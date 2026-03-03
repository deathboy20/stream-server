import { Router } from 'express';
import {
  createMeeting,
  getMeeting,
  updateMeeting,
  deleteMeeting,
  listUserMeetings,
  restartMeeting
} from '../controllers/meetingController';

const router = Router();

router.post('/', createMeeting);
router.post('/:id/restart', restartMeeting);
router.get('/user/:userId', listUserMeetings);
router.get('/:id', getMeeting);
router.put('/:id', updateMeeting);
router.delete('/:id', deleteMeeting);

export default router;
