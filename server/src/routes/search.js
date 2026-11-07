import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { loadRole, requirePermission } from '../middleware/role.js';
import Task from '../models/Task.js';
import List from '../models/List.js';
import Space from '../models/Space.js';
import Item from '../models/Item.js';
import Channel from '../models/Channel.js';
import Message from '../models/Message.js';

// GET /api/search?q=text : tasks, lists, docs and other items, and chat messages in the active workspace
const router = Router();
router.use(requireAuth, loadRole, requirePermission('read'));

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q.length < 2) return res.json({ data: { tasks: [], lists: [], items: [], messages: [] } });
    const rx = new RegExp(escape(q), 'i');
    const ws = req.workspaceId;
    const meId = new mongoose.Types.ObjectId(String(req.userId));

    // Messages only from channels this user can see (every channel, plus their own DMs)
    const visible = await Channel.find({ workspace: ws, $or: [{ kind: 'channel' }, { kind: 'dm', members: meId }] }, '_id kind name').lean();
    const chName = Object.fromEntries(visible.map((c) => [String(c._id), c.kind === 'dm' ? 'Direct message' : `#${c.name}`]));

    const [tasks, lists, items, messages, spaces] = await Promise.all([
      Task.find({ workspace: ws, $or: [{ name: rx }, { description: rx }, { tags: rx }, { 'subtasks.name': rx }] })
        .sort({ updatedAt: -1 }).limit(15).select('name status closed list priority').lean(),
      List.find({ workspace: ws, name: rx }).limit(8).lean(),
      Item.find({ workspace: ws, archived: false, kind: { $nin: ['message', 'formResponse', 'notification'] }, name: rx })
        .sort({ updatedAt: -1 }).limit(10).select('name kind').lean(),
      Message.find({ channel: { $in: visible.map((c) => c._id) }, body: rx }).sort({ createdAt: -1 }).limit(10).lean(),
      Space.find({ workspace: ws }, 'name').lean(),
    ]);
    const spaceName = Object.fromEntries(spaces.map((s) => [String(s._id), s.name]));
    res.json({
      data: {
        tasks,
        lists: lists.map((l) => ({ ...l, spaceName: spaceName[String(l.space)] })),
        items,
        messages: messages.map((m) => ({
          _id: m._id, body: m.body.slice(0, 160), channel: m.channel, channelName: chName[String(m.channel)],
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
