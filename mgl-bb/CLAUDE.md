# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Last verified 2026-08-10** by a full-repo read (14 parallel readers + 2 adversarial auditors, every
> claim below checked against the actual file cited). The previous revision of this file was a ~2026-07
> snapshot and was wrong in roughly a third of its specifics — including documenting a *deleted* feature
> in detail. If something here disagrees with the code, **the code is true** — fix this file in the same PR.

## Working alongside other agents (stay in your task's scope)

Multiple agents/developers work this repo **concurrently**, so at any moment the working tree may hold other people's unfinished, possibly **non-compiling** changes in files that have nothing to do with your task. Therefore:

- **Stay strictly within your task's scope.** Only create/modify/delete files your task actually needs. Do **not** "fix", reformat, revert, or clean up unrelated files — even if they have obvious compile errors or look broken. They are almost certainly another agent's work-in-progress, and touching them clobbers that work.
- **Never touch another agent's uncommitted changes.** Don't `git restore`, `git checkout --`, delete, or stage/commit files you didn't change for your task. If a file you depend on is missing or broken and it's outside your scope, **stop and ask the user** instead of recreating, reverting, or finishing it yourself.
- **A failing full build is not automatically yours.** `npm run build` / `tsc -b` compiles the whole app, so it can fail on errors in files you never touched. Confirm *your* changes are clean by checking the errors are only in unrelated files, then surface the unrelated blocker to the user — don't chase it.
  - **Baseline as of 2026-08-13 — everything is green, so any red is yours or another agent's live WIP.** `npm test` in `backend/` is **44/44** (the long-standing `webPush.test.ts:216` failure was fixed by deriving the expected object from `PUSH_CATEGORIES` instead of hardcoding six keys — a new push category can no longer stale the test). `backend/` `tsc --noEmit` and frontend `tsc -b` are both **clean**. Two `routes/email.ts` `ExecutionContext` errors appeared when `@cloudflare/workers-types` gained a required `tracing` member and were fixed the same day: `softDeleteMessageIds` now takes a structural `{ waitUntil }` instead of the ambiguous global `ExecutionContext` (Hono's and workers-types' declarations of that name are incompatible). It is the only helper in the repo that receives the context as an argument — everywhere else calls `c.executionCtx.waitUntil(...)` inline, which is why nothing else broke.
- **Backend deploys are scoped to the worker.** `wrangler deploy` (esbuild, **no typecheck**) is unaffected by frontend/`tsc` errors — which is how type errors have historically shipped. Run `tsc --noEmit` yourself before deploying; the deploy will not do it for you.
- **Migration numbers collide.** If you are one of several parallel agents, you will have been given a reserved migration number block. Stay inside it. The repo already has six duplicated numbers (see below).

## What this project is

Internal construction-progress + HR tool for a Mongolian engineering firm (MGL). Two faces:

- **Operational app** (staff/admin/client): progress tracking, attendance, leaderboard, leaves, document archives (folders imported off the file server — **not** tied to projects), skills assessments, author supervision (ASR), meetings, mail, quotes, portfolio timeline, Revit quantity take-off (Тоо хэмжээ).
- **Public marketing surface** (`/` and `/work/:id`).

The UI defaults to Mongolian (`mn`); English is opt-in via the language switcher.

## Repo layout

- `backend/` — Cloudflare Worker (Hono, wrapped in an OAuth provider) + D1 + R2 + KV + Durable Object + Workers AI + Browser Rendering.
- `frontend/` — Vite + React 19 SPA, deployed to Cloudflare Pages.
- `backend/migrations/` — D1 SQL migrations, `NNNN_name.sql`. **Append-only; never edit an applied file.**
- `revit-mcp/` — the Revit 2027 C# add-in (`addin/`), a separate Python MCP bridge (`server/`), and PowerShell batch automation (`scripts/`).
- `revit-mcp/bbstudio/` — **«MGL ББ Студи»**, a SEPARATE Revit add-in (own assembly/AddInId/manifest/ribbon tab «MGL ББ», 2026-10-19): learns the company's
  structural working-drawing standard from a finished project (ЖИШЭЭ-1) and generates + annotates beam/column/wall (ЦХ)/slab (per level) drawings and A2
  sheets (series 4-/5-/6-/7-, schedules cloned per mark) from modelled rebar; issues go to `Documents\MGL ББ\<project>\Асуудал-шийдэл.xlsx`.  It LINKS the main add-in's `Reinforcement`/`AutoAnnotate` engine sources unchanged
  (all improvements wrap the engine's input/output) — never edit `addin/` for it.  Read `revit-mcp/bbstudio/README.md` first; tests `revit-mcp/tests/BbStudio.Tests`.
  **Since 2026-10-20 it lives in its own repo https://github.com/osohbayr1016/mgl-bb-studio (engine vendored) — develop there; this copy is stale.**
- `qto/` — QTO design notes + the resource catalog seed. Contains its own `qto/CLAUDE.md` whose "iron rules" (a frozen `type_signature v1`, "Drizzle ORM") describe a pipeline **that was never built** — zero occurrences in shipped code. Treat it as a historical proposal, not a spec.
- `docs/` — 45 files. `docs/dev/` is a 14-part Mongolian handbook (accurate as of 2026-07-22, now stale on roles/crons/migration count). `docs/tech-lead-roadmap.md` (2026-08-06) is the most accurate audit in the tree.
- `scripts/setup-zero-trust.mjs` — one-shot Cloudflare Zero Trust bootstrap. Not part of the runtime.
- `packages/mglai-common/` — runtime-agnostic pure-TS package (`@mgl/mglai-common`, `lib: ES2023`, `types: []`) shared by the Worker (`file:` dep, symlink), `ai/` (relative `.ts` import) and the browser. Added 2026-09-11 for GAP-027 (`redaction`): the ONE secret-masking algorithm; policy (which keys/levels) stays with the server/admin and `ai/deployment`. `backend/src/lib/mglai/redaction.ts` is a re-export only — never put an algorithm copy there or in `ai/deployment`.
- Repo root also holds ~66 MB of loose artefacts (a 57 MB tracked `.ifc`, sample PDFs/xlsx, a 719 KB `user_points` data dump). Only `resources_catalog.json` and `Хяналтын төсөв санал 20230621.xlsx` are read by build scripts.
- **`weasyprint/`, `stirling/`, `ifc-convert/` no longer exist** — deleted by commit `5f1538f` while their Workers stay bound and deployed. `wrangler.toml` comments still say `cd stirling && npx wrangler deploy`; that is unrunnable. Sources are only in git history.

## Common commands

Backend (from `backend/`):

```
npm run dev                 # wrangler dev on :3000 (local D1 + R2)
npm run deploy              # wrangler deploy
npm run db:migrate:all:local   # apply ALL migrations to the local D1  ← the generic one
npm test                    # node --test "src/**/*.test.ts"  (3 files; 54/54 pass)
```

`db:migrate:local` / `db:seed:local` are pinned to migrations 0001/0002 only. `db:migrate:0110:*` point at a dead migration and the `:remote` variant uses the `d1 execute --file` bypass that caused the original bookkeeping drift — **don't use it**.

Frontend (from `frontend/`):

```
npm run dev                 # vite dev (COOP/COEP mirror prod _headers)
npm run build               # tsc -b && vite build
npm run verify              # tsc -b --force && check-contrast && check-quote-notes && vite build   ← the real pre-deploy gate
npm run lint                # eslint .            (~139 pre-existing react-hooks errors)
npm run lint:tokens         # separate design-token eslint config (1358 known violations)
node scripts/nav-matrix.mjs # prints the role→sidebar matrix; the only guard on NAV_ITEMS
npm run check:notes         # 15 quote-footnote scenarios against the real 0185 template
ANALYZE=1 npm run build     # writes dist/stats.html
```

There are **no frontend unit tests** (no vitest); the one executable frontend check is `npm run check:notes` (`scripts/check-quote-notes.mjs`, in `verify`), which loads the real `.ts` sources through a `registerHooks` resolver. The backend has 14 test files under `src/lib/` (185 tests as of 2026-08-24 — the "exactly three" this file used to claim was long stale), all testing pure helpers — zero coverage of any route, role gate, or the progress rollups. A test that imports a source file with extensionless relative imports must `registerHooks` a `.ts` resolver first and then `await import(...)`, as `webPush.test.ts` and `leaveWindow.test.ts` do; a plain static import fails under `node --test` only (tsc stays green, so the breakage is invisible until you run the suite).

### Deploying

Deploys are **local wrangler, not CI**. Both `.github/workflows/deploy-*.yml` still fire on every push and **neither can succeed**: the backend one aborts on a `CONVERT_CALLBACK_SECRET` repo secret belonging to the deleted IFC converter, and the frontend one dies at the deploy step with wrangler's `Not logged in` — the `CLOUDFLARE_API_TOKEN` repo secret is unset (verified 2026-08-12 across every run in `gh run list --workflow=deploy-frontend.yml`; the frontend workflow has **never** produced a deployment). Nothing depends on them.

**Pages production is "newest production deployment wins."** `wrangler pages deploy … --branch main` creates a *new* Production deployment each time, and the site serves whichever is newest — so a rollback/retry from the Cloudflare dashboard, or a deploy from a stale checkout, silently reverts a correct deploy that ran minutes earlier. This happened on 2026-08-12. **Always verify after deploying**, don't trust the success message: compare the hashed asset name in local `dist/index.html` against `https://mgl-design-system.pages.dev/`, and check `wrangler pages deployment list --project-name mgl-design-system` — the top row must be your commit.

The production Pages project is **`mgl-design-system`** (`https://mgl-design-system.pages.dev`). `frontend/wrangler.toml` still carries the dead `name = "mgl-progress-frontend"`, so **always pass `--project-name mgl-design-system` explicitly**.

From `backend/`:

```
npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml   # migrations FIRST
npx wrangler deploy --config wrangler.toml                                            # then the worker
```

**Worker = plain `npx wrangler deploy --config wrangler.toml` (100% at once). Owner's instruction 2026-09-28: no
percent-by-percent / canary rollout — run the deploy command and it's done.** Office network drops 10–20% of TCP
connects some days — set `NODE_OPTIONS=--dns-result-order=ipv4first` and retry wrangler.
**"Push to production" means EVERYTHING in the working tree** — uncommitted changes included. Before deploying,
`d1 migrations list --remote` must show no pending migration after you apply, and afterwards the live
`index-*.js` hash must equal local `dist/index.html`.

From `frontend/`: `npm run build && npx -y wrangler@latest pages deploy dist --project-name mgl-design-system --branch main`.

**2026-10-01 `15cb1138`-аас хойш прод (worker `1cecc563`, Pages `9267d156`) = `main`.** Өмнө нь «held back» байсан Drive `4e752155` deploy хийгдсэн тул `deploy/live-2026-10-01-*` салбарууд ХУУЧИРСАН — тэднээс deploy хийвэл «Эх файлыг нээх»-ийн засвар буцна.

The explicit `--config wrangler.toml` is **mandatory**: a stray `wrangler.jsonc` at the repo root declares a different worker (`name: "mgl"`, no bindings) and wrangler's config discovery can pick it up.

### The 2026-08-24 database cutover

Until 2026-08-24 two production stacks ran side by side: the old
`mgl-progress-frontend.pages.dev` + `mgl-progress-api.anandoctane4.workers.dev`
on a personal Cloudflare account, and the company one. Staff kept using the old
site (attendance on the new one 403'd them — see `DEVICE_REBIND_BEFORE_MS` in
`routes/attendance.ts`), so the two D1s forked: 21 of 106 tables differed, and
some rows had the *same id but different content* on each side.

The company DB is now **`mgl-progress-db-v3`** (`03167f58-…`), a full import of
the old database. The previous `mgl-progress-db` (`d1911478-…`) is kept as the
pre-cutover backup — do not write to it, and do not delete it until the new one
has a few days of clean backups.

A cross-account D1 move is not a one-liner; `wrangler d1 export` → `execute
--file` fails five different ways on a dump this size (whole-file `internal
error`, `no such table` from FK-enforced import order, `FOREIGN KEY constraint
failed` from row order, the `email_messages` ⇄ `correspondence_log` cycle, and
`statement too long` on two 645 k-character `meeting_transcripts` rows). If you
ever repeat it, chunk the dump, create every table first, order tables by their
`REFERENCES`, NULL one side of the cycle and restore it at the end, stream
oversized rows in with guarded `col = col || '…'` appends, and make every
statement `INSERT OR IGNORE` so a dropped connection can be retried.

**⚠️ The pinned wrangler (4.83.0) silently ignores `CLOUDFLARE_ACCOUNT_ID` for `wrangler pages *`.** Measured 2026-08-21: `pages project list` and `pages project create` returned/wrote to the **same** account no matter which id was exported, while `pages deploy` honoured it correctly — so a `project create` "succeeded" on the wrong account and the matching `deploy` then died with `Project not found`. `npx wrangler@latest` resolves the account correctly (13 projects vs 0 across the two accounts). This only matters when the logged-in user has more than one Cloudflare account, which is now the case. **Run every `pages` subcommand through `npx -y wrangler@latest`, or verify with `pages project list` under the newer binary afterwards.** Worker/D1/R2/KV commands are unaffected.

### The one exception: table rebuilds (`DROP TABLE` on a parent)

Production D1 runs `PRAGMA foreign_keys = 1`, and `migrations apply` wraps each file in a transaction — where `PRAGMA foreign_keys = OFF` is silently a no-op and `defer_foreign_keys` does **not** stop `ON DELETE CASCADE`. So dropping a parent through `migrations apply` performs the implicit delete and **wipes every cascading child row**. Measured on a throwaway D1 (2026-08-04): `migrations apply` → children gone; `d1 execute --file` (not transactional, honours the pragma) → children intact.

**Path B**, required for any parent rebuild: `d1 export` (backup) → `d1 execute --remote --file` → `PRAGMA foreign_key_check` → **manual** `INSERT INTO d1_migrations (name) VALUES ('<file>')`. Order statements `CREATE → INSERT → DROP → RENAME` so a column mismatch aborts before anything is destroyed.

Two migrations in-repo are path B and carry their full runbook in the header: `0136_worker_role.sql` (rebuilt `users`) and `0142_assessment_multi_senior.sql` (rebuilt `assessment_responses`). `0107` was also applied that way ad hoc.

`users` really does have 19 `ON DELETE CASCADE` children plus ~14 `ON DELETE SET NULL` (an earlier revision of this file said "~40" — that was wrong, and its two headline examples were wrong too: `attendance_sessions.user_id` and `progress_entries.user_id` declare **no** referential action, so they RESTRICT rather than cascade). `projects` is the other untouchable parent — 33 cascading children. The conclusion stands: never rebuild either through `migrations apply`.

Note the local (miniflare) `--local --file` path is transactional **and** FK-enforcing, so it rolls a rebuild back entirely. Drive `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` with `node:sqlite` instead.

### The migration folder is not a schema

- **Four files are 1-byte blanks** (`0021`, `0022`, `0024`, `0025`) — lost in the original repo recovery. So `0023`/`0026` reference `pricing_rates`/`pricing_complexity_classes` that nothing creates, and a fresh `migrations apply` dies at 0023.
- **`project_threads` and `project_thread_messages` have no `CREATE TABLE` anywhere** — they exist only in production (they were in blank `0024`). `routes/projectChat.ts` and `routes/company.ts` read/write them. Recover the shape with `PRAGMA table_info`.
- **Six duplicated numbers**: 0002, 0060, 0080, 0110, 0120, 0121. `0080` is order-fragile (`0080_report_template_team_code.sql` ALTERs a table `0080_report_templates.sql` CREATEs, and `_` sorts before `s`).
- **Bootstrap a new environment from `wrangler d1 export`, never from the migration folder.**
- `0035_users_email_and_role_split.sql` is on disk but was **never applied**; it declares a role set (`system_admin`, `management`) that has never existed in production.
- Generated migrations (never hand-edit, regenerate via `backend/scripts/gen-*.mjs`): 0008, 0118, 0120, 0129, 0130, 0131/0134/0135/0137/0138/0145/0176/0180, 0140. **Regenerating an already-applied file is a silent no-op on production** — bump the output filename instead. The control-budget generator's `OUT` constant is that filename; 0180 is the newest.

## High-level architecture

### Backend — an OAuth provider wrapping Hono

`backend/src/index.ts`'s default export is **`@cloudflare/workers-oauth-provider`**, not Hono. The provider owns `/mcp`, `/sse`, `/token`, `/register` and `/.well-known/oauth-*`; the Hono `app` is its `defaultHandler` fallback. (There is no `handleMcp` function — a stale comment at `mcp/MglMcpAgent.ts:30` still references one.) Adding an MCP transport path means adding an `apiHandlers` key, **not** a Hono route — a Hono route there would be shadowed.

Hono mounts **58 `app.route()` calls over 51 distinct `/api` prefixes**. Every `/api/*` request goes CORS → timing → `authMiddleware` → `workerScopeGuard` → route module.

**The complete list of unauthenticated `/api` exemptions** (`middleware/auth.ts`, all exact `path ===` matches, not prefixes):

- `/api/auth/login`
- `/api/landing/public`
- `/api/landing/v2/public`, `/api/landing/v2/public/index`, `/api/landing/v2/public/project-cards`
- `/api/email/oauth/callback` (defends itself with a `purpose:'email_oauth'` JWT claim)
- `/api/mgl-ai/workbench-live` (System Workbench WebSocket; `routes/devWorkbench.ts` checks the `?t=` token, revocation, `admin` role, no `purpose`, and office access itself). `/api/client/ws` and the client-invite pair are also exempt.

There is **no** `/api/quotes/public` exemption — an earlier revision of this file invented one. Don't re-add it.

Plus a localhost-only dev bypass (`lib/devAuth.ts`): `DEV_AUTH_BYPASS=1` + a loopback hostname makes any unauthenticated *or expired-token* request act as `DEV_AUTH_USER` (default `admin`). Never put `DEV_AUTH_BYPASS` in `[vars]`.

**Non-`/api` root mounts that never see `authMiddleware`:** `/media` (world-readable by key — see Security), `/speechmatics` (shared-header webhook), `/meeting-audio` (`purpose:'stt-audio'` JWT bound to the key, supports Range), `/authorize` (the OAuth consent page).

### Roles

Exactly six: `admin | engineer | architect | senior | client | worker`. `ADMIN_ROLES = ['admin']`. `requireAdmin() = requireRole('admin')`; `requireManager() = requireRole('admin','senior')`. `LEADERBOARD_ELIGIBLE_ROLES = ['engineer','architect','senior']`.

**⚠️ `role` is read from the JWT, never from the DB — so changing a user's role in D1 has NO effect until that user logs in again.** `authMiddleware` sets `c.var.user` straight from the verified token payload (`{sub, role}`), and every `requireRole`/`requireAdmin`/`viewer.role === 'client'` check reads that. A session token lives 24 h, so an `UPDATE users SET role=…` leaves the person acting under their **old** role for up to a day, and the symptom is a confusing 403 on exactly the routes the new role should open. There is no revocation list; the only levers are "log out and back in" (mints a fresh token) or rotating `JWT_SECRET` (kills every session). The same staleness bites MCP harder — the tool ladder is evaluated once per DO session, and mcp-tokens last a year. **Any role change you make operationally must be handed to the user as "now log out and log in again."**

**`requireManager` is purely role-based** — there is no check that a senior belongs to the project or team being edited. Any senior can rewrite any project's blocks, weights, team shares and memberships, approve every leave/OT/OOO, and backfill or delete attendance. That is the current (accepted) blast radius; don't widen it further without asking.

**Багууд хэсэг: admin/senior бүх баг, бусад зөвхөн ӨӨРИЙН баг (2026-09-30, owner).** Дүрэм ГАНЦ газар — `backend/src/lib/teamAccess.ts` (`seesAllTeams` = admin|senior; өөрийн баг = `user_teams`, үндсэн БА нэмэлт хоёулаа). `GET /api/teams/:id`, `/:id/overview`, `/:id/member-tasks` → `requireOwnTeamOrManager()` (өөр багт 403 `TEAM_FORBIDDEN`, байхгүй id-д ч ижил); `GET /api/teams/allocation` (бүх багийн «хэн аль төсөл дээр» самбар) → `requireManager()`; `GET /api/teams/mine` = дуудагчийн багууд (`/:id`-ээс ДЭЭР). ⚠️ `GET /api/teams` (жагсаалт) ХЭВЭЭР бүх ролид нээлттэй — 7 dropdown татдаг, гэхдээ багийн нэгтгэл тоо, өнөөдрийн `active_projects`-ийг ч буцаадаг (нээлттэй үлдсэн суваг). Frontend: `/app/teams` нь admin/senior-д самбар, бусдад `MyTeamRedirect` (үндсэн багийн хуудас руу; sidebar нэр «Баг»); `/app/teams/:id` нь `TeamDetailRoute` wrapper-аар хаагдана (өөр багийн URL → `/app/teams`). `user.teams` (`/auth/me`)-г ЭНД хэрэглэхгүй — `/auth/login` нь `teams`-гүй буцаадаг тул нэвтэрсэн даруйд хоосон; UI `/teams/mine` уншина. Тест: `lib/teamAccess.test.ts`.

**`worker` (цэвэрлэгч)** — added 2026-08 via migration 0136, the one non-knowledge-worker role. Enforced in layers that must stay in sync:

- **API allowlist** — `lib/workerScope.ts` 403s every `/api` prefix except `auth`, `attendance`, `attendance-confirmations`, `leaves`, `notifications`, `push`, `upload`. It is an allowlist on purpose: a new route module is closed to `worker` by default.
- **Attendance rules inverted** (`routes/attendance.ts`, `isWorkerUser`): exempt from project selection, the phone-UA block, device binding, the log-progress-before-clock-out gate, and late minutes/penalty. In exchange the office-IP allowlist is **always** enforced for her, even when `require_office_ip` is off.
- **Frontend sandbox** — `shared/lib/roles.ts` + `ProtectedRoute` + `Layout` NAV_ITEMS + `MobileBottomNav.WORKER_SLOTS` + `features/attendance/AttendanceRoute.tsx`. Five files.
- **⚠️ There is an unguarded fourth ingress: MCP.** `workerScopeGuard` is mounted on `/api/*` only; `/mcp` is a root path owned by the OAuth provider. `grep worker backend/src/mcp/` returns nothing. A worker can mint a 365-day token via `POST /api/auth/mcp-token` (which is in her allowlist and has **no role gate**) and receive every Tier-1 and Tier-2 tool, including `get_company_overview` — whose REST twin 403s her. Known gap, not yet fixed.

She appears in attendance reports (rosters filter `role != 'client'`) and is absent from leaderboard queries.

**The `TV` account is a plain staff row (now `admin` — see below), and `users.tv_kiosk` is a dead column.** The lobby wallboard (`/app/tv`) needs someone to be logged in on the screen. On 2026-08-24 that shipped as a locked-down kiosk persona — `role='client'` plus a `tv_kiosk` flag, with a `lib/tvScope.ts` allowlist that 403'd every `/api` path except the three the wallboard reads (commit `f5c7224`, migration 0191). **It was reverted the same day** (migration 0192) because the owner wanted the screen to browse the app like any employee, not through a hole punched for three endpoints. The account became `role='engineer'`, `is_support=1`, `tv_kiosk=0`, and every line of guard code is gone — `git show f5c7224` is the restore point if a locked kiosk is ever wanted again. **Measured 2026-10-06 (read-only prod D1): the row is id 80, `role='admin'`, `is_support=1`** — someone promoted it later, and the wallboard's admin-only last scene («Системийн урсгал», System Workbench section) depends on that.

Two things survive that are worth knowing. **`users.tv_kiosk` still exists on production** and is 0 everywhere; dropping a column means rebuilding `users` (19 cascading children — the path-B runbook), so it stays as a leftover like `accent_color` and `model_xkt_url`. And the account, being a normal staff row, **does** land in the `role != 'client'` rosters: nobody clocks in as `TV`, so it adds 1 to the attendance denominator the wallboard itself displays (as `admin` it is no longer in `PARTICIPANT_ROLES`, so it stays out of new assessment rounds). `is_support=1` only keeps it off the leaderboard. Deactivating the row (`status='inactive'`) is the lever if that ever matters, at the cost of the login.

**CEO hardcode (`CEO_USER_ID = 2`).** There is no `ceo` DB role. One hardcoded id is "top of admin": keeps `admin` but gains three staff-like behaviours via `lib/ceo.ts` + `frontend/src/shared/lib/ceo.ts`. (1) **Attendance exemption** — `excludeCeoSql()` at exactly five sites: `attendance.ts:1762/2274/2343`, `attendanceConfirmations.ts:188`, `leaves.ts:664`, plus `ticker.ts:92`. It is **missing** from `routes/company.ts` (so the dashboard attendance % is permanently short by one) and from `mcp/tools/attendance.ts` + `workforce.ts` (so MCP reports him absent every day). Any new roster query must opt in explicitly. (2) **Self-claims tasks** despite `admin`. (3) **Earns points / appears on the leaderboard**, subject to the `app_settings.ceo_on_leaderboard` admin toggle.

*(Note: an earlier revision claimed the CEO hardcode exists because the `users` CHECK "can't be extended". Migration 0136 did exactly that. It is a cost/risk argument now, not an impossibility.)*

### Ирцийн төхөөрөмж — нэг ажилтан · нэг ФИЗИК компьютер · олон браузер (migration 0328, 2026-09-21)

`users.attendance_device_id` (ганц localStorage UUID) нь браузер-профайл × origin тус бүрд тусдаа тул
Chrome → Edge солих, PWA-г өөр браузераар суулгах, «браузерын өгөгдөл цэвэрлэх», Windows дахин суулгах
бүр ажилтныг «Энэ төхөөрөмж бүртгэлгүй» 403-д унагаж админ reset шаарддаг байв.  Хөтөч ямар ч тогтмол
техник хангамжийн id өгдөггүй (MAC/серийн дугаар/машины нэр вэб контентод хүрдэггүй) тул «ижил компьютер»
гэдгийг браузерээс үл хамаарах шинжүүдээр ТААМАГЛАДАГ болов — `lib/attendanceDevice.ts` (ГАНЦ файл, 26 тест):

- **`attendance_devices`** — ажилтан бүрд браузер тус бүрд нэг мөр (`browser_id` = хуучин `mgl_device_id`) +
  **`hw_hash`** = SHA-256(`hw1|gpu|cores|screen|platform|tz`): GPU загвар (WebGL `UNMASKED_RENDERER_WEBGL`,
  `normalizeGpu` нь Chrome/Edge/Firefox/хуучин ANGLE-ийн бичлэгийг нэг болгоно), `hardwareConcurrency`,
  `screen.width×height` (OS scaling дагана, zoom-д хамаарахгүй), `navigator.platform`, цагийн бүс.
  `deviceMemory` зөвхөн `hw_json`-д — хэшэнд ОРОХГҮЙ.  Хэш **сервер** дээр — клиент (`shared/lib/device.ts`
  `getHardwareProfile()`) зөвхөн түүхий шинжүүдээ `POST /attendance/clock-in` body `device`-д илгээнэ
  (хүсэлт бүрд биш; `X-Device-Id` толгой хэвээр).  Хэмжсэн 2026-09-21: энэ PC-ийн Chrome 153 ба Edge 153
  ЯГ ижил GPU/cores/platform/tz өгсөн.
- **Шийдвэр** (`decideDevice`, цэвэр): яг таарсан `browser_id` → `known` (last_seen + профайлыг СУРНА —
  монитор солигдсон ч дараагийн браузер солилт таарна) · идэвхтэй мөргүй → `bind_first` (users толь бичнэ) ·
  шинэ browser_id, идэвхтэй мөрийн `hw_hash`-тай ижил → `bind_hw_match` (шинэ мөр, users толь хэвээр) ·
  бүх идэвхтэй мөр домэйн шилжилтээс өмнөх → `rebind_legacy` (хуучин `DEVICE_REBIND_BEFORE_MS` цонх хэвээр) ·
  бусад → 403 `code: 'DEVICE_NOT_REGISTERED'`.  VM/RDP-ийн ерөнхий renderer (SwiftShader, Microsoft Basic
  Render) GPU гэж тооцогдохгүй → hash үүсэхгүй → зөвхөн яг таарсан browser_id (өмнөх зан төлөв).
- **`users.attendance_device_*` ХЭВЭЭР** = анхны/үндсэн холболтын толь (админы «холбогдсон» шошго, `GET /users`
  одоо `attendance_device_count` ч буцаана); `POST /users/:id/reset-device` users толь + БҮХ мөрийг `revoked_at`-аар
  хаана (устгахгүй; `INSERT … ON CONFLICT` дахин ирсэн id-г сэргээнэ); `GET /users/:id/devices` reset dialog-ийн
  жагсаалт (`browserLabel`: «Edge 149 · Windows», `bound_via`).  `DELETE /users/:id` мөрийг гараар устгана
  (users-ийн 20 дахь cascade хүүхэд).  Миграц одоо байгаа холболтыг `bound_via='legacy'`, `hw_hash NULL` мөр
  болгосон — тэр хүний ӨӨРИЙН браузерын дараагийн clock-in профайлыг сурсны ДАРАА л шинэ браузер нь таарна.
- **⚠️ Хязгаар — эзэнд хэлсэн:** ЯГ ижил загварын компьютер + ижил монитор хоёр ажилтанд байвал профайл давхцаж,
  нууц үгээ мэдэх хамт ажиллагч өөрийн (ижил) PC-ээс нөгөөгийн ирцийг бүртгэж чадна (хуучин ганц-UUID дүрэм
  үүнийг UUID хуулахаас бусад тохиолдолд хаадаг байв).  Оффисын NAT IP бүх PC-д ижил тул IP ялгуур биш.
  Тиймээс `app_settings.attendance_device_hw_match` (өгөгдмөл асаалттай; `PUT /settings/attendance
  {device_hw_match}`, Ирц админ → OfficeIpsCard-ын хоёр дахь toggle) унтраавал зөвхөн яг таарсан browser_id
  зөвшөөрөгдөнө.  Худал эерэг тохиолдол: монитор + браузерыг НЭГЭН ЗЭРЭГ солих → 403 → админ reset (өмнөхтэй ижил).
- Шалгалт: `node --test src/lib/attendanceDevice.test.ts` (миграцын SQL-ийг `node:sqlite` дээр бодитоор
  ажиллуулна); E2E 26 шалгалт scratch wrangler + prod-copy D1 дээр (Chrome → Edge auto-join, өөр PC 403, toggle
  OFF, reset, legacy learn, grace).  ⚠️ `employee_id='ERD'` (`ATTENDANCE_UNRESTRICTED_EMPLOYEE_IDS`) хэрэглэгч
  төхөөрөмжийн шалгалтаас чөлөөтэй тул тестийн хэрэглэгч болгож БОЛОХГҮЙ.

### Сарын ирцийн батлалт + сарын эхний сануулга (2026-10-01, миграцгүй)

Ажилтан сар бүр өөрийн ирцийг «Ирц → Миний сарын ирц» картаас (`MyDailyAttendanceCard`, `id="sec-attendance-monthly"`)
«Батлах» / «Зөрчилтэй» (шалтгаантай) гэж батална — `routes/attendanceConfirmations.ts` (`attendance_confirmations`, 0115-ийн
хүснэгт, нэг мөр = ажилтан × `YYYY-MM-01`; зөвхөн ДУУССАН сар, `OPEN_UNFINISHED_MONTHS` гараар нээсэн онцгой сар).  Эзний
хүсэлтээр **шинэ сарын 1-нээс өмнөх сарын ирцээ хариулаагүй хүнд цонх гарна** (`features/attendance/components/MonthConfirmPrompt.tsx`,
`LayoutShell`-д ГАНЦ удаа): «Ирцээ шалгах» → `/app/attendance?section=sec-attendance-monthly&month=YYYY-MM` (`monthlySectionHref`; карт
өгөгдмөлөөр ОДООГИЙН сарыг харуулна (2026-10-19, эзэн), сонголт `?month=`-д), зөрчилтэй бол Менежментийн багтай
уулзаж засуулахыг сануулна.  Хэнд гарах = СЕРВЕР: `GET /api/attendance-confirmations/due` → `{due:{month}}|{due:null}`
(ирцийн roster − `worker` (түүний хуудсанд карт байхгүй) − тэр сард ажилд ороогүй хүн; `confirmed|disputed` мөр гармагц null;
хуучин `requested` мөр хариулт биш).  Хэзээ: ирсэн бүртгэл бүрийн дараа (`announceClockIn()` — `AttendancePage` ба
`AttendanceWidget`-ийн `submitCheckpoint`, `features/attendance/monthConfirm.ts`) + шинэ таб/өдөр бүрд нэг удаа; «Дараа» нь
зөвхөн тэр табын тэр өдрийнхийг хаана (sessionStorage).  Карт батлахад `MONTH_CONFIRM_DUE_KEY`-г invalidate хийнэ.  Тест:
`routes/attendanceConfirmations.test.ts` (4).  **DEPLOYED 2026-10-01** (commit `6d01b712` = 966f78d5 + энэ ажил — `4e752155`
(Drive) ОРООГҮЙ): worker `7a07f72d`, Pages `8c00167b` (`index-Cs_jhQft.js`); тэр өдөр 53 хүний 52-т гарсан.

**«Гарсан бүртгэл» ХЭЗЭЭ Ч чимээгүй бүтэлгүйтэхгүй (эзэн 2026-10-19, миграцгүй, DEPLOYED — `5ca8132a`, worker `d3269d5a`, Pages `c22aae01` `index-Cutch3Ok.js`).**  Эх гэмтэл (прод 2026-10-16, Баярцэцэг id 84): «Гарах» товч кэшийн хуучирсан `progress_logged_today`-оор ИДЭВХГҮЙ болж (явц хадгалах `/progress`, `/progress/bulk`, хуваарилалтын −/+ нь `my-status`-ийг invalidate хийдэггүй байв), дарахад хүсэлт ч явахгүй, маргааш нь ирэх бүртгэл түгжигдсэн.  Эзний дүрэм: амжилттай гарсан хүн маргааш нь «хийгээгүй» гэж ХЭЗЭЭ Ч харахгүй; хийгдээгүй бол шалтгаан нь ТЭР агшинд монголоор харагдана.  Дүрэм ГАНЦ газар `features/attendance/clockOutFlow.ts` (цэвэр; `npm run check:clock-out`, `verify`-д) + `useClockOutFlow.ts` + `ClockOutBlockedDialog.tsx` (Ирц хуудас, самбарын widget, цэвэрлэгчийн хуудас): ⚠️ гарах товчийг явц/PGP/сүлжээ/төслийн нөхцөлөөр `disabled` БОЛГОХГҮЙ — дарахад төлвийг серверээс шинээр уншаад «Гарах бүртгэл хийгдээгүй байна» цонхонд БҮХ шалтгааныг шийдэх товчтой нь харуулна; сүлжээ/5xx/`NO_OPEN_SESSION` дээр төлвийг дахин уншиж, сервер дээр гарсан бол (хариу алдагдсан, өөр таб) АМЖИЛТ гэж харуулна; гарсны дараа «✓ Гарсан HH:MM» (хуучин «Бүртгэгдээгүй» БИШ), дахин «Ирсэн» дарахад баталгаажуулна.  Явц бичдэг ШИНЭ зам нэмбэл `invalidateAttendanceStatus()` (`attendanceStatus.ts`) дууд.  Backend `POST /clock-out`-ийн татгалзал бүр `code`-тэй (`OFFICE_NETWORK`, `NO_OPEN_SESSION`, `PROJECT_REQUIRED`, `PROGRESS_REQUIRED`, `ALREADY_CLOCKED_OUT`, `PROJECT_NOT_FOUND`…) — шинэ татгалзал нэмбэл код + монгол `error` заавал.  Үлдсэн хязгаар: товч огт дарахгүйгээр компьютер унтраасан хүн маргааш түгжигдсэн хэвээр (сануулга push хийгдээгүй).

**Хариулсны ДАРАА өөрчлөгдвөл дахин батлах (migration 0403, 2026-10-15, DEPLOYED — `4ff76525`).**  Түгжээ БИШ (админ засварласаар — засвар
бол зөрчлийг шийдэх зам; цалингийн модуль байхгүй).  Хариулах агшинд тэр сарын ирцийн түүхий мөрийн SHA-256 хээ
`attendance_confirmations.data_fingerprint`-д (`lib/attendanceMonthFingerprint.ts` — `buildDailyAttendanceRows`-ийн уншдаг ЯГ тэр
хүснэгтүүд: sessions, approved leaves, `leave_arrival_cuts`, approved OOO, holidays; тэнд шинэ эх сурвалж нэмбэл ЭНД ч).  Хээ зөрвөл
`changed_since_answer` (`/mine`, `/overview`, `approve-month`) ба `/due` → `{month, reason: 'changed'}` (зөрчилтэй хариулт ч — админ
засаад шийдсэн бол ажилтан дахин батална).  NULL хээ (0403-аас өмнөх) хэзээ ч «өөрчлөгдсөн» биш.  Тест `attendanceConfirmations.test.ts` (5).

**2026-10-15 P2 хатуужуулалт (DEPLOYED — `4ff76525`):** админы `/sessions/:id/clock-out` + `bulk-clock-out` CAS (`clock_out IS ? AND
edited_by IS ?` → 409 `SESSION_CHANGED` / skipped); өдрийн тайлан `PUT` CAS (`edit_count`, түүхийн мөр DB-ийн ОДООГИЙН хувилбараас;
`base_edit_count` → 409 `STALE_LOG`); `POST /api/tasks` `lib/taskInput.ts` шалгалт + бүрэлдэхүүн байх ёстой; жин засварын дараах онооны
тулгалт унавал `task_credit_reconcile_queue` (0402, `lib/taskCreditReconcileQueue.ts`, cron fail-safe салаа, 8 оролдлогод аудит
`CREDIT_RECONCILE_FAILED`); «Миний ажлууд» бөөн илгээлтийн алдаа мөр бүр дээр.  Deploy дараалал: D1 0402 + 0403 → worker → Pages.

**2026-10-15 P1 — ирц АТОМИК (миграцгүй).  DEPLOYED 2026-10-15 — commit `4ff76525` (0401–0403 + P1/P2 + 410-хэмжилт хамт): D1 0401–0403 (өмнөх live worker `33d84be8`/`f8f2f9c0`), worker `77f178af`, Pages `65c15d76` (`index-CG73bIrU.js`).** `writeClockIn` / `writeClockOut` (`routes/attendance.ts`) — session + `daily_active_*` +
checkpoint (upsert, `UNIQUE(user_id,date,checkpoint_type)`) + checkpoint-ийн төсөл/засвар НЭГ `db.batch`.  Бүх мөр ижил нөхцөлөөр
(`WriteGuard`: clock-in «нээлттэй session байхгүй», clock-out «энэ session нээлттэй хэвээр») хамгаалагдаж session бичилтээс ӨМНӨ
байрлана — давхар хүсэлт юу ч бичихгүй (409), дундаас унавал бүгд буцна.  Шинэ цэгийн `session_id` NULL-аар орж INSERT-ийн дараах
UPDATE холбоно.  14:00 checkpoint ч нэг batch.  Төслийн бус сонголт (`applyNonProjectPicks`, давтахад аюулгүй) batch-д БАГТАХГҮЙ —
нэг дахин оролдоод унавал хариунд `non_project_saved:false` + мессеж.  Тест `routes/attendanceAtomic.test.ts` (6, бодит 0044/0047/0324).

**Өдөрт ОЛОН чөлөө + «7ц 58м» харагдац (2026-10-01, миграцгүй).**  Сарын батлалтын эхний «Зөрчилтэй» хоёр хариунаас:
(1) `buildDailyAttendanceRows` өдөрт ЗӨВХӨН эхний батлагдсан чөлөөг (`find`) авдаг байв — 08:30–12:00 + 12:00–17:30 хоёр
чөлөөтэй өдрийн хоёр дахь нь хүснэгтэд огт ордоггүй, цалингүй бол ажилтан ажиллаагүй цагийн кредит авдаг байв.  Одоо дүрэм ГАНЦ
газар `lib/dayLeaves.ts` (9 тест, продын бодит мөрүүд): чөлөө бүрийн минут хуучин томьёогоор (ирсэн цагаар богиносголт → `hours /
хуанлийн өдөр`), цонх = цагтай нэг өдрийнх `start_time`-аас, бусад нь ээлжийн эхлэлээс; цонхнуудын НЭГДЭЛ (давхцсан минут нэг удаа —
прод дээр ээлжийн амралт + 08:00–11:00 цалингүй нэг өглөөг давхар хамарсан тохиолдол бий); өдрийн нийт ≤ 8ц, илүүг цалингүй →
ээлжийн амралт → цалинтай дарааллаар хасна; мөр `leave_parts` буцаана, `leave_type`/`leave_reason` = хамгийн их минуттай хэсэг;
`/summary` чөлөөг төрлөөр задлана.  Ганц чөлөөтэй өдөр байт-ижил (прод 9-р сар 1193 мөрөөс 3 л өөрчлөгдсөн; #41 9-01-д 4ц бага кредит —
батлагдсан цалингүй 14:00–18:00 өмнө нь тоологдоогүй байв).  UI `features/attendance/components/DayLeaveChips.tsx` (ажилтны карт +
админ grid), XLSX timesheet бүх хэсгийг бичнэ.  (2) «Минут 60 биш 100-аас хасагдсан» нь тооцооны алдаа БИШ — ажилтан аравтын «7.97»-г
«7 цаг 97 мин» гэж уншсан (систем 478 мин = 7ц 58м).  «Миний сарын ирц» цагийг одоо `myAttendance.durHoursMinutes` «7ц 58м» +
«= 7.97 цаг» туслах мөр + тайлбараар; админ grid / XLSX аравтын хэвээр (цалин).  Хоёр бичиглэл хоёулаа андуурагдсан түүхтэй
(«106:40» → 106.40) тул нэгжгүй хэлбэрт бүү буцаа.  **DEPLOYED 2026-10-01** (`fa8d5e95` = `6d01b712` + `0014704c`, Drive `4e752155`
ОРООГҮЙ хэвээр): worker `23aa6fa7`, Pages `b5f18d1b` (`index-D3uvWmdT.js`).

**Бя/Ням цагт тоологдохгүй + «ажлын өдөр / ирсэн» тоолол (2026-10-01, миграцгүй, DEPLOYED — worker `ebd9cdfe`, Pages `f697c30f`, deploy commit `f0cb8f6b` = fa8d5e95 + 8287d391 + 33598da1 + `b82742e6` + `95cfdce0`; Drive `4e752155` held back).**  Эзний хоёр шийдвэр.  (1) **Бямба/Ням өдөр ямар ч байдлаар — оффис дээр ч, гадуур ажил / зохиогчийн хяналтаар ч — ажилласан цагт ТООЦОГДОХГҮЙ**, тэр өдөр юу ч хийгээгүй мэт бодно: `buildDailyAttendanceRows` (`routes/attendance.ts`) Бя/Нямд мөр ҮҮСГЭХГҮЙ (2026-07-30-ны «нөхөж ажилласан» `weekendActivityByUser` хасагдсан — буцаах бол `git log -S weekendActivityByUser`).  Ирцийн бичлэг, гадуур ажлын хүсэлт өөрөө DB-д хэвээр; зөвхөн цагийн хүснэгт / Хураангуй / XLSX / «Миний сарын ирц»-д харагдахгүй, тоологдохгүй.  Нийтийн БАЯРЫН өдөр ӨӨРЧЛӨГДӨӨГҮЙ: мөр байна, ажилласан бол бодит цагаараа тоологдоно.  Эх гэмтэл: Батзориг А. (BB, 2026-09) 22 ажлын өдөр бүгдэд ирсэн, 9/26 + 9/27 зохиогчийн хяналтаар гадуур ажил 2.00 ц → 2 нэмэлт мөр → «24 өдөр · 22 ирсэн» (ажлын 2 өдөр тасалсан мэт), нийт цаг +4 ц.  Прод дээр хэмжсэн (2026-10-01): 9-р сард Бя/Нямд ирцийн бүртгэл 0, батлагдсан гадуур ажил 5 мөр / 2 хүн; 7-р сарын 37 бүртгэл Наадмын үеийнх.  (2) **Өдрийн тоо мөр тоолохгүй**: ГАНЦ дүрэм backend `lib/attendanceDayCount.ts` (`countAttendanceDays`) ↔ frontend `features/attendance/admin/utils/totals.ts` (`isExpectedWorkDay` = амралт ч баяр ч БИШ, `hasWorkActivity`, `GroupTotals.extraDays` — одоо зөвхөн баярт ажилласан өдөр).  Хэрэглэгчид: админ grid «Дүн (N өдөр · M ирсэн · баярын өдөр K ажилласан)», XLSX дэд дүн, «Миний сарын ирц» карт, `/attendance/summary` (`present_days` = ажиллах ёстой өдөр дээрх ирц, шинэ `extra_days`; Хураангуйд «+N», XLSX «Баярын өдөр ажилласан» багана).  Баярын өдөр админ grid-д өмнө нь «ажлын өдөр» гэж тоологддог байсан — одоо Хураангуй, Миний картай ижил.  Тест: `lib/attendanceDayCount.test.ts` (6), `routes/attendanceWeekend.test.ts` (4, бодит SQLite, `buildDailyAttendanceRows` экспортлогдсон; засваргүй кодод 4/4 унана), `npm run check:attendance-totals` (8, `verify`-д).  ⚠️ `reports.ts` (Тайлан → Ажилтан `present_days`: `COUNT(DISTINCT a.date)`), `teamProductivityStore.ts`, MCP `workforce`/`personActivity` өөрийн тооллоготой — Бя/Нямын сессийг ирсэн өдөр гэж тоолдог эсэхийг ХАРААХАН шалгаагүй.  ⚠️ Deploy-ийн сургамж (2026-10-01, `mgl-e-c-ed`-тэй «ping-pong»): worker бүхлээрээ солигддог тул deploy-ийн өмнө `wrangler deployments list`-ийг ТУСАД НЬ уншиж шинэ deploy байхгүйг батал — deploy-той НЭГ командад бүү хий; суурь нь `33598da1`-ийг (таск авах, D1 0368/0369 хэрэгжсэн) заавал агуулна, зөвхөн Drive `4e752155` л held back.

**Ажилласан цаг = ЭЭЛЖИЙН ЦОНХ доторх хугацаа (2026-10-01-ээс, миграцгүй, DEPLOYED — commit `0c7a2e3d`, worker `0f419af6`, Pages `0734c624` `index-BIX0KQou.js`).**  Эзэн: 08:00 ээлжтэй хүн 07:40-д ирээд
16:40-д гарахад 8ц тоологддог нь буруу — ажлын цаг албан эхлэлээс албан тарах цаг хүртэл тоологдоно: 07:40–16:40 → 7ц40м, 07:20–16:57
→ 7ц57м.  Дүрэм ГАНЦ газар **`lib/shiftBoundedHours.ts`** (`shiftBoundedMinutes` = session-уудын НЭГДЭЛ ∩ ээлж − цай, бүтэн минут,
секунд тасална; `countingWindow`).  Ээлж = тухайн өдрийн бодит ээлж (`shiftForUser`: 08:00/08:30/09:00, зун 08:00).  **`worker`
роль ЦОНХГҮЙ** (цаг нь уян хатан — бодит цаг − цай, дээд тал 8ц; user 69 бодитоор ~10:30–20:00 ажилладаг).  Хэрэглэгчид: `computeHours`
(`hours_worked` — гарах, админы 4 зам; `loadCountingWindow`), `syncNonProjectCredit` (гадуурх төслийн бус ажил мөн цонхоор),
`buildDailyAttendanceRows` — кредит = `min(цонх доторх минут, 8ц − хоцролт)` (чөлөөтэй өдөр `8ц − чөлөө − хоцролт`); хоцролт ирсэн цагаас
аль хэдийн хасагдсан тул `min`, давхар хасалт үгүй.  **Цагийн хүснэгт 10-01-ээс хойших өдөрт хадгалсан `hours_worked`-ийг УНШИХГҮЙ** —
хаагдсан session-уудын интервалаас дахин боддог (deploy-оос өмнө хаагдсан, давхар ихэр session).  **2026-08-03-ны «гарсан өдөр = 8ц −
хоцролт, гарсан цагаас үл хамаарна» бодлого ЗӨВХӨН 9-р сар ба түүнээс өмнөх өдөрт** (`SHIFT_BOUNDED_FROM`, эзний сонголт — 9-р сарын
ирцийг ажилтнууд баталж байгаа).  9-р сарын прод өгөгдлөөр загварчилсан (чөлөө/гадуур ажилтай өдөр хасаад): 999 хаагдсан ажлын өдрийн
54 (5.4%) нь багасах, нийт 61.6ц / 23 хүн; 09-29-нд 4 хүн 09:15-д гарсан (хуучнаар 8ц) — ийм өдөр одоо гадуур ажлын хүсэлт шаардана.
Хэвээр: «Ирсэн цаг»-ийн ногоон таймер (`AttendancePage`/`AttendanceWidget`) ирснээс хойших хугацааг харуулсаар.  Тест:
`lib/shiftBoundedHours.test.ts` (12), `routes/attendanceShiftBounded.test.ts` (8, бодит SQLite), `lib/nonProjectCredit.test.ts` (+1).

### System Workbench — live traffic (`/app/admin/system-workbench`, 2026-10-06, no migration, DEPLOYED — main `e2c95769`, worker `02320cc9`, Pages `a60998de`)

The admin-only page shows the whole architecture as a graph, and **every real request** (any user, any page), cron job and MCP call moves along it as a particle. The ring on D1 shows rows read. The «Code» tab is the old GitHub editor/CI/PR, unchanged.

- **Cost model (`backend/src/lib/liveTraffic.ts`, 5 tests): nothing is written to D1/KV/R2, and there is no DO call per request.** Events are kept in isolate memory. With no viewer, an isolate sends one probe to the DO at most every 10 s, and only while it has traffic. With a viewer (the DO answers `watchers > 0`), it sends one batch per second for 20 s and then re-arms. The isolate that accepts the WebSocket arms itself immediately. Hooks: the `/api/*` timing middleware, a `/media/*` middleware, `guardMcp`, and the cron `job()` wrapper in `index.ts`. Nothing is recorded in multi-tenant mode.
- **Privacy:** query strings are never sent, and numeric, UUID, Drive and key segments become `:id` / `:key` (`normalizeLivePath`). Events carry the user id and role, so only admins see them.
- `live/WorkbenchLive.ts` is transport only (in-memory ring of 200, storage writes 0, hibernation, and `'ping'` is answered by an auto-response that does not wake the DO). The frontend closes the socket 20 s after the tab is hidden.
- Frontend: `features/system-workbench/{live,components}/`. `live/routeMap.ts` is the ONE event → node-path rule; an unknown `/api` prefix becomes a dynamic `route:` node. The particle engine writes SVG attributes from a single rAF loop, without React renders, and the loop stops when nothing is moving. `POST /api/mgl-ai/workbench/probe` (admin) runs two tiny COUNTs for the «Ping D1» button.
- Deploy order: worker first (adds DO tag **v7**), then Pages. A Pages build with an old worker shows «NO SIGNAL» and the static graph.
- **Direction + source (2026-10-07, owner).** Particles follow the HTTP method, not the rows written: **GET/HEAD = `pull`** — the particle starts at D1 (or the domain / cache when D1 was not hit) and flows back to the requester, with a ripple on D1 at departure and a small one where it lands; **POST/PUT/PATCH/DELETE = `push`** — requester → D1; 401/403 stay `push` (stopped at the gate). Colour follows the same rule (cyan = GET, amber = POST…), so a POST that writes 0 rows is still amber. ONE place: `live/routeMap.ts` `flowDirection` / `toneOf` / `flowPath` (`eventRoute` stays the request path — counts, node filter and inspector read it). **Revit add-in requests start at «MGL Revit Add-in»**: the worker classifies each event with `liveSource()` (`lib/liveTraffic.ts`, tested) — `User-Agent` starting `MglRevitAddin` (every add-in HTTP client sends it; Cloudflare 1010-blocks UA-less requests) or token purpose `revit`/`revit-refresh` → `src: 'revit'`; the UA string itself is never sent. An older worker without `src` falls back to the `/api/revit*` path rule. The TV scene shows the graph full width with the legend in its own row — **no request counts and no recent-request list there** (owner); the page keeps both. **DEPLOYED 2026-10-07** (`59c80cb0`: worker `7acdbebc`, Pages `b4fe8f6a` `index-Dg8l5g2e.js`).
- **Sidebar + company TV (2026-10-06, frontend only).** The page has an admin-only sidebar row «Системийн самбар» (`Layout.tsx` NAV_ITEMS, group `utility`, module `mglai`; `pageTitle.systemWorkbench`; the backend `systemCatalog.generated.ts` was regenerated). It is also the **LAST scene of `/app/tv`, shown for 30 s** (`CompanyTvPage` `SYSTEM_SCENE_MS`; scenes now carry an optional `ms`, and the ticker follows it) and **only when the viewer's role is `admin`** — the WS endpoint is admin-gated, so for anyone else the scene would only say «NO SIGNAL». The scene (`features/dashboard/tv/SystemScene.tsx`, a lazy chunk) reuses the same graph + particle engine through `live/useGraphModel.ts` (shared with the page), opens its WebSocket only while mounted (~30 s of every rotation), replays the last 10 `hello` events (`useLiveTraffic(…, {replayRecent})`) so it does not start empty, and **never shows user id/role** — the lobby screen is visible to visitors. It renders even when `/company/overview` fails. **DEPLOYED 2026-10-06** (`68098ec0`, Pages `7d4e2db0` `index-Dv1oCCgT.js`; worker unchanged `02320cc9` — the regenerated system catalog reaches MGL AI on the next worker deploy).

### Cron

`wrangler.toml`: `crons = ["*/2 * * * *", "* * * * *"]`. `index.ts`'s `scheduled` branches on `event.cron`:

- exactly `'* * * * *'` → `sweepPushNotifications` only, then returns.
- **every other cron string** → `syncAllMailboxes` + `reconcileMeetings` + `syncGoogleCalendar` + `runDeadlineSweep`. This is a deliberate fail-safe, which means **adding a third cron expression silently double-runs that quartet.** Don't add crons; have the job check its own clock (see `lib/deadlineSweep.ts`, which self-gates on UB hour ≥ 9 plus a day-claim in `app_settings`).

### Bindings

`DB` (D1) · `MEDIA_BUCKET` (public R2) · `MEETING_BUCKET` (private R2) · `OAUTH_KV` (**name is load-bearing** — the oauth-provider library resolves it by that exact string) · `MCP_OBJECT` (SQLite DO → `MglMcpAgent`) · `CLIENT_ROOM` (DO, tag v6) · `WORKBENCH_LIVE` (DO → `WorkbenchLive`, tag v7) · `BROWSER` · `AI` · `STIRLING_SVC` → `mgl-stirling` · `WEASYPRINT_SVC` → `mgl-weasyprint`.

`backend/src/types.ts` `Env` is the source of truth (`worker-configuration.d.ts` is generated and gitignored). It also declares ~10 secrets that live only in `wrangler secret put`: `JWT_SECRET`, `GOOGLE_SA_JSON`, `GOOGLE_OAUTH_CLIENT_ID/_SECRET`, `EMAIL_ENCRYPTION_KEY`, `SPEECHMATICS_API_KEY/_WEBHOOK_SECRET`, `STIRLING_API_KEY`, `APS_CLIENT_ID/_SECRET`, `VAPID_PRIVATE_KEY`.

**Never delete or reorder the `[[migrations]]` DO tags v1–v5** — three are tombstones for deleted classes. `MglMcpAgent` must stay under `new_sqlite_classes`.

**Rotating `VAPID_PUBLIC_KEY` invalidates every push subscription** (irreversible). **Rotating `JWT_SECRET`** kills every session, every installed Revit add-in and every in-flight print job at once — it signs five token classes from 17 call sites.

### Data model — five-level weighted hierarchy

```
Project ──< Block (team_id, weight_percent within team) ──< Drawing (weight_percent within block)
        ──< Component (weight_percent — SEE BELOW) ──< Task (weight_percent, assigned_to/assignees)
```

Plus `project_team_shares.share_percent` = "team T owns N% of project P".

**Component weights are dead.** Every rollup joins drawings→components→tasks and sums **task** weights straight under the **drawing**. `components.weight_percent` is editable and stored but changes nothing except an informational per-component number.

**`task_checklist_items` is NOT a sixth level** (migration 0177). It is a *personal, per-user* breakdown an employee writes for themselves on My Tasks — no `weight_percent`, no rollup reads it, and ticking every box does not close the task. Its only link to progress is a "3/5 done → 60%" button that pre-fills the row's percentage input; the employee still submits a normal `progress_entries` row. Do not "restore" it into the hierarchy — the weighted subtask layer was deliberately dropped by 0017/0020 and must stay dropped.

**`task_self_done` is the second view-only per-user table** (migration 0253, 2026-09-04) and it follows the same rules as `task_checklist_items`: no `weight_percent`, no rollup reads it, no `progress_entries` row, no `user_points` movement. It answers "my part of this task is finished but the task will never reach 100%". **Scoped to `projects.category = 'ZA'` (Засвар) only** — `POST /api/progress/my-tasks/:taskId/self-done` 403s every other category, on the owner's instruction that an employee must not be able to close their own working-drawing tasks. Why it exists: `/progress/my-tasks` shows everything under 100%, so on repair work the rows piled up forever and the only way an employee could clear the list was to **submit percent they had not earned** — the feature removes that pressure. The mark hides the row from the dashboard card and from the Хийгдэж буй / Идэвхтэй / Хоцорсон tabs, and leaves it visible in **Дууссан** and **Бүгд**, which is the only place the undo button lives. `DELETE` deliberately skips the category check so a project re-categorised later can't strand a hidden row.

**Таск хуваах — `POST /api/tasks/:id/split` (2026-09-25, миграцгүй).** Төслийн хуудасны таскийн мөр дээрх «Хуваах»
товч (`detail/TaskSplitDialog.tsx`) таскийг N (2–20) хэсэг болгож `weight_percent`-ийг хуваана; нийлбэр нь эх жинтэй
ЯГ тэнцэнэ (сервер `lib/taskSplit.ts` шалгана, эхний хэсэг = `total − Σ бусад`). Эзний шийдвэр: **бүх ажилтан**
(admin/senior/engineer/architect) · нэрийг хэрэглэгч өөрчлөхгүй, сервер «<нэр> (i/N)» болгоно · **эх таск** (id, явц,
хариуцагч, task_shares) эхний хэсэг болж үлдэнэ, тиймээс жин нь багасахад **төслийн явц буурна** · хуулбарууд
хариуцагчгүй, 0%, огноог хуулна, эх таскийн ард эрэмбэлэгдэнэ. Цонх: өгөгдмөл тэнцүү; нэг хэсгийг засахад гараар
засаагүй хэсгүүд үлдэгдлийг тэнцүү хуваана (9 → 7 + 1 + 1), бүгд засагдсан бол хамгийн эрт засагдсан нь чөлөөлөгдөнө
(`detail/taskSplit.ts`, зуун нэгжээр). `progress_mode='hours'` → 409. Оноог дахин тооцохгүй (`PUT /tasks/:id`-ийн жин
засвартай ижил). Тест: `lib/taskSplit.test.ts` (11), `routes/taskSplit.test.ts` (6).
⚠️ **2026-10-02-нд ХАСАГДСАН — `POST /api/tasks/:id/split` БҮХ таскт `410 SPLIT_RETIRED`.** Хуваалт одоо шинэ таск үүсгэдэггүй: доорх «Таскийн ХУВААРИЛАЛТ (2026-10-02, 0376–0380)» хэсгийг үз (`TaskSplitDialog.tsx`, `detail/taskSplit.ts` устсан; `lib/taskSplit.ts` зөвхөн `splitDefaults` — `TASK_OCCUPIED`-ийн `occupied.split`-аар үлдсэн).  Доорх нь түүх.
⚠️ **2026-10-01-нд өргөтгөсөн** — явцтай таскийн ЗӨВХӨН ҮЛДСЭНИЙГ хуваах, «хувааж авах» (`take`), хийгдсэн хэсэг 100%-аар
хаагдах: доорх «Таск авах = цаг эхлүүлэх» хэсгийг үз (`routes/taskSplit.test.ts` одоо 16).

⚠️ **2026-10-01-нд ДАРАГДСАН** (доорх «Таск авах = цаг эхлүүлэх», 0368/0369): байнгын хариуцагч байхгүй, `/claim` = албан
таймер, `/share`·`/unassign` 410, «N өдөр» чип UI-гаас хасагдсан (`/hold-days` хариулсаар).  Доорх нь түүх.
**Нэг таск = нэг хүн + таск дээр зарцуулсан өдөр (migration 0350, 2026-09-25).** Эзний шийдвэр: «Өөрийгөө нэмэх»
(`POST /:id/join`, 0326), 👥 хамтарсан хувь хуваалт (`GET/PUT /:id/shares`, 0322 — `TaskSharesDialog` одоо дуудагчгүй)
ба олон хүн оноох **ХАСАГДСАН**; хоёр дахь хүн ажиллах бол «Хуваах»-аар хуулбар үүсгэж өөрийн хэсгийг авна. Хаалт
`routes/tasks.ts` `ONE_ASSIGNEE_ERROR`: `/claim` хүнтэй таск → 409, `/share` 2+ id → 400 / хүнтэй таск → 409, `POST /` 2+ →
400, `PUT /:id` ШИНЭ хоёр дахь хүн → 400 (хуучин 2+ хүнтэй таскийг хэвээр засч, хүн хасч болно). **Хуучин 2+ хүнтэй /
хуваалттай таск, тэдний оноо ХӨНДӨГДӨӨГҮЙ**; `task_shares`-тэй таскаас `/unclaim` хийхэд `redistributeTaskPoints` хэвээр.
Засварын (hours) таскийн «Өөрийгөө нэмэх» ч хасагдсан — бусад нь «Засвар бүртгэх» цонхоор тэмдэглэнэ. Хурлын даалгавар
(`meetingTasks.ts`, жин 0) ба блок хуулах нь олон хариуцагчтай хэвээр. **Өдөр** = УБ-ын ажлын өдөр (Даваа–Баасан −
`holidays`), өөртөө авсан / оноосон өдрөөс, буцаасан хугацаа тоологдохгүй, дахин авбал тасралтгүй үргэлжилнэ, хүн
тус бүрд тусдаа (`lib/taskHold.ts`, цэвэр). **Таск 100% болоход ЗОГСОНО** (эзэн 2026-09-29: «дууссан таск 88 дахь өдөр болж явах ёсгүй») — хариуцагч дууссан таскаас гардаггүй тул өмнө нь өдөр үүрд өсдөг байв (прод хуулбар: 3 299 хариуцагчийн мөрийн 2 873 нь аль хэдийн 100% таск, дунджаар 78 өдөр илүү): `doneSpans()` батлагдсан `progress_entries`-ийг `created_at, id` (`byCreatedAt`) дарааллаар уншиж, 100% болсон өдөр (`progress_entries.date`) ӨӨРӨӨ тоологдоно, дараах өдрүүд үгүй; 100%-иас доош бөглөвөл тэр өдрөөс дахин тоологдоно (дууссан хоорондох өдрүүд үгүй). `hold-days` мөр `done_on`-той — чип ногоон «100% болоход N өдөр» (`features/tasks/HoldDaysChip.tsx`); дууссаны ДАРАА оноогдсон хүн 0 өдөр → чип нуугдана (прод хуулбарт 447 мөр). Hours-mode (ZA) таск хувь авдаггүй тул хэзээ ч зогсохгүй. **DEPLOYED 2026-09-29** (commit `98a3bf29`, миграцгүй: worker `63635048`, Pages `acb49281`, `index-Fu-bry8k.js`). Одоогийн эзэмшил = `task_assignees.created_at`; `task_hold_periods` (FK-гүй)
нь ЗӨВХӨН дууссан хугацаа — мөр устахаас ӨМНӨ `closeHolds()` (`lib/taskHoldStore.ts`). ⚠️ `syncTaskAssignees` зөвхөн
өөрчлөгдсөн хүнийг устгадаг болсон — бүгдийг устгаж дахин оруулбал created_at шинэчлэгдэж өдөр тэглэгдэнэ.
`GET /api/tasks/hold-days?project_id=|mine=1`; `/claim` → `hold_days` («N дахь өдрөөс үргэлжилнэ» toast). UI: хариуцагчийн
нүд (`TaskAssigneeCell`) ба «Миний ажлууд»-ын мөрөнд «N өдөр» (`features/tasks/holdDays.ts`); admin popover нэг хүн
сонгоно; setup хуудас шинэ хүн сонгоход сольдог. Тест: `lib/taskHold.test.ts` (13), `routes/taskHold.test.ts` (6).
Хуучин түүх байхгүй — 0350-аас өмнө буцаасан таскийн өдөр алга. **DEPLOYED 2026-09-25** (release `ac0e34eb`, D1 0350).

**«Миний ажлууд» → төслийн хуудас, `?mine=1` (2026-10-01, зөвхөн frontend, миграцгүй).** `/app/my-tasks`-ийн төслийн
бүлгийн толгойн НЭР нь `/app/projects/:id?mine=1` рүү холбоос (`MyTasksPage.tsx`).  Төслийн хуудас `?mine=1`-ээр орвол
(`ProjectDetailPage.tsx`; төлөв нь URL — state биш, `Бүгд | Зөвхөн миний N` сэлгүүр `?mine`-ийг солино) таскийн хэсэгт ЗӨВХӨН
надад хуваарилагдсан таск харагдана (`useProjectTasks` `mineOnly`; багийн pill ҮЛ ТООГДОНО — миний таск өөр багийн блок дотор
байж болно, блок сонговол огтлолцоно) ба `useScrollToMyTasks` таскийн хэсэг рүү төсөл бүрт НЭГ удаа гүйлгэнэ.  «Надад хуваарилагдсан»
= `isMyTask()` (`assigned_to` ЭСВЭЛ `assignees`) — `flatTasks`-ийн хамрах хүрээ ба энэ шүүлт ГАНЦ предикатыг хуваалцана.  Явцын % бөглөх
нь «Миний ажлууд» дээр хэвээр; төслийн хуудас дээр огноо/хариуцагч/«Хуваах» засагдана.  **DEPLOYED 2026-10-01** (commit `8287d391`,
Pages `8c32d6a9`, `index-DKrxmRMy.js`): live суурь `fa8d5e95` (`4e752155`-ийн Drive «Эх файлыг нээх»-ийг АГУУЛААГҮЙ) + зөвхөн
миний 8 файл — HEAD-ээс build хийвэл Drive-г хамт гаргах байсан.

**⚠️ There is exactly ONE rollup — and it is copy-pasted into eleven places.**

Every level divides by the **declared** budget, so weight that was never allocated counts as unfinished work:

| Level | Math |
|---|---|
| task → drawing | `SUM(t.weight_percent × pct) / NULLIF(d.weight_percent, 0)` |
| drawing → block | `SUM(d.weight_percent × d.progress) / 100.0` |
| block → team | `SUM(b.weight_percent × b.progress) / 100.0` |
| team → project | `SUM(pts.share_percent × team_prog) / 100.0` |

Weight sums are **never DB-enforced** (a soft amber `WeightMeter` in the setup UI is the only signal), so a project whose weights or team shares don't reach 100 reads low, and one whose weights exceed 100 can read **above** 100. Not clamping is deliberate — bad weight data must stay visible. The only clamp is in `frontend/src/ui/progress.tsx`, and it clamps the bar *geometry* only; the printed number is the true value.

Until 2026-08-11 the display rollup normalised by the **actual** child weight sum (`/ NULLIF(SUM(w),0)`) while scoring divided by the declared budget, so a project whose team shares summed to 60 showed **100%** on the card while points and auto-archive saw 60%. Both now use the table above, which makes display byte-identical to `calcProjectProgress`.

**Nothing enforces that the eleven copies agree** — the header comment above `PROJECT_LIST_SQL` (`routes/projects.ts`) lists every one. Change one, change all eleven. `calcProjectProgress`, `computeProgressFromMap` and `recalculateProjectPoints` remain byte-aligned to each other on purpose.

A load-bearing subtlety for the JS copies: drawing weight **cancels** out of a task's project contribution, leaving `coef = (share/100) × (block.w/100) × (task.w/100)` — but only when `d.weight_percent ≠ 0`. A zero-budget drawing contributes 0. The SQL copies get that gate free from `NULLIF`; every JS copy must spell out `if (drawing.w <= 0) continue`.

Other rollup facts:

- `projects.manual_progress` (migration 0141) is an admin override that **beats the entire weighted tree**, but only in `PROJECT_LIST_SQL` and Timeline. `GET /api/projects/:id` ignores it, as do points and every chart.
- `projects.is_pending` (migration 0143) = «гэрээ хэлэлцээрийн шат». Visible only to admin + senior via the `seesPending` flag. **MCP and `lib/clientReport.ts` call `PROJECT_LIST_SQL` without it, so it defaults `true` and pending projects leak** to engineers/architects/clients through `list_projects`, `get_project_report`, `list_overdue_tasks`, `get_company_overview` and every client PDF.
- **"Latest approved entry" has two different tiebreaks** across the codebase (`created_at` only / `date,created_at,id` — both emitted by `lib/progressLatest.ts`; the third `MAX(date)`-without-tiebreak copy in `dashboard.ts` double-counted and was replaced by `date,created_at,id` on 2026-09-11). Back-dating an entry still makes the same task show different percentages on different pages.
- **Two incompatible team↔work mappings coexist:** structural `blocks.team_id` (drives the headline rollup and the points math) vs **drawing-name prefix matching** (`UPPER(TRIM(substring before first space or hyphen))` joined to `teams.code`) — reimplemented in six SQL files plus a JS twin in `tasks.ts`. The project card renders a weighted `team_prog` headline next to an unweighted prefix-mapped per-team list; they routinely disagree.
- `PUT /api/components/:id` and `PUT /api/drawings/:id` change weights but do **not** call `recalculateProjectPoints` — editing a drawing weight silently desyncs the leaderboard ledger.

**Project categories** (`lib/projectCategories.ts`, mirrored on the frontend): `AZ` Ажлын зураг · `ZA` **Засвар** · `ET` Ерөнхий төлөвлөгөө · `EZ` Эскиз зураг · `IZ` Интерьер зураг. A **contracted** rework job is modelled as a **project of category `ZA`** — a real project with blocks, drawings and a team roster. That is not the same thing as `repair_entries` (self-logged hours) or `repair_projects` (see below); the three coexist. Categories only seed the default `project_team_shares` roster at create time.

### Approval workflow — REMOVED (2026-09-17, migration 0323)

- **There is no review step at any percentage.** `POST /api/progress` (and `/bulk`, and the Revit add-in's `/api/revit/submissions/*/submit` through the same `submitProgressEntry`) writes every row `status='approved'` with `reviewed_by` = the submitter. Owner's decision: employees are trusted to close their own tasks; the 100%-closure approval queue only slowed them down.
- Gone: `GET /api/progress/pending-approvals`, `PATCH /api/progress/:id/approve|reject`, the `progress_pending` notification, `SubmitOptions.forcePending` + `app_settings['revit.force_pending']`, the MCP tool `list_pending_approvals`, `has_pending` / `last_rejection` / `reported_today_status` on `/progress/my-tasks`, and the whole `frontend/src/features/projects/detail/approval/` folder + the project «Баталгаажуулалт» tab. Migration 0323 flipped the last `pending` rows to `approved` (`reviewed_by = user_id`) — those rows got **no `user_points`**; run `POST /api/leaderboard/recalc-all` once after deploying if the ledger should include them.
- `status IN ('pending','rejected')` still exists in the schema and in ~25 historical rows, so history renderers (`PreviousReportsCard`, `ActivityRow`, `/progress/my-recent`) keep their branches. **Nothing writes those states any more** — a new writer needs a review UI that no longer exists.
- A ≥100% submission still requires every `completion_questions` answer or it 400s, and still triggers `summarizeTaskCompletion` + `archiveProjectIfComplete` in the same request.
- `teams.lead_user_id` survives only as a notification-routing hint in `lib/notify.ts` (`createNotificationForReviewers`, used by leaves/OOO/ASR/suggestions/attendance-confirmations); it is not an authorization input anywhere.

### Points

`awardPointsForEntry` (`routes/progress.ts:46`):

```
complexityPct = max(0, projects.complexity_pct ?? COMPLEXITY_PERCENT.mid)   // the per-project REAL column (migration 0093)
deltaPct      = max(0, calcProjectProgress(after) − snapshot(before))
share         = complexityPct × (deltaPct / 100)
```

**One `user_points` row is written, to the submitter, with `assignee_count` hardcoded to 1.** There is no split across assignees (`assignee_count` is a vestige of an abolished model). `COMPLEXITY_PERCENT` is only a NULL fallback.

`recalculateProjectPoints` rebuilds only the `source='progress'` slice; `source='repair'` rows are deliberately untouchable by it.

**2026-10-01 — ХАМГИЙН ӨНДӨР ХУВЬ (`lib/taskTake.ts` `hwmFraction`).** Δ% is multiplied by the share of the task's move that
lies ABOVE the highest % the task ever reached (77 → 8 → 77 no longer pays twice); live award and recalc use the identical
rule. Recalc credits a `source='split'` 100% entry (the closed «done part» of a split) to the task's earlier contributors
pro rata (`distributeByContribution`), and a baseline entry to `progress_entries.credit_user_id` (frozen by 0368). See
«Таск авах = цаг эхлүүлэх» below.

**Хамтарсан ажил — `task_shares` (migration 0322, 2026-09-17).** ⚠️ 2026-09-25-нд UI + засах зам ХАСАГДСАН (дээрх «Нэг таск = нэг хүн»); хуучин мөр, оноо хэвээр. The one exception to "submitter gets 100%": a task with
`task_shares` rows (`user_id`, `share_percent`, Σ = 100) splits **every** award by share regardless of who submitted, and
the split is **retroactive over the whole task** — «би 80% хийгээд нөгөө нь миний ажлыг ашиглаад дуусгасан → 80 / 20».
`lib/taskShares.ts` is the only place that knows the rule: `creditSplit()` (pure, tested; no rows ⇒ fallback user 100%)
is called from `awardPointsForEntry` (live) and `recalculateProjectPoints` (replay), and `redistributeTaskPoints(taskId)`
re-splits the task's **existing** `user_points` rows entry-by-entry when the split changes (Σ amount and Σ delta_pct per entry
preserved; `awarded_at`/`awarded_by` kept — `awarded_by` stays the person whose work it was, so clearing the split can fall
back to them). Both `amount` **and** `delta_pct` are multiplied by the fraction, so the leaderboard's "Σ delta_pct per user =
project progress" invariant holds; `assignee_count` = number of split members. It deliberately does NOT call
`recalculateProjectPoints` (that would rebuild the whole project under current weights and move other people's numbers).
Routes: `GET/PUT /api/tasks/:id/shares` (`routes/tasks.ts`). **Only the task's original owner (`is_owner=1`, or every current
assignee when no split exists yet) or admin/senior may edit** — a collaborator added through the split cannot re-cut it in their
own favour. Anyone active and leaderboard-eligible from **any team** may be added (owner's call 2026-09-17; the `/share` same-team rule does not apply here). A newcomer is inserted into
`task_assignees` with `added_to_assignees=1` (so they see the task on My Tasks and can submit) and that row is removed again when
they leave the split; admin-assigned rows are never touched. `/unclaim` drops the leaver's share row and re-splits. Rollups
never read this table — progress % is unchanged. UI: the «👥 80% · 2» chip on a My Tasks row (`TaskSharesDialog.tsx`), also on
done rows because retroactive splitting is exactly the post-hoc use case. `tasks.delete` clears the rows by hand (D1 FKs).

**Өөрийгөө нэмэх — `task_assignees.self_joined` (migration 0326, 2026-09-18).** ⚠️ 2026-09-25-нд `/join` ХАСАГДСАН (дээрх «Нэг таск = нэг хүн»). Owner's scenario: «А 30% хийгээд маргааш
ирсэнгүй — Б тэр таск дээр өөрийгөө нэмж үргэлжлүүлээд, дараа нь хоёулаа ярилцаж хувиа оруулна». `POST /api/tasks/:id/join`
adds **only the caller** (body ignored; `canSelfClaim` roles, `users.status='active'`), on an owned task as
`self_joined = 1` — `tasks.assigned_to` is untouched, so reports keep the original «хариуцагч» — and on an unassigned task it
is exactly `/claim` (`self_joined = 0`, `assigned_to` set). **The split is written AUTOMATICALLY at join time
(owner's rule, 2026-09-18): the task's latest approved % (`lib/progressLatest.ts` byCreatedAt, same as My Tasks) stays with
the current members — pro rata to their existing split, equally when there is none — and the newcomer gets `100 − done`**
(«80% хийгдсэн → шинэ хүн 20%», never 50/50; `lib/taskShares.ts` `autoJoinSplit`, pure, 7 tests). The whole-task retroactive
re-slice then makes the final totals exactly «A earned the done part, B the rest» because points are linear in Δ%. Two
deliberate exceptions where **no row is written**: `done = 0` (credit stays delta-based — same result unless the owner later
reports work done before the join, which then stays theirs) and `done = 100` (nothing left to give; negotiate by hand).
⚠️ A task-wide split credits only its members: a *historical* submitter who is no longer on the task (measured on prod copy:
task 16220 — user 32 did the first 10 %, user 30 the rest) loses their slice to the current members the moment any split is
saved — inherent to the 0322 model, not specific to auto-join. The join response carries `auto_split: {done, mine} | null`
(toast «ажил 80% хийгдсэн тул таны хувь 20%»), the shares response carries `progress_pct`, and the dialog's add-person
pre-fill applies the same rule client-side (`splitByRemaining`); joining a task that already has a split at done 0/100 leaves
the joiner outside it (`has_split` + `auto_split = null` → warning). Edit rule now lives in `lib/taskShares.ts` `shareEditPolicy` / `validateShareList` (pure,
tested) and is shared by `GET`/`PUT /shares` and `/join`: **every task member edits the percentages** (owner and self-joined
alike — the owner's call), but **only owners / admin / senior change the list** (add a candidate, drop a non-owner, clear the
split); a self-joined member's saved set must equal the current member set exactly (`400 members only`). «Owner» with no
split = `self_joined = 0` assignees (falls back to all assignees when every owner has unclaimed); with a split = `is_owner`
rows. Every change of someone else's percentage, and every drop from the split, now notifies that person (`task_assigned`
type reused). The 👥 button on the project page renders on **every** row for `canClaimRole || isAdmin` (assigned or not) —
**except on `progress_mode='hours'` projects** (owner, 2026-09-24: repair work is «participant + worked hours», never a
percentage split): there `TaskAssigneeCell` hides it and shows a plain «Өөрийгөө нэмэх» button (same `POST /join`) to a
non-member, and `/join` itself writes no auto split and sends a no-percentage notification; the
dialog shows «Өөрийгөө нэмэх» to a non-member, pre-fills `members` (equal split) when no split is saved, and hides the
add-person search for a self-joined collaborator. Dropping a self-joined member from the split does **not** remove their
assignee row (`added_to_assignees = 0`) — leaving the task is `/unclaim`. Verified 2026-09-18 on an isolated prod-copy D1:
72 API checks (`join-e2e.mjs`) + headless-Chrome dialog flow (20 checks) — Σ`user_points.amount` per task is invariant
across join / split / drop / unclaim.

### Засварын төсөл (`repair_projects`) — migration 0194

When every real project already has an owner, an employee with nothing to work on does company-internal work
(«Оффисын зураг засвар», «Компанийн танилцуулга») and still needs to log hours and earn a percentage. Admin creates those
buckets by hand from the **Засвар бүртгэх** dialog on `/app/my-tasks`.

**They are NOT rows in `projects`, and that is the whole design.** A repair project has no `projects.id`, so it cannot
surface in any of the 126 `FROM projects` / `JOIN projects` sites — Projects page, dashboard, company overview, Timeline,
client portal, MCP, global search. **Zero filters were added anywhere.** The rejected alternative — a real `projects` row
hidden behind a flag — would have needed the filter repeated at **34** enumeration sites (company.ts ×12, dashboard.ts ×4,
mcp/tools/company.ts ×4, …) plus 46 single-id sites to stop direct access. `is_pending` (0143) is exactly that pattern and
**2 of its 4 callers already forget the argument**, which is why it leaks in production today. `landing_projects` is the
in-repo precedent for the separate-table shape and has never leaked.

- **A repair attaches to exactly one owner.** Both `repair_entries` and `user_points` carry `project_id` (nullable now)
  **and** `repair_project_id`, with `CHECK ((project_id IS NULL) <> (repair_project_id IS NULL))` enforced by SQLite —
  unconditionally, not subject to the `foreign_keys` pragma. `POST /api/repair` mirrors it as a 400 so the DB check is
  never the thing the user sees.
- **⚠️ The two id spaces overlap.** `projects.id` and `repair_projects.id` are independent AUTOINCREMENTs, so id 7 exists in
  both. Every UI that mixes them uses a composite `p:<id>` / `r:<id>` token — the repair dialog's `<Select>`, the admin
  history filter (`RepairHistoryTab`), and the profile contribution list. A plain numeric id silently aliases the two.
- **Where admin manages them: Approvals → Засвар** (`/app/approvals?view=repair`, `RepairProjectsPanel`) — that panel owns
  the create form, rename, archive and delete. The same create field also sits inside the repair dialog on `/app/my-tasks`,
  but **`admin` is deliberately NOT in that page's `NAV_ITEMS.roles`** (owner's call, 2026-08-25): the route stays reachable
  by typing the URL, it just must not appear in an admin's sidebar. Only the CEO (`isCeo`, id 2) gets that row.
- **A user who cannot submit a repair must not be shown the submit machinery.** `POST /api/repair` is gated to
  `engineer|architect|senior`, so for an admin `/repair/my` and `/repair/rate` both 403 and `daily_cap` falls to 0 — which
  made the dialog claim «no attendance today» when the real reason was permission. `RepairSection` now derives
  `canLogRepairs` from the role, skips both queries (`enabled`), and hides the picker, description, hours, preview and
  submit button.
- **Every `GROUP BY project_id` over `user_points` had to become `GROUP BY project_id, repair_project_id`** — SQLite treats
  all NULLs as one group, so the single-column version merged every repair project company-wide into one nameless row.
  Fixed at `leaderboard.ts` (per-user breakdown) and `profiles.ts` (contribution card). `GET /api/repair/my` and `/all`
  became `LEFT JOIN` + `COALESCE(p.name, rp.name)`; the old INNER JOIN silently dropped every repair-project entry from the
  submitter's own history.
- `COUNT(DISTINCT p.project_id) AS projects` (leaderboard.ts:136, :203) deliberately still ignores repair projects — a
  repair project is not a project, so it does not raise that counter.
- **Archive, never delete.** `repair_entries` stores only the FK, not a name snapshot, so deleting a repair project would
  blank the label on every historical row. `DELETE /api/repair/projects/:rid` 409s when entries exist; `PATCH` sets
  `status='archived'`, which hides it from the employee dropdown while history keeps its name. `POST /api/repair` rejects an
  archived target.
- The clock-out gate (`hasReportedWorkToday`, `attendance.ts:143`) matches `repair_entries` on `user_id + date` only, with no
  project join — so internal work satisfies «Гарах» unchanged. `routes/attendance.ts` validates clock-in project ids against
  `projects`, so a repair project can never reach `daily_active_projects`.
- Route placement is load-bearing: the CRUD lives under `/api/repair/*`, which is already outside `lib/workerScope.ts`'s
  allowlist. A new top-level prefix would have been another surface to audit.
- **Valuation is fully automatic and DAY-based (migration 0196).** `computed_pct = baseDailyRate × (hours / 8)` — the
  owner's spec: «an employee whose average day is 1.2% earns 0.6% for 4 hours». The original formula multiplied by the
  employee's own last-7-days progress points, which scored **0** for exactly the person the feature exists for — no project
  work that week means no multiplier. `baseDailyRate` (`routes/repair.ts`) walks a ladder and takes the first non-zero:
  **self7 → self90 → team30 → company30**, all in one round trip of scalar subqueries, each divided into *working* days
  (`calendarDays × 5/7`) — *superseded 2026-09-28: every rung is now a worked-day average from `lib/dailyAverage.ts`
  (last 21/64 worked days, cut at the join date, leave skipped); see Conventions.* Tier 1 wins first, so nothing changes for anybody who is actively working; the ladder only
  engages once the old formula would have produced 0. Numerator and denominator of the team/company averages use the
  **same** population (`leaderboardMemberSql(u, false)` + `status='active'` + `is_support = 0`) — CEO points in the
  numerator without the CEO in the denominator would inflate the average, which is why `includeCeo` is false on both.
- **⚠️ `repair_projects.rate_multiplier` is a DEAD column.** It shipped on 2026-08-25 as a per-item admin dial and was
  removed the same day — the owner's decision is that every internal-work hour is worth the same, so there is no dial at
  all. `routes/repair.ts` neither reads nor writes it; 0196 normalised every row to 1. The column stays (dropping it means
  a table rebuild for nothing), like `accent_color` / `tv_kiosk` / `model_xkt_url`. **Do not reintroduce a multiplier UI.**
- **The unit switch was presentational, not numeric.** A week is 5 working days, so `weeklyRate/40` per hour and
  `dailyRate/8` per hour are the *same number* — 0196 changed what the UI *says* («50% of a day» instead of «10% of a
  week»), and left `computed_pct` on every historical row untouched. It did rewrite `repair_entries.day_hours` (224 rows
  held 40, 7 held 8 — one column with two meanings) to 8 and divided `weekly_avg_pct` by 5, because the UI derives the
  displayed percent as `hours / day_hours × 100`. The migration is idempotent (`WHERE day_hours = 40`).
- **Rate inputs are snapshotted, never recomputed.** `repair_entries` stores `weekly_avg_pct` (the base rate — the name is
  historic, it holds the DAILY rate since 0196) and `rate_source`. `user_points` is a ledger — a later shift in the rolling
  average must not move historical points, and `rate_source` is the only breadcrumb that answers «why did I get this
  number?» once the window has moved on.
- **⚠️ (0348-аар ДАРАГДСАН — доорх «ЦАГИЙГ СИСТЕМ БОДНО»-г үз) Цагийг АЖИЛТАН ӨӨРӨӨ оруулна — ирцээс гаргасан тааз ХАСАГДСАН (2026-09-23).** Until then `dailyHourCap` capped a
  day's total repair hours at hours *actually present* (closed sessions' `hours_worked` plus, only for today, elapsed time
  since an open session's `clock_in`, clamped to 12), and no attendance row for that date ⇒ cap 0 ⇒ 400. The owner's
  measured objection: that design makes the **system tell the employee «та 0.1 цаг ажилласан байна»** — somebody who
  clocks in and then finishes a job is refused an 8-hour entry with «Ирцээс хэтэрч байна — өнөөдөр дээд тал нь 0.1 цаг».
  The cap is *structurally* behind the employee, because `hasReportedWorkToday` forces work to be logged **before**
  clock-out, so at write time the elapsed-time branch is always smaller than the hours really worked. The employee now
  types the hours and the percent follows from `ханш × цаг/8` unchanged (8 ц = the full daily average, 4 ц = half).
  `dailyHourCap` is **deleted**; `routes/repair.ts` no longer reads `attendance_sessions` at all.
  What is left is size-only and never asserts hours: `MAX_REPAIR_HOURS = 24` per entry, `MAX_REPAIR_HOURS_PER_DAY = 12`
  on a date's sum (`GET /rate` returns that constant as `daily_cap`, so the frontend contract is unchanged), and a **new
  explicit future-date 400** — previously the attendance cap rejected a future date *as a side effect* (no attendance
  there ⇒ cap 0), so removing it without this guard would have let «2027-01-01, 8 цаг» straight into points and progress.
  The clock-out gate is untouched: `hasReportedWorkToday` still counts `repair_entries` by `user_id + date`.
- **Ирц дээр сонгогдоно (migration 0324, 2026-09-17).** The clock-in / 14:00 / clock-out popup has a second page
  («Засварын төсөл», slides in from the bottom) listing active repair projects, so an employee doing a 1-2 hour
  internal fix no longer has to pick an unrelated real project — which is exactly what made the CEO see them on the
  wrong task. Two **leaf twin tables**, never columns on the project tables: `daily_active_repairs` ↔
  `daily_active_projects` and `attendance_checkpoint_repairs` ↔ `attendance_checkpoint_projects`. Reason: the project
  tables are read in ~20 places that all `JOIN projects`; a nullable `project_id` would have vanished from every one
  of them silently, whereas a twin table means readers **opt in** — only the Teams pages do (`/api/teams/allocation`
  and, since 2026-09-24, `/api/teams/:id/overview`; `/api/company/day-snapshot?include_repairs=1` still accepts the
  flag but lost its only caller when the Teams «Өнөөдөр» tab was removed); company overview, TV, project charts, timeseries and MCP stay
  `projects`-only. Wire format is two arrays (`project_ids` + `repair_project_ids`) on clock-in/checkpoint/clock-out/
  `PUT active-projects`; the «≥1 project» rule is the **sum** of both, so a repair project alone satisfies it.
  **And at most 2 (owner, 2026-09-29):** `project_ids + repair_project_ids` together ≤ `MAX_ATTENDANCE_PROJECTS` = 2 —
  400 `TOO_MANY_PROJECTS` on all four writers (`routes/attendance.ts` `tooManyProjects`); non-project picks (0357) do
  not count. Twin in `AttendanceProjectDialog.tsx` (unpicked options disabled at the limit; a >2 prefill from earlier
  that day blocks submit until deselected). Applies to admin/unrestricted too if they pick. Where
  the two id spaces are mixed in one list (allocation `projects`/`cells`, day-snapshot `active_projects`) a repair
  project is `id = -repair_project_id` with `kind: 'repair'`; the frontend's `projectHref()` (`teams/lib/allocation.ts`)
  is the only place that may build a `/app/projects/:id` link, and it returns `undefined` for those. `my-status`
  carries the picker list (`repair_projects`, active only) so the dialog needs no `/api/repair` call.
  `validateRepairProjectIds` 400s an archived pick; `DELETE /api/repair/projects/:rid` also 409s when attendance rows
  reference it (archive instead). `hasReportedWorkToday` already accepted `repair_entries`, so the clock-out gate
  needed no change.
- **Явц ЦАГИЙН БҮРТГЭЛЭЭС — `progress_mode` (migration 0339, 2026-09-21).** Owner's decision: nobody gives a repair
  project a percentage by hand; it starts at 0 and fills from the hours people log. Both «repair projects» follow ONE
  rule in **`lib/repairProgress.ts`** (the only place — SQL fragments, ladder, backfill, 18 tests):
  ⚠️ **SUPERSEDED 2026-09-29 — see «Явц = АЖИЛЧДАД ОЛГОСОН ХУВЬ» below; the formula in this bullet is history.**
  `progress = MIN(100, Σ repair_entries.progress_pct)`, `progress_pct = progress_rate × hours/8`, `progress_rate` = the
  employee's daily average **project-%** (`user_points.delta_pct`, source='progress') through the SAME self7 → self90 →
  team30 → company30 ladder as the points rate — only the *measure* differs. **Points are untouched**: `computed_pct` /
  `user_points.amount` keep the `amount`-based ladder, so one entry carries two frozen snapshots (`computed_pct` for the
  ledger, `progress_pct`/`progress_rate`/`progress_rate_source` for progress). Measured on prod 2026-09-21: staff daily
  delta_pct median ≈0.1, max 1.7 → a repair project fills slowly by design; do not inflate the number.
  · `repair_projects` (internal work) always use it — `GET /api/repair/projects` returns `progress`, the Approvals →
    Засвар panel shows a bar, the Reports «Засварын төслийн тайлан» tab has a «Явц» KPI/column (`progress` is `null` for
    tasks-mode real projects there).
  · `projects.progress_mode` (`'tasks'` default | `'hours'`): **new ZA projects are created `'hours'`**
    (`defaultProgressMode`, overridable via `progress_mode` on POST/PUT — admin toggle lives in `ProjectEditDialog`, ZA only);
    **every pre-0339 ZA project stays `'tasks'`** (owner: their weighted progress must not drop — **REVERSED by 0348:
    every ZA project is `'hours'`, the mode follows the category and the toggle is gone**). In `'hours'` mode
    `projectProgressSql()` swaps the weighted rollup for the hours sum in PROJECT_LIST_SQL (→ timeline, MCP, client
    report), `GET /projects/:id`, `dashboard.ts` and `company.ts` (overview + «delivered»); `manual_progress` still wins
    over both. `POST /api/progress` (web, `/bulk`, Revit — one gate in `submitProgressEntry`) answers **403
    `HOURS_PROGRESS`** for any task of an hours-mode project; `/progress/my-tasks` carries `project_progress_mode`, and
    My Tasks replaces the % input with a «Цаг бүртгэх» button that opens the repair dialog pre-picked
    (`RepairSection` `openRequest`); such rows are excluded from bulk selection and `pending_today`.
    `calcProjectProgress` (points) still reads `progress_entries` only; no auto-archive at 100 (owner did not ask).
    The OVERALL chart curve (`lib/progressTimeseries.ts` `buildHoursOverall` — charts tab, hero sparkline, perf-report
    graph, MCP portfolio) reads the hours ledger since 2026-09-28, so its last point = the headline; per-team curves
    and the activity bars are still task-based.
  · **Backfill:** pre-0339 entries have `progress_rate_source IS NULL`; `POST /api/repair/backfill-progress` (admin,
    idempotent, `?all=1` redoes everything; the «Явц нөхөж тооцох» button in the Approvals panel) computes each row **as
    of its own `created_at`/date** (`dailyRateSql(measure, member, '?2')` bounds the window on both sides) — run it once
    after deploying 0339. Verified on a prod-copy D1 (route E2E 45 checks incl. 103-row backfill, headless-Chrome UI 13).
    Since 2026-09-29 it only refreshes the `progress_pct` snapshot — it no longer moves any project's progress.

- **Явц = АЖИЛЧДАД ОЛГОСОН ХУВЬ, 100%-аас давна (2026-09-29, миграцгүй).** Owner doubted Теннис ZA #42 showing 100% and
  chose (AskUserQuestion): «ажилтны дундаж хувьд хэд нэмэгдсэн бол төсөлд яг тэр хувь нэмэгдэнэ», no cap.
  `hoursProgressSql` = `[hours_progress_base +] Σ user_points.amount WHERE project_id|repair_project_id = id` — every %
  credited on that target: repair-hour points (`source='repair'`) **and** the %-fill points earned before the project
  switched to hours (`'progress'`, complexity-scaled: task-% × `complexity_pct`). 0348 backfill rows carry 0 points, so
  nothing is counted twice. `repair_entries.progress_pct`/`progress_rate` (the delta_pct ladder) are still written but
  are now **snapshots only** — no reader derives progress from them. Measured cause on prod: Σ progress_pct = 114.13 on
  #42, 86.5 of it from 2 people who had filled a small EZ project 100% in one day on 05-28, so their «daily average
  project-%» was ≈5/day for a month (others ≈0.1); 292 hand-logged rows (2127 h) never got `progress_pct` at all. New vs
  old on prod (2026-09-29): Теннис 24.37 (was 100), EVERGREEN 11.57 (8.25), Макс өргөө 7.47 (40.45), Хуванцар 4.76
  (4.52), MAK Цагаан суварга 2.68 (65.4), internal #3 1.21 (8.13). Chart (`buildHoursOverall`) = Σ amount by UB date of
  `awarded_at`, uncapped. Reports «Засварын төслийн тайлан» per-person «явц» = that person's Σ amount on the target.
  Frontend prints the true number (bars still clamp): `ProjectsPage`/`ProjectListCard` (`shown`), `GanttRow`,
  `RepairProjectsTab.fmtProgress`. Tests: `repairProgress.test.ts`, `progressTimeseries.test.ts` (now `registerHooks` —
  it imports `reportWindows`), `repairDayStore.test.ts` (0349 case).

- **Ажилтанд ЗӨВХӨН ЦАГ — хувьгүй, тайлбаргүй (migration 0341, 2026-09-24).** Засварын бүртгэх цонх
  (`RepairSection.tsx`) нь төсөл + цаг л авна: «Хийсэн засвар» тайлбар, «Өдрийн хувь / Авах хувь / Төслийн
  явцад нэмэгдэх %» урьдчилсан харалт, түүхийн «100% · 0%» баганууд ХАСАГДСАН. `repair_entries.description`
  нь 0114-д NOT NULL тул шинэ мөрөнд `''` (хуучин тайлбар хэвээр, админы түүхэнд харагдана); хуучин клиент
  илгээвэл хадгална. **Оноо (`computed_pct`→`user_points`) ба явц (`progress_pct`) сервер дээр ХЭВЭЭР** —
  зөвхөн ажилтанд харагдахаа больсон. `repair_entries.task_id` (0341, nullable, `ON DELETE SET NULL` +
  `tasks.delete` гараар тайлна) — зөвхөн `progress_mode='hours'` төслийн таск (ердийн төсөлд 400), My Tasks-ийн
  «Цаг бүртгэх» мөр таскаа дамжуулна. «Хэн хэдэн цаг» = `GET /api/repair/hours?project_id=|repair_project_id=`
  (`lib/repairHours.ts`, цэвэр, 5 тест): hours-mode төслийн хуудсанд «Ажилласан цаг» карт, таскийн мөрөнд
  Зураг % / Төсөл % / Явц-ын оронд цаг + хүмүүс (`TaskRowProps.hoursMode/taskHours`, `detail/RepairHours.tsx`),
  блокийн карт цагаар; My Tasks-ийн hours мөр «Би N цаг · нийт M цаг» (`/progress/my-tasks` → `repair_hours`,
  try/catch — 0341-ээс өмнө deploy болсон ч жагсаалт унахгүй); `/repair/projects` → `total_hours`,
  `people_count`. Ердийн (`tasks`) төсөл ХӨНДӨГДӨӨГҮЙ. **Hero (2026-09-28, эзэн: «Furniture Land-аас бусад бүх
  төсөл зөвхөн бодит явцаар — ажилчдын дундаж хувь × ажилласан цаг»):** hours төсөлд «Багуудын явц» (таскийн хуучин
  хувиар бодсон багийн мөрүүд) ОГТ гарахгүй — `detail/RealProgressPreview.tsx` «Бодит явц» = `project.progress`
  (цагаас) + нийт цаг · хүний тоо; хажуугийн sparkline ч цагаас (дээрх `buildHoursOverall`). Томьёо ШИНЭЭР
  зохиогоогүй — 0339/0348-ийн цагийн явц хэвээр (2026-09-29-нөөс «олгосон хувь» — дээрх хэсэг).
  **«Ажилласан цаг» карт (2026-09-29, эзэн):** нээхэд ХУРААЛТТАЙ — толгойд нийт цаг + хүний тоо, доор нь хамгийн их
  цагтай ГАНЦ хүн; толгой эсвэл «Бүх N хүнийг харах»-аар бусад нь `grid-template-rows 0fr↔1fr` 300 мс шилжилтээр
  задарна (агуулга DOM-д үлддэг тул хаах хөдөлгөөн ч гөлгөр; хаалттай үед `inert`; `motion-reduce` унтраана).
  Прод дээр «Luxwood засвар» ХОЁР мөртэй: `repair_projects` #1 (19 бүртгэл, 154.2 ц) ба ZA төсөл #71 (hours,
  26 таск, 0 бүртгэл) — эзэн 2026-09-24: НЭГТГЭХГҮЙ, аль алиныг нь хөндөхгүй, код хатуу id-гүй.

- **«Засвар бүртгэх» цонх ГАР БҮРТГЭЛД БУЦСАН (2026-10-08, эзний хүсэлт, миграцгүй, DEPLOYED — `88390f05`, worker `abb11e01`,
  Pages `bbd1bb97` `index-QvjLsTwj.js`).** Цонх 09-24-өөс өмнөх хэлбэртэй: төсөл + «Хийсэн засвар» тайлбар + цаг (1/2/4/8
  хурдан товч) + өдрийн хувь / өдрийн дундаж / авах хувь / явцад нэмэгдэх урьдчилсан харалт (`GET /repair/rate`). `POST /api/repair`
  ХОЁР горимтой: `hours` ирвэл гар бүртгэл (`description` заавал, ≤24 ц/мөр, өдрийн нийлбэр ≤12 ц, ирээдүйн огноо 400, хувь =
  өдрийн дундаж × цаг/8, `hours_source='manual'`, `user_points` source='repair', өнөөдөр бол `syncRepairDay` — гар цаг өдрийн
  багтаамжаас хасагдана); `hours` ирэхгүй бол 0348-ын тэмдэглэгээ хэвээр (My Tasks hours мөрийн «Ажилласан» товч). Доорх
  «ажилтанд хувь харагдахгүй» (0341) ба «цагийг систем бодно» (0348) нь ЭНЭ цонхны хувьд ДАРАГДСАН. Тест `routes/repairManual.test.ts`.
- **ЦАГИЙГ СИСТЕМ БОДНО — бүх ZA, «Ажилласан» тэмдэглэгээ (migration 0348, 2026-09-25).** Эзний дүрэм: засварын
  таск дээр хувь ч, цаг ч бичихгүй — ажилтан «өнөөдөр үүн дээр ажилласан» гэж тэмдэглэнэ (My Tasks-ийн hours мөрийн
  «Ажилласан» товч, эсвэл «Засвар бүртгэх» цонх — цаг оруулах талбаргүй), цагийг сервер хуваарилна. Дүрэм ГАНЦ
  газар — **`lib/repairDay.ts`** (цэвэр, 19 тест): өдөр = ажилтны ээлж (`shiftForUser`) − цай − төслийн бус ажлын
  цаг (татгалзсанаас бусад) − батлагдсан нэг өдрийн цагийн чөлөө (`remote` биш) = 8 цаг; ≤30 минутын зайтай
  бөглөлтүүд НЭГ СУУЛТ; суулт бүр өмнөх суултаас (эхнийх нь ээлжийн эхнээс) өөрийн сүүлийн бөглөлт хүртэлх
  хугацааг, ӨДРИЙН СҮҮЛИЙН суулт ээлж дуустал хамарна; суултын минутыг тэнд бөглөсөн ялгаатай БҮХ ажилд тэнцүү
  хуваана — хувиар бөглөсөн энгийн (AZ/EZ/IZ) таск ч нэг ажил (эзэн: «хэдэн ч таск — нийлээд 8 цаг», 1 засвар + 3
  энгийн → 2 цаг); ээлж дууссаны дараах бүх бөглөлт нэг эцсийн суулт, ээлжээс өмнөх бөглөлт (хожуу бөглөлт байвал)
  0; гараар бичсэн хуучин (`manual`) цаг өдрийн багтаамжаас эхэлж хасагдана. Хоцорсон/эрт тарсан нь цагт
  нөлөөлөхгүй. Дугуйлалт өдрийн нийлбэрийг хадгална (`roundHoursPreservingTotal`: 2.67+2.67+2.66).
  · **Хүснэгт:** `repair_marks` = ҮЙЛ ЯВДАЛ (хэн, аль өдөр, аль ажлыг, хэзээ; ханшийн snapshot тэмдэглэх агшинд);
    `repair_entries`-ийн `hours_source = 'auto' | 'backfill'` мөр = ТҮҮНЭЭС ГАРГАСАН цаг (`mark_id` UNIQUE, 1:1).
    `repair_entries.hours` нь CHECK(hours > 0) тул 0 цаг ногдсон тэмдэглэгээ мөргүй — тиймээс `hasReportedWorkToday`
    ба `DELETE /repair/projects/:rid` `repair_marks`-ийг ТУСАД НЬ тоолдог, `GET /repair/my` ийм тэмдэглэгээг
    `kind: 'mark'`, 0 цагтай буцаадаг. `lib/repairDayStore.ts` `syncRepairDay` — өдрийг бүхэлд нь дахин хуваарилдаг,
    идемпотент; `manual` мөрийг ХЭЗЭЭ Ч хөндөхгүй. Дахин хуваарилах өдөөгч (ЗӨВХӨН өнөөдөр): тэмдэглэх/болих, `POST
    /progress` + `/bulk` + Revit submit (хүсэлтийн дотор await — `waitUntil`-ээр бол дараалсан sync хуучин snapshot-оор
    дарна), төслийн бус ажлын CRUD. Өдөөдөггүй: чөлөө батлах, төслийн бус ажил татгалзах, өнгөрсөн огнооны хувь.
  · **Ханш:** шат `self30 → self90 → team30 → company30` (эзэн «30 хоногийн дундаж»; `self7` нь хуучин мөрийн түүх) ба
    хүний БҮХ ажил орно (`measureSql`): оноонд progress + repair + non_project `amount`; явцад progress `delta_pct` +
    засварын `repair_entries.progress_pct` (засварын `user_points.delta_pct` нь оноотой тэнцүү — төслийн-% биш).
    Өөрийгөө тэжээх нь тогтвортой (өдөр ≤ 8 цаг ⇒ өдрийн хувь ≤ ханш). ⚠️ Явцын хэмжигдэхүүн «өдөрт төслийн хэдэн %» тул
    13 таскийн эскиз төслийг сард дуусгасан хүний ханш ≈3.8%/өдөр болж, түүний засварын цаг бусдынхаас 10–30 дахин их
    явц нэмдэг — эзэнд хэмжээд харуулсан, эзэн 2026-09-25-нд одоогийн (төслийн-%) хэмжигдэхүүнийг СОНГОСОН.
  · **Бүх ZA цагаар:** миграц бүх ZA-г `'hours'` болгосон; `POST/PUT /projects` горимыг АНГИЛЛААС гаргана
    (`progress_mode`-ыг үл тооно), `ProjectEditDialog`-ийн сэлгэгч хасагдсан. **Хуучин ZA хувийн бөглөлт → цаг
    (эзний шийдвэр: «хүн бүрийн цагийг detect хийж оруул», явц нь ТЭР цагаас):** `runHoursBackfill` нь hours төслийн
    таск дээрх хувийн бөглөлт бүрийг `award_points = 0`, `progress_entry_id` UNIQUE тэмдэглэгээ болгож (ханш = тэр
    өдрийн ЭХЭНД мэдэгдэж байсан 30 хоногийн дундаж), өдрийг хуваарилна — `user_points` ХӨНДӨГДӨХГҮЙ (тэр ажил хувиараа
    оноо авсан). Cron-ын fail-safe салаа (`repairHoursBackfill`, 4 өдөр/тик, ШИНЭ cron илэрхийлэлгүй) + админы «Хуучин
    бөглөлтөөс цаг бодох» товч (Approvals → Засвар, 15 өдөр/дуудлага, ≈35 D1 асуулга/өдөр — 25 өдөр 863 асуулга болж
    1000-ын хязгаарт ойртсон). Дууссан бол `app_settings['repair.hours_backfill']='done'`; төсөл ZA болж шилжихэд
    (`PUT /projects/:id`) устгагдаж дахин асна. Хэмжсэн (09-24-ний продын хуулбар, 0349-ийн дараа 488 ажилтан-өдөр /
    1657 бөглөлт, ≈11 с): жинлэсэн → цагаас явц: EVERGREEN 3.1→8.2, MAK 4.1→65.4, Теннис 30.5→100, FURNITURE LAND
    93.9→93.85 (хэвээр — доор), Макс өргөө 5.9→40.4, Хуванцар 12.5→4.5, Тайгам 0.3→0.4; нөхсөн 484 өдрийн 424 нь яг
    8 цаг, 8-аас хэтэрсэн 0 (бусад нь тэр өдөр энгийн таск бөглөсөн), `user_points` мөр ба нийлбэр ЯГ ижил.
  · **⚠️ FURNITURE LAND (#49) = ХУВИАР, цаг БИШ (migration 0353, эзэн 2026-09-28: «Furniture Land өөр — түүн дээр юу ч
    бүү нэм; зөвхөн тэр нь өмнөх хувийн логикоо авна, бусад бүх ZA цагаар»).** 0353: `progress_mode='tasks'`,
    `hours_progress_base=NULL` → явц жинлэсэн модноос, My Tasks-д % маягт, `POST /progress` зөвшөөрөгдөнө. «Бүх ZA цагаар»
    дүрмийн ЦОРЫН ГАНЦ үл хамаарах. `PUT /projects/:id` горимыг ЗӨВХӨН ангилал ҮНЭХЭЭР солигдоход дахин гаргана (засах цонх
    ангиллаа хадгалах бүрд илгээдэг — эс тэгвэл #49 дараагийн хадгалалтаар цаг руу буцна). `ProjectEditDialog`-ийн «Цагаар»
    тайлбар ангиллаар биш горимоор. 09-25-ны 16 «Ажилласан» тэмдэглэгээ + 24 гараар бичсэн засварын мөр (оноотой) хэвээр.
    Доорх 0349-ийн суурь одоо NULL — `hoursProgressSql`-ийн суурийн код хэрэглэгчгүй үлдсэн.
    **DEPLOYED 2026-09-28** (UTC 00:45–01:07, commit ХИЙГЭЭГҮЙ — 758261d3 + энэ ажил): D1 0353 (өмнөх bookmark
    `00000203-00000508-000050f4-bfaf30426d086909ceefb2e91e68680f`), worker `27a7beb3` (10%→50%→100%, `clientDisconnected` 0),
    Pages `f4201b2f` (`index-NXyW0fTZ.js`, 758261d3-ийн «Эрэмбэ» таб хасалтыг ч агуулна).
  · (0353-аар ДАРАГДСАН) **FURNITURE LAND-ийн явц ХЭВЭЭР (migration 0349, эзэн 2026-09-25: «Furniture Land-ийн хувийг хэвээр үлдээ, бусад
    ZA-г шинэчил»).** `projects.hours_progress_base` = шилжихийн өмнөх жинлэсэн явц − тэр төслийн Σ `progress_pct`;
    0349 нь `calcProjectProgress`-ийг SQL-ээр давтаж ЗӨВХӨН id 49-д бичнэ, бусад ZA NULL. `hoursProgressSql`
    (`lib/repairProgress.ts`, ганц газар) = `MIN(100, base + Σ progress_pct)` — шинэ цаг суурь дээр НЭМЭГДЭНЭ. Суурьтай
    төслийн хуучин хувийн бөглөлт тэмдэглэгээ БОЛОХГҮЙ (`PENDING_FILLS`), гэхдээ `loadDayData`-д үйл явдал хэвээр —
    тэр өдрийн цагаас хувиа эзэлнэ (эс бөгөөс ижил суултад өөр засвар бөглөсөн хүнд бүтэн өдөр ногдоно). Хэмжсэн:
    93.8537 → 93.85 (яг таарсан), id 49-д тэмдэглэгээ 0.
  · Тест: `repairDay.test.ts` 19, `repairDayStore.test.ts` 14 (0348 + 0349-ийг `node:sqlite` дээр ажиллуулна),
    `repairProgress.test.ts` 25; API E2E 43/43 яг deploy хийсэн код дээр (prod-copy D1 + 0348/0349).
  · **DEPLOYED 2026-09-25 (UTC 06:55–07:08) — `26ad791` + энэ ажил, HEAD БИШ** (e31abca2 rollback-ын улмаас):
    D1 0348 + 0349 (өмнөх bookmark `000001c1-0000014e-000050f1-b0b5f7b043ec34df59eb92a2a82574ef`), worker
    `03ee9f65` (эхлээд 25% canary 11 мин — 120 хүсэлт, `clientDisconnected` 0 → 100%), Pages `a868247f`
    (`index-g5tmHI4q.js`). Прод дээрх FURNITURE LAND суурь 93.224 + цаг 0.736 = 93.96 (09-24-ээс хойш хувь нэмэгдсэн).
    Нөхөлтийг cron ≈4 цагт дуусгана, админ «Хуучин бөглөлтөөс цаг бодох» товчоор ≈1 минутад. Commit нь
    `c787974b` (release `ac0e34eb`-ийн нэг хэсэг, 2026-09-25 08:26 UTC-ээс worker `fb39f2bf`). ⚠️ `6668872e` руу
    rollback хийвэл схем нийцтэй ч FURNITURE LAND 0.74% болж харагдана.

### Төслийн бус ажил (migrations 0342–0344, 2026-09-24)

`non_project_work_entries` (`routes/nonProjectWork.ts`, дүрэм `lib/nonProjectWork.ts`): ирцийн цонхонд СОНГОНО (зөвхөн
хяналт — доор), My Tasks-аас ажлаа ДУУССАНЫ ДАРАА цаг (цайны цаг хассан `minutes`) + «юу хийсэн» `report` оруулна; «≥1
төсөл» дүрмийг хангана. Шалгуулахаар илгээгдсэн (`awaiting_review`) = тайлбар БА цагтай (`entryStage` ↔ `STAGE_WHERE`
ИХЭР); дутуу бол `needs_report` («Бөглөөгүй»). Админ «Тайлан → Төслийн бус ажлын тайлан» (`routes/nonProjectWorkReview.ts`,
`/api/reports/non-project-work`) батлахад л оноо: засвартай ИЖИЛ томьёо (`baseDailyRate` × цаг/8, ханш бүртгэл үүссэн мөчийнх) → `user_points`
`source='non_project'`, хоёр эзэн NULL (0343 CHECK), `non_project_work_id`. **Оноо АЖЛЫН ӨДӨРТ** (эзэн 2026-09-24):
`awarded_at` = ажлын өдрийн дуусах цаг (`workDateAwardedAt`), батласан өдөр биш — тайлан, онооны самбар бүгд
`awarded_at`-аас уншдаг тул ганц газар; тэр өдрөөс хойш аль хэдийн бичигдсэн `employee_daily_snapshots`-ийг
батлах үед дахин боддог (`refreshSnapshotsAfter`, ≤30 өдөр). Батлаагүй / татгалзсан ажил оноогүй.

**Ирцэд ЦАГГҮЙ сонголт = ЗӨВХӨН ХЯНАЛТ (migrations 0356/0357; эзний шийдвэр 2026-09-28, мөн өдөр ДАХИН
шийдсэн).** Ирцийн цонхонд (өглөө / 14:00 / гарах) төслийн бус ажлыг төсөл шиг зөвхөн СОНГОНО — «одоо юу хийж байна»-г л
тэмдэглэнэ (Багууд хуудасны «одоо» хяналт `teamDayWorkStore.ts` `selected_now`); цаг, хувь, ирцийн цагийн нэмэлт, засварын
хуваарилалт — ЮУ Ч бодогдохгүй, цаггүй мөрийн `minutes` ҮРГЭЛЖ 0 (`NonProjectPicker.tsx`, `non_project: [{category, note}]`;
хуучин клиентийн `report` хадгалагдана). Ажилтан ажлаа дуусгасны дараа «Миний ажлууд»-ын «Бөглөөгүй» мөр дээрх «Дуусгаж
бүртгэх»-ээр эхэлсэн/дууссан цаг + «юу хийсэн»-ээ ЗААВАЛ оруулна (маягт хоёуланг шаардана; сервер цаггүйг зөвшөөрсөөр —
ирцийн мөртэй ижил хэлбэр) → `awaiting_review` → админ баталсны дараа хувь; цагтай болмогц 0352-ын ирцийн цагийн нэмэлт
ба 0348-ын засварын блок `afterNonProjectChange`-аар дахин бодогдоно. Эхэлсэн цаг нь ирцэд АНХ сонгосон цагаар урьдчилан
бөглөгдөнө (`picked_at` = `MIN(recorded_at)`, `loadEntryPicks`; frontend `suggestedStart` ээлжийн эхлэлээр доод хязгаарлана,
`meta.shift_start`) — 15:00-д гараад хяналтад явсан хүн зөвхөн дууссан цагаа бичнэ. **Гарах бүртгэл «юу хийсэн»-ийг
ШААРДАХГҮЙ** (`NON_PROJECT_REPORT_REQUIRED` хаалт, `missingReportsAfter` устсан; `hasReportedWorkToday` сонголтыг ажлын
баримт гэж тоолсоор). Хасагдсан: `deriveTimelessMinutes`, `HALF_DAY_MINUTES`, `halfWindow`/`halfDaySplit`,
`recomputeTimelessMinutes`, `loadTimelessHalves`. Сонголт = `attendance_checkpoint_non_project(checkpoint_id, entry_id)`
(entry рүү FK-ГҮЙ — гараар устгана); `planPicks` нь сонголтыг өнөөдрийн ижил ажлын `pending` мөртэй тулгана (цаггүй нь
түрүүлнэ), байхгүй бол цаггүй мөр үүсгэнэ. 0356 нь хүснэгтийг rebuild хийж `start_time/end_time` nullable, `minutes >= 0`
болгосон. Тест: `nonProjectWork.test.ts`, `nonProjectPicks.test.ts` (10, бодит миграц), `nonProjectReview.test.ts`;
API E2E 28/28 + headless-Chrome 42/42 (scratch prod-хуулбар 0357-тэй). Прод дээр 2026-09-28-нд цаггүй мөр 0 байсан —
өгөгдлийн засвар хэрэггүй. **DEPLOYED 2026-09-28** (release `5bb5d9ea`, миграцгүй): worker `cbca5cf0`, Pages `1697c799`
(`index-C9qxVTCe.js`).

**Ажилтны профайлын «Өдрийн тайлан» таб (`/app/users/:id`, 2026-09-28, миграцгүй).** Явцын бичлэгийн
(`/profiles/:id/activity`) хажууд засвар ба төслийн бус ажил өдрөөрөө орно: `GET /api/profiles/:id/hours-log`
(`routes/profiles.ts`, эрх = activity-тэй ижил admin/senior/өөрөө) нь `repairs` (`repair_entries` + 0 цаг ногдсон
`repair_marks`, `GET /repair/my`-ийн UNION) ба `non_project` мөрүүдийг ХАДГАЛСАН snapshot-оор нь буцаана — юу ч дахин
бодохгүй. Мөр бүр «Өдрийн дундаж {ханш} × {цаг} ц / 8 = +{олгосон}», өдрийн толгойд нийт цаг + олгосон хувь (татгалзсан
ажил орохгүй; хүлээгдэж буй төслийн бус ажилд хувь БАЙХГҮЙ — батлах үед л бичигддэг). Хувиас нөхсөн (0348 backfill) мөрөнд
ханш `null` (оноо нь тэр бөглөлтөөр орсон). Ханш 0.0001% орчим тул `features/users/hoursLog.ts` `fmtRate` 0.001-ээс доош
2 чухал цифрээр харуулна (`fmtPts` «0%» болгодог). `/:id/activity` ХӨНДӨГДӨӨГҮЙ — «Тайлан → Ажилтан» түүнийг ашигладаг.
«Тайлан → Ажилтан»-ы «Явцын бичлэгүүд» карт (`EmployeeActivityCard`) ч засварын мөрүүдийг (`repairs`) өдрөөрөө нийлүүлнэ
(2026-09-28 — 0348-аас хойш ZA хувиар биш «Ажилласан»-аар явдаг тул эс бөгөөс тэр ажил огт харагдахгүй байв): hours-log
сонголттой `?from=&to=` (YYYY-MM-DD, гурван эх сурвалжид, тааз 1000) авдаг болсон; клиент ч цонхоор дахин шүүнэ (хуучин
worker параметрийг үл тоодог). Төслийн бус ажил тэнд ОРОХГҮЙ — тусдаа `NonProjectHoursCard`. Excel экспорт засварыг
хараахан агуулаагүй. Тест: `routes/profilesHoursLog.test.ts` (4).

### Өдрийн ажлын тайлан — Профайл → «Өдрийн тайлан» (migration 0345, 2026-09-24)

Админ (= «Менежмент» баг; 2026-09-24-нд хэмжсэн: 9 админ бүгд MGMT) өдөрт хийсэн ажлаа 1. 2. 3. гэж бичнэ, насан туршид
хадгалагдаж сарын эцэст нотолгоо болно. `routes/dailyWorkLogs.ts` (`/api/daily-work-logs`, `requireRole('admin')`),
`lib/dailyWorkLog.ts` (цэвэр, 7 тест) + `routes/dailyWorkLogs.test.ts` (бодит SQLite, 6), frontend
`features/daily-log/` (`/app/profile?tab=worklog`, lazy). Эзний 3 шийдвэр (⚠️ 1-р нь 2026-10-07-нд ӨӨРЧЛӨГДСӨН — доорх «Менежментийн багийн тайлан»): **ЗӨВХӨН өөрөө харна** (бүх зам `user.sub`-аар,
өөр хүний id авах параметр ЗОРИУД байхгүй — админ ч, захирал ч бусдынхыг харахгүй) · **өнгөрсөн өдрийг засаж/нөхөж болно,
түүх үлдэнэ** (`daily_work_log_revisions` append-only; `first_written_on` > `log_date` ⇒ «…-нд нөхөж бичсэн»; ирээдүйн өдөр 400;
устгах зам БАЙХГҮЙ) · **зөвхөн дэлгэц** (экспортгүй). `items_json` = дугааргүй мөрүүд; «1.», «2)», «-» угтварыг сервер ХАСНА
(`stripLeadingMark` ↔ frontend `daily-log/lib.ts` ИХЭР — dirty шалгалт үүнээс хамаарна). `DELETE /api/users/:id` хоёр хүснэгтийг
гараар цэвэрлэнэ. MCP хэрэгсэл байхгүй. Шалгасан: headless-Chrome E2E scratch D1 дээр (Enter-ийн автомат дугаар, Ctrl+S,
түүх, нөхөж бичих, 390px, өөр админ 0 мөр). **DEPLOYED 2026-09-24**: D1 0345 (өмнөх bookmark `000001b0-00002772-000050f0-6901bfdcf030e6b17016790db42d5cc2`), worker `a0015688`, Pages `bf229d39` (872d731e; `/api/daily-work-logs` нь `lib/modules.ts`-д `core`).

**Календарь + GitHub маягийн идэвхийн тор (2026-10-07, миграцгүй, DEPLOYED — main `9f2b98a6`, worker `dce22c3f`, Pages `56639074` `index-BQlXDvrc.js`).** Урт сарын жагсаалтыг сольсон: дээр нь 4 тоо (энэ
7 хоног / сар — ажил + «бичсэн/ажлын өдөр», сүүлийн 1 жил, нийт) + 53 долоо хоногийн heatmap (нүд = өдөр, өнгө = тухайн өдрийн
ДУГААРЛАСАН мөрийн тоо, олон бол тод; дарах/сум+Enter → тэр өдөр), доор нь календарь («7 хоног» өгөгдмөл — ажлыг шууд харуулна,
нарийн үед өдөрт ≤ 3 мөр + «+N ажил», `@[44rem]`-ээс 7 багана бүх ажилтай; «Сар» — 7×N тор, тоолуур) ба засварлагч хажууд
(`@container` `@[52rem]`; нарийн үед засварлагч ДЭЭР).  1440×900 дээр бүх хэсэг гүйлгэлтгүй багтана (хэмжсэн 839px).  Backend:
`GET /api/daily-work-logs?from=&to=` (≤ 62 өдөр, сарын хил давна; `?month=` хэвээр) ба `GET /activity?from=&to=` (≤ 400 өдөр, зөвхөн
`{date,count}`, бичвэргүй; `json_valid`-аар эвдэрсэн мөр 0; `/:date`-ээс ДЭЭР).  Өнгөний шатлал `lib.ts heatScale` (бичсэн өдрийн 90-р
перцентиль, доод тал 4 → 1·2·3·4+; heatmap ба календарь ИЖИЛ `HEAT_BG`).  Тест: `routes/dailyWorkLogs.test.ts` (+2), `npm run
check:daily-log` (8, `verify`-д); headless-Chrome 11/11 scratch D1 дээр (dark/dim/light, 1440/1920/390).

**Менежментийн багийн тайлан + өөрийн нэгтгэл + hover (2026-10-07, миграцгүй, DEPLOYED — main `22af96f6`, worker `1ea0fba8`, Pages `a89ff520` `index-DrNUsiiz.js`).** Эзэн: зөвхөн CEO болон admin «Тайлан» хуудасны
ХАМГИЙН СҮҮЛИЙН таб «Менежментийн багийн тайлан»-аас (`/app/reports?tab=mgmt[&mu=<id>]`) багийн БҮХ гишүүний өдрийн тайланг нэгтгэж
харна — дээрх «зөвхөн өөрөө» дүрэм `/api/daily-work-logs`-д ХЭВЭЭР (тэр router өөр хүний id авахгүй), харин уншилт нь ТУСДАА
`routes/managementLogs.ts` = `/api/reports/management-logs` (`reports.ts`-ийн `requireAdmin` + өөрийн `requireAdmin`; бичих зам
БАЙХГҮЙ).  `GET /` (`window`/`anchor` — хуудасны толгойн цонх, `all` = анхны тайлангаас): гишүүд = идэвхтэй `admin` + `is_support=0`
(TV бүртгэл орохгүй) ∪ тухайн мужид бичсэн хэн ч (идэвхгүй ч); гишүүн тутам бичсэн өдөр, ажил, хамрах хувь (хүлээгдэх = Да–Ба −
баяр, `max(муж, 2026-09-24, бүртгэгдсэн өдөр)`-өөс — `lib/managementLogs.ts`, цэвэр, 3 тест), нөхөж бичсэн; өдөр бүрийн тоо, муж
≤ 62 өдөр бол бичвэртэй (`MATRIX_ITEMS_MAX_DAYS`).  `GET /:userId` = нэг гишүүний мужийн бүх ажил + сүүлийн 371 өдрийн heatmap
(admin биш, тайлангүй хүн 404).  UI `features/reports/components/{ManagementLogsTab,ManagementMemberView}.tsx`: KPI, «Хэн хэзээ
бичсэн» матриц (мөр = гишүүн, нүд = өдөр, > 62 өдөрт Даваагаас эхлэх долоо хоног — `lib/mgmtMatrix.ts`), багийн нэгтгэл (хэн юу
хийсэн), гишүүний нэгтгэл.  Профайлд «Нэгтгэл» харагдац (календарийн 3 дахь сэлгүүр; Энэ 7 хоног / Энэ сар / Өмнөх сар / 3 сар / 1 жил
— жагсаалтын муж `MAX_RANGE_DAYS` 62 → 400).  **Hover**: heatmap, сарын нүд, матрицын нүд дээр тэр өдрийн ажил хөвөгч картаар
(`DayHoverCard` + `useDayHover` — нүд бүрт listener БИШ, эцгийн `mousemove` + `[data-date]`; portal — `backdrop-blur` нь fixed-ийн
containing block); профайлын heatmap `/activity?items=1`-ээр бичвэр авна.  Нэгтгэлийн жагсаалт ГАНЦ компонент `LogDigest` (профайл +
тайлан).  Тест: `lib/managementLogs.test.ts` 3, `routes/managementLogs.test.ts` 4 (бодит `reports` mount, senior/engineer 403),
`check:daily-log` 12; headless-Chrome 17/17 scratch D1 (hover, нэгтгэл, матриц, `?mu=`, `window=all` долоо хоног, 390px).

⚠️ **Доорх «Command Center» хуудас 2026-10-08-нд «Багийн тэмдэглэлийн дэвтэр»-ээр СОЛИГДСОН** (хурдан бичлэг, график, «Сүүлийн ажлууд», нэгтгэл тэндээс хасагдсан — доорх хоёр дахь хэсгийг үз; `MgmtQuickCapture` нь баруун доод тэмдэглэлд л үлдсэн).

**Command Center + «Өнөөдөр юу хийв?» (2026-10-07, миграцгүй, DEPLOYED — main `95493c0c`, worker `5a663164`, Pages `cc67e4b3` `index-nyBGhIAb.js`).**  Менежментийн таб дээрээс: толгой (зөөлөн гэрэл) →
**хурдан бичлэг** (`components/mgmt/MgmtQuickCapture.tsx`) → KPI (`AnimatedNumber`) → идэвхийн график (recharts, матрицтай ИЖИЛ
өдөр/долоо хоног хуваалт) → «Сүүлийн ажлууд» (өдрөөр бүлэглэсэн урсгал, нэр → `?mu=`) → матриц → нэгтгэл.  Хурдан бичлэг нь ШИНЭ
хадгалалт БИШ — нэмэх, ✏️ засах, 🗑 устгах, «Буцаах» (сая нэмсэнийг, 8 с) бүгд НЭГ `ReplaceOp` (`lib/mgmtFeed.ts applyReplace`):
`GET /daily-work-logs/:date`-аар ШИНЭ жагсаалтыг уншаад тэр дээр хэрэгжүүлж ижил `PUT` (түүх/`edit_count`/нөхөж бичсэн хэвээр; профайлтай
ИЖИЛ query key); байрлал нь зөвлөмж — бичвэрээр нь дахин хайна, олдохгүй бол 409 (өөр газраас засагдсаныг дарахгүй).  Өдрийн СҮҮЛИЙН
мөрийг устгахгүй (сервер `EMPTY`).  Үйлдлүүд дараалсан, optimistic (дэлгэц = хадгалсан + хүлээгдэж буй op); алдаа гарвал тэр op л хасагдаж
өдрийг дахин уншина, нэмэлтийн бичвэр оролтод буцна; дараалал хоосроход л `/daily-work-logs` ба `/reports/management-logs` кэшийг сэргээнэ.
«Өнөөдөр» = `lib/useUbToday.ts` (минут тутам + таб руу буцахад), op бүр үүссэн агшныхаа огноог авна — шөнө дунд давсан хуудас өчигдрийн
тайланд бичихгүй.  Толгой нь `overflow-clip` (БИШ `overflow-hidden` — тэр нь `scrollIntoView`-д дотроо гүйлгэгдэж агуулгыг тайрдаг).  Backend-ийн ганц өөрчлөлт:
`GET /api/reports/management-logs` `days[].updated_at` (урсгалын цаг).  Урт мужид (> 62 өдөр, бичвэргүй) урсгал `7d`-ээс.  Цэвэр туслах
`reports/lib/mgmtFeed.ts` (`check:daily-log` 16).  Гишүүн рүү/буцах нь `AnimatePresence` + гүйлгэлтийн байрлал сэргээнэ.  Шалгасан:
бодит router-ууд node:sqlite дээр + headless-Chrome 38/38 (optimistic 7 мс, дараалал, revision, rollback, засах/Esc/устгах/буцаах, `?mu=`, `window=all`, 390px,
reduced-motion).

**Баруун доод булангийн тэмдэглэл — «Өнөөдөр юу хийв?» (2026-10-08, миграцгүй, DEPLOYED — main `3af90a5e`, Pages `2e9612ca` `index-B4tYWvhd.js`; worker хөндөгдөөгүй `5a663164`).**  Эзэн: менежментийн баг тайлангийн табыг хайлгүйгээр
системийн АЛЬ Ч хуудаснаас хийсэн ажлаа бичнэ.  `features/daily-log/DailyLogNote.tsx` (`LayoutShell`-д ГАНЦ удаа; зөвхөн `admin` + `is_support=0` —
лобби TV орохгүй; `/app/tv` Layout-аас гадуур) — баруун доод буланд дугуй товч (өнөөдрийн ажлын тоо), дарахад / Alt+N цонх нээгдэнэ (Esc хаана,
нээлттэй төлөв localStorage `mgl:daily-note:open`, хуудас солиход хэвээр).  Цонх (`DailyLogNotePanel.tsx`, lazy chunk) = ИЖИЛ `MgmtQuickCapture`
`variant="note"` (жагсаалт дээр гүйлгэгдэнэ, оролт доор, шууд фокус) → Enter бүр өнөөдрийн тайланд 1. 2. 3. гэж дугаарлагдан нэмэгдэнэ; засах/устгах/
буцаах, түүх бүгд дээрхтэй ижил.  Утсан дээр доод навигацийн дээгүүр, «Апп суулгах» баннер (`InstallPrompt` `data-install-prompt`) харагдвал түүний
дээгүүр (`body:has()`).  Шалгасан: бодит router-ууд node:sqlite + headless-Chrome 14/14 (профайл хуудаснаас, дугаарлалт = сервер, тоолуур, Esc, Alt+N,
хуудас шилжих, reload, 390px).

**КАЛЕНДАРЬ — «Менежментийн багийн тайлан» таб (2026-10-08, зөвхөн frontend, миграцгүй, DEPLOYED — main `b71eee27`, Pages `0a30bd40` `index-DSSy4eKR.js`).**  Эзэн: «өчигдөр, өнөөдөр гэх мэт олон бичвэрийн дундаас тухайн хүний өдрийн тайланг олох нь замбараагүй, бусдынхтай холилдоно — календарь хэлбэртэй болго».  Доорх дэвтэр (`MgmtTeamJournal/MgmtJournal/MgmtDayRail/MgmtPeopleStrip`, `lib/mgmtMatrix.ts`, урсгалын туслахууд) УСТСАН.  `components/mgmt/MgmtCalendar.tsx`: «7 хоног» = мөр нь ХҮН, багана нь Да…Ня (Бя/Ня нарийн), нүдэнд тэр хүний тэр өдрийн ажил (3 мөр + «+N»); «Сар» = сарын календарь — бүгд бол өдөр бүр бичсэн хүмүүсийн аватар (утсанд тоо), нэг хүн сонгосон бол түүний ажил; нүд дарахад `MgmtDayDialog` (тэр хүний / тэр өдрийн хүн бүрийн бүтэн тайлан, ◀ ▶ бичлэгтэй өмнөх/дараах өдөр, «Жилийн идэвх» → `?mu=`).  URL `?cv=week|month&cd=&who=`; хайлт нүдийг тодруулж бусдыг бүдгэрүүлнэ.  Өөрийн навигацтай тул хуудасны толгойн хугацааны сонголт энэ табд (гишүүний хуудаснаас бусад үед) НУУГДАНА (`ReportsPage`).  Серверээс: долоо хоногт `14d` (anchor = min(Ням, өнөөдөр) ⇒ Даваа багтана), сард `month` — хоёулаа ≤ 62 өдөр тул бичвэртэй; backend хөндөгдөөгүй.  Цэвэр дүрэм `lib/mgmtCalendar.ts` (`check:daily-log` 15).  Хувь/хоцролт/«бичээгүй»/цаг ЗОРИУД байхгүй (доорх «Тайван» хэсэг хүчинтэй).  Шалгасан: бодит router-ууд node:sqlite + headless-Chrome 21/21 (7 хоног/сар, нүд → цонх, ◀ ▶, хүнээр шүүх, хайлт, 390px).  **Нягт нүд + ерөнхий тоо (2026-10-08, DEPLOYED — main `222025bc`, Pages `fe089f03` `index-epgLVQkl.js`; эзэн: «нэр бүтэн харагдахгүй, хэдэн ажил хийсэн ерөнхий мэдээлэл үлдээ, олон ажилтай хүний урт бичвэрийг эвтэйхэн болго»):** нэрийн багана 13rem, нэр `line-clamp-2` (таслахгүй); мөрийн толгойд «N ажил · M өдөр», баганын толгойд «N хүн · M ажил», хэрэгслийн мөрөнд «N хүн · M ажил тэмдэглэсэн» (`calTotals` — ТОО л, хувь биш); нүд = том тоо «4 ажил» + эхний 2 ажил (`line-clamp-2`, хайлттай үед тохирсон нь эхэнд) + «+N бусад», бүх нүд ижил өндөр; hover → `DayHoverCard` (бүтэн жагсаалт), дарвал цонх; сарын нүдэнд өдрийн ажлын тоо.  Бя/Ня багана 0.5fr, толгой босоо.  **Тойрог 3 (2026-10-08, эзэн; DEPLOYED — main `55a91dd3`, Pages `55400c0d` `index-BpvYoAUe.js`):** Захирал (`is_ceo`, id 2 — тайлан уншигч) жагсаалт/нийлбэрээс хасагдсан (зөвхөн энэ календарь, frontend шүүлт); «Бүх хүн» dropdown ХАСАГДСАН — хүн сонгох = мөрийн нэр (эсвэл сарын цонхонд нэр) дарах, сонгосон үед толгойд «← Бүгдийг харах» товч + тэр хүний нэр/албан тушаал + том «N ажил · M өдөр»; бүгд үед том «N хүн · M ажил тэмдэглэсэн» (text-3xl); хуудасны «Ажилтан, багийн гүйцэтгэлийн тайлан…» тайлбар энэ табд НУУГДАНА (`ReportsPage`).

**Багийн тэмдэглэлийн дэвтэр — тайлангийн «Менежментийн багийн тайлан» таб (2026-10-08, зөвхөн frontend, миграцгүй, DEPLOYED — main `13f33beb`, Pages `de630973` `index-IXWWfAoK.js`; worker хөндөгдөөгүй).**  Эзэн: хуудас хэт олон текст, юу хийдэг нь ойлгогдохгүй — «баг юу хийв» гэдгийг уншихад хялбар, жигд ажилладаг ГАНЦ хуудас.  (Кино маягийн тоглуулагч туршаад эзэн ТАТГАЛЗСАН — бүү буцааж нэм.)  `ManagementLogsTab.tsx` = зөвхөн гишүүний хуудас руу/буцах шилжилт; багийн харагдац `components/mgmt/MgmtTeamJournal.tsx`: (1) нэг мөрт хураангуй (бичсэн хүн/нийт · ажил · хамралт, `AnimatedNumber`) + хайлт (`/` товч, Esc, тодруулга) + «Миний ажил нэмэх» (`daily-log/dailyNoteEvents.ts` `openDailyNote()` → баруун доод тэмдэглэл нээгдэнэ; давхар маягт ЗОРИУД байхгүй); (2) хүмүүсийн мөр (`MgmtPeopleStrip` — өнөөдөр бичсэн ногоон цэг, бичээгүй тасархай хүрээ; дарвал `?who=<id>` шүүлт, «Жилийн идэвх» → `?mu=`); (3) дэвтэр (`MgmtJournal` — өдөр бүр наалддаг толгой, хүн бүрийн карт дугаартай ажилтай, >6 ажил хураагдана, бичээгүй хүмүүс хэсгийн доор); (4) хажуугийн самбар (`MgmtDayRail`, `@[60rem]`-ээс sticky — өдрийн ажлын тууз дарвал тэр өдөр рүү гүйлгэнэ, «Хэн хэзээ бичсэн» цэг дарвал тэр хүн + өдөр, hover = `DayHoverCard`).  Цэвэр загвар `reports/lib/mgmtJournal.ts` (`buildJournal`, `filterJournal`, `highlightParts`, `todayStatus`; амралтын хоосон өдөр, `since`-ээс өмнөх өдөр орохгүй; `check:daily-log` 18).  > 62 өдрийн мужид бичвэр ирдэггүй тул дэвтэр сүүлийн 14 хоногоос («сүүлийн 14 хоног» тэмдэглэлтэй).  `MgmtActivityChart`/`MgmtActivityFeed` устсан.  Шалгасан: бодит router-ууд node:sqlite + headless-Chrome 23/23 (шүүлт, хайлт, тууз → өдөр, sticky, тэмдэглэл нэмэх, цайвар, урт муж, 390px, reduced-motion), `npm run verify` ногоон.  **Тайван болгосон (2026-10-08, DEPLOYED — main `d83c8374`, Pages `b31b758c` `index-CfAq1UrT.js`; эзэн: «менежментийн багт хувь, хугацаа гэх мэт зүйл хэрэггүй — юу хийснээ л тэмдэглэнэ»):** хураангуйн тоо/хувь/хамралт, хүмүүсийн мөрийн тоо ба «бичсэн/бичээгүй» төлөв, «Хүлээгдэж байна / Бичээгүй» жагсаалт, картын бичсэн цаг, «нөхөж бичсэн» тэмдэг, «Хэн хэзээ бичсэн» тор, гишүүний хуудасны KPI (хамралт %, хоцорсон өдөр) ХАСАГДСАН; профайлын «Өдрийн тайлан»-д «N/M ажлын өдөр» → «N өдөр», «нөхөж бичсэн» тэмдэг (засварлагч, нэгтгэл, hover) хасагдсан.  Өгөгдөл, түүх (`late`, revisions) хэвээр — зөвхөн дэлгэц.  `mgmtJournal.ts`-оос `missing`/`late`/`todayStatus` устсан.  Эдгээрийг БҮҮ буцааж нэм.

### Багийн профайл — «Бүтээмж» таб (migration 0346, 2026-09-24)

Эзний хүсэлт: Багууд хуудаснаас баг дээр дарахад (картын нэр / TeamPanel-ийн «Багийн профайл нээх») `/app/teams/:id` нь
«хувь хүний профайл шиг» — эхний таб **«Бүтээмж»** (⚠️ 2026-09-30-аас өгөгдмөл таб «Өнөөдөр», доорх «Багийн хуудасны дахин дизайн»-ыг үз): хугацаа (Өдөр / 7 хоног = Даваа–Ням / хуанлийн сар, ◀ ▶, URL
`?tab=productivity&period=&date=`), «ажлаа хийсэн %», «төсөлд орсон», «зохиогчийн хяналтаар явсан», ирц, багийн өдрийн дундаж;
гишүүн бүрийн **өдрийн дундаж бүтээмж** + шилдгийн % + «шугамд хүрэхэд +X%/өдөр» + 12 хугацааны чиг; түүхийн график; төсөл, ЗХ.
Дүрэм бүгд **`lib/teamProductivity.ts`** (цэвэр, 24 тест), D1 уншилт `lib/teamProductivityStore.ts`, замууд
`routes/teamProductivity.ts` (`/api/teams`-ийн ХОЁР ДАХЬ mount), frontend `features/teams/productivity/` (lazy chunk).

- **Өдрийн дундаж** = хугацааны `user_points` (бүх source) ÷ ажиллах ёстой өдөр (ажлын өдөр − батлагдсан бүтэн өдрийн чөлөө,
  `users.created_at`-аас). Чөлөөг ХУВААРЬНААС хасна (`leaveAvailability.ts`-ийн `workingDates`/`leaveDatesByUser` — reach-back биш:
  хуанлийн хугацаанд өмнөх сарын өдөр холилдохгүй); чөлөөт өдөр оноо авсан бол энгийн ажлын өдөр. ⚠️ Тайлан/самбарын НИЙЛБЭРТЭЙ
  шууд тэнцүү биш (тэд reach-back). Гишүүн = үндсэн баг нь энэ, идэвхтэй, `is_support=0`, самбарт ордог роль. Гишүүнчлэлийн түүх байхгүй.
- **Зөрүү** = (дээд − доод) ÷ дээд (харьцангуй — өдрийн дундаж ~0.01–0.3% тул «20 пункт» утгагүй); `round1`-ийн ДАРАА `> босго`.
  Шугам = дээд × (1 − босго/100). Босго = `app_settings['team_productivity.gap_threshold_pct']` (анхдагч 20, `PUT
  /api/teams/productivity/settings`, admin). Прод 2026-09-24 (30 хоног): 2+ хүнтэй 6 багийн 5 нь 69–100% — зөвхөн IZ багтсан.
- **Эрх (эзний шийдвэр)**: admin бүх баг + анхааруулга/босго; `teams.lead_user_id` (идэвхтэй senior) өөрийн баг; ахлахгүй багт
  тухайн баг ҮНДСЭН баг нь болох senior-ууд — `createNotificationForReviewers`-ийн ижил олонлог. Бусад 403. Frontend
  (`TeamDetailPage` `canSeeProductivity`) зөвхөн UX. ⚠️ Прод дээр 2026-09-24-нд НЭГ Ч багт ахлах тохируулаагүй.
- **Анхааруулга** `POST /:id/productivity/warnings` (admin): тоог СЕРВЕР дахин бодно, хүлээн авагч ⊆ ахлах/багийн senior,
  `team_productivity_warnings` (0346, snapshot, append-only, хэрэглэгч рүү FK-гүй) + `team_gap_warning` мэдэгдэл (push `approvals`,
  UI `feedback`), бие нь « · »-оор (мэдэгдлийн UI мөр таслал хадгалдаггүй). Хүснэгтгүй (миграц тавиагүй) бол түүх хоосон, илгээлт 500.
- «Төсөлд орсон» = ирцийн сонголт ∪ таскийн бодит ажлын мөр ∪ төсөл дээрх засвар; засварын төсөл тусад нь (`-repair_projects.id`).
  ⚠️ ЗХ, төслийн бус батлагдаагүй ажил бүтээмж өгдөггүй — ЗХ-д олон явдаг хүн доогуур харагдана (BB 2026-09: 7 ЗХ, 0.01%/өдөр).
- **⚠️ «Эрэмбэ» таб 2026-09-28-нд эзний хүсэлтээр ХАСАГДСАН** — `/app/teams` бүгдэд «Багаар» табаар нээгдэнэ, хуучин
  `?tab=leaderboard` холбоос тэр рүү буудаг; `features/teams/leaderboard/` + `teamsBoard.*` i18n устсан. Backend endpoint доорх
  хэвээр, одоо frontend-д дуудагчгүй. Хуучин тайлбар:
  **Багуудын «Эрэмбэ» таб (2026-09-25, миграцгүй)** — `/app/teams?tab=leaderboard`, admin + senior-т өгөгдмөл таб: хэдэн баг,
  бүх багийн нийт хувь (Σ оноо), компанийн дундаж, багуудыг ӨДРИЙН ДУНДАЖААР (нийлбэр биш — том баг үргэлж түрүүлэх тул;
  «Нийт хувиар» сэлгүүр бий) эрэмбэлсэн жагсаалт + шилдэг 3 + 6 хугацааны чиг; мөр дарвал `/app/teams/:id?tab=productivity`.
  `GET /api/teams/productivity/leaderboard?period=&date=` (`requireManager`; хоёр сегменттэй тул үндсэн router-ийн `/:id`-д
  баригдахгүй) → `lib/teamLeaderboardStore.ts` (5 асуулга, баг тутамд дуудлагагүй), дүрэм `lib/teamLeaderboard.ts` (цэвэр, 4 тест) нь
  `memberAverage`/`computeGap`-ийг ДАХИН ашиглана — багийн дундаж `loadTeamProductivity`-ийн `summary.team_avg`-тэй ижил томьёо
  (ажлын өдөргүй гишүүний оноо нийлбэрт орно, дундажид үгүй). Frontend `features/teams/leaderboard/` (lazy). Хувь хүний тоо буцаахгүй.
- Шалгасан 2026-09-24 prod-copy D1 (өнөөдрийн export + 0341–0346): API 42/42, headless-Chrome 30/30, 390px. **Deployed 2026-09-25** (`d5cacd28`, worker `6668872e`; «Эрэмбэ» таб нь release `ac0e34eb`-д);
  `leaveAvailability.ts` (өөр агентын commit хийгээгүй WIP)-оос хамаарна — хамт эсвэл дараа нь commit хийнэ.
- **Багийн хуудасны дахин дизайн (2026-09-30, зөвхөн frontend, миграцгүй, DEPLOYED — доор).** ⚠️ **ТАБТАЙ загвар нь ДАРАГДСАН — доорх «нэг дэлгэцийн самбар»-ыг үз; `TeamProfileHero/TodayBoard/TeamMembersPanel/TeamProjectsPanel` УСТСАН.** `/app/teams/:id` (`TeamDetailPage`,
  `TeamDetailRoute` wrapper-ийн дотор): **табууд Өнөөдөр · Бүтээмж · Төслүүд · Гишүүд, ӨГӨГДМӨЛ = «Өнөөдөр»** (өмнө нь
  «Өнөөдөр хэн аль төсөлд» самбар табын ДЭЭР байнга харагдаж ~870px эзэлдэг, admin/ахлахын өгөгдмөл нь «Бүтээмж» байв; `?tab=productivity`
  мэдэгдлийн холбоос хэвээр, эрхгүй хүнд «Өнөөдөр» руу буудаг).  **Тоолол ГАНЦ газар — `features/teams/lib/teamView.ts`
  `buildTodayBoard`** (ирцийн сонголт ∪ засварын цаг ∪ төслийн бус ажил): hero-ийн «N/M өнөөдөр», «Өнөөдөр» табын тоо, самбар,
  гишүүдийн «Ажиллаж буй / Чөлөөтэй» шүүлт бүгд үүнээс — урьд нь hero «8», самбар «10/12» гэж зөрдөг байв; шинэ өөр тоолол бүү нэм.
  Файлууд: `components/{TeamProfileHero,TodayBoard,TeamMembersPanel,TeamProjectsPanel,TeamPeopleBits}.tsx`.  Hero = тууз БИШ, багийн
  өнгөөр (`teamHex`) зөөлөн гэрэлтэй толгой + hairline KPI (гишүүд · идэвхтэй төсөл · ажлын задаргаа дууссан/явагдаж буй/эхлээгүй/хоцорсон ·
  дундаж явц).  «Үндсэн» шошго бүх гишүүнд давтагддаг байсан тул хасагдаж, зөвхөн ХОЁРДОГЧ багийн гишүүнд «Хоёрдогч баг» гарна;
  админы үйлдэл (лидер болгох / хасах) ⋯ цэсэнд.  ⚠️ Sticky табын мөр `-top-4 lg:-top-7` — Layout-ийн `<main>` padding-тай (`p-4 lg:p-7`) ЯГ
  таарах ёстой (sticky нь padding-ийн доороос наалддаг тул үгүй бол дээгүүр нь картууд цухуйна); <sm дээр таб бүрийн дүрс/тоо нуугдаж 4 таб
  гүйлгэлтгүй багтана.  `TeamDetailPage.tsx` өөр агентын хаалттай зэрэг засагдаж байсан (хоёр удаа бүтнээр нь дарагдсан) — эрхийн
  шалгалтыг ТҮҮНД БИШ `TeamDetailRoute.tsx` wrapper-т тавь.  Шалгасан: mock API + headless-Chrome (1440/820/390px, гэрэл/харанхуй,
  admin ба architect), `npm run verify` ногоон.
  **DEPLOYED 2026-09-30 — нэг release-д дөрвөн урсгал (commit `a22d2d2b`…`ab61760c`, цэвэр worktree-ээс):** ЗХ гэрээний дугаар +
  багаар бүлэглэсэн жагсаалт + төрлөөр шүүх (`a22d2d2b`), Тайлан «Таскийн цаг» таб (`206e9ad8`), Багууд хэсгийн эрх
  (`dac6999a`), энэ дизайн (`737dae3b`); D1 0365 (өмнөх bookmark `0000020c-000002d4-000050f6-2ac4323209514cd0db05c3fdd7e12bd4`),
  worker `5e17620d` (100%), Pages `5b3a2398` (`index-CupQYJ3J.js`).  Backend `npm test` 2196/2199 — уналт нь өмнөх 3
  (миграцын дугаар давхардал, 0214/0245 statement тоо, `templateNote`), энэ release-тэй холбоогүй.
- **Багийн хуудас = НЭГ ДЭЛГЭЦИЙН САМБАР (2026-09-30, өдрийн хоёр дахь дизайн, зөвхөн frontend, миграцгүй, DEPLOYED `d3d2f1c4` — release `9fb53249`, worker `5eba3966`, Pages `49f07e6e`).**
  Эзний гомдол: «доош гүйлгэж мэдээлэл харна, хэн аль төсөл дээр ажиллаж байгааг харуулдаг — гүйлгэлтгүй, хайлтгүй бүх мэдээллээ шууд
  харъя».  Хэмжсэн: өмнөх хуудас 1440×900 дээр 1200px, hero ~300px + 4 таб.  Одоо **ТАБГҮЙ**, `/app/teams/:id` нь `Layout`-ийн full-bleed
  (`isFullBleed`-д `/^\/app\/teams\/\d+$/`) — хуудас өөрөө өндрөө хуваарилж (`flex-1 min-h-0`), 1440×900 дээр 19 гишүүн + 8 төсөл + төслийн бус
  ажил + архив + сүүлийн явц бүгд ГҮЙЛГЭЛТГҮЙ багтана; жижиг дэлгэц / олон мөр бол ЗӨВХӨН панел ӨӨРИЙН дотор гүйлгэгдэнэ, <lg дээр хуудас
  өөрөө гүйлгэгдэнэ.  Бүтэц: `TeamDetailPage.tsx` (өгөгдөл, харагдац, admin үйлдэл) → `components/board/`: **`TeamHeaderBar`** (нэг мөрт: баг ·
  баталгаажуулагч · ажиллаж буй/нийт · төсөл · ажлын задаргаа+хоцролт · дундаж явц; харагдац сэлгүүр нэрийн доор), **`ProjectsToday`** (ТӨСӨЛ
  БҮР НЭГ МӨР: явц, ажил x/y, хоцролт, ойрын хугацаа │ өнөөдөр тэр дээр хэн ажиллаж байна; хүнгүй төсөл ч мөрөө хадгална — «хөдөлгөөнгүй»
  бүлэгт; засварын төсөл ⚙, төслийн бус ажил ℹ; админд архив), **`TeamRoster`** (НЭГ мөр = НЭГ хүн: presence цэг, орсон төслүүдийн өнгөт цэг,
  дууссан/нийт; Бүгд/Ажиллаж буй/Чөлөөтэй шүүлт; ⋯ цэс = лидер болгох/хасах), **`RecentProgress`** (доод туузан, 4 бичлэг; <820px өндөр дэлгэцэд
  нуугдана).  **Харилцан онцлол** (`boardFocus.ts`): хүн дээр хулгана/фокус → тэр хүнгүй төслийн мөрүүд бүдгэрнэ, төслийн мөр дээр → тэр төслийн
  бус хүмүүс жагсаалтад бүдгэрнэ.  Загвар ЦЭВЭР — `lib/teamBoard.ts` `buildTeamBoard` (`buildTodayBoard`-ийн тооллогыг дахин ашиглана, ГАНЦ
  тооллого; `working ⇔ rowKeys.length > 0`), `npm run check:team-board` (14, `verify`-д).  «Бүтээмж» = табын оронд харагдацын сэлгүүр
  (`?view=productivity`, хуучин `?tab=productivity` мэдэгдлийн холбоос хэвээр; эрхгүй хүнд URL-ээр ч нээгдэхгүй).  Responsive нь viewport БИШ
  **container query** (`@container` + `@[34rem]:`…) — sidebar-тай үед өргөн нь viewport-оос ~256px бага тул `md:/xl:` буруу хэмждэг.
  ⚠️ `AddTeamMembersDialog` тусдаа файл болсон (`components/`), хуучин `TeamDetailPage`-ээс НЭГ БАЙТ өөрчлөгдөөгүй шилжсэн (3 түүхий `<button>` —
  `lint:tokens`-ийн мэдэгдэж буй, тэр чигээрээ).  Шалгасан: prod-хуулбар D1 + бодит өнөөдрийн seed (17 ирцийн сонголт, 2 төслийн бус, 1 засвар),
  headless-Chrome 1440×900 / 1920×1000 / 1280×720 / 1024×768 / 390×844, харанхуй+гэрэл, admin · engineer · олон багтай architect · багтай биш,
  интерактив 31 шалгалт (онцлол, шүүлт, dialog, ⋯ цэс, сэлгүүр, эрхийн хаалт).

### Төслийн дуусах хугацааны СУНГАЛТ + түүх (migration 0337, 2026-09-21)

`project_passport.finish_date` нь ХЭВЭЭР «одоо хүчинтэй дуусах хугацаа» — `lib/projectRisk.ts` (хугацаа хэтэрсэн), Timeline, `projectCharts`, `company.ts`, ticker, MCP, захиалагчийн PDF гэх мэт тэр баганыг уншдаг ~30 газар ЮУ Ч ӨӨРЧЛӨГДӨӨГҮЙ: сунгасан даруйд шинэ хугацааг бүгд автоматаар авна. Түүх нь **`project_deadline_changes`** (append-only): `kind='extension'` (шинэ огноо + шалтгаан + `approved_by_kind` захиалагч/захирал/бусад + нэр/зөвшөөрсөн огноо/лавлах № — `seq` = хэд дэх сунгалт) ба `kind='correction'` («Хуваарь» цонх / паспортын 1.3-аар зассан, батлагчгүй, сунгалтын тоонд ОРОХГҮЙ; `from_date NULL` = анх тогтоосон). Анхны хугацаа = эхний сунгалтын `from_date` (тусдаа багана БАЙХГҮЙ). Дүрэм бүгд **`lib/deadlineExtensions.ts`** (цэвэр, 20 тест, миграцын SQL `node:sqlite` дээр); routes **`routes/projectDeadline.ts`** = `/api/deadlines`-ийн ХОЁР ДАХЬ mount: `GET /project/:id/extensions` (staff), `POST` (`requireManager` — admin + senior, паспорт засах эрхтэй ижил олонлог), `DELETE /:changeId` (admin, ЗӨВХӨН төслийн хамгийн сүүлийн мөр ба `finish_date` хөндөгдөөгүй үед — 409 `NOT_LATEST`/`STALE`). Сунгалт нь `finish_date` + `extension_date` баганыг шинэчилж, 1.3 хүснэгтэд `tl-finish` := шинэ (багана ↔ мөрийн инвариант ХЭВЭЭР — эс бөгөөс дараагийн паспорт хадгалалт сунгалтыг буцаана), сунгалт бүр өөрийн `tl-ext*` мөртэй (жишиг баримтын хэлбэр), `project_reminders`-ийг цэвэрлэж, хариуцагч руу `project_deadline` мэдэгдэл явуулна. **⚠️ ХОЙШЛУУЛАХ = СУНГАЛТ:** `PUT /api/timeline/projects/:id/schedule` ба `PUT /api/projects/:id/passport` нь тогтоосон хугацааг ХОЙШ зөөхөд 409 `EXTENSION_REQUIRED` буцаана (`isLaterThan`, чөлөөт `2026.07.09` хэлбэрийг ч уншина); schedule нь `change_kind:'correction'` тугтай бол зөвшөөрч correction гэж бүртгэнэ (буруу бичсэн огноог залруулах зам — `ScheduleDialog` хойшлуулсан огноо дээр «Сунгалт болгож бүртгэх / Зөвхөн засвар» гэж асууна); урагшлуулах, хоослох, анх тогтоох нь хэвийн, мөн correction гэж үлдэнэ. `loadTimelineProjects` нь `extension_count` + `original_finish_date` буцаана (мөрөнд «сунгасан ×N» тэмдэг). Frontend: `features/deadlines/{ExtensionDialog,DeadlineHistoryCard}.tsx` — төслийн «Хугацаа» таб + Timeline самбарт. `DELETE /api/projects/:id` хүснэгтийг гараар устгана (D1 FK). Шалгасан 2026-09-21 scratch D1 дээр: API 49/49 + headless-Chrome UI 42/42; **deploy ХИЙГЭЭГҮЙ**.

### Шинэ төсөл үүсгэх цонх — код, баримтын холбоо, 1.2 өгөгдмөл (2026-09-28, migration 0354)

`ProjectsPage.tsx`-ийн үүсгэх цонх (зөвхөн frontend; паспортын API хөндөгдөөгүй). Эзний хүсэлт: «нэр, шифрийг нэг удаа бичээд
Word баримт дээр дахин бичихгүй». **Код** (`MGL-yymmdd`) өгөгдмөлөөр өнөөдрийн огноо, дарж засаж болно (`newCodeOverride`,
`lib/projectName.ts cleanProjectCode`). **Баримтын «Project title» = суурь нэр, «Drawing No. (шифр)» = код** — `null` = холбоотой,
бичих бүрт дагана; баримт дээр тусад нь засвал зөвхөн тэр нүд салж (`newFullTitle`/`newDrawingNo` нь утга), ТӨСЛИЙН НЭР/КОДЫГ
ХЭЗЭЭ Ч өөрчлөхгүй (бодит паспортуудад гарчиг нь урт албан нэр, шифр нь «MEC-25/21» — нэрнээс ялгаатай); дээрхтэй ижил болговол
өөрөө дахин холбогдоно; нэрийн доорх чип «дахин холбох». Тиймээс шинэ төсөл бүр `drawing_no` = кодтой төрнө. 1.2-ын файлын нэр
нь бусад нүд засагдсан ч нэр/эхлэх огноог дагана — гараар бичсэн мөр л хөлдөнө (`scopeFileManual`). Паспортын гарчиг
«1. Төслийн мэдээлэл / Project Information» (`PassportDocumentEditor` `ReportTextContext` — гүйцэтгэлийн тайлан хуучнаараа).
Миграц 0354 бөглөөгүй бүх төсөлд 1.2-ын 11 өгөгдмөл мөр (файлын нэргүй) бичсэн — prod дээр 31/31. E2E 28/28 (scratch D1).

### Ангиллын ЗАГВАР төсөл — шинэ төсөл бүтцээ автоматаар авна (migration 0392, 2026-10-06, DEPLOYED — main `e2c95769`, D1 0392 (өмнөх bookmark `00000250-000003b6-000050fc-10eb7f536d0d8d19d89c61956f8adf8c`), worker `02320cc9`, Pages `a60998de` `index-BkJoRv6E.js`)

Эзэн: «Төсөл 75 (EZ) — дараагийн эскиз төсөл үүсгэхэд 75-ын бүтэц, ажлын хуваарилалт автоматаар». `app_settings`
`project_template.<АНГИЛАЛ>` = төслийн id (0392 нь `EZ → 75`-ыг `INSERT OR IGNORE`).  Загвар = ЖИНХЭНЭ төсөл, snapshot БИШ —
75-ын бүтцийг засвал дараагийн шинэ EZ шинэ хэлбэрийг авна.  Дүрэм ГАНЦ газар **`lib/categoryTemplates.ts`** (5 тест, бодит 0392):
`POST /api/projects` ангилалд загвар байвал түүний багийн хувь → блок → зураг → бүрэлдэхүүн → ажил, ЖИН ЯГ ХЭВЭЭР хуулна
(category-ийн өгөгдмөл ростерын ОРОНД — EZ дээр BA50/EZ50 биш 75-ынх EZ 100).  Хуулагдахгүй: хариуцагч, огноо, явц, хуваарилалт,
`source_project_id` холбоос (загвар ≠ барилгын lineage).  Алгасна: `use_template: false` (үүсгэх цонхны чагт), `source_project_id`
сонгосон (ZA «Бүтэц татах»), ил `team_shares`.  Загвар хүчингүй: төсөл устсан, ангилал нь өөрчлөгдсөн, `asr_only`; архивласан нь
хүчинтэй.  Унавал өөрийн бичсэнээ буцааж өгөгдмөл ростер суулгана, төсөл 201 хэвээр (`template.applied:false`).  Хуулалт нь
`copy-structure`-тэй НЭГ төлөвлөгч + бичигч — `lib/structureCopyWrite.ts` (`loadCopySourceTree`, `insertPlannedStructure`,
`MAX_COPY_TASKS`; `routes/projects.ts`-ээс 2026-10-06-нд үг үсгээр зөөсөн).  Удирдах: `GET /api/projects/category-templates`,
`PUT /api/projects/:id/category-template {enabled}` (хоёулаа admin, `/:id`-ээс ДЭЭР); UI = үүсгэх цонхны «Загвар бүтэц» хайрцаг
(`features/projects/categoryTemplates.ts`) + төслийн «⋮» цэсний «EZ загвар болгох/хасах» + толгойн «EZ загвар» тэмдэг.
`DELETE /api/projects/:id` тохиргоог цэвэрлэнэ.  ⚠️ 75-ын ажлын жин нийлээд **100.5** («3D Харагдах байдал» 1, бүрэлдэхүүн нь 0.5) —
загвар ЯГ хуулдаг тул шинэ EZ төсөл 100.5% хүртэл уншина; 75-д засвал дагана.  Шалгасан: бодит router + prod-ын 75-ын мод
(тусгаарлагдсан SQLite) 16/16, mock-API headless-Chrome 9/9 + 390px.  Deploy дараалал: D1 0392 → worker → Pages.

### Undocumented-elsewhere subsystems (pointers)

Each of these is shipped and load-bearing. Read the named file before touching the area.

| Area | Entry points |
|---|---|
| **Assessments** (skills/behaviour) | `routes/assessments.ts`, **`lib/assessmentRoster.ts`**, `lib/assessment{Schema,Score}.ts`, `lib/behaviorScale.ts`, migrations 0139–0147 + **0182**, `docs/dev/assessments-spec.md`. `GET /my/results` deliberately returns **only level labels — no percentages**; that is a designed privacy boundary. **Roster rules (2026-08-19) live in ONE file, `lib/assessmentRoster.ts`** — `routes/users.ts` imports the same helpers so a hire/team-move/deactivation and a round's cohort can never disagree. Two constants are load-bearing there: `PARTICIPANT_ROLES` (`engineer\|architect\|senior` — **`admin` is an organizer, not a participant**; twins in `shared/lib/roles.ts` `ASSESSMENT_ROLES` and `PublishDialog.tsx` `CREATE_ROLES`) and `ACTIVE_PARTICIPANT_SQL` (an inactive user vanishes from every roster, report and counter — **read-side filtering, so no submitted answer is ever deleted and reactivating restores them**; change it and you must change `ROUND_SUMMARY_SQL`'s three counters in the same edit or the list count and the table rows desync). Enrollment is no longer a one-shot snapshot: `GET/POST /rounds/:id/candidates\|sync` and `POST/DELETE /rounds/:id/participants/:userId` back the admin **RosterPanel**, and `assessment_rounds` now persists the *whole* cohort spec (`team_codes` + `roles` + `user_ids` + `excluded_user_ids`) so a late hire can be back-filled. Rounds created before 0182 have all three NULL → `isCohortKnown` is false and sync deliberately does nothing. The legacy whole-list `PUT /rounds/:id/participants` still exists but **has never had a frontend caller** — prefer the per-person routes; it replaces the entire roster and silently drops inactive members. |
| **Зохиогчийн хяналт / ASR** | `routes/authorSupervision.ts`, `lib/asrNo.ts` (DASR-NNN since 2026-09-28 (was ASR-NNN; migration 0355 renamed every system-allocated number, legacy backfilled file numbers untouched); **since 2026-09-29 (0359) numbered per (project, first team) in REPORT-DATE order, `DASR-<TEAM>-NNN`, recomputed by `renumberAsrProject` on submit / date-or-team edit / delete / backfill import, and every ASR read is team-scoped via `lib/asrVisibility.ts`** — see «Зохиогчийн хяналт — багийн харагдац, багаар дугаарлалт, ЗХ-ийн нэр» below; twins `asrTemplate.ts` `ASR_ABBR` + `photoStamp.ts` `asrDocNoOf` + the PDF/Word file name `ymd_<project ID>_DASR_<team>_NNN` (Word template's own name shape; `asrFileStem` in `asrTemplate.ts` ↔ `lib/asrNo.ts`)). Access model is deliberately **stricter** than everything else (clients 403 everywhere) and its write gate deliberately **includes** `engineer` where team reports exclude them. **No status freeze for the author since 2026-09-30 (owner):** `PATCH /:id` and `ensureRecordingWrite` let the report's **author** edit their OWN report at ANY status (submitted/approved — text, photo add/replace, recordings; status and `reviewed_*` do not move), and an **admin** edits anyone's at any status (2026-08-28) — the owner's review flow is «see the submitted material → fix the date/text/photos → save → approve». Deployed 2026-09-30 (`5545e143`, worker `7c164409`, Pages `index-kNC43r-G.js`). The PATCH deliberately does NOT move `status`, so `approve`'s `AND status='submitted'` race guard still fires and `reviewed_by`/`reviewed_at` survive an edit of an approved row. `doc_no`/`seq`/`submitted_at` are unreachable from that whitelist (only `lib/asrNo.ts` writes them) — **keep `project_id`, `seq`, `doc_no` off it**. `AsrEditorShell.tsx` mirrors the rule and adds one UI-only extra: an admin editing SOMEONE ELSE's approved report needs an explicit «Засварлах» unlock click (the author's own report is editable as soon as the «Засварлах» tab is opened; notices `asr.authorEditNotice*`). Two knock-on facts: editing `teams` on a submitted row rewrites who `canReview` lets approve (a senior who got the notification then 403s), and the visits panel's counts/dates become retroactively mutable. **Улаан дэвтэр (migration 0279, 2026-09-10)** is a second, independent lifecycle on the same row: `red_book_photo_url` + `red_book_verified_by/at`, status **derived** in `shapeRow` (`missing → signed → verified`; never store it). The photo goes through `PATCH /:id/red-book`, deliberately **outside** the author's status freeze — the signature is usually collected after the report was submitted — and is locked only once verified (409; revoke via `DELETE /:id/red-book/verify`). Verification = `canReview`, needs a photo, refuses drafts. **Since 2026-09-30 (migration 0366, owner) a SITE report (`report_type='site'`) cannot be submitted OR approved without the red book photo — unless the author ticks «Талбай дээр улаан дэвтэр байгаагүй» (`red_book_absent = 1`)**; other types and the PDF are never blocked. Rules in ONE file `lib/asrRedBook.ts` (derived status `missing | absent | signed | verified`, `redBookProblem`, `redBookClearProblem`, `RED_BOOK_OK_SQL` in the approve UPDATE; 5 tests) ↔ frontend twin `types.ts` `redBookStatusOf`/`redBookGap`; only the report's own red book counts (companions stay optional), a photo is enough (verify stays optional). The checkbox goes through `PATCH /:id/red-book/absent {absent}` (same gate/any-status path as the photo, 409 when verified or a photo exists); attaching a photo clears the flag; on a submitted/approved site report the red book can never be emptied again (photo delete / un-tick → 409 `RED_BOOK_REQUIRED`, replace is fine). Existing approved reports without a photo were left as they were; prod had 18 submitted site reports with no photo on 2026-09-30 — they now need a photo or the tick before approval. **The photo and the checkbox work on a NEW, unsaved report too** (2026-09-30, `8bab6284`, Pages `c0067fb7`): clicking either first creates the report through the shell's `ensureSaved` (the same silent `save` path `doSubmit` uses), then writes the red book, then `onCreated`; and a report created from the editor now **stays in «Засварлах»** (`/app/asr` navigates with `&edit=1`, the project tab passes `initialMode`) — before, the first save threw the user into «Баримт», where the red book block does not exist, which is why the owner could not find the checkbox. The missing-list line under the editor has a «Улаан дэвтэр ↓» link (works from «Баримт» too). The print block at the bottom of `AsrDocument.tsx` always shows the status (incl. «Талбай дээр улаан дэвтэр байгаагүй»). **DEPLOYED 2026-09-30** (`d9e97375`: D1 0366 — bookmark before `0000020c-000008be-000050f6-f46e8881c0d89eb35729cf2674ee2cc9`, worker `b87f04dc`, Pages `33ee9074` `index-CGaFLW7M.js`). **Print/PDF (2026-09-23 — ЭЗНИЙ ЖИШЭЭ БАРИМТЫН хэлбэр):** `AsrDocument.tsx` + `asrPrintStyles.ts` reproduce the owner's own paper form («01. Жишээ тайлан.pdf», MEC-25/07 ЛЮКСВҮҮД УУРХАЙЧИН-3): ~~a plain grey title line as the running header~~ — **since 2026-09-28 the running header is the Word template's own header** (`header1.xml`): «Design Author’s Supervision Report» (bold) / «Report Date: 2026/09/25» / «Doc. No.: <project ID>_DASR_<first team>_<NNN>» (project ID = the `MGL-yymmdd` code at the start of `projects.name`, `asrProjectId` twins in `asrProjectName.ts` front+back — owner 2026-09-28: NOT the шифр) on the left, the grey MGL E&C logo on the right, a full-width rule below — all values automatic via `asrTemplate.ts` `asrHeaderDocNo` (shared with the Word export; a backfilled legacy report prints its own file number), mirrored in the doc-mode editor (`AsrDocKit` `DocLogo`), then **black-bordered blocks** — one compact form table — **since 2026-09-28 the Word template's own 12-column grid** (`GRID_COLS` + the template gridSpans: Төслийн нэр|Он сар өдөр → project-info rows → Шифр | Гэрээний дугаар (0363) → Тайлбар beside «Бичиг баримтын төрөл», both spanning 2 rows, with 3×2 checkbox cells → «Хяналтаар явсан» 7 cells, teams without a cell (АУ …) appended to the last one in print AND Word → Шалгасан|Баталсан; navy 8pt labels without English sub-labels, 8.5pt values, 7.5pt checkbox cells because «Ажлын зураг» wraps at 8pt in the ≈20 mm cell; no «Тайлангийн №» row — the number is the header Doc. No.; the doc-mode editor mirrors the order with `sm:row-span-2`) — CSS-drawn checkboxes instead of ☐/☒ glyphs, which fell back to another font on Cloudflare's Chromium, the «АЖЛЫН ТАЙЛАН» navy band + team checkbox strip + one italic body box, then the signature table (the logo that sat to its right moved to the header on 2026-09-28 — logo appears ONCE), the red-book row and finally the photo sheets. **The company stamp is gone from «Баталсан» (owner, 2026-09-23)** — an ASR is an internal document, so an approved report is evidenced by the approver's NAME; `stamp_url` is still returned by the backend (`ceo.stamp_url`) and is simply not rendered, in the print page and in the DOCX alike. The 2026-09-16 performance-report styling — numbered «1. / 2. / 3.» section titles, one table per section, navy sub-bands, the logo in the header — is **gone**; don't reintroduce it without re-reading the 2026-09-23 comment at the top of `AsrDocument.tsx`. **Three owner decisions that day:** (1) the example's SECOND block — «Зохиогчийн хяналтыг … гүйцэтгэлээ» + «Хяналт гүйцэтгэх үеийн ажлын явц:» + «Attachment» — is deleted outright, and `work_report` (whose text is exactly that narrative) moved **inside** the work-report box as its first paragraph, so no field was lost; (2) the example's LAST page («Хавсралт» — typical reinforcement details) is **not** part of the generated report; (3) the 4-photos-per-page + per-photo caption feature stays. Four things the example lacks but the owner kept: the red book, the previous-report resolutions, the project-information rows (now **merged into the one form table** by `pairInfoRows` — short values paired two per row, long ones full width — not a separate «1. Төслийн мэдээлэл» table; **«Албан ёсны нэр» and «Байршил» were removed from the ASR document on 2026-09-28** (and **«Ажлын хэсэг» on 2026-09-30**, `a6a0a8ac`, Pages `a2a25c7c` — the «Хяналтаар явсан» row already says which teams went) — `asrInfoRows` no longer emits them, so print, editor and Word all drop them, and the Word header lost its passport-title line), and the report № in the header. `useFitToPage` is **gone** — blocks flow naturally and the work-report box has a 52 mm `min-height`. **Since 2026-09-28 there is NO page footer or header band at all** (owner: no page number, no logo in the footer, no browser date/URL): `@page` margin is **0** and the paper margins live inside the page — top = the repeated `<thead>` cell's print `padding-top`, bottom = a repeated `<tfoot>` spacer cell (`.asr-footcell`), sides = `.asr-paper` print padding, all from `ASR_PAGE_MARGIN_MM`. With no margin area Chrome has nowhere to draw its own date / URL / «1/2» on browser print (verified with headless print WITH default headers on). The server PDF (`GET /:id/pdf`) passes `displayHeaderFooter: false` and `margin` 0 — any non-zero value there would double the margins. The Word template geometry (`GRID_COLS`, `ROW_H`) survives only for the DOCX export. **Word export is client-side: `buildAsrDocx.ts` fills the real template `frontend/public/asr-template.docx`** (a copy of the root `YYMMDD_PROJECT ID_ASR_BA_001.docx`) with `fflate` — string-level OOXML on the template's 15-row table, Wingdings `F06F/F0FE` checkboxes, images added to `word/media` + rels — not the `html-to-docx` route the performance report uses, which loses gridSpan/vMerge/shading. File names mirror the server's PDF rule via `asrFileStem()`. **2026-09-23 — the same three decisions were applied to Word**, since the template IS the example form: template rows **6 (the narrative cell) and 7 («Attachment») are dropped** at assembly time (rows 5 and 8 are blank spacer rows and stay — they are the gap between the form and the «Ажлын тайлан» block); the project-information rows are no longer a separate table above the form but **rows inserted after row 0**, built by `formRow`/`formInfoRows` (the twin of the print page's `pairInfoRows`; **`FULL_WIDTH_INFO` exists in both files and must move together**); and the photos left the table for **their own pages after the red book** — `PAGE_BREAK` + a «Төслийн нэр … (Зураг n–m / N)» header table + 2×2 images with a stamp line and a caption line each. ⚠️ `formRow` writes its `tcPr` **explicitly** rather than cloning the template cell: the first row's cells carry the thick (`sz=12`) *top* border, and cloning it puts a heavy rule through the middle of the table. Every row's `gridSpan` sum must stay **12** (1 + 6 + 1 + 4 paired, 1 + 11 full width) or Word calls the table corrupt. Verified 2026-09-23 by building the real .docx in-browser through Vite and checking XML balance, per-row gridSpan sums, unique rIds and that every `r:embed` is declared; Word itself last opened the output on 2026-09-11. **Ажлын тайлангийн бүтэц + зургийн тайлбар + өмнөх тайлангийн шийдэл (migration 0336, 2026-09-21):** `photos_json` мөр бүр `caption` авна (≤500, миграцгүй); `author_supervision_reports` дээр `work_report` / `site_tasks` / `defects` (тайлангийн түвшний «Ажлын тайлан», «Талбай дээр өгсөн үүрэг даалгавар», «Илэрсэн алдаа, дутагдал» — багийн `work_note` ХЭВЭЭР, доор нь); `asr_issue_resolutions` = «Өмнөх тайлангийн асуудлыг бид ингэж шийдсэн» — ОДООГИЙН тайлан дээрх мөр (`prev_report_id` ON DELETE SET NULL + `prev_doc_no`/`prev_report_date` цооног, `issue_text` нь өмнөх тайлангийн `defects`-ээс урьдчилан бөглөгдсөн засаж болох цооног). **Өмнөх тайлан ХЭЗЭЭ Ч хөндөгдөхгүй**; түүний дэлгэрэнгүй/баримт дээр `resolved_in` (`loadResolvedIn`, зөвхөн submitted/approved шийдэл) гэсэн ГАРГАН АВСАН «Шийдсэн: ASR-00N · огноо» мөр гарна. `GET /projects/:id/issues` = холбох сонголт (ноорог орохгүй). `replaceResolutions` нь ижил төслийн ноорог биш тайлан л холбоно — буруу id-тай мөрийн холбоос NULL болно, текст нь үлдэнэ; `DELETE /:id` шийдлийн мөрөө гараар устгаж, өөрийг нь иш татсан мөрүүдийн `prev_report_id`-г NULL болгоно. Илгээх биетийн шалгалт (`hasBody`, сервер ↔ `AsrEditorShell.missingOf`) одоо `work_report|site_tasks|defects`-ийг ч тоолно. **Баримт (`AsrDocument.tsx`): зураг нь хавсралт болж ХАМГИЙН СҮҮЛД, хуудас тус бүрд ЯГ 4 (2×2, `chunkPhotos`, `.asr-photo-sheet` `break-before: page`), зураг бүрийн доор дугаар + тайлбар** — текстийн дунд байрлуулбал 4 зургийн хуудас өмнөх хуудасны талыг хоосон үлдээдэг байсан тул гарын үсгийн ДАРАА. (2026-09-23-аас дэд хэсгүүд нь «3.1/3.2/3.3» дугаартай хар-хөх хайрцаг БИШ, нэг хүрээтэй бие дотор тод-налуу мөр — жишээ баримтын «Хяналтаар гарсан шийдвэрлэх асуудлууд:» хэлбэр.  ⚠️ ХЭЛБЭР нь жишээнийх, НЭР нь 0336-гийнх: дэд хэсгүүд «Илэрсэн алдаа, дутагдал» гэх мэт эзний өгсөн нэрээ хэвээр хадгална — цаасан дээрх нэр засварлагчийн талбарын нэрээс зөрвөл инженер андуурна.) Word (`buildAsrDocx.ts`) ижил: зураг нь ТУСДАА хуудсанд, 2 зураг/мөр + тайлбарын мөр, дэд хэсгүүд бичих талбайн нүдэнд. UI: `AsrWorkReportSection.tsx` (үргэлж харагдана — урьд нь баг сонгоогүй бол «Ажлын тайлан» огт гардаггүй байв); **2026-09-28-наас засварлагчийн «Ажлын тайлан» блокт ЗӨВХӨН 3 асуулт** (үүрэг даалгавар · алдаа дутагдал · өмнөх тайлангийн шийдэл) — ерөнхий `work_report` бичвэр ба багийн `work_note` талбар хасагдсан (эзний хүсэлт), гэхдээ багана/API/хэвлэлт/`hasBody` ХЭВЭЭР, текст нь аль хэдийн бичигдсэн хуучин тайланд л талбар харагдана; дуу бичлэгийн «багийн тэмдэглэл рүү оруулах» чип ч хасагдсан, `AsrDocPhotos` тайлбарын талбар. **Нээхэд «Баримт» горим — A4 хуудсаар (2026-09-28, эзний хүсэлт):** хадгалагдсан тайлан нээхэд `AsrEditorShell` засварлагч биш хэвлэх баримтыг (`AsrPagedDocument`) харуулна, дээд талд «Баримт | Засварлах» сэлгүүр («Засварлах» = доорх засварлагч; засах эрхгүйд «Дэлгэрэнгүй»); буцахад хүлээгдэж буй засварыг ЭХЛЭЭД PATCH-ална, баримт нь PATCH-ийн хариунаас. Шинэ (хадгалаагүй) тайлан, сэргээх локал ноорог, `?edit=1` (хэвлэх хуудасны «Засварлах») шууд засварлагчаар. Хэвлэх хуудас мөн A4 хуудсаар + «Засварлах». Хуудаслалтыг JS БОДДОГГҮЙ — браузерын хуваах хөдөлгүүр: нэг баганатай multicol + `column-height` + `column-wrap: wrap` (Chrome ≥145; дэмждэггүйд хуучин урт цаас), бүгд `@media screen` дотор — print/серверийн PDF хөндөгдөөгүй. multicol нь `<thead>`-ийг давтдаггүй тул толгой (`AsrRunningHeader`) хуудасны карт бүрт тусад нь, агуулгын өндөр = 297 − 14 − толгой − 20 (хэвлэлттэй ЯГ ижил). Хэмжсэн: 5/2/1 хуудастай тайлан дээр дэлгэцийн хуудас бүрийн текст `printToPDF`-ийнхтэй тэмдэгт бүрээр ижил. ⚠️ Апп дотор `ASR_DOC_SCREEN_STYLES` (глобал `@page`/`body *` дүрэмгүй), хэвлэх хуудсанд л `ASR_DOC_STYLES`. **Засварлагч = БАРИМТ горим (2026-09-25, эзний хүсэлт):** `AsrEditor.tsx` нь хэвлэх баримттай ижил хүснэгт (`AsrDocKit.tsx`: хар хүрээ, хар-хөх шошго, нүдэн дээр шууд бичих, 640px-ээс доош 1 багана болж эвхэгдэнэ; семантик токен — харанхуй горимд ч токентой дэд компонентууд зөв), хуучин маягт горим + `AsrPhotoGrid` УСТСАН; зургийн хуудас 2×2 нүд (`AsrDocPhotos.tsx`) — хоосон нүд дээр дарахад (утсанд) Камер/Зургийн сан, зураг ЯГ тэр нүдэнд; зэрэг байршуулалт дарааллаа хадгална (`flush` эхний дуусаагүй зураг хүртэл). Зургийн тэмдэг (`photoStamp.ts`) = зургийн БАРУУН ДООД буланд «он.сар.өдөр цаг:мин:СЕК» + ТӨСЛИЙН НЭР (шифр · ASR-№ биш); `taken_at` нь `YYYY-MM-DDTHH:mm:ss` (секунд сонголттой — backend `TAKEN_AT_RE`, frontend `normalizeTakenAt` хоёулаа хуучин `HH:mm`-ийг авна; backend deploy хийгдээгүй бол секундтэй утга NULL болж тэмдэг тайлангийн огноо руу унана). Хэвлэлтэд тэмдэг `.asr-photo-frame` дотор — хайрцгийн саарал зайд биш, зураг дээр. Шалгасан 2026-09-21 scratch D1 дээр: API 36/36, headless-Chrome засварлагч+хэвлэх+PDF (6 зураг → 4 хуудас, 3-рт 4 зураг, 4-рт 2) + Word XML well-formed; deploy ХИЙГЭЭГҮЙ. **Хяналтын хуваарь (migration 0331, 2026-09-21):** `asr_visit_plans` + `asr_visit_plan_members` — admin/senior (`requireManager`) урьдчилан төлөвлөнө (төсөл + огноо + сонголттой цаг + явах хүмүүс + тэмдэглэл); сонгогдсон хүн бүрд одоо байгаа мэдэгдлийн системээр `asr_visit_assigned` («9-р сарын 25-нд (Баасан) 10:00 цагт «X» төсөл дээр зохиогчийн хяналтаар явна · Байршил · Шифр · Хамт явах · Тэмдэглэл · Томилсон»), огноо/цаг/тэмдэглэл өөрчлөгдөхөд үлдсэн гишүүдэд дахин `asr_visit_assigned`, хасагдсан/цуцлагдсанд `asr_visit_cancelled` (push ангилал `tasks`, UI ангилал `asr`); үйлдэл хийсэн хүн өөртөө мэдэгдэл авахгүй. Routes `/api/author-supervision/plans*` in `lib/asrVisitPlanRoutes.ts` (registered ABOVE `/:id`, like `asrTargets.ts`); pure text/validation in `lib/asrVisitPlan.ts` (tested). **Тайланг ХӨНДӨХГҮЙ** — хуваарь бол тусдаа хүснэгт, тайлан руу FK байхгүй; цуцлалт нь soft (`status='cancelled'`, мөр үлдэнэ); `GET /plans` өгөгдмөл `from`=өнөөдөр (ирэх хуваарь л). Frontend: `features/asr/AsrPlansSection.tsx` (`/app/asr` тойм + төслийн workspace дээр), `AsrPlanDialog.tsx` (`?plan=<id>` deep link — мэдэгдлийн холбоос; инженерт зөвхөн харах). **`/app/asr` самбар (2026-09-21):** `routes/authorSupervisionStats.ts` — `GET /api/author-supervision/stats`, `/api/author-supervision` дээрх ХОЁР ДАХЬ mount, `index.ts`-д ҮНДСЭН router-ээс ӨМНӨ (тэр нь `/:id`-тэй тул `/stats`-ыг 400 өгнө). Бүх тоо ОДОО БАЙГАА баганаас: «очилт» = `submitted|approved` (`lib/asrStats.ts` `ASR_COUNTED_SQL`, visits-тэй ижил дүрэм, ноорог хэзээ ч тоологдохгүй); батлах хугацаа = `submitted_at→reviewed_at` дундаж (хоёулаа бөглөгдсөн батлагдсан мөр л); улаан дэвтэр/гарын үсэг/зураг бүрдэл; багаар (нэг очилт олон багийг хамрах тул нийлбэр > очилт); 12 сарын цуваа (`fillMonthSeries` хоосон сарыг 0-оор нөхнө); нэрлэсэн зохиогчид; сүүлийн 6 тайлан. Төслийн хүрээ = `/project-summaries`-ийн `is_pending` дүрэм; ноорогийн тоо үзэгчийнх. **ХАБЭА-н статистик ЗОРИУД алга** — системд осол/PPE хүснэгт байхгүй; `features/asr/AsrSafetyCard.tsx` нь СТАТИК сануулга (тоо биш), `lib/asrSafety.ts`-ийн танилцсан-баталгааны бичвэрээс тусдаа. UI: `features/asr/AsrOverview.tsx` (`shared/components/DashboardPanel.tsx` — Компани хуудасны `PANEL`/`SectionHead`/`KpiRollup`-ийн ерөнхий хувилбар; Компани хуудас өөрийн хуулбараа хэвээр хэрэглэнэ), `sec-asr-*` хэсгүүд `search/sections.ts`-д бүртгэлтэй. |
| **Reporting stack** | `routes/performanceReports.ts` (draft→issued, PDF/DOCX), `lib/clientReport*.ts` (WeasyPrint), `routes/reportTemplates.ts`, `project_team_reports` + the hardcoded per-discipline templates in `frontend/src/features/projects/team-reports/`. |
| **Gmail + correspondence** | `routes/email.ts`, `lib/emailSync.ts`, `lib/google/*`, `lib/crypto/secretBox.ts`, `lib/refNo.ts`. |
| **RFI/CR захиалагчийн гарын үсэг (migration 0335, 2026-09-21)** | `routes/correspondenceSignature.ts` (6 замыг `/api/correspondence`-д ХОЁР дахь `register…` дуудлагаар — `/aliases`-ийн ДАРАА, эс бөгөөс `GET /:id` түүнийг залгина), **`lib/correspondenceSignature.ts`** (цэвэр дүрэм, 13 тест), `lib/correspondencePdf.ts`, frontend `components/CorrespondenceSignDialog.tsx` + `CorrespondencePrintPage.tsx` (`/correspondence/:id/print`, ProtectedRoute-ийн ГАДНА). Эзний 3 шийдвэр: модуль = `correspondence_log`-ийн `doc_type IN (rfi, cr)` мөр (CRC салбар БИШ) · захиалагч ПОРТАЛД нэвтэрч зурна (имэйлийн токен-холбоос БИШ) · баримт = ШИНЭЭР үүсгэсэн RFI/CR PDF (ASR-ийн print → Browser Rendering жор), `attachment_url` дээр давхарлахгүй. Төлөв `sign_status`: `none → pending` (`POST /:id/signature-request`, canWrite; Gmail send-ийн `request_signature: true` мөн ижил `requestClientSignature()` + имэйлийн хөлд порталын заавар) `→ signed` (`POST /:id/sign`, **зөвхөн role=client** + `clientCanRead`; ажилтан захиалагчийн өмнөөс зурж ЧАДАХГҮЙ — 403). `signed` нь ЭЦСИЙН: `SIGNED_LOCKED_FIELDS` (subject/body/date/direction/from/to/cc/doc_type/ref_no/signature_url) PATCH → 409 админд ч, зөвхөн `attachment_url` чөлөөтэй; цуцлах 409; устгах зөвхөн admin. Гарын үсэг = canvas → PNG data URL → сервер PNG magic + ≤512 KB шалгаад **ХУВИЙН `MEETING_BUCKET` `client/signatures/…`** (нийтийн /media-д ХЭЗЭЭ Ч биш; `SignatureCapture`-ийг дахин ашиглаагүй нь тэр шалтгаан); унших `GET /:id/client-signature` (эрх шалгаад stream) эсвэл `GET /:id`-ийн `client_signature_data_url` (print хуудасны `<img>`-д). **PDF нь КЭШ**: `pdf_key`/`pdf_generated_at`, `pdfIsCurrent` (generated ≥ updated_at ба ≥ client_signed_at) хуучирсан бол `GET /:id/pdf` шууд дахин рендерлэнэ; хүсэлт/зурах/засвар дээр `dropPdf` + `waitUntil` prerender — зөвхөн ХУРД, зөв ажиллагааны нөхцөл биш. Print токен = ДУУДАГЧИЙН identity (захиалагч зурсан бол client токен) — тиймээс print хуудас `/app/*` дотор байж БОЛОХГҮЙ (client sandbox `/client` руу шидэнэ). `canRead` одоо захиалагчид `lib/clientAccess.clientCanRead` (эх сурвалж), `project_members` тусгал БИШ. Мэдэгдэл: `client_signature_requested` (захиалагч руу, `/client`), `client_signed` (хүсэлт тавьсан + зохиогч руу, `/app/projects/:id?tab=mail`); `client_events.kind = 'signature'`. Локалд BROWSER binding байхгүй тул PDF 500 — API 48 + headless-Chrome 25 шалгалт scratch D1 дээр ногоон (2026-09-21); бодит Browser Rendering прод дээр л шалгагдана. |
| **Google Calendar (two-way)** | `lib/googleCalendarSync.ts`, migration 0124. Loop prevention hinges on etag equality. |
| **Meetings → STT → AI → tasks** | `routes/meetings.ts`, `lib/speechmatics.ts`, `lib/meetingTranscription.ts`, `lib/meetingAnalysisAi.ts`, `lib/meetingTasks.ts`, `lib/meetingMeta.ts` (pure, tested). Action items become **weight-0** tasks under a synthetic block so they can't move the rollup — reuse this pattern for any new planning layer. Since 2026-09-21 (migration **0333**) a meeting has MANY projects (`meeting_projects`), a `kind` (`project` \| `company`), a recording attached AFTER creation (`POST /:id/audio`, browser `MediaRecorder` via `shared/hooks/useMediaRecorder.ts`) and a human-edited `final_text` — see «Хурлын тэмдэглэл» below. |
| **Web Push** | `lib/webPush.ts` (hand-rolled RFC 8291 on WebCrypto), `lib/pushSweep.ts`, migration 0132. `CATEGORY_OF` is `Record<NotificationType, …>` **on purpose** so a new notification type is a compile error. |
| **Timeline / deadline sweep** | `routes/timeline.ts`, `lib/projectRisk.ts`, `lib/deadlineSweep.ts`, migrations 0141/0143. Note `tasks.due_date`/`start_date` and the `project_reminders`/`project_nudges` tables already exist. |
| **OAuth 2.1 server** | `backend/src/oauth/authorize.ts` (Mongolian consent+login page, double-submit CSRF), `OAUTH_KV`, provider-implemented `/token` + `/register` (DCR, required by claude.ai). |
| **PGP** | `routes/pgp.ts` — **Хувь хүний хөгжлийн төлөвлөгөө** (Personal Growth Plan). No cryptography involved. |
| **Баримт бичиг (архив)** | `routes/document*.ts`, `lib/document*.ts`, migrations **0249–0251**, `frontend/src/features/projects/documents/`. **Since 2026-09-03 this module has NO link to `projects`.** Its unit is a `document_archives` row — one folder imported wholesale off the company file server — because the owner's instruction was «stop the Projects list auto-appearing on the Documents page; only import from the server». `document_folders.archive_id` and `documents.archive_id` replaced `project_id` outright (not the `repair_entries` XOR pattern — there is no second owner). The 0249–0251 rebuild `DROP`ped both tables through `migrations apply`, which is normally forbidden; it was safe **only** because production was measured at documents = 0, revisions = 0, comments = 0 and all 156 folders were auto-seeded `00–12` template rows holding no file. `seedProjectFolders` and the whole per-project template seed are **deleted**; `lib/projectDocTemplate.ts` keeps the code lists only. **Note `projects.id` and `document_archives.id` overlap** — `/app/documents/:archiveId` is an archive id, never a project id. |
| **Office файлыг харах + Google дээр засах** | `routes/documentOfficeRoutes.ts`, `lib/documentGoogle.ts`, `lib/officeDocs.ts` (↔ frontend twin `officeKind.ts`), `lib/google/driveClient.ts`, migration **0264**, `frontend/.../documents/DocPreviewDialog.tsx`. Owner's decision (2026-09-07): **in-page = READ-ONLY, editing = a NEW TAB on Google.** Embedding the Google editor is impossible for two independent reasons — Google's `/edit` refuses framing, and our own COEP `credentialless` loads cross-origin iframes **without cookies**, so the user reads as signed-out inside it (dropping COEP breaks the APS viewer + push SW). **.docx/.xlsx/.pptx are uploaded to Drive UNCONVERTED** (`nativeEdit` in `officeDocs.ts`) and edited in Google's Office mode — converting them made Google's importer shred Word TOC tab-stops/dot-leaders so justified lines sprayed words across the page (measured on a real report), and it capped save-back at Drive's 10 MB `files.export` limit; a native file round-trips through `alt=media` with **no size cap**. Only legacy formats (.doc/.xls/.rtf/.odt/.csv) still convert, and those come back with a modern extension. The PDF preview therefore needs a **throwaway converted copy** (`files.copy` → export → `files.delete` in a `finally`), cached in the PRIVATE `MEETING_BUCKET`, served through an authed route and shown via a `blob:` iframe — that preview export still obeys Google's 10 MB cap, so a render-heavy report degrades to a «open it in Google» message rather than an error (an HTTP-loaded PDF iframe does not render under our isolation — `AttachmentPreviews.tsx`); the edit button opens `docs.google.com/.../edit`. **R2 stays the source of truth** — Google holds a working copy that lands back in the archive on sync. **The Drive token comes from the existing Gmail OAuth connection, NOT a service account** — measured 2026-09-07, both `email_accounts` rows are `auth_type='oauth'`, so **domain-wide delegation has never been configured at this org**; a DWD-based design would have stayed permanently dark. Reusing the OAuth refresh token also sidesteps the 2022 "service accounts have no Drive quota" (`storageQuotaExceeded`) trap, since files are created in a real user's Drive. `drive.file` (app-created files only, non-restricted) was added to `GMAIL_SCOPES`; **a scope added later does not retroactively widen an already-issued refresh token**, so the one manual step is re-running «Gmail холбох» once for the mailbox — `isScopeError()` detects the 403 and says exactly that. `DOCS_DRIVE_SUBJECT` names which connected mailbox owns the copies (empty = first active one). **One editing session = ONE revision**: the first sync inserts a `document_revisions` row and later syncs UPDATE that same row (a fresh R2 key each time, old object deleted) — otherwise the 2-minute cron would mint dozens of revisions during one edit. The sweep rides the existing non-`* * * * *` cron branch (**no new cron expression** — a third one silently double-runs the mail/meeting/calendar/deadline quartet) and only pulls when Drive's `modifiedTime` is both newer than `drive_modified_at` **and** older than 5 minutes, so it never archives a half-typed sentence. ⚠️ `previewPdf` deliberately does **not** write `drive_modified_at` — that column is the sweep's only change signal, and moving it there would mean an employee's edit never reaches the archive. Drive's export API caps at **10 MB**; a bigger doc returns a 413 telling the user to download it from Drive by hand. |
| **Төслийн баримт бичиг — Google Drive** | `routes/projectDrive.ts` (5th mount on `/api/projects`), `lib/google/driveBrowse{,Core}.ts`, `lib/projectDrive.ts` + `lib/projectDriveAccess.ts`, migration **0278**, `frontend/src/features/projects/drive/`. The «Баримт бичиг» tab on the project page. **Drive is the source of truth** — nothing is copied; see «Төслийн баримт бичиг» below. Not the same thing as the `/app/documents` archive. |
| **Тайлан (admin)** | `routes/reports.ts` (`/api/reports`, бүх зам `requireAdmin`), `lib/employeeSnapshot.ts` (cron, УБ 02:00-д ӨЧИГДРИЙГ `employee_daily_snapshots`-д — ШИНЭ cron илэрхийлэлгүй), `lib/reportWindows.ts` + `lib/reportTrend.ts` (цэвэр, тесттэй), миграц **0310/0311**, `frontend/src/features/reports/`, `shared/components/EmployeePicker.tsx` + `shared/lib/search/rankUsers.ts` (UsersPage-ийн хайлт ч үүгээр). **Байр (rank) нь харьцангуй тул зөвхөн snapshot-д хадгалагдана**; цонхны нийлбэр `user_points`-оос LIVE (`recalc-all` түүхийг өөрчилсөн ч тайлан шинэ утга харуулна). «7 хоногийн өмнөх байр» snapshot байхгүй бол `[anchor−36, anchor−7]` мужаар live fallback. Хандлага = сүүлийн 7 хоног vs өмнөх 7 хоног, ±10 %, хоёулаа < 1 оноо → тогтвортой. `awarded_at` UTC → УБ хөрвүүлэлт `reportWindows.ts`-д ГАНЦ газарт (`orgConfig().timezone`, `+8` хатуу бичихгүй). `employee_hr` нь `users`-ээс ТУСДАА 1:1 хүснэгт (GET /api/users JOIN хийхгүй); гэрээний PDF **хувийн `MEETING_BUCKET` `hr/`** угтвар, зөвхөн `GET /employees/:id/contract-file/:kind` — **ХОЁР файл** (0320, 2026-09-16): `employment` = Хөдөлмөрийн гэрээ (`contract_file_*`), `nda` = Нууцлалын гэрээ (`nda_file_*`). **Ажилтны дэлгэрэнгүй БҮХЭЛДЭЭ толгойн цонхыг дагана** (2026-09-16): `series` нь цонхыг бүтнээр хамарч ≤90 өдөр → өдрөөр, ≤400 → 7 хоногоор, цаашид сараар нэгтгэгдэнэ (`granularity`, `expected` = нэгжийн ажлын өдөр); `all` цонхонд `window.from` = тухайн хүний бодит эхлэл (`employeeAllTimeFrom`: `users.created_at` ба анхны `progress_entries.date`, hired_at биш) ба `expected_days` тэр мужаар; `leaves` (цонхтой давхцсан бүх төлөв) ба `suggestions` (**зөвхөн `is_anonymous = 0`** — нууцалсан нь тайланд ХЭЗЭЭ Ч орохгүй) мөн тэнд; `/hr`-ын `leaves_ytd` устсан. Байрын улбар шар шугам графикаас ХАСАГДСАН (эзний хүсэлт). **Экспорт** — `lib/exportEmployeeReport.ts` хөтөч дээр exceljs-ээр 4 хуудастай, хэвлэхэд бэлэн .xlsx угсарна (PC нууц үг/утас ХЭЗЭЭ Ч орохгүй); «Google Sheets үүсгэх» нь `POST /employees/:id/export/google-sheet` → `driveUpload(convertTo: spreadsheet)` + `driveShare` (Gmail OAuth токен, `documentOfficeRoutes.ts`-ийн ижил алдааны зураглал — scope дутуу бол 503 «Gmail холбох»). `/profiles/:id/activity` тааз 200 → 1000. **«Засварын төслийн тайлан» таб (2026-09-18, `?tab=repair&rp=<key>`, `RepairProjectsTab.tsx`)**: зорилт = `r:<repair_projects.id>` (дотоод ажил) ЭСВЭЛ `p:<projects.id>` (жинхэнэ төсөл дээрх засвар — прод дээрх `repair_entries`-ийн бүх мөр ийм байсан тул эзэн «хүмүүс ямар төсөл дээр засвар хийснийг зүүн талд оруул» гэв); хоёр id давхцдаг тул composite key ЗААВАЛ. `GET /api/reports/repair-projects` (`rows` = ядаж нэг бүртгэлтэй зорилтууд, СҮҮЛИЙН бүртгэлээр буурах; жинхэнэ төсөл төлөвөөс үл хамааран; `idle` = бүртгэлгүй дотоод ажил — тэндээс л устгана), `/:key` (хэн хэзээ үүсгэсэн + хүн бүрийн нэр · Σ`computed_pct` · Σ`hours` · эзлэх хувь), `/:key/entries?before=<id>` (`id` буурах cursor, «Өмнөхийг татах»). CRUD зөвхөн дотоод ажилд, `routes/repair.ts`-ийн `/api/repair/projects*` хэвээр; жинхэнэ төсөл нь унших горим + «Төсөл нээх» холбоос |
| **Repair entries + repair projects** | `routes/repair.ts`, migrations 0114 + **0194**. Self-reported rework/extra-work *hours* awarding leaderboard points with no approval. A repair attaches to **exactly one** of `projects.id` or `repair_projects.id` — a DB `CHECK ((project_id IS NULL) <> (repair_project_id IS NULL))` on both `repair_entries` and `user_points`. See «Засварын төсөл» below. Not the same thing as a `ZA` project. |
| **Захиалагчийн портал** | `routes/clientPortal.ts` (`/api/client/*`), `routes/clientAdmin.ts` (`/api/client-admin/*`), `routes/clientFiles.ts`, `client/ClientRoom.ts` (DO), `lib/client{Access,Events,FileName,Invite,Scope}.ts`, migrations **0257–0262**, `frontend/src/features/client/`. See «Захиалагчийн портал» below. |
| Also live and undocumented | ticker, suggestions, holidays, out-of-office, status-starters, norm catalog, team drawing items, project chat (the client portal's primary backend), landing v2 block CMS, APS 3D viewing, Stirling PDF tools, `/api/ai/refine-mongolian`, `/api/speedtest`. |

### Төслийн байршил → Google Maps (2026-09-21, миграцгүй)

Хадгалалт ХЭВЭЭР: `projects.location` (чөлөөт хаяг, 0011) + `projects.latitude/longitude` (пин, 0038). Прод дээр
хэмжсэн 2026-09-21: 28 төслөөс 18 нь хаягтай, **2 нь л пинтэй**, холбоос хадгалсан мөр 0 — тиймээс «Google Maps дээр нээх»
нь гурван эх сурвалжаас НЭГ дүрмээр href гаргана: **пин → хаягийн бичвэр доторх Google Maps холбоос → хаягаар хайх**
(`frontend/src/shared/lib/mapsLink.ts`, `projectMapsHref`/`projectDirectionsHref`; `npm run check:maps-link` 25 сценари,
`verify`-д). Хэлбэр нь Google Maps URLs API (`google.com/maps/search/?api=1&query=lat,lng`, `dir/?api=1&destination=`) —
Android апп, iOS universal link, desktop вэб гурвуулаа нэг URL; `comgooglemaps://` схем ХЭРЭГЛЭХГҮЙ. UI: `OpenInGoogleMaps.tsx`
(Мэдээлэл таб «Маягт» харагдацын байршлын блок + `ProjectMap` toolbar + захиалагчийн портал HeroCard, `data-maps-kind`).
Хаягийн бичвэрт холбоос буулгасан бол `locationDisplayText` урт URL-ийг нуугаад «Google Maps холбоос» badge харуулна.

- **Пин ТАВИХ хоёр зам** (хоёулаа `lib/resolveMapsLink.ts` → нэг задлагч `parseMapsCoords`: `!3d!4d` > `?q=/query=/ll=/
  destination=` > `/@lat,lng` > `geo:` > «47.9, 106.9» бичвэр): `ProjectMap` засах горимын «Холбоос» цонх (`MapsLinkDialog.tsx`,
  draft → ердийн Save → `PUT /:id`), ба `ProjectEditDialog`-ийн хаягийн талбар — холбоос ШИНЭЭР орсон/солигдсон бол
  координатыг нь PUT-д хамт бичнэ (`mapsUrlChanged`; холбоос өөрчлөгдөөгүй бол пин хөндөгдөхгүй — `addressHint`-ийн амлалт).
- **Богино холбоос** (`maps.app.goo.gl`, `goo.gl`, `g.co`) → `GET /api/projects/maps-link/resolve?url=` (`requireManager`,
  `/:id`-ээс ДЭЭР; `lib/mapsLinkResolve.ts`, 13 тест): redirect-ийг ≤6 хоп дагаж эцсийн URL-ийг л буцаана — хоп бүр
  Google-ийн хостоос гадуур бол `NOT_MAPS_HOST` 400 (SSRF), бие ХЭЗЭЭ Ч уншихгүй, `consent.google.com/?continue=` тойрно.
- ⚠️ **Утасны НЭРТЭЙ газрын share нь координатгүй** (хэмжсэн: `maps.app.goo.gl/…` → `maps.google.com?q=<нэр>&ftid=0x…` →
  200 HTML). Тэр HTML-ийн `og:image` staticmap төв нь ХОТЫН ТӨВ (IP-ээр, хүсэлт бүрд өөр) — газрын байршил БИШ, туршаад
  ХАССАН; бодит координат зөвхөн `/maps/preview/place?pb=` дотоод protobuf-д — ашиглахгүй. Ийм холбоосонд цонх
  `no_coords` гэж ил хэлээд «нээгээд хаягийн мөрөөс `/@lat,lng` урт холбоосыг хуул» гэж заана; хэзээ ч таамаглахгүй.
- Захиалагчийн overview (`projectChat.ts`) одоо `p.latitude, p.longitude`-г ч буцаана (портал холбоос яг цэг рүү).
  Шалгасан 2026-09-21: headless-Chrome E2E 32/32 (пин/хаяг/хоосон, холбоосоор пин, богино холбоос бодит Google-ээр,
  засах цонх, 390px), scratch D1 дээр; deploy ХИЙГЭЭГҮЙ.

### Захиалагчийн портал (2026-09-07, migrations 0257–0262)

Захиалагч бидэн рүү **залгахгүйгээр** материалаа өөрөө татаж авах, өөрчлөлтийг
шууд харах, материалаа маягтаар илгээх гадаргуу.  Эзний дөрвөн шийдвэр:
байгууллага төвтэй эрх · илгээсэн материалыг ажилтан шалгаж баталгаажуулна ·
татах хүрээ = гүйцэтгэлийн тайлан + гаргасан зургийн багц + батлагдсан ASR ·
polling биш ЖИНХЭНЭ WebSocket.

- **Эрх нь БАЙГУУЛЛАГАД холбогдоно** (`client_orgs` → `client_contacts` →
  `project_client_access`).  ⚠️ `project_members` нь УСТААГҮЙ: түүн дээр 40 гаруй
  SQL join тогтдог (`PROJECT_LIST_SQL`-ийг байрлалаар нь bind хийдэг 4 дуудагч
  орно) тул `clientAdmin.ts`-ийн **`syncOrgMembership()`** эрхийг тэр хүснэгтэд
  **тусгадаг**.  Эх сурвалж нь шинэ хүснэгтүүд, `project_members` нь ТУСГАЛ.
  Хуучин, гараар нэмсэн 5 мөрийг (төсөл 30/51) хэзээ ч устгахгүй — зөвхөн тухайн
  байгууллагын `project_client_access`-д бүртгэлтэй төслийн мөрийг цэвэрлэнэ.
- **`lib/clientScope.ts` — `client` role-ийн ЦАГААН ЖАГСААЛТ**, `workerScope.ts`-ийн
  ижил хэлбэр.  Энэ нь өмнөх «route бүрт `role === 'client'` шалгалт нэмнэ»
  загварыг сольсон: тэр загвар нь шалгалт нэмэхээ мартсан бүх route-ыг чимээгүй
  нээдэг байсан (аюулгүй байдлын #3, #4).  **Шинэ route өгөгдмөлөөр ХААЛТТАЙ.**
  `/api/client-admin` нь сегментийн хилээр таардаг тул жагсаалтад ОРООГҮЙ.
- **Эрхийг JWT-д ХЭЗЭЭ Ч хийхгүй.**  `lib/clientAccess.ts` хүсэлт бүрт DB-ээс
  шийдэж, `officeAccess.ts`-тэй ижил 60 сек кэш барина — role-ийн 24 цагийн
  хоцролт эрхэд давтагдвал гэрээ цуцлагдсан компани маргааш хүртэл зураг татна.
- **Файл нь ХУВИЙН R2-д** (`MEETING_BUCKET`, `client/` угтвар).  `/media/:key` нь
  нэвтрэлтгүй нийтийн зам тул захиалагчийн гэрээ, гаргасан зураг тэнд байж
  БОЛОХГҮЙ.  Уншилт зөвхөн `/api/client-files/{submission|deliverable}/:id`.
  `upload.ts`-ийн `ownsKey` угтварыг таслаад л `<sub>-` шалгадаг болов.
- **Гаргасан зургийн багц (`project_deliverables`) нь ШИНЭ ойлголт** — `drawings`
  хүснэгтэд файл огт байдаггүй тул «захиалагч зургаа татна» гэдгийн татах юм нь
  системд байгаагүй.  `draft → issued → superseded`; ижил чиглэлийн өмнөх багц
  автоматаар `superseded` болно, УСТАХГҮЙ.
- **Харагдацын ганц дүрэм**: `client_publications`-д `unpublished_at IS NULL`
  мөр байх.  Ноорог багц, гараагүй тайланг эх сурвалж дээр нь хаадаг
  (`POST /publications` нь `status`-ыг шалгана) — UI-д итгэдэггүй.
  «Зарлал» (`notice`) нь эх мөргүй тул `ref_id`-г нэмэгдэх дугаараар өгнө;
  тогтмол 0 өгвөл `UNIQUE(project_id, kind, ref_id)` хоёр дахь зарлалаар
  эхнийхийг дардаг.
- **Файлын нэрийг СЕРВЕР үүсгэнэ** (`lib/clientFileName.ts`, 10 тесттэй).
  Захиалагчаас зөв нэрлэхийг шаардахгүй — маягтын утгуудаас
  `MGL-251222-DAALGAVAR-BA-20260907-001.pdf` болгож, анхны нэрийг
  `original_name`-д ҮЛДЭЭНЭ.  UI нь илгээхийн ӨМНӨ үр дүнг харуулна
  (`POST /client/preview-name`) — «нэрлэх заавар» гэсэн баримт хэрэггүй.
- **Realtime**: `ClientRoom` Durable Object (WebSocket Hibernation, DO tag **v6**),
  төсөл тус бүрд `idFromName('project:<id>')`.  ⚠️ Сокет бол зөвхөн ТЭЭВЭР —
  үнэн нь `client_events`; клиент холбогдох бүрд `since_id`-аар гүйцээж татна.
  Код нь устгасан `backend/src/chat/ChatRoom.ts` (git `1186c80^`)-оос сэргээгдсэн.
  `/api/client/ws` нь `authMiddleware`-ээс чөлөөлөгдсөн бөгөөд токеноо ӨӨРӨӨ
  шалгана (хөтчийн WebSocket API `Authorization` толгой явуулж чаддаггүй).
- **ASR-ийг нийтлэх нь PDF-ийг АГШИНД НЬ хадгална**
  (`POST /client-admin/projects/:id/publish-asr/:asrId`): `authorSupervision.ts`-ийн
  «client бүх endpoint дээр 403» гэсэн зориудын хилийг задлахгүйн тулд PDF-ийг
  нийтлэгч АДМИНЫ эрхээр өөрийн worker руу self-fetch хийж рендерлээд хувийн
  bucket-д тавьж, энгийн `deliverable` болгоно (`note = 'asr:<id>'`).
- **Урилга**: `POST /client-admin/orgs/:id/contacts` нь `client` хэрэглэгч үүсгээд
  нэг удаагийн KV токен (`lib/clientInvite.ts`, `OAUTH_KV`-ийн `client-invite:`
  угтвар) буцаана.  **2026-09-18-аас имэйлээр ч илгээнэ** (`send_email`, өгөгдмөл
  true; `POST /contacts/:userId/invite?send=1` мөн) — `lib/clientInviteMail.ts` нь
  `emailSend.ts`-ийн `sendViaGmail`-аар, хайрцаг = `app_settings.client_invite_account_id`
  эсвэл идэвхтэй хамгийн эртний `email_accounts` мөр (`driveClient.ts`-ийн дүрэм).
  ⚠️ Илгээлт ҮНДСЭН үйлдлийг хэзээ ч унагаахгүй: хариу `{invite_url, email_sent,
  email_error}` — унавал холбоос хэвээр, админ гараар явуулна.  Бичвэр нь цэвэр
  `clientInviteMailBody.ts` (тесттэй; `googleAuth.ts` type-stripping-д ачаалагддаггүй
  тул тусдаа файл).  Урилгын хоёр зам (`/api/auth/client/invite-info`,
  `/api/auth/client/accept`) `authMiddleware`-ийн нээлттэй жагсаалтад бий.
- `member_count` гурван газарт (`PROJECT_LIST_SQL`, `dashboard.ts`, `company.ts`)
  `u.role <> 'client'` шүүлт авав — эс тэгвэл захиалагчийн холбоо барих хүмүүс
  «гишүүд» гэсэн тоог хөөрөгдөнө.
- **Frontend-ийг 2026-09-23-нд эхнээс нь дахин зохиосон** (backend хөндөгдөөгүй).
  Архитектурын товчооны editorial хэв маяг: `font-display` (= Inter Tight, зөвхөн
  `/client*` дээр `useWebFont(INTER_TIGHT_HREF)`), 1px шугам, хурц өнцөг, зөвхөн
  семантик токен + `brand-copper` — `lint:tokens` цэвэр.  Бүтэц: `shell/` (толгой,
  дугаарласан навигаци, хөл) · `overview/` · `progress/` · `tabs/` · `components/primitives.tsx`
  · `lib/` (цэвэр туслах) · `hooks/`.  Төсөл ба хэсэг URL-д: `/client?project=37&tab=materials`
  (`CLIENT_TABS`; хуучин `?tab=report` → `materials`, тайлан одоо «Материал» хэсэгт).
  Тойм нь `/correspondence/projects/:id`-оос `sign_status='pending'` мөрүүдийг «Таны анхаарал»
  самбар + навигацын тоолуур болгоно; overview API унасан ч бусад хэсэг ажиллана.
  i18n нь `clientRoom.*` (хуучин `clientDashboardPage.*`/`clientPortal.*` устсан); тоотой
  бичвэрт `lib/labels.ts countLabel` (англид `…One` хэлбэр).  ⚠️ **Татах холбоос:** backend
  `/api/client-files/…`, `/api/…/client-pdf` гэж `/api`-тай буцаадаг, `downloadPdf` өөрөө
  `/api` угтварладаг тул шууд дамжуулбал `/api/api/…` → захиалагч ЮУ Ч татаж чаддаггүй байв;
  `hooks/useDownloader.ts apiRelative()` засна.  Ажилтны `features/projects/detail/ClientPortalTab.tsx`
  ч мөн `apiRelative`-аар засагдсан (2026-09-24).  ⚠️ Төслийн «Захиалагч» таб 2026-09-24 хүртэл ОГТ
  нээгддэггүй байв: `detail/constants.ts` `PROJECT_TABS`-д `client` байгаагүй тул `?tab=client`
  «overview» руу унадаг — ProjectTabs-д шинэ таб нэмэхдээ тэр багцад ЗААВАЛ нэм.  **2026-09-28-нд «Захиалагч»
  таб ХАСАГДСАН** (эзэн: захиалагчийг яаж хийхээ дараа шийднэ; эрхийг Хэрэглэгчид хуудсаас) — `ClientPortalTab.tsx`
  файл хэвээр, `?tab=client` (`clientPortal.ts`-ийн мэдэгдэл) одоо «overview»-д буудаг.  Оронд нь захиалагчийн НЭРИЙГ
  паспортын баримт / маягт дээр шууд бичнэ: `PUT /:id/passport` `client_name` → `project_clients`
  (`lib/passportClient.ts`, 9 тест: хоосон = бүгдийг устгах, мөргүй = `company` 100% нэмэх, байгаа = ЭХНИЙ мөрийн
  нэрийг солиж бусдыг устгах; ирээгүй бол хөндөхгүй; хариу `clients`), senior ч засна (паспорт `requireManager`).
  Мөн тэр өдөр паспорт/тайлангийн §1-ээс «Doc. No.» мөр хасагдсан (`ProjectIntroPage`, маягт, үүсгэх цонх, толгойн
  карт) — прод дээр `doc_no` ба тайлангийн `docNo` override 0 байсан; багана хэвээр.  ⚠️ `@/ui/button`-ыг `h-auto`/`px-0`-оор
  дарахдаа `pointer-coarse:h-auto` ба `has-[>svg]:px-0`-ийг ХАМТ бич — tailwind-merge variant-тай
  классыг дардаггүй тул мэдрэгчтэй дэлгэц дээр мөрүүд 44px-д хавчигдаж давхцана (хэмжсэн).
  Ажилтны хуваалцсан компонентуудыг (захидал, паспорт) `tabs/EmbeddedSections.tsx` нь lazy
  ачаалж, `[&_[data-slot=card]]:` хүрээгээр л хурц өнцөгтэй болгоно — `ui/card.tsx` хөндөөгүй.
  Шалгасан: mock API + headless-Chrome 26 шалгалт + 320/768px хэвтээ хэт гаралт 16/16, `npm run verify` ногоон.
  **Deploy хийгдсэн 2026-09-23:** commit `90a55c6d`, Pages `91f6f81c` (зөвхөн frontend; миграц,
  worker шаардлагагүй).  Deploy-оос өмнө production = `b8ad84c` цэвэр build гэдгийг chunk-ийн
  хэмжээгээр баталсан; `TeamTabsStrip` chunk нь `ProjectDetailPage` руу нийлсэн нь хэвийн.

### Төслийн баримт бичиг — Google Drive нь ЭХ СУРВАЛЖ (2026-09-10, migration 0278)

The project page's «Баримт бичиг» tab browses the project's Google Drive folder **in place**. Files stay in Drive; the ERP stores only `projects.google_drive_folder_id` (+ `google_drive_folder_name`, a display cache written at link time). There is **no** metadata replica table and no R2/D1 copy of any byte — `GET …/content` pipes Drive's response body through (`alt=media`, or `files.export` → PDF for Docs/Sheets/Slides, which is a conversion, not a copy). This is deliberately **separate** from the `/app/documents` archive (file-server imports into R2) — the owner's 2026-09-03 instruction that the archive must not auto-link to projects stands.

- **Auth = service account acting as itself + `drive.readonly` + the folder shared to the SA as Viewer** (`lib/google/driveBrowse.ts`). Same proven pattern as Calendar (`calendarAuth.ts`), same `GOOGLE_SA_JSON` secret (verified set in production 2026-09-10 via `wrangler secret list`), **no DWD** (never configured at this org). Not the Gmail OAuth token of `driveClient.ts`: that one is `drive.file` (sees only app-created files) and widening it to `drive.readonly` would add a restricted scope to the consent screen and expose the whole mailbox Drive. Employees have no individual Google accounts (one @mglenc.com per team), so per-user OAuth is not an option — ERP authorization decides who sees what. The SA email is exposed to admins via `GET /api/projects/drive/service-account` so they know whom to share with; the private key never leaves `mintServiceAccountToken`.
- **Access rule** (`assertDriveAccess`, `DRIVE_ROLES`): **every staff role (`admin|senior|engineer|architect`), every project's folder — view, edit (rename/move/restore a version) and add files/folders, but NEVER delete** — owner's decision 2026-09-24 (between 2026-09-15 and 09-24 it was `admin|senior` only). «No delete» is enforced by absence: neither `mountDriveBrowse` nor the client router has any trash/delete route (`DELETE …/drive/uploads` only cancels an unfinished upload), and a same-name «replace» upload creates a new Drive version, so the old bytes survive in Drive's history and the 0300 ledger — **do not add a delete endpoint**. Deletion inside Google Drive itself (the «open in Drive» link) is governed by the folder's Drive sharing, not by the ERP. Folder linking / sharing / baseline stay `requireAdmin`; the «Захиалагч» panel + client-view preview stay admin+senior (`DRIVE_MANAGER_ROLES`, `routes/clientDrive.ts`; `DriveBrowser.tsx` `clientMode`). `GET /api/main-projects` uses `DRIVE_ROLES`. Three places hardcode the set and must move together: `routes/projectDrive.ts` `DRIVE_ROLES`, `Layout.tsx` NAV_ITEMS `/app/documents`, `ProjectTabs.tsx` `showDocumentsTab` (`node scripts/nav-matrix.mjs` shows the sidebar result). **`client` is 403 here** on purpose: the portal's download scope is reports + issued packages + approved ASR (owner, 2026-09-07), not the raw working folder; the tab is also hidden for clients. Since 2026-09-18 a client reaches **only the folders/files staff explicitly opened** through the separate `/api/client/projects/:id/drive/*` router — see «Захиалагчид нээсэн Drive баримт» below; the raw folder stays closed. `worker` is closed by `workerScope.ts`.
- **Every `folderId`/`fileId` from the browser is validated by walking Drive `parents` up to the project's root** (`projectDriveAccess.ts resolveAncestry`, depth cap 40, parent-link cache 5 min, pre-filled from listings so opening a just-listed file costs 0 extra Drive calls). Outside the root → 403 `OUTSIDE_PROJECT`; trashed → 404; a shortcut is judged by its own location, not its target. Drive answers 404 for unshared items, so «not found» and «not shared» are indistinguishable and both surface as `NOT_FOUND`.
- **Only the folder being viewed is listed** (`files.list` with `'<id>' in parents`, `supportsAllDrives` + `includeItemsFromAllDrives` + `corpora=allDrives` for Shared Drives, `orderBy=folder,name_natural`, 200/page, `fields=` restricted to `ENTRY_FIELDS`). Never recursive. Listing cache: in-isolate Map, **30 s**, keyed tenant+folder+pageToken; `?refresh=1` («Шинэчлэх») bypasses and invalidates. `invalidateDriveListing()` is the single hook a future Drive Changes API / push-notification receiver should call — nothing else needs rewriting. JSON responses are `Cache-Control: private, no-store`; `withEdgeCache` is deliberately not used (user-varying).
- **Preview plan is decided server-side** (`lib/projectDrive.ts previewPlan`): `pdf`/`image`/`text` → original bytes; Google Docs/Sheets/Slides/Drawings → `files.export` PDF (10 MB export cap → 413 `EXPORT_TOO_LARGE`, the UI falls back to «Google дээр засах»); Office and anything else with `hasThumbnail` → Drive's first-page thumbnail proxied through `…/thumbnail` (`thumbnailLink` needs the bearer token, so it is never sent to the browser); rest → `none` («Эх файлыг нээх» only). SVG is never treated as an image. PDFs are shown via `blob:` iframes for the COEP reason documented in `AttachmentPreviews.tsx`; Google's `/preview` iframe cannot be used either (credentialless → cookieless → «signed out»).
- **Linking** is `PUT /api/projects/:id/drive-folder` (admin), which accepts a raw id or any Drive URL (`parseDriveFolderInput`), then **reads the folder from Drive before saving** — wrong id, unshared folder, a file id, or a trashed folder all fail at link time instead of producing an empty tab. UI: the field in `ProjectEditDialog` and the not-linked state of the tab share `DriveFolderForm`.
- Errors carry a `code` (`NOT_CONFIGURED | AUTH_CONFIG | NOT_FOUND | PERMISSION_DENIED | RATE_LIMITED | EXPORT_TOO_LARGE | UNAVAILABLE | NOT_LINKED | OUTSIDE_PROJECT | …`); the frontend maps codes to i18n in `driveErrors.ts`. Google's raw message goes to `console.error('[project-drive] …')` only. `403 accessNotConfigured` from Google means the Drive API is not enabled on the SA's Cloud project — that is `AUTH_CONFIG`, not a sharing problem.
- Tests: `backend/src/lib/projectDrive.test.ts` (pure helpers, 9). The network layer was verified 2026-09-10 against a fake Drive behind a stubbed `fetch` (47 checks: ancestry, cross-project rejection, pagination, cache bypass, export, thumbnail, linking) — that harness lives outside the repo because `node --test` cannot load `googleAuth.ts` (TS parameter properties), which is also why `driveBrowseCore.ts` is split from `driveBrowse.ts` and `projectDrive.ts` from `projectDriveAccess.ts`.
- **Үндсэн төсөл (`main_projects`, migration 0281, 2026-09-11).** A `projects` row is one *category* of a real job (`MGL-251006 EVERGREEN` is AZ #41 **and** ZA #37), and the owner wants documentation attached to the real job, not to a category. `main_projects` (id, code `MGL-yymmdd`, name, `google_drive_folder_id/_name`) groups them via `projects.main_project_id`. Resolution rule (`loadProjectDriveRoot`): **the main project's folder wins**, `projects.google_drive_folder_id` is only the fallback for an unassigned project. `PUT /api/projects/:id/drive-folder` on a project that has a main project **writes to the main project** (response `scope:'main'`). Routes: `routes/mainProjects.ts` at `/api/main-projects` — list (+ admin `unassigned`), create/update/delete, `PUT /assign`, `POST /auto-group` (groups unassigned projects by the name's `MGL-yymmdd` code via `lib/mainProjects.ts parseProjectName`, inherits a member's own folder; idempotent), and the **same** Drive browse handlers as `/api/projects/:id/drive/*` through `mountDriveBrowse()` (a factory in `routes/projectDrive.ts`). Frontend: `/app/documents` lists main projects (cards with AZ/ZA chips → `/app/documents/main/:id`), `MainProjectDialog` (name/code/members/folder/delete), `MainProjectSelect` in `ProjectEditDialog`; the frontend Drive API takes a `DriveScope` (`'project' | 'main'`). D1 does not enforce the FK, so `DELETE /:id` nulls `main_project_id` by hand. Verified 2026-09-11 against the local prod-copy sqlite (22 checks, rolled back).
- **Drive-ийн үндсэн хавтас → шинэ төслийн хавтсыг АВТОМАТААР нэмэх (2026-09-24, no migration).** Owner: «anything uploaded into the connected Drive must show up in the system». Everything *inside* a linked folder already did (the tab lists Drive live) — what did not was a **new project folder next to the 19**. Now an admin links the parent once (`app_settings.project_drive.company_root`, Documents page → «Drive-ийн үндсэн хавтас» → `DriveRootDialog.tsx`, `GET|PUT /api/main-projects/drive-root`, `POST …/sync`, `DELETE …/ignored/:folderId`, all admin, registered above `/:id`) and **every** direct sub-folder that no `main_projects`/`projects` row links becomes a main project (owner chose «all folders», no name filter; name = folder name minus a leading `00. ` numbering, code = `DOC-|MGL-yymmdd` if present, `created_by NULL`). It runs at the **start of the existing 2-minute Drive-listener tick** (`syncProjectDriveChanges` → `lib/projectDriveDiscovery.ts`, one `files.list`; **no new cron expression**), and the linked roots are re-read before Changes are pulled, so files uploaded into a brand-new folder land in the version ledger in the same tick. Pure rules + 7 tests: `lib/driveDiscovery.ts`. Guards: the INSERT is `… WHERE NOT EXISTS` (cron and «Одоо шалгах» may race — one row per folder); linking a folder that is itself a project folder → 409 `ROOT_IS_PROJECT_FOLDER` (its 00–12 sub-folders would all become projects); a Drive folder rename updates `google_drive_folder_name`, and `name` only while it still equals the old folder-derived name (an admin's own name is never overwritten). **Deleting a main project, unlinking its folder, or re-pointing it to another folder puts the old folder on `project_drive.discovery_ignored`** (`DELETE /main-projects/:id` + the shared `PUT …/drive-folder` in `mountDriveBrowse`) — otherwise the next tick would recreate it; the dialog lists those with «Буцааж нэмэх». A folder trashed/removed in Drive never deletes its main project. Content *moved* in from elsewhere gets no automatic baseline snapshot (R2 cost) — the per-project «Эхний хуулбар авах» button still applies. The parent folder must be shared with the SA (Viewer) or discovery answers `PERMISSION_DENIED` and records `project_drive.discovery_last.error`. Verified 2026-09-24: fake-Drive + prod-copy route/cron harness 40/40, headless-Chrome dialog 15/15 (scratchpad, not in repo). **Deployed 2026-09-24** as `4753f134` on top of the peer release `c0e725e5` (worker `04996867`, Pages `5029e390`, live chunks byte-identical); the owner still has to link the parent folder and share it with the SA.
- **Office previews are rendered in the browser** (2026-09-11): `.docx` → `docx-preview` (own lazy chunk, 170 kB), `.xlsx` → `exceljs` (already bundled) via `preview/xlsxView.ts` (sheet tabs, merges, cached formula values, 3 000×80 cap); `previewPlan` returns `docx`/`xlsx` up to **150 MB** (`OFFICE_RENDER_MAX_BYTES`; was 40 MB until 2026-09-21 — which excluded every real photo report, 47–110 MB on prod; a 110 MB/120-photo docx measured ~1 s render, ~225 MB JS heap), above that Drive's thumbnail; pdf/image/video inline up to 200 MB. `previewPlan` also resolves `application/octet-stream` by file extension (`effectiveMime`), and `normalizeUploadMime` does the same on upload — an empty browser `File.type` used to land a `.docx` in Drive as octet-stream, never previewable. `video/mp4|webm` → `<video>`. The dialog streams the download with a progress bar (`apiFetchBlob` `onProgress`). Nothing is copied or converted on Google's side.
- **.docx → Google: «Эх файлыг нээх» нь ЭХ файлыг Google дээр зөв харагдахаар засна — navy бичвэр цагаан, нуусан navy хэлбэр алга (2026-09-30, миграцгүй; «Google Docs болгох» ХАСАГДСАН; 2026-10-01 эзний шийдвэр: ФОНТ ХӨНДӨХГҮЙ; DEPLOYED 2026-10-01).** Түүх: `4def18d3` navy текст цагаан + «Google Docs болгох» (хөрвүүлсэн ХУУЛБАР), `870b0494` AGFutura → Commissioner + RFI 9pt — хоёулаа мөн өдөр ДАРАГДСАН: эзний гомдол «товч дарах бүрт ижил нэртэй Google Doc нэмэгддэг» (прод дээр RFI-017 ×3, RFI-020 ×2 хуулбар үүссэн — ledger-т), «Эх файлыг нээх» дээр navy текст хар, Google-ийн харагдацыг Word-ын PDF (RFI-017)-тэй яг адилхан болго. **Google-ийн хэмжих арга (оракул):** «anyone with the link» хавтасны файлыг нэрээ нууцлан экспортолно — `https://docs.google.com/document/d/<fileId>/export?format=pdf` нь .docx-ийн хувьд ЯГ «Эх файлыг нээх»-ийн Office-горимын рендер (Google Doc-ийн хувьд `format=docx` = Google-ийн дотоод загвар; Office файлд эх байт л буцна). Хэмжсэн шалтгаанууд: (1) компанийн RFI **загвар өөрөө** «사각형 20» нуусан navy тэгш өнцөгт агуулдаг (`docPr hidden="1"` + VML `visibility:hidden`, 26×37 см, wrapNone, бичвэрийн өмнө) — Google hidden-ийг үл тоож 1-р хуудсыг бүхэлд нь navy болгодог; Google-оор нэг дамжсан файлд hidden алга болж **Word дээр ч** navy (Drive дээрх RFI-020 яг ийм); (2) navy дээрх «Автомат» бичвэр → хар; (3) AGFutura Mon → Google латин үсгийг Poppins, кириллийг Arial (Poppins-д кирилл 0) — холилдоно; AGFutura суугаагүй компьютерт Word fontTable-ийн `altName` = **Calibri**-г хэрэглэдэг (жишиг PDF яг ийм — Word-оор дуурайж пикселээр баталсан); (4) `numId="0"` догол мөр (загвар нь Heading2 → дугаарлалт): Word дугаарлалтын догол шилжилтийг хэрэглэдэггүй, Google lvl-ийн hanging 567-г хэрэглэнэ («Гарчиг»-ийн эхний мөр нүдний хүрээнд наалдсан); (5) Word-ийг өөрчлөхгүйгээр засах АРГАГҮЙ (хэвээр үлдсэн): Google `w:w` (90% шахалт) ба тэмдэгтийн зайг хаядаг, «exact» мөрийн зайг олон дахин болгодог, contextualSpacing үл тоодог, Microsoft Sans Serif → Helvetica Neue, Microsoft YaHei → MS PGothic/Arial Unicode холимог. **Word-оор хэмжсэн (туршилтын .docx):** «Автомат» өнгийг Word ЗӨВХӨН дүүргэлтээр (run → догол мөр → нүд) шийддэг, highlight-ийг ОГТ тооцдоггүй — хар highlight + auto «□» хар хэвээр (= сонгосон checkbox); `docxAutoText.ts` highlight-ийг дэвсгэр гэж үзэж checkbox-ийг «▣» болгодог байсныг ЗАССАН (`check:docx-auto-text` 18).
  **Хэрэгжилт:** **`drive/docxGoogleReady.ts`** (`prepareDocxForGoogle` = `fixDocxBytes` + нуусан хөвөгч хэлбэр устгах + хуудаснаас том/өмнө/бичвэргүй/тунгалаг бус wps бүрхэвч устгах (Google-ийн гэмтэл) + `numId=0` догол мөрөнд Word-ийн бодит `w:ind`-ийг ил бичих; idempotent; `npm run check:docx-google-ready` 17, `verify`-д). ⚠️ **2026-10-05-аас ДАРАГДСАН — «Эх файлыг нээх» БҮХ бичвэрийн фонтыг Arial болгоно** (эзэн: «RFI-ийн word болон docs-ийн бүх текст Arial; зарим нь Poppins, зарим нь Arial байна»): `docxGoogleReady.ts` `forceArialFonts` (run, догол мөрийн тэмдэг, header/footer, `styles.xml` docDefaults+стиль, `numbering.xml`; AGFutura/Poppins/тема → Arial, `eastAsia`/`hint` хэвээр, Symbol/Wingdings/Webdings/MS Gothic тэмдэгт-фонт хөндөгдөхгүй) ба backend `docxSign.ts` `arialRunPr` (гарын үсгийн бөглөсөн нэр/албан тушаал/огноо ҮРГЭЛЖ Arial — ихэр, хамт өөрчил); `openInGoogle.ts` кэш `mgl:google-ready:v2:` (өмнө «цэвэр» гэснийг дахин шалгана).  Хэмжээ, 90% шахалт, мөрийн зай хэвээр.  Доорх «ФОНТ ХӨНДӨХГҮЙ» нь түүх.  **ФОНТ ХӨНДӨХГҮЙ** (эзэн 2026-10-01, AskUserQuestion «зөвхөн өнгө + navy хэлбэр»): `4e752155` AGFutura Mon → altName/Calibri (+ кирилл дээрх Poppins → мөн) болгодог байсан нь AGFutura СУУСАН компьютерт Word дээр ч брэндийн фонтыг солих тул `15cb1138`-аар хасагдсан; Google дээр AGFutura → Poppins/Arial орлуулга хэвээр.  Тиймээс засвар Word дээр ПИКСЕЛ-ИЖИЛ: бодит RFI-023 (EVERGREEN `261001_RFI_EVGR_…-023.docx`, `1_meagvM8pDUbbJwAthl1s1HZx46dfnN5`) Word COM рендер өмнө/дараа 3 хуудас 0 ялгаа, зөвхөн `word/document.xml` өөрчлөгдсөн (navy нүдний 96 run → FFFFFF, нуусан хэлбэр 1 устсан).  Засварын ӨМНӨ Google-ийн оракул: 1-р хуудас бүхэлдээ navy, 2–3-р хуудасны navy нүдний бичвэр хар. **`drive/openInGoogle.ts`**: товшилтын ДОТОР хоосон цонх (попап хориглогч async-ийн дараахыг хаадаг) → шинэ мета + байт (`/content?download=1`) → засвар → өөрчлөлттэй бол **ИЖИЛ файлын ШИНЭ ХУВИЛБАР**: `POST /:id/drive/files/:fileId/revision {size, base_modified_time}` (`routes/projectDrive.ts` `mountDriveBrowse`: `resolveItem` ancestry, `isRevisableDocx`, одоогийн modifiedTime ≠ base → 409 `STALE_FILE` — бусдын засварыг дарахгүй, `driveResumableStart(existingFileId)` = `files.update`, ердийн тикет + `PUT /:id/drive/uploads` chunk, ledger `modified` + `uploaded_by_user_id`) → цонхыг `open_url` руу. Шинэ файл ХЭЗЭЭ Ч үүсэхгүй; ≤40 MB (`REVISION_MAX_BYTES` ↔ `GOOGLE_READY_MAX_BYTES` ИХЭР), том тайлан засваргүй нээгдэнэ; localStorage `mgl:google-ready:<fileId>` = цэвэр гэж мэдэгдсэн modified_time (дахин татахгүй). Орох цэг: preview цонхны товч (2 газар) + жагсаалтын мөрийн дүрс (`onOpenOriginal`), зөвхөн .docx, зөвхөн ажилтан; захиалагчийн портал хөндөгдөөгүй. Хасагдсан: хөрвүүлэх зам бүхэлдээ (`parseConvert`, `convertedDocName`, `GOOGLE_DOC_MIME`, `CONVERT_*`, `driveResumableStart.targetMime`, `docxGoogleFonts.ts`, i18n `toGoogleDoc*`). Шалгасан: mock-API + headless-Chrome 22/22 (дараалал мета → агуулга → revision → 2 chunk → ДАРАА нь Google, кэш, 409, PDF шууд). **DEPLOYED 2026-10-01** (`4e752155` + `15cb1138`; `4e752155` 9/30-нд wrangler login хугацаа дуусч deploy хийгдээгүй үлдсэн, эзэн саатуулаагүй): worker `1cecc563`, Pages `9267d156` (`index-C_Vtj1mW.js`); prod bundle + COOP/COEP headless-Chrome 23/23 (бодит RFI-023).  Deploy-оос өмнө нээгдсэн хуудасны (хуучин chunk санах ойд) «Google Docs болгох» → `startUploadIn`-д `convert` → 400 `CLIENT_OUTDATED` (хавтсанд .docx давхардал үүсгэхгүй; хуудсаа шинэчилнэ).  «Эх файлыг нээх» шинэ хувилбар бичихэд гарын үсгийн самбарын `base_modified_time` хуучирч дараагийн «Гарын үсэг зурах» 409 `STALE_FILE` → самбар дахин ачаална (хүлээгдэж буй).  Бодит Google-ийн шалгалт: ERP-ээс «Эх файлыг нээх» дарсны ДАРАА дээрх оракулаар PDF татаж 1-р хуудас navy биш, navy нүдний бичвэр цагаан эсэхийг тулга.
- **⚠️ 2026-10-12 — R2 БАЙТ ХУУЛБАР УНТАРСАН (эзэн: «Google Drive-д итгэнэ»).** `drive-versions/` (5 342 объект, 40.09 GB) `mgl-meeting-audio`-аас УСТГАГДСАН; `lib/projectDriveSync.ts` `SNAPSHOTS_ENABLED = false` → `snapshotToR2` үргэлж null, сонсогч ба ERP байршуулалт ledger-ээ (хэн/хэзээ/юу) бичсээр, шинэ мөр `r2_key = NULL`. Сэргээх = Drive-ын өөрийн «Version history». **DEPLOYED** worker `f71b51cb` (= `b49b8df8` + `48382667`; HEAD-ийн 0395 ✂ хуваалт ОРООГҮЙ). Хуучин мөрүүдийн `r2_key`-г эзний зөвшөөрлөөр NULL болгосон (7 027 мөр, 2026-10-12; 7 291 мөрийн 0 нь түлхүүртэй) → «Хувилбарууд» татах/буцаах товч харагдахгүй, түүх хэвээр. Үлдсэн бакет 0.27 GB = хурал/ЗХ-ийн 7 аудио (DB-д холбоотой) + транскрипт + гарын үсэг. Доорх нь түүх.
- **Хувилбарын түүх — the ERP listens to Drive and keeps its own copy of every saved state (migration 0300, 2026-09-15).** Owner's decision: the Drive folder may be opened to «anyone with the link can edit» (contractors without Google accounts), so the system must watch Drive continuously, snapshot each save, record who/when/what, and be able to roll a file back. `lib/projectDriveSync.ts` rides the existing 2-minute cron branch (**no new cron expression**): Drive **Changes API** (`changes.list`, token in `app_settings.project_drive.changes_token`; first run = start token, no history) **plus** a fallback `files.list modifiedTime > since` poll (5-min overlap) both feed `project_drive_pending`; a pending file is processed only once its `modifiedTime` is ≥ 3 min old (`QUIET_MS` — Google Docs bump modifiedTime per keystroke), then `classifyChange` (pure, `lib/projectDriveVersions.ts`, 12 tests) compares md5 (binary) / modifiedTime (Google formats) with the last `project_drive_versions` row and only a content change downloads bytes into the PRIVATE `MEETING_BUCKET` under `drive-versions/<root>/<file>/…` (streamed through `FixedLengthStream`; `Accept-Encoding: identity` on `alt=media` because a gzip'd body's content-length is the compressed size). Docs/Sheets/Slides are exported as docx/xlsx/pptx (restorable), Drawings as PNG (not restorable), other Google types metadata-only. **The ledger is append-only**; `renamed`/`moved` rows share the previous row's `r2_key`, so never delete an R2 object by row without checking other rows. **Who edited = Drive's `lastModifyingUser` = the team's shared Google account, or nobody for link-editors**; only `restored` rows carry an ERP user id. Restore = `POST …/drive/versions/:id/restore` → `files.update` (media upload, `drive` write scope minted separately from the read-only browse token) — Drive gets a new version, nothing is deleted; trashed → untrash first; permanently deleted → `files.create` in the last known parent (new Drive id). Both writes and `PUT …/drive/sharing` (`anyone` permission on the root folder, inherited by children; `writer` needs an explicit confirm in the UI) require the folder to be shared to the SA as **Editor**, not Viewer — Google 403s otherwise (`PERMISSION_DENIED`). `POST …/drive/baseline` (admin) walks the tree (≤60 folders / 2 000 files) and enqueues existing files because Changes never reports the past. UI: «Түүх» panel + per-file «Хувилбарууд» dialog in `DriveBrowser`, sharing select inside the admin settings card. Lock: `app_settings.project_drive.sync_lock` (stale after 12 min). Not verified against a real Drive yet — the SA on the dev machine has no shared Editor folder; see the runbook in the 2026-09-15 handover.
- **`POST /api/documents/purge-legacy`** (admin, `confirm:'PURGE-LEGACY-ARCHIVES'`, `routes/documentPurgeRoutes.ts`) hard-deletes the pre-Drive archive data — measured 2026-09-11: 22 archives, 4 054 files, 5 518 revisions, **30.05 GB in R2**. It deletes R2 keys **listed in `document_revisions.file_url` one by one** (never by prefix — `MEDIA_BUCKET` is shared with profile photos, project images and email attachments), trashes Google-Docs working copies, then deletes the D1 rows children→parents in one batch. The Documents page shows the red card only while such data exists; `DELETE /archives/:id` remains a soft delete that frees nothing.
- **ERP-ээс байршуулах — файл / хавтас / шинэ хавтас (2026-09-17, migration 0325).** Owner's decision: staff must not have to open Drive to add documentation; the «Байршуулах» menu + drag-and-drop on the «Баримт бичиг» tab writes **into the folder currently being viewed**; clients and the mail module are explicitly out of scope for now. Transport is Google **resumable upload relayed through the Worker**: `POST …/drive/folders/:folderId/uploads` opens the session (SA, `DRIVE_WRITE_SCOPE`) and returns a **2-part HMAC ticket** (`lib/projectDriveUpload.ts`, JWT_SECRET-keyed but deliberately *not* a JWT so `verifyToken` can never accept it as a session) that hides the session URI — the URI is itself the credential and handing it to the browser would make the Worker an open proxy; `PUT …/drive/uploads?offset=N` (`X-Upload-Token`) streams one 32 MiB chunk (`UPLOAD_CHUNK_BYTES`, a 256 KiB multiple as Google requires, under the Worker's 100 MB body cap) into the session via `FixedLengthStream` — `checkChunk` rejects any offset off a chunk boundary or any length ≠ `min(chunk, size−offset)`; `DELETE …/drive/uploads` cancels; `POST …/drive/folders/:folderId/folders` creates a subfolder with `reuse` (find-by-name first — folder uploads call it once per path segment so re-uploading a tree merges instead of duplicating). Same-name file ⇒ `on_conflict` `replace` (default: `files.update` on the existing id → Drive's own version history + our ledger `modified`) or `keep` (Drive allows duplicates); an existing **Google-format** file is never "replaced" by bytes. The ticket binds root + user, so a ticket from another project/user 403s. On the final chunk the route `waitUntil`s `recordUpload` (`projectDriveSync.ts`): Drive→R2 snapshot + a ledger row with **`uploaded_by_user_id`** (0325 — Drive's `lastModifyingUser` is the SA, so only this column knows who; `versionView.uploaded_by`, «{name} байршуулав» in the activity panel); the row carries Google's md5/version so the 2-minute listener classifies the same file as unchanged. ⚠️ **Creating a file makes the caller its owner, and Google refuses an SA as owner inside My Drive** (`storageQuotaExceeded`, measured on production 2026-09-18 — the project folders are NOT in a Shared drive despite the owner's 2026-09-17 answer, and «anyone with the link can edit» changes nothing for API callers). Fix (478a423): `driveWriteIdentity(root)` reads the root's `driveId`/`owners` (5-min cache) and every write (`driveResumableStart`, `driveCreateFolder`) is made **as the folder owner via domain-wide delegation** (`mintServiceAccountToken` `subject`) when the root is in My Drive, or as the SA itself when it is in a Shared drive. **DWD must be granted once in Google Admin Console** (Security → API controls → Domain-wide delegation: the SA's `client_id` with scope `https://www.googleapis.com/auth/drive`); until then Google answers `unauthorized_client` → `DELEGATION_REQUIRED` 503 whose body carries `delegation.{client_id,scope,subject}` and the upload panel shows the full server message. `SA_NO_QUOTA` remains only for a folder whose owner is outside the Workspace domain. Files created this way are owned by the team account, so `lastModifyingUser` is finally a real name. Verified 2026-09-17 against a fake Drive (route harness, 32 checks; headless-Chrome E2E of the menu/drop/conflict/new-folder/folder-upload/cancel flows, 11 checks) — **not yet exercised against real Drive, not deployed**. Pure tests: `projectDriveUpload.test.ts` (12). Frontend: `drive/driveUpload.ts` (runner, `webkitGetAsEntry` directory walk, junk-file filter), `DriveUploadMenu/Panel/Dialogs.tsx`.
- **Захиалагчид нээсэн Drive баримт — `client_drive_shares` (migration 0327, 2026-09-18).** ⚠️ **SUPERSEDED 2026-09-21 — see the next bullet; the visibility half of this paragraph no longer holds** (kept for the history of the tables/routes). Owner's decisions on 2026-09-18 were: the client sees **only what staff mark** (not the whole folder, not a fixed sub-folder), view + download only, permission **per organisation** (`client_orgs`, same unit as `project_client_access`), invitation e-mailed automatically, and org/contact creation reachable from the Documents tab. One rule, one file — `lib/clientDriveShares.ts` (`visibleAncestor` + `trimPathToShare`, pure, tested): an opened **folder** exposes its whole **subtree** (the Drive `parents` chain from `resolveAncestry` must pass through a shared folder id), an opened **file** exposes only itself; a row with `revoked_at` counts as nothing; no row ⇒ **404, never 403** (a client must not be able to probe the folder structure by guessing ids). Rows are per `(project_id, org_id, drive_item_id)`; sharing the Drive root itself is allowed and means «whole project». **Portal router `routes/clientDrive.ts`** (second mount on `/api/client`, inside `clientScope.ts`'s allowlist): `GET …/drive` (`linked` = folder linked **and** ≥1 share, `share_count`), `…/drive/folders/root` is a **virtual root** listing the shared items themselves (one `driveBrowseGet` per share, 404/trashed items silently skipped) unless the Drive root is shared, `…/drive/folders/:id` / `files/:id` / `content` / `thumbnail` reuse `serveDriveContent` / `serveDriveThumbnail` **exported from `projectDrive.ts`** (extracted so the two routers cannot drift); breadcrumbs are cut at the shared folder (`trimPathToShare` → `[{id:'root', name: project}, shared, …]`) so company folder names above it never leak; every item goes out with **`open_url: null`** — the Drive `webViewLink` would hand a client edit rights on a folder set to «anyone with the link can edit» (0300). Staff `admin|senior` may call the same router as a «what does the client see» preview (all orgs' shares merged); other staff 403. Each client `content` read is logged to **`client_drive_access_log`** (`via_item_id` = the share that granted it, so a folder share's «last accessed» counts its nested files) — staff reads are not. **Staff router `routes/clientDriveAdmin.ts`** (second mount on `/api/client-admin`, `requireManager`): `GET/POST /projects/:id/drive-shares` (POST = `{org_ids|org_id, item_id, note?}`; org must hold an **active** `project_client_access` → else 409 `ORG_NO_ACCESS`; item must be inside the project root → else 403 `OUTSIDE_PROJECT`; shortcuts refused; upsert revives a revoked row), `DELETE /drive-shares/:shareId` (sets `revoked_at`/`revoked_by`, never deletes), `GET /drive-shares/log`. A share emits a project-wide `client_events` row **without the file name** (every org on the project reads that stream) and a `client_publication` notification only to the target orgs' contacts. Both `lib` caches are 60 s (`invalidateClientDriveShares`), like `clientAccess.ts`. Frontend: `DriveScope` gained `'client'` (`driveBase` → `/client/projects/:id`), so `DriveItemList` / `DriveBreadcrumb` / `DriveFilePreviewDialog` / `useDriveFolder` are reused verbatim by the portal's new «Баримт бичиг» tab (`features/client/tabs/DocumentsTab.tsx`; `onVersions`/`onRename`/`onShareClient` are now optional props and simply absent there; `useClientRealtime` invalidates `['project-drive','client',id]` on `document` events). Staff side, **project scope only** (a share is org × project, so the main-project page has no button): the Share2 icon on every row opens `ClientShareDialog` (checkbox per org with access, diff → POST/DELETE), the «Захиалагч» toolbar toggle opens `ClientSharePanel` (shares by org, revoke, last access, access log), and `ClientInviteDialog` chains the three existing routes (create org → grant project access → invite contact with `send_email` + `project_id` for the mail text). Verified 2026-09-18 with a fake-Drive + fake-Gmail route harness on a real SQLite built from 0257 + 0327 (54 checks: subtree/file visibility, 404-not-403, breadcrumb trimming, cross-org isolation, revoke/revive, root share, Google-format export, access log, invite e-mail incl. reset) — no browser E2E yet. **Deployed 2026-09-18** (`c95b3f24` + sw `df8f28e1`: D1 0327 applied, worker `41c1e218`, Pages `4ff5f12c`; superset of the peer session's `f33581ea`).
- **Захиалагчийн Drive баримт — БҮХ хавтас view-only, байршуулах ЗӨВХӨН «09» (2026-09-21, no migration).** Owner's three decisions, asked and answered explicitly: (1) «folder 9» = the Drive folder directly under the project root whose name starts with `09` (template code 09 «ЗАХИАЛАГЧААС ИРСЭН МАТЕРИАЛ», `lib/projectDocTemplate.ts`), recognised **by name** (`/^09(?![0-9])/`, real folder only — a shortcut named 09 does not count; several → first by name), no per-project setting; (2) a client of an organisation with `project_client_access` (any level) sees **the whole project Drive folder** read-only — `client_drive_shares` **no longer governs visibility** (table, `routes/clientDriveAdmin.ts` share/revoke routes and `ClientShareDialog.tsx` stay in the tree but are unused by the UI; the panel now shows orgs + access level, the 09 folder status, invite and the access log); (3) clients may also create **sub-folders inside 09** (folder drag-drop needs it). Upload right = the existing `clientCanSubmit` level (`contributor` | `approver`); `viewer` sees everything, uploads nothing. **One rule file, pure and tested: `lib/clientDriveUpload.ts`** (`isClientUploadFolderName`, `pickClientUploadFolder`, `uploadAllowedOnPath`; imports nothing so `node --test` can load it — `driveBrowse.ts` drags in `googleAuth.ts` parameter properties). `routes/clientDrive.ts` (`findClientUploadFolder` over the root listing's 30 s cache): `GET …/drive` now returns `upload_folder` (`{id,name}` | null) + `can_upload` (level), `…/drive/folders/:id` lists the real tree (root = Drive root, breadcrumb `[{id:'root', name: project}, …]`) and carries `can_upload` for **that** folder; new write routes `POST …/folders/:id/uploads`, `PUT …/drive/uploads?offset=`, `DELETE …/drive/uploads`, `POST …/folders/:id/folders` — `resolveWriteTarget` = role `client` only (staff preview is read-only, 403) → `contributor`+ (else 403 `UPLOAD_NOT_ALLOWED`) → 09 exists (else 409 `UPLOAD_FOLDER_MISSING`) → target inside the project (else 404) **and** on the 09 subtree (else 403 `UPLOAD_NOT_ALLOWED` + `upload_folder` hint); the check is repeated on **every chunk** (`ticket.parent`), so a correctly-signed ticket for `01` is refused at PUT time and a 09 folder moved mid-upload cannot receive bytes elsewhere. The upload core (`createSubfolderIn`, `startUploadIn`, `readUploadTicket`, `putUploadChunkFor`, `cancelUploadFor`) was **extracted from `mountDriveBrowse` and exported from `routes/projectDrive.ts`** so the staff and client routers share one implementation (staff behaviour byte-identical; regression-tested). `recordUpload` writes the client's `uploaded_by_user_id`, so the staff «Түүх» panel shows «{client name} байршуулав»; `client_drive_access_log.via_item_id` is now the root id. Frontend: `DocumentsTab.tsx` renders `DriveUploadZone`/`DriveUploadPanel`/conflict dialog only when `first.can_upload`, a «Материал илгээх» shortcut to 09 elsewhere (contributor+), an amber notice when 09 is missing, and takes `active` from `ClientDashboardPage` so the document-level drag session (`useDriveDragSession`) only runs while the tab is visible (keep-alive tabs stay mounted); `DriveErrorCode` gained `UPLOAD_NOT_ALLOWED` / `UPLOAD_FOLDER_MISSING`. Verified 2026-09-21: `clientDriveUpload.test.ts` (7), a fake-Drive route harness with real 0257+0300+0325+0327 SQLite (72 checks incl. ticket forgery, cross-user/cross-project tickets, viewer denial, staff route regression) and a headless-Chrome E2E on the real routes behind a stubbed Google (36 checks: contributor/viewer/admin flows, file + folder upload into 09, browser-side 403s). **Not deployed.**

### Гаднын (login-гүй) гарын үсгийн link — RFI/CR + Зохиогчийн хяналт (migration 0381)

Ажилтан RFI/CR эсвэл ЗХ тайлангаас «Client link / Гарын үсгийн link» үүсгэж, гадны хүн утсаар `/sign/:token`-оор ERP-д нэвтрэхгүй гарын үсэг зурна.
`routes/publicDocumentSigning.ts` (`createSigningRouters(io)` factory — Browser Rendering нь `lib/publicSigningRender.ts`-д тусдаа, тест `node --test`-д ачаалагдана),
`lib/publicSigning.ts`, frontend `features/signing/`.  Public API = `/public/signing/:token[/document|/sign]` (`/api`-аас ГАДНА, CORS `*`), staff API = `/api/signing-links` (module `projects`).
- **Token**: 32 санамсаргүй байт, D1-д ЗӨВХӨН SHA-256; 7 хоног өгөгдмөл / 30 дээд; (kind, entity, slot)-д нэг pending (partial UNIQUE); шинэ link хуучныг revoke — НЭГ `db.batch`.
- **Эрх**: RFI/CR = `project_members` (canWrite-ийн ихэр), ЗХ = `canSeeAsrReport`.  Хүсэгч идэвхгүй болох / эрхээ алдахад link ХААГДАНА (`revoked`, public GET/document/sign дээр шалгана).
- **Гарын үсэг = НЭГ batch**: баримтын slot UPDATE нь «request pending ба хугацаа дуусаагүй» гэдгийг SQL-д шалгана, request-ийн UPDATE нь «баримт яг миний гарын үсгийг авсан» гэдгийг шалгана →
  revoke / ERP signer / client portal уралдаанд хоёр хүснэгт зөрөхгүй, нэгдүгээр гарын үсэг ялна.  Хуучин portal `/sign` ба `DELETE /signature-request` ч ижил хүснэгтийг batch-аар хаадаг.
- **Бүтэн хуулбар**: RFI → `client_signature_key/_signed_at/_signer_name` (`client_signed_by` NULL, ХУВИЙН bucket); ЗХ → `sig_arch_*` / `sig_site_*` (`/media/public-sign-…png`).  ЗХ-ийн `status` ХЭЗЭЭ Ч автоматаар солигдохгүй (батлах нь тусдаа эрх).
- **Нотолгоо**: signature PNG sha256, `document_snapshot_key` (ХУВИЙН `MEETING_BUCKET` `public-signing/snapshots/`) + `document_sha256`.  Snapshot нь гарын үсгийг ЭРГҮҮЛДЭГГҮЙ: рендерийн өмнө/дараа баримт яг энэ гарын үсэгтэй, `updated_at` ижил байх ёстой, үгүй бол хадгалахгүй;
  унавал staff `POST /api/signing-links/:id/snapshot`-оор дахин оролдоно, `GET …/snapshot`-оор татна.  Preview PDF нь нэвтрэлтгүй endpoint-оос Browser Rendering ажиллуулахгүйн тулд `public-signing/preview/` кэштэй (R2 lifecycle-д нэмэх нь зохистой).
- **Frontend**: pdf.js (`pdfjs-dist` legacy, ЗӨВХӨН энэ lazy chunk) — iframe-PDF нь COEP credentialless / iOS / Android-д ажилладаггүй.  `SignaturePad` вектор зураас (эргэхэд арилахгүй).
- Тест: `routes/publicDocumentSigning.test.ts` (бодит SQLite + бодит хуучин portal router), `lib/publicSigning.test.ts`.  Баримтыг legal/qualified e-signature гэж ХЭЗЭЭ Ч дуудахгүй.

### Баримтын гарын үсэг + захирлын баталгаажуулалт — «Баримт бичиг» дээрх RFI (migration 0371, 2026-10-01, DEPLOYED)

Эзний хүсэлт: RFI-г явуулахаас өмнө ажилтнууд профайлын гарын үсгээ НЭГ товчоор зурна, дараа нь захирал хараад
НЭГ товчоор баталгаажуулна; үр дүн Docs-доо хадгалагдаж хэвлэх / PDF болгох боломжтой.  **Шинэ цэс БАЙХГҮЙ** —
«Баримт бичиг» табын файл үзэх цонхонд «Гарын үсэг» самбар (`drive/signing/DriveSigningPanel.tsx`), жагсаалтын мөрөнд
төлөвийн тэмдэг (`SigningBadge`), самбарт `PendingDocSignBanner`, мэдэгдлийн холбоос `?file=<id>&sign=1`.

- **Гарын үсэг ФАЙЛ ДЭЭР суугаад ИЖИЛ Drive файлын ШИНЭ ХУВИЛБАР болно** (`driveResumableStart(existingFileId)`,
  эзний identity, ledger `recordUpload(replaced)`) — шинэ файл үүсэхгүй, хуучин хувилбар Drive-ийн «Хувилбарууд»-д
  үлдэнэ.  Зураг = `users.signature_url` (байхгүй бол самбар дээр зурж профайлд хадгална); `lib/pngCrop.ts` бэхээр
  тайрч цаасыг тунгалаг болгоно (цагаан дэвсгэр Word-ын хүснэгтийн шугамыг далдалж байв).  ЗӨВХӨН хоосон
  нэр/албан тушаал/огноог бөглөнө (формат = хоосон нүдний догол мөрийн тэмдэг, Word шиг; эс бөгөөс ижил баганын
  бичвэр); бичигдсэн нүд хэзээ ч дарагдахгүй.  `.docx` л — Google Docs/PDF → `NOT_DOCX`.
- **Нүд таних — `lib/docxSign.ts`** (цэвэр, OOXML-ийг regex-ээр, хамааралгүй; `zipPatch.ts` өөрчлөгдөөгүй entry-г
  шахсан байтаар нь хуулна): «багана» (MGL RFI загвар — «Гарын үсэг (Signature)» толгойтой, Position/Name/Date
  багана) ба «мөрөн дотор» (зөвлөхийн маягт — шошготой нүд өөрөө хайрцаг).  Батлах мөр = албан тушаал
  захирал/director, эсвэл «Хянасан/Баталсан/Approved/Reviewed» шошготой хоосон албан тушаал.  Прод дээрх сүүлийн
  40 RFI-ээс 20 нь танигдсан; гарын үсгийн баганагүй хуучин загварт «дэмжигдэхгүй» гэж ил хэлнэ.  Суулгасан зураг
  `mgl-sign-…` нэртэй → дахин уншихад `erp` (гараар оруулсан нь `other`).  **Баганын давхцал ӨРГӨНӨӨР (twip), баганын
  тоогоор БИШ** (2026-10-05): Word хоёр мөрийн хилийг хэдхэн twip зөрүүлэхэд 15 twip-ийн нарийн сүлжээний багана үүсгэдэг —
  ORSH-RFI-007-д толгойн «Гарын үсэг» [4,6), мөрийн «Ирсэн хаяг» [3,5) болж, тоогоор тэнцсэн давхцалд хаяг (эхнийх) ялж
  гарын үсэг ХАЯГИЙН нүдэнд суудаг байв (өмнөх 40 RFI-ийн шалгалтын `16/17.docx` ч ийм байсан).  Хайрцаг нь өргөнийхөө ≥⅔-ээр
  гарын үсгийн баганын доор байх ёстой (хаягтай нэгтгэсэн нүд хайрцаг биш); зурах үед тэр мөрийн хайрцаг БИШ нүдэн дэх
  `mgl-sign-…` зургийг устгана (засвараас өмнө буруу суусныг цэвэрлэнэ; хүний зураг, нөгөө хайрцаг хөндөгдөхгүй).
  **DEPLOYED 2026-10-05** — worker `696e3272` = main `605a35fd` (миграцгүй, Pages хөндөөгүй).  Өмнөх шошгогүй worker `4737bfcc`
  (10-04) нь main `a840b034`-ийн backend гэдгийг esbuild-ийн `a(fn,"нэр")` нэрсийн олонлогоор баталсан (5246 функц ижил) — тэр
  deploy нь амралтын өдрийн чөлөөний `/stats pending_leave` ба ROOT бүлгийн (0372) кодыг продоос аль хэдийн буцаасан.
- **CR (Өөрчлөлтийн хүсэлт) загвар — толгой нүдэнд суудаг байсан (2026-10-12, main `a9bcb6e5`).** `MGL-WT-CR-002` (үндсэн төсөл 38)
  дээр М.Монголжин зурахад гарын үсэг хар-хөх (#0F243E) ТОЛГОЙН «Гарын үсэг: (Sign)» нүдэнд суугаад харагдахгүй, тэр нүд «зурагдсан»
  гэж түгжигдэж, түүний жинхэнэ мөр самбарт огт гарахгүй байв.  Шалтгаан: `isPureCaption` «(Sign)», «(Perpared by)»-ыг цэвэр шошго гэж
  танихгүй → багана хэлбэр бүтэлгүйтэж мөрөн дотрох хэлбэрт унаж толгой нүдийг өөрийг нь хайрцаг болгосон.  Засвар (`docxSign.ts`):
  хаалтан доторх ЛАТИН тайлбар (`LATIN_GLOSS_RE`) шошгоны хэсэг; бараан дүүргэлттэй нүд (`darkFill`) ба үүрэг↔«Гарын үсэг»-ийн хооронд
  «Албан тушаал/Огноо» толгойтой мөр хэзээ ч хайрцаг биш; **захиалагчийн мөр** («Захиалагчаас баталсан: (Approved by client)»,
  `SignSlot.client`) — хэн ч зурахгүй (`CLIENT`), захирлын «Батлах» тийш очихгүй, тоололд орохгүй («Захиалагч зурна»); Google Docs
  файлыг дахин хадгалж `mgl-sign-…` нэрийг «imageN.png» болгосон ERP гарын үсгийг `descr="MGL ERP · …"`-ээр таньж (`erpDescr`) хэн
  зурсныг үйл явдалтай ±2 мин тулгана (`eventForDescr`); зурах үед тухайн хүснэгтийн «Гарын үсэг» толгойд буруу суусан манай зургийг
  (бидний нэмсэн хоосон догол мөртэй нь) цэвэрлэнэ (`strayStampEdits`).  Хэмжсэн: 75 бодит файлын 58 нь (10-01-ний 40 RFI бүгд) өмнөхтэй
  ЯГ ижил үр дүн; өөрчлөгдсөн 17 бүгд CR — продын өөр 10 CR файл ч ижил алдаатай байсан.  Продын v7254 дээр Word COM-оор шалгасан:
  гарын үсэг Монголжин/Захирал мөрөнд, толгой цэвэр.  Тест: `docxSign.test.ts` +6, `routes/driveSigning.test.ts` +1 (CR бүтэн урсгал).
  **DEPLOYED 2026-10-12** (миграцгүй): worker `fbd0e9ff` = `1c62e352` (R2 snapshot унтраасан) + засвар; Pages `d9a5d801`
  (`index-B72G1GC1.js`) = `b250d7a3` (ASR зургийн огноо) + засвар — main HEAD-ийн ✂ 0395 продод ОРООГҮЙ тул main-аас deploy хийгээгүй.
- **Эрх**: `SIGNING_ROLES` = admin|senior|engineer|architect (`DRIVE_ROLES`-тэй ИХЭР), client/worker 403.  Мөр тус
  бүр `lib/driveSigning.ts` `slotDecision`: өөр хүний нэртэй мөрөнд UI зөвхөн «Гарын үсэг хүсэх» (мэдэгдэл, 30 мин
  давтахгүй), сервер `confirm_name_mismatch` шаардана; батлах мөр зөвхөн захиралд.  **Захирал** = `ceoUserId()`
  (идэвхтэй), эс бөгөөс албан тушаалд захирал/director гэсэн ГАНЦ идэвхтэй admin (`loadApprover`).
- **Хүсэлт** `drive_doc_sign_requests`: `pending → approved | returned (тайлбар заавал) | cancelled`, файлд нэг л
  pending (partial UNIQUE); захирал хүсэлтгүйгээр шууд батлаж болно (approved мөр үүснэ).  Мэдэгдэл
  `doc_sign_requested` (push `approvals`) / `doc_sign_decided` (`my_progress`).  Аудит `drive_doc_sign_events`
  (sign/approve/ask; мөрийн snapshot, бөглөсөн нүд, зургийн sha256 + ХУВИЙН `MEETING_BUCKET`
  `doc-signatures/<fileId>/…` хуулбар, өмнөх/дараах modifiedTime + md5); байршуулалт унавал үйл явдал + хуулбар
  устна.  Зэрэг ажиллагаа: `base_modified_time` → 409 `STALE_FILE`; `drive_doc_sign_locks` (90 с) → 409 `BUSY`;
  түгжээний ДАРАА шинэлгийг дахин шалгана.
- **Хэвлэх / PDF**: `/app/drive-print/:scope/:id/:fileId` (`DrivePrintPage.tsx`, docx-preview, `window.print()`) —
  хөтчийн PDF, Word-тэй пиксел-ижил биш (AGFutura → Calibri); яг хэлбэрээр нь Word-оор татаж хэвлэнэ.  Серверээс
  PDF үүсгэж Drive-д хадгалах зам ХАРААХАН БАЙХГҮЙ.
- **Хамт засагдсан прод алдаа**: `routes/projectDrive.ts` `VERSION_SELECT` ба restore нь `users.name` (байхгүй багана)
  уншдаг байсан тул «Түүх»/«Хувилбарууд» 500 өгдөг байв → `COALESCE(full_name, username)`.
- Тест: `docxSign.test.ts` 21, `docxSignFile.test.ts` 5, `routes/driveSigning.test.ts` 10 (бодит SQLite + хуурамч
  Drive IO — `googleAuth.ts` `node --test`-д ачаалагддаггүй); бодит 20 RFI-ийн бүх мөрийг суулгаж Word COM-оор нээж PDF
  болгосон; mock API + бодит route дээр headless-Chrome 40/40.  Deploy дараалал: D1 0371 → worker → Pages.
  ⚠️ `projectDrive.ts`, `DriveBrowser.tsx`, `DriveFilePreviewDialog.tsx` нь held-back Drive commit `4e752155`-тай давхцдаг.
- **DEPLOYED 2026-10-01** (main `1673586d`; deploy branch `deploy/live-2026-10-01-sign` @ `e5ed0bd0` = live суурь `6e2cecaa` +
  энэ ажил — Drive `4e752155` ОРООГҮЙ хэвээр, тиймээс тэр салбар дээрх цонх нь хуучин «Google Docs болгох» товчтой): D1 0371
  (өмнөх bookmark `00000223-0000044c-000050f7-0ced7218d15eae39fb43aa8836fe12b9`), worker `b52eb26d`, Pages `abde2cbe`
  (`index-igE2TNu4.js`).  Deploy-ийн өмнө хэмжсэн: прод дээр ERP → Drive бичилт 790 (сүүлийнх 10-01) — бичих зам ажилладаг;
  55 ажилтны 11 нь профайлдаа гарын үсэгтэй; захирал (id 2, «Захирал») гарын үсэгтэй.  Дараагийн deploy-ийн суурь = энэ салбар (⚠️ ХУУЧИРСАН — 2026-10-01 `15cb1138`-аас хойш live = main).

### «Баримт бичиг» Word баримтад ГАДНЫН хүн утсаараа гарын үсэг зурах link (migration 0397, 2026-10-12, DEPLOYED — main `ebcd9ffd`, worker `ce34e166`, Pages `b8f4569f` `index-DZnP1Acu.js`)

Эзэн: захиалагч руу НЭГ link → утас/компьютер дээр нээмэгц гарын үсгийн хэсэг → зурмагц манай Drive-ын ЯГ тэр файл
шинэчлэгдэж ажилтны цонх бодит цагаар харна.  0371 (ажилтны гарын үсэг) ба 0381 (RFI/CR/ЗХ-ийн login-гүй link) хоёрыг
НЭГТГЭСЭН — шинэ цөм БИШ: гарын үсэг `docxSignFile.stampDocx`-оор Word ФАЙЛ ДЭЭР суугаад `io.upload`-оор ИЖИЛ Drive файлын
шинэ хувилбар (`drive_doc_sign_locks` түгжээ, ledger `io.record` — `uploaded_by` = link илгээсэн ажилтан), нүүр хуудас нь
0381-ийн `/sign/:token` (`PublicSigningPage`).
- **Хүснэгт `drive_doc_public_links`** (0397; 0381-ийнхийг ЗОРИУД өргөтгөөгүй — CHECK + INTEGER entity_id тул rebuild болно):
  токен SHA-256 л, файл × мөр (`slot_key` + үүрэг/албан тушаал/нэрийн хуулбар), төлөв `pending → signing → signed | revoked |
  expired` (CHECK-гүй, `lib/drivePublicSigning.ts`); `signing` = атом claim (давхар илгээлт/цуцлалтаас), 3 мин-ээс хуучирвал
  дахин pending; файл × мөрөнд нэг амьд link (partial UNIQUE, шинэ link хуучныг ижил batch-д цуцална).  `drive_doc_sign_events`
  + `external_signer_name`, `public_link_id`; гаднын гарын үсэг = `action='external'`, `user_id` = link илгээсэн ажилтан.
  Нотолгоо: зурсан эх PNG (`doc-signatures/<file>/<mark>.png`) + зурсны дараах .docx-ийн яг хуулбар
  (`public-signing/drive/link-<id>-….docx`, sha256) — хоёулаа ХУВИЙН `MEETING_BUCKET`.
- **Токены орон зай 0381-тэй НЭГ:** `index.ts` нь `routes/drivePublicSigning.ts`-ийг 0381-ийн router-оос ӨМНӨ
  `/public/signing`-д mount хийнэ; токен энэ хүснэгтэд байхгүй бол `next()` → 0381.  Замууд: `GET /:token` (Drive руу
  дуудахгүй), `GET /:token/document` (Drive-ын ОДООГИЙН .docx байт — хөтөч `docx-preview`-ээр render; зурсны дараа 24 цаг
  снапшот), `POST /:token/presence` («яг одоо нээлттэй»), `POST /:token/sign` (claim → түгжээ → татах → мөрийг дахин тулгах
  `matchLinkSlot` (түлхүүр + үүрэг, эс бөгөөс ганц таарц) → stamp → upload → signed).  Илгээсэн ажилтан идэвхгүй/эрхгүй,
  төслийн хавтас солигдсон, файл хавтаснаас гарсан, мөр өөр замаар бөглөгдсөн/баримт өөрчлөгдсөн → link бүрмөсөн хаагдана.
  Drive-ын түүхий алдаа гаднын хүнд ХЭЗЭЭ Ч гарахгүй.
- **Ажилтны замууд** (`routes/driveSigningLinks.ts`, `mountDriveSigning`-ийн дотроос — project/main хоёуланд):
  `GET|POST /:id/drive/files/:fileId/signing/links`, `DELETE /:id/drive/signing/links/:linkId` (үүсгэсэн хүн | admin; зурж буй
  link-ийг цуцлахгүй).  GET нь ЗӨВХӨН D1 (`root_folder_id`-оор хүрээлэгдсэн) + `version` = файлын сүүлийн гарын үсгийн үйл явдал.
- **Аль мөрөнд link** (`linkableSlot`): хоосон; батлах (`approver`) мөрөнд зөвхөн манай захирлынх БИШ нэр бичигдсэн үед
  (зөвлөхийн RFI-ийн «Approved by: Э.Цогтбат» — бодит файлуудад хэмжсэн).  Самбарын `can_link` нь үүн дээр «минийх биш,
  бүртгэлтэй ажилтны нэргүй» нэмнэ (ажилтан ERP-д өөрөө зурна).
- **Бодит цаг** = поллинг: самбарын link асуулга амьд link байхад 3 с, үгүй бол 20 с (`staleTime: 0` — таб руу буцмагц);
  `version` нь самбарын түүхийн сүүлийн id-аас их бол баримт + самбар дахин ачаалагдана (өөр ажилтан/захирал зурсан ч);
  pending → signed шилжилтэд toast.  Нүүр хуудас 20 с тутам presence.  WebSocket/DO БИШ.
- **Frontend**: `drive/signing/DriveSignLinkDialog.tsx` (QR — `qrcode.react`, хуулах, Web Share, бодит цагийн төлөв),
  `DriveSigningPanel` мөр бүрт «Захиалагчид link илгээх» / «Link» + амьд link-ийн чип (Шинэ link / Цуцлах), жагсаалтад
  `SigningBadge` «Link хүлээгдэж байна» (`statusesFor.links_pending` — 0397 байхгүй орчинд try/catch).  Нүүр хуудас:
  `document.format === 'docx'` → `features/signing/PublicDocxViewer.tsx` (docx-preview + navy-текст засвар, CSS `zoom`-оор
  утасны өргөнд багтаана, «Миний мөр» — мөрийн үүргийн нүдийг тодруулна; ⚠️ нүдний догол мөрүүд зайгүй нийлдэг тул тулгалт зайг
  бүрэн хасна), албан тушаалын талбар (мөрөнд хоосон бол), доод талын «Гарын үсэг зурах» товч (бүх төрөлд), зурсны дараа гарын
  үсэгтэй баримт (⚠️ viewer-т `key` ЗААВАЛ — эс бөгөөс React хуучин instance-ийг дахин ашиглаж гарын үсэггүй хувилбар үлдэнэ).
- Тест: `routes/drivePublicSigning.test.ts` (7, бодит SQLite 0371+0397, хуурамч Drive, 0381 руу `next()`); бодит RFI (зөвлөхийн
  маягт) + хуурамч Drive дээр CDP E2E 27/27 — утас 390×844 touch: render 1.4 с, зурсанаас Drive-д 0.84 с, ажилтны самбар 1.3 с.
  ⚠️ Prod-ын жинхэнэ Drive/DWD бичилт энэ урсгалаар deploy-ийн үед ШАЛГАГДААГҮЙ (ажилтны урсгалтай ижил `io.upload`).
  **DEPLOYED 2026-10-12** (цэвэр worktree, main `ebcd9ffd` = live `467e39f1` + энэ ажил; chunk олонлог 354/354 тулгасан):
  D1 0397 (0398-ын ДАРАА хэрэгжсэн — wrangler нэрээр тулгадаг; өмнөх bookmark
  `000002a8-000044ff-00005102-44ae6f9945bef919c3a7dd28a753ca3b`), worker `ce34e166`, Pages `b8f4569f` (`index-DZnP1Acu.js`).
  `feat/mgl-ai-qwen35-candidate-phase0` салаа өөрийн migration-ыг 0399/0400 болгон шилжүүлсэн (мөргөлдөөнгүй).
- **2-р шат (2026-10-12, миграцгүй, DEPLOYED — main `00db9f63`, worker `0bc6303b`, Pages `60c45388` `index-CW5KbkE4.js`) — DASR-ын link-тэй адил урсгал, эзний 2 шийдвэр:** (1) link-ийг
  **ЗӨВХӨН admin** үүсгэнэ/цуцална (`ADMIN_ONLY` 403; самбарын `can_link`/`can_manage_links` admin-д л) — бусад ажилтан
  төлвийг харна, ажилтан гарын үсэгтэй файлыг татна; (2) захиалагчийн мөргүй RFI-д (захиалагч асууж, манай тал хариулсан —
  бодит EVERGREEN/Буудлын RFI-д «Хүсэлт гаргасан» мөрөнд гарын үсгийн нүд ОГТ байхгүй) admin «Захиалагчийн мөр нэмэх» →
  `lib/docxClientRow.ts` сүүлийн «багана» блокийн сүүлийн мөрийн `tcPr`/өндрийг хуулж «Захиалагч хүлээн авсан: (Received by
  client)» мөр нэмнэ (vMerge хуулахгүй, w14:paraId хасна, «мөрөн дотор» маягтад `NO_TABLE`), Drive-д шинэ хувилбар + үйл явдал
  `add_client_row`; дахин дарахад байгаа хоосон мөрийг ашиглана (давхар нэмэхгүй), зурагдсан бол 409 `CLIENT_ROW_SIGNED`.
  Word COM-оор нээж шалгасан (5 бодит RFI).  `linkableSlot`: батлах мөр нэргүй + албан тушаалгүй бол (MGL-RFI-MAK-ийн
  захиалагчийн «Баталсан») link болно, «Захирал» гэсэн нэргүй мөр болохгүй.  UI: файл үзэх цонхны толгойд «Гарын үсгийн link»
  (admin) + самбарын товч → НЭГ цонх (`DriveSignLinkDialog`: мөр сонгох — захиалагчийнх эхэнд, «Захиалагчийн мөр нэмэх»,
  QR, түүх — цуцлах / «Гарын үсэгтэй файл» татах `GET …/signing/links/:id/signed-file`).  Нүүр хуудас: зурсны дараа preview +
  «Татах» (`/document?download=1` → attachment; хугацаа 24 ц → 7 хоног); `SignaturePad` буцаах/дахин хийх — Ctrl+Z/⌘Z,
  Ctrl+Y/Ctrl+Shift+Z (бичих талбарт хөтчийн undo хэвээр) + «Буцаах»/↷ товч (DASR-ын хуудсанд ч).  Тест: 9/9 (+add_client_row,
  download, батлах мөрийн дүрэм); бодит EVERGREEN RFI + хуурамч Drive дээр CDP E2E 25/25.
- **3-р шат — зурсны дараа ЗӨВХӨН PDF (2026-10-12, эзэн: «засварлах боломжгүй, зөвхөн PDF харж мэдээллээ авна»; миграцгүй,
  DEPLOYED — `ee104b59` = live `00db9f63` + энэ (main дээр `9297b17c`, өөр сессийн `fdd2af3f` ✂ засвар ПРОДОД ОРООГҮЙ): worker
  `c1f345b0`, Pages `a165ecf9` `index--viHzt8b.js`).**  ⚠️ Бодит Browser Rendering-ийн PDF deploy-ийн үед зурсан link-ээр
  ШАЛГАГДААГҮЙ (токен D1-д hash-аар л) — эхний зурсан link-ийг нээж PDF гарч байгааг батал.  Зурсан link-ийн `GET /public/signing/:token/document` одоо `application/pdf` (`?download=1` → `<нэр>.pdf`
  attachment); зурсан хүнд .docx ХЭЗЭЭ Ч очихгүй.  PDF = снапшот .docx → `/sign/:token/print` (`PublicSigningPrintPage`, Layout/
  ProtectedRoute-ийн гадна) → Browser Rendering (`lib/publicSigningRender.ts` `renderDriveSignedPdf`, `deps.renderPdf`-ээр — route
  puppeteer импортлохгүй) → хувийн `MEETING_BUCKET` `public-signing/drive/link-<id>-signed.pdf` кэш (анх удаа ~5 с, дараа нь шууд;
  `%PDF-` биш эсвэл хуудас `data-print-error` тавьсан бол кэшлэхгүй, 502 → «Дахин оролдох»).  Хэвлэх хуудас эх .docx-ийг
  `?source=1&r=<grant>`-ээр л авна: grant = JWT_SECRET HMAC, link id-д уяатай, 3 мин (`renderGrant`/`verifyRenderGrant`);
  токен ганцаараа → 403.  Payload/sign хариу `signed_format: 'pdf'` → нүүр хуудас `PublicPdfViewer` (pdf.js) + «PDF татах» (PDF
  ачаалагдсаны дараа идэвхжинэ); туггүй хуучин worker-т Word viewer руу унана.  Зурахаас ӨМНӨХ харагдац .docx хэвээр.
  Ажилтны «Гарын үсэгтэй файл» (`signed-file`) .docx хэвээр.  Word-ыг A4-т зурах дүрэм ГАНЦ газар
  `features/projects/drive/docxPrint.ts` (`DrivePrintPage` ч үүгээр): нүдэн дэх зураг нүдэнд багтана (бодит RFI-д 766pt зураг
  хүснэгтийг 1.6× өргөн болгож гарын үсгийн багана PDF-д тасарч байв), хуудаснаас гарсан агуулга `zoom`-оор багтана, Word-ын нэг
  хуудас (section) бага зэрэг өндөр бол (≥60%) нэг A4-т багтаана — эс бөгөөс 4 хуудас, 2 нь бараг хоосон гарч байв (одоо 2 = Word).
  Фонт: Cloudflare Browser Rendering-д Calibri/AGFutura байхгүй (Arial, Liberation, DejaVu) → `local()` орлуулга Arial руу.
  Тест: `drivePublicSigning.test.ts` 11/11 (рендерлэгч эх .docx-ийг grant-аар авна, кэш, 502, PDF биш гаралт, grant хуурамчлал);
  CDP E2E 18/18 (локал Chrome `Page.printToPDF` рендерлэгчтэй).  Deploy дараалал: worker → Pages (шинэ worker + хуучин Pages-д
  зурсан view PDF-ийг Word viewer-ээр нээх гэж унана — хооронд нь хэдхэн минут).

### CR — захиалагч зурсны ДАРАА л «Батлагдсан»; RFI — манай тал батлахад л (migration 0415, 2026-10-19, DEPLOYED — main `db80d772`: worker `1b6c7918`; D1 0415 + Pages `4f6d284e` нь эхний хувилбар `57d4bcf9`-оос, frontend-д дүрэм байхгүй тул дахин гаргаагүй)

Эзэн: манай тал (ажилтан + захирлын «Батлах») дуусахад «Батлагдсан» гэж харагддаг ч захиалагчийн баталгаажуулалт,
гарын үсэг дутуу гэсэн төлөв байгаагүй.  Эхний хувилбар RFI-д ч шаардсан — мөн өдөр эзэн залруулсан: **«RFI-д захиалагч
батлахгүй; манай тал зурсан бол батлагдсан.  Захиалагчийн гарын үсгийг ЗӨВХӨН CR-д»**.
- **Захирлын шийдвэр ХӨНДӨГДӨӨГҮЙ** (`drive_doc_sign_requests.status = 'approved'` = «манай тал баталсан»).  «Батлагдсан» =
  захирал баталсан ∧ `client_sign.complete` — UI нийлүүлнэ (`signing/types.ts` `awaitingClient`).
- Дүрэм ГАНЦ газар **`lib/driveClientSign.ts`** (цэвэр, 8 тест) ↔ frontend `ClientSignState` ИХЭР: **шаардлагатай = ЗӨВХӨН CR**
  (файлын нэр `…-CR-…` / `…_CR_…`, `clientDocKind`); RFI ба бусад Word баримтад захиалагчийн мөр / link байсан ч шаардахгүй.
  CR-ийн захиалагчийн талын мөр = `client` мөр («Захиалагчаас баталсан») ∪ гаднын link-ээр зурсан ∪ амьд/зурсан link-тэй мөр;
  бүрэн = мөр ≥ 1 ба бүгд зурагдсан (гараар оруулсан зураг ч); мөргүй CR = `missing_row`.
- **`drive_doc_sign_summaries` (0415) = жагсаалтын КЭШ** (`slots_json`): `buildState` (самбар нээх, зурах, батлах) ба гаднын
  link-ээр зурах бүрд `refreshClientSummary` дарж бичнэ; `statusesFor` түүнийг амьд link-тэй нийлүүлнэ, мөр байхгүй бол гаднын
  link + хүсэлтийн файлын нэрээс ойролцоолно; хүснэгт байхгүй (миграцаас өмнөх worker) бол try/catch — юу ч унахгүй.  Дүрэм
  уншихад хэрэгждэг тул дүрэм солигдоход хураангуйг дахин бичих шаардлагагүй.
- UI: тэмдэг «Захиалагчийн гарын үсэг дутуу» (шар), самбарын төлөв «Захиалагчийн баталгаажуулалт, гарын үсэг дутуу» + «Манай
  тал баталсан · нэр · огноо» + заавар (admin: мөр нэмэх / link; бусад: «admin илгээнэ»; link явсан бол «link илгээсэн»).
  Мэдэгдэл: захирал баталсан ч дутуу → «Манай тал баталлаа»; захиалагч зурж бүрэн болсон → «Бүрэн батлагдлаа» (link илгээгч +
  батлуулах хүсэлтийн эзэн).
- Тест: `lib/driveClientSign.test.ts` 8, `routes/driveSigning.test.ts` +4, `routes/drivePublicSigning.test.ts` +1; бодит CR/RFI
  файл + хуурамч Drive + түр хуудас дээр headless-Chrome.  Deploy дараалал: D1 0415 → worker → Pages.
  Цэвэр worktree (live main + энэ) — origin/main `4d57929f` (PR #86/#87) ОРООГҮЙ; ажлын модны ирцийн WIP ОРООГҮЙ.

### Зохиогчийн хяналт — «Гэрээний дугаар» + тэнцүү өндөртэй мөрүүд (migration 0363, 2026-09-29, DEPLOYED)

Эзний хүсэлт (маягтын зураг): Шифрийн мөрөнд «Гэрээний дугаар» нүд; Тайлбар ба «Бичиг баримтын төрөл» ИЖИЛ өндөр;
«Ажлын зураг / Хуваарь / Бусад» мөр «Төлөвлөлт / Явц / Тайлан» мөртэй ИЖИЛ өндөр.  Эзний 2 хариулт (AskUserQuestion):
утгыг **тайлан бүрт бөглөнө** (паспортоос БИШ) · **Word-д ч** адил.

- `author_supervision_reports.contract_no` (0363, nullable) — `PATCH /:id` цагаан жагсаалтад (`norm`, ≤200), `r.*`-ээр
  уншигдана; паспортоос нөхдөггүй, хоосон = хэвлэлтэд хоосон нүд.  Frontend `AsrReport.contract_no`,
  `AsrFormState.contract_no?` (хуучин локал ноорогт байхгүй бол `patchBodyFrom` ИЛГЭЭХГҮЙ), i18n `asr.contractNo`.
- Хэвлэлт (`AsrDocument.tsx`, 12 баганат сүлжээ): `Шифр(1) | шифр(3) | Гэрээний дугаар(4) | дугаар(4)`, дараа нь
  `Тайлбар(1)` + `тайлбар(3)` + `Бичиг баримтын төрөл(4)` гурвуулаа `rowSpan=2`, хажууд 2+1+1 чагт × 2 мөр.  Chrome
  rowspan-ийн илүүдлийг ижил агуулгатай хоёр мөрөнд ТЭНЦҮҮ хуваадаг (хэмжсэн: 23.61/23.61, 51.92/51.92 px).
- Word (`buildAsrDocx.ts` `restructureShifrRows`): загварын 1–2-р мөр ГУРВАН мөр болно (A шинэ `<w:tr>`, B/C vMerge
  эхлэл/үргэлжлэл, gridSpan нийлбэр 12).  Word vMerge-ийн илүүдлийг СҮҮЛИЙН мөрөнд өгдөг тул тайлбарын мөрийн тоог
  тооцоолж (25 тэмдэгт/мөр, 207 twip) хоёр мөрөнд тэнцүү `trHeight` тавина — тооцоо дутвал л C бага зэрэг өндөр.
- Засварлагч (`AsrEditor.tsx`): `Шифр | Гэрээний дугаар` → `Тайлбар | Бичиг баримтын төрөл` (row-span ХАСАГДСАН).
- Шалгасан: mock-API headless-Chrome (хэвлэх хуудас, PDF, засварлагчийн autosave PATCH, бодит `buildAsrDocx`) 11/11 ×2
  (богино/олон мөрт тайлбар) + Word COM-оор .docx → PDF харагдац; `npm run verify` ногоон.  Deploy дараалал: D1 0363 →
  worker → Pages (хуучин worker `contract_no`-г үл тоож 200 буцаах тул Pages түрүүлбэл утга чимээгүй алдагдана).
- **DEPLOYED 2026-09-29** (commit `1b5b7422`): D1 0363 (өмнөх bookmark
  `00000208-00001c22-000050f5-d6edec8f046687fdb86f760a24252c05`), worker `64dd073f` (100%), Pages `c63a46e2` (`index-CtaY9ht5.js`).
- **⚠️ 2026-09-30 (0365) — ДЭЭРХ «тайлан бүрт бөглөнө, паспортоос БИШ» ДАРАГДСАН: гэрээний дугаар ТӨСЛИЙН түвшинд.**
  Эзний хүсэлт: ЗХ-д төсөл нэмэх / нэр засах цонхонд нэг удаа бичнэ → тэр төсөл дээрх БҮХ тайлан (хэвлэх, Word, хүснэгт,
  дараагийн тайлан ч) ашиглана.  `projects.asr_contract_no` (0365, `asr_name`-ийн ихэр) = төслийн дугаар; тайлангийн
  `contract_no` (0363) нь шифрийн `shifr`-тэй ЯГ ИЖИЛ **хүчингүйлэгч**: NULL ⇒ төслийг дагана.  Ганц газар
  **`lib/asrContractNo.ts`** (цэвэр, 11 тест бодит SQLite дээр): `resolveAsrContractNo` (`shapeRow` нэгтгэнэ: `contract_no` =
  ХҮЧИН ТӨГӨЛДӨР — хэвлэх/Word/жагсаалт үүнийг уншдаг тул өөрчлөлтгүй; `contract_no_override` — засварлагчийн талбар ЗӨВХӨН
  үүнийг харуулна; `contract_no_source`; `project_contract_no`), `PROJECT_CONTRACT_SQL` (`listSql`/`ONE_SQL`-ийн скаляр дэд
  асуулга).  **Шифрээс ялгаатай нь илгээх үед ХӨЛДӨХГҮЙ** (`allocateAndSubmit` хөндөгдөөгүй) — илгээгдсэн тайлан ч төслийн
  одоогийн дугаарыг авна.  Тохируулах хоёр орох цэг: `POST /author-supervision/targets` `contract_no`
  (`CreateAsrProjectDialog`, шифртэй хамт) ба `PATCH /author-supervision/projects/:id/name` `asr_contract_no`
  (`AsrProjectNameDialog`; `asr_name` ба `asr_contract_no` тус тусдаа сонголттой, ядаж нэг нь заавал).  **Шинэ, хоосон биш
  дугаар тогтоход тэр төслийн тайлангуудын гараар бичсэн `contract_no`-г СЕРВЕР цэвэрлэнэ (NULL)** — бүх тайлан төслийг
  дагана (эс бөгөөс хуучин гар утга шинэ дугаарыг чимээгүй дарна); ижил дугаарыг дахин хадгалахад, дугаарыг ХАСАХАД тайлангийн
  утга хөндөгдөхгүй (`planContractNoUpdate`).  Засварлагч (`AsrEditor.tsx`): `form.contract_no` = `contract_no_override`
  (`formStateFrom`, ⚠️ хүчин төгөлдөр утгыг оруулбал autosave override болгож бичнэ), төслийн дугаар харагдах утга + «Авто» chip
  (`projectContractNo` prop — `AsrEditorShell` `GET /projects/:id`-ийн `SELECT *`-ээс; шинэ хадгалаагүй тайланд ч).  Шалгасан
  2026-09-30 scratch prod-хуулбар (0282–0365) дээр: API E2E 32/32 + headless-Chrome UI 25/25 (нэмэх цонх, нэр засах цонх,
  засварлагч Авто/override/цэвэрлэх autosave, баримтын харагдац) — Word/PDF-ийг ажиллуулаагүй (`buildAsrDocx.ts`,
  `AsrDocument.tsx` нь өөр агентын WIP байсан; тэд `entry.contract_no`-г уншдаг тул хэвээр).  **DEPLOYED 2026-09-30** (`a22d2d2b`, release `ab61760c`: D1 0365 → worker
  `5e17620d` → Pages `5b3a2398`; 0365-аас өмнө worker шинэ SQL-ээ унагана: `projects.asr_contract_no` байхгүй).

### Зохиогчийн хяналт — ХАБ-ын танилцсан баталгаа (2026-09-21, migration 0329)

«Шинэ тайлан» ба засварлагчийн ХООРОНД заавал орох алхам (эзний хүсэлт): ХАБ-ын мэдээллийг уншина → «уншиж ойлгосон» чагт (2026-09-28-наас гүйлгэлтийн хаалтгүй — чагт шууд идэвхтэй, эзний хүсэлт) → гарын үсэг (`SignatureCapture`, тайлан бүрд ШИНЭЭР) → баталгаажуулна → зөвхөн тэгж байж ноорог нээгдэнэ. Гурван орох цэг (`/app/asr` жагсаалт, төслийн харагдац, төслийн таб) бүгд `useAsrSafetyGate()` (`frontend/src/features/projects/asr/useAsrSafetyGate.tsx` → `AsrSafetyDialog.tsx`) -аар дамжина.

- **Сервер тал UI-д итгэдэггүй.** `routes/asrSafety.ts` нь `/api/author-supervision`-ы ХОЁР ДАХЬ mount (`index.ts`-д үндсэн router-ээс ӨМНӨ): `GET /safety` (бичвэр + SHA-256 hash), `POST /safety/acknowledgements` (`confirmed: true` + өөрийн upload-ын `/media/<sub>-…` гарын үсэг + одоогийн хувилбар/hash, эс бөгөөс 400/409 `STALE_CONTENT`), ба `POST /projects/:projectId` дээрх **middleware хаалт** — хүчинтэй `safety_ack_id` (өөрийн, хэрэглээгүй, 24 цагийн дотор, төслийн зөрүүгүй) байхгүй бол 403 `SAFETY_ACK_REQUIRED`; амжилттай 201-ийн дараа баталгааг `client_uuid`-аар олдсон тайлантай холбоно (`report_id`, partial UNIQUE). `client_uuid` аль хэдийн байвал (idempotent дахин илгээлт) хаалт алгасна. Үндсэн `authorSupervision.ts`-ийн create handler ХӨНДӨГДӨӨГҮЙ — Hono ижил замын handler-уудыг дарааллаар залгадаг, `c.req.json()` кэшлэгддэг.
- **Бичвэр = `backend/src/lib/asrSafety.ts` `ASR_SAFETY_CONTENT`** (ганц эх сурвалж, хувилбартай; hash нь `version+title+sections+confirmText`). ⚠️ **2026-09-21-ний байдлаар `placeholder: true`** — компанийн албан ёсны ХАБ-ын заавар ба зөрчсөн үеийн хариуцлагын хэллэг ERP-д БАЙХГҮЙ байсан тул зохиогоогүй; UI шар анхааруулга харуулна. Эзний бичвэр ирмэгц хэсгүүдийг солих, `placeholder: false`, `version` өсгөх — хуучин баталгаанууд хуучин hash-аараа үлдэнэ.
- Хүснэгт `asr_safety_acknowledgements` (user_id · project_id nullable · content_version · content_hash · signature_url · acknowledged_at · report_id · used_at); `users`/тайлан руу FK ЗОРИУД байхгүй (0279-ийн шалтгаан). Тайлан устсан ч баталгаа түүх болж үлдэнэ.
- Тест: `lib/asrSafety.test.ts` (10, цэвэр); 2026-09-21-нд тусгаарлагдсан worktree + scratch D1 дээр API 21/21 + headless-Chrome E2E 18/18 + 4/4 (гурван орох цэг). **Deploy ХИЙГЭЭГҮЙ.**

### Зохиогчийн хяналт — төслийг НЭГТГЭХ (`projects.asr_merged_into`, migration 0340, 2026-09-23)

Нэг барилга ERP дээр ангилал тус бүрээр **тусдаа `projects` мөртэй** (EVERGREEN = AZ #41 ба ZA #37,
хоёулаа үндсэн төсөл 25) бөгөөд талбайн хяналт хоёуланд нь бүртгэгдчихсэн байв: AZ дээр 10, ZA дээр 3.
Инженер «Шинэ тайлан» дарахад аль EVERGREEN-ийг сонгохоо мэдэхгүй, `/app/asr` самбарт нэг барилга
хоёр мөр болж харагдана.  Эзний шийдвэр: **ЗХ-ийн хувьд нэг барилга = нэг төсөл.**

- **`projects.asr_merged_into`** (nullable, `REFERENCES projects(id)`) — эх мөр зорилтын id-г тээнэ.
  Уншигч нь ЗӨВХӨН `lib/asrEligible.ts`-ийн `ASR_NOT_MERGED_SQL` (create picker `GET
  /author-supervision/projects`, самбар `/project-summaries`), `ensureAsrProjectAccess`,
  `asrVisitPlanRoutes.ts`-ийн `POST /plans`, `asrBackfill.ts`-ийн `loadMembers`.  **Өөр ямар ч
  модуль үүнийг мэдэхгүй** — Төслүүд хуудас, явц, паспорт, Drive, тайлан, leaderboard бүгд хэвээр.
  Устгал БИШ: `UPDATE projects SET asr_merged_into = NULL WHERE id = 41` бүгдийг буцаана.
- **УНШИХ нь нээлттэй, БИЧИХ нь хаалттай.** Хуучин холбоос/мэдэгдлээр `/app/asr?project=41` нээгдвэл
  жагсаалт хоосон гарах нь «тайлангууд алга болжээ» гэж уншигдана — тиймээс `GET /projects/:id` нь
  `merged_into: {id,name}` буцааж, `can_write` нь `false` болно; `AsrProjectWorkspace` нь зорилт
  руу чиглүүлэгч блок харуулна (`asr.merged*` i18n).  Шинэ тайлан/хуваарь 403.
- **⚠️ Дугаарлалт (0340-ийн үеийн, 0359-өөр ДАРАГДСАН — доорх «багийн харагдац, багаар дугаарлалт»-ыг үз):
  `idx_asr_seq` нь UNIQUE(project_id, seq).** Хоёр багц 1..10 ба 1..3 гэж давхцдаг
  тул зөрүүлэх ЗААВАЛ.  Эзний шийдвэр (2026-09-23): нэгтгэсэн бүртгэлийг **ОГНООГООР 1..13 гэж
  ДАХИН дугаарлав** (хамгийн эртний очилт 2026-05-05 = ASR-001, хамгийн сүүлийнх 2026-09-20 =
  ASR-013), тиймээс 13-ын 12-ынх нь `doc_no` өөрчлөгдсөн — ZA-гийн хоёр батлагдсан тайлан улаан
  дэвтрийн зурагтай байсан ч эзэн бүртгэлийн дараалал чухал гэж үзсэн.  **Миграц нь ГУРВАН
  АЛХАМТАЙ, санамсаргүй биш:** SQLite UNIQUE-ийг мөр тутамд ШУУД шалгадаг тул «байрандаа»
  дугаарлахад дунд нь мөргөлдөнө → эхлээд AZ-гийнхийг 1001+, дараа нь бүгдийг 10001+, эцэст нь
  1..13 болгож буулгана.  Байр суурийг `ROW_NUMBER()` БИШ, корреляцтай `COUNT(*)`-аар (уншдаг
  багана нь `report_date`/`id` — UPDATE хөндөхгүй тул явцын дунд ч тогтвортой).  `seq IS NULL`
  (нөхөж бүртгэсэн хуучин файл) мөрүүд зөвхөн `project_id`-гаа сольдог — тэдний `doc_no` нь файлынх.
- **ЗХ-д төслийн нэр ангиллын дагаваргүй харагдана (2026-09-25, миграцгүй).** «MGL-240506_FURNITURE
  LAND_ZA» → «MGL-240506_FURNITURE LAND» — ЗӨВХӨН харуулахдаа; `projects.name` ба бусад модуль
  хөндөгдөөгүй.  Ихэр `asrProjectName()`: frontend `features/projects/asr/asrProjectName.ts` (самбар,
  жагсаалт, сонголт, хуваарь, засварлагч, хэвлэх баримт, Word, зургийн тэмдэг, нөхөж бүртгэх) ↔ backend
  `lib/asrProjectName.ts` (ЗХ-ийн мэдэгдлүүд).  Дүрэм: төгсгөлийн `[_ -]AZ|ZA|ET|EZ|IZ` (том үсэг).
  API хариу түүхий нэрээ буцаасаар — шинэ харагдац нэмбэл функцээр ороо.
- Дараагийн нэгтгэлт = нэг UPDATE (эх мөрийн тайлангуудыг зөөх + `asr_merged_into`), код
  өөрчлөгдөхгүй.  Шалгасан 2026-09-23: миграцын файлыг эх орчинд нь ажиллуулсан 11 шалгалт
  (сессийн scratchpad, репод БИШ) — самбар «EVERGREEN ZA · 13 очилт», сонголтын цонхонд AZ алга.

### Зохиогчийн хяналт — багийн харагдац, багаар дугаарлалт, ЗХ-ийн нэр (migrations 0358/0359, 2026-09-29)

Эзний 4 хүсэлт + 3 шийдвэр (AskUserQuestion): **баг тус бүр өөрийн дугаарлалт** · нэр засвар **зөвхөн ЗХ-д** ·
Drive-аас **нөхсөн хуучин тайлан ч дараалалд орно**.

- **Багийн харагдац — ГАНЦ газар `lib/asrVisibility.ts`** (`asrVisibleSql(viewer, alias)` + `canSeeAsrReport`):
  admin → бүх тайлан; бусад → тайланд сонгогдсон багийн аль нэгний гишүүн (`user_teams`), эсвэл зохиогч / хамт
  явсан хүн (`asr_report_companions`).  `DRAFT_VISIBILITY` (ноорог = зохиогч + админ) ТУСДАА хэвээр, дээр нь
  нэмэгдэнэ.  Хэрэглэгчийн id-г bind биш ТОО болгож шигтгэнэ (`Number.isSafeInteger` шалгасан) —
  `personVisitsSql` нөхцөлөө хэд давтдаг тул байрлалын bind эвдэрнэ.  Хэрэглэгддэг: `GET /`, `/projects/:id`
  (`listSql(visible)`), `/project-summaries` (очилтын тоо), `/projects/:id/issues`, `/projects/:id/visits`,
  `GET /:id` · `/:id/recordings` · `/:id/pdf` (өөр багийнх 404 — 403 биш), `/stats`, глобал хайлт
  (`search.ts`), MGL AI `asr_reports` entity (+ ноорогийн дүрэм).  Батлах (`canReview`) аль хэдийн багаар
  хязгаарлагдсан тул батлагч үргэлж харна.  Шинэ ЗХ уншилт нэмбэл ЭНЭ функцээр — давтаж бичвэл нэг нь мартагдана.
  Хэвээр: хуваарь (`/plans`) ба нөхөж бүртгэх хуудас (admin+senior-ийн хэрэгсэл) шүүгдээгүй.
- **Самбар (`/stats`)**: «Багаар» (`by_team`), «Бүрдэл» (`review` + `signatures`), «Хамгийн идэвхтэй зохиогчид»
  (`by_person`) нь ЗӨВХӨН админд — бусдад асуулга огт явахгүй, `[]`/`null` буцна; `AsrOverview` нь тэр
  самбаруудыг нууж, үлдсэн самбарыг `lg:col-span-3` болгож, «Та зөвхөн өөрийн багийн тайлангуудыг харж байна»
  тэмдэглэл нэмнэ.  KPI, сарын график, сүүлийн тайлан бүгд үзэгчийн багаар.  **2026-09-29-нд эзний хүсэлтээр
  «Багаар» ба «Хамгийн идэвхтэй зохиогчид» самбар `/app/asr`-аас ХАСАГДСАН** (commit `9ebc1c68`, worker `c4b47040`,
  Pages `595f8983`, `index-BYmm_95b.js`) — «Сүүлийн тайлангууд» бүтэн өргөнтэй, `sec-asr-teams`/`sec-asr-people`
  хайлтаас хасагдсан; backend `/stats` `by_team`/`by_person`-ийг админд тооцсоор (frontend-д уншигчгүй).
- **Төслийн хуудасны «Багаар нэгтгэсэн тайлан» (2026-09-30, зөвхөн frontend, миграцгүй).** Захирал (`admin`) төсөл
  руу ороод баг хамаарахгүй БҮХ DASR-ыг баг бүрээр нэг хуудсан дээр харна — дээрх самбарын «Багаар» (KPI) БИШ, тайлангийн
  жагсаалтыг өөрийг нь бүлэглэнэ.  2026-09-30-ны самбарын дараа энэ нь самбарын «Тайлангууд» хэсгийн нэг харагдац
  (админд л «Багаар»; өгөгдмөл нь «Он цагаар» — доорх хэсгийг үз) → `AsrTeamGroups.tsx` (баг бүр хураагддаг карт: төлөвийн тоо, сүүлийн
  огноо, доор нь ижил `AsrList`) ← цэвэр бүлэглэлт `features/asr/lib/groupReportsByTeam.ts`.  Шинэ API/backend ХЭРЭГГҮЙ — админд
  `asrVisibleSql` аль хэдийн бүгдийг өгдөг.  **Олон багийг хамарсан тайлан баг БҮРИЙН бүлэгт орно** (нийлбэр > нийт;
  UI тэмдэглэл гаргана); самбарын «Багаар»-аас баг сонгосон шүүлт идэвхтэй бол зөвхөн тэр багийн бүлэг үлдэнэ (`onlyTeam`).
  Шалгалт: `npm run check:asr-team-groups` (`verify`-д).  Төлөвийн өнгө/шошго нь `projects/asr/asrStatusStyle.ts`.
- **Төслийн ЗХ-ийн САМБАР — хугацаа сонгох + «Хэн хэзээ явсан» (2026-09-30, зөвхөн frontend, миграцгүй).** Эзний
  гомдол: дэлгэрэнгүй хуудас ойлгомжгүй, хэн хэзээ явсныг суугаад тайлах хэрэгтэй, «X сарын X-ээс X хүртэл» гэж шууд
  харах огнооны сонголтгүй.  `/app/asr?project=` ба төслийн «ЗХ» таб хоёулаа НЭГ `features/asr/board/AsrProjectBoard.tsx`
  (хуучин `AsrTeamVisitsTree` / `AsrVisitsPanel` / `AsrEntriesView` / `lib/groupTeamPeople.ts` УСТСАН).  Дээрээс доош:
  (1) `AsrRangeBar` — ◀ «2026 оны 9-р сар» ▶ + Бүх хугацаа / Энэ сар / Өмнөх сар / Сүүлийн 3 сар / Энэ он + «Эхлэх –
  Дуусах»; доорх БҮХ зүйлийг шүүнэ; URL-д `?from=&to=` (төслийн хуудсанд `asr_from`/`asr_to` — бусад табтай мөргөлдөхгүй;
  `AsrPage` тайлан нээх/хаах/үүсгэхдээ дамжуулна, `projectQs`); ◀ ▶ бүтэн сарын мужийг САРААР, бусдыг хоногоор шилжүүлнэ;
  (2) 4 хавтан: Талбайн очилт (+ өмнөх ижил хугацаа, + бусад төрөл), Явсан хүн (+ баг, хамгийн олон), Сүүлд явсан
  («N хоногийн өмнө»), Батлалт хүлээж буй (дарвал жагсаалт `submitted`-ээр шүүгдэнэ); (3) `AsrWhoWhenChart` — мөр бүр
  нэг хүн, хэвтээ тэнхлэг = хугацаа, цэг = нэг өдрийн тайлан (дүүрэн = талбай, хөндий = бусад төрөл, тоотой = тэр өдөр
  хэд хэдэн; дарвал тайлан/popover), нэр дарвал жагсаалт тэр хүнээр; ≤62 хоногт 7 хоногийн шугам + амралтын өдрийн
  сүүдэр; `AsrTeamBreakdown` (багийн өнгөтэй зурвас, дарвал шүүнэ); (4) «Тайлангууд» — Он цагаар (сараар бүлэглэсэн,
  `AsrReportTimeline`, «Зөвхөн энэ сар») · Багаар (админ) · Хүснэгт (`AsrList`), төрөл + төлөвийн шүүлт.  Бүх тоо
  аль хэдийн татагдсан `useAsrList`-ээс КЛИЕНТ дээр — серверийн `/visits` хугацааны параметргүй; дүрэм нь серверийнхтэй
  ИЖИЛ («очилт» = `submitted|approved` талбайн хяналт, хүн = зохиогч + хамт явсан) — ГАНЦ газар `features/asr/lib/asrBoard.ts`,
  хугацааны арифметик `lib/asrRange.ts` (UTC, `YYYY-MM-DD`); `npm run check:asr-board` (`verify`-д).  `/visits`-ийг зөвхөн
  хамт явсны НЭРИЙГ id-тай нь авахад дууддаг (`companion_ids`/`companion_names` хоёр тусдаа `group_concat` тул дараалал
  баталгаагүй).  Шалгасан: mock API + headless-Chrome (1440/1280/390px, гэрэл/харанхуй) харилцан үйлдлийн 31 шалгалт.
  **DEPLOYED 2026-09-30** (`a2a4a74e`, release `9fb53249`: worker `5eba3966`, Pages `49f07e6e` `index-DrIYN1jU.js`, миграцгүй).
- **Засварлагчийн «Тайлбар» заавар (2026-09-30, зөвхөн frontend).** «Засварлах» горимд «Тайлбар» шошгын доор
  «(Тухайн үед угсралтын ямар ажил хийгдсэн)» — хаалтанд, налуу, «Тайлбар»-аас жижиг (11px энгийн жин), `AsrDocKit` `DocLabel`-ийн
  `hint` (хаалтыг компонент нэмнэ).  ⚠️ `text-label` нь base давхаргад `uppercase` авдаг тул баримтын горимын бүх дэд шошго
  (`DocLabel`/`DocBand`/`DocHead`-ийн `en`, «Авто» чип) `normal-case` авсан — эзэн 2026-09-30 «том үсгээр бичигдсэнийг жижиг
  болго».  ЗӨВХӨН засварлагч — хэвлэх баримт, серверийн PDF, Word-д ОРООГҮЙ; DEPLOYED `ce571486` (worker `b87f04dc`, Pages `33ee9074`).
- **Дугаарлалт = (төсөл, БАГ) тус бүрд ОГНООНЫ дарааллаар 1..N** (`lib/asrNo.ts`): баг = тайлангийн ЭХНИЙ баг
  (`rt.sort_order, rt.team_id`) — толгойн Doc. No. / файлын нэрийн тэр баг; `doc_no` = **`DASR-<БАГ>-NNN`**
  (`formatAsrDocNo(seq, teamCode)`; баггүй бол `DASR-NNN`); шинэ багана `author_supervision_reports.seq_team_id`;
  индекс `idx_asr_team_seq` UNIQUE(project_id, seq_team_id, seq) — хуучин `idx_asr_seq` УСТСАН.  Ноорог биш
  (`status <> 'draft'`) бүх тайлан дугаартай — буцаагдсан, нөхсөн хуучин ч.  Эрэмбэ: огноо → хуучин дугаар (ижил
  дараалалд байсан бол; ижил өдрийн тайлангууд байраа солихгүй) → id.  **`planAsrNumbering` (цэвэр) +
  `renumberAsrProject(db, projectId)`** — өөрчлөгдөх мөрийг л `seq = -id, seq_team_id = NULL` байрлалд аваачаад
  эцсийн утгыг НЭГ batch-д бичнэ, `asr_issue_resolutions.prev_doc_no`-г дагуулна, `updated_at` хөндөхгүй,
  UNIQUE мөргөлдвөл нэг удаа дахин уншина.  Дуудагч: `allocateAndSubmit` (ТҮР `MAX+1`-ийн дараа, retry-ээс
  гадуур), `PATCH /:id` (огноо эсвэл баг өгөгдсөн, ноорог биш), `DELETE /:id` (завсар хаагдана), нөхөж бүртгэх
  импорт.  ⚠️ Дугаар ХӨДӨЛГӨӨНТ — баталсан/хэвлэсэн тайлангийн дугаар ч өмнөх огноотой тайлан орход шилжинэ
  (эзний хүссэн зан төлөв: «12 сарынх автоматаар 2 болно»).  Миграц 0359 одоо байгаа мөрүүдийг ИЖИЛ дүрмээр
  нэг удаа засна (doc_no-д түр эрэмбийн түлхүүр → корреляцтай COUNT → бичвэр); тест нь миграц ба
  `renumberAsrProject` ИЖИЛ дугаар гаргадгийг баталдаг.  Прод хуулбар дээр: EVERGREEN-ийн 07-01-ний тайлан
  DASR-016 → DASR-BB-007, дараагийн 9 нь +1; бусад төсөл баг тус бүр 001-ээс.  `asrTemplate.ts` / backend
  `asrFileStem`-ийн «`seq` NULL ⇒ файлын дугаар» салаа одоо зөвхөн хамгаалалтын нөөц.
- **ЗХ-ийн нэр — `projects.asr_name` (0358)**, `PATCH /api/author-supervision/projects/:id/name` (admin; хоосон/null
  = анхны нэр рүү, ≤200).  `projects.name` ХӨНДӨГДӨХГҮЙ — Төслүүд хуудас, явц, Drive, тайлан хэвээр.  Backend
  `asrLabelSql(alias)` = `COALESCE(NULLIF(TRIM(asr_name),''), name)` ЗХ-ийн жагсаалт, сонголт, самбар, хуваарь,
  мэдэгдэл, нэгтгэлийн зорилтын нэрэнд; `/project-summaries` ба `GET /projects/:id` нь `base_name` + `asr_name`-ийг
  ч буцаана.  Frontend `asrProjectLabel({name, asr_name})`; баримтын «Төслийн нэр», зургийн тэмдэг, Word нь
  `projectLabel` (засварлагч `GET /projects/:id`-ийн `SELECT *`-ээс `asr_name` авна).  ⚠️ **Doc. No. ба файлын
  нэрийн PROJECT-ID (`asrProjectId`) нь `projects.name`-ээс ХЭВЭЭР** (`codeName`) — «EVERGREEN» гэж засахад
  MGL-251006 алга болохгүй.  UI: `features/asr/AsrProjectNameDialog.tsx`, самбарын төслийн мөр бүр ба
  төслийн харагдацын гарчгийн харандаа (admin).  Хүснэгтийн нэрийн нүд `w-full max-w-0` (урт нэр «…»), огноо
  `whitespace-nowrap` — эс бөгөөс товч нэмэгдэхэд хүснэгт панелаас хальж байв.
- Тест: `lib/asrNo.test.ts` (20: төлөвлөгч, миграц 0359-ийг SQLite дээр прод хэлбэрийн өгөгдөлтэй, D1 адаптераар
  `renumberAsrProject`, `asrVisibleSql`).  Прод export (2026-09-29, зөвхөн уншиж) + 0358/0359 scratch D1 дээр:
  API E2E 63/63 (5 хэрэглэгч — admin/BB/BA/HAS; stats, жагсаалт, 404, хайлт, нэр, дугаар шилжих/устгах) +
  нөхөж бүртгэх импорт (хуучин тайлан DASR-BB-001, legacy_doc_no хэвээр) + headless-Chrome 23/23 (админ/ББ
  самбар, нэрийн цонх, 390px) + хэвлэх хуудас 5/5 (Doc. No. `MGL-251006_DASR_BB_016`, нэр = ЗХ-ийн нэр).
  **DEPLOYED 2026-09-29** (release `801d437c`, commit `6e4497e9`): D1 0358 + 0359 (өмнөх bookmark
  `00000208-0000119a-000050f5-1b10f277865f767619ace24c7337edf3`; прод дээр 41 дугаартай тайлан, EVERGREEN 07-01 =
  DASR-BB-007), worker `4c8e24c6` (100%), Pages `c8e41fc2` (`index-FwA-ukoL.js`).  Нэг release-д: засварын явц =
  олгосон хувь (`0ebb9ff7`), ирцэд ≤ 2 төсөл (`23118ebb`), толгойн «Буцах» товч (`d3b63399`), Revit add-in 1.3.0
  бичвэр (`6434083b`, add-in-ийг build/багцлаагүй).

### Зохиогчийн хяналт — тайлангийн 4 ТӨРӨЛ (migration 0362, 2026-09-29, DEPLOYED — release `19eeea2b`)

Эзний жагсаалт: **Талбайн хяналт · Цахим уулзалт · Зургийн өөрчлөлт · Оффис уулзалт** (UI-ийн дараалал 2026-09-30-нөөс эзний хүсэлтээр **Талбай → Оффис → Зургийн өөрчлөлт → Цахим** — `ASR_REPORT_TYPES` массивын дараалал, frontend/backend ИХЭР; шүүлтүүр, төрлийн цонх, засварлагч, хэвлэх/Word, `by_type` бүгд дагана); эзний 3 хариулт (AskUserQuestion):
одоогийн маягт = талбайн хяналт хэвээр · нэг тайлан ЯГ НЭГ төрөл · талбайн бус төрөлд **ХАБ асуухгүй** ба **самбарт тусад нь
тоолно**; цахим уулзалтад **платформ** бичнэ. Улаан дэвтэр, дугаарлалт (`DASR-<БАГ>-NNN` — бүх төрөл НЭГ дараалалд), батлах
урсгал бүх төрөлд ИЖИЛ.
- `author_supervision_reports.report_type` (`site` | `online` | `drawing_change` | `office`, NOT NULL DEFAULT `'site'` — хуучин
  47 тайлан бүгд site) + `meeting_platform` (зөвхөн online-д, бусад төрөлд сервер NULL болгоно). **CHECK ЗОРИУД байхгүй**
  (`users.work_schedule`-ийн сургамж) — цагаан жагсаалт `lib/asrReportType.ts` (цэвэр, 6 тест) ↔ frontend `asr/types.ts`
  `ASR_REPORT_TYPES` ИХЭР.
- **ХАБ-ын хаалга** (`routes/asrSafety.ts` middleware) зөвхөн `site`-д; `report_type` ирээгүй = site (хуучин клиент хэвээр
  ажиллана), танигдахгүй утга = 400. Талбайн бус төрөлд хүчинтэй `safety_ack_id` ирвэл ч тайлантай ХОЛБОНО (төрлөө сольсон
  ноорог). ⚠️ POST-ийн хариун дахь `has_safety_ack` нь холбохоос ӨМНӨХ (middleware `next()`-ийн дараа холбодог) — GET/PATCH зөв.
- **«Талбайн хяналт» РУУ шилжих** (`PATCH /:id`): зохиогч зөвхөн тайланд ХАБ-ын баталгаа холбогдсон үед (эс бөгөөс 409
  `SAFETY_ACK_REQUIRED` — оффис гэж үүсгээд талбай болгох тойрох замыг хаана); админ чөлөөтэй. `GET /:id` → `has_safety_ack`;
  UI ихэр `AsrEditorShell` `canPickSite`. Илгээхэд online + платформгүй → 400 (`reportTypeProblem` ↔ `missingOf`).
- **«Очилт» = ЗӨВХӨН site** (`ASR_SITE_SQL`): `/stats`-ийн visits/this_month/…, by_team, by_month, by_person;
  `/project-summaries` `total_visits`/`last_visit` (`report_count` = бүх төрөл → UI «N тайлан»); `/projects/:id/visits`.
  Бүх төрлөөр: approved/awaiting, улаан дэвтэр, гарын үсэг, зураг (`totals.reports` — «Бүрдэл»-ийн хуваарь), recent
  (+`report_type`), шинэ `by_type` (4 мөр үргэлж). ХӨНДӨӨГҮЙ: `teamProductivityStore.ts` (бүх төрлийн тайланг жагсаасаар).
- UI: «Шинэ тайлан» → `AsrReportTypeDialog` → site бол `AsrSafetyDialog` → засварлагч (`useAsrSafetyGate` одоо
  `{reportType, safetyAckId}` буцаана; 3 орох цэг). Засварлагч/хэвлэх/Word-д «Хяналтын төрөл» мөр эхний мөрийн ДАРАА (4 чагт,
  online-д «(Zoom)»; Word `formTypeRow` 1+11 gridSpan ↔ print `asr-typecell`); online-д «Платформ» мөр + Zoom/Google
  Meet/Microsoft Teams/Viber чип. Жагсаалт/сүүлийн тайланд `AsrTypeBadge` (site-д харагдахгүй); самбарт «Төрлөөр»
  (`sec-asr-types`). MGL AI `asr_reports` entity-д `report_type`, `meeting_platform`.
- Шалгасан 2026-09-29 прод-хуулбар D1 (+0360/0361/0362) дээр: API E2E 42/42, headless-Chrome 31/31 (төрлийн цонх, ХАБ зөвхөн
  site, засварлагч, autosave-д платформ арилах, A4 баримт, хэвлэх, админ самбар, 390px), `npm run verify` ногоон. Мөн
  `AsrTeamVisitsTree`-ийн давхардсан огнооны React key (нэг өдөр хоёр очилт) засагдсан. Deploy дараалал: D1 0362 → worker →
  Pages (шинэ worker `report_type`/`meeting_platform` баганыг уншиж бичдэг тул миграц ЭХЛЭЭД; хуучин worker шинэ баганад
  саадгүй).

### Зохиогчийн хяналт — «Оффис уулзалт»-ын маягт (migration 0367, 2026-09-30, DEPLOYED — `729394c7`)

Эзний хүсэлт (Word уулзалтын тэмдэглэлийн зураг — Өдөр · Цаг · Уулзах газар · Оролцогч тал · Уулзалтын зорилго): тайлангийн
төрөл `office` бол маягт өөр.  Салаалалт ГАНЦ функц — frontend `types.ts` `usesMeetingForm(type)` ↔ backend
`lib/asrMeeting.ts` `usesMeetingForm` (одоогоор зөвхөн `office`; цахим уулзалтад өргөтгөх бол нэг мөр).  Засварлагч
(`AsrEditor`), хэвлэх/PDF (`AsrDocument`), Word (`buildAsrDocx`) гурвуулаа үүгээр салаална; баримтын ХАТУУ шошго
`meetingDoc.ts` `MEETING_LABEL`.
- **Маягт:** «Тайлбар» + «Бичиг баримтын төрөл» мөр ГАРАХГҮЙ → оронд нь `Уулзах газар | Цаг` («13:00-15:30»),
  `Оролцогч тал` (гадны оролцогчид, чөлөөт бичвэр, мөр таслал хадгална), `Уулзалтын зорилго`.  «Өдөр» = эхний мөрийн «Он
  сар өдөр» (давхардуулаагүй).  «Хяналтаар явсан» (багийн чагт) → **«Оролцсон»**: зохиогч (албан тушаалтай, хасагдахгүй) +
  БҮХ идэвхтэй ажилтнаас хайж сонгосон хүмүүс, баримтад мөр бүрд «Албан тушаал Нэр».  ⚠️ 2026-10-08-наас (эзэн) «Шалгасан |
  Баталсан» мөр ба «Уулзалтын агуулга»-ын багийн чагт ГАРАХГҮЙ (засварлагч, хэвлэлт, Word — Word-д загварын 4 ба 10-р мөр
  хасагдана; багийн чагт засварлагчид ОГТ гарахгүй).  Баг ХЭВЭЭР хадгалагдана — тайлан үүсэх агшинд сервер зохиогчийн багийг
  тэмдэглэдэг; хоосон бол PATCH/илгээх үед `fillMeetingTeams` (`lib/asrCompanionStore.ts`) зохиогчийн бүх баг (үндсэн нь эхэнд) +
  «Оролцсон» хүмүүсийн ҮНДСЭН багаар бөглөнө (юу ч устгахгүй).  Хэн нь ч багт байхгүй бол оффис уулзалт баггүйгээр (`DASR-NNN`,
  админ батална) илгээгдэнэ — «дор хаяж нэг баг» шалгалт (сервер + `missingOf`) зөвхөн бусад төрөлд.  **DEPLOYED
  2026-10-08** (commit `472cfe08`: worker `27c27d88`, Pages `2ab6388e` `index-DM8e8OU9.js`; миграцгүй).
- **Оролцогчид = `asr_report_companions` (0351)** — шинэ хүснэгт БИШ, тиймээс харагдац (`asrVisibleSql`) ба «хэн хэзээ явсан»
  самбар автоматаар.  `PATCH /:id` нь ШИНЭ төрөл office бол `replaceCompanions(…, {scope:'all', max: 40})` (бусад нь өөрийн
  баг, 8); `GET …/companion-candidates?scope=all`.  `planCompanionReplace` хязгаарыг зөвхөн жагсаалт УРТСАХАД шалгана —
  12 оролцогчтой оффис уулзалтыг талбай болгоход autosave 409-д унахгүй.  ONE_SQL `author_position`, `loadCompanions`
  `u.position` буцаана.
- **«Ажлын тайлан» → «Уулзалтын агуулга»:** асуултгүй ганц бичвэр = `work_report` багана (дуу бичлэгийн транскрипт ч
  тийшээ).  Дэд асуултууд (үүрэг даалгавар, алдаа дутагдал, өмнөх тайлангийн шийдэл) гарахгүй.  Илгээх биетийн шалгалт
  (`hasBody` ↔ `missingOf`) office-д = `work_report` эсвэл `meeting_purpose`.
- **Гарын үсэг:** «Талбайн инженер» → **«Захиалагч тал»** (ижил `sig_site_*`; Word-д загварын 14-р мөрийн бичвэр, 9-р мөрийн
  «Ажлын тайлан» тууз солигдоно).  «Архитектор, Инженер» → **«Манай тал»** (2026-10-08, эзэн): «Оролцсон» хүмүүсээс НЭГИЙГ
  сонгоно (`AsrMeetingSignerPicker`), албан тушаал нь өөрөө гарна; толгой «Тал | Албан тушаал, нэр».  Миграцгүй — хадгалалт
  хуучин `sig_arch_name` (түүхий бүтэн нэр), албан тушаалыг хэвлэлт/Word `meetingSigner`-ээр оролцогчдын жагсаалтаас НЭРЭЭР
  олно (оролцогчоос хасагдсан / гаднын холбоосоор өөр нэр бичигдсэн бол зөвхөн нэр, засварлагч анхааруулна).  **DEPLOYED
  2026-10-08** (commit `597c0ca8`, зөвхөн Pages `b286b35a` `index-DFHbQOu1.js`; worker хөндөгдөөгүй `bebb0ddc` — тэр нь бусад
  агентын commit хийгээгүй `allocation-label` STAFF өөрчлөлтийг аль хэдийн агуулсан, build нь ажлын модноос тул тэдний frontend ч орсон).  **Улаан дэвтэр ОГТ гарахгүй** (засварлагч, хэвлэлт, Word, жагсаалтын badge, илгээх
  сануулга); `requiresRedBook` аль хэдийн site-only.
- **Хүсэлтийн хүснэгтүүд «0.1 Захиалагч / 0.2 Гүйцэтгэгч» (migration 0396, 2026-10-12, эзний Word тэмдэглэлийн зураг,
  DEPLOYED — `8a6524f3`: D1 0396, worker `e1a3dcf4`, Pages `742004f2` `index-CFm7cQpU.js`):** «Уулзалтын агуулга»-ын эхэнд хоёр хүснэгт — сонголттой оршил + `№ | Хүсэлт гаргагч (нэгтгэсэн нүд) | Тайлбар` +
  хар-хөх хөлийн мөр; доор нь `work_report` «Бусад тэмдэглэл».  Хадгалалт НЭГ багана `meeting_requests_json`
  (`{client|contractor: {intro, items[]}}`; ариутгагч `lib/asrMeeting.ts` `sanitizeMeetingRequests` — хоосон мөр хадгалагдана,
  ≤60 мөр, ≤2000 тэмдэгт; `shapeRow` → `meeting_requests`).  Хэвлэлт/Word хоосон мөрийг алгасаж дахин дугаарлана
  (`meetingDoc.ts` `meetingRequestSections` — ГАНЦ дүрэм); засварлагч `AsrMeetingRequests.tsx`, хэвлэлт `AsrDocument.tsx`
  `MeetingRequestTable`, Word `buildAsrDocx.ts` `meetingRequestXml` (бичих нүдэн ДОТОРХ үүрлэсэн хүснэгт — мөр задлах regex-ийн
  ДАРАА орно).  Илгээх биет: агуулга ∨ зорилго ∨ хүснэгтэд бичвэр (`hasMeetingRequests` сервер ↔ `missingOf`).  Тест
  `asrMeeting.test.ts` +3; mock-API headless-Chrome (хэвлэх, засварлагч autosave) + Word COM-оор .docx нээж шалгасан.  Deploy
  дараалал: D1 0396 → worker → Pages.
- **«Оролцогч тал»-ын МАНАЙ талын мөрүүд АВТОМАТ (2026-10-12, зөвхөн frontend, DEPLOYED ижил release-д):** «Оролцсон» хүн бүрд
  `«Эм Жи Эл И Эн Си» ХХК-ийн <албан тушаал> <Б.Нэр>` (компани = `brand().legalNameMn`, нэр = `formatStaffShortName`).
  ХАДГАЛАГДАХГҮЙ — оролцогчдоос үргэлж дахин гарна (`meetingDoc.ts` `ourPartyLines` / `meetingPartiesText` — засварлагч, хэвлэлт,
  Word ГАНЦ дүрэм), тиймээс хүн нэмэх/хасахад шууд шинэчлэгдэнэ.  `meeting_parties` (гараар) = бусад талынх, доор нь.  Засварлагч
  амьд оролцогчдыг `useMeetingParticipantOptions.ts`-ээр (хадгалаагүй сонголт ч).  ⚠️ Нэгтгэл тайлан (`summaryContent.ts`) түүхий
  `meeting_parties`-ийг л харуулна.
- **Оффис уулзалтын баримт — засварлах мөр, анх 1 мөр, «Оролцсон» хэвлэлтгүй, ХӨЛ (migration 0398, 2026-10-12, эзний
  RFI/тэмдэглэлийн зураг):** (1) «Оролцогч тал»-ын манай талын мөр бүр засварлагдана — `meeting_doc_json.party_lines`
  (user_id → бичвэр; автомат мөртэй ижил/хоосон болговол засвар арилна, ↺ товч), ариутгагч `lib/asrMeeting.ts`
  `sanitizeMeetingDoc`; (2) хүсэлтийн хүснэгт бүр анхнаасаа 1 хоосон мөртэй — `shapeRow` хадгалаагүй тайланд
  `meeting_requests: null` буцааж `formStateFrom` `['']` өгнө, хадгалсан хоосон хүснэгт (`[]`, мөрөө устгасан) хэвээр
  (`sanitizeMeetingRequests` хоосныг ч хадгална); (3) «Оролцсон» мөр хэвлэлт/Word-д ГАРАХГҮЙ (засварлагчид хэвээр);
  (4) гарын үсгийн хүснэгтийн оронд хөл (`meetingDoc.ts` `meetingFooter` ↔ `AsrDocument.tsx` `MeetingFooterBlock` ↔
  `buildAsrDocx.ts` `meetingFooterXml`): «Тайлбар: …» (`work_report`) → «MGL E&C LLC Талаас Хуралд оролцсон:» хүн бүрд
  байгууллага + «албан тушаал нэр ……» (Манай талын гарын үсэг нэрээр таарсан хүний мөрөнд) → «<client_org> Талаас төлөөлж
  гарын үсэг зурсан:» (`client_org`, `client_position` + `sig_site_name`/`sig_site_url`) → огноо.  Хүснэгтийн хар-хөх хөлийн
  мөр 3 нүдтэй.  Word-д «Хяналтаар явсан» + гарын үсгийн 3 мөр хасагдаж, хөл хүснэгтийн доор (`keepNext`).  ⚠️ 0397 дугаарыг
  зэрэг сесс (`0397_drive_doc_public_links.sql`) эзэлсэн тул 0398.  **DEPLOYED 2026-10-12** — `864adc5b`: D1 0398, worker
  `719bba6a`, Pages `1e0b5c2d` (`index-B6z9LUlK.js`).
- **Мөр / «Тайлбар»-ын зураг + гарын үсэг тунгалаг PNG, жигд хэмжээ (2026-10-12, миграцгүй):** хүсэлтийн хүснэгтийн мөр нь
  `{text, images[]}` (хуучин бичвэр мөрийг `toRequestItem`/backend `sanitizeItem` уншина; зураг ≤6, `/media/<key>` л), «Тайлбар»-ын
  зураг `meeting_doc_json.note_images`; засварлагч `AsrInlineImages.tsx` (downscale → `/api/upload`), хэвлэлт бичвэрийн доор
  (`.asr-item-imgs`), Word нүдэнд (`itemImagesXml`).  Зурагтай хүснэгтэд «Хүсэлт гаргагч» rowspan БИШ хүрээгээр нэгтгэнэ —
  rowspan нь апп доторх A4 (multicol) харагдацад хүснэгтийг хуваагдуулдаггүй (хэмжсэн); Word-д бичих мөр + зурагтай дотоод мөр
  `cantSplit`-гүй (эс бөгөөс хуудаснаас өндөр хэсгийг Word тайрдаг).  **Гарын үсэг:** `trimInk.ts` `makePaperTransparent` — цаасыг
  тунгалаг болгоно (хадгалахдаа `cropCanvasToInk` — ажилтны `SignatureCapture` ба захиалагчийн `SignaturePad`; харуулахдаа
  `cropInkFromImage` — хуучин цагаан дэвсгэртэй зураг ч); өмнө нь цагаан тэгш өнцөгт цэгтэй шугамыг дардаг байв.  Хэмжээ
  `signatureDisplayMm` (өндөр ≈ 12 мм, өргөн ≤ 44 мм, нарийн бол ≤ 15 мм өндөр — пикселийн нягтаас үл хамаарна) —
  `HandSignature fitToInk="document"` (ЗХ баримтын бүх гарын үсэг) ↔ Word `fitSignature`; хөлийн гарын үсэг шугамын ДЭЭР
  (хэвлэлт absolute, Word хөвөгч `anchoredDrawingRun`).
- **Гаднын гарын үсгийн link хурдан нээгдэнэ (2026-10-12):** `routes/publicDocumentSigning.ts` link ҮҮСГЭХ агшинд
  (`staffRouter.post`) `waitUntil(warmPreview)` — Browser Rendering-ийн PDF-ийг `public-signing/preview/` cache-д урьдчилан тавина,
  гаднын хүний эхний нээлт ч cache-ээс (`renderAndCachePreview` ГАНЦ функц, GET ч үүнийг дуудна; `version` = баримтын updated_at
  тул хуучирсан баримт гарахгүй).  `PublicPdfViewer` pdf.js-ийг PDF татахтай ЗЭРЭГ ачаална.  Тест `publicDocumentSigning.test.ts` 24.
  **DEPLOYED 2026-10-12** (зураг + гарын үсэг + link хурд, миграцгүй) — `6a30c2d3`: worker `b2b9ec7c`, Pages `17575ce8` (`index-BGouVUkn.js`).
- **Хавсралт = ЯГ НЭГ ТОМ зураг** (`AsrDocPhotos` `single`, хэвлэлт `.asr-photos--single`, Word 170×180мм): гараар бичих
  тайлбаргүй — тайлбар нь автомат «төслийн нэр · он.сар.өдөр цаг:мин:сек» (`photoStamp`).  UI-ийн хязгаар; сервер хаадаггүй
  (талбайн тайланг office болгоход хуучин зургууд устахгүй, хуудас бүрд нэгээр харагдана).
- **0367:** `meeting_place`, `meeting_start`/`meeting_end` («HH:MM»), `meeting_parties`, `meeting_purpose` — NULL-тэй,
  CHECK-гүй, утгын дүрэм `lib/asrMeeting.ts` `meetingPatch`.  Төрлөөс үл хамааран хадгална — төрөл буцаахад Тайлбар г.м.
  нуусан талбарууд ч, уулзалтын мэдээлэл ч алдагдахгүй.
- Шалгасан 2026-09-30: `asrMeeting.test.ts` 9 (миграц `node:sqlite`, бүх ажилтны SQL-ийг D1 адаптероор),
  backend `tsc`/`npm test` (3 өмнөх уналт), mock-API headless-Chrome 36/36 (хэвлэх, PDF, Word gridSpan=12/r:embed, засварлагч
  — оролцогч нэмэх/хасах autosave, `scope=all`) + талбайн төрлийн регресс, `npm run verify` ногоон.
  **Deploy дараалал: D1 0367 → worker → Pages** — шинэ worker-ийн submit `r.meeting_purpose` уншдаг тул миграцгүйгээр
  илгээх 500 болно.
- **DEPLOYED 2026-09-30** (commit `729394c7`, цэвэр worktree-ээс): D1 0367 (өмнөх bookmark
  `0000020c-00000c14-000050f6-6b01e0838231118f0aa1e72c549b12fe`; 57 тайлан хэвээр, office 0), worker `5ff33f35` (100%),
  Pages `fd023ba7` (`index-Ww4nuxda.js`).

### Зохиогчийн хяналт — НЭГТГЭЛ ТАЙЛАН (2026-10-01, миграцгүй, DEPLOYED — commit `962729b9`, worker `0f419af6`, Pages `0734c624`)

Эзний хүсэлт: ЗХ хуудаснаас шууд нэгтгэл тайлан авах.  Эзний 4 хариулт (AskUserQuestion): **хоёр газраас** (ЗХ самбарын
толгой = бүх төсөл/сонгосон төсөл; төслийн ЗХ самбарын «Тайлангууд» толгой = тухайн төсөл, самбарын одоогийн хугацаа/төрөл/
төлөвөөс эхэлнэ — `/app/asr?project=` ба төслийн «ЗХ» таб хоёулаа `AsrProjectBoard`) · **хүснэгт + гол агуулга, зураггүй** ·
**PDF (хэвлэх) + Excel + Word** · **ЗӨВХӨН админ**.
- **Тоо ГАНЦ газар — `backend/src/lib/asrSummary.ts`** (цэвэр, 9 тест): тайлан = `submitted|approved` (ноорог, буцаагдсан
  ХЭЗЭЭ Ч орохгүй; «Зөвхөн батлагдсан» сонголт бий), очилт = талбайн хяналт, хүн = зохиогч + хамт явсан, олон багийн тайлан баг
  бүрт.  `GET /api/author-supervision/summary?from&to&project_id&report_type&status` + `GET …/summary/pdf` —
  `routes/asrSummary.ts`, `/api/author-supervision`-ийн ДАХИН нэг mount (`index.ts`-д ҮНДСЭН router-ээс ӨМНӨ: тэр нь `/:id`,
  `/:id/pdf`-тэй).  Буруу огноо/төрөл/төлөв → 400 (чимээгүй үл тоохгүй).  ≤2000 тайлан (`truncated`).  Нөхөж бүртгэсэн хуучин
  тайланд зохиогч = `legacy_author_name`.  Файлын нэр серверт (`file_stem`, `MGL-251006_DASR_Negtgel_2026-09-01_2026-09-30`).
- **Frontend `features/asr/summary/`**: `AsrSummaryDialog` (товч + цонх: хугацааны товч, төсөл/төрөл/төлөв, урьдчилсан тоо;
  самбараас нээхэд сарын эхний 10 хоногт ӨМНӨХ сар), `AsrSummaryPrintPage` (`/app/asr/summary/print`, Layout-ийн гадна —
  серверийн PDF `?t=`-ээр энд орно), `AsrSummaryDocument` (A4 босоо, `@page` margin 0 + давтагдах thead/tfoot; ⚠️
  `body * { visibility: visible !important }` ЗААВАЛ — `index.css` хэвлэхэд `.print-area`-аас бусдыг нууж ХООСОН PDF гаргадаг,
  хэмжсэн), `exportAsrSummaryXlsx.ts` (2 хуудас), `buildAsrSummaryDocx.ts` (загваргүй гар OOXML, `fflate`; мөр бүрийн
  gridSpan/өргөн = `tblGrid` — `npm run check:asr-summary`, `verify`-д).  Бичвэр/шошго ГАНЦ газар `summaryContent.ts`
  (оффис уулзалт зорилго/оролцогч тал/агуулгаар; улаан дэвтэр зөвхөн талбайд).
- Шалгасан 2026-10-01 прод-хуулбар (10-01, 0370) scratch D1 дээр: API 26/26 (тоо SQL-тэй тэнцүү, инженер 403), headless-Chrome
  25/25 (самбар/төслийн товч, урьдчилсан тоо, хэвлэх 33 тайлан → 8 хуудас, Excel/Word татах, 390px, инженерт товчгүй); татсан
  .docx-ийг Word COM (11 хуудас), .xlsx-ийг Excel COM нээж PDF болгосон.  ⚠️ Серверийн PDF (`/summary/pdf`) локалд BROWSER
  binding байхгүй тул ШАЛГАГДААГҮЙ — `GET /:id/pdf`-ийн ижил жор; deploy-ийн дараа нэг удаа татаж шалга.  Deploy дараалал:
  worker → Pages (миграцгүй).  **DEPLOYED 2026-10-01** (release `485d6192` = live `15cb1138` + ирцийн ээлжийн цонх
  `0c7a2e3d` + энэ + Revit add-in эх код `485d6192`; цэвэр worktree-ээс — `mgl-e-c-50`-ийн дутуу `is_paid` чөлөөний засвар ОРООГҮЙ).

### Зохиогчийн хяналт — ХУУЧИН тайлан нөхөж бүртгэх (migration 0332, 2026-09-21, NOT deployed)

Систем нэвтрэхээс өмнөх ЗХ тайлангууд нь `YYMMDD_<ТӨСӨЛ>_ASR_<БАГ>_<NNN>.docx|pdf` файлууд бөгөөд
**үндсэн төслийн Drive хавтсанд** байдаг (прод дээр хэмжсэн: 19 хавтас бүгд `project_drive_versions`-д
индекслэгдсэн; жинхэнэ файл `260519_EVGR_ASR_BB_005.pdf`, `260428_ТЕННИСНИЙ ОРДОН_ASR_BB.docx` (дугааргүй),
`260429_LUXWOOD_ASR_001.pdf` (баггүй); хавтас бүрд ~7 `YYMMDD_…` ХООСОН ЗАГВАР + `~$` түгжээний файл —
тэдгээр нэр дэвшигч БИШ).  Аппын бодит хэрэглээ ч **нэг тайлан = нэг баг** (төсөл 55: 2026-09-14-нд 5
тайлан, баг тус бүрд) тул хуучин файл бүр өөрөө нэг тайлан — нэгтгэх шаардлагагүй.

- **Эзний 4 шийдвэр (2026-09-21):** зорилтот `projects` мөрийг ХЭРЭГЛЭГЧ сонгоно, өгөгдмөл = идэвхтэй ZA
  гишүүн → тайлантай гишүүн → ганц гишүүн (`suggestTargetProject`); гишүүнгүй үндсэн төсөлд (LUXWOOD, WISDOM
  TOWER …) «ЗХ төсөл үүсгэх» (`asr_only` + `main_project_id`) · **нэг Drive файл нэг л удаа** (UNIQUE
  `asr_legacy_sources.drive_file_id`), ижил төсөл + огноо + баг = ЗӨӨЛӨН давхардал (алгасна, `force_duplicate`
  давна), docx + pdf ижил огноо/баг/дугаар = НЭГ тайлан · ~~дугаар нь файлынх, `seq` NULL, дараалалд ОРОХГҮЙ~~
  **2026-09-29-нөөс (0359) нөхсөн тайлан ч багийнхаа DASR дараалалд ОГНООГООРОО орно** — импортын дараа
  `renumberAsrProject`; файлын дугаар («ASR-BB-005») `legacy_doc_no`-д хэвээр · шууд `approved`,
  `requireManager` (admin + senior).
- **Файлууд:** `lib/asrLegacy.ts` (нэр задлах / бүлэглэх / зорилт / давхардал / `matchLegacyAuthor`, 23 тест),
  `lib/zipRead.ts` (хамааралгүй ZIP уншигч — `DecompressionStream('deflate-raw')`), `lib/asrLegacyDocx.ts`
  (12×15 загварыг ШОШГООР уншина: огноо, шифр, төрлийн ☒, «Хяналтаар явсан» багууд, тайлбар, ажлын тайлан,
  гарын үсгийн нэр, зургийн `r:embed` → `word/media`; 7 тест, бодит загвар дээр), `routes/asrBackfill.ts`
  (`/api/author-supervision/backfill/*`, index.ts-д үндсэн router-оос ӨМНӨ), frontend
  `features/asr/backfill/` (`/app/asr/backfill?main=<id>`, орох цэг = үндсэн төслийн «Баримт бичиг» хуудасны
  «ЗХ тайлан нөхөх» товч), `AsrList` «Нөхөж бүртгэсэн» тэмдэг.  `routes/authorSupervision.ts` ХӨНДӨӨГҮЙ —
  `r.*` тул `origin`/`legacy_doc_no`/`legacy_author_name`/`imported_by` автоматаар жагсаалтад очно.
- **Зохиогч:** `legacy_author_name` («Б.Билгүүн», «У.Ганбат / MGL ENC инженер») → `users.full_name`
  («Овог Нэр») / `username`-тэй тулгаж ЯГ НЭГ хүн таарвал `author_id` = тэр хүн (очилтын тойм түүгээр
  тоолно), хоёрдмол/олдохгүй бол импортлогч (`imported_by` үргэлж импортлогч).  `author_user_id`-г ил өгч болно.
- **Нэр дэвшигч нь D1-ээс** (ledger-ийн сүүлийн мөр, trashed/deleted биш) — Drive рүү ганц ч дуудлагагүй;
  docx-ийн агуулга л Drive-аас SA-гаар татагдана (`/parse`, ≤25 MB, Drive тохируулаагүй бол 503 — файлын
  нэрээр бүртгэх хэвээр ажиллана).  Зураг `MEDIA_BUCKET`-д `<sub>-<ms>-<rand>-legacy-<name>` түлхүүрээр.
  `project_info_json` ХӨЛДӨӨХГҮЙ (0256-ийн дүрэм: өнөөдрийн паспортыг өнгөрсөн баримт руу хөлдөөх нь худал түүх).
- Тайланг устгавал `asr_legacy_sources` CASCADE-аар арилж файл ДАХИН нэр дэвшигч болно (зориудаар — буруу
  импортыг устгаад дахин оруулах зам).  «Алгассан» (`state='ignored'`) файл буцаагдана; импортлогдсоныг
  ignore-оор хөндөхгүй.
- Шалгасан: unit 30, API E2E 57 (scratch D1, порт 3177), headless-Chrome UI 23.  ⚠️ Windows дээр хэд хэдэн
  `wrangler dev` ИЖИЛ портыг зэрэг сонсож чаддаг (2026-09-21-нд 3011 дээр 3 процесс) — хүсэлт санамсаргүй
  серверт очно; `netstat -ano | findstr :<port>` НЭГ л LISTEN мөртэй байхыг батал.

### Хурлын тэмдэглэл — олон төсөл, компанийн хурал, хөтчийн бичлэг, эцсийн текст (2026-09-21, migration 0333)

Owner's request: attendee count, stored participants, several projects per meeting, project-less company
meetings, record audio in the browser, auto-transcribe, then edit the full text in a large editor and save it.
Everything reuses the existing stack (Speechmatics batch STT, private `MEETING_BUCKET`, `/meeting-audio` signed
URL, Workers-AI analysis, structured `participants_json`); nothing was duplicated.

- **`meeting_projects` (N:M) is the source of truth for project links; `meetings.project_id` is a REFLECTION
  (= first project, `sort_order 0`)** written only by `syncMeetingProjects()` in `routes/meetings.ts`. The
  reflection keeps the MCP `create_tasks_from_meeting` fallback, `project_name` and every old `project_id`
  reader working. `GET /api/meetings?project_id=` and MCP `list_meetings` filter through
  `EXISTS (… meeting_projects …)`, so a meeting shows under **each** of its projects. `?kind=company` lists
  company meetings. API takes `project_ids: number[]` (legacy `project_id` still accepted, `lib/meetingMeta.ts
  parseProjectIds`). D1 doesn't enforce FKs at runtime → `DELETE /:id` deletes `meeting_projects` /
  recordings / transcripts / analyses by hand.
- **`kind`** = `project | company`, invariant **`company ⇔ no projects`** (`resolveMeetingKind`, pure, tested):
  `kind` omitted → derived from the ids; `kind='company'` → ids dropped; `kind='project'` with no ids → 400. The
  migration flipped every project-less row to `company`. The UI grid's first card is «Компанийн хурлууд»
  (`?project=company`; the old `?project=none` link is an alias). The create dialog has a «Компанийн хурал»
  switch; the project field is a multi-select (`ProjectMultiSelect.tsx`, the first chip = primary).
- **Attendee count is derived, not stored**: `countAttendeesFromJson(participants_json)` = named members across
  all org groups; returned as `attendee_count` on list/detail/MCP, shown in the list column, the detail header
  («N хүн») and the print page («Нийт N хүн оролцов»). Participants themselves were already structured
  (org → members, `user_id` link → signature) — unchanged.
- **Meeting first, audio later.** `POST /api/meetings` no longer requires `audio_key`: without it the row is
  **`status='draft'`** (new status; `isMeetingBusy` does not poll it). `POST /:id/audio` attaches the uploaded
  key (same `ownsKey` prefix rule, R2 `head` check), **replaces** any previous recording (old R2 object + row +
  `meeting_transcripts` deleted; `final_text` kept), and submits STT — the shared `attachRecording()` also
  serves the one-shot `POST /` + `audio_key` path, byte-for-byte the old behaviour. 409 while
  `transcribing|analyzing`. The dialog offers three sources: «Хөтчөөр бичих» (creates the draft, navigates to
  the detail page with `?record=1` → `MeetingRecorderCard` auto-starts the mic, the param is consumed
  immediately), «Файл оруулах», «Бичлэггүй».
- **Browser recording** = `shared/hooks/useMediaRecorder.ts` (extracted from the ASR recorder's logic;
  `AsrRecorder.tsx` still carries its own copy because that module was another agent's live WIP — migrate it to
  the hook when it is quiet). `start(timesliceMs=10 s)` collects chunks, pause/resume/discard, `beforeunload`
  guard while recording. Verified in headless Chrome with `--use-fake-device-for-media-stream`.
- **`final_text` (+ `_updated_at/_by`) is the edited minutes text; `meeting_transcripts.transcript_text` is
  never overwritten** (re-transcribe rewrites the raw text, not the edit). `PUT /:id/final-text {text}` (empty →
  NULL, 1 MB cap). `FinalTextEditor.tsx`: large textarea (55 vh / full-screen toggle), `useLocalDraft`
  (`mgl:meeting-final-draft:<id>`) so an unsaved edit survives a reload, Ctrl+S, «Транскриптээс эхлүүлэх», and an
  **automatic pre-fill** from the transcript when both final text and draft are empty (nothing is written until
  «Хадгалах»). `runMeetingAnalysis` and `POST /:id/analyze` now use `COALESCE(NULLIF(final_text,''),
  transcript_text)` — a typed, recording-less meeting can be analysed. The print page prints `final_text` under
  «Хурлын тэмдэглэл» after the structured discussion tables; the raw transcript still never prints.
- Access is unchanged: **admin only** (`requireAdmin` on the whole module, `roles: ['admin']` in NAV_ITEMS).
- Tests: `node --test src/lib/meetingMeta.test.ts` (9); API E2E `meeting-e2e.mjs` 53 checks + headless-Chrome
  `meeting-browser.mjs` 47 checks on a scratch prod-copy D1 (2026-09-21, both in the session scratchpad, not
  in-repo). The Speechmatics completion path itself is untouched and was not re-exercised locally (no API key).

### Албан ёсны таскийн цаг хэмжигч — ▶/⏸ (OFFICIAL_TASK_TIMER, migration 0361, 2026-09-29)

Захирлын шийдвэр («хоёр тусдаа систем»): CEO/админд харагдах **ЦОРЫН ГАНЦ албан цаг** = ажилтан «Миний ажлууд»
дээр ӨӨРӨӨ ▶ дарж эхлүүлсэн таймер. Revit-ийн автомат цаг (0360, доор) нь ДАЛД туршилтын эх сурвалж — хоёрыг хэзээ ч
нэмэхгүй, дундажлахгүй, «ихийг нь» авахгүй, нэгээр нөгөөг орлохгүй. Нэр бүр `official_*` / `task_timer_*` (ерөнхий
«worked_ms» ХОРИОТОЙ) — дараа нь хоёр тоог харьцуулахад миграц хэрэггүй.

- **Хүснэгт** `task_timer_sessions` (нэг мөр = нэг тасралтгүй хэсэг; `ended_at IS NULL` = явж буй; дууссан мөр
  ХЭЗЭЭ Ч засагдахгүй, үргэлжлүүлэх = ШИНЭ мөр) + `task_timer_events` (append-only аудит: `start | pause | switch |
  auto_stop_completed | auto_stop_deleted`; сэлгэлт = НЭГ мөр, `from_session_id/from_task_id` = «A нь B эхэлсэн тул
  зогссон»). **`ux_tts_one_running` = UNIQUE(user_id) WHERE ended_at IS NULL** — нэг хүнд хоёр дахь явж буй мөрийг
  DB өөрөө хориглоно. users/tasks руу FK-гүй (`DELETE /users/:id` гараар; таск устгахад сэшн ҮЛДЭНЭ, явж буй нь
  `auto_stop_deleted`).
- **Цаг = СЕРВЕРИЙН UTC ISO** (`toISOString`, 24 тэмдэгт → SQLite-д мөрөөр харьцуулна). «Өнөөдөр» = УБ-ын өдрөөр
  УНШИХДАА тайрна (`lib/taskTimer.ts` `ubDayWindow`/`splitByUbDay`, шөнө дундыг давсан сэшн хоёр өдөрт хуваагдана).
  Хөтөч ганц ч секунд «тоолдоггүй»: харагдах = дууссан нийлбэр + (серверийн одоо − эхлэл).
- **Харуулалт = Apple-ийн секундомер** (эзэн 2026-09-29; дүрэм `task-timer/stopwatch.ts`, цэвэр, `npm run
  check:stopwatch` 19, `verify`-д): 1 цагаас доош `мм:сс.сс` (зуны нэг секунд), 1 цагаас дээш `Ц:ММ` + «ц» (секунд,
  зуны нэг НУУГДАНА); доош хэзээ ч дугуйлахгүй. `StopwatchText` нь React-ийг дахин рендерлэхгүй — `timerClock.ts`-ийн
  ГАНЦ хуваалцсан `requestAnimationFrame` давталт DOM-ын бичвэрийг шууд солино (1 цагаас дээш минутын хил хүртэл
  бичихгүй). Серверийн цаг = `server_now` ↔ хүлээж авсан агшны `performance.now()` зангуу (`nextAnchor`): зөвхөн
  урагш засна, 1 с-ээс их ухралтад л дахин тааруулна → 15 с тутмын тулгалт дэлгэцийг хэзээ ч хойш үсрүүлэхгүй.
  **▶/⏸ ШУУД** (optimistic, `effectiveTimer`): дармагц тоолуур эхэлж/хөлдөнө, хүсэлтүүд ДАРААЛЛААР явна, хүсэлт явж
  байхад поллинг зогсож хуучин хариуг `cancelQueries`-ээр хаяна; энэ табд дарсан агшин сэшний дэлгэцийн эхлэл болно
  (сервер ≤1.5 с зөрвөл, `clickStarts`) — дэлгэц хойш үсрэхгүй. ⚠️ `useOfficialTimer`-ийн ref-үүд `useQuery`-ээс
  ӨМНӨ зарлагдах ёстой (`refetchInterval`-ийг react-query рендерийн үед дууддаг — TDZ-ээр самбар бүхэлдээ унаж байсан).
- **Атом сэлгэлт** (`lib/taskTimerStore.ts`, ганц газар): ▶ = НЭГ `db.batch` — (1) өөр таск явж байвал хаах
  (`end_reason='switch'`), (2) явж буй мөр үлдээгүй бол шинэ мөр (тэр таск аль хэдийн явж байвал юу ч хийхгүй →
  давхар даралт/дахин оролдлого идемпотент), (3) аудит. Мөрүүдийг сервер үүсгэсэн `request_id`-аар холбоно; зогссон
  мөрийг `user_id + ended_at >= :now + end_request_id`-аар (`ended_at = MAX(started_at, :now) ≥ :now` үргэлж) бүтэн
  скангүй олно. Шинэ эхлэл = MAX(:now, хамгийн сүүлд зогссон) → isolate-уудын мс зөрүүгээр ч давхцахгүй. ⏸ нь
  `task_id` авна: хуучирсан таб A-г зогсоох гэж дарахад өөр төхөөрөмж дээр эхэлсэн B хөндөгдөхгүй (`not_running`).
- ⚠️ **2026-10-01-нд ДАРАГДСАН эрх** — `timerDenial` устсан; одоо `lib/taskTakeService.ts` (доорх «Таск авах = цаг
  эхлүүлэх»): хариуцагч биш, ирцтэй ажилтан хүссэн таскаа авна.  Хуучин бичвэр:
  **Эрх** (`timerDenial`, «Миний ажлууд»-тай ижил): admin/senior/engineer/architect; ЗӨВХӨН өөрийн хариуцагч таск
  (`assigned_to` эсвэл `task_assignees`) — admin/senior-т ч ижил; төсөл `active`; таск <100% ба «миний хэсэг дууссан»
  биш. `user_id` биеэс ХЭЗЭЭ Ч авагдахгүй. `/api/task-timer` нь worker/client-ийн цагаан жагсаалтад БАЙХГҮЙ (403),
  модуль `progress` (`lib/modules.ts`). Хуудас сэргээх / хөтөч хаах таймерыг ЗОГСООХГҮЙ (эзний загвар), Revit-ийн
  idle ч албан таймерыг хөндөхгүй.
- **Автомат зогсолт**: `submitProgressEntry` (вэб, `/bulk`, Revit `/submissions` — гурвуулаа) хүчинтэй 100% хаалтын
  ДАРАА тэр таск дээрх БҮХ явж буй таймерыг `auto_stop_completed`; «миний хэсэг дууссан» (`self-done`) зөвхөн тэр
  хүнийхийг; `tasks.delete` → `auto_stop_deleted`. Хаах дүрэм (асуултууд заавал) ӨӨРЧЛӨГДӨӨГҮЙ; алдаа нь бичлэгийг
  унагахгүй (try/catch). ⚠️ Revit-ээс 100% хаахад ч зогсоно (ERP-ийн хүчинтэй хаалт) — эзэнд хэлсэн.
- **Замууд** `routes/taskTimer.ts`: `GET /state` (15 с поллинг + цонх руу буцахад + `BroadcastChannel`
  `mgl-official-task-timer` — нэг хөтчийн табууд шууд), `POST /start|/pause`, `GET /live` (**ЗӨВХӨН admin**, 4
  асуулга, ажилтан тутамд дуудлагагүй), `GET /users/:id/days?from&to` (өөрөө эсвэл admin, ≤62 өдөр).
- ⚠️ 2026-10-01: самбарын «Миний ажлууд» картаас ЭХЛҮҮЛЭХГҮЙ (`canRun={false}` — явж буйг «Зогсоох», бусад нь нийт
  цаг).  «Миний ажлууд» хуудаснаас ДАХИН эхлүүлнэ (0370, `onStart` = `useTakeTask`) — доорх «Миний ажилд нэмэх».
- **UI** `frontend/src/features/task-timer/`: `TaskTimerControl` (My Tasks-ийн мөр бүр + хяналтын самбарын «Миний
  ажлууд» картын баруун дээд булан, явж буй таск картын эхэнд; дууссан мөрөнд нийт л). ⚠️ **2026-10-01: ▶ / ⏸ ДҮРС
  БУЦСАН** (эзэн: «Өөртөө авах» бичгийн оронд зөвхөн playback товч — дарвал цаг шууд эхэлнэ, явж байхад ⏸ болж
  зогсооно; 09-29-ний «бичигтэй товч» шийдвэрийг СОЛЬСОН, «Миний ажлууд»-д ч ижил): `[▶]` / `[12:04.33 | ▶]` /
  `[● 12:04.33 | ⏸]` / цайны цагт `[☕ 12:04.33 | ⏸]` — бичвэр нь tooltip + aria-label-д л.  Төслийн хуудасны
  `TaskLiveCell` ч ЭНЭ компонентыг (`showClosed={false}`, `onStart` = «авах») хэрэглэнэ — «Өөртөө авах» / «Хувааж
  авах» товч устсан (эзлэгдсэн таск дээр ▶ → 409 → хуваах цонх хэвээр).
  `OfficialTimerBanner` (My Tasks-ийн дээд — явж буй таск, энэ таск, өнөөдөр, ⏸), `OfficialTimerLiveCard`
  (**2026-09-30-аас Тайлан → «Таскийн цаг» таб**, `/app/reports?tab=tasktime`; Ирц админ → Өнөөдөр-өөс шилжсэн, тэнд
  давхар харуулахгүй; Revit-ийн карт хасагдсан хэвээр), `OfficialTimerDaysCard` (профайл «Өдрийн тайлан», 14 өдөр,
  сэшний түүх; `embedded` горимд «Таскийн цаг» табын ажилтны задрал). Засах UI, цалин, идэвх хэмжилт — ЗОРИУД байхгүй.
  **«Таскийн цаг» таб** (`features/reports/components/TaskTimeTab.tsx`): «Одоо» карт + хугацааны нийлбэр (толгойн
  цонх/anchor-ыг дагана) — KPI, ажилтан тутмын хүснэгт (нийт цаг · өдөр · өдрийн дундаж · таск · бүртгэл; мөр дарвал өдөр ×
  таск × сэшн, ≤62 өдөр), төслөөр. Backend `GET /api/task-timer/report?window=&anchor=` (admin, `loadOfficialTimerReport`:
  3 асуулга, ажилтан тутамд дуудлагагүй; `running` зөвхөн мужид өнөөдөр багтсан үед; `all` цонхонд `from` = анхны сэшний өдөр).
- **ЦАЙНЫ ЦАГ ТООЛОГДОХГҮЙ (эзэн 2026-10-01, миграцгүй).** Ирцийн цайны цонхонд (`app_settings.lunch_enabled/_start/
  _end` — ирцтэй ЯГ нэг тохиргоо, прод 13:00–14:00) албан таймер хөлдөнө: 13:00-д явж байсан цаг тоологдохоо болиод
  14:00-д өөрөө үргэлжилнэ, цайны цагт эхлүүлсэн нь 14:00-аас тоолно.  Сэшнийг ХААХГҮЙ (таск дээрх нэр хэвээр,
  хуваагдах таск эзлэгдсэн хэвээр) — зөвхөн ТООЦООЛОХДОО давхцлыг хасна, тиймээс бичилт хөндөгдөөгүй: `duration_ms` =
  ТҮҮХИЙ үргэлжлэл (аудит), албан нийлбэрийг `SUM(duration_ms)`-оор ХЭЗЭЭ Ч бүү ав.  Дүрэм ГАНЦ газар
  `lib/taskTimer.ts`: `officialLunchOf` (тохиргоо → цонх), `countedMs`/`lunchOverlapMs` (JS — `clippedMs`,
  `summarizeWindow`, `splitByUbDay`, `summarizeRange` бүгд `lunch` параметртэй), `officialMsSql` (SQL ихэр — `/state`-ийн
  таскийн нийт ба `/live`-ийн хуримтлал; эхэлсэн + дараагийн 2 өдрийн цонх → ≤48 ц сэшнд ЯГ ижил).  Эзний шийдвэр:
  ЗӨВХӨН `OFFICIAL_LUNCH_FROM` = 2026-10-01-нээс — өмнөх өдрүүдийн цаг хэвээр.  ⚠️ Уншихдаа хасдаг тул админ цайны цагийг
  өөрчилбөл 10-01-ээс хойших бүх таймерын нийлбэр ШИНЭ цонхоор дахин бодогдоно (ирцийн хадгалсан цагаас ялгаатай).
  `/state` ба `/live` нь `lunch` ({start_min,end_min,from,offset_min}) буцаана; frontend ихэр `stopwatch.ts`
  (`lunchRuleOf`, `countedMs`, `lunchStateAt`) — `StopwatchText` хөлдөнө, `useLunchNow` (`useSyncExternalStore`, табын
  НЭГ таймер цонхны хил дээр) «☕ Цайны цаг» тэмдгийг мөр, дээд самбар, админы «Одоо» картад харуулна.  Тест:
  `lib/taskTimer.test.ts` (SQL ↔ JS 406 интервал × 3 тохиргоо, frontend ихэр 800 интервал), `routes/taskTimer.test.ts`
  (цайны route тест; харness-ууд `app_settings`-ийг `lunch_enabled='0'`-оор үүсгэнэ — тест өдрийн цагаас үл хамаарна),
  `npm run check:stopwatch` 25; прод-хуулбар + headless-Chrome 28/28 (цонхыг «одоо» болгож хөлдөх → 14:48-д үргэлжлэх).
  **DEPLOYED 2026-10-01** (миграцгүй; commit `aaa1fb00`; deploy worktree `4ee1b070` = live суурь `e5ed0bd0` (6e2cecaa + RFI
  гарын үсэг 1673586d/0371) + `aaa1fb00`, Drive `4e752155` ОРООГҮЙ хэвээр; салаа `deploy/live-2026-10-01-lunch`): worker
  `bf65f6a6`, Pages `3fb9c6c7` (`index-BBYZdVXb.js`; live chunk 285/285 локалтай ижил).
- Тест: `lib/taskTimer.test.ts` (6), `routes/taskTimer.test.ts` (16, бодит 0360+0361, D1-ийн адил дараалсан batch,
  зэрэг хүсэлт, Revit sync-ийн нөлөөгүй). 2026-09-29 прод-хуулбар (0360-тай) + 0361 дээр API E2E 31/31, headless-Chrome
  22/22 (хоёр таб, сэргээлт, 390px, CEO карт, профайл) + секундомер 16/16 (400 мс сүлжээний хоцролттой ▶ 4–15 мс,
  секундэд 61 шинэчлэлт, 163 түүвэрт ухралт 0, сервертэй 18 мс зөрүү, ≥1 ц `1:05ц`). Толгойгүй Chrome-ын шинэ
  профайлд service worker анх суухдаа хуудсыг нэг удаа дахин ачаалдаг; зэрэг ажиллаж буй агентын i18n засвар Vite-ээр
  бүх апп-ыг дахин ачаалдаг — хоёулаа тестийн «navigated» алдаа, таймерын алдаа биш. **DEPLOYED 2026-09-29** (release `19eeea2b`, 7 commit): D1 0360 + 0361 + 0362 (өмнөх bookmark `00000208-0000191a-000050f5-48fc5dbed58907693d842fff2c5c0522`), worker `9dd687d1` (100%), Pages `49353053` (`index-DhWmMHXk.js`).

### Таск авах = цаг эхлүүлэх = таск дээрх нэр (migrations 0368/0369, 2026-10-01, DEPLOYED)

⚠️ **2026-10-02-нд хэсэгчлэн ДАРАГДСАН (энэ нь NOT DEPLOYED):** «хувааж авах» / `POST /split` 410 болж, хуваалт `POST /api/tasks/:id/allocation/split` (нэг root, хүн бүрт хуваарилалт) болсон; «авах» = цаг эхлүүлэх хэвээр, харин managed таск дээр ирээдүйн ажилгүй хүн ▶ дарвал `409 NOT_ALLOCATED`.  Доорх «Хувааж авах», «Хуваагдах таск … `TASK_OCCUPIED`», «`/split` явцтай таскийг үлдсэнээр» мөрүүд түүх — «Таскийн ХУВААРИЛАЛТ» хэсгийг үз.

Эзний асуудал: шинэ төсөл ирэхэд хүмүүс олон таскийг (ялангуяа жин ихтэйг) өөртөө авч 20–30 өдөр «эзэмшдэг».
Эзний шийдвэрүүд (3 тойрог асуулт):

- **Таск дээрх НЭР = албан таймер нь ОДОО явж буй хүн.** Байнгын хариуцагч БАЙХГҮЙ. «Өөртөө авах» = `POST
  /api/tasks/:id/claim` ≡ `POST /api/task-timer/start` → ганц урсгал `lib/taskTakeService.ts` `takeTask`: өөр таск
  дээрх цаг АТОМ зогсож энэ таск дээр эхэлнэ.  Тоон хязгааргүй.  Төслийн хуудаснаас, эсвэл (0370-аас) «Миний ажлууд»-аас.
- **Эрх**: engineer/architect/senior + CEO (`lib/taskTake.ts` `canTakeRole`); ирц нээлттэй (`lib/attendanceUnrestricted.ts`
  `isAtWork` — өнөөдрийн `clock_out IS NULL` мөр, эсвэл ирцээс чөлөөтэй; ⚠️ `isAttendanceUnrestricted` нь
  `routes/attendance.ts`-ээс ЭНД шилжсэн) → эс бөгөөс 409 `NOT_CLOCKED_IN`.  Дууссан/архив/олдохгүй — `takeDenial`.
- **Хуваагдах таск** (`isSplittableTask`: `progress_mode <> 'hours'` ба жин > 0) дээр НЭГ хүн: өөр хүн явж байвал 409
  `TASK_OCCUPIED` + `occupied.split` (50/50 өгөгдмөл) — юу ч бичигдэхгүй, дуудагчийн өмнөх таймер ч зогсохгүй.  Хориг
  `startOfficialTimer`-ийн INSERT WHERE дотор → зэрэг ирсэн хоёр «авах»-ын ЯГ НЭГ нь ялна.  Хуваагдахгүй (ZA цагаар, жин 0)
  таскт хүмүүс ЗЭРЭГ ажиллана.
- **Хувааж авах** — `POST /api/tasks/:id/split {weights, take: true, take_index?}`: ажиллаж буй хүн хэсэг 0 дээр
  үргэлжилнэ, авагч хэсэг 1.  **Явцтай таск (0 < p < 100) — ЗӨВХӨН ҮЛДСЭН `W − W·p/100`-ийг хуваана** (`planSplit`
  remainder): эх таск «(1/N+1)», жин `W·p/100`, системийн `source='split'` 100% бичлэгээр ХААГДАНА (оноо өгөхгүй, төслийн
  явц ЯГ хэвээр); шинэ хэсгүүд 0%-оос; эх таск дээрх таймер хэсэг 0 руу шилжинэ (`end_note='split'`, `resumeMovedTimer`).
  Guard: эх жин + сүүлийн хувь (`byCreatedAt`) уншсанаас хойш өөрчлөгдөөгүй.  Өөр хүн ажиллаж буй таскийг `take`-гүй
  хуваах нь зөвхөн admin/senior.  Хийгдсэн хэсэг дээр хувь бичвэл 409 `SPLIT_DONE` (admin залруулга хэвээр).
- **`task_assignees` = «ажилласан хүмүүсийн БҮРТГЭЛ»** (түүх) — ~15 уншигч (багийн хуудас, профайл, хугацаа, `?mine=1`,
  «Миний ажлууд», MCP, Revit) тэр утгаараа ажилласаар.  Таймер эхлэх бүрт мөр нэмэгдэнэ, хасагдахгүй.  `tasks.assigned_to`
  бичигдэхгүй.  Оноох зам ХАСАГДСАН: `/share`, `/unassign` → 410 `ASSIGNMENT_REMOVED`; `POST /`, `PUT /:id`
  `assignees`-ийг үл тоомсорлоно; `/unclaim` = тэр таск дээрх миний таймерыг зогсоох; блок хуулахад хүн хуулагдахгүй.
  **Хурлын даалгавар (`meetingTasks.ts`, «Хурлын даалгавар» блок, жин 0) оноолттой ХЭВЭЭР** — 0369 ч хөндөхгүй.
- **Хувь оруулах = тухайн таск дээр албан таймерын сэшнтэй хүн** (`submitProgressEntry` — вэб, bulk, Revit) — эс бөгөөс
  403 `TAKE_REQUIRED`; admin залруулга хэвээр.  Revit-ийн хуудас холбох / AI draft нь бүртгэлээр (мөн TAKE_REQUIRED
  мессеж).  ⚠️ Revit хэрэглэгч таскаа эхлээд вэбээс авна.
- **Мартагдсан таймер**: ирцийн «Гарах» (ажилтан, админы `/sessions/:id/clock-out`, bulk) → тэр агшинд
  (`end_note='clock_out'`; `+08:00` → UTC `…Z` — SQL `MAX(started_at, ?)` мөр харьцуулдаг); эхэлсэн өдрийн УБ
  23:59:59.999-д (`lib/taskTimerSweep.ts`, cron-ын fail-safe салаа, ШИНЭ cron үгүй, `day_end`, мэдэгдэлтэй); админ `POST
  /api/task-timer/users/:id/stop` (`admin_stop`, мэдэгдэлтэй).  Шалтгааныг `task_timer_sessions.end_note` /
  `task_timer_events.note` (0368) тээнэ — 0361-ийн CHECK олонлог ХӨНДӨГДӨӨГҮЙ (rebuild-гүй).
- **Оноо — ХАМГИЙН ӨНДӨР ХУВЬ** — дээрх Points хэсэг.  ⚠️ Deploy-ийн дараа `POST /api/leaderboard/recalc-all` ажиллуулбал HWM
  түүхэнд ч хэрэгжиж, давхар тоологдсон оноо (~1.3%, 09-29-ний хэмжилт) хасагдана — ажиллуулах эсэх нь эзний шийдвэр.
  Ажиллуулахгүй бол жин засагдсан төсөл бүр (`recalculateProjectPoints`) аажмаар HWM руу шилжинэ.
- **0369 (reset)**: огт ажиллаагүй (хувь оруулаагүй, таймер эхлүүлээгүй, «Анхны явц»-ын онооны эзэн биш) эзэмшлийг
  `task_hold_periods`-д бичээд устгана; хувь оруулсан / таймер эхлүүлсэн хүнийг бүртгэлд нэмнэ; `assigned_to` = NULL
  (хурлын даалгавраас бусад).  Оноо, явц, бичлэг ХӨНДӨГДӨХГҮЙ.  09-07-ны prod хуулбар: 3299 мөр → 173 арилж, 278 нэмэгдэв.
  0368 ЗААВАЛ эхэлж (`credit_user_id` хөлдөөнө).
- **Frontend**: `features/projects/detail/taskLive.tsx` (provider — `/task-timer/working` 20 с поллинг + BroadcastChannel;
  `take` нь optimistic БИШ, `useOfficialTimer().take()` дараалалд; 409 → хуваах цонх), `taskLiveContext.ts`,
  `TaskLiveCell.tsx` (lg нүд + мобайл), `TaskSplitDialog.tsx` (remainder + take; `taskSplit.ts` `remainingCents`).
  «Одоо хийж буй» багана — нэр л (цаг нь зөвхөн тухайн хүнд + админд).  Хуучин `TaskAssigneeCell`, `SharePopover`,
  `useProjectTaskActions`, `HoldDaysChip`, setup-ийн `AssigneePicker` УСТСАН.  ~~«Миний ажлууд» = ТҮҮХ: эхлүүлэх товч,
  «Таскаа буцаах» хасагдсан; `can_report=false` мөрөнд «Төсөл дээр авах»~~ — ⚠️ мөн өдөр 0370-аар ДАРАГДСАН (доорх
  хэсэг); `pending_today` = `worked_today` мөрүүд.  Компанийн самбарын хэтэрсэн таскийн «хэн» = одоо ажиллаж буй, үгүй
  бол сүүлд ажилласан.
- Тест: `lib/taskTake.test.ts`, `lib/taskSplit.test.ts`, `lib/taskNamesReset.test.ts` (бодит 0368/0369), `routes/taskTake.test.ts`
  (14), `routes/taskSplit.test.ts` (16), `routes/taskTimer.test.ts` (17).  Prod-хуулбар (09-07 + 0250–0369) дээр API E2E 28/28,
  headless-Chrome 36/37 + 1 (унасан нь тестийн selector — засаад тусад нь давсан; авах, эзлэгдсэн → 50/50 хувааж авах,
  ирцгүй, админ зогсоох, Миний ажлууд → мөр рүү гүйлгэх, 390px, setup).  Дараалал:
  D1 0368 → 0369 → worker → Pages.
- **DEPLOYED 2026-10-01** (commit `33598da1`; deploy worktree `f0cb8f6b` = live суурь `fa8d5e95` + `8287d391` (?mine=1) +
  `33598da1` + ирцийн `b82742e6`/`95cfdce0` — Drive `4e752155` ОРООГҮЙ хэвээр): D1 0368 + 0369 (UTC 03:27, өмнөх bookmark
  `00000222-000009c6-000050f7-7110148ea2962eda55dee88e79db93f9`; 0369 бодит: `task_assignees` 3725 → 3892 (огт ажиллаагүй 207
  эзэмшил `task_hold_periods`-д, хувь оруулсан 374 хүн бүртгэлд), `assigned_to` 3652 → 0, `user_points`/`progress_entries`
  хөндөгдөөгүй), worker `ebd9cdfe`, Pages `f697c30f` (`index-Bm7uQAZl.js`).  ⚠️ UTC 03:25–03:40 хоёр сесс overlay deploy-оор
  бие биенийхээ worker-ийг ДАРСАН (ирц ↔ энэ ажил; 03:36–03:40 прод хуучин таскийн дүрмээр, нэр арилсан DB дээр ажилласан) —
  deploy-ийн ЯГ өмнө `deployments list`-ийг уншаад deploy-г ТУСДАА тушаалаар ажиллуул; прод worker-ийн кодыг Cloudflare API-ийн
  `workers/scripts/mgl-progress-api/content/v2`-оос татаж маркер мөрөөр (`TASK_OCCUPIED`, `extra_days`) шалгаж болно.

### «Миний ажилд нэмэх» — «Миний ажлууд»-ын хувийн жагсаалт (migration 0370, 2026-10-01, DEPLOYED)

Дээрх 0368-ын дараа ажилтнууд өдөр бүр төсөл рүүгээ орж олон таскаас өөрийнхөө ажлыг хайдаг болсон.  Хүсэлт: таскийг
«Миний ажлууд»-даа нэмээд ТЭНДЭЭС шууд цаг эхлүүлэх; нэмсэн нь төслийн хуудсанд хэнд ч харагдахгүй (нэр = одоо цаг нь
явж буй хүн хэвээр); цаг зогсоосон ч таск жагсаалтад үлдэх; жагсаалтын таск дээр өөр хүн ажиллаж эхэлбэл «Миний
ажлууд» шууд харуулах.

- **Олонлог ГАНЦ газар — `lib/myTaskList.ts` `myTaskIdsSql(uid)`** = (`tasks.assigned_to` ∪ `task_assignees` — ажилласан)
  ∪ `task_personal_list.hidden_at IS NULL` (нэмсэн) − `hidden_at IS NOT NULL` (хассан).  `/progress/my-tasks` (+ shares,
  засварын цаг, `findMyTask`), `/progress/my-tasks/ids?project_id=`, `/task-timer/working?mine=1` гурвуулаа үүгээр —
  давтаж бичвэл зөрнө.  Хэрэглэгчийн id-г SQL-д ТОО болгож шигтгэнэ (`asrVisibility`-ийн жишиг).
- **`task_personal_list`** (0370; user_id, task_id PK, `added_at`, `hidden_at`) — ЗӨВХӨН тухайн хүнд; таск дээрх нэр,
  rollup, оноо, тайлан, MCP уншихгүй; `task_assignees`-д юу ч бичигдэхгүй.  FK-гүй: `tasks.delete` ба `DELETE /users/:id`
  гараар.  `POST /api/progress/my-tasks/:taskId/list` (нэмэх — `takeDenial` эрх/таск/төсөл/дууссан, ИРЦ шаардахгүй),
  `DELETE …/list` (хасах = `hidden_at`, ажилласан таскийг ч нууна; тэр таск дээр цаг ЯГ ОДОО явж байвал 409 `TASK_RUNNING`).
  `takeTask` амжилттай бол хассан мөрийг буцаана (`unhideOnTake`, алдаа нь «авах»-ыг унагахгүй).
- **Хуваалт** (`routes/tasks.ts` split): явцтай таскийн нэмсэн мөрүүд үргэлжлэл (хэсэг 0) рүү (`moveListOnSplit` — эх таск
  «хийгдсэн хэсэг» болж хаагдсан); «хувааж авах»-д авагчийн нэмсэн мөр эзлэгчийн хэсгээс өөрийн хэсэг рүү шилжинэ.
- **Frontend**: төслийн хуудасны «Одоо хийж буй» нүдэнд 🔖 (`TaskLiveCell.tsx` `MyListButton`, таск тус бүрийн optimistic
  түгжээ `taskLive.tsx`), `?mine=1`/«Зөвхөн миний» нь `myTaskIds`-аар (`useProjectTasks.isMyTask`).  «Миний ажлууд»
  (`MyTasksPage.tsx`): мөр бүр `TaskTimerControl onStart` → `useTakeTask` (`features/projects/detail/useTakeTask.ts` —
  төслийн хуудастай ГАНЦ «авах» урсгал: ирцгүй → алдаа, эзлэгдсэн → «Хувааж авах» цонх); `can_report=false` мөрөнд хувь
  оруулах маягтын оронд «Эхлүүлсний дараа хувь оруулна»; «Одоо: X» = `useMyListWorkers` (`/task-timer/working?mine=1`,
  10 с); 🔖− «Миний ажлаас хасах» (баталгаажуулалттай, явж буй мөрөнд байхгүй).  Төслийн хуудасны нэрс 20 → 10 с.
  Клиент модуль `features/tasks/myTaskList.ts`.  Самбарын карт хөндөгдөөгүй (зөвхөн «Зогсоох»).
- **«Бодит цаг» = поллинг** (10 с, далд табд зогсоно) + нэг хөтчийн табуудад `BroadcastChannel` шууд — WebSocket/DO БИШ.
  Хэмжсэн: А «Миний ажлууд»-аас эхлүүлэхэд Б-ийн төслийн хуудсанд нэр 7.4 с-д, А зогсооход Б-ийн «Одоо» 9.4 с-д.
- Тест: `routes/myTaskList.test.ts` (7, бодит 0361+0368+0370); `taskTake`/`taskSplit`/`taskTimer` harness-д 0370 нэмэгдсэн.
  Прод экспорт (10-01, 0369) + 0370 scratch дээр API (workerd) 14/14, хоёр хэрэглэгчийн headless-Chrome 27/27, 390px.
  Дараалал: D1 0370 → worker → Pages (шинэ worker `task_personal_list`-ийг `/my-tasks`-д уншдаг — миграцгүйгээр 500).
- **DEPLOYED 2026-10-01** (commit `d7ad3cac`; deploy worktree `6e2cecaa` = live суурь `f0cb8f6b` + `d7ad3cac`, Drive `4e752155`
  ОРООГҮЙ хэвээр): D1 0370 (worker-ээс өмнө, bookmark `00000223-000001d2-000050f7-c48aac83e8142fd50ed60f8716c25470`),
  worker `5c866e77`, Pages `4e57a5dc` (`index-CzyOl5sG.js`; live chunk 283/283 локалтай ижил).

### Таскийн ХУВААРИЛАЛТ — нэг root, хүн бүрт хуваарилалт (migrations 0376–0380, 2026-10-02, NOT DEPLOYED)

Эзний 2026.10.02-ны дүрэм: таск хуваахад ШИНЭ ТАСК ҮҮСЭХГҮЙ — нэг «үндсэн ажил» (root = `tasks.id`, дотоод жин `W` ХЭЗЭЭ Ч өөрчлөгдөхгүй)
хүн тус бүрийн **хуваарилалт** (`task_allocations`) болж хуваагдана.  Бүх хийсэн/зорилт ҮНДСЭН АЖЛЫН хувиар, тогтмол цэгтэй (1 пункт = 10 000 нэгж,
бүтэн = 1 000 000).  Инвариант: `0 ≤ L_i ≤ D_i ≤ T_i ≤ 100`, `Σ T_i + B + U = 100`, `root_done = Σ D_i + B` (B = эзэнгүй хуучин хийсэн, U = хуваарилагдаагүй).
**ГАНЦ эхлэх цэг — `docs/task-workflow-2026-10-02.md`** (дүрмийн хүснэгт, API, файлын зураг, шалгасан зүйл, runbook, үлдэгдэл); энд зөвхөн анхаарах зүйлс:

- **Цөм цэвэр, хоёр хуулбартай:** `backend/src/lib/{taskUnits,taskAllocation,taskCredit,taskSeed}.ts` ↔ frontend `features/task-allocation/{units,allocation}.ts`
  (БАЙТ-ИЖИЛ; `npm run check:task-units` transpile хийж тулгана, `verify`-д).  Мутаци ГАНЦ газар `lib/taskRootOps.ts` (marker-тэй D1 `batch`,
  `request_id` идемпотент, `expected_revision` CAS → 409 `STALE_REVISION`); routes `routes/taskAllocations.ts` (`/api/tasks`-ийн 2 дахь mount, `tasks`-ээс ӨМНӨ).
- **Хаагдсан хуучин замууд:** `POST /api/tasks/:id/split` БҮХ таскт 410 `SPLIT_RETIRED`; таскийн дэд хугацааг (`task_deadlines`) үүсгэх/засах/биелүүлэх/устгах 4 зам
  410 `SUB_DEADLINE_RETIRED` (түүх, GET, `can_edit:false`, milestone ХЭВЭЭР; нээлттэй хуучин шалгах цэг «Удахгүй»/хуанли/төслийн «Хугацаа»-д гарахгүй); managed таскт хуучин `POST /api/progress` → 409 `MANAGED_ROOT` (Revit add-in ч — вэбээс бөглөнө);
  түүхтэй root-ын `DELETE /tasks/:id` → 409 `ROOT_PROTECTED`.
- **410 замуудыг УСТГАХААС ӨМНӨ ХЭМЖИНЭ (2026-10-15, эзэн):** хуучин PWA / кэштэй хуудас 410-ын оронд 404 (эсвэл `/:id`-ийн өөр
  handler) авах тул. 9 зам (`tasks.split`, `tasks.share`, `tasks.unassign`, `tasks.allocation_parts`, `tasks.allocation_claim_part`,
  `deadlines.task_create|update|done|delete`) `lib/retiredHits.ts` `retiredHandler`-аар дамжиж `app_settings['retired_hits.<route>']`-д
  `{count, first_at, last_at, last_user, last_ua, users}` (атом UPSERT, миграцгүй, `waitUntil`, бичилт унавал 410 хэвээр) +
  `[retired]` лог (`wrangler tail`). Унших: `wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command
  "SELECT key, value FROM app_settings WHERE key LIKE 'retired_hits.%'"`. Мөр байхгүй = deploy-оос хойш дуудаагүй; 2–4 долоо хоног 0
  бол устгах. Frontend, Revit add-in, MCP-д эдгээрийн дуудагч 0 (2026-10-15 grep). Шинэ 410 зам нэмбэл мөн `retiredHandler`-аар.
  Тест `lib/retiredHits.test.ts`. Мөн өдөр цэвэрлэсэн: өөрийн явцын автомат хадгалалтын үлдэгдэл (`SAVE_DEBOUNCE_MS`, `Draft.dueAt`,
  store-ын `timer/schedule`, `now` параметр) ба setup хуудасны `toggleTaskAssignee` / `workers` / `teamCode`→`TaskRow` prop гинж —
  `buildSetupSummary`-ийн `t.assignees` (= ажилласан хүмүүсийн түүх) ХЭВЭЭР.
- **Lazy seed:** хуучин таскийг анх хуваахад л хуучин түүх `task_roots`-д бичигдэнэ, ШИНЭ ОНОО ҮГҮЙ → глобал backfill, `recalc-all` энэ release-д ХЭРЭГГҮЙ.
- **Оноо журналаас:** `task_contributions` + `user_points.contribution_id/reverses_points_id/recorded_at` (0378).  Өөрийн бүртгэл залруулахад СӨРӨГ мөр анхны
  `awarded_at`-аар (`planReversal`), сэргээлт = буцаалтын урвуу (давхар оноо үгүй).  `recalculateProjectPoints` managed `source='progress'` мөрийг ХӨНДӨХГҮЙ —
  ⚠️ хуучин код рүү rollback хийвэл recalc тэдгээрийг УСТГАНА.  COUNT(*)/`award_count` уншигчид буцаалтын мөрийг нэмж тоолно (SUM цэвэр).
- **Projection:** хадгалалт бүр `progress_entries` дээр `source='alloc'` (actor-ын тайлан), залруулга/сэргээлт `'alloc_adj'` (ажлын үйл явдал БИШ — attendance
  `hasReportedWorkToday`, repair, snapshot, leaderboard, reports бүгд хасдаг) мөр бичнэ; `created_at` таск тутамд хатуу өсөх (`nextEntryTs`), `lib/progressLatest.ts`
  `id DESC` tie-break + `idx_progress_task_approved_latest_id`.
- **Албан таймер:** managed таск дээр олон хүн ЗЭРЭГ ажиллана; ирээдүйн ажилгүй хүн ▶ дарвал 409 `NOT_ALLOCATED {allocation}` → «Хуваарилж, авч эхлэх» цонх.  Өөрийн сэшнийг
  хүчингүй болгох/сэргээх = `task_timer_voids` (аудит хадгалагдана, `notVoidSql` бүх уншигчид).  `idx_tts_task (task_id, user_id)` (0380) нь deploy салааны 0373-тай ЯГ ИЖИЛ
  тодорхойлолт — өөр баганатай ижил нэртэй индекс БҮҮ нэм.
- **UI** `features/task-allocation/`: `OwnProgressControl` (− / + = нийт зорилтын 10%/1%, «Үлдсэн ажлаа дуусгах», хатуу тоо, 5 сек debounce + «Одоо хадгалах / Буцаах»,
  STALE автомат дахин), `AllocationEditorDialog` (авто-тэнцвэржилт, 'нийт'/'үлдсэн' горим), `CompletionQaDialog` (хоёр хүрээ), `OwnRecordsDialog`, `ContributorsList`
  («Б.Бат» богино нэр = `shared/lib/staffName.ts`; засварын цаг тусдаа, нэгтгэхгүй).  engineer/architect-д дотоод жингийн багана нуугдсан (UI л — `GET /projects/:id`
  бүх жинг буцаасаар); дугаар 17 → 17.1 бүтцээс (шүүлт/эрэмбээс үл хамаарна).
- **⛔ ДЕПЛОЙ-ИЙН СААД:** прод нь main-д ОРООГҮЙ `94df1fc1` (ROOT бүлэг + дэд таск, migration 0372 `task_groups` + `tasks.group_id`) ба `e1d55087` («нэр – цаг», 0373) кодтой
  (салаа `deploy/live-2026-10-01-task-groups`, `deploy/live-2026-10-02-revit-license`; Pages `fdf12a6d`).  Main-аас шууд deploy хийвэл тэр код прод-оос БУЦАЖ, энэ загвартай
  ойлголтоор зөрчилддөг (тэдний `/split` хуулбар таск үүсгэнэ).  Эзний шийдвэр + гар merge хэрэгтэй — handoff §11.
- Шалгасан 2026-10-02: backend `tsc` цэвэр, `npm test` 2563/2566 (3 уналт нь өмнөх — 0214/0245 statement, миграцын дугаар давхардал, `templateNote`), frontend `verify`
  ногоон (`check:task-units` 48), headless-Chrome E2E 106/106 (бодит router + бодит миграц дээр).  Deploy, прод миграц, прод өгөгдөл, commit ХИЙГЭЭГҮЙ.
- **2026-10-05 — production-hardening (0383–0385, `docs/task-workflow-2026-10-02.md` §13, NOT DEPLOYED):**
  - **Идэвхжүүлэлтийн хаалга** `app_settings['task_alloc.state']` = `disabled|enabled|paused` (мөр байхгүй/буруу = `paused`, `lib/taskAllocGate.ts`, 0384 `task_alloc_state_log`).  Клиент `X-Task-Alloc-Contract` (`TASK_ALLOC_CONTRACT = 1`,
    frontend `shared/api/taskAllocContract.ts` ИХЭР — `check:task-alloc-admin` тулгана; **ЗӨВХӨН managed мутацид** явна (`needsAllocContractHeader`) — бүх хүсэлтэд явбал хуучин Worker-ийн CORS preflight-ээр апп бүхэлдээ унана) → толгойгүй/хуучин **426** (ҮРГЭЛЖ эхэнд), төлөв хаалттай **423**; managed мутаци ЗӨВХӨН.  **`paused` = яаралтай түгжээ** (түүх/оноо/цаг устахгүй).
    Админы `/api/tasks/alloc-admin/*` (state, roots, audit, conversion, credit/reweight) хаалганаас чөлөөтэй, ЗААВАЛ эхэнд mount.  Бүтэцтэй лог `lib/taskAllocLog.ts` (зөвхөн идентифайер, `X-Request-Id` корреляци).
  - **Идемпотент:** `task_ops.request_hash` (0383) — ижил `request_id` өөр агуулга → 409 `REQUEST_REUSED`; commit-ийн дараах үр дагавар `post_status pending→done` (`lib/taskPostCommit.ts`).
  - **Хуучин бүлгийн хөрвүүлэлт** (0385, `lib/taskConversion{,Plan}.ts`): root = бүлгийн нэг таск, жин `W=Σw`, `T=100·w/W`, `D=T·p/100` ⇒ төслийн явц ЯГ хэвээр (`ROLLUP_DRIFT`); нэгтгэгдсэн хэсэг жин 0 + бичилт 409 `CONVERTED_PART`;
    хийсэн хэсэг ЗӨВХӨН нотолгоотой хүнд (үгүй бол эзэнгүй B — нэр ХЭЗЭЭ Ч зохиохгүй); preview (юу ч бичихгүй, `plan_hash`) → admin apply (атом, идемпотент, `PLAN_STALE`) → revert (root дээр юу ч хийгдээгүй үед).
    ⚠️ «Зарласан бүлэг» = `tasks.group_id` (0372, main-д БАЙХГҮЙ) — багана ИЛРЭХ үед л; прод-д бодит эсэх баталгаагүй.
  - **Оноо:** жин/төвөгшил/багийн хувь өөрчлөгдөхөд managed оноо ЖУРНАЛААС тулгагдана (`lib/taskCreditReweight.ts`, нөхөн мөр `task_credit_adjustments`, анхны мөр дарагдахгүй; **`paused`/`disabled` үед автомат тулгалт бичихгүй**, админы `credit/reweight` = `force`); **инвариант аудитор** `lib/taskAllocAudit.ts` (16 код, `GET alloc-admin/audit`).
  - **UI:** `/app/admin/task-allocation` (admin+senior; Төлөв · Аудит · Хөрвүүлэлт · Оноо) + `TaskAllocGateBanner`.  **Revit/MCP:** managed → 409 `MANAGED_ROOT`, нэгтгэгдсэн → 409 `CONVERTED_PART`; `/work-context` хоёуланг `managed:true`.
  - ⚠️ **0385 worker-ээс ӨМНӨ** (хуучин «Миний ажлууд», `/progress`, Revit work-context одоо `task_conversion_members` уншина).  0382 нь өөр салбарт (guardian) нөөцлөгдсөн.
  - **Хаагдаагүй хаалга:** staging D1 (0383–0385), Worker provenance, прод `task_groups` схем, add-in C# компайл — тусдаа.  Вердикт NOT PRODUCTION-READY (§13.1).

### Хүнгүй ХЭСЭГ — таскийг хүн оноолгүйгээр нэр + хувиар хуваах (migration 0394, 2026-10-09, DEPLOYED — `b49b8df8`: D1 0394, worker `040e19df`, Pages `d9baed0c` `index-DviNarOX.js`; товчны засвар `9bbbfcf0` → Pages `e3ac2f7d`; шинэ/хуулсан мөрийн нэр = таскийн нэр `78d19b68` → Pages `984290d8` `index-BtLyZDQ9.js`)

Эзэн: ажилтан таскаа өөрөө задална — хэсгүүдийг нэрлэж, хувийг нь тохируулж, мөрийг хуулж, нэрийг нь сольж болно.
Хүн оноохгүй. Эзний 2 хариулт (AskUserQuestion): **нэг таск дотор хүнгүй хэсэг** (шинэ таск БИШ) · **бүх ажилтан** хуваана.

- **`task_parts`** (0394): (task_id, ordinal, label, units). Хэсэг = хуваарилагдаагүй ирээдүйн ажлын (`U`) НЭРЛЭСЭН нөөц:
  Σ units ≤ U. Хүн, хийсэн ажил (D), оноо байхгүй. `task_allocations`-ийг дахин бүтээгээгүй (`user_id NOT NULL`,
  `UNIQUE(task_id,user_id)` хэвээр). Дугаар нь `task_roots.next_ordinal`-оос авна (хуваарилалттай НЭГ тоолуур,
  12.k давхцахгүй). Цэвэр дүрэм `lib/taskParts.ts` (`planParts`, `mergedLabel`).
- **Мутаци** (`lib/taskRootOps.ts`, CAS + marker, `/:id/allocation/*` хаалганы ард): `applyParts` (`POST …/allocation/parts`,
  БҮРЭН жагсаалт, байхгүй болсон нь устна; managed болоогүй таскийг seed-ээр managed болгоно — `applyAllocation`-тай ижил
  `seedGuard` + `seedSliceStatements`) · `claimPart` (`POST …/allocation/claim-part`): хэсэг нь авсан хүний хуваарилалт
  болно (ижил дугаар + нэр, U −= units, мөр устна). Тэр хүн аль хэдийн хуваарилалттай бол T дээр нэмэгдэж, нэр «A · B»
  болно. `PUT /:id/part-label` = зөвхөн нэр (revision хөдлөхгүй, хаалганаас гадуур, `allocation-label`-ийн ихэр).
- **Нөөцийг хамгаалах:** `applyAllocation` ба `retakeAllocation` нь хэсгүүдийг түр «B» (түгжигдсэн) гэж тооцно, тиймээс
  хүний хуваарилалт/чөлөөт ажил хэсгийг ХЭЗЭЭ Ч булаахгүй. Цэвэр ихэр `taskAllocation.ts` ↔ frontend `allocation.ts`
  ХӨНДӨГДӨӨГҮЙ. Frontend `AllocationEditorDialog` `baseOf` нь ижил аргаар тооцно. `NOT_ALLOCATED.available_units` ба
  `RootView.free_units` = U − Σ хэсэг. Root устахад хэсэг хамт устна (`taskUnsplit`, `taskConversion` revert,
  `taskRootGuard` `purgeOrphanParts`). Аудит: `PARTS_OVER_FREE`.
- **UI:** мөрийн ✂ товч — `TaskLiveCell` `PartsButton`, бусад БҮХ товчны (▶, 🔖, 👥 / ⋯) БАРУУН талд НЭМЭЛТ товч, тэдгээрийг
  ОРЛОХГҮЙ (эзэн 2026-10-09: эхний хувилбар 👥-г ✂-ээр сольж байсныг буцаасан; ⋯ цэс, 👥 «Хуваарилах» өмнөхөөрөө) →
  `PartsEditorDialog` (`partsEditor.ts`, цэвэр: хуулах = хувь хоёр хуваагдана, гараар засаагүй мөрүүд одоогийн
  харьцаагаар дахин хуваагдана, «Хүнд шууд хуваарилах» → хуучин засварлагч). Хэсэг нь `AllocationChildRows`-д 26.k мөр
  болно: «Хүнгүй» + «▶ Авах» → claim + цаг (`taskLive.tsx` `claimPart`, синхрон ref түгжээ). Root ▶ → `NOT_ALLOCATED`
  цонх хэсгүүдийг жагсаана.
- Тест: `lib/taskParts.test.ts` (5), `routes/taskParts.test.ts` (5, бодит SQLite), `taskAllocGate.test.ts` (шинэ замууд
  426/423). Хөтчийн E2E 24/24 scratch prod-хуулбар (0394 хүртэл) дээр. **Deploy дараалал:** D1 0394 → worker → Pages.
- ⚠️ **2026-10-09-ний оройноос ДАРАГДСАН** (доорх «✂ = ҮНДСЭН таскууд»): `POST …/allocation/parts` ба `…/claim-part` → 410
  `PARTS_RETIRED`, `PartsEditorDialog`/`partsEditor.ts` УСТСАН.  Шалтгаан (эзэн): нэг хүн хоёр хэсэг авахад «A · B» болж
  нийлээд НЭГ цаг явдаг байв.  Одоо байгаа хэсгүүд харагдсаар, «Таск болгох» → ✂ цонх тэднийг урьдчилан бөглөнө.  Lib
  (`applyParts`/`claimPart`) хуучин өгөгдөлд үлдсэн (тест lib-ээр шууд).

### ✂ = ҮНДСЭН таскууд болгон хуваах + дэд таскийн нэр/хүн/хуулах + Ctrl+Z / буцаах (migration 0395, 2026-10-09, DEPLOYED 2026-10-12 — main `0d1a137b`: D1 0395, worker `59fd2856`, Pages `3bd8dbba` `index-Av1HxeRa.js`; ⧉/«Нэмэх» дармагц шинэ мөрийн нэр фокуслогдож сонгогдоно)

Эзэн: хуваасан хэсэг нь ЖИНХЭНЭ үндсэн таск болно (нэр + хувь, мөр хуулах); тэр үндсэн таскаас дэд таск (хуваарилалт)
үүсгэхдээ нэрийг нь сольж хүнд шууд онооно, дэд таскийг ч хуулна; буруу хуваасныг Ctrl+Z / «Буцаах»-аар алдаагүй буцаана.
Эзний хариулт (AskUserQuestion): явцтай таск → ҮЛДСЭНИЙГ л хуваана · хүнгүй хэсгийг ✂-ээр солино (нийлсэн «A · B» мөрийг
хөндөхгүй) · бүх ажилтан · нэг хүнд нэг таскт ОЛОН дэд таск (тус бүр өөрийн цагтай) = **2-р шат, ХИЙГЭЭГҮЙ** (хуваарилалт,
таймер, онооны журнал (task,user)-ээр ~25 газар түлхүүрлэгдсэн — `UNIQUE(task_id,user_id)`); 1-р шатанд editor тэр хүнийг
дахин сонгуулахгүй, «✂-ээр тусдаа таск болго» гэж заана.

- **Хуваах** `POST /api/tasks/:id/root-split {request_id, parts:[{name, share_units}]}` (`routes/taskRootSplit.ts`, `/api/tasks`-ийн
  mount, `tasks`-ээс ӨМНӨ; дүрэм `lib/taskRootSplit.ts` цэвэр + `lib/taskRootSplitStore.ts`).  Хувь = хуваагдах ажлын хувь
  (Σ = 1 000 000), сервер жин болгоно (центийн хамгийн их үлдэгдэл) → хуучин `planSplit` (`lib/taskSplit.ts`).  Явцгүй: эх таск =
  эхний хэсэг (id, нэр, жин).  Явцтай: эх таск «<нэр> (хийгдсэн p%)», жин W·p/100, `source='split'` 100% бичлэгээр хаагдана,
  үлдсэн нь шинэ таскууд; эх таск дээрх таймер эхний хэсэг рүү (`startOfficialTimer`), «Миний ажлууд» хуулагдана — төслийн
  явц ЯГ хэвээр.  CAS = журналын мөрийн INSERT (жин + `latestApprovedPctByCreatedAt` + task_roots байхгүй), бусад нь marker-тэй.
  Хүнд хуваарилагдсан → 409 `HAS_ALLOCATIONS`; зөвхөн хүнгүй хэсэгтэй managed таск → эхлээд `unsplitTask` (хэсгүүд цонхонд
  `prefill`).  Өөр хүн ажиллаж байвал ажилтан 409 `TASK_OCCUPIED`, admin/senior/CEO хуваана.  hours горим / жин 0 / нэгтгэгдсэн
  хэсэг / идэвхгүй төсөл → 409.
- **Буцаах** `POST /api/tasks/root-splits/:id/undo` — журнал `task_root_splits` + `task_root_split_members` (0395, FK-гүй).
  Шинэ таск дээр хувь/оноо/хуваарилалт/хэсэг/хугацаа/milestone/засвар/хамтарсан хуваалт, жин өөрчлөгдсөн, дахин хуваасан, эх таск
  дээр `entry_mark`-аас хойш бичлэг → 409 `UNDO_BLOCKED` (+ `blockers`, `undoBlockedMessage`).  Бусад тохиолдолд НЭГ batch:
  таймерын сэшн/үйл явдал/void, `task_assignees`, «Миний ажлууд», checklist, hold, Revit холбоос эх таск руу; шинэ таскууд
  устаж эх таск анхны нэр/жин, `split` бичлэг устана.  CAS-ын SQL шалгалтыг ДАВТАНА.  `GET /api/tasks/:id/root-split` = цонхны
  өгөгдөл + `last_split` (`undoable`, `blocked_message`).
- **UI** `features/task-allocation/RootSplitDialog.tsx` + `rootSplitEditor.ts` (цэвэр) — ✂ товч (`TaskLiveCell` `RootSplitButton`,
  `task-root-split`, бусад товчны баруун талд); хадгалсны дараа `toast.successWithAction` «Хуваалтыг буцаах» (12 с; `Toast.tsx`-д
  шинэ `action`), цонхонд «сүүлийн хуваалт» блок.  Дэд таск: `AllocationEditorDialog` мөр бүрт нэр (`PUT …/allocation-label`,
  хуваарилалт хадгалсны ДАРАА), ⧉ хуулах → хүлээгдэж буй мөр, хүн сонгоход ирээдүйн ажил хоёр хуваагдана; хадгалсны дараа
  «Буцаах» (шинээр managed болсон бол `unsplit`, эс бөгөөс өмнөх targets + нэрс).  Ctrl+Z / Ctrl+Y = `shared/hooks/useUndoHistory.ts`
  (`useUndoHotkeys` WINDOW capture-д — Radix Select хаагдсаны дараа фокус body руу очдог тул элементийн `onKeyDown` хүрэхгүй;
  нэгтгэх түлхүүрийг updater-ээс ГАДНА шийднэ — StrictMode updater-ийг хоёр дуудна; Ctrl+Z үед бичиж буй % талбарын түр бичвэр
  цэвэрлэгдэнэ).
- Тест: `routes/taskRootSplit.test.ts` (8, бодит SQLite), `routes/taskParts.test.ts` (6, 410 + lib).
- **Үндсэн таскийн нэр + админы устгах (2026-10-12, миграцгүй, DEPLOYED — main `467e39f1`, worker `a6f871ef`, Pages `1082f783` `index-BbGSTc34.js`).**
  Төслийн хуудасны мөрөнд (`FlatTaskRow`/`GroupedTaskRow` → `detail/TaskNameEditor.tsx`) нэрийн хажууд hover-т ✏ (✂ хуваах эрхтэй ИЖИЛ:
  admin/senior/engineer/architect) → `PUT /api/tasks/:id/name` (`routes/taskAllocations.ts`, ЗӨВХӨН нэр, ≤200; `PUT /tasks/:id` admin/senior-д
  хэвээр) ба 🗑 ЗӨВХӨН admin → баталгаажуулалт → хуучин `DELETE /tasks/:id` (хийсэн ажилтай хуваарилагдсан таск 409 ROOT_PROTECTED — серверийн
  `message` харагдана; устгасан хэсэгтэй ✂ хуваалт `MISSING`-ээр буцаагдахгүй).  Мөн өдөр прод task 19450 (төсөл 32 Podium «Моделчлох»)-ийн хүнгүй
  15 хэсгийг гар SQL-ээр үндсэн таск болгосон (root 50 → 8.33%, явц 6 → 36.0144% `alloc_adj`, хийсэн ажил/оноо хэвээр, аудитын инвариант ногоон).
- **✂ хэсгийг устгахад жин БУЦНА (2026-10-12, миграцгүй, DEPLOYED — main `7b5122b1` (засвар `fdd2af3f`), worker `957aab2c`, Pages `1bad5b05` `index-OZcBhGhf.js`).**
  Прод дээр 2.77 → 1.39 + 1.38 хувааж хуулбарыг устгахад жин төслөөс алга болж бүлэг 48.62% болсон.  `DELETE /tasks/:id` одоо устгах таск
  буцаагдаагүй ✂ хуваалтын `role='part'` гишүүн бол ОДООГИЙН жинг нь тэр хуваалтын үлдсэн `part` гишүүн рүү (эх таск түрүүнд, эс бөгөөс
  байрлал; ижил бүрэлдэхүүн; хамгийн сүүлийн хуваалт) НЭГ batch-д нэмнэ (`lib/taskRootSplitStore.ts` `findWeightHeir` + `inheritWeightStatement`,
  managed бол `reconcileTaskCredit`); явцтай хуваалтын `done` хэсэг жин АВАХГҮЙ.  Хариу `weight_merged_into`; `GET /tasks/:id/delete-preview`
  (admin/senior) нь устгах цонхонд «жин нь X руу буцна» гэж хэлнэ.  Тест `routes/taskRootSplit.test.ts` +3.  Продын тэр мөр аль хэдийн гараар 2.77 болсон.  Хөтчийн E2E 25/25: жинхэнэ
  router-ууд node:sqlite дээр + `TaskLiveProvider` харness (хуваах, Ctrl+Z/Y, toast буцаах, явцтай хуваалт, цонхноос буцаах, дэд
  таскийн нэр/хуулах/хүн сонгох/Ctrl+Z, 410).  Prod-хуулбар D1 дээр ШАЛГААГҮЙ.  **Deploy дараалал:** D1 0395 → worker → Pages
  (хуучин worker дээр шинэ Pages-ийн ✂ 404 өгнө).

### Revit-ийн автомат цаг бүртгэл + суулгагч (Session 4–6, 2026-09-29, migration 0360, add-in 1.4.0)

**DEPLOYED 2026-09-29** (release `19eeea2b`, backend + D1; add-in 1.4.0-ийн суулгагч exe ТАРААГДААГҮЙ — эзэн Revit 2027 дээр нэг удаа ачаалж шалгасны дараа гараар): D1 0360 + 0361 + 0362 (өмнөх bookmark `00000208-0000191a-000050f5-48fc5dbed58907693d842fff2c5c0522`), worker `9dd687d1` (100%), Pages `49353053` (`index-DhWmMHXk.js`).

Хэмжиж буй зүйл: **«ажилтны ОДООГИЙН ERP таск дээр Revit-д ИДЭВХТЭЙ ажилласан хугацаа»** — хүний бүх бүтээмж
БИШ. **⚠️ ДАЛД СИСТЕМ (эзний шийдвэр 2026-09-29, «хоёр тусдаа систем»):** албан ёсны, CEO-д харагдах цаг нь гараар
удирдах Play/Pause таймер (тусдаа сесс, migration 0361). Энэ Revit бүртгэл ажилласаар ч ERP-ийн ямар ч хуудас (CEO
самбар, профайл), ажилтны Revit самбар ХАРУУЛАХГҮЙ, албан таймертай ХОЛИХГҮЙ — UI-д холбохоос өмнө эзнээс асуу. Add-in зөвхөн (а) урд цонх ЭНЭ Revit процессынх уу
(`GetForegroundWindow`), (б) Windows-ийн сүүлийн оролтоос хойш хэдэн мс (`GetLastInputInfo`) уншина — товчлуур,
дэлгэц, clipboard, текст, бусад програмын нэр ХЭЗЭЭ Ч үгүй. Revit-ийн `Idling`-ийг «хүн идэвхгүй» гэж хэрэглэхгүй.
«MGL ажил» самбар (нэвтрэх, таск сонгох, 99%/100% маягт) нь зэрэгцээ сессийн ажил — `revit-mcp/addin/WorkPane/`,
`GET /api/revit/work-context`.

- **Цөм = `revit-mcp/addin/WorkTracking/Core/`** (Revit/WPF-гүй, `tests/WorkTracking.Tests` 36 тест, `dotnet run`).
  Бүх босго ГАНЦ газар — `TrackingPolicy` (дохио 2 с, sync 10 с, **idle 5 мин**, Revit урд биш хүлцэл 30 с,
  >60 с завсар = унтах/цаг солих → тоологдохгүй). Хугацаа нь ЗӨВХӨН монотон (`Stopwatch`); ханын цаг зөвхөн
  аудит/өдрийн хил (УБ). 10:00-д зогссон хүн 10:05-д IDLE, 10:00–10:05 нь тоологдоно; оролт буцахад ижил таск
  дээр автоматаар. Таск/баримт солигдоход ЭХЛЭЭД хуучныг одоо хүртэл тоолоод шилжинэ.
- **Сегмент = ХУРИМТЛАЛ, delta БИШ** — (сесс, хэрэглэгч, таск, баримт, өдөр) тутамд нэг мөр, `rev`-тэй; сервер
  `MAX`-аар хадгална → давтан хүргэлт/дараалал алдагдах ХЭЗЭЭ Ч давхар тоолохгүй. Офлайн дараалал
  `%APPDATA%\RevitMcpAddin\tracking\outbox-<сесс>.json` (процесс тутамд + `FileShare.None/DeleteOnClose` түгжээ;
  унасан Revit-ийн «өнчин» файлыг дараагийн эхлэл шингээнэ). Серверийн `acks` ирсэн мөрийг л хасна; 2xx биш
  (оффисын 403 ч) = бүгд хадгалагдана. Өөр хүний токеноор ХЭЗЭЭ Ч илгээхгүй (мөр бүр `user_id`-тай).
- **Таскийг add-in ДУРААРАА сонгохгүй** — ажилтны сонголт (эсвэл түүний санагдсан сонголт,
  `tracking\context.json`: баримт→төсөл, хэрэглэгч×төсөл→таск). Баримт солиход санагдсан таск автоматаар;
  мэдэгдэхгүй баримтын төслийг хост `/api/revit/context`-оос өөрөө асууна (самбар хаалттай ч ажиллана).
- **Хост** `WorkTracking/WorkTrackingHost.cs` (`App.cs`-ийн хоёр `#if MGL_WORK_TRACKING` мөр; net48-д хасагдсан):
  ViewActivated / DocumentClosing, 2 с timer, 10 с арын loop (`AiHttp.Http`, UI thread хэзээ ч хүлээхгүй),
  хаалтад дискэнд хадгалаад ≤1.5 с `ended` heartbeat. (Ажилтны `TrackingPanel` далд шийдвэрээр ХАСАГДСАН.)
  Тайлан: `EnqueueReport` → ЭХЛЭЭД дискэнд → `/api/revit/submissions` (тогтвортой `draft_uid`); 400/404/409/
  HOURS_PROGRESS = «Илгээгдсэнгүй» (текст хадгалагдана, «Дахин илгээх» ШИНЭ uid-аар), сүлжээ/5xx/оффисын 403 = дахин.
- **Backend** `routes/revitTracking.ts` (`/api/revit`-ийн 2 дахь mount, `lib/revitTracking.ts` цэвэр; тест 8 + route 9 бодит SQLite):
  `POST /tracking/sync` (heartbeat + сегмент; `user_id` токеноос, project таскаас), `GET /tracking/day` ба
  `GET /tracking/live` — хоёулаа **ЗӨВХӨН admin** оношилгоо, UI/цэсэнд холбогдоогүй (heartbeat 45 с тасрахад OFFLINE).
  `/submissions` нь `report_date` (офлайн тайлан бичсэн өдөртөө, ≤3 хоног) + `revit_active_ms`-ийг авдаг болсон.
  `users/:id` DELETE гараар цэвэрлэнэ (FK-гүй). ⚠️ 0201–0205-ын «элемент түвшний BIM үйл ажиллагаа зөвхөн өөртөө»
  дүрэм ХЭВЭЭР — энэ модуль элемент/харагдац хадгалдаггүй.
- **Суулгагч** `revit-mcp/installer/` — `build-installer.ps1 -Build` → `revit-mcp/dist/<v>/MGL-Revit2027-Setup-<v>.exe`
  (IExpress; stub `asInvoker` → UAC үгүй; admin эрх, асуулт, тохиргоо ҮГҮЙ). Хэрэглэгч тутамд:
  `%LOCALAPPDATA%\MGL\RevitAddin\2027\versions\<v>\` + `%APPDATA%\Autodesk\Revit\Addins\2027\RevitMcpAddin.addin`
  (абсолют зам, ИЖИЛ AddInId/нэр → хуучин zip/dev манифестыг дарна, хуучин `Addins\2027\RevitMcpAddin\` DLL-ийг
  устгана) + HKCU «Apps & features». Revit нээлттэй үед шинэ хувилбар ХАЖУУД суугаад дараагийн нээлтэд
  ачаалагдана (хагас ачаалал үгүй). Устгахад `%APPDATA%\RevitMcpAddin` (токен, илгээгдээгүй цаг) ХАДГАЛАГДАНА
  (`-PurgeData` цэвэрлэнэ). ⚠️ IExpress-ийн `AppLaunched` нь **`run.cmd`** байх ёстой — `cmd /c run.cmd` нь
  Windows 11 26200 дээр юу ч ажиллуулахгүй 0-ээр гардаг (хэмжсэн; `installer/build.ps1` (MGL AI) тэр хэлбэртэй).
  `test-installer.ps1 [-WithRegistry]` — бодит exe-г тусгаарлагдсан root руу (46 шалгалт). Гарын үсэггүй: SmartScreen
  ба Revit-ийн «Add-In Security» (Always Load) нэг удаа асууна.

### Revit add-in ЛИЦЕНЗ — компанийн бүртгэлээр (add-in 1.9.0, migration 0374, DEPLOYED 2026-10-02) — ⚠️ 0375-аар ДАРАГДСАН хэсэгтэй (доорх «ТӨХӨӨРӨМЖИЙН КРИПТО ТАНИЛТ»: TTL 72→12 цаг, шинэчлэл 6→1 цаг, proof/session)

**⚠️ 2026-10-02 — ӨГӨГДМӨЛ ДҮРЭМ СОЛИГДСОН: «бүртгэлээрээ нэвтрэхэд л ажиллана» (эзэн; commit `e6f2ce38`).**  Ажилтнууд «Admin-д хандана уу» гэж
гацаж байсан (шалтгаан: сервер deploy хийгдээгүй → 404 → «Лицензийн сервер бэлэн биш байна. Admin-д хандана уу»; deploy хийсний дараа ч
ажлын PC-тэй таараагүй компьютер `pending` болох байсан).  `revit.enroll_approval` = **`account`** (өгөгдмөл): идэвхтэй ажилтны бүртгэл
(admin|senior|engineer|architect) хангалттай — шинэ төхөөрөмж `auto`, лиценз `via:'account'` (тулгалт таарвал `match` хэвээр), ирцийн PC,
admin-ы зөвшөөрөл ШААРДАХГҮЙ; `revit.max_devices` тохируулаагүй/0 = ХЯЗГААРГҮЙ.  Хэвээр: төхөөрөмжийн түлхүүр + гарын үсэгтэй лиценз (хуулбар өөр
PC-д ажиллахгүй), идэвхгүй/эрхгүй role/хаасан-цуцалсан төхөөрөмж хориотой, хувилбарын хориг, унтраалга.  Хуучин хатуу горимууд СОНГОЛТООР:
`auto` (зөвхөн ирцийн ажлын PC автомат, бусад admin хүлээнэ), `admin` (бүгдийг admin).  `decideLicense({accountMode})`, `enrollStatus({accountMode,
maxDevices:null})`; хуучин «ажлын PC» route тестүүд одоо `auto`-г ил тохируулж ажилладаг.  Доорх «ЛИЦЕНЗ ОЛГОХ НӨХЦӨЛ» = `auto` горим.
**DEPLOYED 2026-10-02** (deploy branch `deploy/live-2026-10-02-revit-license` @ `e264ba75` = live `e1d55087` + main `a1b21991` + `e6f2ce38` +
`3f0350f6`): D1 0374 + 0375 (өмнөх bookmark `00000228-000000b0-000050f8-a480f9e1125beb06487d698429cde675`), secret `REVIT_LICENSE_KEY` (kid
`mgl-2026-10`), worker `ed830b02`.  **Pages deploy ХИЙГДЭЭГҮЙ** — прод Pages = `fdf12a6d` (`deploy/live-2026-10-01-task-groups`, «нэр – цаг»
засвар) нь энэ deploy салбарт ороогүй; дараагийн Pages deploy `fdf12a6d` + main-ийг ХАМТ агуулах ёстой (эс бөгөөс тэр засвар буцна).  Тэр
болтол admin-ы «Revit add-in — компьютерууд» самбар (`RevitLicenseDevices.tsx`) продод алга; бодлого/хаах нь API-аар.  Add-in **1.10.1**
`dist/1.10.1/MGL-Revit-Addin-1.10.1.zip` (sha256 `579210da…0eeb`, verify 89/89, суулгалт 53/53, Licensing.Tests 35/35).

Эзний асуудал (2026-10-01): add-in-ий сервергүй хэрэгслүүд (Зураг клонлох, Автомат хэмжээс, Хуудас дугаарлах, Smart …)
нэвтрэлтгүй ажилладаг байсан тул DLL-ийг хуулсан хүн өөр газар зарж ашиглаж болно.  Эзний 3 шийдвэр (AskUserQuestion):
интернэтгүй **3 хоног** · **зөвхөн ирц бүртгүүлдэг ажлын PC** (0328-ын «нэг PC, олон хөтөч» таних аргыг ашиглана — тоон
хязгаар биш) · админд **компьютерын НЭР харагдахгүй**.

- **Гарын үсэгтэй лиценз, хуурамч серверт тэсвэртэй.**  Add-in-ий серверийн хаяг хэрэглэгчийн тохиргоонд байдаг тул «сервер
  тийм гэв»-д итгэвэл хуурамч сервер тавиад тойрно.  `POST /api/revit/license` нь ECDSA P-256 гарын үсэгтэй 72 цагийн
  lease олгоно: `b64url(JSON).b64url(r‖s)` (JWS-тэй ижил signing input), payload `{v,kid,aud:'mgl-revit-addin',sub,un,nm,rl,dev,
  via,iat,exp,rfa}`.  Хувийн түлхүүр = Worker secret **`REVIT_LICENSE_KEY`** (`{"kid","kty":"EC","crv":"P-256","d","x","y"}`),
  нөөц нь эзний PC-д `%USERPROFILE%\.mgl-secrets\revit-license-key-mgl-2026-10.json` — репод ХЭЗЭЭ Ч орохгүй.  Нийтийн хагас
  `revit-mcp/addin/Licensing/Core/LicenseKeys.cs` (kid `mgl-2026-10`).  Secret байхгүй → 503 `LICENSE_NOT_CONFIGURED`, гарын
  үсэггүй лиценз ХЭЗЭЭ Ч үгүй.  **Түлхүүр солих:** шинэ kid-ийг add-in-д ЭХЛЭЭД нэмж тарааж, дараа нь secret-ийг соль.
  Тестийн түлхүүр `test-0001` (репод ил, тестүүдэд) — production build түүнд итгэхгүй (`ProductionKeys_DoNotTrustTestKey`).
- **Дүрэм ГАНЦ газар `backend/src/lib/revitLicense.ts`** (`decideLicense`): DB-ийн role (JWT биш — mcp токен 365 хоног) ∈
  admin|senior|engineer|architect, `status ≠ inactive` → admin хаасан (`blocked`) → admin зөвшөөрсөн (`approved`, тулгалтгүй) →
  техник хангамжийн тулгалт: add-in-ий Windows профайл (`Licensing/HardwareProbe.cs`: registry DriverDesc + EnumDisplayDevices
  GPU-ууд, `ProcessorCount`, дэлгэц бүрийн ФИЗИК нягтрал) ↔ ажилтны ИДЭВХТЭЙ `attendance_devices.hw_json` (хөтчийн WebGL GPU,
  `hardwareConcurrency`, CSS `screen`).  Таарах = цөм ЯГ ижил + GPU (`normalizeGpu`; цифргүй гэр бүлийн нэр «intel(r) uhd
  graphics» л угтвараар — «rtx 3070» ≠ «3070 ti») + дэлгэцийн харьцаа ±1.5 % ба масштаб 0.5–4 (Windows scaling/zoom).
  Нэг удаа БҮРЭН таарсан компьютер `bound_attendance_device_id`-тэй болж, тэр ирцийн мөр идэвхтэй + GPU/цөм таарсаар байвал
  монитор салгасан ч ажиллана.  Цагийн бүс/платформ тулгахгүй (прод дээр Asia/Shanghai г.м.).  Прод 2026-10-01: 54 идэвхтэй
  ажилтны 48 нь хэрэглэгдэх hw профайлтай; «brave» GPU-тэй хөтөч хэзээ ч таарахгүй → admin зөвшөөрөл.
- **Хүснэгт `revit_license_devices` (0374)**: (user, device_id) нэг мөр, `device_id` = SHA-256(MachineGuid|Windows хэрэглэгч),
  `status` auto|approved|blocked (CHECK-гүй), `last_result`, оролдлого БҮР бүртгэгдэнэ (татгалзсан ч).  users руу FK-гүй —
  `DELETE /api/users/:id` гараар.  Админ: `GET /api/revit/license/admin/users/:id/devices`, `PATCH|DELETE
  /api/revit/license/admin/devices/:id` (admin) → UI нь Хэрэглэгчид → «Төхөөрөмж» цонхны «Revit add-in — компьютерууд»
  (`features/users/components/RevitLicenseDevices.tsx`; админд тэр товч ирцийн холболтгүй хүнд ч идэвхтэй болсон).
  Компьютерыг add-in-ий цонхонд харагдах 8 тэмдэгтийн «Компьютерын код»-оор таньна.
- **Add-in (`revit-mcp/addin/Licensing/`)**: `Core/` цэвэр (`LicenseLease.Verify` — гарын үсэг, aud, энэ компьютер, хугацаа,
  цаг ухраалт `max_seen_utc`; `LicenseResponse.Classify`; `DeviceProfile`), `LicenseGate` (`%APPDATA%\RevitMcpAddin\license.json`,
  6 цаг тутам арын шинэчлэл, сервер «үгүй» → лиценз ШУУД устна, сүлжээ/5xx/404/503/оффисын сүлжээ → хуучин лиценз дуустал),
  `LicenseDialog` (кодоор WPF), «MGL нэвтрэлт» товч (Тохиргоо самбар).  **Ribbon-ы БҮХ IExternalCommand** (`QtoSettingsCommand`-аас
  бусад) эхэнд `LicenseGate.Ensure()` — шинэ товч нэмбэл ЗААВАЛ тэр 2 мөрийг нэм.  MCP bridge `/tool`, `/execute` лицензгүй бол 403.
  Fail-closed.  ⚠️ Хаагдаагүй: Revit өөрөө сэргээсэн «MGL ажил»/«MGL туслах» самбарын агуулга (сервер нь токеноор хамгаалагдсан),
  BatchQto (шөнийн багц), 1.8.0 ба түүнээс өмнөх тараасан хувилбарууд.  .NET DLL-ийг задалж кодыг нь өөрчлөх нь энэ хамгаалалтын
  хүрээнээс гадна (obfuscation, code signing хийгээгүй).
- Тест: `backend/src/lib/revitLicense.test.ts` (9), `routes/revitLicense.test.ts` (8, бодит 0328+0374 SQLite);
  `revit-mcp/tests/Licensing.Tests` (18 — СЕРВЕРИЙН `signLease`-ийн тест векторыг C# шалгана, энэ PC-ийн probe); scratch
  wrangler (0328+0374, тестийн түлхүүр) дээр HTTP E2E 14/14 бүтэн middleware гинжээр.  Багц `dist/1.9.0/MGL-Revit-Addin-1.9.0.zip`
  (sha256 `35252784…6327`) цэвэр worktree (HEAD `e695751c` + зөвхөн лицензийн өөрчлөлт) дээр: verify 89/89, суулгалт 53/53.
  Бодит Revit дээр ачаалж үзээгүй.
- **Deploy дараалал**: `wrangler secret put REVIT_LICENSE_KEY` (нөөц файлаас) → D1 0374 → worker (live commit дээр overlay —
  `deployments list`-ийг ТУСАД НЬ уншина) → Pages (админы хэсэг) → ДАРАА нь zip тараана.  Сервергүйгээр 1.9.0 бүх хэрэгслээ
  «Лицензийн сервер бэлэн биш» гэж түгжинэ.

### Revit add-in — ТӨХӨӨРӨМЖИЙН КРИПТО ТАНИЛТ (add-in 1.10.0, migration 0375, DEPLOYED 2026-10-02 — дээрх тэмдэглэл)

Эзний даалга (2026-10-01): DLL, installer, settings, токен, license.json-ийг хуулсан ч **өөр компьютер дээр ажиллахгүй** байх.
`COPIED DLL != USABLE ADD-IN`.  DLL хуулагдахыг хаах гэж оролдохгүй — хуулсан DLL ЮУ Ч авч чадахгүй байхыг л хангана.
Дээрх 0374-ийн лиценз (hardware fingerprint + гарын үсэгтэй lease) **хэвээр**, түүний дээр тавигдсан давхарга.  Бүх runbook,
rollout дараалал, халдлагын матриц: `docs/revit-addin-device-security.md`.

- **Төхөөрөмж бүр ӨӨРИЙН ECDSA P-256 түлхүүртэй** — Windows CNG, боломжтой бол «Microsoft Platform Crypto Provider» (TPM, ЭКСПОРТЛОГДОХГҮЙ;
  `security_level='tpm'`), үгүй бол програмын түлхүүр (`'software'`, ИЛ, admin-д харагдана; `revit.require_tpm`-оор татгалзаж болно).  Хувийн хагас
  сервер, settings.json, license.json, лог, registry, DLL-д ХЭЗЭЭ Ч явахгүй.  Сервер ЗӨВХӨН нийтийн хагасыг (`revit_device_keys`, key_id = SHA-256(X‖Y)) хадгална.
  Код: add-in `Licensing/DeviceKeyStore.cs`; сервер `lib/revitDeviceKey.ts` (цэвэр: канон мөр, ES256 шалгалт).
- **Proof = нэг удаагийн challenge-д гарын үсэг.**  `POST /api/revit/device/challenge {device_id, purpose}` → `{challenge_id, nonce, user_id}` (D1 `revit_device_challenges`,
  120 с, хэрэглэгч+төхөөрөмж+зорилгод уяатай, атом `used_at`-аар ГАНЦ удаа, хэрэглэгч тутамд ≤ 30 нээлттэй).  Гарын үсэг канон мөр
  `mgl-revit-device-proof|v1|<purpose>|<challenge_id>|<nonce>|<user_id>|<device_id>|<key_id>` дээр (P1363 r‖s, base64url) — add-in `Licensing/Core/DeviceProof.cs`-тэй БАЙТ-ИЖИЛ
  (TS → C# тест вектор `DeviceProofTests.cs`).  Гарын үсэг буруу байсан ч challenge зарцуулагдана.
- **Дөрвөн зам** (`routes/revitDevice.ts` = `/api/revit`-ийн 4 дэх mount; `use('*')` ЭНД БАЙХГҮЙ): `/device/challenge` · `/device/enroll` (ШИНЭ түлхүүр бүртгэх — **нууц үгээр ≤ 15 мин
  өмнө нэвтэрсэн токен заавал** (`purpose` байхгүй + `iat`), эс бөгөөс 403 `REAUTH_REQUIRED`; 365 хоногийн `mcp` токен / credential түлхүүр бүртгэж ЧАДАХГҮЙ) · `/device/session`
  (proof-оор 30 минутын session) · `/license` (proof-тэй; лиценз + session + credential).  Төлөв: `auto` (ирцийн ажлын PC-тэй таарсан) | `approved` | `pending`
  (таараагүй / хязгаар / TPM шаардсан / `enroll_approval=admin`) | `blocked` (түлхүүр хэвээр) | `revoked` (түлхүүр УСТНА; дахин бүртгэхэд эхлээд `pending`).
  Шинэ төхөөрөмж admin-гүйгээр ХЭЗЭЭ Ч `approved` болохгүй.  **Түлхүүртэй төхөөрөмж ҮРГЭЛЖ proof шаардана** — proof-ыг орхиж «хуучин» зам руу downgrade хийх боломжгүй
  (`gateDevice`, `lib/revitDeviceAccess.ts`, цэвэр + тест).
- **Токен загвар** (`lib/revitDeviceService.ts` `mintDeviceTokens`): `purpose:'revit'` **session 30 мин** (add-in-ий БҮХ API дуудлага; `dev`+`kid` claim; `middleware/auth.ts`
  → `lib/revitSessionCheck.ts` хүсэлт бүрт (60 с кэш, FAIL-CLOSED) төхөөрөмж идэвхтэй/түлхүүр таарч/унтраалга унтраалттай эсэхийг шалгана) ба `purpose:'revit-refresh'` **credential 30 хоног**
  (ЗӨВХӨН `/license`, `/device/challenge`, `/device/session`-д хүчинтэй — бусад /api-д 401; ганцаараа session/лиценз авч чадахгүй, proof заавал; DPAPI-аар `device.json`).
  `/mcp` нь эдгээр хоёр purpose-ыг хүлээн авахгүй (`index.ts resolveExternalToken`).  ⚠️ `purpose==='mcp'`-ыг ХЭЗЭЭ Ч татгалзахгүй дүрэм ХЭВЭЭР — шинэ purpose-ууд л хаалттай;
  хуучин 365 хоногийн токеныг шат шатаар хаах нь `revit.legacy_token_policy` бодлого (доор).  Add-in 1.10 `mcp-token` ҮҮСГЭХГҮЙ.
- **Лиценз 72 цаг → 12 цаг, шинэчлэл 6 цаг → 1 цаг** (`lib/revitLicense.ts` `LEASE_TTL_SEC` / `LEASE_REFRESH_SEC` ГАНЦ газар).  Add-in-ий 5 минутын timer лицензийг цагт нэг,
  session-ийг ~18 минутад нэг шинэчилнэ.  Интернэтгүй: хүчинтэй лиценз 12 цаг хүртэл; сервер «үгүй» гэвэл лиценз + session ШУУД устна; олон хоног интернэтгүй ажиллах боломж ЗОРИУД БАЙХГҮЙ.
  Лицензэд `sec` (tpm|software|legacy) + `dk` (түлхүүрийн key_id) орно — add-in `LicenseLease.Verify(…, localKeyId, …)` `dk`-г өөрийн түлхүүртэй тулгана (түлхүүргүй PC-д хуулбал `WrongDevice`).
- **FAIL-CLOSED олголт** (`POST /license`): бодлого, хэрэглэгч, төхөөрөмж, сүлжээ, мөр бичилтийн АЛЬ НЭГ D1 алдаа → 503 `SECURITY_CHECK_FAILED`, лиценз ОЛГОХГҮЙ (add-in 503-г «хуучин лиценз хэвээр» гэж үздэг).
  Global `officeAccessGuard` зориудаар fail-open хэвээр; `strictNetworkVerdict` нь `OFFICE_ACCESS_ENFORCED=1` үед ЛИЦЕНЗ дээр л fail-closed (оффисын IP эсвэл `remote_access_allowed`; Wi-Fi ГАНЦААРАА лиценз БИШ).
  `REVIT_LICENSE_KEY` байхгүй → 503, гарын үсэггүй лиценз ХЭЗЭЭ Ч үгүй.  Ажилтан тутамд ≤ 30 төхөөрөмжийн мөр (хуурамч device_id-аар хүснэгт дүүргэхээс).
- **Бодлого `app_settings` `revit.*`** (`lib/revitPolicy.ts`; `GET|PUT /api/revit/license/admin/policy`, admin): `disabled` (яаралтай унтраалга — шинэ лиценз/session олгохгүй, session токен ≤ 60 с),
  `min_version`, `blocked_versions` (машин уншигдах код `ADDIN_UPDATE_REQUIRED` / `ADDIN_VERSION_BLOCKED` / `REVIT_LICENSES_DISABLED`), `device_key_policy` (`optional` өгөгдмөл = шилжилт | `required`),
  `require_tpm`, `max_devices` (өгөгдмөл 2; admin approve хязгаараас ГАДУУР), `enroll_approval` (`auto` | `admin`), `legacy_token_policy` (`allow` | `log` | `deny` —
  `middleware/revitLegacyTokenGuard.ts`: `purpose:'mcp'` токеныг `/api/revit/*` + `/api/qto/{revit-runs,schedules,view-exports}`-д; лиценз/төхөөрөмжийн замууд ЗОРИУД чөлөөт — хуучин add-in шилжих ёстой).
  Хувилбар мэдэгдээгүй клиент + `min_version` → `ADDIN_UPDATE_REQUIRED`.
- **Аюулгүй байдлын бүртгэл** `revit_security_events` (токен/түлхүүр/гарын үсэг ХЭЗЭЭ Ч орохгүй; 180 хоногоос хуучныг хааяа устгана): `enroll_*`, `device_*`, `proof_failed`, `unknown_device`, `blocked_device_attempt`,
  `license_issued/denied` (12 цагт нэг), `legacy_*`, `version_blocked`, `policy_changed`, `security_check_failed`.  Admin: `GET /license/admin/events?user_id=&limit=`; UI = Хэрэглэгчид → Төхөөрөмж цонх
  (`RevitLicenseDevices.tsx`: TPM/software/legacy тэмдэг, key_id богино код, enrolled/last_proof/last_lease, Зөвшөөрөх · Хаах · Цуцлах · Хүлээлгэд буцаах · Автомат, үйл явдлын жагсаалт).
  Глобал бодлогын UI ЗОРИУД БАЙХГҮЙ (API л).  `DELETE /api/users/:id` түлхүүр + challenge-ийг гараар устгана; үйл явдлын түүх үлдэнэ.
- **Шилжилт** (хуучин add-in 1.9.x амьд): D1 0375 → worker → Pages → 1.10.0 тараах → `legacy_token_policy=log` → `device_key_policy=required` → `min_version=1.10.0` + `legacy_token_policy=deny`.
  Хуучин add-in + шинэ backend = `optional` үед хуучин зам (`sec:'legacy'`); шинэ add-in + ХУУЧИН backend = 404 (бэлэн биш) — backend-ийг ЭХЛЭЭД deploy хий.  Анх удаа шинэ add-in нэг удаа нууц үгээр дахин нэвтэрч бүртгүүлнэ.
- **Add-in тал** (`revit-mcp/addin/Licensing/`): `LicenseGate.SignInAsync` (нэвтрэх → түлхүүр → enroll → лиценз; 3 login урсгал — LicenseDialog, WorkPaneView, SettingsDialog — бүгд үүгээр), `DeviceSession` (санах ойн session) + `DeviceCredentialStore`
  (DPAPI), `SettingsStore.Load()` нь session-ийг `Token`-д шигтгэнэ (25 дуудагчийг засахгүйгээр) ба `Save()` session-ийг дискэнд БИЧИХГҮЙ; `BatchQto` одоо `EnsureForBatch()` (лиценз + session)-тэй;
  `HttpServer` нь `Origin` толгойтой (хөтчийн) хүсэлтийг 403.  Release gate/signing/obfuscation hook: `installer/harden-release.ps1` (`build-installer.ps1` дуудна; `-RequireSigned`).
- **Windows дээр БАТАЛГААЖСАН 2026-10-02** (анх macOS дээр бичигдсэн, `dotnet`-гүй): `Licensing.Tests` 35/35 (энэ PC-ийн БОДИТ TPM түлхүүрээр),
  Release R24/R25/R26/R27 0 алдаа; **бодит `LicenseGate.cs`-ийг** (Revit-ийн хэсгийг орлуулагчаар) scratch wrangler + прод-хуулбар D1 (0328/0374/0375,
  ТЕСТИЙН түлхүүр) дээр ажиллуулсан E2E 49/50 (унасан 1 нь хуучин 09-07 DB-ийн `hours_progress_base` багана — session-ийн алдаа биш): TPM бүртгэл →
  12 ц лиценз (`sec:tpm`, `dk`) → session (`SESSION_SCOPE` хаалт) → credential+proof шинэчлэл; халдлага — credential ердийн API-д 401, proof-гүй →
  `DEVICE_PROOF_REQUIRED`, өөр түлхүүрийн гарын үсэг → `DEVICE_PROOF_INVALID`, challenge дахин ашиглах 403, license.json хуулбар → `WrongDevice`;
  admin зөвшөөрөл/цуцлалт/хүлээлгэд буцаах, `min_version`, SignOut.  Харness: сессийн scratchpad `gateharness/` (репод БИШ).  Багц
  `dist/1.10.0/MGL-Revit-Addin-1.10.0.zip`: verify 89/89, суулгалт 53/53, DLL бүрт prod kid байгаа / `test-0001` байхгүй.
- **Түлхүүр ERP АЖИЛТАН тутам — `MGL-Revit-Device-v1-u<user_id>`** (`DeviceKeyStore.ForUser`, 2026-10-02 Windows-ийн шалгалтаар нэмсэн).  Өмнө нь Windows
  профайл тутам ГАНЦ түлхүүр байсан тул нэг профайлд хоёр дахь ажилтан нэвтэрвэл (PC шилжих, түр ашиглах) сервер «түлхүүр өөр бүртгэлд ашиглагдаж байна»
  (409 `DEVICE_KEY_MISMATCH`) гэж ХЭЗЭЭ Ч бүртгэдэггүй, admin зөвшөөрөл ч тусгүй байв.  Ажилтны id = токен / лицензийн `sub`
  (`Core/TokenPeek.cs` — гарын үсэг шалгахгүй, ЗӨВХӨН түлхүүрийн нэр сонгоход; эрхийг сервер + `LicenseLease.Verify` шийднэ).  **Түлхүүр солих:**
  `SignInAsync` дотор enroll 409 `DEVICE_KEY_MISMATCH` (admin цуцалсан → tombstone / өөр бүртгэлийнх) бол түлхүүрийг НЭГ удаа устгаад шинээр үүсгэж дахин
  бүртгүүлнэ — эс бөгөөс «цуцлах → хүлээлгэд буцаах» урсгал ажилтныг үүрд гацаадаг байв.  403 `DEVICE_REVOKED` үед солихгүй.
  Backend: `backend/src/routes/revitDevice.test.ts` 43 + `lib/revitDeviceAccess.test.ts` 5 + шинэчилсэн 0374-ийн тестүүд (бодит SQLite, WebCrypto-оор жинхэнэ ECDSA).
- **Хараат шинжилгээний (review, 2 agent) олдвороор хаасан цоорхойнууд — ДАХИН БҮҮ НЭЭ:** (1) `/mcp` `resolveExternalToken` нь `revit` / `revit-refresh` purpose-ыг татгалзана (30 хоногийн
  credential MCP-ийн бүтэн токен болох байсан; ⚠️ python `replace` чимээгүй no-op болсныг `revitDevice.test.ts` эх кодын шалгалтаар барина).  (2) `POST /auth/mcp-token` нь ЗӨВХӨН purpose-гүй (нууц үгээр
  нэвтэрсэн) токенд — хулгайлагдсан session / credential / mcp токен 365 хоногийн токен цохиж чадахгүй.  (3) `purpose:'revit'` session нь `REVIT_SESSION_PREFIXES`-ийн замуудад л хүчинтэй (бусад → 403 `SESSION_SCOPE`;
  `revit.session_scope=open` яаралтай) ба токен дахь role-г DB-тэй тулгана (буулгасан admin 30 минут үргэлжлэхгүй).  Шинэ /api замыг add-in дуудах бол `lib/revitSessionCheck.ts` жагсаалтад НЭМ.
  (4) Түлхүүр бүртгүүлж байсан (эсвэл цуцлагдсан мөртэй) ажилтан ӨӨР device_id-аар түлхүүргүй зам руу орж чадахгүй (`userRequiresKey`, `optional` үед ч).  (5) ИЖИЛ түлхүүрийн дахин бүртгэл admin-ы
  төлөв / last_result-ийг дарахгүй, `blocked`/`revoked` мөр зэрэг хийгдсэн ч дарагдахгүй (`status NOT IN`).  (6) Түлхүүртэй төхөөрөмжийн мөрийг ЗӨВХӨН хүчинтэй proof-той `/license` шинэчилнэ
  (`last_result` / `hw_json` бохирдуулж session унагах боломжгүй).  (7) Цуцлагдсан / устгагдсан түлхүүр `revit_revoked_keys` tombstone-д — дахин ЯМАР Ч төхөөрөмж дээр бүртгэгдэхгүй.  (8) Enroll мөр + түлхүүр
  НЭГ `db.batch`.  (9) Challenge хязгаар (хэрэглэгч, төхөөрөмж, зорилго) тутамд 10, хэрэглэгч тутамд 60; үйл явдлын бүртгэл ижил мөрийг 10 минутад нэг, хэрэглэгч тутамд цагт ≤ 120.
  **C# тал:** `DeviceSession` өмнөх session токенуудыг (≤ 16, санах ойд) тэмдэглэнэ → `SettingsStore.Save` хуучирсан session-ийг ч дискэнд бичихгүй, `SessionTokenHandler` (`ApiClient.Http`) урт ажлын эхэнд барьсан
  хуучин токеныг илгээх агшинд шинээр солино; `LicenseGate` generation тоолуур (SignOut / татгалзалтын дараах хуучин хариу session/credential/лиценз сэргээхгүй), түлхүүр нээгдэхгүй үед сервер рүү proof-гүй
  хүсэлт ИЛГЭЭХГҮЙ (`KEY_UNAVAILABLE`, лиценз устахгүй), `Ensure()` session-ийг ≤ 12 с хүлээнэ, TPM түлхүүр байгаа ч нээгдэхгүй үед програмын түлхүүр ҮҮСГЭХГҮЙ, Platform provider `ExportPolicy`-г хүлээн
  авахгүй бол бодлогогүйгээр дахин оролдоно (⚠️ жинхэнэ TPM дээр шалга — `Release` тавихын өмнө `security_level` `tpm` гарч байгааг admin цонхноос харах).
- Мэдэгдэж буй хязгаар: ЯГ ижил загварын PC (GPU+цөм+дэлгэц) + нууц үг мэддэг хүн автомат `auto` бүртгэл авч чадна → `enroll_approval=admin` хамгийн хатуу горим.  TPM-гүй PC-ийн програмын түлхүүрийг ТУХАЙН Windows хэрэглэгчийн
  процесс ашиглаж чадна (экспорт боломжгүй ч).  Add-in-ий кодыг өөрчилсөн хүн client шалгалтыг тойрч болно — тиймээс session/төхөөрөмж/хувилбарыг СЕРВЕР шалгадаг.  Obfuscation/code signing сертификат репод БАЙХГҮЙ (hook л).

### Revit add-in — «Өөрчлөхөөс өмнө» (Change Impact Radar, add-in 1.16.0 → хаалга зөөх 1.17.0 → ЯМАР Ч элементийг хулганаар чирж симуляц 1.18.0, 2026-10-05)

`revit-mcp/addin/ChangeImpact/` (`MGL_SMART`, Revit 2025+; R24-д хасагдсан) — нэг шулуун ханыг зөөхөөс ӨМНӨ нөлөөллийг sandbox-д хэмжиж НЭГ дүгнэлт (🟢 ТЕХНИКИЙН ХУВЬД ЗӨӨЖ БОЛНО /
🟠 ХЯНААД ЗӨӨ / 🔴 ЗӨӨХГҮЙ / ⚪ ДҮГНЭХ БОЛОМЖГҮЙ) өгнө.  **Модель-ийн техникийн дүгнэлт, Монгол нормын (БНбД) зөвшөөрөл БИШ** — «Монгол нормын автомат баталгаажуулалт хийгдээгүй.» мөр ТУСДАА.
Эхлэх цэг ГАНЦ: `revit-mcp/docs/CHANGE_IMPACT_RADAR_MVP.md` (дүрэм, settled-state Apply, ажиглагчийн хойшлуулалт, кэш, сүүдэр, 27 суурь уналтын шалтгаан, §10 QA хаалга, §12 релиз).
- Дүрэм ГАНЦ газар `Core/PreChangeDecision.cs` (цэвэр, 44 тест); Preview нь ҮРГЭЛЖ `RollBack`, Apply = `TransactionGroup{move → settled тулгалт → Assimilate | RollBack}` (нэг Ctrl+Z);
  хуучирсан/уншиж чадаагүй (`Unverifiable`) preview-ээр ХЭЗЭЭ Ч зөөхгүй (fail-closed).  Backend/D1/Pages хөндөөгүй, интернэт/AI/төлбөр БАЙХГҮЙ.
- Тест: `tests/Smart.Tests` 833/833 (1.17.0; 1.16.0-д 721) (+27 Windows-only skip; тэдгээр нь `main`-д ч унадаг — Windows замын/файл түгжээний семантик), `MglUi.Tests` 123/123, `Smart.UiSmoke` ЗӨВХӨН compile.
- **Хаалга зөөх (1.17.0)** нь ИЖИЛ хөдөлгүүрийн нэмэлт — `Core/PreChangeOperation.cs` (`WallMove | DoorMove`) + Revit `IPreChangeOperation` seam; ханын код үг үсгээрээ зөөгдсөн.  Интерактив: хост ханын дагуу гарын тоо / ±10·50·100 мм / PickPoint,
  DirectContext3D сүүдэр (зөвхөн дэлгэц), хоёр түвшний шинжилгээ (`DoorSimulationController`: 220 мс debounce, generation, latest-wins), Зөвшөөрөх = НЭГ Ctrl+Z («MGL — Хаалга зөөх»), Болих = моделд хүрэхгүй.
  Хаалганы эргэлт/нормын шалгалт ХИЙГДЭЭГҮЙ («Door swing: тооцоолоогүй»).  Дэлгэрэнгүй `CHANGE_IMPACT_RADAR_MVP.md` §14 (QA хаалт §14.9).  ⚠️ Revit дээр ХАРААХАН ажиллуулаагүй; зөвхөн хурдан скан (0.45–1.2 мс) хэмжигдсэн.
- **Ямар ч элементийг ХУЛГАНААР чирж зөөх симуляц (1.18.0)** — цэс, диалог, зайн тоо БАЙХГҮЙ: `PreChangeCommand` нь сонгосон (эсвэл `PickObject`-оор сонгуулсан) ЯМАР Ч элементээр `Ui/SimWindow.cs` (WPF `Viewport3D`) нээнэ.
  ЯАГААД өөрийн цонх: Revit API нь өөрийн зураг дээр чирэх явцад мөр бүрд хүсэлт өгдөггүй, `TransactionGroup`-ыг чирэлтийн турш нээлттэй барьж болдоггүй, хулганы hook/Win32 хориотой — тиймээс бодит геометрийг НЭГ удаа уншиж
  (`SimSceneLoader`), цонх хулганыг эзэмшиж, мөргөлдөөнийг ЦЭВЭР Core-д (`SimConflicts`/`SimBvh`: гадаргуу + эзлэхүүн давхцал, baseline-тай, хатуу хүлцэл) шууд тооцож, тавьсны дараа Revit sandbox (`SimExactAnalyzer`, ҮРГЭЛЖ RollBack)
  эцсийн дүн гаргана; `SimController` нь generation + offset таарвал л Revit-ийн дүнг хүлээнэ.  Apply = `SimApply` («MGL — Элемент зөөх», нэг Undo, settled тулгалт, stale).  Core нь Revit/WPF-гүй (`ChangeImpact/Core/Sim*.cs`).
  «Хэрэв та «X»-г эндээс тийш зөөвөл …» тайлан = `SimNarrative` (coverage мөр ҮРГЭЛЖ; «Нормд нийцсэн» гэж ХЭЗЭЭ Ч хэлэхгүй).  Хуучин хана/хаалганы БҮТЭН шалгалт цонхны «…» цэснээс (`PreChangeCommand.OpenFullCheck`).
  Тест: `Smart.Tests` 912/912 (+27 skip; 79 шинэ `Sim*Tests`, `SimGuardTests` бүтцийн хамгаалалттай), `Smart.UiSmoke/SimSmoke.cs` ЗӨВХӨН compile.  Дэлгэрэнгүй `CHANGE_IMPACT_RADAR_MVP.md` §15 (QA хаалт §15.9).
  ⚠️ Цонх Revit-ийн UI thread-ийг хуваалцдаг тул Revit-ийн шалгалтын үеэр (~0.3–3 с) хөлдөнө; WPF чирэлт, зураглал, sandbox Revit дээр ХАРААХАН ажиллуулаагүй; хэмжигдсэн нь зөвхөн Core (6k×24k гурвалжин 1.8 мс).
- **⛔ ERP МЭДЭГДЭЛ ХАСАГДСАН (эзэн 2026-10-06, `CHANGE_IMPACT_RADAR_MVP.md` §18):** зөөлтийг зөвшөөрөхөд элементийн зохиогч / ахлагч / төслийн багт мэдэгдэх
  ажил (§16) болон sidebar «Revit өөрчлөлт» (`/app/revit-changes`) УСТСАН — зөөсөн хүн холбогдох багийн хүнд ӨӨРӨӨ хэлнэ.  Add-in-д `ChangeNoticeClient`/`SimAuthors`/
  `SimNoticePanel`/`SimNotice` байхгүй, сүлжээ огт дуудахгүй.  Backend `routes/revitChangeNotices.ts` ба продын 0390/0391 хүснэгт ҮЛДСЭН (клиентгүй).  Дахин бүү нэм — эзнээс асуу.
- **2026-10-06-нд Revit 2027 дээр анх ажиллуулж 6 алдаа засав** (§16.2): Coarse-д бүтэц/MEP зураасаар → орчинд 0 дам нуруу (Medium fallback), sketch/beam system шуугиан,
  дагаж өөрчлөгдөх элемент тайланд нэргүй, шал бүхэлдээ улаан, камер/шалны дор нуугдсан элемент, emoji/бараан сэдэв.  Хэмжсэн: ачаалал 0.5–0.65 с, чирэх 1 мс, sandbox 2.6–4 с
  (хөлддөг), зөөлт 2.1 с.  Бодит хулганы чирэлт, Ctrl+Z, линкийн зохиогч — гар QA үлдсэн.
- **Revit-д ШУУД зөөхөд шалгах (§17, эзэн 2026-10-06):** `Revit/PostMoveWatch.cs` (App.cs `PostMoveWatch.Init`) — `SelectionChanged` байрлал санаж, `DocumentChanged`
  (`TransactionCommitted`, «MGL»-гүй гүйлгээ, sandbox биш) цэвэр зөөлтийг (`Core/SimNativeMove.cs`; ханын тайрагдсан үзүүрийг тэвчинэ) таньж 0.7 с-ийн дараа
  `PostMoveAnalyzer` (ГҮЙЛГЭЭГҮЙ, 50–65 мс) → хэн нэгний ажил хөндөгдсөн бол л `Ui/PostMoveWindow.cs` (Буцаах / Хаах / Зөөлтийг үлдээх).  Цонх Revit-гүй (`INativeMoveSession`,
  UiSmoke эмхэтгэнэ).  🔴 үед «өөрийн шийдвэрээр» асуулттай (`SimReport.CanForce`, Revit зөвшөөрсөн үед л).  Мэдэгдэл явахгүй.  Багц add-in 1.23.0.
- ⚠️ **Бодит Revit дээр ХАРААХАН ажиллуулаагүй** (1.18.0 хүртэлх; §16–17 нь эхний бодит QA) — zip-ийг бусдад тарахын өмнө §10 A–E хаалт заавал.  Deploy = Windows дээр `scripts\package-addin.ps1 -Build` (§12); merge нь тараалт БИШ.

### Revit add-in — туузан цэс САЛБАРААР (2026-10-13, zip 1.37.0 (ханын дэлгээсийн засвартай хамт), commit ХИЙГЭЭГҮЙ, бодит Revit дээр шалгаагүй)

Эзэн: БА, ББ, интерьер … ажилтан ӨӨРИЙН салбарын хэрэгслийг харна; нэг хэрэгсэл олон салбарт байж болно.  Эзний 3 хариулт:
НЭГ «MGL» таб, ажилтан нийтлэг + өөрийн салбарынхыг харна · салбар = ERP-ийн баг, Тохиргооноос өөрчилнө · хуваарилалт доорх.
⚠️ Эзний 2 дахь заавар: **ижил хэрэгслийн логик салбараас хамаарч ӨӨР болно** — «Ханын дэлгээс»: БА ба Интерьер өөр template,
Интерьерийнх render зургийн хэсэгтэй.  Энэ удаад ХЭРЭГСЭЛ ХӨНДӨӨГҮЙ, зөвхөн бүтэц/бүлэглэлт.
- Дүрэм: `revit-mcp/addin/Ui/Core/ToolDiscipline.cs` + `RibbonPlan.cs` (цэвэр; `tests/MglUi.Tests` `ToolDisciplineTests` 13 + `RibbonPlanTests`).
  `ToolMeta.Disciplines` flags (өгөгдмөл `All` = нийтлэг) + `VariesByDiscipline` (салбар бүр өөр логиктой болох — одоо тэмдэглэгээ л).
  ББ = арматурын 6 + «Түүвэр хувилах/шинэчлэх»; БА + Интерьер = «Ханын дэлгээс»; үлдсэн 20 нийтлэг; инженерийн багуудад (ХАС/ЦБУ/
  Цахилгаан/ХД/АУ) тусгай хэрэгсэл ОДООГООР БАЙХГҮЙ.  Баг → салбар: BA/EZ/GT → БА, BB → ББ, IZ → Интерьер, HAS/TSBU/TSAH/HD/AU →
  инженер; MGMT/мэдэгдэхгүй/нэвтрээгүй → БҮХ (эргэлзвэл харуулна).  Шинэ баг/хэрэгсэл нэмбэл ЭНД.
- **Самбарууд** (`RibbonPlan.PanelOrder`): Ажил → САЛБАРЫН самбар (Архитектур · Интерьер · Бүтээц · Инженерийн шугам — хэрэгсэлгүй бол
  үүсэхгүй) → нийтлэг Зураг · Шалгалт · Экспорт · Сан.  Салбарын хэрэгсэл ЗӨВХӨН салбарын самбарт (`ToolMeta.Panel` нь тэнд бүлэг/эрэмбэ л:
  арматур → түүвэр), нийтлэг хэрэгсэл ЗӨВХӨН нийтлэг самбарт.  «Арматур»/«Түүвэр» самбар байхгүй болсон; «Элемент тоолох» → «Шалгалт».
  Олон салбартай хэрэгсэл салбар бүрт ТУСДАА товч: нэр `RibbonPlan.ButtonName` (эхний салбарт тогтвортой `Name`, бусдад `Name_interior`),
  командын холбоос `RibbonBuilder.DisciplineBindings["Name@interior"]` (одоо хоосон → ерөнхий команд).  Хэрэгслийн логик салбараар
  салахад ТЭНД салбарын командын анги бүртгэнэ — ribbon-ы бүтэц/ID хөдлөхгүй.  ⚠️ Самбар солигдсон хэрэгслийн QAT/гарын товчлуур
  (Revit команд ID) дахин тохируулах шаардлагатай.
- Нуух нэгж = САЛБАРЫН САМБАР (`Ui/Revit/RibbonDisciplines.cs`, `RibbonPanel.Visible`; товч тус бүрийг хөндөхгүй) — үүссэн хэвээр, Revit
  дахин асаахгүй.  Каталогийн «Нээх» (`ToolLauncher`) ажилтны салбарын байрлалыг түрүүлж сонгоно.  Баг = `GET /api/auth/me`
  (`team_code` + `teams[].code`, `revit` session-ий цагаан жагсаалтад бий) асаалтын дараа арын дэвсгэрт (4/20/60/180/600 с, багцад үгүй) +
  Тохиргоо нээх/нэвтрэх үед; кэш `ui-prefs.json` → `ribbon` (`mode` auto|manual|all, `manual`, `erp_teams`).  Тохиргоо цонхны «3. Туузан
  цэсэнд харагдах хэрэгсэл» ШУУД хэрэгжинэ («Хадгалах» шаардахгүй).  Каталогт «Салбар: …» + нуугдсан бол сануулга.
- Шалгасан: MglUi.Tests 140/140, цэвэр worktree-д R27 + R24 + 4 UiSmoke эмхэтгэгдсэн.  ⚠️ Үндсэн checkout-ын `addin/obj/x64/Release R27`
  дээр WPF baml үүсэхгүй (BG1002) — кодноос үл хамаарна (HEAD цэвэр worktree-д эмхэтгэгддэг), цэвэр worktree-д эмхэтгэ.
  Revit-д `RibbonPanel.Visible`, нэг табд `Name`/`Name_interior` хоёр товч, нуугдсан самбарын товчийг каталогоос `PostCommand` — АМЬД шалгаагүй.

### Revit add-in — «Ханын дэлгээс» (`MglWallElevations`, 2026-10-06, committed `3319ced3`, zip ХИЙГЭЭГҮЙ; Revit 2027: workflow+цонх 133/133, хөдөлгүүр 198/198, тэмдэглэгээ 31/31)

`revit-mcp/addin/WallElevation/` (бүх build R24–R27) — өрөө/хана сонгоод урьдчилсан дүн (загварт хүрэхгүй) → нэг Ctrl+Z-ээр
`ViewSection.CreateSection` дэлгээс (ElevationMarker биш — нэг box = чиглэл+хүрээ+гүн; `IWallElevationViewFactory`-ийн ард).
Цөм Revit-гүй (`Core/`, `tests/WallElevation.Tests` 51), танилт = Extensible Storage түлхүүр (хана+өрөө+тал), нэр биш —
дахин ажиллуулахад давхардахгүй, өөрчлөгдсөнийг байранд нь шинэчилнэ, эх нь устсаныг устгахгүй.  Муруй/link хана үүсгэхгүй,
налуу = шалгах.  ⚠️ Revit 2027-д хэмжсэн: `CreateSection`-ийн дараа far clip 1100 фут үлддэг (шууд тавина);
`RotateElement(view.Id)` юу ч хийдэггүй — зүсэлтийг **viewer** (OST_Viewers) элементээр эргүүлж/зөөнө; хуучин хуудасны title
block bbox асуух нь тэр хуудсыг бүхэлд нь тооцуулна.  Ribbon команд ба шалгалт ижил `WallElevationWorkflow`-ийг ажиллуулна.  ⚠️ Бодит загварыг
API-аар (`OpenDocumentFile`) нээх нь хуваалцсан Revit-ийг upgrade явцад зогсоосон — баримтыг хүн нээнэ.  Дэлгэрэнгүй, хэмжилт, гар QA: `revit-mcp/docs/WALL_ELEVATIONS.md`.
**Тэмдэглэгээ** (эзний дүрэм 2026-10-06; цонхны мөр×багана хүснэгт — элемент × Spot/Хэмжээс/Шошго/Keynote): босоо 1-р эгнээ = шалны
доод · шалны дээд · таазны доод · дээд хучилтын доод, 2-р эгнээ = давхар хооронд; хаалганд spot ЗӨВХӨН дээд ирмэг, цонхонд доод+дээд,
таазны доод; хэвтээ гинж = СОНГОСОН элементийн ирмэг (хана, хаалга/цонх, тэнхлэг, сантехник, ерөнхий модел, тоног төхөөрөмж, тавилга)
+ нийт.  Төлөвлөгч цэвэр (`Core/WeAnnotationPlanner.cs`, тест 16), ӨӨРИЙН тавьсныг `WeAnnoStore`-оор санаж дахин ажиллуулахад сольдог.
⚠️ Хэмжсэн: нуугдсан элементийн лавлагаатай хэмжээс/spot үүсдэг ч ЗУРАГДАХГҮЙ — харагдах элементээр шүүж мэдэгдэнэ (Section-ийн
өгөгдмөл template Structural бол хана/тааз нуугдана); `IndependentTag.Create` leader-тэй үед толгойн цэгийг үл тоож 400 м leader
үүсгэсэн нь Revit-ийг унагасан — `TagHeadPosition`-ийг дахин онооно.  Тест harness-ийг `MGL_ALLOW_EXEC=1`-тэй ӨӨРИЙН Revit-д
ExternalEvent-ээр ажиллуул (Revit арын цонхонд байхад Idling ирдэггүй).
**2026-10-07 (add-in 1.25.0; 1.30.0 хүртэлх ажил 2026-10-08-нд commit хийгдсэн):** өгөгдмөл = жинхэнэ Elevation маркер; өрөө бүрт
баримт бичгийн хуудас (түлхүүр план + 3D + дэлгээс; төслийн өөрийн «өрөөний хуудас»-аас төрөл/template/хүрээ/дугаарыг суралцана —
`WeProjectStandards`).  **АРЫН ГОРИМ:** «Үүсгэх» дармагц команд дуусна — `WeJob` (`IMglJob`) «Зураг клонлох»-ын `CdJobHost`
(Idling) дээр алхам бүрийг нэг `TransactionGroup`-д; самбар «MGL — Ажлын явц» (хоёр хэрэгсэл хуваалцана, `CloneDrawings/MglJob.cs`);
синхрон `Run` = ижил алхмууд (harness).  ⚠️ Хэмжсэн (GATEWAY): `Viewport.LabelOffset` унших = тэр хуудсыг бүхэлд нь тооцно (1 с/хуудас);
давхрын бүтэн план дээр `CreateElevation` 0.8 с, өрөөгөөр тайрсан план дээр 0.2 с (түлхүүр планыг ЭХЛЭЭД үүсгэж суурь болгоно);
`GetBoxOutline` commit/regenerate бүрийн дараа ≈ 120 мс (нэг удаа хэмжиж хадгална); title block `EditFamily` 5 с (дискийн кэш);
detail шугам/дүүргэлт crop-оор тасардаг тул crop-оос гадуурх тэмдэг (түвшний «8,00 ▼ Давхар 3») БҮХЭЛДЭЭ бичвэр; annotation crop-оос
гадна шинэ тэмдэглэгээ нуугдмал — тааруулахын өмнө crop-ыг түр унтраана.  Harness горим `jobtest:<өрөө>[!]` / `ScheduleIdle` — бүгд
`revit-mcp/docs/WALL_ELEVATIONS.md` «Арын горим ба хурд», «Жишээ хуудастай тулгасан тэмдэглэгээ».
**Release gate (2026-10-13, commit ХИЙГЭЭГҮЙ; zip `dist/1.37.0/MGL-Revit-Addin-1.37.0.zip` (+ туузан цэс салбараар) sha256 `f0bd7137…aaa3`, verify 125/125, test-bundle 53/53, тараагаагүй; дараагийн zip ≥ 1.38.0):** `revit-mcp/release-gate/wall-elevation/`
(`build-candidate.ps1` = HEAD + зөвхөн `addin/WallElevation` overlay · `run-live.ps1 -Year` · `gate.ps1` → PASS/FAIL/KNOWN/BLOCKED/NOT RUN/NOT
VERIFIED; давтагдсан release-blocking issue `known-issues.json`-ийн status-аас үл хамааран FAIL).  Black-box: тусдаа тест add-in
`tests/WallElevation.LiveGate` (`MGL_WE_GATE_JOB`-гүй бол идэвхгүй, синтетик RVT-г run бүрт API-гаар) + UIA driver
`tests/WallElevation.LiveGate.Driver` (хүнийг хамгаална; үндсэн цонх = Win32 owner-гүй — preview-ийн UIA нэр Revit-ийн гарчигтай ижил).
Энэ шатаар root cause → засвар → live retest: **WE-BUG-001** (дээд айлын шал/тавилга доод өрөөний дэлгээст — crop дээд түвшин + 100/150 мм;
одоо `RoomCropTopCap` түвшин дээр ЯГ зогсоно, «давхар хоорондын» хэмжээс хэвээр — хэмжсэн), **WE-BUG-002/003** (өрөөн дотор / X / хуудасны
идэвхгүй viewport дээр дарахад сонгогдохгүй — `PickObjects(Element)` link-ийн өрөө сонгодоггүй; одоо `WeRoomPicker` цэгээр, **Esc = дуусгах**),
**WE-BUG-004** (ачаалагдаагүй link-ийн тайлбар алга).  Candidate `1.36.0-11f6bdf9-o94825a63`: unit 184/184 (net10+net48), live 2024 19/19,
2027 19/19 → **FINAL: NOT VERIFIED** (бодит төслийн загвар дээр хүн шалгаагүй).  ⚠️ Суулгагч ижил хувилбарын дугаартай build-ийг хуучин
хавтсаар ДАХИН ашигладаг (WE-RISK-002) — тараахдаа хувилбар өсгө.  Дэлгэрэнгүй: WALL_ELEVATIONS.md «Release gate».
**1.38.0 — өрөөн дээр НЭГ дармагц шууд (2026-10-13, WE-BUG-005, commit ХИЙГЭЭГҮЙ; zip `dist/1.38.0` sha256 `4e75f2b2…3f98`, verify 125/125,
test-bundle 53/53, энэ PC-ийн Revit 2024/2027-д СУУЛГАСАН, тараагаагүй; дараагийн zip ≥ 1.39.0).**  Эзэн: «шошго сонговол ажилладаг, шошгогүй
бол үгүй — өрөөн дээр дармагц автоматаар таниад шууд дэлгээс гарга».  Лог (MAX ӨРГӨӨ INT_B) нотолсон: 1.37.0 link-ийн өрөөг ОЛДОГ ч
тодруулдаггүй тул хэрэглэгч дахин дарж сонголтыг хасдаг байв.  Одоо `ElevationTargetResolver.PickTargets` → цонхгүй `WeRoomPicker.PickOne`
(нэг товшилт → урьдчилсан дүн; олдоогүй бол `Explain` шалтгаан + лог) → Esc = «Бусад сонголт» (`AllRooms` шошгогүй link-ийн өрөө ч,
`PickMany` түр хүрээтэй RollBack-тай, `PickElements`).  Давхрын нөөц хайлт `IsPointInRoom` эзлэхүүний дунд өндөрт, link-ийн шат нэрээр,
link-ийн давхар `Core/WeLevelMatch` ±600 мм.  Unit 187/187; Revit дотор хүний гараар ХАРААХАН шалгаагүй (Revit 2024-д кодын гүүр байхгүй,
pyRevit гүүрийг автомат хамгаалалт хориглосон).
**1.39.0 — бодит төсөл дээр шалгаад засав (2026-10-13, commit ХИЙГЭЭГҮЙ; zip `dist/1.39.0` sha256 `84b41159…6fd2`, verify 125/125,
test-bundle 53/53, энэ PC-ийн 2024/2027-д СУУЛГАСАН, тараагаагүй; дараагийн zip ≥ 1.40.0).**  Эзэн auto горимыг унтрааж pyRevit гүүрийг
зөвшөөрөв; MAX ӨРГӨӨ INT_B 1-р давхрын хадгалахгүй хуулбар дээр: өрөө сонголт 210/210 (70 шошгогүй link-ийн өрөө × төв/булан/хуудас),
шошгоор ба дарж үүсгэсэн нь ижил дэлгээс.  Засвар: WE-BUG-006 таазны дээрх элемент шошгогүй (трибуны 28 суудал «ЗТ-8»), WE-BUG-007 түлхүүр
план дээр бусдын VIEWER (`OST_Viewers`) эзэмшлээр нуугдана, WE-BUG-008 өрөөтэй link ачаалагдаагүй бол дарахаас ӨМНӨ link-ийн нэр, төлөв,
зам, засах заавар (`WeRoomPicker.Preflight`).  Unit 188/188.  Тэр хуулбарын шалтгаан: архитектурын link «Not Found» (харьцангуй зам) ба
central дээр link-ийн бичлэг устсан тул Reload From ч унадаг.  Эзний шийдвэр хүлээж буй 4 зүйл: WALL_ELEVATIONS.md «1.39.0».
**1.40.0 — эзний 4 шийдвэр хэрэгжсэн (2026-10-14, commit ХИЙГЭЭГҮЙ; zip `dist/1.40.0`, дараагийн zip ≥ 1.41.0):** (1) 1 м-ээс богино
булангийн тал дэлгээсгүй, нишийн арын хана хэвээр (`RoomBoundaryAnalyzer.DropShortSides`; 157: 27 → 15) · (2) таазны дээр трибун/шат
(шал/тавцан, шат/хашлага, суудал — host + link `WeAnnoSources.Overheads`) бол хүрээ таазаар, «давхар хоорондын» хэмжээсгүй
(`WeAnnotationPlanner.OverheadAbove`, `CeilingCutY`) · (3) манай тэмдэг оффисын ХУУДСАН дээрх планд нуугдана, ажлын планд үлдэнэ
(`HideOwnOnOfficeSheets`, `WeSettings.HideOwnMarkersOnSheets`) · (4) link дахин холбоход ES түлхүүрийг ижил элементтэй instance руу
(`WeLinkRef.Rebind`, `GeneratedElevationRepository.Read`).  Unit 190/190 (net10 + net48).  WALL_ELEVATIONS.md «1.40.0».
**1.40.0 — интерьерийн багийн нэмэлт (2026-10-14, мөн commit ХИЙГЭЭГҮЙ):** курсор доорх өрөөний тодруулга (DirectContext3D) · хуудас шалгах
самбар · цонхны ТОМ засварлах план (`Ui/WePlanEditor.cs`: шугамыг чирж зөөх/уртасгах, 90°, эсрэг, анхных → `WeSideOverride`,
ES `MglWallElevationOverride`; үсэг анхны геометрээр) · доод талын урьдчилсан ЗУРАГ (`Revit/WeLivePreview.cs`: жинхэнэ
`ElevationGenerationCoordinator.Run` нэг дэлгээс → `ExportImage` → гадна TransactionGroup RollBack; нээлттэй TG дотор ExportImage
ажилладаг — хэмжсэн) · тавилгын хэмжээс ЯГ (`WeAnnoSourceReader.AddHull` харагдах геометрийн гүдгэр бүрхүүл, `WeAnnoRef.Exact` 3 мм;
Revit тал нүүр → түр хэмжээсээр баталсан family хавтгай → ЯГ цэгийн туслах шугам; гинж унавал нэг удаа туслах шугамаар) · түлхүүр
планы дүүргэлт шошго/тэмдэг/маркерын доороос НҮХТЭЙ (`WeKeyPlanService.FillRoom`, `RefillAfterMarkers`) — хатуу дүүргэлтийн дотор тал
бүхэлдээ сонгогдох бүс тул шошго сонгогддоггүй байв (gate-ийн дэлгэцийн зураг).  Unit 206/206.  Live gate 2024: PREVIEW-101,
SEL-ANNO/SEL-TAG-KEYPLAN PASS.  ⚠️ Gate-ийн driver хэрэглэгчийн дэлгэцийг БҮҮ авах (PrintWindow л) — хэрэглэгч энэ PC дээр ажилладаг.
**Ажлын зургийн бүрдэлд байрлуулах** (мөн өдөр): цонхны «Ажлын зургийн бүрдэлд» — Project Browser → Sheets-ийн бүлэглэлтийн түвшин
бүрд засаж болох жагсаалт (`Revit/WeSheetFolderReader.cs`: `BrowserOrganization.GetFolderItems` → параметрийн id + бүлгийн нэр; бичвэр,
бичигдэх, нэр = утга бол л тохируулна; Revit 2025+ Sheet Collection эхний түвшин; Revit 2026+ id-ийн зам reflection-оор) → шинэ хуудсанд
параметр бичнэ (`WeSheetService.NewSheet`), ӨӨРЧИЛСӨН түвшинд өмнөх хуудсыг шилжүүлнэ (`SheetPhase.Folders`).  Анхны утга = өмнөх манай
хуудас → оффисын дэлгээсийн хуудсын түгээмэл бүлэг; файлд хадгалагдахгүй.  Цэвэр `Core/WeSheetFolders.cs`, unit 214/214, 2024–2027
эмхэтгэгдсэн; ⚠️ live-д ШАЛГААГҮЙ (синтетик template-д бүлэглэлтгүй, Browser Organization-ийг API үүсгэдэггүй).  PS 5.1-ийн
`Assembly.LoadFile` Revit 2027 (net10) DLL-ийг ачаалж чаддаггүй — 2026/2027 API-г nuget-ийн `RevitAPI.xml`-ээс шалга.
**Zip 1.42.0 (2026-10-14, commit ХИЙГЭЭГҮЙ, тараагаагүй; дараагийн zip ≥ 1.43.0):** `dist/1.42.0/MGL-Revit-Addin-1.42.0.zip` sha256
`66d78a1d…6ebc`, verify 153/153, test-bundle 53/53 = салаа `feat/roomplan-furniture-tiers` (`c758f02e`, «Давхрын план» 1.41.0) + энэ
ханын дэлгээсийн ажил.  1.40.0 гэж гаргаагүй: энэ PC-ийн Revit 2024-д ижил дугаартай туршилтын build суусан (суулгагч хуучин DLL-ийг
үлдээнэ), 2027-д 1.41.0 суусан (буцаах болно).
**1.43.0 — интерьерийн багийн 2-р тойрог (2026-10-14, 8 хүсэлт, commit ХИЙГЭЭГҮЙ):** «Интерьер» товч (`WallElevationInteriorCommand`) хуудсанд
«* Classification» = «Интерьер», «* Sub-Discipline» = «Барилга архитектур» (нэрээр тулгана) · урьдчилсан зургийн чагт үргэлж харагдана, бэлтгэл алхам
алхмаар (`IWePreviewJob`, цонх гацахгүй, цуцлахад RollBack) · «үүсэхгүй» мөрийг чагтлаж хүчлэх (`WeSettings.Forced`, муруйг хөвчөөр) · Ctrl+дарж
олон өрөө + цонхны «+ Өрөө нэмэх» · render зургийг перспективын байранд ойртуулахад тайрч дүүргэнэ (`WeImageFill`, DocumentChanged →
`CdJobHost.Post`) · олон legend чагтаар · хэмжээсийн зай 300 / +300 ЗАГВАРЫН мм · spot «Relative Base» = өрөөний давхрын host түвшин ӨНДРӨӨР
(сонгосон төрөл ч «(давхраас)» хувилбар).  Дэлгэрэнгүй `revit-mcp/docs/WALL_ELEVATIONS.md` «1.43.0».  Unit 227/227, R24–R27 эмхэтгэгдсэн, цонхны
харness 36/36; Revit дотор live-д ШАЛГААГҮЙ.  **Zip 1.43.0** (тараагаагүй, суулгаагүй): `dist/1.43.0/MGL-Revit-Addin-1.43.0.zip` sha256 `3398fa0d…e4c6`,
verify 153/153, test-bundle 53/53 = салаа `feat/roomplan-furniture-tiers` `76ede9f9` (өөр сессийн «Давхрын план» студи 1.42.0) + энэ ажил
(`addin/WallElevation` + RibbonBuilder/App.cs-ийн 3 мөр); дараагийн zip ≥ 1.44.0.
**1.44.0 — интерьерийн багийн 3-р тойрог (2026-10-14, 7 хүсэлт, commit ХИЙГЭЭГҮЙ):** legend-ийг тэмдгээр («ЗХ-01-С») ба нэрээр хайх
(`Core/WeLegendSearch` кирилл↔латин ижил дүрс + `Revit/WeLegendReader`) · хуудасны «* Type Designator» цонхноос (`WeSheetParamReader`,
`WeSettings.SheetParams`) · шал/таазны spot толин (бичвэр тэмдгийн гадна, `WeSpot.Mirrored`) · таазнаас (эсвэл өгсөн өндрөөс) дээш бүдэг —
masking region + `SetSurfaceTransparency(20)` (энгийн цагаан дүүргэлт шугамыг бүдэгрүүлдэггүй — хэмжсэн; давхарга таазнаас 0.6 мм дээш эхэлнэ,
эс бөгөөс тааз өөрөө бүдэгрэнэ) · бөөрөнхий улаан тасархай хүрээ дэлгээс бүр + түлхүүр планд (`WeRedFrame`; 3D-д API алга) · render-ийн байр
ХЭЗЭЭ Ч хаягдахгүй (`WeSheetComposer.PlaceRenders`: сүүлийн → сүүлээсээ 2 → хувааж → шинэ хуудас; «Хуудас бүрт» сонголт).  Дэлгэрэнгүй
`revit-mcp/docs/WALL_ELEVATIONS.md` «1.44.0».  Unit 240/240, цонхны харness 63/63, live gate Revit 2024 28/28 (PDF вектор/raster-д бүдэг
хадгалагдана).  ⚠️ Gate: сонголт өөрчилсөн ИЖИЛ ExternalEvent-д PostCommand хийвэл Revit «cannot be invoked in this context» гэж хаядаг — команд
дараагийн алхамд 0.8 с дараа (`Scenarios.cs`).
**Zip 1.44.0** (тараагаагүй; энэ PC-ийн Revit 2024-д л суусан): `dist/1.44.0/MGL-Revit-Addin-1.44.0.zip` sha256 `f068a48a…a81e`, verify 153/153,
test-bundle 53/53 = feat `38c92e19` (өөр сессийн 1.43.0 «Давхрын план») + энэ ажлын overlay.  Миний хуучин `dist/1.43.0` zip ТАРААГДААГҮЙ.
Дараагийн zip ≥ 1.45.0.
**1.45.0 — «+ Хана нэмэх»: ЦОНХ ДОТРООС нэмэлт дэлгээс (2026-10-14, интерьерийн баг, commit ХИЙГЭЭГҮЙ):** өрөө бүрийн мөрүүдийн доорх
«+ Хана нэмэх» → цонх ХААГДАХГҮЙ, шууд E (F …) мөр + том план дээр шугам (сонгосон талын өмнө 300–1200 мм, уртын хагас, ижил хана руу); чирж
байрлал/урт, «⟲ 90°», «⇅ Эсрэг» → «Үүсгэх».  ⚠️ Эхний хувилбар (цонх хаагдаж планд хана дарах) хэрэглэгч ТАТГАЛЗСАН — тэр код устсан, бүү сэргээ.
Нэмэлт тал = шугам (`Core/WeExtraSides`, түлхүүр «…|wall:|side:extra-N», шугам = `WeSideOverride` харагдац дээр `WeOverrideStore`-д → дахин
ажиллуулахад санагдана; `WeSettings.ExtraSides` файлд хадгалагдахгүй); төлөвлөгч дугаараар эрэмбэлж A–D-ийн ДАРАА үсэглэнэ, ард нь хана =
`WallsBehind`.  Үсгийн муж өөрчлөгдөхөд хэрэгслийн өгсөн хуудас/түлхүүр план (+гарчиг)/3D-ийн нэр «A-D» → «A-E» (`WeNaming.Rerange`, хэрэглэгч
өөрчилсөн нэрийг хөндөхгүй; хуудас өгөгдмөл ба «сурсан» хоёр загвартай тулгана).  Дэлгэрэнгүй `revit-mcp/docs/WALL_ELEVATIONS.md` «1.45.0».
Unit 260/260, цонхны харness 92/92, live gate Revit 2024 UIA-only 19/19 (GEN-EXTRA/RERUN-EXTRA/PREVIEW-EXTRA шинэ).  **Zip 1.45.0** (тараагаагүй;
Revit 2024-д л суусан): `dist/1.45.0/MGL-Revit-Addin-1.45.0.zip` sha256 `6bacb230…2367`, verify 153/153, test-bundle 53/53 = feat `38c92e19` + overlay.
Дараагийн zip ≥ 1.46.0.
**1.46.0 — инженерийн санал хүсэлт W01–W10 + «Санал хүсэлт» (2026-10-16, салаа `feat/engineering-feedback-we-2026-10-16`, ТАРААГААГҮЙ):**
W01 арын ажил эх элемент (өрөө, хана, шал/тааз, хаалга, түвшин, link, өрөөнд нэмэгдсэн элемент) хөндөгдвөл дараагийн алхмаас ӨМНӨ дахин
төлөвлөнө (`Core/WeSourceWatch`, минутад > 5 бол түр зогсооно), тэмдэглэгээ commit болсны дараа л бүтэн тэмдэг (`WeIdentity.Pending`) ·
W02 бүх дэлгээс НЭГ хуудсанд, 4 бүс → сул зай → шилжүүлсэн давхарга (`Core/WeSingleSheet`) · W04 маркерын төвийг бодит хилээр · W05 дугаарлалтын
муж · W06 үр дүнгийн хөтөч «MGL — Ханын дэлгээсийн үр дүн» (өрөө → дэлгээс → ОДООГИЙН хуудас; хэрэглэгч өөр зураг дээр бол нээхгүй; байрлал
Revit-ийн цонхны баруун доод булангаас харьцангуй — `Core/WeFloatPlacement`) · W07 босоо хүрээ + ШИНЭ ES схем `MglWallElevationState`
(GUID `c4a7e2d9…`), түлхүүр планы дүүргэлт хуудас/лавлагааны ДАРАА эцсийн шошго/маркераар (`Core/WeFillHoles`; Revit-ийн маркер хуудсанд орсны
дараа томордог) · W08 шал/таазны бодит нүүр (олон өндөр, налуу, алхам — `Core/WeSurfaceProfile`; ариун цэврийн өрөөний дүрэм жишээ хүлээж
байна) · W09 өрөөний зориулалт (Интерьер/Архитектур/Ариун цэврийн/Тусгай), англи ангиллын нэр · W10 туслах өгөгдмөлөөр нуугдмал, муруй хана =
«хөвчөөр, нумын уртаар дэлгэсэн БИШ».  Дэлгэрэнгүй `revit-mcp/docs/WALL_ELEVATIONS.md` «1.46.0», явц/нотолгоо
`docs/engineering-feedback/CHECKPOINT.md`.  ⚠️ Live gate (энэ PC, синтетик загвар) — 2-р ажиллагаа: 2027 36/37 PASS, 2024 26 PASS (2 FAIL засагдсан, 9 BLOCKED gate-ийн өөрийн алдаа — засагдсан); бүх засвартай 3-р ажиллагааны дүн хүлээлгэн өгөхөд ороогүй.  Хүний бодит төсөл дээрх шалгалт хийгдээгүй.
Дараагийн zip ≥ 1.47.0 (1.46.0-ийн candidate build-ууд энэ PC-д суусан).

### Revit add-in — «Олон өрөөний план (Python)» LIVE gate (2026-10-14, Revit 2027 дээр PASS, zip ХИЙГЭЭГҮЙ)

`revit-mcp/release-gate/room-plan/run-live.ps1` нь ӨӨРИЙН тусдаа Revit асаана (хэрэглэгчийн Revit ажиллаж байвал татгалзана).
Template-ээс 3 орон сууцтай «plate» үүсгэж, production кодоор (`tests/RoomPlan.LiveGate` нь `RoomPlan/Core`, Python bridge,
`ExistingFloorBoundary`, `RoomPlanFurnitureRevit`, `RoomPlanBatchApply`-г link хийж компайлна) төлөвлөгөө үүсгэнэ.  Revit-ийн бодит
геометрээр шалгадаг зүйлс: хана, Room, tag, хаалганы host, хаалганы эргэлт ↔ хана/тавилга/хаалга, тавилгын бодит хэмжээ, орцоос хүрэх
зам, хагас бүтэлгүйтлийн rollback, Undo/Redo.  Дэлгэрэнгүй, хэмжилт: `revit-mcp/release-gate/room-plan/README.md`.
- **Apply нь `RoomPlanBatchApply`-д (UI-гүй)** — `RoomPlanBatchCommand` (цонхнууд) ба gate хоёулаа ижил кодыг дуудна.  Тэнд мөн
  `DetectFacades`, `SuggestProgram`, `HasOccupied`, `CheckSharedBoundaryDoorConflicts`, `DoorHostProblem` (хаалга сонгосон хананд
  үүсэх эсэхийг юу ч үүсгэхээс ӨМНӨ шалгана; үргэлж rollback), `OrientSwings` байрладаг.
- Хэмжсэн, засагдсан: family-г бодит bbox-оор нь төвлөрүүлж эргүүлнэ (`FitToTarget`; `M_Counter Top` 0.78×2.50 м); `M_Door-Passage-
  Single-Flush` 100 мм хананд үүсэхгүй («Profile sketch is empty!») → preflight мессеж; Revit-ийн алдаа → бүх batch rollback (өмнө нь
  «Delete Element(s)» хагас төлөвлөгөөг commit хийдэг байв); хаалганы эргэлтийг хэн ч тогтоодоггүй байсан → `OrientSwings` (4 хувилбар,
  тавилга/хана > өөр хаалга > хувийн өрөө рүү); `HasOccupied` давхрын өндрийн мужаар шүүнэ.
- **Тавилга ЗЭРЭГЛЭЛЭЭР (economy / standard / luxury) — `Python/plan_furniture.py` (салаа `feat/roomplan-furniture-tiers`, 2026-10-14).**
  «Голд нэг ор»-ыг сольсон: орны толгой хаалгагүй хананд + хоёр талд шөнийн ширээ + хувцасны шүүгээ (+ хүүхдийн өрөөнд цонхны доор
  бичгийн ширээ); гал тогоо булангаас хана дагуу 1.0–1.2 м ажлын зайтай (+ L эргэлт), буйдан ↔ эсрэг хананд ТВ, дунд нь кофены ширээ,
  буйдан→ТВ харах тэнхлэгт юу ч тавихгүй, хоолны ширээ гал тогооны ойр; АЦӨ ванн/шүршүүр + WC (0.8 м бүс) + угаалтуур (+ угаалгын
  машин).  Зэрэглэл = хэмжээ, зай, нэмэлт тавилга (`TIERS`, хүснэгтүүд файлын эхэнд); `SuggestTier` (м²/унтлагын өрөө ≥35 тансаг, ≥24
  дунд).  Гэрээ: зүйл бүр `back` (аль хананд түшиж байгаа) → Revit family-г +Y = ар гэж эргүүлж бодит хананы НҮҮРЭНД 2 см-т тавина;
  footprint хананы нүүрнээс ≥1 см (`FurniturePlanner.Safe` ↔ `assert_furnished`); хаалганы бүс ±0.55 × 0.95 м (Python ↔ C# ижил).
  Заавал = ор, буйдан, гал тогоо, WC, угаалтуур (`FurniturePlanner.Required`); бусад нь сонголттой — family-гүй/багтахгүй бол хасагдаж
  тэмдэглэгдэнэ, хасахаас ӨМНӨ 1 м дотор ойрын чөлөөт байрлал хайна (`Nudge`).  Ижил family-ийн хэмжээгээр хамгийн тохирох төрлийг
  тавилга бүрт авна (`SizedType`: тансаг өрөөнд Queen, хүүхдийн өрөөнд Twin).  Тавилга `select_diverse`-д ЗӨВХӨН авах хувилбарт
  бодогдоно (12 нэгж 41 с → 4.5 с).  Room tag бүх нэгжээр нэг удаа (`PlaceTags`): өрөөндөө багтвал тавилга/бусад tag-ийг хамгийн бага
  дарах байрлал.  Gate (2027): 54 тавилга, хасагдсан 0, хатуу алдаа 0, ар нь хананд 49.  ⚠️ Хост (wall-hosted) тавилга дэмжихгүй;
  дотор ханын зузааныг үүсгэх үед мэдэхгүй (0.1 м гэж үзнэ); Монгол нормын шалгалтгүй; бодит компанийн family/модел дээр
  ХАРААХАН ажиллуулаагүй.
- **«Давхрын план» (Finch маяг, `MglFloorPlate`, 2026-10-14, салаа `feat/roomplan-furniture-tiers`).**  Өмнө нь add-in зөвхөн
  архитекторын аль хэдийн зурсан айл бүрийн шалыг төлөвлөдөг байсан («Олон өрөөний план»), мөн хэрэгсэл нийтлэг самбарт байж Python-ий
  `plan_furniture.py` payload-д ОРДОГГҮЙ байв (csproj `<Content>` дутуу → суулгасан add-in тавилгагүй ажиллана — `verify-bundle.ps1`
  одоо шалгана).  Одоо хоёулаа **Архитектурын самбарт** (`Disciplines = Architecture`), шинэ «Давхрын план»: бүтэн давхрын ХООСОН
  тэгш өнцөгт шал + 4 гадна хана → (1.41.0-д `FloorPlateWindow` цонх байсан; 1.42.0-аас ЦОНХГҮЙ студи — доорх хэсэг) коридорын схем,
  коридорын өргөн, шат-лифтийн хонгил (төвд / аль ч төгсгөлд `CoreAtLowEnd` / байхгүй, коридор руу нээлттэй), айлын харьцаа (1–4 ӨА),
  зэрэглэл, ханын төрөл → `Core/FloorPlateSplitter` (цэвэр, `tests/RoomPlan.Tests` FloorPlateTests) айлуудыг хуваана: харьцаа нь
  ЗОРИЛТ (найрлагыг хайж mixDev + 0.5·max|ln f| хамгийн бага, f ∈ [0.85, 1.35]), айл бүр `MinWidth(унтлагын, гүн)`-ээс өргөн (Python-ы
  7.8 м-ийн доод хэмжээ), ≤ 24 айл, том айл эгнээний захад (2 талын цонх).  Revit тал UI-гүй `FloorPlateShell` (команд ба gate хоёулаа):
  коридор / айл хоорондын хана → айл бүр `ExistingFloorBoundary.FromWalls` (`Virtual`, өөрийн Floor-гүй, `AxesStillMatch`) →
  `RoomPlanBatchCommand.RunPipeline` (ижил урсгал, `summary:false`) → нийтийн коридор + хонгил НЭГ Room (айлуудын ДАРАА: өмнө нь
  үүсгэвэл түүний bbox хонгилын эгнээний айлуудыг «эзэлсэн» болгоно).  Бүгд НЭГ TransactionGroup «MGL — Давхрын план» → нэг Ctrl+Z;
  хаана ч цуцалбал юу ч үлдэхгүй.  Хуваалцсан хананы хаалганы давхцлын босго 1.5 → 1.0 м (коридорын хана эгнээний бүх орцыг тээнэ).
  **Өдрийн гэрэл (эхний live run-аас олдсон):** зөвхөн `MinWidth`-ээр хуваахад дунд байрлалтай айлд цонхгүй унтлагын өрөө гардаг байв
  (☀3/4).  Python-оор хэмжсэн `LitWidth(унтлагын, гүн, булан)` — нэг гадна ханатай «дунд» айл 2ӨА ≥ 8.4–8.7, 3ӨА ≥ 10.8–11.4, 4ӨА ≥
  13.5–13.8 м; эгнээний үзүүрийн «булангийн» айл хамаагүй нарийн (3ӨА 7.8–9.0, 4ӨА 9.0–11.4).  Хуваагч эхлээд энэ өргөнөөр (том айл
  булан руу, `Pack` байрлал бүрээр шалгана), дараа нь хонгилыг төгсгөлд, сүүлд нь л доод өргөнөөр + «⚠ цонхгүй өрөө гарч болно»
  (`FloorPlateLayout.AllLit`).  «Бүгдэд шилдгийг сонгох» = бүх өрөө цонхтой хувилбаруудаас хамгийн өндөр оноотой
  (`RoomPlanBatchApply.BestFirst`) — Python-ы эрэмбэ оноогоор ХЭВЭЭР (тест шаарддаг; гэрэл 32 %-ийн жинтэй тул цонхгүй нь заримдаа №1).
  Fit кэш нь Search бүхэлдээ хуваалцана (хамгийн удаан хуваалт 108 → 77 мс).
  Gate `run-live.ps1 -Mode floor [-FloorSize 36x12 -FloorCore end -FloorTier economy]` (2027, 40×18): **PASS** — 6 айл, **6/6 бүх өрөө
  цонхтой**, үр ашиг 83 %, 289 элемент, хатуу асуудал 0, айл бүр ЯГ 1 орцоор коридорт, Undo/Redo.  ⚠️ Тэгш өнцөгт давхар л;
  шат/лифт/цонхны family тавихгүй; орцын 3/40 хаалга коридор руу эргэнэ (айлын хонгилд багтахгүй үед); нойтон өрөөнүүд айл хооронд
  босоо шугамаар зэрэгцэхгүй; гүн эгнээнд (≥10 м) Python-ы 7.8 м өргөнөөс болж айл томордог (галерей 36×12 энгийн → 3 айл 94–116 м²);
  олон давхар, нормын шалгалт байхгүй.
- **«Давхрын план» СТУДИ — нэг товч, цонхгүй, 100–500 хувилбар, шилдэг 20 (1.42.0, 2026-10-14, эзэн).**  Эзний хүсэлт: «маш их зүйл
  асуудаг» цонхыг хасаж, товч дармагц зүүн талд олон хувилбар гарч, хараад сонгоод нэг товчоор Revit-д, тавилгыг нэг товчоор.  Урсгал:
  `RoomPlanFloorCommand` → `FloorStudioEngine.Capture` (идэвхтэй планы давхрын шал — сонгосон эсвэл хамгийн том; асуудал бол самбарт
  бичнэ, TaskDialog-гүй) → зүүн талын «MGL — Давхрын план» самбар (`FloorStudioPane`, `FloorStudioPaneProvider` — GUID тогтмол,
  App.cs OnStartup-д бүртгэнэ) → `FloorStudioEngine.Generate` АРЫН урсгалд (Revit API дуудахгүй — `PythonUnitRequest.WidthM/HeightM`):
  `Core/FloorStudio.EnumerateSplits` (схем × хонгил × эгнээ × 6 харьцаа × 3 зэрэглэл, геометрээр давхардалгүй, айлын гүн ≤ 12.6 м) →
  айлын түлхүүрээр (`UnitKey`, мм) Python-ыг нэг удаа, 24-өөр 4 зэрэгцээ процесс, `max_options` 12 → `Compose` (хуваалт бүрд ≤ 8
  хослол, нэг хананд 1 м-ээс ойр орц хориотой, ≤ 500) → `Recommend` 20 (олон янз: хуваалт 2, зэрэглэл 45 %, харьцаа 30 %).  Оноо:
  тав тух .28 · гэрэл .22 · агаар сэлгэлт (хоёр талдаа цонхтой айл) .12 · үр ашиг .16 · харьцаа .10 · хэмжээ .07 · ойлгомж .05.
  Карт дээр дарж сонгоно → «Сонгосныг Revit-д тавих» (`Apply`, `CdJobHost.Post`-оор Idling-д; НЭГ TransactionGroup: энэ давхарт өмнө
  үүсгэснээ устгах → хана → айл (тавилгагүй — `RoomPlanBatchApply.Apply`-д хоосон `furniture` = тавилгагүй горим) → нийтийн коридор)
  → «Тавилга байрлуулах» (`Furnish` = ижил хувилбарыг тавилгатай сольж тавина; коридорын ханыг гараар зөөсөн бол татгалзана); туузан
  цэсний «Олон өрөөний план» нь студийн тавилгагүй давхарт ижил зүйлийг цонхгүй хийнэ.  Family автоматаар (`PickFamilies`: дотор хана
  ≈100 мм, коридорын ≈200 мм, хаалга 0.9 м-д ойр + `DoorHostProblem`, тавилга `Suggest`; family-гүй тавилгыг алгасаж самбарт хэлнэ).
  Үүсгэсэн элементийн бүртгэл санах ойд, `Document.CreationGUID` × давхрын түлхүүрээр (файлын замаар биш — Save As-ийн дараа солихоо
  больдог байв); Ctrl+Z-ийн дараа моделд бүтэн байгаа сүүлийн бичлэгийг «тавигдсан» гэж үзнэ.  ⚠️ Самбараас Revit API-г ЗӨВХӨН Post
  (Idling) / командын контекстод — ComboBox, MouseEnter зэрэг WPF үйл явдлаас шууд дуудахгүй.  Тест: `tests/RoomPlan.Tests`
  FloorStudioTests; gate `run-live.ps1 -Mode studio` (2024, 40×18): **PASS** — 500 хувилбар 16.8 с, шилдэг 20 бүгд бүх өрөө цонхтой,
  тавих 4.6 с, тавилга 2.9 с (105), солих 1.4 с, Ctrl+Z 237/237, хатуу асуудал 0; `studio-top20.png`.  ⚠️ Самбарын WPF-ийг бодит Revit-д
  хүн дарж ХАРААХАН шалгаагүй; Revit хаагдахад бүртгэл арилна (дахин нээсний дараа өмнө үүсгэсэн давхрыг «эзэлсэн» гэж үзнэ).
- **1.43.0 (2026-10-14, эзний дэлгэцийн зургаас):** (1) хоосон бүтэн давхар дээр «Олон өрөөний план» дарахад бүтэн давхрыг нэг айл гэж
  Python-д илгээж «Нэгжийн өргөн 7.8–30 м байх ёстой (одоо 40.0…)» гэж унадаг байв → `RoomPlanBatchCommand.IsStoreySized` (30 м-ээс урт
  эсвэл 250 м²-аас том) бол «Давхрын план» самбарыг нээнэ.  (2) **Суулгагчийн алдаа:** Revit нээлттэй үед шинэчлэхэд `install.ps1` хуучин
  хувилбарын хавтсыг `Remove-Item -Recurse`-ээр устгадаг — ачаалагдсан DLL үлдээд Python файлууд устаж, нээлттэй сесс «Python хөдөлгүүр
  олдсонгүй» болдог байв (эзний Revit 2027 дээр 1.41.0 → 1.42.0).  Одоо `Test-InUse` (DLL түгжигдсэн) бол хавтсыг БҮХЭЛД нь үлдээнэ;
  тусгаарласан тест + `test-bundle.ps1` 53/53 (1.5.1-ийн хуучин артефакт `mgl-e-c\revit-mcp\dist\1.5.1`-д).  InformationalVersion
  засвар ажилласан: лог «addin=1.43.0».  Эзний Revit 2027 дээр UIA-аар бодит товч дарж E2E: 500 хувилбар 17.4 с → тавих → тавилга 120 — PASS.


### Тоо хэмжээ (QTO) — Revit push

Source of truth is the **Revit 2027 add-in** (`revit-mcp/addin/`). The old in-browser `web-ifc` pipeline was removed 2026-07-03; legacy `source='ifc'` runs stay readable as history.

- **One run per FILE, not per project.** Since add-in Decision #2 it pushes host + each top-level loaded RVT link separately, which is why `file_name` — not `project_id` — is the dashboard's aggregation unit. This is the most load-bearing fact about the data model here.
- **Intake**: `POST /api/qto/revit-runs`, **admin-only**. ≤20k rows (413); strings are silently **truncated** at 256 chars, not rejected; dedupe on `(project_id, push_id)` → 409, but `push_id` is optional so a caller omitting it gets no idempotency. Writes one `qto_runs` row (`source='revit'`, `model_url='revit://<file>'`, **`schema_version='revit-2027'` in the column** while `'revit-1'` is a field *inside* `summary_json`) plus `qto_facts`.
- **Chunking is hand-tuned to D1's 100-bind limit**: 4 facts/INSERT (21 binds × 4) and 16 rooms/INSERT (6 × 16). **Adding a column to `qto_facts` means recomputing both.**
- **Six tables**: `qto_runs`, `qto_facts` (0117), `qto_view_exports` (0119), `qto_rooms` (0120), `qto_schedules` (0121), plus `resources` + `resource_alias` (0117/0118).
- **⚠️ Phase 2 (шифр classification) is 100% inert.** `resource_alias` has **zero rows and zero writers** — verified. So `resolveResourceCode` always returns null, every `qto_facts.resource_code` is NULL, the 1859-row `resources` catalog joins to nothing, and the UI has always shown 100% ангилаагүй. The spec's four `/classification/*` endpoints and two MCP tools were never built.
- **Frontend** `frontend/src/features/qto/` has **four** tabs, defaulting to **Самбар** (`DashboardTab.tsx`, ~574 lines + 12 sub-components), then Тойм / Ангилал / Түүх. The main read is `GET /api/qto/projects/:id/dashboard` (edge-cached 60 s, **keyed on projectId only** — do not add role-varying fields to that payload).
- `combo_key` / `normalizeFactKey` must never change — it is both the run-diff join key and the alias lookup key.
- **3D viewing is a separate concern** (APS, `routes/aps.ts`, `project_models`). QTO never touches it. `ifc-convert/` is gone; `model_xkt_url` / `model_conversion_status` are leftover columns.

### Remote MCP server

`backend/src/mcp/` — `MglMcpAgent.ts` (the `MCP_OBJECT` Durable Object) + `tools/*.ts`.

- **Auth is OAuth 2.1** through `@cloudflare/workers-oauth-provider`; the browser flow goes through `/authorize`. Legacy bearer JWTs still work via `resolveExternalToken`, which **does not check `purpose === 'mcp'`** — so an ordinary 24 h session token or even a 60 s print token authenticates `/mcp`.
- **31 tools + 1 prompt**, registered by a four-tier ladder evaluated **once per DO session** in `init()` (a role change in the DB does not revoke a live session): Tier 1 all authed (11) → Tier 2 `role !== 'client'` (2 + the prompt) → Tier 3 admin-or-senior (5 — `list_pending_approvals` was deleted 2026-09-17 with the approval workflow) → Tier 4 admin-only (13).
- **Four tools WRITE**: `triage_email` (the only confirm-gated one), `save_meeting_analysis` (UPSERTs over any prior analysis), `create_tasks_from_meeting_actions` (creates real tasks + notifications in any active project id named, fuzzy name→user matching, no dry-run), and `generate_report` (puts a PDF in R2 — and returns a `/media/client-reports/…` URL that **always 404s**, because `routes/media.ts` matches exactly one path segment).
- Tools reuse route SQL (`PROJECT_LIST_SQL`, `getProjectHierarchyFast`, `queryAttendanceForDate`, `classifyEmailMessage`, …) rather than reimplementing it — **keep it that way**. But the parallel surface drifts: `get_project_quantities` is admin+senior (not "non-client"), and the CEO/`seesPending`/`worker` gaps above all live here. **Any change to a REST access rule needs a matching MCP audit.**

### Frontend

React 19 + TanStack Query + React Router v7. **All page chunks are lazy-loaded** — keep it that way.

Real paths (an earlier revision of this file had every one of these wrong):

| Thing | Path |
|---|---|
| Entry | `frontend/src/app/main.tsx` |
| Route tree | `frontend/src/app/routes.tsx` (~60 routes) |
| Providers | `frontend/src/app/providers.tsx` |
| API layer | `frontend/src/shared/api/{client,queryClient,apiHost,useApi,notifications}.ts` |
| i18n | `frontend/src/shared/i18n/` |
| UI kit | `frontend/src/ui/` (shadcn "new-york", 36 primitives) |
| App composites | `frontend/src/shared/components/` |

There is **no** `src/main.tsx`, `src/api/`, `src/i18n/`, or `src/components/`.

- `/` renders **`GlitchLandingPage`** (a WebGL splash with zero API calls). `features/landing/LandingPage.tsx` — the CMS-driven page — is **orphaned**, kept as a documented restore target. Editing "the landing page" almost certainly means the wrong file.
- `ProtectedRoute` has six ordered gates: loading → `!user` → client sandbox → staff-out-of-`/client` → worker sandbox → `allowedRoles`. **`allowedRoles` is used exactly once** (`/app/attendance/admin`); every other page-level role gate lives inside the page component. Frontend role checks are UX only — the backend is the real gate.
- **Theme has three resolved modes**: `dark | dim | light` (+ `system`, which never resolves to `dim`). «Дундаж» = `.dim`, `#293C57`. Adding/changing a theme touches four places: `THEME_CLASSES` (`shared/lib/theme.ts`), the palette scope in `index.css`, `THEME_COLOR` in `ThemeContext.tsx`, `THEME_MODES` in `Layout.tsx`. `@custom-variant dark (&:is(.dark *, .dim *))` means every `dark:` utility also fires under `.dim` — but `ui/chart.tsx`'s `THEMES` map does **not** include `.dim`, so two-key `ChartConfig` colours fall back to light there.
- `resolveApiHost()` **hard-ignores `VITE_API_HOST` on any non-loopback origin** and always returns the production worker. This is a deliberate guard (a local `pages deploy` once shipped `127.0.0.1:3000` to production) — you cannot repoint a deployed preview via env var.
- i18n: `mn.json` is imported **eagerly** (4054 keys, ~273 KB chunk) and is the universal fallback; `en.json` is a lazy dynamic import (also 4054 keys, currently **zero drift**). New strings go in both.
- `manualChunks` ordering is load-bearing: the `classnames` rule must stay **above** the `recharts` rule or rolldown folds clsx into the recharts chunk and drags ~110 KB gzip onto first paint of `/login` and `/`.
- COOP `same-origin` + COEP **`credentialless`** must stay mirrored between `vite.config.ts` and `public/_headers`. `credentialless` (not `require-corp`) is required by the runtime-injected Autodesk APS viewer; narrowing the `/*` block breaks service-worker registration and silently kills push. `web-ifc` is gone but the headers stay.
  - **A consequence measured 2026-09-07: cross-origin isolation disables Chrome's PDF viewer for a PDF loaded over HTTP, but NOT for one loaded from a `blob:` URL.** `<iframe src="…/x.pdf">` renders the "couldn't load" placeholder; `<iframe src={URL.createObjectURL(blob)}>` renders the full viewer; `<object data={blob:…}>` renders nothing. So an in-app PDF preview must fetch the bytes first and hand the iframe a blob — which is what `features/email/components/AttachmentPreviews.tsx` does. `features/qto/.../ViewExports.tsx` hit the same wall and worked around it by opening a top-level tab; that detour is no longer necessary.
- Print routes: six of them, all calling `bridgePrintToken()` at module scope. They must never gate on an auth spinner and must set `body[data-print-ready="true"]` once data is in state.
- **Global search is deep, and it depends on two URL conventions.** `shared/lib/search/` (`normalize.ts` folds Cyrillic↔Latin so «илүү цаг» ≡ `iluu tsag`; `rank.ts` does AND-per-token scoring; `sections.ts` is the registry) plus `shared/hooks/useTabParam.ts` and `shared/hooks/useSectionAnchor.ts`. The sidebar box in `Layout.tsx` indexes nav rows **+ in-page sections + project names** (the `['/projects']` query, fetched only once the user types).
  - `?tab=<value>` — every tabbed page reads its tab through `useTabParam`, **not** `useState`. Converting a page back to `useState` silently breaks every search hit pointing at it.
  - `?section=<domId>` — `useSectionAnchor` is mounted once in `LayoutShell` and scroll-flashes `document.getElementById(...)` on **any** page. So a new searchable section is `id="sec-…" className="scroll-mt-24"` + one row in `sections.ts`; there is no third step. Currently 75 sections are registered against 56 `sec-*` ids; the ~20 unregistered ids are ready to register.
  - `[data-section-flash]` + `--animate-section-flash` in `index.css` are that hook's highlight; the flash timer deliberately lives at module scope, because the hook clears `?section=` immediately and React would otherwise run the effect cleanup before the animation is visible.

## Cloudflare зардлын аудит — D1 rows_read, R2, кэш (2026-09-11)

Хэмжсэн (prod-ын локал хуулбар, `Server-Timing: d1` тоолуур): нэг хүсэлтэд `/api/teams/allocation` **2 974 739** мөр, `/api/company/overview` 285 735 (ТВ самбар минут тутам → өдөрт ~410 сая = D1 үнэгүй лимитийн 80 дахин), `/api/teams` 203 389 (бүх dropdown), `/api/ticker` 48 384 (хэрэглэгч бүр 5 мин тутам), `/api/projects` 76 849.  Эх шалтгаан ГАНЦ: `latest_task AS (… pe.id = (SELECT id … ORDER BY … LIMIT 1))` CTE (24 хуулбар) — батлагдсан мөр БҮРД корреляцтай дэд асуулга + заримдаа `SCAN lt`.

- **`lib/progressLatest.ts` — сүүлийн батлагдсан явцын SQL ГАНЦ газарт.** `latestApprovedPctByCreatedAt(ref)` / `latestApprovedPctByDate(ref)` нь таск тус бүрийн скаляр дэд асуулга; `latest_task` CTE-үүд одоо `SELECT t.id AS task_id, <scalar> AS percentage FROM tasks t` хэлбэртэй (үр дүн байт-ижил, `LEFT JOIN … COALESCE` хэвээр).  **Хоёр tiebreak ХЭВЭЭР** (created_at / date-created_at-id); `dashboard.ts`-ийн гурав дахь `MAX(date)` хувилбар нэг өдрийн хоёр мөрийг ДАВХАР тоолдог байсан тул `byDate` болов — dashboard одоо `/projects`-тэй ижил тоо харуулна (хэмжсэн: 4 төслийн явц 5.31→5.17 г.м. засагдсан).  ⚠️ `latest_task AS MATERIALIZED (ROW_NUMBER() OVER …)` хувилбарыг ТУРШИЖ ХЭМЖСЭН — SQLite `SCAN lt` хийсээр 286 мс болж ДОРДСОН; бүү буцаа.  `projectLastActivitySql(approvedOnly)` — «төслийн сүүлийн үйл ажиллагаа» (ticker/timeline/company, 48 223 → 9 890).
- **Миграц 0290** (дугаар ЗОРИУД 0281-ээс алгасав): `idx_progress_task_approved_latest` → бүрхэх `(task_id, created_at DESC, percentage)`; шинэ `idx_progress_task_approved_seq (task_id, date DESC, created_at DESC, id DESC, percentage)`; `idx_progress_task` → `(task_id, created_at DESC)`; `idx_progress_created_at`.  Бүгд partial/`IF NOT EXISTS`, 6 statement, транспортын дүрэмд нийцнэ.
- **workerd-ийн `rows_read` нь TEMP B-TREE / MATERIALIZED хүснэгтийн мөрийг ч тоолдог** — тиймээс «materialize хийгээд join» нь заримдаа ДОРДУУЛДАГ (teams.ts-д хэмжсэн: overview 113k→546k).  Дүрэм: `WHERE team_id = ?` шүүлттэй handler-т CTE-г материалчлахгүй (pushdown хэрэгтэй), бүх багийг уншдаг handler-т локал `MATERIALIZED` CTE.  `CROSS JOIN` нь SQLite-д нэгдэх дарааллыг хатуу заадаг — блокоос доош алхахад ашигласан.  EXPLAIN-ыг ЗААВАЛ workerd дотор (`wrangler d1 execute --local --command "EXPLAIN QUERY PLAN …"`) ав — Node-ийн SQLite өөр төлөвлөгөө сонгодог.
- **`lib/d1Telemetry.ts`** — `index.ts`-ийн `defaultHandler` хүсэлт бүрд `env`-ийн гүехэн хуулбар + телеметртэй `DB` өгдөг; `Server-Timing: d1;desc="q= r= w="` толгой, босго давсан (`rowsRead ≥ 2000 / rowsWritten ≥ 50 / queries ≥ 25`) хүсэлт `[d1] …` мөрөөр `wrangler tail`-д; cron ажил бүр `cron:<нэр>` тоолууртай.  `D1_TELEMETRY_VERBOSE=1` (зөвхөн локал) бүх хүсэлт + `X-D1-Top` толгой; `POST /api/dev/d1-probe` (loopback + admin + тэр туг гурвуулаа) дурын SELECT-ийн rows_read-ийг хэмжинэ.  ⚠️ `first()` нь `all()`-аар хэрэгжсэн (D1 ч бүтэн үр дүнг татдаг).
- **`withEdgeCache` одоо isolate-ийн санах ойн давхаргатай** (`x-edge-cache: MEM|HIT|MISS`) — Cache API-ийн өмнө; TTL ижил, `bustEdgeCache` хоёуланг цэвэрлэнэ (өөрийн isolate/colo-д л).  Шинэ кэш: `/api/teams` (60 с, `date`), `/api/ticker` (300 с, `risk|plain` ролийн бүлэг — хариу хэрэглэгчийн id уншдаггүй тул аюулгүй; admin мутаци `bustTicker`).  TTL: company overview 120, charts 300, lifetime 3600, dashboard 60, projects 60.  ТВ (`CompanyTvPage`) 60 с → 300 с, lifetime 30 мин.
- **Cron**: `googleCalendarSync` KV `put`-ыг зөвхөн sync token ӨӨРЧЛӨГДСӨН үед (өмнө нь өдөрт 720 KV бичилт = үнэгүй 1 000-ын 72%); `emailSync` «аль хэдийн байгаа» шалгалт хайрцаг тутам НЭГ IN-асуулга (өмнө нь 100 SELECT/тик), `email_accounts` UPDATE зөвхөн өөрчлөлт/10 мин тутам (өмнө нь өдөрт 1 440 бичилт).
- **`/media`**: `caches.default` + `immutable` — түлхүүр хэзээ ч дахин бичигддэггүй тул аюулгүй; хоёр дахь уншилтаас R2 Class B үйлдэлгүй.  `GET /api/email/inbox-version` (1 мөр) — MailInboxPage минут тутмын `/threads` (74 000 мөр) polling-ийг сольсон.  `progress/my-tasks`: `assigned_to = ? OR EXISTS` → `IN (… UNION …)` (4 347 → ~5 мөр).
- **`lib/mediaReplace.ts` — солигдсон зургийн хуучин R2 объектыг устгана** (avatar/cover/signature/stamp — `PATCH /auth/profile`, `PUT /users/:id`; `projects.key_image_url`; `PUT /settings/branding`).  Зөвхөн `<sub>-<ms>-…` хэрэглэгчийн upload, `/media/<нэг сегмент>`, prev ≠ next, `users`/`projects`/`app_settings`/`landing_projects`-д өөр ишлэлгүй үед; UPDATE амжилттай болсны ДАРАА `waitUntil`-д.  `default-profile-photo.png`, хавтастай түлхүүр хэзээ ч устгагдахгүй (тест: `mediaReplace.test.ts`).
- **Цэвэрлэгээний хэрэгсэл (`backend/scripts/cleanup/`, npm `audit:*` / `cleanup:*`)** — БҮГД өгөгдмөлөөр DRY RUN, устгал `--execute --i-have-a-backup` ХОЁУЛАНГ шаардана, зөвхөн оффлайн D1 хуулбар (`--db=export.sql`) дээр ажиллана.  R2 инвентор нь admin-only `GET /api/storage-audit/inventory` (routes/storageAudit.ts, зөвхөн уншина; `wrangler r2 object`-д `list` байхгүй).  `r2-lifecycle.proposed.json` — `docpreview/` 7 хоног, `client-reports/` 30 хоног, multipart 3 хоног; ХЭРЭГЖҮҮЛЭЭГҮЙ.
- ⚠️ Deploy ХИЙГЭЭГҮЙ; prod D1/R2-д юу ч устгаагүй.  Дараалал: миграц 0290 → worker → Pages.  `GET /api/dashboard/team` нь frontend-д дуудагчгүй, 133 query N+1 — устгах/багцлах шийдвэр хүлээгдэж байна.

## Conventions worth knowing

- TypeScript is strict everywhere; `noUncheckedIndexedAccess` is on in the **backend** only. Don't loosen it.
- Mongolian comments and identifiers are intentional — keep them.
- Server-side time helpers are `backend/src/lib/time.ts`, which has exactly three exports: `todayInUB`, `nowInUBIso`, `isSummerSchedule`. There is no general date arithmetic there. **`isSummerSchedule` is a load-bearing attendance invariant**: June/July/August force the 08:00 shift for every user regardless of their stored `work_schedule`.
- **Shift hours live in exactly one place: `backend/src/lib/workSchedule.ts`** (`SHIFTS` = `early` 08:00–17:00 / `mid` 08:30–17:30 / `standard` 09:00–18:00, plus `effectiveSchedule`, `ubMinutesOf`, `isWeekend`, `addDays`). They were inlined in `routes/attendance.ts` until 2026-08-13; `lib/leaveWindow.ts` now reads the same table, so late-minute penalties and the leave-request window can never disagree. Changing a shift time means changing that one file — the values themselves come from `orgConfig()` (`ORG_SHIFT_STANDARD` / `_MID` / `_EARLY`, or `app_settings` `org.shift_*`).
- **Three shifts, and the choice is EFFECTIVE-DATED** (2026-08-26, migration `0199_user_work_schedules.sql`). The owner's rule: staff pick their own shift, the pick applies **from 2026-09-01**, and after that a change applies **from tomorrow** (so you cannot clock in at 09:05 and switch shift to erase the lateness). June–August still force `early` on everyone; the third shift 08:30–17:30 exists for the school/kindergarten run.
  - **`users.work_schedule` is NOT the source of truth any more.** Its `CHECK(... IN ('standard','early'))` cannot hold `'mid'`, and widening it means a path-B rebuild of `users` (19 cascading children) — not worth it for one option. The column is now a **historical fallback**: "what this person's shift was before September 2026", which is exactly what a report over an old date needs. `PATCH /auth/profile` no longer writes it (it was removed from the `allowed` whitelist).
  - The timeline lives in `user_work_schedules` (`user_id, schedule, effective_from`, `UNIQUE(user_id, effective_from)`), read through `lib/scheduleStore.ts` and resolved by the **pure** `effectiveSchedule(stored, date, assignments)`. Precedence: summer force → latest assignment with `effective_from <= date` → the legacy column. Passing no `assignments` reproduces the old behaviour exactly.
  - Three numbers that must not be conflated, all returned by `GET /api/attendance/my-status`: `work_schedule` (effective **today**), `schedule_selected` (what the picker highlights), and `schedule_change` (`{schedule, date, label}` — the next day the working hours change, computed by scanning forward, so it covers both "your pick starts 09-01" and "summer takes it back on 06-01"). The old UI highlighted the *effective* shift, which is why every user appeared to be on 08:00 all summer. `schedule_locked` is now always `false` and is kept only for contract compatibility.
  - `my-status` also returns `schedule_options` (key + label + start + end). The frontend shift table used to exist **four** times (`AttendancePage`, `AttendanceWidget`, `AttendanceProjectDialog`, `useWorkStartReminder`) in three different label formats; it is now one module, `frontend/src/features/attendance/shifts.ts`, and labels come from the server so `ORG_SHIFT_*` finally reaches the UI.
  - ⚠️ `attendance.ts`'s report builder used to hardcode `scheduleKey === 'early' ? '08-17' : '09-18'` — a third key would have silently printed "09-18". Labels now come from `shortShiftLabel(SHIFTS[key])`, which keeps `08-17` / `09-18` byte-identical and yields `08:30-17:30` for `mid`. The builder also resolves the shift **per row date** from the assignment history, which fixes the older bug where editing your shift retroactively rewrote last month's planned times and late waivers.
  - Admin can set someone's shift from **Хэрэглэгчид → засах** (`PUT /api/users/:id`, `work_schedule`); it takes the same deferred path. `GET /api/users` returns both `work_schedule` (effective) and `work_schedule_selected`. `DELETE /api/users/:id` manually deletes the child rows (D1 does not enforce FKs at runtime).
  - **Батлагдсан чөлөө never moves anyone's бүтээмж %** (owner, 2026-09-24: «чөлөө авлаа гээд хувь нэмэгдэх, хасагдах ёсгүй — өмнө ямар байсан тэндээсээ үргэлжилнэ»). ONE place: `lib/leaveAvailability.ts`. A rolling window («30 хоног») is counted in the person's **worked days**: its approved full-day-leave working days are skipped and the window reaches back by exactly that many earlier non-leave working days (`workedWindow`) — so during leave the value freezes and afterwards continues, no fake points are created, the ledger is untouched. Callers add `loadLeaveNeutral(...).delta(user, i)` to their existing nominal sum; no leave ⇒ delta 0 ⇒ byte-identical (verified vs HEAD on a prod copy). Wired into: `leaderboard.ts` `GET /`, `/averages` (+ `total_points_actual`, `leave_days`), `/me` (Profile % and rank); `reports.ts` `buildRows` (points, points_prev, repair_points, rank now / 7 d live, trend via `classifyTrend(…, leaveAdjust)`, team avg/rank; `all` window = lifetime, unadjusted); `employeeSnapshot.ts` (points_7d/30d, rank_7d/30d — stored rows before 2026-09-24 are raw); repair rate ladder (since 2026-09-28 via `lib/dailyAverage.ts`, below). For endpoints whose nominal sum is a UTC `datetime('now','-N days')` window pass `sqlWindows` or the boundary day is double-counted. Definitions reused: working day = Mon–Fri minus `holidays`; approved = `status='approved'` (pending/rejected/cancelled never count). Deliberate edges: sub-day leave and `leave_type='remote'` are not leave days; a leave day on which the person actually earned points is an ordinary working day; an unexcused absence stays a 0 day. NOT adjusted (calendar records, not rolling %): leaderboard `/monthly`, users `/monthly-stats`, daily series/sparkline bars, per-project breakdowns, lifetime totals, ticker «сарын тэргүүлэгч», MCP `trends`/`personActivity`. UI: `shared/components/LeaveAdjustedMark.tsx` (palm icon + actual % tooltip) on leaderboard/report totals, a note on the Profile card.
  - **ӨДРИЙН ДУНДАЖ = АЖИЛЛАСАН өдрийн дундаж — ONE place: `lib/dailyAverage.ts`** (owner, 2026-09-28: «шинэ хүн тэр өдөр хийсэн ажил нь тэр өдрийн хувь, маргааш нь 2 өдрийн дундаж — 30 хоногийн дундаж биш; ээлжийн амралтаас ирсэн хүн амралтаас өмнөх хувиасаа үргэлжилнэ»). `avg = Σ points [from, to] ÷ counted days`, counted days = the person's last **K worked days**, K FIXED = `round(N × 5/7)` (30 → **21**, 90 → 64 — fixed so the value freezes exactly during leave instead of wobbling 21/22 with the weekday). Walking back from `to`: weekends/`holidays` are not counted (their points still add to the sum); approved full-day leave is skipped and replaced by an earlier working day (`leaveAvailability.ts` definitions); it **stops at the join date `users.created_at`** (a 2-day employee divides by 2 — prod had users 84/83 at 1 and 10 days, whose rate was ÷21.43 → 20×/2× too low, and a new hire's first repair points then dragged the next day's rate down ~20×); an **unfinished day** (today / the `asOf` day) counts only once it has points, else the window ends yesterday. An unexcused absence stays a 0 day. `avg = null` when no counted day (joined today, nothing logged). Used by: repair / non-project rate ladder `repairProgress.ts` `baseDailyRate` (self30/self90; team30/company30 = mean of the members' own averages, members with no counted day excluded — the old `dailyRateSql` / `applyLeaveToLadder` / `workDaysIn` are deleted), leaderboard `/averages` `avg_daily` (**changed unit**: per worked day, was total ÷ 30 calendar days → tenured values ×~1.45; new fields `avg_days` / `avg_target`, UI «N өдөр» mark on new hires), reports `daily_avg_30d` (`through: anchor`). NOT used by totals/ranks (still `loadLeaveNeutral`) nor by team productivity (`teamProductivity.ts` `memberAverage`, calendar-period average with the same join/leave rules). Measured on the 2026-09-28 prod copy (48 staff): tenured points-rate median +3.4 % (÷21 vs ÷21.43 plus a one-day window shift before today's first entry — one user ×4 because a 2.54 % day on 08-28 re-entered the Monday-morning window). Tests: `dailyAverage.test.ts` (18), `repairProgress.test.ts`.
- There is **no payroll module** — `payroll_periods` / `payroll_entries` (migration 0036) have zero readers and zero writers. The only money in HR is `late_minutes × app_settings.late_penalty_per_minute`. When someone says "the shift must drive salary", they mean lateness + credited hours + the XLSX timesheet.
- **Чөлөөний хүсэлт is time-gated** (`lib/leaveWindow.ts`, 2026-08-13). `POST /api/leaves` 403s outside the requester's own shift, on weekends, and on `holidays` rows; full-day leave must start **tomorrow or later**, while sub-day leave (a non-null `start_time`) may start today provided it is at or after the current UB minute. **The `adminGrant` branch — `POST /api/leaves` with a `user_id` — is deliberately exempt**, because it is the only way a phoned-in emergency leave reaches the DB. `GET /api/leaves/window` feeds the UI (the `holidays` lookup is server-only); `MyLeavesCard` swaps the form for a locked panel that, by explicit decision, shows **no phone number and no message option**.
  - **`adminGrant` has two sub-modes** (2026-08-26). `submit_as_pending: true` is the **«нөхөж бүртгэх»** path: the row is inserted `status='pending'` with `created_by` = the admin and **no** `reviewer_id`/`decided_at`, and is then approved through the ordinary `POST /:id/approve` — so "who filed it" and "who approved it" stay two different people. Without the field the old behaviour stands: straight to `'approved'` with `reviewer_id` = the admin (the phoned-in emergency). The admin UI is the **Ирц → Чөлөө → «Чөлөө нөхөж бүртгэх»** dialog (`LeaveGrantDialog.tsx`), which mirrors the employee form field-for-field (`reason_code`, full/half/4h/2h/time-range, attachment) — the old one could only write a full-day row with a bare `leave_type`, so a two-hour absence was recorded as a whole day and lost its policy classification.
  - **`adminGrant` also refuses overlaps** (`lib/leaveOverlap.ts`, tested). SQL filters date-range intersection; the pure helper then allows the one legitimate exception — two **single-day, time-ranged** leaves whose windows do not intersect (10:00–12:00 + 14:00–16:00). Anything else 409s with `conflict_leave_id`. The employee path is deliberately **not** guarded: the risk there is low and changing it would alter a shipped flow.
  - **«Өвчтэй (эмчийн магадлагаа)» = ЦАЛИНГҮЙ** (2026-10-13, эзэн; миграцгүй, DEPLOYED — `f8f2f9c0`, worker `33d84be8`, Pages `25d6edfe` `index-BEld2The.js`). `leavePolicy.ts` (backend ↔ frontend ихэр) `sick.is_paid = false`, `leave_type` нь `'sick'` хэвээр. Цалингийн хүснэгт (`lib/dayLeaves.ts` `isUnpaid`) одоо `leave_type = 'unpaid'` ЭСВЭЛ мөрийн `is_paid = 0`-ыг цалингүй гэж тооцно (өмнө нь зөвхөн төрлөөр — прод дээр тэр үед `is_paid = 0` мөр бүгд `unpaid` байсан тул түүх хөдлөөгүй). 11.7-ийн «сард 3 цалингүй хоног» сэрэмжлүүлэг зөвхөн `leave_type = 'unpaid'`-г тоолно. Хуучин 12 «Өвчтэй» мөр `is_paid = 1` хэвээр (цалинтай).
  - **Цайны цаг чөлөөнд ТООЦОГДОХГҮЙ** (2026-10-12, миграцгүй, DEPLOYED — commit `f84f6b12`; deploy branch `deploy/live-2026-10-12-leave-lunch` @ `4aa27130` = Pages `a42d878e` + worker-ийн `48382667` + засвар; worker `cd770d93`, Pages `f26c8ebd` `index-DB4eYYOm.js`). Эзний гомдол: 09:00–18:00 ээлжтэй хүн 09:16–18:00 чөлөө хүсэхэд «8 цагаас хэтэрч болохгүй — 8.73» гэж унадаг байв. Дүрэм ГАНЦ газар `lib/leaveHours.ts` ↔ frontend ихэр `features/attendance/leaveHours.ts`: цагтай чөлөөний цаг = цонх − `app_settings` цайны цонхтой давхцал (09:16–18:00 → 7.73). `POST /api/leaves` үүгээр бодож нэг өдрийн цонхонд 8 ажлын цагийн ХАТУУ тааз тавина (өмнө нь зөвхөн UI); `GET /leaves/window` → `lunch`; «4 цаг/2 цаг»-ийн дуусах цаг цайг алгасна (11:00 + 4ц → 16:00, `addLeaveWorkMinutes`) тул сервер ЯГ сонгосон цагийг дахин бодно; ирсэн цагаар богиносгох (0364) ч цай хасна; ирцийн хүснэгтийн хоцролтын суурь `ээлжийн эхлэл + чөлөө`-г цайг алгасаж бодно (`attendance.ts` `leaveWallMinutes`) — эс бөгөөс 08:00–14:30 чөлөө + 14:30 ирэлт 30 мин хоцролт болно. Ажилтны форм ба админы «нөхөж бүртгэх» цонх `myLeavesCard.lunchExcluded` тайлбар харуулна. Тест: `lib/leaveHours.test.ts` (6), `routes/attendanceShiftBounded.test.ts` (+1, бодит SQLite). ⚠️ Аль хэдийн бичигдсэн мөрүүд ХӨНДӨГДӨӨГҮЙ: прод дээр цай дамнасан нэг өдрийн чөлөө 9-р сард батлагдсан 5, 10-р сард батлагдсан 2 (#443 13:00–17:00, #479 10:30–14:30 — тус бүр 4ц, шинэ дүрмээр 3ц) + хүлээгдэж буй 1 (#490 09:22–13:22, 4ц → 3.63ц) — засах эсэх эзний шийдвэр.
  - **Батлагдсан чөлөө ИРСЭН ЦАГААР автоматаар богиносно** (migration 0364, 2026-09-30, DEPLOYED). Эзэн: «12:00 хүртэл чөлөөтэй хүн 09:00-д ирвэл 08:00–09:00 (1 ц) чөлөө болж, цалин ирсэн цагаас». Дүрэм ГАНЦ газар — `lib/leaveArrivalCut.ts` (цэвэр, 13 тест): өдрийн цонх = нэг өдрийн цагтай чөлөөнд `[start_time, end_time]`, цаггүй / олон хоногийнд ээлжийн `[эхлэл, төгсгөл]`; цонх ээлжийн эхлэлд/өмнө эхэлдэг бол ирсэн цаг < цонхны төгсгөл үед чөлөө = `[ээлжийн эхлэл, ирсэн цаг]` (эрт/цагтаа эсвэл grace дотор ирвэл **0 ц** — эзний шийдвэр), өдрийн дундын цонхонд зөвхөн цонх ДОТОР ирвэл `[эхлэл, ирсэн]`; **олон хоногийнд зөвхөн ирсэн өдөр** (эзний шийдвэр); `remote`, амралт/баярын өдөр, олон хоногийн цагтай мөр хөндөгдөхгүй; минут нь 2026-10-12-оос ЦАЙ ХАССАН ажлын минут (доорх «Цайны цаг чөлөөнд тооцогдохгүй»; өмнө нь түүхий зөрүү байсан). Ирсэн цаг = тэр өдрийн `MIN(clock_in)`. D1 давхарга `lib/leaveArrivalCutStore.ts` `syncLeaveArrivalCuts(user, date)` — идемпотент, өдрийг эхнээс дахин тооцно: `leave_arrival_cuts` (чөлөө × өдөр, `full_minutes`/`used_minutes`) + мөрийн `start_time/end_time/hours/days` = ҮР ДҮН, анхны утга `arrival_orig_*` (`arrival_orig_days IS NOT NULL` = богиносгосон тэмдэг); богиносголт арилбал анхны утга буцна. Дуудагч (Safe, ирцийг унагахгүй): `POST /clock-in` (анхны ирэлт; хариуны `message` + `leave_adjustments`), админы `/sessions/manual|upsert`, `DELETE /sessions/:id`, `/sessions/bulk-delete`, чөлөө батлах (`decide`, adminGrant шууд батлах → `syncLeaveArrivalCutsForLeave`, өнөөдөр хүртэлх ирцтэй өдрүүд). Уншигч: `buildDailyAttendanceRows` (цалингийн хүснэгт) өдрийн минутыг cut-аас, ирээгүй өдрийг `arrival_orig_hours`-оос; 0 минутын cut = тэр өдөр чөлөө БИШ (энгийн ажлын өдөр); `reports.ts` `leaveAgg`; `/stats` «одоо чөлөөтэй»-гээс cut-тай мөр хасагдана; timesheet/сарын хязгаар мөрийн үр дүнг шууд уншина. UI: `LeaveArrivalCutNote.tsx` (админ жагсаалт + «Миний чөлөө»). `DELETE /api/leaves/:id` cut мөрийг гараар устгана. Тест: `leaveArrivalCut.test.ts` 13, `leaveArrivalCutStore.test.ts` 8 (бодит 0364); API E2E 34/34 прод-хуулбар дээр. **DEPLOYED 2026-09-30** (commit `57b7c1b5`): D1 0364 (өмнөх bookmark `0000020c-00000146-000050f6-1c8c817111ee683f0816857e55cff1c6`), worker `9ce46a27`, Pages `6f02d75a` (`index-C4pSvjib.js`). **9-р сарын нөхөлт (эзний шийдвэр)**: deploy хийсэн ЯГ тэр sync-ийг прод өгөгдлийн санах ойн хуулбар дээр ажиллуулж үүсгэсэн SQL-ээр 13 чөлөө / 14 өдөр (−18.82 ц) богиносгосон, дахин шалгахад өөрчлөлт 0.
- `withEdgeCache` has **no** automatic user scoping — correctness depends entirely on the caller enumerating every discriminator in `varyTags`. Six call sites. `routes/ticker.ts` and `routes/timeline.ts` deliberately opt out. (Nine `bustEdgeCache('landing:public')` calls in `landingBlocks.ts` are no-ops — nothing populates that key.)
- **D1 does not enforce the declared foreign keys at runtime**, yet `migrations apply` runs inside a transaction where cascades *do* fire. Hence both the manual-delete convention (`email.ts`, `calendar.ts`, `pgp.ts`, `repair.ts` all delete children by hand and say so) and the path-B runbook. Adding a child table means remembering the manual delete.
- Route-order landmines: `/top` and `/reorder` must stay above `/:id` in `projects.ts`, `tasks.ts`, `blocks.ts`, `drawings.ts`, `components.ts`.
- **Twin files that must move together** (none enforced by types or tests): `lib/leavePolicy.ts` ↔ frontend twin · `lib/teamReportStatusQuestions.ts` ↔ frontend `status-questions.ts` ↔ `lib/teamNotesAi.ts` · `lib/teamReportFieldCatalog.ts` (generated) ↔ each team's `template.ts` · frontend `STANDARD_ADDONS/SECTIONS` ↔ `gen-control-budget-template.mjs` · the worker sandbox (5 files) · the CEO hardcode (2 files) · COOP/COEP (2 files) · `NotificationType` (backend ↔ `shared/types/index.ts`, **currently drifted** — the frontend is missing `assessment_assigned` and `assessment_submitted`).
- There is no `app.onError` and no `app.notFound` in `index.ts`, alongside 103 bare `catch {}` blocks. There is no consistent error envelope. On the client, `apiFetch` parses every response as JSON with a swallowing catch, so a non-JSON 200 resolves to `{}` instead of throwing; `downloadPdf`/`uploadFile` throw plain `Error` while everything else throws `ApiError`.

## Үнийн санал (Price Quote) — v3, a spreadsheet

**The v1 line-item schema (migration 0083) was DROPPED by `0127_drop_quotes.sql` on 2026-07-24.** There is no `quote_template_sections`/`quote_template_items`/`quote_comments`, no `field_type`, no `draft → submitted → approved` lifecycle, no `expires_at`, no `public_token`, no `/api/quotes/public`, no `/quotes/fill` link, no client-facing quote surface, and no quote notifications. Do not resurrect any of it.

What exists (migration 0128, `routes/quotes.ts` header calls it "v3"):

- Four tables: `quote_tariffs` (353 seeded БД 81-16-20 rows, PK `(area_max, complexity)`), `quote_templates`, `quote_template_history`, `quotes`.
- **The whole document is one `sheet_json` column** holding a `WorkbookDoc = {sheets, activeSheet, anchors}`. Cells hold literal values or Excel-ish formulas.
- **The server never evaluates formulas.** `total_amount` is a client-supplied cache and is NULL for any quote never opened in a browser. The formula engine is `frontend/src/features/quotes/lib/formula/`, with custom `TARIF()` and `USGEER()` functions.
- **Every route is `requireAdmin()`** (`quotes.ts:40`) — `senior` is deliberately excluded because prices are confidential.
- Tariff area brackets are **upper bounds** (1200 m² → the 1500 row). The generator refuses to emit unless five real MGL quotes reproduce exactly.
- The «Хяналтын төсөв» template chains: `TARIF(area, complexity)` → height coefficient `IF(h>4.5; 1+(h−4.5)×0.05; 1)` → ЗТАҮ → six % add-ons → seven per-discipline section columns → НИЙТ ДҮН. **The height coefficient's additive-vs-multiplicative reading was never validated against the standard's text** (~2.8% difference at 10 m).
- PDF is `GET /api/quotes/:id/pdf` → 60 s JWT → Browser Rendering against `/quotes/:id/print?t=…`, **`landscape: true`** (mandatory for 26 columns).
- Known gaps: `quotes.project_id` is hardcoded NULL on create (so the FK and its index are unused); anchors do not follow row/column inserts in the editor because neither editor page calls `normalizeWorkbook`.

### Хэсэгчилсэн санал — scope narrowing (`POST /api/quotes/:id/scope`, 2026-08-19)

"If we only commission the concept design, what does it cost?" is the most common follow-up question a client asks, and answering it used to mean hand-editing the ДҮН formula. One button in the editor now does it: the dialog (`components/ScopeQuoteDialog.tsx`) lists the scope items, shows the recomputed grand total **live**, and creates a new quote.

- **The narrowing is 100% client-side** (`lib/scopeQuote.ts` → `applyScope`), because `addons`-spec semantics live in `lib/addons.ts`/`sheetOps.ts` and the server never evaluates formulas. The route only inherits the source quote's header fields and inserts a row — do **not** grow a server-side twin of that logic.
- Excluded cost lines go through `removeCostLine` (strips the term from ДҮН *before* deleting the row, so no `#ХАСАГДСАН!`). Management 2%, НӨАТ and НИЙТ ДҮН point at ДҮН and therefore recompute themselves — that is the whole trick.
- **The building table always stays**, even for a sketch-only quote: the sketch fee *is* `АЗ × 15%`. When АЗ itself is out of scope, only its term is dropped from ДҮН and its label gets « /тооцооны суурь/ » appended, so the client can't read that number as a charge.
- **Anchors are re-derived from the spec** (`lines.totalRef` / `costLines.sumRef`) after the transform. Required, not optional: the editor never calls `normalizeWorkbook`, so `sheet.anchors` is `{}` and `deleteRows` has nothing to remap — the workbook anchor would otherwise freeze N rows below the real total.
- Unlike `/translate`: `source_quote_id` stays **NULL** (a partial-scope quote is its own deal — setting it would make `PATCH /:id/status` 400 forever and hide the row from the funnel), `doc_date` is **today**, and `total_amount` comes from the client because narrowing always changes the number.

### English versions (`lang` / `source_quote_id`, migration 0181, 2026-08-17)

`POST /api/quotes/:id/translate` translates a Mongolian quote's workbook and stores it as a **new, linked row** (`lang='en'`, `source_quote_id=<mn id>`) — so the editor, autosave, print/PDF and status machine reuse the single-document path unchanged. Load-bearing facts:

- **Translation is dictionary-first, AI-second.** `backend/src/lib/quoteTranslate.ts` `QUOTE_MN_EN_DICT` carries every fixed template string; only free text (building names, the title, PM prose) goes to Workers AI (70B with JSON mode, 8B fallback). A string the AI drops **stays Mongolian** — a partial AI failure must never blank a cell.
- **Three twin surfaces must move together with the dictionary:** the MN keys mirror the labels in `backend/scripts/gen-control-budget-template.mjs`, the EN values mirror `labelEn` in `frontend/src/features/quotes/lib/addons.ts` (a menu re-add must reproduce exactly what translation produced), and the translated complexity dropdown feeds `TARIF()` → so `frontend/.../lib/tariffLookup.ts` carries English keywords. Change one, change all three.
- Only cell `v`, string literals **inside** formulas, `choices`, `sheet.addons` labels + `priceFormula`, and sheet names are rewritten. Sheet renames also rewrite cross-sheet refs **the way the engine resolves them** (case-insensitive, trimmed, whitespace before `!`), and collide-proof the new names.
- `USGEER()` stays in the formula; the hooks inject `numberToEnglish` and an `en-US` `TEXT()` locale when `lang==='en'`.
- **The funnel excludes translations** (`source_quote_id IS NULL`), so `PATCH /:id/status` **400s on a translated row** and the list hides «Төлөв солих» there — the deal's status lives on the Mongolian source only. A partial unique index (`WHERE lang='en'`) enforces one English copy per source; the route maps that violation to the same 409 `EXISTS`.

### The print surface (`/quotes/:id/print`) — rebuilt 2026-08-17

Browser Print and the server PDF render **the same page**, so every rule below applies to both. Five things are load-bearing:

1. **Column widths and font size come from the CONTENT, not from the design px.** `lib/printFit.ts` measures every cell's rendered text with canvas `measureText` (same font stack as the page — keep `FONT_STACK` in sync with `QUOTE_PRINT_BASE_CSS`), then picks the largest font at which **both** the un-wrappable demand (numbers) **and** a readable minimum for wrapping text fit. Choosing the font from the numeric demand alone starves the Cyrillic text columns to ~20px and stacks them one letter per line — that shipped once and made the document unreadable and taller than A4.
2. **Page margins are two layers on purpose.** `@page { margin: 7mm 5mm }` + `.quote-print { padding: 7mm }` = the old 14/12mm. The browser's "Margins: None" print setting overrides `@page` but cannot touch the padding. `backend/src/routes/quotes.ts` passes the **same** 7/5mm to `page.pdf()` so the geometry is identical whichever layer Chromium honours — change one, change both.
3. **`printHiddenCols` must never hide an anchor column.** It hides the section columns, and the addon subtotal **only when section columns exist**. On the 13-column default template (0130) `addonTotalCol` *is* the document's only money column (ДҮН · менежмент · НӨАТ · НИЙТ ҮНЭ all live in it), so the unconditional version silently dropped every price from print and PDF.
4. **Summary rows are found by `data-anchor`, not by `colspan`.** `SheetGrid` stamps `data-anchor` on anchored cells. The old `colspan="<cols−1>"` selectors were dead in both templates, because a hidden column makes the rendered colspan count *visible* columns.
5. **The signature block is entirely React and sits in normal flow.** `lib/signatureBlock.ts` finds the «БОЛОВСРУУЛСАН:» heading below the last bordered row and treats everything after it as block content; those rows are hidden via `SheetGrid.hiddenRows` (the vertical twin of `hiddenCols`) and re-drawn centred. Absolute positioning was tried and overlapped the «Тайлбар» line and the stamp. `SIGN_RESERVE_MM` must cover the block's **whole** height or the vertical fill pushes it onto page 2.

### Тайлбар — the footnote blocks are generated, not stored (2026-08-24)

The «Тайлбар:» and «Ашигласан материал:» blocks at the bottom of a control-budget quote used to be five + three **hardcoded** sentences in the template. They lied: every quote claimed «төсвийн 8% нэмж тооцов» even with the `tosov` add-on off, and cited БД 81-117-13 / БД 81-103-21 on quotes with no geology or topography priced. `frontend/src/features/quotes/lib/quoteNotes.ts` now derives them.

- **The predicate is «priced», not «toggled on».** Every new quote is born with all four qty cost lines present but blank, so spec membership would have made the lie *look deliberate*. `noteCtx` reads the literal qty/flat cells (no formula engine — they are plain `v` values) and `addonIsUsed` ignores an add-on column whose data cells the PM cleared. The 4.21.3 height sentence keys off a building height > 4.5 m, **not** the `optionalCols` «Өндөр» group — that group only *hides* columns while the coefficient keeps multiplying the price.
- **No spec, no migration, and no rows required.** State lives in `SheetDoc.notes` (`on`/`off`/`text`/`i18n`) **by key**, exactly like `hiddenGroups`. Rows are only *also* rewritten when the sheet actually has a block (located by scanning for the «Тайлбар:» / «Ашигласан материал:» **label cell**) — so the editor, Excel and print agree there, while a pre-0185 quote with no block still gets correct notes on paper and full menu control (`NoteMenu` gates on `hasNoteBlocks(sheet) || sheet.addons`; only «add your own note», which needs a row, is hidden there). Refs are deliberately not stored: `sheetOps.shiftRef` collapses a deleted row's ref to `op.at` instead of dropping it (unlike `remapCells`), so a ref-based note would eventually overwrite a different row — `sections.noteRef` carries that latent bug today.
- **Only literal (`v`) cells are scanned for the label.** The USGEER row's formula *starts* with «Тайлбар:»; treating it as the block would destroy the PREFIX/SUFFIX dictionary keys.
- **Off ⇒ the row is deleted, never blanked** (the editor and `exportQuoteXlsx` read raw cells; only print hides them). **The label row is never deleted** — without it `detectSignatureBlock` never enters `mode='bd'` and every remaining note vanishes from print while still showing in the editor.
- `syncNotes` runs from the «Нэмэгдэл»/«Тайлбар» menus, from `applyScope`, and **once when `QuoteEditorPage` opens a document** (that last one is what fixes template-fresh quotes). It is idempotent — an unchanged sheet returns the identical object, so autosave does not fire.
- **English stays deterministic without a backend twin.** A generated sentence is no longer a whole-string `QUOTE_MN_EN_DICT` key, so `syncNotes` stores the MN→EN pair in `sheet.notes.i18n` and `POST /api/quotes/:id/translate` layers it **over** the AI results (and removes those strings from the AI batch). `mapNoteState` translates `notes.text` and drops `i18n` on the English copy. `sanitizeSheetDoc` had to allowlist `notes` — it is an allowlist, and a missing field 200s then vanishes on the next read.
- **`signatureBlock.ts` no longer copies the notes off the sheet — it derives them** through the same `noteTextsFor` the editor uses, keeping only the PM's own (rule-less) rows from the parse. `DEFAULT_BD_NOTES` / `DEFAULT_MATERIAL_NOTES` are **deleted; do not restore them.** They were a hardcoded "no block found ⇒ print these five sentences" fallback, and because **every pre-0185 quote's `sheet_json` has no note block at all**, that fallback was the *main* path, not an edge case. Measured on quote 51 (2026-08-24): `addons.items` was bms·water·fire·cool·quake (**no `tosov`**) and `costLines` was sketch·landscape (**no geology/topography/masterplan**), yet `/quotes/51/print` still asserted «төсвийн 8% нэмж тооцов», «БД 81-117-13 … геологи» and «БД 81-103-21 … геодизи». Deriving also makes the print page language-correct by construction (it renders with the quote's `lang`) and makes a «Тайлбар» toggle take effect on paper immediately. `QuotePrintPage` no longer hardcodes the two Mongolian headings — it renders `signBlock.noteLabel`/`materialLabel` and hides a block whose list is empty (the English PDF had been printing «Тайлбар:» all along).
- **Regression guard**: `cd frontend && npm run check:notes` (also inside `npm run verify`). It runs 15 scenarios against the **real** `sheet_json` decoded out of `backend/migrations/0185_*.sql`, so row arithmetic, merges, the USGEER formula and the anchors are checked against production data, not a fixture.
- The template generator still emits the eight static sentences as an initial state; its header now says **edit the wording in `NOTE_RULES`, not there**, because `syncNotes` overwrites those rows on first open.
- ⚠️ Known, untouched: `sections.noteRef` («Хасагдсан хэсэг: …», written by `writeSectionNote`) sits at `A22`, **above** the «Тайлбар:» label, so the classifier never assigns it a mode and it has **never** reached print or PDF. Separate decision, separate change.

`lib/currency.ts` derives the money columns from `AddonSpec` plus a «/төг/» header scan; `formatValue(value, fmt, currency)` prefixes `₮ ` only for `#,##0` / `#,##0.00`, so quantities, heights, coefficients and percentages never get a currency symbol. `SheetGrid` calls it for both the editor and the print page, so screen and paper can't drift.

⚠️ **Template migrations UPDATE in place, never DELETE + INSERT.** `quote_template_history.template_id` is `ON DELETE CASCADE` and `quotes.template_id` is `ON DELETE SET NULL`, so deleting a template row wipes its whole version history and unlinks every quote ever made from it. `gen-control-budget-template.mjs` now snapshots to history, then UPDATEs, and only INSERTs when the row is absent (see `0180_control_budget_management_line.sql`).

⚠️ **A template migration only affects NEW quotes.** Every quote snapshots `sheet_json` at creation, so fixing a formula in the template does nothing for documents already created — those must be edited individually.

### MGL AI (2026-09-08, migrations 0268–0275, `ai/` workspace)

**Шинэ дэд систем.  Локал инференс — токен тутмын төлбөр БАЙХГҮЙ.**  Гурван
давхаргатай: Cloudflare Worker (эрх, контекст, ERP хэрэгсэл, санал хүсэлт) ·
ажилтны PC дээрх `mgl-ai-runtime` (llama.cpp, GGUF) · React чат.

- **`/api/mgl-ai` нь LLM АЖИЛЛУУЛДАГГҮЙ, ЗОРИУД.**  Инференс нь
  `127.0.0.1:39217` дээр.  Worker дунд нь орж дамжуулах нь бүтээгдэхүүний
  оршин байх шалтгааныг (§3-ын «no per-token fee») устгана.  Урсгал:
  хөтөч → `/context` (эрхээр шүүсэн prompt) → локал `/generate` →
  `/messages` (эшлэл СЕРВЕР дээр дахин шийдэгдэнэ).
- **`lib/revitAgent.ts` (Anthropic API) ба `routes/ai.ts` (Workers AI) нь
  ХЭВЭЭР.**  MGL AI тэднийг ХЭЗЭЭ Ч дуудахгүй — тэд бол орлуулах ЗОРИЛТ.
  `ai/runtime/test/engine.test.ts` нь `ai/`-ийн эх кодыг grep-дэж төлбөртэй
  хостыг барина.
- **Модуль нь `mglai`, `ai`-аас ТУСДАА** (`lib/modules.ts` + frontend twin).
  `ai` бол Workers AI-ийн монгол бичвэр сайжруулагч, нэг endpoint.
  ⚠️ Frontend-ийн `MODULE_IDS`-д `learning` БАЙХГҮЙ — энэ өөрчлөлтөөс ӨМНӨ ч
  байсан зөрүү, өнөөдөр цэсгүй тул нөлөөгүй.
- **`lib/mglai/visibility.ts` нь нууцлалын ГАНЦ хаалга.**  `filterEvidence`
  нь `assembleTurns`-аас ӨМНӨ дуудагдана — дарааллыг сольвол нууц текст
  prompt-д орно.  «Загварт битгий хэл гэж хэлэх» нь шүүлт БИШ (§49).
  Захиалагч нь `public` ангилал + `public|org|project` хамрах хүрээ
  ХОЁУЛАА таарсан мөрийг Л авна.
- **`client` нь `clientScope.ts`-ийн цагаан жагсаалтад ЗОРИУД нэмэгдсэн;
  `worker` нь `identity.ts`-д `denied`** — `workerScope`-ийн дараах ХОЁРДУГААР
  давхарга (MCP-ийн цоорхойгоос сурсан).
- **Мөр байхгүй = `READ_ONLY`.**  `ai_permission_profiles`-д мөргүй хэрэглэгч
  нь «тохируулаагүй» биш «зөвхөн уншина».  Roslyn нь эрхийн шатнаас ГАДУУР —
  `FULL_AGENT` ч дур мэдэн C# ажиллуулахгүй.  0273-ийн
  `CHECK (granted_by <> user_id)` нь өөртөө олгохыг хаана.
- **Санал хүсэлт нь сургалтын өгөгдөл БИШ.**  `pending → approved` ШУУД зам
  БАЙХГҮЙ; 👎 нь ЗАЛРУУЛГАГҮЙГЭЭР батлагдахгүй; `included_in_training_run` нь
  ЭЦСИЙН.  0269-ийн өгөгдмөл нь `'pending'` — 0215-ийн `assistant_examples`
  нь `'verified'`-ээс эхэлдэгтэй ЗОРИУД эсрэг (өөр эрсдэл барина).
- **§35 — динамик баримт жинд ОРОХГҮЙ.**  `ai/training/dataset_lint.py` нь
  «41 ажилтан» гэсэн мөрийг барьж сургалтыг ЗОГСООНО; «get_active_employees
  дуудна» гэсэн ЗАН ТӨЛӨВИЙН жишээ нь өнгөрнө.  Алгасах туг БАЙХГҮЙ.
- **Итгэл нь ТӨЛӨВ, ТОО БИШ** (verified/supported/uncertain/insufficient).
  `rules.verification_state = 'UNVERIFIED'` (өнөөдөр БҮГД нь) бол нормын
  хариу ХЭЗЭЭ Ч «Баталгаажсан» болохгүй — 0221-ийн зорилгын үргэлжлэл.
  Эшлэлийг сервер `resolveCitations`-оор дахин шийднэ; загварын зохиосон
  `[3]` хаягдана (`dropped_citations`-д хэмжигдэнэ).
- **Локал үйлчилгээ нь ДӨРВӨН давхаргатай**: 127.0.0.1 бинд · суулгацын нууц ·
  `Origin` цагаан жагсаалт · сессийн токен.  Зөв нууцтай ч хортой Origin-оос
  ирсэн хүсэлт 401 — тестлэгдсэн.  Репогийн эрсдэл #7
  (`revit-mcp/server/`-ийн баталгаажуулалтгүй Roslyn) -ийг ДАВТАХГҮЙ.
- **Загварын артефакт нь SHA-256-гүйгээр суулгагдахгүй**, идэвхтэй хувилбар
  дээр ДАРЖ бичихгүй (буцах хувь үлдэнэ), `license_cleared = 0` бол
  манифестад ОГТ гарахгүй (`ai/registry/LICENSES.md` нь ХААЛГА, баримт биш).
- **Загваргүйгээр ч ажиллана.**  `EchoEngine` нь өгүүлбэр зохиохгүй — олдсон
  эх сурвалж, хэрэгслийн хариуг эшлэлтэй нь дамжуулж, «загвар суулгаагүй»
  гэдгийг ил хэлнэ.  Энэ нь хуурамч endpoint БИШ: өөрийгөө зарладаг.
- **Гүйцэтгэлийн тоо нь ЗӨВХӨН `npm run ai:benchmark`-аас.**  Хэмжээгүй
  тоог баримтад бичихийг хориглоно; тэр скрипт нь echo-гийн тоог «жинхэнэ
  загварынх биш» гэж ил тэмдэглэдэг.
- **Норматив мэдлэг нь D1-д БИШ, ажилтны PC дээрх ЛОКАЛ SQLite-д** (эзний
  §11).  `ai/knowledge/schema.sql` + `ai/retrieval/src/` (12 модуль, 50 тест):
  FTS5 + бүтэцтэй дүрмийн хүснэгт + солигдох вектор индексийн интерфейс.
  Сан нь `%LOCALAPPDATA%\MglAi\knowledge\knowledge.sqlite`;
  `npm run ai:ingest:norm -- <хавтас>` шингээж, `npm run ai:eval:norm`
  ХЭМЖИНЭ; runtime нь `POST /norm` + `GET /norm/info`-оор гаргана.
  ⚠️ **Энэ нь СУРГАЛТ БИШ** — норм нь жинд ОРООГҮЙ.  Багцуудын өөрсдийнх нь
  бодлого үүнийг шаарддаг (`training_policy: retrieval_first_do_not_bake…`),
  тул шинэ норм ирэхэд дахин ШИНГЭЭНЭ, дахин сургахгүй.
  **Гурван баримт шингэсэн** (2026-09-09): БНбД 21-04-05-ын 2018 нэмэлт
  (126 хэсэг · 112 хүснэгтийн мөр), УББ 12-01-01 «Барилгын захиалагчийн
  дүрэм» (46 хэсэг · 33 үүрэг · 5 эрх · 1 хариуцлага · 4 босго), ба
  УББ-11-201-00 «Бүс нутгийн хөгжлийн төсөл боловсруулах аргачилсан заавар»
  (73 хэсэг · 71 шаардлага · 5 тоон утга, профайл `guideline_rules`).
  Хэмжигдсэн (723 QA + 23 алтан кейс): Recall@5 **94.3%** (mn-Cyrl 99.6%,
  mn-Latn **100%**, англи 83.2%), **алтан кейс 23/23**, баталгаажаагүй
  дүрмийн гоожилт **0**.  БНбД-ийн англи тааз нь ~81% — 13 дүрэм НЭГ ижил
  англи alias багц хуваалцдаг тул тэднийг ялгах мэдээлэл өгөгдөлд БАЙХГҮЙ;
  энэ нь кодын доголдол БИШ.
  **Дөрөв дэх баримт — БНбД 11-03-21 «Барилгын инженер-геологи, геотехникийн
  судалгааны ажил» (MCIS GOLD v3 SOURCED, 2026-09-10, профайл `legalinfo_rules`):**
  176 хэсэг + 31 хүснэгтийн мөр · 14 үүрэг · 6 эрх · 157 шаардлага · 9 босго.
  ⚠️ **Хэсэг БҮР дүрэмтэй** — pipeline эшлэлийг эхний ДҮРЭМТЭЙ хэсгээс авдаг;
  дүрэмгүй 152 заалт үлдээхэд эшлэл 3-р байрны өөр баримт, эсвэл ХҮЧИНГҮЙ
  нормын URL-тай төлөвийн хэсэг болж байв (хэмжсэн: 213-ын 138).
  **v3 гэрээ: «Эх сурвалж: код, заалт — URL»** — `citation.ts` одоо
  `source_url` + `source_label_mn` үүрнэ (хэсгийн `answer_source.url` →
  баримтын `authoritative_current_text_url`, байхгүй бол null, зохиохгүй);
  `ai:eval:norm`-д «Эх сурвалжийн URL» хэмжүүр **92% (196/213)**.  ⚠️ Backend
  `localNorm.ts` `source_url`-ыг УНШДАГГҮЙ — чат руу хүрэхгүй, тусдаа ажил;
  frontend гэрээ URL доторх `lawId=…` тоог «баталгаагүй тоо» гэж хасах эрсдэлтэй.
  **Тав дахь — БНбД 11-08-23 «Барилга байгууламжийн геодезийн ажил»** (GOLD v3,
  ижил профайл, ХАВТГАЙ мөр — адаптер хоёуланг ойлгоно): 460 хэсэг + 30
  хүснэгтийн мөр · 576 дүрэм · 115 тоо.  Багц өөрөө хоёр хаалт тээдэг
  (`allow_current_compliance_answer`, `usable_for_current_compliance`) — 13
  эвдэрсэн хэсэг, 5 тоо `…_render_review` төлөвтэй, цагаан жагсаалтад ОРООГҮЙ;
  тоон мөрийн ерөнхий «verified» үгийг адаптер тугтай нь хамт хэсгийн
  `verified_official_text` болгодог («verified» өөрөө хэзээ ч цагаан
  жагсаалтад орохгүй).  `range`/`set`/масштаб «1:5000» — тоо биш утга нөхцөл
  БОЛОХГҮЙ, зарласан утга.  Хэмжсэн: Recall@5 100% (508/508), URL 100%,
  алтан 11/13 (массив оролттой 2 кейс зориуд унана).
  **Зургаа дахь — УББ 12-204-01 «Даамлын үлгэрчилсэн дүрэм»** (профайл
  `flat_clause_rules` = `duty_rules` + `qualification_rules`, `legal_status_graph`-гүй):
  53 хэсэг · 50 дүрэм; 4.3 нь НИЙЛМЭЛ (тоо + 2 үнэн/худал) → `rules.ts`-д
  `kind: 'flag'` нөхцөл + `all_conditions` нэгдсэн туг (зөвхөн
  `evaluate_all_conditions…` бодлоготой дүрэмд).  Энэ багцаас дөрвөн
  хөдөлгүүрийн засвар: хамаарлын хаалга `search_text`-ийг ч тулгана (англи
  26/35 тест FTS-д 1-рт олдоод хаалганд унаж байв); «БНбД»/«УББ» угтвар
  ойлголтын alias болохгүй (багц «БНбД»-г «зураг төсөл»-ийн alias гэж өгсөн
  нь бүх БНбД асуултыг гажуудуулж байв); **`ai_aliases.doc_id` (схем 3)** —
  alias канонаар цэвэрлэгдэж хэзээ ч устдаггүй байв; `expandAliases`-ийн
  O(n²) дэд асуулга 4 003 alias дээр асуулт бүрийг 900 мс болгосныг 15 мс
  болгов.  **6 баримт нийт: Recall@5 95.4% (1477/1549), алтан 53/55, гоожилт
  0, NO_MATCH 6/8.**  Схем 3 → ажилтны сан ДАХИН БАРИГДАНА: хөгжүүлэгчийн машинд `ai:ingest:norm -- --all`
  (ажилтны PC-д ЗӨВХӨН мэдлэгийн release манифестаар — Session B хэсэг, доор).
  **Долоо дахь — СНиП II-97-76* / М-80 «ХАА үйлдвэрийн ерөнхий төлөвлөгөө»**
  (Монголд хүчинтэй Зөвлөлтийн норм; техникийн эх нь 1990 оны орос MIRROR,
  MCIS PDF-тэй тулгаагүй): 209 хэсэг + 33 хүснэгтийн мөр · 481 дүрэм.  Хэсэг
  `verification_status`-гүй → баримтын провенансаас
  `verified_mirror_text_mongolia_listed` (тусдаа мөр, цагаан жагсаалтад);
  `effective_status` = `listed_as_current` → `in_force` БИШ, хуулийн хяналтын
  туг хэвээр; тоон мөрийн id ≠ хэсгийн id → мөр бүр өөрийн дүрэм, хавсралтын
  149 мөр нэрээр хэсэгтээ; мөрийн нэр = alias.  Засварууд: `namedDocuments`
  кодын alias-аар ч таана; бүтэцтэй хөлд заалт хүснэгтээс түрүүлнэ; «1.6-ийн»
  залгавартай дугаар нь нэргүй ч заалтын хаяг (7 баримтад 12-01-01-ийн G003
  унасан).  Хэмжсэн: Recall@5 99.8%, URL 99.8%, алтан 9/14 (4.14 trigger утга
  ×2, 5.4 хөрсний ENUM-аар мөр сонгох ×2, orphan ×1).  **7 баримт нийт:
  Recall@5 96.2% (1915/1991), алтан 61/69, гоожилт 0, NO_MATCH 6/8.**
  Эх нь хуудасны зураг БИШ, legalinfo.mn-ийн одоо мөрдөж буй бичвэр — 78
  тооноос 76-г legalinfo-г ШУУД уншиж тулгав (B-3-ын траншейн гүн 2 нь
  тулгагдаагүй); тиймээс `effective_status: in_force`, эшлэл нь
  `legal_review_required: false` (өмнөх гурваас ялгаатай нь ЗӨВ).  Хэсэг бүр
  ХУРААНГУЙ (`paraphrase: true`), заалтын хуудас ЗОРИУД NULL — эшлэл заалтаар.
  Хэмжигдсэн (936 QA + 37 алтан кейс): Recall@5 **93.8%** (mn-Cyrl 98.9%,
  mn-Latn 98.4%, англи 80.9%), **алтан кейс 37/37**, гоожилт **0**,
  NO_MATCH 6/8 (өмнөхтэй ижил).  Шинэ баримт өөрөө: 92.5% / 14/14; түүний
  галиг 69% / англи 38.5% нь 13-хан тестийнх, заалтууд `text_en`-гүй.
  УББ 12-01-01 нь 96.2% → 95.5% (−1 тест, BM25-ийн корпусын үр дагавар).
  Багцын гурван шинэ хэлбэр адаптерт: `rule_id` = хэсгийн id (→ дүрмийн id
  эх хэсгээр угтварлагдана, `…:clause:3.9:numeric`), `_min`/`_max` хос →
  нэг `between`, лавлах хүснэгтийн мөр → ӨӨРИЙН хэсэг + дүрэм, утга бүр
  тоон мөртэй нэрээр тулгагдана.  Хөдөлгүүрт ГУРВАН зориудын нэмэлт:
  `rules.ts`-д `=` харьцуулагч + `sampled_percent` талбарын синоним +
  таван legalinfo баталгаажилтын мөр; `search.ts`-д `namedDocuments()` —
  **заалтын дугаар баримт хооронд давхцдаг** (1.1, 5.2, 5.3 дөрвөн баримтад
  бүгдэд бий), нэрлэсэн баримтад бүтэцтэй хөлийг хязгаарлахгүй бол
  «УББ-11-201-00-ын 5.2» гэхэд БНбД-ийн 5.2 гарч УББ-11-201-00 99.6 → 97.0%
  унасан (хэмжсэн); мөн зураасаар тасарсан залгавар («29%-аас» → «аас») FTS-д
  орж 4.8/5.6-ийн ялгуур болж байсныг хасав.  `norm-golden.mjs` нь
  `'verified_from_page_image'`-ийг ХАТУУ бичсэн хэвээр байсан («гурван
  газар»-ын нэг нь ЭНД үлдсэн байв) — одоо `isExecutableVerification`.
  ⚠️ **БАГЦ НЭМЭХ БҮРД БҮХ БАРИМТЫГ ДАХИН ХЭМЖИНЭ.**  Гурав дахь баримт
  орсноор УББ 12-01-01-ийн эшлэлийн таарц 87.8% → 94.9% болов — код БИШ,
  BM25 нь корпусаас хамаардаг тул шинэ 73 хэсэг үгсийн IDF-ийг өөрчилсөн.
  (Баталсан: шинэ КОДООР зөвхөн хуучин хоёр багцыг шингээхэд тоо нь суурьтай
  ЯГ ижил — 91.9% / 83.3% / 21-21.)
  ⚠️ **БАРИМТ БҮР ӨӨР ХЭЛБЭРТЭЙ ИРНЭ.**  Хоёр дахь багц нь `guat`/`gmdh`
  гэсэн хос БИШ, харин үүрэг/эрх/хариуцлага/босго байсан тул дүрмийн загвар
  нь `conditions: [{key, cond}]` гэсэн НЭРЛЭСЭН жагсаалт болж ерөнхийчлөгдсөн.
  Шинэ багц нэмэх нь ҮНДСЭНДЭЭ `retrieval/src/datasetProfiles.ts`-д
  **адаптер** нэмэх ажил; хэлбэрийг файлын БҮТЦЭЭР таана, манифестын нэрээр
  БИШ (`guideline_rules` нь ХОЁР файлаар танигдана —
  `general_principles.jsonl` + `implementation_rules.jsonl` —
  учир нь `numeric_requirements.jsonl` нь УББ 12-204-01-д БАС байдаг).
  ⚠️ **«`rules.ts`/`pipeline.ts` ХЭЗЭЭ Ч хөндөгдөхгүй» гэдэг нь ҮНЭН БИШ**
  (энэ файлын өмнөх хувилбар ингэж бичсэн).  Гурав дахь багц ХОЁР ойлголтын
  түвшний өөрчлөлт шаардсан ба хоёуланг адаптераар тойрох нь ХУДАЛ гаралт
  өгөх байсан:
  (1) **`requirement` гэсэн шинэ `RuleKind`** — аргачилсан зааврын 71 заалт
  нь үүрэг БИШ (1.1 нь зорилгын тунхаг, 3.1 нь бүрдлийн жагсаалт), тэднийг
  `obligation` гэвэл хоолой «Эх сурвалжид заасан **үүрэг**» гэж ХУДАЛ хэлнэ;
  (2) **баталгаажилтын хаалга ГАНЦ МӨР биш, ЖАГСААЛТ болов** — доор үз.
  Дүрэм нь хэвээр: адаптераар ТОЙРЧ БОЛОХГҮЙ, зориуд НЭМНЭ.
  ⚠️ Долоон урхи дахин олдохоос сэргийлж: **ASCII `\b` нь кирилл үсгийн
  хажууд ҮҮСДЭГГҮЙ** (`/\bм2\b/u` нь «300 м2»-ыг хэзээ ч олохгүй);
  **монголд тоо нь нэр томьёоны ӨМНӨ** («1.1 заалтад» — эсрэг дарааллыг
  барихгүй бол бүх монгол ишлэл алдагдана); **FTS5-д UNINDEXED багана
  (`chunk_id`)-аар устгах нь алдаа өгөхгүйгээр ЮУ Ч устгадаггүй** (индексийг
  бүтнээр дахин барих ёстой); **чөлөөт бичвэрээс таамагласан entity нь дүрэм
  СОНГОХОД оролцох ёсгүй** — зөвхөн үнэлэхэд (оруулахад дүрмийн таарц
  74.7% → 65.8%); **alias-ыг нийлбэрээр биш ХАМРАЛТААР жинлэнэ** (англи
  Recall 25% → 68%); **нэг заалтад ОЛОН дүрэм ноогдож болно** (`LIMIT 1` нь
  алтан кейсийн 6-г унагасан); мөн **хугацааны нэгж СОЛИГДОХГҮЙ** — «50 хоног»
  нь «2 сар»-д багтах эсэх нь хуанлийн асуулт тул хөдөлгүүр `null` буцаана.
  ⚠️ Гурав дахь багцаас гарсан ХОЁР ШИНЭ урхи, хоёулаа **хэмжүүр НОГООН
  байхад** нуугдаж байсан:
  **(1) баталгаажилтын хаалга нь ГАНЦ МӨРТЭЙ тулгадаг байв.**  УББ-11-201-00-ын
  эх PDF нь зураг зөвхөн тул багц нь бүх 76 мөрөндөө
  `verified_from_rendered_page_image_with_ocr_normalization` гэж бичсэн
  (=«рендерлээд, OCR-дээд, хуудасны ЗУРАГТАЙ ТУЛГАЖ шалгасан»).  Тулгалгүй
  бол 71 заалт бүгд «хүний хяналт хүлээж байна» болох ба ГООЖИЛТ 0 хэвээр
  үлдэнэ — учир нь энэ баримтад `verified` төлөв огт үүсэхгүй (76 дүрэм
  бүгд тоон нөхцөлгүй).  Одоо `rules.ts`-ийн `EXECUTABLE_VERIFICATION`
  гэсэн нэрлэсэн цагаан жагсаалт; мөрийг ДАХИН БИЧДЭГГҮЙ (провенанс хэвээр),
  `needs_human_review` ХЭЗЭЭ Ч орохгүй, ба `/norm/info`-ийн тоолуур мөн
  ТҮҮНЭЭС уншина (`executableVerificationSql()`) — өмнө нь тэр мөр ГУРВАН
  газар давхардаж бичигдсэн байв.
  **(2) нэг заалтын ХОЁР ТООГ асуултаар ялгах шаардлагатай.**  3.8-р заалт нь
  график зургийн эх **2 хувь**, тайлбар бичиг **4 хувь** хоёуланг агуулна;
  ангилал тэнцүү тул цагаан толгойн эрэмбэ («explanatory» < «graphic») нь
  «график хувь хэд вэ?» гэсэн асуултад **«4 хувь»** гэж тодотгож байв.
  Эшлэл, хуудас, нотолгоо бүгд ЗӨВ байсан тул алтан тест үүнийг БАРЬДАГГҮЙ.
  Одоо `loadRuleForChunk` нь ангилал тэнцүү үед асуулттай **хамралтаар**
  (ХУВИАР, тоогоор БИШ — тоогоор бодвол бүтэн заалт үргэлж ялна) эрэмбэлнэ;
  `retrieval/test/pipeline.test.ts` барина.
  Вектор хөл нь ӨНӨӨДӨР унтарсан (`NullVectorIndex` — `node:sqlite`-д `vec0`
  байхгүй); тайлан бүр үүнийг ил бичдэг.  Дэлгэрэнгүй: `ai/knowledge/README.md`.
  **Найм, ес, арав дахь — БНбД 31-23-12 · 31-24-22 · 31-25-22 (олон нийтийн
  барилга: захиргаа, цэцэрлэг, сургууль; MCIS GOLD v3, 2026-09-11):** 120+43 ·
  213+45 · 87 хэсэг; 353 · 464 · 136 дүрэм.  Гурван шинэ ойлголт, гурвуулаа
  `datasetProfiles.ts`-ээс ГАДУУР хүрсэн (адаптераар тойрох нь худал гаралт):
  (1) **хавсралтын үсэг нь ХАЯГ** — `extractDocRef.appendix` + бүтэцтэй хөл
  (`search.ts`); FTS нэг үсэгтэй «В» токеныг ялгадаггүй.  ⚠️ Хаяг БҮТНЭЭРЭЭ
  таарна: 11-03-21-д «Хавсралт B-10» бий, `LIKE 'Хавсралт B%'` нь B-1…B-5-аар
  B-10-ыг шахаж 5 тест унагасан (хэмжсэн) — JS дээр шүүнэ.  (2) **`isCitable`
  мөрийн дугаар ба шошгон дахь «хавсралт/хүснэгт» үгийг хаяг гэж үзнэ** —
  Хавсралт Д-гийн 36 талбайн норм заалт/хуудас/тоон хүснэгтгүй; `norm-golden.mjs`
  тэр ганц функцийг дууддаг болов.  (3) **`amended_rules` — 6 дахь профайл**
  (`canonical_rules` + `section_index`): `:clause:`-гүй id, `direct_answer`
  хаалт (45 бүлгийн гарчиг → `needs_human_review`, «эхийг шалга»), **2024 оны
  №36 тушаалын өөрчлөлт** эшлэлийн шошгонд детерминист («БНбД 31-25-22, 2024
  өөрчлөлт: тушаал №36 (2024-02-16), заалт 5.1.6»), хуучин «7 балл» хайлтад
  орохгүй.  Мөн: 31-23-12 `code`-гүй (`current_code` + хуучин `31-04-12` alias);
  `APP-D`/`APP-V` тоон мөр → кирилл хавсралт (`APPENDIX_LATIN_TO_CYRILLIC`,
  `normalize.ts`, ганц хүснэгт); тоон бус хүснэгтийн id + баганын гарчиг зип;
  `>= [100, 50]` муж БИШ; `keyword_alias_index`-ийн өгүүлбэр alias хасагдав.
  Хэмжсэн: шинэ 3 нь Recall@5 **100%** (802/802), URL 100%, алтан 33/39
  (унасан 6 нь ангиллын оролтоор мөр сонгох — `hazard_class`/`age_group`/`room` —
  хөдөлгүүрт байхгүй ойлголт, СНиП 5.4-тэй ижил).  **10 баримт нийт: Recall@5
  97.3% (2717/2793), алтан 94/108, гоожилт 0, NO_MATCH 6/8**; хуучин 7-ын
  1915/1991 · 61/69 ЯГ хэвээр.  Ажилтны сан 10 хавтсыг НЭРЛЭН дахин барив
  (`--all` БИШ — доорх 11-106-25 хагас орно).  Гурван баримтын төлөв `in_force`
  БИШ (legalinfo-г шууд уншиж тулгаагүй) → хуулийн хяналтын туг хэвээр.
  ~~⚠️ `data-train-files/` дотор ГУРВАН багц хараахан ШИНГЭЭГҮЙ~~ — **2026-09-21-нд
  шийдэгдсэн:** БД 21-101-12 нь `fire_hazard_rules` профайлаар аль хэдийн байсан; **БНбД
  11-106-25** (тоон мөр `locator` биш `clause` → `legalinfoNumericRows` нөөц, 145 → 40 эх
  хэсэггүй) ба **БНбД 11-03-02** (8 дахь профайл `procedure_rules`) ажилтны санд орсон —
  доорх «БНбД 20-04-17» хэсэг.  ⚠️ `/norm`-ийн `decisions`/`inputs_used`-ыг
  `backend/src/lib/mglai/localNorm.ts` УНШДАГГҮЙ — БНбД 11-03-21-ийн «8 м <
  10 м» гэсэн детерминист дүгнэлт чат руу хүрэхгүй, зөвхөн `rule_object_mn`
  («…10 м-ээс багагүй») + нотолгоо очно.  Тусдаа өөрчлөлт.
### MGL AI — ТӨГСГӨЛГҮЙ ДАВТАЛТ (2026-09-09)

«AI нэг хоёр үгийг зогсолтгүй давтдаг» гэсэн гомдол.  ХЭМЖИГДСЭН шалтгаан нь
**загварын түүвэрлэлтийн буруу тохиргоо**, өгөгдөл, сургалт, урсгал БИШ.

**Нотолгоо** (Qwen3-8B-Q4_K_M, llama.cpp b10850, шууд хөдөлгүүр рүү, 24 гүйлт/багц):

| тохиргоо | давталтын хувь |
|---|---|
| ХУУЧИН: `temperature 0.3`, `top_p 0.9`, бусад нь llama.cpp-ийн өгөгдмөл | **3/24 (13%)** |
| Qwen3 албан ёсны, торгуульгүй (`0.7 / 0.8 / top_k 20 / min_p 0`) | 2/24 (8%) |
| + `presence_penalty` (0.5 / 1.0 / 1.5 — гурвуулаа) | **0/24 (0%)** |

Жишээ гажиг: «үндэслэл, төлөвлөгөөний» гэсэн ХОЁР ҮГ 42 удаа давтагдаж
`max_tokens` дуустал үргэлжилсэн.

- **⚠️ ХУУЧИН ТОХИРГОО ЯГ QWEN3-ИЙН САНУУЛГЫН ЭСРЭГ БАЙВ.**  Загварын карт нь
  «DO NOT use greedy decoding, as it can lead to … endless repetitions» гэж
  бичдэг; `temperature 0.3` нь тэр рүү хальтирсан утга.  Мөн `top_k`, `min_p`,
  `presence_penalty` нь `GenerateRequest`-д ТАЛБАР Ч БАЙХГҮЙ байсан тул
  llama.cpp-ийн өгөгдмөл (40 / 0.05 / 0) чимээгүй хүчинтэй байв.
- **⚠️ ХОЁР ГАЗАР ХАТУУ БИЧИГДСЭН БАЙСАН.**  `LlamaCppEngine`-ийг зассан ч
  `server.ts`-ийн `body.temperature ?? 0.3` нь ЗАСВАРЫГ ЧИМЭЭГҮЙ ДАРНА —
  клиент temperature хэзээ ч илгээдэггүй.  Одоо хоёулаа `undefined` дамжуулж,
  `engine/samplingPreset.ts` шийднэ.  `generateGuard.test.ts` нь эх кодыг
  grep-дэж хатуу утга буцаж ирэхийг барина.
- **⚠️ `presence_penalty` НЬ 1.5 БИШ, 1.0.**  Албан ёсны заавар нь өндөр утга
  «language mixing» үүсгэж болзошгүй гэж сануулдаг ба энэ програм МОНГОЛООР
  хариулах ёстой.  Хэмжсэн: 0.5/1.0/1.5 гурвуулаа 0/24 давталт, 0/18 хэл
  холилдолт — тиймээс хамгийн бага хангалттай утгыг сонгов.
- **⚠️ ДАВТАЛТЫН ТОРГУУЛЬ НЬ ҮНДСЭН ЗАСВАР БИШ.**  `repeat_penalty`,
  n-gram хориг зэрэг нь «БНбД», «заалт», хүснэгтийн шошго, томьёог эвддэг.
  Хийсэн зүйл нь загварын АЛБАН ЁСНЫ суурь тохиргоог СЭРГЭЭХ.
- **Хамгаалалт нь RUNTIME дээр, хөтөч дээр БИШ** (`ai/runtime/src/repetition.ts`).
  Зөвхөн тэнд `controller.abort()` нь llama-server-ийн урсгалыг ҮНЭХЭЭР таслаж
  GPU-г суллана; хөтөч дээр илрүүлэх нь зөвхөн НУУНА, загвар үргэлжилсээр
  байна (§7-ийн «Do not merely hide repeated output»).  Хөтөч нь
  `stop_reason: 'repetition'` ТУГИЙГ Л уншина — алгоритм НЭГ хэрэгжүүлэлттэй.
- **⚠️ ЗӨВХӨН ЗЭРЭГЦЭЭ МӨЧЛӨГ БАРИНА.**  Тархай давтагдсан нэр томьёо
  ХЭЗЭЭ Ч баригдахгүй; зөвхөн цэг таслалаас бүрдсэн мөчлөг (markdown
  хүснэгтийн `| --- |`) хаягдана.  Богино мөчлөгт (1-2 үг) 6 давталт,
  урт мөчлөгт 3 шаардана — монгол чангатгал («маш маш их») баригдахгүй.
  21 тест, тэдгээрийн ТАЛ нь ХУДАЛ ЭЕРЭГИЙН тест.
- **⚠️ `finish()` ДУУДАХАА БҮҮ МАРТ.**  Урсгалын хамгаалагч 48 тэмдэгт тутамд Л
  шалгадаг тул сүүлийн хэсэгт босго давсан давталт МӨЛХӨЖ ГАРНА — 24 амьд
  гүйлтийн 1 нь яг ингэж `stop_reason: 'length'` гэж мэдээлэгдэж, програм
  түүнийг ЗӨВ хариулт гэж хадгалах байв.
- **Давталттай хариулт нь ХАДГАЛАГДАХГҮЙ** (`orchestrator.ts`-ийн `savable`).
  Хадгалбал: яриа сэргээхэд буцаж гарна, ДАРААГИЙН ээлжийн `history`-д орж
  загварыг дахин давталт руу түлхэнэ, санал хүсэлтэд «зөв» мэт харагдана.
- **Автомат дахилт нь ЯГ НЭГ УДАА**, гогцоогоор (рекурсээр БИШ — React
  Compiler-ийн `immutability` дүрэм).  Дахилт нь `cacheRef`-ийн
  ХАДГАЛАГДСАН `context.turns`-ыг ашиглана — эвдэрсэн текст prompt-д ОРОХГҮЙ,
  хуучин хариулт дээр НЭМЭГДЭХГҮЙ.
- **ПРОГРАМ ТАЛЫН ХОЁР ДАХЬ ЭХ ҮҮСВЭР (зассан):** хэлний засварын зам нь
  `result.answer`-ыг цэвэрлэдэг байсан ч REDUCER-ийн `run.answer`-ыг
  цэвэрлэдэггүй байв — засварын токенууд ХУУЧИН хариултын ард наалдаж,
  хэрэглэгч ижил агуулгыг ХОЁР УДАА хардаг.  Одоо `answer.reset` үйл явдал.
- **Давхардсан нотолгоо нь загварыг давталт руу түлхдэг** — `budgetEvidence`
  одоо id БА хэвийжүүлсэн ТЕКСТЭЭР давхардлыг хасна (локал болон D1 хөл ижил
  заалтыг ӨӨР id-тайгаар буцаадаг тул id-гаар шүүх нь хангалтгүй).
- **Контекстын төсөв**: prompt + max_tokens нь 8K цонхонд багтахгүй бол одоо
  `413 context_overflow` гэж ИЛ хэлнэ (өмнө нь llama-server-ийн түүхий 400).
  Prompt-ыг ХЭЗЭЭ Ч таслахгүй — асуулт эсвэл заалт алдагдана.
- **Хатуу хугацааны хязгаар**: `MGLAI_GENERATE_TIMEOUT_MS` (өгөгдмөл 5 мин),
  `stop_reason: 'timeout'`.  `max_tokens` ганцаараа хангалтгүй — токен/сек
  унавал 900 токен хэдэн минут үргэлжилнэ.
- Шалгалт: `cd ai && node --test runtime/test/repetition.test.ts` (21) ·
  `runtime/test/generateGuard.test.ts` (7) · `cd frontend && npm run check:ai-stream` (40) ·
  `cd backend && node --test src/lib/mglai/visibility.test.ts` (21).

### MGL AI — гүйцэтгэлийн урсгал ба UI (2026-09-09)

Чат нь «Илгээх» дарснаас хойш **~20 секунд юу ч харуулахгүй, дараа нь улаанаар
«Сервер 20 секундэд хариу өгсөнгүй»** гэж унадаг байв.  Гурван тусдаа гажиг байсан:

1. **`MglAiPage.tsx` нь `/mgl-ai/context`-д `timeoutMs: 20_000` дамжуулдаг байсан.**
   `apiFetch` нь POST-ыг ДАВТДАГГҮЙ тул тэр нь шууд `ApiNetworkError` болж,
   `shared/api/client.ts`-ийн `` `Сервер ${timeout/1000} секундэд хариу өгсөнгүй` ``
   гэсэн мөрийг төрүүлдэг байв.  Хэмжсэн: `/context` нь дулаан үедээ **17-32 мс**.
   Өөрөөр хэлбэл тэр таймер нь зөвхөн worker-ийн ХҮЙТЭН ЭХЛЭЛТИЙГ (баримтжуулсан
   9-20 сек) — өөрөөр хэлбэл цорын ганц хууль ёсны удаан тохиолдлыг — алддаг байв.
2. **Ганц глобал таймер нь НИЙЛМЭЛ ажлыг бүрхэж байсан**: 2 D1 бичилт + N
   ДАРААЛСАН хэрэгсэл + хайлт + prompt угсралт бүгд нэг 20 сек дотор.
3. **`send()`-ийн ганц `catch` нь БҮГДИЙГ `text-rose-600` болгодог байв** — удаашрал,
   цуцлалт, «нотолгоо олдсонгүй» хүртэл улаан алдаа мэт харагдана.

**⚠️ Ганц глобал таймер БҮҮ БУЦААЖ НЭМ.**  Одоо `lib/aiBudget.ts` нь үе шат тус
бүрд `{slowMs, hardMs}` өгдөг: `slowMs` нь ТӨВИЙГ САХИСАН мөр гаргана, ажил
ҮРГЭЛЖИЛНЭ; `hardMs` нь зөвхөн аюулгүйн хана.  Үүсгэлтийн `hardMs` нь
`Infinity` — урт хариулт хууль ёсоор минут үргэлжилж болох ба амьд эсэхийг
ЦОХИЛТ хэлнэ.

**Шинэ урсгал** (зохион байгуулагч нь `packages/mglai-common/src/turn/engine.ts` — 2026-09-14 Session R R3-аас хойш хөтөч · runtime `/turn` · Revit гурвуулаа энэ НЭГ хөдөлгүүрийг хэрэглэнэ; хөтчийн `lib/orchestrator.ts` устсан, `lib/browserTurn.ts` adapter л үлдсэн; `docs/mgl-ai/REVIT_INTELLIGENCE.md` §R3):

```
send() → t=0 ACK (ямар ч await-аас ӨМНӨ)
 1 POST /api/mgl-ai/plan            ~5-20 мс: хэл, санаа, regulatory, хэрэгслийн төлөвлөгөө
 2 ‖ N × POST /tool  ‖  локал POST /norm  ‖  яриа хадгалах (fire-and-forget)
 3 POST /api/mgl-ai/context         угсралтын ЦОРЫН ГАНЦ газар хэвээр
 4 POST 127.0.0.1:39217/generate    SSE токен + ЦОХИЛТ
 5 POST /api/mgl-ai/messages        эшлэл СЕРВЕР дээр дахин шийдэгдэнэ
```

Хэмжсэн (2026-09-09, локал): **үүсгэлт эхлэх хүртэл 38-101 мс** (өмнө нь ганц
`/context` дуудлагын ард бүх зүйл нуугдаж байсан), эхний токен 78-930 мс.

- **`POST /api/mgl-ai/plan` нь ШИНЭ бөгөөд ХАЙЛТ ХИЙХГҮЙ.**  Оршин байх шалтгаан
  нь хоёр: (а) `/context` дуустал UI-д харуулах БОДИТ алхам байдаггүй байсан,
  (б) локал нормыг дуудах эсэхийг СЕРВЕР шийдэх ёстой (§35).  Түлхүүр үгийн
  дүрмийг клиент дээр давхардуулах нь хосын зөрүү үүсгэнэ — тиймээс
  `runObviousTools` нь `backend/src/lib/mglai/toolPlan.ts` болж НҮҮСЭН (9 тест).
- **⚠️ ХАМГИЙН ЧУХАЛ: `/context` нь нормын нотолгоог D1-ээс ОЛДОГГҮЙ БАЙСАН.**
  `ai_knowledge_chunks` нь БҮХ орчинд **0 мөртэй** (хэмжсэн), харин 172 хэсэг,
  155 дүрэм нь ажилтны PC дээрх локал SQLite-д амьдардаг.  Cloudflare Worker нь
  127.0.0.1 руу хүрч ЧАДАХГҮЙ тул чат нь §17-ийн асуултад timeout-аас ҮЛ
  ХАМААРАН «эх сурвалж олдсонгүй» гэж хариулдаг байв.  Одоо хөтөч локал
  `POST /norm`-ыг дуудаж, үр дүнг `/context`-д `norm_answer` талбараар өгнө;
  сервер `lib/mglai/localNorm.ts`-ээр ариутгаж, нотолгоо болгож УГСАРНА.
  Клиент нь ТЭЭВЭР, сервер нь ШИЙДВЭР — `tool_results`-ийн яг тэр загвар.
- **⚠️ Локал заалт нь «ШИЙДВЭРИЙН БЛОК» РУУ ОРОХГҮЙ.**  `promptFrame.ts`-ийн
  `hasNormDecision` салаа нь g-утгын АНГИЛЛЫН загварыг («1) Ангилал 2) Муж
  3) Нэмэлт шалгалт») хатуу тулгадаг.  Тэр нь `decideVSubcategory`-д зөв, гэвч
  үүргийн заалтад утгагүй — хэмжсэн байдлаар «Ангилал: Нормын шийдвэр, Муж: …»
  гэсэн гажсан хариу гаргаж байв.  Локал заалт нь ЖИРИЙН НОТОЛГОО болж орно.
- **⚠️ D1-ийн босгын шийдвэр гарвал локал заалтыг ОГТ оруулахгүй** (`useLocalNorm`).
  Локал хайлт нь RRF-ийн зэрэглэлээр оноо өгдөг тул ХАМААРАЛГҮЙ асуултад ч ҮРГЭЛЖ
  дээд 5 заалтаа `supported` төлөвтэй буцаана (оноо 0.0164/0.0161/… — хамаарлыг
  ЯЛГАДАГГҮЙ).  «g=1800 → В2» гэсэн галын асуултад «УББ 12-01-01 заалт 1.8» гэсэн
  огт хамаарахгүй заалт орж ирдэг байв.
- **Гүйцэтгэлийн үйл явдал нь ХӨТӨЧ дээр үүснэ** (`lib/aiEvents.ts` протокол,
  `lib/aiMachine.ts` цэвэр reducer).  Worker дээр SSE нэмэх нь ЗӨВХӨН Worker-ийн
  өөрийн алхмыг харуулах бөгөөд локал загварын урсгалыг ХЭЗЭЭ Ч харж чадахгүй —
  илүү нарийн атлаа ДУТУУ шийдэл.  Хоёр серверт хүрдэг цорын ганц тал нь хөтөч.
- **⚠️ ГҮЙЦЭТГЭЛИЙН МӨШГӨЛТ ≠ ЗАГВАРЫН СЭТГЭЛГЭЭ.**  Самбарт харагдах мөр бүр
  нь БОДИТ дуудлагатай нэг-нэгээр таарна; шошгыг БИД бичнэ, загвар БИШ.
  `check-ai-stream.mjs` нь шошго дотор «бодож байна / reasoning / thought» гэсэн
  үг байхыг ХОРИГЛОДОГ тест агуулна.
- **Курсор (▌) нь `generationStarted` дээр Л асна**, `streaming` дээр БИШ.  Өмнө
  нь хайлт, ERP, prompt угсралтын бүх хугацаанд «бичиж байна» гэж ХУДЛАА
  хэлдэг байв.
- **Алдаа бүр улаан БИШ** (`lib/aiErrors.ts`): `error` (жинхэнэ гэмтэл) /
  `notice` (нотолгоо алга, цуцлалт, хугацаа) / `offline` (локал runtime).
  `RETRIEVAL_NO_MATCH` ба `RETRIEVAL_TIMEOUT` нь ЗААВАЛ өөр — «санд байхгүй» ба
  «хайлт амжсангүй»-г нэгтгэвэл ажилтан буруу дүгнэлт хийнэ.
- **⚠️ Хатуу хязгаар ба цуцлалтыг ЯЛГАНА** (`StageTimeoutError`).  Хоёулаа
  `AbortSignal`-аар хэрэгждэг тул тэмдэглэхгүй бол хэрэглэгч юу ч дараагүй
  атлаа «Зогсоолоо» гэсэн мессеж авна.
- Локал runtime-ийн `/generate` нь эхний токен гартал **2 секунд тутам
  `heartbeat`** илгээнэ, токен гармагц ЗОГСОНО (`ai/runtime/test/heartbeat.test.ts`,
  4 тест).  UI нь «өгөгдөл алга атлаа цохилт ирж байна» (ажиллаж байна) ба
  «цохилт ирэхээ болив» (RECONNECTING) хоёрыг ЯЛГАНА — сүүлийнх нь мессежийг
  УСТГАХГҮЙ.
- Шалгалт: `cd frontend && npm run check:ai-stream` (32 хувилбар, `verify`-д ч бий) ·
  `cd backend && node --test src/lib/mglai/toolPlan.test.ts` ·
  `cd ai && node --test runtime/test/heartbeat.test.ts`.

- Файлууд: `backend/src/lib/mglai/` (12 модуль — `toolPlan.ts`, `localNorm.ts` нэмэгдсэн) ·
  `backend/src/routes/mglAi.ts` (`/plan` нэмэгдсэн) ·
  `frontend/src/features/mgl-ai/` (`lib/{aiEvents,aiMachine,aiErrors,aiBudget,orchestrator}.ts`,
  `components/MglAiActivity.tsx`) ·
  `ai/` (runtime + retrieval 102 тест, training, registry) ·
  `ai/knowledge/`, `ai/retrieval/`, `ai/evaluation/norm-golden.mjs` ·
  `docs/mgl-ai/{ARCHITECTURE,OPERATIONS}.md`.
- ✅ **DEPLOY ХИЙГДСЭН.**  (Энэ мөр 2026-09-09 хүртэл «хараахан
  хийгээгүй» гэж бичигдсэн байсан нь ХОЦРОГДСОН.)  Шалгасан 2026-09-09:
  `/api/mgl-ai/health` ба `/api/mgl-ai/plan` нь прод дээр **401** буцаана
  (404 БИШ) — өөрөөр хэлбэл маршрут амьд, зөвхөн нэвтрэлт шаардаж байна.
  Дараалал нь ХЭВЭЭР: миграц ЭХЛЭЭД, дараа нь worker, эцэст нь Pages.
- ⚠️ **ЛОКАЛ RUNTIME НЬ WRANGLER-ЭЭР DEPLOY ХИЙГДДЭГГҮЙ.**  `ai/` доторх
  код (давталтын хамгаалалт, түүвэрлэлтийн preset) нь АЖИЛТНЫ PC дээр
  ажилладаг тул worker/Pages deploy нь түүнийг ШИНЭЧЛЭХГҮЙ.  **(Хуучирсан
  2026-09-09 тэмдэглэл: «ажилтан бүр `git pull` + `npm run ai:restart`» — энэ нь
  ХӨГЖҮҮЛЭГЧИЙН машинд л хүчинтэй.)**  2026-09-11-ээс runtime код нь
  Session B-ийн release манифестын `runtime-code`/`app` бүрэлдэхүүнээр
  түгээгдэнэ: stage → SHA → `app\versions\<v>\` заагч → `/shutdown` →
  супервайзер шинэ хувилбараар асаана → health → smoke → lastKnownGood,
  унавал буцаалт (`docs/mgl-ai/DEPLOYMENT.md` §8 P0-1).  Ажилтанд Git,
  Node, гар ingest, гар restart ХЭРЭГГҮЙ; `/runtime/manifest` нь ЗАГВАРЫН
  артефактад, release манифест нь кодод.
- **«Вэб нээхэд AI бэлэн байх» (2026-09-11).**  Хэмжсэн шалтгаан: dev PC дээр
  `MGL AI runtime` даалгавар огт БҮРТГЭГДЭЭГҮЙ (хэн ч `ai:autostart`
  ажиллуулаагүй), мөн хуучин даалгавар нь node-ыг нэвтрэхэд НЭГ удаа асаагаад
  унавал сэргээдэггүй байв — тиймээс өдөр бүр терминалаас `ai:start`.  Одоо
  гурван давхар: (1) `scripts/start.ps1 -Supervise` — Task Scheduler-ийн
  даалгавар нь мөчлөг: node-ыг асааж, гарахыг нь ХҮЛЭЭЖ, унавал 5→60 с
  ухралттай дахин асаана (хэмжсэн: kill → 14 с-д сэргэсэн); (2) даалгаврын
  `RestartCount 10 / 1 мин` — супервайзер өөрөө унахад; (3) 10 минут тутмын
  хяналтын триггер (`-Once` + `RepetitionInterval`, ⚠️ `-RepetitionDuration
  [TimeSpan]::MaxValue` нь Windows 11 26200 дээр «out of range» — ОРХИНО)
  + `MultipleInstances IgnoreNew`.  ⚠️ **2026-10-13-аас `ai:stop` даалгаврыг Disable ХИЙХГҮЙ** —
  `%LOCALAPPDATA%\MglAi\runtime.paused` тэмдэг бичнэ, супервайзер түүнийг харвал node асаахгүй гарна;
  тэмдэг дараагийн Windows нэвтрэлтэд (сессийн explorer тэмдгээс хойш эхэлсэн), 12 цагийн дараа эсвэл
  `ai:start`-аар арилна.  Шалтгаан (хэмжсэн): 09-28-нд сургалтад GPU чөлөөлөх `ai:stop`-ийн дараа даалгавар
  Disabled хэвээр үлдэж runtime 15 хоног асаагүй, вэб «локал үйлчилгээ ажиллахгүй» гэж харуулсаар байв.
  Сургалтыг `training.lock` хамгаалдаг тул эрт сэргэсэн runtime GPU булаахгүй.  `ai:start` хуучин Disabled
  даалгаврыг `Enable` хийсээр.
  Runtime-д `unhandledRejection` → лог + үргэлжлүүл, `uncaughtException` →
  лог + exit(1) (супервайзер сэргээнэ) — өмнө нь хойд дэвсгэрийн нэг унасан
  fetch бүх процессыг чимээгүй авч унагадаг байв.  Суулгагчийн
  `bootstrap.ps1` ижил тохиргоотой, `Start-ScheduledTask`-аар асаадаг болов.
  Frontend: `shared/hooks/useMglAiPrewarm.ts` нь `LayoutShell`-д — сүүлийн
  14 хоногт AI хэрэглэсэн хөтөч дээр (`lib/usage.ts`, `mglai.last_used`)
  ERP нээгдмэгц `probe → pair → warmup`, таб 15 мин далд байснаас буцахад
  дахин; бусдад localStorage-ийн нэг уншилт л (VRAM-ийн шийдвэр ХЭВЭЭР).
  `MglAiPage` нь READY/BUSY/ERROR болтол 4 с тутам `probe()` давтдаг болов —
  өмнө нь «суугаагүй» мөр «Дахин оролдох» дартал хөлддөг байв.

### MGL AI — Company Data Gateway ба олон шатлалт судалгаа (2026-09-10)

«company huudas yu aguuldg ve», «хамгийн идэвхтэй ажилтан хэн бэ», «энэ төсөл яагаад
удаад байна» гэсэн асуултад загвар САНАХУЙГААС хариулдаг байсны ХЭМЖИГДСЭН шалтгаан нь
intent-ийн хаалт БИШ — тэр асуултын ангид ХЭРЭГСЭЛ ОГТ БАЙГААГҮЙ (ажилтны ТОО л байсан
тул «senior хамгийн идэвхтэй» гэж 12 гэсэн тооноос зохиосон).  Дэлгэрэнгүй:
`docs/mgl-ai/ARCHITECTURE.md` §15.

- **`lib/mglai/gateway/entities.ts` — entity каталог, ЦАГААН ЖАГСААЛТ.**  Нууц багана
  (`password_hash`, `email`, төхөөрөмж, IP) энд огт байхгүй; мөрийн хамрах хүрээ нь entity-ийн
  ӨӨРИЙН `FROM`-д (төсөл = `PROJECT_LIST_SQL` дэд асуулга, арван хоёр дахь хуулбар БИШ).
  ⚠️ **Bind дараалал = текстийн дараалал**: `julianday(?)` нь SELECT жагсаалтад учир дэд
  асуулгын `?`-уудаас ӨМНӨ — буруу дараалалд `days_remaining = 2 461 220` гарч байсан.
- **`gateway/query.ts` — Query DSL.**  Загвар SQL бичихгүй хэвээр; гаднаас зөвхөн
  `{entity, fields, filters, sort, limit, group_by, aggregate}`, бүх нэр каталогоор,
  бүх утга bind-ээр, ≤100 мөр.  `query.test.ts` нь SQL-д хэрэглэгчийн мөр орохгүйг барина.
- **`researchPlan.ts` — олон шатлалт planner.**  `/plan` нь `round` + `prior_results` авна;
  ≤3 шат, ≤`max_tool_iterations` хэрэгсэл.  Хөтөч (`orchestrator.ts` → `runResearch`) ЗӨВХӨН
  гогцоо ажиллуулна — «deadline-ийн эхний төслийг шинжил» гэсэн шийдвэр серверт.
  ⚠️ ASCII `` кириллд ажилладаггүй (энэ файлд дахин олдсон) — анафорыг зайгаар хүрээлнэ;
  «төслүүд» нь «төсөл» агуулдаггүй — язгуураар (`төсл`) таарна.
- **`systemCatalog.generated.ts` — ГАРААР ЗАСАХГҮЙ.**  `npm run gen:system-catalog` (backend/)
  нь frontend-ийн `NAV_ITEMS` + `APP_SECTIONS` + i18n-ээс үүсгэнэ; `systemCatalog.test.ts`
  нь `--check`-ээр хуучирсныг барина.  Цэс өөрчилбөл дахин үүсгэ.
- **Хоёр шинэ гэрээний трейлер** (`answerContract.ts` ↔ frontend `contract.ts`):
  `norm_legal_review` (локал нормын `legal_review_required` — 1998 оны байгууллагыг одоогийн
  эрх мэт хэлэхгүй; `parseLocalNorm` тэр тугийг ХАЯДАГ байсан) ба `analysis_metric`
  (`official_kpi:false` → хэмжүүрийн тодорхойлолт заавал).  Загвар зааврыг үл хайхардаг нь
  хэмжигдсэн тул детерминист.
- **Хэмжүүр**: `cd ai && npm run ai:eval:company` — бодит гинж (локал backend + runtime),
  10 хүлээн авалтын асуулт, тоо бүр хэрэгслийн үр дүнд байгаа эсэхийг шалгана.
- ⚠️ Продын `tasks`-ийн 4 345 мөрөөс ердөө 2 нь `due_date`-тэй — «хоцорсон» гэдэг нь
  өгөгдлөөр ядуу; `analyze_project` нь зогссон/эзэнгүй/батлагдаагүй дохиог ашиглана.

### MGL AI — ярианы кернел, хариултын гэрээ, хэрэгслийн чиглүүлэлт, локал санамж (2026-09-10)

Бодит Qwen3-8B E2E (`cd ai && npm run ai:eval:conv -- --gen`) дээр хэмжигдсэн дөрвөн
гажгийн засвар.  Файлууд: `backend/src/lib/mglai/{convState,turn,turnPlan,contextBuilder,
answerContract,memoryHints}.ts` (+ тестүүд, нийт 340), `frontend/src/features/mgl-ai/lib/
{contract,memory}.ts`, `components/MemoryPanel.tsx`, `frontend/scripts/check-ai-{contract,memory}.mjs`
(`verify`-д орсон), `ai/evaluation/conversation-e2e.mjs`, `ai/training/build_behavior_sft.mjs`.

- **⚠️ ЯРИАНЫ ТҮҮХ ≠ PROMPT-ЫН КОНТЕКСТ.**  Өмнө нь сүүлийн 10 мессеж БҮТНЭЭРЭЭ prompt-д ордог
  байсан — «Төсөл A-ийн deadline?» → «В2 галын ачаалал?» гэхэд төсөл A нормын хариултад
  ХОЛИЛДОНО, мөн 900 токены өмнөх хариулт давталтыг татна.  Одоо `turn.ts` ээлж бүрийг
  LLM-ГҮЙ ангилна: NEW_TOPIC / CONTINUATION / FOLLOW_UP / REFERENCE_TO_PRIOR_RESULT /
  CORRECTION / CLARIFICATION / MULTI_INTENT (латин + кирилл тэмдэг үг, салбарын зөрүү, төлөв).
  `contextBuilder.selectHistory` нь төрлөөр хэдийг, хэр урт (өгүүлбэрийн хил дээр тайрсан)
  оруулахыг шийднэ — NEW_TOPIC/MULTI_INTENT-д ОГТ оруулахгүй.  Эргэлзээтэй үед NEW_TOPIC
  (гоожилт нь дутуу үргэлжлэлээс дор).
- **Ярианы бүтэцтэй төлөв `convState.ts`** (subject: төсөл id+нэр | норм | ажилтан, lastIntent,
  lastTools, projectsSeen) нь `tool_results`-ийн ИЖИЛ загвараар КЛИЕНТЭЭР дамжина:
  `/context` → `conv_state_next` → хөтөч ХӨНДӨЛГҮЙ → дараагийн `/plan` + `/context`.
  Сервер `parseConvState`-ээр ариутгана; төлөв нь prompt-ын чиглүүлэг, ЭРХ БИШ (хэрэгсэл
  `/tool`-ийн `decideTool`-оор дахин хаагдана).  Сэдэв 6 ээлжид хуучирна (`SUBJECT_TTL_TURNS`).
  Сэдэв нь хэрэгслийн БОДИТ үр дүнгээс тогтоно («хамгийн ойр deadline» → эхний төсөл),
  загварын текстээс биш; жагсаалт асуусан бол сэдэв тогтоохгүй.  Яриа солиход
  `convStateRef` ЗААВАЛ цэвэрлэгдэнэ.
- **⚠️ `/plan` ба `/context` нь ИЖИЛ `turnPlan.planTurn`-ыг дуудна** — хосын зөрүү (нэг нь
  үргэлжлэл, нөгөө нь шинэ сэдэв гэж үзэх) энэ репогийн хамгийн түгээмэл алдаа.  Нормын
  даалгаварт ERP хэрэгсэл дуудахгүй («В2-ийн галын ачаалал» ≠ `get_active_employees`);
  локал `/norm`-д ЗӨВХӨН нормын даалгаврын текст (`norm_query`) — олон санаатай мессежийн
  ERP үгс BM25-ыг хамааралгүй заалт руу татдаг.
- **⚠️ IDENTITY БОЛ ДҮҮРГЭГЧ БИШ.**  Нэр/албан тушаал/баг/Revit эрх асуулт бүрд системд орж,
  загвар хариулж чадахгүй үедээ тэдгээрийг давтдаг байв.  `contextBuilder.personaPolicy`:
  `none` өгөгдмөл; `name_only` мэндчилгээ/мета; `full` зөвхөн өөрийнхөө тухай асуусан
  («миний даалгавар») эсвэл `get_my_assignments` төлөвлөгдсөн үед.  Revit эрхийн мөр зөвхөн
  REVIT_* санаа/Revit контекстод.  Persona орсон үед ч «асуугаагүй бол дурдахгүй» дүрэм.
- **⚠️ ХАРИУЛТЫН ГЭРЭЭ — ҮНЭН > ЗАГВАРЫН ТЕКСТ (§25, §33).**  Хэмжсэн: загвар «эх сурвалж
  олдсонгүй» гэж эхлэх тушаалыг үл хайхарч, шийдвэр байхад ч «В2 = 10–20 м²» гэж зохиосон.
  `answerContract.ts` (сервер) гэрээ бичнэ (`norm_refusal`: канон өгүүлбэр заавал, тоо
  хориотой; `norm_decision`: ангилал заавал, блокт байхгүй тоо хориотой, детерминист хураангуй
  эхэнд); хөтчийн `lib/contract.ts` үүсгэлтийн ДАРАА, харуулахаас ӨМНӨ тулгаж засна
  (`answer.reset` + нэг токен), засвар бүрийг `notices`-ээр ил хэлнэ.  Баримтын код
  (21-101-12), огноо, заалтын дугаар ТОО гэж баригдахгүй — эс тэгвэл зөв эшлэлтэй өгүүлбэр
  хасагдана.  Олон даалгаварт зөвхөн нормын `N)` хэсэг.  Канон өгүүлбэр `NORM_REFUSAL_MN`
  нь `promptFrame`-д ч ижил тогтмолоос — хос бичвэл зөрнө.
- **Нормын мужийн лавлагаа (`normDecide.mode = 'lookup'`)**: «В2 галын ачаалал хэдээс хэд вэ?»
  (g алга, ангилал нэрлэсэн) → босгын хүснэгтээс тэр ангиллын муж эрх бүхий блок болно.
  Урьд нь энэ асуулт локал сангийн хамааралгүй заалт руу унадаг байв.  Олон даалгаварт
  «1) Ангилал 2) Муж …» дугаарлалт асуултын 1)/2)-той мөргөлддөг тул шийдвэрийн тушаал зөвхөн
  нормын хэсэгт, нэг догол мөрөөр.
- **⚠️ Локал нормын хайлтын ХАМААРЛЫН ХААЛГА** (`ai/retrieval/src/pipeline.ts`): RRF-ийн оноо
  зэрэглэл, хамаарал БИШ — «Хамгийн хоцорсон таскууд юу байна» гэсэн ERP асуултад ч заалт
  `supported` төлөвтэй буцдаг байв.  fts-ээс Л ирсэн хэсэг нь асуултын ≥2 агуулгын токентой
  таарах ёстой (зогсоох үг — ХЭЛНИЙХ; корпуст >15%-д байдаг үг — КОРПУСЫНХ, хоёулаа хасагдана;
  В2 ангиллын тэмдэг, alias орно); эс тэгвэл `insufficient_evidence` + `no_match_reason`
  (no_candidates | no_visible_chunk | no_content_overlap — «хайлт унасан»-аас ЯЛГААТАЙ).
  ⚠️ Зогсоох үгийг FTS-ЭЭС ХАСАХГҮЙ — хасахад G005 алтан кейс унасан («нэг захиалагч» дахь
  «нэг» дохио).  Хэмжсэн: Recall@5 94.3→94.2, алтан 23/23, NO_MATCH зөв 0/8→6/8
  (`ai:eval:norm`-д шинэ хэмжүүр; үлдсэн 2 нь `uncertain`, lexical хаалга сэдвийн
  хамаарлыг бүрэн шийдэхгүй — вектор хөл асахад дахин хэмж).
- **Хэрэгслийн чиглүүлэлт** (`toolRouting.test.ts`, 24 мөрт хүснэгт): ERP шинжилгээний
  үргэлжлэл («яагаад удаад байна») → `analyze_project(сэдвийн id)`; ачаалал/идэвх →
  `get_employee_activity` («галын ачаалал» хамгаалалттай; «идэвхтэй төсөл» дахь «идэвх» биш);
  сэдэв тодорхой байхад `list_projects` хасагдана.  `list_projects` нь `active_count`,
  `counts_by_status`, `days_remaining`, `overdue` буцаана — хэмжсэн: 24 мөрөөс загвар
  «идэвхтэй»-г 14/16/18 гэж гурван өөрөөр тоолсон; хэрэгслийн хайрцагт «мөр тоолохгүй» дүрэм.
  `intent.ts`: «ачаалал», «өндөр» ГАНЦААРАА норм биш; мэндчилгээ зөвхөн ЦЭВЭР мэндчилгээнд.
- **Локал урт хугацааны санамж (§34–36)** — гурав дахь түвшин, ажилтны PC-ийн localStorage
  (`mglai.memory.<namespace>:<user_id>`), Cloudflare руу ХЭЗЭЭ Ч хадгалагдахгүй.  Сервер
  `memoryHints.ts`-ээр ИЛ тохиргооны хүсэлтийг танина («цаашид богино хариулаарай», «намайг X
  гэж дууд», «хүснэгтээр», «always in English»; «энэ удаа» = нэг удаагийн, хадгалагдахгүй);
  санамсаргүй баримт хэзээ ч санамж болохгүй.  `lib/memory.ts`: metadata (importance,
  confidence, lastUsed, lastConfirmed, expiresAt), `selectMemories` ээлж бүрд ХАМААРАЛТАЙГ л
  (хэв маяг ≤3, нэр томьёо зөвхөн асуултад байвал, дуудлага зөвхөн мэндчилгээ/мета, 90 хоног
  хэрэглээгүй нь орохгүй), шинэ ил хүсэлт хуучныг солино.  `/context` `local_memory`-г
  ариутгаж «ХЭРЭГЛЭГЧИЙН ТОХИРГОО» мөр болгоно; identity энд хэзээ ч орохгүй.
- **Зан төлөвийн SFT багц** (`cd ai && npm run ai:build:sft`): мэдлэг ≠ зан төлөв — нормын
  JSONL жинд орохгүй; жишээг серверийн ЯГ тэр кернел үүсгэнэ (код өөрчлөгдвөл дахин угсарна);
  §35 динамик тоо ({{N}} placeholder Л), бодит нэр, давхардал хасагдана; алтан үнэлгээний
  асуултууд test-д Л; манифест хамралтын ЦООРХОЙГ ил бичнэ (хэмжээг хамралт шийднэ).
  Сургалт энд АЖИЛЛАХГҮЙ (§59).
- ⚠️ **Deploy ХИЙГЭЭГҮЙ** (2026-09-10): миграц шаардлагагүй; worker → Pages дараалал; локал
  runtime-ийн (`ai/retrieval`) өөрчлөлт нь хөгжүүлэгчийн машинд `git pull` + `ai:stop/ai:start`
  (ажилтны PC-д Session B-ийн release манифестаар — developer-only заавар).

### MGL AI — итгэмжлэгдсэн баримтын гэрээ, хэмжсэн хайлт, SFT корпус (2026-09-10, 2-р шат)

**Загвар хэл үүсгэж болно; үнэнийг СИСТЕМ хянана.**  Хэмжсэн (бодит Qwen3-8B, гэрээний өмнө):
загвар татгалзлын зааврыг үл тоож «В2 = 10–20 м²» зохиосон, мөрийг 14/16/18 гэж зөрж тоолсон,
«хоцорсон 0» гээд доор нь 5 төслийг «хоцорсон» гэж жагсаасан, өгүүлбэрээ 33% давтсан.

- **Trusted Fact Contract `tfc-1`** (`backend/src/lib/mglai/trustedFacts.ts`, хөтөч
  `packages/mglai-common/src/turn/validator.ts` — 2026-09-14-өөс хөтөч/runtime/Revit нэг хуулбар).  СЕРВЕР `/context`-д гэрээ бичнэ
  (`answerMode` authoritative|grounded|refusal|free · `risk` · `facts` · `allowedNumbers` ·
  `allowedCategories` · `requiredSentence` · `trailerText` · `requiredCitations` · `noMatch` ·
  `forbiddenPhrases` · детерминист `template`); ХӨТӨЧ үүсгэлтийн ДАРАА тулгана.  Зөрчлийн код
  A–I: FACT_MISSING, NUMBER_CHANGED, CATEGORY_CHANGED, UNSUPPORTED_NUMBER, REFUSAL_MISSING,
  CITATION_MISSING, FAKE_CITATION, FALSE_UNCERTAINTY, UNIT_MISMATCH, FORBIDDEN_PHRASE,
  TRAILER_MISSING, CONTRADICTS_ZERO_COUNT.  Байгалийн хэлний утгыг шалгах оролдлого БАЙХГҮЙ (§6).
  ⚠️ Гэрээг хөтөч дээр ЗОХИОДОГГҮЙ — хос тогтмол байхгүй; `trustedFacts.test.ts` (15) +
  `frontend/scripts/check-ai-validator.mjs` (29, `verify`-д) халдлагын тест.
- **Хязгаарлагдмал сэргээлт (§7)**: validate → зөрчилтэй өгүүлбэр хас/дутууг нэм → унавал
  `correctionPrompt`-оор ЯГ НЭГ дахин үүсгэлт → унавал серверийн `template` (`fallbackAnswer`).
  Гогцоо БАЙХГҮЙ.  `risk=high` (норм, татгалзал, Revit үйлдэл) хариултыг батлагдтал БУФЕРЛЭНЭ
  («Хариултыг шалгаж байна» = бодит `validate` шат); дунд/бага эрсдэлд урсгал хэвээр.
  `dedupeSentences` бүх горимд гэрээний ӨМНӨ.  Оношилгоо `ai_messages.diag_json` (миграц 0280;
  түүхий текст хадгалахгүй).
- **Тоо, нэгж**: `numbersIn` — «1 800», «1,401» = мянгат (яг 3 орон), «1,5» = аравтын бутархай;
  NOT_A_NUMBER маск (огноо, цаг, баримтын код, заалт, жагсаалтын «1.»/«1)»); `normalizeUnit`
  сервер/хөтөч ХОС (МДж/м² ≡ MJ/m2 ≡ мдж/м2; кирилл «м» → «m» ХАМГИЙН СҮҮЛД).  Тоолох нь
  СЕРВЕР дээр (count/total талбар) — мөрийг загвар тоолохгүй.
- ⚠️ **Олон санаа**: нормын шийдвэр/татгалзал + ERP хэрэгсэл хамт байхад хэрэгслийн баримт,
  тоо ГЭРЭЭНД ҮЛДЭНЭ (эс тэгвэл «Идэвхтэй төсөл 24» UNSUPPORTED_NUMBER болж хасагдана — SFT
  угсрагч барьсан); validator ERP баримтыг (`authority=erp_tool`) БҮХЭЛ хариултаас, нормын
  баримтыг өөрийн `taskIndex` хэсгээс хайна.
- **Эх сурвалжийн хүчин төгөлдөр байдал (§16–17, `currentness.ts`)**: `effective_status` →
  CURRENT | SUPERSEDED | HISTORICAL | NEEDS_HUMAN_REVIEW | UNKNOWN; зөвхөн ЯГ `in_force`
  анхааруулгагүй, танигдахгүй = UNKNOWN; төлөв бүрд ӨӨР трейлер гэрээгээр хүчээр.  Локал сангийн
  4 баримтын 3 нь `NEEDS_HUMAN_REVIEW` (2026-09-10).
- **Нормын хариултын загвар**: «1) Ангилал: … 3) Нэмэлт шалгалт:» дугаарласан хатуу загварыг
  ХАСАВ (`mglai-sys-5`) — лавлагааны горимд «1) Ангилал: ХҮСЭЛТ», «Дутуу оролт: утга нь … байх
  ёс» гэсэн зохиомол мөр гардаг байв; загвар блокт БАЙХГҮЙ мөрийг дүүргэх гэж оролддог.
- **Хайлт — ХЭМЖИЖ шийдсэн** (`npm run ai:eval:retrieval`, 723 QA + 13 хатуу сөрөг;
  `benchmarks/retrieval-modes-2026-09-10-reference.json`): lexical R@1 84.1 / R@5 94.2 / MRR .883 /
  буруу баримт 2.4% / NO_MATCH recall 69%; vector-only (bge-m3-Q8_0, `ai/retrieval/src/vectorLocal.ts`,
  llama-server `--embeddings --pooling cls`, порт 39219 — 39218 нь runtime-ийнх) R@5 **29.6%**
  (англи 4.2%); hybrid(rerank) R@1 81.7 / R@5 94.6 / буруу баримт 4%.  **Өгөгдмөл lexical ХЭВЭЭР** —
  hybrid R@1-ийг бууруулж, буруу баримтыг нэмсэн.  «vector+fts → босго хагас» сулруулалт NO_MATCH
  recall 69→54% унагасан тул ХАСАГДСАН.  Хамаарлын хаалга: ≥2 агуулгын токен ҮГИЙН ЭХЭНД
  («хана» нь «чанаргүй» дотор таарахгүй), «ёстой» стоп үг.  Оношилгоо `POST /norm {debug:true}`
  ЗӨВХӨН `MGLAI_DEBUG=1` үед — энгийн хэрэглэгчид гарахгүй.
- **Бодит үүсгэлтийн suite** (`npm run ai:eval:conv -- --gen`, кейс A–O): түүхий БА эцсийн
  хариултыг хадгална; давталт (өгүүлбэрийн давхардал, 4-грам, гогцоо), хэв маяг
  (`evaluation/lib/style.mjs` — 11 төрлийн детерминист lint, ASCII `\b` кириллд ҮҮСДЭГГҮЙ тул
  `\p{L}` хил), гэрээний эх сурвалж {model|repaired|regenerated|template}.  2026-09-10 sys-5
  reference: бүтэц 22/22, үүсгэлт 32/33 (J урт хариулт 4-грам тогтворгүй), эх сурвалж model 9 /
  repaired 8 / template 0, түүхий өгүүлбэрийн давхардал 0%, гогцоо 0; enforce <0.3 мс.
- **Монгол хэв маягийн хос** (`ai/training/mn_style_pairs.jsonl`, 30, 27 төрөл): шууд орчуулга
  («үнэн зөв хөдөлж»), албан хэллэг, identity-filler, process-narration, template-leak, татгалзсаны
  дараах таамаг… `npm run ai:eval:style` — муу тал 26/27 баригдана, зөв тал дээр худал эерэг 0.
  Утгын зөрчил (тоолуур, нэгж, эшлэл) нь validator-ын ажил, lint-ийнх БИШ.
- **SFT угсрагч v2** (`npm run ai:build:sft`): жишээ = ЯГ `assembleTurns` (system + түүх +
  user{шийдвэр|хэрэгсэл|нотолгоо|Асуулт}) + assistant.  ⚠️ v1-ийн `{"tool_calls":[…]}` формат
  serving-тэй ТААРДАГГҮЙ байсан — энэ системд загвар хэрэгсэл дууддаггүй, сервер дуудна.
  Хэрэгслийн утга, нормын босго, баримтын код seed-тэй САНАМСАРГҮЙ (бодит норм код ХОРИОТОЙ) —
  «хайрцгаас хуул» гэдгийг сурна, тоог биш; зорилт бүр `validateAnswer` + style lint-ээр;
  6 тэнхлэгийн хамралт (хэл 5 · яриа 7 · хэрэгсэл 8 · үндэслэл 8 · санамж 2 · алдаа 8), нүд
  бүр ≥5; яг/ойролцоо (Jaccard ≥ .85, ӨӨР гэр бүл)/гэр бүлийн cap; `evaluation/*.mjs`-ийн бүх
  алтан мөр test-д Л.  `dataset_lint.py` (serving-v2: хайрцагт байгаа тоо = хуулсан) ЦЭВЭР.
  Хэв маягийн хос → «дахин бич» даалгавар (тоо санамсаргүй, зөв тал муу талд байхгүй тоо нэмсэн
  бол алгасна).  2026-09-10: 302 жишээ (train 243/val 22/test 37).
- **Сургалтын хаалга** (`npm run ai:train:readiness` — 20 хаалга, хэмжсэн файлаас): 2026-09-10
  **NOT READY** — жишээ 302 < 500; torch/peft суулгаагүй; `registry/models.json`-д
  `license_cleared=true` нэг ч алга (ЭЗЭН батламжилна); `train_lora.py` суурь 4B ≠ serving 8B
  (RTX 3070 8 GB дээр 8B QLoRA БАГТАХГҮЙ — шийдвэр хэрэгтэй).  Сургалт ЭХЛҮҮЛЭЭГҮЙ.
- **Кернелийн мэдэгдэж буй цоорхой** (угсрагч илрүүлсэн, засаагүй): `memoryHints` «хариултаа
  англиар бичдэг болоорой» (кирилл/латин)-ыг танихгүй (зөвхөн «always in English»); англи
  «Why is this project behind?» үргэлжлэл CONTINUATION гэж ангилагдана (FOLLOW_UP биш).
- Шалгалт: `cd backend && node --test src/lib/mglai/*.test.ts` · `cd frontend && npm run
  check:ai-validator` · `cd ai && npm run ai:eval:style && npm run ai:build:sft && npm run
  ai:train:readiness`.  ⚠️ **Deploy ХИЙГЭЭГҮЙ** — миграц 0280 ЭХЛЭЭД, дараа нь worker, Pages;
  хөгжүүлэгчийн PC-д `git pull` + `ai:stop/ai:start` (developer-only; ажилтны PC = Session B release урсгал).

### MGL AI 0.6 — анхны хяналттай Qwen3-8B QLoRA smoke (2026-09-10, коммит `8e0501a` · `68e9ab0` · `f22ba7c`)

Дэлгэрэнгүй `docs/mgl-ai/TRAINING.md`.  Хэмжсэн баримт бүр `ai/training/reports/`, `ai/evaluation/{baselines,benchmarks}/`.

- **Суурь = serving суурь: `Qwen/Qwen3-8B@b968826d` (Apache-2.0)**; serving артефакт `unsloth/Qwen3-8B-GGUF` Q4_K_M, sha256 `120307ba…` (локал = HF LFS).  `registry/models.json` → `employee-8b-q4`; лицензийн ГУРВАН түвшин холихгүй: `license_detected`/`license_metadata_complete` (баримт, smoke-д хангалттай) ≠ `license_cleared` (ЭЗНИЙ шийдвэр, түгээлтийн хаалга — одоо `false`).  `train_lora.py` нь `--base-model` serving суурьтай зөрвөл ЗОГСОНО — санах ойн асуудлыг 4B руу шилжиж «шийдэхгүй».
- **⚠️ «8B QLoRA 8 GB-д багтахгүй» гэсэн өмнөх мэдэгдэл ХЭМЖИЛГҮЙ байсан, ХУДАЛ.**  `memory_probe.py` (bf16 бэлтгэл + sliced logits): 512→6470 MB/1.3 с, 1024→6766/2.3 с, **1536→7132 MB/4.7 с (FITS_STABLY)**, 1792→11.8 с, 2048→28 с (reserved ≥ 92% → драйвер хуудаслалт).  Гурван урхи багтаагүй мэт харуулж байв: (1) `peft.prepare_model_for_kbit_training` bf16 → fp32 upcast (embed_tokens + lm_head 2×620M = 5 GB); (2) eval горимд gradient checkpointing АЖИЛЛАДАГГҮЙ (`model.train()` заавал); (3) бүтэн дарааллын logits (151 936 үгсийн сан × N, fp32) — `logits_to_keep` (transformers-ийн албан ёсны параметр) зөвхөн зорилтын байрлалд.  **Windows sysmem fallback OOM өгөхгүй, «allocated > VRAM», 10× удаан** — probe тэр шатыг `sysmem_spill`/`ok:false` гэж тэмдэглэнэ.  ⚠️ Probe ≠ бодит сургалт: 3 алхамд 7514 MB байсан reserved бодит сургалтад 8392 болж 30→88 с/алхам болов.
- **Readiness (`ai:train:readiness`) хоёр түвшин — SMOKE / RELEASE.**  «≥500 жишээ» ХАСАГДСАН (RELEASE R2 зөвлөмж хэвээр); оронд нь кернелийн snapshot = систем (S1), чухал зан төлөв бүрд доод тоо (S4), давхардал/тусгаарлалт/формат файлаас дахин (S8–S10), tokenizer-оор тайрагдах хувь (S12; кирилл ~1.7 тэмдэгт/токен — «тэмдэгт/2.6» тооцоолол 1481 гэж байхад бодит max 2319).  E2/E4 нь хатуу бичсэн sys-4 тайлангаас (case J гогцоо) уншиж sys-5-ыг унагаж байсан — одоо `identity.system_prompt_version` таарсан тайлан/хөлдөөсөн суурь л (`freeze-baseline.mjs` → `baselines/base-<огноо>-<prompt>-<gguf sha8>.json`: суурь+хувилбар, GGUF sha, llama.cpp b10850, түүвэрлэлт, prompt/tool/contract хувилбар, кернелийн хэш, мэдлэгийн сан, үнэлгээний файлын хэш).
- **Held-out suite** `evaluation/heldout-cases.json` + `heldout-gen.mjs` (38 кейс, 24 ангилал, raw/final ТУСДАА; угсрагч эдгээрийг test рүү шилжүүлнэ); `lib/e2e.mjs` нь conversation-e2e-тэй хуваалцсан ээлж; `compare-candidate.mjs` регресс + сохор үнэлгээний хувь (A/B seed-тэй, түлхүүр тусдаа).  Давталт: 4-грамын хувь МЭДЭЭЛЭЛ, хаалга нь `severe` (ижил өгүүлбэр/догол, залгаа блок, гогцоо суффикс, зэргэлдээ хувилбар, ≥6 үгийн цонх ≥3×).
- **Кернелийн детерминист засвар**: `looksRegulatory` = `intent.isNormativeQuestion` (нэг эх сурвалж, латин галиг; «Хүснэгт 4» кирилл `\b` урхи; гишгүүр/захиалагчийн үүрэг); «Why is this project behind?» FOLLOW_UP (`' this '`, why+ижил салбар); `findProjectMention` «Project B» ⊄ «project behind»; `memoryHints` «-дэг болоорой», «англиар бич»; **хадгалсан хэлний санамж `/context`-ийн `response_language`-ийг шийднэ** (`memoryResponseLanguage`; хөтөч `toWire` `value` илгээнэ).  ⚠️ Загвар «Reply in English» зааврыг монгол хайрцагтай үед ҮЛ ТООДОГ (H35/H38/H10 raw) — SFT-ийн зорилт.
- **Smoke `mgl-adapter-0.1-smoke`** (r16/α32 бүх модуль, 1536, accum 8, 2e-4 cosine): 41 алхам = 1 epoch, loss 2.37→0.37, eval_loss 0.399, VRAM оргил 7158; 2-р epoch checkpoint хадгалж байхад сессийн teardown-оор ТАСАРСАН (тайлан логоос сэргээгдсэн, `INTERRUPTED_AT_EPOCH_1_CHECKPOINT`).  GGUF LoRA 83 MB (`export_adapter.py`, `training/.llama.cpp` b10850 shallow clone), `MGLAI_LORA_PATH` runtime override, `/lora-adapters` scale 1.0.  **Харьцуулалт (43 ээлж, ижил нөхцөл): raw 20→27, final 31→36, гэрээ raw 24→29, хэв маяг 8→3, давталт 1→0, дундаж урт 233→91 тэмдэгт.  Регресс: урт тайлбар (2 өгүүлбэр болж, заримдаа утгагүй), H17 эшлэл, алтан C2.  ДҮГНЭЛТ `CANDIDATE_REJECTED`** — багц хэт богино хариулт заадаг (assistant дундаж 48 ток, structured-long 9 мөр).  **Deploy ХИЙГЭЭГҮЙ, манифест ХӨНДӨӨГҮЙ.**  Дараагийн адаптер: урт/тайлбарын + ерөнхий мэдлэгийн монгол жишээ, LR/epoch багасгах, 1280–1408 ток.
- Сургалтын орчин (ХЭМЖСЭН, `requirements.txt`): Windows 11 26200, Python 3.12.10 (`ai/training/.venv`), CUDA драйвер 560.94 / 12.6, torch 2.14.0+cu126, transformers 5.17.0, peft 0.20.0, bitsandbytes 0.50.2, accelerate 1.15.0, datasets 5.0.1 (TRL хэрэггүй).  Qwen3-8B safetensors 16.4 GB HF кэшид (pinned revision).

### MGL AI — нормын найдвартай байдал: детерминист хөдөлгүүр, provenance-той хариулт (2026-09-11, коммит ХИЙГЭЭГҮЙ)

Эзний «NORMATIVE RELIABILITY HARDENING» даалгавар.  Хэмжсэн эх шалтгаан 14 (БД 21-101-12
шингээгээгүй; нэрлэсэн баримт хайлтыг цоожилдоггүй; runtime-ийн `verified` ≠ хамаарал;
эшлэл тоог гаргасан бичлэгт холбогдоогүй; калькулятор давхарга огт байхгүй; гэрээ зөв
тооцоог устгадаг; follow-up хаягддаг; итгэл = нотолгооны ТОО; «хуучин» трейлер бүх
`in_force`-бус баримтад; норм→норм үргэлжлэл өмнөх хариултаа давтдаг; `needs_human_review`
локалд шийдэгддэггүй; «хайлт унасан» ≡ «олдсонгүй»; svg-ийн текст-band-aid).  Дэлгэрэнгүй
`docs/mgl-ai/ARCHITECTURE.md` §16, `OPERATIONS.md` §9.

- **Гинж:** асуулт → normalize → инженерийн entity → ил нэрлэсэн баримтын цоож → хөрвүүлсэн
  дүрэм/томьёо → typed калькулятор → **`TrustedNormResult` (гарын үсэгтэй)** → provenance-той
  эшлэл → загварын дахин өгүүлэлт → validator (хатуу инвариант) → `/messages`.  Загвар
  ангилал, тоо, томьёо, эх сурвалж, хуудас, хүчинтэй эсэхийг ХЭЗЭЭ Ч шийдэхгүй.
- **Бүртгэл ҮҮСГЭГДЭНЭ, гараар бичигдэхгүй** (Decision 1, хувилбар A): `ai/norm-compiler`
  (адаптер → `backend/src/lib/mglai/norm/generated/*.generated.ts` + `manifest.generated.ts`),
  `cd ai && npm run ai:norm:generate [-- --check]`.  БД 21-101-12: 27 дүрэм (гурван утгат
  предикат + хилийн зөрчил), 38 томьёо (28 гүйцэтгэгдэх), 80 хэсэг, 14 кейс, багцын
  **SHA-256** (ingest-тэй ижил файлын жагсаалт).  Байт-давтагдана (`norm-compiler/test`).
- **Amendment A — хувилбарын цоож:** бүртгэлийн SHA ≠ локал сангийн SHA → `data_version_mismatch`
  (`NORM_DATA_VERSION_MISMATCH`), эрх бүхий БИШ, локал нотолгоо хаягдана.  E2E `V01`.
- **Amendment B — ээлжид ЯГ НЭГ үр дүн:** `/context` HMAC-SHA256 (JWT_SECRET, conv/seq/асуулт)
  гарын үсэг зурна; `/messages` хөдөлгүүрийг ДАХИН ажиллуулахгүй, гарын үсгийг шалгаад
  эшлэл/итгэл/оношилгоог тэр объектоос гаргана.  Хөтчийн өөрчилсөн объект хаягдана (E2E `S01`).
  ⚠️ `/messages`-ийн `seq` нь туслахын мессежийнх (+1) — хөтөч `trusted_norm_seq` илгээнэ.
- **Amendment C — 28.0 °C = эх сурвалжийн хоёрдмол утга:** бичлэг `<= 28`, эх бичвэр `< 28`
  → `needs_human_review` / `source_boundary_conflict`, ангилалгүй; 27.9 → А, 28.1 → Б.  Багц
  ХӨНДӨГДӨӨГҮЙ.
- **Amendment D — хүчин төгөлдөр байдал 7 төлөв** (`currentness.ts`): БД 21-101-12 =
  `CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED` → товч тэмдэглэл, «хуучин» БИШ; «хуучин» үг
  зөвхөн HISTORICAL/SUPERSEDED.  UNKNOWN нь аюулгүй тал (хүний хяналтын трейлер).
- **Amendment E — кодгүй баримт сонголт:** «25 °C, ΔP 7 кПа» → entity-ээр БД 21-101-12, BM25-аар
  биш.  Бүртгэлд байхгүй атлаа санд байгаа баримт нэрлэвэл (БНбД 21-04-05) хөдөлгүүр ӨӨР
  баримтаас хариулахгүй, локал хайлт тэр баримтад цоожлогдоно; санд ч байхгүй (УББ 11-202-00)
  бол runtime-ийн `named_document.absent` баталсны дараа л `named_document_absent`.
- **Гэрээ tfc-2** (`trustedFacts.ts` + `norm/contract.ts` ↔ хөтчийн `validator.ts`): `norm` блок
  (alias, үр дүн/нэгж, эхний/эцсийн ангилал, заавал follow-up өгүүлбэр, маск токен, template).
  **Хатуу инвариант** — provenance баримт = эшилсэн баримт · тооцооны үр дүн = харуулсан тоо ·
  эцсийн ангилал = харуулсан ангилал — зөрвөл өгүүлбэр засахгүй, дахин үүсгэхгүй, серверийн
  template.  Детерминист үр дүнгүй нормын ээлжид тоо ЗӨВХӨН нотолгооны текстээс.  Загвар унавал (давталт,
  хугацаа, алдаа) детерминист template-ийг харуулж ХАДГАЛНА — бодит хөтчид GPU-г өөр процесс
  эзэлсэн үед (эхний токен 180 с, 300 с timeout) тасарсан хариулт үлдэж байсныг хэмжсэн.
- **Олон ээлж:** `ConvState.norm` (оролт, орчин, баримт) ERP ээлжийг давж амьдарна; «Q=50000
  МДж, H=6 м» гэсэн бүхэл оролт нормын төлөвтэй үед NORMATIVE/FOLLOW_UP; өмнөх оролт зөвхөн
  ҮРГЭЛЖЛЭЛД нэгтгэгдэнэ (шинэ сэдэвт өвлөгдөхгүй); детерминист ээлжид өмнөх ХАРИУЛТ prompt-д
  орохгүй.  ⚠️ `not_category` предикат УРВУУ байсан — Хүснэгт 1-ийн В мөр хэзээ ч биелдэггүй
  байв (одоо В → Хүснэгт 4 дэд ангилал).
- **Хайлт (ai/retrieval):** `fire_hazard_rules` профайл, хэсэг бүрийн баримт, хатуу цоож + §9
  солигдсон холбоо, `named_document_absent`/`clause_not_in_named_document`, калькуляторын нэгж
  FTS-ээс хасагдана; **фокус хаалга** — «ямар МАСШТАБААР» гэх мэт хэмжигдэхүүний асуултад
  FTS-ийн хэсэг тэр хэмжигдэхүүн + хамгийн ховор 3 сэдвийн үгийн нэгийг агуулах ёстой (B09:
  геодезийн трассын 1:5000 заалт хот суурины асуултад орж байсныг хаана; хийсвэр фокус —
  төрөл, мэдээлэл, хугацаа — шаардахад 20 тест унасан тул ЗӨВХӨН физик хэмжигдэхүүн).
  Recall@5 96.6 % ЯГ хэвээр (101/2955 алдаа ижил).  Runtime санг **readOnly** нээнэ; схем
  зөрөх/дахин шингээлт → `/norm` **503** (олдсонгүй биш); FTS-ийн дэд бүтцийн алдаа залгигдахгүй.
- **UI:** «N эх сурвалж» = `/context` хэрэглэсэн нь л; нормын төлөвийн шошго гарын үсэгтэй
  үр дүнгээс; `ICON_LEAK_RE` ХАСАГДСАН (`logo.svgФайл» эвддэг байв), оронд нь
  `frontend/scripts/check-ai-ui-leak.mjs` (Vite SSR-ээр бодит компонент рендерлэж түүхий SVG
  байхгүйг барина, `verify`-д); анхны «svgsvg» гомдол NOT_REPRODUCIBLE_IN_APP.  «Дахин» товчны
  хуучин closure (`messages`) алдаа засагдсан; notice-түвшний унасан хариулт түүхэд орохгүй.
- **Хэмжсэн (`cd ai && npm run ai:eval:gold [--gen]`, локал backend :3010 + runtime):** Level 1
  29/29 + B09 EXPECTED_NO_SOURCE + R01/R02/V01/S01/M1–M5 бүгд PASS; Level 2 (бодит Qwen3-8B)
  бүх кейс PASS (model/repaired/template), §29-ийн 10 хэмжүүр бүгд 0.  `ai:eval:norm`: Recall@5
  96.6 % (2854/2955), алтан 106/122 (+11 тоон кейс Worker-ийн бүртгэлд), гоожилт 0, NO_MATCH 6/8.
  Backend 476 тест (`systemCatalog` drift нь өөр агентын i18n WIP), ai 221, frontend check 39+6.
- ⚠️ **Хоёр wrangler dev зэрэг явж байв:** `:3000` нь ӨӨР checkout-ын (`mgl-ai-session-c`) хуучин
  код (sys-6) байсан тул хэмжилт `--port 3010 --persist-to <scratchpad>` (D1-ийн хуулбар)
  дээр.  E2E-д `--api http://127.0.0.1:3010/api`.
- **Session A final pass (2026-09-14, OPERATIONS §9.1):** Session C-ийн 6 олдвор — **GAP-023**
  `retrieval/src/reprText.ts` (Python repr → хүний бичвэр, шингээлт + `ai:dataset:repr -- --write`
  хоёулаа нэг функц; багц gitignore-д тул PC бүр ажиллуулна); **GAP-025** баталгаажилтын төлөв
  ГУРВАН анги (`rules.ts`: executable / `KNOWN_NON_EXECUTABLE_VERIFICATION` шалтгаантай / танигдаагүй →
  хаалттай + `ai:ingest:norm --strict` exit 1 + `norm-compiler` зогсоно); мөрийн үүрлэсэн
  `source.verification_status` баримтын өгөгдмөлөөр ДАРАГДАХГҮЙ — БНбД 31-23-12 (`official_mcis_pdf`)
  ба 31-24-22 (`registered_full_text`) өмнө нь чимээгүй `verified_official_text` болдог байсан — **эзэн
  2026-09-14-нд хоёуланг ЭХ СУРВАЛЖИЙН ЭРХЭЭР ил батлав** (`EXECUTABLE_VERIFICATION`, хүчин төгөлдөр
  байдал тусдаа хэвээр); алтан 97/111; багцын `usable_for_current_compliance: false` хаалт whitelist-ээс дээгүүр; **GAP-026** тестийн id `<doc_id>::<id>`, багц доторх давхардал алдаа,
  бүх багцын давхцлын тест; **GAP-024** `training/split-manifest.json` + `ai:train:split` (train/val ↔
  eval 0/0; багцын SFT толь сургалтад ОРОХГҮЙ); **GAP-032** зангуу үг (`anchorTerms`) — «лифтний хонгил»
  §6.3.6 холбох хонгилыг зээлэхгүй, Recall@5 ЯГ хэвээр; **GAP-022** «1.800» хоёрдмол → тодруулна.
  C-тэй давхар засагдсан файлууд (Session D нэгтгэнэ): `intent.ts`, `turn.ts`, `lang.ts`,
  `promptFrame.ts`, `mglAi.ts`, `orchestrator.ts`, `validator.ts`, `MglAiPage.tsx`; C-ийн
  `groundingGuard.ts` A-д байхгүй тул C-ийн conversation/hallucination suite энд ажиллахгүй.
- ⚠️ **Deploy ХИЙГЭЭГҮЙ** (Session A commit → Session D нэгтгэл).  Дараалал: worker →
  Pages; **хөгжүүлэгчийн машинд** `git pull` + `ai:dataset:repr -- --write` + `ai:ingest:norm` (11 багц) +
  `ai:restart` (runtime код өөрчлөгдсөн: readOnly сан, 503, фокус/зангуу хаалга, `named_document`,
  төлөвийн бүртгэл) — developer-only.  **Ажилтны PC-д:** runtime код + шинэ `knowledge.sqlite` (schema 3,
  11 багц) нь Session B-ийн release манифестаар (stage → SHA → activate → restart → health → smoke →
  lastKnownGood / rollback); мэдлэгийн release-ийг хөгжүүлэгч `ai_knowledge_releases`-д sha-тай бүртгэнэ.
### MGL AI — Production readiness давхарга (Session C, 2026-09-11)

`ai/evaluation/production-readiness/` (README-тэй): 6 held-out багц (203 тест, загваргүй/D1-гүй),
`scorecard.mjs` (зөвхөн ил тестээс PASS/FAIL/BLOCKED/NOT_IMPL — таамаг хувь байхгүй),
`perf-baseline.mjs` (p50/p90/p95, зэрэгцээ 2/4), `gap-inventory.json` (эзэнтэй, репродукцтой гажиг).
`ai/tools/dataset-lint/` (норматив багц, ЗАСДАГГҮЙ) ба `ai/tools/training-lint/` (SFT + train/eval гоожилт).
`npm run ai:readiness` · `ai:readiness:suites` · `ai:lint:dataset` · `ai:lint:training` · `ai:perf`.

Хэмжиж баталсан дөрвөн зан төлөв — өөрчлөхдөө тестийг нь ажиллуул:

- **`groundingGuard.ts` — tfc-1 гэрээний ДАРААХ давхарга.**  `buildTrustedContract` нь 7 хэрэгслийн
  баримтыг л таньдаг байсан тул хэрэгсэлгүй COMPANY_FACT, БҮГД унасан хэрэгсэл, `query_entities`/
  `describe_system` үр дүн, Revit контекстгүй REVIT_* асуулт бүгд `free` гэрээтэй үлдэж, зохиомол
  «120 даалгавар», «45.6 м²», унасан хэрэгслийн «24 идэвхтэй төсөл» validator-оор өнгөрч байв
  (хэмжсэн).  Одоо: refusal + канон өгүүлбэр (`ERP_NO_DATA_MN` / `ERP_UNAVAILABLE_MN` /
  `REVIT_NO_CONTEXT_MN`) + `allowedNumbers=[]`, эсвэл grounded + хайрцгийн тоо + `renderToolBox`
  template.  Нормын гэрээг (authoritative/norm refusal) ХӨНДДӨГГҮЙ.  Hook нь `mglAi.ts` `/context`-д
  ганц мөр; `revitContextPresent = revitSummary !== null`.
- **`intent.ts` түлхүүр үг = ҮГИЙН ЭХНЭЭС, латин ганц үг = БҮТЭН үг, `*` = галигийн язгуур.**  Энгийн
  `includes` байхад «бод»→«бодлого» (CALCULATION), «view»→«review» (REVIT), «norm»→«normal»,
  «schedule»→«behind schedule» (REVIT), «чадвар»→«ур чадварын үнэлгээ» (META) болж байв.  Монгол
  морфологи: «ажилтн», «төсл», «даалгавр» язгуурууд `intent.ts`, `toolPlan.ts`, `gateway/entities.ts`
  ГУРВУУЛАНД — «Ажилтны тоо хэд вэ?» өмнө нь tasks entity (буруу итгэмжлэгдсэн домэйн) авдаг байв.
  `entities.ts`-ийн tasks keyword `'ажил'` → `'ажил '` (ажилтан/ажилладаг дотор таарахгүй).
- **Ярианы кернел:** CASUAL/META ХЭЗЭЭ Ч үргэлжлэл биш (`turn.ts` `socialOwn`) — өмнө нь төслийн
  сэдэв + COMPANY_FACT-ыг өвлөж «ИДЭВХТЭЙ СЭДЭВ» мөр мета prompt-д ордог байв; мэндчилгээ сэдвийг
  УСТГАХГҮЙ (advanceState, TTL хэвээр); хэрэгслийн үр дүнд ирсэн нэрлэсэн төсөл сэдэв болно;
  «тэгвэл идэвхтэй нь хэд вэ?» = сэдэвгүй ERP үргэлжлэл (6b, `RESULT_CONNECTORS` + зэргэлдээ seq л).
- **Урсгал/алдааны семантик (frontend):** `done` ирээгүй урсгал = `stopReason:'interrupted'` →
  `GENERATION_INTERRUPTED` (notice), ХАДГАЛАГДАХГҮЙ, дараагийн `history`-д ОРОХГҮЙ (`isInvalidAnswer`
  — давталт/timeout/цуцлалт ч мөн; өмнө нь зөвхөн severity=error шүүгддэг байв); цуцлалт үүсгэлтийн дунд
  → CANCELLED (өмнө нь error=null, хадгалагддаг байв); runtime 413 → `CONTEXT_OVERFLOW`, 503 →
  `MODEL_NOT_READY`, хүрэхгүй → `LOCAL_RUNTIME_OFFLINE`; backend 401 → `AUTH_EXPIRED` (403 биш), 503 →
  `SERVICE_UNAVAILABLE`, сүлжээ → `BACKEND_OFFLINE` (`runStage` алдаанд `stage` наана).
  `validator.enforceContract`: засварын дараа хоосон → `EMPTY_AFTER_REPAIR` → `fallbackAnswer`.
- `lib/mglai/redaction.ts` (`redactSecrets`/`redactObject`) бэлэн, ХОЛБОГДООГҮЙ — runtime лог,
  telemetry, feedback экспортод залгах нь Session B-ийн ажил.

### Нийтийн мэдээлэл — `announcements` (migration 0338, 2026-09-21)

Sidebar «Тойм → Нийтийн мэдээлэл» бүлэг (2026-09-24-нөөс): **«Мэдээ, зарлал»** (`/app/announcements` — системийн шинэчлэлт · компанийн мэдээлэл · чухал дотоод зарлал) · **«Дотоод журам»** (`/app/rules`, 0330 — өмнө нь «Хүн хүчин» бүлэгт тусдаа мөр байсан) · **«Удирдлага»** (admin, `/app/admin/announcements` = `PublicInfoAdminPage`, `?tab=announcements|rules` — хоёр модулийг НЭГ газраас удирдана; таб бүр хуучин админ хуудсыг `embedded` горимоор рендэрлэнэ, `QuotesPage`-ийн хэв маяг). Хуучин `/app/admin/rules` → `?tab=rules` redirect. ⚠️ `?tab=` нь хабынх — мэдээний төлөвийн шүүлт `?status=`. Backend хоёр модуль тусдаа хэвээр. `routes/announcements.ts` + `lib/announcements.ts` (цэвэр, 14 тест) + `routes/announcements.test.ts` (бодит SQLite + Hono харness, 10 тест); frontend `features/announcements/`. Эзний 4 шийдвэр (2026-09-21): **зохиогч = зөвхөн admin** (`requireAdmin`) · **хүрээ = ажилтнууд, мэдээлэл бүрд role × баг** (`audience_json`, NULL = admin/senior/engineer/architect бүгд; `worker`/`client` хэзээ ч орохгүй — `workerScope`/`clientScope` цагаан жагсаалтад угтвар байхгүй) · **гарын үсэг = профайлын `users.signature_url` нэг товчоор** (Дотоод журам 0330-тай ижил: байт хувийн `MEETING_BUCKET` `announcement-signatures/…` руу хуулагдаж sha256-тай хадгалагдана, зураг нь authed `GET /acks/:id/image`) · **статистик = зөвхөн admin**.

- **Бие нь HTML, СЕРВЕР цэвэрлэнэ.** `sanitizeHtml` (цагаан жагсаалт таг/атрибут/style, `on*`·`javascript:`·`url()` хэзээ ч гарахгүй, script/style/iframe агуулгатайгаа устана) хадгалах бүрд; хөтөч `dangerouslySetInnerHTML`-д итгэнэ. Засварлагч `AnnouncementEditor` = contentEditable + execCommand (мэйлийн `RichTextEditor`-ийн механик) + зураг (файл/paste/drop → `uploadFile` → нийтийн `/media/<key>`). Зураг DB-д **харьцангуй** `/media/…`-ээр (домэйн солигдоход эвдэрдэггүй), `toDisplayHtml`/`toStoredHtml` (`lib/announcementHtml.ts`) хоёр тийш хөрвүүлнэ. Preview `stripDangerousHtml` — өөрийн хөтөчийн давхарга л, цэвэрлэгчийн хуулбар биш.
- **`ack_mode`** none | confirm (чагт) | signature. Баталгаа = `announcement_acks (announcement_id, ack_version, user_id)` UNIQUE + `content_hash` (гарчиг+бие SHA-256; клиент буцааж илгээж 409 `HASH_MISMATCH`/`VERSION_CHANGED`). **`PUT … {reack:true}` → `ack_version` +1**: бүгд дахин, хуучин мөр түүх (`/acks?ack_version=N`). Хүрээнээс гадуур admin мэдээллийг харна (`in_audience:false`), гэхдээ `POST /ack` 403 — roster-т тоологдохгүй тул. Roster/харагдац/мэдэгдэл гурвуулаа ГАНЦ предикат `audienceMatches` ↔ `audienceWhereSql`.
- Мэдэгдэл `announcement_published` (шинэ `NotificationType`, push ангилал **`announcements`** — `PUSH_CATEGORIES`-д шинэ; frontend UI ангилал `announcements`), нийтлэх/reack/`POST /:id/remind`-д хүрээний идэвхтэй ажилтанд, нийтлэгчээс бусад. Самбарт `PendingAnnouncementsBanner` (`PendingRulesBanner`-ийн хажууд). **`DELETE` баталгаатай ч устгана** (эзэн 2026-09-25; `HAS_ACKS` 409 ХАСАГДСАН): баталгааны мөр, `MEETING_BUCKET` дэх гарын үсгийн хуулбар (мөрийн `signature_key`-ээр, угтвараар БИШ), `link = /app/announcements/:id` мэдэгдэл хамт арилна; UI-ийн баталгаажуулах цонх баталгааны тоог дурдаж «Архивлах»-ыг санал болгоно.
- Хэмжсэн 2026-09-21: headless-Chrome E2E 72/72 scratch D1 (prod хуулбар) дээр — засварлагч+зураг+Radix select, нийтлэх → 54 мэдэгдэл, чагт/гарын үсэг (canvas → профайл → баталгаа), статистик dialog, remind, reack, 403/404 хаалтууд. **Deploy ХИЙГЭЭГҮЙ.** Ажилтны PC-д хамааралгүй.
- **Дотоод журам = мэдээний засварлагч + ФАЙЛ ХАВСРАЛТ (migration 0347, 2026-09-25).** Өмнө нь журмыг dialog доторх markdown textarea-аар бичдэг байсан тул Word баримт оруулах аргагүй — прод дээр нэг ч журам үүсээгүй байв. Одоо `/app/admin/rules/:id` (`new`) = `InternalRuleEditorPage`, `AnnouncementEditor`-ыг хуваалцана. Хуваалцсан засварлагчид нэмэгдсэн (мэдээнд ч): үсгийн хэмжээ (rem — `execCommand('fontSize','7')`-ийн тэмдэглэгээг сольдог), дээд/доод индекс, хоёр талд тэгшлэх, хүснэгт (8×8 сонгогч + мөр/багана нэмэх/устгах), **Word (.docx) → HTML** (`mammoth`, зөвхөн дарахад ачаалагдах ~295 KB chunk; зураг нь `/media`-д, EMF/WMF алгасна), бүтэн дэлгэц; `onAttachFiles` өгсөн үед л 📎 (журамд). Цэвэрлэгчид `text-indent`/`line-height`/`vertical-align` нэмэгдсэн. `internal_rules` + `internal_rule_versions` дээр `body_format` (`markdown` 0330-ийн мөр | `html`; багана `body_md` нэрээрээ HTML-ийг хадгална) + `attachments_json`. Хавсралт = ХУВИЙН `MEETING_BUCKET` `rule-files/<ms>-<rand>.<ext>`, `POST /api/internal-rules/files` (admin, ≤30 MB, өргөтгөлийн цагаан жагсаалт — html/svg/exe хориотой, MIME өргөтгөлөөс), sha256-г СЕРВЕР тооцоолж R2 мета-д; PUT/POST зөвхөн `{key,name}` илгээж хэмжээ/хэшийг R2 `head`-ээс авна. Татах `GET /:id/files/:fileId` — ажилтан ЗӨВХӨН одоогийн нийтлэгдсэн хувилбарынх, admin ажлын хувь + бүх хувилбар; үргэлж `attachment` + `nosniff`, UI blob-оор харуулна (PDF blob iframe, Word/Excel нь Drive-ийн `DocxPreview`/`XlsxPreview`). **Хэш хавсралтын sha256+нэрийг агуулна** (нэмэлт хэсэг зөвхөн байгаа үед — 0330-ийн markdown мөрийн хэш байт-ижил). Бие хоосон ч хавсралттай бол нийтлэгдэнэ; уншигч эхний файлыг хуудсан дотор нээж, «уншсан» sentinel хавсралтын ДАРАА. Ажлын хувиас хасагдсан, ямар ч хувилбарт ороогүй файл R2-оос устана; нийтлэгдсэн хувилбарын файл хэзээ ч устахгүй (нотолгоо); журам устгахад бүгд. Хадгалаагүй орхисон upload өнчин үлдэнэ (цэвэрлэгч байхгүй). Хуучин markdown журам засварлагчид `markdownToHtml`-ээр нээгдэж хадгалмагц html болно. Тест: `lib/internalRules.test.ts` 14, `routes/internalRules.test.ts` 13; headless-Chrome E2E 47/47 scratch D1 дээр. **⚠️ 2026-09-25 DEPLOY → ROLLBACK → ДАХИН DEPLOY (release `ac0e34eb`, worker `fb39f2bf` 10%→50%→100% canary, `clientDisconnected` 0; Pages `fab5ed0e`).** `e31abca2` (worker `a2f91510`, Pages `6847095e`) УБ 11:12–11:22 хооронд прод дээр байхад хэрэглэгчдийн хүсэлт (`/auth/me` 7с, бусад 12с/30с) гацаж `clientDisconnected` минутад 6–19 болж, систем нэвтрэх боломжгүй болсон; worker-ийг `6668872e` (= `26ad791`-ийн build, байт-ижил батласан), Pages-ийг `b9bfe7a8` руу буцаасны дараа 0 болсон. D1 тэр үед хэвийн (p90 < 2мс), гацсан хүсэлтүүдийн CPU 0–3мс; механизм ХАРААХАН ОЛДООГҮЙ. Хэмжсэн: a2f91510-ийн bundle хэмжээ (5.66 МБ) ба startup (139 мс) бусад хувилбартай ижил түвшинд байсан; тасралт зөвхөн тэр хувилбар дээр, worker (03:12) ба Pages (03:13) 80 сек зөрүүтэй 100% нэг дор шилжсэний дараа эхэлсэн. Ижил кодыг gradual rollout-оор гаргахад гацалт давтагдаагүй — worker-ийг ҮРГЭЛЖ «Deploying» хэсгийн gradual жороор гарга. D1 0347 хэрэгжсэн хэвээр (нэмэлт багана, хуучин кодод хор хөнөөлгүй). 2026-09-25 08:26 UTC-ээс прод worker = `fb39f2bf` = release `ac0e34eb` (main-д бүгд commit хийгдсэн).

### MGL AI — НОРМЫН УХААН v3 (NORM-INTEL, 2026-10-04, branch `fix/mgl-ai-norm-intelligence-v3`, NOT deployed, weights NOT trained)

Эх шалтгаан (NORM-40 хэмжилт): 40 асуултын 10 нь GENERAL_HELP/META/CALCULATION болж нормын хайлтгүй, нотолгоогүй загварт очсон → зохиомол «10 м / 100 кг/м²», ERP төслийн нэр, «EI = Equivalent Impact», дараа нь «Нотолгоо хүрэлцэхгүй».  Загвар БИШ, чиглүүлэлт + гэрээ нь шалтгаан байв.

- **Чиглүүлэлт** `backend/src/lib/mglai/norm/questionKind.ts`: зохицуулагдсан сэдэв (`NORM_TOPICS`, чиглүүлэлтийн үгс — ЗААЛТ БИШ) **ба** шаардлага/ойлголт/хүчин төгөлдөрийн хэлбэр хоёулаа байвал норм (`isRegulatedTopicRequest`).  Сэдэв ганцаараа, хэлбэр ганцаараа норм БИШ; ERP дохио (явц, deadline, хэдэн ажилтан…) ба «яагаад» үндэслэлийн асуулт хасагдана.  ⚠️ «шат» = stair БА design stage (`DESIGN_STAGE` хасна: «Эскизийн шат»).  ⚠️ `foldText` давхар үсгийг хураадаг тул fold-той regex-ийг ГАРААР бүү бич — `matcher([...])` үгсийг fold хийж таарна.  Дэд төрөл: REQUIREMENT_LOOKUP · APPLICABILITY · CURRENTNESS · CONFLICT_RESOLUTION · DOCUMENT_DISCOVERY · GENERAL_NORM_CONCEPT (+ `governance` зарчмын 12 төрөл).  Norm-only ээлжид Revit контекст prompt-д ОРОХГҮЙ (`isNormOnlyTurn`, route `revitSummaryUse`).
- **Гэрээний блок** `TrustedContract.normIntel` (`packages/mglai-common/src/normIntel.ts`, Worker · runtime · хөтөч ЯГ ИЖИЛ): нотолгооны төлөв (AUTHORITATIVE · NO_VERIFIED_MATCH · RETRIEVAL_UNAVAILABLE · CURRENTNESS_UNVERIFIED · MISSING_APPLICABILITY_INPUT · HUMAN_REVIEW_REQUIRED · GENERAL_ONLY), хэрэглэгдэх байдал (APPLIES/DOES_NOT_APPLY/MISSING_CONTEXT/AMBIGUOUS_SCOPE/CONFLICTING_SOURCES), claim ledger (comparator + нэгж), эх сурвалж, нэр томьёоны хамгаалалт.  `validateNormIntel` нь тоо/«заавал-доод-дээд»/зохиомол баримт-заалт-хүснэгт-хуудас/ноорог-солигдсон→хүчинтэй/нийцлийн гэрчилгээ/хэрэглэгдэх байдал/`≥`↔`>`/нэгж/EI-ийн зохиомол задлалыг ХАТУУ зөрчил (`hard`) болгоно → засахгүй, дахин үүсгэхгүй, серверийн детерминист хариулт.  Эх сурвалжийн блокийг СЕРВЕР бичнэ (`ensureSourceBlock`).
- **Сервер бичсэн хариулт** `norm/intelligence.ts` `buildNormIntel` → `applyNormIntel` (route-д ХАМГИЙН ГАДНАХ давхарга; зөвхөн ГАНЦ даалгаврын NORMATIVE, каталог/L1 жагсаалт/clauseAbsent/subjectMissing/drift-д хөндөхгүй).  Нотолгоо БАЙХГҮЙ · хайлт УНАСАН · ноорог/солигдсон/түүхэн · засаглалын асуулт (ноорог≠хүчинтэй, шинэ огноо≠хүчинтэй, зөрчил→шууд сонгохгүй, ойролцоо тоо, прецедент, СНиП, нийцлийн гэрчилгээ) → `templateOnly`: ерөнхий ойлголт (норм биш гэж ИЛ) + сэдвээс гарсан дутуу оролт (`generalGuidance.ts`, «төслийн нэр» БИШ) + дараагийн алхам; ТОО/ЗААЛТ ЗОХИОГДОХ БОЛОМЖГҮЙ, загвар дууддаггүй (хурдан).  ⚠️ `generalGuidance.ts`/`terminology.ts` нь норм БИШ — тоо, заалт, «заавал» ЗОРИУД байхгүй; тест (`intelligence.test.ts`, `norm40Adversarial.test.ts`) бүх серверийн текст өөрийн validator-ыг давдгийг шалгана.  `Currentness`-д `DRAFT` нэмэгдсэн (`ai/norm-compiler/src/currentness.ts` ХОС).
- **Шошго**: `/messages` нь `contract_diag.norm_state`-ээр — GENERAL_ONLY → шошгогүй, NO_VERIFIED_MATCH/RETRIEVAL_UNAVAILABLE → insufficient, CURRENTNESS/APPLICABILITY/HUMAN → uncertain; «Нотолгоотой» зөвхөн AUTHORITATIVE.  Хөтөч: хүнд давталт (`detectSevereRepetition`) харуулахаас ӨМНӨ хаягдана; `echoFallbackText` «төслийн нэр эсвэл нормын код» гэж хэрэггүй зүйл асуухаа больсон.  Parity harness-д INTENTIONAL-6 (`norm_state`).
- **Үнэлгээ**: `ai/evaluation/norm40-v1-cases.json` (40, EVAL ONLY) + `norm40-adversarial-cases.json` (13), `npm run ai:eval:norm40` (STATIC = серверийн хариулт; `--replay` = raw vs final тусдаа, 10 хэмжүүр).  Backend тест `norm40Routing/norm40Adversarial/intelligence`, shared `normIntel/normIntelEngine`.  SFT: `norm_reasoning_pairs.jsonl` (150, тоо/код/нэгжгүй) + `mn_style_pairs_norm.jsonl` (29); NORM-40/adversarial/HUMAN-40 held-out-д (`build_behavior_sft.mjs`, `split-manifest.json`; Jaccard 0.85 босго ХӨНДӨГДӨӨГҮЙ).  Style lint: collapse/filler-loop/зохиомол товчлол/useless refusal/draft-as-active (`evaluation/lib/style.mjs`; `ai:eval:style` OK).
- ⚠️ ХИЙГЭЭГҮЙ: QLoRA сургалт (CUDA байхгүй Mac), `ai:eval:norm` (локал knowledge.sqlite энэ машинд байхгүй; retrieval-д нөлөөлөх `ai/retrieval` өөрчлөлт ХИЙГЭЭГҮЙ), deploy.  Ерөнхий ойлголт нь гараар бичигдсэн 22 сэдэв (`TOPIC_GUIDANCE`) — шинэ сэдэв нэмбэл `NORM_TOPICS` + `TOPIC_GUIDANCE` хоёуланд, мөн тестийг ажиллуул.

### Програмын хүсэлт (engineering feedback) — ERP inbox + Revit «Санал хүсэлт» (migrations 0410–0414, 2026-10-16, ⚠️ DEPLOY ХИЙГЭЭГҮЙ)

Ажилтан ERP-ээс (AccountMenu → «Програмын хүсэлт», `/app/my-engineering-requests`) эсвэл Revit add-in-ий «Санал хүсэлт» цонхноос (ribbon
Library, ажлын урсгалын цонхнуудаас ч — тухайн хэрэгслийн үе шат, онош хавсаргана) алдаа/сайжруулалт/асуулт илгээнэ; ЗӨВХӨН програм хариуцагч
`/app/engineering-requests`-ийн «Програмын хүсэлтүүд» inbox-оос триаж хийж хариулна.  Backend `routes/engineeringFeedback.ts`
(`/api/engineering-feedback`), `lib/engineeringFeedback{,Access}.ts`; frontend `features/engineering-feedback/`; add-in `revit-mcp/addin/Feedback/`.

- **Хэн inbox-д орох вэ — ГАНЦ эх сурвалж `lib/engineeringFeedbackAccess.ts` `resolveReviewer`:** идэвхтэй хэрэглэгч + `access_capabilities`
  (`software_engineer`, revoked биш; 0410) + `engineering_feedback_reviewer_binding` (ганц мөр, user_id + username + employee_id нь users-ийн
  ОДООГИЙН мөртэй ЯГ) + purpose-гүй ERP session.  Холболт = **user 75 / `usukhbayar` / `USH`** (Оюунбүрэн Өсөхбаяр — 4 талбараар баталгаажсан,
  нэрээр тааж олгоогүй; 0414 bootstrap нь тэр гурав таарахгүй бол юу ч бичихгүй).  ⚠️ Admin-д далд эрх БАЙХГҮЙ; JWT-ийн role, `users.position`
  эрхийн оролт биш (DB-ээс хүсэлт бүрд, кэшгүй); reviewer өөрийн эрхийг өөрчлөх зам байхгүй; Revit-ийн `revit`/`revit-refresh`/MCP/print токен
  inbox ХЭЗЭЭ Ч нээхгүй (`revit` session илгээж болно, `revit-refresh` нь зөвхөн шинэчлэл).  UI (sidebar, route, тоолуур, мэдэгдэл) нь
  `GET /capabilities`-ээр ИЖИЛ функцийг дууддаг.  Эрхгүй хүнд inbox-ын зам 404 (байгааг ч мэдэгдэхгүй).
- **Илгээгч** = идэвхтэй admin|engineer|architect|senior (`EF_SUBMITTER_ROLES`); worker/client `workerScope`/`clientScope`-оор хаалттай.
  `revitAddin.ts`-ийн OWNER_ID=1 router ба админы suggestions router-т ХОЛБОГДООГҮЙ — тусдаа модуль.
- **Хавсралт = ХУВИЙН R2 `FEEDBACK_BUCKET` (`mgl-engineering-feedback`)**, `/media`-д ХЭЗЭЭ Ч биш; staged draft → attachment (энгийн ≤ 25 MiB
  нэг PUT, RVT/RFA/ZIP 8 MiB-ийн multipart) → complete → submit; хүсэлтэд ≤ 5 файл, нийт ≤ 100 MiB; татах нь зөвхөн
  `GET /inbox/:id/attachments/:aid` (reviewer).  Хаягдсан/хугацаа дууссан upload-ыг cron-ын fail-safe салаа цэвэрлэнэ (ШИНЭ cron илэрхийлэлгүй).
- Add-in: modeless цонх (баримтгүй ч ажиллана, лицензийн хаалтгүй), онош `mgl-diag/1` (Revit он/build, DLL зам/хувилбар/SHA-256, үе шат,
  exception; нууцыг далдлана, ≤ 64 KiB), офлайн outbox `%APPDATA%\RevitMcpAddin\feedback` (host+tenant+хэрэглэгчээр, процессын түгжээтэй,
  `client_request_id`-аар идемпотент, backoff).
- Тест: backend `routes/engineeringFeedback.test.ts` 18, add-in `tests/Feedback.Tests` 28; headless-Chrome E2E 31/31 (локал wrangler + prod-хуулбар D1).
  **Prod-д: R2 bucket үүсээгүй, 0410–0414 хэрэгжээгүй, worker/Pages deploy хийгээгүй.**  Deploy дараалал: `wrangler r2 bucket create
  mgl-engineering-feedback` → D1 0410–0414 (0414 нь холболтыг тулгаад бичнэ) → worker → Pages.  Явцын бүртгэл `docs/engineering-feedback/CHECKPOINT.md`.

## Security posture — known open items

These are documented, not fixed. Don't make them worse; ask before "fixing" one, since some are load-bearing.

1. **A live Cloudflare API token is committed** at `.claude/settings.local.json` (in history since `74ce74e`), and `.claude/` is **not** in `.gitignore`. That token can deploy the Worker and read D1 + R2.
2. **`GET /media/:key` is world-readable by key with no auth** — including every synced email body and attachment under the `email/` prefix. The one-path-segment match is simultaneously a security control (`authorSupervision.ts`'s `isMediaUrl` depends on it) and the cause of the broken `generate_report` URL. Never put a private object in `MEDIA_BUCKET`; that is what `MEETING_BUCKET` + the signed `/meeting-audio` route are for.
3. **`GET /api/documents` and `/api/documents/:id` have no membership or role gate** — any authenticated **staff** user can read every document, revision and comment in the firm. ~~including a client~~: since 2026-09-07 `lib/clientScope.ts` 403s the `client` role on every `/api` prefix outside the portal's allowlist, so the client half of this leak is closed; the staff-level openness stands.
4. Several project-scoped GETs have no access gate **for staff**: `/api/progress/task/:taskId` and the `/api/blocks|drawings|components|tasks` list endpoints. For the `client` role both halves are now closed: `lib/clientScope.ts` 403s those prefixes outright, and `/api/projects/:id/activity|members|client-logo` call `guardClientProject()` (2026-09-07). Any *new* `/api/projects/:id/*` route must call it too — the prefix itself is open to clients.
5. The `worker` MCP bypass and the `seesPending` MCP leak described above.
6. `lib/jwt.ts` verifies signature and `exp` only — no `alg` check, no purpose validation, no revocation.
7. **`employee_hr.pc_password` is stored in plain text by the owner's explicit decision (2026-09-15)** — it is the employee's Windows login, typed in by admins, not a system credential. The only reader is `GET /api/reports/employees/:id/hr` (`requireAdmin`); it must never be joined into `GET /api/users`, MCP tools, or logs.
8. `revit-mcp/server/` exposes `run_revit_code(code)` over an **unauthenticated** localhost `HttpListener` that Roslyn-compiles and runs C# inside a live Revit transaction, on the same PC that holds a ~1-year production API token.

### MGL AI — `ai/norm-dataset`: нормын canonical dataset, L0 бүртгэл, БНбД 31-17-10 (2026-09-16)

`highrise_ai_dataset_v1/` санал (33 KB скелет) нь **`ai/norm-dataset/`** болж одоо байгаа дэд бүтэц дээр СУУСАН —
хоёр дахь систем БИШ.  README нь `ai/norm-dataset/README.md` (хэмжсэн тоо бүр тэнд).  Load-bearing зүйлс:

- **Таван давхарга нэг газар.**  L0 = `registry/norms.jsonl` (ҮҮСГЭГДСЭН: `norms.seed.jsonl` гараар + `mcis_verification.json`
  MCIS бүртгэлээс + `documents/*/metadata.json`) → локал сангийн **`ai_norm_registry`/`_terms`/`ai_norm_references`** (schema.sql-д
  `CREATE TABLE IF NOT EXISTS`, **SCHEMA_VERSION 3 хэвээр** — одоо байгаа сан дахин баригдахгүй; `db.ts` DERIVED_TABLES-д орсон).
  L1/L2 = `documents/<Doc>/{source,parsed,tests}` → `pack/` → шингээгчийн **8 дахь профайл `clause_document`**
  (`norm-dataset.pack.json`-оор танигдана; `clauseRulesChunks` + `legalinfoNumericRows` адаптеруудыг ДАХИН хэрэглэнэ).
  L3 = хэвээр `backend/src/lib/mglai/norm` (31-17-10-д гүйцэтгэгдэх томьёо 0).  L4 = `training_ready/` — ХЯНУУЛАХ л, сургалт хийгээгүй.
- **Төлөв ХЭЗЭЭ Ч таамаглагдахгүй.**  `ACTIVE` зөвхөн `tools/mcis_verify.py`-ийн (POST `mcis.gov.mn/mn/getNormList`) «Хүчин
  төгөлдөр» мөрөөс; олдохгүй код `CANDIDATE_NEEDS_STATUS_CHECK`; төсөл `DRAFT` + `retrieval_default:false` (өгөгдмөл хайлтад
  гарахгүй, `include_non_current` ил асуувал л).  2026-09-16: 49 норм = 29 ACTIVE · 19 CANDIDATE · 1 DRAFT (**БНбД 31-17-23** —
  MCIS-ийн 2022-10 PDF, батлах тушаалын мөр хоосон, бүртгэлд байхгүй; ХЭЗЭЭ Ч current гэж үйлчлэхгүй).
- **Автоматаар задалсан текст = `official_pdf_text_layer_auto_extracted`** (`rules.ts` KNOWN_NON_EXECUTABLE).  MCIS-ийн албан PDF-ийн
  текст давхарга (**Arial Mon хөрвүүлэлт**: Latin-1 0xC0–0xFF → cp1251, є/ї → ө/ү; `tools/parse_pdf.py`, pymupdf) — хайгдана,
  хуудас + https URL-тай эшлэгдэнэ, гэвч тоон мөр `ai_rules`-д ОРОХГҮЙ (`ingest.ts`: гүйцэтгэгдэх төлөвтэй л орно).  Хэмжсэн шалтгаан:
  46 auto-дүрэм оруулахад хоолой тэднийг эшлэлийн эх болгож (4.6-ийн асуултад 10.6) эшлэлийн таарц 36 % байв.
- **`pipeline.ts`: дүрэм ЗӨВХӨН толгой хэсгийн баримтаас.**  Дүрэмгүй баримт (L1/L2 шингээлт бүр ийм) орж ирэхэд өөр баримтын
  (21-04-05 хүснэгтийн мөр, 11-08-23 11.5.7) дүрэм эшлэлийн толгойг булаадаг байв — 36 тестийн 28-д.  Бүтэн корпус: Recall@5 ба
  дүрмийн таарц ЯГ хэвээр (2854 бусад баримт, 878/972, алтан 97/111), эшлэл 92.0 → 92.6 %.  `search.ts`: «5.1-р хүснэгт» гэх
  цэгтэй дугаарыг `section_path = 'хүснэгт 5.1'`-ээр бүтэцтэй хөл олно (FTS «5.1»-ийг «5» «1» гэж тасалдаг).
- **Runtime**: `/norm` → `registry` блок (нэрлэсэн баримт санд байхгүй ч бүртгэлд байвал код/нэр/төлөв/холбоос, `deep_ingested:false`;
  + асуултын баг/сэдвээр LINKS_ONLY жагсаалт), `POST /norm/registry`, `/norm/info` → `norm_registry`.  Worker: `localNorm.ts`
  `parseLocalNormRegistry` цагаан жагсаалт (https л, ≤8 мөр) → `/context` diagnostics `local_registry`.  **Prompt/гэрээнд ХАРААХАН
  ОРООГҮЙ** — чатанд бүртгэлийн холбоос харуулах нь tfc гэрээний өөрчлөлт, тусдаа хянуулах ажил.
- **Хаалга** `npm run ai:norm:gate -- <doc>` → `GATE.json`; дүн ГУРВАН утгатай: NOT_GOLD · **GOLD_CANDIDATE_PENDING_HUMAN_VERIFICATION**
  (31-17-10 одоо) · GOLD (хүн заалтуудыг хуудасны зурагтай тулгаж төлөв солисон).  «GOLD» гэж auto-текстэд бичихгүй.
- Шалгалт: `retrieval/test/{registry,clauseDocument}.test.ts` (18), backend `localNorm.test.ts` (3); `ai:test` 260/260 (retrieval +
  norm-compiler + runtime).  `evaluation/parity` ба `redaction.test.ts`-ийн унасан тестүүд нь `node_modules` type-stripping орчны
  асуудал (өмнөх), энэ ажилтай хамааралгүй.  ⚠️ 2026-09-16-нд deploy / commit ХИЙГЭЭГҮЙ байсан; код нь 2026-09-18-нд коммитлогдсон (L0/L1 бүртгэл f54f1c1…, pack + L2 7c242ff0/2fc6712f — доорх хэсгүүд), ажилтны сан ХӨНДӨГДӨӨГҮЙ (бүх хэмжилт scratchpad хуулбар,
  runtime 39317 тусгаар порт дээр).  Дараагийн P0: ишлэлийн графаар **БНбД 20-04-17** (2.01.07-90-ийн залгамж, 7 заалт) →
  **БД 43-102-07** (11 заалт, бүртгэлд шалгагдаагүй) → **БНбД 41-01-11**.
- **БНбД 20-04-17 «Ачаалал ба үйлчлэл» — ажилтны (энэ PC-ийн) санд ШИНГЭЭСЭН (2026-09-21).** Эзний тавьсан PDF нь MCIS-ийн
  албан PDF-тэй байт-ижил (sha256 тулгасан), тушаал 117/2017 нь 2.01.07-90-ийг хүчингүй болгосон → бүртгэлд `БНбД 2-01-07-90`
  `SUPERSEDED` (`status_override` + албан бичвэрийн нотолгоо; `/norm` → `named_document_absent`).  203 заалт (үсэгтэй хавсралт
  «Б.1.1»), 73 хүснэгт, 8 хуудас ЗУРГААР (γf хүснэгт алга — хариулт тоо хэлэхгүй), хуудасны дугаар хоёр систем (`page_number_mode:
  top_of_page`).  Гейт GOLD_CANDIDATE_PENDING_HUMAN_VERIFICATION (36/36, RUNTIME PASS).  Хамт: 31-17-10-ийн 593 L2 тайлбар анх
  удаа амьд санд (`ai_norm_explanations` тэнд байгаагүй), 11-106-25 + 11-03-02 (дээр).  **Хайлтын гурван засвар** (12 хуучин
  баримтын нэг ч тоо буураагүй): `extractDocRef` «7.1-р хүснэгт» → `table:1` гэж уншиж СНиП-ийн 1-р хүснэгт татдаг байсныг
  зогсоов; бүтэцтэй хөлд цэгтэй/үсэгтэй хүснэгт заалтаас түрүүлнэ; **FTS-ийн alias өргөтгөл ≥5 канонд хуваалцсан ерөнхий alias-аар
  («орон сууц», «sprinkler» 89 мөр) ах дүүгээ татахгүй** (`maxCanonicalsPerAlias: 4`) — өмнө нь «Орон сууцны хучилтын ачааллын
  нормын утга?» гэхэд галын дохиоллын мөр «verified» гарч 8.3-р хүснэгт огт ирдэггүй байв (ажилтны сан дээр ч).  Корпус 15 баримт:
  Recall@5 94.8 % (3167/3339; хуучин 12 нь 2886 → 2889), алтан 106/121, гоожилт 0.  Дэлгэрэнгүй `ai/norm-dataset/README.md`.
  Cloudflare deploy, сургалт, ажилтны PC-ийн release ХИЙГЭЭГҮЙ; runtime `ai:start`-аар шинэ кодоор асаасан.  ⚠️ Зэрэгцээ сесс
  БНбД 41-01-11-ийг ижил парсераар бэлтгэж байна (README-ийн дараагийн хэсэг) — `parse_pdf.py` хоёр сессийн өөрчлөлтийг хамт тээнэ,
  20-04-17/31-17-10-ийн `parsed/` байт-ижил гэдгийг хоёулаа хэмжсэн.

### MGL AI — L1 сэдвийн чиглүүлэгч: «ямар норм байна» → ОЛОН баримт (2026-09-18)

Багц `MCIS_NORM_REGISTRY_L1_TOPIC_ROUTER_2026-09-18` → `ai/norm-dataset/{router,registry/cdc-2025,evals/topic_router}` (sha256
провенанс `router/PACKAGE.json`; `data-train-files/` gitignore хэвээр).  Дэлгэрэнгүй `ai/norm-dataset/README.md` «L1».

- **Баримт ОЛОХ давхарга, заалтын хайлт БИШ.**  `ai/retrieval/src/topicRouter.ts` нь багцын `router/topic_lookup.py`-той
  **байт-ижил** (92 acceptance кейсийн ЭРЭМБЭЛСЭН registry_id, `retrieval/test/topicRouter.test.ts`).  Ганц зориудын зөрүү:
  морфологийн нөөц (`stemFallback`) — жишгийн дэд мөрийн таарц «дохиоллын» ← «дохиолол»-ыг олдоггүй байсан.  2025 оны
  бүртгэлийн мөр нь ЗААЛТ БИШ — эндээс тоо/заалт/хүснэгт ХЭЗЭЭ Ч гарахгүй.
- **Upsert, давхардалгүй, төлөв дээшлэхгүй.**  `ingestRegistry(…, { l1 })`: куратор `norms.jsonl` (49, MCIS ACTIVE) эхлээд,
  багцын 524-өөс код/alias-аар таарсан 31 нь НЭГТГЭГДЭНЭ (төлөв/нотолгоо/холбоос кураторынх хэвээр), 493 шинэ
  `STATUS_REQUIRES_VERIFICATION` (+1 SUPERSEDED БД 11-106-08 → БНбД 11-106-25).  Шинэ мөр ХЭЗЭЭ Ч ACTIVE биш.  5 шинэ
  хүснэгт (`ai_norm_registry_l1`, `ai_norm_topics`, `ai_norm_topic_aliases`, `ai_norm_topic_assignments`,
  `ai_norm_building_overlays`) `CREATE TABLE IF NOT EXISTS`, **`SCHEMA_VERSION` 3 ХЭВЭЭР** (ажилтны сан дахин баригдахгүй).
- **Төсөв 81-… / хөдөлмөр 83-…** энгийн зураг төслийн асуултад ОРОХГҮЙ (`scope_classes`), «төсөв/өртөг/хөдөлмөр» гэж ил
  асуувал орно.  Холбоос ХЭЗЭЭ Ч null биш (official_pdf → detail → source; куратор мөрөнд MCIS PDF).
- **Runtime**: `/norm` → `registry.topic_router`, `POST /norm/registry` → `topic_router` (бүх мөр, `include_cost/labour`),
  `GET /norm/topics`, `/norm/info` → `topic_router` тоо.  **Worker**: `localNorm.ts` цагаан жагсаалт (≤60 мөр, https л,
  `statusVerified` = ACTIVE л — runtime-ийн туг ҮЛ тоогдоно); `lib/mglai/normDocuments.ts`: олох асуулт
  (`isDocumentDiscoveryQuestion` — норм/дүрэм/баримт гэсэн ч хэд вэ/тоо/заалт/хүснэгт асуугаагүй) + детерминист шийдвэргүй
  ээлжид синтетик `norm_documents` хэрэгсэл prompt-д (≤15 мөр, `count` бүтэн), гэрээ `norm_documents` (grounded/medium,
  баримт бүр mustMention, тоо ЗӨВХӨН хайрцгаас, трейлер = «N нь шалгагдаагүй»); заалтын нотолгоо олох горимд prompt-д
  ОРОХГҮЙ; `norm_refusal` энэ горимд ГАРАХГҮЙ.  Хэмжсэн (scratch runtime :39317): ӨМНӨ нь энэ PC-д бүртгэл огт
  шингээгээгүй (503), чат `norm_legal_review` + хамааралгүй 21-04-05 өрөөний мөрүүд; ОДОО 11 / 3 баримт.
- **⚠️ Жагсаалт ДЕТЕРМИНИСТ Л — `trusted_contract.templateOnly` (2026-09-18, бодит чатанд хэмжсэн).**  8B+адаптер 0.4
  жагсаалт «дахин бичихдээ» холбоос орхиж («[холбоос]»), `*` алдаж, БД 43-102-07-г «MCIS-хүчинтэй» гэж дээшлүүлж, «одоогоор
  хүчингүй нь 2» гэж зохиож 23 с зарцуулав — validator код л шалгадаг тул өнгөрсөн.  Одоо `packages/mglai-common` engine
  `templateOnly` бол `/generate`-ийг ОГТ дуудахгүй (`fallbackAnswer` = template + трейлер, `contractDiag.final='template'`,
  ~250 мс); хариулт = `renderNormDocuments` markdown хүснэгт `| № | Код | Нэр | Төлөв | Холбоос |` (БҮХ мөр — Worker parse
  тааз 160, prompt-ын хайрцаг ≤15 хэвээр; эрэмбэ норм → MNS → кодгүй; холбоосын шошго MCIS PDF / MCIS / legalinfo /
  Бүртгэл х.N; төлөв НЭГ үг «MCIS-хүчинтэй / ШАЛГАГДААГҮЙ / СОЛИГДСОН→код» + legend нэг удаа — урт хэллэг мөр бүрд
  давтагдвал хөтчийн `dedupeSentences` 2 дахь мөрөөс хасдаг, `dataset_lint` 4-грам унагадаг).  Трейлер template-д ОРОХГҮЙ —
  гэрээний `trailerText`-ээр нэг удаа (өмнө нь хоёр удаа гарч байв).  Engine: `NORM_EVIDENCE_MISSING` notice
  («эх сурвалж олдсонгүй») жагсаалттай ээлжид гарахгүй; `/messages` `contract_diag.legacy='norm_documents'` → шошго
  «Нотолгоотой» (өмнө нь «Нотолгоо хүрэлцэхгүй» гэсэн хуурамч улаан шошго).  Парите харness INTENTIONAL-4 (`contract_diag.legacy`).
  Тест: `production-readiness/suites/streaming-faults` 17, `normDocuments.test` 7.  Хуучин хөтөч (templateOnly мэдэхгүй)
  validator A3-аар template руу унана — хоёр зам нэг үр дүн.
- **Сургалт**: багцын `topic_router_train.jsonl` нь `[ROUTER_RESULTS]` хэлбэртэй — serving-v2-тэй ТААРАХГҮЙ (skew) тул
  `excluded_from_training`; ижил зан төлөвийг `build_behavior_sft.mjs` `norm-documents` гэр бүл (10) serving-ийн ЯГ хэлбэрээр;
  92 кейс + багцын val/test `eval`-д (`ai:train:split` 0/0).  Сургалт, deploy, ажилтны сангийн ingest ХИЙГЭЭГҮЙ.

### MGL AI — L2 норм ОЙЛГОХ давхарга: заалтын тайлбар, зөвхөн БНбД 31-17-10 (2026-09-18, L2.1 хатуужуулалттай)

`ai/norm-dataset/documents/BNbD_31-17-10/l2/` (593 `clause_explanation`, HUMAN_VERIFIED 0) → `ai_norm_explanations` (`CREATE TABLE IF NOT
EXISTS`, SCHEMA_VERSION 3 хэвээр) → runtime `/norm.explanation` + `POST /norm/explain` → Worker `lib/mglai/normExplain.ts` (цагаан
жагсаалт → `templateOnly` гэрээ).  Дэлгэрэнгүй `ai/norm-dataset/README.md` «L2» ба «L2.1».

- **Тооцоо / ангилал / нийцэл БИШ** — бичлэг бүр `computable:false` (шингээгч `true`-г унагана); «хангах уу», «ямар ангилалд»,
  тоо+нэгж+«бол» асуултад L2 загвар СОЛИГДОХГҮЙ (`isComputationAsk`), трейлер «L3 ирээдүйд».  Хүчинтэй эсэх → бүртгэлийн зам.
- **Эх бичвэр хөдлөшгүй.**  `source_text` = `parsed/clauses.jsonl` ЯГ (sha256); семантик хүрээний өгүүлбэр бүр эх бичвэрт үг
  үсгээрээ; тоо ЭХИЙН ХЭЛБЭРЭЭР; үндэслэл/зорилго/төлөв ХЭЗЭЭ Ч зохиогдохгүй; хоосон хэсэг орхигдоно, тухайлан асуувал «эх бичвэрт заагаагүй».
- **L2.1 — validator PASS ≠ утгын ижилтгэл (хэмжсэн: Qwen ноорог 2.2-ыг урвуулсан ч тоо/код-ын validator өнгөрүүлсэн).**  Хоёр
  шатлалт: ЭХ → ХҮРЭЭ → НЭР ДЭВШИГЧ (`tools/gen-l2-candidates.mjs`, локал Qwen, инференс л; `l2/candidates.jsonl`) → **СЕМАНТИК
  ШАЛГАГЧ** `tools/l2-semantic.mjs` (claim-level, детерминист, 21 код: -гүй урвуулалт, заавал↔зөвшөөрөл↔хориглол↔зөвлөмж, нөхцөл/онцгой
  нөхцөл алдагдах–зохиогдох, «бүх»/«зөвхөн» хамрах хүрээ, субъект, тоо/нэгж/харьцуулалт/босго, «учир нь», «хүчинтэй», эхэд байхгүй
  агуулгын үг ≥2, өөр код, асуулт) → PASS → `plain_mn_candidate`; FAIL → детерминист fallback.  `status` = source_verification ·
  explanation_generation · semantic_validation · human_review (NOT_REVIEWED) · `candidate_policy: REVIEW_REQUIRED`.  593 ноорог:
  PASS 131 / FAIL 462; fallback 593/593 PASS.  ⚠️ PASS-ын санамсаргүй 12-ын 3 нь утгын дутагдалтай байсан → **нэр дэвшигч ХҮНИЙ
  хяналт APPROVED хүртэл үйлчлэхгүй** (`plain_mn` = fallback үргэлж; Worker `human_review === 'APPROVED'` шаардана).  Хүний хяналтын
  багц `l2/review/HUMAN_REVIEW_100.jsonl` (114, 15 давхарга, бүгд NOT_REVIEWED; хаалга ≥99 %, урвуулалт 0).
- **Хайлтын хоёр дахь систем БИШ** — `askNorm` олсон хэсгийн `chunk_id`-аар л (`retrieval/src/explain.ts`); баримтын цоож хэвээр;
  дугаар давхардал (үндсэн 8.3 ↔ 8-р хавсралтын 8.3) → үндсэн + ambiguity.  L2.1: НЭРЛЭСЭН баримт доторх түлхүүр үгийн дахин эрэмбэ
  (`rerankWithinDocument`, баримт-локал IDF; толгойд байхгүй түлхүүр + ≥1.5× оноогоор л солино) — paraphrase 13/14 → 14/14, `ai:eval:norm`
  ЯГ хэвээр (Recall@5 96.5 %, алтан 97/111).  «5.2-ыг тайлбарла» (заалт үггүй) ч нэрлэсэн баримтад яг заалт.  Нэр томьёо: 22
  тодорхойлолт заалтад давтагддаггүй → холбоос 0 (консерватив `l2-terms.mjs`), оронд нь `/norm` **definition горим**.  Ишлэл: хамрах
  хүрээтэй (хавсралт → үндсэн), 7 unresolved ТААМАГЛААГҮЙ («олдсонгүй — шийдэгдээгүй ишлэл»), буруу холбоос 0.
- **Follow-up** «энэ юу гэсэн үг вэ?», «яагаад?», «дээвэрт хамаарах уу?», «exception бий юу?» → `ConvState.norm.lastClause` +
  `turnEngine.followUpNormQuery` угтвар, `turn.ts` 6c `EXPLAIN_FOLLOWUP`; нормын төлөвгүй кодгүй асуулт 31-17-10-ыг ТААМАГЛАХГҮЙ.
  «Яагаад?» → «…инженерийн үндэслэлийг энэ заалт өөрөө тайлбарлаагүй» + эх сурвалж (§15).
- Хэмжсэн: `ai:eval:l2` 234 кейс / 45 ангилал → 234/234, хатуу 0 (зохиомол 0 · гоожилт 0 · эх сурвалж 100 % · цоож 100 % · утгын
  урвуулалт 0); тест `retrieval/test/{explain,l2Semantic}.test.ts` 19, backend `normExplain.test.ts` 12.  Сургалт, deploy ХИЙГЭЭГҮЙ;
  ажилтны сан хөндөгдөөгүй.
- **Хоёр дахь L2 норм — БНбД 20-04-17 «Ачаалал ба үйлчлэл» (2026-09-23)**, ИЖИЛ хоолой (баримтын тусгай код байхгүй).  Нэмэгдсэн ерөнхий
  ойлголтууд: `l2/{table,formula}_explanations.jsonl` + `cross_document_links.json` → derived `ai_norm_explanation_objects`
  (`computable = 0` CHECK, SCHEMA_VERSION 3 хэвээр; runtime `/norm/explain {table|formula}`, `/norm/info.explanation_objects`;
  Worker `l2Applies` нь `table|formula|classification` горимыг ч авна); ангиллын жагсаалт (`membership` — категори холилдвол хатуу
  алдаа); **албан тайлбар БД 20-102-21** (`commentary/`, COMMENTARY_SOURCE, норм БИШ — тусдаа «Албан тайлбарт … гэж тайлбарласан» блок);
  хуучин код БНбД 2.01.07-90 → 20-04-17 зөвхөн албан залгамжийн нотолгоогоор (эх ишлэл хэвээр).  Хэмжсэн: 270/270 + 31-17-10 234/234,
  хатуу 0; корпусын `ai:eval:norm` суурь хэвээр.  Дэлгэрэнгүй `ai/norm-dataset/README.md` «L2 — БНбД 20-04-17».  Ажилтны санд
  ШИНГЭЭГЭЭГҮЙ (release урсгалаар), deploy ХИЙГЭЭГҮЙ.

### MGL AI — мэдлэгийн сангийн каталог: «чамд ямар норм байгаа вэ» / «X юуны тухай вэ» (2026-09-18)

Хэмжсэн гажиг: «chamd ymar norm durmuud baigaa ve» → `NORMATIVE` («норм» түлхүүр үг) → локал `/norm` BM25 `insufficient_evidence` → загвар system prompt-ынхаа СҮҮЛИЙН мөрийг («Идэвхгүй хэлбэрээс идэвхтэйг илүүд үз.») цуурайтуулж «Эргэлзээтэй» гэж гарав. Асуулт нь заалтын БИШ, сангийн ЖАГСААЛТЫН асуулт — хайх зүйл алга, `ai_documents`-ийг жагсаах л хэрэгтэй.

- **`backend/src/lib/mglai/normCatalog.ts`** — `detectNormCatalogAsk` (ЦЭВЭР): `inventory` (нормын нэр үг + ямар/хэдэн/байгаа/мэддэг + СЭДВИЙН ҮГ ҮЛДЭХГҮЙ) эсвэл `document` (код + «юуны тухай/агуулга/танилцуул/гэж юу вэ» + сэдвийн үг үлдэхгүй). «Сургуулийн барилгад ямар норм байна» → null (чиглүүлэгчийн зам, `normDocuments.ts`); «БНбД 21-04-05-д галын дохиоллын тухай юу заасан бэ» → null (заалтын зам). `classifyIntent` 0-р алхамд **META**, `isNormativeQuestion` → `false` (эс тэгвэл `turnPlan.looksRegulatory` хатуу горим асааж татгалзлын гэрээ бичнэ). `depth.ts`: inventory → `detailed`, document → `normal` (META-гийн «1–3 өгүүлбэр, жагсаалтгүй» нь 11 баримтыг 2 болгож тайрдаг байсан).
- **Урсгал** = `tool_results`/`norm_answer`-ийн ИЖИЛ загвар: `/plan` → `ask_norm_catalog: {code|null}` → хөтөч/Revit (`packages/mglai-common` engine `runCatalog`, `RuntimeTransport.askNormCatalog?` — сонголттой, хуучин орлуулагч эвдрэхгүй) → ажилтны PC `POST /norm/catalog` (`ai/retrieval/src/catalog.ts`: `ai_documents` + `section_path`-аас код · нэр · төлөв · тоо · бүлгийн муж · хүснэгт · хавсралт; заалтын ТЕКСТ хэзээ ч гарахгүй; `« / »` зайтай заагчаар л хуваана — гарчиг дотор «гарц/шат» бий; хавсралт `(?!\p{L})`, ASCII `\b` биш) → `/context` `parseNormCatalog` цагаан жагсаалт → синтетик хэрэгсэл **`norm_catalog`** (`revit_selection`-ий ижил зам) → `groundingGuard` grounded + хайрцгийн тоо → `withNormCatalog` (guard-ын ДАРАА): детерминист template, баримт/бүлэг бүр `catalog_doc*` mustMention, document-д currentness note = `trailerText` (template-д давхардуулахгүй). Каталог ирээгүй бол `withNormCatalogUnavailable` — нормын үгтэй татгалзал, санахуйгаас жагсаалт зохиохгүй.
- **⚠️ Адаптер 0.4 жагсааж ЧАДАХГҮЙ (хэмжсэн, бодит Qwen3-8B, llama-server `/lora-adapters` scale 0 ↔ 1):** суурь 8B 11 баримтыг бүгдийг «• код — нэр (төлөв)» мөрөөр жагсаасан (17 с, нэг кодыг «11-03-22» гэж буруу бичсэн); адаптер 0.4-тэй нь «11 баримт байна» гэсэн 1–2 өгүүлбэр л (гурван удаа) — богино хариултын багц жагсаах чадварыг дарсан. Тиймээс `validator.ts` A2: `catalog_doc*` баримтын АЛЬ НЭГ нь дутуу → **ХАТУУ** зөрчил → серверийн бүрэн template (`final: template`); монгол хариулт өнөөдөр бараг үргэлж template, англи нь загварынх. Сургалтын тал: `build_behavior_sft.mjs`-д **`norm-catalog` гэр бүл** (10 жишээ, зохиомол код/нэр, зорилт = template ЯГ) — дараагийн адаптерт жагсаах зан төлөв орно; 0.4-ийг солиогүй.
- Шалгалт: `backend` `normCatalog.test.ts` (45), `ai` `retrieval/test/catalog.test.ts` (3, бодит 31-17-10 pack), `packages/mglai-common` 33; бодит E2E (backend :3010 no-AI scratch config + echo runtime :39327 каталогт + прод runtime :39217 үүсгэлтэд): inventory (mn-Latn/mn-Cyrl/en), document (УББ 12-01-01, БНбД 31-23-12, БНбД 21-04-05), not_found (БНбД 41-01-11), регресс «Галын гарц хэдэн байх ёстой вэ» NORMATIVE хэвээр. ⚠️ Deploy / commit ХИЙГЭЭГҮЙ; ажилтны runtime код (`/norm/catalog`) Session B release урсгалаар.

### MGL AI — эзний 11 асуултын прод тест → 9 гажгийн засвар (2026-09-18, хоёрдугаар хэсэг)

Эзэн дээрх каталогийн ажлын дараа прод дээр (адаптер 0.4) 11 тест асуулт явуулсан; зөв нь 4 (g→В2/В1, 25 °C→А, 35 °C→Б), бусад нь буруу. Бүгд ХЭМЖИГДЭЖ, дараах засвартай (`backend/src/lib/mglai/norm/followupRegression.test.ts` 12 тест бүгдийг хамгаална):

- **Өвлөсөн g нь дараагийн асуултыг булаадаг байв** (`norm/engine.ts`): «g=2500→В1» гэсний дараа «H=8 м үед хэсгүүдийн зай?» → дахин «В1»; «S=20 м² бол g хэд вэ?» (Q алга) → В1.  Одоо гэр бүлийг ЭНЭ ЭЭЛЖИЙН оролт (`curG`) сонгоно: зай → 18 м; Q дутуу → `insufficient_context` «Q хэрэгтэй».  `turnEngine.normTurnStateFrom`: шинэ Q/S хуучин g-г устгана, тооцсон g төлөвийн g болно (дараагийн «ямар ангилал?» шинэ g-ээр В3).  Өвлөсөн баримт код бүртгэлд байхгүй бол (УББ 12-01-01) хөдөлгүүрийг цоожлохгүй (энэ ээлжид ИЛ нэрлэсэн бол хэвээр цоожтой, P0-3).  `normEntities.ts`: «В2-ийн/V3-т» залгавартай ангилал танигдана → муж лавлагаа 1401–2200.
- **ГУАТ/ГМДХ** (БНбД 21-04-05): `intent.ts`-д «гуат/гмдх/галын дохиолол/гэрэлтүүл/люкс/хоногийн дотор/хоногийн өмнө/геодез/даамал/хэдэн … байх ёстой/хэд байх вэ/хэдэн давхар/ppm/IDA» нэмэгдэв («Архивт … ГУАТ уу?» нь «баримт»-аар DOCUMENT_ANALYSIS болж «ГМДХ = Гурван Мянган Дагуул Хадгалагч» гэж зохиож байв).  ⚠️ Барилгын ТӨРЛИЙН нэр («цэцэрлэг») ГАНЦААРАА hint БИШ — төслийн нэрэнд байдаг, засварын ээлжийг норм болгодог (SFT угсрагч барьсан).  `turn.ts` 6c: нормын ээлжийн ШУУД дараах богино нөхцөлт/тоотой «Архивт 200 мянган нэгж бол?» = FOLLOW_UP NORMATIVE.  Runtime `normalize.ts`: «N мянган нэгж» → `item_count`; `pipeline.ts`: эхний мөрийн ТООН нөхцөл биелээгүй бол ИЖИЛ дугаартай дэд мөр («27.1»↔«27.2») дундаас биелсэнийг сонгоно — ХАТУУ хязгаартай (оролт мөрийн өөрийн босготой тэнцвэл шилжихгүй: «28 м-ээс дээш орон сууц» мөрийг НЭРЛЭЖ байна); сул хувилбар голден дүрмийн таарцыг 73.5→68.8 % унагасан, хатуу нь 0 өөрчлөлт (Recall@5 2854 · rule 879 · citation 2738 · алтан 97 — суурьтай ЯГ ижил).
- **Локал нормын хариулт ЗАГВАРГҮЙ (`templateOnly`)** — `localNorm.ts` `localNormTemplate`/`localNormDeterministic`, `mglAi.ts` `withLocalNorm`: runtime `decisions` (өмнө нь Worker УНШДАГГҮЙ) → «Хатаалгын өрөө: ГУАТ — шаардлагатай; ГМДХ — шаардлагагүй (БНбД 21-04-05, Хүснэгт 4, х.11)»; `uncertain` → «шууд заалт олдсонгүй; хамгийн ойр: «…»; олдсон дүрэм нь барилгын өндөр (м) утгаас хамаарна» (түлхүүр → хүний нэр `MISSING_LABEL`); утга асуусан («хэдэн люкс», «хэдээр») + заалт асуулттай давхцаж тоотой бол заалт өөрөө хариулт (100 люкс, 18 °C); утга асуусан атлаа толгой заалт ТООГҮЙ бол «тоон шаардлага олдсонгүй»; `supported` → толгой + ижил баримтын 2 заалт мөрөөр.  Шалтгаан хэмжсэн: адаптер 0.4 заалтаас ЗОХИОДОГ («Гэрээний төлөвлөгөө байхгүй бол даамал хариуцлага алга», «хоёр долоо хоног» ← зөв 10 хоног) — тоогүй зохиомол өгүүлбэрийг validator барьдаггүй.  Нормын ТАТГАЛЗАЛ ч (`trustedFacts.ts`, ганц даалгаварт) templateOnly — канон өгүүлбэрийн ард агуулга зохиож байв.  `composeTemplate`-ийн «Хүний хяналт хэрэгтэй: **NEEDS_HUMAN_REVIEW**» гэх мэт ТӨЛӨВИЙН ENUM template нь эдгээр ээлжид ХАРАГДАХАА болив.  Трейлерийг template-д ОРУУЛАХГҮЙ — `fallbackAnswer`/`templateOnly` өөрөө залгадаг (давхардаж байв).
- **`clause_not_in_named_document`** («УББ 12-01-01-ийн 9.7 заалт?») → нотолгоо 0, канон татгалзал + trailer «УББ 12-01-01 санд байгаа боловч ийм дугаартай заалт түүнд алга» (өмнө нь ойролцоо заалтуудаар grounded).  **Validator**: бие хоосон + трейлер л үлдвэл fallback (өмнө нь «Анхаар: …» ганцаараа хариулт болж гарч байв).  **Каталог**: `templateOnly` бүх төрөлд; `not_found`-д канон өгүүлбэр hard mustMention + «гэдэг нь/зохицуулдаг» хориотой (агуулга зохиож байв).
- Готовность suite `cases/intent-routing.json`-ийн 3 кейс («X-д юу заасан/бичсэн бэ», «99-99-99 гэж юу вэ») META болов (баримтын тойм); `intent.test.ts`-ийн ижил мөр сэдэвтэй хэлбэр болов.  ⚠️ Deploy ХИЙГЭЭГҮЙ (peer сесс f54f1c1…d5f3790-ийг deploy хийсэн, эдгээр нь дээр нь uncommitted); runtime талын өөрчлөлт (`normalize.ts`, `pipeline.ts`, `/norm/catalog`) ажилтны/энэ PC-ийн runtime дахин асаагдтал хүчингүй.

### MGL AI — хүнлэг асуултууд HL01–HL10: маршрут, санамж, хайлт, хариултын хүрээ (2026-09-23)

Эзний 10 латин асуулт (`ai/training/humanized_review/cases-2026-09-23.json` — зөв хариулт, эх заалт, прод дээрх 0/10 хариулт ба хэмжсэн шалтгаан) прод дээр бүгд бүтэлгүйтсэн.  Загварын монгол хэл нь шалтгааны ЖИЖИГ хэсэг байв; ихэнх нь загварт хүрэхээс ӨМНӨ эвдэрсэн.  Засвар бүр тестээр цоожлогдсон (`backend/src/lib/mglai/humanizedTurns.test.ts`, `ai/retrieval/test/humanizedRetrieval.test.ts`):

- **Маршрут (`intent.ts`).** `normalizeLatinMongolian` нь ЖИЖИГ толь бичиг — «hiij», «chaddag», «zahialagch», «uureg», «yostoi» латинаараа үлдэж кирилл түлхүүр үгтэй хэзээ ч таарахгүй байв.  Одоо латин монгол / холимог асуултад кирилл түлхүүр үгсийг `foldText`-оор (хайлттай ижил дуудлагын түлхүүр) ҮГИЙН ЭХНЭЭС тулгана (`foldedHit`; англи асуултад ХЭРЭГЛЭХГҮЙ — «norm»↔«normal»).  Нэмээд `hitNormativeStructure`: оролцогч + үүрэг/эрх/хариуцлага («би захиалагч … гол үүрэг», өгүүлбэр хооронд ч), гадаадын + компани/байгууллага + зураг/барилга (явц/хугацааны үггүй), «хэдэн <нэгж> … ёстой», барилга/орон зай + «ёстой/заавал/зөвшөөрөгдөх» (ERP-ийн үггүй).  ⚠️ «өрөө» (`oro` → «орох»), «анги» («ангилал»), ганц «шат» («шатах») угтвараар ОРООГҮЙ.
- **Ярианы санамж.** (1) Локал нормын хариултын дараа `/context` нормын төлөвт баримт (+ ганц заалт харуулсан бол заалт) бичнэ — өмнө нь зөвхөн детерминист хөдөлгүүр ба L2 бичдэг байсан тул «яагаад заавал 2 удаа?» гэсэн дагалдах асуулт юуны тухай болохоо мэдэхгүй байв.  (2) `turn.ts` 6c: «Яагаад/Тэгвэл/Энэ …» гэж ЭХЭЛСЭН асуулт 8 үгээс урт ч FOLLOW_UP.  (3) `turnEngine.ts`: өмнөх баримтад ЦООЖЛОХ нь зөвхөн дагалдах асуулт эсвэл өмнөх ээлж рүү заасан (`refersBack`) асуултад — CONTINUATION («ижил салбарын ШИНЭ асуулт») цоожлогдохгүй (өмнө нь «авто угаалгын норм» СНиП-ийн ХАА-н үйлдвэрийн заалтаар хариулагдав).
- **Хайлт (`ai/retrieval`, runtime).** Recall@5 94.8 → 95.4 %, эшлэлийн таарц 92.5 → 93.9 %, дүрмийн таарц хэвээр (88.3 %), алтан 106 → 107, гоожилт 0, NO_MATCH 6/8 (`ai:eval:norm`, snapshot; 15 баримтын АЛЬ Ч хэмжүүр сууриас доош ороогүй).  `stem.ts` — монгол сул эгшиг/тохиолын залгаврын УГТВАР хувилбар («даамлыг» → `даамл*`, `даам*`; «зогсоож» → `зогсоо*`) FTS ба хамаарлын хаалгад (УББ 12-204-01 Recall@5 80 → 90.5 %).  `normalize.isInstructionWord` — «энгийн үгээр тайлбарлаад өгөөч», «удахгүй» FTS-д орохгүй.  `questionKind.ts` — асуултын хэлбэр → `ai_rules.rule_kind` («…чадах уу/эрхтэй» → эрх, «үүрэг» → үүрэг, «болж чадах/туршлага/шалгуур» → шаардлага, «хариуцлага»), ТОЛГОЙ БАРИМТ дотор тэр төрлийн заалтыг урагшлуулж, бүлэг дотроо асуултын ховор үг (гарчигтай нь) ба асуусан ҮЙЛДЭЛ («зогсоож» → 4.3/4.4, 4.9 биш) -ээр эрэмбэлнэ.  ⚠️ «шаардлага/шаарддаг», «заавал», «must», «requirement» дохио БИШ (58 ил хаягтай тест унасан — хэмжсэн), хүчин төгөлдөр байдлын асуулт ба ил хаяг (заалт/хүснэгт нэрлэсэн, бүтэцтэй хөл) ХӨНДӨГДӨХГҮЙ.  `sectionCandidates` — «X-ийн үүрэг/эрх» асуултад FTS-ийн эхний баримт дотор гарчиг нь тэр төрлийн үгтэй, асуултын ≥2 тусгай үгтэй таарсан бүлгийн заалтууд (УББ 12-01-01-ийн «Хоёр. Захиалагчийн үүрэг» заалтын биед «захиалагч» ч «үүрэг» ч байхгүй, `search_text`-д гарчиг ороогүй).  Латин монгол асуултын токены ФОЛД хэлбэр FTS-д (31-2x багцууд `text_latin`-гүй — «togloomiin», «tsag» нь `toglomin`, `cag`-тай таарахгүй байв).  Хугацааны нэгж (`cag`, `honog`, `minut`) фокус үг.  `citation.title_mn` — баримтын нэр (Worker хүнд эшлэлд).  **Томьёо толгойд байвал дүрэм эшлэлийг СОЛИХГҮЙ** — томьёоны хэсэгт дүрэм хэзээ ч холбогддоггүй (корпус дээр 0) тул дүрмийн гогцоо жагсаалтын гүнээс өөр заалтын дүрэм олж хуудсыг солидог байв («…Томьёо: V_{1T}=qT» → 4.2-ын хавхлага, х.5; хүлээгдэж буй х.9) — БД 21-101-12-ын эшлэл 67 → 85 %.
- **Хариултын хүрээ (`localNormFrame.ts` + `localNorm.composeLocalNorm`, загваргүй хэвээр).** Асуултын хэлбэр (яагаад / хүчинтэй юу / ялгаа / болж чадах / чадах уу / үүрэг) → эхний өгүүлбэр: «Тийм — эх сурвалжид дараах тохиолдолд ийм эрх…», «Энэ заалт шалтгааныг нь тайлбарлаагүй — зөвхөн …», «Тийм — X … жагсаалтад бүртгэлтэй» + хамрах хүрээ + «таны төсөлд …», «Одоохондоо үгүй — … 3 жил шаарддаг, таны 2 жил 1 жилээр дутуу» (`yearsGap`, зөвхөн хоёр ИЛ тоо), ГУАТ/ГМДХ нэр томьёо.  Заалт БҮТНЭЭРЭЭ (дундуур тасрахгүй), эх сурвалж нэг удаа төгсгөлд.  ⚠️ Танигдахгүй дутуу түлхүүр (`facility_volume_m3` г.м.) ДЭЛГЭЦЭНД ХЭЗЭЭ Ч гарахгүй.  `contentOverlap` фолдоор (латин асуулт ↔ кирилл заалт).
- **Хамгаалалт.** `smallTalk.ts`: «чи юу хийж чаддаг вэ» (+ «нэг ч зөв хариулт авсангүй» бол уучлал) → детерминист чадварын хариулт.  `groundingGuard.ts` 5-р алхам: нотолгоогүй GENERAL_HELP/DOCUMENT_ANALYSIS/CALCULATION гэрээ `grounded` (тоо шалгахгүй, `noMatch` → хуурамч нормын эшлэл + «норм дүрэм:», «…-ийн дагуу», «удирдамж» хэллэгтэй өгүүлбэр хасагдана; бүгд хасагдвал шударга template).  Шошго хөндөгдөхгүй — эдгээр санаанд `showConfidenceBadge: false`.
- ⚠️ Локал runtime-ийн (хайлт) өөрчлөлт нь Worker deploy-оор ИРЭХГҮЙ — runtime дахин асаах шаардлагатай (хөгжүүлэгчийн PC: `npm run ai:restart`; ажилтны PC: Session B release).  Хуучин runtime + шинэ Worker хамт ажиллана (`title_mn` сонголттой).
- **Прод дахин шалгалт (2026-09-23, deploy хийсэн Worker + энэ PC-ийн runtime + Qwen3-8B/адаптер 0.4, 10 асуулт нэг ярианд):** 10-аас 10 нь зөв эх сурвалжтай, зохиомолгүй детерминист хариулт (эхэнд 0/10).  Чанарын үлдэгдэл нь НАЙРУУЛГА (загварын A үүрэг): HL03 урт + дундуур тасарсан заалт, HL04 утгагүй удиртгал мөр («…дараах үндсэн шаардлага тавигдана.»), HL05 «Болно.» гэж эхэлдэггүй, HL10 «яагаад»-ыг тайлбарлахгүй (норм өөрөө тайлбарлаагүй).  Дахин шалгалтаас гарсан дөрвөн засвар: (1) `turn.refersBack` — урт асуулт ДОТОРХ «tegvel»/«tailbarlaach» өмнөх баримтад цоожлохгүй; зөвхөн эхэндээ холбогчтой эсвэл ≤8 үгтэй асуулт (HL05, HL06 УББ 12-204-01-д цоожлогдож даамлын эрхээр хариулагдав).  (2) `normDocuments.missingDiscoverySubject` + `mglAi.withSubjectAbsent` — «X барих гэж байна, ямар норм байдаг вэ» асуултад чиглүүлэгч сэдэв олоогүй, асуултын сэдвийн үг («авто», «угаалга») нотолгоонд огт байхгүй бол заалт харуулахгүй, «санд алга, зохиож хэлэхгүй» + MCIS (HL08: «барилга, барих, газар, шаардлага»-аар 31-17-10-ийн 6.1 «хамгийн ойр заалт» болж байв; хайлтын хаалга эдгээр үгийг ≤15 % тул «түгээмэл биш» гэж тоолдог).  (3) `mglAi.l2OffHead` — заалт нэрлээгүй (`nearest_clause`) L2 тайлбар хайлтын ТОЛГОЙ баримтаас өөр бол хэрэглэхгүй: runtime нотолгооны аль ч байрнаас L2 багцтай хэсгийг тайлбарладаг тул 3-р байрны 31-17-10 3.9 нь 11-03-02-ын хариултыг бүхэлд нь сольж байв (`l2Applies` мөр хөндөгдөөгүй).  (4) `normalize.foreignOrgExpansion` — улсын нэр + байгууллага («solongos kompani», «Хятадын компани») → «гадаадын» токен ба хэсэг ӨӨРӨӨ «гадаад»-тай байх зангуу (кирилл зангуу нь «компани» болж 11-03-02-ын бүх заалтыг хаадаг байв).  Мөн `intent.ts`: фолд давхар эгшгийг хураадаг тул «хаана» = `hana` = Revit-ийн «хана» — нийтлэг асуултын үгтэй давхцах түлхүүрийг фолдын замд алгасна (readiness intent-routing).  ⚠️ `GENERAL_HELP` одоо `grounded` (тоо шалгахгүй) — readiness `hallucination-contract` тест шинэ зан төлөвийг барина.  Дахин шалгах скрипт (хөтчийн engine-тэй ижил: templateOnly → template, бусад нь бодит `/generate` → гэрээ): сессийн scratchpad `hl-recheck.mjs` — `ai/evaluation/lib/e2e.mjs`-ийн GEN горим `templateOnly`-г ҮЛ ТООДОГ тул тэр горимыг шууд хэрэглэвэл хөтчөөс ӨӨР хариулт гарна.

### MGL AI — эзний бодит чат 2026-09-28: латин хэл таних, гомдол, цуурай, «тог ус», «хамгийн хэцүү норм»

Эзний 6 ээлжийн чат (прод, адаптер 0.4) — 4 нь буруу байсан; бүгд ХЭМЖИГДЭЖ загварт хүрэхээс ӨМНӨ засагдав.
Шалгалт: scratch Worker (`wrangler dev`, AI/browser binding-гүй тусдаа toml, локал D1 хуулбар) + echo runtime (өөр порт,
KB-ийн checkpoint хийсэн хуулбар) + хуваалцсан engine-ийн `runTurn` (хөтөчтэй ИЖИЛ зам) — 5/5 зөв, ярианы дунд ч.

- **Хэл (`lang.ts`).** «Mongold hudaldaanii tov barilaa gehed, tog us avah norm durem baidag uu» → тэмдэг үг 0 → `en` →
  АНГЛИАР хариулсан.  Тэмдэг үгийн жагсаалт хэзээ ч бүрэн болохгүй тул `mnMorphology` — монгол залгавар (-iin/-ii, -iig,
  -aar/-oor, -aas/-oos, -tai/-tei/-toi, -dag/-deg, -gui, -lj, -aad/-eed, -laa, -uud, эгшгийн араах -h/-hed) + төгсгөлийн
  «ve/be/uu» ≥2 бөгөөд англи туслах үгээс (`EN_FUNCTION`) давамгайлбал монгол.  ⚠️ «-san/-sen/-son», «-ood», «-ees»,
  «-vel» ЗОРИУД ХАСАГДСАН (person, good, employees, level); `EN_SUFFIX_EXCEPTIONS` (door, floor, engineer, need…).
- **Гомдол / дотоод заавар (`smallTalk.ts`).** «chinii Mongol helnii nairullaga muu ym» → GENERAL_HELP → загвар хэлний
  тушаалаа ҮГЧЛЭН буцаасан.  Шинэ төрөл `feedback_language` · `feedback_wrong` · `instructions` (фолдоор) — детерминист,
  👎 + зөв хувилбар бичихийг санал болгоно.  ⚠️ Тоо, нормын/төслийн үгтэй мессеж («hariult buruu, galiin norm hed ve»),
  засвар («буруу ойлголоо, Төсөл Бета»), нормын «аргачилсан заавар» ЭНД ОРОХГҮЙ.
- **System prompt-ын цуурайн хамгаалалт** (`packages/mglai-common` `stripPromptEcho`, engine-д бүх горимд, dedupe-ийн
  дараа): хариултын өгүүлбэр system prompt-ын ЗААВРЫН догол мөртэй ≥6 зэргэлдээ үгээр давхцвал хасна; хасагдсан нь
  үлдсэнээс олон бол гэрээний template эсвэл `echoFallbackText`.  ⚠️ Өгөгдлийн догол мөр (`Хэрэглэгчийн нэр:`,
  `ИДЭВХТЭЙ СЭДЭВ`, `ХЭРЭГЛЭГЧИЙН ТОХИРГОО`, `Одоогийн Revit контекст:`, синкийн огноо) ба тоотой цонх харьцуулагдахгүй —
  Revit сонголт, төслийн нэрийг иш татах нь ЗӨВ.  Гэрээний канон өгүүлбэр/template/trailer (`keep`) хэзээ ч хасагдахгүй.
  system prompt-д шинэ ӨГӨГДЛИЙН мөр нэмбэл `SYSTEM_DATA_PARAGRAPH`-д угтварыг нь нэм.
- **«тог», «ус», «дулаан», «бохир/канализац» (`ai/retrieval/src/topicRouter.ts` `colloquialTopics`).** Ярианы нэр —
  ФОЛДСОН БҮТЭН токен (дэд мөр БИШ: тог ⊄ тогтоол/тоглоом, ус ⊄ хус); зөвхөн морфологийн горимд (жишиг
  `stemFallback:false` = topic_lookup.py байт-ижил ХЭВЭЭР), exact alias-тай ХАМТ нэмэгдэнэ (жин 1).  Англитай давхцах
  үндсэн хэлбэр («us», «tog», «dulaan») англи туслах үгтэй латин асуултад тоологдохгүй; «дулаан хамгаалалт» hvac биш.
  ⚠️ Runtime код → хөгжүүлэгчийн PC `ai:restart`, ажилтны PC Session B release.
- **Барилгын төрлийн тайлбар (`normDocuments.ts` `buildingTypeGap`).** Олох жагсаалтын ӨМНӨ «Нормын бүртгэлд «худалдааны
  төв, дэлгүүр» гэсэн төрлийн барилгад зориулсан тусгай норм алга. Доорх нь … ерөнхий нормууд (сэдэв: цахилгаан, ус
  хангамж):» — төрөл (`BUILDING_TYPES`, фолдсон) асуултад байгаа ч үр дүнгийн аль ч баримтын нэрэнд байхгүй үед л.
  L1 сэдэвтэй төрөл (сургууль, цэцэрлэг, эмнэлэг, оффис, зогсоол) энд ОРОХГҮЙ.
- **Үнэлгээний жагсаалт (`normCatalog.ts` `rank`).** «hamgiin hetsuu norm durmiin jagsaaltiig beltge» → олох асуулт болж
  «энэ төрлийн барилгад норм санд алга» гэсэн хамааралгүй загвар гарсан.  Одоо каталог `{kind:'inventory', rank}`:
  `size` (хэцүү/төвөгтэй/том/урт) = хэмжээгээр (заалт + хүснэгтийн мөр) эрэмбэлж «хэцүүг хэмжих албан үзүүлэлт байхгүй,
  орлуулга» гэж ИЛ хэлнэ; `judgement` (чухал/сайн) = эрэмбэлэхгүй, шалтгаанаа хэлнэ.  ⚠️ `turn.ts` 2b: каталогийн асуулт
  нь ШИНЭ META ээлж — эс бөгөөс нормын жагсаалтын дараа «jagsaalt» үгээр REFERENCE_TO_PRIOR_RESULT болж NORMATIVE өвлөөд L2
  давхарга (31-17-10 14.1) хариултыг булааж байв (E2E-ээр л олдсон, unit тест ногоон байсан).  `subjectMissing` нь
  каталогийн ээлжид асахгүй.
- **Давхар notice.** Детерминист ТАТГАЛЗАЛ (templateOnly + refusal) аль хэдийн «олдсонгүй» гэж хэлсэн бол engine
  `NORM_EVIDENCE_MISSING` notice НЭМЭХГҮЙ (хэрэглэгч ижил мөрийг хоёр удаа уншиж байв).
- **Адаптер 0.5 (сургалт).** `train.ps1` npm-ээр дамжихад `-TrainArgs "--epochs 2 …"` хашилт задарч 09-21-ний 0.5 шууд
  унасан → `ValueFromRemainingArguments`.  Багц `behav-2026-09-28.6` (681; шинэ гэр бүл `complaint` · `prompt-probe` ·
  `vague`), тохиргоо 0.4-тэй ИЖИЛ.  `eval-candidate.mjs --api` (scratch backend порт).  Үр дүн: доор / `docs/mgl-ai/TRAINING.md`.
- Тест: `lang.test.ts`, `smallTalk.test.ts`, `normCatalog.test.ts`, `normDocuments.test.ts`, `humanizedTurns.test.ts`
  (backend 741), `packages/mglai-common/test/promptEcho.test.ts` (6), `retrieval/test/topicRouter.test.ts` (ярианы нэр).
- **A/B баталгаа (HEAD worktree :3188 vs шинэ :3187, ижил D1/KB хуулбар, `npm run ai:eval:replay`):** эзний 5 асуулт HEAD
  дээр яг прод шиг унав (англи хариулт, «санд алга», гомдол загварт), шинэ дээр 5/5 зөв; HL01–HL10 — 9 нь ҮГ ҮСГЭЭР ижил,
  HL08 зөвхөн давхар notice арилсан.  Хэлний шинэ таних: SFT-ийн 681 асуултад 24 засвар, 0 регресс.  Цуурайн хамгаалалт:
  өмнөх үнэлгээний 1763 бодит хариултад худал эерэг 0 (канон татгалзал нь «…эх сурвалж **одоогоор** олдсонгүй.» —
  `keep`-ийн 6-граммууд цуурайн олонлогоос хасагддаг).  `ai:eval:replay` = хөтчийн `runTurn` (templateOnly-г тоодог) —
  эзний чатыг давтах ЗӨВ хэрэгсэл; `lib/e2e.mjs` биш.

### MGL AI — интеграц, гэрээ, релизийн хаалга (Session D, 2026-09-11)

`ai/integration/` — A (норматив) · B (ажилтны платформ) · C (чанарын хаалга) гурвыг нэг хувилбарлагдсан бүтээгдэхүүн болгох
гэрээ/тест/хаалга.  Эзний логикийг ДАХИН БИЧДЭГГҮЙ.  `cd ai && npm run mgl-ai:verify` (`--full`, `--e2e`) →
`integration/reports/release-gate.json` (`mgl-ai-release-gate/1`): ангилал бүр (UNIT/INTEGRATION/E2E/MODEL_EVAL/SECURITY/
PERFORMANCE/INSTALLATION) ТУСДАА, `releaseReady` зөвхөн `--e2e` + blocking хоосон + эзний WIP merge хийгдсэн үед; хувь хэмжээ
ХЭЗЭЭ Ч тооцохгүй.  `npm run mgl-ai:merge-forecast -- --tree A=… --tree B=…` нь зэрэгцээ worktree-үүдийн давхцсан файлыг
эрсдэлээр ангилна (юу ч merge хийхгүй).  Гэрээний зураглал, эзэн бүрд шаардлагатай өөрчлөлт: `ai/integration/CONTRACTS.md`;
архитектур: `ai/integration/README.md`.  Хэмжсэн drift (2026-09-11): backend `RUNTIME_VARIANTS`-д `employee-8b-q4` байгаагүй
тул 8B-ийн хариулт бүр `ai_messages.runtime_variant = NULL` хадгалагдаж байв — зассан, `integration/test/drift.test.ts` барина.
⚠️ `retrieval/src/db.ts openKnowledgeDb` нь схемийн хувилбар зөрвөл ажилтны БҮХ мэдлэгийг DROP хийдэг — runtime-ийн
`SCHEMA_VERSION` өссөн релиз knowledge багцгүй тарж БОЛОХГҮЙ (`compat/matrix.ts` BLOCKING).
`backend/package-lock.json` — 2026-09-11 хүртэл `package.json`-той зөрсөн байсан (`npm ci` EUSAGE, `npm install` ERESOLVE). ХОЁР бодит шалтгаан, хоёуланг нь `--force`/`--legacy-peer-deps`-гүй засав: (1) `agents@0.15.0`-ийн ЗААВАЛ peer `ai@^6` + `react@^19` lock-д огт байгаагүй (хуучин install peer-гүй тавьсан), харин npm 11 нь optional peer `@cloudflare/ai-chat`-ыг latest 0.11.0-оор тооцож `@ai-sdk/react@4 → ai@7` гэж мөргөлдүүлдэг — 0.11.0 нь өөрөө `agents>=0.17.1` шаарддаг тул agents 0.15-тай НИЙЦГҮЙ; `overrides: {"@cloudflare/ai-chat": "0.8.0"}` (agents ≥0.14-тэй хамт гарсан хувилбар) нь optional peer-ийн гинжийг тогтвортой болгоно, ai-chat өөрөө СУУДАГГҮЙ, `ai@6`/`react@19` peer болж суудаг (bundle-д ордоггүй — `agents/mcp` л импортлогддог). (2) `@cloudflare/workers-types` нь 2026-08-13-нд 5.x болсон ч `wrangler` lock-д 4.83.0 (peer `workers-types@^4`) үлдсэн — `wrangler ^4.121.0` (5.20260804.1-тэй ХАМТ гарсан pair) болгов; workerd/miniflare 5.20260804.1(-alpha)/esbuild 0.28 дагаж бумпэлэгдэв. Нотолгоо: цэвэр `npm ci` 429 багц 12 с ✓, `tsc` ✓, `npm test` 1238/1241 (3 нь өмнөх), `wrangler deploy --dry-run` bundle ✓, `wrangler dev --local` boot ✓ (`/api/mgl-ai/health` 401). ⚠️ Дээрх «pinned wrangler (4.83.0) `pages *`-д CLOUDFLARE_ACCOUNT_ID-г ХАЙХРАХГҮЙ» гэсэн хэмжилт 4.121-д ДАХИН ХЭМЖИГДЭЭГҮЙ — `pages` тушаалд `npx -y wrangler@latest` зөвлөмж хэвээр.
- **Эцсийн нэгтгэл 2026-09-14 (`mgl-ai-integration-final`, Session D):** A `main`(a2f6c4b, 01c1166) → C `fda2875` → B `e9819a5`
  семантик шийдлүүд `ai/integration/CONTRACTS.md §5g–§5h`.  Шинэ гэрээ: runtime `/norm/info` → `schema_version`,
  `runtime_schema_version`, `knowledge_version` (`kf1:`), `documents[].dataset_sha256` (A-ийн `datasetIdentityOf`);
  Worker `GET /api/mgl-ai/norm-registry` (`routes/mglAiNormRegistry.ts`, `rf1:`); харьцуулагч
  `packages/mglai-common/src/normIdentity.ts`; B health `NORM_DATA_VERSION_MISMATCH` (`deployment/src/normVersion.ts`).
  Канон redaction: утасны regex ASCII үсэг-тооны хилтэй (SHA-256 доторх 8 орон утас БИШ, `REDACTION_REVISION = 2`).
  Fleet failures sync нь `diagTrustedSummaryProvider` (A `diag_json.norm` → B хураангуй).  Миграц B = 0295–0299.
- **`main`-д нэгтгэсэн 2026-09-14 (хөгжүүлэлтийн нэгтгэлийн milestone, merge commit `mgl-ai-integration-final`@68b869e).**
  ЭНЭ НЬ прод deploy / canary / `--remote` / прод миграц / push БИШ — тус бүр тусдаа зөвшөөрөл.  Төлөв:
  READY_FOR_INTEGRATION = true · READY_FOR_CANARY = false · READY_FOR_PRODUCTION = false (conv үүсгэлт 32/34,
  company 7/10, бодит цэвэр Windows reboot/canary хийгээгүй, прод Fleet/Feedback auth + миграц 0295–0299
  шалгаагүй, Session R тусдаа, `c:training-lint` output алга).
- **Баримтын бодлого:** «ажилтны PC-д `git pull` / `ai:ingest:norm` / `ai:restart`» гэсэн БҮХ заавар нь
  developer-only.  Ажилтны прод шинэчлэлт = Session B-ийн release манифест урсгал (stage → SHA → нийцэл →
  хувилбартай бүрэлдэхүүн идэвхжүүлэх → шаардлагатай бол runtime restart → health → smoke → lastKnownGood →
  унавал rollback), `docs/mgl-ai/OPERATIONS.md` толгойн блок + `DEPLOYMENT.md`.

### MGL AI — ажилтны PC-ийн суулгац, шинэчлэлт, флот, алдааны inbox (2026-09-11, Session B, салаа `mgl-ai-employee-deployment`)

Дэлгэрэнгүй `docs/mgl-ai/DEPLOYMENT.md`.  Код `ai/deployment/`, `backend/src/lib/mglai/{fleet,releases,improvement}/`, `backend/src/routes/mglAiFleet.ts`, миграц **0295–0298**, `frontend/src/features/mgl-ai-admin/`.

- **Ганц «хувилбар» байхгүй** — `app · runtime · model · knowledge · normRegistry · revit` тус бүр хувилбар + SHA-256 (`mgl-ai-release/1` манифест, `ai/deployment/src/manifest.ts` ↔ backend `releases/manifest.ts` ХОС схем).  Загварын шинэчлэлт мэдлэгийг дахин барихгүй, мэдлэгийн шинэчлэлт QLoRA шаардахгүй, UI-ийн засвар 5 GB татуулахгүй.
- **Хэмжсэн цоорхой:** `POST /runtime/heartbeat`-д ai/ ба frontend/ дотор **0 дуудагч** байсан (`ai_runtime_installs` хоосон); мэдлэгийн `.pack` татагддаг ч **шингэдэггүй**; bootstrap ба `start.ps1 -Supervise` **хоёр өөр супервайзер**.  Одоо: runtime доторх `DeploymentAgent` 2 мин/30 мин тутам `/api/mgl-ai/fleet/heartbeat`; `ai_fleet_devices` (0295) — хостын нэр/IP авахгүй, `installation_id` санамсаргүй UUID.
- **Хувилбартай хавтас + заагч** (`app/versions/<v>/` + `app/current.runtime.json`, `knowledge/versions/<v>/`): ажиллаж буйг хэзээ ч дарж бичихгүй; health унавал тэр релизийн БҮХ идэвхжсэн бүрэлдэхүүн буцна; `lastKnownGoodRelease` зөвхөн READY-ийн дараа.  `bootstrap.ps1` нь одоо заагч бичиж, Task Scheduler-ийн action-ыг `deployment\bin\supervise.ts` болгодог (lock + порт → давхар процесс үгүй, 5→60 с ухралт).  ⚠️ Windows: `spawn({detached, stdio:'ignore'})` хүүхэд эцэг гармагц үхнэ — stdio файл руу.
- **Health = тал тус бүр** (`LOCAL_AI · KNOWLEDGE · NORM · COMPANY_BACKEND · REVIT`, 14 шалгалт, шалтгаан-код): backend offline нь fatal БИШ (локал READY + backend OFFLINE = DEGRADED).  Норм дэд систем нь `NormSubsystem{Health,Version,SmokeTest}Provider` интерфейсээр — өнөөдөр `/norm/info` адаптер, тооцоолуурын smoke `skipped` гэж ИЛ; Session A гаргахад нэг функц солино.
- **Телеметри цагаан жагсаалт, хоёр давхарга** (`OFF/MINIMAL/QUALITY/DEBUG`; `FORBIDDEN_KEY_PARTS` клиент↔сервер ХОС).  Ярианы агуулга ямар ч түвшинд явахгүй; `first_token_ms` гэх түлхүүр «token» агуулдаг тул `ttft_*` болсон.  Диагностик багц өөрийгөө `findSensitiveKeys`-ээр шалгаж, нууц олдвол экспортлохгүй.
- **Ажилтны яриа ≠ сургалтын өгөгдөл** (0296): 👎 → `ai_failure_candidates` NEW → админ ангилна → `APPROVED_REGRESSION | APPROVED_SFT`; `NEW → APPROVED_SFT` шилжилт БАЙХГҮЙ, SFT нэр дэвшигч нь REDACTED + залруулгатай мөрөөс Л.  Санал хүсэлтийн хувилбарын тамга `ai_message_install_context` (0298) — `routes/mglAi.ts`-ийг хөндөхгүйн тулд тусдаа хүснэгт, хөтөч `FeedbackBar`-аас fire-and-forget.  Model промоушн (`PRODUCTION`) энэ шатанд 403.
- Шалгалт: `cd ai && npm run ai:deploy:test` (59) · `cd backend && node --test src/lib/mglai/{fleet,releases,improvement}/*.test.ts` (23) · `docs/mgl-ai/DEPLOYMENT.md` §5-ын бодит PC-ийн нэг шалгалт ҮЛДСЭН.  ⚠️ **Deploy, commit ХИЙГЭЭГҮЙ.**
- **Хатуужуулалт (2026-09-11, 2-р хэсэг):** runtime/мэдлэгийн шинэчлэлт → `/shutdown` → супервайзер заагчаас (`state/update.json` = зориудын гарц, ухралтгүй) → `/info.deployment.running` ≟ хүлээсэн → health → smoke → буцаалт (буцаалт ч унавал `ROLLBACK_FAILED`, `state/last-update.json`).  `deployment/test/restartChain.test.ts` — бодит процессууд, 7 хувилбар.  `installer/acceptance.ps1` (repo-гүй 15 алхам, Fixture горим амьд суулгацыг хөндөхгүй) — энэ PC дээр 11 PASS/0 FAIL/4 BLOCKED, бодит reboot ҮЛДСЭН.  `bootstrap.ps1` нь `-DataDir/-Port/-TaskName/-EngineEcho/-SkipNode/-SkipLlama` (зөвхөн harness) + `state/runtime-env.json` бичдэг.  P0-5: заагч/буцаалт зөвхөн `activation.ts` (`consolidation.test.ts` барина); `updater.ts` мэдлэгийг `activateKnowledge`-ээр.  P0-4: `improvement/trustedSummary.ts` адаптер — Session A-ийн TrustedNormResult-д холбох нь **Session D**.  2026-09-14 follow-up: загварын activate→smoke→rollback гинж ч `activation.ts switchModel`-д Л (updater.ts, server.ts `/model/activate` дуудна); редакц = `packages/mglai-common` канон (D), B-д regex үгүй; миграц 0295–0299.  Миграц 0299 (`running_versions_json`).  NAV өөрчлөгдсөн тул `gen:system-catalog` дахин үүсгэсэн.
