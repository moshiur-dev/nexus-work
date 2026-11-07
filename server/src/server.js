import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import app from './app.js';
import { connectDB } from './config/db.js';
import { migrate } from './services/migrate.js';

// When the web app has been built (client/dist), serve it here too, so one address runs everything
const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
  // Any other non-API path is a page of the single-page app
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

const port = process.env.PORT || 5000;
connectDB().then(async () => {
  await migrate();
  app.listen(port, () => console.log(`API running on http://localhost:${port}`));
});
