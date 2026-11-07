// Five workspace roles, highest to lowest access.
// read:   see items and tasks
// chat:   post chat messages
// write:  create, edit and delete items and tasks
// manage: invite members and change their roles (member system is not built yet)
export const ROLES = ['owner', 'admin', 'member', 'guest', 'viewer'];

const PERMISSIONS = {
  owner:  ['read', 'chat', 'write', 'manage'],
  admin:  ['read', 'chat', 'write', 'manage'],
  member: ['read', 'chat', 'write'],
  guest:  ['read', 'chat'],
  viewer: ['read'],
};

export function can(role, action) {
  return (PERMISSIONS[role] || []).includes(action);
}
