const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('./db');
const Message = require('./models/Message');
const Group = require('./models/Group');
const User = require('./models/User');

dotenv.config();
connectDB();

const app = express();

// Set the allowed origin for CORS
// IMPORTANT: Replace this with your actual Vercel frontend URL
const allowedOrigin = 'https://yash-app-chat-application-19.vercel.app';

// Configure CORS middleware for Express
app.use(cors({
  origin: allowedOrigin,
  credentials: true,
}));

app.use(express.json());
app.use("/api/auth", require('./routes/authRoutes'));
app.use("/api/chat", require('./routes/chatRoutes'));

const server = http.createServer(app);

// Configure Socket.IO to allow connections from the Vercel frontend
const io = socketIo(server, {
  cors: {
    origin: allowedOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  }
});

// Correctly manage online users
const onlineUsers = {};

io.on("connection", (socket) => {
    console.log("🟢 Socket connected:", socket.id);

    // This event should be the only way to map a user ID to a socket ID
    socket.on("user-online", async (userId) => {
        try {
            const user = await User.findByIdAndUpdate(userId, { online: true }, { new: true });
            if (user) {
                onlineUsers[user._id] = socket.id; // Use the onlineUsers map
                io.emit("update-user-status", onlineUsers);
            }
        } catch (err) {
            console.error("❌ Error setting user online:", err);
        }
    });

    // === WebRTC Signaling Events (New) ===
    
    // 1. A client wants to initiate a call
    socket.on('call-invitation', ({ to, from, name }) => {
        const receiverSocketId = onlineUsers[to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('call-invitation', { from, name });
        }
    });

    // 2. The caller sends an SDP offer
    socket.on('offer', ({ to, sdp }) => {
        const receiverSocketId = onlineUsers[to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('offer', { from: socket.id, sdp });
        }
    });

    // 3. The receiver sends an SDP answer
    socket.on('answer', ({ to, sdp }) => {
        const callerSocketId = onlineUsers[to];
        if (callerSocketId) {
            io.to(callerSocketId).emit('answer', { sdp });
        }
    });

    // 4. Clients exchange ICE candidates
    socket.on('ice-candidate', ({ to, candidate }) => {
        const otherUserSocketId = onlineUsers[to];
        if (otherUserSocketId) {
            io.to(otherUserSocketId).emit('ice-candidate', { candidate });
        }
    });

    // 5. The receiver accepts the call
    socket.on('call-accepted', ({ to }) => {
        const callerSocketId = onlineUsers[to];
        if (callerSocketId) {
            io.to(callerSocketId).emit('call-accepted');
        }
    });

    // 6. A client rejects or ends the call
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

    // === Existing Chat Events ===

    socket.on("sendMessage", async ({ sender, receiver, content, type = "text" }) => {
        try {
            const msg = new Message({ sender, receiver, content, type, read: false });
            await msg.save();
            const receiverSocketId = onlineUsers[receiver];
            if (receiverSocketId) {
                io.to(receiverSocketId).emit("receiveMessage", msg);
            } else {
                // Handle offline messages
            }
        } catch (err) {
            console.error("❌ Message send error:", err);
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