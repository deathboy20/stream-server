export interface Viewer {
  id: string;
  name: string;
  joinedAt: number;
  status: 'waiting' | 'approved' | 'rejected';
}

export interface Session {
  id: string;
  hostId: string; // Could be simple string if no auth
  createdAt: number;
  isActive: boolean;
  viewers: Record<string, Viewer>;
  expiresAt: number;
  admissionMode: 'auto' | 'manual';
}

// Conference Types
export interface Participant {
  id: string;
  name: string;
  joinedAt: number;
  status: 'waiting' | 'active' | 'rejected';
  role: 'host' | 'participant';
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

export interface Conference {
  id: string;
  createdBy: string; // hostId
  createdAt: number;
  isActive: boolean;
  name: string;
  description?: string;
  roomMode: 'open' | 'moderated';
  maxParticipants: number;
  participants: Record<string, Participant>;
  expiresAt: number;
  settings: {
    recordingEnabled: boolean;
    screenShareEnabled: boolean;
  };
}
