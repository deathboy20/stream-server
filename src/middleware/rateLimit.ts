import { NextFunction, Request, Response } from 'express';

type RateLimiterOptions = {
  windowMs: number;
  maxRequests: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export const createRateLimiter = ({ windowMs, maxRequests }: RateLimiterOptions) => {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown';
    const now = Date.now();
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (current.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', retryAfterSeconds.toString());
      res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
      return;
    }

    current.count += 1;
    buckets.set(key, current);
    next();
  };
};
