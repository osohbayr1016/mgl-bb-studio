# Revit MCP — Prototype Extraction Mission

> **Placeholder.** The original prompt content was not carried over from the
> planning session. Fill this in with the extraction mission used for
> MCP-connected Claude Code sessions (see Decision #12 — the prototyping lane).

## Purpose

Validate **canonical contract v1** and the frozen `type_signature` (see
[../../CLAUDE.md](../../CLAUDE.md)) against a real Revit model — cheaply,
READ-ONLY, on a **detached copy**. The output of this run is a "gap report":
what the MCP path could NOT provide becomes the C# add-in requirements list.

## Ground rules (from CLAUDE.md + DECISIONS.md)

- READ-ONLY. Never write to the model in the prototype lane.
- Numbers = code, meaning = AI (Decision #1) — extract quantities
  deterministically; do not let the model estimate or "fix" numbers.
- Scope v0 to **Walls + Structural Columns only** (Decision #10).
- Emit the canonical JSON schema with `source: "revit_api"`.
- Produce `type_signature` hashes identical to the frozen spec.

## The Revit MCP server

Lives at `mgl/revit-mcp/` (repo `Anandshde/REVIT-MCP`). See its `README.md`
and `.mcp.json` for how the add-in executes C# against the live session.

## TODO

- [ ] Paste the actual extraction prompt from the planning chat.
- [ ] Define the exact canonical JSON fields expected in the run output.
- [ ] Define the gap-report format.
