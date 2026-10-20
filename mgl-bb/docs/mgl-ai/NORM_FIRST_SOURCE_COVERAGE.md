# MGL AI — NORM FIRST: registry → official links → verified clauses → reasoning
2026-10-13 · implementation milestone 1 · no production changes

## Owner's requirement (source of truth)
**Do NOT treat MGL AI as trained by memorizing PDFs.** First, build a comprehensive, continuously maintained *finding aid* for Mongolian construction laws, BNbD/BD/UBB/MNS and other legally applicable standards. For each question:
- If an authoritative, current and applicable clause is verified, answer with precise evidence, scope and original link.
- If exact evidence is unavailable, **do not guess** a threshold, clause or compliance decision. Return the most relevant source *code, title, official PDF/detail URL and verified/unverified status* for the engineer to read personally.
- Incrementally promote a small number of high-demand documents to full page/section/clause/table/formula understanding; **never** silently claim an L1 registry row is an L2 knowledge document.
- Continue this process until the coverage of the approved catalog is measurable. Then refine multilingual Mongolian explanation, Qwen3-8B SFT and natural follow-ups; PC rollout and Revit remain out of scope.

## Verified existing repository capabilities and gaps (NOT a claim about production DB)
- L1 inventory already documented in `ai/norm-dataset/README.md`: 524 register entries from a 2025 registry snapshot with a verified subset and status caveats; topic router `registry.topic_router`. **This is not a complete or automatically current list of all Mongolian norms.**
- L2 clause explanation documented initially for BNbD 31-17-10 (593 parsed clauses, candidate auto-drafts, not human-approved). Other documents have different coverage levels. Measure current inventory/pack hashes instead of extrapolating these figures.
- Deterministic proven rules and calculations live in `backend/src/lib/mglai/norm/`; they must take priority over links-only fallback.
- Existing `normDocuments.ts` only returns topic links when the user's question explicitly asks to *list documents*, not for technical queries that cannot be answered. This patch fills **one** important gap.

## Milestone 1 implemented in this branch
`normReferenceLinks.ts`:
1. For a **single normative turn**, when `NORM-INTEL` says `NO_VERIFIED_MATCH` (including low-confidence/uncertain local evidence), L1 topic identification is nonempty and exact/stem based, return the first five *official* source links from the registry with document code, title and **honest** status.
2. Server-generated `templateOnly` reply; Qwen cannot invent a clause or drop URLs. No arbitrary external HTTPS URLs accepted (allow `*.gov.mn` and `legalinfo.mn` only). No PDF ingestion or DB mutation involved.
3. Do not override verified deterministic computation, named missing clause, explicit doc discovery, catalog listing, unrelated/non-norm queries, topical mismatch, currentness or governance answers.
4. If no safely matched official links exist, preserve the cautious existing unavailable/uncertain response. Do not synthesize a URL.
5. The answer explicitly states **these are starting links, NOT an applicable norm clause or compliance result**.

## Milestones 2+ (NOT implemented yet)
**2. Registry completeness and source freshness:** enumerate independent official source registries (MCIS, Legalinfo, eStandard, licensed sources), dedupe document code/edition, record official locator, source license, legal status, supersession graph, last verified date, retrieval timestamp, canonical SHA256, and link-health checks; catalogue reports `known/official-verified/unverified/missing-URL/indexed/clauses-approved`. Ignore fake or low-trust sources. Registry update proposals are never auto-marked ACTIVE.

**3. Prioritized ingestion:** stage these domain bundles through a source → PDF metadata → parsed clauses/tables/equations → source position → reviewer gate → index pipeline. Recommended priority:
1. Building-law and customer/client/developer obligations, approvals, design procurement and commissioning;
2. Fire safety, evacuation and fire alarms/extinguishing, building-type applicability;
3. Structural loads, seismic design and foundations;
4. General architecture, residential/public buildings, schools/kindergartens, administrative buildings;
5. Geodesy, engineering geology/geotechnics;
6. HVAC/smoke, plumbing/water, electrical and telecom/signal, automation;
7. Remaining specialties, estimating/labour documents separated by scope.

**4. Evidence-grade answers:** intent/router → active/effective-source check → passage retrieval → clause and scope match → bounded calculation and units → grounded answer with source URL. Never use mere word overlap as evidence that a clause answers the user. Keep L1 links as the explicit escape hatch.

**5. Manual quality loop:** Claude prepares 30–50 new questions; owner copies them to live MGL AI; ChatGPT analyzes original outputs, citations and humanized Mongolian; Claude implements fixes and separately vetted SFT candidates; owner retests. Regression suites remain hold-out, not training data.

**6. Acceptance:** for all verified applicable normative answers include code+edition/section/page/official link or explicit uncertainty; on any unsupported request do not invent quantities or statuses. Track: L1 catalog coverage, source URL rate, link health, document status freshness, L2 verified clause coverage, retrieval top-k, answer relevance, incorrect-applicability rate, 30–50-case owner replay, median and p95 latency. Never claim 100% accuracy or unrestricted coverage without evidence.

## Current validation boundary
Code/unit tests on this PR are **not** confirmation that the employee's current MGL AI runtime has the 524-entry L1 router populated. Deploy/ingest must be a separately approved operation with source/legal review. L1 links do not substitute engineer verification and do not constitute design compliance approval.
