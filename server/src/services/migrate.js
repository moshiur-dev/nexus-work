import Task from '../models/Task.js';

// Brings older tasks up to date: one assignee becomes the assignees list, and Done tasks are marked closed
export async function migrate() {
  await Task.updateMany(
    { assignee: { $ne: null }, 'assignees.0': { $exists: false } },
    [{ $set: { assignees: ['$assignee'] } }]
  );
  await Task.updateMany({ status: 'done', closed: { $ne: true } }, { $set: { closed: true } });
}
