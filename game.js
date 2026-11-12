'use strict';
// Phase 10 規則引擎（純邏輯，無 I/O）。規則依據 Mattel W4729 說明書。
const { randomInt } = require('node:crypto');

const COLORS = ['R', 'B', 'G', 'Y'];
const PHASES = [
  [['set', 3], ['set', 3]],
  [['set', 3], ['run', 4]],
  [['set', 4], ['run', 4]],
  [['run', 7]],
  [['run', 8]],
  [['run', 9]],
  [['set', 4], ['set', 4]],
  [['color', 7]],
  [['set', 5], ['set', 2]],
  [['set', 5], ['set', 3]],
];
const HAND = 10;
const err = (m) => { throw Object.assign(new Error(m), { user: true }); };

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// t: n=數字牌 w=百搭 s=跳過
function deck() {
  const d = []; let id = 0;
  for (let k = 0; k < 2; k++) for (const c of COLORS) for (let n = 1; n <= 12; n++) d.push({ id: id++, t: 'n', c, n });
  for (let i = 0; i < 8; i++) d.push({ id: id++, t: 'w' });
  for (let i = 0; i < 4; i++) d.push({ id: id++, t: 's' });
  return d;
}

const pts = (c) => (c.t === 'w' ? 25 : c.t === 's' ? 15 : c.n >= 10 ? 10 : 5);

// 驗證並排好一組牌。順子：百搭補洞，多餘的百搭往大的一端延伸。
// ponytail: 不支援手動指定百搭位置，需要時改成讓玩家傳入排好的順序。
function build(type, size, cards) {
  if (cards.length !== size) err(`這組需要 ${size} 張牌`);
  if (cards.some((c) => c.t === 's')) err('跳過牌不能用在階段中');
  const nat = cards.filter((c) => c.t === 'n');
  if (!nat.length) err('每組至少要有一張數字牌');
  if (type === 'set') {
    if (new Set(nat.map((c) => c.n)).size > 1) err('同一組的數字必須相同');
    return { type, n: nat[0].n, cards };
  }
  if (type === 'color') {
    if (new Set(nat.map((c) => c.c)).size > 1) err('必須是同一種顏色');
    return { type, c: nat[0].c, cards };
  }
  const ns = nat.map((c) => c.n);
  if (new Set(ns).size < ns.length) err('順子不能有重複的數字');
  const min = Math.min(...ns);
  if (Math.max(...ns) - min + 1 > size) err('數字間隔太大，百搭牌補不起來');
  const lo = Math.min(min, 13 - size);
  const wilds = cards.filter((c) => c.t === 'w');
  const slots = Array.from({ length: size }, (_, i) => nat.find((c) => c.n === lo + i) || wilds.pop());
  return { type, lo, hi: lo + size - 1, cards: slots };
}

// 接牌：回傳新的 group，不合法就丟錯（不改動原物件）。
function hit(grp, cards, end) {
  const g = { ...grp, cards: [...grp.cards] };
  if (g.type !== 'run') {
    const ok = (c) => c.t === 'w' || (c.t === 'n' && (g.type === 'set' ? c.n === g.n : c.c === g.c));
    if (!cards.every(ok)) err('這張牌不能接在這一組');
    g.cards.push(...cards);
    return g;
  }
  let rest = [...cards];
  for (let moved = true; moved && rest.length;) {
    moved = false;
    for (const c of rest) {
      if (c.t !== 'n') continue;
      if (c.n === g.hi + 1) { g.cards.push(c); g.hi++; } else if (c.n === g.lo - 1) { g.cards.unshift(c); g.lo--; } else continue;
      rest = rest.filter((x) => x !== c); moved = true; break;
    }
  }
  for (const c of rest) {
    if (c.t !== 'w') err('這張牌不能接在這一組');
    const up = end === 'lo' ? false : end === 'hi' ? true : g.hi < 12;
    if (up ? g.hi >= 12 : g.lo <= 1) err('順子已經到頭了');
    if (up) { g.cards.push(c); g.hi++; } else { g.cards.unshift(c); g.lo--; }
  }
  return g;
}

const log = (g, m) => { g.log.push(m); if (g.log.length > 50) g.log.shift(); };
const nextIn = (g, i) => {
  for (let k = 1; k <= g.players.length; k++) { const j = (i + k) % g.players.length; if (g.players[j].in) return j; }
  return i;
};
const lowest = (ps) => { const m = Math.min(...ps.map((p) => p.score)); return ps.filter((p) => p.score === m); };

function create(players, { target }) {
  const g = {
    target, round: 0, dealer: randomInt(players.length), turn: 0, stage: 'draw', status: 'play',
    players: players.map(({ id, name }) => ({ id, name, phase: 1, score: 0, hand: [], laid: false, skip: 0, in: true })),
    draw: [], disc: [], groups: [], log: [], summary: null, winners: null, playoff: null,
  };
  startRound(g);
  return g;
}

function startRound(g) {
  g.round++;
  if (g.round > 1) g.dealer = (g.dealer + 1) % g.players.length;
  const d = shuffle(deck());
  for (const p of g.players) {
    p.in = !p.left && (!g.playoff || g.playoff.includes(p.id)); // 中途退出的人不會再被發牌
    p.laid = false; p.skip = 0; p.pick = null;
    p.hand = p.in ? d.splice(0, HAND) : [];
  }
  g.disc = [d.pop()];
  g.draw = d;
  g.groups = []; g.status = 'play'; g.summary = null;
  g.turn = nextIn(g, g.dealer);
  log(g, g.playoff ? `加賽開始（第 ${g.round} 回合）` : `第 ${g.round} 回合開始`);
  if (g.disc[0].t === 's') { g.players[g.turn].skip = 1; log(g, '翻開的第一張是跳過牌'); }
  begin(g);
}

// 回合開始：處理被跳過的玩家。skip 狀態 0=正常 1=等著被跳過 2=剛被跳過（下一個正常回合前不能再被跳）
function begin(g) {
  for (let p = g.players[g.turn]; p.skip === 1; p = g.players[g.turn]) {
    p.skip = 2; log(g, `${p.name} 被跳過一回合`); g.turn = nextIn(g, g.turn);
  }
  g.stage = 'draw';
}

function endRound(g, out) {
  const w = g.players[out];
  const live = g.players.filter((p) => p.in);
  const done = live.filter((p) => p.laid && p.phase >= g.target);
  const rows = live.map((p) => {
    const gain = p === w ? 0 : p.hand.reduce((s, c) => s + pts(c), 0);
    p.score += gain;
    return { id: p.id, name: p.name, phase: p.phase, laid: p.laid, gain, score: p.score, hand: [...p.hand] };
  });
  live.forEach((p) => { if (p.laid) p.phase++; }); // 只有完成階段的人才進下一階段
  let winners = null, note = '';
  if (g.playoff) winners = [w];
  else if (done.length) {
    const best = lowest(done);
    if (best.length > 1) {
      g.playoff = best.map((p) => p.id);
      best.forEach((p) => { p.phase = g.target; });
      note = `${best.map((p) => p.name).join('、')} 同分平手，加賽第 ${g.target} 階段，先出完牌者獲勝`;
    } else winners = best;
  }
  g.summary = { rows, out: w.id, note };
  g.winners = winners && winners.map((p) => p.id);
  g.status = winners ? 'over' : 'roundEnd';
  log(g, `${w.name} 出完牌，回合結束`);
}

const take = (p, ids) => {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) err('選牌有誤');
  return ids.map((id) => p.hand.find((c) => c.id === id) || err('你沒有這張牌'));
};

function act(g, pid, a) {
  if (a.type === 'next') {
    if (g.status !== 'roundEnd') err('現在不能開始下一回合');
    return startRound(g);
  }
  if (g.status !== 'play') err('遊戲不在進行中');
  const p = g.players[g.turn];
  if (p.id !== pid) err('還沒輪到你');
  const drop = (cards) => { p.hand = p.hand.filter((c) => !cards.includes(c)); };
  const needAct = () => { if (g.stage !== 'act') err('請先抽一張牌'); };

  switch (a.type) {
    case 'draw': {
      if (g.stage !== 'draw') err('這回合已經抽過牌了');
      if (a.from === 'discard') {
        const top = g.disc.at(-1);
        if (!top || top.t === 's') err('跳過牌不能撿');
        p.hand.push(g.disc.pop());
        p.pick = { from: 'discard', card: p.hand.at(-1) }; // 棄牌堆頂本來就公開，所以連牌面一起給別人看
      } else {
        if (!g.draw.length) { const top = g.disc.pop(); g.draw = shuffle(g.disc); g.disc = [top]; }
        if (!g.draw.length) err('牌堆已空，請改拿棄牌');
        p.hand.push(g.draw.pop());
        p.pick = { from: 'pile' }; // 牌堆抽的牌不公開
      }
      g.stage = 'act';
      return;
    }
    case 'lay': {
      needAct();
      if (p.laid) err('這回合已經放下階段了');
      const req = PHASES[p.phase - 1];
      if (!Array.isArray(a.groups) || a.groups.length !== req.length || !a.groups.every(Array.isArray)) err('組數不對');
      const cards = take(p, a.groups.flat());
      let k = 0;
      const built = req.map(([t, s], i) => build(t, s, cards.slice(k, (k += a.groups[i].length))));
      drop(cards);
      built.forEach((b) => g.groups.push({ ...b, owner: p.id }));
      p.laid = true;
      log(g, `${p.name} 放下了第 ${p.phase} 階段`);
      if (!p.hand.length) endRound(g, g.turn);
      return;
    }
    case 'hit': {
      needAct();
      if (!p.laid) err('要先放下自己的階段才能接牌');
      const t = g.groups[a.group] || err('找不到這一組');
      const cards = take(p, a.cards);
      if (!cards.length) err('請先選要接的牌');
      g.groups[a.group] = hit(t, cards, a.end);
      drop(cards);
      log(g, `${p.name} 接了 ${cards.length} 張牌`);
      if (!p.hand.length) endRound(g, g.turn);
      return;
    }
    case 'discard': {
      needAct();
      const [c] = take(p, [a.card]);
      let target = null;
      if (c.t === 's' && p.hand.length > 1) {
        const ok = g.players.filter((q) => q.in && q !== p && q.skip === 0);
        if (ok.length) target = ok.find((q) => q.id === a.target) || err('請選擇要跳過的玩家');
      }
      drop([c]); g.disc.push(c);
      if (target) { target.skip = 1; log(g, `${p.name} 打出跳過牌，${target.name} 將少一回合`); }
      if (!p.hand.length) return endRound(g, g.turn);
      p.skip = 0;
      g.turn = nextIn(g, g.turn);
      return begin(g);
    }
    default: err('未知的動作');
  }
}

// 遊戲中途退出：不刪玩家（turn / dealer / playoff / groups[].owner 都靠索引或 id 指著他），
// 只標記 in=false + left=true，沿用加賽淘汰者的機制（nextIn 會跳過）。手牌放回棄牌堆底，牌數守恆。
// 已放下的組合留在桌上（別人還可以接）。回傳剩下的玩家數；剩 1 人時由呼叫者決定怎麼收尾。
function leave(g, pid) {
  const i = g.players.findIndex((p) => p.id === pid);
  const p = g.players[i];
  if (!p || p.left) return g.players.filter((q) => q.in).length;
  const wasTurn = g.status === 'play' && g.turn === i;
  g.disc.unshift(...p.hand);
  p.hand = []; p.in = false; p.left = true; p.skip = 0; p.pick = null;
  log(g, `${p.name} 離開了遊戲`);
  const left = g.players.filter((q) => q.in).length;
  if (g.playoff) g.playoff = g.playoff.filter((id) => id !== pid);
  if (wasTurn && left > 1) { g.turn = nextIn(g, i); begin(g); }
  return left;
}

// 離線玩家的代打：抽牌堆，棄掉分數最高的數字牌。
function autoPlay(g, pid) {
  const p = g.players[g.turn];
  if (g.status !== 'play' || p.id !== pid) return;
  if (g.stage === 'draw') act(g, pid, { type: 'draw', from: 'pile' });
  const c = p.hand.filter((x) => x.t === 'n').sort((a, b) => pts(b) - pts(a))[0] || p.hand[0];
  const t = g.players.find((q) => q.in && q !== p && q.skip === 0);
  act(g, pid, { type: 'discard', card: c.id, target: t && t.id });
}

function view(g, pid) {
  const me = g.players.find((p) => p.id === pid);
  return {
    target: g.target, round: g.round, status: g.status, stage: g.stage, playoff: !!g.playoff,
    turn: g.status === 'play' ? g.players[g.turn].id : null,
    drawCount: g.draw.length, top: g.disc.at(-1) || null,
    players: g.players.map((p) => ({ id: p.id, name: p.name, phase: p.phase, score: p.score, laid: p.laid, n: p.hand.length, skip: p.skip, in: p.in, left: !!p.left, pick: p.pick })),
    groups: g.groups, hand: me.hand, phases: PHASES, log: g.log.slice(-8),
    summary: g.summary, winners: g.winners,
  };
}

module.exports = { PHASES, deck, build, hit, create, act, leave, autoPlay, view, pts, err };
