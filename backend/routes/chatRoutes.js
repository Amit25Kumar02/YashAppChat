const express = require("express");
const router = express.Router();
const Message = require("../models/Message");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;
const path = require("path");
const fs = require("fs");

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const imageStorage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => ({
        folder: "yashapp/chat",
        allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"],
        public_id: Date.now() + "-" + file.originalname.split(".")[0],
    }),
});
const upload = multer({ storage: imageStorage, limits: { fileSize: 10 * 1024 * 1024 } });

const voiceDir = path.join(__dirname, "../uploads/voices");
if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir, { recursive: true });
const voiceStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, voiceDir),
    filename: (req, file, cb) => cb(null, Date.now() + ".webm"),
});
const uploadVoice = multer({ storage: voiceStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// Upload voice
router.post("/upload-voice", uploadVoice.single("voice"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  res.json({ url: `/uploads/voices/${req.file.filename}` });
});

// Upload image — now returns Cloudinary URL directly
router.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  res.json({ url: req.file.path });
});

// Send a message
router.post("/send", async (req, res) => {
  const { sender, receiver, content, type } = req.body;
  try {
    const newMessage = new Message({ sender, receiver, content, type: type || "text" });
    await newMessage.save();
    res.status(201).json(newMessage);
  } catch (error) {
    res.status(500).json({ message: "Error saving message", error });
  }
});

// Get all messages between two users
router.get("/messages/:receiverId", async (req, res) => {
  const { receiverId } = req.params;
  const { userId } = req.query;
  try {
    const messages = await Message.find({
      $or: [
        { sender: userId, receiver: receiverId },
        { sender: receiverId, receiver: userId },
      ],
    }).sort({ createdAt: 1 });
    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ message: "Error fetching messages", error });
  }
});

// Mark a message as read
router.put("/read/:messageId", async (req, res) => {
  const { messageId } = req.params;
  try {
    const updatedMessage = await Message.findByIdAndUpdate(messageId, { read: true }, { new: true });
    if (!updatedMessage) return res.status(404).json({ message: "Message not found." });
    res.status(200).json(updatedMessage);
  } catch (error) {
    res.status(500).json({ message: "Error updating message status.", error });
  }
});

// Delete a single message
router.delete("/message/:messageId", async (req, res) => {
  try {
    const msg = await Message.findByIdAndDelete(req.params.messageId);
    if (!msg) return res.status(404).json({ message: "Message not found." });
    if (msg.type === "image" && msg.content?.includes("cloudinary")) {
      const parts = msg.content.split("/");
      const publicId = "yashapp/chat/" + parts[parts.length - 1].split(".")[0];
      await cloudinary.uploader.destroy(publicId).catch(() => {});
    }
    res.json({ success: true, messageId: req.params.messageId });
  } catch (error) {
    res.status(500).json({ message: "Error deleting message", error });
  }
});

// Delete multiple messages
router.post("/delete-many", async (req, res) => {
  const { messageIds } = req.body;
  try {
    const msgs = await Message.find({ _id: { $in: messageIds } });
    await Promise.all(msgs.map(async msg => {
      if (msg.type === "image" && msg.content?.includes("cloudinary")) {
        const parts = msg.content.split("/");
        const publicId = "yashapp/chat/" + parts[parts.length - 1].split(".")[0];
        await cloudinary.uploader.destroy(publicId).catch(() => {});
      }
    }));
    await Message.deleteMany({ _id: { $in: messageIds } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Error deleting messages", error });
  }
});

// Clear entire conversation
router.delete("/conversation/:userId/:receiverId", async (req, res) => {
  const { userId, receiverId } = req.params;
  try {
    const msgs = await Message.find({
      $or: [
        { sender: userId, receiver: receiverId },
        { sender: receiverId, receiver: userId },
      ],
    });
    msgs.forEach(msg => {
      if (msg.type === "image" && msg.content) {
        const filename = msg.content.split("/uploads/")[1];
        if (filename) {
          const filePath = path.join(uploadDir, filename);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      }
    });
    await Message.deleteMany({
      $or: [
        { sender: userId, receiver: receiverId },
        { sender: receiverId, receiver: userId },
      ],
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Error clearing conversation", error });
  }
});

module.exports = router;
