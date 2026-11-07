// Every list starts with these. A list can replace them with its own (List.statuses).
export const DEFAULT_STATUSES = [
  { id: 'todo', name: 'To Do', color: '#87909e', type: 'open' },
  { id: 'prog', name: 'In Progress', color: '#5b8def', type: 'open' },
  { id: 'done', name: 'Done', color: '#16a34a', type: 'done' },
];

export const statusesOf = (list) => (list?.statuses?.length ? list.statuses : DEFAULT_STATUSES);
