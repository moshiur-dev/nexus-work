// Google Drive storage for screenshots, recordings and attachments (15 GB free per Google account).
// Used when GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN are set (Super admin page or environment).
// The app uses the "drive.file" scope, so it can only see the files it created itself.
// Files are found by their server-made name (a random UUID), never by an id sent from the browser.
import { Readable } from 'node:stream';
import * as secrets from './secrets.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const enabled = () =>
  Boolean(secrets.get('GOOGLE_CLIENT_ID') && secrets.get('GOOGLE_CLIENT_SECRET') && secrets.get('GOOGLE_REFRESH_TOKEN'));

// Access tokens last about an hour; keep one in memory and refresh it shortly before it ends
let cached = { token: null, expires: 0 };
async function accessToken() {
  if (cached.token && Date.now() < cached.expires - 60_000) return cached.token;
  const body = new URLSearchParams({
    client_id: secrets.get('GOOGLE_CLIENT_ID'),
    client_secret: secrets.get('GOOGLE_CLIENT_SECRET'),
    refresh_token: secrets.get('GOOGLE_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google Drive sign-in failed (${data.error || res.status}). Check GOOGLE_REFRESH_TOKEN.`);
  cached = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cached.token;
}
const auth = async () => ({ Authorization: `Bearer ${await accessToken()}` });

// The folder the files live in (created once, found again later)
let folderId = null;
async function folder() {
  if (folderId) return folderId;
  const name = (secrets.get('GOOGLE_DRIVE_FOLDER') || 'NexusWork').replace(/'/g, "\\'");
  const q = `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`;
  const found = await fetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)`, { headers: await auth() }).then((r) => r.json());
  if (found.files?.[0]?.id) {
    folderId = found.files[0].id;
    return folderId;
  }
  const res = await fetch(`${API}/files`, {
    method: 'POST',
    headers: { ...(await auth()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: secrets.get('GOOGLE_DRIVE_FOLDER') || 'NexusWork', mimeType: 'application/vnd.google-apps.folder' }),
  });
  const data = await res.json();
  if (!res.ok || !data.id) throw new Error(`Google Drive folder could not be created (${res.status})`);
  folderId = data.id;
  return folderId;
}

// The file's name inside Drive: the last part of the server-made path (a UUID plus extension)
const nameOf = (rel) => rel.split('/').pop();

// Finds a file the app created, by its name. Returns { id, size } or null.
async function find(rel) {
  const q = `name = '${nameOf(rel)}' and trashed = false`;
  const res = await fetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id,size)`, { headers: await auth() });
  if (!res.ok) throw new Error(`Google Drive lookup failed (${res.status})`);
  const data = await res.json();
  const f = data.files?.[0];
  return f ? { id: f.id, size: Number(f.size || 0) } : null;
}

// Starts a resumable upload. Returns the address the browser sends the bytes to (no login needed for that address).
export async function createUploadSession(rel, contentType = 'application/octet-stream') {
  const res = await fetch(`${UPLOAD}?uploadType=resumable`, {
    method: 'POST',
    headers: { ...(await auth()), 'Content-Type': 'application/json', 'X-Upload-Content-Type': contentType },
    body: JSON.stringify({ name: nameOf(rel), parents: [await folder()] }),
  });
  const location = res.headers.get('location');
  if (!res.ok || !location) throw new Error(`Google Drive upload session failed (${res.status})`);
  return location;
}

// Small files (the server path): one request with the whole file
export async function upload(rel, buf, contentType) {
  const url = await createUploadSession(rel, contentType);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType || 'application/octet-stream', 'Content-Length': String(buf.length) },
    body: buf,
  });
  if (!res.ok) throw new Error(`Google Drive upload failed (${res.status})`);
  return rel;
}

// Metadata of a stored file, or null if it is not there (used to confirm a browser upload finished)
export async function exists(rel) {
  return find(rel);
}

// Streams a stored file to the browser. Returns false when it does not exist.
export async function sendTo(res, rel, headers = {}) {
  const f = await find(rel);
  if (!f) return false;
  const r = await fetch(`${API}/files/${f.id}?alt=media`, { headers: await auth() });
  if (!r.ok || !r.body) throw new Error(`Google Drive download failed (${r.status})`);
  res.set({ 'Content-Type': headers.contentType || 'application/octet-stream', ...headers.extra });
  if (f.size) res.set('Content-Length', String(f.size));
  Readable.fromWeb(r.body).pipe(res);
  return true;
}

export async function remove(rel) {
  const f = await find(rel);
  if (!f) return;
  const res = await fetch(`${API}/files/${f.id}`, { method: 'DELETE', headers: await auth() });
  if (!res.ok && res.status !== 404) throw new Error(`Google Drive delete failed (${res.status})`);
}
