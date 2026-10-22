import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { minBidFor } from '../../shared/engine';
import type { Card, Play } from '../../shared/engine';
import type { Session, StateMsg } from '../net/types';
import { CardBack, CardFace, SUIT_SYMBOL, cardKey, isRed } from './Cards';

interface Props { msg: StateMsg; session: Session; onLeave: () => void }

const THROW = ['throw-0', 'throw-1', 'throw-2', 'throw-3'];
const TILT = [-4, 7, -6, 5];
// Play runs counter-clockwise: the next player to act sits on your right.
const SLOT_POS = [
  'bottom-0 left-1/2 -translate-x-1/2',
  'right-0 top-1/2 -translate-y-1/2',
  'top-0 left-1/2 -translate-x-1/2',
  'left-0 top-1/2 -translate-y-1/2',
];

export function Table({ msg, session, onLeave }: Props) {
  const v = msg.view!;
  const me = msg.seat;
  const base = me < 0 ? 0 : me; // spectators view from seat 1's side
  const myTeam = base % 2;
  const rel = (seat: number) => (seat - base + 4) % 4;
  const name = (seat: number) => msg.seats[seat]?.name || `Seat ${seat + 1}`;
  const myHand = me >= 0 ? (v.hands[me] as Card[]) : [];
  const myTurn = me >= 0 && v.turn === me && (v.phase === 'playing' || v.phase === 'bidding' || v.phase === 'trumpSelect');
  const isHost = msg.hostSeat === me;

  const [selected, setSelected] = useState<string | null>(null);
  const [bidVal, setBidVal] = useState(16);
  const [shown, setShown] = useState<{ plays: Play[]; winner: number } | null>(null);

  // keep the finished trick on the table for a moment so the result can be read
  const prevTricks = useRef(v.completedTricks.length);
  useEffect(() => {
    const n = v.completedTricks.length;
    let t: ReturnType<typeof setTimeout> | undefined;
    if (n > prevTricks.current) {
      setShown(v.completedTricks[n - 1]);
      t = setTimeout(() => setShown(null), 1500);
    }
    prevTricks.current = n;
    return () => { if (t) clearTimeout(t); };
  }, [v.completedTricks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const minBid = me >= 0 ? minBidFor(v, me) : 16;
  useEffect(() => { setBidVal(minBid); }, [minBid, v.dealer]);
  useEffect(() => { setSelected(null); }, [v.turn, v.phase]);

  const legal = v.legal;
  const legalKeys = new Set((legal?.cards ?? []).map(cardKey));
  const trickPlays = v.currentTrick.length ? v.currentTrick : shown?.plays ?? [];
  const winnerSeat = v.currentTrick.length ? null : shown?.winner ?? null;

  // Royals: K and Q of trump in hand, trump exposed, and our side has won the exposing trick or a later one
  const holdsPair = !!v.trumpSuit && ['K', 'Q'].every(r => myHand.some(c => c.suit === v.trumpSuit && c.rank === r));
  const canPair = me >= 0 && v.phase === 'playing' && v.trumpRevealed && !v.pair && v.revealTrick !== null
    && v.lastWinTrick[myTeam] >= v.revealTrick && holdsPair;

  const playCard = (card: Card) => {
    session.act({ type: 'PLAY', seat: me, card });
    setSelected(null);
  };

  const onTap = (card: Card) => {
    const key = cardKey(card);
    if (v.phase === 'trumpSelect' && me === v.bidWinner) { setSelected(selected === key ? null : key); return; }
    if (v.phase !== 'playing' || !myTurn || !legalKeys.has(key)) return;
    if (selected !== key) { setSelected(key); return; }
    playCard(card);
  };

  // ---------- header ----------
  const bidderName = v.bidWinner !== null ? name(v.bidWinner) : '';
  const bidTeam = v.bidWinner !== null ? v.bidWinner % 2 : null;
  const target = v.bidValue === null ? null
    : !v.pair ? v.bidValue
    : v.pair.team === bidTeam ? Math.max(v.bidValue - 4, 16) : Math.min(v.bidValue + 4, 28);

  let trumpChip = '';
  if (v.trumpSuit) trumpChip = `Trump ${SUIT_SYMBOL[v.trumpSuit]}${v.trumpRevealed ? '' : ' (hidden)'}`;
  else if (v.bidWinner !== null) trumpChip = 'Trump hidden';

  const lead = v.currentTrick[0]?.card.suit;
  // only the player who asked for trump in this trick is obliged to trump
  const mustTrump = !!(v.trumpRevealed && lead && lead !== v.trumpSuit && legal && legal.cards.length > 0
    && v.revealedBy === me && v.revealTrick === v.completedTricks.length
    && legal.cards.every(c => c.suit === v.trumpSuit));

  // ---------- status / action panel ----------
  let panel: JSX.Element;
  if (me < 0) {
    panel = <Status>Spectating. {name(v.turn)} to act.</Status>;
  } else if (v.phase === 'bidding') {
    panel = myTurn ? (
      <div className="rise flex items-center gap-2">
        <button className="btn !px-4" disabled={bidVal <= minBid} onClick={() => setBidVal(b => b - 1)} aria-label="Lower bid">−</button>
        <span className="w-12 text-center font-serif text-3xl font-bold text-saffron">{bidVal}</span>
        <button className="btn !px-4" disabled={bidVal >= 28} onClick={() => setBidVal(b => b + 1)} aria-label="Raise bid">+</button>
        <button className="btn btn-primary flex-1" disabled={minBid > 28}
                onClick={() => session.act({ type: 'BID', seat: me, value: bidVal })}>Bid {bidVal}</button>
        <button className="btn btn-quiet" onClick={() => session.act({ type: 'PASS', seat: me })}>Pass</button>
      </div>
    ) : (
      <Status>
        {name(v.turn)} is bidding.{' '}
        {v.bidding.highBidder !== null && `High bid ${v.bidding.highBid} by ${name(v.bidding.highBidder)}.`}
      </Status>
    );
  } else if (v.phase === 'trumpSelect') {
    panel = me === v.bidWinner ? (
      <div className="rise grid gap-2">
        <p className="text-sm">You bid {v.bidValue}. Lift a card to set it aside face down; its suit is trump.</p>
        <div className="flex gap-2">
          <button className="btn btn-primary flex-1" disabled={!selected}
                  onClick={() => {
                    const card = myHand.find(c => cardKey(c) === selected);
                    if (card) session.act({ type: 'SET_TRUMP', seat: me, card });
                  }}>Set trump</button>
          <button className="btn btn-quiet" onClick={() => session.act({ type: 'SET_TRUMP', seat: me, seventh: true })}>
            Blind 7th card
          </button>
        </div>
      </div>
    ) : <Status>{bidderName} won the bid at {v.bidValue} and is choosing trump.</Status>;
  } else if (v.phase === 'playing') {
    if (myTurn && legal?.mustReveal) {
      panel = (
        <div className="rise flex items-center gap-3">
          <p className="flex-1 text-sm">Your face-down trump is your only card of this suit.</p>
          <button className="btn btn-primary" onClick={() => session.act({ type: 'REVEAL', seat: me })}>Reveal trump</button>
        </div>
      );
    } else if (myTurn && legal?.canAskReveal) {
      panel = (
        <div className="rise flex items-center gap-3">
          <p className="flex-1 text-sm">No {v.currentTrick[0] ? SUIT_SYMBOL[v.currentTrick[0].card.suit] : ''} left. Discard any card, or ask to see trump (then you must trump if you can).</p>
          <button className="btn btn-primary" onClick={() => session.act({ type: 'REVEAL', seat: me })}>Ask trump</button>
        </div>
      );
    } else if (myTurn) {
      panel = <Status strong>
        Your turn.{selected ? ' Tap the lifted card again to play it.' : ' Tap a card to lift it.'}
        {mustTrump ? ' You asked, so you must play trump.' : ''}
      </Status>;
    } else panel = <Status>Waiting for {name(v.turn)}.</Status>;
  } else panel = <Status>&nbsp;</Status>;

  // ---------- render ----------
  return (
    <div className="flex h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <header className="flex items-center gap-2 px-3 py-2 text-sm">
        <button className="rounded-lg px-2 py-1 text-mute" onClick={() => { if (confirm('Leave this table?')) onLeave(); }}
                aria-label="Leave table">✕</button>
        <div className="flex-1 text-center">
          <span className="font-serif text-lg font-bold">
            <span className="text-saffron">Us {v.gameScore[myTeam] > 0 ? '+' : ''}{v.gameScore[myTeam]}</span>
            <span className="mx-2 text-mute">:</span>
            <span className="text-mint">Them {v.gameScore[1 - myTeam] > 0 ? '+' : ''}{v.gameScore[1 - myTeam]}</span>
          </span>
        </div>
        <span className={`rounded-lg px-2 py-1 ${v.trumpSuit && isRed(v.trumpSuit) && v.trumpRevealed ? 'text-rose' : ''} bg-black/25`}>
          {trumpChip || 'No trump yet'}
        </span>
      </header>

      {v.bidWinner !== null && (
        <p className="px-3 pb-1 text-center text-xs text-mute">
          {bidderName} bid {v.bidValue}
          {v.pair ? `, pair ${v.pair.team === bidTeam ? '−4' : '+4'} (target ${target})` : ''}
          {' · '}
          <span className="text-saffron">Us {v.trickPoints[myTeam]}</span> / <span className="text-mint">Them {v.trickPoints[1 - myTeam]}</span>
          {' · trick '}{Math.min(v.completedTricks.length + 1, 8)} of 8
        </p>
      )}

      <section className="cloth relative mx-2 min-h-0 flex-1 rounded-3xl border border-white/5">
        {/* seats */}
        {[2, 1, 3].map(r => {
          const seat = (base + r) % 4;
          const pos = r === 2 ? 'left-1/2 top-2 -translate-x-1/2' : r === 1 ? 'right-2 top-1/2 -translate-y-1/2' : 'left-2 top-1/2 -translate-y-1/2';
          return <SeatBadge key={seat} className={`absolute ${pos}`} seat={seat} msg={msg} myTeam={myTeam} partner={r === 2} />;
        })}

        {/* trick area */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative aspect-square w-[min(58vw,15rem)] rounded-full border border-dashed border-saffron/25"
               style={{ '--cw': 'clamp(40px, 11.5vw, 58px)' } as CSSProperties}>
            {trickPlays.length === 0 && (
              <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-mute">
                {v.phase === 'playing' ? `${name(v.turn)} leads` : ''}
              </p>
            )}
            {trickPlays.map(p => {
              const r = rel(p.seat);
              return (
                <div key={p.seat} className={`absolute ${SLOT_POS[r]}`}>
                  <div className={winnerSeat === null ? THROW[r] : ''} style={{ rotate: `${TILT[r]}deg` }}>
                    <CardFace card={p.card} ring={winnerSeat === p.seat} className={winnerSeat !== null && winnerSeat !== p.seat ? 'opacity-60' : ''} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* my seat tag */}
        {me >= 0 && (
          <div className={`absolute bottom-1 left-2 rounded-lg px-2 py-1 text-xs ${v.turn === me ? 'bg-saffron text-ink' : 'bg-black/25 text-mute'}`}>
            You{v.dealer === me ? ' · dealer' : ''}
          </div>
        )}
        {me >= 0 && v.hasHiddenTrump && me === v.bidWinner && (
          <div className="absolute bottom-1 right-2 flex items-center gap-1 text-xs text-mute" style={{ '--cw': '22px' } as CSSProperties}>
            <CardBack /> set aside
          </div>
        )}
      </section>

      <div className="min-h-[3.75rem] px-3 py-2">
        {canPair && (
          <button className="btn btn-primary rise mb-2 w-full" onClick={() => session.act({ type: 'DECLARE_PAIR', seat: me })}>
            Declare pair ({v.bidWinner !== null && v.bidWinner % 2 === myTeam ? 'bid −4' : 'bid +4'})
          </button>
        )}
        {panel}
      </div>

      {me >= 0 && (
        <div className="flex items-end justify-center px-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-5"
             style={{ '--cw': 'clamp(48px, 14vw, 68px)' } as CSSProperties}>
          {myHand.map((c, i) => {
            const key = cardKey(c);
            const lifted = selected === key;
            const dim = v.phase === 'playing' && myTurn && !legalKeys.has(key);
            return (
              <button key={key} onClick={() => onTap(c)} aria-pressed={lifted}
                      className={`transition-transform duration-150 ${i > 0 ? '-ml-[clamp(14px,4.2vw,24px)]' : ''} ${
                        lifted ? '-translate-y-5' : ''} ${dim ? 'opacity-45' : ''}`}>
                <CardFace card={c} ring={lifted} />
              </button>
            );
          })}
        </div>
      )}

      {!shown && (v.phase === 'handOver' || v.phase === 'gameOver') && v.handResult && (
        <ResultSheet msg={msg} myTeam={myTeam} isHost={isHost} session={session} onLeave={onLeave} />
      )}
    </div>
  );
}

function Status({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return <p className={`py-2 text-center text-sm ${strong ? 'font-semibold text-saffron' : 'text-mute'}`}>{children}</p>;
}

function SeatBadge({ seat, msg, myTeam, partner, className }: {
  seat: number; msg: StateMsg; myTeam: number; partner: boolean; className: string;
}) {
  const v = msg.view!;
  const info = msg.seats[seat];
  const count = v.hands[seat].length + (seat === v.bidWinner && v.hasHiddenTrump ? 1 : 0);
  const turn = v.turn === seat && v.phase !== 'handOver' && v.phase !== 'gameOver';
  const ours = seat % 2 === myTeam;
  return (
    <div className={`${className} flex w-24 flex-col items-center gap-1 text-center ${info?.connected ? '' : 'opacity-50'}`}>
      <div className={`w-full rounded-xl px-2 py-1 text-xs font-semibold ${
        turn ? 'bg-saffron text-ink' : ours ? 'bg-saffron/20 text-saffron' : 'bg-mint/20 text-mint'}`}>
        <div className="truncate">{info?.name || `Seat ${seat + 1}`}</div>
        <div className="font-normal opacity-80">
          {partner ? 'Partner' : ours ? 'Team' : 'Opponent'}{info?.bot ? ' · bot' : ''}
        </div>
      </div>
      <div className="flex" style={{ '--cw': '14px' } as CSSProperties}>
        {Array.from({ length: Math.min(count, 8) }).map((_, i) => (
          <CardBack key={i} className={i > 0 ? '-ml-2' : ''} />
        ))}
      </div>
      {seat === v.dealer && <span className="text-[10px] text-mute">dealer</span>}
    </div>
  );
}

function ResultSheet({ msg, myTeam, isHost, session, onLeave }: {
  msg: StateMsg; myTeam: number; isHost: boolean; session: Session; onLeave: () => void;
}) {
  const v = msg.view!;
  const r = v.handResult!;
  if (r.cancelled) {
    return (
      <div className="fixed inset-0 z-10 flex items-end justify-center bg-black/55 p-4 sm:items-center">
        <div className="rise w-full max-w-sm rounded-2xl bg-cloth p-5 shadow-xl ring-1 ring-white/10">
          <h2 className="font-serif text-2xl font-bold">Hand cancelled</h2>
          <p className="mt-2 text-sm text-mute">{r.reason} Scores stay as they are. The cards are being dealt again.</p>
        </div>
      </div>
    );
  }
  const bidderName = msg.seats[v.bidWinner ?? 0]?.name;
  const usBid = r.bidTeam === myTeam;
  const over = v.phase === 'gameOver';
  const weWon = v.winnerTeam === myTeam;

  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-black/55 p-4 sm:items-center">
      <div className="rise w-full max-w-sm rounded-2xl bg-cloth p-5 shadow-xl ring-1 ring-white/10">
        {over ? (
          <h2 className="font-serif text-3xl font-bold text-saffron">{weWon ? 'Your team wins' : 'Their team wins'}</h2>
        ) : (
          <h2 className="font-serif text-2xl font-bold">
            {r.made ? `${bidderName}’s team made the bid` : `${bidderName}’s team fell short`}
          </h2>
        )}
        <p className="mt-2 text-sm text-mute">
          Target {r.effectiveBid}. {usBid ? 'You' : 'They'} took {r.points[r.bidTeam]}.
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-saffron/15 p-2"><dt className="text-xs text-mute">Us</dt>
            <dd className="font-serif text-2xl font-bold text-saffron">{r.points[myTeam]} pts · {v.gameScore[myTeam]}</dd></div>
          <div className="rounded-xl bg-mint/15 p-2"><dt className="text-xs text-mute">Them</dt>
            <dd className="font-serif text-2xl font-bold text-mint">{r.points[1 - myTeam]} pts · {v.gameScore[1 - myTeam]}</dd></div>
        </dl>
        {over ? (
          <div className="mt-4 grid gap-2">
            {isHost
              ? <button className="btn btn-primary" onClick={() => session.rematch()}>Play again</button>
              : <p className="text-center text-sm text-mute">The host can start a rematch.</p>}
            <button className="btn btn-quiet" onClick={onLeave}>Leave table</button>
          </div>
        ) : <p className="mt-4 text-center text-sm text-mute">Next hand is being dealt…</p>}
      </div>
    </div>
  );
}
