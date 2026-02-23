import { Server, Socket } from 'socket.io';

export const setupConferenceSocketEvents = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    // Conference-specific events
    
    socket.on('join-conference', (data: { roomId: string; participantId: string }) => {
      socket.join(data.roomId);
      socket.join(data.participantId); // For targeted messaging
      console.log(`Participant ${data.participantId} joined conference ${data.roomId}`);
    });

    socket.on('leave-conference', (data: { roomId: string; participantId: string }) => {
      socket.leave(data.roomId);
      socket.leave(data.participantId);
      io.to(data.roomId).emit('participant-left', { participantId: data.participantId });
      console.log(`Participant ${data.participantId} left conference ${data.roomId}`);
    });

    // WebRTC Signaling for SFU
    socket.on('signal', (data: { target: string; signal: any; roomId: string; metadata?: any }) => {
      io.to(data.target).emit('signal', {
        signal: data.signal,
        sender: socket.id,
        metadata: data.metadata
      });
    });

    // Chat messages
    socket.on('chat-message', (data: { roomId: string; message: any }) => {
      io.to(data.roomId).emit('chat-message', {
        ...data.message,
        senderId: socket.id
      });
    });

    // File share initiation
    socket.on('file-share-start', (data: { roomId: string; fileInfo: any }) => {
      io.to(data.roomId).emit('file-share-start', {
        ...data.fileInfo,
        senderId: socket.id
      });
    });

    // Screen share events
    socket.on('screen-share-start', (data: { roomId: string; participantId: string }) => {
      console.log(`Screen share started by ${data.participantId} in room ${data.roomId}`);
      io.to(data.roomId).emit('screen-share-started', { participantId: data.participantId });
    });

    socket.on('screen-share-stop', (data: { roomId: string; participantId: string }) => {
      console.log(`Screen share stopped by ${data.participantId} in room ${data.roomId}`);
      io.to(data.roomId).emit('screen-share-stopped', { participantId: data.participantId });
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });
};
