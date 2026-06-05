# Nightfall

A 2D top-down asymmetric horror demo. One player is the Killer, everyone else is a Survivor. Survivors finish 3 objectives to escape. The Killer tries to catch all of them first.

Browser client (Canvas + vanilla JS) on the front, authoritative Node.js WebSocket server on the back. Everything is placeholder shapes and silent for now. Sprites and sound drop in later.

## Layout

```
index.html        client entry
css/style.css      client styling
js/                client code (network, input, game, renderer, main)
server/            Node.js WebSocket server (deploy this separately)
```

The client is static and the server is a long-running process. They get deployed to two different places: client to GitHub Pages, server to Railway.

## Run it locally

Two terminals.

Server:
```
cd server
npm install
npm start
```
Server listens on `localhost:3000`.

Client: serve the repo root with any static server and open it.
```
npx serve .
```
Then open the printed URL (something like `http://localhost:3000` will clash with the game server, so use the port `serve` gives you, usually 3000 or 5000; if it grabs 3000, stop it and pass `npx serve . -l 5000`). When the page is on `localhost`, the client auto-connects to `ws://localhost:3000`.

Open two browser tabs to test. First to join becomes the host and plays the Killer. Host needs 2+ players in the lobby to start.

## Deploy

### Server on Railway

1. Push this repo to GitHub.
2. On Railway, create a new project from the repo.
3. Set the service root directory to `server`.
4. Railway runs `npm install` and `npm start` automatically. The server reads `process.env.PORT`, so do not hardcode a port.
5. Generate a public domain for the service. You get something like `your-app.up.railway.app`.

### Point the client at your server

Open `js/main.js` and replace the production host:
```js
const SERVER_URL = isLocal
  ? 'ws://localhost:3000'
  : 'wss://REPLACE-ME.up.railway.app';   // <-- your Railway domain here
```
Use `wss://` (secure), not `ws://`, since GitHub Pages is HTTPS.

### Client on GitHub Pages

1. Commit the edited `main.js`.
2. In the repo settings, enable Pages and serve from the root of your default branch.
3. Your client lives at `https://yourname.github.io/your-repo/`.

## Controls

- WASD or arrow keys to move
- Survivor: aim the flashlight with the mouse, hold Space (or E) near an objective to work it
- Killer: walk into a survivor to catch them

## How to win

- Survivors complete 3 objectives -> survivors escape and win
- Killer catches every survivor -> killer wins
- Killer disconnects -> survivors win
- All survivors leave -> killer wins

## Notes

Vision is rendered client-side. The Killer sees a wide circle that fogs out with distance. Survivors get a flashlight cone plus a small glow so they are never fully blind. The server sends full state, so this demo does not hide information from a determined cheater. Fine for a friends-and-playtesting demo, not for a competitive release.

Gameplay tuning (speeds, radii, objective time, win count) lives in `server/constants.js` and is the single source of truth. The client receives those values at match start. Render-only values (vision sizes, colors, smoothing) live in `js/constants.js`.

`server/logictest.mjs` runs the core game logic without a network. From `server/`, run `node logictest.mjs`.
