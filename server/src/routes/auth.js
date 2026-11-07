import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import otplib from 'otplib';
import QRCode from 'qrcode';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';
import { registerUser, loginUser, signTokens } from '../services/auth.service.js';
import { sendMail } from '../services/mail.js';

const { authenticator } = otplib;
const router = Router();

const REFRESH_COOKIE = 'nw_refresh';
const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email');
const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters'),
  workspaceName: z.string().trim().min(2, 'Workspace name is required'),
});
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
  otp: z.string().optional(),
});
const forgotSchema = z.object({ email: emailSchema });
const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
const otpSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

function setRefreshCookie(res, userId) {
  const { refreshToken } = signTokens(userId);
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOpts);
}

// POST /api/auth/register
router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const user = await registerUser(req.body);
    const { accessToken } = signTokens(user._id);
    setRefreshCookie(res, user._id);
    res.status(201).json({ user: user.toSafeJSON(), accessToken });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login  (if 2FA is on, the first call returns 401 with code TWO_FACTOR_REQUIRED)
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const user = await loginUser(req.body);
    if (user.twoFactorEnabled) {
      const full = await User.findById(user._id).select('+twoFactorSecret');
      if (!req.body.otp) {
        return res.status(401).json({ code: 'TWO_FACTOR_REQUIRED', message: 'Enter the code from your authenticator app' });
      }
      if (!authenticator.check(req.body.otp, full.twoFactorSecret)) {
        return res.status(401).json({ code: 'BAD_OTP', message: 'That code is not valid' });
      }
    }
    const { accessToken } = signTokens(user._id);
    setRefreshCookie(res, user._id);
    res.json({ user: user.toSafeJSON(), accessToken });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh  (uses httpOnly refresh cookie)
router.post('/refresh', async (req, res) => {
  try {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) return res.status(401).json({ message: 'Not authenticated' });
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ message: 'Not authenticated' });
    const tokens = signTokens(user._id);
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOpts);
    res.json({ user: user.toSafeJSON(), accessToken: tokens.accessToken });
  } catch {
    res.status(401).json({ message: 'Session expired, please log in again' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(REFRESH_COOKIE, cookieOpts);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/auth/me  (profile + workspace name)
const profileSchema = z.object({
  name: z.string().trim().min(2).optional(),
  workspaceName: z.string().trim().min(2).optional(),
});
router.patch('/me', requireAuth, validate(profileSchema), async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(req.userId, req.body, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/forgot-password
// Always returns the same message so it does not reveal which emails exist.
router.post('/forgot-password', validate(forgotSchema), async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      user.resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
      user.resetExpires = new Date(Date.now() + 60 * 60 * 1000);
      await user.save();
      const base = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
      await sendMail({
        to: user.email,
        subject: 'Reset your Nexus Work password',
        text: `Open this link within 1 hour to reset your password:\n${base}/reset-password?token=${token}`,
      });
    }
    res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', validate(resetSchema), async (req, res, next) => {
  try {
    const hash = crypto.createHash('sha256').update(req.body.token).digest('hex');
    const user = await User.findOne({ resetTokenHash: hash, resetExpires: { $gt: new Date() } })
      .select('+resetTokenHash +resetExpires');
    if (!user) return res.status(400).json({ message: 'This reset link is invalid or has expired' });
    user.passwordHash = await bcrypt.hash(req.body.password, 12);
    user.resetTokenHash = undefined;
    user.resetExpires = undefined;
    await user.save();
    res.json({ ok: true, message: 'Password updated. You can log in now.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/2fa/setup  -> returns secret + QR code (data URL) for the authenticator app
router.post('/2fa/setup', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    const secret = authenticator.generateSecret();
    user.twoFactorSecret = secret;
    user.twoFactorEnabled = false;
    await user.save();
    const otpauth = authenticator.keyuri(user.email, 'Nexus Work', secret);
    const qr = await QRCode.toDataURL(otpauth);
    res.json({ secret, qr });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/2fa/enable  { code }  -> confirms the first code and turns 2FA on
router.post('/2fa/enable', requireAuth, validate(otpSchema), async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select('+twoFactorSecret');
    if (!user.twoFactorSecret) return res.status(400).json({ message: 'Run setup first' });
    if (!authenticator.check(req.body.code, user.twoFactorSecret)) {
      return res.status(400).json({ message: 'That code is not valid' });
    }
    user.twoFactorEnabled = true;
    await user.save();
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/2fa/disable  { code }
router.post('/2fa/disable', requireAuth, validate(otpSchema), async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select('+twoFactorSecret');
    if (!authenticator.check(req.body.code, user.twoFactorSecret)) {
      return res.status(400).json({ message: 'That code is not valid' });
    }
    user.twoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    await user.save();
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

export default router;
