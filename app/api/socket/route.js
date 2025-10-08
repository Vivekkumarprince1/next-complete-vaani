import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import jwt from 'jsonwebtoken';
import handleAudioTranslation from '../../../server/socket/audioHandler';
import handleGroupCallAudioTranslation from '../../../server/socket/groupCallAudioHandler';
import { config as envConfig } from '../../../server/utils/env';

// Store active users and rooms (in production, use Redis or similar)
const users = {};
const rooms = {};

// Global Socket.IO instance
let io;

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Initialize Socket.IO server if not already done
  if (!io) {
    const httpServer = createServer();
    io = new SocketIOServer(httpServer, {
      path: '/api/socket',
      cors: {
        origin: envConfig.ALLOWED_ORIGINS || true,
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      allowUpgrades: true,
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e7,
      perMessageDeflate: false,
      connectTimeout: 30000,
      serveClient: false
    });

    // Authentication middleware
    io.use((socket, next) => {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];

      if (!token) {
        console.error('No token provided for socket connection');
        return next(new Error('Authentication error: No token provided'));
      }

      try {
        const decoded = jwt.verify(token, envConfig.JWT_SECRET);
        socket.user = decoded;
        next();
      } catch (err) {
        console.error('Socket authentication error:', err.message);
        return next(new Error('Authentication error: Invalid token'));
      }
    });

    // Connection handler
    io.on('connection', (socket) => {
      const userId = socket.user.userId;
      const username = socket.user.username || socket.user.user?.username || 'Unknown';

      console.log(`User connected: ${userId}`);

      // Clean up existing connections
      Object.keys(users).forEach(sid => {
        if (users[sid].userId === userId && sid !== socket.id) {
          console.log(`Cleaning up old connection for userId=${userId}`);
          delete users[sid];
        }
      });

      // Store user connection
      users[socket.id] = {
        socketId: socket.id,
        userId: userId,
        username: username,
        status: 'online',
        lastActive: new Date(),
        preferredLanguage: 'en'
      };

      // Broadcast user online status
      socket.broadcast.emit('userStatusChange', {
        userId,
        status: 'online'
      });

      // Initialize handlers
      handleAudioTranslation(io, socket, users);
      handleGroupCallAudioTranslation(io, socket, users);

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log(`User disconnected: ${userId}`);
        if (users[socket.id]) {
          delete users[socket.id];
          socket.broadcast.emit('userStatusChange', {
            userId,
            status: 'offline'
          });
        }
      });

      // Handle language preference updates
      socket.on('updateLanguagePreference', (data) => {
        if (users[socket.id]) {
          users[socket.id].preferredLanguage = data.language;
          console.log(`Updated language preference for user ${userId}: ${data.language}`);
        }
      });
    });

    // Cleanup stale connections
    setInterval(() => {
      Object.keys(users).forEach(socketId => {
        const user = users[socketId];
        const socket = io.sockets.sockets.get(socketId);
        if (!socket) {
          console.log(`Removing stale user: ${socketId}`);
          delete users[socketId];
        }
      });
    }, 5 * 60 * 1000);
  }

  // Handle Socket.IO requests
  if (req.url && req.url.includes('/socket.io')) {
    io.engine.handleRequest(req, res);
  } else {
    res.status(400).json({ error: 'Invalid socket request' });
  }
}