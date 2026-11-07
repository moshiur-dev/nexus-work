import { Router } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ensureWorkspace, loadRole, requirePermission } from '../middleware/role.js';
import Workspace from '../models/Workspace.js';
import Membership from '../models/Membership.js';
import Invite from '../models/Invite.js';
import User from '../models/User.js';
import { ROLES } from '../utils/permissions.js';
import { sendMail } from '../services/mail.js';

const router = Router();
router.use(requireAuth);

const INVITE_ROLES = ROLES.filter((r) => r !== 'owner');
const WS_COOKIE = { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 365 };
const INVITE_DAYS = 7;
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const badId = (id) => !mongoose.isValidObjectId(id);

// These routes work before the user has an active workspace
router.get('/list', async (req, res, next) => {
  try {
    await ensureWorkspace(req.userId);
    const memberships = await Membership.find({ user: req.userId }).populate('workspace', 'name').sort({ createdAt: 1 });
    res.json({
      data: memberships
        .filter((m) => m.workspace)
        .map((m) => ({ id: m.workspace._id, name: m.workspace.name, role: m.role })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/switch', validate(z.object({ workspaceId: z.string().min(1) })), async (req, res, next) => {
  try {
    if (badId(req.body.workspaceId)) return res.status(404).json({ message: 'Workspace not found' });
    const m = await Membership.findOne({ user: req.userId, workspace: req.body.workspaceId });
    if (!m) return res.status(404).json({ message: 'Workspace not found' });
    res.cookie('ws', String(m.workspace), WS_COOKIE);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Accepting an invite: the logged-in user must be the email the invite was sent to
router.post('/invites/accept', validate(z.object({ token: z.string().min(10) })), async (req, res, next) => {
  try {
    const invite = await Invite.findOne({ tokenHash: hash(req.body.token), expiresAt: { $gt: new Date() } });
    if (!invite) return res.status(400).json({ message: 'This invite is invalid or has expired' });
    const user = await User.findById(req.userId);
    if (!user || user.email !== invite.email) {
      return res.status(403).json({ message: 'This invite was sent to a different email address' });
    }
    // $setOnInsert: accepting an invite never changes an existing role
    await Membership.updateOne(
      { workspace: invite.workspace, user: req.userId },
      { $setOnInsert: { role: invite.role } },
      { upsert: true }
    );
    await Invite.deleteOne({ _id: invite._id });
    const ws = await Workspace.findById(invite.workspace);
    res.cookie('ws', String(invite.workspace), WS_COOKIE);
    res.json({ ok: true, workspaceName: ws?.name });
  } catch (err) {
    next(err);
  }
});

// From here on, the active workspace and the caller's role are loaded
router.use(loadRole);

// GET /api/workspace: name, the caller's role, and the members
router.get('/', async (req, res, next) => {
  try {
    const ws = await Workspace.findById(req.workspaceId);
    const members = await Membership.find({ workspace: req.workspaceId }).populate('user', 'name email').sort({ createdAt: 1 });
    res.json({
      id: ws._id,
      name: ws.name,
      role: req.role,
      members: members
        .filter((m) => m.user)
        .map((m) => ({ userId: m.user._id, name: m.user.name, email: m.user.email, role: m.role })),
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/', requirePermission('manage'), validate(z.object({ name: z.string().trim().min(1).max(100) })), async (req, res, next) => {
  try {
    const ws = await Workspace.findByIdAndUpdate(req.workspaceId, { name: req.body.name }, { new: true });
    res.json({ id: ws._id, name: ws.name });
  } catch (err) {
    next(err);
  }
});

// Change a member's role. Only the owner can touch admins. The owner role can never be changed here.
router.patch('/members/:userId', requirePermission('manage'), validate(z.object({ role: z.enum(INVITE_ROLES) })), async (req, res, next) => {
  try {
    if (badId(req.params.userId)) return res.status(404).json({ message: 'Member not found' });
    const target = await Membership.findOne({ workspace: req.workspaceId, user: req.params.userId });
    if (!target) return res.status(404).json({ message: 'Member not found' });
    if (target.role === 'owner') return res.status(403).json({ message: 'The owner role cannot be changed' });
    if ((target.role === 'admin' || req.body.role === 'admin') && req.role !== 'owner') {
      return res.status(403).json({ message: 'Only the owner can manage admins' });
    }
    target.role = req.body.role;
    await target.save();
    res.json({ ok: true, role: target.role });
  } catch (err) {
    next(err);
  }
});

// Remove a member from the workspace (their own items stay in the workspace)
router.delete('/members/:userId', requirePermission('manage'), async (req, res, next) => {
  try {
    if (badId(req.params.userId)) return res.status(404).json({ message: 'Member not found' });
    const target = await Membership.findOne({ workspace: req.workspaceId, user: req.params.userId });
    if (!target) return res.status(404).json({ message: 'Member not found' });
    if (target.role === 'owner') return res.status(403).json({ message: 'The owner cannot be removed' });
    if (target.role === 'admin' && req.role !== 'owner') {
      return res.status(403).json({ message: 'Only the owner can remove admins' });
    }
    await target.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Send an invite by email (7 day link)
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  role: z.enum(INVITE_ROLES),
});
router.post('/invites', requirePermission('manage'), validate(inviteSchema), async (req, res, next) => {
  try {
    const { email, role } = req.body;
    if (role === 'admin' && req.role !== 'owner') {
      return res.status(403).json({ message: 'Only the owner can invite admins' });
    }
    const existingUser = await User.findOne({ email });
    if (existingUser && (await Membership.exists({ workspace: req.workspaceId, user: existingUser._id }))) {
      return res.status(409).json({ message: 'This person is already a member' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    await Invite.deleteMany({ workspace: req.workspaceId, email });
    await Invite.create({
      workspace: req.workspaceId,
      email,
      role,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
      invitedBy: req.userId,
    });

    const ws = await Workspace.findById(req.workspaceId);
    const link = `${process.env.CLIENT_ORIGIN}/invite?token=${token}`;
    await sendMail({
      to: email,
      subject: `You're invited to ${ws.name} on Nexus`,
      text: `You have been invited to join ${ws.name} as ${role}.\n\nAccept the invite within ${INVITE_DAYS} days:\n${link}\n\nIf you did not expect this, you can ignore this email.`,
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/invites', requirePermission('manage'), async (req, res, next) => {
  try {
    const invites = await Invite.find({ workspace: req.workspaceId, expiresAt: { $gt: new Date() } })
      .select('email role expiresAt createdAt')
      .sort({ createdAt: -1 });
    res.json({ data: invites });
  } catch (err) {
    next(err);
  }
});

router.delete('/invites/:id', requirePermission('manage'), async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'Invite not found' });
    const removed = await Invite.findOneAndDelete({ _id: req.params.id, workspace: req.workspaceId });
    if (!removed) return res.status(404).json({ message: 'Invite not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
