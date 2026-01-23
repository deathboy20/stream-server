import { Request, Response } from 'express';
import { Session, Viewer } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/firebase';
import { collection, doc, setDoc, getDoc, deleteDoc, updateDoc, getDocs } from 'firebase/firestore';

const SESSIONS_COLLECTION = 'sessions';

export const createSession = async (req: Request, res: Response) => {
  try {
    const sessionId = uuidv4();
    const now = Date.now();
    const session: Session = {
      id: sessionId,
      hostId: 'host_' + sessionId, // Simple host ID generation
      createdAt: now,
      isActive: true,
      viewers: {}, // This will be handled as a subcollection or map depending on structure, but for simplicity keeping as empty obj here
      expiresAt: now + 24 * 60 * 60 * 1000 // 24 hours
    };

    const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
    // Convert object to plain object for Firestore if needed (though explicit typing usually handles it)
    await setDoc(sessionRef, session);

    res.status(201).json(session);
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
};

export const getSession = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const sessionRef = doc(db, SESSIONS_COLLECTION, id);
    const sessionSnap = await getDoc(sessionRef);

    if (!sessionSnap.exists()) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Since viewers are in a subcollection or map, we might need to fetch them if stored separately.
    // For this prototype, let's assume viewers are stored in the main doc's 'viewers' map for 
    // real-time updates simplicity, or we fetch the subcollection.
    // Given the previous RTDB structure, let's keep viewers as a field map in the document for now
    // to match the frontend expectations without major refactoring.

    res.json(sessionSnap.data());
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
};

export const endSession = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const sessionRef = doc(db, SESSIONS_COLLECTION, id);
    await deleteDoc(sessionRef);
    res.json({ message: 'Session ended' });
  } catch (error) {
    console.error('End session error:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
};

export const getViewers = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const sessionRef = doc(db, SESSIONS_COLLECTION, id);
    const sessionSnap = await getDoc(sessionRef);

    if (sessionSnap.exists()) {
      const data = sessionSnap.data() as Session;
      res.json(data.viewers || {});
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  } catch (error) {
    console.error('Get viewers error:', error);
    res.status(500).json({ error: 'Failed to get viewers' });
  }
};

export const requestJoin = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name } = req.body;

    if (!name) return res.status(400).json({ error: 'Name is required' });

    const sessionRef = doc(db, SESSIONS_COLLECTION, id);
    const sessionSnap = await getDoc(sessionRef);

    if (!sessionSnap.exists()) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const viewerId = uuidv4();
    const viewer: Viewer = {
      id: viewerId,
      name,
      joinedAt: Date.now(),
      status: 'waiting'
    };

    // Update using dot notation to target specific map key
    await updateDoc(sessionRef, {
      [`viewers.${viewerId}`]: viewer
    });

    res.status(201).json(viewer);
  } catch (error) {
    console.error('Request join error:', error);
    res.status(500).json({ error: 'Failed to submit join request' });
  }
};

export const approveViewer = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { viewerId } = req.body;

    if (!viewerId) return res.status(400).json({ error: 'Viewer ID is required' });

    const sessionRef = doc(db, SESSIONS_COLLECTION, id);

    // Check if session exists
    const sessionSnap = await getDoc(sessionRef);
    if (!sessionSnap.exists()) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // We update the specific viewer's status
    await updateDoc(sessionRef, {
      [`viewers.${viewerId}.status`]: 'approved'
    });

    res.json({ message: 'Viewer approved' });

  } catch (error) {
    console.error('Approve viewer error:', error);
    res.status(500).json({ error: 'Failed to approve viewer' });
  }
};

export const rejectViewer = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { viewerId } = req.body;

    if (!viewerId) return res.status(400).json({ error: 'Viewer ID is required' });

    const sessionRef = doc(db, SESSIONS_COLLECTION, id);

    await updateDoc(sessionRef, {
      [`viewers.${viewerId}.status`]: 'rejected'
    });

    res.json({ message: 'Viewer rejected' });

  } catch (error) {
    console.error('Reject viewer error:', error);
    res.status(500).json({ error: 'Failed to reject viewer' });
  }
};

export const removeViewer = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const viewerId = req.params.viewerId as string;

    const sessionRef = doc(db, SESSIONS_COLLECTION, id);
    const sessionSnap = await getDoc(sessionRef);

    if (!sessionSnap.exists()) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // To delete a field in Firestore, use deleteField()
    // But importing it might be tricky with updateDoc signature sometimes if not consistent.
    // Easiest is to read, delete from object, and write back, OR use the specific deleteField sentinel.
    // Let's rely on standard update with FieldValue.delete() but we need to import it.
    // Wait, firebase/firestore exports deleteField.

    const { deleteField } = await import('firebase/firestore');

    await updateDoc(sessionRef, {
      [`viewers.${viewerId}`]: deleteField()
    });

    res.json({ message: 'Viewer removed' });

  } catch (error) {
    console.error('Remove viewer error:', error);
    res.status(500).json({ error: 'Failed to remove viewer' });
  }
};
