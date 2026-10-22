import type { Action, GameState, Rules } from './engine';
import { DEFAULT_RULES, newGame, reduce, viewFor } from './engine';
import { botAction } from './bots';

export interface SeatInfo { playerId: string | null; name: string; bot: boolean; connected: boolean }

export type ServerMsg =
  | {
      type: 'state'; code: string; seat: number; // seat -1 = spectator
      started: boolean; hostSeat: number | null; rules: Rules;
      seats: Pick<SeatInfo, 'name' | 'bot' | 'connected'>[];
      view: ReturnType<typeof viewFor> | null;
    }
  | { type: 'error'; message: string };

export type Send = (playerId: string, msg: ServerMsg) => void;

const ACTIONS = new Set(['BID', 'PASS', 'SET_TRUMP', 'REVEAL', 'PLAY', 'DECLARE_PAIR', 'NEXT_HAND']);

export interface RoomOptions { botDelayMs: number; reconnectGraceMs: number; nextHandMs: number }

/**
 * One Room = one table. It owns the authoritative GameState and never talks to a socket directly;
 * it only calls `send(playerId, msg)`. The Socket.io server (Mode A) and the local WebRTC host
 * (Mode B) both plug their own `send` in.
 */
export class Room {
  state: GameState | null = null;
  rules: Rules = { ...DEFAULT_RULES };
  seats: SeatInfo[] = Array.from({ length: 4 }, () => ({ playerId: null, name: '', bot: false, connected: false }));
  spectators = new Map<string, string>();
  hostId: string | null = null;
  lastActive = Date.now();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private drops = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    public code: string,
    private send: Send,
    private opts: RoomOptions = { botDelayMs: 800, reconnectGraceMs: 15000, nextHandMs: 6000 },
  ) {}

  get started() { return this.state !== null; }
  private seatOf(pid: string) { return this.seats.findIndex(s => s.playerId === pid); }
  humansConnected() { return this.seats.filter(s => s.playerId && s.connected).length + this.spectators.size; }

  /** Join, reconnect to your own seat, or spectate when the table is full / already running. */
  join(playerId: string, name: string): number {
    this.lastActive = Date.now();
    const clean = name.trim().slice(0, 16) || 'Player';
    let seat = this.seatOf(playerId);
    if (seat >= 0) { // reconnect: take the seat back from the bot
      clearTimeout(this.drops.get(playerId)); this.drops.delete(playerId);
      Object.assign(this.seats[seat], { connected: true, bot: false });
    } else if (!this.started && (seat = this.seats.findIndex(s => !s.playerId)) >= 0) {
      this.seats[seat] = { playerId, name: clean, bot: false, connected: true };
    } else {
      this.spectators.set(playerId, clean);
      seat = -1;
    }
    if (!this.hostId) this.hostId = playerId;
    this.broadcast();
    this.schedule();
    return seat;
  }

  /** Host starts; empty seats are filled with bots. */
  start(playerId: string) {
    if (playerId !== this.hostId) return this.err(playerId, 'Only the host can start');
    if (this.started) return;
    this.seats.forEach((s, i) => { if (!s.playerId) Object.assign(s, { name: `Bot ${i + 1}`, bot: true, connected: true }); });
    this.state = newGame(this.rules);
    this.broadcast();
    this.schedule();
  }

  /** Host picks table options before the game starts. Unknown keys and non-booleans are ignored. */
  setRules(playerId: string, patch: Partial<Rules>) {
    if (playerId !== this.hostId) return this.err(playerId, 'Only the host can change the rules');
    if (this.started) return this.err(playerId, 'Rules are locked once the game starts');
    for (const k of Object.keys(DEFAULT_RULES) as (keyof Rules)[]) {
      if (typeof patch?.[k] === 'boolean') this.rules[k] = patch[k] as boolean;
    }
    this.broadcast();
  }

  /** Host starts a fresh match (scores reset) after game over. */
  rematch(playerId: string) {
    if (playerId !== this.hostId) return this.err(playerId, 'Only the host can start a rematch');
    if (this.state?.phase !== 'gameOver') return;
    this.state = newGame(this.rules);
    this.broadcast();
    this.schedule();
  }

  act(playerId: string, raw: Action) {
    this.lastActive = Date.now();
    const seat = this.seatOf(playerId);
    if (!this.state) return this.err(playerId, 'Game not started');
    if (seat < 0) return this.err(playerId, 'Spectators cannot act');
    if (!raw || !ACTIONS.has((raw as Action).type)) return this.err(playerId, 'Bad action');
    // never trust a client-supplied seat
    const action = raw.type === 'NEXT_HAND' ? raw : ({ ...raw, seat } as Action);
    if (action.type === 'NEXT_HAND' && playerId !== this.hostId) return this.err(playerId, 'Host only');
    this.apply(action, playerId);
  }

  disconnect(playerId: string) {
    this.spectators.delete(playerId);
    const seat = this.seatOf(playerId);
    if (seat >= 0) {
      this.seats[seat].connected = false;
      if (!this.started) {
        this.seats[seat] = { playerId: null, name: '', bot: false, connected: false };
      } else {
        // grace period, then a bot covers the seat; the player can still reclaim it
        this.drops.set(playerId, setTimeout(() => {
          this.seats[seat].bot = true; this.broadcast(); this.schedule();
        }, this.opts.reconnectGraceMs));
      }
    }
    if (playerId === this.hostId) {
      this.hostId = this.seats.find(s => s.playerId && s.connected)?.playerId ?? [...this.spectators.keys()][0] ?? null;
    }
    this.broadcast();
  }

  destroy() { if (this.timer) clearTimeout(this.timer); this.drops.forEach(clearTimeout); }

  // ---------- internals ----------

  private apply(action: Action, actor?: string) {
    try {
      this.state = reduce(this.state!, action);
    } catch (e) {
      if (actor) this.err(actor, (e as Error).message);
      else console.error('bot produced illegal action', action, e);
      return;
    }
    this.broadcast();
    this.schedule();
  }

  /** Drives bots and the between-hands pause. Called after every state change. */
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    const s = this.state;
    if (!s || s.phase === 'gameOver') return;
    if (s.phase === 'handOver') {
      this.timer = setTimeout(() => this.apply({ type: 'NEXT_HAND' }), this.opts.nextHandMs);
      return;
    }
    if (this.seats[s.turn].bot) {
      this.timer = setTimeout(() => {
        const a = this.state && botAction(this.state, s.turn);
        if (a) this.apply(a);
      }, this.opts.botDelayMs);
    }
  }

  private broadcast() {
    const names = this.seats.map(({ name, bot, connected }) => ({ name, bot, connected }));
    const hostSeat = this.hostId ? this.seatOf(this.hostId) : null;
    const base = { type: 'state' as const, code: this.code, started: this.started, hostSeat, rules: this.rules, seats: names };
    this.seats.forEach((s, i) => {
      if (s.playerId && s.connected)
        this.send(s.playerId, { ...base, seat: i, view: this.state ? viewFor(this.state, i) : null });
    });
    this.spectators.forEach((_, pid) =>
      this.send(pid, { ...base, seat: -1, view: this.state ? viewFor(this.state, -1) : null }));
  }

  private err(pid: string, message: string) { this.send(pid, { type: 'error', message }); }
}
