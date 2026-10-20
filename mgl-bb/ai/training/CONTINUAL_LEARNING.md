# MGL AI continual Mongolian/AEC learning

This pipeline improves MGL AI from real employee conversations **without training on raw conversations**.

## Safety boundary

The model must not continuously imitate every employee message. Raw chat can contain wrong engineering advice, private information, temporary ERP facts, draft norms, and accidental hallucinations. The continual loop therefore accepts only records that passed the existing admin feedback review and were exported as `approved` / `included_in_dataset`.

Normative knowledge stays **retrieval-first**. Do not put current numeric requirements, clause numbers, employee counts, project progress, or other changing facts into LoRA weights. The model should learn how to understand Mongolian, ask for missing inputs, explain engineering reasoning, use retrieved evidence, and avoid inventing facts.

## What changed

The continual corpus combines:

- the existing serving-v2 synthetic tool/grounding/contract curriculum;
- `mn_style_pairs.jsonl` for known broken-Mongolian rewrites;
- `aec_conversation_pairs.jsonl` for architecture, structure, MEP, Revit coordination, and engineering-decision behavior;
- admin-approved conversation corrections exported by `ai:export-feedback`.

Latin Mongolian is normalized for understanding while the original user text is preserved. The same normalized helper line is used by production prompt assembly and the SFT builder, so train/serve format stays aligned.

## Run continuously on the training workstation

From `ai/`:

```powershell
$env:MGLAI_TOKEN = "<admin token>"
npm run ai:train:continuous
```

Defaults:

- poll approved feedback every 60 minutes;
- start a new candidate only after 10 new approved rows (or an edit to the previously trained approved snapshot);
- Qwen3-8B QLoRA, 2 epochs, LR 1e-4, grad accumulation 8;
- sequence buckets 1536/1792/2048;
- one candidate at a time;
- each candidate starts from the frozen Qwen3-8B base, **not from the previous adapter**;
- export the completed candidate to GGUF LoRA;
- never auto-promote or modify the production manifest.

Useful commands:

```powershell
npm run ai:train:continuous:once
npm run ai:train:status
npm run ai:train:log -- -RunName <run>
npm run ai:train:stop -- -RunName <run>
npm run ai:train:eval -- --run <run>
npm run ai:eval:aec
npm run ai:train:readiness
```

`ai:eval:aec` is the focused employee-style architecture/engineering red-team:
active-vs-draft high-rise norms, superseded seismic/load references, Latin Mongolian,
architecture/core reasoning, structural missing-input discipline, MEP pressure zoning,
and Revit coordination. It records both the raw model answer and the contract-repaired
final answer so a better validator cannot hide a worse model.

To automatically attempt the existing candidate-vs-frozen-baseline evaluation after training:

```powershell
npm run ai:train:continuous -- -AutoEvaluate
```

The candidate evaluator still requires its documented local backend and candidate knowledge-pack prerequisites. If they are absent, training remains valid but the candidate stays unpromoted.

## Promotion rule

A newly trained adapter is only a **candidate**. Promotion remains manual and should happen only after:

1. training/data lint passes;
2. held-out + conversation evaluation runs against the frozen baseline;
3. safety regressions are zero;
4. Mongolian language/style is measurably no worse and ideally better;
5. norm retrieval/citation tests pass;
6. a human blind review confirms useful architecture/engineering answers.

This separation is intentional: continual learning may be automatic; **production trust must not be automatic**.
