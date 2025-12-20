import express from "express";
import "dotenv/config";
import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import cors from "cors";
import mongoose from "mongoose";
import axios from "axios";
import Message from "./models/Message.js";

const app = express();
app.use(cors());

/* ------------------ KEEP ALIVE ROUTE ------------------ */
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    time: new Date().toISOString(),
  });
});

/* ------------------ HTTP + SOCKET ------------------ */
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:3000", "https://gurusharan.vercel.app"],
  },
});

const SECRET = "supersecret";
const onlineUsers = new Map();

/* ------------------ MONGODB ------------------ */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

/* ------------------ SOCKET AUTH ------------------ */
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

/* ------------------ SOCKET EVENTS ------------------ */
io.on("connection", async (socket) => {
  io.emit("userStatus", {
    userId: socket.user.id,
    status: "online",
  });

  // Send chat history (user <-> admin)
  if (String(socket.user.id) !== String(ADMIN_ID)) {
    try {
      const userObjId = new mongoose.Types.ObjectId(socket.user.id);
      const adminObjId = new mongoose.Types.ObjectId(ADMIN_ID);

      const history = await Message.find({
        $or: [
          { senderId: userObjId, recipientId: adminObjId },
          { senderId: adminObjId, recipientId: userObjId },
        ],
      })
        .sort({ timestamp: 1 })
        .limit(50)
        .lean();

      socket.emit("chatHistory", history);
    } catch (err) {
      console.error("Chat history error:", err);
    }
  }

  socket.on("privateMessage", async ({ recipientId, text, clientId }) => {
    if (!recipientId || !text) return;

    if (!/^[0-9a-fA-F]{24}$/.test(recipientId)) return;

    let senderObjId, recipientObjId;
    try {
      senderObjId = new mongoose.Types.ObjectId(socket.user.id);
      recipientObjId = new mongoose.Types.ObjectId(recipientId);
    } catch {
      return;
    }

    const msg = await Message.create({
      senderId: senderObjId,
      recipientId: recipientObjId,
      senderEmail: socket.user.email,
      text,
      timestamp: new Date(),
    });

    const msgObj = msg.toObject();
    if (clientId) msgObj.clientId = clientId;

    const recipientSocketId = onlineUsers.get(String(recipientId));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit("privateMessage", msgObj);
    }

    socket.emit("privateMessage", msgObj);
  });

  socket.on("typing", ({ recipientId }) => {
    const socketId = onlineUsers.get(String(recipientId));
    if (socketId) {
      io.to(socketId).emit("typing", { senderId: socket.user.id });
    }
  });

  socket.on("stopTyping", ({ recipientId }) => {
    const socketId = onlineUsers.get(String(recipientId));
    if (socketId) {
      io.to(socketId).emit("stopTyping", { senderId: socket.user.id });
    }
  });

  socket.on("disconnect", (reason) => {
    onlineUsers.delete(String(socket.user.id));
    io.emit("userStatus", {
      userId: socket.user.id,
      status: "offline",
    });
    console.log(`Disconnected: ${socket.user.email} (${reason})`);
  });
});

/* ------------------ KEEP ALIVE FUNCTION ------------------ */
function keepServerAlive() {
 

  const URL = process.env.RENDER_URL; // e.g. https://your-app.onrender.com

  setInterval(async () => {
    try {
      const res = await axios.get(`${URL}/health`);
      console.log("Keep-alive ping:", res.status);
    } catch (err) {
      console.error("Keep-alive error:", err.message);
    }
  }, 10 * 60 * 1000); // 5 minutes
}

/* ------------------ START SERVER ------------------ */
httpServer.listen(4000, () => {
  console.log("Chat server running on 4000");
  keepServerAlive();
});
