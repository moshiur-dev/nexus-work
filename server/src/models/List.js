import mongoose from 'mongoose';

// One status a list's tasks can have. `done` statuses count as finished.
const statusSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    color: { type: String, required: true },
    type: { type: String, enum: ['open', 'done'], required: true },
  },
  { _id: false }
);

// A list of tasks inside a space
const listSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    space: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true, index: true },
    folder: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // Empty means the default To Do / In Progress / Done
    statuses: { type: [statusSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model('List', listSchema);
