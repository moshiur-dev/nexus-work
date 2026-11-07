import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
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

// The Express app. server.js runs it on a port; api/index.js runs it on Vercel.
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

app.use(notFound);
app.use(errorHandler);

export default app;
