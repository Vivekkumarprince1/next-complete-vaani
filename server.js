const { config: envConfig } = require('./server/utils/env');

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const handleAudioTranslation = require('./server/socket/audioHandler');
const handleGroupCallAudioTranslation = require('./server/socket/groupCallAudioHandler');

// Log to env verify they're loaded
console.log('🔑 Azure Configuration:');
console.log('  AZURE_SPEECH_KEY:', envConfig.AZURE_SPEECH_KEY ? '✅ Loaded' : '❌ Missing');
console.log('  AZURE_SPEECH_REGION:', envConfig.AZURE_SPEECH_REGION || '❌ Missing');
console.log('  AZURE_TRANSLATOR_KEY:', envConfig.AZURE_TRANSLATOR_KEY ? '✅ Loaded' : '❌ Missing');
console.log('  AZURE_TRANSLATOR_REGION:', envConfig.AZURE_TRANSLATOR_REGION || '❌ Missing');
console.log('  JWT_SECRET:', envConfig.JWT_SECRET ? '✅ Loaded' : '❌ Missing');
console.log('  NODE_ENV:', envConfig.NODE_ENV || 'development');
console.log('  PORT:', envConfig.PORT || '3000');
console.log('  ALLOWED_ORIGINS:', envConfig.ALLOWED_ORIGINS || '❌ Missing');



const dev = envConfig.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || envConfig.PORT || '3000', 10);

// Initialize Next.js. Do not force a hostname here so the HTTP server can bind to 0.0.0.0
const app = next({ dev });
const handle = app.getRequestHandler();

// Store active users and their rooms
const users = {}; // Now keyed by socketId for proper audio translation lookup
const rooms = {};

// Helper function to find user by userId
const findUserByUserId = (userId) => {
  return Object.values(users).find(user => user.userId === userId);
};

app.prepare().then(() => {
  // If running on Vercel platform, do not start the custom Node server.
  // Vercel runs Next.js via serverless/edge functions and does not support
  // long-lived socket servers started from within the deployment. In that
  // case, the frontend will be deployed to Vercel and the socket server
  // should be deployed separately (see DEPLOYMENT.md).
  if (process.env.VERCEL && !process.env.FORCE_SOCKET_SERVER) {
    console.log('Detected VERCEL environment; skipping custom server startup.');
    console.log('To run Socket.IO server on Vercel-compatible platform, set FORCE_SOCKET_SERVER=true');
    return;
  }
  const server = createServer();

  const isProduction = envConfig.NODE_ENV === 'production';


  // Initialize Socket.IO with OPTIMIZED settings for low latency
  const io = new Server(server, {
    path: '/socket.io',
    cors: {
      origin: isProduction ? envConfig.ALLOWED_ORIGINS : true, // Allow any origin in development
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
    },

    // ✅ OPTIMIZED: Allow both transports but prefer WebSocket
    transports: ['websocket', 'polling'],
    allowUpgrades: true, // Allow upgrade from polling to WebSocket
    upgradeTimeout: 10000,

    // ✅ OPTIMIZED: Reduce ping intervals for faster connection checks
    pingTimeout: 60000,
    pingInterval: 25000,

    // ✅ OPTIMIZED: Increase buffer for larger audio payloads
    maxHttpBufferSize: 1e7, // 10MB (was 5MB)

    // ✅ OPTIMIZED: Disable compression for speed (trade bandwidth for latency)
    perMessageDeflate: false, // Compression adds latency

    connectTimeout: 30000,
    serveClient: false
  });

  // Expose io globally so Next.js API routes can emit events
  try {
    global.__io = io;
    console.log('Global Socket.IO instance set: global.__io');
  } catch (e) {
    console.warn('Could not set global Socket.IO instance', e);
  }

  // Socket.IO authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) {
      console.error('No token provided for socket connection');
      return next(new Error('Authentication error: No token provided'));
    }

    try {
      const decoded = jwt.verify(token, envConfig.JWT_SECRET);
      socket.user = decoded;
      // console.log('Socket authenticated for user:', decoded.userId);
      next();
    } catch (err) {
      console.error('Socket authentication error:', err.message);
      return next(new Error('Authentication error: Invalid token'));
    }
  });

  // Handle socket connections
  io.on('connection', (socket) => {
    // console.log('New client connected:', socket.id);
    // console.log(`Client transport: ${socket.conn.transport.name}`);

    const userId = socket.user.userId;
    const username = socket.user.username || socket.user.user?.username || 'Unknown';

    // Clean up any existing connections for this userId (handle multiple devices/tabs)
    Object.keys(users).forEach(sid => {
      if (users[sid].userId === userId && sid !== socket.id) {
        console.log(`🧹 Cleaning up old connection for userId=${userId}, oldSocketId=${sid}`);
        delete users[sid];
      }
    });

    // Store user connection - KEY BY SOCKET ID for proper lookup in audio handler
    users[socket.id] = {
      socketId: socket.id,
      userId: userId,
      username: username,
      status: 'online',
      lastActive: new Date(),
      preferredLanguage: 'en' // Default, will be updated by updateLanguagePreference event
    };

    // console.log(`✅ User registered: socketId=${socket.id}, userId=${userId}, username=${username}`);
    // console.log(`📊 Total active users: ${Object.keys(users).length}`);

    // Broadcast user online status
    socket.broadcast.emit('userStatusChange', {
      userId,
      status: 'online'
    });

    // Initialize audio translation handlers
    handleAudioTranslation(io, socket, users);
    handleGroupCallAudioTranslation(io, socket, users);

    // Handle language preference updates
    socket.on('updateLanguagePreference', (data) => {
      const { language } = data;
      if (language && users[socket.id]) {
        users[socket.id].preferredLanguage = language;
        // const username = users[socket.id].username || 'Unknown';
        // console.log(`📝 Updated language preference: socketId=${socket.id}, userId=${userId}, username=${username}, language=${language}`);

        // Log all users and their languages for debugging
        // console.log('📋 All users with languages:', Object.keys(users).map(sid => ({
        //   socketId: sid.substring(0, 8) + '...',
        //   userId: users[sid].userId,
        //   username: users[sid].username,
        //   language: users[sid].preferredLanguage
        // })));

        // Confirm update to client
        socket.emit('languagePreferenceUpdated', {
          language,
          success: true
        });
      }
    });

    // Handle user joining a room
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

    // Handle leaving a room
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

    // Note: disconnect cleanup is handled later in a single consolidated handler
    // to avoid duplicate/conflicting cleanup logic. See the later `socket.on('disconnect')` block.

    // Handle private messages
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
        // Private message
        const receiverUser = findUserByUserId(receiverId);
        if (receiverUser) {
          io.to(receiverUser.socketId).emit('receiveMessage', message);
        }
      } else if (roomId) {
        // Room message
        socket.to(roomId).emit('receiveMessage', message);
      }

      // Send confirmation back to sender
      socket.emit('messageSent', { success: true, message });
    });

    // Handle typing indicator
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

    // WebRTC signaling events
    socket.on('callUser', (data) => {
      const { to, offer, callType, roomId } = data;
      console.log(`📞 Call initiated: from=${userId} to=${to}, callType=${callType}, roomId=${roomId}`);

      if (roomId) {
        // Group call - notify all room members except sender
        socket.to(roomId).emit('incomingCall', {
          from: userId,
          fromName: socket.user.username,
          offer,
          callType,
          roomId
        });
        console.log(`📤 Sent group call notification to room ${roomId}`);
      } else {
        // Private call
        const toUser = findUserByUserId(to);

        if (toUser) {
          // Ensure the socketId is still connected in Socket.IO
          const targetSocket = io.sockets.sockets.get(toUser.socketId);
          if (targetSocket) {
            console.log(`\u2705 Receiver found: socketId=${toUser.socketId}, status=${toUser.status}`);
            // Debug: list active socket ids and verify presence
            try {
              const activeIds = Array.from(io.sockets.sockets.keys());
              console.log('Active socket IDs count:', activeIds.length, 'sample:', activeIds.slice(0, 10));
              console.log('Target socket present via sockets.get:', !!io.sockets.sockets.get(toUser.socketId));
            } catch (dbgErr) {
              console.warn('Error enumerating sockets for debug:', dbgErr);
            }

            io.to(toUser.socketId).emit('incomingCall', {
              from: userId,
              fromName: socket.user.username,
              offer,
              callType
            });
            console.log(`\ud83d\udce4 Sent incomingCall event to ${toUser.socketId}`);
            // Inform caller that the incomingCall was delivered to the target socket
            try {
              socket.emit('incomingCallDelivered', { to, socketId: toUser.socketId });
            } catch (ackErr) {
              console.warn('Failed to emit incomingCallDelivered ack to caller:', ackErr);
            }
          } else {
            // Stale entry -- remove it so future lookups won't return this socket
            console.log(`\u274c Receiver socket not connected for userId: ${to} (stale socketId=${toUser.socketId}). Removing stale entry.`);
            delete users[toUser.socketId];
            // Inform caller that the user is unavailable (client may handle this)
            socket.emit('userUnavailable', { to });
          }
        } else {
          console.log(`\u274c Receiver not found for userId: ${to}`);
          console.log(`\ud83d\udcca Available users:`, Object.keys(users).map(sid => ({
            socketId: sid,
            userId: users[sid].userId,
            status: users[sid].status
          })));
        }
      }
    });

    socket.on('answerCall', (data) => {
      const { to, answer, roomId } = data;

      if (roomId) {
        // Group call answer - broadcast to room
        socket.to(roomId).emit('callAnswered', {
          from: userId,
          answer,
          roomId
        });
      } else {
        // Private call answer
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
        // Group call ICE candidate - broadcast to room
        socket.to(roomId).emit('iceCandidate', {
          from: userId,
          candidate,
          roomId
        });
      } else {
        // Private call ICE candidate
        const toUser = findUserByUserId(to);

        if (toUser) {
          io.to(toUser.socketId).emit('iceCandidate', {
            from: userId,
            candidate
          });
        }
      }
    });

    // App-level ACK: callee notifies server that their UI received the incoming call
    socket.on('incomingCallAck', (data) => {
      try {
        const { from, to, callSessionId } = data; // from = original caller userId
        console.log(`📥 incomingCallAck received from socket=${socket.id} for caller userId=${from}`);
        const callerUser = findUserByUserId(from);
        if (callerUser) {
          io.to(callerUser.socketId).emit('incomingCallAck', { from: socket.user.userId, callSessionId });
        }
      } catch (e) {
        console.warn('Error handling incomingCallAck:', e);
      }
    });

    socket.on('endCall', (data) => {
      const { to, roomId } = data;

      if (roomId) {
        // Group call end - notify room
        socket.to(roomId).emit('callEnded', {
          from: userId,
          roomId
        });
      } else {
        // Private call end
        const toUser = findUserByUserId(to);

        if (toUser) {
          io.to(toUser.socketId).emit('callEnded', {
            from: userId
          });
        }
      }
    });

    // ==================== GROUP CALL SIGNALING ====================

    // Join group call room
    socket.on('joinGroupCall', (data) => {
      const { callRoomId, userId: joinUserId } = data;
      console.log(`👥 User ${joinUserId || userId} joining group call room: ${callRoomId}`);

      socket.join(callRoomId);

      // Notify others in the call room
      socket.to(callRoomId).emit('userJoinedGroupCall', {
        userId: joinUserId || userId,
        username: socket.user.username,
        socketId: socket.id
      });

      // Send back list of existing participants
      io.in(callRoomId).allSockets().then(sockets => {
        const participants = Array.from(sockets)
          .filter(sid => sid !== socket.id)
          .map(sid => ({
            socketId: sid,
            userId: users[sid]?.userId,
            username: users[sid]?.username
          }))
          .filter(p => p.userId); // Remove any undefined users

        socket.emit('existingParticipants', {
          callRoomId,
          participants
        });
      });
    });

    // Leave group call room
    socket.on('leaveGroupCall', (data) => {
      const { callRoomId } = data;
      console.log(`👥 User ${userId} leaving group call room: ${callRoomId}`);

      socket.leave(callRoomId);

      // Notify others in the call room
      socket.to(callRoomId).emit('userLeftGroupCall', {
        userId,
        username: socket.user.username,
        socketId: socket.id
      });
    });

    // Group call offer (mesh topology - each peer connects to all others)
    socket.on('groupCallOffer', (data) => {
      const { callRoomId, targetSocketId, offer } = data;
      console.log(`📞 Group call offer: from=${socket.id} to=${targetSocketId}`);

      io.to(targetSocketId).emit('groupCallOffer', {
        fromSocketId: socket.id,
        fromUserId: userId,
        fromUsername: socket.user.username,
        offer,
        callRoomId
      });
    });

    // Group call answer
    socket.on('groupCallAnswer', (data) => {
      const { callRoomId, targetSocketId, answer } = data;
      console.log(`✅ Group call answer: from=${socket.id} to=${targetSocketId}`);

      io.to(targetSocketId).emit('groupCallAnswer', {
        fromSocketId: socket.id,
        fromUserId: userId,
        fromUsername: socket.user.username,
        answer,
        callRoomId
      });
    });

    // Group call ICE candidate
    socket.on('groupCallIceCandidate', (data) => {
      const { callRoomId, targetSocketId, candidate } = data;

      io.to(targetSocketId).emit('groupCallIceCandidate', {
        fromSocketId: socket.id,
        fromUserId: userId,
        candidate,
        callRoomId
      });
    });

    // Group call speaking event (for translation/transcription)
    socket.on('groupCallSpeaking', (data) => {
      const { callRoomId, isSpeaking } = data;

      socket.to(callRoomId).emit('participantSpeaking', {
        userId,
        username: socket.user.username,
        isSpeaking
      });
    });

    // ==================== END GROUP CALL SIGNALING ====================

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);

      const user = users[socket.id];
      if (user) {
        const userId = user.userId;
        user.status = 'offline';
        user.lastActive = new Date();

        // Broadcast user offline status
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

        // Remove user from all rooms
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

    // Error handling - avoid noisy logs for empty payloads and show stack traces when available
    const handleSocketErrorServer = (error) => {
      try {
        if (!error || (typeof error === 'object' && Object.keys(error).length === 0)) {
          console.debug(`Socket error event on server for socket ${socket.id} but no payload (likely non-fatal)`);
          return;
        }

        if (error instanceof Error) {
          console.error(`Socket error on server for socket ${socket.id}:`, error.stack || error.message);
          return;
        }

        if (typeof error === 'string') {
          console.error(`Socket error on server for socket ${socket.id}:`, error);
          return;
        }

        try {
          console.error(`Socket error on server for socket ${socket.id}:`, JSON.stringify(error));
        } catch (serErr) {
          console.error(`Socket error on server for socket ${socket.id} (non-serializable payload):`, error);
        }
      } catch (handlerErr) {
        console.error('Unexpected error in server socket error handler:', handlerErr);
      }
    };

    socket.on('error', handleSocketErrorServer);
  });

  // Handle Next.js requests
  server.on('request', async (req, res) => {
    // Let Socket.IO handle its own requests
    if (req.url && req.url.startsWith('/socket.io')) {
      return;
    }
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Cleanup stale connections every 5 minutes
  setInterval(() => {
    console.log('Cleaning up stale connections');
    Object.keys(users).forEach(socketId => {
      const user = users[socketId];
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) {
        console.log(`Removing stale user: socketId=${socketId}, userId=${user?.userId}`);
        delete users[socketId];
      }
    });
  }, 5 * 60 * 1000);

  server.listen(port, '0.0.0.0', (err) => {
    if (err) throw err;
    console.log(`> Ready on 0.0.0.0:${port}`);
    console.log(`> Socket.IO server initialized`);
  });
});
