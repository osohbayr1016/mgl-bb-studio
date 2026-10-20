# MGL AI — Reasoning v1 · SESSION 0 BASELINE

Baseline date: 2026-10-03
Source: main @ dd1d8b70e01abcdeced0b6f97cff0880b643e6da
Reproduction run: https://github.com/osohbayr1016/mgl-e-c/actions/runs/37119476315
Scope: audit only. No MGL AI behavior was changed.

## Frozen identity

- Product: MGL AI 1.0.0
- System prompt: mglai-sys-7
- Tool schema: mglai-tools-1
- Retrieval: mglai-rag-1
- Documented serving variant: employee-8b-q4
- Documented base: Qwen/Qwen3-8B @ b968826d9c46dd6066d109eabc6255188de91218
- Documented GGUF: Qwen3-8B-Q4_K_M.gguf
- Documented model SHA-256: 120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4
- Registry context: 8192; code default context: 4096
- Latest training report: mgl-adapter-0.5, CANDIDATE_TRAINED_NOT_EVALUATED, deployed=false
- Candidate dataset report: behav-2026-09-28.6, train 509 / val 59
- Active local model/adapter: BLOCKED; no employee runtime was available to CI
- Knowledge DB hash: BLOCKED; knowledge.sqlite unavailable
- Current generated SFT manifest: BLOCKED; training/out unavailable

Metadata drift noted, not fixed: version.ts still names BASE_MODEL_CANDIDATE=Qwen3.5-4B-Instruct while serving registry/training records identify Qwen3-8B.

## Audit environment

GitHub Ubuntu runner, AMD EPYC 7763, 2 vCPU, 7.8 GiB RAM, no NVIDIA GPU, Node 22.23.3. This is not the employee RTX workstation; historical GPU performance is not today's measurement.

## Deterministic baseline

Backend MGL AI tests: 669/669 pass, 0 fail.

ai:check after repository frontend/backend/shared dependencies were installed:
- tests 443
- pass 390
- fail 0
- skipped 53

An earlier audit attempt installed only ai/ dependencies and produced package-resolution failures for @mgl/mglai-common. Those disappeared after installing repository dependencies and are not counted as product failures.

## Direct current-main probes

- "Standard бланк хаана байна?" -> NORMATIVE: WRONG, VERIFIED_CURRENT
- "standard шаардлага юу вэ?" -> NORMATIVE: expected
- "Өргөн хэрэглээний бараа" -> NORMATIVE: WRONG, VERIFIED_CURRENT
- "Шатны өргөн хэд байх ёстой вэ?" -> NORMATIVE: expected
- "normal ажиллаж байна" -> NORMATIVE: WRONG, VERIFIED_CURRENT
- "norm шаардлага юу вэ?" -> NORMATIVE: expected
- "review meeting хэзээ вэ?" -> DOCUMENT_ANALYSIS
- "Revit view sheet харуул" -> REVIT_READ

Numeric parsing:
- g ni 2200 -> 2200
- g нь 2200 -> 2200
- 2 200 мджм2 -> 2200
- g=1800,5 MJ/m2 -> 1800.5
- g = 1.800 MJ/m2 -> ambiguous, no value guessed

Thus historical GAP-022 is HISTORICAL_FIXED, while contextual ambiguous-intent gaps remain current.

## Production-readiness snapshot

- Mongolian / Latin / units: 37 pass, 2 fail, 2 blocked (95%)
- Hallucination / company grounding: 57 pass, 0 fail, 2 blocked
- Streaming / error recovery: 40 pass, 0 fail, 2 blocked
- Observability: 1 pass, 1 blocked
- Intent, conversation, normative, security, route-level and performance retain blocked cases because live backend/runtime/knowledge resources were unavailable.
- Revit safety includes a not-implemented path.

This is not a full production score.

## Required command baseline

| Command | Result | Evidence |
|---|---|---|
| ai:check | PASS | 390 pass / 0 fail / 53 skipped |
| ai:readiness | PARTIAL | live-dependent categories blocked |
| ai:eval:mn | BLOCKED | MGLAI_TOKEN / TOKEN_FILE absent |
| ai:eval:conv | BLOCKED | backend 127.0.0.1:3000 unavailable |
| ai:eval:heldout | BLOCKED | backend 127.0.0.1:3000 unavailable |
| ai:eval:norm | BLOCKED | knowledge.sqlite unavailable |
| ai:eval:gold | BLOCKED | backend unavailable |
| ai:eval:retrieval | BLOCKED | knowledge.sqlite unavailable |
| ai:eval:style | PASS | 50 pairs; 37/39 bad styles caught, 0 false positives; misses st006/st049 |
| ai:train:split | NON-SUBSTANTIVE PASS | train/val/test all 0; 378 eval questions |
| ai:lint:dataset | BLOCKED | ai/data-train-files absent |
| ai:lint:training | NON-SUBSTANTIVE PASS | 0 SFT files / 0 examples |
| ai:perf | BLOCKED | runtime + backend unavailable; 2 blocked checks |

Blocked results are not converted into invented scores.

## Benchmark freshness

Current held-out definition: 38 cases / 43 turns.

The checked-in 2026-09-10 sys-6 generation recorded raw 21/43 versus final 33/43, with 21 model-sourced and 22 repaired outputs. This proves repair can mask weak raw generation, but it is historical and must not be reported as the current score.

Current model-only, full-RAG and adversarial scores are therefore UNMEASURED in Session 0.

## Reclassification of historical gaps

HISTORICAL_FIXED at current source/test level:
- GAP-022 Mongolian numeric parsing
- split/leakage infrastructure
- verification-state elevation guard
- canonical redaction package/cross-consumer parity
- invalid/interrupted assistant-history filtering
- trusted-fact contradiction protection
- explicit currentness model

BLOCKED for current data/runtime proof:
- corpus corruption state
- actual candidate train/eval leakage
- near-neighbor retrieval against current knowledge DB
- live model quality / active adapter identity
- current concurrency/performance

VERIFIED_CURRENT:
- contextual ambiguous intent false positives
- no isolated model-only reasoning benchmark
- stored generated benchmarks stale for current main
- no structured MGL-AEC reasoning benchmark
- client tool registry still exposes describe_system
- incomplete dynamic-data freshness contract
- adapter 0.5 is trained but not evaluated

## Session 0 conclusion

The deterministic MGL AI foundation is materially stronger than the old September gap inventory implies: current backend tests are green and several historical risks have regression protection.

But the project still cannot quantitatively answer how well the underlying Qwen model reasons. Current evaluation mixes retrieval/orchestration/generation/repair, the fresh live model/RAG suites are blocked in CI, and stored generated references are stale.

Session 1 should build benchmark instrumentation before any fine-tuning or behavior changes.
