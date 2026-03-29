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
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) || [];
const CORS_CREDENTIALS = process.env.CORS_CREDENTIALS === 'true';
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://sigtrack-stream.vercel.app',
  'https://prod-sigtrackweb.sigtrackapp.com',
  'https://staging-sigtrackweb.sigtrackapp.com'
];
const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...CORS_ORIGINS]);

const isOriginAllowed = (origin?: string | null) => {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  if (origin.endsWith('.vercel.app')) return true;
  return false;
};

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS origin denied: ${origin || 'unknown'}`));
  },
  credentials: CORS_CREDENTIALS,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-firebase-token'],
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling']
});

app.set('trust proxy', 1);
app.use(cors(corsOptions));
app.options('/{*splat}', cors(corsOptions));
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
