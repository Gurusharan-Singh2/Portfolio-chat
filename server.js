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
    onlineUsers.set(String(decoded.id), socket.id);
    next();
  } catch {
    next(new Error("Authentication error"));
  }
});
const ADMIN_ID = "6940e8fb7e042f29dcf61df0"; 


io.on("connection", async (socket) => {
  // Broadcast online status
  io.emit("userStatus", { userId: socket.user.id, status: "online" });

  // Only send chat history for non-admin users chatting with admin
  if (String(socket.user.id) !== String(ADMIN_ID)) {
    try {
      const userObjId = new mongoose.Types.ObjectId(socket.user.id);
      const adminObjId = new mongoose.Types.ObjectId(ADMIN_ID);
      const history = await Message.find({
        $or: [
          { senderId: userObjId, recipientId: adminObjId },
          { senderId: adminObjId, recipientId: userObjId }
        ],
      })
        .sort({ timestamp: 1 })
        .limit(50)
        .lean();
      socket.emit("chatHistory", history);
    } catch (err) {
      console.error("Error fetching chat history:", err);
    }
  }

  socket.on("privateMessage", async ({ recipientId, text, clientId }) => {
    if (!recipientId || !text) return;

    // Basic validation: recipientId must look like a Mongo ObjectId string
    if (typeof recipientId !== "string" || !/^[0-9a-fA-F]{24}$/.test(recipientId)) {
      console.error("Invalid recipientId format:", recipientId);
      return;
    }

    // Convert IDs to ObjectId for proper MongoDB storage
    let senderObjId, recipientObjId;
    try {
      senderObjId = new mongoose.Types.ObjectId(socket.user.id);
      recipientObjId = new mongoose.Types.ObjectId(recipientId);
    } catch (err) {
      console.error("Invalid ObjectId:", err);
      return;
    }

    const msg = await Message.create({
      senderId: senderObjId,
      recipientId: recipientObjId,                 
      senderEmail: socket.user.email,
      text,
      timestamp: new Date(),
    });

    // Convert to plain object for socket emission
    const msgObj = msg.toObject ? msg.toObject() : msg;
    // Attach clientId (not stored in DB) so clients can reconcile optimistic messages
    if (clientId) {
      msgObj.clientId = clientId;
    }

    // Send to recipient if online
    const recipientSocketId = onlineUsers.get(String(recipientId));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit("privateMessage", msgObj);
    }

    // Also send back to sender for confirmation
    socket.emit("privateMessage", msgObj);
  });

  socket.on("typing", ({ recipientId }) => {
    if (!recipientId) return;
    const recipientSocketId = onlineUsers.get(String(recipientId));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit("typing", { senderId: socket.user.id });
    }
  });

  socket.on("stopTyping", ({ recipientId }) => {
    if (!recipientId) return;
    const recipientSocketId = onlineUsers.get(String(recipientId));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit("stopTyping", { senderId: socket.user.id });
    }
  });

  socket.on("disconnect", (reason) => {
    onlineUsers.delete(String(socket.user.id));
    io.emit("userStatus", { userId: socket.user.id, status: "offline" });
    console.log(`User disconnected: ${socket.user.email} Reason: ${reason}`);
  });
});
httpServer.listen(4000, () => console.log("Chat server running on 4000"));
