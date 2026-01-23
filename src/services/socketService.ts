import { Server, Socket } from 'socket.io';

export const setupSocketEvents = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-session', (sessionId: string) => {
      socket.join(sessionId);
      console.log(`User ${socket.id} joined session ${sessionId}`);
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

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });
};
