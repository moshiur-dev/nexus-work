import mongoose from 'mongoose';

// A screenshot (taken during a time entry) or a screen recording attached to a task.
// The file itself is saved on disk under server/uploads; this holds who, where and when.
const mediaSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    entry: { type: mongoose.Schema.Types.ObjectId, ref: 'TimeEntry', default: null, index: true },
    kind: { type: String, enum: ['screenshot', 'recording', 'attachment'], required: true },
    name: { type: String, default: '', maxlength: 200 }, // attachments: the original file name
    file: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    seconds: { type: Number, default: 0 }, // recordings only
  },
  { timestamps: true }
);

export default mongoose.model('Media', mediaSchema);
