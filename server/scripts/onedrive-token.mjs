// Run once on your own computer to get MS_REFRESH_TOKEN for OneDrive storage:  node scripts/onedrive-token.mjs
// Copy the printed refresh token into the server's environment variables. Do not share it.
import readline from 'readline/promises';

const REDIRECT = 'http://localhost:3000/callback';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const clientId = (await rl.question('Application (client) ID: ')).trim();
const clientSecret = (await rl.question('Client secret value: ')).trim();
const scope = 'Files.ReadWrite offline_access';

const link = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}&response_mode=query&scope=${encodeURIComponent(scope)}`;
console.log(`\n1) Open this link, sign in with the OneDrive account and allow access:\n${link}\n`);
console.log('2) The browser then goes to a "localhost" page that does not open. That is fine.');
console.log('   Copy the value after "code=" in the address bar.\n');

const code = (await rl.question('code: ')).trim();
rl.close();

const res = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
  method: 'POST',
  body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: REDIRECT, scope }),
});
const data = await res.json();
if (!data.refresh_token) {
  console.error('Could not get a refresh token:', data.error_description || data.error || res.status);
  process.exit(1);
}
console.log(`\nMS_REFRESH_TOKEN=${data.refresh_token}\n`);
