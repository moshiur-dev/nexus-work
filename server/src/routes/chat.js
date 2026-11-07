import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loadRole, requirePermission } from '../middleware/role.js';
import Channel from '../models/Channel.js';
import Message from '../models/Message.js';
import Membership from '../models/Membership.js';
import User from '../models/User.js';
import { publish } from '../services/events.js';

// Mounted at /api/chat
const router = Router();
router.use(requireAuth, loadRole, requirePermission('read'));

const badId = (id) => !mongoose.isValidObjectId(id);
const me = (req) => new mongoose.Types.ObjectId(String(req.userId));

// Every workspace gets a #general channel the first time chat is opened
async function ensureGeneral(req) {
  const exists = await Channel.exists({ workspace: req.workspaceId, kind: 'channel' });
  if (!exists) await Channel.create({ workspace: req.workspaceId, kind: 'channel', name: 'general', createdBy: req.userId });
}

// A channel the caller may see: any workspace channel, or a DM they are part of
async function findVisible(req, id) {
  if (badId(id)) return null;
  const ch = await Channel.findOne({ _id: id, workspace: req.workspaceId });
  if (!ch) return null;
  if (ch.kind === 'dm' && !ch.members.some((m) => String(m) === String(req.userId))) return null;
  return ch;
}

// GET /api/chat/channels: channels and the caller's DMs
router.get('/channels', async (req, res, next) => {
  try {
    await ensureGeneral(req);
    const list = await Channel.find({
      workspace: req.workspaceId,
      $or: [{ kind: 'channel' }, { kind: 'dm', members: me(req) }],
    }).sort({ kind: 1, name: 1, lastMessageAt: -1 }).lean();
    res.json({ data: list });
  } catch (err) {
    next(err);
  }
});

const channelSchema = z.object({
  name: z.string().trim().toLowerCase().min(1, 'Channel name is required').max(60)
    .regex(/^[a-z0-9][a-z0-9 _-]*$/, 'Use letters, numbers, spaces, - or _')
    .transform((s) => s.replace(/\s+/g, '-')),
});

router.post('/channels', requirePermission('write'), validate(channelSchema), async (req, res, next) => {
  try {
    if (await Channel.exists({ workspace: req.workspaceId, kind: 'channel', name: req.body.name })) {
      return res.status(409).json({ message: `#${req.body.name} already exists` });
    }
    const ch = await Channel.create({ workspace: req.workspaceId, kind: 'channel', name: req.body.name, createdBy: req.userId });
    res.status(201).json({ data: ch });
  } catch (err) {
    next(err);
  }
});

// Delete a channel and its messages (admins and owners; #general stays)
router.delete('/channels/:id', requirePermission('manage'), async (req, res, next) => {
  try {
    const ch = await findVisible(req, req.params.id);
    if (!ch || ch.kind !== 'channel') return res.status(404).json({ message: 'Channel not found' });
    if (ch.name === 'general') return res.status(400).json({ message: '#general cannot be deleted' });
    await Promise.all([ch.deleteOne(), Message.deleteMany({ channel: ch._id })]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/dm { userId }: open (or create) the DM with another member, or with yourself for notes
router.post('/dm', requirePermission('chat'), validate(z.object({ userId: z.string().min(1) })), async (req, res, next) => {
  try {
    const other = req.body.userId;
    if (badId(other) || !(await Membership.exists({ workspace: req.workspaceId, user: other }))) {
      return res.status(404).json({ message: 'Member not found' });
    }
    const pair = [String(req.userId), String(other)].sort();
    const dmKey = pair.join(':');
    const ch = await Channel.findOneAndUpdate(
      { workspace: req.workspaceId, kind: 'dm', dmKey },
      { $setOnInsert: { workspace: req.workspaceId, kind: 'dm', dmKey, members: [...new Set(pair)], createdBy: req.userId } },
      { upsert: true, new: true }
    );
    res.json({ data: ch });
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/channels/:id/messages?after=<iso>  (newest 100, or only newer than "after" when polling)
router.get('/channels/:id/messages', async (req, res, next) => {
  try {
    const ch = await findVisible(req, req.params.id);
    if (!ch) return res.status(404).json({ message: 'Channel not found' });
    const filter = { channel: ch._id };
    const after = req.query.after ? new Date(req.query.after) : null;
    if (after && !isNaN(after)) filter.createdAt = { $gt: after };
    const msgs = (await Message.find(filter).sort({ createdAt: -1 }).limit(100).lean()).reverse();
    const ids = [...new Set(msgs.map((m) => String(m.author)))];
    const users = Object.fromEntries((await User.find({ _id: { $in: ids } }, 'name').lean()).map((u) => [String(u._id), u.name]));
    res.json({ data: msgs.map((m) => ({ ...m, authorName: users[String(m.author)] || 'Former member' })) });
  } catch (err) {
    next(err);
  }
});

const messageSchema = z.object({ body: z.string().trim().min(1, 'Message is empty').max(4000) });

router.post('/channels/:id/messages', requirePermission('chat'), validate(messageSchema), async (req, res, next) => {
  try {
    const ch = await findVisible(req, req.params.id);
    if (!ch) return res.status(404).json({ message: 'Channel not found' });
    const msg = await Message.create({ workspace: req.workspaceId, channel: ch._id, author: req.userId, body: req.body.body });
    await Channel.updateOne({ _id: ch._id }, { lastMessageAt: msg.createdAt });
    publish(req.workspaceId, { type: 'message', channel: String(ch._id), by: req.get('x-client-id') || String(req.userId) }, ch.kind === 'dm' ? ch.members : null);
    const u = await User.findById(req.userId, 'name').lean();
    res.status(201).json({ data: { ...msg.toObject(), authorName: u?.name } });
  } catch (err) {
    next(err);
  }
});

// Authors delete their own messages; admins and owners can delete any
router.delete('/messages/:id', requirePermission('chat'), async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'Message not found' });
    const msg = await Message.findOne({ _id: req.params.id, workspace: req.workspaceId });
    if (!msg || !(await findVisible(req, msg.channel))) return res.status(404).json({ message: 'Message not found' });
    if (String(msg.author) !== String(req.userId) && !['owner', 'admin'].includes(req.role)) {
      return res.status(403).json({ message: 'You can only delete your own messages' });
    }
    await msg.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
