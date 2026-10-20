import { Hono } from 'hono';
import type { Env, AppVariables, NotificationRow } from '../types';

const notifications = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// GET /api/notifications — list current user's notifications
// Unread first, then most recent. Caller can pass ?limit=N (default 30, max 100).
notifications.get('/', async (c) => {
  const user = c.get('user');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30', 10), 100);

  const { results } = await c.env.DB.prepare(
    `
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY read ASC, created_at DESC
    LIMIT ?
  `,
  )
    .bind(user.sub, limit)
    .all<NotificationRow>();

  return c.json({ notifications: results });
});

// GET /api/notifications/unread-count
notifications.get('/unread-count', async (c) => {
  const user = c.get('user');

  const row = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read = 0',
  )
    .bind(user.sub)
    .first<{ count: number }>();

  return c.json({ count: row?.count ?? 0 });
});

// POST /api/notifications/:id/read
notifications.post('/:id/read', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);

  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?')
    .bind(id, user.sub)
    .run();

  return c.json({ message: 'Marked read' });
});

// POST /api/notifications/read-all
notifications.post('/read-all', async (c) => {
  const user = c.get('user');

  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0')
    .bind(user.sub)
    .run();

  return c.json({ message: 'All marked read' });
});

export default notifications;
