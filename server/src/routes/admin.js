import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { requireSuperAdmin } from '../middleware/superAdmin.js';
import * as secrets from '../services/secrets.js';

// Mounted at /api/admin: server settings, for the super admin only
const router = Router();
router.use(requireAuth, requireSuperAdmin);

// GET /api/admin/settings: which settings exist and whether each is set (values are never sent back)
router.get('/settings', async (req, res, next) => {
  try {
    res.json({ data: await secrets.status(), canSave: secrets.canStore() });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/settings/:key { value }: saves a setting; an empty value clears it (the environment value is used again)
router.put('/settings/:key', validate(z.object({ value: z.string().max(4000) })), async (req, res, next) => {
  try {
    if (!secrets.SETTINGS[req.params.key]) return res.status(400).json({ message: 'Unknown setting' });
    if (req.body.value !== '' && !secrets.canStore()) {
      return res.status(400).json({ message: 'ENCRYPTION_KEY is not set on the server, so settings cannot be saved yet' });
    }
    await secrets.set(req.params.key, req.body.value.trim(), req.userId);
    res.json({ data: await secrets.status() });
  } catch (err) {
    next(err);
  }
});

export default router;
