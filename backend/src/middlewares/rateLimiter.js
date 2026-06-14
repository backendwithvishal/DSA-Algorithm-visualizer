import rateLimit from 'express-rate-limit';
import { RateLimitError } from '../errors/ApiError.js';
import logger from '../utils/logger.js';
import config from '../config/index.js';

/**
 * Centralized rate-limit handler that passes a structured error through
 * the Express error middleware chain instead of sending a raw response.
 */
const limitHandler = (req, res, next, options) => {
  logger.warn(`Rate limit exceeded`, {
    ip: req.ip,
    path: req.originalUrl,
    correlationId: req.correlationId
  });
  next(new RateLimitError(options.message));
};

/**
 * Skip rate limiting in the test environment to avoid test interference.
 */
const bypassInTest = (limiterMiddleware) => (req, res, next) => {
  if (config.env === 'test') return next();
  return limiterMiddleware(req, res, next);
};

/**
 * General API rate limiter — applies to all /api/* routes.
 * Uses the default in-memory store (sufficient for single-instance deployments).
 * For multi-instance deployments, configure a Redis store via:
 *   npm install rate-limit-redis
 *   store: new RedisStore({ client: redisClient })
 */
export const generalLimiter = bypassInTest(rateLimit({
  windowMs: 15 * 60 * 1000,  // 15-minute window
  max: 150,                   // 150 requests per window per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Too many requests from this IP. Please try again after 15 minutes.',
  handler: limitHandler,
  keyGenerator: (req) => req.ip || 'unknown'
}));

/**
 * Strict limiter for authentication endpoints.
 * Protects against brute-force and credential stuffing attacks.
 */
export const authLimiter = bypassInTest(rateLimit({
  windowMs: 15 * 60 * 1000,  // 15-minute window
  max: 10,                    // 10 auth attempts per window per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Too many authentication attempts. Please wait 15 minutes.',
  handler: limitHandler,
  keyGenerator: (req) => req.ip || 'unknown',
  // Skip successful requests — only count failures
  skipSuccessfulRequests: false
}));

/**
 * Limiter for AI code analysis (resource-intensive endpoint).
 */
export const apiAnalysisLimiter = bypassInTest(rateLimit({
  windowMs: 60 * 60 * 1000,  // 1-hour window
  max: 30,                    // 30 analyses per hour per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Analysis rate limit reached. Please wait before analyzing more code.',
  handler: limitHandler,
  keyGenerator: (req) => {
    // Use user ID if authenticated, otherwise fall back to IP
    return req.user?._id?.toString() || req.ip || 'unknown';
  }
}));

/**
 * Limiter for general AI Chat inquiries.
 */
export const chatLimiter = bypassInTest(rateLimit({
  windowMs: 15 * 60 * 1000,  // 15-minute window
  max: 30,                    // 30 questions per 15 minutes per IP/User
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'You have reached your chat limit. Please wait a few minutes before sending another message.',
  handler: limitHandler,
  keyGenerator: (req) => {
    return req.user?._id?.toString() || req.ip || 'unknown';
  }
}));
