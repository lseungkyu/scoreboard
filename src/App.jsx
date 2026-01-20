import React, { useState, useMemo, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, onSnapshot, collection } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { Plus, Shield, ArrowUp, Save, RefreshCw, RotateCcw, Database, Trophy, List, TrendingUp, TrendingDown, CheckSquare, Square, Trash2 } from 'lucide-react';

// --- Firebase 설정 ---
const firebaseConfig = {
  apiKey: "AIzaSyCxCOVwf1cY7dx1B9Bk0pTIsxww_Bc8qTQ",
  authDomain: "biblequizcloud.firebaseapp.com",
  projectId: "biblequizcloud",
  storageBucket: "biblequizcloud.firebasestorage.app",
  messagingSenderId: "794279182240",
  appId: "1:794279182240:web:63f70343a050513d902ec5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

const TEAM_COUNT = 12;
const COLLECTION_NAME = "team_scores";

const CARD_TYPES = [
  { id: 'none', name: '아이템 없음', type: 'none', value: 0 },
  { id: 'attack_1', name: '공격(1점)', type: 'attack', value: 1 },
  { id: 'attack_2', name: '공격(2점)', type: 'attack', value: 2 },
  { id: 'attack_3', name: '공격(3점)', type: 'attack', value: 3 },
  { id: 'plus_1', name: '추가점수(1점)', type: 'plus', value: 1 },
  { id: 'plus_2', name: '추가점수(2점)', type: 'plus', value: 2 },
  { id: 'plus_3', name: '추가점수(3점)', type: 'plus', value: 3 },
  { id: 'overtake_2', name: '2등 추월', type: 'overtake', value: 2 },
  { id: 'overtake_3', name: '3등 추월', type: 'overtake', value: 3 },
  { id: 'defense', name: '방어권', type: 'defense', value: 1 },
];

const App = () => {
  const [user, setUser] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [currentRoundPoints, setCurrentRoundPoints] = useState(1);
  const [selectedTeams, setSelectedTeams] = useState([]);
  const [viewMode, setViewMode] = useState('total');
  const [statusMsg, setStatusMsg] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);

  const [fixedItemCards, setFixedItemCards] = useState(
    Array.from({ length: TEAM_COUNT }, (_, i) => ({
      teamId: i + 1,
      cardType: 'none',
      value: 0,
      targetId: i === 0 ? '2' : '1'
    }))
  );

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) { console.error(e); }
    };
    initAuth();
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = collection(db, 'artifacts', appId, 'public', 'data', COLLECTION_NAME);
    return onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data());
      const gameDoc = data.find(d => d.id === 'current_game');
      if (gameDoc?.rounds) setRounds(gameDoc.rounds);
    });
  }, [user]);

  const calculateAllStats = (targetRounds) => {
    let teamScores = Array.from({ length: TEAM_COUNT }, (_, i) => ({
      id: i + 1,
      baseScore: 0,
      totalScore: 0,
      itemDiff: 0,
      defenseStack: 0
    }));

    targetRounds.forEach((round) => {
      teamScores.forEach(t => {
        if (round.winners.includes(t.id)) {
          t.baseScore += round.points;
          t.totalScore += round.points;
        }
      });

      round.cards.filter(c => c.cardType === 'defense').forEach(card => {
        const team = teamScores.find(t => t.id === card.teamId);
        if (team) team.defenseStack += card.value;
      });

      round.cards.forEach(card => {
        const team = teamScores.find(t => t.id === card.teamId);
        if (card.cardType === 'plus') {
          team.totalScore += card.value;
          team.itemDiff += card.value;
        } else if (card.cardType === 'attack') {
          const target = teamScores.find(t => t.id === parseInt(card.targetId));
          if (target) {
            if (target.defenseStack > 0) {
              target.defenseStack -= 1;
            } else {
              const steal = Math.min(card.value, target.totalScore);
              target.totalScore -= steal;
              target.itemDiff -= steal;
              team.totalScore += steal;
              team.itemDiff += steal;
            }
          }
        }
      });

      // 4. 추월 로직 최종 수정: 전체 구간 방어권 전수 조사
      round.cards.filter(c => c.cardType === 'overtake').forEach(card => {
        const team = teamScores.find(t => t.id === card.teamId);
        const steps = card.value; // 2(2등 추월) 또는 3(3등 추월)

        // 현재 점수 기준 내림차순 정렬 (동점 시 ID순으로 고유 인덱스 부여)
        const sorted = [...teamScores].sort((a, b) => b.totalScore - a.totalScore || a.id - b.id);
        const myRankIndex = sorted.findIndex(t => t.id === team.id);

        // 목표 인덱스 설정 (나보다 steps-1 만큼 앞선 팀의 점수 참조)
        const targetIndex = myRankIndex - (steps - 1);

        if (targetIndex >= 0) {
          const targetTeamRef = sorted[targetIndex];
          const targetScoreValue = targetTeamRef.totalScore;

          // [해결 포인트] 경로 체크 범위를 '0번 인덱스(1등)'부터 '내 바로 위 인덱스'까지가 아니라,
          // '목표 지점(targetIndex)'부터 '내 바로 위(myRankIndex - 1)'까지 "모든 팀"을 검사합니다.
          let isBlocked = false;

          // 내 위로 존재하는 모든 팀 중 하나라도 방어권이 있는지 확인
          for (let i = 0; i < myRankIndex; i++) {
            // 특히 '목표 점수'와 같거나 높은 점수를 가진 팀들이 방어권을 썼는지 확인
            if (sorted[i].defenseStack > 0) {
              // 추월 경로 상에 있거나 목표 순위권에 있는 팀이 막아섬
              sorted[i].defenseStack -= 1; // 방어권 1개 소모
              isBlocked = true;
              break;
            }
          }

          if (!isBlocked) {
            // 방어막이 전혀 없을 때만 점수 상승 (+1점)
            const oldScore = team.totalScore;
            team.totalScore = targetScoreValue + 1;
            team.itemDiff += (team.totalScore - oldScore);
          }
          // isBlocked가 true면 점수 변동 없이 카드가 소모됩니다.
        }
      });

      teamScores.forEach(t => t.defenseStack = 0);
    });

    const sortedFinal = [...teamScores].sort((a, b) => b.totalScore - a.totalScore);
    let currentRank = 1;
    sortedFinal.forEach((team, idx) => {
      if (idx > 0 && team.totalScore < sortedFinal[idx - 1].totalScore) {
        currentRank = idx + 1;
      }
      team.displayRank = currentRank;
    });

    return teamScores;
  };

  const saveToCloud = async (updatedRounds) => {
    if (!user) return;
    setIsSyncing(true);
    setStatusMsg("저장 중...");
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', COLLECTION_NAME, 'current_game');
      await setDoc(docRef, {
        id: 'current_game',
        rounds: updatedRounds,
        updatedAt: new Date().toISOString()
      });
      setStatusMsg("완료");
    } catch (e) { setStatusMsg("에러"); }
    finally { setIsSyncing(false); setTimeout(() => setStatusMsg(""), 2000); }
  };

  const addRound = () => {
    const activeCards = fixedItemCards.filter(c => c.cardType !== 'none');
    const newRound = { id: Date.now(), points: currentRoundPoints, winners: [...selectedTeams], cards: activeCards };
    const updated = [...rounds, newRound];
    setRounds(updated);
    saveToCloud(updated);
    setSelectedTeams([]);
    setFixedItemCards(prev => prev.map(c => ({ ...c, cardType: 'none', value: 0 })));
  };

  // --- 추가된 초기화 함수 ---
  const resetGame = async () => {
    if (window.confirm("모든 라운드 데이터와 점수를 초기화하시겠습니까?")) {
      setRounds([]);
      await saveToCloud([]);
    }
  };

  const gameStats = useMemo(() => {
    const stats = calculateAllStats(rounds);
    return stats.sort((a, b) => {
      const scoreA = viewMode === 'total' ? a.totalScore : a.baseScore;
      const scoreB = viewMode === 'total' ? b.totalScore : b.baseScore;
      return scoreB - scoreA || a.id - b.id;
    });
  }, [rounds, viewMode]);

  const updateFixedCard = (index, field, val) => {
    const newCards = [...fixedItemCards];
    if (field === 'cardType') {
      const info = CARD_TYPES.find(t => t.id === val);
      newCards[index].cardType = info.type;
      newCards[index].value = info.value;
    } else {
      newCards[index][field] = parseInt(val) || 0;
    }
    setFixedItemCards(newCards);
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <div className="w-1/2 p-6 overflow-y-auto border-r border-slate-200">
        <header className="mb-6 flex justify-between items-center">
          <h1 className="text-2xl font-black text-blue-600 flex items-center gap-2"><Database /> 관리자</h1>
          <div className="flex items-center gap-3">
            {/* 초기화 버튼 추가 */}
            <button
              onClick={resetGame}
              className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-xl text-xs font-bold border border-red-100 hover:bg-red-100 transition-colors"
            >
              <RotateCcw size={14} /> 점수 초기화
            </button>
            {statusMsg && <div className="bg-blue-600 text-white text-[10px] px-3 py-1 rounded-full">{statusMsg}</div>}
          </div>
        </header>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 space-y-8">
          <div>
            <label className="text-xs font-bold text-slate-400 mb-3 block">배점 설정</label>
            <div className="flex gap-2">
              {[1, 2, 3].map(p => (
                <button key={p} onClick={() => setCurrentRoundPoints(p)} className={`flex-1 py-3 rounded-2xl font-black ${currentRoundPoints === p ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{p}점</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 mb-3 block">정답 조</label>
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: TEAM_COUNT }, (_, i) => i + 1).map(num => (
                <button key={num} onClick={() => setSelectedTeams(prev => prev.includes(num) ? prev.filter(t => t !== num) : [...prev, num])} className={`py-2 rounded-xl text-sm font-bold border-2 ${selectedTeams.includes(num) ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white text-slate-600'}`}>{num}조</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 mb-3 block">아이템 카드 (방어권 수량 입력 가능)</label>
            <div className="grid grid-cols-2 gap-2">
              {fixedItemCards.map((card, idx) => (
                <div key={idx} className={`p-3 rounded-2xl border ${card.cardType !== 'none' ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-100'}`}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-black">{card.teamId}조</span>
                    {card.cardType === 'attack' && (
                      <select className="text-[10px] border rounded p-0.5" value={card.targetId} onChange={(e) => updateFixedCard(idx, 'targetId', e.target.value)}>
                        {Array.from({ length: TEAM_COUNT }, (_, i) => i + 1).filter(n => n !== card.teamId).map(n => <option key={n} value={n}>{n}조</option>)}
                      </select>
                    )}
                    {card.cardType === 'defense' && (
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-bold">수량:</span>
                        <input type="number" min="1" className="w-8 text-[10px] border rounded px-1" value={card.value} onChange={(e) => updateFixedCard(idx, 'value', e.target.value)} />
                      </div>
                    )}
                  </div>
                  <select className="w-full text-[11px] font-bold p-1.5 rounded-xl border" value={CARD_TYPES.find(t => t.type === card.cardType && (t.type !== 'defense' ? t.value === card.value : true))?.id || 'none'} onChange={(e) => updateFixedCard(idx, 'cardType', e.target.value)}>
                    {CARD_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <button onClick={addRound} className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black text-xl flex items-center justify-center gap-3">
            {isSyncing ? <RefreshCw className="animate-spin" /> : <Save />} 라운드 업데이트
          </button>
        </div>
      </div>

      <div className="w-1/2 p-6 bg-white overflow-y-auto">
        <header className="mb-8 flex justify-between items-end">
          <div>
            <h2 className="text-3xl font-black flex items-center gap-3"><ArrowUp className="text-emerald-500" /> 리더보드</h2>
            <p className="text-slate-400 text-sm">동점 시 같은 등수로 표시됩니다.</p>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button onClick={() => setViewMode('total')} className={`px-4 py-2 rounded-lg text-xs font-bold ${viewMode === 'total' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>최종</button>
            <button onClick={() => setViewMode('base')} className={`px-4 py-2 rounded-lg text-xs font-bold ${viewMode === 'base' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}>기본</button>
          </div>
        </header>

        <div className="space-y-3">
          {gameStats.map((team, index) => {
            const currentScore = viewMode === 'total' ? team.totalScore : team.baseScore;
            const isTop3 = team.displayRank <= 3;
            return (
              <div key={team.id} className={`flex items-center p-4 rounded-2xl border-2 transition-all ${isTop3 ? 'border-slate-800 bg-slate-800 text-white shadow-lg' : 'border-slate-100 bg-slate-50'}`}>
                <div className={`w-10 h-10 flex items-center justify-center rounded-xl font-black text-lg mr-4 ${team.displayRank === 1 ? 'bg-yellow-400' : team.displayRank === 2 ? 'bg-slate-300 text-slate-800' : team.displayRank === 3 ? 'bg-orange-400' : 'bg-white text-slate-400'}`}>
                  {team.displayRank}
                </div>
                <div className="flex-1">
                  <div className="text-lg font-black">{team.id}조</div>
                  <div className="text-[10px] opacity-60">정답: {team.baseScore} / 아이템: {team.itemDiff > 0 ? `+${team.itemDiff}` : team.itemDiff}</div>
                </div>
                <div className="text-right">
                  <div className={`text-3xl font-black ${isTop3 ? 'text-yellow-400' : 'text-blue-600'}`}>{currentScore}<span className="text-xs ml-1 opacity-50">PTS</span></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default App;