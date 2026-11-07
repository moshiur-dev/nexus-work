import mongoose from 'mongoose';

// One stretch of tracked time on a task. `end` is empty while the timer runs.
const timeEntrySchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    start: { type: Date, required: true },
    end: { type: Date, default: null },
    seconds: { type: Number, default: 0 },
    // Activity while the timer ran, counted only inside the Nexus tab (no key contents are stored)
    keystrokes: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    screenshots: { type: Boolean, default: false }, // the user agreed to screenshots for this entry
  },
  { timestamps: true }
);

export default mongoose.model('TimeEntry', timeEntrySchema);
