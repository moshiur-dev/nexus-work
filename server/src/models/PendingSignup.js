import mongoose from 'mongoose';

// A sign-up waiting for the link in the email. The account is only created when the link is opened.
const pendingSignupSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    workspaceName: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    tokenHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }, // removed automatically after it passes
  },
  { timestamps: true }
);

export default mongoose.model('PendingSignup', pendingSignupSchema);
