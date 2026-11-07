import mongoose from 'mongoose';

// A message in someone's Inbox: they were assigned, someone commented or mentioned them, or an automation ran
const notificationSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // who receives it
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // who caused it
    type: { type: String, enum: ['assigned', 'comment', 'mention', 'automation'], required: true },
    text: { type: String, required: true, maxlength: 300 },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, workspace: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
