import { useEffect, useState } from 'react';

interface BIPEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

export function InstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [hidden, setHidden] = useState(() => localStorage.getItem('29-install-dismissed') === '1');
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  if (standalone || hidden || (!evt && !ios)) return null;

  const dismiss = () => { localStorage.setItem('29-install-dismissed', '1'); setHidden(true); };

  return (
    <div className="rise mx-auto mt-4 flex max-w-sm items-center gap-3 rounded-xl border border-saffron/40 bg-black/25 p-3 text-sm">
      <p className="flex-1">
        {evt ? 'Install Twenty-Nine to play full screen, even offline.'
             : 'To install: tap Share, then Add to Home Screen.'}
      </p>
      {evt && (
        <button className="btn btn-primary !px-3 !py-2" onClick={async () => { await evt.prompt(); setEvt(null); }}>
          Install
        </button>
      )}
      <button className="text-mute" aria-label="Dismiss" onClick={dismiss}>✕</button>
    </div>
  );
}
