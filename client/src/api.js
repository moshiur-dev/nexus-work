// Small fetch wrapper. Keeps the access token in memory, sends the refresh cookie automatically.
let accessToken = null;

// Identifies this open page, so live updates can skip changes this page made itself
export const CLIENT_ID = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

export function setAccessToken(token) {
  accessToken = token;
}

async function request(path, { method = 'GET', body, retry = true } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': CLIENT_ID,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Access token expired: try a silent refresh once
  if (res.status === 401 && retry && path !== '/auth/refresh' && path !== '/auth/login') {
    const refreshed = await request('/auth/refresh', { method: 'POST', retry: false }).catch(() => null);
    if (refreshed?.accessToken) {
      setAccessToken(refreshed.accessToken);
      return request(path, { method, body, retry: false });
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Request failed');
    err.details = data.details;
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// For files: uploads a Blob or downloads one, with the same token refresh as request()
async function requestRaw(path, { method = 'GET', body, type, retry = true, keepalive = false, signal } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    keepalive,
    signal,
    headers: {
      ...(type ? { 'Content-Type': type } : {}),
      'X-Client-Id': CLIENT_ID,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body,
  });
  if (res.status === 401 && retry) {
    const refreshed = await request('/auth/refresh', { method: 'POST', retry: false }).catch(() => null);
    if (refreshed?.accessToken) {
      setAccessToken(refreshed.accessToken);
      return requestRaw(path, { method, body, type, retry: false, keepalive, signal });
    }
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.message || (res.status === 413 ? 'File is too large' : 'Request failed'));
    err.status = res.status;
    throw err;
  }
  return res;
}

export const api = {
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token, password) => request('/auth/reset-password', { method: 'POST', body: { token, password } }),
  twoFactorSetup: () => request('/auth/2fa/setup', { method: 'POST' }),
  twoFactorEnable: (code) => request('/auth/2fa/enable', { method: 'POST', body: { code } }),
  twoFactorDisable: (code) => request('/auth/2fa/disable', { method: 'POST', body: { code } }),
  workspace: () => request('/workspace'),
  listWorkspaces: () => request('/workspace/list'),
  switchWorkspace: (workspaceId) => request('/workspace/switch', { method: 'POST', body: { workspaceId } }),
  renameWorkspace: (name) => request('/workspace', { method: 'PATCH', body: { name } }),
  setMemberRole: (userId, role) => request(`/workspace/members/${userId}`, { method: 'PATCH', body: { role } }),
  removeMember: (userId) => request(`/workspace/members/${userId}`, { method: 'DELETE' }),
  invite: (email, role) => request('/workspace/invites', { method: 'POST', body: { email, role } }),
  listInvites: () => request('/workspace/invites'),
  cancelInvite: (id) => request(`/workspace/invites/${id}`, { method: 'DELETE' }),
  acceptInvite: (token) => request('/workspace/invites/accept', { method: 'POST', body: { token } }),
  refresh: () => request('/auth/refresh', { method: 'POST', retry: false }),
  me: () => request('/auth/me'),

  updateProfile: (payload) => request('/auth/me', { method: 'PATCH', body: payload }),

  listItems: (kind, page = 1, limit = 20) =>
    request(`/items?kind=${encodeURIComponent(kind)}&page=${page}&limit=${limit}`),
  createItem: (payload) => request('/items', { method: 'POST', body: payload }),
  updateItem: (id, payload) => request(`/items/${id}`, { method: 'PATCH', body: payload }),
  deleteItem: (id) => request(`/items/${id}`, { method: 'DELETE' }),

  listSpaces: () => request('/spaces'),
  createSpace: (payload) => request('/spaces', { method: 'POST', body: payload }),
  updateSpace: (id, payload) => request(`/spaces/${id}`, { method: 'PATCH', body: payload }),
  deleteSpace: (id) => request(`/spaces/${id}`, { method: 'DELETE' }),
  createList: (payload) => request('/spaces/lists', { method: 'POST', body: payload }),
  updateList: (id, payload) => request(`/spaces/lists/${id}`, { method: 'PATCH', body: payload }),
  deleteList: (id) => request(`/spaces/lists/${id}`, { method: 'DELETE' }),
  createFolder: (payload) => request('/spaces/folders', { method: 'POST', body: payload }),
  updateFolder: (id, payload) => request(`/spaces/folders/${id}`, { method: 'PATCH', body: payload }),
  deleteFolder: (id) => request(`/spaces/folders/${id}`, { method: 'DELETE' }),
  taskDependencies: (id) => request(`/tasks/${id}/dependencies`),
  // Live updates: a long-running response the caller reads line by line
  eventStream: (signal) => requestRaw('/events', { signal }),
  updateStatuses: (id, statuses) => request(`/spaces/lists/${id}/statuses`, { method: 'PUT', body: { statuses } }),

  listTasks: (params = '') => request(`/tasks${params}`),
  createTask: (payload) => request('/tasks', { method: 'POST', body: payload }),
  updateTask: (id, payload) => request(`/tasks/${id}`, { method: 'PATCH', body: payload }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),

  addSubtask: (taskId, name) => request(`/tasks/${taskId}/subtasks`, { method: 'POST', body: { name } }),
  updateSubtask: (taskId, sid, payload) => request(`/tasks/${taskId}/subtasks/${sid}`, { method: 'PATCH', body: payload }),
  deleteSubtask: (taskId, sid) => request(`/tasks/${taskId}/subtasks/${sid}`, { method: 'DELETE' }),
  listComments: (taskId) => request(`/tasks/${taskId}/comments`),
  addComment: (taskId, body) => request(`/tasks/${taskId}/comments`, { method: 'POST', body: { body } }),
  deleteComment: (taskId, cid) => request(`/tasks/${taskId}/comments/${cid}`, { method: 'DELETE' }),

  listChannels: () => request('/chat/channels'),
  createChannel: (name) => request('/chat/channels', { method: 'POST', body: { name } }),
  deleteChannel: (id) => request(`/chat/channels/${id}`, { method: 'DELETE' }),
  openDm: (userId) => request('/chat/dm', { method: 'POST', body: { userId } }),
  listMessages: (channelId, after) =>
    request(`/chat/channels/${channelId}/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`),
  sendMessage: (channelId, body) => request(`/chat/channels/${channelId}/messages`, { method: 'POST', body: { body } }),
  deleteMessage: (id) => request(`/chat/messages/${id}`, { method: 'DELETE' }),

  runningTimer: () => request('/time/running'),
  startTimer: (task, screenshots) => request('/time/start', { method: 'POST', body: { task, screenshots } }),
  stopTimer: () => request('/time/stop', { method: 'POST' }),
  addActivity: (entryId, payload, keepalive = false) =>
    requestRaw(`/time/entries/${entryId}/activity`, { method: 'PATCH', body: JSON.stringify(payload), type: 'application/json', keepalive }).then((r) => r.json()),
  timeEntries: ({ from, to, user } = {}) => request(`/time/entries?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(user ? { user } : {}) })}`),
  taskTime: (taskId) => request(`/time/task/${taskId}`),
  deleteTimeEntry: (id) => request(`/time/entries/${id}`, { method: 'DELETE' }),
  uploadScreenshot: (entryId, blob) =>
    requestRaw(`/time/entries/${entryId}/screenshots`, { method: 'POST', body: blob, type: blob.type }).then((r) => r.json()),
  screenshotBlob: (id) => requestRaw(`/time/screenshots/${id}`).then((r) => r.blob()),
  deleteScreenshot: (id) => request(`/time/screenshots/${id}`, { method: 'DELETE' }),
  listRecordings: (taskId) => request(`/time/recordings?task=${taskId}`),
  uploadRecording: (taskId, blob, seconds) =>
    requestRaw(`/time/recordings?task=${taskId}&seconds=${seconds}`, { method: 'POST', body: blob, type: 'video/webm' }).then((r) => r.json()),
  recordingBlob: (id) => requestRaw(`/time/recordings/${id}/file`).then((r) => r.blob()),
  deleteRecording: (id) => request(`/time/recordings/${id}`, { method: 'DELETE' }),

  listAttachments: (taskId) => request(`/tasks/${taskId}/attachments`),
  uploadAttachment: (taskId, file) =>
    requestRaw(`/tasks/${taskId}/attachments?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, type: 'application/octet-stream' }).then((r) => r.json()),
  attachmentBlob: (id) => requestRaw(`/tasks/attachments/${id}/file`).then((r) => r.blob()),
  deleteAttachment: (id) => request(`/tasks/attachments/${id}`, { method: 'DELETE' }),

  notifications: (unread) => request(`/notifications${unread ? '?unread=1' : ''}`),
  notificationCount: () => request('/notifications/count'),
  markNotification: (id, read = true) => request(`/notifications/${id}/read`, { method: 'PATCH', body: { read } }),
  markAllNotifications: () => request('/notifications/read-all', { method: 'POST' }),

  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),
};
