import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loadRole, requirePermission } from '../middleware/role.js';
import Space from '../models/Space.js';
import List from '../models/List.js';
import Folder from '../models/Folder.js';
import { publish } from '../services/events.js';
import Task from '../models/Task.js';
import { removeTaskData } from '../services/cleanup.js';
import { statusesOf } from '../services/statuses.js';

// Mounted at /api/spaces. Lists live under /api/spaces/lists so one router covers the hierarchy.
const router = Router();
router.use(requireAuth, loadRole);

const badId = (id) => !mongoose.isValidObjectId(id);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must look like #7b68ee');
const spaceSchema = z.object({ name: z.string().trim().min(1, 'Space name is required').max(100), color: color.optional() });
const listCreate = z.object({ name: z.string().trim().min(1, 'List name is required').max(100), space: z.string().min(1), folder: z.string().nullable().optional() });
const listUpdate = z.object({ name: z.string().trim().min(1).max(100).optional(), folder: z.string().nullable().optional() });
const folderSchema = z.object({ name: z.string().trim().min(1, 'Folder name is required').max(100), space: z.string().min(1) });

// Any change to spaces, folders or lists tells open apps to reload the sidebar
router.use((req, res, next) => {
  if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400) publish(req.workspaceId, { type: 'spaces', by: req.get('x-client-id') || String(req.userId) }); });
  next();
});

// A folder must belong to the given space
async function folderIn(req, folderId, spaceId) {
  if (!folderId) return null;
  if (badId(folderId)) return false;
  return (await Folder.findOne({ _id: folderId, space: spaceId, workspace: req.workspaceId })) || false;
}

// GET /api/spaces: every space with its lists and open/total task counts, for the sidebar
router.get('/', requirePermission('read'), async (req, res, next) => {
  try {
    const ws = req.workspaceId;
    const [spaces, folders, lists, counts] = await Promise.all([
      Space.find({ workspace: ws }).sort({ createdAt: 1 }).lean(),
      Folder.find({ workspace: ws }).sort({ createdAt: 1 }).lean(),
      List.find({ workspace: ws }).sort({ createdAt: 1 }).lean(),
      Task.aggregate([
        { $match: { workspace: ws, list: { $ne: null } } },
        { $group: { _id: '$list', total: { $sum: 1 }, open: { $sum: { $cond: [{ $ne: ['$closed', true] }, 1, 0] } } } },
      ]),
    ]);
    const byList = Object.fromEntries(counts.map((c) => [String(c._id), c]));
    const data = spaces.map((s) => ({
      ...s,
      folders: folders.filter((f) => String(f.space) === String(s._id)),
      lists: lists
        .filter((l) => String(l.space) === String(s._id))
        .map((l) => ({ ...l, statuses: statusesOf(l), total: byList[l._id]?.total || 0, open: byList[l._id]?.open || 0 })),
    }));
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('write'), validate(spaceSchema), async (req, res, next) => {
  try {
    const space = await Space.create({ ...req.body, workspace: req.workspaceId, owner: req.userId });
    res.status(201).json({ data: { ...space.toObject(), folders: [], lists: [] } });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requirePermission('write'), validate(spaceSchema.partial()), async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'Space not found' });
    const space = await Space.findOneAndUpdate({ _id: req.params.id, workspace: req.workspaceId }, req.body, { new: true });
    if (!space) return res.status(404).json({ message: 'Space not found' });
    res.json({ data: space });
  } catch (err) {
    next(err);
  }
});

// Deleting a space removes its lists and their tasks
router.delete('/:id', requirePermission('write'), async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'Space not found' });
    const space = await Space.findOneAndDelete({ _id: req.params.id, workspace: req.workspaceId });
    if (!space) return res.status(404).json({ message: 'Space not found' });
    const lists = await List.find({ space: space._id }, '_id');
    const ids = lists.map((l) => l._id);
    const taskIds = (await Task.find({ list: { $in: ids } }, '_id').lean()).map((t) => t._id);
    await removeTaskData(taskIds);
    await Promise.all([Task.deleteMany({ list: { $in: ids } }), List.deleteMany({ space: space._id }), Folder.deleteMany({ space: space._id })]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/lists', requirePermission('write'), validate(listCreate), async (req, res, next) => {
  try {
    if (badId(req.body.space)) return res.status(400).json({ message: 'Space not found' });
    const space = await Space.findOne({ _id: req.body.space, workspace: req.workspaceId });
    if (!space) return res.status(400).json({ message: 'Space not found' });
    const folder = await folderIn(req, req.body.folder, space._id);
    if (folder === false) return res.status(400).json({ message: 'Folder not found in this space' });
    const list = await List.create({ name: req.body.name, space: space._id, folder: folder?._id || null, workspace: req.workspaceId, owner: req.userId });
    res.status(201).json({ data: { ...list.toObject(), statuses: statusesOf(list), total: 0, open: 0 } });
  } catch (err) {
    next(err);
  }
});

router.patch('/lists/:id', requirePermission('write'), validate(listUpdate), async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'List not found' });
    const list = await List.findOne({ _id: req.params.id, workspace: req.workspaceId });
    if (!list) return res.status(404).json({ message: 'List not found' });
    if (req.body.folder !== undefined) {
      const folder = await folderIn(req, req.body.folder, list.space);
      if (folder === false) return res.status(400).json({ message: 'Folder not found in this space' });
      list.folder = folder?._id || null;
    }
    if (req.body.name) list.name = req.body.name;
    await list.save();
    res.json({ data: list });
  } catch (err) {
    next(err);
  }
});

// ---------- Folders ----------
router.post('/folders', requirePermission('write'), validate(folderSchema), async (req, res, next) => {
  try {
    if (badId(req.body.space)) return res.status(400).json({ message: 'Space not found' });
    const space = await Space.findOne({ _id: req.body.space, workspace: req.workspaceId });
    if (!space) return res.status(400).json({ message: 'Space not found' });
    const folder = await Folder.create({ name: req.body.name, space: space._id, workspace: req.workspaceId, owner: req.userId });
    res.status(201).json({ data: folder });
  } catch (err) {
    next(err);
  }
});

router.patch('/folders/:id', requirePermission('write'), validate(z.object({ name: z.string().trim().min(1).max(100) })), async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'Folder not found' });
    const folder = await Folder.findOneAndUpdate({ _id: req.params.id, workspace: req.workspaceId }, { name: req.body.name }, { new: true });
    if (!folder) return res.status(404).json({ message: 'Folder not found' });
    res.json({ data: folder });
  } catch (err) {
    next(err);
  }
});

// Deleting a folder keeps its lists: they move up to the space
router.delete('/folders/:id', requirePermission('write'), async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'Folder not found' });
    const folder = await Folder.findOneAndDelete({ _id: req.params.id, workspace: req.workspaceId });
    if (!folder) return res.status(404).json({ message: 'Folder not found' });
    await List.updateMany({ folder: folder._id }, { folder: null });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/spaces/lists/:id/statuses { statuses }: replaces a list's statuses.
// Tasks whose status was removed move to the first open status.
const statusItem = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/, 'Bad status id'),
  name: z.string().trim().min(1, 'Status name is required').max(30),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must look like #7b68ee'),
  type: z.enum(['open', 'done']),
});
const statusesSchema = z.object({
  statuses: z.array(statusItem).min(2).max(15)
    .refine((a) => new Set(a.map((s) => s.id)).size === a.length, 'Status ids must be different')
    .refine((a) => new Set(a.map((s) => s.name.toLowerCase())).size === a.length, 'Status names must be different')
    .refine((a) => a.some((s) => s.type === 'open') && a.some((s) => s.type === 'done'), 'Keep at least one open and one done status'),
});

router.put('/lists/:id/statuses', requirePermission('write'), validate(statusesSchema), async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'List not found' });
    const list = await List.findOne({ _id: req.params.id, workspace: req.workspaceId });
    if (!list) return res.status(404).json({ message: 'List not found' });
    const next_ = req.body.statuses;
    const firstOpen = next_.find((s) => s.type === 'open');
    await Task.updateMany({ list: list._id, status: { $nin: next_.map((s) => s.id) } }, { status: firstOpen.id, closed: false });
    for (const s of next_) await Task.updateMany({ list: list._id, status: s.id }, { closed: s.type === 'done' });
    list.statuses = next_;
    await list.save();
    res.json({ data: { ...list.toObject(), statuses: statusesOf(list) } });
  } catch (err) {
    next(err);
  }
});

router.delete('/lists/:id', requirePermission('write'), async (req, res, next) => {
  try {
    if (badId(req.params.id)) return res.status(404).json({ message: 'List not found' });
    const list = await List.findOneAndDelete({ _id: req.params.id, workspace: req.workspaceId });
    if (!list) return res.status(404).json({ message: 'List not found' });
    const taskIds = (await Task.find({ list: list._id }, '_id').lean()).map((t) => t._id);
    await removeTaskData(taskIds);
    await Task.deleteMany({ list: list._id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
