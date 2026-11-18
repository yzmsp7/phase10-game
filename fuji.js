'use strict';
// 富士流規則引擎（純邏輯，無 I/O）。介面跟 game.js 一樣（create / act / leave / autoPlay / view），server.js 依 room.kind 選用。
// ponytail: 規則書沒寫「打出同盟時拿誰的數值去沖別人」，這裡用同盟合計去比（兩張 8 打出來就是 16）；想改成只比單張，改 act() 的 total。
const { randomInt } = require('node:crypto');
const { err, shuffle } = require('./game');

const COUNTS = [16, 12, 9, 8, 6, 6, 5, 4, 4, 4, 3, 3, 3, 2, 1, 1, 1, 1, 1]; // 數字 2–20 各幾張，共 90 張
function deck() {
  let id = 0;
  return COUNTS.flatMap((k, i) => Array.from({ length: k }, () => ({ id: id++, n: i + 2 })));
}

const log = (g, m) => { g.log.push(m); if (g.log.length > 50) g.log.shift(); }
const event = (g, by, n, mates, out) => { g.ev = { no: ++g.evNo, by, n, mates, out, gone: [] }; }; // ev：最近一手發生的事（誰打出、誰結盟、誰被沖走、誰流走），no 每次都不同，前端靠它判斷是不是新事件；牌面都是公開的
const sum = (g, n) => n * g.players.filter((p) => p.card?.n === n).length; // 場上數字 n 的同盟合計（單張就是 n）
const nextIn = (g, i) => {
  const n = g.players.length;
  for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (g.players[j].in) return j; }
  return i;
};
function draw(g, p) {
  if (!g.draw.length) g.draw = shuffle(g.disc.splice(0)); // 牌堆抽完 → 棄牌洗回去
  if (g.draw.length) p.hand.push(g.draw.pop());
}

function create(players) {
  const d = shuffle(deck()), size = players.length >= 7 ? 5 : 6;
  const g = { status: 'play', turn: randomInt(players.length), turnNo: 0, evNo: 0, ev: null, log: [], winners: null, disc: [] };
  g.players = players.map(({ id, name }) => ({ id, name, hand: d.splice(0, size), card: null, in: true }));
  g.draw = d;
  log(g, `遊戲開始，${g.players[g.turn].name} 先出`);
  begin(g);
  return g;
}

// 回合開始：面前的牌還在 = 順水流走（不補牌）；同數字的同盟連別人的牌一起走。流走的人手牌空了就贏。
function begin(g) {
  g.turnNo++; // 每次換人 +1，伺服器靠它判斷「新回合」該重設倒數
  const c = g.players[g.turn].card;
  if (!c) return;
  const crew = g.players.filter((p) => p.card?.n === c.n);
  for (const p of crew) { g.disc.push(p.card); p.card = null; g.ev?.gone.push({ id: p.id, n: c.n }); }
  log(g, `${crew.map((p) => p.name).join('、')} 的 ${c.n} 順水流走${crew.length > 1 ? '（同盟）' : ''}`);
  const won = crew.filter((p) => !p.hand.length);
  if (won.length) { g.status = 'over'; g.winners = won.map((p) => p.id); log(g, `${won.map((p) => p.name).join('、')} 獲勝`); }
}

function act(g, pid, a) {
  if (g.status !== 'play') err('遊戲不在進行中');
  const p = g.players[g.turn];
  if (p.id !== pid) err('還沒輪到你');
  if (a.type !== 'play') err('未知的動作');
  const i = p.hand.findIndex((c) => c.id === a.card);
  if (i < 0) err('你沒有這張牌');
  const [c] = p.hand.splice(i, 1);
  p.card = c;
  const total = sum(g, c.n), mates = g.players.filter((q) => q !== p && q.card?.n === c.n);
  const out = g.players.filter((q) => q.card && q.card.n !== c.n && sum(g, q.card.n) < total); // 先挑完再動手：合計相同不沖，要嚴格大於
  event(g, p.id, c.n, mates.map((q) => q.id), out.map((q) => ({ id: q.id, n: q.card.n })));
  log(g, `${p.name} 打出 ${c.n}${mates.length ? `，與 ${mates.map((q) => q.name).join('、')} 結盟（合計 ${total}）` : ''}`);
  if (out.length) {
    log(g, `沖走 ${out.map((q) => `${q.name} 的 ${q.card.n}`).join('、')}，各抽 1 張`);
    for (const q of out) { g.disc.push(q.card); q.card = null; draw(g, q); }
  }
  if (!p.hand.length) log(g, `${p.name} 手牌出完了，等牌順水流走`);
  g.turn = nextIn(g, g.turn);
  begin(g);
}

// 中途退出：手牌和面前的牌都放進棄牌堆（同盟少一個人，合計自然重算），輪到他就換人。回傳剩下的玩家數；剩 1 人由 server 關房。
function leave(g, pid) {
  const i = g.players.findIndex((p) => p.id === pid), p = g.players[i];
  const alive = () => g.players.filter((q) => q.in).length;
  if (!p?.in) return alive();
  g.disc.push(...p.hand, ...(p.card ? [p.card] : []));
  p.hand = []; p.card = null; p.in = false; p.left = true;
  log(g, `${p.name} 離開了遊戲`);
  if (g.status === 'play' && g.turn === i && alive() > 1) { event(g, null, null, [], []); g.turn = nextIn(g, i); begin(g); }
  return alive();
}

// 超時代打：出最小的牌（最容易被沖走，等於吃點虧）
function autoPlay(g, pid) {
  const p = g.players[g.turn];
  if (g.status !== 'play' || p.id !== pid) return;
  act(g, pid, { type: 'play', card: p.hand.reduce((a, b) => (b.n < a.n ? b : a)).id });
}

function view(g, pid) {
  const me = g.players.find((p) => p.id === pid);
  return {
    status: g.status, turn: g.status === 'play' ? g.players[g.turn].id : null,
    drawCount: g.draw.length, discCount: g.disc.length,
    players: g.players.map((p) => ({ id: p.id, name: p.name, n: p.hand.length, card: p.card, sum: p.card && sum(g, p.card.n), in: p.in, left: !!p.left })),
    hand: me.hand, log: g.log.slice(-12), ev: g.ev, winners: g.winners,
  };
}

module.exports = { deck, create, act, leave, autoPlay, view };
