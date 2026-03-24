import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import sessionRoutes from './routes/sessionRoutes';
import meetingRoutes from './routes/meetingRoutes';
import { startCleanupJob } from './services/cleanupService';
import { setupSocketEvents } from './services/socketService';
import { initFirebase } from './config/firebase';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3001;
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'];
const CORS_CREDENTIALS = process.env.CORS_CREDENTIALS === 'true';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CORS_ORIGINS,
    methods: ["GET", "POST"],
    credentials: CORS_CREDENTIALS
  }
});

app.use(cors({
  origin: CORS_ORIGINS,
  credentials: CORS_CREDENTIALS
}));
app.use(express.json());

// Initialize Socket.IO events
setupSocketEvents(io);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'backend server running',
    endpoints: [
      '--- Sessions ---',
      'POST   /api/sessions',
      'GET    /api/sessions/:id',
      'DELETE /api/sessions/:id',
      '--- Meetings ---',
      'POST   /api/meetings',
      'GET    /api/meetings/:id',
      'PUT    /api/meetings/:id',
      'DELETE /api/meetings/:id',
      'GET    /api/meetings/user/:userId'
    ]
  });
});

app.use('/api/sessions', sessionRoutes);
app.use('/api/meetings', meetingRoutes);

server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initFirebase();
  startCleanupJob();
});
