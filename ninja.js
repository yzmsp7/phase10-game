'use strict';
// 忍者之夜（Night of Ninga）規則引擎（純邏輯，無 I/O）。介面跟 cats.js 一樣（create / act / leave / autoPlay / view），server.js 依 room.kind 選用。
// 騙徒六種與三張特殊牌的效果照實體牌。規則書沒寫的部分是自訂的，想改看這幾個地方：
// ponytail: 牌組 = 五類（密探／隱士／騙徒／盲眼刺客／上忍）各 1–6 號 + 還施僧／殉道者／首腦各 1 張 = 33 張（剛好 11 人 × 3 張）。改 DECK。
// ponytail: 榮譽標記不限量，每次抽 2/3/4；正版是有限的布袋，要限量就把 drawTok 改成從袋子 splice。
// ponytail: 掘墓人的「棄牌堆」= 輪抽時丟掉的牌（每輪 N 張）；打出過的牌不進去。
// ponytail: 被擊殺的人同時有還施僧與殉道者，兩張都可以揭示。
const { randomInt } = require('node:crypto');
const { err, shuffle } = require('./game');

const PHASES = ['spy', 'hermit', 'trick', 'assassin', 'jonin']; // 依序執行的五個小階段
const NAME = { spy: '密探', hermit: '隱士', trick: '騙徒', assassin: '盲眼刺客', jonin: '上忍', monk: '還施僧', martyr: '殉道者', head: '首腦' };
const TRICK_NAME = [null, '百變者', '掘墓人', '搗蛋鬼', '靈魂商販', '竊賊', '裁判'];
const COUNTER = ['monk', 'martyr'];
const WIN = 10; // 一輪結束有人到這個分數就結束
const DECK = [...PHASES.flatMap((k) => [1, 2, 3, 4, 5, 6].map((n) => ({ k, n }))), ...['monk', 'martyr', 'head'].map((k) => ({ k, n: 0 }))].map((c, id) => ({ ...c, id }));

const log = (g, m) => { g.log.push(m); if (g.log.length > 50) g.log.shift(); };
const note = (p, m) => { p.memo.push(m); }; // 只有本人看得到的情報。刻意不回傳值：效果函式的回傳值有意義（物件 = 還要等玩家接著決定），不能讓 push 的長度混進去
const cn = (c) => (c.k === 'trick' ? `${TRICK_NAME[c.n]}（騙徒 ${c.n}）` : `${NAME[c.k]}${c.n ? ` ${c.n}` : ''}`);
const fl = (f) => (f.s === 'ronin' ? '浪人' : `${f.s === 'lotus' ? '蓮花' : '仙鶴'} ${f.n}`);
const flag = (t) => ({ s: t.f.s, n: t.f.n }); // 給前端看的流派牌（不帶 open）
const score = (p) => p.tokens.reduce((a, b) => a + b, 0);
const drawTok = () => 2 + randomInt(3);
const byId = (g, id) => g.players.find((x) => x.id === id);
const use = (p, c) => { p.hand.splice(p.hand.indexOf(c), 1); p.played.push({ k: c.k, n: c.n }); }; // 打出：離開手牌、公開在桌上
const show = (g, p) => { p.f.open = true; log(g, `${p.name} 揭示了流派牌：${fl(p.f)}`); }; // open 跟著牌走，被百變者換走也一樣
const look = (p, t) => note(p, `${t.name} 的流派牌：${fl(t.f)}`);

// 發動時能選的對象：n = 最多幾位、min = 至少幾位、ids = 合法對象（伺服器算好，前端照著亮）
function spec(g, p, c) {
  const ins = g.players.filter((x) => x.in), ids = (f) => ins.filter(f).map((x) => x.id);
  if (c.k === 'trick') {
    return [null,
      { n: 2, min: 2, ids: ids(() => true) }, // 百變者：任意兩位（含自己、含已倒下的）
      { n: 0, min: 0, ids: [] }, // 掘墓人：不選人
      { n: 1, min: 1, ids: ids((x) => x !== p) }, // 搗蛋鬼
      { n: 1, min: 1, ids: ids((x) => x !== p) }, // 靈魂商販
      { n: 1, min: 0, ids: ids((x) => x.tokens.length > p.tokens.length) }, // 竊賊：標記比我多的人，可以不偷
      { n: 1, min: 1, ids: ids((x) => x.alive && x !== p) }, // 裁判
    ][c.n];
  }
  const kill = c.k === 'assassin' || c.k === 'jonin';
  return { n: 1, min: 1, ids: ids((x) => x !== p && (!kill || x.alive)) };
}

// 擊殺：src = 'ninja'（盲眼刺客／上忍）會讓被殺的人有機會反制；'judge'（裁判）不會。
// 一律先問被殺的人（就算沒有反制牌），不然「有沒有停頓」會洩漏他手上有沒有反制。
function hit(g, by, t, src) {
  t.alive = false;
  log(g, `${t.name} 被 ${by.name} 擊殺`);
  if (src === 'ninja' && t.in) { g.stage = 'react'; g.react = { vid: t.id, kid: by.id }; }
}

// 騙徒：回傳 { then, t, peek } 代表「看完了，還要等你決定」；沒回傳就是做完了
const TRICKS = [null,
  (g, p, ts) => { ts.forEach((t) => look(p, t)); return { then: 'swap', t: ts.map((t) => t.id), peek: { flags: ts.map((t) => ({ id: t.id, f: flag(t) })) } }; }, // 1 百變者
  (g, p) => { // 2 掘墓人
    const cards = shuffle([...g.disc]).slice(0, 2);
    if (!cards.length) { note(p, '棄牌堆是空的'); return; }
    note(p, `棄牌堆看到：${cards.map(cn).join('、')}`);
    return { then: 'dig', peek: { cards } };
  },
  (g, p, [t]) => { look(p, t); return { then: 'reveal', t: [t.id], peek: { flags: [{ id: t.id, f: flag(t) }] } }; }, // 3 搗蛋鬼
  (g, p, [t], a) => { // 4 靈魂商販：看標記或流派，之後可以換 1 個標記
    if (a.view === 'tokens') note(p, `${t.name} 的榮譽標記：${t.tokens.join('、') || '（沒有）'}`); else look(p, t);
    if (!p.tokens.length || !t.tokens.length) return; // 有一方沒有標記就沒得換
    return { then: 'trade', t: [t.id], peek: a.view === 'tokens' ? { view: 'tokens', tokens: [...t.tokens] } : { view: 'flag', flags: [{ id: t.id, f: flag(t) }] } };
  },
  (g, p, [t]) => { // 5 竊賊：先揭示，再（可選）從標記比我多的人那裡偷一個
    show(g, p);
    if (!t) return;
    const [v] = t.tokens.splice(randomInt(t.tokens.length), 1);
    p.tokens.push(v);
    note(p, `偷到 ${t.name} 的榮譽標記：${v}`); note(t, `你的一個榮譽標記被 ${p.name} 偷走了`);
    log(g, `${p.name} 從 ${t.name} 那裡偷走 1 個榮譽標記`);
  },
  (g, p, [t]) => { show(g, p); hit(g, p, t, 'judge'); }, // 6 裁判
];
const EFFECT = {
  spy: (g, p, [t]) => look(p, t),
  hermit: (g, p, [t]) => { look(p, t); const c = t.hand.length ? t.hand[randomInt(t.hand.length)] : null; note(p, `隨機看到 ${t.name} 的一張忍者牌：${c ? cn(c) : '（沒有手牌）'}`); },
  assassin: (g, p, [t]) => hit(g, p, t, 'ninja'),
  jonin: (g, p, [t]) => { look(p, t); return { then: 'kill', t: [t.id], peek: { flags: [{ id: t.id, f: flag(t) }] } }; },
  trick: (g, p, ts, a, c) => TRICKS[c.n](g, p, ts, a),
};

// 「看完之後」的決定。回傳 true = 還沒結束（queue[0] 已被改成下一步）
const THEN = {
  kill(g, p, cur, [t], a) { if (a.yes === true && t.alive) hit(g, p, t, 'ninja'); else log(g, `${p.name} 沒有動手`); },
  swap(g, p, cur, [x, y], a) {
    if (a.yes !== true) return;
    [x.f, y.f] = [y.f, x.f];
    for (const z of [x, y]) { z.blind = true; note(z, '你的流派牌被百變者調包了，你不能再查看新的流派牌'); } // 對旁人不公布有沒有換
  },
  reveal(g, p, cur, [t], a) { if (a.yes === true) { t.f.open = true; log(g, `${t.name} 的流派牌被搗蛋鬼揭示：${fl(t.f)}`); } },
  trade(g, p, cur, [t], a) {
    if (a.yes !== true) return;
    const m = a.mine, blind = cur.peek.view !== 'tokens'; // 選了看標記才知道對方有哪些、可以指定；看流派牌就是盲換，由伺服器隨機挑
    const h = blind ? randomInt(t.tokens.length) : a.theirs;
    if (![m, h].every(Number.isInteger) || m < 0 || h < 0 || m >= p.tokens.length || h >= t.tokens.length) err('請選擇要交換的標記');
    [p.tokens[m], t.tokens[h]] = [t.tokens[h], p.tokens[m]];
    note(p, `你換到一個榮譽標記：${p.tokens[m]}`); note(t, `你的一個榮譽標記被 ${p.name} 換走了，換回：${t.tokens[h]}`);
    log(g, `${p.name} 與 ${t.name} 交換了 1 個榮譽標記`);
  },
  dig(g, p, cur, ts, a) {
    const c = cur.peek.cards.find((x) => x.id === a.card);
    if (!c) err('請選一張要拿的牌');
    g.disc.splice(g.disc.findIndex((x) => x.id === c.id), 1);
    log(g, `${p.name} 從棄牌堆拿走 1 張牌`);
    if (!PHASES.includes(c.k)) { p.hand.push(c); note(p, `拿到 ${cn(c)}`); return; } // 反制與首腦不是「使用」的牌，直接放手上
    cur.then = 'use'; cur.dug = c; cur.peek = { cards: [c] };
    return true;
  },
  use(g, p, cur, ts, a) {
    const c = cur.dug;
    if (a.yes !== true) { p.hand.push(c); note(p, `拿到 ${cn(c)}，之後再用`); return; }
    p.played.push({ k: c.k, n: c.n }); log(g, `${p.name} 立即使用 ${cn(c)}`);
    g.queue[0] = { pid: p.id, card: c }; // 這張牌現在接著發動
    return true;
  },
};

function startRound(g) {
  const ins = g.players.filter((p) => p.in);
  g.round++; g.status = 'play'; g.summary = null; g.ready = []; g.queue = []; g.disc = []; g.react = null;
  const k = ins.length >> 1; // 每派 1..k 號；奇數人加浪人
  const fs = shuffle([...Array(k).keys()].flatMap((i) => [{ s: 'lotus', n: i + 1 }, { s: 'crane', n: i + 1 }]).concat(ins.length % 2 ? [{ s: 'ronin', n: 0 }] : []));
  const deck = shuffle(DECK.map((c) => ({ ...c })));
  for (const p of ins) Object.assign(p, { f: fs.pop(), hand: deck.splice(0, 3), keep: [], played: [], memo: [], pick: null, decl: [], alive: true, blind: false });
  g.stage = 'draft'; g.step = 1;
  log(g, `第 ${g.round} 輪開始：每人保留 1 張忍者牌，其餘傳給下一位`);
  settle(g);
}

function startPhase(g, i) {
  g.phase = i; g.stage = 'declare'; g.queue = [];
  for (const p of g.players) p.decl = p.in && p.alive ? null : []; // 活人都要按一次，不然「還在等誰」就洩漏了誰有這類牌
}

// 把能自動前進的推到底：每次狀態變動後呼叫，停在需要有人動作的地方
function settle(g) {
  while (g.status === 'play') {
    const ins = g.players.filter((p) => p.in);
    if (g.stage === 'draft') {
      if (ins.some((p) => p.pick === null)) break;
      draftStep(g, ins);
    } else if (g.stage === 'declare') {
      if (ins.some((p) => p.alive && p.decl === null)) break;
      const q = [];
      for (const p of ins) for (const id of p.decl) q.push({ pid: p.id, card: p.hand.find((c) => c.id === id) });
      q.sort((a, b) => a.card.n - b.card.n); // 同類每號只有一張，不會同號；同一人兩張照號碼
      for (const x of q) use(byId(g, x.pid), x.card);
      log(g, q.length ? `【${NAME[PHASES[g.phase]]}】${q.map((x) => `${byId(g, x.pid).name} 打出 ${cn(x.card)}`).join('、')}` : `【${NAME[PHASES[g.phase]]}】沒有人打出`);
      g.queue = q; g.stage = 'exec';
    } else if (g.stage === 'react') { g.turn = g.players.findIndex((p) => p.id === g.react.vid); break; } // 等被殺的人決定要不要反制；turn 指向他，server 的倒數與 view 才不會指到兇手
    else {
      const cur = g.queue[0];
      if (!cur) { if (g.phase + 1 < PHASES.length) startPhase(g, g.phase + 1); else reveal(g); continue; }
      const ex = byId(g, cur.pid);
      if (!ex.in || !ex.alive) { log(g, `${ex.name} 已倒下，${cn(cur.card)} 失效`); g.queue.shift(); continue; }
      if (!cur.then) { const sp = spec(g, ex, cur.card); if (sp.ids.length < sp.min) { log(g, `${ex.name} 的 ${cn(cur.card)} 沒有可選對象，失效`); g.queue.shift(); continue; } }
      g.turn = g.players.indexOf(ex);
      break;
    }
  }
  const sig = [g.round, g.status, g.stage, g.step, g.phase, g.queue[0]?.card.id, g.queue[0]?.then, g.react?.vid].join();
  if (sig !== g.sig) { g.sig = sig; g.turnNo++; } // 等待對象或階段變了才重設倒數
}

function draftStep(g, ins) {
  const out = ins.map((p) => { const i = p.hand.findIndex((c) => c.id === p.pick); return [p.hand.splice(i, 1)[0], p.hand.splice(0)]; }); // [保留的, 其餘]
  ins.forEach((p, i) => {
    p.pick = null;
    if (g.step === 1) { p.keep = [out[i][0]]; p.hand = out[(i + ins.length - 1) % ins.length][1]; } // 其餘傳給下一位
    else { p.hand = [...p.keep, out[i][0]]; p.keep = []; g.disc.push(...out[i][1]); } // 第二次沒選的進棄牌堆
  });
  if (g.step === 1) { g.step = 2; log(g, '再從收到的 2 張選 1 張'); } else { log(g, '行動階段開始，可以自由討論（但不能展示流派牌與手牌）'); startPhase(g, 0); }
}

function reveal(g) {
  const ins = g.players.filter((p) => p.in), live = ins.filter((p) => p.alive);
  const head = live.find((p) => p.hand.some((c) => c.k === 'head'));
  const lows = (s) => live.filter((p) => p.f.s === s).map((p) => p.f.n).sort((a, b) => a - b);
  let win, why;
  if (head) { win = head.f.s; why = `${head.name} 持有首腦且存活`; }
  else {
    const a = lows('lotus'), b = lows('crane');
    for (let i = 0; i < Math.max(a.length, b.length) && !win; i++) { const x = a[i] ?? 99, y = b[i] ?? 99; if (x !== y) win = x < y ? 'lotus' : 'crane'; } // 由小到大逐個比；沒人了 = 輸
    why = win ? `存活者由小到大比較：蓮花 [${a}] 對 仙鶴 [${b}]` : '兩派存活者完全相同，存活的人一起獲勝';
  }
  // 勝方整派（含倒下的）；浪人活著就能抽（首腦在浪人手上時沒有流派獲勝，他獨贏）；完全平手 = 所有存活者
  const won = ins.filter((p) => (win === 'ronin' ? p === head : win ? p.f.s === win || (p.f.s === 'ronin' && p.alive) : p.alive));
  for (const p of won) p.tokens.push(drawTok());
  g.summary = { round: g.round, win: win ?? 'tie', why, rows: ins.map((p) => ({ id: p.id, name: p.name, f: p.f, alive: p.alive, head: p.hand.some((c) => c.k === 'head'), won: won.includes(p) })) };
  log(g, `第 ${g.round} 輪結算：${why}；獲勝：${won.map((p) => p.name).join('、') || '無'}`);
  g.stage = null;
  const top = Math.max(...ins.map(score));
  if (top >= WIN) { g.status = 'over'; g.winners = ins.filter((p) => score(p) === top).map((p) => p.id); log(g, `遊戲結束！${ins.filter((p) => score(p) === top).map((p) => p.name).join('、')} 以 ${top} 分獲勝`); }
  else g.status = 'roundEnd';
}

function create(players) {
  const g = { status: 'play', round: 0, stage: null, step: 0, phase: 0, turn: 0, turnNo: 0, sig: '', queue: [], ready: [], disc: [], react: null, log: [], summary: null, winners: null,
    players: players.map(({ id, name }) => ({ id, name, in: true, alive: true, blind: false, f: null, hand: [], keep: [], played: [], memo: [], tokens: [], pick: null, decl: [] })) };
  startRound(g);
  return g;
}

const ACT = {
  pick(g, p, a) {
    if (g.stage !== 'draft') err('現在不是選牌階段');
    if (!p.hand.some((c) => c.id === a.card)) err('你沒有這張牌');
    p.pick = a.card; // 全員選好前都可以改
  },
  declare(g, p, a) {
    if (g.stage !== 'declare') err('現在不是出牌階段');
    if (!p.alive) err('你已經倒下了');
    if (p.decl !== null) err('你已經決定了');
    const ids = a.cards ?? [];
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id) => !p.hand.some((c) => c.id === id && c.k === PHASES[g.phase]))) err('這些牌現在不能打出');
    p.decl = ids;
  },
  exec(g, p, a) {
    const cur = g.queue[0];
    if (g.stage !== 'exec' || cur?.pid !== p.id) err('還沒輪到你');
    if (cur.then) err('請先決定要不要接著做');
    const c = cur.card, sp = spec(g, p, c), ids = a.targets ?? [];
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.length > sp.n || ids.length < sp.min || ids.some((id) => !sp.ids.includes(id))) err('對象不合法');
    if (c.k === 'trick' && c.n === 4 && a.view !== 'tokens' && a.view !== 'flag') err('請選擇要看榮譽標記還是流派牌');
    log(g, `${p.name} 發動 ${cn(c)}`); // 對象是祕密；公開的結果（擊殺、揭示、偷標記）由各效果自己寫 log
    const r = EFFECT[c.k](g, p, ids.map((id) => byId(g, id)), a, c);
    if (r?.then) Object.assign(cur, r); else g.queue.shift(); // 只有明確帶 then 的物件才代表「看完還要決定」
  },
  then(g, p, a) {
    const cur = g.queue[0];
    if (g.stage !== 'exec' || cur?.pid !== p.id || !cur.then) err('現在不用決定');
    if (!THEN[cur.then](g, p, cur, (cur.t ?? []).map((id) => byId(g, id)), a)) g.queue.shift();
  },
  react(g, p, a) {
    if (g.stage !== 'react' || g.react.vid !== p.id) err('現在不用反制');
    const ids = a.cards ?? [], cs = Array.isArray(ids) ? ids.map((id) => p.hand.find((c) => c.id === id && COUNTER.includes(c.k))) : [null];
    if (new Set(ids).size !== ids.length || cs.some((c) => !c)) err('這些牌不能反制');
    const by = byId(g, g.react.kid);
    for (const c of cs) {
      use(p, c);
      if (c.k === 'monk') { by.alive = false; log(g, `${p.name} 揭示還施僧，反殺了 ${by.name}`); }
      else { p.tokens.push(drawTok()); log(g, `${p.name} 揭示殉道者，獲得 1 個榮譽標記`); }
    }
    g.react = null; g.stage = 'exec';
  },
  next(g, p) {
    if (g.status !== 'roundEnd') err('現在不能開始下一輪');
    if (!g.ready.includes(p.id)) g.ready.push(p.id);
    if (g.players.every((x) => !x.in || g.ready.includes(x.id))) startRound(g);
  },
};

function act(g, pid, a) {
  const p = byId(g, pid);
  if (!p?.in) err('你不在這局遊戲中');
  if (!Object.hasOwn(ACT, a.type)) err('未知的動作');
  if (a.type !== 'next' && g.status !== 'play') err('遊戲不在進行中');
  ACT[a.type](g, p, a);
  settle(g);
}

// 中途退出：視同倒下並離席（流派牌留著算在他那派），不擋住別人的等待。回傳剩下人數，剩 1 人由 server 關房。
function leave(g, pid) {
  const p = byId(g, pid), alive = () => g.players.filter((q) => q.in).length;
  if (!p?.in) return alive();
  Object.assign(p, { in: false, alive: false, left: true, hand: [], keep: [], pick: null, decl: [] });
  g.queue = g.queue.filter((x) => x.pid !== pid);
  g.ready = g.ready.filter((id) => id !== pid);
  if (g.react?.vid === pid) { g.react = null; g.stage = 'exec'; }
  log(g, `${p.name} 離開了遊戲`);
  if (alive() > 1) { if (g.status === 'roundEnd' && g.players.every((x) => !x.in || g.ready.includes(x.id))) startRound(g); else settle(g); }
  return alive();
}

// 超時代打：選牌隨機選、出牌階段不打、發動階段放棄（掘墓人拿第一張）、被殺不反制
function autoPlay(g) {
  if (g.status !== 'play') return;
  const { stage, step, phase } = g;
  if (stage === 'draft') {
    for (const p of g.players.filter((x) => x.in && x.pick === null)) {
      if (g.stage !== stage || g.step !== step) break;
      act(g, p.id, { type: 'pick', card: p.hand[randomInt(p.hand.length)].id });
    }
  } else if (stage === 'declare') {
    for (const p of g.players.filter((x) => x.in && x.alive && x.decl === null)) {
      if (g.stage !== stage || g.phase !== phase) break;
      act(g, p.id, { type: 'declare', cards: [] });
    }
  } else if (stage === 'react') act(g, g.react.vid, { type: 'react', cards: [] });
  else if (g.queue[0]) {
    const cur = g.queue[0], ex = byId(g, cur.pid);
    if (cur.then === 'dig') act(g, ex.id, { type: 'then', card: cur.peek.cards[0].id });
    else if (cur.then) act(g, ex.id, { type: 'then', yes: false });
    else { log(g, `${ex.name} 超時，${cn(cur.card)} 失效`); g.queue.shift(); settle(g); }
  }
}

function view(g, pid) {
  const me = byId(g, pid), cur = g.stage === 'exec' ? g.queue[0] : null;
  const waiting = g.status === 'play' && me?.in && (g.stage === 'draft' ? me.pick === null : g.stage === 'declare' ? me.alive && me.decl === null : g.stage === 'react' ? g.react.vid === pid : cur?.pid === pid);
  return {
    status: g.status, round: g.round, stage: g.stage, step: g.step, phase: g.stage === 'declare' || g.stage === 'exec' || g.stage === 'react' ? PHASES[g.phase] : null, win: WIN,
    turn: waiting ? pid : null,
    players: g.players.map((p) => ({
      id: p.id, name: p.name, in: p.in, left: !!p.left, alive: p.alive, tokens: p.tokens.length, played: p.played,
      f: g.status !== 'play' || p.f?.open || (p.id === pid && !p.blind) ? p.f : null, // 別人的流派牌：結算後或被揭示才看得到；被百變者換過的人自己也不能看
      score: g.status === 'over' ? score(p) : undefined,
      picked: g.stage === 'draft' ? p.pick !== null : undefined,
    })),
    hand: me?.hand ?? [], pick: me?.pick ?? null, decl: me?.decl ?? [], memo: me?.memo ?? [], myTokens: me?.tokens ?? [], myScore: me ? score(me) : 0,
    queue: g.queue.map((x) => ({ pid: x.pid, k: x.card.k, n: x.card.n })),
    cur: cur && { pid: cur.pid, k: cur.card.k, n: cur.card.n, then: cur.then ?? null, spec: cur.pid === pid && !cur.then ? spec(g, me, cur.card) : null, peek: cur.pid === pid ? cur.peek ?? null : null }, // 看到了什麼只有本人知道
    react: g.stage === 'react' ? { vid: g.react.vid, kid: g.react.kid } : null,
    ready: g.ready, summary: g.summary, winners: g.winners, log: g.log.slice(-12),
  };
}

module.exports = { DECK, PHASES, create, act, leave, autoPlay, view, startPhase, settle, spec };
