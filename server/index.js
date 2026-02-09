const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const GAME_VERSION = '1.0.1';

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ server, path: '/' });

function safeSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, message, excludeWs = null) {
  room.players.forEach(player => {
    if (player.ws && player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
      safeSend(player.ws, message);
    }
  });
}

wss.on('connection', (ws, req) => {
  console.log('New connection:', req.headers.host);
});

app.use(express.static(path.join(__dirname, '../public')));

const PLAYER_ROLES = ['黑棋', '白棋', '红棋', '蓝棋', '绿棋', '黄棋', '紫棋', '橙棋', '粉棋', '青棋'];
const PLAYER_COLORS = ['#000000', '#FFFFFF', '#6c5ce7', '#0984e3', '#00b894', '#fdcb6e', '#e17055', '#e84393', '#00cec9', '#fd79a8'];

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function checkWin(board, row, col, player) {
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const size = 15;
  
  for (const [dr, dc] of directions) {
    let count = 1;
    for (let i = 1; i < 5; i++) {
      const r = row + dr * i, c = col + dc * i;
      if (r < 0 || r >= size || c < 0 || c >= size || board[r][c] !== player) break;
      count++;
    }
    for (let i = 1; i < 5; i++) {
      const r = row - dr * i, c = col - dc * i;
      if (r < 0 || r >= size || c < 0 || c >= size || board[r][c] !== player) break;
      count++;
    }
    if (count >= 5) return true;
  }
  return false;
}

const rooms = new Map();

wss.on('connection', (ws) => {
  let currentRoom = null;
  let playerInfo = null;

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    
    switch (msg.type) {
      case 'create': {
        const roomId = generateRoomId();
        const room = {
          id: roomId,
          players: [],
          board: Array(15).fill(null).map(() => Array(15).fill(0)),
          currentPlayer: 0,
          gameStarted: false,
          winner: null,
          waitingReconnect: false,
          pendingOfflineOrderId: null,
          createdAt: Date.now(),
          lastActivity: Date.now()
        };
        rooms.set(roomId, room);
        
        const player = {
          orderId: 0,
          colorId: 0,
          name: msg.playerName || '玩家1',
          color: PLAYER_COLORS[0],
          role: PLAYER_ROLES[0],
          ws: ws,
          isOwner: true
        };
        room.players.push(player);
        
        currentRoom = room;
        playerInfo = player;
        
        safeSend(ws, { 
          type: 'created', 
          version: GAME_VERSION,
          roomId, 
          orderId: 0, 
          colorId: 0, 
          ownerOrderId: 0,
          players: [{ orderId: 0, colorId: 0, name: msg.playerName || '玩家1', role: '黑棋', color: PLAYER_COLORS[0] }]
        });
        break;
      }
      
      case 'join': {
        const room = rooms.get(msg.roomId);
        if (!room) {
          safeSend(ws, { type: 'error', message: '房间不存在' });
          return;
        }
        
        if (room.gameStarted) {
          const offlinePlayer = room.players.find(p => (!p.ws || p.ws.readyState !== WebSocket.OPEN) && p.name === msg.playerName);
          
          if (offlinePlayer) {
            offlinePlayer.ws = ws;
            currentRoom = room;
            playerInfo = offlinePlayer;
            
            safeSend(ws, { 
              type: 'rejoined', 
              version: GAME_VERSION,
              roomId: room.id,
              orderId: offlinePlayer.orderId,
              colorId: offlinePlayer.colorId,
              board: room.board,
              currentPlayer: room.currentPlayer,
              lastMove: room.lastMove,
              ownerOrderId: room.players.find(p => p.isOwner)?.orderId ?? 0,
              players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, online: p.ws && p.ws.readyState === WebSocket.OPEN }))
            });
            
            broadcast(room, {
              type: 'playerReconnected',
              playerName: offlinePlayer.name,
              ownerOrderId: room.players.find(p => p.isOwner)?.orderId ?? 0,
              players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, online: p.ws && p.ws.readyState === WebSocket.OPEN }))
            }, ws);
          } else {
            safeSend(ws, { type: 'error', message: '游戏已开始，无法加入' });
          }
          return;
        }
        
        if (room.players.length >= 10) {
          safeSend(ws, { type: 'error', message: '房间已满' });
          return;
        }
        
        const existingPlayer = room.players.find(p => p.name === msg.playerName && (!p.ws || p.ws.readyState !== WebSocket.OPEN));
        
        if (existingPlayer) {
          // 游戏已开始时，恢复重连
          existingPlayer.ws = ws;
          existingPlayer.isOwner = false;
          currentRoom = room;
          playerInfo = existingPlayer;
          
          safeSend(ws, { 
            type: 'rejoined', 
            version: GAME_VERSION,
            roomId: room.id,
            orderId: existingPlayer.orderId,
            colorId: existingPlayer.colorId,
            board: room.board,
            currentPlayer: room.currentPlayer,
            lastMove: room.lastMove,
            ownerOrderId: room.players.find(p => p.isOwner)?.orderId ?? 0,
            players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, online: p.ws && p.ws.readyState === WebSocket.OPEN }))
          });
          
          broadcast(room, {
            type: 'playerReconnected',
            playerName: existingPlayer.name,
            ownerOrderId: room.players.find(p => p.isOwner)?.orderId ?? 0,
            players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, online: p.ws && p.ws.readyState === WebSocket.OPEN }))
          }, ws);
          return;
        }
        
        // 检查是否有人用了同样的名字（在线玩家）
        const nameExists = room.players.some(p => p.name === msg.playerName && p.ws && p.ws.readyState === WebSocket.OPEN);
        if (nameExists && room.gameStarted) {
          safeSend(ws, { type: 'error', message: '该昵称已被使用' });
          return;
        }
        
        // 游戏未开始时同名重新加入作为普通玩家
        const takenColors = room.players.map(p => p.colorId);
        let selectedColorId = msg.colorId;
        if (selectedColorId === null || selectedColorId === undefined || takenColors.includes(selectedColorId)) {
          for (let i = 0; i < 10; i++) {
            if (!takenColors.includes(i)) {
              selectedColorId = i;
              break;
            }
          }
        }
        
        // 查找当前真正的房主
        let currentOwnerId = 0;
        const currentOwner = room.players.find(p => p.isOwner && p.ws && p.ws.readyState === WebSocket.OPEN);
        if (currentOwner) {
          currentOwnerId = currentOwner.orderId;
        } else {
          const onlinePlayer = room.players.find(p => p.ws && p.ws.readyState === WebSocket.OPEN);
          if (onlinePlayer) {
            onlinePlayer.isOwner = true;
            currentOwnerId = onlinePlayer.orderId;
          }
        }
        
        const orderId = room.players.length;
        const player = {
          orderId: orderId,
          colorId: selectedColorId,
          name: msg.playerName || '玩家' + Date.now() % 1000,
          color: PLAYER_COLORS[selectedColorId],
          role: PLAYER_ROLES[selectedColorId],
          ws: ws,
          isOwner: false
        };
        room.players.push(player);
        
        currentRoom = room;
        playerInfo = player;
        
        safeSend(ws, { 
          type: 'joined', 
          version: GAME_VERSION,
          roomId: room.id, 
          orderId: player.orderId,
          colorId: player.colorId,
          ownerOrderId: currentOwnerId,
          players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
        });
        
        broadcast(room, {
          type: 'playerJoined',
          players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
        }, ws);
        break;
      }
      
      case 'start': {
        if (!currentRoom || currentRoom.players.length < 2) {
          safeSend(ws, { type: 'error', message: '至少需要2名玩家' });
          return;
        }
        const firstPlayer = currentRoom.players[0];
        currentRoom.currentPlayer = firstPlayer ? firstPlayer.orderId : 0;
        currentRoom.gameStarted = true;
        currentRoom.board = Array(15).fill(null).map(() => Array(15).fill(0));
        currentRoom.history = [];
        currentRoom.winner = null;
        currentRoom.waitingReconnect = false;
        currentRoom.pendingOfflineOrderId = null;
        
        broadcast(currentRoom, { 
          type: 'gameStart', 
          currentPlayer: currentRoom.currentPlayer,
          ownerOrderId: currentRoom.players.find(p => p.isOwner)?.orderId ?? 0,
          players: currentRoom.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
        });
        break;
      }
      
      case 'selectColor': {
        if (!currentRoom || currentRoom.gameStarted) return;
        
        const newColorId = msg.colorId;
        const takenColors = currentRoom.players.filter(p => p.orderId !== msg.orderId).map(p => p.colorId);
        
        if (takenColors.includes(newColorId)) {
          safeSend(ws, { type: 'error', message: '该颜色已被占用' });
          return;
        }
        
        const player = currentRoom.players.find(p => p.orderId === msg.orderId);
        if (player) {
          player.colorId = newColorId;
          player.color = PLAYER_COLORS[newColorId];
          player.role = PLAYER_ROLES[newColorId];
          
          broadcast(currentRoom, {
            type: 'colorChanged',
            players: currentRoom.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
          });
        }
        break;
      }
      
      case 'move': {
        if (!currentRoom || !currentRoom.gameStarted) return;
        if (currentRoom.waitingReconnect) return;
        
        const currentPlayer = currentRoom.players.find(p => p.orderId === msg.orderId);
        if (!currentPlayer) return;
        if (currentRoom.currentPlayer !== msg.orderId) return;
        
        const { row, col } = msg;
        if (row < 0 || row >= 15 || col < 0 || col >= 15) return;
        if (currentRoom.board[row][col] !== 0) return;
        
        currentRoom.board[row][col] = currentPlayer.colorId + 1;
        currentRoom.history.push({ row, col, player: msg.orderId, colorId: currentPlayer.colorId, timestamp: Date.now() });
        currentRoom.lastActivity = Date.now();
        currentRoom.lastMove = { row, col, orderId: msg.orderId };
        
        const isWin = checkWin(currentRoom.board, row, col, currentPlayer.colorId + 1);
        
        const moveData = { type: 'move', row, col, orderId: msg.orderId, colorId: currentPlayer.colorId, lastMove: { row, col } };
        
        if (isWin) {
          currentRoom.winner = msg.orderId;
          moveData.winner = msg.orderId;
          moveData.gameOver = true;
          currentRoom.waitingReconnect = false;
        } else {
          const currentIdx = currentRoom.players.findIndex(p => p.orderId === msg.orderId);
          if (currentIdx !== -1 && currentRoom.players.length > 1) {
            const nextIdx = (currentIdx + 1) % currentRoom.players.length;
            currentRoom.currentPlayer = currentRoom.players[nextIdx]?.orderId ?? 0;
          }
          moveData.currentPlayer = currentRoom.currentPlayer;
        }
        
        broadcast(currentRoom, moveData);
        break;
      }
      
      case 'ownerDecision': {
        if (!currentRoom || !currentRoom.waitingReconnect) return;
        
        const owner = currentRoom.players.find(p => p.isOwner && p.ws && p.ws.readyState === WebSocket.OPEN);
        if (msg.orderId !== (owner?.orderId ?? -1)) return;
        
        const offlineOrderId = currentRoom.pendingOfflineOrderId;
        const offlinePlayer = currentRoom.players.find(p => p.orderId === offlineOrderId);
        
        if (msg.continueWaiting) {
          currentRoom.waitingReconnect = false;
          currentRoom.pendingOfflineOrderId = null;
          broadcast(currentRoom, {
            type: 'gameResumed',
            message: '继续等待 ' + (offlinePlayer?.name ?? '玩家') + ' 重连...'
          });
        } else {
          if (offlinePlayer) {
            const removedWasOwner = offlinePlayer.isOwner;
            
            currentRoom.players = currentRoom.players.filter(p => p.orderId !== offlineOrderId);
            currentRoom.waitingReconnect = false;
            currentRoom.pendingOfflineOrderId = null;
            
            if (removedWasOwner && currentRoom.players.length > 0) {
              currentRoom.players[0].isOwner = true;
            }
            
            if (currentRoom.players.length > 0) {
              const currentIdx = currentRoom.players.findIndex(p => p.orderId === currentRoom.currentPlayer);
              if (currentIdx === -1 || currentIdx >= currentRoom.players.length) {
                currentRoom.currentPlayer = currentRoom.players[0]?.orderId ?? 0;
              }
              
              broadcast(currentRoom, {
                type: 'playerRemoved',
                playerName: offlinePlayer.name,
                waitingReconnect: false,
                players: currentRoom.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color })),
                currentPlayer: currentRoom.currentPlayer,
                ownerOrderId: currentRoom.players.find(p => p.isOwner)?.orderId ?? 0
              });
            }
          }
        }
        
        currentRoom.lastActivity = Date.now();
        break;
      }
      
      case 'chat': {
        if (!currentRoom || !playerInfo) return;
        broadcast(currentRoom, {
          type: 'chat',
          orderId: playerInfo.orderId,
          colorId: playerInfo.colorId,
          playerName: playerInfo.name,
          message: msg.message
        });
        break;
      }
      
      case 'restart': {
        if (!currentRoom) return;
        const player = currentRoom.players.find(p => p.ws === ws);
        if (!player || !player.isOwner) {
          safeSend(ws, { type: 'error', message: '只有房主可以发起再来一局' });
          return;
        }
        
        currentRoom.gameStarted = true;
        currentRoom.currentPlayer = currentRoom.players[0]?.orderId ?? 0;
        currentRoom.board = Array(15).fill(null).map(() => Array(15).fill(0));
        currentRoom.history = [];
        currentRoom.winner = null;
        currentRoom.waitingReconnect = false;
        currentRoom.pendingOfflineOrderId = null;
        
        broadcast(currentRoom, { type: 'restart' });
        break;
      }
      
      case 'getRooms': {
        const roomList = [];
        rooms.forEach((room, id) => {
          if (!room.gameStarted && room.players.length > 0) {
            roomList.push({ id, playerCount: room.players.length });
          }
        });
        safeSend(ws, { type: 'rooms', rooms: roomList });
        break;
      }
      
      case 'leave': {
        if (!currentRoom) break;
        
        const player = currentRoom.players.find(p => p.ws === ws);
        if (!player) break;
        
        const wasOwner = player.isOwner;
        const playerName = player.name;
        
        player.ws = null;
        
        if (currentRoom.gameStarted) {
          broadcast(currentRoom, {
            type: 'playerOffline',
            playerName: playerName,
            orderId: player.orderId
          });
          
          currentRoom.waitingReconnect = true;
          currentRoom.pendingOfflineOrderId = player.orderId;
          currentRoom.lastActivity = Date.now();
          
          if (wasOwner) {
            player.isOwner = false;
            const onlinePlayers = currentRoom.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN);
            if (onlinePlayers.length > 0) {
              onlinePlayers.forEach(p => p.isOwner = false);
              onlinePlayers[0].isOwner = true;
              
              broadcast(currentRoom, {
                type: 'ownerChanged',
                newOwnerOrderId: onlinePlayers[0].orderId,
                newOwnerName: onlinePlayers[0].name,
                offlinePlayerName: playerName,
                offlineOrderId: player.orderId
              });
            }
          } else {
            const owner = currentRoom.players.find(p => p.isOwner && p.ws && p.ws.readyState === WebSocket.OPEN);
            if (owner) {
              safeSend(owner.ws, {
                type: 'ownerConfirm',
                playerName: playerName,
                orderId: player.orderId
              });
            }
          }
        } else {
          // 游戏未开始，房主离开则房间解散
          if (wasOwner) {
            // 先通知所有玩家房间解散
            broadcast(currentRoom, {
              type: 'roomDismissed',
              message: '房主已离开，房间解散'
            });
            rooms.delete(currentRoom.id);
            currentRoom = null;
            playerInfo = null;
            return;
          }
          
          // 普通玩家离开
          const idx = currentRoom.players.indexOf(player);
          if (idx > -1) {
            currentRoom.players.splice(idx, 1);
            broadcast(currentRoom, {
              type: 'playerLeft',
              playerName: playerName,
              players: currentRoom.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
            });
          }
          currentRoom = null;
          playerInfo = null;
          break;
        }
      }
    }
  });

  ws.on('close', () => {
    // ws.on('close')只处理非leave消息触发的关闭
    return;
  });
});

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  rooms.forEach((room, roomId) => {
    if (room.players.length === 0) {
      rooms.delete(roomId);
      cleaned++;
      return;
    }
    
    if (room.gameStarted) {
      const onlineCount = room.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN).length;
      
      if (onlineCount === 0) {
        rooms.delete(roomId);
        cleaned++;
        return;
      }
      
      if (room.waitingReconnect && now - room.lastActivity > 5 * 60 * 1000) {
        const offlineOrderId = room.pendingOfflineOrderId;
        const offlinePlayer = room.players.find(p => p.orderId === offlineOrderId);
        const removedWasOwner = offlinePlayer?.isOwner ?? false;
        
        room.players = room.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN);
        room.waitingReconnect = false;
        room.pendingOfflineOrderId = null;
        
        if (removedWasOwner && room.players.length > 0) {
          room.players[0].isOwner = true;
        }
        
        if (room.players.length > 0) {
          const currentIsValid = room.players.some(p => p.orderId === room.currentPlayer);
          if (!currentIsValid) {
            room.currentPlayer = room.players[0]?.orderId ?? 0;
          }
          
          broadcast(room, {
            type: 'playerRemoved',
            playerName: '离线玩家',
            waitingReconnect: false,
            players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color })),
            currentPlayer: room.currentPlayer,
            ownerOrderId: room.players.find(p => p.isOwner)?.orderId ?? 0
          });
        } else {
          rooms.delete(roomId);
        }
        cleaned++;
      }
    }
  });
  
  if (cleaned > 0) console.log('Cleaned ' + cleaned + ' rooms');
}, 3 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
});
