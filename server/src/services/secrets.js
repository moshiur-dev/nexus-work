import crypto from 'crypto';
import mongoose from 'mongoose';
import AppSetting from '../models/AppSetting.js';

// Settings the Super admin can change from the app. Anything else stays in the server's environment.
// MONGODB_URI, JWT secrets and ENCRYPTION_KEY must stay in the environment (the app needs them before it can read the database).
export const SETTINGS = {
  SMTP_URL: { label: 'Email (SMTP URL)', secret: true },
  MAIL_FROM: { label: 'Email sender address', secret: false },
  GOOGLE_CLIENT_ID: { label: 'Google Drive: client ID', secret: false },
  GOOGLE_CLIENT_SECRET: { label: 'Google Drive: client secret', secret: true },
  GOOGLE_REFRESH_TOKEN: { label: 'Google Drive: refresh token', secret: true },
  GOOGLE_DRIVE_FOLDER: { label: 'Google Drive: folder name (default: NexusWork)', secret: false },
  B2_KEY_ID: { label: 'Backblaze B2: key ID', secret: false },
  B2_APPLICATION_KEY: { label: 'Backblaze B2: application key', secret: true },
  B2_BUCKET: { label: 'Backblaze B2: bucket name', secret: false },
  B2_ENDPOINT: { label: 'Backblaze B2: endpoint (e.g. s3.us-east-005.backblazeb2.com)', secret: false },
  CLIENT_ORIGIN: { label: 'Web app address', secret: false },
};

const TTL = 60_000; // how long a read stays fresh before the database is asked again
let cache = {}; // key -> decrypted value
let loadedAt = 0;

// Saving needs ENCRYPTION_KEY, so secrets are never stored in plain text
const keyBytes = () => (process.env.ENCRYPTION_KEY ? crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest() : null);
export const canStore = () => Boolean(keyBytes());

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decrypt(stored) {
  const [v, iv, tag, data] = stored.split(':');
  if (v !== 'v1' || !keyBytes()) throw new Error('cannot read setting');
  const d = crypto.createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

// Loads the saved settings into memory (at most once a minute unless forced)
export async function refresh(force = false) {
  if (!force && Date.now() - loadedAt < TTL) return;
  if (mongoose.connection.readyState !== 1) return;
  const rows = await AppSetting.find({}).lean();
  const next = {};
  for (const r of rows) {
    try { next[r.key] = decrypt(r.value); } catch { next[r.key] = null; }
  }
  cache = next;
  loadedAt = Date.now();
}

// The saved value if there is one, otherwise the server's environment variable
export function get(key) {
  const saved = cache[key];
  if (saved) return saved;
  return process.env[key] || '';
}

export async function set(key, value, userId) {
  if (!SETTINGS[key]) throw new Error('Unknown setting');
  if (!canStore()) throw new Error('ENCRYPTION_KEY is not set on the server, so settings cannot be saved');
  if (value === '') {
    await AppSetting.deleteOne({ key });
  } else {
    await AppSetting.updateOne({ key }, { $set: { value: encrypt(value), updatedBy: userId } }, { upsert: true });
  }
  await refresh(true);
}

// What the Super admin page shows: never the values, only whether each is set and where it comes from
export async function status() {
  await refresh(true);
  const rows = await AppSetting.find({}, 'key updatedAt').lean();
  const when = Object.fromEntries(rows.map((r) => [r.key, r.updatedAt]));
  return Object.entries(SETTINGS).map(([key, meta]) => {
    const saved = Boolean(cache[key]);
    const fromEnv = !saved && Boolean(process.env[key]);
    return {
      key,
      label: meta.label,
      secret: meta.secret,
      source: saved ? 'saved' : fromEnv ? 'environment' : 'not set',
      updatedAt: when[key] || null,
    };
  });
}
