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
import PendingSignup from '../models/PendingSignup.js';
import Invite from '../models/Invite.js';
import Membership from '../models/Membership.js';
import Workspace from '../models/Workspace.js';

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const WS_COOKIE = { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 365 };

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
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

const joinSchema = z.object({
  token: z.string().min(10),
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });
const otpSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

function setRefreshCookie(res, userId) {
  const { refreshToken } = signTokens(userId);
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOpts);
}

// POST /api/auth/register: emails a link. The account is created when the link is opened.
router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    if (await User.exists({ email: req.body.email })) {
      return res.status(409).json({ message: 'An account with this email already exists' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    await PendingSignup.findOneAndUpdate(
      { email: req.body.email },
      { name: req.body.name, workspaceName: req.body.workspaceName, passwordHash, tokenHash: sha(token), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      { upsert: true }
    );
    const base = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
    await sendMail({
      to: req.body.email,
      subject: 'Confirm your Nexus Work account',
      text: `Open this link to confirm your email and create your account (valid for 24 hours):\n${base}/verify?token=${token}\n\nIf you did not sign up, you can ignore this email.`,
    });
    res.status(202).json({ pending: true, message: 'We sent a link to your email. Open it to finish creating your account.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/verify { token }: creates the account from the emailed link and logs it in
router.post('/verify', validate(z.object({ token: z.string().min(10) })), async (req, res, next) => {
  try {
    const pending = await PendingSignup.findOne({ tokenHash: sha(req.body.token), expiresAt: { $gt: new Date() } }).select('+passwordHash');
    if (!pending) return res.status(400).json({ message: 'This link is invalid or has expired. Sign up again.' });
    if (await User.exists({ email: pending.email })) {
      await pending.deleteOne();
      return res.status(409).json({ message: 'An account with this email already exists. Log in instead.' });
    }
    const user = await User.create({ name: pending.name, email: pending.email, passwordHash: pending.passwordHash, workspaceName: pending.workspaceName });
    await pending.deleteOne();
    const { accessToken } = signTokens(user._id);
    setRefreshCookie(res, user._id);
    res.status(201).json({ user: user.toSafeJSON(), accessToken });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/invite?token= : what an invite is for (no login needed)
router.get('/invite', async (req, res, next) => {
  try {
    const inv = await Invite.findOne({ tokenHash: sha(String(req.query.token || '')), expiresAt: { $gt: new Date() } });
    if (!inv) return res.status(400).json({ message: 'This invite is invalid or has expired' });
    const ws = await Workspace.findById(inv.workspace, 'name').lean();
    res.json({
      email: inv.email,
      role: inv.role,
      workspaceName: ws?.name || 'the workspace',
      hasAccount: Boolean(await User.exists({ email: inv.email })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/invite/join { token, name, password, confirmPassword }: a new person sets a password and joins
router.post('/invite/join', validate(joinSchema), async (req, res, next) => {
  try {
    const inv = await Invite.findOne({ tokenHash: sha(req.body.token), expiresAt: { $gt: new Date() } });
    if (!inv) return res.status(400).json({ message: 'This invite is invalid or has expired' });
    if (await User.exists({ email: inv.email })) {
      return res.status(409).json({ message: 'This email already has an account. Log in, then open the invite link again.' });
    }
    const ws = await Workspace.findById(inv.workspace, 'name').lean();
    const user = await User.create({
      name: req.body.name,
      email: inv.email,
      passwordHash: await bcrypt.hash(req.body.password, 12),
      workspaceName: ws?.name || 'My Workspace',
    });
    await Membership.create({ workspace: inv.workspace, user: user._id, role: inv.role });
    await Invite.deleteOne({ _id: inv._id });
    const { accessToken } = signTokens(user._id);
    setRefreshCookie(res, user._id);
    res.cookie('ws', String(inv.workspace), WS_COOKIE);
    res.status(201).json({ user: user.toSafeJSON(), accessToken, workspaceName: ws?.name || '' });
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
