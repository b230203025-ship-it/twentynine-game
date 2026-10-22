import { useState } from 'react';
import { connectOnline, type OnlineSession } from '../net/online';
import { LocalGuest, LocalHost } from '../net/local';
import type { Session } from '../net/types';
import { InstallPrompt } from './InstallPrompt';
import { Qr, Scanner, copyText } from './QrTools';

type Mode = 'home' | 'online' | 'host' | 'join';

interface Props {
  online: OnlineSession | null;
  onOnline: (c: OnlineSession) => void;
  onLocal: (s: Session) => void;
}

export function Lobby({ online, onOnline, onLocal }: Props) {
  const [mode, setMode] = useState<Mode>('home');
  const [name, setName] = useState(() => localStorage.getItem('29-name') ?? '');
  const saveName = (v: string) => { setName(v); localStorage.setItem('29-name', v); };
  const ready = name.trim().length > 0;

  return (
    <main className="cloth mx-auto flex min-h-full flex-col px-5 pb-8 pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="font-serif text-6xl font-bold leading-none text-saffron">29</h1>
        <p className="mt-2 text-mute">Four players, two teams, one hidden trump.</p>

        <label className="mt-8 block text-sm text-mute" htmlFor="name">Your name</label>
        <input id="name" className="field mt-1" value={name} maxLength={16}
               onChange={e => saveName(e.target.value)} placeholder="Name shown at the table" />

        {mode === 'home' && (
          <div className="rise mt-6 grid gap-3">
            <button className="btn btn-primary" disabled={!ready} onClick={() => setMode('online')}>
              Play online with a room code
            </button>
            <button className="btn" disabled={!ready} onClick={() => setMode('host')}>
              Host a local game (no internet)
            </button>
            <button className="btn" disabled={!ready} onClick={() => setMode('join')}>
              Join a local game
            </button>
            <InstallPrompt />
          </div>
        )}

        {mode === 'online' && (
          <OnlineForm name={name.trim()} online={online} onOnline={onOnline} onBack={() => setMode('home')} />
        )}
        {mode === 'host' && (
          <HostStart name={name.trim()} onLocal={onLocal} onBack={() => setMode('home')} />
        )}
        {mode === 'join' && (
          <JoinLocal name={name.trim()} onLocal={onLocal} onBack={() => setMode('home')} />
        )}
      </div>
    </main>
  );
}

function OnlineForm({ name, online, onOnline, onBack }: {
  name: string; online: OnlineSession | null; onOnline: (c: OnlineSession) => void; onBack: () => void;
}) {
  const [passkey, setPasskey] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (!online) {
    return (
      <form className="rise mt-6 grid gap-3" onSubmit={e => {
        e.preventDefault();
        run(async () => {
          const c = await connectOnline(passkey);
          localStorage.setItem('29-passkey', passkey);
          onOnline(c);
        });
      }}>
        <label className="text-sm text-mute" htmlFor="pk">Table passkey</label>
        <input id="pk" type="password" className="field" value={passkey} autoComplete="current-password"
               onChange={e => setPasskey(e.target.value)} />
        {err && <p className="text-sm text-saffron" role="alert">{err}</p>}
        <button className="btn btn-primary" disabled={busy || !passkey}>{busy ? 'Connecting…' : 'Continue'}</button>
        <button type="button" className="btn btn-quiet" onClick={onBack}>Back</button>
      </form>
    );
  }

  return (
    <div className="rise mt-6 grid gap-3">
      <button className="btn btn-primary" disabled={busy} onClick={() => run(() => online.create(name))}>
        Create a room
      </button>
      <div className="flex gap-2">
        <input className="field" inputMode="numeric" placeholder="Room code" value={code} maxLength={6}
               onChange={e => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Room code" />
        <button className="btn" disabled={busy || code.length < 4} onClick={() => run(() => online.join(code, name))}>
          Join
        </button>
      </div>
      {err && <p className="text-sm text-saffron" role="alert">{err}</p>}
      <button className="btn btn-quiet" onClick={onBack}>Back</button>
    </div>
  );
}

function HostStart({ name, onLocal, onBack }: { name: string; onLocal: (s: Session) => void; onBack: () => void }) {
  return (
    <div className="rise mt-6 grid gap-3 text-sm">
      <p className="text-mute">
        This device runs the game. Everyone joins from their own phone on the same Wi-Fi or hotspot.
        You will invite each player with a QR code. Empty seats are filled by bots.
      </p>
      <button className="btn btn-primary" onClick={() => onLocal(new LocalHost(name))}>Start hosting</button>
      <button className="btn btn-quiet" onClick={onBack}>Back</button>
    </div>
  );
}

function JoinLocal({ name, onLocal, onBack }: { name: string; onLocal: (s: Session) => void; onBack: () => void }) {
  const [invite, setInvite] = useState('');
  const [reply, setReply] = useState('');
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [guest, setGuest] = useState<LocalGuest | null>(null);

  const makeReply = async (text: string) => {
    setBusy(true); setErr('');
    try {
      const g = new LocalGuest(name);
      const r = await g.reply(text);
      setGuest(g);
      setReply(r);
      const off = g.subscribe(m => { if (m.type === 'state') { off(); onLocal(g); } });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (reply) {
    return (
      <div className="rise mt-6 grid gap-3 text-center">
        <p>Show this reply to the host. They scan it or paste it into their screen.</p>
        <Qr text={reply} />
        <button className="btn" onClick={() => copyText(reply)}>Copy reply code</button>
        <p className="text-sm text-mute">Waiting for the host to connect…</p>
        <button className="btn btn-quiet" onClick={() => { guest?.leave(); setReply(''); setInvite(''); }}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="rise mt-6 grid gap-3">
      <p className="text-sm text-mute">Scan the host’s invite, or paste the invite code.</p>
      {scan
        ? <Scanner onResult={t => { setScan(false); setInvite(t); makeReply(t); }} onClose={() => setScan(false)} />
        : <button className="btn" onClick={() => setScan(true)}>Scan invite QR</button>}
      <textarea className="field h-24 font-mono text-xs" placeholder="Paste invite code" value={invite}
                onChange={e => setInvite(e.target.value)} aria-label="Invite code" />
      {err && <p className="text-sm text-saffron" role="alert">{err}</p>}
      <button className="btn btn-primary" disabled={busy || !invite.trim()} onClick={() => makeReply(invite)}>
        {busy ? 'Working…' : 'Create reply'}
      </button>
      <button className="btn btn-quiet" onClick={onBack}>Back</button>
    </div>
  );
}
