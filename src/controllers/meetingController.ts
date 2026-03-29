import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { collection, doc, setDoc, getDoc, deleteDoc, updateDoc, getDocs, query, where, deleteField } from 'firebase/firestore';
import { AuthenticatedRequest } from '../middleware/auth';

const MEETINGS_COLLECTION = 'tele-meet';

export const createMeeting = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, hostName, title, scheduledAt, orgName, team, userType } = req.body;
    const hostId = req.authUser?.uid;
    
    if (!id || !hostId) {
      return res.status(400).json({ error: 'Meeting ID and Host ID are required' });
    }

    const meeting = {
      id,
      hostId,
      hostName: hostName || 'Anonymous',
      hostEmail: req.authUser?.email || '',
      title: title || 'New Meeting',
      orgName: orgName || 'Unknown Org',
      team: team || null,
      userType: userType || null,
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

export const updateMeeting = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const meetingRef = doc(db, MEETINGS_COLLECTION, id as string);
    const meetingSnap = await getDoc(meetingRef);

    if (!meetingSnap.exists()) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    const meeting = meetingSnap.data() as { hostId: string };
    if (meeting.hostId !== req.authUser?.uid) {
      return res.status(403).json({ error: 'Only host can update meeting' });
    }
    
    await updateDoc(meetingRef, updates);
    res.json({ message: 'Meeting updated successfully' });
  } catch (error) {
    console.error('Update meeting error:', error);
    res.status(500).json({ error: 'Failed to update meeting' });
  }
};

export const deleteMeeting = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const meetingRef = doc(db, MEETINGS_COLLECTION, id as string);
    const meetingSnap = await getDoc(meetingRef);
    if (!meetingSnap.exists()) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    const meeting = meetingSnap.data() as { hostId: string };
    if (meeting.hostId !== req.authUser?.uid) {
      return res.status(403).json({ error: 'Only host can delete meeting' });
    }
    await deleteDoc(meetingRef);
    res.json({ message: 'Meeting deleted' });
  } catch (error) {
    console.error('Delete meeting error:', error);
    res.status(500).json({ error: 'Failed to delete meeting' });
  }
};

export const listUserMeetings = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.authUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const q = query(collection(db, MEETINGS_COLLECTION), where('hostId', '==', userId));
    const querySnapshot = await getDocs(q);
    
    const meetings = querySnapshot.docs.map(doc => doc.data());
    res.json(meetings);
  } catch (error) {
    console.error('List meetings error:', error);
    res.status(500).json({ error: 'Failed to list meetings' });
  }
};

/** Restart (reactivate) an ended meeting. Only the original host can restart. */
export const restartMeeting = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.authUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const meetingRef = doc(db, MEETINGS_COLLECTION, id as string);
    const meetingSnap = await getDoc(meetingRef);
    if (!meetingSnap.exists()) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    const data = meetingSnap.data() as { hostId: string; isActive?: boolean };
    if (data.hostId !== userId) {
      return res.status(403).json({ error: 'Only the host can restart this meeting' });
    }
    if (data.isActive !== false) {
      return res.status(400).json({ error: 'Meeting is already active' });
    }
    await updateDoc(meetingRef, {
      isActive: true,
      participants: [],
      endedAt: deleteField(),
      restartedAt: Date.now()
    });
    const updated = (await getDoc(meetingRef)).data();
    res.json(updated);
  } catch (error) {
    console.error('Restart meeting error:', error);
    res.status(500).json({ error: 'Failed to restart meeting' });
  }
};
