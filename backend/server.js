const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('./db');
const Message = require('./models/Message');
const User = require('./models/User');

dotenv.config();
connectDB();

const app = express();

const corsOptions = {
  origin: (origin, callback) => callback(null, true),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/chat', require('./routes/chatRoutes'));
app.use('/api/status', require('./routes/statusRoutes'));

const server = http.createServer(app);

const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: false }
});

const onlineUsers = {};

// Make io accessible in routes
app.set('io', io);
app.set('onlineUsers', onlineUsers);

io.on('connection', (socket) => {
  console.log('🟢 Socket connected:', socket.id);

  socket.on('user-online', async (userId) => {
    try {
      onlineUsers[userId] = socket.id;
      io.emit('update-user-status', Object.keys(onlineUsers));
      await User.findByIdAndUpdate(userId, { online: true });
    } catch (err) {
      console.error('❌ Error setting user online:', err);
    }
  });

  socket.on('sendMessage', (messageData) => {
    const receiverSocketId = onlineUsers[messageData.receiver];
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('receiveMessage', messageData);
    }
  });

  // Delete messages and notify the other user
  socket.on('deleteMessages', ({ messageIds, receiverId }) => {
    const receiverSocketId = onlineUsers[receiverId];
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('messagesDeleted', { messageIds });
    }
  });

  // Mark message as read and notify sender
  socket.on('markRead', async ({ messageId, senderId }) => {
    try {
      const updated = await Message.findByIdAndUpdate(messageId, { read: true }, { new: true });
      const senderSocketId = onlineUsers[senderId];
      if (senderSocketId && updated) {
        io.to(senderSocketId).emit('messageRead', updated);
      }
    } catch (err) {
      console.error('❌ Error marking message read:', err);
    }
  });

  // Audio Call Signaling
  socket.on('audio-call-invitation', ({ to, from, name }) => {
    const receiverSocketId = onlineUsers[to];
    if (receiverSocketId) io.to(receiverSocketId).emit('audio-call-invitation', { from, name });
  });

  socket.on('audio-offer', ({ to, from, sdp }) => {
    const receiverSocketId = onlineUsers[to];
    if (receiverSocketId) io.to(receiverSocketId).emit('audio-offer', { from, sdp });
  });

  socket.on('audio-answer', ({ to, sdp }) => {
    const callerSocketId = onlineUsers[to];
    if (callerSocketId) io.to(callerSocketId).emit('audio-answer', { sdp });
  });

  socket.on('audio-ice-candidate', ({ to, candidate }) => {
    const otherSocketId = onlineUsers[to];
    if (otherSocketId) io.to(otherSocketId).emit('audio-ice-candidate', { candidate });
  });

  socket.on('audio-call-accepted', ({ to }) => {
    const callerSocketId = onlineUsers[to];
    if (callerSocketId) io.to(callerSocketId).emit('audio-call-accepted');
  });

  socket.on('audio-call-rejected', ({ to }) => {
    const callerSocketId = onlineUsers[to];
    if (callerSocketId) io.to(callerSocketId).emit('audio-call-rejected');
  });

  socket.on('audio-call-ended', ({ to }) => {
    const otherSocketId = onlineUsers[to];
    if (otherSocketId) io.to(otherSocketId).emit('audio-call-ended');
  });

  // Video Call Signaling
  socket.on('call-invitation', ({ to, from, name }) => {
    const receiverSocketId = onlineUsers[to];
    if (receiverSocketId) io.to(receiverSocketId).emit('call-invitation', { from, name });
  });

  socket.on('offer', ({ to, from, sdp }) => {
    const receiverSocketId = onlineUsers[to];
    if (receiverSocketId) io.to(receiverSocketId).emit('offer', { from, sdp });
  });

  socket.on('answer', ({ to, sdp }) => {
    const callerSocketId = onlineUsers[to];
    if (callerSocketId) io.to(callerSocketId).emit('answer', { sdp });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    const otherUserSocketId = onlineUsers[to];
    if (otherUserSocketId) io.to(otherUserSocketId).emit('ice-candidate', { candidate });
  });

  socket.on('call-accepted', ({ to }) => {
    const callerSocketId = onlineUsers[to];
    if (callerSocketId) io.to(callerSocketId).emit('call-accepted');
  });

  socket.on('call-rejected', ({ to }) => {
    const callerSocketId = onlineUsers[to];
    if (callerSocketId) io.to(callerSocketId).emit('call-rejected');
  });

  socket.on('call-cancelled', ({ to }) => {
    const receiverSocketId = onlineUsers[to];
    if (receiverSocketId) io.to(receiverSocketId).emit('call-cancelled');
  });

  socket.on('audio-call-cancelled', ({ to }) => {
    const receiverSocketId = onlineUsers[to];
    if (receiverSocketId) io.to(receiverSocketId).emit('audio-call-cancelled');
  });

  socket.on('call-ended', ({ to }) => {
    const otherUserSocketId = onlineUsers[to];
    if (otherUserSocketId) io.to(otherUserSocketId).emit('call-ended');
  });

  socket.on('disconnect', async () => {
    for (let uid in onlineUsers) {
      if (onlineUsers[uid] === socket.id) {
        delete onlineUsers[uid];
        try {
          await User.findByIdAndUpdate(uid, { online: false });
        } catch (err) {
          console.error('❌ Error setting user offline:', err);
        }
        io.emit('update-user-status', Object.keys(onlineUsers));
        break;
      }
    }
  });
});

server.listen(process.env.PORT || 4000, () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 4000}`);
});

// ── Birthday wish cron (runs daily at 8:00 AM) ──
const checkBirthdays = async () => {
  try {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const todayMD = `${mm}-${dd}`;
    const users = await User.find({ dob: { $regex: `-${mm}-${dd}$` } }).populate("friends", "_id");
    for (const birthdayUser of users) {
      for (const friend of birthdayUser.friends) {
        const msg = await Message.create({
          sender: friend._id,
          receiver: birthdayUser._id,
          content: `🎂 Happy Birthday, ${birthdayUser.username}! 🎉 Wishing you a wonderful day!`,
          type: "text",
        });
        // Notify the birthday person
        const birthdaySocket = onlineUsers[String(birthdayUser._id)];
        if (birthdaySocket) io.to(birthdaySocket).emit("receiveMessage", msg);
        // Also notify the friend so it appears in their chat too
        const friendSocket = onlineUsers[String(friend._id)];
        if (friendSocket) io.to(friendSocket).emit("receiveMessage", msg);
      }
    }
    console.log(`🎂 Birthday check done: ${users.length} birthdays today`);
  } catch (err) {
    console.error("Birthday cron error:", err);
  }
};

// Run at startup and then every 24h
checkBirthdays();
setInterval(checkBirthdays, 24 * 60 * 60 * 1000);
