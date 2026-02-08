const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ server, path: '/' });

function safeSend(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
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
  console.log('New connection from:', req.headers.host);
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
          history: [],
          pendingSkip: null,  // 待处理的跳过请求
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
          online: true
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
          players: [{ orderId: 0, colorId: 0, name: '玩家1', role: '黑棋', color: PLAYER_COLORS[0] }]
        });
        break;
      }
      
      case 'join': {
        const room = rooms.get(msg.roomId);
        if (!room) {
          safeSend(ws, { type: 'error', message: '房间不存在' });
          return;
        }
        
        const onlinePlayers = room.players.filter(p => p.online);
        if (onlinePlayers.length >= 10) {
          safeSend(ws, { type: 'error', message: '房间已满' });
          return;
        }
        if (room.gameStarted) {
          safeSend(ws, { type: 'error', message: '游戏已开始' });
          return;
        }
        
        // Check if player was offline
        const offlinePlayer = room.players.find(p => p.name === msg.playerName && !p.online);
        if (offlinePlayer) {
          offlinePlayer.ws = ws;
          offlinePlayer.online = true;
          offlinePlayer.colorId = msg.colorId !== null ? msg.colorId : offlinePlayer.colorId;
          offlinePlayer.color = PLAYER_COLORS[offlinePlayer.colorId];
          offlinePlayer.role = PLAYER_ROLES[offlinePlayer.colorId];
          
          currentRoom = room;
          playerInfo = offlinePlayer;
          
          safeSend(ws, { 
            type: 'joined', 
            roomId: room.id, 
            orderId: offlinePlayer.orderId,
            colorId: offlinePlayer.colorId,
            ownerOrderId: room.players[0] ? room.players[0].orderId : null,
            players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, online: p.online }))
          });
          
          broadcast(room, {
            type: 'playerJoined',
            players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, online: p.online }))
          });
          break;
        }
        
        // New player
        const takenColors = room.players.map(p => p.colorId);
        let selectedColorId = msg.colorId;
        if (selectedColorId === null || takenColors.includes(selectedColorId)) {
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
          online: true
        };
        room.players.push(player);
        
        currentRoom = room;
        playerInfo = player;
        
        safeSend(ws, { 
          type: 'joined', 
          roomId: room.id, 
          orderId: player.orderId,
          colorId: player.colorId,
          ownerOrderId: room.players[0] ? room.players[0].orderId : null,
          players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, online: p.online }))
        });
        
        broadcast(room, {
          type: 'playerJoined',
          players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, online: p.online }))
        });
        break;
      }
      
      case 'start': {
        if (!currentRoom || currentRoom.players.filter(p => p.online).length < 2) {
          safeSend(ws, { type: 'error', message: '至少需要2名在线玩家' });
          return;
        }
        currentRoom.gameStarted = true;
        currentRoom.currentPlayer = 0;
        currentRoom.board = Array(15).fill(null).map(() => Array(15).fill(0));
        currentRoom.history = [];
        currentRoom.winner = null;
        currentRoom.pendingSkip = null;
        
        broadcast(currentRoom, { 
          type: 'gameStart', 
          currentPlayer: 0,
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
        if (currentRoom.currentPlayer !== msg.orderId) return;
        
        const { row, col } = msg;
        if (row < 0 || row >= 15 || col < 0 || col >= 15) return;
        if (currentRoom.board[row][col] !== 0) return;
        
        const currentPlayer = currentRoom.players.find(p => p.orderId === msg.orderId);
        if (!currentPlayer || !currentPlayer.online) return;
        
        currentRoom.board[row][col] = currentPlayer.colorId + 1;
        currentRoom.history.push({ row, col, player: msg.orderId, colorId: currentPlayer.colorId, timestamp: Date.now() });
        currentRoom.lastActivity = Date.now();
        
        const isWin = checkWin(currentRoom.board, row, col, currentPlayer.colorId + 1);
        
        const moveData = { type: 'move', row, col, orderId: msg.orderId, colorId: currentPlayer.colorId };
        
        if (isWin) {
          currentRoom.winner = msg.orderId;
          moveData.winner = msg.orderId;
          moveData.gameOver = true;
        } else {
          currentRoom.currentPlayer = (currentRoom.currentPlayer + 1) % currentRoom.players.length;
          moveData.currentPlayer = currentRoom.currentPlayer;
        }
        
        broadcast(currentRoom, moveData);
        break;
      }
      
      case 'requestSkip': {
        // 玩家请求跳过离线玩家的回合
        if (!currentRoom || !currentRoom.gameStarted) return;
        if (currentRoom.pendingSkip) return;  // 已有待处理的请求
        
        const offlineOrderId = msg.offlineOrderId;
        const offlinePlayer = currentRoom.players.find(p => p.orderId === offlineOrderId);
        
        if (!offlinePlayer || offlinePlayer.online) return;
        
        currentRoom.pendingSkip = { offlineOrderId: offlineOrderId };
        currentRoom.lastActivity = Date.now();
        
        // 通知房主
        const owner = currentRoom.players.find(p => p.orderId === currentRoom.players[0].orderId);
        if (owner && owner.online) {
          safeSend(owner.ws, {
            type: 'skipRequest',
            offlinePlayerName: offlinePlayer.name,
            offlineOrderId: offlineOrderId
          });
        }
        
        // 通知其他玩家
        broadcast(currentRoom, {
          type: 'waitingForSkip',
          offlinePlayerName: offlinePlayer.name
        }, ws);
        break;
      }
      
      case 'approveSkip': {
        // 房主批准跳过
        if (!currentRoom || !currentRoom.pendingSkip) return;
        if (msg.orderId !== currentRoom.players[0]?.orderId) return;  // 只有房主可以批准
        
        const offlineOrderId = currentRoom.pendingSkip.offlineOrderId;
        currentRoom.pendingSkip = null;
        currentRoom.lastActivity = Date.now();
        
        // 找到下一个在线玩家
        const onlinePlayers = currentRoom.players.filter(p => p.online);
        const currentIdx = onlinePlayers.findIndex(p => p.orderId === currentRoom.currentPlayer);
        
        if (onlinePlayers.length > 0) {
          const nextIdx = (currentIdx + 1) % onlinePlayers.length;
          currentRoom.currentPlayer = onlinePlayers[nextIdx].orderId;
        }
        
        broadcast(currentRoom, {
          type: 'skipApproved',
          offlineOrderId: offlineOrderId,
          currentPlayer: currentRoom.currentPlayer
        });
        break;
      }
      
      case 'rejectSkip': {
        // 房主拒绝，继续等待
        if (!currentRoom || !currentRoom.pendingSkip) return;
        if (msg.orderId !== currentRoom.players[0]?.orderId) return;
        
        currentRoom.pendingSkip = null;
        currentRoom.lastActivity = Date.now();
        
        const offlinePlayer = currentRoom.players.find(p => p.orderId === msg.offlineOrderId);
        broadcast(currentRoom, {
          type: 'skipRejected',
          message: '房主拒绝，继续等待 ' + (offlinePlayer ? offlinePlayer.name : '玩家')
        });
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
      
      case 'getRooms': {
        const roomList = [];
        rooms.forEach((room, id) => {
          if (!room.gameStarted) {
            roomList.push({ id, playerCount: room.players.filter(p => p.online).length });
          }
        });
        safeSend(ws, { type: 'rooms', rooms: roomList });
        break;
      }
      
      case 'leave': {
        if (currentRoom) {
          const player = currentRoom.players.find(p => p.ws === ws);
          if (player) {
            player.online = false;
            player.ws = null;
            
            const wasOwner = currentRoom.players[0]?.orderId === player.orderId;
            
            broadcast(currentRoom, {
              type: 'playerLeft',
              playerName: player.name,
              orderId: player.orderId,
              players: currentRoom.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, online: p.online }))
            });
            
            // 如果是房主离开，转移房主
            if (wasOwner && currentRoom.players.some(p => p.online)) {
              const newOwner = currentRoom.players.find(p => p.online);
              broadcast(currentRoom, {
                type: 'ownerChanged',
                newOwnerOrderId: newOwner.orderId,
                newOwnerName: newOwner.name
              });
            }
          }
          currentRoom = null;
          playerInfo = null;
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom && playerInfo) {
      playerInfo.online = false;
      playerInfo.ws = null;
      
      const wasGameStarted = currentRoom.gameStarted;
      
      broadcast(currentRoom, {
        type: 'playerOffline',
        playerName: playerInfo.name,
        orderId: playerInfo.orderId,
        players: currentRoom.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, online: p.online }))
      });
      
      // 如果游戏已开始且是当前玩家回合，等待处理
      if (wasGameStarted && currentRoom.gameStarted && currentRoom.currentPlayer === playerInfo.orderId) {
        // 通知玩家需要等待房主决定
        broadcast(currentRoom, {
          type: 'turnWaiting',
          waitingFor: playerInfo.orderId,
          playerName: playerInfo.name
        });
      }
    }
  });
});

// Clean up every 3 minutes
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  rooms.forEach((room, roomId) => {
    const onlinePlayers = room.players.filter(p => p.online);
    
    // 空房间删除
    if (onlinePlayers.length === 0) {
      rooms.delete(roomId);
      cleaned++;
      return;
    }
    
    // 游戏中的房间，如果只有一个玩家且离线玩家太多，结束游戏
    if (room.gameStarted && onlinePlayers.length === 1) {
      const offlineCount = room.players.length - 1;
      if (offlineCount >= room.players.length - 1 && now - room.lastActivity > 5 * 60 * 1000) {
        room.gameStarted = false;
        room.winner = null;
        broadcast(room, { type: 'gameEnd', reason: '其他玩家都离线了' });
      }
    }
    
    // 清理离线太久的玩家（非游戏中）
    if (!room.gameStarted && room.players.length > onlinePlayers.length) {
      const staleOffline = room.players.filter(p => !p.online && now - room.lastActivity > 30 * 60 * 1000);
      staleOffline.forEach(p => {
        const idx = room.players.indexOf(p);
        if (idx > -1) room.players.splice(idx, 1);
      });
      if (staleOffline.length > 0) cleaned++;
    }
  });
  
  if (cleaned > 0) console.log('Cleaned ' + cleaned + ' rooms');
}, 3 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
});
