// End-to-end check against a running API. Uses only Node 18+ built-ins.
//   Terminal 1: npm run dev            (server on http://localhost:5000)
//   Terminal 2: npm run test:e2e
// Optional: INVITE_TOKEN=<token from server console> to also test accepting an invite.
const BASE = process.env.API_URL || 'http://localhost:5000/api';
const run = Date.now().toString(36);
let failures = 0;

// Minimal cookie jar so the refresh and "ws" (active workspace) cookies are sent back
function session() {
  const jar = {};
  return {
    jar,
    async call(method, path, { body, token, expect } = {}) {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      for (const c of res.headers.getSetCookie?.() || []) {
        const [pair] = c.split(';');
        const [k, ...v] = pair.split('=');
        if (v.join('=')) jar[k.trim()] = v.join('=');
      }
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data, expect };
    },
  };
}

function check(name, cond, extra = '') {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name} ${extra}`); }
}

// Sign-up sends a link by email. Locally the mail is written to the server log, so set API_LOG to that log file.
async function mailedToken(email) {
  const fs = await import('node:fs');
  for (let i = 0; i < 20; i++) {
    const text = fs.readFileSync(process.env.API_LOG, 'utf8');
    const blocks = text.split('[mail:dev]').slice(1).filter((b) => b.includes(email));
    const m = blocks.length && blocks[blocks.length - 1].match(/token=([a-f0-9]{64})/);
    if (m) return m[1];
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

async function register(email) {
  const s = session();
  const r = await s.call('POST', '/auth/register', { body: { name: 'Tester', email, password: 'password123', workspaceName: 'Test Workspace' } });
  if (r.status !== 202) return { s, token: r.data.accessToken, status: r.status };
  const token = await mailedToken(email);
  const v = await s.call('POST', '/auth/verify', { body: { token } });
  return { s, token: v.data.accessToken, status: v.status };
}

async function main() {
  if (!process.env.API_LOG) { console.log('SKIP: sign-up now needs the emailed link. Run with API_LOG=<path to the server log>.'); process.exit(0); }
  const health = await fetch(BASE.replace(/\/api$/, '') + '/api/health').then((r) => r.json()).catch(() => null);
  if (!health?.ok) { console.log('Server is not reachable at', BASE); process.exit(1); }
  check('health endpoint responds', health.ok === true);

  // Owner account
  const owner = await register(`owner-${run}@example.com`);
  check('owner registers', owner.status === 201 || owner.status === 200, `status=${owner.status}`);

  const ws = await owner.s.call('GET', '/workspace', { token: owner.token });
  check('owner has a workspace with role owner', ws.status === 200 && ws.data.role === 'owner', JSON.stringify(ws.data));
  check('workspace lists the owner as its only member', ws.data.members?.length === 1);

  const task = await owner.s.call('POST', '/tasks', { token: owner.token, body: { name: 'E2E task', status: 'todo' } });
  check('owner can create a task', task.status === 201, `status=${task.status}`);

  const unauth = await owner.s.call('GET', '/tasks');
  check('request without a token is rejected', unauth.status === 401, `status=${unauth.status}`);

  // Guest invite
  const guestEmail = `guest-${run}@example.com`;
  const inv = await owner.s.call('POST', '/workspace/invites', { token: owner.token, body: { email: guestEmail, role: 'guest' } });
  check('owner can send an invite', inv.status === 201, `status=${inv.status} ${JSON.stringify(inv.data)}`);

  const badRole = await owner.s.call('POST', '/workspace/invites', { token: owner.token, body: { email: guestEmail, role: 'owner' } });
  check('owner role cannot be invited', badRole.status === 400, `status=${badRole.status}`);

  const selfRole = await owner.s.call('PATCH', `/workspace/members/${ws.data.members[0].userId}`, { token: owner.token, body: { role: 'viewer' } });
  check('owner role cannot be changed', selfRole.status === 403, `status=${selfRole.status}`);

  const token = process.env.INVITE_TOKEN;
  if (!token) {
    console.log('SKIP  invite acceptance, guest and viewer checks (set INVITE_TOKEN to run them)');
  } else {
    // The invitee must register with the invited email, then accept the invite
    const guest = await register(guestEmail);
    const acc = await guest.s.call('POST', '/workspace/invites/accept', { token: guest.token, body: { token } });
    check('invitee accepts the invite', acc.status === 200, `status=${acc.status} ${JSON.stringify(acc.data)}`);

    const gws = await guest.s.call('GET', '/workspace', { token: guest.token });
    check('invitee now sees the owner workspace as guest', gws.data.role === 'guest', JSON.stringify(gws.data));

    const gtask = await guest.s.call('POST', '/tasks', { token: guest.token, body: { name: 'nope', status: 'todo' } });
    check('guest cannot create a task (403)', gtask.status === 403, `status=${gtask.status}`);

    const gread = await guest.s.call('GET', '/tasks', { token: guest.token });
    check('guest can read tasks', gread.status === 200 && gread.data.data?.some((t) => t.name === 'E2E task'));

    const gchat = await guest.s.call('POST', '/items', { token: guest.token, body: { kind: 'message', name: 'hello from guest', data: {} } });
    check('guest can post chat messages', gchat.status === 201, `status=${gchat.status}`);

    const members = await owner.s.call('GET', '/workspace', { token: owner.token });
    const g = members.data.members.find((m) => m.email === guestEmail);
    const demote = await owner.s.call('PATCH', `/workspace/members/${g.userId}`, { token: owner.token, body: { role: 'viewer' } });
    check('owner changes guest to viewer', demote.status === 200, `status=${demote.status}`);

    const vchat = await guest.s.call('POST', '/items', { token: guest.token, body: { kind: 'message', name: 'viewer msg', data: {} } });
    check('viewer cannot post chat messages (403)', vchat.status === 403, `status=${vchat.status}`);

    const removed = await owner.s.call('DELETE', `/workspace/members/${g.userId}`, { token: owner.token });
    check('owner removes the member', removed.status === 200, `status=${removed.status}`);
    const after = await guest.s.call('GET', '/tasks', { token: guest.token });
    check('removed member loses access to the workspace', after.status === 200 && !after.data.data?.some((t) => t.name === 'E2E task'));
  }

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error('Test crashed:', err); process.exit(1); });
