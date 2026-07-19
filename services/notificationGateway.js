const socketIo = require("socket.io");
const jwt = require("jsonwebtoken");

class NotificationGateway {
  constructor(server) {
    this.io = socketIo(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:5173",
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    global.io = this.io;

    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error("Authentication error"));

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.id;
        socket.role = decoded.role;
        next();
      } catch (err) {
        next(new Error("Authentication error"));
      }
    });

    this.io.on("connection", (socket) => {
      socket.join(socket.userId);

      if (socket.role === "admin") {
        socket.join("admin:notifications");
      }

      socket.on("chat:join", ({ chatId }) => {
        const room = `chat:${chatId}`;
        socket.join(room);
        console.log(`Socket ${socket.id} (User: ${socket.userId}) joined room ${room}`);
      });

      socket.on("chat:leave", ({ chatId }) => {
        const room = `chat:${chatId}`;
        socket.leave(room);
        console.log(`Socket ${socket.id} (User: ${socket.userId}) left room ${room}`);
      });

      socket.on("chat:typing", ({ chatId, isTyping }) => {
        socket.to(`chat:${chatId}`).emit("chat:typing:status", {
          chatId,
          isTyping,
          userId: socket.userId,
          userRole: socket.role,
        });
      });

      socket.on("chat:read", ({ chatId }) => {
        socket.to(`chat:${chatId}`).emit("chat:messages:read", {
          chatId,
          readerId: socket.userId,
          readerRole: socket.role,
        });
      });

      socket.on("disconnect", () => { });
    });
  }

  getActiveUserCount() {
    return this.io.engine.clientsCount;
  }

  broadcastHeartbeat() {
    this.io.emit("heartbeat", { timestamp: new Date() });
  }

  cleanupStaleConnections() {
  }

  async close() {
    await this.io.close();
  }
}

module.exports = NotificationGateway;
