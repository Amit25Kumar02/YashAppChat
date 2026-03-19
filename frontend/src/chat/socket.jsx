import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export const socket = io(SOCKET_URL, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  timeout: 10000,
});

socket.on("connect", () => {
  console.log("🟢 Socket connected:", socket.id);
  // Re-register user online after reconnect so onlineUsers map stays fresh
  const userId = localStorage.getItem("myUserId");
  if (userId) socket.emit("user-online", userId);
});
socket.on("disconnect", () => console.log("🔴 Socket disconnected"));
