# MGL Native Room Plan — Finch-inspired independent implementation

Updated 2026-10-13. **Not a clone of Finch source code**, a locally owned alternative.
Finch public workflow references:
- https://docs.finch3d.com/courses/finch-101/finch-101-generating-floor-plans-in-revit
- https://docs.finch3d.com/docs/projects-and-variants/unit-editor/adaptive-plan-library
- https://docs.finch3d.com/docs/projects-and-variants/unit-editor/enterprise-generate-unit-plan

## Original, synthetic six-example program library

| Seed | Bedrooms | Concept | Core variation |
| --- | ---: | --- | --- |
| mgl-studio-open-01 | 1 | Shared living hub | Wet area near access; direct room-to-living doors |
| mgl-studio-gallery-02 | 1 | Entry gallery | Rooms off horizontal corridor |
| mgl-family-social-03 | 2 | Shared living hub | Living central, bedroom privacy |
| mgl-family-gallery-04 | 2 | Entry gallery | Separate public and private rooms |
| mgl-family-private-05 | 3 | Shared living hub | Bedrooms around common public area |
| mgl-family-gallery-06 | 3 | Long frontage gallery | Several rooms on one gallery wall |

These are original hand-defined *program/geometry seeds*. **They are NOT licensed approved real project floor plans**, not copied from Finch's screenshots, and not evidence of building-code compliance. The library only models one- to three-bedroom schematic units at present. Architects must curate real examples, document ownership/permission, and verify topology/room function before work use.

## Code shipped to Draft PR #82

- Local Python CLI: `RoomPlan/Python/roomplan_cli.py` (no third-party runtime dependencies).
- Adaptive synthetic seeds: `plan_archetypes.py` (living-hub and entry-gallery topologies, N/E/S/W entries, mirrored and scaled options), alongside center and side halls.
- Deterministic graph audit: `plan_validation.py` checks exact area coverage, room overlaps, wall-hosted door centre positions, external entrance, and **every room reachable from the entrance through actual door connections**. These are schematic constraints only, not real Revit Family swing checks.
- Local SQLite stores generated, viewed, selected, explicitly rejected, and successfully applied options, including minimal geometry. Previously applied designs form a *private local plan library* and can be adaptively resized only to nearby dimensions, then rechecked. This is retrieval + constrained adaptation, NOT model weight training.
- Ranking: room area heuristic, option-geometry hashing/deduplication, preference adjustment of at most +/-4 points once a template has >=3 explicit applied/rejected events (Bayesian-smoothed; how often it was merely shown is not evidence); unviewed suggestions are not automatically treated as failures. Display measured area-efficiency and min-bedroom area; daylight/compliance not guessed.
- Revit: native Floor and 4-wall selection, 1–24 separate rectangular units, independent entrance, bedroom counts, plan selection; C# WPF has colored plan thumbnail gallery and topology filter; apply in one transaction with hosted Doors, Rooms, Tags, furniture and rollback intent.
- Optional frozen Python worker in QA installer. `roomplan_cli.py`, `plan_archetypes.py`, and `plan_validation.py` are included for Python fallback. `verify-bundle.ps1` must verify all three and the compiled RoomPlan command.

## Engine v2 — program-driven generator (2026-10-13, `py-rp-10`)

Finch's documented unit-plan workflow (pick the unit, pick entrance walls, set graph rules,
toggle daylight facades, browse scored plans, filter by bedrooms/bathrooms, import walls/doors/
rooms/tags/furniture) is now covered locally, without AI, API or network:

- **`plan_generator.py`** builds plans from the PROGRAM (1–4 bedrooms, 1–2 bathrooms, optional
  «Агуулах» storage filler) instead of 36 fixed templates. Eight layout families:
  T-corridor, L-corridor (foyer + cross corridor — the classic single-facade apartment),
  central and side corridor, entrance gallery, living-hub band, living column, split bedrooms.
  Dimensions are sampled inside the *feasible* range of each room's minimum (graph rules:
  bedroom ≥ 9 m² / 2.6 m, bath ≥ 5 m² / 2.2 m, living ≥ 14 m² / 3.0 m, corridor 1.2–1.6 m),
  then mirrored/rotated to the real entrance. A corridor may be several rectangles named
  «Хонгил» with no wall between them; Revit creates ONE Room for it.
- **Scoring (0–100 %, same scale for every source)**: daylight 32 % (habitable rooms touching
  a window facade, living room counts double), room-size fit 23 % (undersize hard,
  generous mild, oversized bathroom wasted), squareness 15 %, corridor area 12 %,
  zoning 18 % (bedrooms/bath through the living room, split wet rooms, bath on the
  window wall). Every option carries the breakdown, shown in the preview.
- **Facades**: the Revit command marks every side that is neither the entrance nor a wall
  shared with another selected unit as a window facade (editable per unit). Bedroom count is
  suggested from the floor area.
- **Speed**: ~300–1000 candidates per unit, all validated, in ~0.2–0.4 s; a 12-unit batch
  in a few seconds. The Revit UI no longer blocks (worker thread + progress window,
  60 s timeout); viewed/selected feedback is written in the background.
- **Gallery**: all (up to 36) diverse options as cards with score %, ☀ lit/habitable rooms,
  window sides; sort by score / daylight / room size / efficiency / bedroom size; filter by
  the layout families the unit actually produced and «all rooms daylit».
- **Accuracy gate**: `plan_validation.revit_geometry_problem` and the furniture planner are
  twins of C# `RoomPlanRanking.GeometrySafe` / `FurniturePlanner.Safe`; a port of the C#
  gates over 800 random programs dropped 0 options (was 44 + 408 before the fixes).
- **One bad unit** no longer fails the batch: it returns `error`, Revit lists it and offers
  to continue with the others.

## What is missing for meaningful parity

| Feature | Current | Remaining work |
| --- | --- | --- |
| Plan Library | Original six seeded programs + local applied-history retrieval | Approved firm plan dataset, safe import from authorized RVTs, robust metadata and room graphs |
| Multiple plan types | Eight program-driven layout families + legacy templates/seeds | Irregular polygon constraints, separate kitchen, balcony, en-suite bath, full architect validation |
| Polygon adaptation | Rectangle resizing only | Real footprint graph, shafts/columns, doors/windows, corridor adjacency, segmented exterior walls |
| Score and filter | Finch-like 0–100 % with daylight/size/shape/corridor/zoning breakdown, sort + filter | User-tunable weights (Finch sliders), Pareto view, verified daylight/egress/accessibility rule packs |
| Furnish and tag | Native Room/Room Tag and explicit loaded hosted Door/Fixture/Casework/Furniture Family types | Certified family catalog, appropriate orientation/door swing, dimensions, room separator/tag style |
| Many units | Up to 24 independent rectangular Floor objects | Shared slab subdivided into unit polygons, 24-unit host performance, stack sync/group update |
| Real-time model editing | No; modal preview | Modeless pane + DocumentChanged + ExternalEvent, debounce, cancellation, incremental engine rerun |
| Self-improving | SQLite explicit events, selected plan retrieval, bounded prior adjustment | Architect-reviewed outcomes, Undo reconciliation, optional team-level aggregates, offline evaluation |
| Revit QA | Windows compilation passed on earlier base changes | Newest commit CI failures and full disposable Revit host tests remain |

## Not production-ready

Current GitHub Actions jobs for the newer commits have failed before executing runner steps; reason is not established from logs. A **previous** successful build does not verify the latest code. Do not merge, call this compatible with current live RVT projects, or deploy until CI, native Revit host QA, and architect approvals are complete. The name/UX is MGL's; don't use Finch branding, assets, plan imagery or proprietary datasets in an MGL commercial package.

## Next cycle top priorities

1. Restore CI runner execution and validate Python tests, all four Revit builds and QA installer including the three scripts and offline EXE.
2. Test live Revit model with real Family symbols and Door swing, Room Area/Tag, rollback, shared-wall adjacent apartment collisions and Ctrl+Z.
3. Import authorized previous design plans through explicit opt-in; convert native geometry to topological representation; add source rights and traceability.
4. Design true shared-slab and arbitrary polygon unit detector; avoid writing inside DocumentChanged and preserve transaction safety.
5. Modeless preview + safe incremental regeneration, debounce, backpressure, cache and size/time metrics.

Reference CI: earlier fully passing base build https://github.com/osohbayr1016/mgl-e-c/actions/runs/38381631892 ; this does NOT validate the newer seed, graph and UI files.
