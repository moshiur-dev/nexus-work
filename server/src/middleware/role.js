import Membership from '../models/Membership.js';
import Workspace from '../models/Workspace.js';
import User from '../models/User.js';
import Item from '../models/Item.js';
import Task from '../models/Task.js';
import { can } from '../utils/permissions.js';

// Gives a user a personal workspace the first time they need one, and adopts data created before workspaces existed.
export async function ensureWorkspace(userId) {
  const count = await Membership.countDocuments({ user: userId });
  if (count > 0) return;
  const user = await User.findById(userId);
  if (!user) return;
  const ws = await Workspace.create({ name: user.workspaceName || 'My Workspace', owner: user._id });
  await Membership.create({ workspace: ws._id, user: user._id, role: 'owner' });
  await Promise.all([
    Item.updateMany({ owner: user._id, workspace: { $exists: false } }, { workspace: ws._id }),
    Task.updateMany({ owner: user._id, workspace: { $exists: false } }, { workspace: ws._id }),
  ]);
}

// Sets req.workspaceId and req.role from the active workspace (the "ws" cookie, else the first one)
export async function loadRole(req, res, next) {
  try {
    if (!(await User.exists({ _id: req.userId }))) return res.status(401).json({ message: 'Not authenticated' });
    await ensureWorkspace(req.userId);
    const memberships = await Membership.find({ user: req.userId }).sort({ createdAt: 1 });
    const chosen =
      (req.cookies?.ws && memberships.find((m) => String(m.workspace) === req.cookies.ws)) || memberships[0];
    req.role = chosen.role;
    req.workspaceId = chosen.workspace;
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePermission(action) {
  return (req, res, next) =>
    can(req.role, action) ? next() : res.status(403).json({ message: `Your role (${req.role}) cannot do this` });
}

// Chat messages need "chat", everything else needs "write"
export function requireWriteOrChat(req, res, next) {
  const action = req.body?.kind === 'message' ? 'chat' : 'write';
  return requirePermission(action)(req, res, next);
}
