// One place for every saved file (screenshots, recordings, attachments).
// With OneDrive configured, files go to OneDrive. Otherwise they go to UPLOAD_DIR on this server.
// A stored name starts with "onedrive:" when it lives in OneDrive, so old local files keep working.
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as onedrive from './onedrive.js';

// Local folder (only used when OneDrive is off). On Vercel only /tmp is writable, and it is not kept.
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');

const PREFIX = 'onedrive:';
// The name stored in the database for a new file at this relative path
export const storedName = (rel) => (onedrive.enabled() ? PREFIX + rel : rel);
export const isOneDrive = (file) => typeof file === 'string' && file.startsWith(PREFIX);
const relOf = (file) => file.slice(PREFIX.length);

// Saves a file. `rel` is a server-made relative path such as "screenshots/<uuid>.jpg".
export async function save(rel, buf, contentType) {
  if (onedrive.enabled()) {
    await onedrive.upload(rel, buf, contentType);
    return PREFIX + rel;
  }
  await fs.mkdir(path.dirname(path.join(UPLOAD_DIR, rel)), { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, rel), buf);
  return rel;
}

// Sends a stored file to the browser. Returns false when it cannot be found.
export async function send(res, media, extra = {}) {
  const headers = { contentType: media.contentType, extra };
  if (isOneDrive(media.file)) return onedrive.sendTo(res, relOf(media.file), headers);
  res.set({ 'Content-Type': media.contentType, ...extra });
  return new Promise((resolve) => {
    res.sendFile(path.join(UPLOAD_DIR, media.file), (err) => {
      if (err && !res.headersSent) res.status(404).json({ message: 'File not found' });
      resolve(!err);
    });
  });
}

// Deletes stored files; missing files are ignored
export async function removeAll(media) {
  await Promise.all(
    media.map((m) => {
      if (!m.file) return null;
      if (isOneDrive(m.file)) return onedrive.remove(relOf(m.file)).catch(() => {});
      return fs.unlink(path.join(UPLOAD_DIR, m.file)).catch(() => {});
    })
  );
}

// Recordings uploaded straight to OneDrive: the server picks the path, the browser sends the bytes.
export const newRecordingPath = (uuid) => `recordings/${uuid}.webm`;
export const isRecordingPath = (rel) => /^recordings\/[0-9a-f-]{36}\.webm$/.test(rel);
export { onedrive };
