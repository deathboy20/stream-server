import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const server = createServer(app);

// Get allowed origins from environment
const getAllowedOrigins = () => {
  const envOrigins = process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000';
  return envOrigins.split(',').map(origin => origin.trim());
};

const allowedOrigins = getAllowedOrigins();

// Configure CORS for Express
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());

// Configure Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// In-memory storage for sessions and rooms
const sessions = new Map();
const rooms = new Map();
const userSessions = new Map();
const chatMessages = new Map(); // Store chat messages by sessionId
const users = new Map(); // Store active users

// JWT secret for token generation
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Session management class
class VideoSession {
  constructor(sessionId, creatorSocketId, sessionData = {}) {
    this.sessionId = sessionId;
    this.creatorSocketId = creatorSocketId;
    this.participants = new Map();
    this.isActive = true;
    this.createdAt = new Date(sessionData.createdAt) || new Date();
    this.screenShareActive = false;
    this.screenShareSocketId = null;
    
    // Store session metadata
    this.isMultiSource = sessionData.isMultiSource || false;
    this.sourceCount = sessionData.sourceCount || 1;
    this.layout = sessionData.layout || 'single';
    this.sourceIds = sessionData.sourceIds || [];
    this.title = sessionData.title || `Stream ${new Date().toLocaleString()}`;
    this.userId = sessionData.userId || 'anonymous';
    this.lastUpdate = new Date().toISOString();
    this.currentSource = null;
    
    // Store latest WebRTC offer for late-joining viewers
    this.latestOffer = null;
  }
  
  updateMetadata(updates) {
    if (updates.isMultiSource !== undefined) this.isMultiSource = updates.isMultiSource;
    if (updates.sourceCount !== undefined) this.sourceCount = updates.sourceCount;
    if (updates.layout !== undefined) this.layout = updates.layout;
    if (updates.sourceIds !== undefined) this.sourceIds = updates.sourceIds;
    if (updates.title !== undefined) this.title = updates.title;
    if (updates.currentSource !== undefined) this.currentSource = updates.currentSource;
    if (updates.isActive !== undefined) this.isActive = updates.isActive;
    this.lastUpdate = new Date().toISOString();
  }
  
  setLatestOffer(offer) {
    this.latestOffer = offer;
  }
  
  getMetadata() {
    return {
      sessionId: this.sessionId,
      isActive: this.isActive,
      isMultiSource: this.isMultiSource,
      sourceCount: this.sourceCount,
      layout: this.layout,
      sourceIds: this.sourceIds,
      title: this.title,
      userId: this.userId,
      createdAt: this.createdAt,
      lastUpdate: this.lastUpdate,
      currentSource: this.currentSource,
      participantCount: this.participants.size,
      screenShareActive: this.screenShareActive
    };
  }

  addParticipant(socketId, isCreator = false, deviceType = 'webcam') {
    this.participants.set(socketId, {
      socketId,
      isCreator,
      deviceType,
      joinedAt: new Date(),
      isScreenSharing: false
    });
  }

  removeParticipant(socketId) {
    this.participants.delete(socketId);
    if (this.screenShareSocketId === socketId) {
      this.screenShareActive = false;
      this.screenShareSocketId = null;
    }
  }

  getParticipants() {
    return Array.from(this.participants.values());
  }

  setScreenShare(socketId, isActive) {
    if (isActive) {
      this.screenShareActive = true;
      this.screenShareSocketId = socketId;
      const participant = this.participants.get(socketId);
      if (participant) {
        participant.isScreenSharing = true;
      }
    } else {
      this.screenShareActive = false;
      this.screenShareSocketId = null;
      const participant = this.participants.get(socketId);
      if (participant) {
        participant.isScreenSharing = false;
      }
    }
  }
}

// Generate token for session authentication
function generateToken(sessionId, socketId, isCreator = false) {
  const payload = {
    sessionId,
    socketId,
    isCreator,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24 hours
  };
  return jwt.sign(payload, JWT_SECRET);
}

// Verify token
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// REST API endpoints
app.post('/api/sessions', (req, res) => {
  const sessionId = uuidv4();
  const token = generateToken(sessionId, null, true);
  
  res.json({
    sessionId,
    token,
    shareUrl: `${req.protocol}://${req.get('host')}/shared-stream/${sessionId}`
  });
});

app.post('/api/sessions/:sessionId/token', (req, res) => {
  const { sessionId } = req.params;
  const { isViewer = true } = req.body;
  
  if (!sessions.has(sessionId)) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const token = generateToken(sessionId, null, !isViewer);
  res.json({ token, sessionId });
});

app.get('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({
    sessionId: session.sessionId,
    isActive: session.isActive,
    participantCount: session.participants.size,
    createdAt: session.createdAt,
    screenShareActive: session.screenShareActive
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Store socket reference
  userSessions.set(socket.id, { socket, sessionId: null });

  // Handle session creation - accepts sessionData or callback
  socket.on('create-session', (sessionDataOrCallback, callback) => {
    let sessionData = {};
    let actualCallback = callback;
    
    // Handle both signatures: (sessionData, callback) or just (callback)
    if (typeof sessionDataOrCallback === 'function') {
      actualCallback = sessionDataOrCallback;
      sessionData = {};
    } else {
      sessionData = sessionDataOrCallback || {};
    }
    
    // Use provided sessionId or generate new one
    const sessionId = sessionData.sessionId || uuidv4();
    
    // Check if session already exists
    if (sessions.has(sessionId)) {
      const existingSession = sessions.get(sessionId);
      const userSession = userSessions.get(socket.id);
      if (userSession) {
        userSession.sessionId = sessionId;
      }
      
      console.log(`Session already exists: ${sessionId}, reusing`);
      
      if (actualCallback) {
        const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
        actualCallback({
          success: true,
          sessionId,
          token: generateToken(sessionId, socket.id, true),
          shareUrl: `${clientUrl}/watch/${sessionId}`
        });
      }
      return;
    }
    
    const session = new VideoSession(sessionId, socket.id, sessionData);
    sessions.set(sessionId, session);
    
    // Join the socket to the session room
    socket.join(sessionId);
    session.addParticipant(socket.id, true);
    
    // Update user session
    const userSession = userSessions.get(socket.id);
    if (userSession) {
      userSession.sessionId = sessionId;
    }
    
    const token = generateToken(sessionId, socket.id, true);
    
    console.log(`Session created: ${sessionId} by ${socket.id}`, sessionData);
    
    // Broadcast session update to all participants
    io.to(sessionId).emit('session-update', session.getMetadata());
    
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    
    if (actualCallback) {
      actualCallback({
        success: true,
        sessionId,
        token,
        shareUrl: `${clientUrl}/watch/${sessionId}`
      });
    }
  });

  // Handle joining existing session
  socket.on('join-session', ({ sessionId, token, isViewer = true, deviceType = 'webcam' }, callback) => {
    // Handle both short and full UUID session IDs
    let session = sessions.get(sessionId);
    let actualSessionId = sessionId;
    
    // If not found with exact match, try to find by short ID (first 8-12 chars)
    if (!session && sessionId.length >= 8 && sessionId.length < 36) {
      for (const [fullSessionId, sessionData] of sessions) {
        const shortId = fullSessionId.replace(/-/g, '').substring(0, sessionId.length);
        if (shortId === sessionId) {
          session = sessionData;
          actualSessionId = fullSessionId;
          console.log(`Matched short session ID ${sessionId} to full ID ${fullSessionId}`);
          break;
        }
      }
    }
    
    if (!session) {
      if (callback) {
        callback({ success: false, error: 'Session not found' });
      }
      // Emit session-update with null to indicate session doesn't exist
      socket.emit('session-update', null);
      return;
    }
    
    // Verify token if provided
    if (token) {
      const decoded = verifyToken(token);
      if (!decoded || decoded.sessionId !== actualSessionId) {
        if (callback) {
          callback({ success: false, error: 'Invalid token' });
        }
        return;
      }
    }
    
    // Join the session using the actual session ID
    socket.join(actualSessionId);
    session.addParticipant(socket.id, !isViewer, deviceType);
    
    // Update user session
    const userSession = userSessions.get(socket.id);
    if (userSession) {
      userSession.sessionId = actualSessionId;
    }
    
    console.log(`${socket.id} joined session: ${actualSessionId} as ${isViewer ? 'viewer' : 'creator'}`);
    
    // Send current session metadata to the joining user
    socket.emit('session-update', session.getMetadata());
    
    // If there's an active stream with a pending offer, send it to the new viewer
    if (isViewer && session.latestOffer && session.isActive) {
      console.log(`Sending stored offer to new viewer ${socket.id} in session ${actualSessionId}`, {
        hasOffer: !!session.latestOffer,
        offerType: session.latestOffer?.type,
        sessionActive: session.isActive
      });
      // Use setTimeout to ensure the client's listeners are fully set up
      setTimeout(() => {
        socket.emit('webrtc-offer', {
          sessionId: actualSessionId,
          offer: session.latestOffer
        });
        console.log(`Offer sent to viewer ${socket.id}`);
      }, 100);
    } else if (isViewer) {
      console.log(`No offer to send to viewer ${socket.id}:`, {
        hasOffer: !!session.latestOffer,
        sessionActive: session.isActive,
        isViewer: isViewer
      });
    }
    
    // Notify other participants
    socket.to(actualSessionId).emit('participant-joined', {
      socketId: socket.id,
      isViewer,
      deviceType,
      participantCount: session.participants.size
    });
    
    if (callback) {
      callback({
        success: true,
        sessionId: actualSessionId,
        participants: session.getParticipants(),
        screenShareActive: session.screenShareActive,
        screenShareSocketId: session.screenShareSocketId,
        sessionData: session.getMetadata()
      });
    }
  });

  // WebRTC Signaling - Direct peer-to-peer
  socket.on('offer', ({ sessionId, targetSocketId, offer }) => {
    console.log(`Offer from ${socket.id} to ${targetSocketId} in session ${sessionId}`);
    socket.to(targetSocketId).emit('offer', {
      fromSocketId: socket.id,
      offer
    });
  });

  socket.on('answer', ({ sessionId, targetSocketId, answer }) => {
    console.log(`Answer from ${socket.id} to ${targetSocketId} in session ${sessionId}`);
    socket.to(targetSocketId).emit('answer', {
      fromSocketId: socket.id,
      answer
    });
  });

  socket.on('ice-candidate', ({ sessionId, targetSocketId, candidate, role }) => {
    console.log(`ICE candidate from ${socket.id} to ${targetSocketId || 'all'} in session ${sessionId}`);
    
    const session = sessions.get(sessionId);
    if (!session) {
      console.error(`Session ${sessionId} not found for ICE candidate`);
      return;
    }
    
    if (targetSocketId && targetSocketId !== 'host') {
      // Send to specific socket
      socket.to(targetSocketId).emit('ice-candidate', {
        fromSocketId: socket.id,
        candidate
      });
    } else if (targetSocketId === 'host' || role === 'viewer') {
      // Viewer sending to host - send to creator
      if (session.creatorSocketId && session.creatorSocketId !== socket.id) {
        socket.to(session.creatorSocketId).emit('ice-candidate', {
          fromSocketId: socket.id,
          candidate
        });
      }
    } else {
      // Host/creator sending - broadcast to all viewers in the session
      socket.to(sessionId).emit('ice-candidate', {
        fromSocketId: socket.id,
        candidate
      });
    }
  });

  // WebRTC Signaling - Session-based (for StreamPage/WatchPage)
  socket.on('webrtc-offer', ({ sessionId, offer }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      console.error(`Session ${sessionId} not found for WebRTC offer`);
      return;
    }
    
    console.log(`WebRTC offer from ${socket.id} in session ${sessionId}`);
    
    // Store the latest offer for late-joining viewers
    session.setLatestOffer(offer);
    
    // Broadcast offer to all viewers in the session (except the sender)
    socket.to(sessionId).emit('webrtc-offer', {
      sessionId,
      offer
    });
  });

  socket.on('webrtc-answer', ({ sessionId, answer }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      console.error(`Session ${sessionId} not found for WebRTC answer`);
      return;
    }
    
    console.log(`WebRTC answer from ${socket.id} in session ${sessionId}`);
    
    // Send answer to the creator (host) of the session
    const creatorSocketId = session.creatorSocketId;
    if (creatorSocketId && creatorSocketId !== socket.id) {
      socket.to(creatorSocketId).emit('webrtc-answer', answer);
    } else {
      // Fallback: broadcast to all in session if creator not available
      socket.to(sessionId).emit('webrtc-answer', answer);
    }
  });

  // Screen sharing events
  socket.on('start-screen-share', ({ sessionId }, callback) => {
    const session = sessions.get(sessionId);
    if (!session) {
      if (callback) callback({ success: false, error: 'Session not found' });
      return;
    }

    // Check if someone else is already screen sharing
    if (session.screenShareActive && session.screenShareSocketId !== socket.id) {
      if (callback) callback({ success: false, error: 'Screen sharing already active by another user' });
      return;
    }

    session.setScreenShare(socket.id, true);
    
    // Notify all participants
    socket.to(sessionId).emit('screen-share-started', {
      socketId: socket.id
    });

    console.log(`Screen sharing started by ${socket.id} in session ${sessionId}`);
    
    if (callback) {
      callback({ success: true });
    }
  });

  socket.on('stop-screen-share', ({ sessionId }) => {
    const session = sessions.get(sessionId);
    if (!session) return;

    session.setScreenShare(socket.id, false);
    
    // Notify all participants
    socket.to(sessionId).emit('screen-share-stopped', {
      socketId: socket.id
    });

    console.log(`Screen sharing stopped by ${socket.id} in session ${sessionId}`);
  });

  // Handle stream events
  socket.on('stream-started', ({ sessionId, streamType = 'camera' }) => {
    const session = sessions.get(sessionId);
    if (!session) return;

    socket.to(sessionId).emit('stream-started', {
      socketId: socket.id,
      streamType
    });
  });

  socket.on('stream-stopped', ({ sessionId }) => {
    const session = sessions.get(sessionId);
    if (!session) return;

    socket.to(sessionId).emit('stream-stopped', {
      socketId: socket.id
    });
  });

  // Analytics and diagnostics
  socket.on('analytics-data', ({ sessionId, data }) => {
    const session = sessions.get(sessionId);
    if (!session) return;

    // Broadcast analytics data to other participants (for monitoring)
    socket.to(sessionId).emit('analytics-update', {
      socketId: socket.id,
      data
    });
  });

  // Chat functionality
  socket.on('join-chat', ({ sessionId, userId, userName, avatar }) => {
    if (!chatMessages.has(sessionId)) {
      chatMessages.set(sessionId, []);
    }
    
    // Store user info
    users.set(socket.id, { userId, userName, avatar, sessionId, connectedAt: new Date() });
    
    // Send chat history to the new user
    const messages = chatMessages.get(sessionId) || [];
    socket.emit('chat-history', { messages });
    
    // Notify others that user joined chat
    socket.to(sessionId).emit('user-joined-chat', { userId, userName, avatar });
  });

  socket.on('chat-message', ({ sessionId, userId, userName, avatar, content, type = 'text' }) => {
    const session = sessions.get(sessionId);
    if (!session) return;

    const message = {
      id: uuidv4(),
      userId,
      userName,
      avatar,
      content,
      type,
      timestamp: new Date(),
      socketId: socket.id
    };

    // Store the message
    if (!chatMessages.has(sessionId)) {
      chatMessages.set(sessionId, []);
    }
    const messages = chatMessages.get(sessionId);
    messages.push(message);
    
    // Keep only last 100 messages per session
    if (messages.length > 100) {
      messages.shift();
    }

    // Broadcast message to all participants in the session
    io.to(sessionId).emit('new-chat-message', message);
  });

  socket.on('typing-start', ({ sessionId, userId, userName }) => {
    socket.to(sessionId).emit('user-typing', { userId, userName });
  });

  socket.on('typing-stop', ({ sessionId, userId }) => {
    socket.to(sessionId).emit('user-stopped-typing', { userId });
  });

  // User management
  socket.on('register-user', ({ userId, userName, avatar, email }) => {
    const user = {
      userId,
      userName,
      avatar,
      email,
      isOnline: true,
      lastSeen: new Date(),
      socketIds: [socket.id]
    };
    
    users.set(socket.id, { ...user, sessionId: null });
    
    // Broadcast user online status
    io.emit('user-online', { userId, userName, avatar });
  });

  socket.on('get-users', (callback) => {
    const onlineUsers = Array.from(users.values())
      .filter(u => u.isOnline)
      .map(({ userId, userName, avatar, email }) => ({ userId, userName, avatar, email }));
    
    if (callback) {
      callback(onlineUsers);
    }
  });

  socket.on('get-online-users', (callback) => {
    const onlineUsers = Array.from(users.values())
      .filter(u => u.isOnline)
      .map(({ userId, userName, avatar }) => ({ userId, userName, avatar }));
    
    if (callback) {
      callback(onlineUsers);
    }
  });

  // Session management handlers
  socket.on('check-session-exists', ({ sessionId }, callback) => {
    // Handle both short and full UUID session IDs
    let exists = sessions.has(sessionId);
    
    // If not found with exact match, try to find by short ID (first 8-12 chars)
    if (!exists && sessionId.length >= 8 && sessionId.length < 36) {
      for (const [fullSessionId] of sessions) {
        const shortId = fullSessionId.replace(/-/g, '').substring(0, sessionId.length);
        if (shortId === sessionId) {
          exists = true;
          console.log(`Check session exists: ${sessionId} -> ${exists} (matched ${fullSessionId})`);
          if (callback) {
            callback(exists);
          }
          return;
        }
      }
    }
    
    console.log(`Check session exists: ${sessionId} -> ${exists}`);
    if (callback) {
      callback(exists);
    }
  });

  socket.on('delete-session', (callback) => {
    const userSession = userSessions.get(socket.id);
    if (userSession && userSession.sessionId) {
      const sessionId = userSession.sessionId;
      const session = sessions.get(sessionId);
      
      if (session) {
        // Only allow creator to delete session
        if (session.creatorSocketId === socket.id) {
          // Notify all participants
          io.to(sessionId).emit('session-update', null);
          io.to(sessionId).emit('session-deleted', { sessionId });
          
          // Clean up
          sessions.delete(sessionId);
          chatMessages.delete(sessionId);
          
          console.log(`Session deleted: ${sessionId} by ${socket.id}`);
          
          if (callback) {
            callback({ success: true, sessionId });
          }
        } else {
          if (callback) {
            callback({ success: false, error: 'Only creator can delete session' });
          }
        }
      } else {
        if (callback) {
          callback({ success: false, error: 'Session not found' });
        }
      }
    } else {
      if (callback) {
        callback({ success: false, error: 'No active session' });
      }
    }
  });

  socket.on('update-session', (updates) => {
    const userSession = userSessions.get(socket.id);
    if (userSession && userSession.sessionId) {
      const session = sessions.get(userSession.sessionId);
      if (session) {
        session.updateMetadata(updates);
        
        // Broadcast update to all participants
        io.to(userSession.sessionId).emit('session-update', session.getMetadata());
        
        console.log(`Session updated: ${userSession.sessionId}`, updates);
      }
    }
  });

  // User streams management
  socket.on('get-user-streams', ({ userId }, callback) => {
    // Find all sessions created by this user
    const userStreams = [];
    sessions.forEach((session, sessionId) => {
      if (session.userId === userId && session.isActive) {
        userStreams.push(sessionId);
      }
    });
    
    console.log(`User streams requested for ${userId}:`, userStreams);
    
    // Emit to the requesting socket
    socket.emit('user-streams', userStreams);
    
    if (callback) {
      callback(userStreams);
    }
  });

  socket.on('get-users-list', (callback) => {
    const onlineUsers = Array.from(users.values())
      .filter(u => u.isOnline)
      .map(({ userId, userName, avatar, email }) => ({ 
        id: userId,
        userId,
        userName, 
        avatar, 
        email 
      }));
    
    console.log(`Users list requested, returning ${onlineUsers.length} users`);
    
    // Emit to the requesting socket
    socket.emit('users-list', onlineUsers);
    
    if (callback) {
      callback(onlineUsers);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    const userSession = userSessions.get(socket.id);
    const user = users.get(socket.id);
    
    if (userSession && userSession.sessionId) {
      const session = sessions.get(userSession.sessionId);
      if (session) {
        session.removeParticipant(socket.id);
        
        // Notify other participants
        socket.to(userSession.sessionId).emit('participant-left', {
          socketId: socket.id,
          participantCount: session.participants.size
        });
        
        // Clean up chat messages if session is ending
        if (session.participants.size === 0) {
          sessions.delete(userSession.sessionId);
          chatMessages.delete(userSession.sessionId);
          console.log(`Session ${userSession.sessionId} cleaned up`);
        }
      }
    }
    
    // Notify user offline
    if (user) {
      io.emit('user-offline', { userId: user.userId });
    }
    
    userSessions.delete(socket.id);
    users.delete(socket.id);
  });

  // Handle leave session
  socket.on('leave-session', ({ sessionId }) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.removeParticipant(socket.id);
      socket.leave(sessionId);
      
      socket.to(sessionId).emit('participant-left', {
        socketId: socket.id,
        participantCount: session.participants.size
      });
    }
    
    const userSession = userSessions.get(socket.id);
    if (userSession) {
      userSession.sessionId = null;
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    activeSessions: sessions.size,
    connectedClients: userSessions.size
  });
});

// Serve static files for shared stream viewer (if needed)
app.get('/shared-stream/:sessionId', (req, res) => {
  res.json({
    sessionId: req.params.sessionId,
    message: 'Use the client application to view this stream'
  });
});

// Session cleanup - remove sessions older than 24 hours
setInterval(() => {
  const twentyFourHours = 24 * 60 * 60 * 1000;
  const now = Date.now();
  
  sessions.forEach((session, sessionId) => {
    if (now - session.createdAt.getTime() > twentyFourHours) {
      // Notify any remaining participants
      io.to(sessionId).emit('session-expired', { sessionId });
      
      // Clean up the session
      sessions.delete(sessionId);
      console.log(`Expired session cleaned up: ${sessionId}`);
    }
  });
}, 60 * 60 * 1000); // Check every hour

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Video streaming server running on port ${PORT}`);
  console.log(`📡 Socket.IO server ready for WebRTC signaling`);
  console.log(`🔗 Health check available at http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;