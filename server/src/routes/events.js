import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { loadRole, requirePermission } from '../middleware/role.js';
import { subscribe } from '../services/events.js';

// GET /api/events: a text/event-stream of changes in the active workspace
const router = Router();
router.get('/', requireAuth, loadRole, requirePermission('read'), (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
  const unsubscribe = subscribe(req.workspaceId, req.userId, res);
  // A comment line every 25 seconds keeps proxies from closing the stream
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); unsubscribe(); });
});

export default router;
