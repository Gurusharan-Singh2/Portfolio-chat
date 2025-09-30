import express from "express";
import 'dotenv/config'
import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import cors from "cors";
import mongoose from "mongoose";
import Message from "./models/Message.js";

const app = express();
app.use(cors());
const httpServer = createServer(app);

const io = new Server(httpServer, { cors: { origin:["http://localhost:3000", "https://gurusharan.vercel.app"]  } });
const SECRET = "supersecret";
const onlineUsers = new Map();

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));


io.use((socket, next) => {
  const token = socket.handshake.query.token;
  try {
    const decoded = jwt.verify(token, SECRET);
    socket.user = decoded;
    onlineUsers.set(decoded.id, socket.id);
    next();
  } catch {
    next(new Error("Authentication error"));
  }
});
const ADMIN_ID = "68d25ce46ae71dccc1483c27"; 


io.on("connection", async (socket) => {
  console.log("User connected:", socket.user.email);

  const history = await Message.find({
    $or: [
      { senderId: socket.user.id, recipientId: ADMIN_ID },
      { senderId: ADMIN_ID, recipientId: socket.user.id }
    ],
  })
    .sort({ timestamp: 1 })
    .limit(50)
    .lean();
  socket.emit("chatHistory", history);

  socket.on("privateMessage", async ({ recipientId, text }) => {
    if (!recipientId || !text) return;

    const msg = await Message.create({
      senderId: socket.user.id,
      recipientId,                 
      senderEmail: socket.user.email,
      text,
      timestamp: new Date(),
    });

    const recipientSocketId = onlineUsers.get(recipientId);
    if (recipientSocketId) io.to(recipientSocketId).emit("privateMessage", msg);

    socket.emit("privateMessage", msg);
  });

  socket.on("typing", ({ recipientId }) => {
    if (!recipientId) return;
    const recipientSocketId = onlineUsers.get(recipientId);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit("typing", { senderId: socket.user.id });
    }
  });

  socket.on("disconnect", () => {
    onlineUsers.delete(socket.user.id);
    console.log("User disconnected:", socket.user.email);
  });
});
httpServer.listen(4000, () => console.log("Chat server running on 4000"));
