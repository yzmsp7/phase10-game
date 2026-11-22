'use strict';
// 房間 / 邀請 / 即時同步。HTTP POST 送動作，SSE 推送狀態。零依賴。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomInt, randomUUID } = require('node:crypto');
const G = require('./game');
const F = require('./fuji');
const C = require('./cats');
const M = require('./manila');
const MA = require('./magical');

const TURN_SEC = 60; // 每回合預設秒數；建房時可改（10–600），手機切去 LINE 回訊息再回來要來得及，所以下限不能太短
const KINDS = { phase10: { eng: G, min: 2, max: 6 }, fuji: { eng: F, min: 3, max: 8 }, cats: { eng: C, min: 3, max: 6 }, manila: { eng: M, min: 3, max: 5 }, magical: { eng: MA, min: 2, max: 6 } }; // 遊戲種類：規則引擎（同一組介面 create/act/leave/autoPlay/view）與人數；新增遊戲在這裡加一行
const K = (room) => KINDS[room.kind];
const EMOJI = ['😮', '😡', '😂', '👏', '😭', '😎', '🙏', '😴']; // 白名單；index.html 有同一份，改的時候兩邊一起改
const RULES = ['catchUp', 'first', 'rv', 'sh', 'xn', 'xc']; // 建房時可開的特殊規則（見 game.js），全部預設關 = 標準 Phase 10；index.html 有同一份鍵名，test.js 會比對
const BOT_NAMES = ['老船長(電腦)', '海盜王(電腦)', '香料商(電腦)', '黑市通(電腦)'];
const MA_BOT_NAMES = ['閃電豹(電腦)', '火箭龜(電腦)', '香蕉俠(電腦)', '魔術兔(電腦)', '狂野喵(電腦)'];
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newRoom(kind, turn, extra) {
  let code;
  do { code = Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join(''); } while (rooms.has(code));
  const r = { code, kind, players: [], host: null, settings: { turn, ...extra }, // extra：phase10 才有 target、rules；富士流沒有額外設定
     game: null, rx: [], clients: new Map(), touched: Date.now(), timer: null, botTimer: null, dl: null };
  rooms.set(code, r);
  return r;
}

function addPlayer(room, name) {
  name = String(name ?? '').trim().slice(0, 12);
  if (!name) G.err('請輸入名字');
  if (room.players.some((p) => p.name === name)) G.err('房間裡已經有人用這個名字');
  const p = { id: randomUUID().slice(0, 8), token: randomUUID(), name };
  room.players.push(p);
  room.host ??= p.id;
  return p;
}

const online = (room, id) => room.players.some((p) => p.id === id && p.bot) || (room.clients.get(id)?.size ?? 0) > 0;
const isBot = (room, id) => room.players.some((p) => p.id === id && p.bot);

function snapshot(room, pid) {
  return {
    code: room.code, kind: room.kind, min: K(room).min, max: K(room).max, me: pid, host: room.host, settings: room.settings,
    turnLeft: room.dl && Math.max(0, room.dl.at - Date.now()), // 剩餘毫秒（不傳絕對時間，免得被手機時鐘誤差影響）
    players: room.players.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot, online: online(room, p.id) })),
    rx: room.rx, // 最近 5 筆表情；seq 遞增，前端只播自己沒看過的
    game: room.game ? K(room).eng.view(room.game, pid) : null,
  };
}

function broadcast(room) {
  room.touched = Date.now();
  watch(room); // 先定好期限，快照才帶得到剩餘秒數
  for (const [pid, set] of room.clients) {
    const data = `data: ${JSON.stringify(snapshot(room, pid))}\n\n`;
    for (const res of set) res.write(data);
  }
}

// 回合倒數與電腦玩家排程：每個回合（g.turnNo）開始時定下期限，其餘廣播只重掛 timer 不重設；
// 沒在玩或全員離線就凍結，有人回來時重新計時。
function watch(room) {
  clearTimeout(room.timer);
  clearTimeout(room.botTimer);
  const g = room.game;
  const anyHumanOnline = [...room.clients.values()].some((s) => s.size);
  if (!g || !anyHumanOnline) { room.dl = null; return; }

  // 馬尼拉／瘋狂運動會結算畫面：電腦玩家自動按下準備，但仍等所有真人玩家按開始
  if ((g.status === 'roundEnd' && room.kind === 'manila') || (g.status === 'raceEnd' && room.kind === 'magical')) {
    room.dl = null;
    const pendingBots = g.players.filter((p) => p.in && isBot(room, p.id) && !g.nextReady.includes(p.id));
    if (pendingBots.length) {
      const delay = room.settings.botDelay ?? 700;
      room.botTimer = setTimeout(() => {
        if (room.game !== g || (g.status !== 'roundEnd' && g.status !== 'raceEnd')) return;
        for (const b of pendingBots) {
          if (g.status !== 'roundEnd' && g.status !== 'raceEnd') break;
          try { K(room).eng.act(g, b.id, { type: 'next' }); } catch (e) { console.error(e); }
        }
        broadcast(room);
      }, delay);
      room.botTimer.unref();
    }
    return;
  }

  if (g.status !== 'play') { room.dl = null; return; }
  const no = g.turnNo, cur = g.players[g.turn].id;

  // 瘋狂運動會同時秘密選選手階段：電腦玩家自動挑選本場出戰選手，同時照常對真人倒數
  if (room.kind === 'magical' && g.stage === 'select') {
    const pendingBots = g.players.filter((p) => p.in && isBot(room, p.id) && !p.selected);
    if (pendingBots.length) {
      const delay = room.settings.botDelay ?? 650;
      room.botTimer = setTimeout(() => {
        if (room.game !== g || g.status !== 'play' || g.stage !== 'select') return;
        for (const b of pendingBots) {
          if (g.stage !== 'select') break;
          try { MA.botPlay(g, b.id); } catch (e) { console.error(e); }
        }
        broadcast(room);
      }, delay);
      room.botTimer.unref();
    }
  }

  // 輪到電腦玩家時自動執行 AI 決策（留出足夠閱讀其他玩家動作大通知與 3D 擲骰、逐格移動動畫的時間）
  if (isBot(room, cur) && K(room).eng.botPlay && !(room.kind === 'magical' && g.stage === 'select')) {
    room.dl = null;
    const maDelay = g.stage === 'race' ? Math.min(5500, Math.max(1800, (g.lastAnimMs || 0) + 650)) : 950;
    const baseDelay = room.settings.botDelay ?? (room.kind === 'magical' ? maDelay : (g.ev?.kind === 'roll' ? 3400 : 1350));
    room.botTimer = setTimeout(() => {
      if (room.game !== g || g.status !== 'play' || g.turnNo !== no) return;
      try { K(room).eng.botPlay(g, cur); } catch (e) { console.error(e); try { K(room).eng.autoPlay(g, cur); } catch {} }
      broadcast(room);
    }, baseDelay);
    room.botTimer.unref();
    return;
  }

  if (room.dl?.no !== no) room.dl = { no, at: Date.now() + room.settings.turn * 1000 };
  room.timer = setTimeout(() => {
    if (room.game !== g || g.status !== 'play' || g.turnNo !== no) return;
    room.dl = null; // 代打若失敗（牌堆空）也會重新倒數，不會空轉
    try { K(room).eng.autoPlay(g, cur); } catch (e) { console.error(e); }
    broadcast(room);
  }, Math.max(0, room.dl.at - Date.now()));
  room.timer.unref();
}

// 關房間：先推一筆 { closed } 讓前端顯示原因並退出，再斷線、刪房。
function close(room, why) {
  clearTimeout(room.timer);
  clearTimeout(room.botTimer);
  rooms.delete(room.code); // 先刪房：res.end() 會觸發 req 'close' → broadcast，那時 rooms.has 必須已是 false
  for (const set of room.clients.values()) for (const res of set) { res.write(`data: ${JSON.stringify({ closed: why })}\n\n`); res.end(); }
}

const actions = {
  settings(room, p, b) {
    if (room.host !== p.id) G.err('只有房主可以改設定');
    if (room.game) G.err('遊戲進行中不能改設定');
    if (room.kind === 'phase10' && Number.isInteger(b.target) && b.target >= 1 && b.target <= 10) room.settings.target = b.target;
    if (room.kind === 'cats' && Number.isInteger(b.rounds) && b.rounds >= 1 && b.rounds <= 10) room.settings.rounds = b.rounds;
    if (room.kind === 'manila' && typeof b.pirateKick === 'boolean') room.settings.pirateKick = b.pirateKick;
    if (room.kind === 'magical') {
      if (typeof b.schedule === 'string' && Object.hasOwn(MA.SCHEDULES, b.schedule)) room.settings.schedule = b.schedule;
      if (typeof b.double3p === 'boolean') room.settings.double3p = b.double3p;
    }
  },
  addBot(room, p) {
    if (room.kind !== 'manila' && room.kind !== 'magical') G.err('目前只有馬尼拉與瘋狂運動會支援電腦玩家');
    if (room.host !== p.id) G.err('只有房主可以新增電腦玩家');
    if (room.game) G.err('遊戲進行中不能新增電腦玩家');
    if (room.players.length >= K(room).max) G.err(`房間已滿（最多 ${K(room).max} 人）`);
    const used = new Set(room.players.map((x) => x.name));
    const pool = room.kind === 'magical' ? MA_BOT_NAMES : BOT_NAMES;
    let name = pool.find((n) => !used.has(n));
    if (!name) { let k = 1; while (used.has(`電腦${k}`)) k++; name = `電腦${k}`; }
    room.players.push({ id: randomUUID().slice(0, 8), token: null, name, bot: true });
  },
  removeBot(room, p, b) {
    if (room.kind !== 'manila' && room.kind !== 'magical') G.err('目前只有馬尼拉與瘋狂運動會支援電腦玩家');
    if (room.host !== p.id) G.err('只有房主可以移除電腦玩家');
    if (room.game) G.err('遊戲進行中不能移除電腦玩家');
    const idx = b.id
      ? room.players.findIndex((x) => x.bot && x.id === b.id)
      : room.players.findLastIndex((x) => x.bot);
    if (idx < 0) G.err('找不到可移除的電腦玩家');
    room.players.splice(idx, 1);
  },
  shuffle(room, p) { // 隨機排座位：座位 = room.players 的順序，G.create 照這個順序發牌、輪流
    if (room.host !== p.id) G.err('只有房主可以排位子');
    if (room.game) G.err('遊戲進行中不能排位子');
    const a = room.players;
    for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  },
  start(room, p) {
    if (room.host !== p.id) G.err('只有房主可以開始');
    if (room.game) G.err('遊戲已經開始');
    if (room.players.length < K(room).min) G.err(`至少要 ${K(room).min} 人才能開始`);
    room.game = K(room).eng.create(room.players, room.settings);
  },
  act(room, p, b) {
    if (!room.game) G.err('遊戲還沒開始');
    K(room).eng.act(room.game, p.id, b.action ?? {});
  },
  react(room, p, b) { // 表情：不是遊戲規則，只是暫時事件，不進 game、不存檔
    if (!EMOJI.includes(b.e)) G.err('不支援的表情');
    if (Date.now() - (p.rxAt ?? 0) < 1000) G.err('表情送太快了');
    p.rxAt = Date.now();
    room.rx = [...room.rx, { seq: (room.rx.at(-1)?.seq ?? 0) + 1, by: p.id, e: b.e }].slice(-5);
  },
  back(room, p) { // 遊戲結束後回到房間
    if (room.host !== p.id) G.err('只有房主可以操作');
    if (room.game?.status !== 'over') G.err('遊戲還沒結束');
    room.game = null;
  },
  leave(room, p) {
    const playing = room.game && room.game.status !== 'over';
    // 遊戲中途退出：牌放回棄牌堆、輪次換人；只剩 1 人就關房間（一個人沒辦法玩）
    if (playing && K(room).eng.leave(room.game, p.id) < 2) return close(room, `${p.name} 離開了，只剩一人，房間已關閉`);
    room.players = room.players.filter((x) => x !== p);
    room.clients.get(p.id)?.forEach((res) => res.end());
    room.clients.delete(p.id);
    if (!room.players.some((x) => !x.bot)) {
      clearTimeout(room.timer);
      clearTimeout(room.botTimer);
      return rooms.delete(room.code);
    }
    if (room.host === p.id) room.host = room.players.find((x) => !x.bot)?.id ?? null;
  },
};

function body(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 10_000) { reject(Object.assign(new Error('too big'), { user: true })); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(Object.assign(new Error('bad json'), { user: true })); } });
  });
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const findAuth = (code, token) => {
  const room = rooms.get(String(code ?? '').toUpperCase());
  const p = room?.players.find((x) => x.token === token);
  return p ? { room, p } : null;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const rel = url.pathname.slice('/assets/'.length);
      if (!/^[a-zA-Z0-9_/-]+\.(jpg|jpeg|png|webp|svg)$/.test(rel)) return json(res, 404, { error: 'not found' });
      const file = path.join(__dirname, 'assets', rel);
      if (!fs.existsSync(file)) return json(res, 404, { error: 'not found' });
      const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' }[rel.split('.').pop()];
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=86400' });
      return res.end(fs.readFileSync(file));
    }
    if (req.method === 'GET' && url.pathname === '/api/lan') { // 本機開發用：localhost 開的頁面拿區網 IP 組邀請連結／QR。只回應本機請求，部署後（請求來自 proxy）一律 null，不洩漏內網位址
      const local = /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress ?? '');
      const ips = local ? Object.values(os.networkInterfaces()).flat().filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address) : [];
      return json(res, 200, { ip: ips.find((a) => /^(192\.168|10)\./.test(a)) ?? ips[0] ?? null }); // 優先一般家用網段，避開 docker／VPN 的位址
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const a = findAuth(url.searchParams.get('code'), url.searchParams.get('token'));
      if (!a) return json(res, 404, { error: '房間不存在或已過期' });
      const { room, p } = a;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      if (!room.clients.has(p.id)) room.clients.set(p.id, new Set());
      room.clients.get(p.id).add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        room.clients.get(p.id)?.delete(res);
        if (rooms.has(room.code)) broadcast(room);
      });
      return broadcast(room);
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const b = await body(req), name = url.pathname.slice(5);
      if (name === 'create' || name === 'join') {
        let room;
        if (name === 'create') {
          const kind = b.kind ?? 'phase10';
          if (!Object.hasOwn(KINDS, kind)) G.err('不支援的遊戲');
          const turn = b.turn ?? TURN_SEC;
          if (!Number.isInteger(turn) || turn < 10 || turn > 600) G.err('每回合秒數要在 10–600 之間');
          if (b.rules != null && (typeof b.rules !== 'object' || Array.isArray(b.rules))) G.err('規則格式不對');
          const target = b.target ?? 10;
          if (!Number.isInteger(target) || target < 1 || target > 10) G.err('目標階段要在 1–10 之間');
          const rounds = b.rounds ?? C.DEFAULT_ROUNDS;
          if (kind === 'cats' && (!Number.isInteger(rounds) || rounds < 1 || rounds > 10)) G.err('遊戲輪數要在 1–10 之間');
          const schedule = b.schedule ?? 'std';
          if (kind === 'magical' && !Object.hasOwn(MA.SCHEDULES, schedule)) G.err('無效的賽程組合');
          const extra = kind === 'phase10' ? { target, rules: Object.fromEntries(RULES.map((k) => [k, b.rules?.[k] === true])) }
            : kind === 'cats' ? { rounds }
            : kind === 'manila' ? { pirateKick: b.pirateKick === true }
            : kind === 'magical' ? { schedule, double3p: b.double3p === true } : {};
          room = newRoom(kind, turn, extra);
        } else {
          room = rooms.get(String(b.code ?? '').toUpperCase());
          if (!room) G.err('找不到這個房間');
          if (room.game) G.err('遊戲已經開始，無法加入');
          if (room.players.length >= K(room).max) G.err(`房間已滿（最多 ${K(room).max} 人）`);
        }
        let p;
        try { p = addPlayer(room, b.name); } catch (e) { if (!room.players.length) rooms.delete(room.code); throw e; }
        return json(res, 200, { code: room.code, token: p.token, kind: room.kind });
      }
      const a = findAuth(b.code, b.token);
      if (!a) return json(res, 404, { error: '房間不存在或已過期' });
      if (!actions[name]) return json(res, 404, { error: 'unknown' });
      actions[name](a.room, a.p, b);
      if (rooms.has(a.room.code)) broadcast(a.room);
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    if (e.user) return json(res, 400, { error: e.message });
    console.error(e);
    json(res, 500, { error: '伺服器錯誤' });
  }
});

// 清掉沒人連線超過 1 小時的房間
setInterval(() => {
  for (const [code, r] of rooms) if (![...r.clients.values()].some((s) => s.size) && Date.now() - r.touched > 3_600_000) rooms.delete(code);
}, 600_000).unref();

if (require.main === module) {
  const port = process.env.PORT || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Phase 10 / 富士流 / 貓貓食堂 / 馬尼拉 / 瘋狂運動會 → http://localhost:${port}`));
}
module.exports = Object.assign(server, { rooms }); // rooms 只給測試改狀態用
