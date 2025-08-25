const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('./db');
const Message = require('./models/Message');
const User = require('./models/User');

dotenv.config();
connectDB();

const app = express();

// --- START: CORS Configuration Fix ---
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? ['https://yash-app-chat-application-19.vercel.app']
  : ['http://localhost:5173', 'http://localhost:3000']; 

// Express CORS for HTTP requests (like /api/auth/login)
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
// --- END: CORS Configuration Fix ---

app.use(express.json());
app.use("/api/auth", require('./routes/authRoutes'));
app.use("/api/chat", require('./routes/chatRoutes'));

const server = http.createServer(app);

// Socket.IO CORS for WebSocket connections
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  }
});

// Correctly manage online users
const onlineUsers = {};

io.on("connection", (socket) => {
    console.log("🟢 Socket connected:", socket.id);

    socket.on("user-online", async (userId) => {
        try {
            const user = await User.findByIdAndUpdate(userId, { online: true }, { new: true });
            if (user) {
                onlineUsers[user._id] = socket.id;
                io.emit("update-user-status", onlineUsers);
            }
        } catch (err) {
            console.error("❌ Error setting user online:", err);
        }
    });

    // --- START: Message Logic Fix ---
    // The server no longer saves the message.
    // The message is saved by a separate HTTP POST request from the frontend.
    // This event only broadcasts the message to the receiver.
    socket.on("sendMessage", (messageData) => {
        const receiverSocketId = onlineUsers[messageData.receiver];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit("receiveMessage", messageData);
        }
    });
    // --- END: Message Logic Fix ---

    // === Existing WebRTC Signaling Events ===
    socket.on('call-invitation', ({ to, from, name }) => {
        const receiverSocketId = onlineUsers[to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('call-invitation', { from, name });
        }
    });
    socket.on('offer', ({ to, sdp }) => {
        const receiverSocketId = onlineUsers[to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('offer', { from: socket.id, sdp });
        }
    });
    socket.on('answer', ({ to, sdp }) => {
        const callerSocketId = onlineUsers[to];
        if (callerSocketId) {
            io.to(callerSocketId).emit('answer', { sdp });
        }
    });
    socket.on('ice-candidate', ({ to, candidate }) => {
        const otherUserSocketId = onlineUsers[to];
        if (otherUserSocketId) {
            io.to(otherUserSocketId).emit('ice-candidate', { candidate });
        }
    });
    socket.on('call-accepted', ({ to }) => {
        const callerSocketId = onlineUsers[to];
        if (callerSocketId) {
            io.to(callerSocketId).emit('call-accepted');
        }
    });
    socket.on('call-rejected', ({ to }) => {
        const callerSocketId = onlineUsers[to];
        if (callerSocketId) {
            io.to(callerSocketId).emit('call-rejected');
        }
    });
    socket.on('call-ended', ({ to }) => {
        const otherUserSocketId = onlineUsers[to];
        if (otherUserSocketId) {
            io.to(otherUserSocketId).emit('call-ended');
        }
    });

    socket.on("disconnect", () => {
        for (let uid in onlineUsers) {
            if (onlineUsers[uid] === socket.id) {
                delete onlineUsers[uid];
                io.emit("update-user-status", onlineUsers);
                break;
            }
        }
    });
});

server.listen(process.env.PORT || 4000, () => {
    console.log(`🚀 Server running on port ${process.env.PORT || 4000}`);
});