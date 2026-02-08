const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

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

function getOwnerOrderId(room) {
  const owner = room.players.find(p => p.isOwner);
  return owner ? owner.orderId : (room.players[0] ? room.players[0].orderId : 0);
}

function getCurrentPlayer(room) {
  return room.currentPlayer;
}

wss.on('connection', (ws, req) => {
  console.log('New connection:', req.headers.host);
});

app.use(express.static(path.join(__dirname, '../public')));

const PLAYER_ROLES = ['黑棋', '白棋', '红棋', '蓝棋', '绿棋', '黄棋', '紫棋', '橙棋', '粉棋', '青棋'];
const PLAYER_COLORS = ['#000000', '#FFFFFF', '#FF0000', '#0984e3', '#00b894', '#fdcb6e', '#6c5ce7', '#e17055', '#e84393', '#00cec9'];

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
            // 保持房主身份不变
            currentRoom = room;
            playerInfo = offlinePlayer;
            
            safeSend(ws, { 
              type: 'rejoined', 
              roomId: room.id,
              orderId: offlinePlayer.orderId,
              colorId: offlinePlayer.colorId,
              board: room.board,
              currentPlayer: room.currentPlayer,
              ownerOrderId: getOwnerOrderId(room),
              players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, online: p.ws && p.ws.readyState === WebSocket.OPEN }))
            });
            
            broadcast(room, {
              type: 'playerReconnected',
              playerName: offlinePlayer.name,
              ownerOrderId: getOwnerOrderId(room),
              players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, online: p.ws && p.ws.readyState === WebSocket.OPEN }))
            });
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
          // 恢复重连
          existingPlayer.ws = ws;
          existingPlayer.isOwner = false; // 不再是房主
          currentRoom = room;
          playerInfo = existingPlayer;
          
          const currentOwnerOrderId = getOwnerOrderId(room);
          
          safeSend(ws, { 
            type: 'joined', 
            roomId: room.id, 
            orderId: existingPlayer.orderId,
            colorId: existingPlayer.colorId,
            ownerOrderId: currentOwnerOrderId,
            players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
          });
          
          broadcast(room, {
            type: 'playerReconnected',
            playerName: existingPlayer.name,
            ownerOrderId: currentOwnerOrderId,
            players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
          }, ws);
          return;
        }
        
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
          roomId: room.id, 
          orderId: player.orderId,
          colorId: player.colorId,
          ownerOrderId: getOwnerOrderId(room),
          players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
        });
        
        broadcast(room, {
          type: 'playerJoined',
          players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
        }, ws);
        break;
      }
      
      case 'ownerDecision': {
        if (!currentRoom || !currentRoom.waitingReconnect) return;
        
        const owner = currentRoom.players.find(p => p.isOwner);
        if (msg.orderId !== (owner ? owner.orderId : -1)) return;
        
        const offlineOrderId = currentRoom.pendingOfflineOrderId;
        const offlinePlayer = currentRoom.players.find(p => p.orderId === offlineOrderId);
        
        if (msg.continueWaiting) {
          currentRoom.waitingReconnect = false;
          currentRoom.pendingOfflineOrderId = null;
          broadcast(currentRoom, {
            type: 'gameResumed',
            message: '继续等待 ' + (offlinePlayer ? offlinePlayer.name : '玩家') + ' 重连...'
          });
        } else {
          if (offlinePlayer) {
            const removedWasOwner = offlinePlayer.isOwner;
            const removedWasCurrent = currentRoom.currentPlayer === offlineOrderId;
            
            currentRoom.players = currentRoom.players.filter(p => p.orderId !== offlineOrderId);
            currentRoom.waitingReconnect = false;
            currentRoom.pendingOfflineOrderId = null;
            
            if (removedWasOwner && currentRoom.players.length > 0) {
              currentRoom.players[0].isOwner = true;
            }
            
            // 如果移除的是当前玩家，找到下一个玩家
            if (removedWasCurrent && currentRoom.players.length > 0) {
              const removedIdx = currentRoom.players.findIndex(p => p.orderId === offlineOrderId);
              const nextIdx = removedIdx === -1 ? 0 : (removedIdx % currentRoom.players.length);
              currentRoom.currentPlayer = currentRoom.players[nextIdx] ? currentRoom.players[nextIdx].orderId : 0;
            }
            
            broadcast(currentRoom, {
              type: 'playerRemoved',
              playerName: offlinePlayer.name,
              waitingReconnect: false,
              players: currentRoom.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color })),
              currentPlayer: currentRoom.currentPlayer,
              ownerOrderId: getOwnerOrderId(currentRoom)
            });
          }
        }
        
        currentRoom.lastActivity = Date.now();
        break;
      }
      
      case 'start': {
        if (!currentRoom || currentRoom.players.length < 2) {
          safeSend(ws, { type: 'error', message: '至少需要2名玩家' });
          return;
        }
        // 使用第一个玩家的orderId作为currentPlayer
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
          ownerOrderId: getOwnerOrderId(currentRoom),
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
        
        const isWin = checkWin(currentRoom.board, row, col, currentPlayer.colorId + 1);
        
        const moveData = { type: 'move', row, col, orderId: msg.orderId, colorId: currentPlayer.colorId };
        
        if (isWin) {
          currentRoom.winner = msg.orderId;
          moveData.winner = msg.orderId;
          moveData.gameOver = true;
          currentRoom.waitingReconnect = false;
        } else {
          // currentPlayer是orderId，需要找到索引再+1
          const currentIdx = currentRoom.players.findIndex(p => p.orderId === msg.orderId);
          if (currentIdx !== -1 && currentRoom.players.length > 1) {
            const nextIdx = (currentIdx + 1) % currentRoom.players.length;
            currentRoom.currentPlayer = currentRoom.players[nextIdx] ? currentRoom.players[nextIdx].orderId : 0;
          }
          moveData.currentPlayer = currentRoom.currentPlayer;
        }
        
        broadcast(currentRoom, moveData);
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
        // 只有房主可以发起restart
        const player = currentRoom.players.find(p => p.ws === ws);
        if (!player || !player.isOwner) {
          safeSend(ws, { type: 'error', message: '只有房主可以发起再来一局' });
          return;
        }
        
        // 重置游戏
        currentRoom.gameStarted = true;
        currentRoom.currentPlayer = 0;
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
        const playerOrderId = player.orderId;
        
        // 先把ws设为null，防止onClose重复处理
        player.ws = null;
        
        if (currentRoom.gameStarted) {
          // 游戏已开始，设为离线
          broadcast(currentRoom, {
            type: 'playerOffline',
            playerName: playerName,
            orderId: playerOrderId
          });
          
          currentRoom.waitingReconnect = true;
          currentRoom.pendingOfflineOrderId = playerOrderId;
          currentRoom.lastActivity = Date.now();
          
          if (wasOwner) {
            player.isOwner = false;
            const onlinePlayers = currentRoom.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN);
            if (onlinePlayers.length > 0) {
              currentRoom.players.forEach(p => p.isOwner = false);
              onlinePlayers[0].isOwner = true;
              
              broadcast(currentRoom, {
                type: 'ownerChanged',
                newOwnerOrderId: onlinePlayers[0].orderId,
                newOwnerName: onlinePlayers[0].name,
                offlinePlayerName: playerName,
                offlineOrderId: playerOrderId
              });
            }
          } else {
            const owner = currentRoom.players.find(p => p.isOwner);
            if (owner && owner.ws && owner.ws.readyState === WebSocket.OPEN) {
              safeSend(owner.ws, {
                type: 'ownerConfirm',
                playerName: playerName,
                orderId: playerOrderId
              });
            }
          }
        } else {
          // 游戏未开始，设为离线而不是移除，方便重连
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
  });

  ws.on('close', () => {
    // ws.on('close')只处理非leave消息触发的关闭（如网络断开）
    // leave消息会自己处理，这里跳过避免重复
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
        const removedWasOwner = offlinePlayer ? offlinePlayer.isOwner : false;
        
        room.players = room.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN);
        room.waitingReconnect = false;
        room.pendingOfflineOrderId = null;
        
        if (removedWasOwner && room.players.length > 0) {
          room.players[0].isOwner = true;
        }
        
        if (room.players.length > 0) {
          // 确保currentPlayer是有效的在线玩家
          const currentIsValid = room.players.some(p => p.orderId === room.currentPlayer);
          if (!currentIsValid) {
            // 找到下一个玩家
            const offlineOrderId = room.pendingOfflineOrderId;
            const removedIdx = room.players.findIndex(p => p.orderId === offlineOrderId);
            let nextIdx;
            if (removedIdx !== -1) {
              nextIdx = removedIdx % room.players.length;
              room.currentPlayer = room.players[nextIdx] ? room.players[nextIdx].orderId : (room.players[0] ? room.players[0].orderId : 0);
            } else {
              room.currentPlayer = room.players[0] ? room.players[0].orderId : 0;
            }
          }
          
          broadcast(room, {
            type: 'playerRemoved',
            playerName: '离线玩家',
            waitingReconnect: false,
            players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color })),
            currentPlayer: room.currentPlayer,
            ownerOrderId: getOwnerOrderId(room)
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
