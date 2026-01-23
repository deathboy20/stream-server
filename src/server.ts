import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import sessionRoutes from './routes/sessionRoutes';
import { startCleanupJob } from './services/cleanupService';
import { setupSocketEvents } from './services/socketService';

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

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'backend server running',
    endpoints: [
      'POST   /api/sessions',
      'GET    /api/sessions/:id',
      'DELETE /api/sessions/:id',
      'GET    /api/sessions/:id/viewers',
      'POST   /api/sessions/:id/request',
      'POST   /api/sessions/:id/approve',
      'POST   /api/sessions/:id/reject',
      'DELETE /api/sessions/:id/viewers/:viewerId'
    ]
  });
});

app.use('/api/sessions', sessionRoutes);

import { initFirebase } from './config/firebase';

// ... (existing imports)

// ...

server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initFirebase();
  startCleanupJob();
});
