const express = require("express");
const router = express.Router();
const Message = require("../models/Message");

// This middleware is often used to protect routes
// If you have one, make sure to require it
// const auth = require('../middleware/authMiddleware');

// ✅ Send a message (saves to DB)
router.post("/send", async (req, res) => {
  const { sender, receiver, content } = req.body;
  try {
    const newMessage = new Message({ sender, receiver, content });
    await newMessage.save();
    res.status(201).json(newMessage);
  } catch (error) {
    res.status(500).json({ message: "Error saving message", error });
  }
});

// ✅ Get all messages between two users
router.get("/messages/:receiverId", async (req, res) => {
  const { receiverId } = req.params;
  const { userId } = req.query; // Assuming you'll pass sender ID as a query param
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

// ✅ NEW: Mark a message as read
router.put("/read/:messageId", async (req, res) => {
  const { messageId } = req.params;
  try {
    // Find the message by its ID and update the 'read' field to true
    const updatedMessage = await Message.findByIdAndUpdate(
      messageId,
      { read: true },
      { new: true } // The 'new: true' option returns the updated document
    );

    if (!updatedMessage) {
      return res.status(404).json({ message: "Message not found." });
    }

    res.status(200).json(updatedMessage);
  } catch (error) {
    res.status(500).json({ message: "Error updating message status.", error });
  }
});

module.exports = router;