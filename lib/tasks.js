const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, ensureDataDir } = require('./paths');

/**
 * Family task list, stored in data/tasks.json (kept separate from state.json so
 * phone edits never collide with service cache writes).
 * Task shape: { id, owner, text, done, createdAt, doneAt }
 */
ensureDataDir();
const TASKS_PATH = path.join(DATA_DIR, 'tasks.json');
const MAX_TEXT_LENGTH = 80;
const KEEP_DONE_DAYS = 7; // Completed tasks are pruned after this many days

/** People who can own tasks, from TASK_PEOPLE (comma separated). Max 3 so they fit on the display. */
function getPeople() {
  const raw = process.env.TASK_PEOPLE || 'Sibi,Partner,Shared';
  return raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
}

function readTasks() {
  try {
    if (fs.existsSync(TASKS_PATH)) return JSON.parse(fs.readFileSync(TASKS_PATH, 'utf-8'));
  } catch (err) {
    console.warn('Failed to read tasks.json:', err.message);
  }
  return [];
}

function writeTasks(tasks) {
  // Drop old completed tasks, then write atomically so a crash can't corrupt the file
  const cutoff = Date.now() - KEEP_DONE_DAYS * 24 * 60 * 60 * 1000;
  const kept = tasks.filter(t => !t.done || t.doneAt > cutoff);
  const tmp = `${TASKS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(kept, null, 2));
  fs.renameSync(tmp, TASKS_PATH);
  return kept;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function addTask(owner, text) {
  if (!getPeople().includes(owner)) throw badRequest('Unknown owner');
  const clean = String(text || '').trim().slice(0, MAX_TEXT_LENGTH);
  if (!clean) throw badRequest('Task text is required');

  const tasks = readTasks();
  const task = { id: crypto.randomUUID(), owner, text: clean, done: false, createdAt: Date.now(), doneAt: null };
  tasks.push(task);
  writeTasks(tasks);
  return task;
}

function toggleTask(id) {
  const tasks = readTasks();
  const task = tasks.find(t => t.id === id);
  if (!task) return null;
  task.done = !task.done;
  task.doneAt = task.done ? Date.now() : null;
  writeTasks(tasks);
  return task;
}

function deleteTask(id) {
  const tasks = readTasks();
  const remaining = tasks.filter(t => t.id !== id);
  if (remaining.length === tasks.length) return false;
  writeTasks(remaining);
  return true;
}

/**
 * Summary for the dashboard: per-person open count and tasks completed today,
 * plus the oldest open task as "next".
 * @param {string} [timezone] - IANA timezone that defines "today"
 */
function getTasksSummary(timezone) {
  const tasks = readTasks();
  const dayKey = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
  const today = dayKey(Date.now());

  const people = getPeople().map(name => ({
    name,
    left: tasks.filter(t => t.owner === name && !t.done).length,
    done: tasks.filter(t => t.owner === name && t.done && dayKey(t.doneAt) === today).length,
  }));

  const next = tasks.filter(t => !t.done).sort((a, b) => a.createdAt - b.createdAt)[0];
  return { people, next: next ? next.text : null };
}

module.exports = { getPeople, readTasks, addTask, toggleTask, deleteTask, getTasksSummary };
