import { useState } from 'react';
import type { LocalHost } from '../net/local';
import type { Session, StateMsg } from '../net/types';
import { Qr, Scanner, copyText } from './QrTools';

interface Props { msg: StateMsg; session: Session; local: LocalHost | null; onLeave: () => void }

export function Waiting({ msg, session, local, onLeave }: Props) {
  const isHost = msg.hostSeat === msg.seat;
  const teamOf = (i: number) => (i % 2 === 0 ? 'Team A' : 'Team B');

  return (
    <main className="cloth mx-auto flex min-h-full flex-col px-5 pb-8 pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-sm">
        {session.kind === 'online' ? (
          <>
            <p className="text-sm text-mute">Room code</p>
            <p className="font-serif text-6xl font-bold tracking-widest text-saffron">{msg.code}</p>
            <button className="btn btn-quiet mt-2 !py-2 text-sm" onClick={() => {
              const text = `Join my Twenty-Nine table with code ${msg.code}`;
              if (navigator.share) navigator.share({ text }).catch(() => {}); else copyText(msg.code);
            }}>Share code</button>
          </>
        ) : (
          <p className="font-serif text-3xl font-bold text-saffron">Local table</p>
        )}

        <p className="mt-6 text-sm text-mute">Partners sit opposite each other: seats 1 and 3 against seats 2 and 4.</p>
        <ul className="mt-2 grid gap-2">
          {msg.seats.map((s, i) => (
            <li key={i} className={`flex items-center justify-between rounded-xl px-4 py-3 ${
              s.name ? 'bg-cloth-2' : 'border border-dashed border-mute/40'}`}>
              <span>{i + 1}. {s.name || 'Open seat'}{i === msg.seat ? ' (you)' : ''}</span>
              <span className="text-sm text-mute">{teamOf(i)}{i === msg.hostSeat ? ' · host' : ''}</span>
            </li>
          ))}
        </ul>

        <RulesPanel msg={msg} session={session} editable={isHost} />

        {local && <HostSlots host={local} msg={msg} />}

        <div className="mt-6 grid gap-3">
          {isHost
            ? <button className="btn btn-primary" onClick={() => session.start()}>Start game (empty seats get bots)</button>
            : <p className="text-center text-mute">Waiting for the host to start…</p>}
          <button className="btn btn-quiet" onClick={onLeave}>Leave table</button>
        </div>
      </div>
    </main>
  );
}

function HostSlots({ host, msg }: { host: LocalHost; msg: StateMsg }) {
  void msg; // re-renders whenever the table changes
  return (
    <div className="mt-6 grid gap-3">
      <p className="text-sm text-mute">Invite up to three players. Each one needs their own invite.</p>
      {[0, 1, 2].map(i => <Slot key={i} i={i} host={host} />)}
    </div>
  );
}

function Slot({ i, host }: { i: number; host: LocalHost }) {
  const [invite, setInvite] = useState('');
  const [reply, setReply] = useState('');
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const state = host.slotState(i);

  const accept = async (text: string) => {
    setBusy(true); setErr('');
    try { await host.acceptReply(i, text); setReply(''); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (state === 'connected') return <div className="rounded-xl bg-mint/15 px-4 py-3 text-mint">Guest {i + 1} connected</div>;

  return (
    <div className="rounded-xl border border-mute/30 p-3">
      {!invite ? (
        <button className="btn w-full" disabled={busy} onClick={async () => {
          setBusy(true); setErr('');
          try { setInvite(await host.createInvite(i)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}>{busy ? 'Preparing…' : `Invite guest ${i + 1}`}</button>
      ) : (
        <div className="grid gap-3 text-center">
          <p className="text-sm">Guest {i + 1}: scan this, or send them the code.</p>
          <Qr text={invite} />
          <button className="btn" onClick={() => copyText(invite)}>Copy invite code</button>
          <p className="text-sm text-mute">Then enter their reply:</p>
          {scan
            ? <Scanner onResult={t => { setScan(false); setReply(t); accept(t); }} onClose={() => setScan(false)} />
            : <button className="btn" onClick={() => setScan(true)}>Scan their reply</button>}
          <textarea className="field h-20 font-mono text-xs" placeholder="Paste reply code" value={reply}
                    onChange={e => setReply(e.target.value)} aria-label={`Reply code from guest ${i + 1}`} />
          <button className="btn btn-primary" disabled={busy || !reply.trim()} onClick={() => accept(reply)}>Connect</button>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-saffron" role="alert">{err}</p>}
    </div>
  );
}

const RULE_LABELS: { key: 'lastTrickPoint' | 'noUnderTrump' | 'dealerForcedBid'; title: string; hint: string }[] = [
  { key: 'lastTrickPoint', title: 'Last trick is worth 1 point', hint: 'Makes 29 points in total instead of 28.' },
  { key: 'noUnderTrump', title: 'No under-trumping', hint: 'Once a trump is on the table you cannot play a lower one, unless you have no choice.' },
  { key: 'dealerForcedBid', title: 'Dealer must bid 16 if all pass', hint: 'Off means everyone passing gives a redeal.' },
];

function RulesPanel({ msg, session, editable }: { msg: StateMsg; session: Session; editable: boolean }) {
  return (
    <fieldset className="mt-6 grid gap-2">
      <legend className="mb-1 text-sm text-mute">Table rules{editable ? '' : ' (set by the host)'}</legend>
      {RULE_LABELS.map(r => (
        <label key={r.key} className="flex items-start gap-3 rounded-xl bg-black/20 px-4 py-3">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-[#f0a93b]" disabled={!editable}
                 checked={msg.rules[r.key]} onChange={e => session.setRules({ [r.key]: e.target.checked })} />
          <span>
            <span className="block text-sm font-semibold">{r.title}</span>
            <span className="block text-xs text-mute">{r.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
