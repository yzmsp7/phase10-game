'use strict';
// 瘋狂運動會（Magical Athlete, CMYK / Richard Garfield 版）規則引擎（純邏輯，無 I/O）。
// 介面與 game.js / fuji.js / cats.js / manila.js 相同（create / act / leave / autoPlay / botPlay / view）。
const { randomInt } = require('node:crypto');
const { err, shuffle } = require('./game');

const FINISH = 30;
const SECOND_CORNER = 15;
const GOLD_CHIPS = [3, 4, 5, 6];
const SILVER_CHIPS = [1, 2, 3, 4];

const SCHEDULES = {
  std: ['mild', 'wild', 'mild', 'wild'],
  mild: ['mild', 'mild', 'mild', 'mild'],
  wild: ['wild', 'wild', 'wild', 'wild'],
  wildFirst: ['wild', 'mild', 'wild', 'mild'],
};

// 狂野賽道（Wild Wilds）30 格機關：箭頭（獨立移動）、石頭（絆倒）、星星（+1 銅分）
const WILD_SPACES = {
  3: { type: 'star', label: '⭐ +1分' },
  5: { type: 'arrow', delta: 2, label: '➡️ +2' },
  8: { type: 'trip', label: '🪨 絆倒' },
  10: { type: 'star', label: '⭐ +1分' },
  12: { type: 'arrow', delta: -2, label: '⬅️ -2' },
  14: { type: 'arrow', delta: 3, label: '➡️ +3' },
  16: { type: 'trip', label: '🪨 絆倒' },
  18: { type: 'star', label: '⭐ +1分' },
  20: { type: 'arrow', delta: 2, label: '➡️ +2' },
  23: { type: 'trip', label: '🪨 絆倒' },
  24: { type: 'arrow', delta: -3, label: '⬅️ -3' },
  26: { type: 'star', label: '⭐ +1分' },
  27: { type: 'arrow', delta: 2, label: '➡️ +2' },
  28: { type: 'trip', label: '🪨 絆倒' },
};

// 全部 36 位選手（名稱、英文原名、技能說明與配色完全對應 PDF p.22–25）
const RACERS = [
  { id: 'alchemist', name: '煉金術師', en: 'Alchemist', color: '#e6b800', short: '骰出 1 或 2 可改走 4 格', desc: '主要移動骰出 1 或 2 時，可以改為移動 4 格。' },
  { id: 'baba_yaga', name: '芭芭雅嘎', en: 'Baba Yaga', color: '#4c73c4', short: '與我同格就絆倒對方', desc: '任何選手停在我所在格子，或我停在對方格子時，對方絆倒。' },
  { id: 'banana', name: '香蕉', en: 'Banana', color: '#e6be1c', short: '超越我的選手會絆倒', desc: '任何選手在移動中超越我時，完成移動後會絆倒。' },
  { id: 'blimp', name: '飛船', en: 'Blimp', color: '#d96b38', short: '15格前 +3，之後 −1', desc: '回合開始時若在第 2 轉角（15 格）前，主要移動 +3；在 15 格或之後則 −1。' },
  { id: 'centaur', name: '半人馬', en: 'Centaur', color: '#d64545', short: '超越對手踢退 2 格', desc: '當我移動並超越其他選手時，該選手後退 2 格（最遠退回起點）。' },
  { id: 'cheerleader', name: '啦啦隊長', en: 'Cheerleader', color: '#d4497a', short: '幫最後一名 +2，自己 +1', desc: '主要移動前，可讓所有最後一名選手移動 2 格；若這麼做，我也移動 1 格。' },
  { id: 'coach', name: '教練', en: 'Coach', color: '#2e9e5b', short: '同格所有人主要移動 +1', desc: '和我同格的所有選手（包含我自己），主要移動都獲得 +1。' },
  { id: 'copycat', name: '模仿貓', en: 'Copycat', color: '#3b82c4', short: '持續複製領先者的能力', desc: '我持續擁有目前領先者的能力（平手由我選擇，但不複製「賽前」能力）。' },
  { id: 'dicemonger', name: '骰子商人', en: 'Dicemonger', color: '#b83b6e', short: '誰重骰主要移動我就 +1', desc: '所有選手每回合可重骰主要移動 1 次；每當其他選手重骰時，我移動 1 格。' },
  { id: 'duelist', name: '決鬥家', en: 'Duelist', color: '#b556a8', short: '同格可喊決鬥！贏家 +2', desc: '每當有選手與我同格時，我可喊出決鬥！雙方比骰點，高者移動 2 格（平手我贏）。' },
  { id: 'egg', name: '奇蹟蛋', en: 'Egg', color: '#3aa374', short: '賽前抽 3 張選手挑 1 能力', desc: '比賽開始前，從牌堆抽 3 張新選手並選 1 張，本場獲得其能力（含賽前能力）。', beforeRace: true },
  { id: 'flip_flop', name: '夾腳拖', en: 'Flip Flop', color: '#d9534f', short: '可不擲骰直接與人換位', desc: '可跳過主要移動擲骰，改為與另一位選手同時互換位置（視為傳送，不算移動）。' },
  { id: 'genius', name: '天才', en: 'Genius', color: '#4a5fd4', short: '猜中骰點再多一回合', desc: '主要移動前可預測骰點；若猜中，本回合結束後我立刻再進行一個回合。' },
  { id: 'gunk', name: '黏液怪', en: 'Gunk', color: '#7ea632', short: '所有其他選手主要移動 −1', desc: '其他所有選手的主要移動距離 −1（只減移動格數，不改變骰面點數）。' },
  { id: 'hare', name: '野兔', en: 'Hare', color: '#459ed6', short: '主要移動 +2；獨自領先就睡著', desc: '我的主要移動 +2；但若回合開始時我獨自領先，則跳過本次主要移動。' },
  { id: 'heckler', name: '吐槽怪', en: 'Heckler', color: '#c44690', short: '有人整回合只走 ≤1 格我就 +2', desc: '當任一選手結束回合時，位置與回合開始時相差 ≤1 格，我移動 2 格。' },
  { id: 'huge_baby', name: '巨嬰', en: 'Huge Baby', color: '#d96ba8', short: '誰也不能跟我同格（退後1格）', desc: '除了起點外，沒有人能待在我的格子上；否則將對方放到我身後 1 格（不算移動）。' },
  { id: 'hypnotist', name: '催眠師', en: 'Hypnotist', color: '#c49d27', short: '主要移動前可把一人傳過來', desc: '主要移動前，可選擇另一位選手傳送到我所在的格子（不算移動）。' },
  { id: 'inchworm', name: '尺蠖', en: 'Inchworm', color: '#7a52b8', short: '別人骰 1 取消移動，我 +1', desc: '當其他選手主要移動骰出 1 時，取消該次移動，並由我移動 1 格。' },
  { id: 'lackey', name: '跟班', en: 'Lackey', color: '#c44536', short: '別人骰 6 我搶先 +2', desc: '當其他選手主要移動骰出 6 時，在對方移動前我先移動 2 格。' },
  { id: 'leaptoad', name: '跳蛙', en: 'Leaptoad', color: '#3b88d4', short: '移動時直接跳過有人的格子', desc: '移動過程中，會直接跳過所有有其他選手的格子（不計入步數）。' },
  { id: 'legs', name: '大長腿', en: 'Legs', color: '#2e9968', short: '可不擲骰直接走 5 格', desc: '可跳過主要移動擲骰，改為直接移動 5 格（視為主要移動，會受加減影響）。' },
  { id: 'lovable_loser', name: '可愛魯蛇', en: 'Lovable Loser', color: '#d45a8c', short: '獨自墊底就白拿 1 分', desc: '主要移動前，若我獨自位居最後一名，立刻獲得 1 枚銅分籌碼（+1 分）。' },
  { id: 'magician', name: '魔術師', en: 'Magician', color: '#7b4cc4', short: '主要移動最多可重骰 2 次', desc: '我的主要移動最多可以重骰 2 次，且必須採用最後一次的結果。' },
  { id: 'mastermind', name: '幕後黑手', en: 'Mastermind', color: '#2b8a5c', short: '預言誰拿第一，猜中我直接拿第二', desc: '首回合開始時預言一位冠軍（可選自己）；若猜中，比賽立刻結束且我獲得第 2 名！' },
  { id: 'mouth', name: '大嘴怪', en: 'M.O.U.T.H.', color: '#d43d3d', short: '停在只有 1 人的格子就把他吃掉', desc: '當我停在剛好只有 1 位其他選手的格子時，將對方直接淘汰出本場比賽！' },
  { id: 'party_animal', name: '派對動物', en: 'Party Animal', color: '#cc8b1f', short: '全場向我靠攏 1 格，同格每人 +1', desc: '主要移動前，全場其他選手往我的方向移動 1 格；同格每位對手讓我主要移動 +1。' },
  { id: 'rocket_scientist', name: '火箭科學家', en: 'Rocket Scientist', color: '#d9573b', short: '骰完可選雙倍移動，但會絆倒', desc: '主要移動擲骰後，可選擇移動 2 倍點數；若這麼做，移動結束後我會絆倒。' },
  { id: 'romantic', name: '浪漫主義者', en: 'Romantic', color: '#e0537a', short: '哪格剛好湊成兩人我就 +2', desc: '每當任一選手停在剛好有 1 位其他選手的格子上（兩人同格）時，我移動 2 格。' },
  { id: 'scoocher', name: '挪動怪', en: 'Scoocher', color: '#9c6638', short: '別人每次發動能力我就 +1', desc: '每當其他選手的能力觸發發動時，我移動 1 格。' },
  { id: 'sisyphus', name: '西西弗斯', en: 'Sisyphus', color: '#b87a2e', short: '賽前先拿 4 分；骰 6 退回起點扣 1 分', desc: '賽前先拿 4 分；但主要移動骰出 6 時不移動，改傳送回起點並失去 1 分。', beforeRace: true },
  { id: 'skipper', name: '船長', en: 'Skipper', color: '#2b78a8', short: '任何人骰出 1，下個換我！', desc: '每當任何選手主要移動骰出 1 時，下一個回合直接換我行動（接著依序順時針）。' },
  { id: 'stickler', name: '規則魔人', en: 'Stickler', color: '#4554b8', short: '對手必須剛好步數才能衝線', desc: '其他選手必須移動剛好到終點的格數才能過線；若超過則留在原地不動。' },
  { id: 'suckerfish', name: '吸盤魚', en: 'Suckerfish', color: '#469e5c', short: '同格對手移動時可搭便車', desc: '當與我同格的選手移動時，我可以跟著移動到對方的新格子（也能跟著衝過終點）。' },
  { id: 'third_wheel', name: '電燈泡', en: 'Third Wheel', color: '#2d998c', short: '主要移動前可傳到剛好 2 人的格', desc: '主要移動前，可傳送到任一剛好有 2 位選手的格子，接著照常進行主要移動。' },
  { id: 'twin', name: '雙胞胎', en: 'Twin', color: '#c45e9c', short: '賽前複製先前場次的冠軍能力', desc: '比賽開始前，可選擇一位先前場次奪冠的選手並獲得其能力（含賽前能力）。', beforeRace: true },
];

const RACER_MAP = Object.fromEntries(RACERS.map((r) => [r.id, r]));
const PCOLORS = ['#e63946', '#2a7de1', '#27a85d', '#e59f1a', '#8c4dd6', '#e05a9f'];

const log = (g, m) => { g.log.push(m); if (g.log.length > 80) g.log.shift(); };
const playerOf = (g, id) => g.players.find((p) => p.id === id);
const indexOf = (g, id) => g.players.findIndex((p) => p.id === id);
const racerOf = (g, rid) => g.racers.find((r) => r.id === rid);
const activePlayers = (g) => g.players.filter((p) => p.in);
const activeRacers = (g) => g.racers.filter((r) => r.active);
const nextIn = (g, i) => {
  const n = g.players.length;
  for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (g.players[j].in) return j; }
  return i;
};

function totalPoints(p) {
  const gs = p.golds.reduce((a, x) => a + x, 0);
  const ss = p.silvers.reduce((a, x) => a + x, 0);
  return Math.max(0, gs + ss + p.bronze);
}

function addBronze(g, pid, delta) {
  const p = playerOf(g, pid);
  if (!p) return 0;
  if (delta >= 0) {
    p.bronze += delta;
    p.racePts = (p.racePts || 0) + delta;
    return delta;
  }
  const cur = totalPoints(p);
  const lose = Math.min(cur, -delta);
  if (lose > 0) {
    p.bronze -= lose;
    p.racePts = (p.racePts || 0) - lose;
  }
  return -lose;
}

// 官方比骰決定先手（PDF p.12）：最高者勝；若最高平手則由次高者勝；若全部平手則重骰
function rollOff(ids) {
  for (let tries = 0; tries < 20; tries++) {
    const rolls = ids.map((id) => ({ id, d: randomInt(1, 7) }));
    const counts = {};
    for (const r of rolls) counts[r.d] = (counts[r.d] || 0) + 1;
    const uniques = rolls.filter((r) => counts[r.d] === 1).sort((a, b) => b.d - a.d);
    if (uniques.length) return { winner: uniques[0].id, rolls };
  }
  const rolls = ids.map((id) => ({ id, d: randomInt(1, 7) }));
  return { winner: ids[randomInt(ids.length)], rolls };
}

function emit(g, ev) {
  g.evNo++;
  const item = { no: g.evNo, ...ev };
  g.ev = item;
  g.evFeed.push(item);
  if (g.evFeed.length > 36) g.evFeed.shift();
  // 估算前端動畫播放毫秒數，供電腦玩家自動留出觀賞時間
  if (ev.kind === 'roll') g.lastAnimMs = (g.lastAnimMs || 0) + 2100;
  else if (ev.kind === 'duel') g.lastAnimMs = (g.lastAnimMs || 0) + 2500;
  else if (ev.kind === 'move') g.lastAnimMs = (g.lastAnimMs || 0) + Math.abs((ev.to ?? 0) - (ev.from ?? 0)) * 270 + 250;
  else if (ev.kind === 'warp' || ev.kind === 'swap' || ev.kind === 'partyMove') g.lastAnimMs = (g.lastAnimMs || 0) + 520;
}

function racerLabel(g, r) {
  const base = RACER_MAP[r.base];
  const cp = r.copiedPower ? RACER_MAP[r.copiedPower] : null;
  const p = playerOf(g, r.ownerId);
  return `${base.name}${cp ? `(${cp.name})` : ''}[${p?.name ?? '?'}]`;
}

// 取得選手當前生效的能力 ID（支援 Egg / Twin / Copycat）
function leadRacers(g) {
  const act = activeRacers(g);
  if (!act.length) return [];
  const maxPos = Math.max(...act.map((r) => r.pos));
  return act.filter((r) => r.pos === maxPos);
}

function lastRacers(g) {
  const act = activeRacers(g);
  if (!act.length) return [];
  const minPos = Math.min(...act.map((r) => r.pos));
  return act.filter((r) => r.pos === minPos);
}

function effectivePower(g, r, depth = 0) {
  if (!r || !r.active || depth > 4) return null;
  let pid = r.base;
  if (pid === 'egg' || pid === 'twin') pid = r.copiedPower || null;
  if (!pid) return null;
  if (pid === 'copycat') {
    const leads = leadRacers(g).filter((x) => x.id !== r.id);
    if (!leads.length) return null;
    let target = leads.find((x) => x.id === r.copyTarget);
    if (!target) target = leads[0];
    const copied = effectivePower(g, target, depth + 1);
    if (!copied || copied === 'egg' || copied === 'twin') return null;
    return copied;
  }
  return pid;
}

function hasPower(g, r, pid) {
  return effectivePower(g, r) === pid;
}

// 取得場上擁有某能力的活著選手（順序：原版擁有者優先於 Copycat，再依行動順位）
function racersWithPower(g, pid, curRacerId = null) {
  const list = activeRacers(g).filter((r) => hasPower(g, r, pid));
  const curIdx = g.activePlayerIdx ?? 0;
  const n = g.players.length;
  const pri = (r) => {
    const isOrig = r.base === pid || r.copiedPower === pid ? 0 : 1; // 原版優先於 Copycat（PDF p.22）
    const isCur = r.id === curRacerId ? 0 : 1;
    const pIdx = indexOf(g, r.ownerId);
    const dist = (pIdx - curIdx + n) % n;
    return isOrig * 1000 + isCur * 100 + dist * 10 + (r.slot || 0);
  };
  return list.sort((a, b) => pri(a) - pri(b));
}

function orderByTurn(g, racers, curRacerId = null) {
  const curIdx = g.activePlayerIdx ?? 0;
  const n = g.players.length;
  return [...racers].sort((a, b) => {
    const ca = a.id === curRacerId ? 0 : 1, cb = b.id === curRacerId ? 0 : 1;
    if (ca !== cb) return ca - cb;
    const da = (indexOf(g, a.ownerId) - curIdx + n) % n;
    const db = (indexOf(g, b.ownerId) - curIdx + n) % n;
    return da - db || (a.slot || 0) - (b.slot || 0);
  });
}

// 更新 Copycat 目標；若領先平手且有 ≥2 位其他選手可選，回傳需要詢問的 Copycat
function syncCopycats(g) {
  const leads = leadRacers(g);
  for (const r of activeRacers(g)) {
    const base = (r.base === 'egg' || r.base === 'twin') ? r.copiedPower : r.base;
    if (base !== 'copycat') continue;
    const cands = leads.filter((x) => x.id !== r.id);
    if (!cands.length) {
      r.copyTarget = null;
    } else if (cands.length === 1) {
      r.copyTarget = cands[0].id;
    } else if (!cands.some((x) => x.id === r.copyTarget)) {
      // 領先者平手且原本目標已不在領先群：預設先指第一位，並在佇列讓模仿貓玩家可挑
      r.copyTarget = cands[0].id;
      const key = cands.map((x) => x.id).sort().join(',');
      if (r._lastCopyTie !== key) {
        r._lastCopyTie = key;
        g.queue.push({ kind: 'copycatPick', racerId: r.id, cands: cands.map((x) => x.id) });
      }
    }
  }
}

// 同步目前輪到誰操作（給 server.js 倒數計時 & AI Bot 排程）
function syncTurn(g) {
  if (g.status !== 'play') return;
  let pid = null;
  if (g.stage === 'rollOff') {
    const waiting = activePlayers(g).find((p) => !g.rollOff?.ready.includes(p.id));
    pid = waiting ? waiting.id : g.players[g.activePlayerIdx]?.id;
  } else if (g.stage === 'draft') {
    pid = g.draft.order[g.draft.idx];
  } else if (g.stage === 'select') {
    const waiting = activePlayers(g).find((p) => !p.selected);
    pid = waiting ? waiting.id : g.players[g.activePlayerIdx].id;
  } else if (g.prompt) {
    pid = g.prompt.pid;
  } else {
    pid = g.players[g.activePlayerIdx]?.id;
  }
  const idx = indexOf(g, pid);
  if (idx >= 0) g.turn = idx;
}

function create(players, { schedule = 'std', double3p = false } = {}) {
  const sched = SCHEDULES[schedule] ? schedule : 'std';
  const n = players.length;
  const mode = n === 2 ? '2p' : (n === 3 && double3p) ? '3p2' : 'std';
  const doubleMode = mode !== 'std';
  const ps = players.map(({ id, name }, i) => ({
    id, name, color: i % PCOLORS.length, in: true, left: false,
    roster: [], used: [], selected: null,
    golds: [], silvers: [], bronze: 0, racePts: 0, turnsTaken: 0,
  }));
  const deck = shuffle(RACERS.map((r) => r.id));
  const g = {
    status: 'play', stage: 'rollOff', mode, doubleMode,
    scheduleKey: sched, schedule: [...SCHEDULES[sched]],
    race: 0, track: SCHEDULES[sched][0],
    turn: 0, turnNo: 1, evNo: 0, ev: null, evFeed: [], log: [],
    players: ps, deck, prevWinners: [],
    rollOff: null, draft: null, racers: [], finishers: [], eliminated: [], firstEliminatedOwner: null,
    activePlayerIdx: 0, activeRacerId: null, usedRacersThisTurn: [],
    turnCtx: null, queue: [], prompt: null, skipperNext: null,
    nextReady: [], summary: null, winners: null,
  };
  startDraft(g);
  return g;
}

// --- 選秀比骰與蛇行選秀階段（Snake Draft，完全依 PDF p.12 & p.26） ---
function startDraft(g) {
  const act = activePlayers(g);
  const ro = rollOff(act.map((p) => p.id));
  const startIdx = indexOf(g, ro.winner);
  const roTxt = ro.rolls.map((x) => `${playerOf(g, x.id).name} 🎲${x.d}`).join('、');
  log(g, `🎲 選秀比骰：${roTxt} → ${playerOf(g, ro.winner).name} 先選！`);
  emit(g, { kind: 'rollOff', rolls: ro.rolls, winner: ro.winner, title: `${playerOf(g, ro.winner).name} 贏得先選權！`, sub: roTxt, tone: 'gold' });

  // 等待全體玩家看完比骰結果並按下確認後，再正式進入第 1 輪蛇行選秀
  g.stage = 'rollOff';
  g.rollOff = { purpose: 'draft', rolls: ro.rolls, winner: ro.winner, startIdx, ready: [] };
  syncTurn(g);
  g.turnNo++;
}

function enterDraft(g) {
  let startIdx = g.rollOff?.startIdx ?? 0;
  if (!g.players[startIdx]?.in) startIdx = nextIn(g, startIdx);
  g.rollOff = null;
  const totalRounds = g.mode === '3p2' ? 4 : 2;
  g.draft = { round: 1, totalRounds, startIdx, pool: [], order: [], idx: 0 };
  setupDraftRound(g);
}

function setupDraftRound(g) {
  const act = activePlayers(g);
  const n = act.length;
  const d = g.draft;
  const clockwise = Array.from({ length: n }, (_, k) => {
    let idx = d.startIdx;
    for (let s = 0; s < k; s++) idx = nextIn(g, idx);
    return g.players[idx].id;
  });

  if (g.mode === '2p') {
    // 2 人變體（PDF p.26）：翻 8 張，ABBAABBA；第 2 輪再翻 8 張，反序 BAABBAAB
    const [A, B] = d.round === 1 ? clockwise : [clockwise[1], clockwise[0]];
    d.pool = g.deck.splice(0, 8);
    d.order = [A, B, B, A, A, B, B, A];
  } else {
    // 3–6 人標準（翻 2N 張，蛇行選 2 輪）或 3 人雙選手（翻 6 張，蛇行選 4 輪）
    d.pool = g.deck.splice(0, n * 2);
    d.order = [...clockwise, ...[...clockwise].reverse()];
  }
  d.idx = 0;
  g.stage = 'draft';
  syncTurn(g);
  g.turnNo++;
  log(g, `📋 第 ${d.round}/${d.totalRounds} 輪蛇行選秀開始（${d.pool.length} 位選手登場），由 ${playerOf(g, d.order[0]).name} 先選`);
}

function handleDraftPick(g, pid, racerId) {
  if (g.stage !== 'draft') err('目前不在選秀階段');
  const d = g.draft;
  const expected = d.order[d.idx];
  if (pid !== expected) err('還沒輪到你選選手');
  const i = d.pool.indexOf(racerId);
  if (i < 0) err('這張選手卡不在本輪選池裡');
  d.pool.splice(i, 1);
  const p = playerOf(g, pid);
  p.roster.push(racerId);
  const info = RACER_MAP[racerId];
  log(g, `✨ ${p.name} 招募了「${info.name} ${info.en}」`);
  emit(g, { kind: 'draft', by: pid, racer: racerId, title: `${p.name} 選了 ${info.name}`, sub: info.short, tone: 'blue' });

  d.idx++;
  // 跳過已離開的玩家
  while (d.idx < d.order.length && !playerOf(g, d.order[d.idx])?.in) d.idx++;

  if (d.idx >= d.order.length || !d.pool.length) {
    if (d.round < d.totalRounds) {
      d.round++;
      d.startIdx = nextIn(g, d.startIdx);
      setupDraftRound(g);
    } else {
      beginRaceSelect(g, null);
    }
  } else {
    syncTurn(g);
    g.turnNo++;
  }
}

// --- 賽前同時秘密出戰選擇（Select） ---
function beginRaceSelect(g, nextStarterIdx) {
  g.race++;
  g.track = g.schedule[g.race - 1] || 'mild';
  g.status = 'play';
  g.stage = 'select';
  g.summary = null;
  g.nextReady = [];
  g.racers = [];
  g.finishers = [];
  g.eliminated = [];
  g.firstEliminatedOwner = null;
  g.queue = [];
  g.prompt = null;
  g.turnCtx = null;
  g.skipperNext = null;
  g.activeRacerId = null;
  g.usedRacersThisTurn = [];

  for (const p of g.players) {
    p.selected = null;
    p.racePts = 0;
    p.turnsTaken = 0;
  }

  if (nextStarterIdx == null || !g.players[nextStarterIdx]?.in) {
    const act = activePlayers(g);
    const ro = rollOff(act.map((p) => p.id));
    g.activePlayerIdx = indexOf(g, ro.winner);
    const roTxt = ro.rolls.map((x) => `${playerOf(g, x.id).name} 🎲${x.d}`).join('、');
    log(g, `🏁 第 ${g.race}/4 場（${g.track === 'wild' ? '🌋 狂野賽道' : '🌼 溫和賽道'}）！比骰決定先手：${roTxt} → ${playerOf(g, ro.winner).name} 先攻！`);
    emit(g, { kind: 'rollOff', rolls: ro.rolls, winner: ro.winner, tag: '先攻', title: `第 ${g.race} 場：${playerOf(g, ro.winner).name} 先攻！`, sub: roTxt, tone: 'gold' });
  } else {
    g.activePlayerIdx = nextStarterIdx;
    log(g, `🏁 第 ${g.race}/4 場（${g.track === 'wild' ? '🌋 狂野賽道' : '🌼 溫和賽道'}）！本場由 ${g.players[g.activePlayerIdx].name} 先攻！`);
  }

  // 最後一場若剛好只剩需要出戰的數量，不強制自動選，讓玩家可確認（但電腦玩家會立刻選好）
  syncTurn(g);
  g.turnNo++;
}

function handleSelectRacers(g, pid, racers) {
  if (g.stage !== 'select') err('目前不在出戰選擇階段');
  const p = playerOf(g, pid);
  if (!p?.in) err('玩家不在場上');
  const need = g.doubleMode ? 2 : 1;
  if (!Array.isArray(racers) || racers.length !== need) err(`請選擇 ${need} 位選手出戰`);
  if (new Set(racers).size !== need) err('不能重複選同一位選手');
  const avail = p.roster.filter((id) => !p.used.includes(id));
  for (const r of racers) {
    if (!avail.includes(r)) err('只能選擇尚未出賽的選手');
  }
  p.selected = [...racers];
  if (activePlayers(g).every((x) => x.selected)) {
    revealAndStartRace(g);
  } else {
    syncTurn(g);
  }
}

function handleUnselectRacers(g, pid) {
  if (g.stage !== 'select') err('目前不在出戰選擇階段');
  const p = playerOf(g, pid);
  if (!p?.in) err('玩家不在場上');
  p.selected = null;
  syncTurn(g);
}

function revealAndStartRace(g) {
  const act = activePlayers(g);
  // 依座位順序建立參賽選手
  g.racers = [];
  const names = [];
  for (const p of act) {
    p.selected.forEach((rid, slot) => {
      p.used.push(rid);
      g.racers.push({
        id: `${p.id}:${rid}`,
        ownerId: p.id,
        base: rid,
        slot,
        pos: 0,
        tripped: false,
        active: true,
        finished: false,
        eliminated: false,
        finishOrder: null,
        copiedPower: null,
        copyTarget: null,
        mastermindPicked: false,
        mastermindTarget: null,
        turnStartPos: 0,
        _lastCopyTie: null,
      });
      names.push(`${p.name}派出「${RACER_MAP[rid].name}」`);
    });
    p.selected = null;
  }
  log(g, `📣 同時翻牌亮出陣容：${names.join('、')}`);
  emit(g, { kind: 'reveal', title: `第 ${g.race}/4 場選手全員就位！`, sub: names.join(' · '), tone: 'gold' });

  // 建立賽前能力（beforeRace）佇列：從先攻玩家開始順時針
  g.stage = 'beforeRace';
  g.queue = [];
  const ordered = orderByTurn(g, activeRacers(g));
  for (const r of ordered) {
    if (r.base === 'egg' || r.base === 'twin' || r.base === 'sisyphus') {
      g.queue.push({ kind: 'beforeRace', racerId: r.id });
    }
  }
  advanceBeforeRace(g);
}

function advanceBeforeRace(g) {
  while (g.queue.length) {
    const task = g.queue.shift();
    const r = racerOf(g, task.racerId);
    if (!r || !r.active) continue;
    const pid = r.copiedPower || r.base;
    if (pid === 'egg' && !r.copiedPower) {
      const choices = g.deck.splice(0, 3);
      if (choices.length) {
        g.prompt = { kind: 'eggPick', pid: r.ownerId, racerId: r.id, choices };
        syncTurn(g);
        g.turnNo++;
        return;
      }
    } else if (pid === 'twin' && !r.copiedPower) {
      const uniq = [...new Set(g.prevWinners)];
      if (uniq.length) {
        g.prompt = { kind: 'twinPick', pid: r.ownerId, racerId: r.id, choices: uniq };
        syncTurn(g);
        g.turnNo++;
        return;
      }
      log(g, `👯 ${racerLabel(g, r)} 尚未有前場冠軍可複製`);
    } else if (pid === 'sisyphus') {
      addBronze(g, r.ownerId, 4);
      log(g, `🪨 ${racerLabel(g, r)} 賽前獲得 4 枚銅分籌碼（+4 分）！`);
      emit(g, { kind: 'power', by: r.ownerId, racer: r.base, title: `${racerLabel(g, r)} +4 分`, sub: '西西弗斯賽前先領 4 分', tone: 'gold' });
    }
  }
  g.prompt = null;
  g.stage = 'race';
  syncCopycats(g);
  // 若賽前有 Copycat 平手不需急著彈窗，開始第一回合
  g.queue = [];
  beginPlayerTurn(g);
}

// --- 比賽回合流程 ---
function beginPlayerTurn(g) {
  if (g.status !== 'play') return;
  // 確保 activePlayerIdx 有活著的選手
  const n = g.players.length;
  let found = -1;
  for (let k = 0; k < n; k++) {
    const idx = (g.activePlayerIdx + k) % n;
    const p = g.players[idx];
    if (p.in && activeRacers(g).some((r) => r.ownerId === p.id)) { found = idx; break; }
  }
  if (found < 0) return finishRace(g);
  g.activePlayerIdx = found;
  g.usedRacersThisTurn = [];
  const p = g.players[g.activePlayerIdx];
  const mine = activeRacers(g).filter((r) => r.ownerId === p.id);

  if (mine.length === 1) {
    startRacerTurn(g, mine[0]);
  } else {
    // 雙選手模式：讓玩家選擇先動哪位（2 人局首回合只需選 1 位）
    const onlyOne = g.mode === '2p' && p.turnsTaken === 0;
    g.prompt = { kind: 'pickRacer', pid: p.id, racerIds: mine.map((r) => r.id), onlyOne };
    syncTurn(g);
    g.turnNo++;
  }
}

function startRacerTurn(g, r) {
  if (g.status !== 'play') return;
  if (!r || !r.active) return advanceAfterRacerTurn(g);
  g.activeRacerId = r.id;
  if (!g.usedRacersThisTurn.includes(r.id)) g.usedRacersThisTurn.push(r.id);
  r.turnStartPos = r.pos;
  g.turnCtx = {
    racerId: r.id,
    phase: 'start',
    roll: null,
    finalRoll: null,
    dicemongerUsed: false,
    magicianRerolls: 0,
    geniusGuess: null,
    blimpMod: null,
    alchemistUsed: false,
    rocketUsed: false,
    legsUsed: false,
    extraTurn: false,
    beforeDone: {},
    loopCounts: {},
    steps: 0,
  };
  g.queue = [];
  syncCopycats(g);
  continueTurn(g);
}

// 主驅動器：先清完中斷/連鎖事件佇列，再推進當前回合的下一個階段
function continueTurn(g) {
  while (g.status === 'play') {
    // 1. 先處理佇列裡的連鎖事件（賽道機關、能力觸發、決鬥、吸盤魚等）
    if (g.queue.length) {
      if (processNextQueued(g)) return; // 需要等待玩家輸入（已設 g.prompt）
      continue;
    }
    if (g.status !== 'play') return;

    const ctx = g.turnCtx;
    if (!ctx) return beginPlayerTurn(g);
    const r = racerOf(g, ctx.racerId);

    // 若主動選手已完賽或被淘汰，直接結束該選手回合
    if (!r || !r.active) {
      ctx.phase = 'done';
    }

    if (ctx.phase === 'start') {
      // 幕後黑手首回合必選預言（即使絆倒也是首回合開始）
      if (hasPower(g, r, 'mastermind') && !r.mastermindPicked) {
        r.mastermindPicked = true;
        g.prompt = { kind: 'mastermindPick', pid: r.ownerId, racerId: r.id, targets: activeRacers(g).map((x) => x.id) };
        syncTurn(g);
        g.turnNo++;
        return;
      }
      // 飛船在回合開始時判定是否在 15 格前
      if (hasPower(g, r, 'blimp')) {
        ctx.blimpMod = r.pos < SECOND_CORNER ? 3 : -1;
      }
      // 檢查是否絆倒：爬起來並跳過主要移動（不擲骰，但回合結束仍會觸發吐槽怪！）
      if (r.tripped) {
        r.tripped = false;
        log(g, `🩹 ${racerLabel(g, r)} 從絆倒中爬起（跳過本次主要移動）`);
        emit(g, { kind: 'recover', by: r.ownerId, racer: r.base, title: `${racerLabel(g, r)} 爬起來了`, sub: '跳過本次主要移動', tone: 'blue' });
        ctx.phase = 'turnEnd';
        continue;
      }
      // 野兔：若回合開始時獨自領先，跳過主要移動！
      if (hasPower(g, r, 'hare')) {
        const leads = leadRacers(g);
        if (leads.length === 1 && leads[0].id === r.id) {
          log(g, `🐰 ${racerLabel(g, r)} 獨自領先太得意，在賽道打瞌睡（跳過本次主要移動）！`);
          emit(g, { kind: 'power', by: r.ownerId, racer: r.base, title: `${racerLabel(g, r)} 打瞌睡了！`, sub: '野兔獨自領先時跳過主要移動', tone: 'gold' });
          triggerScoocher(g, r, 'hare');
          ctx.phase = 'turnEnd';
          continue;
        }
      }
      ctx.phase = 'beforeMain';
      continue;
    }

    if (ctx.phase === 'beforeMain') {
      // 可愛魯蛇（強制）：獨自最後一名 +1 分
      if (hasPower(g, r, 'lovable_loser') && !ctx.beforeDone.lovable_loser) {
        ctx.beforeDone.lovable_loser = true;
        const lasts = lastRacers(g);
        if (lasts.length === 1 && lasts[0].id === r.id) {
          addBronze(g, r.ownerId, 1);
          log(g, `🐌 ${racerLabel(g, r)} 獨自墊底，獲得 1 枚銅分籌碼（+1 分）！`);
          emit(g, { kind: 'power', by: r.ownerId, racer: r.base, title: `${racerLabel(g, r)} 魯蛇加分 +1`, sub: '獨自最後一名獲得 1 分', tone: 'gold' });
          triggerScoocher(g, r, 'lovable_loser');
          continue;
        }
      }
      // 派對動物（強制）：全場其他選手往我方向移動 1 格
      if (hasPower(g, r, 'party_animal') && !ctx.beforeDone.party_animal) {
        ctx.beforeDone.party_animal = true;
        const others = orderByTurn(g, activeRacers(g).filter((x) => x.id !== r.id && x.pos !== r.pos), r.id);
        if (others.length) {
          log(g, `🎉 ${racerLabel(g, r)} 開趴！全場選手向第 ${r.pos} 格靠攏 1 格！`);
          emit(g, { kind: 'power', by: r.ownerId, racer: r.base, title: `${racerLabel(g, r)} 開派對！`, sub: '所有對手向其靠攏 1 格', tone: 'gold' });
          triggerScoocher(g, r, 'party_animal');
          // 同時移動：先全部更新位置，再依順位結算停格效果
          const moved = [];
          for (const o of others) {
            const d = o.pos < r.pos ? 1 : -1;
            const from = o.pos;
            const to = Math.max(0, Math.min(FINISH - 1, from + d));
            if (to !== from) {
              o.pos = to;
              moved.push({ r: o, from, to });
            }
          }
          if (moved.length) {
            emit(g, { kind: 'partyMove', by: r.ownerId, racer: r.base, reason: '派對靠攏', moves: moved.map((m) => ({ racerId: m.r.id, from: m.from, to: m.to })) });
          }
          for (const m of moved) {
            queueAfterStep(g, m.r, m.from, m.to, { isMain: false, silentMove: true });
          }
          continue;
        }
      }
      // 啦啦隊長（可選）
      if (hasPower(g, r, 'cheerleader') && !ctx.beforeDone.cheerleader) {
        ctx.beforeDone.cheerleader = true;
        const lasts = lastRacers(g);
        if (lasts.length) {
          g.prompt = { kind: 'cheerleader', pid: r.ownerId, racerId: r.id, lastIds: lasts.map((x) => x.id) };
          syncTurn(g);
          g.turnNo++;
          return;
        }
      }
      // 催眠師（可選）
      if (hasPower(g, r, 'hypnotist') && !ctx.beforeDone.hypnotist) {
        ctx.beforeDone.hypnotist = true;
        const targets = activeRacers(g).filter((x) => x.id !== r.id && x.pos !== r.pos);
        if (targets.length) {
          g.prompt = { kind: 'hypnotist', pid: r.ownerId, racerId: r.id, targets: targets.map((x) => x.id) };
          syncTurn(g);
          g.turnNo++;
          return;
        }
      }
      // 電燈泡（可選）
      if (hasPower(g, r, 'third_wheel') && !ctx.beforeDone.third_wheel) {
        ctx.beforeDone.third_wheel = true;
        const spaces = [];
        for (let sp = 0; sp < FINISH; sp++) {
          const here = activeRacers(g).filter((x) => x.pos === sp);
          if (here.length === 2 && !here.some((x) => x.id === r.id)) spaces.push(sp);
        }
        if (spaces.length) {
          g.prompt = { kind: 'thirdWheel', pid: r.ownerId, racerId: r.id, spaces };
          syncTurn(g);
          g.turnNo++;
          return;
        }
      }
      ctx.phase = 'chooseMain';
      continue;
    }

    if (ctx.phase === 'chooseMain') {
      const canLegs = hasPower(g, r, 'legs');
      const flipTargets = hasPower(g, r, 'flip_flop') ? activeRacers(g).filter((x) => x.id !== r.id).map((x) => x.id) : [];
      const canGenius = hasPower(g, r, 'genius');
      g.prompt = { kind: 'mainAction', pid: r.ownerId, racerId: r.id, canLegs, flipTargets, canGenius };
      syncTurn(g);
      g.turnNo++;
      return;
    }

    if (ctx.phase === 'afterRoll') {
      const canMag = hasPower(g, r, 'magician') && ctx.magicianRerolls < 2;
      const dmList = racersWithPower(g, 'dicemonger', r.id);
      const canDM = dmList.length > 0 && !ctx.dicemongerUsed;
      if (canMag || canDM) {
        g.prompt = {
          kind: 'reroll', pid: r.ownerId, racerId: r.id, roll: ctx.roll,
          canMag, magLeft: 2 - ctx.magicianRerolls,
          canDM, dmSelf: dmList.some((x) => x.id === r.id),
        };
        syncTurn(g);
        g.turnNo++;
        return;
      }
      ctx.phase = 'commitRoll';
      continue;
    }

    if (ctx.phase === 'commitRoll') {
      ctx.finalRoll = ctx.roll;
      const d = ctx.finalRoll;
      // 天才預測檢查
      if (ctx.geniusGuess != null) {
        if (ctx.geniusGuess === d) {
          ctx.extraTurn = true;
          log(g, `🧠 ${racerLabel(g, r)} 神預測骰出 ${d}！本回合結束後再多跑一回合！`);
          emit(g, { kind: 'power', by: r.ownerId, racer: r.base, title: `${racerLabel(g, r)} 預測命中！`, sub: `猜中 ${d} 點，額外獲得一回合`, tone: 'gold' });
          triggerScoocher(g, r, 'genius');
        } else {
          log(g, `🧠 ${racerLabel(g, r)} 預測 ${ctx.geniusGuess}，實際骰出 ${d}（沒猜中）`);
        }
        ctx.geniusGuess = null;
      }
      // 西西弗斯：骰 6 不移動，傳回起點並扣 1 分
      if (hasPower(g, r, 'sisyphus') && d === 6) {
        const lost = addBronze(g, r.ownerId, -1);
        log(g, `🪨 ${racerLabel(g, r)} 骰出 6！巨石滾落，傳送回起點${lost ? '並失去 1 分' : ''}！`);
        emit(g, { kind: 'power', by: r.ownerId, racer: r.base, title: `${racerLabel(g, r)} 巨石滾落！`, sub: `骰出 6 回到起點${lost ? ' −1 分' : ''}`, tone: 'red' });
        triggerScoocher(g, r, 'sisyphus');
        warpRacer(g, r, 0);
        ctx.phase = 'turnEnd';
        continue;
      }
      // 船長：任何人骰出 1，下個換船長
      if (d === 1) {
        const skippers = racersWithPower(g, 'skipper', r.id);
        if (skippers.length) {
          g.skipperNext = skippers[0].id;
          log(g, `⛵ ${racerLabel(g, skippers[0])} 發動船長權限！有人骰到 1，下個立刻換他！`);
          emit(g, { kind: 'power', by: skippers[0].ownerId, racer: skippers[0].base, title: `${racerLabel(g, skippers[0])} 搶先插隊！`, sub: '有人骰出 1，下回合換船長', tone: 'blue' });
          triggerScoocher(g, skippers[0], 'skipper');
        }
        // 尺蠖：其他選手骰 1 跳過該次主要移動，尺蠖走 1
        const worms = racersWithPower(g, 'inchworm', r.id).filter((x) => x.id !== r.id);
        if (worms.length) {
          for (const w of worms) {
            log(g, `🐛 ${racerLabel(g, w)} 發動！${racerLabel(g, r)} 骰出 1 取消移動，尺蠖前進 1 格！`);
            emit(g, { kind: 'power', by: w.ownerId, racer: w.base, title: `${racerLabel(g, w)} 偷跑 +1`, sub: `${racerLabel(g, r)} 骰到 1 被取消移動`, tone: 'red' });
            triggerScoocher(g, w, 'inchworm');
            g.queue.push({ kind: 'move', racerId: w.id, delta: 1, reason: '尺蠖' });
          }
          ctx.phase = 'turnEnd';
          continue;
        }
      }
      // 跟班：其他選手骰 6，在對方移動前先走 2
      if (d === 6) {
        const lackeys = racersWithPower(g, 'lackey', r.id).filter((x) => x.id !== r.id);
        for (const lk of lackeys) {
          log(g, `🙇 ${racerLabel(g, lk)} 緊緊跟隨！${racerLabel(g, r)} 骰出 6，跟班搶先移動 2 格！`);
          emit(g, { kind: 'power', by: lk.ownerId, racer: lk.base, title: `${racerLabel(g, lk)} 搶先 +2`, sub: `${racerLabel(g, r)} 骰出 6`, tone: 'gold' });
          triggerScoocher(g, lk, 'lackey');
          g.queue.push({ kind: 'move', racerId: lk.id, delta: 2, reason: '跟班' });
        }
      }
      ctx.phase = 'postRollOpt';
      continue;
    }

    if (ctx.phase === 'postRollOpt') {
      const d = ctx.finalRoll;
      // 煉金術師：骰 1 或 2 可改走 4
      if (hasPower(g, r, 'alchemist') && (d === 1 || d === 2) && !ctx.beforeDone.alchemist) {
        ctx.beforeDone.alchemist = true;
        g.prompt = { kind: 'alchemist', pid: r.ownerId, racerId: r.id, roll: d };
        syncTurn(g);
        g.turnNo++;
        return;
      }
      // 火箭科學家：骰完可選雙倍但會絆倒
      if (hasPower(g, r, 'rocket_scientist') && !ctx.beforeDone.rocket) {
        ctx.beforeDone.rocket = true;
        g.prompt = { kind: 'rocket', pid: r.ownerId, racerId: r.id, roll: d };
        syncTurn(g);
        g.turnNo++;
        return;
      }
      ctx.phase = 'doMainMove';
      continue;
    }

    if (ctx.phase === 'doMainMove') {
      let base = ctx.legsUsed ? 5 : ctx.alchemistUsed ? 4 : ctx.rocketUsed ? ctx.finalRoll * 2 : ctx.finalRoll;
      let mod = 0;
      const notes = [];
      if (ctx.legsUsed) { notes.push('大長腿=5'); triggerScoocher(g, r, 'legs'); }
      if (ctx.alchemistUsed) { notes.push('煉金=4'); triggerScoocher(g, r, 'alchemist'); }
      if (ctx.rocketUsed) { notes.push(`火箭×2=${base}`); triggerScoocher(g, r, 'rocket_scientist'); }
      // 飛船
      if (ctx.blimpMod != null) {
        mod += ctx.blimpMod;
        notes.push(`飛船${ctx.blimpMod > 0 ? `+${ctx.blimpMod}` : ctx.blimpMod}`);
        triggerScoocher(g, r, 'blimp');
      }
      // 野兔 +2
      if (hasPower(g, r, 'hare')) {
        mod += 2;
        notes.push('野兔+2');
        triggerScoocher(g, r, 'hare');
      }
      // 教練（同格所有選手 +1，含自己）
      const coaches = racersWithPower(g, 'coach', r.id).filter((c) => c.pos === r.pos);
      for (const c of coaches) {
        mod += 1;
        notes.push('教練+1');
        triggerScoocher(g, c, 'coach');
      }
      // 黏液怪（其他所有選手 -1）
      const gunks = racersWithPower(g, 'gunk', r.id).filter((x) => x.id !== r.id);
      for (const gk of gunks) {
        mod -= 1;
        notes.push('黏液-1');
        triggerScoocher(g, gk, 'gunk');
      }
      // 派對動物（同格每位其他選手 +1）
      if (hasPower(g, r, 'party_animal')) {
        const mates = activeRacers(g).filter((x) => x.id !== r.id && x.pos === r.pos).length;
        if (mates > 0) {
          mod += mates;
          notes.push(`派對+${mates}`);
        }
      }

      const total = Math.max(0, base + mod);
      const modStr = notes.length ? `（${notes.join('、')}）` : '';
      log(g, `🏃 ${racerLabel(g, r)} 主要移動 ${total} 格${modStr}`);
      moveRacer(g, r, total, { isMain: true, tripAfter: ctx.rocketUsed });
      ctx.phase = 'turnEnd';
      continue;
    }

    if (ctx.phase === 'turnEnd') {
      // 吐槽怪：任一選手結束回合時，離回合開始位置 ≤1 格，吐槽怪前進 2 格
      if (r && r.active && Math.abs(r.pos - r.turnStartPos) <= 1) {
        const hecklers = racersWithPower(g, 'heckler', r.id);
        for (const h of hecklers) {
          log(g, `😜 ${racerLabel(g, h)} 嘲笑 ${racerLabel(g, r)} 原地踏步，吐槽怪前進 2 格！`);
          emit(g, { kind: 'power', by: h.ownerId, racer: h.base, title: `${racerLabel(g, h)} 吐槽衝刺 +2`, sub: `${racerLabel(g, r)} 本回合移動 ≤1 格`, tone: 'gold' });
          triggerScoocher(g, h, 'heckler');
          g.queue.push({ kind: 'move', racerId: h.id, delta: 2, reason: '吐槽怪' });
        }
      }
      ctx.phase = 'done';
      continue;
    }

    if (ctx.phase === 'done') {
      const extra = ctx.extraTurn && r && r.active;
      g.turnCtx = null;
      if (extra) {
        startRacerTurn(g, r);
        return;
      }
      advanceAfterRacerTurn(g);
      return;
    }
  }
}

function advanceAfterRacerTurn(g) {
  if (g.status !== 'play') return;
  const p = g.players[g.activePlayerIdx];
  // 若船長插隊生效：
  if (g.skipperNext) {
    const sk = racerOf(g, g.skipperNext);
    g.skipperNext = null;
    if (sk && sk.active) {
      if (p) p.turnsTaken++;
      g.activePlayerIdx = indexOf(g, sk.ownerId);
      g.usedRacersThisTurn = [];
      startRacerTurn(g, sk);
      return;
    }
  }
  // 雙選手模式：同一位玩家還要移動第 2 位選手（2 人局首回合例外，只動 1 位）
  if (g.doubleMode && p?.in && !(g.mode === '2p' && p.turnsTaken === 0)) {
    const rest = activeRacers(g).filter((r) => r.ownerId === p.id && !g.usedRacersThisTurn.includes(r.id));
    if (rest.length === 1) {
      startRacerTurn(g, rest[0]);
      return;
    }
    if (rest.length > 1) {
      g.prompt = { kind: 'pickRacer', pid: p.id, racerIds: rest.map((x) => x.id), onlyOne: false };
      syncTurn(g);
      g.turnNo++;
      return;
    }
  }
  if (p) p.turnsTaken++;
  g.activePlayerIdx = nextIn(g, g.activePlayerIdx);
  beginPlayerTurn(g);
}

// --- 移動、傳送與連鎖事件佇列 ---
function triggerScoocher(g, sourceRacer, powerId) {
  if (g.status !== 'play') return;
  const scoochers = racersWithPower(g, 'scoocher', g.activeRacerId).filter((s) => s.id !== sourceRacer?.id);
  for (const s of scoochers) {
    // 無限迴圈防護（PDF p.21 細則 #8）：同一輪中同一個 (scoocher, sourcePower, pos) 若重複 ≥2 次，完成一次迴圈後結束
    const key = `sc:${s.id}:${powerId}:${s.pos}`;
    if (g.turnCtx) {
      g.turnCtx.loopCounts[key] = (g.turnCtx.loopCounts[key] || 0) + 1;
      if (g.turnCtx.loopCounts[key] > 1) {
        log(g, `♾️ 偵測到能力循環（${racerLabel(g, s)}），依規則完成一次後中止循環`);
        continue;
      }
    }
    g.queue.push({ kind: 'move', racerId: s.id, delta: 1, reason: `挪動(${RACER_MAP[powerId]?.name || powerId})` });
  }
}

function moveRacer(g, r, delta, opts = {}) {
  if (g.status !== 'play' || !r || !r.active) return false;
  if (!delta) return false; // 規則 #4：移動 0 不算移動！
  if (g.turnCtx) {
    g.turnCtx.steps++;
    if (g.turnCtx.steps > 80) return false;
  }

  const from = r.pos;
  const dir = delta > 0 ? 1 : -1;
  let steps = Math.abs(delta);
  let cur = from;
  let skipped = 0;
  const isLeap = hasPower(g, r, 'leaptoad');

  if (isLeap) {
    while (steps > 0) {
      cur += dir;
      while (cur > 0 && cur < FINISH && activeRacers(g).some((x) => x.id !== r.id && x.pos === cur)) {
        skipped++;
        cur += dir;
      }
      steps--;
      if (dir < 0 && cur <= 0) { cur = 0; break; }
    }
  } else {
    cur = from + delta;
  }

  // 規則魔人（Stickler）：其他選手超過終點則原地不動！
  if (dir > 0 && cur > FINISH) {
    const sticklers = racersWithPower(g, 'stickler', r.id).filter((x) => x.id !== r.id);
    if (sticklers.length) {
      log(g, `📏 ${racerLabel(g, sticklers[0])} 發動！${racerLabel(g, r)} 步數超過終點，留在第 ${from} 格不動！`);
      emit(g, { kind: 'power', by: sticklers[0].ownerId, racer: sticklers[0].base, title: '規則魔人擋下衝線！', sub: `${racerLabel(g, r)} 必須剛好停在終點`, tone: 'red' });
      triggerScoocher(g, sticklers[0], 'stickler');
      if (opts.tripAfter) r.tripped = true;
      return false;
    }
  }

  const to = Math.max(0, Math.min(FINISH, cur));
  if (to === from) {
    if (opts.tripAfter) r.tripped = true;
    return false;
  }

  r.pos = to;
  if (opts.tripAfter) {
    r.tripped = true;
    log(g, `💥 ${racerLabel(g, r)} 火箭噴射過度，著陸後絆倒了！`);
  }
  if (skipped > 0) {
    log(g, `🐸 ${racerLabel(g, r)} 跳蛙跨過 ${skipped} 個有人的格子，落點第 ${to >= FINISH ? '終點' : to} 格！`);
    for (let k = 0; k < skipped; k++) triggerScoocher(g, r, 'leaptoad');
  }
  emit(g, { kind: 'move', by: r.ownerId, racerId: r.id, racer: r.base, from, to, reason: opts.reason || (opts.isMain ? '主要移動' : '移動') });
  syncCopycats(g);

  // 吸盤魚：同格的對手移動時，可詢問是否搭便車（即使衝過終點也可跟！）
  const suckers = racersWithPower(g, 'suckerfish', r.id).filter((sf) => sf.id !== r.id && sf.pos === from);
  for (const sf of suckers) {
    g.queue.push({ kind: 'suckerfish', racerId: sf.id, targetPos: to, leaderId: r.id });
  }

  // 超越判定（Passing：起點在後、終點在前）
  if (dir > 0) {
    const passed = orderByTurn(g, activeRacers(g).filter((o) => o.id !== r.id && from < o.pos && o.pos < to), r.id);
    for (const o of passed) {
      // 半人馬（主動選手優先）：踢退對方 2 格
      if (hasPower(g, r, 'centaur')) {
        log(g, `🐴 ${racerLabel(g, r)} 飛踢！超越 ${racerLabel(g, o)}，把對方踢退 2 格！`);
        emit(g, { kind: 'power', by: r.ownerId, racer: r.base, title: `${racerLabel(g, r)} 飛踢！`, sub: `${racerLabel(g, o)} 被踢退 2 格`, tone: 'red' });
        triggerScoocher(g, r, 'centaur');
        g.queue.push({ kind: 'move', racerId: o.id, delta: -2, reason: '半人馬飛踢' });
      }
      // 香蕉（其他選手）：超越香蕉者絆倒
      if (hasPower(g, o, 'banana') && to < FINISH) {
        r.tripped = true;
        log(g, `🍌 ${racerLabel(g, r)} 超越 ${racerLabel(g, o)} 踩到香蕉皮滑倒了！`);
        emit(g, { kind: 'power', by: o.ownerId, racer: o.base, title: `${racerLabel(g, r)} 踩到香蕉！`, sub: '下回合跳過主要移動', tone: 'red' });
        triggerScoocher(g, o, 'banana');
      }
    }
  }

  // 檢查衝過終點線
  if (to >= FINISH) {
    handleCrossFinish(g, r);
    return true;
  }

  queueAfterStep(g, r, from, to, opts);
  return true;
}

function warpRacer(g, r, toPos) {
  if (g.status !== 'play' || !r || !r.active) return;
  const from = r.pos;
  const to = Math.max(0, Math.min(FINISH - 1, toPos));
  r.pos = to;
  emit(g, { kind: 'warp', by: r.ownerId, racerId: r.id, racer: r.base, from, to });
  syncCopycats(g);
  queueAfterStep(g, r, from, to, { isWarp: true });
}

function queueAfterStep(g, r, _from, to, _opts = {}) {
  if (g.status !== 'play' || !r.active || to >= FINISH) return;
  // 優先順序 1：賽道特殊格（Wild Wilds）
  if (g.track === 'wild' && WILD_SPACES[to]) {
    g.queue.push({ kind: 'trackSpace', racerId: r.id, pos: to });
  }
  // 優先順序 2–3：停格能力（巨嬰、芭芭雅嘎、大嘴怪、浪漫主義者、決鬥家）
  g.queue.push({ kind: 'stopCheck', racerId: r.id, pos: to });
}

function processNextQueued(g) {
  if (!g.queue.length || g.status !== 'play') return false;
  // 依 PDF p.15 排序：trackSpace → 巨嬰（立即排斥）→ 其餘照佇列順序
  const trackIdx = g.queue.findIndex((t) => t.kind === 'trackSpace');
  const task = trackIdx >= 0 ? g.queue.splice(trackIdx, 1)[0] : g.queue.shift();

  if (task.kind === 'trackSpace') {
    const r = racerOf(g, task.racerId);
    if (!r || !r.active || r.pos !== task.pos) return false;
    const sp = WILD_SPACES[task.pos];
    if (!sp) return false;
    if (sp.type === 'star') {
      addBronze(g, r.ownerId, 1);
      log(g, `⭐ ${racerLabel(g, r)} 停在狂野星星格（${task.pos}），獲得 1 枚銅分籌碼（+1 分）！`);
      emit(g, { kind: 'star', by: r.ownerId, racer: r.base, title: `${racerLabel(g, r)} 踩到星星 +1 分`, sub: `狂野賽道第 ${task.pos} 格`, tone: 'gold' });
    } else if (sp.type === 'trip') {
      r.tripped = true;
      log(g, `🪨 ${racerLabel(g, r)} 踩到狂野石頭格（${task.pos}）絆倒了！`);
      emit(g, { kind: 'trip', by: r.ownerId, racer: r.base, title: `${racerLabel(g, r)} 踢到石頭絆倒！`, sub: `狂野賽道第 ${task.pos} 格`, tone: 'red' });
    } else if (sp.type === 'arrow') {
      log(g, `➡️ ${racerLabel(g, r)} 踩到狂野箭頭格（${task.pos}），移動 ${sp.delta > 0 ? `+${sp.delta}` : sp.delta} 格！`);
      moveRacer(g, r, sp.delta, { reason: `箭頭(${sp.delta > 0 ? `+${sp.delta}` : sp.delta})` });
    }
    return false;
  }

  if (task.kind === 'move') {
    const r = racerOf(g, task.racerId);
    if (r && r.active) moveRacer(g, r, task.delta, { reason: task.reason });
    return false;
  }

  if (task.kind === 'stopCheck') {
    const r = racerOf(g, task.racerId);
    if (!r || !r.active || r.pos !== task.pos) return false;
    const pos = task.pos;

    // 1) 巨嬰（Huge Baby）：除起點(0)外沒人能同格，原版優先於 Copycat
    if (pos > 0) {
      const babies = racersWithPower(g, 'huge_baby', r.id).filter((b) => b.pos === pos);
      if (babies.length) {
        const hb = babies[0]; // 原版巨嬰優先
        const others = activeRacers(g).filter((x) => x.pos === pos && x.id !== hb.id);
        if (others.length) {
          for (const o of others) {
            o.pos = pos - 1;
            log(g, `👶 ${racerLabel(g, hb)} 體型太巨大！${racerLabel(g, o)} 被擠到身後第 ${o.pos} 格！`);
            emit(g, { kind: 'warp', by: o.ownerId, racerId: o.id, racer: o.base, from: pos, to: o.pos, reason: '巨嬰擠開' });
            emit(g, { kind: 'power', by: hb.ownerId, racer: hb.base, title: `${racerLabel(g, hb)} 擠開對手！`, sub: `${racerLabel(g, o)} 被推至第 ${o.pos} 格`, tone: 'red' });
            triggerScoocher(g, hb, 'huge_baby');
            queueAfterStep(g, o, pos, o.pos, { isWarp: true });
          }
          syncCopycats(g);
          // 若 r 本身已被擠走，後面原格檢查不再觸發
          if (r.pos !== pos) return false;
        }
      }
    }

    const onSpace = activeRacers(g).filter((x) => x.pos === pos);
    const othersHere = onSpace.filter((x) => x.id !== r.id);

    // 2) 決鬥家（Duelist）：同格可先喊決鬥（即使和芭芭雅嘎同格也能決鬥，但仍會絆倒，PDF p.22）
    const duelists = racersWithPower(g, 'duelist', r.id).filter((dl) => dl.pos === pos);
    for (const dl of duelists) {
      const foes = activeRacers(g).filter((x) => x.pos === pos && x.id !== dl.id);
      for (const foe of foes) {
        const dKey = `duel:${dl.id}:${foe.id}:${pos}`;
        if (g.turnCtx && !g.turnCtx.loopCounts[dKey]) {
          g.turnCtx.loopCounts[dKey] = 1;
          g.queue.unshift({ kind: 'duelistPrompt', racerId: dl.id, foeId: foe.id, pos });
        }
      }
    }

    // 3) 芭芭雅嘎（Baba Yaga）：停在她格上或她停在別人格上 → 絆倒對方
    if (othersHere.length) {
      if (hasPower(g, r, 'baba_yaga')) {
        for (const o of othersHere) {
          o.tripped = true;
          log(g, `🏚️ ${racerLabel(g, r)} 停在 ${racerLabel(g, o)} 格上，把對方絆倒了！`);
          triggerScoocher(g, r, 'baba_yaga');
        }
      }
      for (const o of othersHere) {
        if (hasPower(g, o, 'baba_yaga')) {
          r.tripped = true;
          log(g, `🏚️ ${racerLabel(g, r)} 停在 ${racerLabel(g, o)} 格上，被芭芭雅嘎絆倒了！`);
          triggerScoocher(g, o, 'baba_yaga');
        }
      }
    }

    // 4) 大嘴怪（M.O.U.T.H.）：大嘴怪停在「剛好 1 位其他選手」的格子時吃掉對方！
    if (hasPower(g, r, 'mouth') && othersHere.length === 1) {
      const victim = othersHere[0];
      victim.active = false;
      victim.eliminated = true;
      g.eliminated.push(victim.id);
      if (!g.firstEliminatedOwner) g.firstEliminatedOwner = victim.ownerId;
      log(g, `👄 ${racerLabel(g, r)} 一口吃掉了 ${racerLabel(g, victim)}！${racerLabel(g, victim)} 本場淘汰！`);
      emit(g, { kind: 'chomp', by: r.ownerId, racer: r.base, title: `👄 ${racerLabel(g, victim)} 被吃掉了！`, sub: `${racerLabel(g, r)} 發動大嘴怪淘汰對手`, tone: 'red' });
      triggerScoocher(g, r, 'mouth');
      syncCopycats(g);
      // 檢查是否只剩 0 人在場且已有 1 位完賽（銀徽章作廢）
      if (g.finishers.length >= 1 && activeRacers(g).length === 0) {
        finishRace(g);
        return false;
      }
    }

    // 5) 浪漫主義者（Romantic）：當有人停在剛好與 1 位其他選手同格（該格總人數 === 2）
    const nowOnSpace = activeRacers(g).filter((x) => x.pos === pos);
    if (nowOnSpace.length === 2 && r.active) {
      const romantics = racersWithPower(g, 'romantic', r.id);
      for (const rom of romantics) {
        const key = `rom:${rom.id}:${pos}:${r.id}:${rom.pos}`;
        if (g.turnCtx) {
          g.turnCtx.loopCounts[key] = (g.turnCtx.loopCounts[key] || 0) + 1;
          if (g.turnCtx.loopCounts[key] > 1) continue;
        }
        log(g, `💕 ${racerLabel(g, rom)} 看到第 ${pos} 格兩人獨處，心花怒放前進 2 格！`);
        emit(g, { kind: 'power', by: rom.ownerId, racer: rom.base, title: `${racerLabel(g, rom)} 浪漫加速 +2`, sub: `第 ${pos} 格剛好兩人同格`, tone: 'gold' });
        triggerScoocher(g, rom, 'romantic');
        g.queue.push({ kind: 'move', racerId: rom.id, delta: 2, reason: '浪漫加速' });
      }
    }
    return false;
  }

  if (task.kind === 'suckerfish') {
    const sf = racerOf(g, task.racerId);
    if (!sf || !sf.active || sf.pos === task.targetPos) return false;
    g.prompt = { kind: 'suckerfish', pid: sf.ownerId, racerId: sf.id, targetPos: task.targetPos, leaderId: task.leaderId };
    syncTurn(g);
    g.turnNo++;
    return true;
  }

  if (task.kind === 'duelistPrompt') {
    const dl = racerOf(g, task.racerId), foe = racerOf(g, task.foeId);
    if (!dl || !foe || !dl.active || !foe.active || dl.pos !== foe.pos) return false;
    g.prompt = { kind: 'duelist', pid: dl.ownerId, racerId: dl.id, foeId: foe.id };
    syncTurn(g);
    g.turnNo++;
    return true;
  }

  if (task.kind === 'copycatPick') {
    const cc = racerOf(g, task.racerId);
    const leads = leadRacers(g).filter((x) => x.id !== cc?.id);
    if (!cc || !cc.active || leads.length < 2) return false;
    g.prompt = { kind: 'copycatPick', pid: cc.ownerId, racerId: cc.id, cands: leads.map((x) => x.id) };
    syncTurn(g);
    g.turnNo++;
    return true;
  }

  return false;
}

function handleCrossFinish(g, r) {
  r.active = false;
  r.finished = true;
  r.pos = FINISH;
  r.finishOrder = g.finishers.length + 1;
  g.finishers.push(r.id);
  log(g, `🏆 ${racerLabel(g, r)} 衝過終點線，奪得第 ${r.finishOrder} 名！`);
  emit(g, { kind: 'finish', by: r.ownerId, racer: r.base, place: r.finishOrder, title: `🏁 ${racerLabel(g, r)} 衝線第 ${r.finishOrder} 名！`, sub: r.finishOrder === 1 ? `金盃 +${GOLD_CHIPS[g.race - 1]} 分` : `銀徽章 +${SILVER_CHIPS[g.race - 1]} 分`, tone: 'gold' });

  // 幕後黑手（Mastermind）檢查：第 1 名剛誕生時，若預言命中則立刻結束比賽且幕後黑手拿第 2 名！
  if (g.finishers.length === 1) {
    // 包含幕後黑手自己預言自己拿第 1 名（PDF p.24 FAQ：可同時拿第 1 和第 2！）
    const mms = g.racers.filter((x) => (x.active || x.id === r.id) && x.mastermindTarget === r.id && (x.base === 'mastermind' || x.copiedPower === 'mastermind' || (x.base === 'copycat' && x.mastermindPicked)));
    if (mms.length) {
      const mm = mms[0];
      mm.active = false;
      mm.finished = true;
      g.finishers.push(mm.id);
      log(g, `🕶️ ${racerLabel(g, mm)} 預言成真！比賽立刻結束，${racerLabel(g, mm)} 直接獲得第 2 名！`);
      emit(g, { kind: 'power', by: mm.ownerId, racer: mm.base, title: `🕶️ 幕後黑手預言命中！`, sub: `${racerLabel(g, mm)} 直接奪下第 2 名！`, tone: 'gold' });
      return finishRace(g);
    }
  }

  // 第 2 名衝線，或場上只剩 0 位活著的選手 → 比賽立刻結束
  // 但若第 1 名剛衝線且有吸盤魚正在佇列等著搭便車，先讓吸盤魚表態！
  if (g.finishers.length >= 2 || (activeRacers(g).length === 0 && !g.queue.some((q) => q.kind === 'suckerfish'))) {
    finishRace(g);
  }
}

function finishRace(g) {
  if (g.status !== 'play') return;
  g.queue = [];
  g.prompt = null;
  g.turnCtx = null;

  const goldVal = GOLD_CHIPS[g.race - 1];
  const silverVal = SILVER_CHIPS[g.race - 1];
  const first = g.finishers[0] ? racerOf(g, g.finishers[0]) : null;
  const second = g.finishers[1] ? racerOf(g, g.finishers[1]) : null;

  if (first) {
    const p1 = playerOf(g, first.ownerId);
    if (p1) { p1.golds.push(goldVal); p1.racePts += goldVal; }
    // 記錄冠軍選手供「雙胞胎」在後續場次複製
    const winBase = first.base === 'egg' || first.base === 'twin' ? (first.copiedPower || first.base) : first.base;
    if (winBase && winBase !== 'twin') g.prevWinners.push(winBase);
  }
  if (second) {
    const p2 = playerOf(g, second.ownerId);
    if (p2) { p2.silvers.push(silverVal); p2.racePts += silverVal; }
  }

  // 計算下一場先攻玩家
  let nextStarterIdx = g.activePlayerIdx;
  if (g.race < 4) {
    const act = activePlayers(g);
    if (g.mode === '2p' && act.length === 2) {
      // 2 人變體（PDF p.26）：本場得分較低者先攻；同分則比骰
      if (act[0].racePts < act[1].racePts) nextStarterIdx = indexOf(g, act[0].id);
      else if (act[1].racePts < act[0].racePts) nextStarterIdx = indexOf(g, act[1].id);
      else nextStarterIdx = indexOf(g, rollOff(act.map((p) => p.id)).winner);
    } else if (g.firstEliminatedOwner && playerOf(g, g.firstEliminatedOwner)?.in) {
      // PDF p.18：首位被淘汰者優先先攻
      nextStarterIdx = indexOf(g, g.firstEliminatedOwner);
    } else {
      const rem = activeRacers(g);
      if (rem.length) {
        const minPos = Math.min(...rem.map((x) => x.pos));
        const behindOwners = [...new Set(rem.filter((x) => x.pos === minPos).map((x) => x.ownerId))];
        nextStarterIdx = behindOwners.length === 1 ? indexOf(g, behindOwners[0]) : indexOf(g, rollOff(behindOwners).winner);
      } else {
        nextStarterIdx = nextIn(g, g.activePlayerIdx);
      }
    }
  }
  g.nextStarterIdx = nextStarterIdx;

  const rows = g.players.filter((p) => !p.left).map((p) => ({
    id: p.id, name: p.name, color: p.color,
    racePts: p.racePts, total: totalPoints(p),
    golds: [...p.golds], silvers: [...p.silvers], bronze: p.bronze,
  })).sort((a, b) => b.total - a.total || b.racePts - a.racePts);

  g.summary = {
    race: g.race, track: g.track,
    first: first ? { id: first.id, ownerId: first.ownerId, base: first.base, copiedPower: first.copiedPower, pts: goldVal } : null,
    second: second ? { id: second.id, ownerId: second.ownerId, base: second.base, copiedPower: second.copiedPower, pts: silverVal } : null,
    silverDiscarded: !second,
    nextStarter: g.race < 4 ? g.players[nextStarterIdx]?.id : null,
    rows,
  };

  if (g.race >= 4) {
    g.status = 'over';
    const maxPts = Math.max(...rows.map((x) => x.total));
    g.winners = rows.filter((x) => x.total === maxPts).map((x) => x.id);
    log(g, `🎉 4 場賽事全數結束！總冠軍：${g.winners.map((id) => playerOf(g, id).name).join('、')}（${maxPts} 分）！`);
  } else {
    g.status = 'raceEnd';
    g.nextReady = [];
    log(g, `🏁 第 ${g.race}/4 場結束！第 1 名 ${first ? racerLabel(g, first) : '無'}（+${goldVal}）、第 2 名 ${second ? racerLabel(g, second) : '從缺'}`);
  }
  g.turnNo++;
}

// --- 動作處理入口 ---
function act(g, pid, a) {
  if (!a || typeof a !== 'object') err('無效的動作');
  g.lastAnimMs = 0;
  if (g.status === 'raceEnd') {
    if (a.type !== 'next') err('請先按準備進入下一場比賽');
    const p = playerOf(g, pid);
    if (!p?.in) err('玩家不在場上');
    if (!g.nextReady.includes(pid)) g.nextReady.push(pid);
    if (activePlayers(g).every((x) => g.nextReady.includes(x.id))) {
      beginRaceSelect(g, g.nextStarterIdx);
    }
    return;
  }
  if (g.status !== 'play') err('遊戲已結束');

  if (g.stage === 'rollOff') {
    if (a.type !== 'rollOffOk') err('請先按確認開始選秀');
    const p = playerOf(g, pid);
    if (!p?.in) err('玩家不在場上');
    if (!g.rollOff.ready.includes(pid)) g.rollOff.ready.push(pid);
    if (activePlayers(g).every((x) => g.rollOff.ready.includes(x.id))) {
      enterDraft(g);
    } else {
      syncTurn(g);
    }
    return;
  }
  if (g.stage === 'draft') {
    if (a.type !== 'draftPick') err('請選擇要招募的選手');
    return handleDraftPick(g, pid, a.racer);
  }
  if (g.stage === 'select') {
    if (a.type === 'selectRacers') return handleSelectRacers(g, pid, a.racers);
    if (a.type === 'unselectRacers') return handleUnselectRacers(g, pid);
    err('請選擇本場出戰選手');
  }

  const pr = g.prompt;
  if (!pr) err('目前不需要操作');
  if (pr.pid !== pid) err('還沒輪到你操作');

  // 賽前選擇（Egg / Twin）
  if (pr.kind === 'eggPick') {
    if (a.type !== 'eggPick' || !pr.choices.includes(a.racer)) err('請從 3 位選手中選 1 位');
    const r = racerOf(g, pr.racerId);
    r.copiedPower = a.racer;
    g.prompt = null;
    log(g, `🥚 ${playerOf(g, pid).name} 的奇蹟蛋孵化出「${RACER_MAP[a.racer].name}」的能力！`);
    emit(g, { kind: 'power', by: pid, racer: 'egg', title: `奇蹟蛋孵化：${RACER_MAP[a.racer].name}！`, sub: RACER_MAP[a.racer].short, tone: 'gold' });
    if (a.racer === 'sisyphus' || a.racer === 'twin') g.queue.unshift({ kind: 'beforeRace', racerId: r.id });
    return advanceBeforeRace(g);
  }
  if (pr.kind === 'twinPick') {
    if (a.type !== 'twinPick') err('請選擇要複製的前場冠軍');
    const r = racerOf(g, pr.racerId);
    if (a.racer) {
      if (!pr.choices.includes(a.racer)) err('無效的選手選擇');
      r.copiedPower = a.racer;
      log(g, `👯 ${playerOf(g, pid).name} 的雙胞胎複製了前冠軍「${RACER_MAP[a.racer].name}」的能力！`);
      emit(g, { kind: 'power', by: pid, racer: 'twin', title: `雙胞胎複製：${RACER_MAP[a.racer].name}`, sub: RACER_MAP[a.racer].short, tone: 'gold' });
      if (a.racer === 'sisyphus') g.queue.unshift({ kind: 'beforeRace', racerId: r.id });
    } else {
      log(g, `👯 ${playerOf(g, pid).name} 的雙胞胎放棄複製`);
    }
    g.prompt = null;
    return advanceBeforeRace(g);
  }

  // 雙選手模式：選擇先移動哪位選手
  if (pr.kind === 'pickRacer') {
    if (a.type !== 'pickRacer' || !pr.racerIds.includes(a.racerId)) err('請選擇要行動的選手');
    const r = racerOf(g, a.racerId);
    g.prompt = null;
    return startRacerTurn(g, r);
  }

  // 幕後黑手預言
  if (pr.kind === 'mastermindPick') {
    if (a.type !== 'mastermindPick' || !pr.targets.includes(a.targetId)) err('請選擇預言冠軍');
    const r = racerOf(g, pr.racerId), tgt = racerOf(g, a.targetId);
    r.mastermindTarget = tgt.id;
    g.prompt = null;
    log(g, `🕶️ ${racerLabel(g, r)} 預言「${racerLabel(g, tgt)}」將奪得本場冠軍！`);
    emit(g, { kind: 'power', by: pid, racer: r.base, title: `幕後黑手下達預言！`, sub: `看好 ${racerLabel(g, tgt)} 奪冠`, tone: 'blue' });
    triggerScoocher(g, r, 'mastermind');
    return continueTurn(g);
  }

  // 啦啦隊長
  if (pr.kind === 'cheerleader') {
    if (a.type !== 'cheerleader') err('請決定是否加油');
    const r = racerOf(g, pr.racerId);
    g.prompt = null;
    if (a.use) {
      const lasts = lastRacers(g);
      log(g, `📣 ${racerLabel(g, r)} 大聲加油！${lasts.map((x) => racerLabel(g, x)).join('、')} 前進 2 格，自己前進 1 格！`);
      emit(g, { kind: 'power', by: pid, racer: r.base, title: `${racerLabel(g, r)} 啦啦隊加油！`, sub: '墊底選手 +2，自己 +1', tone: 'gold' });
      triggerScoocher(g, r, 'cheerleader');
      for (const l of orderByTurn(g, lasts, r.id)) g.queue.push({ kind: 'move', racerId: l.id, delta: 2, reason: '啦啦隊加油' });
      g.queue.push({ kind: 'move', racerId: r.id, delta: 1, reason: '啦啦隊鼓舞' });
    }
    return continueTurn(g);
  }

  // 催眠師
  if (pr.kind === 'hypnotist') {
    if (a.type !== 'hypnotist') err('請決定是否施展催眠');
    const r = racerOf(g, pr.racerId);
    g.prompt = null;
    if (a.targetId) {
      if (!pr.targets.includes(a.targetId)) err('無效的目標選手');
      const tgt = racerOf(g, a.targetId);
      log(g, `🌀 ${racerLabel(g, r)} 施展催眠！將 ${racerLabel(g, tgt)} 傳送到第 ${r.pos} 格！`);
      emit(g, { kind: 'power', by: pid, racer: r.base, title: `${racerLabel(g, r)} 催眠傳送！`, sub: `${racerLabel(g, tgt)} 被拉到第 ${r.pos} 格`, tone: 'blue' });
      triggerScoocher(g, r, 'hypnotist');
      warpRacer(g, tgt, r.pos);
    }
    return continueTurn(g);
  }

  // 電燈泡
  if (pr.kind === 'thirdWheel') {
    if (a.type !== 'thirdWheel') err('請決定是否傳送');
    const r = racerOf(g, pr.racerId);
    g.prompt = null;
    if (a.space != null) {
      if (!pr.spaces.includes(a.space)) err('該格目前不是剛好 2 位選手');
      log(g, `💡 ${racerLabel(g, r)} 當電燈泡！直接傳送到第 ${a.space} 格！`);
      emit(g, { kind: 'power', by: pid, racer: r.base, title: `${racerLabel(g, r)} 電燈泡插花！`, sub: `傳送到第 ${a.space} 格`, tone: 'blue' });
      triggerScoocher(g, r, 'third_wheel');
      warpRacer(g, r, a.space);
    }
    return continueTurn(g);
  }

  // 主要行動（擲骰 / 大長腿走5 / 夾腳拖換位）
  if (pr.kind === 'mainAction') {
    const r = racerOf(g, pr.racerId);
    const ctx = g.turnCtx;
    if (a.type === 'roll') {
      if (a.guess != null) {
        if (!pr.canGenius || !Number.isInteger(a.guess) || a.guess < 1 || a.guess > 6) err('無效的預測點數');
        ctx.geniusGuess = a.guess;
      }
      g.prompt = null;
      ctx.roll = randomInt(1, 7);
      log(g, `🎲 ${racerLabel(g, r)} 擲出 ${ctx.roll} 點${ctx.geniusGuess ? `（預測 ${ctx.geniusGuess}）` : ''}`);
      emit(g, { kind: 'roll', by: pid, racerId: r.id, racer: r.base, d: ctx.roll, from: r.pos, guess: ctx.geniusGuess, title: `${racerLabel(g, r)} 擲出 ${ctx.roll} 點`, tone: 'gold' });
      ctx.phase = 'afterRoll';
      return continueTurn(g);
    }
    if (a.type === 'legs') {
      if (!pr.canLegs) err('目前不能使用大長腿');
      g.prompt = null;
      ctx.legsUsed = true;
      ctx.phase = 'doMainMove';
      return continueTurn(g);
    }
    if (a.type === 'flipFlop') {
      if (!pr.flipTargets.includes(a.targetId)) err('無效的換位對象');
      const tgt = racerOf(g, a.targetId);
      g.prompt = null;
      const pA = r.pos, pB = tgt.pos;
      r.pos = pB;
      tgt.pos = pA;
      log(g, `🩴 ${racerLabel(g, r)} 與 ${racerLabel(g, tgt)} 夾腳拖互換位置（${pA} ↔ ${pB}）！`);
      emit(g, { kind: 'swap', by: pid, racer: r.base, racerA: r.id, fromA: pA, toA: pB, racerB: tgt.id, fromB: pB, toB: pA, reason: '夾腳拖換位', title: `${racerLabel(g, r)} 換位傳送！`, sub: `與 ${racerLabel(g, tgt)} 互換位置（${pA}↔${pB}）`, tone: 'blue' });
      triggerScoocher(g, r, 'flip_flop');
      syncCopycats(g);
      queueAfterStep(g, r, pA, pB, { isWarp: true });
      queueAfterStep(g, tgt, pB, pA, { isWarp: true });
      ctx.phase = 'turnEnd';
      return continueTurn(g);
    }
    err('無效的主要行動');
  }

  // 重骰詢問（魔術師 / 骰子商人）
  if (pr.kind === 'reroll') {
    const r = racerOf(g, pr.racerId);
    const ctx = g.turnCtx;
    if (a.type === 'keepRoll') {
      g.prompt = null;
      ctx.phase = 'commitRoll';
      return continueTurn(g);
    }
    if (a.type === 'rerollMag') {
      if (!pr.canMag) err('魔術師重骰次數已用完');
      g.prompt = null;
      ctx.magicianRerolls++;
      ctx.roll = randomInt(1, 7);
      log(g, `🎩 ${racerLabel(g, r)} 施展魔術重骰 → 骰出 ${ctx.roll} 點！`);
      emit(g, { kind: 'roll', by: pid, racerId: r.id, racer: r.base, d: ctx.roll, from: r.pos, reroll: 'mag', title: `${racerLabel(g, r)} 魔術重骰：${ctx.roll} 點`, tone: 'gold' });
      triggerScoocher(g, r, 'magician');
      ctx.phase = 'afterRoll';
      return continueTurn(g);
    }
    if (a.type === 'rerollDM') {
      if (!pr.canDM) err('本回合已使用過骰子商人重骰');
      g.prompt = null;
      ctx.dicemongerUsed = true;
      ctx.roll = randomInt(1, 7);
      log(g, `🎰 ${racerLabel(g, r)} 使用骰子商人重骰 → 骰出 ${ctx.roll} 點！`);
      emit(g, { kind: 'roll', by: pid, racerId: r.id, racer: r.base, d: ctx.roll, from: r.pos, reroll: 'dm', title: `${racerLabel(g, r)} 商人重骰：${ctx.roll} 點`, tone: 'gold' });
      const dms = racersWithPower(g, 'dicemonger', r.id);
      for (const dm of dms) {
        triggerScoocher(g, dm, 'dicemonger');
        if (dm.id !== r.id) {
          log(g, `🎰 有人重骰！${racerLabel(g, dm)} 趁機前進 1 格！`);
          g.queue.push({ kind: 'move', racerId: dm.id, delta: 1, reason: '骰子商人' });
        }
      }
      ctx.phase = 'afterRoll';
      return continueTurn(g);
    }
    err('無效的重骰動作');
  }

  // 煉金術師
  if (pr.kind === 'alchemist') {
    if (a.type !== 'alchemist') err('請選擇是否改走 4 格');
    g.prompt = null;
    if (a.use) g.turnCtx.alchemistUsed = true;
    g.turnCtx.phase = 'postRollOpt';
    return continueTurn(g);
  }

  // 火箭科學家
  if (pr.kind === 'rocket') {
    if (a.type !== 'rocket') err('請選擇是否雙倍噴射');
    g.prompt = null;
    if (a.use) g.turnCtx.rocketUsed = true;
    g.turnCtx.phase = 'doMainMove';
    return continueTurn(g);
  }

  // 吸盤魚搭便車
  if (pr.kind === 'suckerfish') {
    if (a.type !== 'suckerfish') err('請決定是否搭便車');
    const sf = racerOf(g, pr.racerId);
    const tgtPos = pr.targetPos;
    g.prompt = null;
    if (a.use && sf?.active) {
      const dist = tgtPos - sf.pos;
      log(g, `🐟 ${racerLabel(g, sf)} 緊緊吸住！跟著移動到${tgtPos >= FINISH ? '終點' : `第 ${tgtPos} 格`}！`);
      emit(g, { kind: 'power', by: pid, racer: sf.base, title: `${racerLabel(g, sf)} 搭便車！`, sub: `跟著移動到${tgtPos >= FINISH ? '終點' : `第 ${tgtPos} 格`}`, tone: 'blue' });
      triggerScoocher(g, sf, 'suckerfish');
      if (dist !== 0) moveRacer(g, sf, dist, { reason: '吸盤魚搭便車' });
    }
    // 若第 1 名已衝線且場上沒活人了，檢查結算
    if (g.status === 'play' && g.finishers.length >= 1 && activeRacers(g).length === 0) {
      finishRace(g);
      return;
    }
    return continueTurn(g);
  }

  // 決鬥家決鬥
  if (pr.kind === 'duelist') {
    if (a.type !== 'duelist') err('請決定是否決鬥');
    const dl = racerOf(g, pr.racerId), foe = racerOf(g, pr.foeId);
    g.prompt = null;
    if (a.use && dl?.active && foe?.active && dl.pos === foe.pos) {
      const d1 = randomInt(1, 7), d2 = randomInt(1, 7);
      const win = d1 >= d2 ? dl : foe;
      log(g, `⚔️ 決鬥！${racerLabel(g, dl)} 🎲${d1} vs ${racerLabel(g, foe)} 🎲${d2} → ${racerLabel(g, win)} 勝出前進 2 格！`);
      emit(g, { kind: 'duel', by: pid, racer: dl.base, racer1: dl.base, owner1: dl.ownerId, racer2: foe.base, owner2: foe.ownerId, d1, d2, winner: win.id, winSide: d1 >= d2 ? 1 : 2, title: `⚔️ 決鬥！${d1} vs ${d2}`, sub: `${racerLabel(g, win)} 勝出前進 2 格`, tone: 'gold' });
      triggerScoocher(g, dl, 'duelist');
      moveRacer(g, win, 2, { reason: '決鬥勝出' });
    }
    return continueTurn(g);
  }

  // 模仿貓平手自選
  if (pr.kind === 'copycatPick') {
    if (a.type !== 'copycatPick' || !pr.cands.includes(a.targetId)) err('請選擇要複製的領先者');
    const cc = racerOf(g, pr.racerId), tgt = racerOf(g, a.targetId);
    cc.copyTarget = tgt.id;
    g.prompt = null;
    log(g, `🐱 ${racerLabel(g, cc)} 選擇複製領先者「${racerLabel(g, tgt)}」的能力！`);
    return continueTurn(g);
  }

  err('不支援的動作');
}

// --- 玩家中途離場 ---
function leave(g, pid) {
  const p = playerOf(g, pid);
  if (!p || p.left) return activePlayers(g).length;
  p.left = true;
  p.in = false;
  p.selected = null;
  // 離場玩家的場上選手退出本場比賽
  for (const r of g.racers) {
    if (r.ownerId === pid && r.active) { r.active = false; r.eliminated = true; }
  }
  log(g, `${p.name} 離開了賽場`);
  const leftCount = activePlayers(g).length;
  if (leftCount < 2) return leftCount;

  if (g.status === 'raceEnd') {
    if (activePlayers(g).every((x) => g.nextReady.includes(x.id))) beginRaceSelect(g, g.nextStarterIdx);
    return leftCount;
  }
  if (g.stage === 'rollOff') {
    if (activePlayers(g).every((x) => g.rollOff.ready.includes(x.id))) enterDraft(g);
    else syncTurn(g);
  } else if (g.stage === 'draft') {
    const d = g.draft;
    while (d.idx < d.order.length && !playerOf(g, d.order[d.idx])?.in) d.idx++;
    if (d.idx >= d.order.length || !d.pool.length) {
      if (d.round < d.totalRounds) { d.round++; d.startIdx = nextIn(g, d.startIdx); setupDraftRound(g); }
      else beginRaceSelect(g, null);
    } else {
      syncTurn(g); g.turnNo++;
    }
  } else if (g.stage === 'select') {
    if (activePlayers(g).every((x) => x.selected)) revealAndStartRace(g);
    else syncTurn(g);
  } else if (g.status === 'play') {
    if (g.prompt?.pid === pid) {
      autoPlay(g, pid);
    } else if (g.players[g.activePlayerIdx]?.id === pid) {
      g.turnCtx = null;
      g.prompt = null;
      g.activePlayerIdx = nextIn(g, g.activePlayerIdx);
      beginPlayerTurn(g);
    }
  }
  return leftCount;
}

// --- 超時自動代打（autoPlay） & 聰明 AI 電腦玩家（botPlay） ---
const DRAFT_TIER = {
  legs: 95, hare: 90, blimp: 88, rocket_scientist: 86, magician: 85,
  alchemist: 84, scoocher: 83, coach: 82, suckerfish: 80, centaur: 80,
  baba_yaga: 78, duelist: 77, romantic: 76, party_animal: 75, leaptoad: 75,
  lackey: 74, copycat: 73, dicemonger: 72, twin: 72, egg: 70,
  flip_flop: 69, banana: 68, hypnotist: 67, inchworm: 66, mouth: 66,
  gunk: 65, huge_baby: 64, skipper: 64, mastermind: 63, cheerleader: 62,
  heckler: 61, third_wheel: 60, stickler: 59, sisyphus: 58, lovable_loser: 56, genius: 55,
};

function autoPlay(g, pid) {
  if (g.status === 'raceEnd') return act(g, pid, { type: 'next' });
  if (g.status !== 'play') return;
  if (g.stage === 'rollOff') {
    const waiting = activePlayers(g).filter((p) => !g.rollOff.ready.includes(p.id));
    const p = waiting.find((x) => x.id === pid) || waiting[0];
    if (p) return act(g, p.id, { type: 'rollOffOk' });
    return;
  }
  if (g.stage === 'draft') {
    const pick = g.draft.pool[0];
    if (pick) return act(g, pid, { type: 'draftPick', racer: pick });
    return;
  }
  if (g.stage === 'select') {
    const targets = activePlayers(g).filter((p) => !p.selected);
    const p = targets.find((x) => x.id === pid) || targets[0];
    if (!p) return;
    const avail = p.roster.filter((id) => !p.used.includes(id));
    const need = g.doubleMode ? 2 : 1;
    return act(g, p.id, { type: 'selectRacers', racers: avail.slice(0, need) });
  }
  const pr = g.prompt;
  if (!pr) return;
  const actor = pr.pid;
  switch (pr.kind) {
    case 'eggPick': return act(g, actor, { type: 'eggPick', racer: pr.choices[0] });
    case 'twinPick': return act(g, actor, { type: 'twinPick', racer: pr.choices[0] ?? null });
    case 'pickRacer': return act(g, actor, { type: 'pickRacer', racerId: pr.racerIds[0] });
    case 'mastermindPick': return act(g, actor, { type: 'mastermindPick', targetId: pr.targets[0] });
    case 'cheerleader': return act(g, actor, { type: 'cheerleader', use: false });
    case 'hypnotist': return act(g, actor, { type: 'hypnotist', targetId: null });
    case 'thirdWheel': return act(g, actor, { type: 'thirdWheel', space: null });
    case 'mainAction': return act(g, actor, { type: 'roll' });
    case 'reroll': return act(g, actor, { type: 'keepRoll' });
    case 'alchemist': return act(g, actor, { type: 'alchemist', use: true });
    case 'rocket': return act(g, actor, { type: 'rocket', use: false });
    case 'suckerfish': return act(g, actor, { type: 'suckerfish', use: pr.targetPos > (racerOf(g, pr.racerId)?.pos ?? 0) });
    case 'duelist': return act(g, actor, { type: 'duelist', use: true });
    case 'copycatPick': return act(g, actor, { type: 'copycatPick', targetId: pr.cands[0] });
  }
}

function botPlay(g, pid) {
  if (g.status === 'raceEnd') return act(g, pid, { type: 'next' });
  if (g.status !== 'play') return;

  if (g.stage === 'rollOff') {
    if (!g.rollOff.ready.includes(pid)) return act(g, pid, { type: 'rollOffOk' });
    return;
  }
  if (g.stage === 'draft') {
    // 依強度表加一點隨機擾動選最強選手
    const best = [...g.draft.pool].sort((a, b) => ((DRAFT_TIER[b] ?? 60) + randomInt(-6, 7)) - ((DRAFT_TIER[a] ?? 60) + randomInt(-6, 7)))[0];
    return act(g, pid, { type: 'draftPick', racer: best });
  }

  if (g.stage === 'select') {
    const p = playerOf(g, pid);
    if (!p?.in || p.selected) return;
    const avail = p.roster.filter((id) => !p.used.includes(id));
    const need = g.doubleMode ? 2 : 1;
    // 越後面的場次分數越高，保留較強選手給第 3、4 場；雙胞胎第 1 場不派
    const scored = [...avail].sort((a, b) => {
      const ta = (a === 'twin' && g.race === 1 ? -50 : (DRAFT_TIER[a] ?? 60));
      const tb = (b === 'twin' && g.race === 1 ? -50 : (DRAFT_TIER[b] ?? 60));
      return g.race >= 3 ? tb - ta : ta - tb;
    });
    return act(g, pid, { type: 'selectRacers', racers: scored.slice(0, need) });
  }

  const pr = g.prompt;
  if (!pr || pr.pid !== pid) return;
  const r = pr.racerId ? racerOf(g, pr.racerId) : null;

  switch (pr.kind) {
    case 'eggPick': {
      const best = [...pr.choices].sort((a, b) => (DRAFT_TIER[b] ?? 60) - (DRAFT_TIER[a] ?? 60))[0];
      return act(g, pid, { type: 'eggPick', racer: best });
    }
    case 'twinPick': {
      const best = [...pr.choices].sort((a, b) => (DRAFT_TIER[b] ?? 60) - (DRAFT_TIER[a] ?? 60))[0];
      return act(g, pid, { type: 'twinPick', racer: best ?? null });
    }
    case 'pickRacer': {
      const best = [...pr.racerIds].sort((a, b) => (racerOf(g, b)?.pos ?? 0) - (racerOf(g, a)?.pos ?? 0))[0];
      return act(g, pid, { type: 'pickRacer', racerId: best });
    }
    case 'mastermindPick': {
      const best = [...pr.targets].sort((a, b) => {
        const ra = racerOf(g, a), rb = racerOf(g, b);
        return (DRAFT_TIER[rb?.base] ?? 60) - (DRAFT_TIER[ra?.base] ?? 60);
      })[0];
      return act(g, pid, { type: 'mastermindPick', targetId: best });
    }
    case 'cheerleader': {
      const amLast = pr.lastIds.includes(r.id);
      return act(g, pid, { type: 'cheerleader', use: amLast || r.pos >= FINISH - 4 });
    }
    case 'hypnotist': {
      const ahead = pr.targets.map((id) => racerOf(g, id)).filter((x) => x.pos > r.pos + 2).sort((a, b) => b.pos - a.pos);
      return act(g, pid, { type: 'hypnotist', targetId: ahead[0]?.id ?? null });
    }
    case 'thirdWheel': {
      const bestSp = [...pr.spaces].filter((sp) => sp > r.pos).sort((a, b) => b - a)[0] ?? null;
      return act(g, pid, { type: 'thirdWheel', space: bestSp });
    }
    case 'mainAction': {
      if (pr.flipTargets.length) {
        const ahead = pr.flipTargets.map((id) => racerOf(g, id)).filter((x) => x.pos >= r.pos + 5).sort((a, b) => b.pos - a.pos);
        if (ahead.length) return act(g, pid, { type: 'flipFlop', targetId: ahead[0].id });
      }
      if (pr.canLegs) {
        const hasStickler = racersWithPower(g, 'stickler', r.id).some((x) => x.id !== r.id);
        if (!hasStickler || r.pos + 5 <= FINISH) return act(g, pid, { type: 'legs' });
      }
      if (pr.canGenius) return act(g, pid, { type: 'roll', guess: randomInt(1, 7) });
      return act(g, pid, { type: 'roll' });
    }
    case 'reroll': {
      const wantReroll = pr.roll <= 2 || (pr.roll === 6 && hasPower(g, r, 'sisyphus'));
      if (wantReroll && pr.canMag) return act(g, pid, { type: 'rerollMag' });
      if (wantReroll && pr.canDM) return act(g, pid, { type: 'rerollDM' });
      return act(g, pid, { type: 'keepRoll' });
    }
    case 'alchemist':
      return act(g, pid, { type: 'alchemist', use: true });
    case 'rocket': {
      const canFinish = r.pos + pr.roll * 2 >= FINISH;
      const bigGain = pr.roll >= 4 && r.pos < FINISH - 4;
      return act(g, pid, { type: 'rocket', use: canFinish || bigGain });
    }
    case 'suckerfish':
      return act(g, pid, { type: 'suckerfish', use: pr.targetPos > r.pos });
    case 'duelist':
      return act(g, pid, { type: 'duelist', use: true });
    case 'copycatPick': {
      const best = [...pr.cands].sort((a, b) => (DRAFT_TIER[racerOf(g, b)?.base] ?? 60) - (DRAFT_TIER[racerOf(g, a)?.base] ?? 60))[0];
      return act(g, pid, { type: 'copycatPick', targetId: best });
    }
  }
}

// --- 玩家視角快照（隱藏其他人的秘密選角） ---
function view(g, pid) {
  const me = playerOf(g, pid);
  return {
    status: g.status, stage: g.stage, mode: g.mode, doubleMode: g.doubleMode,
    scheduleKey: g.scheduleKey, schedule: g.schedule,
    race: g.race, track: g.track,
    turn: g.players[g.turn]?.id ?? null,
    activePlayer: g.players[g.activePlayerIdx]?.id ?? null,
    activeRacerId: g.activeRacerId,
    turnNo: g.turnNo,
    goldChip: GOLD_CHIPS[Math.max(0, g.race - 1)] ?? 3,
    silverChip: SILVER_CHIPS[Math.max(0, g.race - 1)] ?? 1,
    prevWinners: [...new Set(g.prevWinners)],
    rollOff: g.stage === 'rollOff' && g.rollOff ? {
      purpose: g.rollOff.purpose, rolls: g.rollOff.rolls, winner: g.rollOff.winner, ready: g.rollOff.ready,
    } : null,
    draft: g.stage === 'draft' && g.draft ? {
      round: g.draft.round, totalRounds: g.draft.totalRounds,
      pool: g.draft.pool,
      picker: g.draft.order[g.draft.idx] ?? null,
      order: g.draft.order.slice(g.draft.idx, g.draft.idx + 6),
    } : null,
    myRoster: me ? me.roster : [],
    myUsed: me ? me.used : [],
    mySelected: me ? me.selected : null,
    racers: g.racers.map((r) => ({
      id: r.id, ownerId: r.ownerId, base: r.base,
      copiedPower: r.copiedPower, copyTarget: r.copyTarget,
      effPower: effectivePower(g, r),
      pos: r.pos, tripped: r.tripped, active: r.active,
      finished: r.finished, eliminated: r.eliminated, finishOrder: r.finishOrder,
      mastermindTarget: r.mastermindTarget,
    })),
    finishers: g.finishers,
    prompt: g.prompt ? (g.prompt.pid === pid ? g.prompt : { kind: g.prompt.kind, pid: g.prompt.pid, racerId: g.prompt.racerId }) : null,
    players: g.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, in: p.in, left: p.left,
      points: totalPoints(p), golds: p.golds, silvers: p.silvers, bronze: p.bronze,
      roster: g.stage === 'draft' ? p.roster : p.roster.map((id) => (p.used.includes(id) || p.id === pid ? id : null)),
      rosterCount: p.roster.length,
      availCount: p.roster.length - p.used.length,
      ready: p.selected != null,
    })),
    nextReady: g.nextReady,
    ev: g.ev,
    evFeed: g.evFeed.slice(-20),
    log: g.log.slice(-30),
    summary: g.summary,
    winners: g.winners,
  };
}

module.exports = {
  RACERS, RACER_MAP, WILD_SPACES, SCHEDULES, GOLD_CHIPS, SILVER_CHIPS, FINISH, SECOND_CORNER,
  create, act, leave, autoPlay, botPlay, view,
};
