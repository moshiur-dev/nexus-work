// Run once on your own computer to get GOOGLE_REFRESH_TOKEN for Google Drive storage:  node scripts/google-token.mjs
// Copy the printed refresh token into the Super admin page (or the server environment). Do not share it.
import readline from 'readline/promises';

const REDIRECT = 'http://localhost:3000/callback';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const clientId = (await rl.question('Client ID: ')).trim();
const clientSecret = (await rl.question('Client secret: ')).trim();

const link = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',
}).toString();
console.log('\n1) Open this link, sign in with the Google account that owns the Drive, and allow access:\n' + link + '\n');
console.log('2) The browser then goes to a "localhost" page that does not open. That is fine.');
console.log('   Copy the value after "code=" in the address bar.\n');

const code = (await rl.question('code: ')).trim();
rl.close();

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
});
const data = await res.json();
if (!data.refresh_token) {
  console.error('Could not get a refresh token:', data.error_description || data.error || res.status);
  process.exit(1);
}
console.log('\nGOOGLE_REFRESH_TOKEN=' + data.refresh_token + '\n');
