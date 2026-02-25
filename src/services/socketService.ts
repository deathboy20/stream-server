import { Server, Socket } from 'socket.io';
import { db } from '../config/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

export const setupSocketEvents = (io: Server) => {
  // Store session host mapping
  const sessionHosts = new Map<string, string>(); // sessionId -> hostUid

  io.on('connection', (socket: Socket) => {
    console.log('User connected:', socket.id);

    const pendingRequests = new Map<string, Array<{ viewerId: string; name: string }>>();

    socket.on('join-session', async (data: { sessionId: string, userId?: string }) => {
      const sessionId = typeof data === 'string' ? data : data.sessionId;
      const userId = typeof data === 'string' ? null : data.userId;
      
      // Try to fetch meeting and host info
      try {
        const meetingSnap = await getDoc(doc(db, 'meetings', sessionId));
        if (!meetingSnap.exists() || meetingSnap.data()?.isActive === false) {
          console.warn(`Attempt to join inactive/non-existent session: ${sessionId}`);
          socket.emit('meeting-ended', { sessionId });
          return;
        }
        
        if (!sessionHosts.has(sessionId)) {
          sessionHosts.set(sessionId, meetingSnap.data().hostId);
        }
      } catch (err) {
        console.error("Failed to fetch meeting:", err);
      }

      socket.join(sessionId);
      console.log(`User ${socket.id} joined session ${sessionId}`);
      socket.data.sessionId = sessionId;

      // If this is the host, mark the socket
      if (userId && sessionHosts.get(sessionId) === userId) {
        socket.data.isHost = true;
        socket.data.userId = userId;
        console.log(`Host ${userId} joined session ${sessionId}`);
      }
    });

    socket.on('join-request', async (data: { sessionId: string; viewerId: string; name: string }) => {
      const { sessionId, viewerId, name } = data;
      
      try {
        const meetingSnap = await getDoc(doc(db, 'meetings', sessionId));
        if (!meetingSnap.exists() || meetingSnap.data()?.isActive === false) {
          console.warn(`Join request for inactive session ${sessionId}`);
          io.to(viewerId).emit('join-rejected', { sessionId, reason: 'Meeting has ended' });
          return;
        }
      } catch (e) {
        console.error('Failed to verify meeting for join request', e);
      }

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
      const entry = list.find(r => r.viewerId === viewerId) || { viewerId, name: 'Guest' };
      pendingRequests.set(sessionId, list.filter(r => r.viewerId !== viewerId));
      io.to(viewerId).emit('join-approved', { sessionId });
      io.to(sessionId).emit('viewer-connected', { viewerId, name: entry.name });
      (async () => {
        try {
          const mRef = doc(db, 'meetings', sessionId);
          const mSnap = await getDoc(mRef);
          if (mSnap.exists()) {
            const data = mSnap.data() as any;
            const participants: Array<{ id: string; name: string; role?: string }> = Array.isArray(data.participants) ? data.participants : [];
            const exists = participants.find(p => p.id === viewerId);
            const updated = exists ? participants.map(p => p.id === viewerId ? { ...p, name: entry.name } : p) : [...participants, { id: viewerId, name: entry.name, role: 'participant' }];
            await updateDoc(mRef, { participants: updated });
          }
        } catch (e) {
          console.error('Failed to persist participant add', e);
        }
      })();
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

    socket.on('viewer-connected', (data: { sessionId: string; viewerId: string; name?: string }) => {
        console.log(`Viewer ${data.viewerId} connected to session ${data.sessionId}`);
        socket.to(data.sessionId).emit('viewer-connected', { viewerId: data.viewerId, name: data.name });
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
      io.to(data.sessionId).emit('chat-message', data);
    });

    socket.on('end-meeting', (data: { sessionId: string }) => {
      if (!socket.data.isHost) {
        console.warn(`Unauthorized end-meeting from ${socket.id}`);
        return;
      }
      console.log(`Meeting ${data.sessionId} ended by host`);
      io.to(data.sessionId).emit('meeting-ended', { sessionId: data.sessionId });
      (async () => {
        try {
          const mRef = doc(db, 'meetings', data.sessionId);
          await updateDoc(mRef, { isActive: false, endedAt: Date.now() });
        } catch (e) {
          console.error('Failed to persist meeting end', e);
        }
      })();
    });

    socket.on('host-leaving', (data: { sessionId: string }) => {
      if (!socket.data.isHost) return;
      io.to(data.sessionId).emit('host-left', { sessionId: data.sessionId });
    });

    socket.on('update-name', (data: { sessionId: string; viewerId: string; name: string }) => {
      io.to(data.sessionId).emit('name-updated', { viewerId: data.viewerId, name: data.name });
      (async () => {
        try {
          const mRef = doc(db, 'meetings', data.sessionId);
          const mSnap = await getDoc(mRef);
          if (mSnap.exists()) {
            const docData = mSnap.data() as any;
            const participants: Array<{ id: string; name: string; role?: string }> = Array.isArray(docData.participants) ? docData.participants : [];
            const updated = participants.map(p => p.id === data.viewerId ? { ...p, name: data.name } : p);
            await updateDoc(mRef, { participants: updated });
          }
        } catch (e) {
          console.error('Failed to persist name update', e);
        }
      })();
    });

    socket.on('update-role', (data: { sessionId: string; targetId: string; role: string }) => {
      if (!socket.data.isHost) {
        console.warn(`Unauthorized update-role from ${socket.id}`);
        return;
      }
      io.to(data.sessionId).emit('role-updated', { targetId: data.targetId, role: data.role });
      
      (async () => {
        try {
          const mRef = doc(db, 'meetings', data.sessionId);
          const mSnap = await getDoc(mRef);
          if (mSnap.exists()) {
            const docData = mSnap.data() as any;
            const participants: Array<{ id: string; name: string; role?: string }> = Array.isArray(docData.participants) ? docData.participants : [];
            const updated = participants.map(p => p.id === data.targetId ? { ...p, role: data.role } : p);
            await updateDoc(mRef, { participants: updated });
            
            // Mark target socket explicitly with co-host if promoted
            if (data.role === 'co-host') {
                const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === data.targetId);
                if (targetSocket) {
                    targetSocket.data.isCoHost = true;
                }
            } else if (data.role === 'participant') {
                const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === data.targetId);
                if (targetSocket) {
                    targetSocket.data.isCoHost = false;
                }
            }
          }
        } catch (e) {
          console.error('Failed to persist role update', e);
        }
      })();
    });


    socket.on('reaction', (data: { sessionId: string, reaction: string, senderName: string, senderId: string }) => {
      console.log(`Reaction ${data.reaction} in ${data.sessionId} from ${data.senderName}`);
      socket.to(data.sessionId).emit('reaction', data);
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      const sessionId = socket.data.sessionId as string | undefined;
      if (sessionId) {
        io.to(sessionId).emit('viewer-left', { viewerId: socket.id });
        if (socket.data.isHost) {
          io.to(sessionId).emit('host-left', { sessionId });
        }
        (async () => {
          try {
            const mRef = doc(db, 'meetings', sessionId);
            const mSnap = await getDoc(mRef);
            if (mSnap.exists()) {
              const data = mSnap.data() as any;
              const participants: Array<{ id: string; name: string; role?: string }> = Array.isArray(data.participants) ? data.participants : [];
              const updated = participants.filter(p => p.id !== socket.id);
              await updateDoc(mRef, { participants: updated });
            }
          } catch (e) {
            console.error('Failed to persist participant removal', e);
          }
        })();
      }
    });
  });
};
