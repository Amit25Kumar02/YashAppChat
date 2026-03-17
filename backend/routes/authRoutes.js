const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const dotenv = require("dotenv");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

dotenv.config();
const app = express();

const avatarDir = path.join(__dirname, "../uploads/avatars");
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Register
app.post("/", async (req, res) => {
    const { username, phoneNumber, email, password } = req.body;
    try {
        const existingUser = await User.findOne({ phoneNumber });
        if (existingUser) return res.status(400).json({ message: "User already exists" });
        const newUser = new User({ username, phoneNumber, email, password });
        await newUser.save();
        const io = req.app.get("io");
        if (io) io.emit("new-user", { _id: newUser._id, username: newUser.username, avatar: newUser.avatar, online: false, friends: [], friendRequests: [] });
        res.status(200).json({ message: "✅ User registered successfully" });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// Login
app.post("/login", async (req, res) => {
    const { phoneNumber, password } = req.body;
    try {
        const user = await User.findOne({ phoneNumber });
        if (!user) return res.status(400).json({ message: "Invalid phone number" });
        if (user.password !== password) return res.status(400).json({ message: "Invalid password" });
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "30d" });
        res.json({ token, user: { userId: user._id, username: user.username, phoneNumber: user.phoneNumber } });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// Get logged-in user
app.get("/me", async (req, res) => {
    try {
        const token = req.headers.authorization.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select("-password");
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json(user);
    } catch (error) {
        res.status(401).json({ message: "Unauthorized" });
    }
});

// Upload / update avatar
app.put("/avatar", upload.single("avatar"), async (req, res) => {
    try {
        const token = req.headers.authorization.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        // Delete old avatar file if exists
        const existing = await User.findById(decoded.id);
        if (existing.avatar) {
            const oldPath = path.join(__dirname, "../", existing.avatar);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        const avatarUrl = `/uploads/avatars/${req.file.filename}`;
        const user = await User.findByIdAndUpdate(decoded.id, { avatar: avatarUrl }, { new: true }).select("-password");
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: "Error updating avatar" });
    }
});

// Get user by username
app.get("/username/:username", async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ error: "User not found" });
        res.json({ _id: user._id, username: user.username });
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Get all users
app.get("/users", async (req, res) => {
    try {
        const token = req.headers.authorization.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const users = await User.find({ _id: { $ne: decoded.id } }).select("-password");
        res.json(users);
    } catch (error) {
        res.status(401).json({ message: "Unauthorized" });
    }
});

// Send friend request
app.post("/friend-request", async (req, res) => {
    try {
        const token = req.headers.authorization.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { toId } = req.body;
        const target = await User.findById(toId);
        if (!target) return res.status(404).json({ message: "User not found" });
        if (target.friendRequests.includes(decoded.id) || target.friends.includes(decoded.id))
            return res.status(400).json({ message: "Already sent or friends" });
        await User.findByIdAndUpdate(toId, { $push: { friendRequests: decoded.id } });
        const io = req.app.get("io");
        const onlineUsers = req.app.get("onlineUsers");
        const targetSocket = onlineUsers[toId];
        if (io && targetSocket) io.to(targetSocket).emit("friend-request", { from: decoded.id });
        res.json({ message: "Request sent" });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// Accept friend request
app.post("/friend-accept", async (req, res) => {
    try {
        const token = req.headers.authorization.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { fromId } = req.body;
        await User.findByIdAndUpdate(decoded.id, { $pull: { friendRequests: fromId }, $push: { friends: fromId } });
        await User.findByIdAndUpdate(fromId, { $push: { friends: decoded.id } });
        const io = req.app.get("io");
        const onlineUsers = req.app.get("onlineUsers");
        const [me, friend] = await Promise.all([
            User.findById(decoded.id).select("-password"),
            User.findById(fromId).select("-password")
        ]);
        const fromSocket = onlineUsers[fromId];
        if (io && fromSocket) io.to(fromSocket).emit("friend-accepted", { by: decoded.id, user: me });
        res.json({ user: friend });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// Reject friend request
app.post("/friend-reject", async (req, res) => {
    try {
        const token = req.headers.authorization.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { fromId } = req.body;
        await User.findByIdAndUpdate(decoded.id, { $pull: { friendRequests: fromId } });
        res.json({ message: "Rejected" });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// Unfriend
app.post("/unfriend", async (req, res) => {
    try {
        const token = req.headers.authorization.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { friendId } = req.body;
        await User.findByIdAndUpdate(decoded.id, { $pull: { friends: friendId } });
        await User.findByIdAndUpdate(friendId, { $pull: { friends: decoded.id } });
        const io = req.app.get("io");
        const onlineUsers = req.app.get("onlineUsers");
        const friendSocket = onlineUsers[friendId];
        if (io && friendSocket) io.to(friendSocket).emit("unfriended", { by: decoded.id });
        res.json({ message: "Unfriended" });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error" });
    }
});

module.exports = app;
