# MGL AI · Reasoning Benchmark v1

Version: **reasoning-v1.0.0**

This directory is an evaluation-only instrument. Production code may be imported by the benchmark; production code must never import this directory.

## Execution types

- `MODEL_ONLY_EVIDENCE` — direct local generation with verified/synthetic evidence already supplied. No router, retrieval, ERP/Revit discovery, substantive repair, or deterministic answer substitution.
- `FULL_RAG` — existing evaluation client follows the real plan → tools → norm → context → generation → validation/repair path and preserves raw/final answers separately.
- `ADVERSARIAL_SYSTEM` — FULL_RAG plus explicit benchmark fixtures for leading assumptions, tool failures, conflicting/irrelevant evidence, missing context and related failure modes.
- `STRUCTURAL` — non-scoring CI validation of schemas, cases, fixtures, hashing, scorer, hard gates, comparison and blocked semantics.

A missing runtime/backend/token/knowledge DB is `BLOCKED`, not a zero score.

## Core definitions

The core set has 48 cases with the required distribution:

| Category | Core |
|---|---:|
| Mongolian understanding | 8 |
| Norm retrieval/source selection | 8 |
| Applied rule reasoning | 8 |
| Engineering reasoning | 7 |
| Missing information/clarification | 5 |
| Hallucination traps | 5 |
| Conversation reasoning | 4 |
| Cross-source synthesis | 3 |

There are 56 curated variants, for 104 distinct case definitions. Variants are counted separately and never inflate the 48-core claim. Case provenance records which expectations came from verified sources, existing held-out work, or explicitly synthetic rules. Independent human review of all 48 references is still pending; do not describe the set as human-approved until that review is recorded.

Every structural run writes an ignored `reports/reasoning-v1-reference-review-*.json` packet with all 48 core questions, expectations, fixture evidence, source locators, provenance, and blank reviewer verdicts. A reviewer can verify each reference without a live runtime. Live runs also write a separate answer-review packet; its items stay empty when no model answers were measured. These packets are handoff material, not claims of human approval.

## Commands

From `ai/`:

```bash
npm run ai:eval:reasoning
npm run ai:eval:reasoning:structural
npm run ai:eval:reasoning:model
npm run ai:eval:reasoning:full
npm run ai:eval:reasoning:adversarial
npm run ai:eval:reasoning:compare -- old.json new.json
npm run ai:eval:reasoning:test
```

Default mode validates structure first, then attempts live modes only when dependencies are observable. It does not fail merely because no GPU/runtime exists.

Exit codes:

- `0` requested evaluation completed, or default run is structurally valid with live modes blocked.
- `1` evaluation completed but semantic/release gates failed.
- `2` benchmark structure/configuration is invalid.
- `3` an explicitly requested live mode is blocked by a missing dependency.

## Live environment

MODEL_ONLY requires the local runtime and installation secret. FULL_RAG / ADVERSARIAL additionally require the backend and explicit evaluation credentials:

- `MGLAI_EVAL_USER`
- `MGLAI_EVAL_PASS`

Optional:

- `MGLAI_RUNTIME_URL` (default `http://127.0.0.1:39217`)
- `MGLAI_API_URL` (default `http://127.0.0.1:3000/api`)
- `MGLAI_KNOWLEDGE_DB`

No default username/password is embedded in this benchmark.

## Scoring

The scorer uses structured semantic expectations rather than reference-answer similarity. It evaluates decisions, required conditions/claims, missing inputs, source locators, calculations, refusals/clarifications and trusted-fact consistency.

No chain-of-thought is requested or stored.

Core dimension weights:

- Mongolian comprehension 10
- Retrieval/source selection 15
- Applied normative reasoning 20
- Engineering reasoning 20
- Clarification judgment 10
- Hallucination resistance 15
- Multi-turn reasoning 5
- Cross-source synthesis 5

Blocked cases are excluded from the denominator and force `COVERAGE_INCOMPLETE` when coverage is partial.

## Hard gates

These are independent of weighted score:

- fabricated normative numbers
- fabricated normative citations
- trusted fact contradictions
- unverified rule promoted to verified
- secret leaks
- benchmark/train leakage

Any measured hard-gate violation fails the release gate.

## Reference status

Case provenance distinguishes `REFERENCE_VERIFIED`, `SYNTHETIC_DETERMINISTIC`, `PORTED_FROM_EXISTING_GOLD`, `PORTED_FROM_EXISTING_HELDOUT`, `NEEDS_HUMAN_REVIEW`, and `HUMAN_REVIEWED`.

This benchmark never labels its own generated material `HUMAN_REVIEWED`.

## Privacy

Generated live reports are written below `reasoning-v1/reports/` and ignored by git. Diagnostic payloads are passed through the repository's canonical `@mgl/mglai-common/redaction` implementation before writing.
