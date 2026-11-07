import Notification from '../models/Notification.js';
import { publish } from './events.js';

// Sends one notification to each user, except the person who caused it
export async function notify({ workspace, users, actor, type, text, task = null }) {
  const ids = [...new Set(users.filter(Boolean).map(String))].filter((u) => u !== String(actor || ''));
  if (!ids.length) return;
  await Notification.insertMany(ids.map((user) => ({ workspace, user, actor, type, text: text.slice(0, 300), task })));
  publish(workspace, { type: 'notification' }, ids);
}
