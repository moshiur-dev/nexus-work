import { Router } from 'express';
import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loadRole, requirePermission } from '../middleware/role.js';
import Task from '../models/Task.js';
import Item from '../models/Item.js';
import List from '../models/List.js';
import Membership from '../models/Membership.js';
import mongoose from 'mongoose';
import Comment from '../models/Comment.js';
import User from '../models/User.js';
import Media from '../models/Media.js';
import { removeTaskData, removeFiles } from '../services/cleanup.js';
import * as storage from '../services/storage.js';
import { statusesOf } from '../services/statuses.js';
import { notify } from '../services/notify.js';
import { publish } from '../services/events.js';

const router = Router();
router.use(requireAuth, loadRole);

// Every successful change to /:taskId/... tells open apps in the workspace to refresh that task
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  const m = req.path.match(/^\/([0-9a-fA-F]{24})(\/|$)/);
  if (m) {
    res.on('finish', () => {
      if (res.statusCode < 400) publish(req.workspaceId, { type: 'task', id: m[1], list: res.locals.list || null, by: req.get('x-client-id') || String(req.userId) });
    });
  }
  next();
});

// No defaults on the base schema: a PATCH must not reset fields the client did not send.
const taskSchema = z.object({
  name: z.string().trim().min(1, 'Task name is required').max(200),
  status: z.string().trim().min(1).max(40),
  dueDate: z.string().datetime().optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20),
  list: z.string().nullable(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).nullable(),
  assignees: z.array(z.string()).max(20),
  timeEstimate: z.number().int().min(0).max(100000).nullable(), // minutes
  description: z.string().max(5000),
  startDate: z.string().datetime().nullable(),
  blockedBy: z.array(z.string()).max(50),
  recurrence: z.object({ every: z.enum(['day', 'week', 'month']), interval: z.number().int().min(1).max(365) }).nullable(),
});
const createSchema = taskSchema.extend({
  status: z.string().trim().min(1).max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
  list: z.string().nullable().default(null),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).nullable().default(null),
  assignees: z.array(z.string()).max(20).default([]),
  timeEstimate: z.number().int().min(0).max(100000).nullable().default(null),
  description: z.string().max(5000).default(''),
  startDate: z.string().datetime().nullable().default(null),
  blockedBy: z.array(z.string()).max(50).default([]),
  recurrence: z.object({ every: z.enum(['day', 'week', 'month']), interval: z.number().int().min(1).max(365) }).nullable().default(null),
});
const updateSchema = taskSchema.partial();

const badId = (id) => !mongoose.isValidObjectId(id);

// Checks the list, assignees and status against the workspace, and sets `closed` from the status.
// `existing` is the task before a PATCH (null when creating).
async function prepare(req, existing) {
  const body = req.body;
  const listId = body.list !== undefined ? body.list : existing?.list;
  let list = null;
  if (listId) {
    if (badId(listId)) return 'List not found';
    list = await List.findOne({ _id: listId, workspace: req.workspaceId });
    if (!list) return 'List not found';
  }
  if (body.assignees) {
    const ids = [...new Set(body.assignees)];
    if (ids.some(badId)) return 'Assignee is not a member of this workspace';
    const count = await Membership.countDocuments({ workspace: req.workspaceId, user: { $in: ids } });
    if (count !== ids.length) return 'Assignee is not a member of this workspace';
    body.assignees = ids;
  }
  if (body.blockedBy) {
    const ids = [...new Set(body.blockedBy.map(String))];
    if (ids.some(badId)) return 'Unknown task in "waiting on"';
    if (existing && ids.includes(String(existing._id))) return 'A task cannot wait on itself';
    const found = await Task.countDocuments({ _id: { $in: ids }, workspace: req.workspaceId });
    if (found !== ids.length) return 'Unknown task in "waiting on"';
    if (existing && (await createsCycle(existing._id, ids))) return 'That would make tasks wait on each other in a loop';
    body.blockedBy = ids;
  }
  const start = body.startDate !== undefined ? body.startDate : existing?.startDate;
  const due = body.dueDate !== undefined ? body.dueDate : existing?.dueDate;
  if (start && due && new Date(start) > new Date(due)) return 'Start date must be on or before the due date';

  const statuses = statusesOf(list);
  const listChanged = existing && body.list !== undefined && String(body.list) !== String(existing.list);
  if (body.status === undefined && (!existing || listChanged)) {
    // New task, or moved to another list: keep the status if that list has it, else use its first status
    const keep = existing && statuses.find((s) => s.id === existing.status);
    body.status = keep ? keep.id : statuses[0].id;
  }
  if (body.status !== undefined) {
    const s = statuses.find((x) => x.id === body.status);
    if (!s) return `Unknown status for this list: ${body.status}`;
    body.closed = s.type === 'done';
  }
  return null;
}

// True when `taskId` would end up waiting on itself through the chain of blockers
async function createsCycle(taskId, blockerIds) {
  const target = String(taskId);
  const seen = new Set();
  let frontier = blockerIds.map(String);
  for (let depth = 0; frontier.length && depth < 50; depth++) {
    if (frontier.includes(target)) return true;
    frontier.forEach((id) => seen.add(id));
    const next = await Task.find({ _id: { $in: frontier } }, 'blockedBy').lean();
    frontier = [...new Set(next.flatMap((t) => (t.blockedBy || []).map(String)))].filter((id) => !seen.has(id));
  }
  return false;
}

// Adds N days, weeks or months to a date
function shift(date, { every, interval }) {
  const d = new Date(date);
  if (every === 'day') d.setDate(d.getDate() + interval);
  if (every === 'week') d.setDate(d.getDate() + 7 * interval);
  if (every === 'month') d.setMonth(d.getMonth() + interval);
  return d;
}

// When a repeating task is finished, the next one is created with its dates moved forward
async function createNextOccurrence(req, task) {
  const list = task.list ? await List.findById(task.list) : null;
  const first = statusesOf(list).find((x) => x.type === 'open');
  const base = task.dueDate || new Date();
  const nextDue = shift(base, task.recurrence);
  const nextStart = task.startDate ? new Date(nextDue.getTime() - (new Date(base) - new Date(task.startDate))) : null;
  const next = await Task.create({
    workspace: task.workspace, owner: task.owner, list: task.list, name: task.name, description: task.description,
    tags: task.tags, priority: task.priority, assignees: task.assignees, timeEstimate: task.timeEstimate,
    recurrence: task.recurrence, status: first.id, closed: false, dueDate: nextDue, startDate: nextStart,
    subtasks: (task.subtasks || []).map((st) => ({ name: st.name, done: false })),
  });
  publish(req.workspaceId, { type: 'task', id: String(next._id), list: next.list ? String(next.list) : null, by: req.get('x-client-id') || String(req.userId) });
  return next;
}

// When a task is closed, every enabled "task completed" automation sends its owner a notification
async function runAutomations(req, task) {
  const rules = await Item.find({
    workspace: req.workspaceId,
    kind: 'automation',
    archived: false,
    'data.trigger': 'task_completed',
    'data.enabled': { $nin: [false, 'false'] },
  });
  for (const rule of rules) {
    await notify({ workspace: req.workspaceId, users: [rule.owner], actor: null, type: 'automation', text: `${rule.name}: "${task.name}" was completed`, task: task._id });
  }
}

const actorName = async (req) => (await User.findById(req.userId, 'name').lean())?.name || 'Someone';

// GET /api/tasks?page&limit&status&list&assignee=me&open=1&sort=updated|due
router.get('/', requirePermission('read'), async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const filter = { workspace: req.workspaceId };
    if (typeof req.query.status === 'string' && req.query.status) filter.status = req.query.status.slice(0, 40);
    if (req.query.list) {
      if (badId(req.query.list)) return res.status(404).json({ message: 'List not found' });
      filter.list = req.query.list;
    }
    if (req.query.assignee === 'me') filter.assignees = req.userId;
    if (req.query.open === '1') filter.closed = { $ne: true };
    const sort = req.query.sort === 'updated' ? { updatedAt: -1 } : req.query.sort === 'due' ? { dueDate: 1, createdAt: -1 } : { createdAt: -1 };
    if (req.query.sort === 'due') filter.dueDate = { $ne: null };

    const [data, total] = await Promise.all([
      Task.find(filter).sort(sort).skip((page - 1) * limit).limit(limit),
      Task.countDocuments(filter),
    ]);
    res.json({ data, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks
router.post('/', requirePermission('write'), validate(createSchema), async (req, res, next) => {
  try {
    const bad = await prepare(req, null);
    if (bad) return res.status(400).json({ message: bad });
    const task = await Task.create({ ...req.body, workspace: req.workspaceId, owner: req.userId });
    publish(req.workspaceId, { type: 'task', id: String(task._id), list: task.list ? String(task.list) : null, by: req.get('x-client-id') || String(req.userId) });
    if (task.assignees.length) {
      await notify({ workspace: req.workspaceId, users: task.assignees, actor: req.userId, type: 'assigned', text: `${await actorName(req)} assigned you to "${task.name}"`, task: task._id });
    }
    res.status(201).json({ data: task });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/tasks/:id
router.patch('/:id', requirePermission('write'), validate(updateSchema), async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'Task not found' });
    const before = await Task.findOne({ _id: req.params.id, workspace: req.workspaceId });
    if (!before) return res.status(404).json({ message: 'Task not found' });
    const bad = await prepare(req, before);
    if (bad) return res.status(400).json({ message: bad });
    const task = await Task.findOneAndUpdate({ _id: before._id }, req.body, { new: true });

    const added = (task.assignees || []).filter((a) => !(before.assignees || []).some((b) => String(b) === String(a)));
    if (added.length) {
      await notify({ workspace: req.workspaceId, users: added, actor: req.userId, type: 'assigned', text: `${await actorName(req)} assigned you to "${task.name}"`, task: task._id });
    }
    res.locals.list = task.list ? String(task.list) : null;
    let next = null;
    if (task.closed && !before.closed) {
      await runAutomations(req, task);
      if (task.recurrence) next = await createNextOccurrence(req, task);
    }
    res.json({ data: task, next });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', requirePermission('write'), async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'Task not found' });
    const task = await Task.findOneAndDelete({ _id: req.params.id, workspace: req.workspaceId });
    if (!task) return res.status(404).json({ message: 'Task not found' });
    await removeTaskData([task._id]);
    await Task.updateMany({ blockedBy: task._id }, { $pull: { blockedBy: task._id } });
    res.locals.list = task.list ? String(task.list) : null;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/:id/dependencies
router.get('/:id/dependencies', requirePermission('read'), async (req, res, next) => {
  try {
    const task = await findTask(req, res);
    if (!task) return;
    const [waitingOn, blocking] = await Promise.all([
      Task.find({ _id: { $in: task.blockedBy || [] }, workspace: req.workspaceId }, 'name status closed list').lean(),
      Task.find({ blockedBy: task._id, workspace: req.workspaceId }, 'name status closed list').lean(),
    ]);
    res.json({ waitingOn, blocking });
  } catch (err) {
    next(err);
  }
});

// ---------- Attachments ----------
// Any file up to 25 MB. Pictures are shown in the app; every other file is only ever downloaded,
// so an uploaded web page or script can never run inside Nexus.
const IMAGE_TYPES = [
  { type: 'image/png', ext: 'png', ok: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: 'image/jpeg', ext: 'jpg', ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/gif', ext: 'gif', ok: (b) => b.slice(0, 4).toString('latin1') === 'GIF8' },
  { type: 'image/webp', ext: 'webp', ok: (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' },
];
const cleanName = (n) => String(n || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 200) || 'file';

router.post('/:id/attachments', requirePermission('write'), express.raw({ type: () => true, limit: '25mb' }), async (req, res, next) => {
  try {
    const task = await findTask(req, res);
    if (!task) return;
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ message: 'The file is empty' });
    if ((await Media.countDocuments({ task: task._id, kind: 'attachment' })) >= 50) {
      return res.status(400).json({ message: 'A task can have at most 50 attachments' });
    }
    const image = IMAGE_TYPES.find((t) => buf.length > 12 && t.ok(buf));
    const rel = `attachments/${crypto.randomUUID()}.${image ? image.ext : 'bin'}`;
    const file = await storage.save(rel, buf, image ? image.type : 'application/octet-stream');
    const m = await Media.create({
      workspace: req.workspaceId, task: task._id, user: req.userId, kind: 'attachment', file,
      contentType: image ? image.type : 'application/octet-stream', size: buf.length, name: cleanName(req.query.name),
    });
    const { file: _f, ...data } = m.toObject();
    res.status(201).json({ data: { ...data, userName: await actorName(req) } });
  } catch (err) {
    next(err);
  }
});

// ---------- Large attachments straight to Google Drive ----------
// Over 4 MB Vercel cannot take the file through this server, so the browser sends it to Google Drive in pieces.
// When Google Drive is off the answer is { local: true } and the normal upload above is used.
const MAX_ATTACHMENT = 25 * 1024 * 1024;
router.post('/:id/attachments/session', requirePermission('write'), validate(z.object({ name: z.string().max(200), size: z.number().int().min(1).max(MAX_ATTACHMENT) })), async (req, res, next) => {
  try {
    if (!storage.drive.enabled()) return res.json({ local: true });
    const task = await findTask(req, res);
    if (!task) return;
    if ((await Media.countDocuments({ task: task._id, kind: 'attachment' })) >= 50) {
      return res.status(400).json({ message: 'A task can have at most 50 attachments' });
    }
    const rel = `attachments/${crypto.randomUUID()}.bin`;
    const uploadUrl = await storage.drive.createUploadSession(rel);
    res.json({ local: false, uploadUrl, rel });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/attachments/finish', requirePermission('write'), validate(z.object({ rel: z.string().max(100), name: z.string().max(200), size: z.number().int().min(1).max(MAX_ATTACHMENT) })), async (req, res, next) => {
  try {
    if (!/^attachments\/[0-9a-f-]{36}\.bin$/.test(req.body.rel)) return res.status(400).json({ message: 'Unknown upload' });
    const task = await findTask(req, res);
    if (!task) return;
    const meta = await storage.drive.exists(req.body.rel);
    if (!meta || meta.size !== req.body.size) return res.status(400).json({ message: 'The file was not received in full' });
    // Sent as a download only (never shown inline), since its contents were not checked by the server
    const m = await Media.create({
      workspace: req.workspaceId, task: task._id, user: req.userId, kind: 'attachment',
      file: storage.storedName(req.body.rel), contentType: 'application/octet-stream', size: req.body.size, name: cleanName(req.body.name),
    });
    const { file: _f, ...data } = m.toObject();
    res.status(201).json({ data: { ...data, userName: await actorName(req) } });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/attachments', requirePermission('read'), async (req, res, next) => {
  try {
    const task = await findTask(req, res);
    if (!task) return;
    const list = await Media.find({ task: task._id, kind: 'attachment' }).sort({ createdAt: -1 }).lean();
    const users = Object.fromEntries((await User.find({ _id: { $in: list.map((m) => m.user) } }, 'name').lean()).map((u) => [String(u._id), u.name]));
    res.json({ data: list.map(({ file, ...m }) => ({ ...m, userName: users[String(m.user)] || 'Former member' })) });
  } catch (err) {
    next(err);
  }
});

router.get('/attachments/:aid/file', requirePermission('read'), async (req, res, next) => {
  try {
    if (badId(req.params.aid)) return res.status(404).json({ message: 'File not found' });
    const m = await Media.findOne({ _id: req.params.aid, workspace: req.workspaceId, kind: 'attachment' });
    if (!m) return res.status(404).json({ message: 'File not found' });
    const isImage = m.contentType.startsWith('image/');
    res.set({
      'Content-Type': m.contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Content-Disposition': `${isImage ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(m.name || 'file')}`,
      'Cache-Control': 'private, max-age=3600',
    });
    const ok = await storage.send(res, m, { 'X-Content-Type-Options': 'nosniff' });
    if (ok === false && !res.headersSent) res.status(404).json({ message: 'File not found' });
  } catch (err) {
    next(err);
  }
});

router.delete('/attachments/:aid', requirePermission('write'), async (req, res, next) => {
  try {
    if (badId(req.params.aid)) return res.status(404).json({ message: 'File not found' });
    const m = await Media.findOne({ _id: req.params.aid, workspace: req.workspaceId, kind: 'attachment' });
    if (!m) return res.status(404).json({ message: 'File not found' });
    if (String(m.user) !== String(req.userId) && !['owner', 'admin'].includes(req.role)) {
      return res.status(403).json({ message: 'You can only delete your own files' });
    }
    await Promise.all([m.deleteOne(), removeFiles([m])]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Subtasks ----------
const subName = z.object({ name: z.string().trim().min(1, 'Subtask name is required').max(200) });
const subPatch = z.object({ name: z.string().trim().min(1).max(200).optional(), done: z.boolean().optional() });

async function findTask(req, res) {
  if (badId(req.params.id)) { res.status(404).json({ message: 'Task not found' }); return null; }
  const task = await Task.findOne({ _id: req.params.id, workspace: req.workspaceId });
  if (!task) res.status(404).json({ message: 'Task not found' });
  return task;
}

router.post('/:id/subtasks', requirePermission('write'), validate(subName), async (req, res, next) => {
  try {
    const task = await findTask(req, res);
    if (!task) return;
    if (task.subtasks.length >= 100) return res.status(400).json({ message: 'A task can have at most 100 subtasks' });
    task.subtasks.push({ name: req.body.name });
    await task.save();
    res.status(201).json({ data: task });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/subtasks/:sid', requirePermission('write'), validate(subPatch), async (req, res, next) => {
  try {
    const task = await findTask(req, res);
    if (!task) return;
    const sub = badId(req.params.sid) ? null : task.subtasks.id(req.params.sid);
    if (!sub) return res.status(404).json({ message: 'Subtask not found' });
    Object.assign(sub, req.body);
    await task.save();
    res.json({ data: task });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/subtasks/:sid', requirePermission('write'), async (req, res, next) => {
  try {
    const task = await findTask(req, res);
    if (!task) return;
    const sub = badId(req.params.sid) ? null : task.subtasks.id(req.params.sid);
    if (!sub) return res.status(404).json({ message: 'Subtask not found' });
    sub.deleteOne();
    await task.save();
    res.json({ data: task });
  } catch (err) {
    next(err);
  }
});

// ---------- Comments ----------
const commentBody = z.object({ body: z.string().trim().min(1, 'Comment is empty').max(4000) });
const withAuthor = (c, users) => {
  const u = users[String(c.author)];
  return { ...c, authorName: u?.name || 'Former member' };
};

// @Name in a comment mentions that member; the task's creator and assignees hear about every comment
async function notifyComment(req, task, body, who) {
  const members = await Membership.find({ workspace: req.workspaceId }, 'user').populate('user', 'name').lean();
  const lower = body.toLowerCase();
  const mentioned = members
    .filter((m) => m.user?.name && lower.includes('@' + m.user.name.toLowerCase()))
    .map((m) => String(m.user._id));
  const preview = body.length > 80 ? body.slice(0, 80) + '…' : body;
  await notify({ workspace: req.workspaceId, users: mentioned, actor: req.userId, type: 'mention', text: `${who} mentioned you on "${task.name}": ${preview}`, task: task._id });
  const followers = [task.owner, ...(task.assignees || [])].map(String).filter((u) => !mentioned.includes(u));
  await notify({ workspace: req.workspaceId, users: followers, actor: req.userId, type: 'comment', text: `${who} commented on "${task.name}": ${preview}`, task: task._id });
}

router.get('/:id/comments', requirePermission('read'), async (req, res, next) => {
  try {
    const task = await findTask(req, res);
    if (!task) return;
    const comments = await Comment.find({ task: task._id }).sort({ createdAt: 1 }).limit(500).lean();
    const users = Object.fromEntries(
      (await User.find({ _id: { $in: [...new Set(comments.map((c) => String(c.author)))] } }, 'name').lean()).map((u) => [String(u._id), u])
    );
    res.json({ data: comments.map((c) => withAuthor(c, users)) });
  } catch (err) {
    next(err);
  }
});

// Anyone who can chat (members and guests) can comment
router.post('/:id/comments', requirePermission('chat'), validate(commentBody), async (req, res, next) => {
  try {
    const task = await findTask(req, res);
    if (!task) return;
    const c = await Comment.create({ workspace: req.workspaceId, task: task._id, author: req.userId, body: req.body.body });
    const me = await User.findById(req.userId, 'name').lean();
    await notifyComment(req, task, c.body, me?.name || 'Someone');
    res.status(201).json({ data: { ...c.toObject(), authorName: me?.name } });
  } catch (err) {
    next(err);
  }
});

// Authors can delete their own comments; admins and owners can delete any
router.delete('/:id/comments/:cid', requirePermission('chat'), async (req, res, next) => {
  try {
    if (badId(req.params.cid)) return res.status(404).json({ message: 'Comment not found' });
    const c = await Comment.findOne({ _id: req.params.cid, task: req.params.id, workspace: req.workspaceId });
    if (!c) return res.status(404).json({ message: 'Comment not found' });
    if (String(c.author) !== String(req.userId) && !['owner', 'admin'].includes(req.role)) {
      return res.status(403).json({ message: 'You can only delete your own comments' });
    }
    await c.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
