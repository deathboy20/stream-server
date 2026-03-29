import { Router } from 'express';
import {
  createSession,
  getSession,
  endSession,
  getViewers,
  requestJoin,
  approveViewer,
  rejectViewer,
  removeViewer,
  updateAdmissionMode
} from '../controllers/sessionController';
import { requireFirebaseAuth } from '../middleware/auth';

const router = Router();

router.post('/', requireFirebaseAuth, createSession);
router.get('/:id', getSession);
router.delete('/:id', requireFirebaseAuth, endSession);
router.get('/:id/viewers', getViewers);
router.post('/:id/request', requestJoin);
router.post('/:id/approve', requireFirebaseAuth, approveViewer);
router.post('/:id/reject', requireFirebaseAuth, rejectViewer);
router.post('/:id/admission', requireFirebaseAuth, updateAdmissionMode);
router.delete('/:id/viewers/:viewerId', requireFirebaseAuth, removeViewer);

export default router;
