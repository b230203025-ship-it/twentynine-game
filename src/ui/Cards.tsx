import type { Card, Suit } from '../../shared/engine';

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const isRed = (s: Suit) => s === 'H' || s === 'D';
export const cardKey = (c: Card) => `${c.suit}${c.rank}`;

/** Card width comes from the --cw custom property so each area can size its own cards. */
export function CardFace({ card, className = '', ring = false }: { card: Card; className?: string; ring?: boolean }) {
  const color = isRed(card.suit) ? 'text-rose' : 'text-ink';
  return (
    <div
      aria-label={`${card.rank} of ${SUIT_NAME[card.suit]}`}
      className={`relative aspect-[5/7] w-[var(--cw)] rounded-[calc(var(--cw)*0.12)] bg-paper shadow-md ${color} ${
        ring ? 'ring-4 ring-saffron' : 'ring-1 ring-black/20'
      } ${className}`}
    >
      <div className="absolute left-[10%] top-[6%] flex flex-col items-center font-serif font-bold leading-none"
           style={{ fontSize: 'calc(var(--cw) * 0.3)' }}>
        <span>{card.rank}</span>
        <span style={{ fontSize: 'calc(var(--cw) * 0.26)' }}>{SUIT_SYMBOL[card.suit]}</span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center pt-[18%] leading-none"
           style={{ fontSize: 'calc(var(--cw) * 0.62)' }}>
        {SUIT_SYMBOL[card.suit]}
      </div>
    </div>
  );
}

export function CardBack({ className = '' }: { className?: string }) {
  return (
    <div
      className={`relative aspect-[5/7] w-[var(--cw)] rounded-[calc(var(--cw)*0.12)] bg-cloth-2 ring-1 ring-black/30 shadow-md ${className}`}
      style={{
        backgroundImage:
          'repeating-linear-gradient(45deg, rgba(240,169,59,.35) 0 2px, transparent 2px 7px), repeating-linear-gradient(-45deg, rgba(240,169,59,.35) 0 2px, transparent 2px 7px)',
      }}
    >
      <div className="absolute inset-[14%] rounded-[calc(var(--cw)*0.08)] border-2 border-saffron/70" />
    </div>
  );
}
