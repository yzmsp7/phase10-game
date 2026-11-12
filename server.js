'use strict';
// 房間 / 邀請 / 即時同步。HTTP POST 送動作，SSE 推送狀態。零依賴。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomInt, randomUUID } = require('node:crypto');
const G = require('./game');

const MAX = 6, MIN = 2, AFK_MS = 20_000;
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

// 規則隨人數變化的預設值（說明書本身沒有分人數的規則，這是我們的設計）：
// 2-4 人打完 10 階段；5-6 人每回合更久，預設 7 階段。房主可自行改。
const defaultTarget = (n) => (n >= 5 ? 7 : 10);

function newRoom() {
  let code;
  do { code = Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join(''); } while (rooms.has(code));
  const r = { code, players: [], host: null, settings: { mode: 'phases', target: 10, auto: true }, game: null, clients: new Map(), touched: Date.now(), timer: null };
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
  if (room.settings.auto) room.settings.target = defaultTarget(room.players.length);
  return p;
}

const online = (room, id) => (room.clients.get(id)?.size ?? 0) > 0;

function snapshot(room, pid) {
  return {
    code: room.code, me: pid, host: room.host, settings: room.settings,
    players: room.players.map((p) => ({ id: p.id, name: p.name, online: online(room, p.id) })),
    game: room.game ? G.view(room.game, pid) : null,
  };
}

function broadcast(room) {
  room.touched = Date.now();
  for (const [pid, set] of room.clients) {
    const data = `data: ${JSON.stringify(snapshot(room, pid))}\n\n`;
    for (const res of set) res.write(data);
  }
  watch(room);
}

// 輪到離線玩家時，等 AFK_MS 後自動代打（抽牌堆、棄最大張）。
// ponytail: 只處理離線；在線但發呆的玩家不會被代打，需要時加回合計時器。
function watch(room) {
  clearTimeout(room.timer);
  const g = room.game;
  if (!g || g.status !== 'play') return;
  const cur = g.players[g.turn].id;
  if (online(room, cur) || ![...room.clients.values()].some((s) => s.size)) return; // 全員離線就凍結
  room.timer = setTimeout(() => {
    if (room.game !== g || g.status !== 'play' || g.players[g.turn].id !== cur || online(room, cur)) return;
    try { G.autoPlay(g, cur); } catch (e) { console.error(e); }
    broadcast(room);
  }, AFK_MS);
  room.timer.unref();
}

const actions = {
  settings(room, p, b) {
    if (room.host !== p.id) G.err('只有房主可以改設定');
    if (room.game) G.err('遊戲進行中不能改設定');
    const s = room.settings;
    if (b.mode === 'phases' || b.mode === 'rounds') s.mode = b.mode;
    if (Number.isInteger(b.target) && b.target >= 1 && b.target <= 10) { s.target = b.target; s.auto = false; }
  },
  start(room, p) {
    if (room.host !== p.id) G.err('只有房主可以開始');
    if (room.game) G.err('遊戲已經開始');
    if (room.players.length < MIN) G.err(`至少要 ${MIN} 人才能開始`);
    room.game = G.create(room.players, room.settings);
  },
  act(room, p, b) {
    if (!room.game) G.err('遊戲還沒開始');
    G.act(room.game, p.id, b.action ?? {});
  },
  back(room, p) { // 遊戲結束後回到房間
    if (room.host !== p.id) G.err('只有房主可以操作');
    if (room.game?.status !== 'over') G.err('遊戲還沒結束');
    room.game = null;
  },
  leave(room, p) {
    if (room.game) G.err('遊戲進行中不能離開，直接關掉頁面即可（會由系統代打）');
    room.players = room.players.filter((x) => x !== p);
    room.clients.get(p.id)?.forEach((res) => res.end());
    room.clients.delete(p.id);
    if (room.host === p.id) room.host = room.players[0]?.id ?? null;
    if (room.settings.auto) room.settings.target = defaultTarget(room.players.length);
    if (!room.players.length) rooms.delete(room.code);
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
        if (name === 'create') room = newRoom();
        else {
          room = rooms.get(String(b.code ?? '').toUpperCase());
          if (!room) G.err('找不到這個房間');
          if (room.game) G.err('遊戲已經開始，無法加入');
          if (room.players.length >= MAX) G.err(`房間已滿（最多 ${MAX} 人）`);
        }
        let p;
        try { p = addPlayer(room, b.name); } catch (e) { if (!room.players.length) rooms.delete(room.code); throw e; }
        return json(res, 200, { code: room.code, token: p.token });
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
  server.listen(port, '0.0.0.0', () => console.log(`Phase 10 → http://localhost:${port}`));
}
module.exports = server;
