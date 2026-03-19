const express = require("express");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;
const User = require("../models/User");
const Status = require("../models/Status");

const app = express();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => ({
        folder: "yashapp/statuses",
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
        public_id: Date.now() + "-" + file.originalname.split(".")[0],
    }),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const auth = (req) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) throw new Error("Unauthorized");
    return jwt.verify(token, process.env.JWT_SECRET);
};

// Post text status
app.post("/text", async (req, res) => {
    try {
        const decoded = auth(req);
        const { content, bgColor } = req.body;
        if (!content?.trim()) return res.status(400).json({ message: "Content required" });
        const status = await Status.create({ user: decoded.id, type: "text", content: content.trim(), bgColor: bgColor || "#1e1e2e" });
        const populated = await status.populate("user", "username avatar");
        const io = req.app.get("io");
        const me = await User.findById(decoded.id).select("friends");
        if (io) {
            const onlineUsers = req.app.get("onlineUsers");
            (me.friends || []).forEach(fid => {
                const sid = onlineUsers[String(fid)];
                if (sid) io.to(sid).emit("new-status", populated);
            });
        }
        res.json(populated);
    } catch { res.status(500).json({ message: "Server error" }); }
});

// Post image status
app.post("/image", upload.single("image"), async (req, res) => {
    try {
        const decoded = auth(req);
        if (!req.file) return res.status(400).json({ message: "No image uploaded" });
        const imageUrl = req.file.path;
        const status = await Status.create({ user: decoded.id, type: "image", content: imageUrl, caption: req.body.caption || "" });
        const populated = await status.populate("user", "username avatar");
        const io = req.app.get("io");
        const me = await User.findById(decoded.id).select("friends");
        if (io) {
            const onlineUsers = req.app.get("onlineUsers");
            (me.friends || []).forEach(fid => {
                const sid = onlineUsers[String(fid)];
                if (sid) io.to(sid).emit("new-status", populated);
            });
        }
        res.json(populated);
    } catch { res.status(500).json({ message: "Server error" }); }
});

// Get all statuses (own + friends), grouped by user
app.get("/", async (req, res) => {
    try {
        const decoded = auth(req);
        const me = await User.findById(decoded.id).select("friends");
        const allowedUsers = [decoded.id, ...(me.friends || []).map(String)];
        const statuses = await Status.find({ user: { $in: allowedUsers } })
            .populate("user", "username avatar")
            .populate("viewers", "username avatar")
            .sort({ createdAt: -1 });
        res.json(statuses);
    } catch { res.status(401).json({ message: "Unauthorized" }); }
});

// Mark status as viewed
app.post("/:id/view", async (req, res) => {
    try {
        const decoded = auth(req);
        await Status.findByIdAndUpdate(req.params.id, { $addToSet: { viewers: decoded.id } });
        res.json({ ok: true });
    } catch { res.status(500).json({ message: "Server error" }); }
});

// Delete own status
app.delete("/:id", async (req, res) => {
    try {
        const decoded = auth(req);
        const status = await Status.findById(req.params.id);
        if (!status) return res.status(404).json({ message: "Not found" });
        if (String(status.user) !== String(decoded.id)) return res.status(403).json({ message: "Forbidden" });
        await status.deleteOne();
        res.json({ ok: true });
    } catch { res.status(500).json({ message: "Server error" }); }
});

module.exports = app;
