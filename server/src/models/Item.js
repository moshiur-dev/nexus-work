import mongoose from 'mongoose';

// One flexible collection for most workspace sections (docs, dashboards, forms, goals,
// time entries, chat messages, notifications, automations, tags, custom fields, etc.).
// `kind` says which section an item belongs to; `data` holds section-specific fields.
export const KINDS = [
  'space', 'doc', 'dashboard', 'whiteboard', 'form', 'goal', 'time', 'message',
  'notification', 'clip', 'meeting', 'artifact', 'skill', 'agent', 'automation', 'formResponse',
  'tag', 'customField', 'taskType', 'team', 'integration',
];

const itemSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: KINDS, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

itemSchema.index({ workspace: 1, kind: 1, createdAt: -1 });

export default mongoose.model('Item', itemSchema);
