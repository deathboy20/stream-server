import { NextFunction, Request, Response } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../config/firebase';

export interface AuthenticatedRequest extends Request {
  authUser?: DecodedIdToken;
}

const getBearerToken = (req: Request) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const rawToken = req.headers['x-firebase-token'];
  if (typeof rawToken === 'string' && rawToken.trim().length > 0) {
    return rawToken.trim();
  }
  return null;
};

export const requireFirebaseAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Missing Firebase auth token' });
    }
    const decoded = await adminAuth.verifyIdToken(token);
    req.authUser = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid Firebase auth token' });
  }
};
