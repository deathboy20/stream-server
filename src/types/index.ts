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
