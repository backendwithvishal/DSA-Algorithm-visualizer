import { z } from 'zod';

// ── Password policy ────────────────────────────────────────────────────
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

// ── Auth Schemas ───────────────────────────────────────────────────────
export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name is too long').trim(),
  email: z.string().email('Invalid email address').max(254, 'Email is too long').toLowerCase(),
  password: passwordSchema
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address').max(254, 'Email is too long'),
  password: z.string().min(1, 'Password is required').max(128, 'Password is too long')
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address').max(254, 'Email is too long')
});

export const resetPasswordSchema = z.object({
  token: z.string().min(64, 'Token is invalid').max(128, 'Token is invalid'),
  email: z.string().email('Invalid email address').max(254, 'Email is too long'),
  password: passwordSchema
});

// verifyEmail now uses POST body (not query string)
export const verifyEmailSchema = z.object({
  token: z.string().min(64, 'Token is invalid').max(128, 'Token is invalid'),
  email: z.string().email('Invalid email address').max(254, 'Email is too long')
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Current password is required').max(128, 'Password is too long'),
  newPassword: passwordSchema
});

// ── User Schemas ───────────────────────────────────────────────────────
export const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).trim().optional(),
  avatar: z.string().url('Avatar must be a valid URL').optional()
});

export const adminUpdateUserSchema = z.object({
  role: z.enum(['owner', 'admin', 'manager', 'member', 'guest']).optional(),
  plan: z.enum(['free', 'starter', 'pro', 'business', 'enterprise']).optional(),
  status: z.enum(['active', 'suspended', 'deactivated']).optional()
});

// ── API Key Schemas ────────────────────────────────────────────────────
export const createApiKeySchema = z.object({
  name: z.string().min(1, 'Key name is required').max(50, 'Name must not exceed 50 characters').trim()
});

export const updateApiKeySchema = z.object({
  name: z.string().min(1).max(50).trim().optional(),
  isActive: z.boolean().optional()
});

// ── Analysis Schemas ───────────────────────────────────────────────────
export const analyzeSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .max(50_000, 'Code must not exceed 50,000 characters'),
  language: z
    .string()
    .min(1, 'Programming language is required')
    .max(50, 'Language name is too long')
    .trim(),
  array: z
    .array(z.number().int('Array elements must be integers').safe('Array values are out of safe range'))
    .max(100, 'Array must not exceed 100 elements')
    .optional()
});

// ── Contact Schema ─────────────────────────────────────────────────────
export const contactSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long').trim(),
  email: z.string().email('Invalid email address').max(254, 'Email is too long'),
  subject: z.string().min(1, 'Subject is required').max(200, 'Subject is too long').trim(),
  message: z.string().min(10, 'Message must be at least 10 characters').max(5000, 'Message is too long').trim()
});

// ── Chat Schema ────────────────────────────────────────────────────────
export const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1, 'Message content cannot be empty').max(4000, 'Message is too long')
      })
    )
    .min(1, 'Messages cannot be empty'),
  currentPath: z.string().max(2048).optional()
});
