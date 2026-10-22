import { io, type Socket } from 'socket.io-client';
import type { Action, Rules } from '../../shared/engine';
import type { ServerMsg } from '../../shared/room';
import { Emitter, getPlayerId, type Listener, type Session } from './types';

export class OnlineSession implements Session {
  readonly kind = 'online' as const;
  private em = new Emitter();

  constructor(private socket: Socket) {
    socket.on('msg', (m: ServerMsg) => this.em.emit(m));
  }

  subscribe(cb: Listener) { return this.em.subscribe(cb); }
  start() { this.socket.emit('room:start'); }
  act(action: Action) { this.socket.emit('game:action', action); }
  rematch() { this.socket.emit('room:rematch'); }
  setRules(patch: Partial<Rules>) { this.socket.emit('room:rules', patch); }
  leave() { this.socket.emit('room:leave'); this.em.reset(); }

  create(name: string): Promise<string> {
    return new Promise((res, rej) =>
      this.socket.emit('room:create', name, (r: { code?: string; error?: string }) =>
        r.code ? res(r.code) : rej(new Error(r.error ?? 'Could not create room'))));
  }

  join(code: string, name: string): Promise<void> {
    return new Promise((res, rej) =>
      this.socket.emit('room:join', { code, name }, (r: { error?: string }) =>
        r.error ? rej(new Error(r.error)) : res()));
  }

  disconnect() { this.socket.disconnect(); }
}

export function connectOnline(passkey: string): Promise<OnlineSession> {
  return new Promise((resolve, reject) => {
    const socket = io({ auth: { passkey, playerId: getPlayerId() }, reconnectionDelayMax: 4000 });
    let settled = false;
    socket.once('connect', () => { settled = true; resolve(new OnlineSession(socket)); });
    socket.on('connect_error', e => {
      if (settled) return; // later hiccups are handled by socket.io's own reconnection
      settled = true;
      socket.disconnect();
      reject(new Error(
        e.message === 'unauthorized' ? 'Wrong passkey'
          : e.message === 'rate_limited' ? 'Too many attempts. Wait a minute and retry.'
          : 'Cannot reach the server'));
    });
  });
}
