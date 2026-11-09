import User from '../models/User.js';

// A super admin is the account named by SUPER_ADMIN_EMAIL (or any user flagged isSuperAdmin)
export const isSuperAdminEmail = (email) =>
  Boolean(process.env.SUPER_ADMIN_EMAIL) && String(email || '').toLowerCase() === process.env.SUPER_ADMIN_EMAIL.toLowerCase();

export async function requireSuperAdmin(req, res, next) {
  try {
    const u = await User.findById(req.userId, 'email isSuperAdmin').lean();
    if (!u || !(u.isSuperAdmin || isSuperAdminEmail(u.email))) {
      return res.status(403).json({ message: 'Only the super admin can change these settings' });
    }
    next();
  } catch (err) {
    next(err);
  }
}
