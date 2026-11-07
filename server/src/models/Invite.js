import mongoose from 'mongoose';
import { ROLES } from '../utils/permissions.js';

// Pending invitation. The token is stored hashed and the document expires automatically.
const inviteSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ROLES.filter((r) => r !== 'owner'), required: true },
    tokenHash: { type: String, required: true, select: false, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default mongoose.model('Invite', inviteSchema);
