// OneDrive storage through Microsoft Graph. Used for screenshots, recordings and attachments when the
// MS_* variables are set. Files are addressed by their path inside ONEDRIVE_FOLDER (never by a client-sent id).
//
// Needed environment variables:
//   MS_CLIENT_ID, MS_CLIENT_SECRET   from the Azure app registration
//   MS_REFRESH_TOKEN                 obtained once by signing in with the OneDrive owner account
//   MS_TENANT                        optional, default "consumers" (personal Microsoft accounts)
//   ONEDRIVE_FOLDER                  optional, default "NexusWork"

const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = (tenant) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

export const enabled = () => Boolean(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_REFRESH_TOKEN);
const folder = () => (process.env.ONEDRIVE_FOLDER || 'NexusWork').replace(/^\/+|\/+$/g, '');

// Path inside OneDrive for a relative path such as "screenshots/x.jpg"
const fullPath = (rel) => [folder(), ...rel.split('/')].map(encodeURIComponent).join('/');
const itemUrl = (rel, suffix = '') => `${GRAPH}/me/drive/root:/${fullPath(rel)}${suffix}`;

// Access tokens last about an hour; keep one in memory and refresh it when it is close to expiry
let cached = { token: null, expires: 0 };
async function accessToken() {
  if (cached.token && Date.now() < cached.expires - 60_000) return cached.token;
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: process.env.MS_REFRESH_TOKEN,
    scope: 'Files.ReadWrite offline_access',
  });
  const res = await fetch(LOGIN(process.env.MS_TENANT || 'consumers'), { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`OneDrive sign-in failed (${data.error || res.status}). Check MS_REFRESH_TOKEN.`);
  cached = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

const auth = async () => ({ Authorization: `Bearer ${await accessToken()}` });

// Small files (under 4 MB): one request
export async function upload(rel, buf, contentType) {
  const res = await fetch(itemUrl(rel, ':/content'), {
    method: 'PUT',
    headers: { ...(await auth()), 'Content-Type': contentType || 'application/octet-stream' },
    body: buf,
  });
  if (!res.ok) throw new Error(`OneDrive upload failed (${res.status})`);
  return rel;
}

// Large files (recordings): Graph gives an upload URL that the browser sends the file to in chunks
export async function createUploadSession(rel) {
  const res = await fetch(itemUrl(rel, ':/createUploadSession'), {
    method: 'POST',
    headers: { ...(await auth()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.uploadUrl) throw new Error(`OneDrive upload session failed (${res.status})`);
  return data.uploadUrl;
}

// The file's metadata, or null when it is not there (used to confirm an upload finished)
export async function exists(rel) {
  const res = await fetch(itemUrl(rel), { headers: await auth() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OneDrive lookup failed (${res.status})`);
  return res.json();
}

// Streams the file to an Express response. Returns false when it does not exist.
export async function sendTo(res, rel, headers = {}) {
  const r = await fetch(itemUrl(rel, ':/content'), { headers: await auth(), redirect: 'follow' });
  if (r.status === 404) return false;
  if (!r.ok || !r.body) throw new Error(`OneDrive download failed (${r.status})`);
  res.set({ 'Content-Type': headers.contentType || r.headers.get('content-type') || 'application/octet-stream', ...headers.extra });
  const len = r.headers.get('content-length');
  if (len) res.set('Content-Length', len);
  const { Readable } = await import('node:stream');
  Readable.fromWeb(r.body).pipe(res);
  return true;
}

export async function remove(rel) {
  const res = await fetch(itemUrl(rel), { method: 'DELETE', headers: await auth() });
  if (!res.ok && res.status !== 404) throw new Error(`OneDrive delete failed (${res.status})`);
}
