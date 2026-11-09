import mongoose from 'mongoose';

// One setting changed from the Super admin page. The value is encrypted (see services/secrets.js).
const appSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, maxlength: 60 },
    value: { type: String, required: true }, // "v1:<iv>:<tag>:<data>"
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

export default mongoose.model('AppSetting', appSettingSchema);
