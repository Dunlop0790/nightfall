// Entry point. An HTTP server carries both the /health route Railway probes
// and the WebSocket upgrade, on the single port Railway assigns. The ws server
// is attached to the HTTP server rather than binding its own port, which is
// what Railway's proxy expects.

import http from 'http';
import { WebSocketServer } from 'ws';
import { Room } from './game.js';
import { TICK_RATE, MAX_PLAYERS } from './constants.js';

const room = new Room();

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });
let nextId = 1;

wss.on('connection', (ws) => {
  if (room.players.size >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ t: 'full' }));
    ws.close();
    return;
  }

  const id = nextId++;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }  // ignore garbage
    switch (msg.t) {
      case 'join':  room.addPlayer(id, String(msg.name || 'Player').slice(0, 16), ws); break;
      case 'start': room.start(id); break;
      case 'input': room.setInput(id, msg); break;
      case 'claimKiller': room.claimKiller(id); break;
    }
  });

  ws.on('close', () => room.removePlayer(id));
  ws.on('error', () => {});  // a dropped socket should not crash the process

  ws.send(JSON.stringify({ t: 'welcome', you: id }));
});

setInterval(() => room.update(), 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`server listening on 0.0.0.0:${PORT}`);
});
