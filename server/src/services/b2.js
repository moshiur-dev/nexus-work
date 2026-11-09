// Backblaze B2 storage (through its S3-compatible API) for screenshots, recordings and attachments.
// Used when B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET and B2_ENDPOINT are set (Super admin page or environment).
// The browser uploads straight to B2 with a short-lived signed address, so big files never pass through Vercel.
import { Readable } from 'node:stream';
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as secrets from './secrets.js';

export const enabled = () =>
  Boolean(secrets.get('B2_KEY_ID') && secrets.get('B2_APPLICATION_KEY') && secrets.get('B2_BUCKET') && secrets.get('B2_ENDPOINT'));

// "https://s3.us-east-005.backblazeb2.com/" -> "s3.us-east-005.backblazeb2.com"
const hostOf = () => secrets.get('B2_ENDPOINT').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const regionOf = (host) => host.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/)?.[1] || 'us-east-005';

let client = null;
let clientKey = '';
function s3() {
  const host = hostOf();
  const id = secrets.get('B2_KEY_ID');
  const secret = secrets.get('B2_APPLICATION_KEY');
  const key = `${host}|${id}|${secret}`;
  if (!client || clientKey !== key) {
    client = new S3Client({
      endpoint: `https://${host}`,
      region: regionOf(host),
      credentials: { accessKeyId: id, secretAccessKey: secret },
      // Keep plain signed URLs for the browser (no extra checksum headers it would have to send)
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    clientKey = key;
  }
  return client;
}

const bucket = () => secrets.get('B2_BUCKET');
const notFound = (err) => err?.name === 'NotFound' || err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404;

// A signed address the browser can PUT the whole file to (valid for one hour)
export async function createUploadSession(rel, contentType = 'application/octet-stream') {
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: bucket(), Key: rel, ContentType: contentType }), { expiresIn: 3600 });
}

// Small files (the server path): one request with the whole file
export async function upload(rel, buf, contentType) {
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: rel, Body: buf, ContentType: contentType || 'application/octet-stream' }));
  return rel;
}

// Metadata of a stored file, or null if it is not there
export async function exists(rel) {
  try {
    const r = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: rel }));
    return { size: Number(r.ContentLength || 0) };
  } catch (err) {
    if (notFound(err)) return null;
    throw err;
  }
}

// Streams a stored file to the browser. Returns false when it does not exist.
export async function sendTo(res, rel, headers = {}) {
  let r;
  try {
    r = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: rel }));
  } catch (err) {
    if (notFound(err)) return false;
    throw err;
  }
  res.set({ 'Content-Type': headers.contentType || 'application/octet-stream', ...headers.extra });
  if (r.ContentLength) res.set('Content-Length', String(r.ContentLength));
  const body = r.Body;
  if (body instanceof Readable) body.pipe(res);
  else Readable.fromWeb(body.transformToWebStream()).pipe(res);
  return true;
}

export async function remove(rel) {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: rel })).catch(() => {});
}
