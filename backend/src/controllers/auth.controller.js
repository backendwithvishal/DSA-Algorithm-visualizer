import crypto from 'crypto';
import User from '../models/User.js';
import Session from '../models/Session.js';
import RefreshToken from '../models/RefreshToken.js';
import SecurityEvent from '../models/SecurityEvent.js';
import UserPreference from '../models/UserPreference.js';
import PasetoService from '../services/paseto.service.js';
import { emailQueue } from '../queues/queue.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { BadRequestError, UnauthorizedError, ForbiddenError, NotFoundError } from '../errors/ApiError.js';
import logger from '../utils/logger.js';
import config from '../config/index.js';

// ── Constants ────────────────────────────────────────────────────────
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ACCESS_TOKEN_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Build a cookie options object with secure defaults.
 */
function makeCookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge
  };
}

/**
 * Extract device information from the request's User-Agent header.
 * @param {import('express').Request} req
 * @returns {{ userAgent: string, browser: string, os: string, deviceType: string, ipAddress: string }}
 */
function getDeviceDetails(req) {
  const ua = req.headers['user-agent'] || 'Unknown';
  let browser = 'Unknown';
  let os = 'Unknown';
  let deviceType = 'desktop';

  if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edg')) browser = 'Edge';
  else if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('curl')) browser = 'curl';

  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Macintosh')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('iPhone') || ua.includes('iPad')) {
    os = 'iOS';
    deviceType = 'mobile';
  } else if (ua.includes('Android')) {
    os = 'Android';
    deviceType = 'mobile';
  }

  // req.ip is set by express-rate-limit / proxy middleware
  const ipAddress = req.ip || req.socket?.remoteAddress || 'Unknown';

  return { userAgent: ua, browser, os, deviceType, ipAddress };
}

/**
 * Hash a token with SHA-256 before storing.
 * @param {string} token
 * @returns {string}
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Log a security event to the database (non-blocking, errors only logged).
 */
async function logSecurityEvent(data) {
  try {
    await SecurityEvent.create(data);
  } catch (err) {
    logger.error('Failed to save security event:', err);
  }
}

export class AuthController {
  // ── Register ───────────────────────────────────────────────────────
  static async register(req, res, next) {
    try {
      const { name, email, password } = req.validatedBody;

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        throw new BadRequestError('An account with this email already exists');
      }

      const user = await User.create({ name, email, password });

      // Create default user preferences
      await UserPreference.create({ userId: user._id }).catch(err => {
        logger.warn(`Failed to create user preferences for ${user._id}:`, err);
      });

      // Generate email verification token
      const verifyToken = crypto.randomBytes(32).toString('hex');
      const verifyTokenHash = hashToken(verifyToken);

      user.emailVerifyHash = verifyTokenHash;
      user.emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      await user.save();

      // Queue welcome and verification emails (non-blocking)
      if (emailQueue) {
        await emailQueue.add('welcome_email', { type: 'welcome', data: { user: { name: user.name, email: user.email } } });
        await emailQueue.add('verify_email', { type: 'verify', data: { user: { name: user.name, email: user.email }, token: verifyToken } });
      }

      // ── Automatic Login on Successful Registration ─────────────────
      const device = getDeviceDetails(req);
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

      // Create session record
      const session = await Session.create({
        userId: user._id,
        browser: device.browser,
        os: device.os,
        deviceType: device.deviceType,
        ipAddress: device.ipAddress,
        userAgent: device.userAgent,
        expiresAt,
        refreshTokHash: 'initializing'
      });

      // Generate and store refresh token
      const refreshToken = await PasetoService.generateRefreshToken({
        userId: user._id.toString(),
        sessionId: session._id.toString()
      });
      const refreshHash = hashToken(refreshToken);

      session.refreshTokHash = refreshHash;
      await session.save();

      await RefreshToken.create({ userId: user._id, token: refreshHash, expiresAt });

      // Generate access token
      const accessToken = await PasetoService.generateAccessToken({
        userId: user._id.toString(),
        sessionId: session._id.toString(),
        role: user.role,
        plan: user.plan
      });

      // Log successful login
      await logSecurityEvent({
        userId: user._id,
        email: user.email,
        eventType: 'login',
        ipAddress: device.ipAddress,
        userAgent: device.userAgent
      });

      // Set cookies
      res.cookie('refreshToken', refreshToken, makeCookieOptions(REFRESH_TOKEN_EXPIRY_MS));
      res.cookie('accessToken', accessToken, makeCookieOptions(ACCESS_TOKEN_EXPIRY_MS));

      return ApiResponse.success(res, {
        accessToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          role: user.role,
          plan: user.plan,
          emailVerified: user.emailVerified,
          mfaEnabled: user.mfaEnabled,
          createdAt: user.createdAt
        }
      }, 'Registration successful! Please check your email to verify your account.', 201);
    } catch (err) {
      next(err);
    }
  }

  // ── Login ──────────────────────────────────────────────────────────
  static async login(req, res, next) {
    try {
      const { email, password } = req.validatedBody;
      const device = getDeviceDetails(req);

      // Always select password for comparison
      const user = await User.findOne({ email }).select('+password');
      if (!user) {
        // Timing-safe: don't reveal whether email exists
        await bcryptTimingDelay();
        throw new UnauthorizedError('Invalid email or password');
      }

      // Check account lock
      if (user.isLocked()) {
        const lockMinutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
        throw new ForbiddenError(`Account is temporarily locked. Try again in ${lockMinutes} minute${lockMinutes !== 1 ? 's' : ''}.`);
      }

      const isMatch = await user.comparePassword(password);

      if (!isMatch) {
        user.failedLoginAttempts += 1;

        await logSecurityEvent({
          userId: user._id,
          email: user.email,
          eventType: 'failed_login',
          ipAddress: device.ipAddress,
          userAgent: device.userAgent
        });

        if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
          user.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
          await user.save();

          await logSecurityEvent({
            userId: user._id,
            email: user.email,
            eventType: 'lockout',
            ipAddress: device.ipAddress,
            userAgent: device.userAgent
          });

          if (emailQueue) {
            await emailQueue.add('lockout_email', { type: 'lockout', data: { user: { name: user.name, email: user.email } } });
          }

          throw new ForbiddenError('Account locked due to too many failed attempts. A security alert has been sent to your email.');
        }

        await user.save();
        throw new UnauthorizedError('Invalid email or password');
      }

      // ── Login successful ──────────────────────────────────────────
      user.failedLoginAttempts = 0;
      user.lockUntil = null;
      await user.save();

      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

      // Create session record
      const session = await Session.create({
        userId: user._id,
        browser: device.browser,
        os: device.os,
        deviceType: device.deviceType,
        ipAddress: device.ipAddress,
        userAgent: device.userAgent,
        expiresAt,
        refreshTokHash: 'initializing' // Placeholder updated below
      });

      // Generate and store refresh token
      const refreshToken = await PasetoService.generateRefreshToken({
        userId: user._id.toString(),
        sessionId: session._id.toString()
      });
      const refreshHash = hashToken(refreshToken);

      session.refreshTokHash = refreshHash;
      await session.save();

      await RefreshToken.create({ userId: user._id, token: refreshHash, expiresAt });

      // Generate access token
      const accessToken = await PasetoService.generateAccessToken({
        userId: user._id.toString(),
        sessionId: session._id.toString(),
        role: user.role,
        plan: user.plan
      });

      // Log successful login
      await logSecurityEvent({
        userId: user._id,
        email: user.email,
        eventType: 'login',
        ipAddress: device.ipAddress,
        userAgent: device.userAgent
      });

      // Send login alert email asynchronously
      if (emailQueue) {
        await emailQueue.add('login_alert_email', {
          type: 'login_alert',
          data: {
            user: { name: user.name, email: user.email },
            session: { os: device.os, browser: device.browser, ipAddress: device.ipAddress, deviceType: device.deviceType }
          }
        });
      }

      // Set refresh token as httpOnly cookie
      res.cookie('refreshToken', refreshToken, makeCookieOptions(REFRESH_TOKEN_EXPIRY_MS));
      res.cookie('accessToken', accessToken, makeCookieOptions(ACCESS_TOKEN_EXPIRY_MS));
      
      // Access token is returned in the response body (not cookie) so the
      // frontend can attach it to Authorization headers
      return ApiResponse.success(res, {
        accessToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          role: user.role,
          plan: user.plan,
          emailVerified: user.emailVerified,
          mfaEnabled: user.mfaEnabled,
          createdAt: user.createdAt
        }
      }, 'Login successful');
    } catch (err) {
      next(err);
    }
  }

  // ── Token Refresh (with rotation & reuse detection) ──────────────
  static async refresh(req, res, next) {
    try {
      const oldRefreshToken = req.cookies?.refreshToken;
      if (!oldRefreshToken) {
        throw new UnauthorizedError('Refresh token is missing');
      }

      const decoded = await PasetoService.verifyRefreshToken(oldRefreshToken);
      const oldHash = hashToken(oldRefreshToken);

      const tokenDoc = await RefreshToken.findOne({ token: oldHash });
      if (!tokenDoc) {
        throw new UnauthorizedError('Invalid refresh token');
      }

      // Reuse Detection: Token was already consumed — possible compromise
      if (tokenDoc.isUsed || tokenDoc.isRevoked) {
        await Session.updateMany({ userId: decoded.userId }, { isRevoked: true });
        await RefreshToken.updateMany({ userId: decoded.userId }, { isRevoked: true });
        res.clearCookie('refreshToken', { path: '/' });

        await logSecurityEvent({
          userId: decoded.userId,
          email: 'unknown',
          eventType: 'token_reuse',
          ipAddress: req.ip || 'Unknown',
          userAgent: req.headers['user-agent'] || 'Unknown'
        });

        logger.error(`Security Alert: Refresh token reuse detected for user ${decoded.userId}. All sessions revoked.`);
        throw new ForbiddenError('Security breach detected. All sessions have been terminated. Please log in again.');
      }

      const session = await Session.findOne({ _id: decoded.sessionId, isRevoked: false });
      if (!session) {
        throw new UnauthorizedError('Session has expired or been revoked');
      }

      // Mark old token as consumed
      tokenDoc.isUsed = true;

      // Generate new refresh token
      const newRefreshToken = await PasetoService.generateRefreshToken({
        userId: decoded.userId,
        sessionId: decoded.sessionId
      });
      const newHash = hashToken(newRefreshToken);

      tokenDoc.replacedByToken = newHash;
      await tokenDoc.save();

      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
      await RefreshToken.create({ userId: decoded.userId, token: newHash, expiresAt });

      session.refreshTokHash = newHash;
      session.lastActive = new Date();
      await session.save();

      const user = await User.findById(decoded.userId);
      if (!user) throw new UnauthorizedError('User not found');

      const accessToken = await PasetoService.generateAccessToken({
        userId: user._id.toString(),
        sessionId: session._id.toString(),
        role: user.role,
        plan: user.plan
      });

      res.cookie('refreshToken', newRefreshToken, makeCookieOptions(REFRESH_TOKEN_EXPIRY_MS));
      res.cookie('accessToken', accessToken, makeCookieOptions(ACCESS_TOKEN_EXPIRY_MS));

      return ApiResponse.success(res, {
        accessToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          role: user.role,
          plan: user.plan,
          emailVerified: user.emailVerified,
          mfaEnabled: user.mfaEnabled,
          createdAt: user.createdAt
        }
      }, 'Tokens refreshed successfully');
    } catch (err) {
      next(err);
    }
  }

  // ── Logout ─────────────────────────────────────────────────────────
  static async logout(req, res, next) {
    try {
      if (req.session) {
        req.session.isRevoked = true;
        await req.session.save();
        await RefreshToken.updateMany({ token: req.session.refreshTokHash }, { isRevoked: true });
      }

      res.clearCookie('refreshToken', { path: '/' });
      res.clearCookie('accessToken', { path: '/' });

      return ApiResponse.success(res, null, 'Logged out successfully');
    } catch (err) {
      next(err);
    }
  }

  // ── Logout All Devices ─────────────────────────────────────────────
  static async logoutAll(req, res, next) {
    try {
      await Session.updateMany({ userId: req.user._id }, { isRevoked: true });
      await RefreshToken.updateMany({ userId: req.user._id }, { isRevoked: true });

      await logSecurityEvent({
        userId: req.user._id,
        email: req.user.email,
        eventType: 'logout_all',
        ipAddress: req.ip || 'Unknown',
        userAgent: req.headers['user-agent'] || 'Unknown'
      });

      res.clearCookie('refreshToken', { path: '/' });
      res.clearCookie('accessToken', { path: '/' });

      return ApiResponse.success(res, null, 'All sessions terminated successfully');
    } catch (err) {
      next(err);
    }
  }

  // ── Forgot Password ────────────────────────────────────────────────
  static async forgotPassword(req, res, next) {
    try {
      const { email } = req.validatedBody;

      // Always return success to prevent email enumeration
      const successMessage = 'If this email is registered, a password reset link will be sent.';

      const user = await User.findOne({ email });
      if (!user) {
        return ApiResponse.success(res, null, successMessage);
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetHash = hashToken(resetToken);

      user.passwordResetHash = resetHash;
      user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await user.save();

      if (emailQueue) {
        await emailQueue.add('forgot_password_email', {
          type: 'forgot',
          data: { user: { name: user.name, email: user.email }, token: resetToken }
        });
      }

      return ApiResponse.success(res, null, successMessage);
    } catch (err) {
      next(err);
    }
  }

  // ── Reset Password ─────────────────────────────────────────────────
  static async resetPassword(req, res, next) {
    try {
      const { token, email, password } = req.validatedBody;

      // Select password reset fields explicitly (they are select:false)
      const user = await User.findOne({ email }).select('+passwordResetHash +passwordResetExpires');
      if (!user) {
        throw new BadRequestError('Invalid or expired password reset link');
      }

      const resetHash = hashToken(token);

      if (
        !user.passwordResetHash ||
        user.passwordResetHash !== resetHash ||
        !user.passwordResetExpires ||
        user.passwordResetExpires < new Date()
      ) {
        throw new BadRequestError('Invalid or expired password reset link');
      }

      user.password = password;
      user.passwordResetHash = null;
      user.passwordResetExpires = null;

      // Revoke all sessions for security
      await Promise.all([
        Session.updateMany({ userId: user._id }, { isRevoked: true }),
        RefreshToken.updateMany({ userId: user._id }, { isRevoked: true })
      ]);

      await logSecurityEvent({
        userId: user._id,
        email: user.email,
        eventType: 'password_reset',
        ipAddress: req.ip || 'Unknown',
        userAgent: req.headers['user-agent'] || 'Unknown'
      });

      await user.save();

      return ApiResponse.success(res, null, 'Password has been reset. Please log in with your new password.');
    } catch (err) {
      next(err);
    }
  }

  // ── Change Password (Authenticated) ──────────────────────────────
  static async changePassword(req, res, next) {
    try {
      const { oldPassword, newPassword } = req.validatedBody;

      const user = await User.findById(req.user._id).select('+password');
      if (!user || !(await user.comparePassword(oldPassword))) {
        throw new BadRequestError('Current password is incorrect');
      }

      user.password = newPassword;
      await user.save();

      // Revoke all other sessions (keep current)
      const currentSessionId = req.session?._id;
      await Promise.all([
        Session.updateMany({ userId: user._id, _id: { $ne: currentSessionId } }, { isRevoked: true }),
        RefreshToken.updateMany({
          userId: user._id,
          token: { $ne: req.session?.refreshTokHash }
        }, { isRevoked: true })
      ]);

      await logSecurityEvent({
        userId: user._id,
        email: user.email,
        eventType: 'password_change',
        ipAddress: req.ip || 'Unknown',
        userAgent: req.headers['user-agent'] || 'Unknown'
      });

      return ApiResponse.success(res, null, 'Password changed successfully. Other sessions have been terminated.');
    } catch (err) {
      next(err);
    }
  }

  // ── Verify Email (via POST body — token never in query string) ─────
  static async verifyEmail(req, res, next) {
    try {
      const { token, email } = req.validatedBody;

      // Select verification fields (select:false)
      const user = await User.findOne({ email }).select('+emailVerifyHash +emailVerifyExpires');
      if (!user) {
        throw new NotFoundError('User not found');
      }

      if (user.emailVerified) {
        return ApiResponse.success(res, null, 'Email is already verified');
      }

      const hash = hashToken(token);

      if (
        !user.emailVerifyHash ||
        user.emailVerifyHash !== hash ||
        !user.emailVerifyExpires ||
        user.emailVerifyExpires < new Date()
      ) {
        throw new BadRequestError('Invalid or expired email verification link. Please request a new one.');
      }

      user.emailVerified = true;
      user.emailVerifyHash = null;
      user.emailVerifyExpires = null;
      await user.save();

      return ApiResponse.success(res, null, 'Email verified successfully!');
    } catch (err) {
      next(err);
    }
  }

  // ── Resend Verification Email ──────────────────────────────────────
  static async resendVerification(req, res, next) {
    try {
      const { email } = req.body;

      // Always respond with success to prevent email enumeration
      const successMessage = 'If this email is registered and unverified, a new verification link has been sent.';

      const user = await User.findOne({ email }).select('+emailVerifyHash +emailVerifyExpires');
      if (!user || user.emailVerified) {
        return ApiResponse.success(res, null, successMessage);
      }

      const verifyToken = crypto.randomBytes(32).toString('hex');
      const verifyTokenHash = hashToken(verifyToken);

      user.emailVerifyHash = verifyTokenHash;
      user.emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await user.save();

      if (emailQueue) {
        await emailQueue.add('verify_email', {
          type: 'verify',
          data: { user: { name: user.name, email: user.email }, token: verifyToken }
        });
      }

      return ApiResponse.success(res, null, successMessage);
    } catch (err) {
      next(err);
    }
  }

  // ── Deactivate Account ─────────────────────────────────────────────
  static async deactivate(req, res, next) {
    try {
      const user = await User.findById(req.user._id);
      if (!user) throw new NotFoundError('User not found');

      user.status = 'deactivated';
      await user.save();

      await Promise.all([
        Session.updateMany({ userId: user._id }, { isRevoked: true }),
        RefreshToken.updateMany({ userId: user._id }, { isRevoked: true })
      ]);

      await logSecurityEvent({
        userId: user._id,
        email: user.email,
        eventType: 'account_deactivated',
        ipAddress: req.ip || 'Unknown',
        userAgent: req.headers['user-agent'] || 'Unknown'
      });

      res.clearCookie('refreshToken', { path: '/' });
      res.clearCookie('accessToken', { path: '/' });

      return ApiResponse.success(res, null, 'Account deactivated successfully');
    } catch (err) {
      next(err);
    }
  }

  // ── Get Active Sessions ────────────────────────────────────────────
  static async getSessions(req, res, next) {
    try {
      const sessions = await Session.find({
        userId: req.user._id,
        isRevoked: false,
        expiresAt: { $gt: new Date() }
      }).sort({ createdAt: -1 });

      const sanitized = sessions.map(s => ({
        id: s._id,
        browser: s.browser,
        os: s.os,
        deviceType: s.deviceType,
        ipAddress: s.ipAddress,
        lastActive: s.lastActive,
        createdAt: s.createdAt,
        isCurrent: req.session?._id?.toString() === s._id.toString()
      }));

      return ApiResponse.success(res, sanitized, 'Active sessions retrieved');
    } catch (err) {
      next(err);
    }
  }

  // ── Revoke Specific Session ────────────────────────────────────────
  static async revokeSession(req, res, next) {
    try {
      const { sessionId } = req.params;

      const session = await Session.findOne({ _id: sessionId, userId: req.user._id });
      if (!session) throw new NotFoundError('Session not found');

      session.isRevoked = true;
      await session.save();

      await RefreshToken.updateMany({ token: session.refreshTokHash }, { isRevoked: true });

      return ApiResponse.success(res, null, 'Session revoked successfully');
    } catch (err) {
      next(err);
    }
  }
}

/**
 * Timing-safe delay to prevent user enumeration via response time differences.
 * Simulates a bcrypt comparison when no user is found.
 */
async function bcryptTimingDelay() {
  // Approximately equal to bcrypt compare time at cost 12
  await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 100));
}

export default AuthController;
