# MGL Room Plan Generator — Offline schematic MVP

Status: **DRAFT / not validated inside Revit** (2026-10-13).

## Scope

Ribbon: **MGL → Зураг → Өрөөний план** (and Tool Catalog search).
Targets Revit 2024, 2025, 2026, 2027 from the existing multi-target add-in project;
the same command sources are included in each configuration. **Compilation and host
compatibility must be verified** on supported Windows SDKs before release.

This is **not Finch 3D**, not a model that learns, and not a building-code approval engine.
No AI/API call, cloud service, permission migration, ERP integration or deployment.

## User workflow

1. Open an editable project **Floor Plan** on a valid Level.
2. In a **vacant rectangular area** pick two opposite points (axis-aligned model coordinates).
3. Choose 1, 2, or 3 bedrooms and variant A/B/C. Observe preview and room areas.
4. Close/cancel = **zero** document mutation. Click **Хэрэгжүүлэх** for actual
   native Revit **Walls, Rooms, optional hosted Doors and Room Tags**.
5. Ctrl+Z undoes the entire creation transaction.

A living room + kitchen and bathroom are included. A central corridor connects to
each room via a proposed hosted door. There are no windows, fixtures or furniture.
Walls are 2.8 m high and use the first available basic wall type; door insertion uses
the first loaded *OneLevelBasedHosted* Door FamilySymbol. When no suitable Door Family
is loaded, walls/rooms are created but **no physical door opening is available**.
Always inspect the resulting plan before treating it as navigable.

Sizes (metres, schematic gate, NOT normative minimums): 1–2 bedrooms: width >= 9,
height >= 8; 3 bedrooms: width >= 10.5, height >= 10; maximum 30 × 30.
Three variants change hallway placement and partition ratios. Rectangles use the
model's XY axes and don't support irregular boundaries, curves or linked boundaries.

## Safety

- Runs only in project floor-plan context after add-in's own company license check.
- Blocks footprints intersecting existing **native walls / placed rooms on the target
  level**. No existing element is deleted or moved.
- Preview consists of read-only WPF shapes — **no Revit transactions**.
- Rechecks occupancy immediately before creating elements.
- All main geometry and room-area validation occur in a **single Transaction**.
  Errors cause rollback; no partial wall/room plan is intended to persist.
- Optional door insertion uses subtransactions; failed doors are counted and
  reported, not silently declared successful.
- Room Tags depend on loaded usable tag families and may be absent.
- Geometry engine is pure C# (no Revit/WPF) and has isolated invariant tests.

**Known blind spots:** linked-model collisions, columns/slabs/furniture, existing
door clearances, exterior façade orientation, walls spanning from a different
base Level, fire exits / means of egress, structural suitability, plumbing/MEP,
sunlight/insolation, accessibility, sound isolation, Mongolian БНбД/MNS. The
schematic size gates are not evidence of any normative compliance.

## Verification gates

Pure geometry tests, requiring only .NET 8:

```sh
dotnet run --project revit-mcp/tests/RoomPlan.Tests/RoomPlan.Tests.csproj --configuration Release
```

Revit build (on Windows with licensed Revit SDK/restored dependencies):

```pwsh
dotnet build revit-mcp/addin/RevitMcpAddin.csproj -c "Release R24" -p:Platform=x64
dotnet build revit-mcp/addin/RevitMcpAddin.csproj -c "Release R25" -p:Platform=x64
dotnet build revit-mcp/addin/RevitMcpAddin.csproj -c "Release R27" -p:Platform=x64
```

**Do not** pass `DeployToRevit=true` for build QA: that overwrites live installed
DLLs.

**Verified GitHub Actions (2026-10-13):**
[run #38371217636](https://github.com/osohbayr1016/mgl-e-c/actions/runs/38371217636)
passed the initial pure-geometry 895 assertions and Windows R24/R25/R27
compilation. The updated existing-floor, multi-orientation, furnished version
later passed **10,129 assertions** and **Windows R24/R25/R27 compilation**
([run #38377563918](https://github.com/osohbayr1016/mgl-e-c/actions/runs/38377563918)). The build logs contain warnings.
R26 compile was added in a subsequent CI matrix update; check that run
before marking Revit 2026 supported. The current
assistant environment has no Revit host; no real-model QA was performed.

### Real-host acceptance checklist (perform on disposable RVT)

- [ ] R24, R25, R26, R27 add-in builds and ribbon button appears with correct label.
- [ ] First-run tool catalog finds and opens the command; license denies unlicensed.
- [ ] Empty 12×11 m Level 1, 1/2/3 bedrooms × A/B/C: preview changes, room names,
      wall count, 2D geometry, no stray walls.
- [ ] Esc after point picking; Cancel in preview; close via X: no document edits.
- [ ] Apply with standard basic wall & one loaded hosted Door Family: every room
      is bounded, Area > 0, expected door openings; no failed-door message.
- [ ] Apply with no Door Family and with no RoomTag: warning/partial capability
      accurately reported; no crash.
- [ ] Second run same footprint and overlapping footprint: blocked and untouched.
- [ ] Failure injection (invalid wall type, locked model, unhostable Family):
      no partial wall/room writes; one Ctrl+Z returns to exact before state.
- [ ] Workshared document, rotated plan, model links, rooms on other levels:
      verify limitations and blockers; mark unsafe combinations as unsupported.
- [ ] Revit performance in a large commercial model, active-room schedule,
      actual Autodesk Room Tag visibility, wall joins and family placement.
- [ ] Review this output with licensed Mongolian architects/engineers against
      current official norms **before** use in real client drawings.

## Next phase: Claude-assisted plan intelligence

1. Source opt-in, anonymized company apartment-plan examples, with designer's
   express permission; normalize topology into wall/room/door graphs.
2. Define a **versioned schema** with project type, room counts, circulation,
   daylight/orientation, wet-area adjacencies and dimension constraints.
3. Add a constraint solver that rejects disconnected rooms, non-hostable doors,
   clashes, unusable widths and missing entrances before ranking plans.
4. Add **source-anchored** Mongolian norm retrieval with document URL/code/clause,
   revision and applicability; unresolved rules become **Needs human review**.
5. Use Claude as a *proposal/ranking assistant*, not as an unverified builder.
   Deterministic geometry and fail-closed validator remain authoritative.
6. Create a benchmark of at least 30 anonymized plan cases and have a licensed
   architect rate usability, circulation, adjacency and documented compliance.
   No blind automatic PR merging, model mutation or production rollout.

No standards are silently treated as verified by the current MVP.


## 2026-10-13 follow-up: bounded-floor / multi-option / furnished draft

**This section supersedes the original vacant rectangle two-click MVP directions above.**
It is still DRAFT, not a Revit-host validated release.

**Current intended sequence**

1. Open a project Floor Plan for the relevant Level, and select one existing horizontal
   rectangular `Floor` (or select it when prompted).
2. That floor must have **four distinct, straight, axis-aligned, room-bounding basic
   Walls** on its exterior edges. Walls are matched to slab edges conservatively;
   ambiguous/segmented, curved, L-shaped, sloped, multi-loop floors are rejected.
3. Click one of those **existing four Walls as the entrance wall**. Candidate plans
   rotate for north/east/south/west entrances.
4. Preview **up to 27 deterministic parameter variations per bedroom count**, sorted
   by a **schematic heuristic**, not a safety/compliance percentage. Candidates
   are discarded for invalid rectangles, insufficient room/bedroom envelope,
   schematic door/junction clearance, or clashes between proposed furniture.
   Remaining options may be fewer than 27, or none.
5. Green rectangles in preview = **schematic furniture envelopes** (bed/sofa/
   kitchen counter/WC/basin), not currently loaded native families. Choose
   the most suitable option based on your design judgment.
6. Next, explicitly map loaded family TYPES for **hosted Door, one-level
   Furniture (Bed, Sofa), one-level Casework (Kitchen), one-level Plumbing
   Fixtures (Toilet, Basin)**. If missing, select **Cancel**, load suitable
   families into the Revit project, then retry.
7. On `Хэрэгжүүлэх` the command rechecks the floor and surrounding walls;
   **reuses the four original outer Walls** and creates only internal Walls,
   Room, RoomTag, hosted Doors and selected native family instances in a
   single Revit transaction. Native family bounding boxes are checked for
   room envelope, 700 mm schematic door access, and mutual intersections
   before commit; a failure should cause rollback.

**What is not covered**

- No Finch AI training or generative model; 27 alternatives come from one fixed
  central-corridor topology with varying splits and rotations, NOT 27 different
  architectural concepts.
- No library bundled. The selected model MUST already contain the required
  suitable families; unsuitable or unexpectedly sized/rotated symbols cause a
  conservative refusal/rollback.
- No plan solutions for structural/MEP columns inside floor, doors/windows
  already inserted in boundary walls, stepped slab polygons, linked models,
  custom corridors or existing rooms: currently rejected rather than modified.
- No formal egress, disability access, thermal/daylight, furniture swing,
  kitchen work-triangle, plumbing shafts, acoustics, façade orientation,
  BNbD/MNS compliance or IFC/LOD evaluation. The visible score is an
  **uncalibrated design heuristic**; never present it as compliance.
- No real model performance or actual Revit behaviour claim until the
  Windows build gates AND a human-run Revit disposable project QA are green.

**Required additional acceptance**

- [ ] Select floor with perimeter walls; ensure no duplicate exterior Walls
      are created; confirm native Wall joins and valid Room.Area.
- [ ] Choose entry wall on each of north/east/south/west and verify that
      door is hosted on exactly the selected Wall and room access works.
- [ ] In preview: alternatives vary visibly and selected score explanation is
      correct. No green collision envelopes intersect doors or other furniture.
- [ ] Load one-level non-hosted Furniture/Casework/Plumbing Fixtures and one
      hosted Door type; explicit family map is remembered only for that apply.
- [ ] Oversized/rotated/face-hosted/wall-hosted families, incompatible
      Bathroom fixtures, missing Type and inaccurate Family origin cause
      rollback, not half-furnished plan.
- [ ] Revit 2024 / 2025 / 2026 / 2027 host QA on disposable RVT; test Ctrl+Z,
      room tags, family geometry, collision and dimension correctness.
- [ ] Independently audit against current official Mongolian regulations with
      references and clause-level traceability.

**Implementation location:** `revit-mcp/addin/RoomPlan/` and
`revit-mcp/tests/RoomPlan.Tests/`.
