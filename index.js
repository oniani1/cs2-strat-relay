// CS2 Strat Giver — Cloud Relay Server
// A dumb WebSocket forwarder with room-based routing.
// Deploy to Render/Fly.io free tier. Knows nothing about CS2.

import { WebSocketServer } from 'ws';

const PORT = parseInt(process.env.PORT || '8080', 10);

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const rooms = new Map();

/** @type {Map<import('ws').WebSocket, { roomCode: string, steamId: string, name: string, role: string }>} */
const clients = new Map();

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'join') {
      const { roomCode, steamId, name, role } = msg;
      if (!roomCode || !steamId) return;

      // Add client to room
      if (!rooms.has(roomCode)) {
        rooms.set(roomCode, new Set());
      }
      rooms.get(roomCode).add(ws);
      clients.set(ws, { roomCode, steamId, name: name || steamId, role: role || 'member' });

      // Send joinAck with current room members
      const members = [];
      for (const peer of rooms.get(roomCode)) {
        const info = clients.get(peer);
        if (info) {
          members.push({ steamId: info.steamId, name: info.name, role: info.role });
        }
      }

      ws.send(JSON.stringify({ type: 'joinAck', members, roomCode }));

      // Notify others in room
      broadcast(roomCode, ws, {
        type: 'playerJoined',
        steamId,
        name: name || steamId,
        role: role || 'member',
        members,
      });

      console.log(`[${roomCode}] ${name || steamId} joined (${members.length} in room)`);
      return;
    }

    // For all other message types, rebroadcast to room
    const info = clients.get(ws);
    if (!info) return;

    broadcast(info.roomCode, ws, msg);
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (!info) return;

    const { roomCode, steamId, name } = info;
    clients.delete(ws);

    const room = rooms.get(roomCode);
    if (room) {
      room.delete(ws);
      if (room.size === 0) {
        rooms.delete(roomCode);
        console.log(`[${roomCode}] Room empty, removed`);
      } else {
        // Notify remaining players
        broadcast(roomCode, null, { type: 'playerLeft', steamId, name });
        console.log(`[${roomCode}] ${name} left (${room.size} remaining)`);
      }
    }
  });

  ws.on('error', () => ws.close());
});

/**
 * Broadcast a message to all clients in a room except the sender.
 * @param {string} roomCode
 * @param {import('ws').WebSocket | null} sender
 * @param {object} message
 */
function broadcast(roomCode, sender, message) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const data = JSON.stringify(message);
  for (const client of room) {
    if (client !== sender && client.readyState === 1) {
      client.send(data);
    }
  }
}

console.log(`CS2 Strat Relay listening on port ${PORT}`);
