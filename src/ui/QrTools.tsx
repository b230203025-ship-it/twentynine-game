import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

export function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(text, { errorCorrectionLevel: 'L', margin: 2, width: 320 })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [text]);
  if (!src) return <p className="text-sm text-mute">Code is too long for a QR. Use Copy instead.</p>;
  return <img src={src} alt="QR code" className="mx-auto h-60 w-60 rounded-xl bg-white" />;
}

export function Scanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const BD = (window as unknown as { BarcodeDetector?: new (o: object) => { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!BD) { setErr('This browser cannot scan QR codes. Paste the code instead.'); return; }
    let stop = false;
    let stream: MediaStream | undefined;
    const detector = new BD({ formats: ['qr_code'] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stop) { stream.getTracks().forEach(t => t.stop()); return; }
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const tick = async () => {
          if (stop) return;
          try {
            const r = await detector.detect(v);
            if (r[0]?.rawValue) { onResult(r[0].rawValue); return; }
          } catch { /* keep trying */ }
          setTimeout(tick, 250);
        };
        tick();
      } catch {
        setErr('Camera not available. Paste the code instead.');
      }
    })();
    return () => { stop = true; stream?.getTracks().forEach(t => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-2">
      {err ? <p className="text-sm text-saffron">{err}</p>
           : <video ref={video} playsInline muted className="mx-auto h-60 w-full max-w-xs rounded-xl bg-black object-cover" />}
      <button className="btn btn-quiet w-full" onClick={onClose}>Close scanner</button>
    </div>
  );
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
