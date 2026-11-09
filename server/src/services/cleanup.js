import * as storage from './storage.js';
import Comment from '../models/Comment.js';
import TimeEntry from '../models/TimeEntry.js';
import Media from '../models/Media.js';

// UPLOAD_DIR can point somewhere else (on Vercel only /tmp is writable, and it is not kept between requests)
export { UPLOAD_DIR } from './storage.js';

export async function removeFiles(media) {
  await storage.removeAll(media);
}

// Removes everything that hangs off the given tasks: comments, time entries, screenshots and recordings
export async function removeTaskData(taskIds) {
  if (!taskIds.length) return;
  const media = await Media.find({ task: { $in: taskIds } }, 'file').lean();
  await Promise.all([
    Comment.deleteMany({ task: { $in: taskIds } }),
    TimeEntry.deleteMany({ task: { $in: taskIds } }),
    Media.deleteMany({ task: { $in: taskIds } }),
    removeFiles(media),
  ]);
}
