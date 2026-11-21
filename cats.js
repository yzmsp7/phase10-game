'use strict';
// 貓貓食堂（Kittys）規則引擎（純邏輯，無 I/O）。介面跟 game.js / fuji.js 一樣（create / act / leave / autoPlay / view），server.js 依 room.kind 選用。
const { randomInt } = require('node:crypto');
const { err } = require('./game');

const CARDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const DEFAULT_ROUNDS = 3;

const log = (g, m) => { g.log.push(m); if (g.log.length > 50) g.log.shift(); };
const nextIn = (g, i) => {
  const n = g.players.length;
  for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (g.players[j].in) return j; }
  return i;
};

function create(players, { rounds = DEFAULT_ROUNDS } = {}) {
  const leader = randomInt(players.length);
  const g = {
    status: 'play', round: 0, rounds, trick: 0, leader, turn: leader, turnNo: 0, evNo: 0,
    ev: null, last: null, log: [], summary: null, winners: null,
    players: players.map(({ id, name }) => ({
      id, name, tokens: 0, totalScore: 0, roundScore: 0, hand: [], played: [], pick: null, roundDeltas: [], in: true,
    })),
  };
  startRound(g);
  return g;
}

function startRound(g) {
  g.round++;
  g.trick = 1;
  g.status = 'play';
  g.summary = null;
  g.last = null;
  for (const p of g.players) {
    p.hand = p.in ? [...CARDS] : [];
    p.played = [];
    p.roundScore = 0;
    p.pick = null;
  }
  if (!g.players[g.leader]?.in) g.leader = nextIn(g, g.leader);
  g.turn = g.leader;
  g.turnNo++;
  log(g, `第 ${g.round}/${g.rounds} 輪開始，${g.players[g.leader].name} 擔任首領`);
}

function resolve(g) {
  const active = g.players.filter((p) => p.in);
  const leader = g.players[g.leader];
  const lv = leader.pick;
  const matchedPlayers = active.filter((p) => p !== leader && p.pick === lv);
  const matched = matchedPlayers.length > 0;
  const picks = [];

  for (const p of active) {
    const n = p.pick;
    p.hand = p.hand.filter((x) => x !== n);
    p.pick = null;
    const isLeader = p === leader;
    let sign, why;
    if (isLeader) {
      sign = matched ? -1 : 1;
      why = matched ? 'leaderMatched' : 'leaderSafe';
    } else if (n === lv) {
      sign = 1;
      why = 'matched';
    } else if (n > lv) {
      sign = -1;
      why = 'over';
    } else {
      sign = 1;
      why = 'under';
    }
    const rec = { trick: g.trick, n, sign, isLeader, why };
    p.played.push(rec);
    p.roundScore += sign * n;
    picks.push({ id: p.id, name: p.name, n, sign, isLeader, why });
  }

  g.ev = g.last = { no: ++g.evNo, round: g.round, trick: g.trick, leader: leader.id, leaderCard: lv, matched, picks };
  const negs = picks.filter((x) => !x.isLeader && x.sign < 0);
  const parts = [`第 ${g.trick} 手：首領 ${leader.name} 出 ${lv}${matched ? `（與 ${matchedPlayers.map((p) => p.name).join('、')} 撞號，首領 −${lv}）` : `（+${lv}）`}`];
  if (negs.length) parts.push(`橫置扣分：${negs.map((x) => `${x.name} −${x.n}`).join('、')}`);
  log(g, parts.join('；'));

  // 首領標記順時針傳給下一位仍在場的玩家
  g.leader = nextIn(g, g.leader);
  g.turn = g.leader;

  if (active.every((p) => !p.hand.length)) endRound(g);
  else { g.trick++; g.turnNo++; }
}

// 一輪結束計分：最高分 +2、第二名 +1、最低分 -1（同分並列；若兩人以上並列最高分則不另給第二名；全員同分則皆 0）
function endRound(g) {
  const active = g.players.filter((p) => p.in);
  const scores = [...new Set(active.map((p) => p.roundScore))].sort((a, b) => b - a);
  const hi = scores[0], lo = scores.at(-1);
  const firsts = active.filter((p) => p.roundScore === hi);
  const second = firsts.length === 1 && scores.length >= 3 ? scores[1] : null;
  const allTied = scores.length <= 1;

  const rows = active.map((p) => {
    let delta = 0;
    if (!allTied) {
      if (p.roundScore === hi) delta = 2;
      else if (p.roundScore === lo) delta = -1;
      else if (second !== null && p.roundScore === second) delta = 1;
    }
    p.tokens += delta;
    p.totalScore += p.roundScore;
    p.roundDeltas.push({ round: g.round, score: p.roundScore, delta });
    return {
      id: p.id, name: p.name, roundScore: p.roundScore, delta, tokens: p.tokens,
      played: [...p.played],
    };
  }).sort((a, b) => b.roundScore - a.roundScore || b.tokens - a.tokens);

  const note = allTied ? '全員本輪同分平手，不加減得分標記' : '';
  g.summary = { round: g.round, rows, note };
  log(g, `第 ${g.round} 輪結算：${rows.map((r) => `${r.name} ${r.roundScore}分(${r.delta > 0 ? '+' : ''}${r.delta})`).join('、')}`);

  if (g.round >= g.rounds) {
    const top = Math.max(...active.map((p) => p.tokens));
    g.winners = active.filter((p) => p.tokens === top).map((p) => p.id);
    g.status = 'over';
    log(g, `遊戲結束！${active.filter((p) => p.tokens === top).map((p) => p.name).join('、')} 獲得喵喵之王稱號！`);
  } else {
    g.status = 'roundEnd';
  }
}

function act(g, pid, a) {
  if (a.type === 'next') {
    if (g.status !== 'roundEnd') err('現在不能開始下一輪');
    return startRound(g);
  }
  if (g.status !== 'play') err('遊戲不在進行中');
  const p = g.players.find((x) => x.id === pid);
  if (!p?.in) err('你不在這局遊戲中');

  if (a.type === 'unpick') {
    if (p.pick === null) err('你還沒蓋牌');
    p.pick = null;
    return;
  }
  if (a.type !== 'pick') err('未知的動作');
  const card = a.card;
  if (!Number.isInteger(card) || !p.hand.includes(card)) err('你沒有這張覓食地點卡');
  p.pick = card;
  if (g.players.every((q) => !q.in || q.pick !== null)) resolve(g);
}

// 中途退出：若剛好是首領，交棒給下一位；若剩下的在場玩家都已蓋牌，立即翻牌結算避免卡死。回傳剩下人數，剩 1 人由 server 關房。
function leave(g, pid) {
  const i = g.players.findIndex((p) => p.id === pid), p = g.players[i];
  const alive = () => g.players.filter((q) => q.in).length;
  if (!p?.in) return alive();
  p.hand = []; p.pick = null; p.in = false; p.left = true;
  log(g, `${p.name} 離開了貓貓食堂`);
  const left = alive();
  if (g.status === 'play' && left > 1) {
    if (g.leader === i) { g.leader = nextIn(g, i); g.turn = g.leader; }
    if (g.players.every((q) => !q.in || q.pick !== null)) resolve(g);
  }
  return left;
}

// 超時代打：替所有還沒蓋牌的在場玩家出目前最小的覓食地點卡
function autoPlay(g) {
  if (g.status !== 'play') return;
  const todo = g.players.filter((p) => p.in && p.pick === null);
  for (const p of todo) {
    if (g.status !== 'play' || !p.hand.length) break;
    act(g, p.id, { type: 'pick', card: Math.min(...p.hand) });
  }
}

function view(g, pid) {
  const me = g.players.find((p) => p.id === pid);
  return {
    status: g.status, round: g.round, rounds: g.rounds, trick: g.trick,
    leader: g.players[g.leader]?.id ?? null,
    turn: g.status === 'play' && me?.in && me.pick === null ? pid : null,
    players: g.players.map((p) => ({
      id: p.id, name: p.name, tokens: p.tokens, totalScore: p.totalScore, roundScore: p.roundScore,
      n: p.hand.length, ready: p.pick !== null, played: p.played, roundDeltas: p.roundDeltas, in: p.in, left: !!p.left,
    })),
    hand: me ? [...me.hand] : [],
    myPick: me ? me.pick : null,
    last: g.last, ev: g.ev, summary: g.summary, winners: g.winners, log: g.log.slice(-12),
  };
}

module.exports = { CARDS, DEFAULT_ROUNDS, create, act, leave, autoPlay, view };
