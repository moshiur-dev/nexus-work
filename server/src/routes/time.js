import { Router } from 'express';
import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loadRole, requirePermission } from '../middleware/role.js';
import Task from '../models/Task.js';
import TimeEntry from '../models/TimeEntry.js';
import Media from '../models/Media.js';
import User from '../models/User.js';
import { UPLOAD_DIR, removeFiles } from '../services/cleanup.js';

// Mounted at /api/time: timers, activity counts, screenshots and screen recordings
const router = Router();
router.use(requireAuth, loadRole, requirePermission('read'));

const badId = (id) => !mongoose.isValidObjectId(id);
const isAdmin = (req) => ['owner', 'admin'].includes(req.role);
const sameUser = (a, b) => String(a) === String(b);

// Files are checked by their first bytes, not just the header the browser sent
const SIGNATURES = {
  'image/jpeg': { ext: 'jpg', ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', ok: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'video/webm': { ext: 'webm', ok: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
};

async function saveFile(buf, contentType, folder) {
  const sig = SIGNATURES[contentType];
  if (!sig || !Buffer.isBuffer(buf) || buf.length < 8 || !sig.ok(buf)) return null;
  const name = `${folder}/${crypto.randomUUID()}.${sig.ext}`;
  await fs.mkdir(path.join(UPLOAD_DIR, folder), { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, name), buf);
  return name;
}

async function sendFile(res, media) {
  res.set({
    'Content-Type': media.contentType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
  });
  res.sendFile(path.join(UPLOAD_DIR, media.file), (err) => {
    if (err && !res.headersSent) res.status(404).json({ message: 'File not found' });
  });
}

// Closes a running entry and adds its time to the task
async function stopEntry(entry) {
  const end = new Date();
  const seconds = Math.max(0, Math.round((end - entry.start) / 1000));
  entry.end = end;
  entry.seconds = seconds;
  await entry.save();
  await Task.updateOne({ _id: entry.task }, { $inc: { timeSpent: seconds } });
  return entry;
}

const withTaskName = async (entry) => {
  if (!entry) return null;
  const task = await Task.findById(entry.task, 'name list').lean();
  return { ...entry.toObject(), taskName: task?.name, taskList: task?.list };
};

// GET /api/time/running: the caller's running timer, if any
router.get('/running', async (req, res, next) => {
  try {
    const entry = await TimeEntry.findOne({ workspace: req.workspaceId, user: req.userId, end: null });
    res.json({ data: await withTaskName(entry) });
  } catch (err) {
    next(err);
  }
});

// POST /api/time/start { task, screenshots }: starts a timer; any other running timer of the caller stops first
router.post('/start', requirePermission('write'), validate(z.object({ task: z.string(), screenshots: z.boolean().default(false) })), async (req, res, next) => {
  try {
    if (badId(req.body.task)) return res.status(404).json({ message: 'Task not found' });
    const task = await Task.findOne({ _id: req.body.task, workspace: req.workspaceId });
    if (!task) return res.status(404).json({ message: 'Task not found' });
    const running = await TimeEntry.find({ user: req.userId, end: null });
    for (const r of running) await stopEntry(r);
    const entry = await TimeEntry.create({
      workspace: req.workspaceId, task: task._id, user: req.userId, start: new Date(), screenshots: req.body.screenshots,
    });
    res.status(201).json({ data: await withTaskName(entry) });
  } catch (err) {
    next(err);
  }
});

// POST /api/time/stop: stops the caller's running timer and returns the task's new total
router.post('/stop', async (req, res, next) => {
  try {
    const entry = await TimeEntry.findOne({ workspace: req.workspaceId, user: req.userId, end: null });
    if (!entry) return res.status(404).json({ message: 'No timer is running' });
    await stopEntry(entry);
    const task = await Task.findById(entry.task);
    res.json({ data: entry, task });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/time/entries/:id/activity { keystrokes, clicks }: adds counts to the caller's running entry
const activitySchema = z.object({
  keystrokes: z.number().int().min(0).max(50000),
  clicks: z.number().int().min(0).max(50000),
  screenshots: z.boolean().optional(),
});
router.patch('/entries/:id/activity', validate(activitySchema), async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'Entry not found' });
    const update = { $inc: { keystrokes: req.body.keystrokes, clicks: req.body.clicks } };
    if (req.body.screenshots !== undefined) update.$set = { screenshots: req.body.screenshots };
    const entry = await TimeEntry.findOneAndUpdate({ _id: req.params.id, user: req.userId, end: null }, update, { new: true });
    if (!entry) return res.status(404).json({ message: 'Entry not found or already stopped' });
    res.json({ data: entry });
  } catch (err) {
    next(err);
  }
});

// GET /api/time/task/:taskId: time entries for a task, with screenshots the caller may see
router.get('/task/:taskId', async (req, res, next) => {
  try {
    if (badId(req.params.taskId)) return res.status(404).json({ message: 'Task not found' });
    const task = await Task.findOne({ _id: req.params.taskId, workspace: req.workspaceId }, '_id timeSpent');
    if (!task) return res.status(404).json({ message: 'Task not found' });
    const [entries, shots] = await Promise.all([
      TimeEntry.find({ task: task._id }).sort({ start: -1 }).limit(200).lean(),
      Media.find({ task: task._id, kind: 'screenshot' }, 'entry user createdAt size').sort({ createdAt: 1 }).lean(),
    ]);
    const users = Object.fromEntries(
      (await User.find({ _id: { $in: [...new Set(entries.map((e) => String(e.user)))] } }, 'name').lean()).map((u) => [String(u._id), u.name])
    );
    // Screenshots are private to the person who took them, plus workspace owners and admins
    const canSee = (s) => isAdmin(req) || sameUser(s.user, req.userId);
    res.json({
      timeSpent: task.timeSpent || 0,
      data: entries.map((e) => ({
        ...e,
        userName: users[String(e.user)] || 'Former member',
        shots: shots.filter((s) => sameUser(s.entry, e._id) && canSee(s)).map((s) => ({ _id: s._id, takenAt: s.createdAt })),
        hiddenShots: shots.filter((s) => sameUser(s.entry, e._id) && !canSee(s)).length,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------- Reports for the Time tracking page ----------
// Whose time to show: yourself by default; owners and admins may pick one member or everyone ("all")
function whoFilter(req) {
  const u = String(req.query.user || '');
  if (isAdmin(req) && u === 'all') return {};
  if (isAdmin(req) && u && !badId(u)) return { user: new mongoose.Types.ObjectId(u) };
  return { user: new mongoose.Types.ObjectId(String(req.userId)) };
}

// from/to are ISO dates; the default is the last 7 days. At most a year at a time.
function rangeOf(req) {
  const to = req.query.to && !isNaN(new Date(req.query.to)) ? new Date(req.query.to) : new Date(Date.now() + 86400000);
  let from = req.query.from && !isNaN(new Date(req.query.from)) ? new Date(req.query.from) : new Date(to.getTime() - 8 * 86400000);
  if (to - from > 366 * 86400000) from = new Date(to.getTime() - 366 * 86400000);
  return { from, to };
}

// GET /api/time/entries?from&to&user — entries in the range, with task names, people and screenshots
router.get('/entries', async (req, res, next) => {
  try {
    const { from, to } = rangeOf(req);
    const filter = { workspace: req.workspaceId, start: { $gte: from, $lt: to }, ...whoFilter(req) };
    const entries = await TimeEntry.find(filter).sort({ start: -1 }).limit(500).lean();
    const [tasks, users, shots] = await Promise.all([
      Task.find({ _id: { $in: [...new Set(entries.map((e) => String(e.task)))] } }, 'name list').lean(),
      User.find({ _id: { $in: [...new Set(entries.map((e) => String(e.user)))] } }, 'name').lean(),
      Media.find({ entry: { $in: entries.map((e) => e._id) }, kind: 'screenshot' }, 'entry user createdAt').sort({ createdAt: 1 }).lean(),
    ]);
    const task = Object.fromEntries(tasks.map((t) => [String(t._id), t]));
    const name = Object.fromEntries(users.map((u) => [String(u._id), u.name]));
    const now = Date.now();
    let seconds = 0, keystrokes = 0, clicks = 0, screenshots = 0;
    const data = entries.map((e) => {
      const secs = e.end ? e.seconds : Math.round((now - new Date(e.start)) / 1000);
      const mine = shots.filter((s) => String(s.entry) === String(e._id));
      seconds += secs; keystrokes += e.keystrokes; clicks += e.clicks; screenshots += mine.length;
      return {
        ...e,
        seconds: secs,
        running: !e.end,
        taskName: task[String(e.task)]?.name || 'Deleted task',
        taskList: task[String(e.task)]?.list || null,
        userName: name[String(e.user)] || 'Former member',
        shots: mine.map((s) => ({ _id: s._id, takenAt: s.createdAt })),
      };
    });
    res.json({ data, totals: { seconds, keystrokes, clicks, screenshots, entries: data.length }, from, to });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/time/entries/:id: own entries, or any for owners and admins. Its screenshots go too.
router.delete('/entries/:id', requirePermission('write'), async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'Entry not found' });
    const entry = await TimeEntry.findOne({ _id: req.params.id, workspace: req.workspaceId });
    if (!entry) return res.status(404).json({ message: 'Entry not found' });
    if (!sameUser(entry.user, req.userId) && !isAdmin(req)) return res.status(403).json({ message: 'You can only delete your own time' });
    const media = await Media.find({ entry: entry._id }, 'file').lean();
    await Promise.all([entry.deleteOne(), Media.deleteMany({ entry: entry._id }), removeFiles(media)]);
    if (entry.end) await Task.updateOne({ _id: entry.task }, { $inc: { timeSpent: -entry.seconds } });
    const task = await Task.findById(entry.task);
    res.json({ ok: true, task });
  } catch (err) {
    next(err);
  }
});

// POST /api/time/entries/:id/screenshots (body: JPEG or PNG): only for the caller's running entry that allows screenshots
router.post('/entries/:id/screenshots', express.raw({ type: ['image/jpeg', 'image/png'], limit: '5mb' }), async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'Entry not found' });
    const entry = await TimeEntry.findOne({ _id: req.params.id, user: req.userId, workspace: req.workspaceId, end: null });
    if (!entry) return res.status(404).json({ message: 'Entry not found or already stopped' });
    if (!entry.screenshots) return res.status(400).json({ message: 'Screenshots are off for this timer' });
    const type = req.headers['content-type'];
    const file = await saveFile(req.body, type, 'screenshots');
    if (!file) return res.status(400).json({ message: 'Upload a JPEG or PNG image' });
    const media = await Media.create({
      workspace: req.workspaceId, task: entry.task, user: req.userId, entry: entry._id, kind: 'screenshot', file, contentType: type, size: req.body.length,
    });
    res.status(201).json({ data: { _id: media._id, takenAt: media.createdAt } });
  } catch (err) {
    next(err);
  }
});

router.get('/screenshots/:id', async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'Screenshot not found' });
    const m = await Media.findOne({ _id: req.params.id, workspace: req.workspaceId, kind: 'screenshot' });
    if (!m || (!isAdmin(req) && !sameUser(m.user, req.userId))) return res.status(404).json({ message: 'Screenshot not found' });
    await sendFile(res, m);
  } catch (err) {
    next(err);
  }
});

router.delete('/screenshots/:id', async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'Screenshot not found' });
    const m = await Media.findOne({ _id: req.params.id, workspace: req.workspaceId, kind: 'screenshot' });
    if (!m || (!isAdmin(req) && !sameUser(m.user, req.userId))) return res.status(404).json({ message: 'Screenshot not found' });
    await Promise.all([m.deleteOne(), removeFiles([m])]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Screen recordings attached to a task (visible to everyone in the workspace) ----------
router.post('/recordings', requirePermission('write'), express.raw({ type: 'video/webm', limit: '300mb' }), async (req, res, next) => {
  try {
    const taskId = String(req.query.task || '');
    if (badId(taskId)) return res.status(404).json({ message: 'Task not found' });
    const task = await Task.findOne({ _id: taskId, workspace: req.workspaceId }, '_id');
    if (!task) return res.status(404).json({ message: 'Task not found' });
    const file = await saveFile(req.body, 'video/webm', 'recordings');
    if (!file) return res.status(400).json({ message: 'Upload a WebM video' });
    const seconds = Math.max(0, Math.min(86400, Math.round(Number(req.query.seconds) || 0)));
    const m = await Media.create({
      workspace: req.workspaceId, task: task._id, user: req.userId, kind: 'recording', file, contentType: 'video/webm', size: req.body.length, seconds,
    });
    const me = await User.findById(req.userId, 'name').lean();
    res.status(201).json({ data: { ...m.toObject(), userName: me?.name } });
  } catch (err) {
    next(err);
  }
});

router.get('/recordings', async (req, res, next) => {
  try {
    const taskId = String(req.query.task || '');
    if (badId(taskId)) return res.status(404).json({ message: 'Task not found' });
    const list = await Media.find({ workspace: req.workspaceId, task: taskId, kind: 'recording' }).sort({ createdAt: -1 }).lean();
    const users = Object.fromEntries(
      (await User.find({ _id: { $in: [...new Set(list.map((m) => String(m.user)))] } }, 'name').lean()).map((u) => [String(u._id), u.name])
    );
    res.json({ data: list.map(({ file, ...m }) => ({ ...m, userName: users[String(m.user)] || 'Former member' })) });
  } catch (err) {
    next(err);
  }
});

router.get('/recordings/:id/file', async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'Recording not found' });
    const m = await Media.findOne({ _id: req.params.id, workspace: req.workspaceId, kind: 'recording' });
    if (!m) return res.status(404).json({ message: 'Recording not found' });
    await sendFile(res, m);
  } catch (err) {
    next(err);
  }
});

router.delete('/recordings/:id', requirePermission('write'), async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'Recording not found' });
    const m = await Media.findOne({ _id: req.params.id, workspace: req.workspaceId, kind: 'recording' });
    if (!m) return res.status(404).json({ message: 'Recording not found' });
    if (!sameUser(m.user, req.userId) && !isAdmin(req)) return res.status(403).json({ message: 'You can only delete your own recordings' });
    await Promise.all([m.deleteOne(), removeFiles([m])]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
