# MGL AI — Architecture

> **Status:** 1.0 under construction. Target launch **2026-09-24**.
> **Rule of this document:** it describes *this repository*, not a wish. Where the
> repo and this file disagree, **the repo is true** — fix this file in the same PR.
> Verified against the working tree on **2026-09-08**.

---

## 0. One paragraph

MGL AI is the AI operating layer for the MGL ERP. Its inference runs **locally on the
employee's PC** (llama.cpp + an open-weight ~4B model, GGUF Q4_K_M) behind a replaceable
`InferenceEngine` interface. Cloudflare stays what it already is — identity, permissions,
ERP truth, model release metadata, feedback storage — and is **never** the LLM. Every
factual claim MGL AI makes about the company comes from a typed ERP tool call or a
permission-filtered retrieval hit, never from weights.

---

## 1. What already existed before MGL AI (measured, not assumed)

This repo is **not** an AI greenfield. Building MGL AI as if it were would have duplicated
seven shipped subsystems. What exists:

### 1.1 The Revit assistant learning loop — shipped, ~60% of a feedback pipeline

| Concern | Where |
|---|---|
| Training corpus | `assistant_examples` (migration **0195**) — `text`, `text_folded`, `intent`, `slot`, `style` |
| Raw production usage | `assistant_logs` (**0195**) — prompt text, `predicted`, `confidence`, `decided_by`, `corrected`, `feedback ∈ {-1,1}`, `acted`, `curated` |
| Trust taxonomy | **0215** — `source_type` (8 values) × `review_state` (4 values) as **two independent axes**. Eligibility = `policy_allows(source_type) AND review_state IN ('reviewed','verified')` |
| Reviewer identity | **0214/0215** — `reviewed_by`, `reviewed_at`, `origin_log_id` |
| Model registry | `assistant_models` (**0195**) — `version`, `weights_json`, `accuracy`, partial unique index enforcing exactly one `is_active = 1` |
| Frozen eval gate | **0213** — `eval_json`, `eval_dataset_version`, `eval_passed`; `POST /assistant/models` 409s on `activate:true` with `eval_passed <> 1` |
| Authority ladder | `model_capabilities` (**0239**) + `lib/modelCapability.ts` + `lib/complianceAuthority.ts`; `MAX_GRANTABLE_AUTHORITY = 2` (RECOMMEND) |
| Training + eval code | `revit-mcp/training/` (Python, `train_intent.py`, `pull_and_retrain.py`), `revit-mcp/eval/` (`run_golden.py`, frozen `golden/*.json`) |

**The "model" here is a TF-IDF + logistic-regression intent classifier**, not a generative
LLM. It routes a Mongolian sentence to one of N Revit intents. MGL AI does not replace it —
that classifier is the **250 ms fast path** and stays exactly where it is.

### 1.2 The regulation / rule spine — shipped, empty by design

| Table | Migration | Note |
|---|---|---|
| `regulatory_documents` | 0220 | БНбД / БД / MNS registry: `doc_uid`, `code`, `edition`, `effective_from`, `status`, `artifact_id` |
| `rule_clauses` | 0220 | `clause_uid`, `document_uid`, `clause_no`, `page_no`, `table_no`, `text_mn`, `text_source` |
| `rules` | 0221 | `verification_state ∈ UNVERIFIED \| CLAUSE_CITED \| HUMAN_VERIFIED`, with a **DB CHECK** that a cited rule cannot exist without `clause_uid + edition_ref + effective_from` |
| `rule_deps`, `rule_conflicts`, `rule_test_cases`, `rule_pack_versions` | 0221/0222 | dependency index, conflict ledger, test cases |
| `compliance_findings`, `finding_elements`, `finding_edges`, `finding_teams` | 0224/0225 | findings + element links |
| `rule_run_ledger` | 0229 | which rule ran, against what |

Owner decision Ш4 (2026-08-31): **the owner supplies the official БНбД/MNS documents.**
Until then every rule is `UNVERIFIED`, which the schema forces to:
warning-only, `MODEL_DERIVED` evidence, and **no code/clause/title in the citation**.

**MGL AI's citation engine is a reader of this spine.** It does not invent a parallel one.

### 1.3 BIM event ledger — shipped

`bim_artifacts` (0201), `bim_sessions` (0202), `revit_transactions` (0203),
`revit_element_touches` (0204), `learning_events` (0205), append-only triggers (0206),
generated columns + indexes (0207/0209/0210), capture settings (0208).
Single write gate: `lib/bimEvents.ts` (enforced by `scripts/check-bim-events.mjs` and
`bimEvents.test.ts`). HTTP surface: `routes/learning.ts`, deliberately **never** exposed on `/mcp`.

Privacy invariant already in force: element-level activity is **self-view only**; every read
route is either scoped to `user.sub` or returns aggregate counters. MGL AI inherits this.

### 1.4 The thing MGL AI must replace

`backend/src/lib/revitAgent.ts` (462 lines) proxies one agent turn to
**`https://api.anthropic.com/v1/messages`** with `ANTHROPIC_API_KEY`, falling back to
Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. `routes/ai.ts` calls Workers AI
`@cf/meta/llama-3.1-8b-instruct` for Mongolian text polish.

Both are **paid, per-token, third-party inference**. They are the exact economic dependency
MGL AI exists to remove. Neither is deleted in 1.0 (deleting shipped, working features is
out of scope and would break `PolishableTextarea` and the add-in's `AgentChat`); they are
**re-expressed as `InferenceEngine` implementations** so the same call sites can be pointed
at the local runtime and the remote ones retired without touching business logic.

---

## 2. What genuinely does not exist (the MGL AI 1.0 build)

1. **Any local generative inference.** No llama.cpp, no GGUF, no model manager, no hardware
   detection, no local service. `ai/` did not exist.
2. **Chat.** No `ai_conversations` / `ai_messages`. The add-in's `Conversation.cs` holds a
   transcript client-side and re-sends it whole; nothing is persisted server-side.
3. **Retrieval / embeddings.** Zero vector index anywhere. `rule_clauses.text_mn` is stored
   but never searched semantically. Document search is SQL `LIKE`.
4. **Generative-model registry.** `assistant_models` stores classifier weights inline as
   JSON — wrong shape for multi-GB GGUF artifacts (D1 row limits, no checksums, no
   quantization field, no rollout state).
5. **Per-user AI memory.** None.
6. **A client-mode AI surface.** `clientScope.ts` closes everything by default; there is no
   allowlisted AI prefix.
7. **Offline cache with freshness semantics.** None.

---

## 3. System boundary — who computes what

```
┌────────────────── EMPLOYEE PC (Windows) ───────────────────┐
│                                                             │
│  Revit 2024/25/26/27 add-in (C#)                            │
│    IntentRouter (TF-IDF, 250 ms, UNCHANGED)                 │
│    RevitToolBus / ExternalEvent  ── typed Revit tools       │
│         │  localhost HTTP + install secret                  │
│         ▼                                                   │
│  ┌─── mgl-ai-runtime  (Node, 127.0.0.1:39217) ──────────┐  │
│  │  InferenceEngine  ─ LlamaCppEngine | EchoEngine       │  │
│  │  ModelManager     ─ manifest, SHA-256, versions       │  │
│  │  HardwareProbe    ─ VRAM / RAM / CUDA / cores         │  │
│  │  Retrieval (local hybrid: SQLite FTS + vectors)       │  │
│  │  Memory · Offline cache (encrypted)                   │  │
│  └───────────────────────────────────────────────────────┘  │
│         ▲                                                   │
│  Browser (ERP SPA) ── /app/mgl-ai chat panel                │
└─────────┼───────────────────────────────────────────────────┘
          │ HTTPS, bearer JWT (existing auth)
          ▼
┌────────── CLOUDFLARE WORKER (control plane, NOT inference) ─┐
│  authMiddleware → workerScopeGuard → clientScopeGuard        │
│                 → entitlementGuard → /api/mgl-ai/*           │
│  · identity + AI mode resolution   · permission profiles     │
│  · typed ERP tools (server-side)   · conversation ledger     │
│  · feedback + approval queue       · model release manifest  │
│  · rule / clause citation reads    · action audit            │
│  D1 · R2 · KV · Durable Objects                              │
└──────────────────────────────────────────────────────────────┘
```

**Hard boundary:** the Worker never runs an LLM and never proxies to an employee PC.
Client-mode inference runs in the **client's own browser** (WebGPU, MGL AI Lite) or degrades
to retrieval-only answers — never to a machine that must stay powered on.

---

## 4. Identity and mode — resolved server-side, always

`middleware/auth.ts` sets `c.var.user` from the **verified JWT** (`{sub, role, tid}`).
`lib/mglai/identity.ts` maps that to an `AiMode`:

| `users.role` | `AiMode` | Notes |
|---|---|---|
| *(no token)* | `client` | public knowledge only |
| `client` | `client` | plus their own org's published material |
| `worker` | `denied` | `workerScope.ts` allowlist does not include `/api/mgl-ai` |
| `engineer`, `architect`, `senior` | `employee` | |
| `admin` | `admin` | diagnostics, dataset approval, model release |

Three rules that are not negotiable and are unit-tested:

1. **A role in the request body is ignored.** `resolveAiIdentity()` takes the JWT payload
   only; there is no parameter that lets a caller assert a mode.
2. **Role is stale for up to 24 h** (repo-wide fact: role lives in the token, not the DB).
   MGL AI does **not** work around this — it inherits it, so an operational role change must
   still be handed to the user as "log out and log in again."
3. **`admin` ⊃ `employee` ⊃ `client`** is *not* assumed for data. It is assumed only for
   *capabilities*. Data access is re-derived per request from the ERP's own gates.

---

## 5. The confidentiality boundary

The governing sentence: **the model having seen something is not authorization to say it.**

Therefore MGL AI has one filtering law:

> Secrets are removed **before** context construction, never by asking the model to keep quiet.

Implementation: every retrievable record carries
`classification`, `visibility_scope`, `allowed_roles`, `project_scope`, `org_scope`.
`lib/mglai/visibility.ts` is a **pure** function `filterEvidence(evidence[], viewer) → evidence[]`
that runs *before* the prompt is assembled and is tested with a client viewer against
employee-classified rows.

Corollary, and the reason §35 of the mandate matters: **dynamic confidential facts are never
fine-tuned into weights.** Training teaches *behaviour* ("to answer a headcount question,
call `get_active_employees`"), never *values* ("there are 41 employees").
`ai/training/policy/` encodes this as a dataset lint that rejects examples containing
numerals bound to live ERP entities.

---

## 6. Knowledge split

| Layer | Holds | Changes by |
|---|---|---|
| **Weights** | Mongolian fluency, AEC register, tool-choice behaviour, refusal behaviour, citation habit | a release (1.0 → 1.1) |
| **Retrieval** | БНбД/MNS clauses, company documents, project documents, per-project context | ingestion |
| **Tools** | employees, projects, deadlines, tasks, workload, progress | live, every request |
| **Rule engine** | deterministic thresholds and formulas | `rules` table + human verification |

Arithmetic is **never** the model's job when a deterministic path exists. The rule engine
already exists in two places (`revit-mcp/addin/RuleEngine.cs` for in-Revit checks, the
`rules` table for the authored corpus); MGL AI calls them, it does not reimplement them.

---

## 7. Model strategy

- **Base:** an open-weight ~4B instruct model, GGUF. Candidate: Qwen3.5-4B-Instruct.
  **License is a release gate** — `ai/registry/LICENSES.md` must carry the resolved license
  text and an explicit commercial-use finding before any artifact ships. Until that finding
  is recorded, `ai/registry/models.json` marks the entry `license_cleared: false` and the
  ModelManager refuses to install it.
- **Quantization:** benchmark Q4_K_M / Q5_K_M / Q6_K on the reference machine
  (i7-12700KF, 21 GB RAM, RTX 3070 **8 GB VRAM** — confirmed present on the dev box).
  Q4_K_M is the starting default because a 4B at Q5_K_M leaves too little headroom for
  KV cache at 8 K context on 8 GB.
- **Runtime:** llama.cpp / CUDA first, behind `InferenceEngine`. `EchoEngine` is a
  deterministic no-model implementation used by tests and by first-run before any download.
- **Context:** start at **4 K**, benchmark 8 K. Retrieval + memory summaries instead of raw
  transcript dumps.
- **Client:** MGL AI Lite (0.8B–1.7B class) in-browser via WebGPU, same prompts, same
  citation rules, same feedback pipeline, **different weights** — recorded honestly as
  `runtime_variant`, never claimed to be the same model.

Naming: the product is **MGL AI 1.0**. The base model's brand is never the product name in
the UI; attribution lives in `ai/registry/LICENSES.md` and `docs/mgl-ai/ATTRIBUTION.md`.

---

## 8. Repository layout

```
ai/                              # new workspace, outside backend/ and frontend/
  runtime/       mgl-ai-runtime  — local Node service (engine, model mgr, HTTP)
  retrieval/     mgl-ai-retrieval— chunking, embedding, hybrid index (local)
  training/      mgl-ai-training — dataset export, QLoRA config, GGUF convert
  datasets/                      — versioned dataset manifests (data is gitignored)
  registry/      mgl-ai-model-registry — models.json manifest + licenses
  evaluation/                    — MGL AI golden set (separate from revit-mcp/eval)
  scripts/                       — ai:* command implementations
  research/tiny-transformer/     — educational, NOT on the 1.0 path
  docs/

backend/src/lib/mglai/           # control-plane logic, pure where possible
backend/src/routes/mglAi.ts      # /api/mgl-ai
backend/migrations/0268..0275    # reserved block
frontend/src/features/mgl-ai/    # chat UI
docs/mgl-ai/                     # this file + operational runbooks
```

`ai/` is deliberately **not** a workspace of `backend/` — the Worker must never accidentally
bundle a Node-only dependency, and `wrangler deploy` bundles the working tree.

---

## 9. Database — migrations 0268–0275

Written under the repo's measured D1 transport rules: **≤ 9 statements per file, no block
comments, no `;` inside string literals, every statement `IF NOT EXISTS`.**

| Migration | Adds |
|---|---|
| 0268 | `ai_conversations`, `ai_messages` + indexes |
| 0269 | `ai_feedback` + indexes |
| 0270 | `ai_model_releases`, `ai_runtime_installs` + indexes |
| 0271 | `ai_action_audits` + indexes |
| 0272 | `ai_user_memories` + indexes |
| 0273 | `ai_permission_profiles`, `ai_sync_state` + indexes |
| 0274 | `app_settings` seeds |

Naming is `ai_*` — deliberately distinct from the existing `assistant_*` (classifier) and
`bim_*` (event ledger) families, so a reader can tell in one glance which subsystem a table
belongs to.

**Not stored in D1:** embeddings. They live in the local retrieval index on the employee PC.
D1 holds the *document and chunk metadata* that authorizes a hit; the vectors themselves are
an implementation detail of the retrieval engine and would be both expensive and useless in
a row store.

---

## 10. Revit permission ladder

`lib/mglai/permissions.ts`, five levels, stored per user in `ai_permission_profiles`:

| Level | Meaning |
|---|---|
| `READ_ONLY` | inspection tools only — the default for every user |
| `SAFE_WRITE` | allowlisted reversible writes, each previewed |
| `CONFIRM_EVERY_WRITE` | any write, but always human-confirmed |
| `PROJECT_ADMIN` | expanded project tools |
| `FULL_AGENT` | approved actions without per-action confirmation |

Non-negotiables, unit-tested:
- **Nobody can raise their own level.** The grant route is `requireAdmin()`.
- **Roslyn `run_revit_code` is never reachable from the agent loop** at any level below an
  explicit admin developer flag. It stays what it is today: a developer tool.
- Default for a fresh user is `READ_ONLY`, and an absent row means `READ_ONLY`, not "unset".

---

## 11. Latency budget — what "~200 ms" actually means

| Stage | Target | Measured 2026-09-08 |
|---|---|---|
| UI acknowledgement | ≤ 200 ms | local orchestration only; not yet instrumented |
| Intent classify (existing) | ~1 ms warm | cold load 72.8 ms (pre-existing measurement) |
| Retrieval (lexical, D1) | ≤ 80 ms | not yet instrumented against production data |
| **First token — cold prompt** | ≤ 1 s | **671 ms** ✅ |
| **First token — warm prompt cache** | ≤ 1 s | **48 ms** ✅ |
| **Generation rate** | — | **26.6 tok/s** |
| Simple full answer (128 tokens) | ≤ 3 s | **5.5 s** ⚠️ **over target** |

**Reference machine:** i7-12700KF · 32 GB RAM · RTX 3070 8 GB · CUDA 12.6.
**Model:** Qwen3-4B-Instruct-2507 **Q4_K_M** (2.33 GB), all layers on GPU, 8 K context,
llama.cpp build **b10850** (win-cuda-12.4). VRAM in use: **2 559 MiB** — leaving ~5.6 GB
headroom, which is why 8 K context fits.

⚠️ **The 3-second target is NOT met for a 128-token answer.** 26.6 tok/s means a full
paragraph takes ~5 s. Two honest options, neither yet taken: shorten default answers (the
system prompt already says «товч»), or revise the target. **Do not report 3 s as achieved.**

✅ The 48 ms warm figure comes from llama.cpp's `--cache-reuse 256`. This is why the system
prompt must stay **stable across turns** — regenerating it every turn destroys the KV cache
and puts first-token back at ~670 ms. `MGL_AI_PROMPT_VERSION` changing is a release event,
not a per-request one.

No performance number enters the UI or docs until `npm run ai:benchmark` has produced it on
the reference machine. `ai/evaluation/benchmarks/` holds the results with hardware fingerprints.

---

## 12. Security model

Threats and where they are answered:

| Threat | Answer |
|---|---|
| Client extracts company data | `clientScope.ts` prefix gate + `filterEvidence()` before prompt assembly + separate client memory namespace |
| Prompt injection inside an ingested PDF | Retrieved text is wrapped as **data**, never as system turns; `lib/mglai/promptFrame.ts` is the only assembler and is tested against injection strings |
| Model calls an unauthorized tool | Server-side tool registry with per-mode allowlists; the model's chosen name is matched against the registry, never executed by reflection |
| Employee escalates own AI permission | Grant route is admin-only; profile is read from D1 per request, never from the token |
| Localhost API abuse by any web page | Install-time random secret + `Origin` allowlist + short-lived session token; bound to `127.0.0.1` |
| Poisoned training feedback | Feedback is never training data. It must pass `pending → reviewed → approved` by an admin, then enter a **versioned** dataset. |
| Forged citation | Citations are re-resolved server-side from `rule_clauses` / document ids; a citation the model emits that does not resolve is dropped, not displayed |
| Stale offline data | Every cached record carries `synced_at`; the UI states the timestamp and MGL AI is instructed to state it too |
| Malicious model artifact | SHA-256 in a manifest served by our own Worker; ModelManager refuses a mismatch and never installs over the running version |

Known open items inherited from the repo (documented, not introduced by MGL AI, and listed
in `CLAUDE.md` §Security): `/media/:key` is world-readable by key; `lib/jwt.ts` checks
signature + `exp` only; `revit-mcp/server/` exposes unauthenticated Roslyn on localhost.
**MGL AI's local service must not repeat the third one** — hence the install secret.

---

## 13. Build order (and what 1.0 actually promises)

P0 for 2026-09-24: local runtime · identity · chat UI · ERP tools · standards retrieval with
citations · offline cache · feedback + admin review · Revit read context · allowlisted safe
Revit action architecture · model version metadata.

P1 after: memory, workload analysis, report intelligence, model updater, QLoRA pipeline,
browser-local client inference, Revit change previews.

**1.0 does not promise fine-tuned weights.** It ships the unmodified base model behind our
own orchestration. That is deliberate: the mandate's own §61 says usable software precedes
specialized weights, and a fine-tune with no production feedback corpus would be guesswork.

---

## 14. Decisions log

| # | Decision | Why | Reversible? |
|---|---|---|---|
| D1 | Reuse `rules`/`rule_clauses` for citations instead of a new corpus | A second regulation store would fork the verification-state CHECK that makes citations trustworthy | n/a — reuse |
| D2 | New `ai_*` table family, not extensions to `assistant_*` | `assistant_*` is the classifier's registry; overloading it would break the single-active-model index and the golden-eval gate | yes |
| D3 | `ai/` outside the backend workspace | `wrangler deploy` bundles the working tree; a Node-only dep in backend's graph risks the Worker bundle | yes |
| D4 | Embeddings local, metadata in D1 | D1 row size + cost; vectors are engine-specific and must stay replaceable | yes |
| D5 | Keep `revitAgent.ts` (Anthropic) alive in 1.0, wrapped, not deleted | Deleting a shipped feature is outside the mandate's scope; the interface makes retirement a config change | yes |
| D6 | `EchoEngine` ships as a first-class engine | Tests, CI and first-run must work with **no** model on disk | yes |
| D7 | Default Revit level `READ_ONLY`, absent row = `READ_ONLY` | An absent row must never mean "unrestricted" | no — safety |

## 15. Universal company agent — Company Data Gateway + iterative research (2026-09-10)

**Why.** Measured on the working tree before this change (local backend + Qwen3-8B, admin
session): the ten acceptance questions split three ways. Count/deadline questions
(`how many projects`, `hamgiin oir deadline`) already reached `list_projects` /
`get_upcoming_deadlines` and answered from data. But three question *classes* had **no
capability at all**, and the model filled the gap from memory:

| Question | What happened | Root cause |
|---|---|---|
| `company huudas yu aguuldg ve` | invented «хувьцааны мэдээлэл, мөнгөний төлбөр…» | no system/site catalog tool; `GENERAL_HELP` → no tools |
| `hamgiin idevhtei ajilladag ajiltan hen be` | «хамгийн идэвхтэй нь senior (12)» — read off the *headcount by role* box | only `get_active_employees` (counts) existed; nearest tool ≠ right tool |
| `ene project yagaad udaad bna` | invented causes («хаалтын хүчний ачаалал») from a progress % | only `get_project_progress`; no task-level facts |
| §17 norm question | cited БНбД 11-01-98 / 11-02-97 as if current | local `/norm` returned `legal_review_required: true` and the server **dropped the flag** in `parseLocalNorm` |
| `system dotor heden tusul baina` after a deadline question | «19 төсөл» — the *page count* of `describe_system` | turn interpreter inherited the project subject; count question got a single-project tool |

So the failure was **not** intent gating in the strict sense — `classifyIntent` already defaults to
`GENERAL_HELP` — it was *one-shot planning over a tool set with holes*, plus a prompt that never
told the model what to do when the box lacks the answer.

**What exists now.**

```
/plan (round 0)  ──►  tools ‖ local /norm  ──►  /plan (round 1, prior_results) ──► tools … ──► /context ──► /generate
   planTurn + planResearch                        researchPlan.ts decides from PRIOR RESULTS      applyContract (trailers)
```

- **`lib/mglai/gateway/entities.ts`** — the capability catalog (§11): nine entities
  (`projects`, `tasks`, `employees`, `teams`, `progress_entries`, `attendance`, `asr_reports`,
  `meetings`, `repair_entries`), each with typed fields, filterable/sortable flags, allowed
  operations, per-mode visibility (entity *and* field level) and an **authoritative source**
  string. Row scope lives in the entity's own `FROM` (projects reuse `PROJECT_LIST_SQL`
  verbatim — not a twelfth copy; tasks/progress/ASR are `WHERE p.id IN (visible projects)`;
  `repair_entries` is own-rows-only outside admin). Sensitive columns (`password_hash`, `email`,
  device ids, IPs) are simply absent — an allowlist, not a denylist. `describeEntities(mode)`
  is what `GET /api/mgl-ai/capabilities` returns; it carries no SQL.
- **`lib/mglai/gateway/query.ts`** — the safe query DSL (§12):
  `{entity, fields, filters[{field,op,value}], sort, limit, group_by, aggregate}` →
  `compileQuery` validates every name against the catalog, coerces values by field type
  (`today±N` relative dates resolve server-side), binds every value, caps at 100 rows / 8
  filters / 20 `in` values, then `runQuery` executes. There is no path from a string to SQL.
  Pure and tested (`query.test.ts`).
- **Four new tools** (`tools/analytics.ts`): `describe_system` (role-filtered pages/sections
  from **`systemCatalog.generated.ts`**, generated by `backend/scripts/gen-system-catalog.mjs`
  from the frontend's `NAV_ITEMS` + `APP_SECTIONS` + i18n; `systemCatalog.test.ts` fails when
  it is stale), `get_employee_activity` (a *declared* analytical metric — `metric_definition`,
  `official_kpi:false`, `ranking_reliable`; widens 30→90 days once if the window is empty and
  says so), `analyze_project` (facts: overdue / stale-14d / unassigned / pending approvals /
  last activity / per-team overdue; `signals` marked `signals_are_inference`), and
  `query_entities` (the gateway itself, `json` param type).
- **`lib/mglai/researchPlan.ts`** — the multi-round planner (§13/§16). Round 0 = keyword tools
  + catalog entity discovery (a question with no keyword hit but an entity match becomes a
  `query_entities`), count-vs-subject disambiguation, activity/system/analysis rules. Round ≥1
  = dependent steps from prior results: nearest-deadline + «яагаад» → `analyze_project` on that
  project; deep research («судал», «bottleneck») → `get_overdue_tasks` + active projects, then
  the worst ≤3 projects analysed; an over-filtered `query_entities` that returned 0 rows is
  retried once unfiltered. Hard limits: 3 rounds, `max_tool_iterations` (profile, default 8).
  Intent is a hint, never a gate. Depth (`fast|normal|analysis|deep`) is reported for the UI.
  The browser (`orchestrator.ts` → `runResearch`) only loops; every decision is server-side.
- **Answer contracts grew two trailer kinds** (`answerContract.ts`, applied in
  `frontend/.../contract.ts`): `norm_legal_review` — when the local norm hit carries
  `legal_review_required`, the answer must end with «хүчин төгөлдөр байдал шалгагдаагүй …
  хүний хяналт шаардлагатай»; `analysis_metric` — when a tool returned `official_kpi:false`,
  the metric definition is appended. Both are deterministic because the 8B model measurably
  ignores the equivalent prompt instruction.
- **Prompt (`mglai-sys-4`)**: when a tool box is present, «numbers/names only from the box; if
  the box lacks it say the system has no such data; facts before inferences; no ranking when
  `ranking_reliable=false`». A separate line for historical sources.

**Acceptance (`cd ai && npm run ai:eval:company`, real chain, local D1 = Aug-2026 prod copy,
Qwen3-8B, RTX 3070):** 9/10 grounded; the one intermittent failure is the model tripping the
runtime's repetition guard on `ene project yagaad udaad bna` (`stop_reason: repetition`, which the
browser retries once). Latency: tools 60–290 ms, `/context` ~20 ms, generation 1–7 s.

**Known limits.** Only 2 of 4 345 tasks in production carry a `due_date`, so «overdue» is
data-poor — `analyze_project` leans on stale/unassigned/pending signals instead, and says so.
The local D1 copy has no activity after 2026-08-04, which is why the activity window widens
to 90 days there. The model is still not selecting tools itself (1.0 decision); the catalog
and `/capabilities` are the input a tool-calling fine-tune will train against.

## 16. Normative reliability hardening — deterministic engine, provenance-bound answers (2026-09-11)

**Why.** Phase-1 reproduction (real chain, Qwen3-8B, 20 GOLD questions on БД 21-101-12) measured
14 root causes: the document was never ingested; a document code in the question did not lock the
search; the runtime's `verified` meant "record verified", not "relevant"; citations were not bound
to the record that produced the number; there was no calculator layer (Q/S, 0.64·g·H², Vₐ, spacing,
0.8·V) so the model computed; the contract discarded correct calculations; follow-up obligations
(4.20 upgrade check, spacing check) were dropped; confidence came from evidence *count*; every
non-`in_force` document got a «хуучин» trailer; norm→norm continuations reused the previous answer;
`needs_human_review` records were never handled locally; "retrieval failed" and "no match" were one
state; and the svg leak was fought with a text regex that corrupted `logo.svg…`.

**What exists now.** The chain is
`question → normalize → engineering entities → explicit document lock → compiled rule/formula →
deterministic calculator → TrustedNormResult (signed) → provenance-bound citation → NL restatement →
validator (hard invariants) → /messages`.

- **Compiled registry, not prompt text** (`ai/norm-compiler` → `backend/src/lib/mglai/norm/generated/`).
  `npm run ai:norm:generate` (in `ai/`) compiles each dataset through an adapter
  (`adapters/bd-21-101-12.ts`) into a typed TS module: 27 predicate rules (three-valued: true / false /
  missing / **boundary conflict**), 38 formulas (28 executable), 80 clauses, 14 calculation cases,
  plus the dataset **SHA-256 identity** (same file list the runtime ingest hashes). `-- --check`
  fails when the generated files drift; the generated files carry a "do not edit" header and are
  byte-reproducible (`norm-compiler/test`).
- **Engine** (`norm/engine.ts`, `entities.ts`, `calculators.ts`, `predicate.ts`). Entity extraction
  (g, Q, S, H, ΔP, flash point, apparatus P/V, geometric volume, media, shutoff flags, explicit
  document codes, asked-for quantity) drives *family selection* — room category (Table 1),
  В-subcategory (Table 4 + 4.20 upgrade), specific fire load (formula 22), apparatus gas volume
  (formula 7), spacing (formulas 23/24), free-volume fallback (4.4), shutoff time (4.2). Calculators
  are typed functions with explicit ids and constants pinned against the dataset's own
  `expression_python`; there is no `eval`. The result is one object, `TrustedNormResult`
  (`version: tnr-1`): verification state, authoritative flag, document, dataset SHA, currentness,
  value+unit, initial/final category, rule and calculation trace, **follow-ups as first-class
  fields** (`requires_4_20_upgrade_check`, `requires_spacing_check`, missing inputs), provenance
  (record id, clause, table, formula, page, verification status), allowed numbers/categories, and
  the deterministic Mongolian/English text.
- **Amendment C — boundary ambiguity is a state, not a guess.** Flash point exactly 28.0 °C is a
  `source_boundary_conflict` (executable record `<= 28`, source text `< 28`): `needs_human_review`,
  `authoritative=false`, no category. 27.9 → А, 28.1 → Б.
- **Amendment A — version lock.** `/context` compares the registry SHA with the local runtime's
  dataset SHA for the same document; a mismatch downgrades the result to `data_version_mismatch`
  (`NORM_DATA_VERSION_MISMATCH` warning, refusal contract, no categories, local evidence dropped).
- **Amendment B — exactly one result per turn.** `/context` produces the TrustedNormResult and
  signs it (HMAC-SHA256 over conv/turn/question with `JWT_SECRET`); the browser forwards it
  unchanged to `/messages`, which **verifies the signature instead of re-running the engine**.
  Citations, confidence and diagnostics derive from that object; a tampered object is ignored
  (measured: citations 0, confidence not «Баталгаажсан»).
- **Amendment D — currentness is seven states** (`currentness.ts`): `IN_FORCE_VERIFIED`,
  `CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED` (БД 21-101-12), `LISTED_CURRENT_NOT_SOURCE_VERIFIED`,
  `NEEDS_HUMAN_REVIEW`, `HISTORICAL`, `SUPERSEDED`, `UNKNOWN`. Only HISTORICAL/SUPERSEDED may use
  "old" language; the "not checked for later amendments" case gets a neutral note in metadata, not
  a trailer in the answer.
- **Amendment E — document selection without a code.** «25 °C, ΔP 7 кПа → ямар ангилал?» selects
  БД 21-101-12 through engineering entities, never through BM25. An explicitly named document that
  is *not* in the registry (БНбД 21-04-05) makes the engine refuse to answer from another document
  and locks the local search to the named one; a code absent from the local store as well
  (УББ 11-202-00) becomes `named_document_absent` only when the runtime confirms it.
- **Retrieval side** (`ai/retrieval`): `fire_hazard_rules` profile for the BD dataset; per-chunk
  document identity; hard document lock (`requestedDocument`, §9 supersession relations);
  `named_document_absent` / `clause_not_in_named_document` no-match reasons; calculator-input units
  excluded from FTS terms; a *focus* gate for quantity questions (the asked-for physical quantity —
  масштаб, зай, өндөр, даралт… — and one of the three rarest subject terms must appear in an
  FTS-only chunk), which turns the B09 near-miss (urban master-plan scale answered from a geodesy
  route-plan clause) into `no_content_overlap` without moving Recall@5 (96.6 % before and after,
  identical miss set of 101/2955). The runtime opens the store **read-only**, reports a schema
  mismatch or a mid-rebuild failure as **503**, and FTS infrastructure errors are no longer
  swallowed as "no candidates".
- **Contract tfc-2** (`trustedFacts.ts` + `norm/contract.ts`, browser `validator.ts`): a `norm`
  block with document aliases, result value/unit, initial/final category, required follow-up
  sentences, mask tokens (clause/table/formula/page numbers are not "numbers"), citation labels and
  the deterministic template. Three **hard invariants** — provenance document = cited document,
  calculation result = displayed result, final category = displayed category — skip sentence repair
  and regeneration entirely: the model text is discarded for the server template. Grounded norm
  answers without a deterministic result restrict numbers to the evidence text (the «1:5000 from
  memory» risk). Confidence in `/messages` is derived from the verification state, not the evidence
  count. When generation itself fails on a norm turn (runtime repetition stop, generation timeout,
  model error) the browser shows and persists the server template instead of a truncated model
  answer — measured in a real headless-Chrome run while an unrelated process held the GPU at 100 %:
  first token at 180 s, timeout at 300 s, deterministic В2 result already signed and waiting.
- **Multi-turn**: `ConvState.norm` keeps engineering inputs, medium and document across turns
  (survives an ERP question, expires with the subject TTL); bare-input follow-ups («Q=50000 МДж,
  H=6 м», «ΔP=5 кПа бол?») are classified NORMATIVE/FOLLOW_UP when norm state exists; prior inputs
  merge only into continuation turns, never into a new norm topic; prompt history drops the previous
  *assistant* answer whenever a deterministic result exists; the room-category В row now chains to
  the Table 4 subcategory when g is known (the `not_category` predicate had been inverted and the
  В row could never fire).
- **UI evidence**: sources counted only from what `/context` used (provenance + kept evidence); a
  norm-state badge from the signed result; the `ICON_LEAK_RE` text band-aid is removed and
  `frontend/scripts/check-ai-ui-leak.mjs` renders the real components through Vite SSR and asserts
  no raw SVG in visible text — the original «svgsvg» report is NOT_REPRODUCIBLE_IN_APP.

**Measured (2026-09-11, local backend on :3010 + local runtime, Qwen3-8B Q4_K_M, RTX 3070,
`cd ai && npm run ai:eval:gold [--gen]`).** Level 1 (deterministic subsystem, no model): 29/29
verified gold + B09 EXPECTED_NO_SOURCE + retrieval-failure, drift, signature and 5-turn contamination
cases all pass. Level 2 (real generation + validator): every case passes with final answers from
`model`/`repaired`/`template`; the §29 counters (wrong-source citations, explicit-document
violations, calculation bypass, formula-selection failures, unsupported numeric claims, follow-up
omissions, human-review leakage, incorrect historical warnings, retrieval-failure/no-match
confusion, multi-turn contamination) are all 0. Unit: backend 476 (one unrelated `systemCatalog`
drift from another agent's i18n WIP), ai 221, compiler 8, frontend check scripts 39 + 6.

**Session A final acceptance pass (2026-09-14).** Six Session C findings reconciled without touching C's
architecture: GAP-022 (number forms; `1.800` is *ambiguous* → `insufficient_context`, never guessed),
GAP-023 (`retrieval/src/reprText.ts` — one normaliser used by ingest *and* by
`scripts/normalize-dataset-repr.mjs`, which rewrites raw packages in place and refreshes manifest hashes;
variant keys stay in parentheses so no normative meaning or traceability is lost), GAP-025 (three-class
verification registry in `rules.ts`: executable / known-non-executable-with-reason / unknown; a row's own
declared status — even nested under `source`/`answer_source` — can no longer be silently promoted to the
document default `verified_official_text`; unknown statuses fail closed, are reported by
`ai:ingest:norm --strict`, and abort `norm-compiler`; БНбД 31-23-12 and 31-24-22 are therefore
**non-authoritative until the owner whitelists** `official_mcis_pdf` / `registered_full_text`), GAP-026
(document-prefixed test ids, in-package duplicates are an ingest error, cross-dataset collision test),
GAP-024 (`training/split-manifest.json` + `ai:train:split`: train/val ↔ eval overlap 0/0; package SFT
mirrors reclassified as evaluation material, not training), GAP-032 (anchor term — the rarest ≤0.5 %
content token among the first two of a Cyrillic question must appear in minimum-overlap FTS chunks;
«лифтний хонгил» no longer borrows the connecting-corridor clause; Recall@5 byte-identical).

