// Live updates: each open app keeps a stream open, and changes are pushed to everyone in the same workspace.
// This lives in memory, so it works for one server process.
const clients = new Map(); // workspaceId -> Set of { userId, res }

export function subscribe(workspaceId, userId, res) {
  const key = String(workspaceId);
  if (!clients.has(key)) clients.set(key, new Set());
  const client = { userId: String(userId), res };
  clients.get(key).add(client);
  return () => {
    clients.get(key)?.delete(client);
    if (!clients.get(key)?.size) clients.delete(key);
  };
}

// Sends an event to the workspace, or only to the listed users when `onlyUsers` is given
export function publish(workspaceId, event, onlyUsers = null) {
  const set = clients.get(String(workspaceId));
  if (!set) return;
  const only = onlyUsers && new Set(onlyUsers.map(String));
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of set) {
    if (only && !only.has(c.userId)) continue;
    try { c.res.write(line); } catch { /* the stream closed; its cleanup removes it */ }
  }
}

export const clientCount = () => [...clients.values()].reduce((n, s) => n + s.size, 0);
