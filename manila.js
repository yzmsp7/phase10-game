'use strict';
// 馬尼拉（Manila）規則引擎（純邏輯，無 I/O）。介面與 game.js / fuji.js / cats.js 相同（create / act / leave / autoPlay / view）。
const { randomInt } = require('node:crypto');
const { err, shuffle } = require('./game');

const GOODS = ['jade', 'silk', 'nutmeg', 'ginseng'];
const GOOD_INFO = {
  jade: { name: '玉石', slots: [3, 4, 5, 5], payout: 36 },
  silk: { name: '絲綢', slots: [3, 4, 5], payout: 30 },
  nutmeg: { name: '豆蔻', slots: [2, 3, 4], payout: 24 },
  ginseng: { name: '人蔘', slots: [1, 2, 3], payout: 18 },
};
const PRICE_TRACK = [0, 5, 10, 20, 30];
const HARBOR_SLOTS = [
  { label: 'A', cost: 4, reward: 6, need: 1 },
  { label: 'B', cost: 3, reward: 8, need: 2 },
  { label: 'C', cost: 2, reward: 15, need: 3 },
];
const SHIPYARD_SLOTS = [
  { label: 'A', cost: 4, reward: 6, need: 1 },
  { label: 'B', cost: 3, reward: 8, need: 2 },
  { label: 'C', cost: 2, reward: 15, need: 3 },
];
const PIRATE_COST = 5;
const NAV_SMALL_COST = 2;
const NAV_BIG_COST = 5;
const INSURANCE_GAIN = 10;
const MORTGAGE_GAIN = 12;
const REDEEM_COST = 15;
const START_CASH = 30;
const SHARES_PER_GOOD = 5;
const MAX_POS = 13;
const HARBOR_POS = 14;

const log = (g, m) => { g.log.push(m); if (g.log.length > 60) g.log.shift(); };
const playerOf = (g, id) => g.players.find((p) => p.id === id);
const indexOf = (g, id) => g.players.findIndex((p) => p.id === id);
const nextIn = (g, i) => {
  const n = g.players.length;
  for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (g.players[j].in) return j; }
  return i;
};
const activeOrder = (g, startIdx) => {
  const out = [];
  const n = g.players.length;
  for (let k = 0; k < n; k++) {
    const p = g.players[(startIdx + k) % n];
    if (p.in) out.push(p.id);
  }
  return out;
};
const buyPrice = (g, good) => Math.max(5, PRICE_TRACK[g.market[good]]);
const pushEv = (g, ev) => {
  const item = { no: ++g.evNo, ...ev };
  g.ev = item;
  g.evFeed.push(item);
  if (g.evFeed.length > 10) g.evFeed.shift();
};

function create(players, { pirateKick = false } = {}) {
  const deck = shuffle(GOODS.flatMap((good) => Array(SHARES_PER_GOOD).fill(good)));
  const supply = Object.fromEntries(GOODS.map((k) => [k, 0]));
  const ps = players.map(({ id, name, bot }, color) => {
    const init = deck.splice(0, 2);
    return {
      id, name, bot: !!bot, color, cash: START_CASH, workers: 0, in: true, left: false,
      stocks: init.map((good) => ({ good, mortgaged: false, public: false })),
      bought: [],
    };
  });
  for (const good of deck) supply[good]++;

  const starter = randomInt(ps.length);
  const g = {
    status: 'play',
    rules: { pirateKick: !!pirateKick },
    round: 0,
    stage: 'bid',
    roll: 0,
    turn: starter,
    turnNo: 0,
    evNo: 0,
    ev: null,
    evFeed: [],
    master: null,
    lastMaster: starter,
    masterBought: false,
    market: Object.fromEntries(GOODS.map((k) => [k, 0])),
    supply,
    auction: null,
    ships: [],
    board: emptyBoard(),
    placeQueue: [],
    pirateQueue: [],
    pirateSlot: null,
    plunder: null,
    lastRoll: null,
    nextReady: [],
    summary: null,
    winners: null,
    log: [],
    players: ps,
  };
  startRound(g);
  return g;
}

function emptyBoard() {
  return {
    harbor: [null, null, null],
    shipyard: [null, null, null],
    insurance: null,
    pirates: [null, null],
    navSmall: null,
    navBig: null,
  };
}

function startRound(g) {
  g.round++;
  g.status = 'play';
  g.stage = 'bid';
  g.roll = 0;
  g.summary = null;
  g.master = null;
  g.masterBought = false;
  g.ships = [];
  g.board = emptyBoard();
  g.placeQueue = [];
  g.pirateQueue = [];
  g.pirateSlot = null;
  g.plunder = null;
  g.lastRoll = null;
  g.nextReady = [];

  const activeCount = g.players.filter((p) => p.in).length;
  const perPlayer = activeCount <= 3 ? 4 : 3;
  for (const p of g.players) p.workers = p.in ? perPlayer : 0;

  let starter = g.lastMaster;
  if (!g.players[starter]?.in) starter = nextIn(g, starter);
  g.auction = { starter: g.players[starter].id, high: 0, leader: null, passed: [] };
  g.turn = starter;
  g.turnNo++;
  log(g, `第 ${g.round} 航程開始！由 ${g.players[starter].name} 率先競標船老大`);
  pushEv(g, { kind: 'roundStart', round: g.round, starter: g.players[starter].id });
}

// --- 競標船老大 ---
function nextBidder(g, fromIdx) {
  const n = g.players.length;
  for (let k = 1; k <= n; k++) {
    const j = (fromIdx + k) % n;
    const p = g.players[j];
    if (p.in && !g.auction.passed.includes(p.id)) return j;
  }
  return -1;
}

function checkAuctionEnd(g, fromIdx) {
  const a = g.auction;
  const remaining = g.players.filter((p) => p.in && !a.passed.includes(p.id));
  if (remaining.length === 0) {
    // 全員 PASS → 首位喊價者免費（0 元）擔任船老大
    let starter = playerOf(g, a.starter);
    if (!starter?.in) starter = g.players.find((p) => p.in);
    return finishAuction(g, starter, 0);
  }
  if (remaining.length === 1 && a.leader === remaining[0].id) {
    return finishAuction(g, remaining[0], a.high);
  }
  const nxt = nextBidder(g, fromIdx);
  if (nxt < 0) return finishAuction(g, remaining[0], a.high);
  g.turn = nxt;
  g.turnNo++;
}

function finishAuction(g, winner, price) {
  winner.cash -= price;
  const idx = indexOf(g, winner.id);
  g.master = winner.id;
  g.lastMaster = idx;
  g.stage = 'master';
  g.masterBought = false;
  g.turn = idx;
  g.turnNo++;
  log(g, `${winner.name} 以 ${price} 元標下船老大！`);
  pushEv(g, { kind: 'masterWon', by: winner.id, price, title: `⚓ ${winner.name} 當選船老大！`, sub: price > 0 ? `以 $${price} 得標，開始執行三大特權` : '全員 PASS，免費擔任船老大', tone: 'gold' });
}

// --- 派遣手下 ---
function startPlaceWave(g) {
  const masterIdx = indexOf(g, g.master);
  const order = activeOrder(g, masterIdx);
  const activeCount = order.length;
  // 3 人局第 1 輪（g.roll === 0）輪流放兩圈（共 2 個手下），其餘每輪放 1 個
  const passes = g.roll === 0 && activeCount <= 3 ? 2 : 1;
  g.placeQueue = [];
  for (let k = 0; k < passes; k++) g.placeQueue.push(...order);
  g.stage = 'place';
  advancePlaceQueue(g);
}

function advancePlaceQueue(g) {
  while (g.placeQueue.length) {
    const pid = g.placeQueue[0];
    const p = playerOf(g, pid);
    if (p?.in && p.workers > 0) {
      g.turn = indexOf(g, pid);
      g.turnNo++;
      return;
    }
    g.placeQueue.shift();
  }
  // 本波派遣完成
  if (g.roll === 2) {
    // 第 3 次擲骰前：依序由小領航員 → 大領航員行動
    return startNavigatorPhase(g);
  }
  enterRollStage(g);
}

function startNavigatorPhase(g) {
  const ns = g.board.navSmall && playerOf(g, g.board.navSmall)?.in ? g.board.navSmall : null;
  if (ns) {
    g.stage = 'nav_small';
    g.turn = indexOf(g, ns);
    g.turnNo++;
    return;
  }
  const nb = g.board.navBig && playerOf(g, g.board.navBig)?.in ? g.board.navBig : null;
  if (nb) {
    g.stage = 'nav_big';
    g.turn = indexOf(g, nb);
    g.turnNo++;
    return;
  }
  enterRollStage(g);
}

function enterRollStage(g) {
  g.stage = 'roll';
  let mIdx = indexOf(g, g.master);
  if (!g.players[mIdx]?.in) {
    mIdx = nextIn(g, mIdx);
    g.master = g.players[mIdx].id;
    g.lastMaster = mIdx;
  }
  g.turn = mIdx;
  g.turnNo++;
}

// --- 擲骰移動與海盜 ---
function performRoll(g, forcedDice) {
  g.roll++;
  const dice = g.ships.map((s, idx) => {
    const from = s.pos;
    if (from >= HARBOR_POS) return { ship: idx, good: s.good, d: 0, from, to: from, alreadyIn: true };
    const d = forcedDice ? forcedDice[idx] : randomInt(1, 7);
    const to = from + d > MAX_POS ? HARBOR_POS : from + d;
    s.pos = to;
    return { ship: idx, good: s.good, d, from, to, alreadyIn: false };
  });
  g.lastRoll = { roll: g.roll, dice };
  const desc = dice.map((x) => x.alreadyIn
    ? `${GOOD_INFO[x.good].name}(已進港)`
    : `${GOOD_INFO[x.good].name}+${x.d}→${x.to >= HARBOR_POS ? '進港' : x.to}`
  ).join('、');
  log(g, `第 ${g.roll}/3 次擲骰：${desc}`);
  pushEv(g, { kind: 'roll', roll: g.roll, dice });

  if (g.roll === 1) {
    return startPlaceWave(g);
  }
  if (g.roll === 2) {
    return startPirateBoard(g);
  }
  // 第 3 次擲骰結束：檢查 13 格海盜掠奪
  return startPiratePlunder(g);
}

function boardableShipsFor(g, pid) {
  return g.ships.map((s, i) => ({ s, i })).filter(({ s }) => {
    if (s.pos !== MAX_POS) return false;
    const maxSlots = GOOD_INFO[s.good].slots.length;
    if (s.crew.length < maxSlots) return true;
    return g.rules.pirateKick && s.crew.some((owner) => owner !== pid);
  }).map(({ i }) => i);
}

function startPirateBoard(g) {
  g.pirateQueue = [0, 1].filter((slot) => g.board.pirates[slot] && playerOf(g, g.board.pirates[slot])?.in);
  advancePirateBoard(g);
}

function advancePirateBoard(g) {
  while (g.pirateQueue.length) {
    const slot = g.pirateQueue.shift();
    const pid = g.board.pirates[slot];
    if (!pid || !playerOf(g, pid)?.in) continue;
    const eligible = boardableShipsFor(g, pid);
    if (!eligible.length) continue;
    g.stage = 'pirate_board';
    g.pirateSlot = slot;
    g.turn = indexOf(g, pid);
    g.turnNo++;
    return;
  }
  g.pirateSlot = null;
  startPlaceWave(g);
}

function startPiratePlunder(g) {
  const ships13 = g.ships.map((s, i) => i).filter((i) => g.ships[i].pos === MAX_POS);
  const pirateSlots = [0, 1].filter((slot) => g.board.pirates[slot] && playerOf(g, g.board.pirates[slot])?.in);
  if (!ships13.length || !pirateSlots.length) {
    return settleVoyage(g);
  }
  if (ships13.length === 1) {
    const si = ships13[0];
    const ship = g.ships[si];
    const pirates = pirateSlots.map((slot) => g.board.pirates[slot]);
    ship.crew = [];
    ship.plunderedBy = pirates;
    for (const slot of pirateSlots) g.board.pirates[slot] = null;
    const captainId = pirates[0];
    g.stage = 'pirate_plunder';
    g.plunder = { mode: 'dest', ship: si, by: captainId, ships: [si], pirateSlot: pirateSlots[0], remainingPirates: [] };
    g.turn = indexOf(g, captainId);
    g.turnNo++;
    log(g, `🏴‍☠️ 海盜掠奪了${GOOD_INFO[ship.good].name}船！全體船員落海，由 ${playerOf(g, captainId).name} 決定船隻去向`);
    pushEv(g, { kind: 'plunder', ship: si, good: ship.good, pirates });
    return;
  }
  // 2 艘（或以上）停在 13 格：海盜依序挑選要掠奪的船並決定去向
  const firstSlot = pirateSlots[0];
  const captainId = g.board.pirates[firstSlot];
  g.stage = 'pirate_plunder';
  g.plunder = { mode: 'pick', ship: null, by: captainId, ships: ships13, pirateSlot: firstSlot, remainingPirates: pirateSlots.slice(1) };
  g.turn = indexOf(g, captainId);
  g.turnNo++;
  log(g, `🏴‍☠️ 多艘船停在 13 格！${playerOf(g, captainId).name} 選擇要掠奪哪一艘船`);
  pushEv(g, { kind: 'plunder', ships: ships13, pirates: [captainId] });
}

// --- 航程結算 ---
function settleVoyage(g) {
  const deltas = Object.fromEntries(g.players.map((p) => [p.id, { cargo: 0, harbor: 0, shipyard: 0, pirate: 0, insurancePaid: 0, autoMortgaged: 0 }]));

  const shipResults = g.ships.map((s, idx) => {
    const info = GOOD_INFO[s.good];
    const dest = s.dest ?? (s.pos >= HARBOR_POS ? 'harbor' : 'shipyard');
    s.dest = dest;
    const payouts = [];
    if (s.plunderedBy?.length) {
      const share = info.payout / s.plunderedBy.length;
      for (const pid of s.plunderedBy) {
        const p = playerOf(g, pid);
        if (p) { p.cash += share; deltas[pid].pirate += share; payouts.push({ id: pid, amount: share, role: 'pirate' }); }
      }
    } else if (dest === 'harbor' && s.crew.length) {
      const share = info.payout / s.crew.length;
      for (const pid of s.crew) {
        const p = playerOf(g, pid);
        if (p) { p.cash += share; deltas[pid].cargo += share; payouts.push({ id: pid, amount: share, role: 'crew' }); }
      }
    }
    return { idx, good: s.good, name: info.name, pos: s.pos, dest, plundered: !!s.plunderedBy?.length, payout: info.payout, payouts };
  });

  const harborCount = shipResults.filter((r) => r.dest === 'harbor').length;
  const shipyardCount = shipResults.filter((r) => r.dest === 'shipyard').length;

  // 港口分紅
  const harborPayouts = [];
  HARBOR_SLOTS.forEach((slot, i) => {
    const pid = g.board.harbor[i];
    if (pid && harborCount >= slot.need) {
      const p = playerOf(g, pid);
      if (p) { p.cash += slot.reward; deltas[pid].harbor += slot.reward; }
      harborPayouts.push({ label: slot.label, id: pid, amount: slot.reward });
    }
  });

  // 修船廠分紅
  const shipyardPayouts = [];
  let shipyardTotal = 0;
  SHIPYARD_SLOTS.forEach((slot, i) => {
    const pid = g.board.shipyard[i];
    if (pid && shipyardCount >= slot.need) {
      const p = playerOf(g, pid);
      if (p) { p.cash += slot.reward; deltas[pid].shipyard += slot.reward; }
      shipyardTotal += slot.reward;
      shipyardPayouts.push({ label: slot.label, id: pid, amount: slot.reward });
    }
  });

  // 保險公司理賠
  let insuranceSummary = null;
  if (g.board.insurance) {
    const ins = playerOf(g, g.board.insurance);
    if (ins && shipyardTotal > 0) {
      let autoMortgaged = 0;
      while (ins.cash < shipyardTotal) {
        const st = ins.stocks.find((x) => !x.mortgaged);
        if (!st) break;
        st.mortgaged = true;
        ins.cash += MORTGAGE_GAIN;
        autoMortgaged++;
      }
      const paid = Math.min(ins.cash, shipyardTotal);
      ins.cash -= paid;
      const bankCovered = shipyardTotal - paid;
      deltas[ins.id].insurancePaid = paid;
      deltas[ins.id].autoMortgaged = autoMortgaged;
      insuranceSummary = { id: ins.id, name: ins.name, owed: shipyardTotal, paid, autoMortgaged, bankCovered };
      log(g, `🛡️ 保險公司 ${ins.name} 理賠修船廠 ${paid} 元${autoMortgaged ? `（強制抵押 ${autoMortgaged} 張股票）` : ''}${bankCovered ? `（銀行補足 ${bankCovered} 元）` : ''}`);
    } else if (ins) {
      insuranceSummary = { id: ins.id, name: ins.name, owed: 0, paid: 0, autoMortgaged: 0, bankCovered: 0 };
    }
  }

  // 黑市價格調漲
  const priceChanges = [];
  for (const sr of shipResults) {
    if (sr.dest === 'harbor') {
      const before = PRICE_TRACK[g.market[sr.good]];
      g.market[sr.good] = Math.min(PRICE_TRACK.length - 1, g.market[sr.good] + 1);
      const after = PRICE_TRACK[g.market[sr.good]];
      priceChanges.push({ good: sr.good, name: sr.name, before, after });
    }
  }

  const gameOver = GOODS.some((k) => g.market[k] >= PRICE_TRACK.length - 1);

  const playerRows = g.players.filter((p) => !p.left).map((p) => {
    const d = deltas[p.id];
    const net = d.cargo + d.harbor + d.shipyard + d.pirate - d.insurancePaid;
    return { id: p.id, name: p.name, color: p.color, cash: p.cash, net, ...d };
  });

  log(g, `第 ${g.round} 航程結算：${harborCount} 艘進港、${shipyardCount} 艘進修船廠${priceChanges.length ? `；黑市漲價：${priceChanges.map((x) => `${x.name}→$${x.after}`).join('、')}` : ''}`);

  let finalRows = null;
  if (gameOver) {
    finalRows = g.players.filter((p) => !p.left).map((p) => {
      const byGood = Object.fromEntries(GOODS.map((k) => [k, 0]));
      let mortgaged = 0;
      let stockValue = 0;
      for (const s of p.stocks) {
        byGood[s.good]++;
        stockValue += PRICE_TRACK[g.market[s.good]];
        if (s.mortgaged) mortgaged++;
      }
      const debt = mortgaged * REDEEM_COST;
      const total = p.cash + stockValue - debt;
      return { id: p.id, name: p.name, color: p.color, cash: p.cash, byGood, stockValue, mortgaged, debt, total };
    }).sort((a, b) => b.total - a.total || b.cash - a.cash);

    const top = Math.max(...finalRows.map((r) => r.total));
    g.winners = finalRows.filter((r) => r.total === top).map((r) => r.id);
    g.status = 'over';
    log(g, `🏆 遊戲結束！${finalRows.filter((r) => r.total === top).map((r) => r.name).join('、')} 以 ${top} 元成為馬尼拉走私大王！`);
  } else {
    g.status = 'roundEnd';
    g.nextReady = [];
  }

  g.stage = 'summary';
  g.summary = {
    round: g.round,
    ships: shipResults,
    harborCount,
    shipyardCount,
    harborPayouts,
    shipyardPayouts,
    insurance: insuranceSummary,
    priceChanges,
    market: Object.fromEntries(GOODS.map((k) => [k, PRICE_TRACK[g.market[k]]])),
    rows: playerRows,
    finalRows,
  };
  pushEv(g, { kind: gameOver ? 'gameOver' : 'roundEnd', round: g.round, harborCount, shipyardCount });
}

// --- 玩家動作 ---
function act(g, pid, a) {
  if (a.type === 'next') {
    if (g.status !== 'roundEnd') err('現在不能開始下一航程');
    const p = playerOf(g, pid);
    if (!p?.in) err('你不在這局遊戲中');
    if (!g.nextReady.includes(pid)) g.nextReady.push(pid);
    if (g.players.every((q) => !q.in || g.nextReady.includes(q.id))) return startRound(g);
    return;
  }
  if (g.status !== 'play') err('遊戲不在進行中');
  const p = playerOf(g, pid);
  if (!p?.in) err('你不在這局遊戲中');

  // 任何時候皆可抵押／贖回股票
  if (a.type === 'mortgage') {
    const idx = a.idx != null ? a.idx : p.stocks.findIndex((s) => !s.mortgaged);
    if (!Number.isInteger(idx) || idx < 0 || idx >= p.stocks.length) err('找不到這張股票');
    if (p.stocks[idx].mortgaged) err('這張股票已經抵押了');
    p.stocks[idx].mortgaged = true;
    p.cash += MORTGAGE_GAIN;
    log(g, `${p.name} 抵押了 1 張股票（+${MORTGAGE_GAIN} 元）`);
    pushEv(g, { kind: 'mortgage', by: p.id, title: `🔒 ${p.name} 抵押了 1 張股票`, sub: `換取現金 +$${MORTGAGE_GAIN}（贖回需 $${REDEEM_COST}）`, tone: 'gold' });
    return;
  }
  if (a.type === 'redeem') {
    const idx = a.idx != null ? a.idx : p.stocks.findIndex((s) => s.mortgaged);
    if (!Number.isInteger(idx) || idx < 0 || idx >= p.stocks.length) err('找不到這張抵押股票');
    if (!p.stocks[idx].mortgaged) err('這張股票沒有抵押');
    if (p.cash < REDEEM_COST) err(`現金不足，贖回需要 ${REDEEM_COST} 元`);
    p.stocks[idx].mortgaged = false;
    p.cash -= REDEEM_COST;
    log(g, `${p.name} 贖回了 1 張抵押股票（−${REDEEM_COST} 元）`);
    pushEv(g, { kind: 'redeem', by: p.id, title: `📜 ${p.name} 贖回了抵押股票`, sub: `支付 −$${REDEEM_COST} 解除紅蠟抵押`, tone: 'gold' });
    return;
  }

  const cur = g.players[g.turn];
  if (cur.id !== pid) err('還沒輪到你');

  if (g.stage === 'bid') {
    if (a.type === 'bid') {
      const amount = a.amount;
      const minBid = Math.max(1, g.auction.high + 1);
      if (!Number.isInteger(amount) || amount < minBid) err(`出價必須至少 ${minBid} 元`);
      if (amount > p.cash) err('現金不足，可先抵押股票換取 12 元');
      g.auction.high = amount;
      g.auction.leader = p.id;
      log(g, `${p.name} 喊價 ${amount} 元`);
      pushEv(g, { kind: 'bid', by: p.id, amount, title: `💰 ${p.name} 競標喊價 $${amount}`, sub: '目前最高出價，爭奪船老大', tone: 'gold' });
      return checkAuctionEnd(g, g.turn);
    }
    if (a.type === 'pass') {
      if (g.auction.leader === p.id) err('你目前是最高出價者，不能 PASS');
      if (!g.auction.passed.includes(p.id)) g.auction.passed.push(p.id);
      log(g, `${p.name} 放棄競標`);
      pushEv(g, { kind: 'pass', by: p.id, title: `${p.name} 放棄競標（PASS）`, sub: '退出本航程船老大競標', tone: 'mute' });
      return checkAuctionEnd(g, g.turn);
    }
    err('現在是競標階段，請出價或 PASS');
  }

  if (g.stage === 'master') {
    if (a.type === 'buyStock') {
      if (g.masterBought) err('船老大每航程只能買 1 張股票');
      const good = a.good;
      if (!GOODS.includes(good)) err('未知的貨物種類');
      if (g.supply[good] <= 0) err(`${GOOD_INFO[good].name}股票已售完`);
      const price = buyPrice(g, good);
      if (p.cash < price) err(`現金不足，需要 ${price} 元（可先抵押股票）`);
      p.cash -= price;
      g.supply[good]--;
      p.stocks.push({ good, mortgaged: false, public: true });
      p.bought.push(good);
      g.masterBought = true;
      log(g, `船老大 ${p.name} 以 ${price} 元買進 1 張${GOOD_INFO[good].name}股票`);
      pushEv(g, { kind: 'buyStock', by: p.id, good, price, title: `📜 ${p.name} 買進${GOOD_INFO[good].name}股票`, sub: `船老大特權 · 花費 $${price}（公開紀錄）`, tone: 'gold' });
      return;
    }
    if (a.type === 'setupShips') {
      const list = a.ships;
      if (!Array.isArray(list) || list.length !== 3) err('必須選擇 3 種貨物裝船');
      const seen = new Set();
      let sum = 0;
      for (const item of list) {
        if (!item || !GOODS.includes(item.good)) err('貨物種類不正確');
        if (seen.has(item.good)) err('3 艘船的貨物不能重複');
        seen.add(item.good);
        if (!Number.isInteger(item.pos) || item.pos < 0 || item.pos > 5) err('每艘船起始格數要在 0–5 之間');
        sum += item.pos;
      }
      if (sum !== 9) err('三艘船的起始格數總和必須剛好是 9 格');
      g.ships = list.map(({ good, pos }) => ({ good, pos, startPos: pos, crew: [], plunderedBy: null, dest: null }));
      const shipDesc = g.ships.map((s) => `${GOOD_INFO[s.good].name}(${s.pos}格)`).join(' · ');
      log(g, `船老大 ${p.name} 啟航：${shipDesc}`);
      pushEv(g, { kind: 'sail', by: p.id, ships: g.ships.map((s) => ({ good: s.good, pos: s.pos })), title: `⛵ 船老大 ${p.name} 安排啟航！`, sub: shipDesc, tone: 'gold' });
      return startPlaceWave(g);
    }
    err('請執行船老大特權（買股或安排三艘船出發）');
  }

  if (g.stage === 'place') {
    if (a.type === 'passPlace') {
      log(g, `${p.name} 本次跳過派遣`);
      pushEv(g, { kind: 'passPlace', by: p.id, title: `${p.name} 跳過本次派遣`, sub: '未派出手下', tone: 'mute' });
      g.placeQueue.shift();
      return advancePlaceQueue(g);
    }
    if (a.type !== 'place') err('現在是派遣手下階段');
    if (p.workers <= 0) err('你已經沒有可用的手下了');
    const spot = String(a.spot ?? '');
    if (spot.startsWith('ship:')) {
      const si = Number(spot.slice(5));
      const ship = g.ships[si];
      if (!ship) err('找不到這艘船');
      if (ship.pos >= HARBOR_POS) err('這艘船已經進港了，不能再上船');
      const slots = GOOD_INFO[ship.good].slots;
      if (ship.crew.length >= slots.length) err('這艘船的位置已滿');
      const cost = slots[ship.crew.length];
      if (p.cash < cost) err(`現金不足，這個位置需要 ${cost} 元（可先抵押股票）`);
      p.cash -= cost;
      p.workers--;
      ship.crew.push(p.id);
      log(g, `${p.name} 花 ${cost} 元登上${GOOD_INFO[ship.good].name}船`);
      pushEv(g, { kind: 'place', by: p.id, good: ship.good, title: `⛵ ${p.name} 登上${GOOD_INFO[ship.good].name}船`, sub: `花費 $${cost} · 進港平分 $${GOOD_INFO[ship.good].payout}`, tone: 'gold' });
    } else if (spot.startsWith('harbor:')) {
      const hi = Number(spot.slice(7));
      const slot = HARBOR_SLOTS[hi];
      if (!slot) err('找不到這個港口位置');
      if (g.board.harbor[hi]) err('這個港口位置已經有人了');
      if (p.cash < slot.cost) err(`現金不足，需要 ${slot.cost} 元`);
      p.cash -= slot.cost;
      p.workers--;
      g.board.harbor[hi] = p.id;
      log(g, `${p.name} 花 ${slot.cost} 元佔據港口 ${slot.label}`);
      pushEv(g, { kind: 'place', by: p.id, title: `⚓ ${p.name} 佔據港口 ${slot.label}`, sub: `花費 $${slot.cost} · ≥${slot.need} 船進港得 $${slot.reward}`, tone: 'gold' });
    } else if (spot.startsWith('shipyard:')) {
      const yi = Number(spot.slice(9));
      const slot = SHIPYARD_SLOTS[yi];
      if (!slot) err('找不到這個修船廠位置');
      if (g.board.shipyard[yi]) err('這個修船廠位置已經有人了');
      if (p.cash < slot.cost) err(`現金不足，需要 ${slot.cost} 元`);
      p.cash -= slot.cost;
      p.workers--;
      g.board.shipyard[yi] = p.id;
      log(g, `${p.name} 花 ${slot.cost} 元佔據修船廠 ${slot.label}`);
      pushEv(g, { kind: 'place', by: p.id, title: `🔧 ${p.name} 佔據修船廠 ${slot.label}`, sub: `花費 $${slot.cost} · ≥${slot.need} 船進修船廠得 $${slot.reward}`, tone: 'gold' });
    } else if (spot === 'insurance') {
      if (g.board.insurance) err('保險辦事處已經有人了');
      p.workers--;
      p.cash += INSURANCE_GAIN;
      g.board.insurance = p.id;
      log(g, `${p.name} 接任保險辦事處，立刻獲得 ${INSURANCE_GAIN} 元！`);
      pushEv(g, { kind: 'place', by: p.id, title: `🛡️ ${p.name} 接任保險辦事處！`, sub: `立刻領取 +$${INSURANCE_GAIN}（須代付修船廠賠償）`, tone: 'green' });
    } else if (spot === 'pirate') {
      const pi = g.board.pirates[0] ? (g.board.pirates[1] ? -1 : 1) : 0;
      if (pi < 0) err('海盜船已經滿員');
      if (p.cash < PIRATE_COST) err(`現金不足，當海盜需要 ${PIRATE_COST} 元`);
      p.cash -= PIRATE_COST;
      p.workers--;
      g.board.pirates[pi] = p.id;
      const role = pi === 0 ? '船長' : '船員';
      log(g, `${p.name} 花 ${PIRATE_COST} 元成為海盜${role}`);
      pushEv(g, { kind: 'place', by: p.id, title: `🏴‍☠️ ${p.name} 成為海盜${role}！`, sub: `花費 $${PIRATE_COST} · 船停 13 格即可劫船`, tone: 'red' });
    } else if (spot === 'nav_small') {
      if (g.board.navSmall) err('小領航員位置已經有人了');
      if (p.cash < NAV_SMALL_COST) err(`現金不足，小領航員需要 ${NAV_SMALL_COST} 元`);
      p.cash -= NAV_SMALL_COST;
      p.workers--;
      g.board.navSmall = p.id;
      log(g, `${p.name} 花 ${NAV_SMALL_COST} 元擔任小領航員（±1 格）`);
      pushEv(g, { kind: 'place', by: p.id, title: `🧭 ${p.name} 擔任小領航員`, sub: `花費 $${NAV_SMALL_COST} · 第 3 輪前可調船 ±1 格`, tone: 'blue' });
    } else if (spot === 'nav_big') {
      if (g.board.navBig) err('大領航員位置已經有人了');
      if (p.cash < NAV_BIG_COST) err(`現金不足，大領航員需要 ${NAV_BIG_COST} 元`);
      p.cash -= NAV_BIG_COST;
      p.workers--;
      g.board.navBig = p.id;
      log(g, `${p.name} 花 ${NAV_BIG_COST} 元擔任大領航員（±2 格）`);
      pushEv(g, { kind: 'place', by: p.id, title: `🧭 ${p.name} 擔任大領航員`, sub: `花費 $${NAV_BIG_COST} · 第 3 輪前可調船 ±2 格`, tone: 'blue' });
    } else {
      err('未知的派遣位置');
    }
    g.placeQueue.shift();
    return advancePlaceQueue(g);
  }

  if (g.stage === 'nav_small' || g.stage === 'nav_big') {
    if (a.type !== 'navigate') err('請使用領航員移動船隻（或選擇不移動）');
    const budget = g.stage === 'nav_small' ? 1 : 2;
    const moves = Array.isArray(a.moves) ? a.moves : [];
    const totals = new Map();
    let spent = 0;
    for (const m of moves) {
      if (!m || !Number.isInteger(m.ship) || !g.ships[m.ship]) err('找不到要移動的船');
      if (!Number.isInteger(m.delta) || m.delta === 0) err('移動格數不正確');
      spent += Math.abs(m.delta);
      totals.set(m.ship, (totals.get(m.ship) ?? 0) + m.delta);
    }
    if (spent > budget) err(`最多只能移動 ${budget} 格`);
    for (const [si, delta] of totals) {
      const ship = g.ships[si];
      if (ship.pos >= HARBOR_POS) err(`${GOOD_INFO[ship.good].name}船已進港，領航員無法移動`);
      const next = ship.pos + delta;
      if (next < 0 || next > MAX_POS) err(`領航員只能將船維持在 0–${MAX_POS} 格之間（不能直接送進港）`);
    }
    const notes = [];
    for (const [si, delta] of totals) {
      if (!delta) continue;
      const ship = g.ships[si];
      ship.pos += delta;
      notes.push(`${GOOD_INFO[ship.good].name}${delta > 0 ? `+${delta}` : delta}→${ship.pos}格`);
    }
    const navLabel = g.stage === 'nav_small' ? '小領航員' : '大領航員';
    log(g, `${navLabel} ${p.name}：${notes.length ? notes.join('、') : '按兵不動'}`);
    pushEv(g, { kind: 'nav', by: p.id, small: g.stage === 'nav_small', notes, title: `🧭 ${p.name} 操控${navLabel}`, sub: notes.length ? notes.join(' · ') : '選擇按兵不動', tone: 'blue' });

    if (g.stage === 'nav_small') {
      const nb = g.board.navBig && playerOf(g, g.board.navBig)?.in ? g.board.navBig : null;
      if (nb) {
        g.stage = 'nav_big';
        g.turn = indexOf(g, nb);
        g.turnNo++;
        return;
      }
    }
    return enterRollStage(g);
  }

  if (g.stage === 'roll') {
    if (a.type !== 'roll') err('請船老大擲骰子');
    return performRoll(g);
  }

  if (g.stage === 'pirate_board') {
    if (a.type !== 'pirateBoard') err('請海盜決定是否登上 13 格的船');
    const slot = g.pirateSlot;
    if (a.ship === null || a.ship === undefined) {
      log(g, `海盜 ${p.name} 選擇留在海盜船上，等待第 3 輪掠奪`);
      pushEv(g, { kind: 'pirateBoard', by: p.id, title: `🏴‍☠️ 海盜 ${p.name} 留在海盜船`, sub: '放棄登船，等待第 3 輪掠奪', tone: 'red' });
      return advancePirateBoard(g);
    }
    const si = a.ship;
    const ship = g.ships[si];
    if (!ship || ship.pos !== MAX_POS) err('只能登上停在 13 格的船');
    const maxSlots = GOOD_INFO[ship.good].slots.length;
    if (ship.crew.length < maxSlots) {
      ship.crew.push(p.id);
      g.board.pirates[slot] = null;
      log(g, `🏴‍☠️ 海盜 ${p.name} 免費登上${GOOD_INFO[ship.good].name}船！`);
      pushEv(g, { kind: 'pirateBoard', by: p.id, good: ship.good, title: `🏴‍☠️ 海盜 ${p.name} 免費登上${GOOD_INFO[ship.good].name}船！`, sub: '船停 13 格趁機登船佔空位', tone: 'red' });
    } else {
      if (!g.rules.pirateKick) err('這艘船已經客滿，海盜無法登船');
      const ki = a.kickIdx;
      if (!Number.isInteger(ki) || ki < 0 || ki >= ship.crew.length) err('請指定要踢下船的水手');
      if (ship.crew[ki] === p.id) err('不能踢自己的手下');
      const kickedId = ship.crew[ki];
      const kickedName = playerOf(g, kickedId).name;
      ship.crew[ki] = p.id;
      g.board.pirates[slot] = null;
      log(g, `🏴‍☠️ 海盜 ${p.name} 踢下 ${kickedName}，強行登上${GOOD_INFO[ship.good].name}船！`);
      pushEv(g, { kind: 'pirateBoard', by: p.id, good: ship.good, title: `🏴‍☠️ 海盜 ${p.name} 踢下 ${kickedName}！`, sub: `強行登上${GOOD_INFO[ship.good].name}船搶佔位置`, tone: 'red' });
    }
    return advancePirateBoard(g);
  }

  if (g.stage === 'pirate_plunder') {
    if (a.type !== 'pirateDecide') err('請海盜決定掠奪目標與去向');
    const pl = g.plunder;
    const dest = a.dest;
    if (dest !== 'harbor' && dest !== 'shipyard') err('請選擇送進港口或修船廠');
    if (pl.mode === 'dest') {
      const ship = g.ships[pl.ship];
      ship.dest = dest;
      log(g, `🏴‍☠️ 海盜船長 ${p.name} 將${GOOD_INFO[ship.good].name}船送進${dest === 'harbor' ? '港口' : '修船廠'}！`);
      pushEv(g, { kind: 'pirateDecide', by: p.id, good: ship.good, dest, title: `🏴‍☠️ 海盜 ${p.name} 劫走${GOOD_INFO[ship.good].name}船！`, sub: `送進${dest === 'harbor' ? '⚓ 港口（拉抬股價）' : '🔧 修船廠（重創保險）'}`, tone: 'red' });
      g.plunder = null;
      return settleVoyage(g);
    }
    // pick mode（多艘停在 13 格）
    const si = a.ship;
    if (!pl.ships.includes(si)) err('請選擇停在 13 格且尚未被掠奪的船');
    const ship = g.ships[si];
    ship.crew = [];
    ship.plunderedBy = [p.id];
    ship.dest = dest;
    g.board.pirates[pl.pirateSlot] = null;
    log(g, `🏴‍☠️ 海盜 ${p.name} 掠奪${GOOD_INFO[ship.good].name}船並送進${dest === 'harbor' ? '港口' : '修船廠'}！`);
    pushEv(g, { kind: 'pirateDecide', by: p.id, good: ship.good, dest, title: `🏴‍☠️ 海盜 ${p.name} 掠奪${GOOD_INFO[ship.good].name}船！`, sub: `送進${dest === 'harbor' ? '⚓ 港口（拉抬股價）' : '🔧 修船廠（重創保險）'}`, tone: 'red' });

    const restShips = pl.ships.filter((x) => x !== si);
    const restPirates = pl.remainingPirates.filter((slot) => g.board.pirates[slot] && playerOf(g, g.board.pirates[slot])?.in);
    if (restPirates.length && restShips.length) {
      const nextSlot = restPirates[0];
      const nextId = g.board.pirates[nextSlot];
      g.plunder = { mode: 'pick', ship: null, by: nextId, ships: restShips, pirateSlot: nextSlot, remainingPirates: restPirates.slice(1) };
      g.turn = indexOf(g, nextId);
      g.turnNo++;
      return;
    }
    g.plunder = null;
    return settleVoyage(g);
  }

  err('未知的動作');
}

// --- 中途退出 ---
function leave(g, pid) {
  const i = indexOf(g, pid), p = g.players[i];
  const alive = () => g.players.filter((q) => q.in).length;
  if (!p?.in) return alive();
  p.in = false;
  p.left = true;
  p.workers = 0;
  log(g, `${p.name} 離開了馬尼拉`);
  const left = alive();
  if (g.status === 'roundEnd') {
    g.nextReady = g.nextReady.filter((x) => x !== pid);
    if (left >= 2 && g.players.every((q) => !q.in || g.nextReady.includes(q.id))) startRound(g);
    return left;
  }
  if (g.status !== 'play' || left < 2) return left;

  // 若退出者在派遣佇列中，移除之
  if (g.placeQueue.length) g.placeQueue = g.placeQueue.filter((x) => x !== pid);

  if (g.stage === 'bid') {
    if (!g.auction.passed.includes(pid)) g.auction.passed.push(pid);
    if (g.auction.leader === pid) { g.auction.leader = null; g.auction.high = 0; }
    if (g.turn === i || g.players.filter((q) => q.in && !g.auction.passed.includes(q.id)).length <= 1) {
      checkAuctionEnd(g, i);
    }
  } else if (g.stage === 'master' && g.turn === i) {
    const nxt = nextIn(g, i);
    g.master = g.players[nxt].id;
    g.lastMaster = nxt;
    g.turn = nxt;
    g.turnNo++;
    log(g, `由 ${g.players[nxt].name} 接任船老大`);
  } else if (g.stage === 'place' && g.turn === i) {
    advancePlaceQueue(g);
  } else if (g.stage === 'nav_small' && g.turn === i) {
    const nb = g.board.navBig && playerOf(g, g.board.navBig)?.in ? g.board.navBig : null;
    if (nb) { g.stage = 'nav_big'; g.turn = indexOf(g, nb); g.turnNo++; }
    else enterRollStage(g);
  } else if (g.stage === 'nav_big' && g.turn === i) {
    enterRollStage(g);
  } else if (g.stage === 'roll' && g.turn === i) {
    enterRollStage(g);
  } else if (g.stage === 'pirate_board' && g.turn === i) {
    advancePirateBoard(g);
  } else if (g.stage === 'pirate_plunder' && g.turn === i) {
    const pl = g.plunder;
    if (pl.mode === 'dest') {
      g.ships[pl.ship].dest = 'harbor';
      g.plunder = null;
      settleVoyage(g);
    } else {
      const restPirates = pl.remainingPirates.filter((slot) => g.board.pirates[slot] && playerOf(g, g.board.pirates[slot])?.in);
      if (restPirates.length) {
        const nextSlot = restPirates[0];
        const nextId = g.board.pirates[nextSlot];
        g.plunder = { mode: 'pick', ship: null, by: nextId, ships: pl.ships, pirateSlot: nextSlot, remainingPirates: restPirates.slice(1) };
        g.turn = indexOf(g, nextId);
        g.turnNo++;
      } else {
        g.plunder = null;
        settleVoyage(g);
      }
    }
  }
  return left;
}

// --- 超時代打 ---
function autoPlay(g, pid) {
  if (g.status !== 'play') return;
  const cur = g.players[g.turn];
  if (!cur || (pid && cur.id !== pid)) return;
  const id = cur.id;
  if (g.stage === 'bid') {
    if (g.auction.leader === id) return finishAuction(g, cur, g.auction.high);
    return act(g, id, { type: 'pass' });
  }
  if (g.stage === 'master') {
    return act(g, id, { type: 'setupShips', ships: [{ good: 'jade', pos: 3 }, { good: 'silk', pos: 3 }, { good: 'nutmeg', pos: 3 }] });
  }
  if (g.stage === 'place') return act(g, id, { type: 'passPlace' });
  if (g.stage === 'nav_small' || g.stage === 'nav_big') return act(g, id, { type: 'navigate', moves: [] });
  if (g.stage === 'roll') return act(g, id, { type: 'roll' });
  if (g.stage === 'pirate_board') return act(g, id, { type: 'pirateBoard', ship: null });
  if (g.stage === 'pirate_plunder') {
    const pl = g.plunder;
    return act(g, id, { type: 'pirateDecide', ship: pl.mode === 'pick' ? pl.ships[0] : pl.ship, dest: 'harbor' });
  }
}

// --- 電腦玩家 AI 決策（競標、買股、配船、派遣、領航、海盜皆依局勢評估）---
function botPlay(g, pid) {
  if (g.status !== 'play') return;
  const p = g.players[g.turn];
  if (!p || p.id !== pid || !p.in) return;

  // 現金充裕時贖回抵押股票；現金太少時必要才抵押
  const tryRedeem = () => {
    while (p.cash >= 26) {
      const mi = p.stocks.findIndex((s) => s.mortgaged);
      if (mi < 0) break;
      act(g, pid, { type: 'redeem', idx: mi });
    }
  };
  const mortgageOnce = () => {
    const ui = p.stocks.findIndex((s) => !s.mortgaged);
    if (ui < 0) return false;
    act(g, pid, { type: 'mortgage', idx: ui });
    return true;
  };
  const myShares = (good) => p.stocks.filter((s) => s.good === good).length;

  tryRedeem();

  if (g.stage === 'bid') {
    const minBid = Math.max(1, g.auction.high + 1);
    const hotBonus = GOODS.some((k) => g.market[k] >= 2 && (g.supply[k] > 0 || myShares(k) > 0)) ? 3 : 0;
    const stockSynergy = Math.max(...GOODS.map((k) => myShares(k))) * 2;
    const val = 5 + hotBonus + stockSynergy + randomInt(0, 5);
    const cap = Math.min(val, p.cash - 6);
    if (minBid <= cap) {
      const jump = minBid + 1 <= cap && randomInt(3) === 0 ? 1 : 0;
      return act(g, pid, { type: 'bid', amount: minBid + jump });
    }
    if (g.auction.leader === pid) return finishAuction(g, p, g.auction.high);
    return act(g, pid, { type: 'pass' });
  }

  if (g.stage === 'master') {
    // ① 特權買股：優先買黑市已漲或手上有同貨物的股票（保留足夠現金派遣）
    if (!g.masterBought) {
      const buyCands = GOODS
        .filter((k) => g.supply[k] > 0 && p.cash - buyPrice(g, k) >= 8)
        .map((k) => ({ k, score: g.market[k] * 4 + myShares(k) * 3 + (GOOD_INFO[k].payout / 12) + randomInt(0, 3) }))
        .sort((a, b) => b.score - a.score);
      if (buyCands.length && (buyCands[0].score >= 5 || randomInt(2) === 0)) {
        act(g, pid, { type: 'buyStock', good: buyCands[0].k });
      }
    }
    // ② 挑選 3 種貨物並分配 9 格起始位置
    const ranked = GOODS
      .map((k) => ({ k, score: myShares(k) * 4 + g.market[k] * 3 + GOOD_INFO[k].payout / 12 + randomInt(0, 3) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.k);
    const p0 = 4 + randomInt(0, 2); // 4 或 5
    const p1 = Math.min(5, Math.max(9 - p0 - 5, 3 + randomInt(0, 2)));
    const p2 = 9 - p0 - p1;
    return act(g, pid, {
      type: 'setupShips',
      ships: [{ good: ranked[0], pos: p0 }, { good: ranked[1], pos: p1 }, { good: ranked[2], pos: p2 }],
    });
  }

  if (g.stage === 'place') {
    if (p.workers <= 0) return act(g, pid, { type: 'passPlace' });
    const rollsLeft = Math.max(1, 3 - g.roll);
    const shipProb = (s) => {
      if (s.pos >= HARBOR_POS) return 1;
      const need = HARBOR_POS - s.pos;
      const exp = rollsLeft * 3.5;
      return Math.max(0.05, Math.min(0.95, 0.5 + (exp - need) * 0.14));
    };
    const probs = g.ships.map(shipProb);
    const expIn = probs.reduce((a, b) => a + b, 0);
    const expOut = 3 - expIn;

    const cands = [];
    const pushCand = (spot, cost, ev) => cands.push({ spot, cost, ev: ev + (randomInt(0, 30) - 10) / 10 });

    // 船上水手位
    g.ships.forEach((s, si) => {
      const info = GOOD_INFO[s.good];
      if (s.pos >= HARBOR_POS || s.crew.length >= info.slots.length) return;
      const cost = info.slots[s.crew.length];
      const estCrew = Math.min(info.slots.length, s.crew.length + 1 + (rollsLeft >= 2 ? 0.6 : 0));
      const share = info.payout / estCrew;
      pushCand(`ship:${si}`, cost, probs[si] * share - cost + myShares(s.good) * 0.4);
    });
    // 港口 A/B/C
    HARBOR_SLOTS.forEach((h, i) => {
      if (g.board.harbor[i]) return;
      const prob = Math.max(0.08, Math.min(0.95, 0.55 + (expIn - h.need) * 0.35));
      pushCand(`harbor:${i}`, h.cost, prob * h.reward - h.cost);
    });
    // 修船廠 A/B/C
    SHIPYARD_SLOTS.forEach((y, i) => {
      if (g.board.shipyard[i]) return;
      const prob = Math.max(0.08, Math.min(0.95, 0.55 + (expOut - y.need) * 0.35));
      pushCand(`shipyard:${i}`, y.cost, prob * y.reward - y.cost);
    });
    // 保險辦事處
    if (!g.board.insurance) {
      const takenYard = g.board.shipyard.reduce((a, owner, i) => a + (owner ? SHIPYARD_SLOTS[i].reward : 0), 0);
      const estPay = Math.min(takenYard + (rollsLeft >= 2 ? 6 : 0), expOut * 7);
      pushCand('insurance', 0, INSURANCE_GAIN - estPay);
    }
    // 海盜船
    if (!g.board.pirates[0] || !g.board.pirates[1]) {
      const near13 = g.ships.some((s) => s.pos >= 8 && s.pos <= 13);
      const base = g.roll <= 1 ? 3.5 : near13 ? 4.5 : -2;
      pushCand('pirate', PIRATE_COST, base);
    }
    // 領航員
    const myCrewCount = g.ships.reduce((a, s) => a + s.crew.filter((x) => x === pid).length, 0);
    const hasStake = myCrewCount > 0 || g.board.harbor.includes(pid) || g.board.shipyard.includes(pid) || g.board.insurance === pid;
    if (!g.board.navSmall) pushCand('nav_small', NAV_SMALL_COST, hasStake ? 3.5 : 1.0);
    if (!g.board.navBig) pushCand('nav_big', NAV_BIG_COST, hasStake ? 4.5 : 0.5);

    cands.sort((a, b) => b.ev - a.ev);
    let pick = cands.find((c) => c.cost <= p.cash && c.ev > -1.2);
    if (!pick && cands.length && cands[0].ev > 3.5 && cands[0].cost <= p.cash + MORTGAGE_GAIN && mortgageOnce()) {
      pick = cands[0];
    }
    if (pick) return act(g, pid, { type: 'place', spot: pick.spot });
    return act(g, pid, { type: 'passPlace' });
  }

  if (g.stage === 'nav_small' || g.stage === 'nav_big') {
    const budget = g.stage === 'nav_small' ? 1 : 2;
    const isHarbor = g.board.harbor.includes(pid);
    const isYard = g.board.shipyard.includes(pid);
    const isIns = g.board.insurance === pid;
    const wants = g.ships.map((s, si) => {
      if (s.pos >= HARBOR_POS) return { si, score: 0, pos: s.pos };
      let sc = s.crew.filter((x) => x === pid).length * 4 + myShares(s.good) * 2;
      if (isHarbor || isIns) sc += 2;
      if (isYard) sc -= 3;
      return { si, score: sc, pos: s.pos };
    });
    const moves = [];
    const posCopy = g.ships.map((s) => s.pos);
    for (let step = 0; step < budget; step++) {
      let best = null;
      for (const w of wants) {
        if (posCopy[w.si] >= HARBOR_POS || w.score === 0) continue;
        const dir = w.score > 0 ? 1 : -1;
        const nxt = posCopy[w.si] + dir;
        if (nxt < 0 || nxt > MAX_POS) continue;
        const mag = Math.abs(w.score);
        if (!best || mag > best.mag) best = { si: w.si, delta: dir, mag };
      }
      if (!best) break;
      posCopy[best.si] += best.delta;
      moves.push({ ship: best.si, delta: best.delta });
    }
    return act(g, pid, { type: 'navigate', moves });
  }

  if (g.stage === 'roll') return act(g, pid, { type: 'roll' });

  if (g.stage === 'pirate_board') {
    // 第 2 次擲骰停 13 格：第 3 次擲骰必過 13 進港，優先免費登上利潤最高的船！
    const cands = boardableShipsFor(g, pid)
      .map((si) => ({ si, s: g.ships[si], payout: GOOD_INFO[g.ships[si].good].payout }))
      .sort((a, b) => b.payout - a.payout);
    if (cands.length) {
      const { si, s } = cands[0];
      const maxSlots = GOOD_INFO[s.good].slots.length;
      if (s.crew.length < maxSlots) return act(g, pid, { type: 'pirateBoard', ship: si });
      const kickIdx = s.crew.findIndex((owner) => owner !== pid);
      if (kickIdx >= 0) return act(g, pid, { type: 'pirateBoard', ship: si, kickIdx });
    }
    return act(g, pid, { type: 'pirateBoard', ship: null });
  }

  if (g.stage === 'pirate_plunder') {
    const pl = g.plunder;
    const shipIdx = pl.mode === 'dest'
      ? pl.ship
      : [...pl.ships].sort((a, b) => GOOD_INFO[g.ships[b].good].payout - GOOD_INFO[g.ships[a].good].payout)[0];
    const good = g.ships[shipIdx].good;
    let harborScore = myShares(good) * 5 + (g.board.harbor.includes(pid) ? 4 : 0) + (g.board.insurance === pid ? 5 : 0);
    let yardScore = (g.board.shipyard.includes(pid) ? 5 : 0) + (g.board.insurance && g.board.insurance !== pid ? 4 : 0);
    const dest = harborScore >= yardScore ? 'harbor' : 'shipyard';
    return act(g, pid, { type: 'pirateDecide', ship: shipIdx, dest });
  }

  return autoPlay(g, pid);
}

// --- 玩家視角 ---
function view(g, pid) {
  const me = playerOf(g, pid);
  return {
    status: g.status,
    rules: g.rules,
    round: g.round,
    stage: g.stage,
    roll: g.roll,
    turn: g.status === 'play' ? g.players[g.turn]?.id ?? null : null,
    master: g.master,
    masterBought: g.masterBought,
    market: Object.fromEntries(GOODS.map((k) => [k, { idx: g.market[k], price: PRICE_TRACK[g.market[k]], buy: buyPrice(g, k) }])),
    supply: { ...g.supply },
    auction: g.stage === 'bid' ? { ...g.auction, passed: [...g.auction.passed] } : null,
    ships: g.ships.map((s, idx) => ({
      idx, good: s.good, pos: s.pos, startPos: s.startPos,
      crew: [...s.crew], plunderedBy: s.plunderedBy ? [...s.plunderedBy] : null, dest: s.dest,
    })),
    board: {
      harbor: [...g.board.harbor],
      shipyard: [...g.board.shipyard],
      insurance: g.board.insurance,
      pirates: [...g.board.pirates],
      navSmall: g.board.navSmall,
      navBig: g.board.navBig,
    },
    pirateSlot: g.pirateSlot,
    plunder: g.plunder ? { mode: g.plunder.mode, ship: g.plunder.ship, ships: [...g.plunder.ships], by: g.plunder.by } : null,
    lastRoll: g.lastRoll,
    nextReady: [...g.nextReady],
    players: g.players.map((p) => ({
      id: p.id, name: p.name, bot: !!p.bot, color: p.color, cash: p.cash, workers: p.workers,
      stockCount: p.stocks.length,
      mortgagedCount: p.stocks.filter((s) => s.mortgaged).length,
      bought: [...p.bought],
      in: p.in, left: !!p.left,
    })),
    myStocks: me ? me.stocks.map((s, idx) => ({ idx, good: s.good, mortgaged: s.mortgaged, public: s.public })) : [],
    ev: g.ev,
    evFeed: g.evFeed.slice(-8),
    summary: g.summary,
    winners: g.winners,
    log: g.log.slice(-20),
  };
}

module.exports = {
  GOODS, GOOD_INFO, PRICE_TRACK, HARBOR_SLOTS, SHIPYARD_SLOTS,
  PIRATE_COST, NAV_SMALL_COST, NAV_BIG_COST, INSURANCE_GAIN, MORTGAGE_GAIN, REDEEM_COST,
  create, act, leave, autoPlay, botPlay, view, performRoll,
};
