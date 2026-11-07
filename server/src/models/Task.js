import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    status: { type: String, default: 'todo', maxlength: 40 }, // an id from the list's statuses
    closed: { type: Boolean, default: false, index: true }, // true when the status counts as done
    startDate: { type: Date, default: null },
    dueDate: { type: Date },
    // This task waits on these tasks to finish first
    blockedBy: { type: [mongoose.Schema.Types.ObjectId], ref: 'Task', default: [], index: true },
    // When a repeating task is finished, the next one is created: every N days, weeks or months
    recurrence: {
      type: new mongoose.Schema({ every: { type: String, enum: ['day', 'week', 'month'] }, interval: { type: Number, min: 1, max: 365 } }, { _id: false }),
      default: null,
    },
    tags: { type: [String], default: [] },
    list: { type: mongoose.Schema.Types.ObjectId, ref: 'List', default: null, index: true },
    priority: { type: String, enum: ['urgent', 'high', 'normal', 'low', null], default: null },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // older single assignee, kept for migration
    assignees: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [], index: true },
    timeEstimate: { type: Number, default: null }, // minutes
    description: { type: String, default: '', maxlength: 5000 },
    timeSpent: { type: Number, default: 0 }, // seconds, from finished time entries
    // Subtasks are small checklist-style tasks stored inside their parent
    subtasks: {
      type: [{ name: { type: String, required: true, trim: true, maxlength: 200 }, done: { type: Boolean, default: false } }],
      default: [],
    },
  },
  { timestamps: true }
);

taskSchema.index({ workspace: 1, createdAt: -1 });

export default mongoose.model('Task', taskSchema);
