import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { requireAdmin } from '../middleware/auth';
import { verifyToken } from '../lib/jwt';
import { checkTokenValidity } from '../lib/tokenValidity';
import { assertOfficeAccess, officeAccessJson } from '../lib/officeAccess';
import { getClientIpFromRequest } from '../lib/officeNetwork';
import { armLiveTraffic } from '../lib/liveTraffic';
import { ADMIN_ROLES } from '../types';
import type { AppVariables, Env } from '../types';

type WorkbenchBindings = { Bindings: Env; Variables: AppVariables };

const workbench = new Hono<WorkbenchBindings>();

/**
 * Internal developer workbench.
 *
 * Security model:
 * - global /api auth + office gate still run in index.ts
 * - every route below is admin-only
 * - GitHub access is disabled unless DEV_WORKBENCH_ENABLED=1
 * - token stays in the Worker secret store; it is never returned to the browser
 * - writes are only accepted on workbench/* branches
 * - .github/workflows cannot be edited from the workbench
 * - tests run a fixed workflow with contents:read and no deployment secrets
 *
 * This is deliberately NOT a customer feature.  Tenant deployments should leave
 * DEV_WORKBENCH_ENABLED unset.
 */
workbench.use('/workbench/*', requireAdmin());

/**
 * `GET /api/mgl-ai/workbench-live?t=<jwt>` — амьд урсгалын WebSocket.
 *
 * ⚠️ `middleware/auth.ts`-ийн нээлттэй жагсаалтад БАЙГАА (хөтчийн WebSocket
 *    `Authorization` толгой явуулж чаддаггүй — `/api/client/ws`-тэй ижил буулт),
 *    тиймээс токен, цуцлалт, admin role, оффисын сүлжээг ЭНД өөрөө шалгана.
 *    Purpose-тэй токен (print, revit, …) хүлээн авахгүй.
 */
workbench.get('/workbench-live', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return c.json({ error: 'Expected websocket' }, 426);
  const token = c.req.query('t') || getCookie(c, 'token');
  const payload = token ? await verifyToken(token, c.env.JWT_SECRET) : null;
  if (!payload || payload.purpose) return c.json({ error: 'Unauthorized' }, 401);
  if (!(ADMIN_ROLES as readonly string[]).includes(payload.role)) return c.json({ error: 'Admin only' }, 403);
  const validity = await checkTokenValidity(c.env.DB, payload);
  if (!validity.ok) return c.json({ error: 'Unauthorized' }, 401);
  const office = await assertOfficeAccess({
    env: c.env,
    requestUrl: c.req.url,
    clientIp: getClientIpFromRequest(c.req.raw),
    db: c.env.DB,
    user: { sub: payload.sub, role: payload.role },
  });
  if (!office.ok) return c.json(officeAccessJson(office), office.status as 403);
  if (!c.env.WORKBENCH_LIVE) return c.json({ error: 'Live channel unavailable' }, 503);

  // Энэ isolate шууд зэвсэглэнэ — бусад нь дараагийн probe дээрээ нэгдэнэ.
  armLiveTraffic();
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Live-User', String(payload.sub));
  const stub = c.env.WORKBENCH_LIVE.get(c.env.WORKBENCH_LIVE.idFromName('workbench:live'));
  return stub.fetch(new Request('https://workbench-live/ws', { headers }));
});

/**
 * `POST /api/mgl-ai/workbench/probe` — «D1 рүү хүсэлт явуулаад графаар урсахыг
 * харах» товч.  Хоёр жижиг COUNT (хэдэн арван мөр уншина) — зориуд хямд.
 */
workbench.post('/workbench/probe', async (c) => {
  const started = Date.now();
  const [projects, users] = await c.env.DB.batch<{ n: number }>([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM projects'),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'active'"),
  ]);
  return c.json({
    ok: true,
    projects: projects?.results[0]?.n ?? 0,
    active_users: users?.results[0]?.n ?? 0,
    ms: Date.now() - started,
  });
});

const DEFAULT_REPO = 'osohbayr1016/mgl-e-c';
const DEFAULT_BASE = 'main';
const WORKFLOW_FILE = 'dev-workbench.yml';
const MAX_FILE_CHARS = 700_000;
const MAX_TREE_ITEMS = 5_000;

function enabled(env: Env): boolean {
  return env.DEV_WORKBENCH_ENABLED === '1';
}

function config(env: Env) {
  const repository = (env.GITHUB_WORKBENCH_REPO ?? DEFAULT_REPO).trim();
  const baseBranch = (env.GITHUB_WORKBENCH_BASE_BRANCH ?? DEFAULT_BASE).trim() || DEFAULT_BASE;
  const token = env.GITHUB_WORKBENCH_TOKEN?.trim() ?? '';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GITHUB_WORKBENCH_REPO буруу байна.');
  }
  return { repository, baseBranch, token };
}

function safePath(raw: string | undefined): string | null {
  if (!raw) return null;
  const p = raw.replace(/^\/+/, '').trim();
  if (!p || p.includes('\0') || p.split('/').some((part) => part === '..' || part === '')) return null;
  return p;
}

function safeBranch(raw: string | undefined): string | null {
  if (!raw) return null;
  const b = raw.trim();
  if (!/^workbench\/[A-Za-z0-9._/-]+$/.test(b) || b.includes('..') || b.endsWith('/')) return null;
  return b;
}

function protectedPath(path: string): boolean {
  return path === '.github/workflows' || path.startsWith('.github/workflows/');
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUtf8(input: string): string {
  const binary = atob(input.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function github<T>(
  env: Env,
  apiPath: string,
  init: RequestInit = {},
): Promise<{ data: T; status: number; headers: Headers }> {
  const { repository, token } = config(env);
  if (!enabled(env)) throw Object.assign(new Error('Developer workbench disabled'), { status: 403 });
  if (!token) throw Object.assign(new Error('GITHUB_WORKBENCH_TOKEN тохируулаагүй байна.'), { status: 503 });

  const response = await fetch(`https://api.github.com/repos/${repository}${apiPath}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mgl-system-workbench',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  let data: unknown = {};
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 500) };
    }
  }
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string'
        ? (data as { message: string }).message
        : `GitHub HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return { data: data as T, status: response.status, headers: response.headers };
}

function apiError(c: Context<WorkbenchBindings>, err: unknown) {
  const status =
    err && typeof err === 'object' && 'status' in err && typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : 500;
  const message = err instanceof Error ? err.message : 'Developer workbench error';
  console.error('[dev-workbench]', err);
  return c.json({ error: message }, status as 400 | 401 | 403 | 404 | 409 | 422 | 500 | 502 | 503);
}

workbench.get('/workbench/status', async (c) => {
  const cfg = config(c.env);
  return c.json({
    enabled: enabled(c.env),
    configured: enabled(c.env) && cfg.token.length > 0,
    repository: cfg.repository,
    base_branch: cfg.baseBranch,
    workflow: WORKFLOW_FILE,
    policy: {
      branch_prefix: 'workbench/',
      direct_main_writes: false,
      protected_paths: ['.github/workflows/**'],
      tests_have_deploy_secrets: false,
    },
  });
});

workbench.get('/workbench/file', async (c) => {
  try {
    const path = safePath(c.req.query('path'));
    const ref = c.req.query('ref')?.trim() || config(c.env).baseBranch;
    if (!path) return c.json({ error: 'path шаардлагатай.' }, 400);

    type FileResponse = {
      type: string;
      name: string;
      path: string;
      sha: string;
      size: number;
      encoding: string;
      content?: string;
      html_url?: string;
    };
    const { data } = await github<FileResponse>(
      c.env,
      `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
    );
    if (data.type !== 'file' || data.encoding !== 'base64' || typeof data.content !== 'string') {
      return c.json({ error: 'Энэ зам текст файл биш байна.' }, 422);
    }
    if (data.size > MAX_FILE_CHARS * 2) {
      return c.json({ error: 'Файл workbench editor-д хэт том байна.', size: data.size }, 422);
    }
    return c.json({
      path: data.path,
      name: data.name,
      sha: data.sha,
      size: data.size,
      ref,
      content: base64ToUtf8(data.content),
      html_url: data.html_url ?? null,
      protected: protectedPath(data.path),
    });
  } catch (err) {
    return apiError(c, err);
  }
});

workbench.get('/workbench/tree', async (c) => {
  try {
    const ref = c.req.query('ref')?.trim() || config(c.env).baseBranch;
    const prefix = (c.req.query('prefix') ?? '').replace(/^\/+/, '').trim().toLowerCase();
    type TreeResponse = {
      truncated?: boolean;
      tree: Array<{ path: string; mode: string; type: 'blob' | 'tree'; sha: string; size?: number }>;
    };
    const { data } = await github<TreeResponse>(
      c.env,
      `/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    );
    const entries = data.tree
      .filter((item) => item.type === 'blob')
      .filter((item) => !prefix || item.path.toLowerCase().includes(prefix))
      .slice(0, MAX_TREE_ITEMS)
      .map((item) => ({ path: item.path, sha: item.sha, size: item.size ?? 0 }));
    return c.json({ ref, prefix, truncated: data.truncated === true || entries.length >= MAX_TREE_ITEMS, entries });
  } catch (err) {
    return apiError(c, err);
  }
});

workbench.post('/workbench/session', async (c) => {
  try {
    if (!enabled(c.env)) return c.json({ error: 'Developer workbench disabled' }, 403);
    const user = c.get('user');
    const body = (await c.req.json().catch(() => ({}))) as { title?: unknown };
    const title = typeof body.title === 'string' ? body.title : '';
    const slug =
      title
        .normalize('NFKD')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 36) || 'session';
    const cfg = config(c.env);

    type RefResponse = { object: { sha: string } };
    const { data: base } = await github<RefResponse>(
      c.env,
      `/git/ref/heads/${encodeURIComponent(cfg.baseBranch)}`,
    );
    const suffix = crypto.randomUUID().slice(0, 8);
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const branch = `workbench/u${user.sub}/${stamp}-${slug}-${suffix}`;

    await github(c.env, '/git/refs', {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha }),
    });
    return c.json({ branch, base_branch: cfg.baseBranch, base_sha: base.object.sha });
  } catch (err) {
    return apiError(c, err);
  }
});

workbench.put('/workbench/file', async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const branch = safeBranch(typeof body.branch === 'string' ? body.branch : undefined);
    const path = safePath(typeof body.path === 'string' ? body.path : undefined);
    const content = typeof body.content === 'string' ? body.content : null;
    const sha = typeof body.sha === 'string' && body.sha.trim() ? body.sha.trim() : undefined;
    const message =
      typeof body.message === 'string' && body.message.trim()
        ? body.message.trim().slice(0, 120)
        : `workbench: update ${path ?? 'file'}`;

    if (!branch) return c.json({ error: 'Зөв workbench branch шаардлагатай.' }, 400);
    if (!path) return c.json({ error: 'path шаардлагатай.' }, 400);
    if (protectedPath(path)) {
      return c.json({ error: '.github/workflows файлыг workbench-ээс засахыг хориглосон.' }, 403);
    }
    if (content === null) return c.json({ error: 'content шаардлагатай.' }, 400);
    if (content.length > MAX_FILE_CHARS) return c.json({ error: 'Файл хэт том байна.' }, 413);

    type UpdateResponse = {
      content?: { sha?: string; html_url?: string };
      commit?: { sha?: string; html_url?: string };
    };
    const { data } = await github<UpdateResponse>(c.env, `/contents/${encodePath(path)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: utf8ToBase64(content),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    return c.json({
      ok: true,
      branch,
      path,
      sha: data.content?.sha ?? null,
      commit_sha: data.commit?.sha ?? null,
      commit_url: data.commit?.html_url ?? null,
    });
  } catch (err) {
    return apiError(c, err);
  }
});

workbench.post('/workbench/tests', async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const branch = safeBranch(typeof body.branch === 'string' ? body.branch : undefined);
    const suite = typeof body.suite === 'string' ? body.suite : 'all';
    if (!branch) return c.json({ error: 'Зөв workbench branch шаардлагатай.' }, 400);
    if (!['frontend', 'backend', 'ai', 'all'].includes(suite)) {
      return c.json({ error: 'suite буруу байна.' }, 400);
    }

    // The workflow itself is immutable from the workbench UI and has contents:read only.
    // Once this feature is merged to main, workflow_dispatch can validate any workbench branch.
    const cfg = config(c.env);
    await github(c.env, `/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({
        ref: cfg.baseBranch,
        inputs: { target_ref: branch, suite },
      }),
    });
    return c.json({ ok: true, branch, suite, workflow: WORKFLOW_FILE });
  } catch (err) {
    return apiError(c, err);
  }
});

workbench.get('/workbench/runs', async (c) => {
  try {
    const branch = safeBranch(c.req.query('branch'));
    if (!branch) return c.json({ error: 'Зөв workbench branch шаардлагатай.' }, 400);

    type RunsResponse = {
      workflow_runs: Array<{
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        html_url: string;
        created_at: string;
        updated_at: string;
        head_branch: string | null;
        display_title?: string;
      }>;
    };
    // Runs are launched from main but checkout target_ref as an input; filtering by
    // event keeps this list small.  We return the latest workbench validations and
    // let the UI display the branch requested in each run's title/inputs after dispatch.
    const { data } = await github<RunsResponse>(
      c.env,
      `/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=20`,
    );
    return c.json({
      branch,
      runs: data.workflow_runs
        .filter((run) => (run.display_title ?? run.name).includes(branch))
        .slice(0, 12)
        .map((run) => ({
        id: run.id,
        name: run.display_title ?? run.name,
        status: run.status,
        conclusion: run.conclusion,
        url: run.html_url,
        created_at: run.created_at,
        updated_at: run.updated_at,
        head_branch: run.head_branch,
      })),
    });
  } catch (err) {
    return apiError(c, err);
  }
});

workbench.post('/workbench/pr', async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const branch = safeBranch(typeof body.branch === 'string' ? body.branch : undefined);
    if (!branch) return c.json({ error: 'Зөв workbench branch шаардлагатай.' }, 400);
    const cfg = config(c.env);
    const title =
      typeof body.title === 'string' && body.title.trim()
        ? body.title.trim().slice(0, 120)
        : 'Developer workbench changes';
    const prBody =
      typeof body.body === 'string' && body.body.trim()
        ? body.body.trim().slice(0, 8_000)
        : 'Created from MGL System Workbench.\n\n- Changes were written only to a workbench branch.\n- Review validation results before merge.';

    type PrResponse = { number: number; html_url: string; state: string; draft?: boolean };
    const { data } = await github<PrResponse>(c.env, '/pulls', {
      method: 'POST',
      body: JSON.stringify({
        title,
        head: branch,
        base: cfg.baseBranch,
        body: prBody,
        draft: true,
      }),
    });
    return c.json({ ok: true, number: data.number, url: data.html_url, state: data.state, draft: data.draft === true });
  } catch (err) {
    return apiError(c, err);
  }
});

export default workbench;
