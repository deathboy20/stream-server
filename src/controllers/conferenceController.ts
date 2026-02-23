import { Request, Response } from 'express';
import { Conference, Participant } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/firebase';
import { collection, doc, setDoc, getDoc, deleteDoc, updateDoc, getDocs, query, where } from 'firebase/firestore';

const CONFERENCES_COLLECTION = 'conferences';

export const createConference = async (req: Request, res: Response) => {
  try {
    const { name, description, roomMode = 'open', maxParticipants = 50 } = req.body;
    const conferenceId = uuidv4();
    const now = Date.now();
    
    const conference: Conference = {
      id: conferenceId,
      createdBy: 'host_' + conferenceId,
      createdAt: now,
      isActive: true,
      name: name || 'Untitled Conference',
      ...(description && { description }), // Only include if defined
      roomMode: roomMode || 'open',
      maxParticipants: maxParticipants || 50,
      participants: {},
      expiresAt: now + 24 * 60 * 60 * 1000, // 24 hours
      settings: {
        recordingEnabled: false,
        screenShareEnabled: true
      }
    };

    const confRef = doc(db, CONFERENCES_COLLECTION as string, conferenceId as string);
    await setDoc(confRef, conference);

    res.status(201).json(conference);
  } catch (error) {
    console.error('Create conference error:', error);
    res.status(500).json({ error: 'Failed to create conference' });
  }
};

export const getConference = async (req: Request, res: Response) => {
  try {
    const id = req.params.roomId as string;
    const confRef = doc(db, CONFERENCES_COLLECTION, id);
    const confSnap = await getDoc(confRef);

    if (!confSnap.exists()) {
      return res.status(404).json({ error: 'Conference not found' });
    }

    res.json(confSnap.data());
  } catch (error) {
    console.error('Get conference error:', error);
    res.status(500).json({ error: 'Failed to get conference' });
  }
};

export const endConference = async (req: Request, res: Response) => {
  try {
    const id = req.params.roomId as string;
    const confRef = doc(db, CONFERENCES_COLLECTION as string, id as string);
    await deleteDoc(confRef);
    res.json({ message: 'Conference ended' });
  } catch (error) {
    console.error('End conference error:', error);
    res.status(500).json({ error: 'Failed to end conference' });
  }
};

export const getParticipants = async (req: Request, res: Response) => {
  try {
    const id = req.params.roomId as string;
    const confRef = doc(db, CONFERENCES_COLLECTION as string, id as string);
    const confSnap = await getDoc(confRef);

    if (confSnap.exists()) {
      const data = confSnap.data() as Conference;
      res.json(data.participants || {});
    } else {
      res.status(404).json({ error: 'Conference not found' });
    }
  } catch (error) {
    console.error('Get participants error:', error);
    res.status(500).json({ error: 'Failed to get participants' });
  }
};

export const requestJoinConference = async (req: Request, res: Response) => {
  try {
    const id = req.params.roomId as string;
    const { name } = req.body;

    if (!name) return res.status(400).json({ error: 'Name is required' });

    const confRef = doc(db, CONFERENCES_COLLECTION as string, id as string);
    const confSnap = await getDoc(confRef);

    if (!confSnap.exists()) {
      return res.status(404).json({ error: 'Conference not found' });
    }

    const confData = confSnap.data() as Conference;
    
    // Check capacity
    const participantCount = Object.keys(confData.participants || {}).length;
    if (participantCount >= confData.maxParticipants) {
      return res.status(400).json({ error: 'Conference is at capacity' });
    }

    const roomMode = confData.roomMode || 'open';
    const participantId = uuidv4();
    const participant: Participant = {
      id: participantId,
      name,
      joinedAt: Date.now(),
      status: roomMode === 'open' ? 'active' : 'waiting',
      role: 'participant'
    };

    await updateDoc(confRef, {
      [`participants.${participantId}`]: participant
    });

    res.status(201).json(participant);
  } catch (error) {
    console.error('Request join conference error:', error);
    res.status(500).json({ error: 'Failed to submit join request' });
  }
};

export const approveParticipant = async (req: Request, res: Response) => {
  try {
    const { roomId, participantId } = req.params;
    const confRef = doc(db, CONFERENCES_COLLECTION as string, roomId as string);
    const confSnap = await getDoc(confRef);

    if (!confSnap.exists()) {
      return res.status(404).json({ error: 'Conference not found' });
    }

    await updateDoc(confRef, {
      [`participants.${participantId}.status`]: 'active'
    });

    res.json({ message: 'Participant approved' });
  } catch (error) {
    console.error('Approve participant error:', error);
    res.status(500).json({ error: 'Failed to approve participant' });
  }
};

export const rejectParticipant = async (req: Request, res: Response) => {
  try {
    const { roomId, participantId } = req.params;
    const confRef = doc(db, CONFERENCES_COLLECTION as string, roomId as string);

    await updateDoc(confRef, {
      [`participants.${participantId}.status`]: 'rejected'
    });

    res.json({ message: 'Participant rejected' });
  } catch (error) {
    console.error('Reject participant error:', error);
    res.status(500).json({ error: 'Failed to reject participant' });
  }
};

export const removeParticipant = async (req: Request, res: Response) => {
  try {
    const { roomId, participantId } = req.params;
    const confRef = doc(db, CONFERENCES_COLLECTION as string, roomId as string);
    const confSnap = await getDoc(confRef);

    if (!confSnap.exists()) {
      return res.status(404).json({ error: 'Conference not found' });
    }

    const confData = confSnap.data() as Conference;
    const updatedParticipants = { ...confData.participants };
    delete updatedParticipants[participantId as string];

    await updateDoc(confRef, {
      participants: updatedParticipants
    });

    res.json({ message: 'Participant removed' });
  } catch (error) {
    console.error('Remove participant error:', error);
    res.status(500).json({ error: 'Failed to remove participant' });
  }
};

export const setRoomMode = async (req: Request, res: Response) => {
  try {
    const { roomId } = req.params;
    const { roomMode } = req.body;

    if (!['open', 'moderated'].includes(roomMode)) {
      return res.status(400).json({ error: 'Invalid room mode' });
    }

    const confRef = doc(db, CONFERENCES_COLLECTION as string, roomId as string);
    await updateDoc(confRef, { roomMode });

    res.json({ message: `Room mode set to ${roomMode}` });
  } catch (error) {
    console.error('Set room mode error:', error);
    res.status(500).json({ error: 'Failed to set room mode' });
  }
};
