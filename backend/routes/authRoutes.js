const express = require("express");
const jwt = require("jsonwebtoken");
// const bcrypt = require("bcryptjs");
const User = require("../models/User");
const dotenv = require("dotenv");

dotenv.config();
const app = express();

// ✅ Register Route
app.post("/", async (req, res) => {
    const { username, phoneNumber, email, password } = req.body;

    try {
        // Check if user already exists
        const existingUser = await User.findOne({ phoneNumber });
        if (existingUser) {
            return res.status(400).json({ message: "User already exists" });
        }
        // Save user
        const newUser = new User({
            username,
            phoneNumber,
            email,
            password,
        });

        await newUser.save();
        res.status(200).json({ message: "✅ User registered successfully" });

    } catch (error) {
        console.error("❌ Registration error:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// ✅ Login Route
app.post("/login", async (req, res) => {
    const { phoneNumber, password } = req.body;

    try {
        const user = await User.findOne({ phoneNumber });
        if (!user) {
            return res.status(400).json({ message: "Invalid phone number" });
        }

        // Check password
        if (user.password !== password) {
            return res.status(400).json({ message: "Invalid password" });
        }

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
            expiresIn: "1h",
        });

        res.json({
            token,
            user: {
                userId: user._id,
                username: user.username,
                phoneNumber: user.phoneNumber,
            },
        });

    } catch (error) {
        console.error("❌ Login error:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// ✅ Get Logged-in User Info (Protected)
app.get("/me", async (req, res) => {
    try {
        const token = req.headers.authorization.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findById(decoded.id).select("-password");
        if (!user) return res.status(404).json({ message: "User not found" });

        res.json(user);
    } catch (error) {
        console.error("❌ Get user error:", error);
        res.status(401).json({ message: "Unauthorized" });
    }
});

// ✅ Get User by Username
app.get("/username/:username", async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ error: "User not found" });

        res.json({
            _id: user._id,
            username: user.username
        });

    } catch (error) {
        console.error("❌ Fetch user by username error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
// ✅ Get all users (Protected)
app.get("/users", async (req, res) => {
  try {
    const token = req.headers.authorization.split(" ")[1];
    jwt.verify(token, process.env.JWT_SECRET);

    const users = await User.find().select("-password");
    res.json(users);
  } catch (error) {
    console.error("❌ Fetch all users error:", error);
    res.status(401).json({ message: "Unauthorized" });
  }
});
module.exports = app;
