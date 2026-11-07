// Vercel entry point: every /api/* request runs through the Express app.
// The database connection is set up on the first request (and reused while the function stays warm).
import app from '../server/src/app.js';
import { connectDB } from '../server/src/config/db.js';
import { migrate } from '../server/src/services/migrate.js';

let ready = null;
const setup = () => (ready ??= connectDB().then(migrate).catch((err) => { ready = null; throw err; }));

export default async function handler(req, res) {
  try {
    await setup();
  } catch (err) {
    console.error('Database not ready:', err.message);
    return res.status(503).json({ message: 'The database is not reachable yet. Check MONGODB_URI.' });
  }
  return app(req, res);
}
