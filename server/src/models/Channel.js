import mongoose from 'mongoose';

// A chat channel (everyone in the workspace) or a direct message between two members
const channelSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    kind: { type: String, enum: ['channel', 'dm'], required: true },
    name: { type: String, trim: true, maxlength: 60 }, // channels only
    members: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] }, // DMs only: the two people
    dmKey: { type: String }, // DMs only: sorted user ids, so each pair has one conversation
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastMessageAt: { type: Date },
  },
  { timestamps: true }
);

channelSchema.index({ workspace: 1, dmKey: 1 }, { unique: true, partialFilterExpression: { kind: 'dm' } });
channelSchema.index({ workspace: 1, kind: 1, name: 1 });

export default mongoose.model('Channel', channelSchema);
