import React, { useState, useMemo, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, onSnapshot, collection } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { Plus, Shield, ArrowUp, Save, RefreshCw, RotateCcw, Database, Trophy, List, TrendingUp, TrendingDown, CheckSquare, Square, Trash2, History, X } from 'lucide-react';

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
  const [showLeaderboard, setShowLeaderboard] = useState(false); // 리더보드 모달 상태

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

      round.cards.filter(c => c.cardType === 'overtake').forEach(card => {
        const team = teamScores.find(t => t.id === card.teamId);
        const steps = card.value;
        const sorted = [...teamScores].sort((a, b) => b.totalScore - a.totalScore || a.id - b.id);
        const myRankIndex = sorted.findIndex(t => t.id === team.id);
        const targetIndex = myRankIndex - (steps - 1);

        if (targetIndex >= 0) {
          const targetTeamRef = sorted[targetIndex];
          const targetScoreValue = targetTeamRef.totalScore;
          let isBlocked = false;

          for (let i = 0; i < myRankIndex; i++) {
            if (sorted[i].defenseStack > 0) {
              sorted[i].defenseStack -= 1;
              isBlocked = true;
              break;
            }
          }

          if (!isBlocked) {
            const oldScore = team.totalScore;
            team.totalScore = targetScoreValue + 1;
            team.itemDiff += (team.totalScore - oldScore);
          }
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
    setFixedItemCards(prev => prev.map(c => ({ ...c, cardType: 'none', value: 0, targetId: c.teamId === 1 ? '2' : '1' })));
  };

  const deleteRound = (roundId) => {
    if (window.confirm("선택한 라운드를 삭제하고 점수를 되돌리시겠습니까?")) {
      const updated = rounds.filter(r => r.id !== roundId);
      setRounds(updated);
      saveToCloud(updated);
    }
  };

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
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans relative">
      {/* 리더보드 모달 (버튼 누를 때만 등장) */}
      {showLeaderboard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
            <header className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h2 className="text-3xl font-black flex items-center gap-3 text-slate-800"><Trophy className="text-yellow-500" /> 리더보드</h2>
                <p className="text-slate-400 text-sm font-bold">전체 순위 및 점수 현황</p>
              </div>
              <button onClick={() => setShowLeaderboard(false)} className="p-3 bg-white rounded-2xl shadow-sm text-slate-400 hover:text-red-500 transition-colors">
                <X size={24} />
              </button>
            </header>
            <div className="p-8 overflow-y-auto max-h-[70vh]">
              <div className="flex justify-center mb-6 bg-slate-100 p-1.5 rounded-2xl w-fit mx-auto">
                <button onClick={() => setViewMode('total')} className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${viewMode === 'total' ? 'bg-white shadow-md text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>최종 점수</button>
                <button onClick={() => setViewMode('base')} className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${viewMode === 'base' ? 'bg-white shadow-md text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>기본 점수</button>
              </div>
              <div className="space-y-3">
                {gameStats.map((team) => {
                  const currentScore = viewMode === 'total' ? team.totalScore : team.baseScore;
                  const isTop3 = team.displayRank <= 3;
                  return (
                    <div key={team.id} className={`flex items-center p-4 rounded-2xl border-2 transition-all ${isTop3 ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-100 bg-slate-50'}`}>
                      <div className={`w-10 h-10 flex items-center justify-center rounded-xl font-black text-lg mr-4 ${team.displayRank === 1 ? 'bg-yellow-400 text-slate-900' : team.displayRank === 2 ? 'bg-slate-300 text-slate-800' : team.displayRank === 3 ? 'bg-orange-400 text-white' : 'bg-white text-slate-400 border border-slate-100'}`}>
                        {team.displayRank}
                      </div>
                      <div className="flex-1">
                        <div className="text-lg font-black">{team.id}조</div>
                        <div className={`text-[10px] font-bold opacity-60`}>정답: {team.baseScore} / 아이템 변동: {team.itemDiff > 0 ? `+${team.itemDiff}` : team.itemDiff}</div>
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
        </div>
      )}

      {/* 왼쪽 패널: 관리자 입력 섹션 */}
      <div className="w-1/2 p-6 overflow-y-auto border-r border-slate-200">
        <header className="mb-6 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-black text-blue-600 flex items-center gap-2"><Database /> 관리자</h1>
            <button
              onClick={() => setShowLeaderboard(true)}
              className="px-4 py-2 bg-yellow-400 text-slate-900 rounded-2xl text-xs font-black shadow-lg shadow-yellow-100 flex items-center gap-2 hover:scale-105 transition-transform"
            >
              <Trophy size={14} /> 리더보드 확인
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={resetGame} className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-xl text-xs font-bold border border-red-100 hover:bg-red-100 transition-colors">
              <RotateCcw size={14} /> 초기화
            </button>
            {statusMsg && <div className="bg-blue-600 text-white text-[10px] px-3 py-1 rounded-full">{statusMsg}</div>}
          </div>
        </header>

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 space-y-6">
            {/* 1. 아이템 카드 설정 (기존 유지) */}
            <div>
              <label className="text-sm font-black text-slate-500 mb-4 flex items-center gap-2">
                <Shield size={18} className="text-blue-500" /> 아이템 카드 설정
              </label>
              <div className="grid grid-cols-1 gap-4">
                {fixedItemCards.map((card, idx) => (
                  <div key={idx} className={`p-5 rounded-[2.5rem] border-2 transition-all duration-300 ${card.cardType !== 'none' ? 'bg-slate-900 border-slate-900 shadow-xl' : 'bg-white border-slate-100'}`}>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className={`text-xl font-black min-w-[50px] ${card.cardType !== 'none' ? 'text-white' : 'text-slate-800'}`}>{card.teamId}조</div>
                      <div className="flex flex-wrap gap-2 flex-1">
                        {CARD_TYPES.map((type) => {
                          const isSelected = (type.type === card.cardType && (type.type !== 'defense' ? type.value === card.value : true));
                          const getBtnClass = () => {
                            if (!isSelected) return 'bg-slate-100 text-slate-400 border-transparent';
                            if (type.type === 'attack') return 'bg-red-500 text-white border-red-400';
                            if (type.type === 'plus') return 'bg-emerald-500 text-white border-emerald-400';
                            if (type.type === 'overtake') return 'bg-purple-500 text-white border-purple-400';
                            if (type.type === 'defense') return 'bg-amber-500 text-white border-amber-400';
                            return 'bg-slate-500 text-white border-slate-400';
                          };
                          return (
                            <button key={type.id} onClick={() => updateFixedCard(idx, 'cardType', type.id)} className={`px-3 py-2 rounded-xl text-[11px] font-black border-2 transition-all active:scale-90 ${getBtnClass()}`}>{type.name}</button>
                          );
                        })}
                      </div>
                    </div>
                    {(card.cardType === 'attack' || card.cardType === 'defense') && (
                      <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap items-center gap-4">
                        {card.cardType === 'attack' && (
                          <div className="flex items-center gap-2 bg-white/10 p-2 rounded-2xl w-full">
                            <span className="text-xs font-bold text-white/70 ml-2">공격 대상:</span>
                            <div className="flex flex-wrap gap-1">
                              {Array.from({ length: TEAM_COUNT }, (_, i) => i + 1).filter(n => n !== card.teamId).map(n => (
                                <button key={n} onClick={() => updateFixedCard(idx, 'targetId', n)} className={`w-8 h-8 rounded-lg text-xs font-black transition-all ${parseInt(card.targetId) === n ? 'bg-red-500 text-white' : 'bg-white/20 text-white/50 hover:bg-white/30'}`}>{n}</button>
                              ))}
                            </div>
                          </div>
                        )}
                        {card.cardType === 'defense' && (
                          <div className="flex items-center justify-between bg-white/10 p-3 rounded-2xl w-full">
                            <span className="text-xs font-bold text-white/70 ml-2">방어권 사용 수량</span>
                            <div className="flex items-center gap-3">
                              <button onClick={() => updateFixedCard(idx, 'value', Math.max(1, card.value - 1))} className="w-10 h-10 bg-white/20 text-white rounded-xl font-black flex items-center justify-center active:scale-90">-</button>
                              <span className="text-xl font-black text-white w-8 text-center">{card.value}</span>
                              <button onClick={() => updateFixedCard(idx, 'value', card.value + 1)} className="w-10 h-10 bg-white/20 text-white rounded-xl font-black flex items-center justify-center active:scale-90">+</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 2. 배점 설정 */}
            <div>
              <label className="text-xs font-bold text-slate-400 mb-3 block uppercase tracking-wider">배점 설정</label>
              <div className="flex gap-2">
                {[1, 2, 3].map(p => (
                  <button key={p} onClick={() => setCurrentRoundPoints(p)} className={`flex-1 py-4 rounded-2xl font-black text-lg transition-all ${currentRoundPoints === p ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>{p}점</button>
                ))}
              </div>
            </div>

            {/* 3. 정답 조 선택 */}
            <div>
              <label className="text-xs font-bold text-slate-400 mb-3 block uppercase tracking-wider">정답 조 선택</label>
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: TEAM_COUNT }, (_, i) => i + 1).map(num => (
                  <button key={num} onClick={() => setSelectedTeams(prev => prev.includes(num) ? prev.filter(t => t !== num) : [...prev, num])} className={`py-3 rounded-2xl text-base font-black border-2 transition-all ${selectedTeams.includes(num) ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-100' : 'bg-white border-slate-100 text-slate-600 hover:border-slate-300'}`}>{num}조</button>
                ))}
              </div>
            </div>

            <button onClick={addRound} className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-xl flex items-center justify-center gap-3 active:scale-95 transition-transform shadow-xl">
              {isSyncing ? <RefreshCw className="animate-spin" /> : <Save />} 라운드 업데이트 및 저장
            </button>
          </div>
        </div>
      </div>

      {/* 오른쪽 패널: 상세 라운드 기록 섹션 (교체됨) */}
      <div className="w-1/2 p-8 bg-slate-100 overflow-y-auto">
        <header className="mb-8">
          <h2 className="text-3xl font-black flex items-center gap-3 text-slate-800"><History size={32} className="text-blue-500" /> 상세 기록 로그</h2>
          <p className="text-slate-400 text-sm font-bold mt-1">라운드별 정답 및 아이템 사용 내역을 실시간으로 확인합니다.</p>
        </header>

        <div className="grid grid-cols-1 gap-4">
          {rounds.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 bg-white/50 rounded-[3rem] border-2 border-dashed border-slate-200">
              <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mb-4"><List className="text-slate-400" /></div>
              <div className="text-slate-400 font-black">아직 기록된 라운드가 없습니다.</div>
            </div>
          ) : (
            [...rounds].reverse().map((r, i) => (
              <div key={r.id} className="p-6 bg-white rounded-[2.5rem] shadow-sm border border-slate-200 space-y-4 animate-in slide-in-from-right duration-300">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <span className="px-3 py-1 bg-blue-100 text-blue-600 rounded-full text-[10px] font-black uppercase mb-1 inline-block">ROUND {rounds.length - i}</span>
                    <h4 className="text-lg font-black text-slate-800">기본 배점 <span className="text-blue-600">{r.points}점</span></h4>
                  </div>
                  <button onClick={() => deleteRound(r.id)} className="p-3 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-2xl transition-all">
                    <Trash2 size={20} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  {/* 정답 조 */}
                  <div>
                    <span className="text-[11px] font-black text-slate-400 uppercase mb-2 block">정답 조</span>
                    <div className="flex flex-wrap gap-2">
                      {r.winners.length > 0 ? r.winners.sort((a, b) => a - b).map(w => (
                        <span key={w} className="px-3 py-1 bg-emerald-500 text-white rounded-xl text-xs font-black shadow-sm">{w}조</span>
                      )) : <span className="text-xs text-slate-300 italic font-bold">없음</span>}
                    </div>
                  </div>

                  {/* 사용된 아이템 */}
                  <div>
                    <span className="text-[11px] font-black text-slate-400 uppercase mb-2 block">사용된 아이템 ({r.cards.length})</span>
                    <div className="space-y-1.5">
                      {r.cards.length > 0 ? r.cards.map((c, idx) => {
                        const cardInfo = CARD_TYPES.find(t => t.type === c.cardType && (t.type !== 'defense' ? t.value === c.value : true));
                        return (
                          <div key={idx} className="flex items-center gap-2 text-[11px] bg-slate-50 p-2 rounded-xl border border-slate-100">
                            <span className="font-black text-slate-700">{c.teamId}조</span>
                            <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                            <span className="text-blue-600 font-black">{cardInfo?.name}</span>
                            {c.cardType === 'attack' && <span className="text-red-500 font-black">→ {c.targetId}조</span>}
                            {c.cardType === 'defense' && <span className="text-amber-500 font-black">({c.value}장)</span>}
                          </div>
                        );
                      }) : <span className="text-xs text-slate-300 italic font-bold">아이템 미사용</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default App;