import { Server, Socket } from 'socket.io';
import { db } from '../config/firebase';
import { doc, getDoc } from 'firebase/firestore';

export const setupSocketEvents = (io: Server) => {
  // Store session host mapping
  const sessionHosts = new Map<string, string>(); // sessionId -> hostUid

  io.on('connection', (socket: Socket) => {
    console.log('User connected:', socket.id);

    const pendingRequests = new Map<string, Array<{ viewerId: string; name: string }>>();

    socket.on('join-session', async (data: { sessionId: string, userId?: string }) => {
      const sessionId = typeof data === 'string' ? data : data.sessionId;
      const userId = typeof data === 'string' ? null : data.userId;
      
      socket.join(sessionId);
      console.log(`User ${socket.id} joined session ${sessionId}`);

      // Try to fetch host info if not already cached
      if (!sessionHosts.has(sessionId)) {
        try {
          const meetingSnap = await getDoc(doc(db, 'meetings', sessionId));
          if (meetingSnap.exists()) {
            sessionHosts.set(sessionId, meetingSnap.data().hostId);
          }
        } catch (err) {
          console.error("Failed to fetch meeting host:", err);
        }
      }

      // If this is the host, mark the socket
      if (userId && sessionHosts.get(sessionId) === userId) {
        socket.data.isHost = true;
        socket.data.userId = userId;
        console.log(`Host ${userId} joined session ${sessionId}`);
      }
    });

    socket.on('join-request', (data: { sessionId: string; viewerId: string; name: string }) => {
      const { sessionId, viewerId, name } = data;
      const list = pendingRequests.get(sessionId) || [];
      list.push({ viewerId, name });
      pendingRequests.set(sessionId, list);
      io.to(sessionId).emit('pending-join', { viewerId, name });
    });

    socket.on('approve-join', (data: { sessionId: string; viewerId: string }) => {
      if (!socket.data.isHost) {
        console.warn(`Unauthorized approve-join from ${socket.id}`);
        return;
      }
      const { sessionId, viewerId } = data;
      const list = pendingRequests.get(sessionId) || [];
      pendingRequests.set(sessionId, list.filter(r => r.viewerId !== viewerId));
      io.to(viewerId).emit('join-approved', { sessionId });
      io.to(sessionId).emit('viewer-connected', { viewerId });
    });

    socket.on('reject-join', (data: { sessionId: string; viewerId: string }) => {
      if (!socket.data.isHost) {
        console.warn(`Unauthorized reject-join from ${socket.id}`);
        return;
      }
      const { sessionId, viewerId } = data;
      const list = pendingRequests.get(sessionId) || [];
      pendingRequests.set(sessionId, list.filter(r => r.viewerId !== viewerId));
      io.to(viewerId).emit('join-rejected', { sessionId });
    });

    socket.on('host-command', (data: { sessionId: string, command: string, value?: any }) => {
      if (!socket.data.isHost) {
        console.warn(`Unauthorized host command from ${socket.id}`);
        return;
      }
      
      console.log(`Host command: ${data.command} in session ${data.sessionId}`);
      // Broadcast to everyone in the session except the host
      socket.to(data.sessionId).emit('peer-command', { 
        command: data.command, 
        value: data.value,
        sender: socket.id 
      });
    });

    socket.on('targeted-command', (data: { sessionId: string, targetId: string, command: string, value?: any }) => {
      if (!socket.data.isHost) {
        console.warn(`Unauthorized targeted command from ${socket.id}`);
        return;
      }

      console.log(`Targeted command: ${data.command} to ${data.targetId}`);
      io.to(data.targetId).emit('peer-command', {
        command: data.command,
        value: data.value,
        sender: socket.id
      });
    });

    socket.on('join-user', (userId: string) => {
      socket.join(userId);
      console.log(`User ${socket.id} joined user room ${userId}`);
    });

    socket.on('viewer-connected', (data: { sessionId: string; viewerId: string }) => {
        console.log(`Viewer ${data.viewerId} connected to session ${data.sessionId}`);
        socket.to(data.sessionId).emit('viewer-connected', { viewerId: data.viewerId });
    });

    socket.on('viewer-ready', (data: { sessionId: string; viewerId: string }) => {
        console.log(`Viewer ${data.viewerId} ready for WebRTC in session ${data.sessionId}`);
        socket.to(data.sessionId).emit('viewer-ready', { viewerId: data.viewerId });
    });

    socket.on('viewer-watching', (data: { sessionId: string; viewerId: string }) => {
        console.log(`Viewer ${data.viewerId} is now watching the stream in session ${data.sessionId}`);
        socket.to(data.sessionId).emit('viewer-watching', { viewerId: data.viewerId });
    });

    socket.on('signal', (data: { target: string; signal: any; sessionId: string; metadata?: any }) => {
      io.to(data.target).emit('signal', {
        signal: data.signal,
        sender: socket.id,
        metadata: data.metadata
      });
    });

    socket.on('chat-message', (data: { sessionId: string, message: string, senderName: string, senderId: string, timestamp: number }) => {
      console.log(`Chat message in ${data.sessionId} from ${data.senderName}`);
      // Broadcast to everyone in the session including the sender for simplicity or just others
      io.to(data.sessionId).emit('chat-message', data);
    });

    socket.on('reaction', (data: { sessionId: string, reaction: string, senderName: string, senderId: string }) => {
      console.log(`Reaction ${data.reaction} in ${data.sessionId} from ${data.senderName}`);
      socket.to(data.sessionId).emit('reaction', data);
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });
};
