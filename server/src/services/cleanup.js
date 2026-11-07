import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Comment from '../models/Comment.js';
import TimeEntry from '../models/TimeEntry.js';
import Media from '../models/Media.js';

export const UPLOAD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');

export async function removeFiles(media) {
  await Promise.all(media.map((m) => fs.unlink(path.join(UPLOAD_DIR, m.file)).catch(() => {})));
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
