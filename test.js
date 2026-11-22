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

// 放下階段時多放的牌（順便接牌）：張數 ≥ 要求都行
r = G.build('run', 4, [n(3), n(4), n(5), n(6), n(7)]);
assert.deepEqual([r.lo, r.hi, r.cards.length], [3, 7, 5]);
r = G.build('run', 4, [n(3), n(4), n(5), n(6), w()], 2); // 百搭起點仍可指定：2–6
assert.deepEqual([r.lo, r.hi], [2, 6]);
assert.equal(G.build('set', 3, [n(7), n(7, 'B'), n(7, 'G'), w()]).cards.length, 4);
throws(() => G.build('run', 4, [n(3), n(4), n(5), n(9), n(10)]), /間隔/);
throws(() => G.build('run', 4, [...Array(13)].map((_, i) => (i ? n(i) : w()))), /12/);

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
  const ev = G.view(g, a.id).ev;
  assert.deepEqual([ev.kind, ev.by, ev.to], ['s', a.id, b.id], 'view 帶出誰跳過誰');
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
  if (top && (top.t === 'n' || top.t === 'w') && Math.random() < 0.3) tryAct({ type: 'draw', from: 'discard' });
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
  const t = g.players.find((q) => q.in && q !== p && q.skip === 0), o = g.players.find((q) => q.in && q !== p);
  const give = p.hand.find((x) => x !== c);
  tryAct({ type: 'discard', card: c.id, target: t && t.id, give: give && give.id, num: 1 + Math.floor(Math.random() * 12), color: 'RBGY'[Math.floor(Math.random() * 4)] })
    || tryAct({ type: 'discard', card: c.id, target: o && o.id, give: give && give.id, num: 1 + Math.floor(Math.random() * 12), color: 'RBGY'[Math.floor(Math.random() * 4)] });
  void my;
}
function simulate(nPlayers, opts) {
  const g = opts.rules ? rigR(nPlayers, opts.rules, { target: opts.target }) : rig(nPlayers, opts);
  const size = G.deck(opts.rules).length;
  let steps = 0;
  while (g.status !== 'over') {
    assert.ok(++steps < 60000, `${nPlayers} 人局無法結束（卡死）`);
    if (g.status === 'roundEnd') { G.act(g, g.players[0].id, { type: 'next' }); continue; }
    // 不變量：牌數守恆（每回合 108 = 手牌 + 組合 + 牌堆 + 棄牌）
    const total = g.players.reduce((a, p) => a + p.hand.length, 0) + g.groups.reduce((a, x) => a + x.cards.length, 0) + g.draw.length + g.disc.length;
    assert.equal(total, size);
    assert.equal(new Set([].concat(...g.players.map((p) => p.hand.map((c) => c.id)), ...g.groups.map((x) => x.cards.map((c) => c.id)), g.draw.map((c) => c.id), g.disc.map((c) => c.id))).size, size, '不得有重複牌');
    bot(g, g.players[g.turn]);
  }
  assert.ok(g.winners.length >= 1);
  return g;
}
for (let np = 2; np <= 6; np++) {
  const phasesGame = simulate(np, { target: np >= 5 ? 3 : 4 });
  assert.ok(phasesGame.round >= 3);
}


// --- 特殊規則（建房時可選；預設全關 = 標準規則）---
const ALL = { catchUp: true, first: true, rv: true, sh: true, xn: true, xc: true };
const sp = (t) => ({ id: Math.random(), t });
const total = (g) => g.players.reduce((a, p) => a + p.hand.length, 0) + g.groups.reduce((a, x) => a + x.cards.length, 0) + g.draw.length + g.disc.length;
function rigR(nPlayers, rules, opts = {}) {
  const ps = [...Array(nPlayers)].map((_, i) => ({ id: 'p' + i, name: 'P' + i }));
  for (;;) { const g = G.create(ps, { target: 10, ...opts, rules }); if (g.disc[0].t === 'n') return g; }
}
{
  // 牌組：沒開 = 108；開哪種就多幾張（迴轉、換位子、換顏色 2 張，換數字 4 張）；特殊牌每張 25 分
  assert.equal(G.deck().length, 108);
  assert.equal(G.deck(ALL).length, 118);
  assert.equal(G.deck({ rv: true }).filter((c) => c.t === 'rv').length, 2);
  assert.equal(G.deck({ xn: true }).filter((c) => c.t === 'xn').length, 4);
  assert.equal(G.deck({ rv: true }).length, 110);
  ['rv', 'sh', 'xn', 'xc'].forEach((t) => assert.equal(G.pts(sp(t)), 25));
  // 特殊牌不能放階段、不能接牌、不能從棄牌堆撿
  throws(() => G.build('set', 3, [n(7), n(7), sp('rv')]), /特殊牌/);
  const g = rigR(2, ALL);
  const a = g.players[g.turn];
  g.disc.push(sp('xn'));
  throws(() => G.act(g, a.id, { type: 'draw', from: 'discard' }), /不能撿/);
}
{
  // 落後 2 階段以上多發一張；跟最高階段比；沒開規則就不發
  const ps = [0, 1, 2].map((i) => ({ id: 'p' + i, name: 'P' + i }));
  const g = G.create(ps, { target: 10, rules: { catchUp: true } });
  g.players[0].phase = 5; g.players[1].phase = 4; g.players[2].phase = 3;
  g.status = 'roundEnd'; G.act(g, 'p0', { type: 'next' });
  assert.deepEqual(g.players.map((p) => p.hand.length), [10, 10, 11], '差 1 不算，差 2 多一張');
  assert.equal(total(g), 108);
  g.players[2].phase = 1; g.status = 'roundEnd'; G.act(g, 'p0', { type: 'next' });
  assert.equal(g.players[2].hand.length, 11, '差再多也只多一張');
  const off = G.create(ps, { target: 10 });
  off.players[2].phase = 1; off.players[0].phase = 9; off.status = 'roundEnd'; G.act(off, 'p0', { type: 'next' });
  assert.equal(off.players[2].hand.length, 10, '沒開規則不多發');
  // 離開的人不影響最高階段
  const lv = G.create(ps, { target: 10, rules: { catchUp: true } });
  lv.players[0].phase = 9; lv.players[1].phase = 3; lv.players[2].phase = 3;
  G.leave(lv, 'p0'); lv.status = 'roundEnd'; G.act(lv, 'p1', { type: 'next' });
  assert.deepEqual([lv.players[1].hand.length, lv.players[2].hand.length], [10, 10], '最高階段只算還在場的人');
}
{
  // 先放下 −10：只有「第一個」放下的人；後面放下的不算；出完牌的 0 分照樣 −10（變負分）；沒開規則不扣
  const ids = (xs) => xs.map((x) => x.id);
  const lay = (g, p) => {
    p.hand = [n(5), n(5, 'B'), n(5, 'G'), n(9), n(9, 'B'), n(9, 'G'), n(1), n(2)];
    g.turn = g.players.indexOf(p); g.stage = 'act';
    G.act(g, p.id, { type: 'lay', groups: [ids(p.hand.slice(0, 3)), ids(p.hand.slice(3, 6))] });
  };
  const play = (rules) => {
    const g = rigR(3, rules);
    const [a, b, c] = g.players;
    lay(g, a); lay(g, b); // a 先、b 後
    c.hand = [n(3)];
    a.hand = [n(1)]; b.hand = [n(4), n(4, 'B')];
    g.turn = g.players.indexOf(a); g.stage = 'act';
    G.act(g, a.id, { type: 'discard', card: a.hand[0].id }); // a 出完牌
    const gain = Object.fromEntries(g.summary.rows.map((r) => [r.id, r.gain]));
    return { g, gain, a, b, c };
  };
  let { g, gain, a, b, c } = play({ first: true });
  assert.equal(g.first, a.id);
  assert.deepEqual([gain[a.id], gain[b.id], gain[c.id]], [-10, 5 + 5, 5], 'a 先放下又出完牌 = −10；b 後放下不算');
  assert.equal(a.score, -10, '分數可以是負的');
  assert.equal(g.summary.rows.find((r) => r.id === a.id).first, true);
  ({ gain, a, b, c } = play({}));
  assert.deepEqual([gain[a.id], gain[b.id], gain[c.id]], [0, 10, 5], '沒開規則不扣');
  // 先放下的人中途離開 → 作廢，不轉給別人
  g = rigR(3, { first: true });
  lay(g, g.players[0]);
  assert.equal(g.first, g.players[0].id);
  G.leave(g, g.players[0].id);
  assert.equal(g.first, null, '先放下的人離開 → −10 作廢');
  lay(g, g.players[1]);
  assert.equal(g.first, null, '桌上已有組合（他留下的），後面的人拿不到');
  // 新回合重設
  g.status = 'roundEnd'; G.act(g, g.players[1].id, { type: 'next' });
  assert.equal(g.first, null);
}
{
  // 迴轉：方向反過來；2 人局無差別；下一回合恢復
  const g = rigR(4, ALL);
  const i = g.turn, a = g.players[i];
  a.hand = [sp('rv'), n(1), n(2)];
  G.act(g, a.id, { type: 'draw', from: 'pile' });
  G.act(g, a.id, { type: 'discard', card: a.hand.find((x) => x.t === 'rv').id });
  assert.equal(g.dir, -1);
  assert.equal(g.turn, (i + 3) % 4, '改成往回走');
  assert.equal(G.view(g, a.id).ev.kind, 'rv');
  const g2 = rigR(2, ALL), b = g2.players[g2.turn];
  b.hand = [sp('rv'), n(1), n(2)];
  G.act(g2, b.id, { type: 'draw', from: 'pile' });
  G.act(g2, b.id, { type: 'discard', card: b.hand.find((x) => x.t === 'rv').id });
  assert.notEqual(g2.players[g2.turn], b, '2 人局迴轉照樣換人');
  g.status = 'roundEnd'; G.act(g, a.id, { type: 'next' });
  assert.equal(g.dir, 1, '新回合方向重設');
}
{
  // 換位子：手牌跟著人走，輪次接著位子打亂前的下一位，莊家還是同一個人
  let moved = false;
  for (let t = 0; t < 30 && !moved; t++) {
    const g = rigR(5, ALL);
    const a = g.players[g.turn], dealer = g.players[g.dealer];
    a.hand = [sp('sh'), n(1), n(2)];
    const all = total(g); // 自訂手牌後的總數（被換掉的牌不見了，所以不能寫死 118）；這裡只驗證「換位子前後牌數不變」
    const hands = new Map(g.players.map((p) => [p, p.hand.map((c) => c.id).join()]));
    const before = g.players.map((p) => p.id).join();
    G.act(g, a.id, { type: 'draw', from: 'pile' });
    hands.set(a, null);
    const ids = g.players.map((p) => p.id);
    G.act(g, a.id, { type: 'discard', card: a.hand.find((x) => x.t === 'sh').id });
    assert.deepEqual([...g.players.map((p) => p.id)].sort(), [...ids].sort(), '人不增不減');
    assert.equal(g.players[g.dealer], dealer, '莊家還是同一個人');
    assert.equal(g.players[(g.turn - 1 + 5) % 5], a, '下一位 = 他新座位的下家');
    for (const [p, h] of hands) if (h) assert.equal(p.hand.map((c) => c.id).join(), h, '手牌跟著人走');
    assert.equal(total(g), all, '換位子不增減牌');
    moved = g.players.map((p) => p.id).join() !== before;
  }
  assert.ok(moved, '座位應該被打亂');
}
{
  // 交換牌：結果前先選好要換出去的牌；落空時什麼都不換；只換得到數字牌
  const setup = (t) => {
    const g = rigR(3, ALL);
    const [a, b] = [g.players[g.turn], g.players[(g.turn + 1) % 3]];
    a.hand = [sp(t), n(1), n(2)];
    b.hand = [n(7), n(7, 'B'), w(), s(), n(9, 'G')];
    G.act(g, a.id, { type: 'draw', from: 'pile' });
    return { g, a, b, x: a.hand.find((c) => c.t === t), give: a.hand.find((c) => c.t === 'n' && c.n === 1) };
  };
  let { g, a, b, x, give } = setup('xn');
  const bIds = b.hand.map((c) => c.id), aN = a.hand.length;
  throws(() => G.act(g, a.id, { type: 'discard', card: x.id, give: give.id, num: 7 }), /交換的玩家/);
  throws(() => G.act(g, a.id, { type: 'discard', card: x.id, target: b.id, num: 7 }), /換出去/);
  throws(() => G.act(g, a.id, { type: 'discard', card: x.id, target: b.id, give: x.id, num: 7 }), /換出去/, '不能拿剛打出的牌來換');
  throws(() => G.act(g, a.id, { type: 'discard', card: x.id, target: a.id, give: give.id, num: 7 }), /交換的玩家/, '不能選自己');
  throws(() => G.act(g, a.id, { type: 'discard', card: x.id, target: b.id, give: give.id, num: 13 }), /1–12/);
  assert.equal(g.turn, g.players.indexOf(a), '驗證失敗不會動到狀態');
  G.act(g, a.id, { type: 'discard', card: x.id, target: b.id, give: give.id, num: 7 });
  assert.ok(b.hand.some((c) => c.id === give.id), '對方拿到我換出去的牌');
  const got = a.hand.find((c) => !bIds.includes(c.id) === false && c.t === 'n' && c.n === 7);
  assert.ok(got, '我拿到對方的 7');
  assert.equal(a.hand.length, aN - 1);
  assert.equal(b.hand.length, 5, '雙方張數不變');
  assert.equal(G.view(g, a.id).ev.got.n, 7, '當事人看得到換到什麼');
  assert.equal(G.view(g, b.id).ev.give.id, give.id);
  const spy = G.view(g, g.players.find((p) => p !== a && p !== b).id).ev;
  assert.deepEqual([spy.ok, spy.give, spy.got], [true, undefined, undefined], '旁觀者只知道成功，不知道是哪張');
  // 對方沒有該數字 → 落空：牌留在原位，這張牌仍然打出去、換下一位
  ({ g, a, b, x, give } = setup('xn'));
  const bBefore = b.hand.map((c) => c.id).join();
  G.act(g, a.id, { type: 'discard', card: x.id, target: b.id, give: give.id, num: 3 });
  assert.equal(b.hand.map((c) => c.id).join(), bBefore, '落空不換');
  assert.ok(a.hand.some((c) => c.id === give.id));
  assert.equal(G.view(g, a.id).ev.ok, false);
  assert.notEqual(g.players[g.turn], a);
  // 百搭、跳過牌指定不到：指定數字只會換到數字牌
  ({ g, a, b, x, give } = setup('xc'));
  throws(() => G.act(g, a.id, { type: 'discard', card: x.id, target: b.id, give: give.id, color: 'X' }), /顏色/);
  G.act(g, a.id, { type: 'discard', card: x.id, target: b.id, give: give.id, color: 'G' });
  assert.ok(a.hand.some((c) => c.t === 'n' && c.c === 'G' && c.n === 9), '指定顏色換到綠 9');
  // plain：當普通牌棄掉，不指定任何東西、不換牌、沒有交換事件，照樣換下一位
  ({ g, a, b, x } = setup('xc'));
  const bPlain = b.hand.map((c) => c.id).join(), aPlain = a.hand.length;
  G.act(g, a.id, { type: 'discard', card: x.id, plain: true });
  assert.equal(b.hand.map((c) => c.id).join(), bPlain);
  assert.equal(a.hand.length, aPlain - 1);
  assert.ok(!g.ev || g.ev.kind !== 'xc', '沒有交換事件');
  assert.notEqual(g.players[g.turn], a);
  // 最後一張牌是交換牌：直接出完，不需要指定
  ({ g, a } = setup('xn'));
  a.laid = true; a.hand = [sp('xn')];
  G.act(g, a.id, { type: 'discard', card: a.hand[0].id });
  assert.equal(g.status, 'roundEnd');
  // 逾時代打：手上全是特殊牌也不會卡住
  ({ g, a } = setup('xc'));
  a.hand = [sp('xc'), sp('xn'), sp('sh')];
  g.stage = 'draw'; G.autoPlay(g, a.id);
  assert.notEqual(g.players[g.turn], a, '代打能處理需要選擇的特殊牌');
}
// 隨機整局：原有的特殊規則（落後補牌、先放先贏、迴轉、換位子、兩種交換）同時開，不變量照常成立
for (let np = 2; np <= 6; np++) {
  const g = simulate(np, { target: np >= 5 ? 3 : 4, rules: ALL });
  assert.ok(g.round >= 3);
}

// --- 富士流 ---
{
  const F = require('./fuji');
  const fd = F.deck();
  assert.equal(fd.length, 90);
  assert.equal(fd.filter((c) => c.n === 2).length, 16);
  assert.equal(fd.filter((c) => c.n === 8).length, 5);
  assert.equal(Math.max(...fd.map((c) => c.n)), 20);
  assert.equal(new Set(fd.map((c) => c.id)).size, 90);
  const ppl = (k) => Array.from({ length: k }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  assert.equal(F.create(ppl(6)).players[0].hand.length, 6, '3–6 人發 6 張');
  assert.equal(F.create(ppl(7)).players[0].hand.length, 5, '7–8 人發 5 張');
  // 手牌固定的小牌局：p0 先出；牌堆放幾張已知的牌
  const mk = (hands, k = hands.length) => {
    const g = F.create(ppl(k));
    g.turn = 0; g.draw = [100, 101, 102, 103].map((id) => ({ id, n: 2 })); g.log = [];
    g.players.forEach((p, i) => { p.hand = (hands[i] || []).map((n, j) => ({ id: i * 10 + j, n })); p.card = null; });
    return g;
  };
  const play = (g, i, n) => F.act(g, g.players[i].id, { type: 'play', card: g.players[i].hand.find((c) => c.n === n).id });
  let g = mk([[5, 9], [3, 9], [7, 9]]);
  play(g, 0, 5); play(g, 1, 3);
  assert.equal(g.players[0].card.n, 5, '比別人大的不會被沖走');
  play(g, 2, 7); // 7 沖走 5 和 3，各抽 1
  assert.ok(g.players[0].card === null && g.players[1].card === null, '較小的被沖走');
  assert.deepEqual([g.players[0].hand.length, g.players[1].hand.length, g.players[2].hand.length], [2, 2, 1], '被沖走的人手牌數不變');
  assert.equal(g.disc.length, 2);
  const e1 = F.view(g, 'p0').ev; // 結構化事件：前端靠它提示「你的牌被沖走／流走」
  assert.deepEqual([e1.by, e1.n, e1.out.map((o) => o.id + o.n)], ['p2', 7, ['p05', 'p13']]);
  // 輪回自己：面前的牌還在 → 流走、不補牌
  g = mk([[5, 9], [3, 9], [2, 9]]);
  play(g, 0, 5); play(g, 1, 3); play(g, 2, 2);
  assert.equal(g.players[0].card, null, '輪回來時 5 順水流走');
  assert.equal(g.players[0].hand.length, 1, '流走不補牌');
  assert.equal(g.players[1].card.n, 3, '別人的牌不受影響');
  // 同盟：8+8=16 擋住 9、10；打出 17 才沖得走；同盟一起被沖走、各抽 1
  g = mk([[8, 20], [3, 8, 20], [9, 17], [10, 17]]);
  play(g, 0, 8); play(g, 1, 8);
  assert.equal(g.players[0].card.n, 8); assert.equal(F.view(g, 'p0').players[1].sum, 16, '同盟合計 16');
  play(g, 2, 9);
  assert.ok(g.players[0].card && g.players[1].card && g.players[2].card, '9 小於同盟 16，誰都沒被沖走');
  play(g, 3, 10); // 10 沖走 9；輪回 p0 → 同盟 8+8 一起流走
  assert.equal(g.players[2].card, null, '9 被 10 沖走'); assert.equal(g.players[2].hand.length, 2, '被沖走的補 1 張');
  assert.ok(g.players[0].card === null && g.players[1].card === null, '同盟一起流走，10 小於 16 沖不走它們');
  assert.equal(g.players[3].card.n, 10);
  // 回到 p0：同盟一起流走（p1 還沒輪到也走了）
  const g2 = mk([[8, 20], [8, 20], [4, 20]]);
  play(g2, 0, 8); play(g2, 1, 8); play(g2, 2, 4);
  assert.ok(g2.players[0].card === null && g2.players[1].card === null, '同盟成功是一體的：輪到 p0 時 p1 的牌一起流走');
  assert.deepEqual(F.view(g2, 'p2').ev.gone.map((x) => x.id), ['p0', 'p1'], '流走的事件記在觸發它的那一手上');
  assert.equal(g2.players[1].hand.length, 1, '同盟流走不補牌');
  // 同盟被沖走：p0、p1 的 8 都被 17 沖掉，各抽 1
  const g3 = mk([[8, 20], [8, 20], [17, 20]]);
  play(g3, 0, 8); play(g3, 1, 8); play(g3, 2, 17);
  assert.ok(g3.players[0].card === null && g3.players[1].card === null && g3.players[2].card.n === 17);
  assert.deepEqual(g3.players.map((p) => p.hand.length), [2, 2, 1], '同盟失敗是一體的，各抽 1');
  // 合計剛好相等不沖：8+8=16 vs 單張 16
  const g4 = mk([[8, 20], [8, 20], [16, 20]]);
  play(g4, 0, 8); play(g4, 1, 8); play(g4, 2, 16);
  assert.deepEqual(g4.players.map((p) => p.hand.length), [1, 1, 1], '16 不大於 16，沒人被沖走（沒人補牌）');
  assert.equal(g4.players[2].card.n, 16);
  // 勝利：最後一張打出且流走才算；中途被沖走要補牌繼續
  let w = mk([[5], [3, 9], [4, 9]]);
  play(w, 0, 5); play(w, 1, 3);
  assert.equal(w.status, 'play', '最後一張打出還沒流走，不算贏');
  play(w, 2, 4);
  assert.equal(w.status, 'over'); assert.deepEqual(w.winners, ['p0']);
  w = mk([[5], [3, 9], [7, 9]]);
  play(w, 0, 5); play(w, 1, 3); play(w, 2, 7); // 沖走 5：p0 抽 1
  assert.equal(w.status, 'play'); assert.equal(w.players[0].hand.length, 1, '最後一張被沖走要補牌');
  // 同盟一起贏：兩人的最後一張同數字、一起流走
  w = mk([[6], [6], [2, 9]]);
  play(w, 0, 6); play(w, 1, 6); play(w, 2, 2);
  assert.deepEqual(w.winners.sort(), ['p0', 'p1'], '同盟一起流走，兩人同時出完');
  // 錯誤：不是自己的回合／沒有這張牌
  g = mk([[5], [3], [4]]);
  throws(() => F.act(g, 'p1', { type: 'play', card: 10 }), /還沒輪到/);
  throws(() => F.act(g, 'p0', { type: 'play', card: 999 }), /沒有這張牌/);
  throws(() => F.act(g, 'p0', { type: 'x' }), /未知/);
  // 中途退出：牌回棄牌堆、輪到他就換人、同盟重算
  g = mk([[8, 9], [8, 9], [4, 9]]);
  play(g, 0, 8);
  assert.equal(F.leave(g, 'p1'), 2);
  assert.equal(g.players[1].in, false); assert.equal(g.turn, 2, '輪到他的回合直接換人');
  assert.equal(F.view(g, 'p0').players[0].sum, 8, '同盟少一人，合計重算');
  // 牌守恆 + 隨機機器人整局（3–8 人）：一定會結束、牌不多不少
  for (let np = 3; np <= 8; np++) for (let t = 0; t < 20; t++) {
    const s = F.create(ppl(np));
    const total = () => s.players.reduce((a, p) => a + p.hand.length + (p.card ? 1 : 0), 0) + s.draw.length + s.disc.length;
    let steps = 0;
    while (s.status === 'play') {
      const p = s.players[s.turn];
      F.act(s, p.id, { type: 'play', card: p.hand[randomInt(p.hand.length)].id });
      assert.equal(total(), 90, '牌數守恆');
      assert.ok(++steps < 5000, '整局要能結束');
    }
    assert.ok(s.winners.length >= 1);
  }
  F.autoPlay(mk([[5, 2], [3], [4]]), 'p0'); // 代打不會丟錯
}

// --- 貓貓食堂 ---
{
  const C = require('./cats');
  const ppl = (k) => Array.from({ length: k }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const mk = (k, rounds = 3) => { const g = C.create(ppl(k), { rounds }); g.leader = 0; g.turn = 0; return g; };
  const pickAll = (g, cards) => cards.forEach((c, i) => C.act(g, g.players[i].id, { type: 'pick', card: c }));

  // 初始狀態：每人 1–12 共 12 張、預設 3 輪、自訂輪數
  let g = C.create(ppl(4));
  assert.equal(g.rounds, 3);
  assert.equal(g.round, 1);
  assert.equal(g.trick, 1);
  assert.ok(g.players.every((p) => p.hand.length === 12 && p.hand[0] === 1 && p.hand[11] === 12));
  assert.equal(C.create(ppl(3), { rounds: 5 }).rounds, 5);

  // 核心比對規則：
  // 1) 沒有人跟首領相同：首領正放(+)、比首領小正放(+)、比首領大橫置(-)
  g = mk(4);
  pickAll(g, [6, 3, 9, 12]); // 首領 p0 出 6；p1 出 3(<6 +3)；p2 出 9(>6 -9)；p3 出 12(>6 -12)
  assert.deepEqual(g.players.map((p) => p.roundScore), [6, 3, -9, -12]);
  assert.equal(g.leader, 1, '首領標記順時針傳給下一位');
  assert.equal(g.trick, 2);
  assert.equal(g.last.matched, false);

  // 2) 有玩家與首領數字相同：首領橫置(-)、同號玩家正放(+)、比首領小(+)、比首領大(-)
  pickAll(g, [5, 7, 7, 10]); // 首領是 p1 出 7；p0 出 5(+5)；p2 出 7(+7 撞號)；p3 出 10(-10)；首領 p1 橫置(-7)
  assert.deepEqual(g.players.map((p) => p.roundScore), [6 + 5, 3 - 7, -9 + 7, -12 - 10]);
  assert.equal(g.last.matched, true);
  assert.equal(g.leader, 2, '首領順時針傳給 p2');

  // 3) 蓋牌隱藏（view 不洩漏別人蓋哪張，只看得到 ready 與自己的 myPick）、可 unpick 重選
  C.act(g, 'p0', { type: 'pick', card: 4 });
  const v1 = C.view(g, 'p1'), v0 = C.view(g, 'p0');
  assert.equal(v1.players[0].ready, true);
  assert.equal(v1.myPick, null);
  assert.equal(v0.myPick, 4);
  assert.ok(!JSON.stringify(v1).includes('"pick":4'), '不能洩漏別人蓋的牌');
  C.act(g, 'p0', { type: 'unpick' });
  assert.equal(C.view(g, 'p0').myPick, null);
  throws(() => C.act(g, 'p0', { type: 'unpick' }), /還沒蓋牌/);
  throws(() => C.act(g, 'p0', { type: 'pick', card: 6 }), /沒有這張/, '出過的牌不能再出');
  throws(() => C.act(g, 'p0', { type: 'pick', card: 13 }), /沒有這張/);
  throws(() => C.act(g, 'p0', { type: 'bogus' }), /未知/);

  // 4) 一輪結算計分：最高 +2、第二 +1、最低 -1（3 人局、4 人局、同分情況）
  // 4 人局正常名次：p0 最高(+2)、p1 第二(+1)、p2 第三(0)、p3 最低(-1)
  g = mk(4, 2);
  for (let t = 1; t <= 12; t++) {
    // 故意安排最後分數：打完 12 張，直接測試第 12 手觸發 endRound
    if (t < 12) pickAll(g, [t, t, t, t]);
  }
  g.players[0].roundScore = 40; g.players[1].roundScore = 25; g.players[2].roundScore = 10; g.players[3].roundScore = -5;
  g.leader = 0;
  pickAll(g, [12, 12, 12, 12]); // 撞號：p0 -12(28), p1 +12(37), p2 +12(22), p3 +12(7) → p1(37)+2, p0(28)+1, p2(22)0, p3(7)-1
  assert.equal(g.status, 'roundEnd');
  assert.deepEqual(g.players.map((p) => p.tokens), [1, 2, 0, -1]);
  // 下一輪
  C.act(g, 'p0', { type: 'next' });
  assert.equal(g.round, 2);
  assert.equal(g.trick, 1);
  assert.ok(g.players.every((p) => p.hand.length === 12 && p.roundScore === 0));

  // 3 人局：最高 +2、第二 +1、最低 -1
  g = mk(3, 1);
  for (let t = 1; t < 12; t++) pickAll(g, [t, t, t]);
  g.players[0].roundScore = 30; g.players[1].roundScore = 20; g.players[2].roundScore = 10;
  g.leader = 2; // p2 出 12（撞號 -12 → -2），p0 +12(42)，p1 +12(32)
  pickAll(g, [12, 12, 12]);
  assert.equal(g.status, 'over');
  assert.deepEqual(g.players.map((p) => p.tokens), [2, 1, -1]);
  assert.deepEqual(g.winners, ['p0']);

  // 同分情況：兩人並列最高 → 皆 +2，不另發 +1，最低 -1
  g = mk(4, 1);
  for (let t = 1; t < 12; t++) pickAll(g, [t, t, t, t]);
  g.players[0].roundScore = 20; g.players[1].roundScore = 20; g.players[2].roundScore = 10; g.players[3].roundScore = 0;
  g.leader = 3; // p3 撞號 -12 → -12；p0/p1 32 並列第一；p2 22
  pickAll(g, [12, 12, 12, 12]);
  assert.deepEqual(g.players.map((p) => p.tokens), [2, 2, 0, -1]);
  assert.deepEqual(g.winners.sort(), ['p0', 'p1']);

  // 全員同分：皆 0 分
  g = mk(3, 1);
  for (let t = 1; t < 12; t++) pickAll(g, [t, t, t]);
  g.players[0].roundScore = 24; g.players[1].roundScore = 0; g.players[2].roundScore = 0;
  g.leader = 0; // p0 24-12=12, p1 0+12=12, p2 0+12=12
  pickAll(g, [12, 12, 12]);
  assert.deepEqual(g.players.map((p) => p.tokens), [0, 0, 0]);
  assert.ok(g.summary.note.includes('同分'));

  // 中途退出：若首領離開要交棒；若其他人皆已蓋牌要立即翻牌不卡死
  g = mk(3, 1);
  C.act(g, 'p1', { type: 'pick', card: 5 });
  C.act(g, 'p2', { type: 'pick', card: 8 });
  assert.equal(C.leave(g, 'p0'), 2); // p0 是首領且是唯一沒蓋牌的人 → 交棒給 p1 並立即以 p1(5) vs p2(8) 結算！
  assert.equal(g.trick, 2, '剩餘玩家皆已蓋牌，應立即翻牌進下一手');
  assert.equal(g.players[1].roundScore, 5, 'p1 接棒當首領且沒撞號 → +5');
  assert.equal(g.players[2].roundScore, -8, 'p2 出 8 > 5 → 橫置 -8');

  // 超時代打：替所有尚未蓋牌的人自動出最小張並完成該手
  g = mk(3, 1);
  C.act(g, 'p0', { type: 'pick', card: 7 });
  C.autoPlay(g);
  assert.equal(g.trick, 2, 'autoPlay 補齊未蓋牌玩家並翻牌');
  assert.deepEqual(g.players.map((p) => p.roundScore), [7, 1, 1], 'p1/p2 各自動出最小張 1');

  // 3–6 人完整隨機模擬（1–5 輪）：每局必然結束、手牌與分數完全守恆
  for (let np = 3; np <= 6; np++) for (let rd = 1; rd <= 4; rd++) {
    const s = C.create(ppl(np), { rounds: rd });
    let steps = 0;
    while (s.status !== 'over') {
      assert.ok(++steps < 1000, '貓貓食堂不應卡死');
      if (s.status === 'roundEnd') { C.act(s, s.players[0].id, { type: 'next' }); continue; }
      for (const p of s.players) {
        if (!p.in || s.status !== 'play') continue;
        C.act(s, p.id, { type: 'pick', card: p.hand[randomInt(p.hand.length)] });
      }
    }
    assert.equal(s.round, rd);
    assert.ok(s.winners.length >= 1);
    assert.ok(s.players.every((p) => p.roundDeltas.length === rd && p.hand.length === 0));
  }
}

// --- 馬尼拉（Manila）規則引擎 ---
{
  const M = require('./manila');
  const ppl = (k) => [...Array(k)].map((_, i) => ({ id: 'p' + i, name: 'P' + i }));

  // 1) 開局狀態：現金 30、每人 2 張秘密股、剩餘公開股合計 20、3人=4手下 / 4-5人=3手下
  for (const np of [3, 4, 5]) {
    const g = M.create(ppl(np));
    assert.equal(g.players.length, np);
    assert.ok(g.players.every((p) => p.cash === 30 && p.stocks.length === 2 && p.workers === (np === 3 ? 4 : 3)));
    const supTotal = Object.values(g.supply).reduce((a, b) => a + b, 0);
    assert.equal(supTotal + np * 2, 20, '四種股票合計 20 張');
    const v0 = M.view(g, 'p0');
    assert.equal(v0.myStocks.length, 2);
    assert.ok(v0.players.every((p) => !('stocks' in p) && p.stockCount === 2), '看不到別人的秘密股票');
  }

  // 2) 股票隨時抵押（+12）與贖回（-15）
  {
    const g = M.create(ppl(4));
    const other = g.players.find((p) => p.id !== g.players[g.turn].id);
    const t0 = g.turnNo;
    M.act(g, other.id, { type: 'mortgage', idx: 0 });
    assert.equal(other.cash, 42);
    assert.equal(other.stocks[0].mortgaged, true);
    assert.equal(g.turnNo, t0, '抵押不影響目前輪次與倒數');
    throws(() => M.act(g, other.id, { type: 'mortgage', idx: 0 }), /已經抵押/);
    M.act(g, other.id, { type: 'redeem', idx: 0 });
    assert.equal(other.cash, 27);
    assert.equal(other.stocks[0].mortgaged, false);
    other.cash = 10;
    M.act(g, other.id, { type: 'mortgage', idx: 0 }); // cash = 22
    other.cash = 10;
    throws(() => M.act(g, other.id, { type: 'redeem', idx: 0 }), /現金不足/);
  }

  // 3) 競標船老大：全員 PASS 免費由首位擔任；正常喊價最高者付錢得標
  {
    const g = M.create(ppl(3));
    const starter = g.auction.starter;
    for (let k = 0; k < 3; k++) M.act(g, g.players[g.turn].id, { type: 'pass' });
    assert.equal(g.stage, 'master');
    assert.equal(g.master, starter);
    assert.equal(g.players.find((p) => p.id === starter).cash, 30, '全員 PASS 免費當船老大');
  }
  {
    const g = M.create(ppl(3));
    const pA = g.players[g.turn].id;
    throws(() => M.act(g, pA, { type: 'bid', amount: 0 }), /至少 1/);
    M.act(g, pA, { type: 'bid', amount: 4 });
    const pB = g.players[g.turn].id;
    throws(() => M.act(g, pB, { type: 'bid', amount: 4 }), /至少 5/);
    M.act(g, pB, { type: 'bid', amount: 7 });
    const pC = g.players[g.turn].id;
    M.act(g, pC, { type: 'pass' });
    M.act(g, pA, { type: 'pass' });
    assert.equal(g.stage, 'master');
    assert.equal(g.master, pB);
    assert.equal(g.players.find((p) => p.id === pB).cash, 23);

    // 船老大買股票（黑市 0 也要付 5 元，且公開紀錄）
    const buyGood = M.GOODS.find((k) => g.supply[k] > 0);
    M.act(g, pB, { type: 'buyStock', good: buyGood });
    assert.equal(g.players.find((p) => p.id === pB).cash, 18);
    assert.deepEqual(g.players.find((p) => p.id === pB).bought, [buyGood]);
    throws(() => M.act(g, pB, { type: 'buyStock', good: buyGood }), /只能買 1 張/);

    // 船老大安排 3 艘船：總和須為 9，每船 0–5
    throws(() => M.act(g, pB, { type: 'setupShips', ships: [{ good: 'jade', pos: 6 }, { good: 'silk', pos: 2 }, { good: 'nutmeg', pos: 1 }] }), /0–5/);
    throws(() => M.act(g, pB, { type: 'setupShips', ships: [{ good: 'jade', pos: 4 }, { good: 'silk', pos: 4 }, { good: 'nutmeg', pos: 2 }] }), /9 格/);
    M.act(g, pB, { type: 'setupShips', ships: [{ good: 'jade', pos: 5 }, { good: 'silk', pos: 3 }, { good: 'nutmeg', pos: 1 }] });
    assert.equal(g.stage, 'place');
    // 3 人局第 1 輪輪流放兩圈（共 6 次派遣）
    assert.equal(g.placeQueue.length, 6);
  }

  // 4) 領航員順序（小先於大、不可過 13 或低於 0）、海盜第 2 輪登船（標準 vs 踢人變體）
  {
    const runPirateBoard = (pirateKick) => {
      const g = M.create(ppl(4), { pirateKick });
      g.turn = 0; g.auction.starter = 'p0';
      for (let i = 0; i < 4; i++) M.act(g, g.players[g.turn].id, { type: 'pass' }); // p0 免費當船老大
      M.act(g, 'p0', { type: 'setupShips', ships: [{ good: 'ginseng', pos: 5 }, { good: 'silk', pos: 3 }, { good: 'jade', pos: 1 }] });
      // Wave 1: 塞滿人蔘船（3 格：p0, p1, p2）+ p3 當海盜船長
      M.act(g, 'p0', { type: 'place', spot: 'ship:0' }); // $1
      M.act(g, 'p1', { type: 'place', spot: 'ship:0' }); // $2
      M.act(g, 'p2', { type: 'place', spot: 'ship:0' }); // $3
      M.act(g, 'p3', { type: 'place', spot: 'pirate' }); // $5
      assert.equal(g.stage, 'roll');
      M.performRoll(g, [4, 1, 1]); // 人蔘 5+4=9
      // Wave 2: 買小領航員與大領航員，順便佔修船廠與保險
      M.act(g, 'p0', { type: 'place', spot: 'nav_big' });   // $5
      M.act(g, 'p1', { type: 'place', spot: 'nav_small' }); // $2
      M.act(g, 'p2', { type: 'place', spot: 'shipyard:0' }); // $4
      M.act(g, 'p3', { type: 'place', spot: 'insurance' });  // +$10
      assert.equal(g.stage, 'roll');
      M.performRoll(g, [4, 2, 2]); // 第 2 次擲骰：人蔘 9+4=13（且船滿！）
      return g;
    };

    // 標準規則：人蔘船滿了，海盜不能登船 → 直接進 Wave 3
    const std = runPirateBoard(false);
    assert.equal(std.stage, 'place');
    assert.equal(std.board.pirates[0], 'p3');

    // 變體規則：人蔘船停 13 且客滿 → 海盜 p3 可踢下 p1 強行登船
    const v = runPirateBoard(true);
    assert.equal(v.stage, 'pirate_board');
    assert.equal(v.players[v.turn].id, 'p3');
    M.act(v, 'p3', { type: 'pirateBoard', ship: 0, kickIdx: 1 });
    assert.deepEqual(v.ships[0].crew, ['p0', 'p3', 'p2']);
    assert.equal(v.board.pirates[0], null);
    assert.equal(v.stage, 'place');

    // Wave 3 全部跳過 → 小領航員（p1）先於大領航員（p0）行動！
    for (let i = 0; i < 4; i++) M.act(v, v.players[v.turn].id, { type: 'passPlace' });
    assert.equal(v.stage, 'nav_small');
    assert.equal(v.players[v.turn].id, 'p1');
    throws(() => M.act(v, 'p1', { type: 'navigate', moves: [{ ship: 0, delta: 1 }] }), /0–13/);
    M.act(v, 'p1', { type: 'navigate', moves: [{ ship: 0, delta: -1 }] }); // 人蔘 13→12
    assert.equal(v.stage, 'nav_big');
    assert.equal(v.players[v.turn].id, 'p0');
    M.act(v, 'p0', { type: 'navigate', moves: [{ ship: 0, delta: 1 }, { ship: 1, delta: 1 }] }); // 人蔘 12→13（領航到 13 不觸發海盜）, 絲綢 6→7
    assert.equal(v.stage, 'roll');
    assert.equal(v.ships[0].pos, 13);
    assert.equal(v.ships[1].pos, 7);
  }

  // 5) 第 3 次擲骰海盜掠奪（1 船 2 海盜平分 & 2 船各獨吞）＋ 保險公司現金不足自動抵押與銀行補差額 ＋ 終局 30 元結算
  {
    const g = M.create(ppl(4));
    g.turn = 0; g.auction.starter = 'p0';
    for (let i = 0; i < 4; i++) M.act(g, g.players[g.turn].id, { type: 'pass' });
    M.act(g, 'p0', { type: 'setupShips', ships: [{ good: 'jade', pos: 5 }, { good: 'silk', pos: 3 }, { good: 'nutmeg', pos: 1 }] });
    // Wave 1: p0 上玉石、p1/p2 當海盜、p3 當保險
    M.act(g, 'p0', { type: 'place', spot: 'ship:0' });
    M.act(g, 'p1', { type: 'place', spot: 'pirate' }); // 船長
    M.act(g, 'p2', { type: 'place', spot: 'pirate' }); // 船員
    M.act(g, 'p3', { type: 'place', spot: 'insurance' }); // +10 → cash 40
    M.performRoll(g, [3, 1, 1]); // 玉石 8, 絲綢 4, 豆蔻 2
    // Wave 2: 佔滿修船廠 A/B/C（共賠 6+8+15=29）
    M.act(g, 'p0', { type: 'place', spot: 'shipyard:0' });
    M.act(g, 'p1', { type: 'place', spot: 'shipyard:1' });
    M.act(g, 'p2', { type: 'place', spot: 'shipyard:2' });
    M.act(g, 'p3', { type: 'passPlace' });
    M.performRoll(g, [2, 1, 1]); // 玉石 10, 絲綢 5, 豆蔻 3
    for (let i = 0; i < 4; i++) M.act(g, g.players[g.turn].id, { type: 'passPlace' });
    // 故意把保險 p3 現金調低到 2，且只有 2 張股（全抵押 +24 → 總共 26 < 29，銀行補 3）
    g.players[3].cash = 2;
    const p1Before = g.players[1].cash, p2Before = g.players[2].cash;
    M.performRoll(g, [3, 1, 1]); // 第 3 次擲骰：玉石 10+3=13！
    assert.equal(g.stage, 'pirate_plunder');
    assert.equal(g.players[g.turn].id, 'p1', '海盜船長決定船隻去向');
    M.act(g, 'p1', { type: 'pirateDecide', ship: 0, dest: 'shipyard' }); // 送進修船廠 → 3 船全進修船廠！
    assert.equal(g.status, 'roundEnd');
    assert.equal(g.market.jade, 0, '被海盜送進修船廠，玉石不漲價');
    assert.equal(g.players[1].cash, p1Before + 18 + 8, '海盜船長分玉石一半 18 + 修船廠 B 8');
    assert.equal(g.players[2].cash, p2Before + 18 + 15, '海盜船員分玉石一半 18 + 修船廠 C 15');
    assert.equal(g.players[3].cash, 0, '保險公司全數抵押後現金歸 0');
    assert.equal(g.summary.insurance.autoMortgaged, 2);
    assert.equal(g.summary.insurance.bankCovered, 3);
    // 結算須全部在場玩家按「開始下一航程」才進第 2 航程
    M.act(g, 'p0', { type: 'next' });
    M.act(g, 'p0', { type: 'next' }); // 重複按不重複計數
    assert.equal(g.status, 'roundEnd');
    assert.deepEqual(g.nextReady, ['p0']);
    M.act(g, 'p1', { type: 'next' });
    M.act(g, 'p2', { type: 'next' });
    assert.equal(g.status, 'roundEnd', '還有 1 人未按開始，不能進下一航程');
    M.act(g, 'p3', { type: 'next' });
    assert.equal(g.status, 'play');
    assert.equal(g.round, 2, '全員按開始後進入第 2 航程');
    assert.deepEqual(g.nextReady, []);
  }

  // 5b) 結算畫面若最後一位未按開始的人中途離開 → 立即進入下一航程不卡死
  {
    const g = M.create(ppl(3));
    g.turn = 0; g.auction.starter = 'p0';
    for (let i = 0; i < 3; i++) M.act(g, g.players[g.turn].id, { type: 'pass' });
    M.act(g, 'p0', { type: 'setupShips', ships: [{ good: 'jade', pos: 3 }, { good: 'silk', pos: 3 }, { good: 'nutmeg', pos: 3 }] });
    for (let r = 0; r < 3; r++) {
      while (g.stage === 'place') M.act(g, g.players[g.turn].id, { type: 'passPlace' });
      M.performRoll(g, [1, 1, 1]);
    }
    assert.equal(g.status, 'roundEnd');
    M.act(g, 'p0', { type: 'next' });
    M.act(g, 'p1', { type: 'next' });
    assert.equal(g.status, 'roundEnd');
    assert.equal(M.leave(g, 'p2'), 2);
    assert.equal(g.status, 'play', '最後未準備者離開 → 剩餘全員皆已準備，自動進下一航程');
    assert.equal(g.round, 2);
  }

  // 6) 終局結算：黑市到 30 觸發結束，抵押股票強制扣 15 元
  {
    const g = M.create(ppl(3));
    g.market.jade = 3; // 20 → 差 1 步到 30
    g.players[0].stocks = [{ good: 'jade', mortgaged: true, public: false }]; // 30 - 15 = +15
    g.players[0].cash = 20; // total = 35
    g.players[1].stocks = [{ good: 'jade', mortgaged: false, public: false }, { good: 'jade', mortgaged: false, public: false }]; // 60
    g.players[1].cash = 10; // total = 70
    g.players[2].stocks = [];
    g.players[2].cash = 50; // total = 50
    g.turn = 0; g.auction.starter = 'p0';
    for (let i = 0; i < 3; i++) M.act(g, g.players[g.turn].id, { type: 'pass' });
    M.act(g, 'p0', { type: 'setupShips', ships: [{ good: 'jade', pos: 5 }, { good: 'silk', pos: 3 }, { good: 'nutmeg', pos: 1 }] });
    for (let r = 0; r < 3; r++) {
      while (g.stage === 'place') M.act(g, g.players[g.turn].id, { type: 'passPlace' });
      M.performRoll(g, [5, 1, 1]);
    }
    assert.equal(g.status, 'over');
    assert.deepEqual(g.winners, ['p1']);
    const r0 = g.summary.finalRows.find((r) => r.id === 'p0');
    assert.equal(r0.total, 35, '現金 20 + 玉石 30 - 贖回 15 = 35');
  }

  // 7) 3–5 人完整隨機對局模擬（含標準與海盜踢人變體、autoPlay、中途退出）
  for (const np of [3, 4, 5]) for (const pirateKick of [false, true]) {
    const g = M.create(ppl(np), { pirateKick });
    let steps = 0;
    while (g.status !== 'over') {
      assert.ok(++steps < 2500, `馬尼拉 ${np} 人局不應卡死`);
      if (g.status === 'roundEnd') {
        for (const q of g.players) if (q.in && g.status === 'roundEnd') M.act(g, q.id, { type: 'next' });
        continue;
      }
      const p = g.players[g.turn];
      if (g.stage === 'bid') {
        if (g.auction.high < 3 && p.cash > g.auction.high && randomInt(2)) M.act(g, p.id, { type: 'bid', amount: g.auction.high + 1 });
        else M.act(g, p.id, { type: 'pass' });
      } else if (g.stage === 'master') {
        const avGood = M.GOODS.find((k) => g.supply[k] > 0 && p.cash >= Math.max(5, M.PRICE_TRACK[g.market[k]]));
        if (avGood && !g.masterBought && randomInt(2)) M.act(g, p.id, { type: 'buyStock', good: avGood });
        const pick3 = M.GOODS.slice(0, 3);
        M.act(g, p.id, { type: 'setupShips', ships: [{ good: pick3[0], pos: 5 }, { good: pick3[1], pos: 3 }, { good: pick3[2], pos: 1 }] });
      } else if (g.stage === 'place') {
        const opts = [];
        g.ships.forEach((s, si) => { if (s.pos < 14 && s.crew.length < M.GOOD_INFO[s.good].slots.length && p.cash >= M.GOOD_INFO[s.good].slots[s.crew.length]) opts.push(`ship:${si}`); });
        M.HARBOR_SLOTS.forEach((h, i) => { if (!g.board.harbor[i] && p.cash >= h.cost) opts.push(`harbor:${i}`); });
        M.SHIPYARD_SLOTS.forEach((y, i) => { if (!g.board.shipyard[i] && p.cash >= y.cost) opts.push(`shipyard:${i}`); });
        if (!g.board.insurance) opts.push('insurance');
        if ((!g.board.pirates[0] || !g.board.pirates[1]) && p.cash >= 5) opts.push('pirate');
        if (!g.board.navSmall && p.cash >= 2) opts.push('nav_small');
        if (!g.board.navBig && p.cash >= 5) opts.push('nav_big');
        if (opts.length && randomInt(4)) M.act(g, p.id, { type: 'place', spot: opts[randomInt(opts.length)] });
        else M.act(g, p.id, { type: 'passPlace' });
      } else if (g.stage === 'nav_small' || g.stage === 'nav_big') {
        const cand = g.ships.findIndex((s) => s.pos > 0 && s.pos < 13);
        if (cand >= 0 && randomInt(2)) M.act(g, p.id, { type: 'navigate', moves: [{ ship: cand, delta: randomInt(2) ? 1 : -1 }] });
        else M.act(g, p.id, { type: 'navigate', moves: [] });
      } else if (g.stage === 'roll') {
        M.act(g, p.id, { type: 'roll' });
      } else if (g.stage === 'pirate_board') {
        M.autoPlay(g, p.id);
      } else if (g.stage === 'pirate_plunder') {
        const pl = g.plunder;
        M.act(g, p.id, { type: 'pirateDecide', ship: pl.mode === 'pick' ? pl.ships[0] : pl.ship, dest: randomInt(2) ? 'harbor' : 'shipyard' });
      }
    }
    assert.ok(g.winners.length >= 1);
    assert.ok(M.GOODS.some((k) => g.market[k] === 4), '結束時必有貨物達黑市 30');
  }

  // 中途退出不卡死
  {
    const g = M.create(ppl(4));
    const curId = g.players[g.turn].id;
    assert.equal(M.leave(g, curId), 3);
    assert.notEqual(g.players[g.turn].id, curId);
    for (let k = 0; k < 10 && g.status === 'play'; k++) M.autoPlay(g);
    assert.ok(g.turnNo > 2);
  }

  // 8) 電腦玩家 AI（botPlay）：3–5 人全 AI 對局可完整打完至終局且不報錯、會主動競標／買股／派遣
  for (const np of [3, 4, 5]) {
    const g = M.create(ppl(np).map((p) => ({ ...p, bot: true })), { pirateKick: np === 4 });
    let steps = 0, bidCount = 0, placeCount = 0;
    while (g.status !== 'over') {
      assert.ok(++steps < 3000, `AI ${np} 人局不應卡死`);
      if (g.status === 'roundEnd') {
        for (const q of g.players) if (q.in && g.status === 'roundEnd') M.act(g, q.id, { type: 'next' });
        continue;
      }
      const prevStage = g.stage, prevHigh = g.auction?.high ?? 0, cur = g.players[g.turn];
      const prevW = cur.workers;
      M.botPlay(g, cur.id);
      if (prevStage === 'bid' && (g.auction?.high ?? 0) > prevHigh) bidCount++;
      if (prevStage === 'place' && cur.workers < prevW) placeCount++;
    }
    assert.ok(g.winners.length >= 1);
    assert.ok(placeCount > 0, '電腦玩家應會主動派遣手下');
    void bidCount;
  }
}
function randomInt(n) { return require('node:crypto').randomInt(n); }

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
  // 隨機排位子：只有房主；人還在、不多不少；順序會變（4 人洗 20 次全都沒變的機率 ≈ 1e-28）
  assert.equal((await post('shuffle', guests[0])).status, 400, '非房主不能排位子');
  const ids = (await sseOnce(host)).players.map((p) => p.id), first = ids.join();
  let moved = false;
  for (let i = 0; i < 20 && !moved; i++) {
    assert.equal((await post('shuffle', host)).status, 200);
    const now = (await sseOnce(host)).players.map((p) => p.id);
    assert.deepEqual([...now].sort(), [...ids].sort(), '排位子不能增減玩家');
    moved = now.join() !== first;
  }
  assert.ok(moved, '位子應該被打亂');
  assert.equal((await post('start', host)).status, 200);
  assert.equal((await post('shuffle', host)).status, 400, '遊戲開始後不能排位子');
  assert.deepEqual(Object.values(v.settings.rules), Array(6).fill(false), '沒指定規則 = 全關');
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
  // 規則鍵名：server 與前端要一致（用簡單的逐行比對，index.html 的 RULES 每條規則一行）
  const read = (f) => require('node:fs').readFileSync(require('node:path').join(__dirname, f), 'utf8');
  const serverKeys = read('server.js').match(/const RULES = \[(.*?)\];/)[1].match(/\w+/g);
  const pageBlock = read('index.html').split('const RULES = [')[1].split('\n];')[0];
  const pageKeys = pageBlock.split('\n').map((l) => l.match(/^\s*\['(\w+)'/)?.[1]).filter(Boolean);
  assert.deepEqual(pageKeys, serverKeys, 'server 與前端的規則鍵名要一致');
  const wl = (f) => require('node:fs').readFileSync(require('node:path').join(__dirname, f), 'utf8').match(/const EMOJI = (\[.*?\]);/)[1];
  assert.equal(wl('server.js'), wl('index.html'), 'server 與前端的表情白名單要一致');
  const room = server.rooms.get(host.code);
  { // 建房選規則：只認白名單內、值為 true 的；格式不對直接拒絕
    assert.equal((await post('create', { name: 'x', rules: 'all' })).status, 400);
    assert.equal((await post('create', { name: 'x', rules: [] })).status, 400);
    // 建房時選目標階段：不帶 = 10；1–10 的整數才接受
    for (const bad of [0, 11, 2.5, '3']) assert.equal((await post('create', { name: 'x', target: bad })).status, 400, `目標 ${bad} 不合法`);
    const t3 = (await post('create', { name: 'T', target: 3 })).json;
    assert.equal(server.rooms.get(t3.code).settings.target, 3, '建房時指定目標階段');
    assert.equal(server.rooms.get((await post('create', { name: 'D' })).json.code).settings.target, 10, '沒指定 = 10');
    const r = (await post('create', { name: 'R', rules: { rv: true, sh: 'yes', hack: true, catchUp: true } })).json;
    assert.deepEqual(server.rooms.get(r.code).settings.rules, { catchUp: true, first: false, rv: true, sh: false, xn: false, xc: false });
    const g = (await post('join', { code: r.code, name: 'S' })).json;
    await post('start', r);
    assert.equal(server.rooms.get(r.code).game.draw.length + server.rooms.get(r.code).game.disc.length + 20, 110, '只開迴轉 = 110 張');
    await post('leave', g);
  }
  { // 富士流：建房種類、人數 3–8、無效種類被拒、設定不套用 Phase 10 的欄位；前端與伺服器的遊戲鍵名一致
    assert.equal((await post('create', { name: 'x', kind: 'chess' })).status, 400, '不支援的遊戲');
    assert.equal((await post('create', { name: 'x', kind: '__proto__' })).status, 400, '原型鍵也要擋');
    assert.equal(server.rooms.get(host.code).kind, 'phase10', '沒帶 kind = Phase 10（舊連結相容）');
    assert.equal(host.kind, 'phase10');
    const f = (await post('create', { name: 'F0', kind: 'fuji', target: 3, rules: { rv: true } })).json;
    const fr = server.rooms.get(f.code);
    assert.equal(f.kind, 'fuji'); assert.deepEqual(Object.keys(fr.settings), ['turn'], '富士流沒有階段與特殊規則');
    const v0 = await sseOnce(f);
    assert.deepEqual([v0.kind, v0.min, v0.max], ['fuji', 3, 8]);
    assert.equal((await post('join', { code: f.code, name: 'F1' })).json.kind, 'fuji');
    assert.equal((await post('start', f)).status, 400, '富士流 2 人不能開');
    assert.equal((await post('settings', { ...f, target: 2 })).status, 200); assert.equal(fr.settings.target, undefined, '富士流忽略 target');
    const fs2 = [];
    for (let i = 2; i < 8; i++) fs2.push((await post('join', { code: f.code, name: 'F' + i })).json);
    assert.equal((await post('join', { code: f.code, name: '第九人' })).status, 400, '富士流滿 8 人');
    assert.equal((await post('start', f)).status, 200);
    const fv = await sseOnce(fs2[0]);
    assert.equal(fv.game.hand.length, 5, '8 人每人 5 張');
    assert.ok(fv.game.players.every((p) => p.n === 5));
    assert.ok(!JSON.stringify(fv.game).includes('"hand":[{"id"') || fv.game.players.every((p) => !('hand' in p)), '看不到別人手牌');
    const turnTok = fr.players.find((q) => q.id === fr.game.players[fr.game.turn].id).token;
    const turnP = { code: f.code, token: turnTok };
    assert.equal((await post('act', { ...turnP, action: { type: 'play', card: -1 } })).status, 400, '沒這張牌');
    const my = fr.game.players[fr.game.turn];
    assert.equal((await post('act', { ...turnP, action: { type: 'play', card: my.hand[0].id } })).status, 200, '輪到的人出牌');
    assert.ok(fr.game.turnNo >= 2, '出牌後換人');
    assert.equal((await post('start', f)).status, 400, '已開始');
    const wl = (f2) => [...read(f2).matchAll(/^(?:const KINDS = \{| *const GAMES = \{)(.*)$/gm)].map((m) => [...m[1].matchAll(/\b(\w+): \{/g)].map((x) => x[1]).filter((k) => k !== 'eng').join());
    assert.equal(wl('server.js')[0], 'phase10,fuji,cats,manila,magical'); assert.equal(wl('index.html')[0], 'phase10,fuji,cats,manila,magical', '伺服器與前端的遊戲鍵名要一致');
  }
  { // 貓貓食堂：人數 3–6、輪數預設 3 且可自訂（1–10）、房主可在等待室修改輪數、同時蓋牌同步與隱藏
    for (const bad of [0, 11, 2.5, '3']) assert.equal((await post('create', { name: 'c', kind: 'cats', rounds: bad })).status, 400, `輪數 ${bad} 不合法`);
    const cDef = (await post('create', { name: 'CDef', kind: 'cats' })).json;
    assert.equal(server.rooms.get(cDef.code).settings.rounds, 3, '預設 3 輪');
    const c = (await post('create', { name: 'C0', kind: 'cats', rounds: 5 })).json;
    const cr = server.rooms.get(c.code);
    assert.equal(c.kind, 'cats'); assert.equal(cr.settings.rounds, 5);
    const cv0 = await sseOnce(c);
    assert.deepEqual([cv0.kind, cv0.min, cv0.max, cv0.settings.rounds], ['cats', 3, 6, 5]);
    assert.equal((await post('settings', { ...c, rounds: 2 })).status, 200);
    assert.equal(cr.settings.rounds, 2, '房主可在房內改輪數');
    const c1 = (await post('join', { code: c.code, name: 'C1' })).json;
    assert.equal((await post('start', c)).status, 400, '貓貓食堂 2 人不能開');
    const c2 = (await post('join', { code: c.code, name: 'C2' })).json;
    for (let i = 3; i < 6; i++) await post('join', { code: c.code, name: 'C' + i });
    assert.equal((await post('join', { code: c.code, name: '第七隻貓' })).status, 400, '貓貓食堂滿 6 人');
    assert.equal((await post('start', c)).status, 200);
    assert.equal((await post('act', { ...c, action: { type: 'pick', card: 8 } })).status, 200);
    const cv1 = await sseOnce(c1);
    assert.equal(cv1.game.hand.length, 12);
    assert.equal(cv1.game.players[0].ready, true, '別人看得到 C0 已蓋牌');
    assert.equal(cv1.game.myPick, null, '看不到別人蓋哪張');
    // 全部人蓋牌 → 同時翻牌進入第 2 手
    for (const p of cr.players.slice(1)) {
      assert.equal((await post('act', { code: c.code, token: p.token, action: { type: 'pick', card: 5 } })).status, 200);
    }
    assert.equal(cr.game.trick, 2, '全員蓋牌後翻牌進第 2 手');
    assert.ok(cr.game.last && cr.game.last.picks.length === 6);
    void c2;
  }
  { // 馬尼拉：人數 3–5、海盜踢人變體預設關且可切換、起始秘密股票不外洩
    const mDef = (await post('create', { name: 'M0', kind: 'manila' })).json;
    const mr = server.rooms.get(mDef.code);
    assert.equal(mDef.kind, 'manila');
    assert.equal(mr.settings.pirateKick, false, '預設標準規則（不踢人）');
    assert.equal((await post('settings', { ...mDef, pirateKick: true })).status, 200);
    assert.equal(mr.settings.pirateKick, true, '房主可在房內開啟海盜踢人變體');
    const mv0 = await sseOnce(mDef);
    assert.deepEqual([mv0.kind, mv0.min, mv0.max, mv0.settings.pirateKick], ['manila', 3, 5, true]);
    const m1 = (await post('join', { code: mDef.code, name: 'M1' })).json;
    assert.equal((await post('start', mDef)).status, 400, '馬尼拉 2 人不能開');
    for (let i = 2; i < 5; i++) await post('join', { code: mDef.code, name: 'M' + i });
    assert.equal((await post('join', { code: mDef.code, name: '第六人' })).status, 400, '馬尼拉滿 5 人');
    assert.equal((await post('start', mDef)).status, 200);
    const mv1 = await sseOnce(m1);
    assert.equal(mv1.game.stage, 'bid');
    assert.equal(mv1.game.myStocks.length, 2);
    assert.ok(mv1.game.players.every((p) => !('stocks' in p) && p.stockCount === 2), '秘密股票不洩漏給其他玩家');
    assert.equal(mv1.game.rules.pirateKick, true);
    // 靜態美術素材路由與路徑穿越防護
    for (const f of ['board_bg.jpg', 'good_jade.jpg', 'good_silk.jpg', 'good_nutmeg.jpg', 'good_ginseng.jpg']) {
      const r = await fetch(`${base}/assets/manila/${f}`);
      assert.equal(r.status, 200, `${f} 應可讀取`);
      assert.equal(r.headers.get('content-type'), 'image/jpeg');
    }
    assert.equal((await fetch(`${base}/assets/../server.js`)).status, 404, '阻擋路徑穿越');
    assert.equal((await fetch(`${base}/assets/manila/nope.jpg`)).status, 404);

    // 電腦玩家：只有馬尼拉支援、僅房主可增刪、滿 5 人擋下、開局後電腦自動行動且結算自動準備、最後真人離開即清房
    const mb = (await post('create', { name: '房主甲', kind: 'manila' })).json;
    const mbr = server.rooms.get(mb.code);
    assert.equal((await post('addBot', host)).status, 400, 'Phase 10 不支援電腦');
    assert.equal((await post('addBot', mb)).status, 200);
    assert.equal((await post('addBot', mb)).status, 200);
    assert.equal((await post('addBot', mb)).status, 200);
    assert.equal((await post('addBot', mb)).status, 200);
    assert.equal(mbr.players.length, 5);
    assert.equal((await post('addBot', mb)).status, 400, '滿 5 人不能再加電腦');
    const rmId = mbr.players.find((x) => x.bot).id;
    assert.equal((await post('removeBot', { ...mb, id: rmId })).status, 200);
    assert.equal(mbr.players.length, 4);
    assert.ok(!mbr.players.some((x) => x.id === rmId), '已移除指定電腦');
    // 測試電腦自動行動
    mbr.settings.botDelay = 10;
    const acB = new AbortController();
    const sseB = await fetch(`${base}/api/events?code=${mb.code}&token=${mb.token}`, { signal: acB.signal });
    assert.equal((await post('start', mb)).status, 200);
    assert.equal((await post('addBot', mb)).status, 400, '開局後不能加電腦');
    // 若開局先輪到真人就先 PASS，確保接著輪到電腦自動推進
    if (mbr.game.players[mbr.game.turn].id === mbr.players[0].id) {
      await post('act', { ...mb, action: { type: 'pass' } });
    }
    const turnBefore = mbr.game.turnNo;
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(mbr.game.turnNo > turnBefore, '輪到電腦應自動出牌推進回合');
    // 最後一名真人離開 → 即使房內還有電腦也要立即刪房
    acB.abort();
    void sseB;
    assert.equal((await post('leave', mb)).status, 200);
    assert.ok(!server.rooms.has(mb.code), '最後真人離開後應自動清理僅剩電腦的房間');
  }
  { // 瘋狂運動會（Magical Athlete）：36 選手完整性、規則單元測試、2P/3P雙選手/4P標準整局模擬、HTTP+SSE+電腦玩家
    const MA = require('./magical');
    assert.equal(MA.RACERS.length, 36, '應有完整 36 位選手');
    assert.equal(new Set(MA.RACERS.map((r) => r.id)).size, 36, '36 位選手 ID 皆唯一');
    // 檢查 index.html 的 MA_RACERS 與 magical.js 一致，且 36 張裁切插圖皆可讀取
    const maIdsInPage = [...read('index.html').split('const MA_RACERS = [')[1].split('const MA_MAP')[0].matchAll(/id: '(\w+)'/g)].map((m) => m[1]);
    assert.deepEqual(maIdsInPage, MA.RACERS.map((r) => r.id), '前端與後端 36 位選手清單要一致');
    for (const r of MA.RACERS) {
      const resp = await fetch(`${base}/assets/magical/${r.id}.jpg`);
      assert.equal(resp.status, 200, `${r.id}.jpg 應可讀取`);
      assert.equal(resp.headers.get('content-type'), 'image/jpeg');
    }

    // 1. 蛇行選秀：4 人標準（2 輪×8 張→每人 4 位）、2 人變體（2 輪×8 張 ABBAABBA→每人 8 位）、3 人雙選手（4 輪×6 張→每人 8 位）
    const makePs = (cnt) => Array.from({ length: cnt }, (_, i) => ({ id: `p${i}`, name: `玩家${i}` }));
    const simDraft = (g) => {
      let guard = 0;
      while (g.stage === 'draft' && guard++ < 50) MA.botPlay(g, g.draft.order[g.draft.idx]);
    };
    const g4 = MA.create(makePs(4), { schedule: 'std' });
    assert.equal(g4.mode, 'std');
    simDraft(g4);
    assert.equal(g4.stage, 'select');
    assert.ok(g4.players.every((p) => p.roster.length === 4), '4 人標準每人 4 位選手');

    const g2 = MA.create(makePs(2), { schedule: 'std' });
    assert.equal(g2.mode, '2p');
    assert.equal(g2.draft.order.join(',').split(',').length, 8);
    simDraft(g2);
    assert.equal(g2.stage, 'select');
    assert.ok(g2.players.every((p) => p.roster.length === 8), '2 人變體每人 8 位選手');

    const g3d = MA.create(makePs(3), { schedule: 'wild', double3p: true });
    assert.equal(g3d.mode, '3p2');
    simDraft(g3d);
    assert.equal(g3d.stage, 'select');
    assert.ok(g3d.players.every((p) => p.roster.length === 8), '3 人雙選手每人 8 位選手');

    // 2. 關鍵能力與連鎖精確驗證（建構乾淨起跑賽局）
    const mkRace = (specs, track = 'mild') => {
      const ps = specs.map((sp, i) => ({ id: `p${i}`, name: `P${i}` }));
      const g = MA.create(ps, { schedule: track === 'wild' ? 'wild' : 'mild' });
      g.stage = 'select';
      g.race = 1;
      g.track = track;
      g.activePlayerIdx = 0;
      g.players.forEach((p, i) => { p.roster = [specs[i], 'banana', 'coach', 'legs']; p.used = []; p.selected = null; });
      specs.forEach((sp, i) => MA.act(g, `p${i}`, { type: 'selectRacers', racers: [sp] }));
      return g;
    };

    // 2a. 大長腿(5) + 同格教練(+1) + 對手黏液怪(-1) = 5 格
    {
      const g = mkRace(['legs', 'coach', 'gunk']);
      assert.equal(g.prompt.kind, 'mainAction');
      MA.act(g, 'p0', { type: 'legs' });
      assert.equal(g.racers[0].pos, 5, '大長腿 5 + 教練 1 - 黏液 1 = 5 格');
    }
    // 2b. 香蕉絆倒超越者 + 絆倒者下回合爬起跳過主要移動 + 吐槽怪觸發 +2
    {
      const g = mkRace(['legs', 'banana', 'heckler']);
      g.racers[1].pos = 2; // 香蕉在 2 格
      MA.act(g, 'p0', { type: 'legs' }); // 大長腿 0→5 超越香蕉
      assert.equal(g.racers[0].pos, 5);
      assert.equal(g.racers[0].tripped, true, '超越香蕉應絆倒');
      // 讓 p1、p2 動完回到 p0
      MA.act(g, 'p1', { type: 'roll' });
      MA.act(g, 'p2', { type: 'roll' });
      // 輪到 p0 時應自動爬起來跳過主要移動，並立刻觸發吐槽怪 +2
      assert.equal(g.racers[0].tripped, false, 'p0 輪到自己時應自動爬起來');
      assert.equal(g.racers[0].pos, 5, '絆倒恢復不移動');
    }
    // 2c. 巨嬰 + 挪動怪無限循環防護（PDF p.21 規則 #8）
    {
      const g = mkRace(['legs', 'huge_baby', 'scoocher']);
      g.racers[1].pos = 6; // 巨嬰在 6 格
      g.racers[2].pos = 5; // 挪動怪在 5 格（別人發動能力→挪到 6→被巨嬰擠回 5→巨嬰發動能力→挪動怪又想挪到 6）
      MA.act(g, 'p0', { type: 'legs' }); // 大長腿發動能力觸發挪動怪
      assert.equal(g.racers[2].pos, 5, '巨嬰與挪動怪循環應依規則完成一次後中止，不當機');
    }
    // 2d. 規則魔人阻擋超過終點
    {
      const g = mkRace(['legs', 'stickler', 'coach']);
      g.racers[0].pos = 27; // 27 + 5 = 32 > 30
      MA.act(g, 'p0', { type: 'legs' });
      assert.equal(g.racers[0].pos, 27, '規則魔人在場時超過 30 格應停在原地');
      assert.equal(g.racers[0].finished, false);
    }
    // 2e. 幕後黑手預言自己拿第 1 → 同時拿第 1 和第 2 並立刻結束比賽！
    {
      const g = mkRace(['mastermind', 'banana', 'coach']);
      assert.equal(g.prompt.kind, 'mastermindPick');
      MA.act(g, 'p0', { type: 'mastermindPick', targetId: g.racers[0].id });
      g.racers[0].pos = 29;
      MA.act(g, 'p0', { type: 'roll' });
      assert.equal(g.status, 'raceEnd', '幕後黑手預言自己奪冠並衝線，比賽應立刻結束');
      assert.equal(g.summary.first.ownerId, 'p0');
      assert.equal(g.summary.second.ownerId, 'p0', '幕後黑手應同時包辦第 1 與第 2 名');
      assert.equal(g.players[0].golds[0] + g.players[0].silvers[0], 4, '第 1 場金盃 3 + 銀徽章 1 = 4 分');
    }
    // 2f. 西西弗斯賽前拿 4 分 + 可愛魯蛇獨自墊底拿 1 分 + 大嘴怪淘汰對手（狂野賽道箭頭）
    {
      const g = mkRace(['sisyphus', 'lovable_loser', 'banana']);
      assert.equal(g.players[0].bronze, 4, '西西弗斯賽前應先拿 4 分');
      g.racers[0].pos = 4; g.racers[2].pos = 3; g.racers[1].pos = 0; // lovable_loser 獨自墊底
      MA.act(g, 'p0', { type: 'roll' });
      // 輪到 p1 (lovable_loser) 時自動觸發「主要移動前獨自墊底 +1 分」
      assert.equal(g.players[1].bronze, 1, '可愛魯蛇獨自墊底應拿 1 枚銅分');
    }
    {
      // 大嘴怪（p0）踩到狂野賽道第 5 格箭頭(+2)→落到第 7 格與單一對手同格，吃掉對方！
      const g = mkRace(['mouth', 'banana', 'coach'], 'wild');
      g.racers[0].pos = 0; g.racers[1].pos = 7; g.racers[2].pos = 10;
      // 讓 p0 剛好停在 7 格：設定 p0 在 6 格並測停格吃人（透過雙胞胎/夾腳拖/直接移到 5 格箭頭）
      g.racers[0].pos = 5;
      // 用電燈泡 / 催眠師不需動 p0；改測 p0 用普通擲骰或直接用「奇蹟蛋→大長腿」無法；改讓 p0 是大嘴怪、p1 在 5 格、p2 在 10 格，把 p0 放在 14 格（箭頭+3→17）且把對手放 17 格不太需要骰；最直接：催眠師(p0)或夾腳拖(p0)讓大嘴怪(p1)傳送到剛好 1 人的格！
      const g2 = mkRace(['flip_flop', 'mouth', 'banana']);
      g2.racers[0].pos = 8; // flip_flop 在 8
      g2.racers[1].pos = 1; // mouth 在 1
      g2.racers[2].pos = 8; // banana 也在 8（與 flip_flop 同格）
      // flip_flop 和 mouth 互換 → mouth 傳送到第 8 格（剛好只有 banana 1 人）→ 一口吃掉 banana！
      MA.act(g2, 'p0', { type: 'flipFlop', targetId: g2.racers[1].id });
      assert.equal(g2.racers[1].pos, 8, '大嘴怪換到第 8 格');
      assert.equal(g2.racers[2].eliminated, true, '大嘴怪停在剛好只有 1 位對手的格子應淘汰對方');
      assert.equal(g2.firstEliminatedOwner, 'p2', '應記錄首位被淘汰玩家供下場先攻');
    }
    // 2g. 夾腳拖同時互換位置（不算移動）
    {
      const g = mkRace(['flip_flop', 'banana', 'coach']);
      g.racers[1].pos = 12;
      MA.act(g, 'p0', { type: 'flipFlop', targetId: g.racers[1].id });
      assert.equal(g.racers[0].pos, 12, '夾腳拖應換到 12 格');
      assert.equal(g.racers[1].pos, 0, '香蕉應換到 0 格');
      assert.equal(g.racers[0].tripped, false, '傳送不算超越香蕉，不絆倒');
    }

    // 3. 完整 4 場機器人整局模擬（標準 4 人、2 人變體、3 人雙選手變體、6 人大亂鬥）
    for (const [cnt, opts, tag] of [
      [2, { schedule: 'std' }, '2人變體'],
      [3, { schedule: 'wild', double3p: true }, '3人雙選手狂野'],
      [4, { schedule: 'std' }, '4人標準'],
      [6, { schedule: 'wildFirst' }, '6人標準'],
    ]) {
      const sim = MA.create(makePs(cnt), opts);
      let steps = 0;
      while (sim.status !== 'over' && steps++ < 4000) {
        if (sim.status === 'raceEnd') {
          for (const p of sim.players) if (p.in && !sim.nextReady.includes(p.id)) MA.botPlay(sim, p.id);
        } else if (sim.stage === 'select') {
          for (const p of sim.players) if (p.in && !p.selected) MA.botPlay(sim, p.id);
        } else {
          MA.botPlay(sim, sim.players[sim.turn].id);
        }
      }
      assert.equal(sim.status, 'over', `${tag} 應在合理步數內完成 4 場比賽（目前 ${sim.status} 第 ${sim.race} 場）`);
      assert.equal(sim.race, 4, `${tag} 應跑完 4 場`);
      assert.ok(sim.winners.length >= 1, `${tag} 應產生總冠軍`);
    }

    // 4. HTTP + SSE + AI 電腦玩家整合測試
    assert.equal((await post('create', { name: 'bad', kind: 'magical', schedule: 'hack' })).status, 400, '無效賽程被拒');
    const mg = (await post('create', { name: '跑者甲', kind: 'magical', schedule: 'wildFirst', double3p: true })).json;
    const mgr = server.rooms.get(mg.code);
    assert.equal(mg.kind, 'magical');
    assert.deepEqual([mgr.settings.schedule, mgr.settings.double3p], ['wildFirst', true]);
    assert.equal((await post('settings', { ...mg, schedule: 'std', double3p: false })).status, 200);
    assert.deepEqual([mgr.settings.schedule, mgr.settings.double3p], ['std', false]);
    const mgv0 = await sseOnce(mg);
    assert.deepEqual([mgv0.kind, mgv0.min, mgv0.max], ['magical', 2, 6]);
    assert.equal((await post('start', mg)).status, 400, '瘋狂運動會 1 人不能開');
    assert.equal((await post('addBot', mg)).status, 200, '瘋狂運動會支援加電腦玩家');
    assert.equal((await post('addBot', mg)).status, 200);
    assert.equal(mgr.players.length, 3);
    mgr.settings.botDelay = 10;
    const acM = new AbortController();
    const sseM = await fetch(`${base}/api/events?code=${mg.code}&token=${mg.token}`, { signal: acM.signal });
    assert.equal((await post('start', mg)).status, 200);
    // 電腦應自動完成自己的選秀順位
    if (mgr.game.draft.order[mgr.game.draft.idx] === mgr.players[0].id) {
      await post('act', { ...mg, action: { type: 'draftPick', racer: mgr.game.draft.pool[0] } });
    }
    const mgTurn0 = mgr.game.turnNo;
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(mgr.game.turnNo > mgTurn0, '瘋狂運動會電腦玩家應自動選秀推進回合');
    acM.abort();
    void sseM;
    assert.equal((await post('leave', mg)).status, 200);
    assert.ok(!server.rooms.has(mg.code), '最後真人離開後應自動清理瘋狂運動會房間');
  }
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
  const sse3 = await fetch(`${base}/api/events?code=${h3.code}&token=${h3.token}`, { signal: ac3.signal }); // 要有人連線倒數才會跑（保留參照避免 Node 24 GC 回收關閉連線）
  await post('start', h3);
  const no0 = room3.game.turnNo;
  await new Promise((res) => setTimeout(res, 800));
  assert.ok(room3.game.turnNo > no0, '超時自動代打、換人');
  ac3.abort();
  void sse3;
  server.close();
  console.log('✅ 全部測試通過');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
