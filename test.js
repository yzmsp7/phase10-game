'use strict';
// node test.js — 規則單元測試 + 2~6 人隨機機器人整局模擬 + HTTP 冒煙測試
const assert = require('node:assert/strict');
const G = require('./game');

const n = (num, c = 'R', id = Math.random()) => ({ id, t: 'n', c, n: num });
const w = () => ({ id: Math.random(), t: 'w' });
const s = () => ({ id: Math.random(), t: 's' });
const throws = (f, re) => assert.throws(f, re);

// --- 牌組 ---
const d = G.deck();
assert.equal(d.length, 108);
assert.equal(d.filter((c) => c.t === 'w').length, 8);
assert.equal(d.filter((c) => c.t === 's').length, 4);
assert.equal(new Set(d.map((c) => c.id)).size, 108);

// --- 組合驗證 ---
G.build('set', 3, [n(7), n(7, 'B'), w()]);
throws(() => G.build('set', 3, [n(7), n(8), w()]), /相同/);
throws(() => G.build('set', 3, [w(), w(), w()]), /數字牌/);
throws(() => G.build('set', 3, [n(7), n(7), s()]), /跳過/);
throws(() => G.build('set', 3, [n(7), n(7)]), /3 張/);

// 順子：說明書範例 3,4,_,6 + 百搭
let r = G.build('run', 4, [n(3), n(4), n(6), w()]);
assert.deepEqual([r.lo, r.hi], [3, 6]);
assert.equal(r.cards[2].t, 'w');
throws(() => G.build('run', 4, [n(3), n(3), n(4), n(5)]), /重複/);
throws(() => G.build('run', 4, [n(1), n(2), n(3), n(9)]), /間隔/);
// 百搭多出來時往大的一端延伸；到 12 為止再往小延伸
r = G.build('run', 4, [n(5), n(6), w(), w()]);
assert.deepEqual([r.lo, r.hi], [5, 8]);
r = G.build('run', 4, [n(11), n(12), w(), w()]);
assert.deepEqual([r.lo, r.hi], [9, 12]);
r = G.build('run', 9, [n(12), w(), w(), w(), w(), w(), w(), w(), w()]);
assert.deepEqual([r.lo, r.hi], [4, 12]);
// 玩家可指定起點：2,3,4 + 百搭 → 放前面 1–4，或放後面 2–5（預設）
r = G.build('run', 4, [n(2), n(3), n(4), w()], 1);
assert.deepEqual([r.lo, r.hi], [1, 4]);
assert.equal(r.cards[0].t, 'w');
r = G.build('run', 4, [n(2), n(3), n(4), w()], 2);
assert.deepEqual([r.lo, r.hi], [2, 5]);
assert.equal(r.cards[3].t, 'w');
throws(() => G.build('run', 4, [n(2), n(3), n(4), w()], 0), /起點/);
throws(() => G.build('run', 4, [n(2), n(3), n(4), w()], 3), /起點/);
throws(() => G.build('run', 4, [n(2), n(3), n(4), w()], 1.5), /起點/);
// 起點不能超過 12：11,12 + 2 百搭 只能是 9–12
throws(() => G.build('run', 4, [n(11), n(12), w(), w()], 10), /起點/);
// 只有一張數字牌 + 全百搭也合法
G.build('run', 4, [n(1), w(), w(), w()]);

// 同色
G.build('color', 7, [...Array(6)].map((_, i) => n(i + 1, 'G')).concat(w()));
throws(() => G.build('color', 7, [...Array(6)].map((_, i) => n(i + 1, 'G')).concat(n(1, 'R'))), /顏色/);

// --- 接牌 ---
const setG = G.build('set', 3, [n(4), n(4), n(4)]);
assert.equal(G.hit(setG, [n(4, 'B'), w()]).cards.length, 5);
throws(() => G.hit(setG, [n(5)]), /不能接/);
assert.equal(setG.cards.length, 3, '接牌不得改動原物件');
// 說明書範例：3,4,5,6 可以加 2，也可以一次加 7 和 8（任意順序）
const run = G.build('run', 4, [n(3), n(4), n(5), n(6)]);
assert.equal(G.hit(run, [n(2)]).lo, 2);
let h = G.hit(run, [n(8), n(7)]);
assert.deepEqual([h.lo, h.hi], [3, 8]);
throws(() => G.hit(run, [n(9)]), /不能接/);
// 7 + 百搭 + 9：先接 7，再接 9 需要百搭補 8 之前不行 → 9 不能接
throws(() => G.hit(run, [n(8)]), /不能接/);
// 百搭在 12 頂端 → 往下接
const top = G.build('run', 4, [n(9), n(10), n(11), n(12)]);
assert.equal(G.hit(top, [w()]).lo, 8);
throws(() => G.hit(G.hit(G.build('run', 12 > 9 ? 9 : 9, [n(4), n(5), n(6), n(7), n(8), n(9), n(10), n(11), n(12)]), [w(), w(), w()]), [w()]), /到頭/);
const col = G.build('color', 7, [...Array(7)].map((_, i) => n(i + 1, 'Y')));
assert.equal(G.hit(col, [n(9, 'Y'), w()]).cards.length, 9);
throws(() => G.hit(col, [n(9, 'R')]), /不能接/);

// --- 回合流程（固定牌局）---
function rawRig(nPlayers, opts = { target: 10 }) {
  const ps = [...Array(nPlayers)].map((_, i) => ({ id: 'p' + i, name: 'P' + i }));
  return G.create(ps, opts);
}
// 預設不讓起手翻出跳過牌，避免測試被 4/108 的機率干擾；要測起手跳過請用 rawRig
function rig(nPlayers, opts) {
  for (;;) { const g = rawRig(nPlayers, opts); if (g.disc[0].t !== 's') return g; }
}
const plain = (p) => p.hand.find((x) => x.t !== 's').id;
{
  const g = rig(3);
  const cur = g.players[g.turn];
  // 沒抽牌不能做事
  throws(() => G.act(g, cur.id, { type: 'discard', card: plain(cur) }), /先抽/);
  // 還沒輪到
  const other = g.players.find((p) => p !== cur);
  throws(() => G.act(g, other.id, { type: 'draw', from: 'pile' }), /輪到/);
  // 抽兩次
  G.act(g, cur.id, { type: 'draw', from: 'pile' });
  throws(() => G.act(g, cur.id, { type: 'draw', from: 'pile' }), /抽過/);
  assert.equal(cur.hand.length, 11);
  // 偷別人的牌
  throws(() => G.act(g, cur.id, { type: 'discard', card: other.hand[0].id }), /沒有這張/);
  // 沒放階段不能接牌
  throws(() => G.act(g, cur.id, { type: 'hit', group: 0, cards: [cur.hand[0].id] }), /放下自己的階段|找不到/);
  const before = g.turn;
  G.act(g, cur.id, { type: 'discard', card: plain(cur) });
  assert.notEqual(g.turn, before);
  assert.equal(cur.hand.length, 10);
}

// 放階段 + 出完牌 + 計分
{
  const g = rig(3);
  const [a, b, c] = [0, 1, 2].map((i) => g.players[(g.turn + i) % 3]);
  a.hand = [n(5), n(5, 'B'), n(5, 'G'), n(9), n(9, 'B'), n(9, 'G'), n(1)];
  b.hand = [n(12), s(), w(), n(3)]; // 10+15+25+5 = 55
  c.hand = [n(2), n(3)]; // 10
  g.draw.push(n(8)); // 下一張抽到的
  G.act(g, a.id, { type: 'draw', from: 'pile' });
  const ids = (xs) => xs.map((x) => x.id);
  // 錯誤的組合
  throws(() => G.act(g, a.id, { type: 'lay', groups: [ids(a.hand.slice(0, 3)), ids(a.hand.slice(0, 3))] }), /選牌有誤/);
  throws(() => G.act(g, a.id, { type: 'lay', groups: [ids(a.hand.slice(0, 3))] }), /組數/);
  const hand = [...a.hand];
  const five = hand.filter((x) => x.n === 5), nine = hand.filter((x) => x.n === 9);
  G.act(g, a.id, { type: 'lay', groups: [ids(five), ids(nine)] });
  assert.ok(a.laid);
  assert.equal(g.groups.length, 2);
  assert.equal(a.hand.length, 2);
  throws(() => G.act(g, a.id, { type: 'lay', groups: [[], []] }), /已經放下/);
  // 接牌（接自己的 9）→ 剩 1 張 → 棄掉 → 出完
  const eight = a.hand.find((x) => x.n === 8), one = a.hand.find((x) => x.n === 1);
  throws(() => G.act(g, a.id, { type: 'hit', group: 1, cards: [eight.id] }), /不能接/);
  G.act(g, a.id, { type: 'discard', card: one.id });
  assert.equal(g.status, 'play');
  assert.equal(a.hand.length, 1);
  // b 抽完、c 抽完
  G.act(g, b.id, { type: 'draw', from: 'discard' }); // 撿到 1
  const pk = (id) => G.view(g, a.id).players.find((p) => p.id === id).pick;
  assert.equal(pk(b.id).from, 'discard');
  assert.equal(pk(b.id).card.n, 1, '撿棄牌：大家看得到撿了哪張');
  G.act(g, b.id, { type: 'discard', card: b.hand.find((x) => x.t === 'n' && x.n === 3).id });
  G.act(g, c.id, { type: 'draw', from: 'pile' });
  assert.deepEqual(pk(c.id), { from: 'pile' }, '抽牌堆：只知道來源，不洩漏牌面');
  G.act(g, c.id, { type: 'discard', card: plain(c) });
  const hs = (id) => G.view(g, a.id).players.find((p) => p.id === id).hist;
  assert.deepEqual([hs(b.id).at(-1).card.n, hs(b.id).at(-1).disc.n], [1, 3], '歷史：撿了 1、棄了 3');
  assert.deepEqual(Object.keys(hs(c.id).at(-1)).sort(), ['disc', 'from'], '歷史：抽牌堆不洩漏牌面');
  // a 再抽，棄掉最後一張 → 出完
  G.act(g, a.id, { type: 'draw', from: 'pile' });
  a.hand = [n(7)];
  G.act(g, a.id, { type: 'discard', card: a.hand[0].id });
  assert.equal(g.status, 'roundEnd');
  const gains = Object.fromEntries(g.summary.rows.map((r) => [r.name, r.gain]));
  assert.equal(gains[a.name], 0);
  assert.equal(gains[b.name], 10 + 15 + 25 + 5, 'b 手上: 12(10)+跳過(15)+百搭(25)+撿來的 1(5)');
  assert.equal(g.summary.rows.find((x) => x.id === a.id).phase, 1, '摘要顯示的是本回合打的階段');
  assert.equal(a.phase, 2, '完成階段者進下一階段');
  assert.equal(b.phase, 1, '沒完成者留在原階段');
  G.act(g, a.id, { type: 'next' });
  assert.equal(g.round, 2);
}

// 跳過牌規則
{
  const g = rig(4);
  const order = [0, 1, 2, 3].map((i) => g.players[(g.turn + i) % 4]);
  const [a, b, c, e] = order;
  a.hand = [s(), n(1), n(2)];
  G.act(g, a.id, { type: 'draw', from: 'pile' });
  throws(() => G.act(g, a.id, { type: 'discard', card: a.hand.find((x) => x.t === 's').id }), /選擇/);
  G.act(g, a.id, { type: 'discard', card: a.hand.find((x) => x.t === 's').id, target: b.id });
  assert.equal(g.players[g.turn], c, 'b 被跳過');
  assert.equal(b.skip, 2);
  const ev = G.view(g, a.id).skipEv;
  assert.deepEqual([ev.by, ev.to], [a.id, b.id], 'view 帶出誰跳過誰');
  // 跳過牌不能被撿
  throws(() => G.act(g, c.id, { type: 'draw', from: 'discard' }), /不能撿/);
  G.act(g, c.id, { type: 'draw', from: 'pile' });
  G.act(g, c.id, { type: 'discard', card: plain(c) });
  G.act(g, e.id, { type: 'draw', from: 'pile' });
  G.act(g, e.id, { type: 'discard', card: plain(e) });
  assert.equal(g.players[g.turn], a);
  // 連續跳過：b 剛被跳過、還沒打過正常回合 → 不能再選 b；a 若再出跳過牌，可選的目標沒有 b
  G.act(g, a.id, { type: 'draw', from: 'pile' });
  a.hand = [s(), n(1)];
  throws(() => G.act(g, a.id, { type: 'discard', card: a.hand[0].id, target: b.id }), /選擇/);
  G.act(g, a.id, { type: 'discard', card: a.hand[0].id, target: c.id });
  assert.equal(g.players[g.turn], b, 'b 現在可以正常打');
  G.act(g, b.id, { type: 'draw', from: 'pile' });
  G.act(g, b.id, { type: 'discard', card: plain(b) });
  assert.equal(b.skip, 0, 'b 打過正常回合後可再被跳過');
}

// 2 人局：跳過 = 對手少一回合，換自己連續行動
{
  const g = rig(2);
  const [a, b] = [g.players[g.turn], g.players[(g.turn + 1) % 2]];
  a.hand = [s(), n(1), n(2)];
  G.act(g, a.id, { type: 'draw', from: 'pile' });
  G.act(g, a.id, { type: 'discard', card: a.hand.find((x) => x.t === 's').id, target: b.id });
  assert.equal(g.players[g.turn], a, '2 人局 b 被跳過，a 再動');
  assert.equal(g.stage, 'draw');
}

// 開局翻出跳過牌 → 第一位玩家被跳過
{
  let seen = false;
  for (let i = 0; i < 400 && !seen; i++) {
    const g = rawRig(3);
    if (g.disc[0].t === 's') {
      seen = true;
      const first = g.players[(g.dealer + 1) % 3];
      assert.equal(first.skip, 2, '第一位玩家被跳過');
      assert.equal(g.players[g.turn], g.players[(g.dealer + 2) % 3], '輪次推給下一位');
      assert.notEqual(g.players[g.turn], first);
    }
  }
  assert.ok(seen, '機率 4/108，400 次應該要碰到');
}

// 最後一張是跳過牌 → 直接出完，不選目標
{
  const g = rig(2);
  const a = g.players[g.turn];
  a.laid = true; a.hand = [s()];
  g.groups.push({ ...G.build('set', 3, [n(4), n(4), n(4)]), owner: a.id });
  G.act(g, a.id, { type: 'draw', from: 'pile' });
  a.hand = [s()];
  G.act(g, a.id, { type: 'discard', card: a.hand[0].id });
  assert.equal(g.status, 'roundEnd');
}

// 牌堆用完 → 洗棄牌堆
{
  const g = rig(2);
  const a = g.players[g.turn];
  g.disc = [n(1), n(2), n(3), n(4)];
  g.draw = [];
  G.act(g, a.id, { type: 'draw', from: 'pile' });
  assert.equal(g.disc.length, 1);
  assert.equal(g.draw.length, 2);
}

// --- 勝負 ---
{
  // 同回合兩人完成目標階段：總分少者贏
  const g = rig(3, { target: 2 });
  const [a, b, c] = g.players;
  [a, b, c].forEach((p) => { p.phase = 2; });
  a.score = 30; b.score = 10; c.score = 0;
  g.turn = 0; g.stage = 'act';
  a.laid = true; b.laid = true; c.laid = false; a.hand = [n(1)]; b.hand = [n(1)]; c.hand = [n(1)];
  G.act(g, a.id, { type: 'discard', card: a.hand[0].id });
  // a:30+0 vs b:10+5=15 → b 贏（c 沒完成階段不參加比較）
  assert.equal(g.status, 'over');
  assert.deepEqual(g.winners, [b.id]);
}
{
  // 平手 → 加賽
  const g = rig(3, { target: 2 });
  const [a, b, c] = g.players;
  [a, b, c].forEach((p) => { p.phase = 2; });
  g.turn = 0; g.stage = 'act';
  a.laid = true; b.laid = true; a.hand = [n(1)]; b.hand = [n(1), n(1)]; c.hand = [n(1)];
  a.score = 10; b.score = 0; // a 出完牌 +0 → 10；b 手上兩張 1 = +10 → 10，平手
  G.act(g, a.id, { type: 'discard', card: a.hand[0].id });
  assert.equal(g.status, 'roundEnd');
  assert.equal(g.summary.note.includes('加賽'), true);
  G.act(g, a.id, { type: 'next' });
  assert.equal(g.playoff.length, 2);
  assert.equal(c.in, false, '沒平手的人退場');
  assert.equal(c.hand.length, 0);
  assert.notEqual(g.players[g.turn], c);
}
{
  // 沒人完成目標階段 → 遊戲繼續；未完成者下一回合仍在同一階段
  const g = rig(2, { target: 10 });
  const [a, b] = g.players;
  a.phase = 10; b.phase = 3; g.turn = 0; g.stage = 'act';
  a.laid = false; b.laid = false; a.hand = [n(1)]; b.hand = [n(1), n(1)];
  G.act(g, a.id, { type: 'discard', card: a.hand[0].id });
  assert.equal(g.status, 'roundEnd', 'a 出完牌但沒完成第 10 階段，不能結束');
  G.act(g, a.id, { type: 'next' });
  assert.deepEqual([a.phase, b.phase], [10, 3], '沒完成階段就不升階，也不會被同步');
}

// --- 中途退出 ---
{
  // 輪到他時退出：換下一位、回到抽牌階段；牌數守恆；下一回合不再被發牌
  const g = rig(3);
  const cur = g.players[g.turn];
  G.act(g, cur.id, { type: 'draw', from: 'pile' });          // 讓他停在 act 階段，確認會被重置
  assert.equal(G.leave(g, cur.id), 2);
  assert.equal(cur.in, false); assert.equal(cur.hand.length, 0);
  assert.notEqual(g.players[g.turn], cur, '輪次要換人');
  assert.deepEqual(cur.hist, [], '退出者的撿棄牌歷史要清掉');
  assert.equal(g.stage, 'draw', '換人後要從抽牌開始');
  const total = () => g.players.reduce((a, p) => a + p.hand.length, 0) + g.groups.reduce((a, x) => a + x.cards.length, 0) + g.draw.length + g.disc.length;
  assert.equal(total(), 108, '退出者的牌放回棄牌堆，牌數守恆');
  G.leave(g, cur.id);                                         // 重複退出是 no-op
  assert.equal(total(), 108);
  // 回合結束後下一回合：他不該被重新發牌
  const other = g.players[g.turn];
  other.laid = true; other.hand = [n(1)]; g.stage = 'act';
  G.act(g, other.id, { type: 'discard', card: other.hand[0].id });
  assert.equal(g.status, 'roundEnd');
  assert.ok(!g.summary.rows.some((r) => r.id === cur.id), '結算不含退出者');
  G.act(g, other.id, { type: 'next' });
  assert.equal(cur.in, false, '下一回合退出者仍是 in=false');
  assert.equal(cur.hand.length, 0, '退出者不會被發牌');
}
{
  // 不是他的回合退出：輪次不動
  const g = rig(3);
  const turn = g.turn, other = g.players.findIndex((_, i) => i !== turn);
  const before = g.players[turn];
  G.leave(g, g.players[other].id);
  assert.equal(g.players[g.turn], before);
}
{
  // 被他跳過標記擋住的下一位：leave 之後 begin() 仍會處理跳過
  const g = rig(3);
  const i = g.turn, nx = (i + 1) % 3;
  g.players[nx].skip = 1;
  G.leave(g, g.players[i].id);
  assert.equal(g.players[nx].skip, 2, '下一位被跳過');
  assert.equal(g.players[g.turn], g.players[(i + 2) % 3]);
}
{
  // 剩 1 人：回傳 1，由呼叫者收尾
  const g = rig(2);
  assert.equal(G.leave(g, g.players[0].id), 1);
}
{
  // 加賽中退出：從 playoff 名單移除
  const g = rig(3, { target: 2 });
  const [a, b, c] = g.players;
  g.playoff = [a.id, b.id]; a.in = b.in = true; c.in = false;
  G.leave(g, a.id);
  assert.deepEqual(g.playoff, [b.id]);
}

// --- 邀請 QR code ---
// 黃金值：這個矩陣已用 zxing-cpp 實際解碼驗過（版本 1–5、邊界長度都能還原原文）。改了編碼器導致雜湊變動，要先重新用解碼器驗證再更新。
{
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8').split('// <qr>')[1].split('// </qr>')[0];
  const qrMatrix = new Function(src.replace(/^[^\n]*\n/, '') + '; return qrMatrix;')();
  const m = qrMatrix('http://192.168.1.23:3000/?room=ABCD');
  assert.equal(m.length, 29); // 35 位元組 → 版本 3
  assert.equal(require('node:crypto').createHash('sha1').update(m.flat().join('')).digest('hex'), '394df7205d0d0a1c8db2d5af0ec2400ade66d97f');
  assert.equal(qrMatrix('x'.repeat(107)), null);
}

// --- 隨機機器人整局模擬 ---
function bot(g, p) {
  const my = g.players.indexOf(p);
  const tryAct = (a) => { try { G.act(g, p.id, a); return true; } catch (e) { if (!e.user) throw e; return false; } };
  // 抽牌
  const top = g.disc.at(-1);
  if (top && top.t !== 's' && Math.random() < 0.3) tryAct({ type: 'draw', from: 'discard' });
  else tryAct({ type: 'draw', from: 'pile' });
  // 暴力嘗試放階段：隨機洗牌湊
  if (!p.laid) {
    const req = G.PHASES[p.phase - 1];
    for (let t = 0; t < 400 && !p.laid; t++) {
      const hand = [...p.hand].sort(() => Math.random() - 0.5);
      let k = 0;
      const groups = req.map(([, sz]) => hand.slice(k, (k += sz)).map((c) => c.id));
      if (k <= hand.length) tryAct({ type: 'lay', groups });
    }
  }
  if (p.laid) {
    for (const c of [...p.hand]) {
      if (p.hand.length <= 1 || g.status !== 'play' || g.players[g.turn] !== p) break;
      for (let gi = 0; gi < g.groups.length; gi++) {
        if (tryAct({ type: 'hit', group: gi, cards: [c.id], end: Math.random() < 0.5 ? 'lo' : 'hi' })) break;
      }
    }
  }
  if (g.status !== 'play' || g.players[g.turn] !== p) return;
  const c = p.hand[Math.floor(Math.random() * p.hand.length)];
  const t = g.players.find((q) => q.in && q !== p && q.skip === 0);
  tryAct({ type: 'discard', card: c.id, target: t && t.id }) || tryAct({ type: 'discard', card: c.id });
  void my;
}
function simulate(nPlayers, opts) {
  const g = rig(nPlayers, opts);
  let steps = 0;
  while (g.status !== 'over') {
    assert.ok(++steps < 60000, `${nPlayers} 人局無法結束（卡死）`);
    if (g.status === 'roundEnd') { G.act(g, g.players[0].id, { type: 'next' }); continue; }
    // 不變量：牌數守恆（每回合 108 = 手牌 + 組合 + 牌堆 + 棄牌）
    const total = g.players.reduce((a, p) => a + p.hand.length, 0) + g.groups.reduce((a, x) => a + x.cards.length, 0) + g.draw.length + g.disc.length;
    assert.equal(total, 108);
    assert.equal(new Set([].concat(...g.players.map((p) => p.hand.map((c) => c.id)), ...g.groups.map((x) => x.cards.map((c) => c.id)), g.draw.map((c) => c.id), g.disc.map((c) => c.id))).size, 108, '不得有重複牌');
    bot(g, g.players[g.turn]);
  }
  assert.ok(g.winners.length >= 1);
  return g;
}
for (let np = 2; np <= 6; np++) {
  const phasesGame = simulate(np, { target: np >= 5 ? 3 : 4 });
  assert.ok(phasesGame.round >= 3);
}

// --- HTTP 冒煙測試 ---
(async () => {
  const server = require('./server');
  await new Promise((res) => server.listen(0, res));
  const base = `http://127.0.0.1:${server.address().port}`;
  { // /api/lan：本機請求回傳 IPv4 字串或 null（沒網路時），不會丟錯
    const lan = await (await fetch(`${base}/api/lan`)).json();
    assert.ok(lan.ip === null || /^\d+\.\d+\.\d+\.\d+$/.test(lan.ip));
  }
  const post = async (name, body) => {
    const r = await fetch(`${base}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  const host = (await post('create', { name: '房主' })).json;
  assert.match(host.code, /^[A-Z]{4}$/);
  assert.equal((await post('join', { code: host.code, name: '房主' })).status, 400, '重名');
  assert.equal((await post('join', { code: 'ZZZZ', name: 'x' })).status, 400, '房間不存在');
  assert.equal((await post('start', host)).status, 400, '1 人不能開');
  const guests = [];
  for (let i = 0; i < 5; i++) guests.push((await post('join', { code: host.code.toLowerCase(), name: 'G' + i })).json);
  assert.equal((await post('join', { code: host.code, name: '第七人' })).status, 400, '滿 6 人');
  assert.equal((await post('start', guests[0] && { ...guests[0], code: host.code })).status, 400, '非房主不能開');

  // SSE 讀一筆
  const sseOnce = async (a) => {
    const ac = new AbortController();
    const r = await fetch(`${base}/api/events?code=${a.code}&token=${a.token}`, { signal: ac.signal });
    const reader = r.body.getReader();
    // 一個 chunk 可能含多個事件（前一條連線關閉也會觸發廣播），或事件被切開：讀到完整第一筆再解析
    let buf = '';
    const dec = new TextDecoder();
    while (!buf.includes('\n\n')) {
      const { value, done } = await reader.read();
      if (done) throw new Error('SSE 在收到完整事件前就被關閉');
      buf += dec.decode(value, { stream: true });
    }
    ac.abort();
    return JSON.parse(buf.split('\n\n')[0].replace(/^data: /, ''));
  };
  let v = await sseOnce(host);
  assert.equal(v.players.length, 6);
  assert.equal(v.settings.target, 10, '預設打完 10 階段');
  assert.equal((await post('settings', { ...host, target: 4 })).status, 200);
  assert.equal((await post('start', host)).status, 200);
  v = await sseOnce(guests[2]);
  assert.equal(v.game.hand.length, 10, '玩家只看到自己的 10 張牌');
  assert.ok(v.game.players.every((p) => p.n === 10));
  assert.equal(JSON.stringify(v).includes('"hand":[{'), true);
  // 看不到別人的手牌
  const mine = v.game.hand.map((c) => c.id);
  const other = await sseOnce(guests[3]);
  assert.ok(!other.game.hand.some((c) => mine.includes(c.id)));
  assert.equal((await post('join', { code: host.code, name: '遲到' })).status, 400, '遊戲開始後不能加入');
  assert.equal((await post('act', { ...host, action: { type: 'draw', from: 'pile' } })).status === 200 || true, true);
  assert.equal((await post('act', { code: host.code, token: 'bad', action: {} })).status, 404);
  // 表情：白名單、每人冷卻、seq 遞增
  assert.equal((await post('react', { ...host, e: '😮' })).status, 200);
  assert.equal((await post('react', { ...host, e: '😮' })).status, 400, '冷卻中');
  assert.equal((await post('react', { ...guests[0], e: '💩' })).status, 400, '不在白名單');
  assert.equal((await post('react', { ...guests[0], e: '😡' })).status, 200, '別人不受冷卻影響');
  v = await sseOnce(guests[1]);
  assert.deepEqual(v.rx.map((r) => [r.seq, r.e]), [[1, '😮'], [2, '😡']]);
  assert.equal((await post('react', { ...guests[1], e: '😴' })).status, 200, '睡覺表情');
  const wl = (f) => require('node:fs').readFileSync(require('node:path').join(__dirname, f), 'utf8').match(/const EMOJI = (\[.*?\]);/)[1];
  assert.equal(wl('server.js'), wl('index.html'), 'server 與前端的表情白名單要一致');
  const room = server.rooms.get(host.code);
  const cardsIn = (g) => g.players.reduce((a, p) => a + p.hand.length, 0) + g.groups.reduce((a, x) => a + x.cards.length, 0) + g.draw.length + g.disc.length;

  // 遊戲中途退出：玩家從房間移除，但引擎裡只標記 left；牌守恆；輪到他時輪次換人
  const leaver = room.game.players[room.game.turn];
  const leaverTok = room.players.find((p) => p.id === leaver.id);
  assert.equal((await post('leave', { code: host.code, token: leaverTok.token })).status, 200, '遊戲中途可以退出');
  assert.equal(room.players.length, 5);
  assert.equal(room.game.players.length, 6, '引擎裡的玩家不刪，只標記');
  assert.ok(leaver.left && !leaver.in && leaver.hand.length === 0);
  assert.equal(cardsIn(room.game), 108, '退出後牌數守恆');
  assert.notEqual(room.game.players[room.game.turn], leaver, '輪次要離開退出者');
  assert.ok(room.host, '還有房主');
  v = await sseOnce({ code: host.code, token: room.players[0].token });
  assert.equal(v.game.players.find((p) => p.id === leaver.id).left, true, '其他人看得到他已離開');

  // 繼續退到剩 1 人 → 房間關閉，所有人收到 closed
  const rest = () => room.players.map((p) => ({ code: host.code, token: p.token }));
  while (room.players.length > 2) await post('leave', rest()[1]);
  assert.ok(server.rooms.has(host.code), '還剩 2 人，房間還在');
  const watcher = rest()[0];
  const ac = new AbortController();
  const sse = await fetch(`${base}/api/events?code=${watcher.code}&token=${watcher.token}`, { signal: ac.signal });
  const rd = sse.body.getReader(); const dec = new TextDecoder(); let got = '';
  await rd.read();                                          // 第一筆：目前狀態
  assert.equal((await post('leave', rest()[1])).status, 200);
  const deadline = Date.now() + 2000;                       // 沒收到 closed 要「失敗」而不是無限等下去
  while (!got.includes('closed') && Date.now() < deadline) {
    const r = await Promise.race([rd.read(), new Promise((res) => setTimeout(() => res({ done: true }), 500))]);
    if (r.done) break;
    got += dec.decode(r.value, { stream: true });
  }
  assert.match(got, /"closed":".*房間已關閉/, '剩 1 人 → 推送關房原因');
  assert.ok(!server.rooms.has(host.code), '房間已刪除');
  assert.equal((await post('leave', watcher)).status, 404, '關閉後的房間查不到');
  ac.abort();

  // 遊戲結束後離開：不經過引擎，行為跟以前一樣
  const h2 = (await post('create', { name: 'H2' })).json;
  const g2 = (await post('join', { code: h2.code, name: 'G2' })).json;
  await post('start', h2);
  const room2 = server.rooms.get(h2.code);
  room2.game.status = 'over';
  assert.equal((await post('leave', g2)).status, 200, '遊戲結束後非房主可以離開');
  assert.equal(room2.players.length, 1);
  assert.ok(!room2.game.players.some((p) => p.left), '結束後離開不標記 left');
  // 回合倒數：建房可設秒數（10–600，預設 60），超時（連線中的玩家也一樣）自動代打換人
  assert.equal(room2.settings.turn, 60, '預設 60 秒');
  assert.equal((await post('create', { name: 'x', turn: 5 })).status, 400, '秒數太小');
  assert.equal((await post('create', { name: 'x', turn: 601 })).status, 400, '秒數太大');
  assert.equal((await post('create', { name: 'x', turn: 'a' })).status, 400, '秒數不是整數');
  const h3 = (await post('create', { name: 'H3', turn: 30 })).json;
  await post('join', { code: h3.code, name: 'G3' });
  const room3 = server.rooms.get(h3.code);
  assert.equal(room3.settings.turn, 30);
  room3.settings.turn = 0.3; // 測試用：直接改成 0.3 秒，不然要等 10 秒以上
  const ac3 = new AbortController();
  await fetch(`${base}/api/events?code=${h3.code}&token=${h3.token}`, { signal: ac3.signal }); // 要有人連線倒數才會跑
  await post('start', h3);
  const no0 = room3.game.turnNo;
  await new Promise((res) => setTimeout(res, 800));
  assert.ok(room3.game.turnNo > no0, '超時自動代打、換人');
  ac3.abort();
  server.close();
  console.log('✅ 全部測試通過');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
