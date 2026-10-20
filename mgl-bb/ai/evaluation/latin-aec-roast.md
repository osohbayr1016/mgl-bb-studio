# Latin Mongolian AEC response review

`latin-aec-roast.json` contains 40 natural Latin-written Mongolian questions about architecture, structure, fire safety, MEP, site work and Revit. The Cyrillic reference replies are **assistant drafts**, not verified engineering approvals or training labels. Keep this set out of SFT and adapter training.

From `ai/`:

```sh
npm run ai:eval:latin-roast -- --mode static
npm run ai:eval:latin-roast -- --mode live
```

Static mode checks the real language detector, intent router and answer-depth policy. It records disagreements with the draft route labels; it does **not** measure Qwen or natural sentence quality.

Live mode uses the existing evaluation client and follows the production-style `plan → tools → norm → context → Qwen → validation/repair` path. It requires a running **non-Echo** MGL AI runtime and `MGLAI_EVAL_USER` / `MGLAI_EVAL_PASS` for a test account. Set `MGLAI_RUNTIME_URL`, `MGLAI_API_URL`, and `MGLAI_SECRET` if needed. It does not save answers to the ERP. The output in `evaluation/benchmarks/` is ignored by git and redacted with the canonical shared redactor.

Each live row preserves the model's raw answer and the final answer beside the draft reference. Factual correctness, natural Mongolian, usefulness and overall preference are blank fields for a Mongolian-speaking AEC reviewer. Do not train on the held-out questions or call the reference replies human reviewed. A blocked live run is **UNMEASURED**, never a zero or a pass.
