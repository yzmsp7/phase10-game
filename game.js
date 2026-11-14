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

// t: n=數字牌 w=百搭 s=跳過；房間開了才有的特殊牌（各 4 張）：rv=迴轉 sh=換位子 xn=指定數字交換 xc=指定顏色交換
const SPECIAL = ['rv', 'sh', 'xn', 'xc'];
const CN = { R: '紅', B: '藍', G: '綠', Y: '黃' };
const playable = (c) => c.t === 'n' || c.t === 'w'; // 只有數字牌和百搭能用在階段／接牌／從棄牌堆撿
function deck(rules = {}) {
  const d = []; let id = 0;
  for (let k = 0; k < 2; k++) for (const c of COLORS) for (let n = 1; n <= 12; n++) d.push({ id: id++, t: 'n', c, n });
  for (let i = 0; i < 8; i++) d.push({ id: id++, t: 'w' });
  for (let i = 0; i < 4; i++) d.push({ id: id++, t: 's' });
  for (const t of SPECIAL) if (rules[t]) for (let i = 0; i < 4; i++) d.push({ id: id++, t });
  return d;
}

const pts = (c) => (c.t === 'n' ? (c.n >= 10 ? 10 : 5) : c.t === 's' ? 15 : 25); // 百搭和特殊牌都是 25

// 驗證並排好一組牌。順子：百搭補洞；多餘的百搭預設往大的一端延伸，玩家可用 lo 指定順子的起點。
// ponytail: 只能指定起點（整段平移），不能把多張百搭拆成一半在前一半在後以外的任意位置；補洞的百搭位置本來就固定。
// 張數 ≥ size 都行：多放的牌等於放下後立刻接牌（順子就是更長的順子），所以後面的運算都用實際張數 size。
function build(type, size, cards, lo) {
  if (cards.length < size) err(`這組至少需要 ${size} 張牌`);
  size = cards.length;
  if (!cards.every(playable)) err('跳過牌和特殊牌不能用在階段中');
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
  const min = Math.min(...ns), max = Math.max(...ns);
  if (size > 12) err('順子最長 12 張');
  if (max - min + 1 > size) err('數字間隔太大，百搭牌補不起來');
  const top = Math.min(min, 13 - size); // 起點最大值（也是預設）；最小值是剛好蓋住最大那張
  if (lo == null) lo = top;
  else if (!Number.isInteger(lo) || lo > top || lo < Math.max(1, max - size + 1)) err('順子的起點不對');
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
  const n = g.players.length; // g.dir：1 順向、-1 反向（迴轉牌）
  for (let k = 1; k <= n; k++) { const j = (((i + k * g.dir) % n) + n) % n; if (g.players[j].in) return j; }
  return i;
};
const lowest = (ps) => { const m = Math.min(...ps.map((p) => p.score)); return ps.filter((p) => p.score === m); };

function create(players, { target, rules = {} }) {
  const g = {
    target, rules, dir: 1, first: null, ev: null, round: 0, dealer: randomInt(players.length), turn: 0, stage: 'draw', status: 'play',
    players: players.map(({ id, name }) => ({ id, name, phase: 1, score: 0, hand: [], laid: false, skip: 0, in: true })),
    draw: [], disc: [], groups: [], log: [], summary: null, winners: null, playoff: null,
  };
  startRound(g);
  return g;
}

function startRound(g) {
  g.round++;
  if (g.round > 1) g.dealer = (g.dealer + 1) % g.players.length;
  const d = shuffle(deck(g.rules));
  g.dir = 1; g.first = null;
  for (const p of g.players) p.in = !p.left && (!g.playoff || g.playoff.includes(p.id)); // 中途退出的人不會再被發牌
  const top = Math.max(...g.players.filter((p) => p.in).map((p) => p.phase)), more = [];
  for (const p of g.players) {
    p.laid = false; p.skip = 0; p.pick = null; p.hist = []; // hist：本回合每手的 { from, card?, disc }，點玩家卡可看
    const extra = p.in && g.rules.catchUp && top - p.phase >= 2 ? 1 : 0; // 落後最高階段 2 階以上多發一張
    p.hand = p.in ? d.splice(0, HAND + extra) : [];
    if (extra) more.push(p.name);
  }
  g.disc = [d.pop()];
  g.draw = d;
  g.groups = []; g.status = 'play'; g.summary = null;
  g.turn = nextIn(g, g.dealer);
  log(g, g.playoff ? `加賽開始（第 ${g.round} 回合）` : `第 ${g.round} 回合開始`);
  if (more.length) log(g, `${more.join('、')} 落後兩階段以上，多發一張牌`);
  if (g.disc[0].t === 's') { g.players[g.turn].skip = 1; log(g, '翻開的第一張是跳過牌'); }
  begin(g);
}

// 回合開始：處理被跳過的玩家。skip 狀態 0=正常 1=等著被跳過 2=剛被跳過（下一個正常回合前不能再被跳）
function begin(g) {
  g.turnNo = (g.turnNo || 0) + 1; // 每次換人 +1，伺服器靠它判斷「新回合」該重設倒數
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
    const gain = (p === w ? 0 : p.hand.reduce((s, c) => s + pts(c), 0)) - (g.first === p.id ? 10 : 0); // 先放下 −10（可能變負分）
    p.score += gain;
    return { id: p.id, name: p.name, phase: p.phase, laid: p.laid, gain, first: g.first === p.id, score: p.score, hand: [...p.hand] };
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
        if (!top || !playable(top)) err('跳過牌和特殊牌不能撿');
        p.hand.push(g.disc.pop());
        p.pick = { from: 'discard', card: p.hand.at(-1) }; // 棄牌堆頂本來就公開，所以連牌面一起給別人看
      } else {
        if (!g.draw.length) { const top = g.disc.pop(); g.draw = shuffle(g.disc); g.disc = [top]; }
        if (!g.draw.length) err('牌堆已空，請改拿棄牌');
        p.hand.push(g.draw.pop());
        p.pick = { from: 'pile' }; // 牌堆抽的牌不公開
      }
      p.hist.push({ ...p.pick });
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
      const built = req.map(([t, s], i) => build(t, s, cards.slice(k, (k += a.groups[i].length)), a.los?.[i]));
      drop(cards);
      if (g.rules.first && !g.groups.length) g.first = p.id; // 桌上還沒有任何組合 = 第一個放下的人（他中途離開會被清成 null，不會轉給別人）
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
      const live = p.hand.length > 1; // 最後一張牌直接出完，效果不觸發
      const others = g.players.filter((q) => q.in && q !== p);
      let target = null, give = null, pool = [];
      if (live && c.t === 's') {
        const ok = others.filter((q) => q.skip === 0);
        if (ok.length) target = ok.find((q) => q.id === a.target) || err('請選擇要跳過的玩家');
      }
      if (live && (c.t === 'xn' || c.t === 'xc')) { // 全部驗證完才動手，錯了不會留下半套狀態
        const num = c.t === 'xn';
        target = others.find((q) => q.id === a.target) || err('請選擇要交換的玩家');
        give = p.hand.find((x) => x.id === a.give && x !== c) || err('請選一張要換出去的牌');
        if (num ? !(Number.isInteger(a.num) && a.num >= 1 && a.num <= 12) : !COLORS.includes(a.color)) err(num ? '請指定數字 1–12' : '請指定顏色');
        pool = target.hand.filter((x) => x.t === 'n' && (num ? x.n === a.num : x.c === a.color)); // 百搭和特殊牌換不走
      }
      drop([c]); g.disc.push(c); const h = p.hist.at(-1); if (h) h.disc = c; // 測試會跳過 draw 直接設 stage，所以要判斷
      if (!p.hand.length) return endRound(g, g.turn);
      const ev = (o) => { g.ev = { kind: c.t, by: p.id, no: g.turnNo, ...o }; }; // no 每回合都不同，前端靠它判斷是不是新事件
      if (target && c.t === 's') { target.skip = 1; ev({ to: target.id }); log(g, `${p.name} 打出跳過牌，${target.name} 將少一回合`); }
      if (c.t === 'rv') { g.dir = -g.dir; ev(); log(g, `${p.name} 打出迴轉牌，出牌方向反過來了`); }
      if (c.t === 'sh') { // 座位 = g.players 的順序，turn / dealer 是索引，洗完要用人找回來；手牌掛在人身上，自然跟著走
        const dealer = g.players[g.dealer];
        shuffle(g.players); g.turn = g.players.indexOf(p); g.dealer = g.players.indexOf(dealer);
        ev(); log(g, `${p.name} 打出換位子牌，座位被打亂了`);
      }
      if (give) {
        const got = pool.length ? pool[randomInt(pool.length)] : null, want = c.t === 'xn' ? a.num : a.color;
        if (got) { target.hand[target.hand.indexOf(got)] = give; p.hand[p.hand.indexOf(give)] = got; }
        ev({ to: target.id, want, ok: !!got, give: got && give, got }); // give / got 只有當事兩人看得到（見 view）；got 為 null = 對方沒有，落空
        log(g, `${p.name} 指定 ${target.name} 的${c.t === 'xn' ? `數字 ${want}` : `${CN[want]}色`}，${got ? '交換成功' : '對方沒有，落空'}`);
      }
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
  p.hand = []; p.in = false; p.left = true; p.skip = 0; p.pick = null; p.hist = [];
  if (g.first === pid) g.first = null; // 先放下的人中途離開 → −10 作廢
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
  const others = g.players.filter((q) => q.in && q !== p);
  const t = others.find((q) => q.skip === 0) || others[0];
  // 手上只剩特殊牌時可能得棄到需要選擇的牌：一併給預設值（交換牌：隨便指定 1／紅色，換出手上另一張）
  act(g, pid, { type: 'discard', card: c.id, target: t?.id, num: 1, color: 'R', give: p.hand.find((x) => x !== c)?.id });
}

function view(g, pid) {
  const me = g.players.find((p) => p.id === pid);
  return {
    target: g.target, round: g.round, status: g.status, stage: g.stage, playoff: !!g.playoff,
    turn: g.status === 'play' ? g.players[g.turn].id : null,
    drawCount: g.draw.length, top: g.disc.at(-1) || null,
    players: g.players.map((p) => ({ id: p.id, name: p.name, phase: p.phase, score: p.score, laid: p.laid, n: p.hand.length, skip: p.skip, in: p.in, left: !!p.left, pick: p.pick, hist: p.hist })),
    groups: g.groups, hand: me.hand, phases: PHASES, log: g.log.slice(-8),
    summary: g.summary, winners: g.winners, rules: g.rules, dir: g.dir, first: g.first,
    ev: g.ev && (g.ev.by === pid || g.ev.to === pid ? g.ev : { ...g.ev, give: undefined, got: undefined }), // 最近一次特殊牌效果；換到哪張牌只給當事兩人看
  };
}

module.exports = { PHASES, deck, build, hit, create, act, leave, autoPlay, view, pts, err };
