// Sets the CORS rules on the Backblaze B2 bucket so the browser may upload straight to it.
// Run once on your own computer. Keys are read from environment variables and are not stored anywhere:
//   B2_KEY_ID=<key ID>  B2_APP_KEY=<application key>  node scripts/b2-cors.mjs
// Use a key that can change bucket settings (the master key, or a key with writeBuckets).
const BUCKET = process.env.B2_BUCKET || 'nexus665686';
const keyId = process.env.B2_KEY_ID;
const appKey = process.env.B2_APP_KEY;
if (!keyId || !appKey) {
  console.error('Set B2_KEY_ID and B2_APP_KEY first.');
  process.exit(1);
}

const API = 'https://api.backblazeb2.com/b2api/v2';
const fail = async (res, step) => {
  const text = await res.text();
  throw new Error(`${step} failed (${res.status}): ${text}`);
};

// 1) log in
const authRes = await fetch(`${API}/b2_authorize_account`, {
  headers: { Authorization: 'Basic ' + Buffer.from(`${keyId}:${appKey}`).toString('base64') },
});
if (!authRes.ok) await fail(authRes, 'Login');
const auth = await authRes.json();

// 2) find the bucket
const listRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_buckets`, {
  method: 'POST',
  headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
  body: JSON.stringify({ accountId: auth.accountId, bucketName: BUCKET }),
});
if (!listRes.ok) await fail(listRes, 'Finding the bucket');
const bucket = (await listRes.json()).buckets?.[0];
if (!bucket) throw new Error(`Bucket "${BUCKET}" was not found for this key`);

// 3) set the rules: any origin may upload and read with S3-style requests (every upload is still signed)
const corsRules = [
  {
    corsRuleName: 'browserUploads',
    allowedOrigins: ['*'],
    allowedOperations: ['s3_put', 's3_get', 's3_head', 'b2_upload_file', 'b2_download_file_by_name'],
    allowedHeaders: ['*'],
    exposeHeaders: ['etag', 'x-amz-request-id'],
    maxAgeSeconds: 3600,
  },
];
const updRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_update_bucket`, {
  method: 'POST',
  headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
  body: JSON.stringify({ accountId: auth.accountId, bucketId: bucket.bucketId, bucketType: bucket.bucketType, corsRules }),
});
if (!updRes.ok) await fail(updRes, 'Saving the CORS rules');
console.log(`CORS rules saved on "${BUCKET}". Wait about a minute, then try the recording again.`);
