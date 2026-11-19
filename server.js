'use strict';
// NABLA ARENA V2 online match server for Render.
// Uses exactly the same game engine embedded in index.html as the Netlify site.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const match = html.match(/<script\s*>([\s\S]*?)<\/script\s*>/i);
if (!match) throw new Error('Cannot find NABLA ARENA game engine in index.html');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(match[1], sandbox, { filename: 'nabla-engine.js', timeout: 3000 });
const Engine = sandbox.module.exports;
for (const method of ['makeGame', 'beginOnline', 'move', 'pass', 'publicView']) {
  if (typeof Engine[method] !== 'function') throw new Error('Missing game engine function: ' + method);
}

const rooms = new Map();
const ROOM_IDLE_LIMIT = 6 * 60 * 60 * 1000;
const MAX_ROOMS = 500;
const MAX_BODY_BYTES = 16384;

function json(res, status, data) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function fail(res, status, message) { json(res, status, { error: message }); }
function getRoom(data) {
  const code = String(data?.code || '');
  if (!/^\d{6}$/.test(code)) return null;
  return rooms.get(code) || null;
}
function authenticate(room, data) {
  const token = String(data?.token || '');
  if (token && token === room.tokens[0]) return 0;
  if (token && token === room.tokens[1]) return 1;
  return -1;
}
function stateFor(room, seat) { return Engine.publicView(room.game, seat); }
function publish(room) {
  for (const client of [...room.clients]) {
    try {
      const state = JSON.stringify(stateFor(room, client.seat));
      client.res.write('event: state\ndata: ' + state + '\n\n');
    } catch (_) { room.clients.delete(client); }
  }
}
function roomReply(room, seat) {
  return { code: room.code, seat, token: room.tokens[seat], state: stateFor(room, seat) };
}
function createCode() {
  for (let i = 0; i < 100; i++) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    if (!rooms.has(code)) return code;
  }
  throw new Error('部屋を作成できませんでした。');
}
function makeToken() { return crypto.randomBytes(24).toString('hex'); }
function cleanRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastSeen < ROOM_IDLE_LIMIT) continue;
    for (const client of room.clients) {
      try { client.res.end(); } catch (_) {}
    }
    rooms.delete(code);
  }
}
setInterval(cleanRooms, 15 * 60 * 1000).unref();

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', chunk => {
      text += chunk;
      if (text.length > MAX_BODY_BYTES) {
        reject(new Error('リクエストが大きすぎます。'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const data = text ? JSON.parse(text) : {};
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
        resolve(data);
      } catch (_) { reject(new Error('リクエストの形式が正しくありません。')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return json(res, 204, {});

  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, app: 'NABLA ARENA', rooms: rooms.size });
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const data = Object.fromEntries(url.searchParams);
      const room = getRoom(data);
      if (!room) return fail(res, 404, '部屋が見つかりません。');
      const seat = authenticate(room, data);
      if (seat === -1) return fail(res, 403, '参加者の認証に失敗しました。');
      room.lastSeen = Date.now();
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const client = { seat, res };
      room.clients.add(client);
      res.write('retry: 3000\n\n');
      res.write('event: state\ndata: ' + JSON.stringify(stateFor(room, seat)) + '\n\n');
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': ping\n\n');
      }, 20000);
      req.on('close', () => { clearInterval(heartbeat); room.clients.delete(client); });
      return;
    }
    if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) {
      return fail(res, 404, 'APIが見つかりません。');
    }
    const data = await readJson(req);
    if (url.pathname === '/api/create') {
      cleanRooms();
      if (rooms.size >= MAX_ROOMS) return fail(res, 503, '満室のため、新しい部屋を作れません。');
      const code = createCode();
      const room = {
        code,
        tokens: [makeToken(), null],
        game: Engine.makeGame('online'),
        clients: new Set(),
        votes: [false, false],
        lastSeen: Date.now(),
      };
      rooms.set(code, room);
      return json(res, 200, roomReply(room, 0));
    }
    const room = getRoom(data);
    if (!room) return fail(res, 404, '部屋が見つかりません。');
    room.lastSeen = Date.now();
    if (url.pathname === '/api/join') {
      if (room.tokens[1]) return fail(res, 409, 'この部屋はすでに2人参加しています。');
      room.tokens[1] = makeToken();
      Engine.beginOnline(room.game);
      publish(room);
      return json(res, 200, roomReply(room, 1));
    }
    const seat = authenticate(room, data);
    if (seat === -1) return fail(res, 403, '参加者の認証に失敗しました。');
    if (url.pathname === '/api/reconnect') return json(res, 200, roomReply(room, seat));
    if (url.pathname === '/api/move' || url.pathname === '/api/pass') {
      const index = data.index == null ? null : data.index;
      let result;
      if (url.pathname === '/api/move') {
        if (!Number.isInteger(index) || !Number.isInteger(data.owner) || ![0, 1].includes(data.owner)) {
          return fail(res, 400, 'カードまたは対象が不正です。');
        }
        if (data.targetId != null && !Number.isInteger(data.targetId)) {
          return fail(res, 400, '基底の指定が不正です。');
        }
        result = Engine.move(room.game, seat, index, data.owner, data.targetId ?? null);
      } else {
        if (index != null && !Number.isInteger(index)) return fail(res, 400, 'カードが不正です。');
        result = Engine.pass(room.game, seat, index);
      }
      if (result.error) return fail(res, 400, result.error);
      publish(room);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/rematch') {
      if (room.game.status !== 'ended') return fail(res, 400, '対戦終了後に再戦できます。');
      room.votes[seat] = true;
      if (room.votes[0] && room.votes[1]) {
        room.game = Engine.makeGame('online');
        Engine.beginOnline(room.game);
        room.votes = [false, false];
        publish(room);
        return json(res, 200, { ok: true, restarted: true });
      }
      return json(res, 200, { ok: true, restarted: false });
    }
    return fail(res, 404, 'APIが見つかりません。');
  } catch (e) {
    console.error(e?.stack || e);
    if (!res.headersSent && !res.destroyed) fail(res, 500, e?.message || 'サーバーエラーが発生しました。');
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log('NABLA ARENA server listening on ' + port));
