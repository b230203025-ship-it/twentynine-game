/**
 * Mode A server.
 *   npm run build && PASSKEY=your-secret npm start
 * Serves the built client (dist/) and the Socket.io endpoint on the same origin.
 */
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { Server } from 'socket.io';
import { Room } from '../shared/room';
import type { ServerMsg } from '../shared/room';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PASSKEY = process.env.PASSKEY;
if (!PASSKEY) throw new Error('Set PASSKEY env var');
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
const dist = path.join(__dirname, '../dist');
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.ORIGIN ?? false } });

const rooms = new Map<string, Room>();
const socketOf = new Map<string, string>();   // playerId -> socket.id
const roomOf = new Map<string, string>();     // playerId -> room code

const sha = (s: string) => crypto.createHash('sha256').update(s).digest();
const passkeyOk = (given: string) => crypto.timingSafeEqual(sha(given), sha(PASSKEY));

// crude brute-force limiter: 10 failed attempts / minute / IP
const fails = new Map<string, { n: number; reset: number }>();
function tooMany(ip: string) {
  const f = fails.get(ip);
  return !!f && f.reset > Date.now() && f.n >= 10;
}
function noteFail(ip: string) {
  const f = fails.get(ip);
  if (!f || f.reset < Date.now()) fails.set(ip, { n: 1, reset: Date.now() + 60_000 });
  else f.n++;
}

io.use((socket, next) => {
  const ip = socket.handshake.address;
  const { passkey, playerId } = (socket.handshake.auth ?? {}) as Record<string, unknown>;
  if (tooMany(ip)) return next(new Error('rate_limited'));
  if (typeof passkey !== 'string' || typeof playerId !== 'string' || playerId.length < 8 || playerId.length > 64
      || !passkeyOk(passkey)) {
    noteFail(ip);
    return next(new Error('unauthorized'));
  }
  socket.data.playerId = playerId;
  next();
});

const send = (playerId: string, msg: ServerMsg) => {
  const sid = socketOf.get(playerId);
  if (sid) io.to(sid).emit('msg', msg);
};

function newCode() {
  let code: string;
  do code = String(crypto.randomInt(10_000, 100_000)); while (rooms.has(code));
  return code;
}

io.on('connection', socket => {
  const pid: string = socket.data.playerId;
  socketOf.set(pid, socket.id);

  // automatic reconnect to an existing table
  const existing = roomOf.get(pid);
  if (existing && rooms.has(existing)) rooms.get(existing)!.join(pid, '');

  const myRoom = () => rooms.get(roomOf.get(pid) ?? '');

  socket.on('room:create', (name: string, ack?: (r: { code?: string; error?: string }) => void) => {
    if (myRoom()) return ack?.({ error: 'Already in a room' });
    const code = newCode();
    const room = new Room(code, send);
    rooms.set(code, room);
    roomOf.set(pid, code);
    room.join(pid, String(name ?? ''));
    ack?.({ code });
  });

  socket.on('room:join', (p: { code: string; name: string }, ack?: (r: { seat?: number; error?: string }) => void) => {
    const room = rooms.get(String(p?.code ?? ''));
    if (!room) return ack?.({ error: 'Room not found' });
    roomOf.set(pid, room.code);
    ack?.({ seat: room.join(pid, String(p?.name ?? '')) });
  });

  socket.on('room:start', () => myRoom()?.start(pid));
  socket.on('room:rematch', () => myRoom()?.rematch(pid));
  socket.on('room:rules', (patch: unknown) => myRoom()?.setRules(pid, (patch ?? {}) as never));
  socket.on('game:action', (action: unknown) => myRoom()?.act(pid, action as never));

  socket.on('room:leave', () => {
    myRoom()?.disconnect(pid);
    roomOf.delete(pid);
  });

  socket.on('disconnect', () => {
    if (socketOf.get(pid) === socket.id) socketOf.delete(pid);
    myRoom()?.disconnect(pid); // keeps roomOf so the player can reclaim their seat
  });
});

// drop empty / idle rooms
setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.humansConnected() === 0 && Date.now() - room.lastActive > 10 * 60_000) {
      room.destroy();
      rooms.delete(code);
      for (const [p, c] of roomOf) if (c === code) roomOf.delete(p);
    }
  }
}, 60_000);

server.listen(PORT, () => console.log(`29 server on :${PORT}`));
