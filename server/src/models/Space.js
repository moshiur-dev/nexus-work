import mongoose from 'mongoose';

// Top level of the work hierarchy: Workspace > Space > List > Task
const spaceSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    color: { type: String, default: '#7b68ee', maxlength: 20 },
  },
  { timestamps: true }
);

export default mongoose.model('Space', spaceSchema);
