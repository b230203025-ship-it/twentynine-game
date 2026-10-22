/**
 * Mode B: no server, no internet. One device (the host) runs the Room in its own browser and
 * talks to up to three phones over WebRTC data channels. Signaling is done by hand: the host
 * shows an invite (text + QR), the guest answers with a reply code, the host enters it.
 * With no ICE servers, only same-network (Wi-Fi / hotspot) host candidates are used.
 */
import type { Action, Rules } from '../../shared/engine';
import { Room } from '../../shared/room';
import type { ServerMsg } from '../../shared/room';
import { Emitter, getPlayerId, type Listener, type Session } from './types';

const rtcConfig: RTCConfiguration = { iceServers: [] };

const encode = (d: RTCSessionDescription | null) => {
  if (!d) throw new Error('No session description');
  return btoa(JSON.stringify({ type: d.type, sdp: d.sdp }));
};
const decode = (s: string): RTCSessionDescriptionInit => {
  try { return JSON.parse(atob(s.trim())); } catch { throw new Error('That code is not valid. Copy it again in full.'); }
};

function iceDone(pc: RTCPeerConnection) {
  return new Promise<void>(resolve => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const t = setTimeout(resolve, 4000);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    });
  });
}

interface Slot { pc: RTCPeerConnection; dc: RTCDataChannel; pid?: string }

export class LocalHost implements Session {
  readonly kind = 'local' as const;
  readonly myId = getPlayerId();
  private em = new Emitter();
  private room: Room;
  private slots: (Slot | undefined)[] = [undefined, undefined, undefined];
  private chans = new Map<string, RTCDataChannel>();

  constructor(name: string) {
    this.room = new Room('LOCAL', (pid, msg: ServerMsg) => {
      if (pid === this.myId) this.em.emit(msg);
      else {
        const dc = this.chans.get(pid);
        if (dc?.readyState === 'open') dc.send(JSON.stringify(msg));
      }
    }, { botDelayMs: 700, reconnectGraceMs: 10000, nextHandMs: 5000 });
    this.room.join(this.myId, name);
  }

  subscribe(cb: Listener) { return this.em.subscribe(cb); }
  start() { this.room.start(this.myId); }
  act(a: Action) { this.room.act(this.myId, a); }
  rematch() { this.room.rematch(this.myId); }
  setRules(patch: Partial<Rules>) { this.room.setRules(this.myId, patch); }
  leave() {
    this.slots.forEach((_, i) => this.closeSlot(i));
    this.room.destroy();
    this.em.reset();
  }

  slotState(i: number): 'empty' | 'waiting' | 'connected' {
    const s = this.slots[i];
    if (!s) return 'empty';
    return s.pid && s.dc.readyState === 'open' ? 'connected' : 'waiting';
  }

  /** Step 1 (host): create an invite for guest slot i. */
  async createInvite(i: number): Promise<string> {
    this.closeSlot(i);
    const pc = new RTCPeerConnection(rtcConfig);
    const dc = pc.createDataChannel('game');
    const slot: Slot = { pc, dc };
    this.slots[i] = slot;
    dc.onmessage = e => this.onGuest(slot, String(e.data));
    dc.onclose = () => this.drop(slot);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(slot);
    };
    await pc.setLocalDescription(await pc.createOffer());
    await iceDone(pc);
    return encode(pc.localDescription);
  }

  /** Step 3 (host): accept the guest's reply code. */
  async acceptReply(i: number, reply: string) {
    const s = this.slots[i];
    if (!s) throw new Error('Create an invite first');
    await s.pc.setRemoteDescription(decode(reply));
  }

  private closeSlot(i: number) {
    const s = this.slots[i];
    if (!s) return;
    this.slots[i] = undefined;
    this.drop(s);
    s.pc.close();
  }

  private onGuest(slot: Slot, raw: string) {
    let m: { t: string; name?: string; playerId?: string; action?: Action; rules?: Partial<Rules> };
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'hello' && typeof m.playerId === 'string' && !slot.pid) {
      slot.pid = m.playerId;
      this.chans.set(m.playerId, slot.dc);
      this.room.join(m.playerId, String(m.name ?? ''));
    } else if (slot.pid) {
      if (m.t === 'act' && m.action) this.room.act(slot.pid, m.action);
      else if (m.t === 'start') this.room.start(slot.pid);
      else if (m.t === 'rematch') this.room.rematch(slot.pid);
      else if (m.t === 'rules' && m.rules) this.room.setRules(slot.pid, m.rules);
    }
  }

  private drop(slot: Slot) {
    if (slot.pid && this.chans.get(slot.pid) === slot.dc) {
      this.chans.delete(slot.pid);
      this.room.disconnect(slot.pid);
    }
  }
}

export class LocalGuest implements Session {
  readonly kind = 'local' as const;
  private em = new Emitter();
  private pc = new RTCPeerConnection(rtcConfig);
  private dc: RTCDataChannel | null = null;

  constructor(private name: string) {}

  subscribe(cb: Listener) { return this.em.subscribe(cb); }
  start() { this.send({ t: 'start' }); }
  act(action: Action) { this.send({ t: 'act', action }); }
  rematch() { this.send({ t: 'rematch' }); }
  setRules(rules: Partial<Rules>) { this.send({ t: 'rules', rules }); }
  leave() { this.pc.close(); this.em.reset(); }

  private send(o: unknown) { if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(o)); }

  /** Step 2 (guest): take the host's invite, produce the reply code. */
  async reply(invite: string): Promise<string> {
    this.pc.ondatachannel = e => {
      const dc = (this.dc = e.channel);
      dc.onopen = () => dc.send(JSON.stringify({ t: 'hello', name: this.name, playerId: getPlayerId() }));
      dc.onmessage = ev => { try { this.em.emit(JSON.parse(String(ev.data))); } catch { /* ignore */ } };
      dc.onclose = () => this.em.emit({ type: 'error', message: 'Lost connection to the host' });
    };
    await this.pc.setRemoteDescription(decode(invite));
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await iceDone(this.pc);
    return encode(this.pc.localDescription);
  }
}
