import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { collection, doc, setDoc, getDoc, deleteDoc, updateDoc, getDocs, query, where } from 'firebase/firestore';

const MEETINGS_COLLECTION = 'meetings';

export const createMeeting = async (req: Request, res: Response) => {
  try {
    const { id, hostId, hostName, title, scheduledAt } = req.body;
    
    if (!id || !hostId) {
      return res.status(400).json({ error: 'Meeting ID and Host ID are required' });
    }

    const meeting = {
      id,
      hostId,
      hostName: hostName || 'Anonymous',
      title: title || 'New Meeting',
      createdAt: Date.now(),
      scheduledAt: scheduledAt || Date.now(),
      isActive: true,
      participants: []
    };

    await setDoc(doc(db, MEETINGS_COLLECTION, id as string), meeting);
    res.status(201).json(meeting);
  } catch (error) {
    console.error('Create meeting error:', error);
    res.status(500).json({ error: 'Failed to create meeting' });
  }
};

export const getMeeting = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const meetingSnap = await getDoc(doc(db, MEETINGS_COLLECTION, id as string));

    if (!meetingSnap.exists()) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    res.json(meetingSnap.data());
  } catch (error) {
    console.error('Get meeting error:', error);
    res.status(500).json({ error: 'Failed to get meeting' });
  }
};

export const updateMeeting = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const meetingRef = doc(db, MEETINGS_COLLECTION, id as string);
    
    await updateDoc(meetingRef, updates);
    res.json({ message: 'Meeting updated successfully' });
  } catch (error) {
    console.error('Update meeting error:', error);
    res.status(500).json({ error: 'Failed to update meeting' });
  }
};

export const deleteMeeting = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await deleteDoc(doc(db, MEETINGS_COLLECTION, id as string));
    res.json({ message: 'Meeting deleted' });
  } catch (error) {
    console.error('Delete meeting error:', error);
    res.status(500).json({ error: 'Failed to delete meeting' });
  }
};

export const listUserMeetings = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const q = query(collection(db, MEETINGS_COLLECTION), where('hostId', '==', userId));
    const querySnapshot = await getDocs(q);
    
    const meetings = querySnapshot.docs.map(doc => doc.data());
    res.json(meetings);
  } catch (error) {
    console.error('List meetings error:', error);
    res.status(500).json({ error: 'Failed to list meetings' });
  }
};
