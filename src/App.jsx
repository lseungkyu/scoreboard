import React, { useState, useMemo, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, onSnapshot, collection, query } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { Plus, Shield, ArrowUp, Save, RefreshCw, Trash2, Database, RotateCcw, TrendingUp, TrendingDown, CheckSquare, Square, Trophy, List, FastForward } from 'lucide-react';

// --- 1. Firebase 설정 ---
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
  { id: 'defense', name: '방어권', type: 'defense', value: 0 },
];

const App = () => {
  const [user, setUser] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [currentRoundPoints, setCurrentRoundPoints] = useState(1);
  const [selectedTeams, setSelectedTeams] = useState([]);
  const [viewMode, setViewMode] = useState('total'); // 'total' (아이템 반영), 'base' (미반영)
  
  const [fixedItemCards, setFixedItemCards] = useState(
    Array.from({ length: TEAM_COUNT }, (_, i) => ({
      teamId: i + 1,
      cardType: 'none',
      value: 0,
      targetId: i === 0 ? '2' : '1'
    }))
  );

  const [isSyncing, setIsSyncing] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("인증 실패:", error);
      }
    };
    initAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, setUser);
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = collection(db, 'artifacts', appId, 'public', 'data', COLLECTION_NAME);
    const unsubscribeData = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data());
      const gameDoc = data.find(d => d.id === 'current_game');
      if (gameDoc && gameDoc.rounds) {
        setRounds(gameDoc.rounds);
      }
    }, (error) => {
      console.error("데이터 수신 에러:", error);
    });
    return () => unsubscribeData();
  }, [user]);

  const saveToCloud = async (updatedRounds) => {
    if (!user) return;
    setIsSyncing(true);
    setStatusMsg("Cloud 동기화 중...");

    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', COLLECTION_NAME, 'current_game');
      const currentStats = calculateAllStats(updatedRounds);
      
      await setDoc(docRef, {
        id: 'current_game',
        rounds: updatedRounds,
        stats: currentStats,
        updatedAt: new Date().toISOString(),
        updatedBy: user.uid
      });
      setStatusMsg("동기화 완료!");
    } catch (error) {
      console.error("저장 실패:", error);
      setStatusMsg("저장 실패!");
    } finally {
      setIsSyncing(false);
      setTimeout(() => setStatusMsg(""), 2000);
    }
  };

  const calculateAllStats = (targetRounds) => {
    let teamScores = Array.from({ length: TEAM_COUNT }, (_, i) => ({
      id: i + 1, 
      baseScore: 0,
      totalScore: 0,
      itemDiff: 0,
      hasDefense: false
    }));

    targetRounds.forEach((round) => {
      // 1. 기본 정답 점수 적용
      teamScores.forEach(team => {
        if (round.winners.includes(team.id)) {
          team.baseScore += round.points;
          team.totalScore += round.points;
        }
      });

      // 2. 해당 라운드 방어권 팀 식별
      const defenders = round.cards.filter(c => c.cardType === 'defense').map(c => c.teamId);

      // 3. 공격 및 추가 점수 카드 적용 (추월 제외)
      round.cards.forEach(card => {
        if (card.cardType === 'none' || card.cardType === 'defense' || card.cardType === 'overtake') return;
        
        const team = teamScores.find(t => t.id === card.teamId);
        if (card.cardType === 'plus') {
          team.totalScore += card.value;
          team.itemDiff += card.value;
        } else if (card.cardType === 'attack') {
          const target = teamScores.find(t => t.id === parseInt(card.targetId));
          // 타겟이 방어권을 쓰고 있지 않을 때만 공격 성공
          if (target && !defenders.includes(target.id)) {
            const stealAmount = Math.min(card.value, target.totalScore);
            target.totalScore -= stealAmount;
            target.itemDiff -= stealAmount;
            team.totalScore += stealAmount;
            team.itemDiff += stealAmount;
          }
        }
      });

      // 4. 추월 카드 적용 (라운드 마지막에 처리)
      round.cards.filter(c => c.cardType === 'overtake').forEach(card => {
        const team = teamScores.find(t => t.id === card.teamId);
        const steps = card.value; // 2등 추월 또는 3등 추월

        // 현재 점수 기준으로 팀들 정렬 (동점은 ID순)
        const sorted = [...teamScores].sort((a, b) => b.totalScore - a.totalScore || a.id - b.id);
        const myIndex = sorted.findIndex(t => t.id === team.id);
        
        // 내 위에 팀이 있어야 추월 가능
        if (myIndex >= steps - 1) {
          const targetTeamInRank = sorted[myIndex - (steps - 1)]; // 2등 추월이면 바로 위(1단계 위) 팀
          
          // 방어권 확인: 나를 넘어서 추월할 수 없음
          // 즉, 내 위로 'steps-1'개 팀 중 방어권을 가진 팀이 있다면 그 팀까지만 추월 가능
          let finalTargetTeam = targetTeamInRank;
          for (let i = 1; i < steps; i++) {
            const stepTeam = sorted[myIndex - i];
            if (defenders.includes(stepTeam.id)) {
              finalTargetTeam = stepTeam;
              break; 
            }
          }

          if (finalTargetTeam && finalTargetTeam.id !== team.id) {
            const oldScore = team.totalScore;
            team.totalScore = finalTargetTeam.totalScore;
            team.itemDiff += (team.totalScore - oldScore);
          }
        }
      });
      
      teamScores.forEach(team => { team.hasDefense = defenders.includes(team.id); });
    });
    return teamScores;
  };

  const addRound = () => {
    if (selectedTeams.length === 0 && fixedItemCards.every(c => c.cardType === 'none')) return;
    
    const activeCards = fixedItemCards.filter(c => c.cardType !== 'none');
    
    const newRound = {
      id: Date.now(),
      points: currentRoundPoints,
      winners: [...selectedTeams],
      cards: activeCards,
    };

    const updatedRounds = [...rounds, newRound];
    setRounds(updatedRounds);
    saveToCloud(updatedRounds);

    setSelectedTeams([]);
    setFixedItemCards(Array.from({ length: TEAM_COUNT }, (_, i) => ({
      teamId: i + 1,
      cardType: 'none',
      value: 0,
      targetId: i === 0 ? '2' : '1'
    })));
  };

  const resetGame = async () => {
    if (!window.confirm("모든 데이터를 초기화하시겠습니까?")) return;
    setRounds([]);
    await saveToCloud([]);
  };

  const selectAllTeams = () => {
    setSelectedTeams(Array.from({ length: TEAM_COUNT }, (_, i) => i + 1));
  };

  const deselectAllTeams = () => {
    setSelectedTeams([]);
  };

  const gameStats = useMemo(() => {
    const stats = calculateAllStats(rounds);
    return stats.sort((a, b) => {
      const scoreA = viewMode === 'total' ? a.totalScore : a.baseScore;
      const scoreB = viewMode === 'total' ? b.totalScore : b.baseScore;
      return scoreB - scoreA || a.id - b.id;
    });
  }, [rounds, viewMode]);

  const updateFixedCard = (index, field, value) => {
    const newCards = [...fixedItemCards];
    if (field === 'cardType') {
      const typeInfo = CARD_TYPES.find(t => t.id === value || t.type === value);
      newCards[index].cardType = typeInfo.type;
      newCards[index].value = typeInfo ? typeInfo.value : 0;
    } else {
      newCards[index][field] = value;
    }
    setFixedItemCards(newCards);
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      {/* 입력 패널 */}
      <div className="w-1/2 p-6 overflow-y-auto border-r border-slate-200">
        <header className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-black text-blue-600 flex items-center gap-2">
              <Database size={24} /> 스코어 관리자
            </h1>
            <p className="text-xs text-slate-500 mt-1 font-medium">실시간 클라우드 동기화 모드</p>
          </div>
          {statusMsg && (
            <div className="bg-blue-600 text-white text-[10px] px-3 py-1 rounded-full animate-pulse font-bold">
              {statusMsg}
            </div>
          )}
        </header>

        <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 mb-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-bold flex items-center gap-2 text-slate-700">라운드 데이터 입력</h2>
            <button onClick={resetGame} className="text-xs font-bold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-xl transition-all border border-red-100 flex items-center gap-1">
              <RotateCcw size={14} /> 초기화
            </button>
          </div>

          <div className="space-y-8">
            {/* 1. 배점 */}
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-3">1. 라운드 배점</label>
              <div className="flex gap-2">
                {[1, 2, 3].map(p => (
                  <button key={p} onClick={() => setCurrentRoundPoints(p)} className={`flex-1 py-3 rounded-2xl font-black transition-all ${currentRoundPoints === p ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                    {p}점
                  </button>
                ))}
              </div>
            </div>

            {/* 2. 정답 조 */}
            <div>
              <div className="flex justify-between items-center mb-3">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">2. 정답 조 선택</label>
                <div className="flex gap-2">
                  <button onClick={selectAllTeams} className="text-[10px] font-bold text-blue-600 flex items-center gap-1 bg-blue-50 px-2 py-1 rounded-lg">
                    <CheckSquare size={12} /> 전체 선택
                  </button>
                  <button onClick={deselectAllTeams} className="text-[10px] font-bold text-slate-500 flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-lg">
                    <Square size={12} /> 전체 해제
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: TEAM_COUNT }, (_, i) => i + 1).map(num => (
                  <button key={num} onClick={() => setSelectedTeams(prev => prev.includes(num) ? prev.filter(t => t !== num) : [...prev, num])} className={`py-2 rounded-xl text-sm font-bold transition-all border-2 ${selectedTeams.includes(num) ? 'bg-emerald-500 border-emerald-500 text-white shadow-md shadow-emerald-100' : 'bg-white border-slate-100 text-slate-600 hover:border-slate-300'}`}>
                    {num}조
                  </button>
                ))}
              </div>
            </div>

            {/* 3. 아이템 카드 (2열 그리드로 수정) */}
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-3">3. 팀별 아이템 사용</label>
              <div className="grid grid-cols-2 gap-2">
                {fixedItemCards.map((card, idx) => (
                  <div key={idx} className={`flex flex-col gap-2 p-3 rounded-2xl border transition-all ${card.cardType !== 'none' ? 'bg-blue-50 border-blue-200 shadow-sm' : 'bg-slate-50 border-slate-100'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-slate-500">{card.teamId}조</span>
                      {card.cardType === 'attack' && (
                        <div className="flex items-center gap-1 animate-in fade-in slide-in-from-right-1">
                          <span className="text-[9px] font-bold text-slate-400">대상:</span>
                          <select 
                            className="bg-white border border-slate-200 rounded-lg px-1.5 py-0.5 text-[10px] font-bold outline-none"
                            value={card.targetId}
                            onChange={(e) => updateFixedCard(idx, 'targetId', e.target.value)}
                          >
                            {Array.from({ length: TEAM_COUNT }, (_, i) => i + 1)
                              .filter(n => n !== card.teamId)
                              .map(n => <option key={n} value={n}>{n}조</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                    <select 
                      className="w-full bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-[11px] font-bold outline-none shadow-sm cursor-pointer"
                      value={CARD_TYPES.find(t => t.type === card.cardType && t.value === card.value)?.id || 'none'}
                      onChange={(e) => updateFixedCard(idx, 'cardType', e.target.value)}
                    >
                      {CARD_TYPES.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <button onClick={addRound} disabled={isSyncing || !user} className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black text-xl flex items-center justify-center gap-3 hover:bg-slate-800 disabled:bg-slate-300 transition-all shadow-xl shadow-slate-200 sticky bottom-0">
              {isSyncing ? <RefreshCw className="animate-spin" /> : <Save />} 라운드 결과 업데이트
            </button>
          </div>
        </section>
      </div>

      {/* 실시간 랭킹 패널 */}
      <div className="w-1/2 p-6 bg-white overflow-y-auto">
        <header className="mb-8">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-3xl font-black text-slate-800 flex items-center gap-3 tracking-tight">
                <ArrowUp size={32} className="text-emerald-500" /> 리더보드
              </h2>
              <p className="text-slate-400 text-sm mt-1">항목별 가중치가 반영된 실시간 순위</p>
            </div>
            <div className="bg-slate-100 p-1.5 rounded-2xl flex gap-1 shadow-inner">
              <button 
                onClick={() => setViewMode('total')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all ${viewMode === 'total' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <Trophy size={14} /> 최종 스코어
              </button>
              <button 
                onClick={() => setViewMode('base')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all ${viewMode === 'base' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <List size={14} /> 기본 스코어
              </button>
            </div>
          </div>
        </header>

        <div className="space-y-4">
          {gameStats.map((team, index) => {
            const currentScore = viewMode === 'total' ? team.totalScore : team.baseScore;
            return (
              <div key={team.id} className={`flex items-center p-5 rounded-3xl border-2 transition-all ${index < 3 ? 'border-slate-900 bg-slate-900 text-white shadow-2xl scale-[1.02] z-10' : 'border-slate-100 bg-slate-50/50'}`}>
                <div className={`w-12 h-12 flex items-center justify-center rounded-2xl font-black text-2xl mr-5 ${index === 0 ? 'bg-yellow-400 text-white shadow-lg shadow-yellow-200' : index === 1 ? 'bg-slate-300 text-slate-600' : index === 2 ? 'bg-orange-400 text-white' : 'bg-white text-slate-400 border border-slate-100'}`}>
                  {index + 1}
                </div>
                
                <div className="flex-1">
                  <div className="text-xl font-black flex items-center gap-2">
                    {team.id}조
                    {team.hasDefense && <Shield size={16} className="text-blue-400 fill-blue-400/20" />}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {viewMode === 'total' ? (
                      <>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${index < 3 ? 'bg-white/10 text-white/60' : 'bg-slate-200 text-slate-500'}`}>
                          정답 점수: {team.baseScore}점
                        </span>
                        {team.itemDiff !== 0 && (
                          <span className={`text-[10px] font-bold flex items-center gap-0.5 ${team.itemDiff > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {team.itemDiff > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                            {Math.abs(team.itemDiff)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${index < 3 ? 'bg-white/10 text-white/60' : 'bg-slate-200 text-slate-500'}`}>
                        아이템 미적용 점수
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <div className={`text-4xl font-black tabular-nums tracking-tighter ${index < 3 ? 'text-yellow-400' : 'text-blue-600'}`}>
                    {currentScore}<span className="text-sm font-bold ml-1 opacity-50">PTS</span>
                  </div>
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
