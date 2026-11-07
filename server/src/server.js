import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './config/db.js';
import { migrate } from './services/migrate.js';
import notificationRoutes from './routes/notifications.js';
import eventRoutes from './routes/events.js';
import authRoutes from './routes/auth.js';
import taskRoutes from './routes/tasks.js';
import itemRoutes from './routes/items.js';
import workspaceRoutes from './routes/workspace.js';
import spaceRoutes from './routes/spaces.js';
import chatRoutes from './routes/chat.js';
import searchRoutes from './routes/search.js';
import timeRoutes from './routes/time.js';
import { errorHandler, notFound } from './middleware/error.js';

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/spaces', spaceRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/time', timeRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/events', eventRoutes);

// When the web app has been built (client/dist), serve it here too, so one address runs everything
const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
  // Any other non-API path is a page of the single-page app
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

app.use(notFound);
app.use(errorHandler);

const port = process.env.PORT || 5000;
connectDB().then(async () => {
  await migrate();
  app.listen(port, () => console.log(`API running on http://localhost:${port}`));
});
