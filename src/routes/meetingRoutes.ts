import { Router } from 'express';
import {
  createMeeting,
  getMeeting,
  getMeetingPublic,
  updateMeeting,
  deleteMeeting,
  listUserMeetings,
  restartMeeting
} from '../controllers/meetingController';
import { requireFirebaseAuth } from '../middleware/auth';

const router = Router();

router.post('/', requireFirebaseAuth, createMeeting);
router.post('/:id/restart', requireFirebaseAuth, restartMeeting);
router.get('/user/:userId', requireFirebaseAuth, listUserMeetings);
router.get('/:id/public', getMeetingPublic);
router.get('/:id', requireFirebaseAuth, getMeeting);
router.put('/:id', requireFirebaseAuth, updateMeeting);
router.delete('/:id', requireFirebaseAuth, deleteMeeting);

export default router;
