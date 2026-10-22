import type { Action, Card, GameState, Suit } from './engine';
import { MAX_BID, POINTS, canDeclarePair, legalPlays, minBidFor, strength, teamOf, trickWinner } from './engine';

/** Returns the bot's next action for `seat`, or null if it is not that seat's turn. */
export function botAction(s: GameState, seat: number): Action | null {
  if (s.turn !== seat) return null;
  const hand = s.hands[seat];

  if (s.phase === 'bidding') {
    const pts = hand.reduce((n, c) => n + POINTS[c.rank], 0);
    const willing = pts >= 3 ? 16 + (pts - 3) : 0;
    const next = minBidFor(s, seat);
    return next <= Math.min(willing, MAX_BID) ? { type: 'BID', seat, value: next } : { type: 'PASS', seat };
  }

  if (s.phase === 'trumpSelect') {
    const bySuit = new Map<Suit, Card[]>();
    hand.forEach(c => bySuit.set(c.suit, [...(bySuit.get(c.suit) ?? []), c]));
    const score = (cs: Card[]) => cs.length * 10 + cs.reduce((n, c) => n + POINTS[c.rank], 0);
    const best = [...bySuit.values()].sort((a, b) => score(b) - score(a))[0];
    const card = [...best].sort((a, b) => strength(a.rank) - strength(b.rank))[0]; // set aside the lowest
    return Math.random() < 0.1 ? { type: 'SET_TRUMP', seat, seventh: true } : { type: 'SET_TRUMP', seat, card };
  }

  if (s.phase !== 'playing') return null;

  if (canDeclarePair(s, seat)) return { type: 'DECLARE_PAIR', seat };

  const lg = legalPlays(s, seat);
  if (lg.mustReveal) return { type: 'REVEAL', seat };
  if (lg.canAskReveal && Math.random() < 0.35) return { type: 'REVEAL', seat };

  const trump: Suit | null = s.trumpRevealed || seat === s.bidWinner ? s.trumpSuit : null;
  const cards = lg.cards;
  const play = (card: Card): Action => ({ type: 'PLAY', seat, card });

  const lowest = [...cards].sort((a, b) => POINTS[a.rank] - POINTS[b.rank] || strength(a.rank) - strength(b.rank));
  if (s.currentTrick.length === 0) return play([...cards].sort((a, b) => strength(a.rank) - strength(b.rank))[0]);

  const lead = s.currentTrick[0].card.suit;
  const winnerNow = trickWinner(s.currentTrick, trump ?? lead, s.trumpRevealed);
  if (teamOf(winnerNow.seat) === teamOf(seat)) {
    // partner is winning: feed points
    return play([...cards].sort((a, b) => POINTS[b.rank] - POINTS[a.rank] || strength(a.rank) - strength(b.rank))[0]);
  }
  const winners = cards.filter(c =>
    trickWinner([...s.currentTrick, { seat, card: c }], trump ?? lead, s.trumpRevealed).seat === seat);
  if (winners.length) return play([...winners].sort((a, b) => strength(a.rank) - strength(b.rank))[0]);
  return play(lowest[0]);
}
