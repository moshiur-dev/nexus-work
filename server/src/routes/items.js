import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loadRole, requirePermission, requireWriteOrChat } from '../middleware/role.js';
import Item, { KINDS } from '../models/Item.js';
import { sanitizeHtml } from '../utils/sanitize.js';

// Docs store rich HTML in data.body; sanitize it on every write
function clean(data) {
  if (data && typeof data.body === 'string') return { ...data, body: sanitizeHtml(data.body) };
  return data;
}

const router = Router();
router.use(requireAuth, loadRole);

const createSchema = z.object({
  kind: z.enum(KINDS),
  name: z.string().trim().min(1, 'Name is required').max(200),
  data: z.record(z.any()).optional().default({}),
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  data: z.record(z.any()).optional(),
  archived: z.boolean().optional(),
});

// GET /api/items?kind=doc&page=1&limit=20
router.get('/', requirePermission('read'), async (req, res, next) => {
  try {
    const kind = req.query.kind;
    if (!KINDS.includes(kind)) return res.status(400).json({ message: 'Unknown section' });
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const filter = { workspace: req.workspaceId, kind, archived: false };

    const [data, total] = await Promise.all([
      Item.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Item.countDocuments(filter),
    ]);
    res.json({ data, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
});

// POST /api/items
router.post('/', requireWriteOrChat, validate(createSchema), async (req, res, next) => {
  try {
    const item = await Item.create({
      ...req.body,
      data: clean(req.body.data),
      workspace: req.workspaceId,
      owner: req.userId,
    });
    res.status(201).json({ data: item });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/items/:id
router.patch('/:id', requirePermission('write'), validate(updateSchema), async (req, res, next) => {
  try {
    const update = { ...req.body };
    if (update.data) update.data = clean(update.data);
    const item = await Item.findOneAndUpdate(
      { _id: req.params.id, workspace: req.workspaceId },
      update,
      { new: true }
    );
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json({ data: item });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/items/:id
router.delete('/:id', requirePermission('write'), async (req, res, next) => {
  try {
    const item = await Item.findOneAndDelete({ _id: req.params.id, workspace: req.workspaceId });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
