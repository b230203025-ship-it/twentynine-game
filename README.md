# Twenty-Nine (29): private PWA

Install-able card game for four players. Two ways to play:

- **Online**: room codes, authoritative Socket.io server, bots cover empty or dropped seats.
- **Local**: no internet. One phone hosts, up to three others join over Wi-Fi or a hotspot using WebRTC with QR / copy-paste signaling.

## Run it

```bash
npm install
npm run build
PASSKEY="pick-a-long-passphrase" npm start      # serves the app + sockets on :3000
```

Development: `npm run dev:server` in one terminal, `npm run dev` in another (Vite proxies `/socket.io`).

## Deploy

Any Node host works (Render, Fly.io, Railway, a VPS). Requirements:

1. Serve over **HTTPS**. Browsers only allow service workers, install, camera (QR scan) and WebRTC on secure origins.
2. Set the `PASSKEY` env var. Share it only with people you want at the table.
3. Single instance (rooms live in memory). Restarting the server ends running games.

## Install on a phone

Open the HTTPS URL once, then use the in-app Install button (Android/desktop Chrome, Edge) or Share, then Add to Home Screen (iOS). After the first load the whole app, including the rules engine, is cached, so **local mode works with no internet**.

## Local mode, step by step

1. Host: Host a local game, then Start hosting. Under "Invite guest 1" a QR appears.
2. Guest: Join a local game, scan the QR (or paste the code), then Create reply. A reply QR appears.
3. Host: Scan their reply (or paste it) and press Connect. Repeat for each guest.
4. Host: Start game. Empty seats become bots.

Everyone must be on the same network. Some public or guest Wi-Fi blocks device-to-device traffic; a phone hotspot always works.

## Layout

```
shared/engine.ts   pure rules (deal, bid, hidden trump, follow suit, reveal, pair, scoring)
shared/bots.ts     bot players (only use information a real player has)
shared/room.ts     seats, host, reconnect, bot-fill, per-player redacted state
server/index.ts    Socket.io + passkey gate + static files
src/net/           Session interface: online.ts (Socket.io), local.ts (WebRTC host/guest)
src/ui/            Lobby, Waiting, Table, Cards, QR tools, install prompt
```

## Rules as implemented (South Asian 29; change in shared/engine.ts)

**Fixed rules**
- 32 cards, J 3, 9 2, A 1, 10 1 (28 points). Rank J, 9, A, 10, K, Q, 8, 7. Partners sit opposite.
- Dealing, bidding and play go **counter-clockwise**. The player on the dealer's right bids first and leads the first trick.
- 4 cards each, then bidding from 16 to 28. A pass is final for that hand. A later bidder must raise; an earlier (senior) bidder may **match** the current bid. Bidding ends when three have passed.
- Bidder sets one of their first four cards face down; its suit is the hidden trump. Alternatively they can take the **blind 7th card** (3rd of the second four). If that card is their only card of its suit, the hand is cancelled and redealt.
- Then 4 more cards each. Follow suit if you can. If void, you may discard anything or **ask for trump to be shown**. Whoever asks must play trump if they have one. Anyone else who is void may play any card.
- Trump counts from the trick in which it is exposed: the highest trump in that trick wins, otherwise the highest card of the suit led. Before that, trump-suit cards have no power. The bidder takes the face-down card back when it is exposed, or on the last trick.
- **Pair (Royals)**: K and Q of trump, both still in hand. Declare once trump is exposed and your side has won the exposing trick or a later one. Bidders' pair: target minus 4 (not below 16). Opponents' pair: target plus 4 (not above 28).
- Scoring: bidding side scores +1 if it makes its target, else −1 (red and black 6s). First side to +6, or opponents at −6, wins.

**Host options** (checkboxes in the lobby)
- Last trick worth 1 point (default on, 29 points total).
- No under-trumping (default on): once a trump is in the trick you may not play a lower one unless you have nothing else.
- Dealer must bid 16 if everyone passes (default off, so all-pass means redeal).

**Not included**: double and re-double, single hand, extra points for winning or losing all 8 tricks, half-bid penalty, joker (no-trump) bids.
