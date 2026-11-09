// One place for every saved file (screenshots, recordings, attachments).
// Which place is used: Google Drive if it is set up, else Backblaze B2 if it is set up, else UPLOAD_DIR on this server.
// A stored name starts with "gdrive:" or "b2:" when the file lives there, so files saved earlier keep working.
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as drive from './gdrive.js';
import * as b2 from './b2.js';

export { drive, b2 };

// Local folder (only used when no cloud storage is set up). On Vercel only /tmp is writable, and it is not kept.
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');

const PREFIX = { gdrive: 'gdrive:', b2: 'b2:' };
const BACKEND = { gdrive: drive, b2 };

// The place new files go: 'gdrive', 'b2' or 'local'
export const provider = () => (drive.enabled() ? 'gdrive' : b2.enabled() ? 'b2' : 'local');
export const remoteEnabled = () => provider() !== 'local';

// The name stored in the database for a new file at this relative path
export const storedName = (rel) => (provider() === 'local' ? rel : PREFIX[provider()] + rel);
const remoteOf = (file) => {
  if (typeof file !== 'string') return null;
  for (const [name, prefix] of Object.entries(PREFIX)) {
    if (file.startsWith(prefix)) return { backend: BACKEND[name], rel: file.slice(prefix.length) };
  }
  return null;
};
export const isRemote = (file) => remoteOf(file) !== null;

// The backend for files that are being uploaded right now
const current = () => BACKEND[provider()];

// Saves a file. `rel` is a server-made relative path such as "screenshots/<uuid>.jpg".
export async function save(rel, buf, contentType) {
  if (remoteEnabled()) {
    await current().upload(rel, buf, contentType);
    return storedName(rel);
  }
  await fs.mkdir(path.dirname(path.join(UPLOAD_DIR, rel)), { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, rel), buf);
  return rel;
}

// Address the browser sends a file to, directly (for large files). `provider` tells the browser how to send it.
export async function createUploadSession(rel, contentType) {
  const uploadUrl = await current().createUploadSession(rel, contentType);
  return { provider: provider(), uploadUrl };
}

// Metadata of a file that was sent directly to cloud storage, or null
export async function exists(rel) {
  return current().exists(rel);
}

// Sends a stored file to the browser. Returns false when it cannot be found.
export async function send(res, media, extra = {}) {
  const headers = { contentType: media.contentType, extra };
  const remote = remoteOf(media.file);
  if (remote) return remote.backend.sendTo(res, remote.rel, headers);
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
      const remote = remoteOf(m.file);
      if (remote) return remote.backend.remove(remote.rel).catch(() => {});
      return fs.unlink(path.join(UPLOAD_DIR, m.file)).catch(() => {});
    })
  );
}

// Recordings uploaded straight to cloud storage: the server picks the path, the browser sends the bytes.
export const newRecordingPath = (uuid) => `recordings/${uuid}.webm`;
export const isRecordingPath = (rel) => /^recordings\/[0-9a-f-]{36}\.webm$/.test(rel);
