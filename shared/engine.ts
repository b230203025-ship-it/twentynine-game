/**
 * Twenty-Nine (29) rules engine, South Asian rules.
 * Pure + deterministic: reduce(state, action) -> new state (throws on illegal action).
 * Runs unchanged on the Socket.io server (Mode A) and on the local host device (Mode B).
 *
 * Seats 0..3. Play and bidding go COUNTER-CLOCKWISE: nextSeat(seat) is the player on your right.
 * Teams: seats 0&2 = team 0, seats 1&3 = team 1 (partners sit opposite).
 */

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 'J' | '9' | 'A' | '10' | 'K' | 'Q' | '8' | '7';
export interface Card { suit: Suit; rank: Rank }

export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const RANKS: Rank[] = ['J', '9', 'A', '10', 'K', 'Q', '8', '7']; // high -> low
export const POINTS: Record<Rank, number> = { J: 3, '9': 2, A: 1, '10': 1, K: 0, Q: 0, '8': 0, '7': 0 };
export const MIN_BID = 16;
export const MAX_BID = 28;
export const PAIR_BONUS = 4;
export const WIN_SCORE = 6; // red/black 6s: first to +6 (all red pips) or opponent at -6 (all black pips)

/** Table options. Defaults follow the common South Asian rules; hosts can switch the variants. */
export interface Rules {
  /** +1 card point for the last trick (28 -> 29 total). */
  lastTrickPoint: boolean;
  /** After a trump has been played to a trick, nobody may play a lower trump (unless forced). */
  noUnderTrump: boolean;
  /** If everyone passes, the dealer must bid 16 (otherwise the hand is redealt). */
  dealerForcedBid: boolean;
}
export const DEFAULT_RULES: Rules = { lastTrickPoint: true, noUnderTrump: true, dealerForcedBid: false };

export const strength = (r: Rank) => 7 - RANKS.indexOf(r);
export const sameCard = (a: Card, b: Card) => a.suit === b.suit && a.rank === b.rank;
export const teamOf = (seat: number) => seat % 2;
export const nextSeat = (seat: number) => (seat + 1) % 4;

export type Phase = 'bidding' | 'trumpSelect' | 'playing' | 'handOver' | 'gameOver';

export interface Play { seat: number; card: Card }

export type HandResult =
  | { cancelled: true; reason: string }
  | { cancelled: false; bidTeam: number; effectiveBid: number; points: [number, number]; made: boolean };

export interface GameState {
  rules: Rules;
  phase: Phase;
  dealer: number;
  turn: number;
  hands: Card[][];            // bidder's face-down trump card is NOT in here until revealed
  secondDeal: Card[][];       // server-only: cards dealt after bidding
  bidding: { highBid: number; highBidder: number | null; passed: boolean[] };
  bidWinner: number | null;
  bidValue: number | null;
  trumpSuit: Suit | null;     // server-only until revealed
  hiddenTrumpCard: Card | null;
  trumpRevealed: boolean;
  revealedBy: number | null;
  revealTrick: number | null; // index (0-7) of the trick in which trump was exposed
  currentTrick: Play[];
  completedTricks: { plays: Play[]; winner: number }[];
  lastWinTrick: [number, number]; // index of the latest trick each team won (-1 = none)
  trickPoints: [number, number];
  pair: { seat: number; team: number } | null;
  gameScore: [number, number];
  handResult: HandResult | null;
  winnerTeam: number | null;
}

export type Action =
  | { type: 'BID'; seat: number; value: number }
  | { type: 'PASS'; seat: number }
  /** Pick a card from your first four to set face down, or `seventh: true` to use your blind 7th card. */
  | { type: 'SET_TRUMP'; seat: number; card?: Card; seventh?: boolean }
  | { type: 'REVEAL'; seat: number }
  | { type: 'PLAY'; seat: number; card: Card }
  | { type: 'DECLARE_PAIR'; seat: number }
  | { type: 'NEXT_HAND' };

const fail = (msg: string): never => { throw new Error(msg); };

// ---------- setup ----------

export function makeDeck(): Card[] {
  return SUITS.flatMap(suit => RANKS.map(rank => ({ suit, rank })));
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sortHand = (h: Card[]) =>
  h.sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || strength(b.rank) - strength(a.rank));

function startHand(s: GameState, dealer: number, rng: () => number): GameState {
  const deck = shuffle(makeDeck(), rng);
  const hands: Card[][] = [[], [], [], []];
  const secondDeal: Card[][] = [[], [], [], []];
  for (let i = 0; i < 16; i++) hands[i % 4].push(deck[i]);
  for (let i = 16; i < 32; i++) secondDeal[i % 4].push(deck[i]);
  hands.forEach(sortHand);
  const first = nextSeat(dealer); // player to the dealer's right bids and leads first
  return {
    ...s, phase: 'bidding', dealer, turn: first, hands, secondDeal,
    bidding: { highBid: 0, highBidder: null, passed: [false, false, false, false] },
    bidWinner: null, bidValue: null, trumpSuit: null, hiddenTrumpCard: null,
    trumpRevealed: false, revealedBy: null, revealTrick: null, currentTrick: [], completedTricks: [],
    lastWinTrick: [-1, -1], trickPoints: [0, 0], pair: null, handResult: null,
  };
}

export function newGame(rules: Rules = DEFAULT_RULES, rng: () => number = Math.random): GameState {
  const blank = { rules, gameScore: [0, 0] as [number, number], winnerTeam: null } as GameState;
  return startHand(blank, Math.floor(rng() * 4), rng);
}

// ---------- bidding helpers ----------

/**
 * Lowest bid `seat` may make now. A bid must beat the current high bid, except that a player who bids
 * earlier in the bidding order than the current high bidder (the senior hand) may match it.
 */
export function minBidFor(
  s: { dealer: number; bidding: { highBid: number; highBidder: number | null } }, seat: number,
): number {
  const { highBid, highBidder } = s.bidding;
  if (highBidder === null) return MIN_BID;
  const order = (x: number) => (x - nextSeat(s.dealer) + 4) % 4;
  return order(seat) < order(highBidder) ? highBid : highBid + 1;
}

// ---------- legal-move logic ----------

export interface Legal { cards: Card[]; canAskReveal: boolean; mustReveal: boolean }

export function legalPlays(s: GameState, seat: number): Legal {
  const hand = s.hands[seat];
  if (s.currentTrick.length === 0) return { cards: hand, canAskReveal: false, mustReveal: false };

  const lead = s.currentTrick[0].card.suit;
  const follow = hand.filter(c => c.suit === lead);
  if (follow.length) return { cards: follow, canAskReveal: false, mustReveal: false };

  // Void in the lead suit.
  // The bidder's face-down card counts as theirs for following suit: if it is the only card of the lead suit,
  // they have to expose it.
  if (!s.trumpRevealed && seat === s.bidWinner && s.hiddenTrumpCard?.suit === lead)
    return { cards: [], canAskReveal: false, mustReveal: true };

  // Trump still hidden: discard anything, or ask for trump to be shown.
  if (!s.trumpRevealed) return { cards: hand, canAskReveal: true, mustReveal: false };

  // Trump is known. Free choice, except: the player who asked in this trick must trump if able,
  // and (optionally) nobody may under-trump.
  const trumps = hand.filter(c => c.suit === s.trumpSuit);
  const asker = s.revealedBy === seat && s.revealTrick === s.completedTricks.length;
  let cards = hand;
  const trumpsInTrick = s.currentTrick.filter(p => p.card.suit === s.trumpSuit);
  const best = trumpsInTrick.length ? Math.max(...trumpsInTrick.map(p => strength(p.card.rank))) : -1;
  const higher = trumps.filter(c => strength(c.rank) > best);

  if (asker && trumps.length) cards = s.rules.noUnderTrump && best >= 0 && higher.length ? higher : trumps;
  else if (s.rules.noUnderTrump && best >= 0 && trumps.length) {
    const allowed = hand.filter(c => c.suit !== s.trumpSuit || strength(c.rank) > best);
    cards = allowed.length ? allowed : hand; // only lower trumps left: forced
  }
  return { cards, canAskReveal: false, mustReveal: false };
}

/** `active` = trump has been exposed during or before this trick, so every trump-suit card in it counts. */
export function trickWinner(trick: Play[], trumpSuit: Suit, active: boolean): Play {
  const lead = trick[0].card.suit;
  const trumps = active ? trick.filter(p => p.card.suit === trumpSuit) : [];
  const pool = trumps.length ? trumps : trick.filter(p => p.card.suit === lead);
  return pool.reduce((b, p) => (strength(p.card.rank) > strength(b.card.rank) ? p : b));
}

/** Royals: both K and Q of trump still in hand, trump exposed, and your side has won the trick in which
 *  trump was exposed or a later one. */
export function canDeclarePair(s: GameState, seat: number): boolean {
  if (s.phase !== 'playing' || !s.trumpRevealed || s.pair || s.revealTrick === null) return false;
  if (s.lastWinTrick[teamOf(seat)] < s.revealTrick) return false;
  return ['K', 'Q'].every(r => s.hands[seat].some(c => c.suit === s.trumpSuit && c.rank === r));
}

// ---------- reducer ----------

export function reduce(prev: GameState, action: Action, rng: () => number = Math.random): GameState {
  const s: GameState = structuredClone(prev);

  switch (action.type) {
    case 'BID': return bid(s, action.seat, action.value);
    case 'PASS': return pass(s, action.seat, rng);
    case 'SET_TRUMP': return setTrump(s, action.seat, action.card, !!action.seventh);
    case 'REVEAL': return reveal(s, action.seat);
    case 'PLAY': return play(s, action.seat, action.card);
    case 'DECLARE_PAIR':
      if (!canDeclarePair(s, action.seat)) fail('Cannot declare pair now');
      s.pair = { seat: action.seat, team: teamOf(action.seat) };
      return s;
    case 'NEXT_HAND':
      if (s.phase !== 'handOver') fail('Hand not over');
      return startHand(s, nextSeat(s.dealer), rng);
  }
}

function advanceBidding(s: GameState, rng: () => number): GameState {
  const b = s.bidding;
  const active = b.passed.map((p, i) => (p ? -1 : i)).filter(i => i >= 0);
  if (b.highBidder === null && active.length === 0) {
    return startHand(s, nextSeat(s.dealer), rng); // everyone passed: redeal, dealer rotates
  }
  if (b.highBidder === null && active.length === 1 && s.rules.dealerForcedBid) {
    b.highBid = MIN_BID; b.highBidder = active[0]; // dealer is last to act and must bid 16
  }
  if (b.highBidder !== null && active.length === 1) {
    s.bidWinner = b.highBidder; s.bidValue = b.highBid;
    s.phase = 'trumpSelect'; s.turn = b.highBidder;
    return s;
  }
  let t = nextSeat(s.turn);
  while (b.passed[t]) t = nextSeat(t);
  s.turn = t;
  return s;
}

function bid(s: GameState, seat: number, value: number) {
  if (s.phase !== 'bidding') fail('Not bidding');
  if (seat !== s.turn) fail('Not your turn');
  if (!Number.isInteger(value) || value > MAX_BID || value < minBidFor(s, seat)) fail('Invalid bid');
  s.bidding.highBid = value; s.bidding.highBidder = seat;
  return advanceBidding(s, Math.random);
}

function pass(s: GameState, seat: number, rng: () => number) {
  if (s.phase !== 'bidding') fail('Not bidding');
  if (seat !== s.turn) fail('Not your turn');
  s.bidding.passed[seat] = true; // a pass is final for this hand
  return advanceBidding(s, rng);
}

function setTrump(s: GameState, seat: number, card: Card | undefined, seventh: boolean) {
  if (s.phase !== 'trumpSelect' || seat !== s.bidWinner) fail('Cannot set trump');
  let hidden: Card;
  if (seventh) {
    hidden = s.secondDeal[seat].splice(2, 1)[0]; // blind: the 7th card, 3rd of the next four
  } else {
    const idx = card ? s.hands[seat].findIndex(c => sameCard(c, card)) : -1;
    if (idx < 0) fail('Trump card must come from your first four cards');
    hidden = s.hands[seat].splice(idx, 1)[0];
  }
  s.hiddenTrumpCard = hidden;
  s.trumpSuit = hidden.suit;
  for (let p = 0; p < 4; p++) s.hands[p] = sortHand([...s.hands[p], ...s.secondDeal[p]]);
  s.secondDeal = [[], [], [], []];

  if (seventh && !s.hands[seat].some(c => c.suit === hidden.suit)) {
    // the blind card is the bidder's only card of its suit: hand is void, redeal
    s.phase = 'handOver';
    s.hiddenTrumpCard = null;
    s.handResult = { cancelled: true, reason: 'The 7th card was the bidder’s only card of its suit.' };
    return s;
  }
  s.phase = 'playing';
  s.turn = nextSeat(s.dealer);
  return autoRevealIfNeeded(s);
}

function doReveal(s: GameState, by: number) {
  s.trumpRevealed = true; s.revealedBy = by; s.revealTrick = s.completedTricks.length;
  const b = s.bidWinner!;
  s.hands[b] = sortHand([...s.hands[b], s.hiddenTrumpCard!]);
  s.hiddenTrumpCard = null;
}

function reveal(s: GameState, seat: number) {
  if (s.phase !== 'playing' || seat !== s.turn) fail('Cannot reveal now');
  if (s.trumpRevealed) fail('Trump already revealed');
  const lg = legalPlays(s, seat);
  if (!lg.canAskReveal && !lg.mustReveal) fail('You may only ask when void in the lead suit');
  doReveal(s, seat);
  return s;
}

/** Bidder with an empty hand (final trick) must pick the face-down card back up. */
function autoRevealIfNeeded(s: GameState) {
  if (s.phase === 'playing' && !s.trumpRevealed && s.turn === s.bidWinner && s.hands[s.turn].length === 0)
    doReveal(s, s.turn);
  return s;
}

function play(s: GameState, seat: number, card: Card) {
  if (s.phase !== 'playing' || seat !== s.turn) fail('Not your turn');
  const lg = legalPlays(s, seat);
  if (lg.mustReveal) fail('You must reveal trump first');
  if (!lg.cards.some(c => sameCard(c, card))) fail('Illegal card');

  s.hands[seat].splice(s.hands[seat].findIndex(c => sameCard(c, card)), 1);
  s.currentTrick.push({ seat, card });

  if (s.currentTrick.length < 4) {
    s.turn = nextSeat(seat);
    return autoRevealIfNeeded(s);
  }

  const winner = trickWinner(s.currentTrick, s.trumpSuit!, s.trumpRevealed);
  const pts = s.currentTrick.reduce((n, p) => n + POINTS[p.card.rank], 0);
  const idx = s.completedTricks.length;
  s.trickPoints[teamOf(winner.seat)] += pts;
  s.lastWinTrick[teamOf(winner.seat)] = idx;
  s.completedTricks.push({ plays: s.currentTrick, winner: winner.seat });
  s.currentTrick = [];
  s.turn = winner.seat;

  if (s.completedTricks.length === 8) return finishHand(s, winner.seat);
  return autoRevealIfNeeded(s);
}

function finishHand(s: GameState, lastWinner: number) {
  if (s.rules.lastTrickPoint) s.trickPoints[teamOf(lastWinner)] += 1;
  const bidTeam = teamOf(s.bidWinner!);
  let effectiveBid = s.bidValue!;
  if (s.pair) {
    effectiveBid = s.pair.team === bidTeam
      ? Math.max(effectiveBid - PAIR_BONUS, MIN_BID)   // bidders' pair lowers the target (not below 16)
      : Math.min(effectiveBid + PAIR_BONUS, MAX_BID);  // opponents' pair raises it (not above 28)
  }
  const made = s.trickPoints[bidTeam] >= effectiveBid;
  s.gameScore[bidTeam] += made ? 1 : -1;
  s.handResult = { cancelled: false, bidTeam, effectiveBid, points: [...s.trickPoints] as [number, number], made };

  for (const t of [0, 1]) {
    if (s.gameScore[t] >= WIN_SCORE || s.gameScore[1 - t] <= -WIN_SCORE) s.winnerTeam = t;
  }
  s.phase = s.winnerTeam !== null ? 'gameOver' : 'handOver';
  return s;
}

// ---------- per-player redacted view (send THIS over the wire, never the raw state) ----------

export function viewFor(s: GameState, seat: number) {
  const isBidder = seat === s.bidWinner;
  return {
    ...s,
    hands: s.hands.map((h, i) => (i === seat ? h : h.map(() => null))) as (Card | null)[][],
    secondDeal: undefined,
    hiddenTrumpCard: isBidder ? s.hiddenTrumpCard : null,
    hasHiddenTrump: !!s.hiddenTrumpCard,
    trumpSuit: s.trumpRevealed || isBidder ? s.trumpSuit : null,
    legal: s.phase === 'playing' && s.turn === seat ? legalPlays(s, seat) : null,
  };
}
