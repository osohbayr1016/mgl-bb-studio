# MGL AI — Human-in-the-loop quality improvement

**Owner-approved workflow clarified 2026-10-13. MANUAL FIRST.** This branch is evaluation infrastructure only; it must NOT assume that the owner wants an unattended autonomous question-generation, auto-grading, training, or rollout system.

## Agreed actual workflow

1. **Claude creates** a *new* batch of 30–50 non-repeating, varied AEC / Mongolian regulations / architecture / customer & design obligations questions. Claude may research source materials and propose expected references separately, but cannot self-certify them.
2. **Owner manually copy/pastes** each question into the **real MGL AI user interface**, collects the entire response including source, status, latency and important preceding conversation turns, and sends the results to ChatGPT.
3. **ChatGPT independently audits** each Q/A: relevance, correctness against official current source, norm code+edition+clause/page/table, numeric boundaries/units, completeness, Mongolian naturalness, personalization, context retention, quality and measured timing. Distinguish verified defects, uncertain cases and user-ambiguous questions. No invented gold answers.
4. **ChatGPT produces a detailed actionable Claude implementation prompt**: numbered, deduplicated failures, expected behavior, probable root-cause hypotheses, affected code areas to inspect, minimal fixes, corner cases, acceptance tests, baseline preservation, training-data plan and release gates.
5. **Claude inspects the ACTUAL repository, implements appropriate fixes, tests, and trains an isolated LoRA candidate only where evidence supports SFT**. It may explore related corner cases and add new tests. Retrieval, norm corpus, routing and deterministic rule calculations must be repaired in software/knowledge first, not by blindly fine-tuning hallucinated answers.
6. **Owner repeats the real manual MGL AI test** after the changes. ChatGPT compares before/after on fixed regression cases PLUS new blind holdout cases. Loop until evidence supports high-quality normal and tricky questions.

No bot should silently open the owner's MGL AI UI or claim the manually copied cases were tested automatically. No auto model promotion, no employee PC rollout, no Revit integration until the owner explicitly changes the phase.

## Claude batch guidelines

- Number `QA-001` ... `QA-050`. Keep one independent, testable problem per case; a multi-turn sequence may belong to one case with its own context.
- Coverage: architectural design, building/client responsibilities, current-versus-replaced Mongolian norms, fire safety, structure and loads, engineering-geology, geodesy, MEP, design documents, licensing, and interpretation. Include novice explanations, detailed analysis, edge-value boundaries, units, missing facts, misleading user assumptions, Cyrillic/Latin Mongolian, multi-turn follow-ups, personalized tone where relevant, and out-of-knowledge cases for safe abstention.
- **No copy of earlier batches**; near-duplicates get flagged, unless explicitly included as named REGRESSION tests that DO NOT count as novel.
- Questions needing a precise normative answer should provide source proposal separately: document code, title, edition/currentness check, official URL, clause/table/page and fact needed to grade. If not independently verified, say `REFERENCE_PENDING`, never claim the model failed because Claude guessed a correct answer.
- Be careful with conditional answers: do not expect one universal number or yes/no when building type, fire compartment or applicable edition changes the requirement.
- Protect blind tests: NEVER paste exact evaluation cases and expected answers into training datasets. For training, author different approved examples with the same general skill; keep hidden holdout questions unseen.

## Copy/paste return format (owner → ChatGPT)

```text
QA-001
QUESTION: ...
CONVERSATION CONTEXT: ... (only essential previous turns; redact private information)
MGL AI ANSWER: ... (verbatim)
MGL AI SOURCES: ... (all shown source URLs/codes/clauses/status)
MGL AI STATUS: Verified / Uncertain / Insufficient (verbatim UI label)
LATENCY: ... seconds (as shown, optional)
USER NOTE: ... (optional)
```

The owner may also send a full unstructured copy/paste batch. ChatGPT can normalize it into this structure; don't demand that the owner manually fill in fields already present.

### Audit rubric

- **P0:** unsupported hazardous normative claim; false `verified` status; private/cross-domain data leak or misuse; invalid compliance approval.
- **P1:** wrong answer, wrong clause or edition, wrong measurement/unit, unhandled numeric boundary, lost multi-turn subject, unresolved missing-critical-info.
- **P2:** incomplete answer, misleading explanation, weak Mongolian naturalness, unhelpful clarification, poor formatting.
- **P3:** style/concision/polish only.
- Track answer correctness and evidence separately. Record `PASS / FAIL / PARTIAL / UNSCORABLE` and reviewer confidence; never count `UNSCORABLE` as passed.
- Report `raw model output`, `final UI output`, and `runtime` when available; do not invent internals missing from owner-provided screenshots/text.

## Existing automated utilities are OPTIONAL supporting tools only

The earlier code in this PR (`lib.mjs`, `batch.mjs`, `--only` evaluator, tests/CI) selects a non-repeating batch from an **existing curated catalog** for development regression. It does not replace Claude's manually produced questions or the owner's live copy/paste testing. At present it has 48 reasoning-v1 core definitions, only 40 model-only eligible; no promise of endless new 40-case batches.

```sh
cd ai
npm run ai:eval:quality:test                # deterministic selector tests only
npm run ai:eval:quality:batch -- --size 40 --dry-run
npm run ai:eval:reasoning:structural
```

These do NOT query the real MGL AI user interface, run an inference benchmark, auto-score pasted user answers, or fine-tune a model.

## Training/release boundaries

Use verified data and licensed norms. Never promote raw user/model answers into training targets. Keep train, validation, and final unseen tests separate; report leakage checks, model identity, exact commands, outcomes, GPU limitations, regressions, and rollback. A faster answer cannot outweigh wrong normative advice. Merge/deploy, migrations, automatic training triggers, employee installation, and Revit work are OUT OF SCOPE for this manual-first quality cycle unless specifically authorized.
