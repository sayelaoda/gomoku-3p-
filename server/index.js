const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);

// WebSocket服务器配置
const wss = new WebSocket.Server({ 
  server,
  path: '/'
});

// 安全发送WebSocket消息
function safeSend(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// 处理WebSocket升级
wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection from:', req.headers.host);
});

// 静态文件服务
app.use(express.static(path.join(__dirname, '../public')));

// 房间管理
const rooms = new Map();
const PLAYERS = ['黑棋', '白棋', '红棋', '蓝棋', '绿棋', '黄棋', '紫棋', '橙棋', '粉棋', '青棋'];
const COLORS = ['#000000', '#FFFFFF', '#FF0000', '#0984e3', '#00b894', '#fdcb6e', '#6c5ce7', '#e17055', '#e84393', '#00cec9'];

// 生成房间ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// 创建房间
function createRoom(ws, roomId, playerName) {
  const room = {
    id: roomId,
    players: [],
    board: Array(15).fill(null).map(() => Array(15).fill(0)),
    currentPlayer: 0, // 0:黑棋, 1:白棋, 2:红棋
    gameStarted: false,
    winner: null,
    history: [], // 记录每步棋
    createdAt: Date.now(), // 创建时间
    lastActivity: Date.now() // 最后活动时间
  };
  
  rooms.set(roomId, room);
  return room;
}

// 加入房间
function joinRoom(ws, roomId, playerName, colorId = null) {
  const room = rooms.get(roomId);
  if (!room) return { success: false, message: '房间不存在' };
  
  // 统计在线玩家
  const onlinePlayers = room.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN);
  
  if (onlinePlayers.length >= 10) return { success: false, message: '房间已满' };
  if (room.gameStarted) return { success: false, message: '游戏已开始' };
  
  // 检查是否掉线重连
  const disconnectedPlayer = room.players.find(p => p.name === playerName && p.ws && p.ws.readyState !== WebSocket.OPEN);
  if (disconnectedPlayer) {
    disconnectedPlayer.ws = ws;
    return { success: true, room, reconnect: true };
  }
  
  // 获取可用颜色
  const takenColors = room.players.map(p => p.id);
  
  // 如果指定了颜色且可用
  let playerId = colorId;
  if (playerId === null || takenColors.includes(playerId)) {
    // 自动分配第一个可用颜色
    for (let i = 0; i < 10; i++) {
      if (!takenColors.includes(i)) {
        playerId = i;
        break;
      }
    }
  }
  
  // 添加新玩家
  room.players.push({
    id: playerId,
    name: playerName,
    color: COLORS[playerId],
    role: PLAYERS[playerId],
    ws: ws
  });
  
  return { success: true, room };
}

// 广播消息给房间内所有玩家
function broadcast(room, message, excludeWs = null) {
  room.players.forEach(player => {
    if (player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
      safeSend(player.ws, message);
    }
  });
}

// 检查获胜
function checkWin(board, row, col, player) {
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const size = 15;
  
  for (const [dr, dc] of directions) {
    let count = 1;
    
    // 正方向
    for (let i = 1; i < 5; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      if (r < 0 || r >= size || c < 0 || c >= size || board[r][c] !== player) break;
      count++;
    }
    
    // 反方向
    for (let i = 1; i < 5; i++) {
      const r = row - dr * i;
      const c = col - dc * i;
      if (r < 0 || r >= size || c < 0 || c >= size || board[r][c] !== player) break;
      count++;
    }
    
    if (count >= 5) return true;
  }
  return false;
}

// WebSocket处理
wss.on('connection', (ws) => {
  let currentRoom = null;
  let playerInfo = null;

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    
    switch (msg.type) {
      case 'create': {
        // 创建房间
        const roomId = generateRoomId();
        const room = createRoom(ws, roomId, msg.playerName || '玩家1');
        room.lastActivity = Date.now();
        
        // 添加房主到房间
        const player = {
          id: 0,
          name: msg.playerName || '玩家1',
          color: COLORS[0],
          role: PLAYERS[0],
          ws: ws
        };
        room.players.push(player);
        
        currentRoom = room;
        playerInfo = player;
        
        safeSend(ws, { type: 'created', roomId, playerId: 0 });
        break;
      }
      
      case 'join': {
        // 加入房间
        const result = joinRoom(ws, msg.roomId, msg.playerName || `玩家${Date.now() % 1000}`, msg.colorId);
        if (!result.success) {
          safeSend(ws, { type: 'error', message: result.message });
          return;
        }
        currentRoom = result.room;
        currentRoom.lastActivity = Date.now(); // 更新活动时间
        
        // 获取当前玩家信息
        playerInfo = result.room.players.find(p => p.ws === ws);
        
        safeSend(ws, { 
          type: 'joined', 
          roomId: result.room.id, 
          playerId: playerInfo.id,
          reconnect: result.reconnect || false,
          players: result.room.players.map(p => ({ id: p.id, name: p.name, role: p.role }))
        });
        
        // 通知其他玩家
        broadcast(result.room, {
          type: 'playerJoined',
          players: result.room.players.map(p => ({ id: p.id, name: p.name, role: p.role }))
        });
        break;
      }
      
      case 'start': {
        // 开始游戏
        if (!currentRoom || currentRoom.players.length < 2) {
          safeSend(ws, { type: 'error', message: '至少需要2名玩家' });
          return;
        }
        currentRoom.gameStarted = true;
        currentRoom.currentPlayer = 0;
        currentRoom.board = Array(15).fill(null).map(() => Array(15).fill(0));
        currentRoom.history = [];
        currentRoom.winner = null;
        
        broadcast(currentRoom, { 
          type: 'gameStart', 
          currentPlayer: 0,
          players: currentRoom.players.map(p => ({ id: p.id, name: p.name, role: p.role }))
        });
        break;
      }
      
      case 'selectColor': {
        // 选择颜色
        if (!currentRoom) return;
        if (currentRoom.gameStarted) return;
        
        const newColorId = msg.colorId;
        const takenColors = currentRoom.players.map(p => p.id).filter(id => id !== playerId);
        
        // 检查颜色是否被占用
        if (takenColors.includes(newColorId)) {
          safeSend(ws, { type: 'error', message: '该颜色已被占用' });
          return;
        }
        
        // 更新玩家颜色
        const player = currentRoom.players.find(p => p.ws === ws);
        if (player) {
          player.id = newColorId;
          player.color = COLORS[newColorId];
          player.role = PLAYERS[newColorId];
          
          // 重新排序玩家数组
          currentRoom.players.sort((a, b) => a.id - b.id);
          
          // 广播通知所有玩家
          broadcast(currentRoom, {
            type: 'colorChanged',
            players: currentRoom.players.map(p => ({ id: p.id, name: p.name, role: p.role }))
          });
        }
        break;
      }
      
      case 'move': {
        // 下棋
        if (!currentRoom || !currentRoom.gameStarted) return;
        if (currentRoom.currentPlayer !== msg.playerId) return;
        
        const { row, col } = msg;
        if (row < 0 || row >= 15 || col < 0 || col >= 15) return;
        if (currentRoom.board[row][col] !== 0) return;
        
        // 放置棋子
        currentRoom.board[row][col] = msg.playerId + 1; // 1:黑, 2:白, 3:红
        currentRoom.history.push({ row, col, player: msg.playerId, timestamp: Date.now() });
        currentRoom.lastActivity = Date.now(); // 更新活动时间
        
        // 检查获胜
        const isWin = checkWin(currentRoom.board, row, col, msg.playerId + 1);
        
        const moveData = { type: 'move', row, col, playerId: msg.playerId };
        
        if (isWin) {
          currentRoom.winner = msg.playerId;
          moveData.winner = msg.playerId;
          moveData.gameOver = true;
        } else {
          // 切换玩家
          currentRoom.currentPlayer = (currentRoom.currentPlayer + 1) % currentRoom.players.length;
          moveData.currentPlayer = currentRoom.currentPlayer;
        }
        
        broadcast(currentRoom, moveData);
        break;
      }
      
      case 'restart': {
        // 重新开始
        if (!currentRoom || currentRoom.players.length < 2) return;
        currentRoom.gameStarted = false;
        currentRoom.board = Array(15).fill(null).map(() => Array(15).fill(0));
        currentRoom.history = [];
        currentRoom.winner = null;
        currentRoom.currentPlayer = 0;
        
        broadcast(currentRoom, { type: 'restart' });
        break;
      }
      
      case 'chat': {
        // 聊天
        if (!currentRoom || !playerInfo) return;
        broadcast(currentRoom, {
          type: 'chat',
          playerId: playerInfo.id,
          playerName: playerInfo.name,
          message: msg.message
        });
        break;
      }
      
      case 'getRooms': {
        // 获取房间列表
        const roomList = [];
        rooms.forEach((room, id) => {
          if (!room.gameStarted) {
            roomList.push({ id, playerCount: room.players.length });
          }
        });
        safeSend(ws, { type: 'rooms', rooms: roomList });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      const playerIndex = currentRoom.players.findIndex(p => p.ws === ws);
      if (playerIndex !== -1) {
        const playerName = currentRoom.players[playerIndex].name;
        const wasGameStarted = currentRoom.gameStarted;
        
        // 移除玩家
        currentRoom.players.splice(playerIndex, 1);
        
        // 通知其他玩家
        broadcast(currentRoom, {
          type: 'playerLeft',
          playerId: playerIndex,
          playerName: playerName,
          remainingPlayers: currentRoom.players.length
        });
        
        // 如果游戏已开始且有人离开，游戏结束
        if (wasGameStarted && currentRoom.gameStarted) {
          currentRoom.gameStarted = false;
          currentRoom.winner = null;
          broadcast(currentRoom, {
            type: 'gameEnd',
            reason: `${playerName} 离开了游戏`
          });
        }
        
        // 如果没有玩家了，删除房间
        if (currentRoom.players.length === 0) {
          rooms.delete(currentRoom.id);
        } else {
          // 重新分配玩家ID（保持连续性）
          currentRoom.players.forEach((p, i) => {
            p.id = i;
            p.role = PLAYERS[i];
            p.color = COLORS[i];
          });
        }
      }
    }
  });
});

// 定期清理空闲房间（每5分钟检查一次）
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  rooms.forEach((room, roomId) => {
    // 删除没有玩家的房间
    if (room.players.length === 0) {
      rooms.delete(roomId);
      cleaned++;
      return;
    }
    
    // 删除空闲超过30分钟的房间
    const lastActivity = room.history.length > 0 
      ? Math.max(...room.history.map(h => h.timestamp || 0))
      : room.createdAt || now;
    
    if (now - lastActivity > 30 * 60 * 1000) {
      rooms.delete(roomId);
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    console.log(`🧹 清理了 ${cleaned} 个空闲房间，剩余 ${rooms.size} 个房间`);
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 三人五子棋服务器运行在 http://localhost:${PORT}`);
});
