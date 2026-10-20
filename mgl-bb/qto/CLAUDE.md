# MGL QTO — BIM-to-Quantity-Takeoff Pipeline

Revit/IFC → deterministic extraction → canonical JSON → D1 → Claude classifies types/materials to Mongolian construction norm codes (шифр / БҮТН) → versioned QTO views in MGL Progress.

Solo developer: Anand (architect + software engineer, MGL E&C, Ulaanbaatar). **Planning happens in claude.ai chat; implementation happens here.** `docs/DECISIONS.md` contains binding architecture decisions — read it before proposing architectural changes, and challenge it explicitly rather than silently deviating.

## Stack

- Cloudflare Workers, Hono, D1, Drizzle ORM, TypeScript, R2 (same as MGL Progress)
- Web UI: React/TS pages inside MGL Progress
- Extraction: **C# Revit add-in** (production) · Revit MCP + Claude Code (prototyping only)
- Batch automation (Phase 4): RevitBatchProcessor
- AI: Claude API — classification only, never quantities

## Iron rules

1. **Numbers = code, meaning = AI.** AI never extracts or computes quantities; it only classifies types/materials to шифр.
2. QTO runs are **immutable and versioned**; full audit trail: element GUID → type_signature → mapping → approver → run.
3. All quantities metric (mm / m² / m³). Revit internal units are imperial feet — always convert, round mm to integer, m³ to 0.001.
4. Mongolian Cyrillic survives byte-perfect: UTF-8 everywhere, Unicode NFC before hashing/comparison.
5. **Prices come LAST (Phase 5).** Do not build pricing features, price columns, or price imports. mcis price data is known-dirty.
6. `type_signature` spec below is **frozen** — every implementation (TS prototype, C# add-in) must produce identical hashes or the mapping cache dies.

## type_signature v1 (frozen)

```
normalize(s): Unicode NFC → trim → lowercase → collapse internal whitespace to single space
material_part: materials sorted by thickness_mm desc, each "{normalize(name)}:{thickness_mm}"
key_params_part: sorted "key=value" pairs (structural, thickness_mm for walls)
payload = normalize(category)|normalize(family)|normalize(type_name)|join(material_part,";")|join(key_params_part,";")
type_signature = "sha256:" + sha256_hex(utf8(payload))
```

Store the raw payload alongside the hash for auditability. Material→шифр mapping attaches at **layer level**, not type level.

## Matching funnel (Phase 2)

cache (signature hash) → deterministic rules (pre-filter to 10–30 candidates) → Claude with shortlist + explicit "none of these" option → human review when confidence < 0.9. Confirmed шифр is written **back into Revit** via shared parameter (`MGL_Шифр`, or Assembly Code / Keynote) so models self-classify over time.

## Status (2026-07-02)

- **Phase 0 ~done:** materials catalog fetched from mcis.gov.mn, cleaned, discipline-classified → `seeds/resources_catalog.json` (1,859 items; `code`, `code_format` dashed|digit8, `name`, `unit`, `disc`, `method`, `flags`). Legacy Cyrillic encoding corruption fixed (є→ө, ї→ү, º→ө, ¿→ү, Latin V→ү).
- **Next: 3-week vertical slice** (Decision #10): canonical contract v1 → D1 schema + seed → RevitAdapter v0 (Walls + Structural Columns only) → Worker ingest + first Claude material classification (Phase 2a) → one material-schedule page in MGL Progress.
- **Parallel, not blocking:** estimator meeting (unlocks Phase 2b work-item mapping — the moat). Open questions live in `docs/DECISIONS.md` §Pending.

## Domain glossary

- **шифр** — norm code `XX-YYY-ZZ` (эмхэтгэл–зүйл анги–норм) per БНбД 81-10-18; material codes use `XXX-XXXX` or an unidentified 8-digit system (ask estimator).
- **БҮТН** — Барилгын үнэ бүрдлийн төсвийн норм (estimating norms; 32 official эмхэтгэл). **БНбД** = building codes (how to build); БҮТН = what it costs.
- **1:N mapping** — one Revit type → a SET of work шифр with qty formulas (concrete m³ → rebar тн, formwork m²), units carry scale_factor (100 м³ etc.).
- Discipline teams: БА/ББ (architecture/structure), ХАС (HVAC), ЦБУ (water/sewage), ЦАХ (electrical), ХД (comms/signal), АУ.

## Repo map

- `docs/DECISIONS.md` — binding decision log (#1–#12). Append-only; new decisions come from planning chat.
- `docs/prompts/revit-mcp-extraction.md` — prototype extraction mission for MCP-connected sessions.
- `seeds/resources_catalog.json` — material шифр catalog seed (no prices, by design).
- `reference/materials_by_discipline.html` — human-browsable catalog for engineers.

## Working agreements for Claude Code

- Read `docs/DECISIONS.md` when touching architecture; cite decision numbers in commit messages when relevant.
- Prototype extractions via Revit MCP are READ-ONLY against detached model copies.
- Ground-truth accuracy target for extraction: within ±2% of the manual Zuunmod estimate totals.
- When something here conflicts with reality, say so loudly instead of quietly working around it — this file is maintained by hand from planning sessions and can go stale.
