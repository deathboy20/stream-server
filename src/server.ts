import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import sessionRoutes from './routes/sessionRoutes';
import conferenceRoutes from './routes/conferenceRoutes';
import { startCleanupJob } from './services/cleanupService';
import { setupSocketEvents } from './services/socketService';
import { setupConferenceSocketEvents } from './services/conferenceSocketService';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for now
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialize Socket.IO events
setupSocketEvents(io);
setupConferenceSocketEvents(io);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'backend server running',
    endpoints: [
      // Streaming
      'POST   /api/sessions',
      'GET    /api/sessions/:id',
      'DELETE /api/sessions/:id',
      'GET    /api/sessions/:id/viewers',
      'POST   /api/sessions/:id/request',
      'POST   /api/sessions/:id/approve',
      'POST   /api/sessions/:id/reject',
      'DELETE /api/sessions/:id/viewers/:viewerId',
      // Conferencing
      'POST   /api/conferences',
      'GET    /api/conferences/:roomId',
      'DELETE /api/conferences/:roomId',
      'GET    /api/conferences/:roomId/participants',
      'POST   /api/conferences/:roomId/request',
      'POST   /api/conferences/:roomId/approve/:participantId',
      'POST   /api/conferences/:roomId/reject/:participantId',
      'DELETE /api/conferences/:roomId/participants/:participantId',
      'POST   /api/conferences/:roomId/room-mode'
    ]
  });
});

app.use('/api/sessions', sessionRoutes);
app.use('/api/conferences', conferenceRoutes);

import { initFirebase } from './config/firebase';

// ... (existing imports)

// ...

server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initFirebase();
  startCleanupJob();
});
