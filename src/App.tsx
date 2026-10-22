import { useEffect, useState } from 'react';
import { connectOnline, type OnlineSession } from './net/online';
import type { LocalHost } from './net/local';
import type { Session, StateMsg } from './net/types';
import { Lobby } from './ui/Lobby';
import { Table } from './ui/Table';
import { Waiting } from './ui/Waiting';

export default function App() {
  const [online, setOnline] = useState<OnlineSession | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [local, setLocal] = useState<LocalHost | null>(null);
  const [msg, setMsg] = useState<StateMsg | null>(null);
  const [toast, setToast] = useState('');

  // reconnect with the saved passkey; the server puts us straight back at our table if we had one
  useEffect(() => {
    const pk = localStorage.getItem('29-passkey');
    if (pk) connectOnline(pk).then(setOnline).catch(() => localStorage.removeItem('29-passkey'));
  }, []);

  // an online connection becomes the active session as soon as a table state arrives
  useEffect(() => {
    if (!online) return;
    return online.subscribe(m => { if (m.type === 'state') setSession(online); });
  }, [online]);

  useEffect(() => {
    if (!session) { setMsg(null); return; }
    return session.subscribe(m => {
      if (m.type === 'state') setMsg(m);
      else { setToast(m.message); setTimeout(() => setToast(''), 3500); }
    });
  }, [session]);

  const leave = () => {
    session?.leave();
    if (session?.kind === 'local') setLocal(null);
    setSession(null);
    setMsg(null);
  };

  let screen: JSX.Element;
  if (!session) {
    screen = (
      <Lobby
        online={online}
        onOnline={setOnline}
        onLocal={(s) => { setSession(s); setLocal(s.kind === 'local' && 'createInvite' in s ? (s as LocalHost) : null); }}
      />
    );
  } else if (!msg) {
    screen = <p className="p-8 text-center text-mute">Connecting…</p>;
  } else if (!msg.started) {
    screen = <Waiting msg={msg} session={session} local={local} onLeave={leave} />;
  } else {
    screen = <Table msg={msg} session={session} onLeave={leave} />;
  }

  return (
    <>
      {screen}
      {toast && (
        <div role="status" className="rise fixed inset-x-4 top-[max(1rem,env(safe-area-inset-top))] z-20 mx-auto max-w-sm rounded-xl bg-rose px-4 py-3 text-center text-sm font-semibold text-paper shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
