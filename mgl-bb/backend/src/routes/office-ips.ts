import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

const officeIps = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Ирцийн оффис-IP жагсаалтыг admin удирдана.
officeIps.use('/*', requireAdmin());

officeIps.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT oi.*, u.full_name AS created_by_name
     FROM office_ips oi
     LEFT JOIN users u ON u.id = oi.created_by
     ORDER BY oi.created_at DESC`,
  ).all();
  return c.json({ ips: results });
});

officeIps.post('/', async (c) => {
  const body = await c.req.json<{ label: string; ip_address: string }>();
  const user = c.get('user');

  if (!body.label?.trim() || !body.ip_address?.trim()) {
    return c.json({ error: 'label and ip_address are required' }, 400);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO office_ips (label, ip_address, created_by) VALUES (?, ?, ?)',
  )
    .bind(body.label.trim(), body.ip_address.trim(), user.sub)
    .run();

  return c.json({ id: result.meta.last_row_id }, 201);
});

officeIps.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM office_ips WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

officeIps.patch('/:id/toggle', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare(
    'UPDATE office_ips SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?',
  )
    .bind(id)
    .run();
  return c.json({ ok: true });
});

export default officeIps;
