import { Router } from 'express';
import {
  createConference,
  getConference,
  endConference,
  getParticipants,
  requestJoinConference,
  approveParticipant,
  rejectParticipant,
  removeParticipant,
  setRoomMode
} from '../controllers/conferenceController';

const router = Router();

// Create conference
router.post('/', createConference);

// Get conference details
router.get('/:roomId', getConference);

// End conference
router.delete('/:roomId', endConference);

// Get participants
router.get('/:roomId/participants', getParticipants);

// Request to join conference
router.post('/:roomId/request', requestJoinConference);

// Approve participant (host only)
router.post('/:roomId/approve/:participantId', approveParticipant);

// Reject participant (host only)
router.post('/:roomId/reject/:participantId', rejectParticipant);

// Remove participant from conference (host only)
router.delete('/:roomId/participants/:participantId', removeParticipant);

// Set room mode (open/moderated)
router.post('/:roomId/room-mode', setRoomMode);

export default router;
