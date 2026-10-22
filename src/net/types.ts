import type { Action, Rules } from '../../shared/engine';
import type { ServerMsg } from '../../shared/room';

export type StateMsg = Extract<ServerMsg, { type: 'state' }>;
export type View = NonNullable<StateMsg['view']>;
export type Listener = (m: ServerMsg) => void;

/** Everything the UI needs. Online (Socket.io) and local (WebRTC) sessions both implement this. */
export interface Session {
  readonly kind: 'online' | 'local';
  subscribe(cb: Listener): () => void;
  start(): void;
  act(action: Action): void;
  rematch(): void;
  setRules(patch: Partial<Rules>): void;
  leave(): void;
}

export class Emitter {
  last: StateMsg | null = null;
  private listeners = new Set<Listener>();
  emit(m: ServerMsg) {
    if (m.type === 'state') this.last = m;
    this.listeners.forEach(l => l(m));
  }
  subscribe(cb: Listener) {
    this.listeners.add(cb);
    if (this.last) cb(this.last);
    return () => { this.listeners.delete(cb); };
  }
  reset() { this.last = null; }
}

export function getPlayerId(): string {
  let id = localStorage.getItem('29-player-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('29-player-id', id);
  }
  return id;
}
