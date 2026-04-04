import { Server, Socket } from 'socket.io';
import { adminAuth, db } from '../config/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

interface MeetingMeta {
  hostId: string;
  isActive: boolean;
  fetchedAt: number;
}

interface PendingRequest {
  viewerId: string;
  name: string;
}

export const setupSocketEvents = (io: Server) => {
  const MEETINGS_COLLECTION = 'tele-meet';
  const SESSIONS_COLLECTION = 'sessions';
  const sessionHosts = new Map<string, string>();
  const meetingCache = new Map<string, MeetingMeta>();
  const pendingRequests = new Map<string, PendingRequest[]>();
  const socketQueue = new Map<string, unknown[]>();
  const sessionActivity = new Map<string, number>();
  const socketRateBuckets = new Map<string, { count: number; resetAt: number }>();

  const touchSession = (sessionId: string) => {
    sessionActivity.set(sessionId, Date.now());
  };

  const maybeCleanupSessionCaches = (sessionId: string) => {
    const roomSize = io.sockets.adapter.rooms.get(sessionId)?.size || 0;
    if (roomSize > 0) return;
    sessionHosts.delete(sessionId);
    meetingCache.delete(sessionId);
    pendingRequests.delete(sessionId);
    socketQueue.delete(sessionId);
    sessionActivity.delete(sessionId);
  };

  const checkSocketRateLimit = (socketId: string, eventName: string, maxRequests: number, windowMs: number) => {
    const key = `${socketId}:${eventName}`;
    const now = Date.now();
    const bucket = socketRateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      socketRateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (bucket.count >= maxRequests) {
      return false;
    }
    bucket.count += 1;
    socketRateBuckets.set(key, bucket);
    return true;
  };

  const getMeetingMeta = async (sessionId: string): Promise<MeetingMeta | null> => {
    const cached = meetingCache.get(sessionId);
    if (cached && cached.isActive) {
      return cached;
    }
    try {
      const snap = await getDoc(doc(db, MEETINGS_COLLECTION, sessionId));
      if (!snap.exists()) return null;
      const data = snap.data();
      const meta: MeetingMeta = {
        hostId: data.hostId,
        isActive: data.isActive !== false,
        fetchedAt: Date.now()
      };
      meetingCache.set(sessionId, meta);
      return meta;
    } catch {
      return null;
    }
  };

  const flushQueue = (sessionId: string) => {
    const queue = socketQueue.get(sessionId) || [];
    socketQueue.delete(sessionId);
    queue.forEach(fn => { (fn as () => void)(); });
  };

  const emitSessionParticipants = (sessionId: string, excludedSocketId?: string) => {
    const participants = Array.from(io.sockets.adapter.rooms.get(sessionId) || [])
      .filter(id => id !== excludedSocketId)
      .map(id => {
        const s = io.sockets.sockets.get(id);
        return {
          viewerId: id,
          name: (s?.data?.displayName as string | undefined) || 'Guest',
          isHost: !!s?.data?.isHost
        };
      });
    io.to(sessionId).emit('session-participants', { sessionId, participants });
  };

  const validateViewerJoinToken = async (sessionId: string, viewerId: string, joinToken: string) => {
    try {
      const sessionSnap = await getDoc(doc(db, SESSIONS_COLLECTION, sessionId));
      if (!sessionSnap.exists()) return null;
      const data = sessionSnap.data() as { viewers?: Record<string, { joinToken?: string; name?: string }> };
      const viewer = data.viewers?.[viewerId];
      if (!viewer || !viewer.joinToken || viewer.joinToken !== joinToken) return null;
      return viewer.name || 'Guest';
    } catch {
      return null;
    }
  };

  const persistParticipantRemoval = async (sessionId: string, viewerId: string) => {
    try {
      const mRef = doc(db, MEETINGS_COLLECTION, sessionId);
      const mSnap = await getDoc(mRef);
      if (mSnap.exists()) {
        const d = mSnap.data() as any;
        const participants: Array<{ id: string; name: string; role?: string }> = Array.isArray(d.participants) ? d.participants : [];
        const updated = participants.filter(p => p.id !== viewerId);
        await updateDoc(mRef, { participants: updated });
      }
    } catch (e) {
      console.error('Failed to persist participant removal', e);
    }
  };

  const removeParticipantFromSession = async (sessionId: string, viewerId: string) => {
    const targetSocket = io.sockets.sockets.get(viewerId);

    if (targetSocket) {
      targetSocket.leave(sessionId);
      if ((targetSocket.data.sessionId as string | undefined) === sessionId) {
        delete targetSocket.data.sessionId;
      }
      if (targetSocket.data.isHost) {
        targetSocket.data.isHost = false;
      }
      if (targetSocket.data.isCoHost) {
        targetSocket.data.isCoHost = false;
      }
    }

    const list = pendingRequests.get(sessionId) || [];
    pendingRequests.set(sessionId, list.filter(r => r.viewerId !== viewerId));

    io.to(sessionId).emit('viewer-left', { viewerId });
    emitSessionParticipants(sessionId, viewerId);
    await persistParticipantRemoval(sessionId, viewerId);
    maybeCleanupSessionCaches(sessionId);
  };

  io.use(async (socket, next) => {
    try {
      const tokenFromAuth = typeof socket.handshake.auth?.token === 'string'
        ? socket.handshake.auth.token
        : null;
      const authHeader = socket.handshake.headers.authorization;
      const tokenFromHeader = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;
      const token = tokenFromAuth || tokenFromHeader;
      if (token) {
        const decoded = await adminAuth.verifyIdToken(token);
        socket.data.firebaseUid = decoded.uid;
        socket.data.firebaseEmail = decoded.email || '';
      }
      next();
    } catch (error) {
      next(new Error('Unauthorized socket connection'));
    }
  });

  setInterval(() => {
    const now = Date.now();
    for (const [sessionId, lastSeenAt] of sessionActivity.entries()) {
      const inactiveForMs = now - lastSeenAt;
      if (inactiveForMs > 60 * 60 * 1000) {
        sessionHosts.delete(sessionId);
        meetingCache.delete(sessionId);
        pendingRequests.delete(sessionId);
        socketQueue.delete(sessionId);
        sessionActivity.delete(sessionId);
      }
    }
    for (const [key, bucket] of socketRateBuckets.entries()) {
      if (bucket.resetAt <= now) {
        socketRateBuckets.delete(key);
      }
    }
  }, 10 * 60 * 1000);

  io.on('connection', (socket: Socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-session', async (data: { sessionId: string; userId?: string; name?: string } | string) => {
      const sessionId = typeof data === 'string' ? data : data.sessionId;
      const userId = typeof data === 'string' ? null : data.userId;
      const name = typeof data === 'string' ? undefined : data.name;

      if (userId) {
        const firebaseUid = socket.data.firebaseUid as string | undefined;
        if (!firebaseUid || firebaseUid !== userId) {
          socket.emit('join-error', { sessionId, error: 'Invalid user identity' });
          return;
        }
        const meta = await getMeetingMeta(sessionId);
        if (!meta || !meta.isActive) {
          socket.emit('meeting-ended', { sessionId });
          return;
        }
        if (!sessionHosts.has(sessionId)) {
          sessionHosts.set(sessionId, meta.hostId);
        }
      }

      socket.join(sessionId);
      socket.data.sessionId = sessionId;
      touchSession(sessionId);
      if (userId) {
        socket.data.userId = userId;
      }
      if (typeof name === 'string' && name.trim()) {
        socket.data.displayName = name.trim().slice(0, 80);
      }

      const participants = Array.from(io.sockets.adapter.rooms.get(sessionId) || [])
        .filter(id => id !== socket.id)
        .map(id => {
          const s = io.sockets.sockets.get(id);
          return {
            viewerId: id,
            name: (s?.data?.displayName as string | undefined) || 'Guest',
            isHost: !!s?.data?.isHost
          };
        });
      socket.emit('session-participants', { sessionId, participants });

      if (userId && sessionHosts.get(sessionId) === userId) {
        socket.data.isHost = true;
        console.log(`Host ${userId} rejoined session ${sessionId}`);
      }

      setTimeout(() => flushQueue(sessionId), 0);
    });

    socket.on('join-request', async (data: { sessionId: string; name: string }) => {
      if (!checkSocketRateLimit(socket.id, 'join-request', 8, 60_000)) {
        socket.emit('join-error', { error: 'Too many join requests. Please wait and try again.' });
        return;
      }
      const { sessionId, name } = data;
      const viewerId = socket.id;
      const safeName = typeof name === 'string' && name.trim().length > 0 ? name.trim().slice(0, 80) : 'Guest';
      socket.data.displayName = safeName;

      const meta = await getMeetingMeta(sessionId);
      if (!meta || !meta.isActive) {
        io.to(socket.id).emit('join-rejected', { sessionId, reason: 'Meeting has ended' });
        return;
      }

      const list = pendingRequests.get(sessionId) || [];
      if (!list.find(r => r.viewerId === viewerId)) {
        list.push({ viewerId, name: safeName });
        pendingRequests.set(sessionId, list);
      }
      touchSession(sessionId);
      io.to(sessionId).emit('pending-join', { viewerId, name: safeName });
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
      touchSession(sessionId);

      io.to(viewerId).emit('join-approved', { sessionId, approvedName: entry.name });
      io.to(sessionId).emit('pending-requests-updated', { viewerId });

      (async () => {
        try {
          const mRef = doc(db, MEETINGS_COLLECTION, sessionId);
          const mSnap = await getDoc(mRef);
          if (mSnap.exists()) {
            const d = mSnap.data() as any;
            const participants: Array<{ id: string; name: string; role?: string }> = Array.isArray(d.participants) ? d.participants : [];
            const exists = participants.find(p => p.id === viewerId);
            const updated = exists
              ? participants.map(p => p.id === viewerId ? { ...p, name: entry.name } : p)
              : [...participants, { id: viewerId, name: entry.name, role: 'participant' }];
            await updateDoc(mRef, { participants: updated });
          }
        } catch (e) {
          console.error('Failed to persist participant add', e);
        }
      })();
    });

    socket.on('reject-join', (data: { sessionId: string; viewerId: string }) => {
      if (!socket.data.isHost) return;
      const { sessionId, viewerId } = data;
      const list = pendingRequests.get(sessionId) || [];
      pendingRequests.set(sessionId, list.filter(r => r.viewerId !== viewerId));
      touchSession(sessionId);
      io.to(viewerId).emit('join-rejected', { sessionId });
      io.to(sessionId).emit('pending-requests-updated', { viewerId });
    });

    socket.on('host-command', (data: { sessionId: string; command: string; value?: unknown }) => {
      if (!socket.data.isHost) return;
      socket.to(data.sessionId).emit('peer-command', {
        command: data.command,
        value: data.value,
        sender: socket.id
      });
    });

    socket.on('targeted-command', async (data: { sessionId: string; targetId: string; command: string; value?: unknown }) => {
      if (!socket.data.isHost) return;
      io.to(data.targetId).emit('peer-command', {
        command: data.command,
        value: data.value,
        sender: socket.id
      });
      if (data.command === 'remove') {
        await removeParticipantFromSession(data.sessionId, data.targetId);
      }
    });

    socket.on('join-user', async (data: { sessionId: string; viewerId: string; joinToken: string }) => {
      const sessionId = data?.sessionId;
      const viewerId = data?.viewerId;
      const joinToken = data?.joinToken;
      if (!sessionId || !viewerId || !joinToken) {
        socket.emit('join-error', { error: 'Invalid viewer join payload' });
        return;
      }
      if (!checkSocketRateLimit(socket.id, 'join-user', 20, 60_000)) {
        socket.emit('join-error', { error: 'Too many join attempts. Please wait and retry.' });
        return;
      }
      const viewerName = await validateViewerJoinToken(sessionId, viewerId, joinToken);
      if (!viewerName) {
        socket.emit('join-error', { error: 'Unauthorized viewer access' });
        return;
      }
      touchSession(sessionId);
      socket.data.displayName = viewerName;
      socket.join(viewerId);
    });

    socket.on('viewer-connected', (data: { sessionId: string; viewerId: string; name?: string }) => {
      const safeName = typeof data.name === 'string' && data.name.trim().length > 0
        ? data.name.trim().slice(0, 80)
        : ((socket.data.displayName as string | undefined) || 'Guest');
      socket.data.displayName = safeName;
      console.log(`Viewer ${data.viewerId} connected to session ${data.sessionId}`);
      socket.to(data.sessionId).emit('viewer-connected', {
        viewerId: data.viewerId,
        name: safeName,
        isHost: !!socket.data.isHost
      });
      const participants = Array.from(io.sockets.adapter.rooms.get(data.sessionId) || [])
        .filter(id => id !== socket.id)
        .map(id => {
          const s = io.sockets.sockets.get(id);
          return {
            viewerId: id,
            name: (s?.data?.displayName as string | undefined) || 'Guest',
            isHost: !!s?.data?.isHost
          };
        });
      io.to(data.sessionId).emit('session-participants', { sessionId: data.sessionId, participants });
    });

    socket.on('viewer-left', async (data: { sessionId?: string; viewerId?: string }) => {
      const sessionId = data?.sessionId || (socket.data.sessionId as string | undefined);
      if (!sessionId) return;
      const viewerId = data?.viewerId || socket.id;
      if (viewerId !== socket.id && !socket.data.isHost) return;
      await removeParticipantFromSession(sessionId, viewerId);
    });

    socket.on('leave-session', async (data: { sessionId?: string } | string | undefined) => {
      const sessionId = typeof data === 'string'
        ? data
        : (data?.sessionId || (socket.data.sessionId as string | undefined));
      if (!sessionId) return;
      await removeParticipantFromSession(sessionId, socket.id);
    });

    socket.on('get-session-participants', (data: { sessionId: string }) => {
      const sessionId = data?.sessionId || (socket.data.sessionId as string | undefined);
      if (!sessionId) return;
      const participants = Array.from(io.sockets.adapter.rooms.get(sessionId) || [])
        .filter(id => id !== socket.id)
        .map(id => {
          const s = io.sockets.sockets.get(id);
          return {
            viewerId: id,
            name: (s?.data?.displayName as string | undefined) || 'Guest',
            isHost: !!s?.data?.isHost
          };
        });
      socket.emit('session-participants', { sessionId, participants });
    });

    socket.on('viewer-ready', (data: { sessionId: string; viewerId: string }) => {
      if (!checkSocketRateLimit(socket.id, 'viewer-ready', 60, 60_000)) {
        return;
      }
      const sessionId = data?.sessionId || (socket.data.sessionId as string | undefined);
      if (!sessionId) return;
      touchSession(sessionId);
      console.log(`Viewer ${socket.id} ready for WebRTC in session ${sessionId}`);
      socket.to(sessionId).emit('viewer-ready', { viewerId: data?.viewerId || socket.id });
    });

    socket.on('viewer-watching', (data: { sessionId: string; viewerId: string }) => {
      console.log(`Viewer ${data.viewerId} is now watching`);
      socket.to(data.sessionId).emit('viewer-watching', { viewerId: data.viewerId });
    });

    socket.on('signal', (data: { target: string; signal: unknown; sessionId: string; metadata?: unknown }) => {
      if (!checkSocketRateLimit(socket.id, 'signal', 600, 60_000)) {
        socket.emit('join-error', { error: 'Signaling rate limit exceeded' });
        return;
      }
      if (!data?.target || !data?.sessionId || !data?.signal) return;
      if (!socket.rooms.has(data.sessionId)) return;
      const targetSocket = io.sockets.sockets.get(data.target);
      if (!targetSocket || !targetSocket.rooms.has(data.sessionId) && data.target !== data.sessionId) {
        return;
      }
      touchSession(data.sessionId);
      io.to(data.target).emit('signal', {
        signal: data.signal,
        sender: socket.id,
        metadata: data.metadata
      });
    });

    socket.on('chat-message', (data: { sessionId: string; message: string; senderName: string; senderId: string; timestamp: number }) => {
      if (!checkSocketRateLimit(socket.id, 'chat-message', 40, 60_000)) return;
      if (!data?.sessionId || typeof data.message !== 'string') return;
      touchSession(data.sessionId);
      io.to(data.sessionId).emit('chat-message', data);
    });

    socket.on('end-meeting', (data: { sessionId: string }) => {
      if (!data?.sessionId) {
        socket.emit('meeting-end-error', { error: 'Missing session ID' });
        return;
      }
      if (!socket.data.isHost) {
        socket.emit('meeting-end-error', { error: 'Only host can end the meeting' });
        return;
      }
      console.log(`Meeting ${data.sessionId} ended by host`);
      io.to(data.sessionId).emit('meeting-ended', { sessionId: data.sessionId });
      const cached = meetingCache.get(data.sessionId);
      if (cached) {
        meetingCache.set(data.sessionId, { ...cached, isActive: false, fetchedAt: Date.now() });
      }
      pendingRequests.delete(data.sessionId);
      const socketsInRoom = Array.from(io.sockets.adapter.rooms.get(data.sessionId) || []);
      socketsInRoom.forEach((socketId) => {
        const participantSocket = io.sockets.sockets.get(socketId);
        if (!participantSocket) return;
        participantSocket.leave(data.sessionId);
        if ((participantSocket.data.sessionId as string | undefined) === data.sessionId) {
          delete participantSocket.data.sessionId;
        }
        if (participantSocket.data.isHost) {
          participantSocket.data.isHost = false;
        }
      });
      (async () => {
        try {
          await updateDoc(doc(db, MEETINGS_COLLECTION, data.sessionId), { isActive: false, endedAt: Date.now() });
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
          const mRef = doc(db, MEETINGS_COLLECTION, data.sessionId);
          const mSnap = await getDoc(mRef);
          if (mSnap.exists()) {
            const d = mSnap.data() as any;
            const participants: Array<{ id: string; name: string; role?: string }> = Array.isArray(d.participants) ? d.participants : [];
            const updated = participants.map(p => p.id === data.viewerId ? { ...p, name: data.name } : p);
            await updateDoc(mRef, { participants: updated });
          }
        } catch (e) {
          console.error('Failed to persist name update', e);
        }
      })();
    });

    socket.on('update-role', (data: { sessionId: string; targetId: string; role: string }) => {
      if (!socket.data.isHost) return;
      io.to(data.sessionId).emit('role-updated', { targetId: data.targetId, role: data.role });

      (async () => {
        try {
          const mRef = doc(db, MEETINGS_COLLECTION, data.sessionId);
          const mSnap = await getDoc(mRef);
          if (mSnap.exists()) {
            const d = mSnap.data() as any;
            const participants: Array<{ id: string; name: string; role?: string }> = Array.isArray(d.participants) ? d.participants : [];
            const updated = participants.map(p => p.id === data.targetId ? { ...p, role: data.role } : p);
            await updateDoc(mRef, { participants: updated });

            const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === data.targetId);
            if (targetSocket) {
              targetSocket.data.isCoHost = data.role === 'co-host';
            }
          }
        } catch (e) {
          console.error('Failed to persist role update', e);
        }
      })();
    });

    socket.on('reaction', (data: { sessionId: string; reaction: string; senderName: string; senderId: string }) => {
      if (!checkSocketRateLimit(socket.id, 'reaction', 80, 60_000)) return;
      if (!data?.sessionId) return;
      touchSession(data.sessionId);
      io.to(data.sessionId).emit('reaction', data);
    });

    socket.on('hand-raised', (data: { sessionId: string; raised: boolean }) => {
      const sessionId = data.sessionId || (socket.data.sessionId as string | undefined);
      if (!sessionId) return;
      io.to(sessionId).emit('hand-updated', { viewerId: socket.id, raised: data.raised });
    });

    socket.on('pin-participant', (data: { sessionId: string; targetId: string | null }) => {
      if (!socket.data.isHost && !socket.data.isCoHost) return;
      const sessionId = data.sessionId || (socket.data.sessionId as string | undefined);
      if (!sessionId) return;
      io.to(sessionId).emit('pinned-updated', { targetId: data.targetId });
    });

    socket.on('transfer-host', async (data: { sessionId: string; targetId: string }) => {
      if (!socket.data.isHost) return;
      const sessionId = data.sessionId || (socket.data.sessionId as string | undefined);
      if (!sessionId) return;

      const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === data.targetId);
      if (!targetSocket) {
        socket.emit('host-transfer-error', { reason: 'Target participant not found' });
        return;
      }
      const newHostUserId = targetSocket.data.userId as string | undefined;
      if (!newHostUserId) {
        socket.emit('host-transfer-error', { reason: 'Target user must be signed in to become host' });
        return;
      }

      try {
        const mRef = doc(db, MEETINGS_COLLECTION, sessionId);
        const mSnap = await getDoc(mRef);
        if (!mSnap.exists()) {
          socket.emit('host-transfer-error', { reason: 'Meeting not found' });
          return;
        }
        const d = mSnap.data() as any;
        const participants: Array<{ id: string; name: string; role?: string }> = Array.isArray(d.participants) ? d.participants : [];
        const targetParticipant = participants.find(p => p.id === data.targetId);
        const newHostName = targetParticipant?.name || d.hostName || 'Host';

        await updateDoc(mRef, { hostId: newHostUserId, hostName: newHostName });
        sessionHosts.set(sessionId, newHostUserId);
        const existingMeta = meetingCache.get(sessionId);
        if (existingMeta) {
          meetingCache.set(sessionId, { ...existingMeta, hostId: newHostUserId, fetchedAt: Date.now() });
        }

        socket.data.isHost = false;
        targetSocket.data.isHost = true;

        io.to(sessionId).emit('host-transferred', {
          sessionId,
          newHostUserId,
          newHostName,
          targetSocketId: data.targetId
        });
      } catch (e) {
        console.error('Failed to transfer host', e);
        socket.emit('host-transfer-error', { reason: 'Failed to transfer host' });
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      for (const key of socketRateBuckets.keys()) {
        if (key.startsWith(`${socket.id}:`)) {
          socketRateBuckets.delete(key);
        }
      }
      const sessionId = socket.data.sessionId as string | undefined;
      if (sessionId) {
        io.to(sessionId).emit('viewer-left', { viewerId: socket.id });
        emitSessionParticipants(sessionId, socket.id);
        if (socket.data.isHost) {
          io.to(sessionId).emit('host-left', { sessionId });
        }
        const list = pendingRequests.get(sessionId) || [];
        pendingRequests.set(sessionId, list.filter(r => r.viewerId !== socket.id));
        persistParticipantRemoval(sessionId, socket.id);
        maybeCleanupSessionCaches(sessionId);
      }
    });
  });
};
