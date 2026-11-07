import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { loadRole, requirePermission } from '../middleware/role.js';
import Notification from '../models/Notification.js';
import Task from '../models/Task.js';
import User from '../models/User.js';

// Mounted at /api/notifications: the caller's own Inbox in the active workspace
const router = Router();
router.use(requireAuth, loadRole, requirePermission('read'));

const mine = (req) => ({ user: req.userId, workspace: req.workspaceId });

// GET /api/notifications?unread=1&limit=50
router.get('/', async (req, res, next) => {
  try {
    const filter = mine(req);
    if (req.query.unread === '1') filter.read = false;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const list = await Notification.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    const [actors, tasks] = await Promise.all([
      User.find({ _id: { $in: list.map((n) => n.actor).filter(Boolean) } }, 'name').lean(),
      Task.find({ _id: { $in: list.map((n) => n.task).filter(Boolean) } }, 'name list').lean(),
    ]);
    const actorName = Object.fromEntries(actors.map((u) => [String(u._id), u.name]));
    const taskInfo = Object.fromEntries(tasks.map((t) => [String(t._id), t]));
    res.json({
      data: list.map((n) => ({
        ...n,
        actorName: n.actor ? actorName[String(n.actor)] || 'Former member' : null,
        taskName: n.task ? taskInfo[String(n.task)]?.name || null : null,
        taskList: n.task ? taskInfo[String(n.task)]?.list || null : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/count', async (req, res, next) => {
  try {
    res.json({ unread: await Notification.countDocuments({ ...mine(req), read: false }) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Notification not found' });
    const n = await Notification.findOneAndUpdate({ _id: req.params.id, ...mine(req) }, { read: req.body?.read !== false }, { new: true });
    if (!n) return res.status(404).json({ message: 'Notification not found' });
    res.json({ data: n });
  } catch (err) {
    next(err);
  }
});

router.post('/read-all', async (req, res, next) => {
  try {
    await Notification.updateMany({ ...mine(req), read: false }, { read: true });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
