# MGL QTO — Decision Log

Binding architecture decisions from planning sessions (claude.ai). Append-only: new decisions get the next number; reversals are new entries referencing the old one, never edits. Claude Code: challenge these explicitly if reality disagrees — do not silently deviate.

---

**#1 — Numbers = code, meaning = AI.** Quantities are extracted by deterministic code only (Revit API / IfcOpenShell). Claude's only job is classification: type/material → шифр. AI never computes, estimates, or "fixes" a quantity.

**#2 — Per-discipline file extraction.** Extract each discipline's Revit file separately (detached open, `OpenAllWorksets`), merge in the database keyed by run + file. No live central-file access.

**#3 — Immutable versioned QTO runs.** Every extraction is a `qto_run` with a manifest (source files, versions, timestamps). Runs are never mutated; corrections create new runs. Full audit chain: element GUID → type_signature → mapping → approver → run.

**#4 — Don't build an orchestrator.** Batch automation uses RevitBatchProcessor (Phase 4). We write the add-in/task script, not the scheduler.

**#5 — Revit API is single-threaded.** Any socket listener (MCP plugin included) must marshal calls via `ExternalEvent` / Revit.Async. Prefer few large filtered queries over many small calls.

**#6 — Revit API → canonical JSON is the primary extraction path** (`RevitAdapter`), not IFC-first: richer type signatures for AI, and output matches Revit schedules estimators already trust. `IfcAdapter` (Tekla / БД team) is Phase 1.5. The canonical contract carries `source: "revit_api" | "ifc"` so both converge on one schema.

**#7 — Шифр structure (verified against the Zuunmod estimate PDF, made in Estimator Pro 4.0).** Work codes are `XX-YYY-ZZ` = эмхэтгэл–зүйл анги–норм (БНбД 81-10-18). `type_mappings` are **1:N**: one type → a set of шифр rows with qty formulas (e.g., wall concrete m³ also yields rebar тн and formwork m²). Norm units are scaled (100 м³, 1000 м³) → store `unit` + `scale_factor`. The «Үндэслэл» column is reference metadata, not a code.

**#8 — Meet estimators where they are.** They use Estimator Pro 4.0. Seed standards from official БҮТН sources (mcis.gov.mn / legalinfo.mn), NOT from EP's database (licensing + correctness). Phase 3 ships an **Estimator Pro-compatible Excel export** as the adoption bridge: feed their tool first, replace it later. Commercial redistribution of norm texts needs БХТ permission; internal digitization is low-risk.

**#9 — Phase 2 splits in two.** `resources` catalog is seeded from the mcis API (done). **2a = material mapping** (Revit material → material шифр, ~1:1, catalog in hand — early quick win that exercises the whole classification stack). **2b = work-item mapping** (type → шифр set + formulas — the moat; blocked on estimator input). 2a de-risks 2b's infrastructure.

**#10 — Stop planning; build a 3-week vertical slice.** Contract v1 → D1 schema + seed → RevitAdapter v0 (Walls + Structural Columns only, JSON to disk) → Worker ingest + first Claude classification (2a) → one material-schedule page in MGL Progress. Estimator meeting runs parallel, not blocking. Success = the thinnest end-to-end path works on a real model.

**#11 — Classification mechanics.** `type_signature = sha256(normalize(category|family|type_name|materials[]|key_params))` — exact spec frozen in CLAUDE.md; all implementations must hash identically. Material mapping attaches at **layer level** (`GetMaterialIds` / `GetMaterialVolume`), not type level. Matching funnel: cache → deterministic rules (pre-filter to 10–30 candidates) → Claude with shortlist + mandatory "none of these" option → human review below 0.9 confidence. Confirmed шифр is written **back into Revit** via shared parameter (`MGL_Шифр` or Assembly Code/Keynote) so models self-classify over time.

**#12 — Two lanes, one contract.** Revit-MCP + Claude Code = prototyping lane (validate contract v1 on real models cheaply, READ-ONLY, detached copies). C# add-in + RevitBatchProcessor = production lane. Both share the same canonical JSON schema and type_signature definition. The prototype's "gap report" (what MCP couldn't provide) becomes the C# requirements list.

---

## Roadmap (agreed)

- **Шат 0 — Foundation:** D1 schema; materials catalog seed ✅; БҮТН classification structure with senior estimator (riskiest human step).
- **Шат 1 — Manual pipeline (~1 month):** RevitAdapter v0 → JSON → D1. Success criterion: **±2%** vs manual Zuunmod ground truth.
- **Шат 2 — AI classification:** 2a materials, then 2b work items. ≥0.9 confidence auto-applies; below → review queue. The verified mapping table is the compounding moat Estimator Pro cannot copy.
- **Шат 3 — Web QTO views:** versioned runs, diffs, per-discipline; + Estimator Pro-compatible Excel export.
- **Шат 4 — Automation:** RevitBatchProcessor nightly runs, dedicated PC.
- **Шат 5 — Live budgeting:** QTO × unit prices. Explicitly LAST; mcis price data confirmed dirty (~⅓ unusable).

Realistic horizon: ~6 months alongside ERP duties.

## Pending questions (estimator meeting)

1. Excel export of the Zuunmod detail estimate from Estimator Pro (digital source of work шифр).
2. What is the **8-digit material code system** (945 items in the mcis catalog alongside classic XXX-XXXX)?
3. Real example: how many шифр rows does one RC wall type become in a detail estimate?
4. Which normative source provides м³→тн (rebar) and м³→м² (formwork) conversion factors?
5. Where do estimators view шифр digitally today?
6. Count which эмхэтгэл dominate the Zuunmod PDF → pick the priority 5–6 to digitize first (do NOT digitize all 32).

## Data provenance

- `seeds/resources_catalog.json`: fetched 2026-07-02 from `mcis.gov.mn/mn/getUneData` (3,170 raw rows → 1,859 unique materials). Apparent duplicates were 2021/2022 price-year rows. 4 null-code aggregate rows excluded. Prices intentionally dropped (Decision: Шат 5). Legacy encoding corruption repaired (є→ө, ї→ү, º→ө, ¿→ү, Latin V→ү) across 179+ names. Discipline classification: dashed groups mapped by group evidence; digit8 groups keyword-classified (`method: "keyword"` = heuristic); 204 items honestly `UNK`.
- Ground truth: «Шинэ Зуунмод» нэгдсэн төсөв PDF (261 pages, ₮73.69B, Estimator Pro 4.0 output) — scanned, no text layer; use estimator's Excel instead of OCR.
