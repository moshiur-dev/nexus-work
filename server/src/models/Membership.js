import mongoose from 'mongoose';
import { ROLES } from '../utils/permissions.js';

// Links a user to a workspace with one of the five roles
const membershipSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, required: true },
  },
  { timestamps: true }
);

membershipSchema.index({ workspace: 1, user: 1 }, { unique: true });
membershipSchema.index({ user: 1, createdAt: 1 });

export default mongoose.model('Membership', membershipSchema);
