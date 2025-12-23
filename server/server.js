import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import webpush from 'web-push';
import path from "path"; 
import { fileURLToPath } from "url";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  }
});
const __filename = fileURLToPath(import.meta.url); 
const __dirname = path.dirname(__filename); 
app.use(express.static(path.join(__dirname, "../dist"))); 
app.get(/.*/, (req, res) => { 
    res.sendFile(path.join(__dirname, "../dist", "index.html")); 
});
// Dữ liệu chính
const rooms = {
  general: { id: 'general', label: 'Sảnh chung', type: 'public', owner: 'system', members: [], pendingRequests: [] },
  sports: { id: 'sports', label: 'Thể thao', type: 'public', owner: 'system', members: [], pendingRequests: [] },
  music: { id: 'music', label: 'Âm nhạc', type: 'public', owner: 'system', members: [], pendingRequests: [] },
};

const usersInRoom = {};           // roomId -> [{ id: socket.id, name: username }]
const onlineUsers = {};           // username -> { socket, subscription? }
const roomMessages = {};          // roomId -> [messages]
const unreadCounts = {};          // username -> { roomId: count }
let requestCounter = 0;

// VAPID keys
const vapidKeys = {
  publicKey: 'BPGHv4kLY7Rv-mbja7YOb1J3LfErVjjQvEFDOiNunKmz2SurewqqaCg35lCJ1AsgouEPS_4jpYvghUma40e4BvA',
  privateKey: 'PViU5G_04UdUggEpoc5f_utro1UZM0_Yaz45ZMwmhBQ'
};

webpush.setVapidDetails(
  'mailto:xuanthe01656@gmail.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Phát danh sách online users
function emitOnlineUsers() {
  io.emit('onlineUsers', Object.keys(onlineUsers));
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  emitOnlineUsers();

  // Lưu subscription push
  socket.on('subscribePush', (subscription) => {
    if (socket.username) {
      if (!onlineUsers[socket.username]) {
        onlineUsers[socket.username] = { socket };
      }
      onlineUsers[socket.username].subscription = subscription;
      console.log(`Saved push subscription for ${socket.username}`);
    }
  });

  // Tạo phòng mới
  socket.on('createRoom', (roomData) => {
    const username = socket.username;
    if (!username) return;

    let roomId, label = roomData.label?.trim() || 'Unnamed';

    if (roomData.type === 'dm') {
      if (!roomData.targetUser || roomData.targetUser === username) return;
      const users = [username, roomData.targetUser].sort();
      roomId = users.join('_');
      label = users.join(' and ');
      if (rooms[roomId]) {
        socket.emit('newRoomCreated', rooms[roomId]);
        return;
      }
    } else {
      roomId = roomData.id?.toLowerCase().replace(/\s+/g, '-') || 'unnamed';
      if (rooms[roomId]) return;
    }

    const newRoom = {
      id: roomId,
      label,
      type: roomData.type,
      owner: username,
      members: roomData.type === 'public' ? [] : [username],
      pendingRequests: []
    };

    if (roomData.type === 'dm') {
      newRoom.members.push(roomData.targetUser);
    }

    rooms[roomId] = newRoom;
    roomMessages[roomId] = [];

    if (roomData.type === 'public') {
      io.emit('newRoomCreated', newRoom);
    } else {
      socket.emit('newRoomCreated', newRoom);
      if (roomData.type === 'dm') {
        const target = onlineUsers[roomData.targetUser];
        if (target?.socket) target.socket.emit('newRoomCreated', newRoom);
      }
    }
  });

  // Yêu cầu tham gia (group/private)
  socket.on('requestJoin', ({ room: roomId, user }) => {
    if (!rooms[roomId] || !socket.username || socket.username !== user) return;
    const r = rooms[roomId];
    if (r.type === 'public' || r.members.includes(user)) {
      socket.emit('joinApproved', r);
      return;
    }
    if (r.type === 'dm') return;
    if (r.pendingRequests.some(req => req.user === user)) return;

    const reqId = ++requestCounter;
    r.pendingRequests.push({ id: reqId, user });
    const owner = onlineUsers[r.owner];
    if (owner?.socket) {
      owner.socket.emit('joinRequest', { id: reqId, room: r.id, user });
    }
  });

  // Phê duyệt tham gia
  socket.on('approveJoin', ({ requestId, approve }) => {
    const username = socket.username;
    for (let roomId in rooms) {
      const r = rooms[roomId];
      if (r.owner !== username) continue;
      const reqIndex = r.pendingRequests.findIndex(req => req.id === requestId);
      if (reqIndex === -1) continue;
      const req = r.pendingRequests[reqIndex];
      r.pendingRequests.splice(reqIndex, 1);
      if (approve) {
        r.members.push(req.user);
        const userSocket = onlineUsers[req.user]?.socket;
        if (userSocket) {
          userSocket.emit('joinApproved', r);
        }
      }
      return;
    }
  });

  // Lấy danh sách phòng
  socket.on('getUserRooms', () => {
    if (!socket.username) return;
    const pr = [];
    for (let r of Object.values(rooms)) {
      if (r.members.includes(socket.username) && r.type === 'group') {
        pr.push(r);
      }
    }
    socket.emit('userRooms', { privateRooms: pr });
  });

  // Tham gia phòng
  socket.on('joinRoom', (roomId, username) => {
    if (!rooms[roomId]) return;
    const r = rooms[roomId];
    if (r.type !== 'public' && !r.members.includes(username)) return;

    if (!socket.username) socket.username = username;
    onlineUsers[username] = { socket };
    emitOnlineUsers();

    socket.join(roomId);
    if (!usersInRoom[roomId]) usersInRoom[roomId] = [];
    if (!usersInRoom[roomId].some(u => u.id === socket.id)) {
      usersInRoom[roomId].push({ id: socket.id, name: username });
    }

    socket.to(roomId).emit('message', `Hệ thống: ${username} đã tham gia phòng`);
    io.to(roomId).emit('roomUsers', usersInRoom[roomId]);

    // Reset unread khi join
    if (!unreadCounts[username]) unreadCounts[username] = {};
    unreadCounts[username][roomId] = 0;

    socket.emit('loadMessages', roomMessages[roomId] || []);
    socket.emit('unreadUpdate', unreadCounts[username] || {});
  });

  // Rời phòng
  socket.on('leaveRoom', (roomId, username) => {
    if (socket.username !== username) return;
    socket.leave(roomId);
    if (usersInRoom[roomId]) {
      usersInRoom[roomId] = usersInRoom[roomId].filter(u => u.id !== socket.id);
      io.to(roomId).emit('roomUsers', usersInRoom[roomId]);
    }
  });

  // Gửi tin nhắn - ĐÃ SỬA HOÀN CHỈNH
  socket.on('chatMessage', ({ room: roomId, message }) => {
    if (!rooms[roomId] || !message) return;

    if (!roomMessages[roomId]) roomMessages[roomId] = [];
    roomMessages[roomId].push(message);

    io.to(roomId).emit('message', message);

    const r = rooms[roomId];
    if (r) {
      r.members.forEach(member => {
        if (member === socket.username) return; // Bỏ qua người gửi

        // Kiểm tra user có đang ở trong phòng này không
        const isInThisRoom = usersInRoom[roomId]?.some(u => u.name === member) || false;

        // Nếu KHÔNG đang ở phòng này → tăng unread
        if (!isInThisRoom) {
          if (!unreadCounts[member]) unreadCounts[member] = {};
          unreadCounts[member][roomId] = (unreadCounts[member][roomId] || 0) + 1;

          // Cập nhật realtime cho user online (ở tab/phòng khác)
          const userData = onlineUsers[member];
          if (userData?.socket) {
            userData.socket.emit('unreadUpdate', unreadCounts[member]);
          }
        }

        // Push notification chỉ gửi cho người offline hoàn toàn
        const isOnline = !!onlineUsers[member];
        if (!isOnline && userData?.subscription) {
          const payload = JSON.stringify({
            title: `Tin nhắn mới trong ${r.label}`,
            body: message.slice(0, 100) + (message.length > 100 ? '...' : ''),
            icon: '/icon.png',
            url: `/chat/${roomId}`
          });

          webpush.sendNotification(userData.subscription, payload)
            .catch(err => {
              console.error(`Push failed for ${member}:`, err);
              if (err.statusCode === 410) {
                delete userData.subscription;
              }
            });
        }
      });
    }
  });

  // Cleanup disconnecting
  socket.on('disconnecting', () => {
    const roomsList = [...socket.rooms].filter(r => r !== socket.id);
    roomsList.forEach(roomId => {
      if (usersInRoom[roomId]) {
        usersInRoom[roomId] = usersInRoom[roomId].filter(u => u.id !== socket.id);
        io.to(roomId).emit('roomUsers', usersInRoom[roomId]);
      }
    });
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      delete onlineUsers[socket.username];
      emitOnlineUsers();
    }
    console.log('Client disconnected:', socket.id);
  });
});

httpServer.listen(3000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:3000');
});