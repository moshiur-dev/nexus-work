// Checks the setup in CHECKLIST.md before running the app. Node built-ins only.
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const pass = (m) => console.log(`PASS  ${m}`);
const fail = (m) => { fails++; console.log(`FAIL  ${m}`); };

const major = Number(process.versions.node.split('.')[0]);
major >= 18 ? pass(`Node ${process.versions.node}`) : fail(`Node 18+ needed, found ${process.versions.node}`);

fs.existsSync(path.join(root, 'node_modules')) ? pass('server dependencies installed') : fail('run npm install in server/');
const clientModules = path.join(root, '..', 'client', 'node_modules');
fs.existsSync(clientModules) ? pass('client dependencies installed') : fail('run npm install in client/');

const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath)) {
  fail('server/.env is missing (copy .env.example)');
} else {
  const env = Object.fromEntries(
    fs.readFileSync(envPath, 'utf8').split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
  for (const key of ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'CLIENT_ORIGIN']) {
    env[key] ? pass(`${key} is set`) : fail(`${key} is empty in server/.env`);
  }
  if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) fail('JWT secrets must be different');
  if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET.length < 32) fail('JWT_ACCESS_SECRET should be at least 32 characters');

  // Check the MongoDB port is open (Atlas "mongodb+srv" URIs are skipped)
  const uri = env.MONGODB_URI || '';
  const m = uri.match(/^mongodb:\/\/(?:[^@]+@)?([^:/,]+)(?::(\d+))?/);
  if (uri.startsWith('mongodb+srv://')) {
    pass('Atlas connection string (reachability is checked when the server starts)');
  } else if (m) {
    const [, host, port = '27017'] = m;
    await new Promise((resolve) => {
      const sock = net.connect({ host, port: Number(port), timeout: 2000 });
      sock.on('connect', () => { pass(`MongoDB is reachable at ${host}:${port}`); sock.destroy(); resolve(); });
      const bad = (why) => { fail(`MongoDB not reachable at ${host}:${port} (${why})`); sock.destroy(); resolve(); };
      sock.on('timeout', () => bad('timeout'));
      sock.on('error', (e) => bad(e.code));
    });
  }
}

console.log(fails ? `\n${fails} problem(s). Fix the FAIL lines above and run again.` : '\nReady to run.');
process.exit(fails ? 1 : 0);
