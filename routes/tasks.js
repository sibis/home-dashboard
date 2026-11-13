const express = require('express');
const { getPeople, readTasks, addTask, toggleTask, deleteTask } = require('../lib/tasks');

const router = express.Router();

// Note: no auth, intended for your home network only. Don't expose this port to the internet.

/** GET /tasks - Mobile-friendly page for adding and checking off tasks */
router.get('/tasks', (req, res) => {
  res.render('tasks', { people: getPeople() });
});

/** GET /api/tasks - All tasks plus the list of people */
router.get('/api/tasks', (req, res) => {
  res.json({ people: getPeople(), tasks: readTasks() });
});

/** POST /api/tasks - Add a task: { owner, text } */
router.post('/api/tasks', (req, res) => {
  try {
    res.status(201).json(addTask(req.body?.owner, req.body?.text));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** POST /api/tasks/:id/toggle - Mark a task done or not done */
router.post('/api/tasks/:id/toggle', (req, res) => {
  const task = toggleTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

/** DELETE /api/tasks/:id - Remove a task */
router.delete('/api/tasks/:id', (req, res) => {
  if (!deleteTask(req.params.id)) return res.status(404).json({ error: 'Task not found' });
  res.status(204).end();
});

module.exports = router;
