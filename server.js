const { config: envConfig } = require('./server/utils/env');

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const handleAudioTranslation = require('./server/socket/audioHandler');
const handleGroupCallAudioTranslation = require('./server/socket/groupCallAudioHandler');

// Check if we should run as standalone Socket.IO server
const forceSocketServer = process.env.FORCE_SOCKET_SERVER === 'true';

// Log environment configuration
console.log('🔑 Azure Configuration:');
console.log('  AZURE_SPEECH_KEY:', envConfig.AZURE_SPEECH_KEY ? '✅ Loaded' : '❌ Missing');
console.log('  AZURE_SPEECH_REGION:', envConfig.AZURE_SPEECH_REGION || '❌ Missing');
console.log('  AZURE_TRANSLATOR_KEY:', envConfig.AZURE_TRANSLATOR_KEY ? '✅ Loaded' : '❌ Missing');
console.log('  AZURE_TRANSLATOR_REGION:', envConfig.AZURE_TRANSLATOR_REGION || '❌ Missing');
console.log('  JWT_SECRET:', envConfig.JWT_SECRET ? '✅ Loaded' : '❌ Missing');
console.log('  NODE_ENV:', envConfig.NODE_ENV || 'development');
console.log('  PORT:', envConfig.PORT || '3000');
console.log('  ALLOWED_ORIGINS:', envConfig.ALLOWED_ORIGINS || '❌ Missing');
console.log('  FORCE_SOCKET_SERVER:', forceSocketServer ? '✅ Enabled' : '❌ Disabled');

const dev = envConfig.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || envConfig.PORT || '3000', 10);

// Initialize Next.js only if not running as standalone Socket.IO server
const app = forceSocketServer ? null : next({ dev });
const handle = forceSocketServer ? null : app?.getRequestHandler();

// Store active users and rooms
const users = {};
const rooms = {};

// Helper function to find user by userId
const findUserByUserId = (userId) => {
  return Object.values(users).find(user => user.userId === userId);
};

// Global variables for singleton pattern
let httpServer;
let ioInstance;
let isInitialized = false;

// Initialize server (singleton pattern for serverless)
const initializeServer = async () => {
  if (isInitialized) {
    return { server: httpServer, io: ioInstance };
  }

  if (!forceSocketServer) {
    await app.prepare();
  }

  // Create HTTP server
  httpServer = createServer(async (req, res) => {
    if (req.url && req.url.startsWith('/socket.io')) {
      return; // Let Socket.IO handle this
    }
    
    if (!forceSocketServer) {
      try {
        const parsedUrl = parse(req.url, true);
        await handle(req, res, parsedUrl);
      } catch (err) {
        console.error('Error occurred handling', req.url, err);
        res.statusCode = 500;
        res.end('internal server error');
      }
    } else {
      // Standalone Socket.IO server - return 404 for non-Socket.IO requests
      res.statusCode = 404;
      res.end('Not found');
    }
  });

  const isProduction = envConfig.NODE_ENV === 'production';

  // Initialize Socket.IO with optimized settings
  ioInstance = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: isProduction ? envConfig.ALLOWED_ORIGINS : true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
    },
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    upgradeTimeout: 10000,
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e7, // 10MB
    perMessageDeflate: false,
    connectTimeout: 30000,
    serveClient: false
  });

  // Expose io globally for Next.js API routes
  global.__io = ioInstance;
  console.log('✅ Global Socket.IO instance set: global.__io');

  // Socket.IO authentication middleware
  ioInstance.use((socket, next) => {
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

  // Setup socket event handlers
  setupSocketHandlers(ioInstance);

  // Cleanup stale connections every 5 minutes
  setInterval(() => {
    console.log('🧹 Cleaning up stale connections');
    Object.keys(users).forEach(socketId => {
      const user = users[socketId];
      const socket = ioInstance.sockets.sockets.get(socketId);
      if (!socket) {
        console.log(`Removing stale user: socketId=${socketId}, userId=${user?.userId}`);
        delete users[socketId];
      }
    });
  }, 5 * 60 * 1000);

  isInitialized = true;
  return { server: httpServer, io: ioInstance };
};

// Setup all socket event handlers
const setupSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    const userId = socket.user.userId;
    const username = socket.user.username || socket.user.user?.username || 'Unknown';

    // Clean up existing connections for this userId
    Object.keys(users).forEach(sid => {
      if (users[sid].userId === userId && sid !== socket.id) {
        console.log(`🧹 Cleaning up old connection for userId=${userId}, oldSocketId=${sid}`);
        delete users[sid];
      }
    });

    // Register user connection
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

    // Initialize audio translation handlers
    handleAudioTranslation(io, socket, users);
    handleGroupCallAudioTranslation(io, socket, users);

    // Language preference updates
    socket.on('updateLanguagePreference', (data) => {
      const { language } = data;
      if (language && users[socket.id]) {
        users[socket.id].preferredLanguage = language;
        socket.emit('languagePreferenceUpdated', {
          language,
          success: true
        });
      }
    });

    // Room management
    socket.on('joinRoom', (roomId) => {
      socket.join(roomId);
      console.log(`User ${userId} joined room ${roomId}`);

      if (!rooms[roomId]) {
        rooms[roomId] = new Set();
      }
      rooms[roomId].add(userId);

      socket.to(roomId).emit('userJoinedRoom', {
        userId,
        username: socket.user.username,
        roomId
      });
    });

    socket.on('leaveRoom', (roomId) => {
      socket.leave(roomId);
      console.log(`User ${userId} left room ${roomId}`);

      if (rooms[roomId]) {
        rooms[roomId].delete(userId);
        if (rooms[roomId].size === 0) {
          delete rooms[roomId];
        }
      }

      socket.to(roomId).emit('userLeftRoom', {
        userId,
        username: socket.user.username,
        roomId
      });
    });

    // Messaging
    socket.on('sendMessage', async (data) => {
      const { receiverId, content, roomId } = data;

      const message = {
        senderId: userId,
        senderName: socket.user.username,
        content,
        timestamp: new Date(),
        roomId
      };

      if (receiverId) {
        const receiverUser = findUserByUserId(receiverId);
        if (receiverUser) {
          io.to(receiverUser.socketId).emit('receiveMessage', message);
        }
      } else if (roomId) {
        socket.to(roomId).emit('receiveMessage', message);
      }

      socket.emit('messageSent', { success: true, message });
    });

    // Typing indicator
    socket.on('typing', (data) => {
      const { receiverId, roomId, isTyping } = data;

      if (receiverId) {
        const receiverUser = findUserByUserId(receiverId);
        if (receiverUser) {
          io.to(receiverUser.socketId).emit('userTyping', {
            userId,
            username: socket.user.username,
            isTyping
          });
        }
      } else if (roomId) {
        socket.to(roomId).emit('userTyping', {
          userId,
          username: socket.user.username,
          isTyping
        });
      }
    });

    // WebRTC signaling - Call User
    socket.on('callUser', (data) => {
      const { to, offer, callType, roomId } = data;
      console.log(`📞 Call initiated: from=${userId} to=${to}, callType=${callType}, roomId=${roomId}`);

      if (roomId) {
        socket.to(roomId).emit('incomingCall', {
          from: userId,
          fromName: socket.user.username,
          offer,
          callType,
          roomId
        });
        console.log(`📤 Sent group call notification to room ${roomId}`);
      } else {
        const toUser = findUserByUserId(to);
        if (toUser) {
          const targetSocket = io.sockets.sockets.get(toUser.socketId);
          if (targetSocket) {
            io.to(toUser.socketId).emit('incomingCall', {
              from: userId,
              fromName: socket.user.username,
              offer,
              callType
            });
            socket.emit('incomingCallDelivered', { to, socketId: toUser.socketId });
          } else {
            console.log(`❌ Receiver socket not connected for userId: ${to}`);
            delete users[toUser.socketId];
            socket.emit('userUnavailable', { to });
          }
        } else {
          console.log(`❌ Receiver not found for userId: ${to}`);
        }
      }
    });

    socket.on('answerCall', (data) => {
      const { to, answer, roomId } = data;

      if (roomId) {
        socket.to(roomId).emit('callAnswered', {
          from: userId,
          answer,
          roomId
        });
      } else {
        const toUser = findUserByUserId(to);
        if (toUser) {
          io.to(toUser.socketId).emit('callAnswered', {
            from: userId,
            answer
          });
        }
      }
    });

    socket.on('iceCandidate', (data) => {
      const { to, candidate, roomId } = data;

      if (roomId) {
        socket.to(roomId).emit('iceCandidate', {
          from: userId,
          candidate,
          roomId
        });
      } else {
        const toUser = findUserByUserId(to);
        if (toUser) {
          io.to(toUser.socketId).emit('iceCandidate', {
            from: userId,
            candidate
          });
        }
      }
    });

    socket.on('incomingCallAck', (data) => {
      const { from, callSessionId } = data;
      const callerUser = findUserByUserId(from);
      if (callerUser) {
        io.to(callerUser.socketId).emit('incomingCallAck', { 
          from: socket.user.userId, 
          callSessionId 
        });
      }
    });

    socket.on('endCall', (data) => {
      const { to, roomId } = data;

      if (roomId) {
        socket.to(roomId).emit('callEnded', {
          from: userId,
          roomId
        });
      } else {
        const toUser = findUserByUserId(to);
        if (toUser) {
          io.to(toUser.socketId).emit('callEnded', {
            from: userId
          });
        }
      }
    });

    // Group call signaling
    socket.on('joinGroupCall', (data) => {
      const { callRoomId, userId: joinUserId } = data;
      console.log(`👥 User ${joinUserId || userId} joining group call room: ${callRoomId}`);

      socket.join(callRoomId);

      socket.to(callRoomId).emit('userJoinedGroupCall', {
        userId: joinUserId || userId,
        username: socket.user.username,
        socketId: socket.id
      });

      io.in(callRoomId).allSockets().then(sockets => {
        const participants = Array.from(sockets)
          .filter(sid => sid !== socket.id)
          .map(sid => ({
            socketId: sid,
            userId: users[sid]?.userId,
            username: users[sid]?.username
          }))
          .filter(p => p.userId);

        socket.emit('existingParticipants', {
          callRoomId,
          participants
        });
      });
    });

    socket.on('leaveGroupCall', (data) => {
      const { callRoomId } = data;
      console.log(`👥 User ${userId} leaving group call room: ${callRoomId}`);

      socket.leave(callRoomId);

      socket.to(callRoomId).emit('userLeftGroupCall', {
        userId,
        username: socket.user.username,
        socketId: socket.id
      });
    });

    socket.on('groupCallOffer', (data) => {
      const { targetSocketId, offer, callRoomId } = data;
      io.to(targetSocketId).emit('groupCallOffer', {
        fromSocketId: socket.id,
        fromUserId: userId,
        fromUsername: socket.user.username,
        offer,
        callRoomId
      });
    });

    socket.on('groupCallAnswer', (data) => {
      const { targetSocketId, answer, callRoomId } = data;
      io.to(targetSocketId).emit('groupCallAnswer', {
        fromSocketId: socket.id,
        fromUserId: userId,
        fromUsername: socket.user.username,
        answer,
        callRoomId
      });
    });

    socket.on('groupCallIceCandidate', (data) => {
      const { targetSocketId, candidate, callRoomId } = data;
      io.to(targetSocketId).emit('groupCallIceCandidate', {
        fromSocketId: socket.id,
        fromUserId: userId,
        candidate,
        callRoomId
      });
    });

    socket.on('groupCallSpeaking', (data) => {
      const { callRoomId, isSpeaking } = data;
      socket.to(callRoomId).emit('participantSpeaking', {
        userId,
        username: socket.user.username,
        isSpeaking
      });
    });

    // Disconnect handler
    socket.on('disconnect', () => {
      console.log(`User disconnected: socketId=${socket.id}, userId=${userId}`);
      
      if (users[socket.id]) {
        users[socket.id].status = 'offline';
        users[socket.id].lastActive = new Date();

        socket.broadcast.emit('userStatusChange', {
          userId,
          status: 'offline'
        });

        // Clean up after 5 minutes
        setTimeout(() => {
          if (users[socket.id]?.status === 'offline') {
            delete users[socket.id];
          }
        }, 5 * 60 * 1000);

        // Remove from rooms
        Object.keys(rooms).forEach(roomId => {
          if (rooms[roomId]?.has(userId)) {
            rooms[roomId].delete(userId);
            if (rooms[roomId].size === 0) {
              delete rooms[roomId];
            }
          }
        });
      }
    });

    // Error handling
    socket.on('error', (error) => {
      if (!error || (typeof error === 'object' && Object.keys(error).length === 0)) {
        return;
      }
      console.error(`Socket error for ${socket.id}:`, error.stack || error.message || error);
    });
  });
};

// Export handler for Vercel serverless
module.exports = async (req, res) => {
  try {
    const { server } = await initializeServer();

    if (req.url && req.url.startsWith('/socket.io')) {
      // Handle Socket.IO requests
      server.emit('request', req, res);
    } else {
      // Handle Next.js requests
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    }
  } catch (err) {
    console.error('Server error:', err);
    res.statusCode = 500;
    res.end('Internal server error');
  }
};

// For local development
if (require.main === module) {
  initializeServer().then(({ server }) => {
    server.listen(port, '0.0.0.0', (err) => {
      if (err) throw err;
      console.log(`> Ready on 0.0.0.0:${port}`);
      console.log(`> Socket.IO server initialized`);
    });
  });
}