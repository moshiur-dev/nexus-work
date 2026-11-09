import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    workspaceName: { type: String, default: 'My Workspace' },
    role: { type: String, enum: ['owner', 'admin', 'member', 'guest', 'viewer'], default: 'owner' },

    // password reset (token stored hashed, expires after 1 hour)
    resetTokenHash: { type: String, select: false },
    resetExpires: { type: Date, select: false },

    // two-factor authentication (TOTP)
    twoFactorSecret: { type: String, select: false },
    twoFactorEnabled: { type: Boolean, default: false },

    // platform super admin: can change server settings from the app
    isSuperAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    workspaceName: this.workspaceName,
    role: this.role,
    twoFactorEnabled: this.twoFactorEnabled,
    isSuperAdmin: this.isSuperAdmin || (!!process.env.SUPER_ADMIN_EMAIL && this.email === process.env.SUPER_ADMIN_EMAIL.toLowerCase()),
  };
};

export default mongoose.model('User', userSchema);
