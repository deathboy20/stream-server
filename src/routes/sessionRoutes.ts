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

const router = Router();

router.post('/', createSession);
router.get('/:id', getSession);
router.delete('/:id', endSession);
router.get('/:id/viewers', getViewers);
router.post('/:id/request', requestJoin);
router.post('/:id/approve', approveViewer);
router.post('/:id/reject', rejectViewer);
router.post('/:id/admission', updateAdmissionMode);
router.delete('/:id/viewers/:viewerId', removeViewer);

export default router;
