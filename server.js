'use strict';
// 房間 / 邀請 / 即時同步。HTTP POST 送動作，SSE 推送狀態。零依賴。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomInt, randomUUID } = require('node:crypto');
const G = require('./game');

const MAX = 6, MIN = 2, TURN_SEC = 60; // 每回合預設秒數；建房時可改（10–600），手機切去 LINE 回訊息再回來要來得及，所以下限不能太短
const EMOJI = ['😮', '😡', '😂', '👏', '😭', '😎', '🙏', '😴']; // 白名單；index.html 有同一份，改的時候兩邊一起改
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newRoom(turn) {
  let code;
  do { code = Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join(''); } while (rooms.has(code));
  const r = { code, players: [], host: null, settings: { target: 10, turn }, game: null, rx: [], clients: new Map(), touched: Date.now(), timer: null, dl: null };
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

const online = (room, id) => (room.clients.get(id)?.size ?? 0) > 0;

function snapshot(room, pid) {
  return {
    code: room.code, me: pid, host: room.host, settings: room.settings,
    turnLeft: room.dl && Math.max(0, room.dl.at - Date.now()), // 剩餘毫秒（不傳絕對時間，免得被手機時鐘誤差影響）
    players: room.players.map((p) => ({ id: p.id, name: p.name, online: online(room, p.id) })),
    rx: room.rx, // 最近 5 筆表情；seq 遞增，前端只播自己沒看過的
    game: room.game ? G.view(room.game, pid) : null,
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

// 回合倒數：每個回合（g.turnNo）開始時定下期限，其餘廣播只重掛 timer 不重設；
// 時間到就代打（抽牌堆、棄最大張）。沒在玩或全員離線就凍結，有人回來時重新計時。
function watch(room) {
  clearTimeout(room.timer);
  const g = room.game;
  if (!g || g.status !== 'play' || ![...room.clients.values()].some((s) => s.size)) { room.dl = null; return; }
  const no = g.turnNo, cur = g.players[g.turn].id;
  if (room.dl?.no !== no) room.dl = { no, at: Date.now() + room.settings.turn * 1000 };
  room.timer = setTimeout(() => {
    if (room.game !== g || g.status !== 'play' || g.turnNo !== no) return;
    room.dl = null; // 代打若失敗（牌堆空）也會重新倒數，不會空轉
    try { G.autoPlay(g, cur); } catch (e) { console.error(e); }
    broadcast(room);
  }, Math.max(0, room.dl.at - Date.now()));
  room.timer.unref();
}

// 關房間：先推一筆 { closed } 讓前端顯示原因並退出，再斷線、刪房。
function close(room, why) {
  clearTimeout(room.timer);
  rooms.delete(room.code); // 先刪房：res.end() 會觸發 req 'close' → broadcast，那時 rooms.has 必須已是 false
  for (const set of room.clients.values()) for (const res of set) { res.write(`data: ${JSON.stringify({ closed: why })}\n\n`); res.end(); }
}

const actions = {
  settings(room, p, b) {
    if (room.host !== p.id) G.err('只有房主可以改設定');
    if (room.game) G.err('遊戲進行中不能改設定');
    if (Number.isInteger(b.target) && b.target >= 1 && b.target <= 10) room.settings.target = b.target;
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
    if (playing && G.leave(room.game, p.id) < 2) return close(room, `${p.name} 離開了，只剩一人，房間已關閉`);
    room.players = room.players.filter((x) => x !== p);
    room.clients.get(p.id)?.forEach((res) => res.end());
    room.clients.delete(p.id);
    if (room.host === p.id) room.host = room.players[0]?.id ?? null;
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
          const turn = b.turn ?? TURN_SEC;
          if (!Number.isInteger(turn) || turn < 10 || turn > 600) G.err('每回合秒數要在 10–600 之間');
          room = newRoom(turn);
        } else {
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
module.exports = Object.assign(server, { rooms }); // rooms 只給測試改狀態用
