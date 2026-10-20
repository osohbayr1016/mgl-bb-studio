# Room Plan Python Batch — release handoff (2026-10-13)

Stacked PR #82 is based on Draft PR #80, not main. This file is a status and QA contract, not a Claude prompt.

## Source implemented, but NOT yet Revit-host validated
- Local Python stdlib generator for 1–24 separate rectangular Floors, 1–3 bedrooms each, and up to 36 candidates per unit.
- Two genuinely distinct topology families: center-hall and side-hall, with parametric internal partitions, mirrored entry N/E/S/W, and individual unit options.
- Python furniture positions (bed, sofa, kitchen casework, WC, basin) and collision-based pruning; C# handles actual Revit FamilySymbol selection and placement.
- Per-unit preview and manual approval; Revit uses existing four exterior Walls, creates interior native Walls, Doors, Rooms, Room Tags and preloaded native furniture Families.
- Single Revit transaction for all chosen units; intended full rollback on any failure, requires actual Revit QA.
- Local SQLite generated/viewed/selected/applied/explicit-rejected/failed actions. Never treat unseen/unselected options as rejected. Offline Bayesian-smoothed rank adjustments from verified actions, bounded to 4 points.
- Python engine does not call MGL AI, LLMs or any remote API. Existing company LicenseGate remains unchanged and may require online authentication.
- QA bundler can freeze Python into a standalone exe (PyInstaller used in CI only), bundle the exe and .py in the installer, run all four Revit builds and verify SHA256/payload.

## Must fix or verify BEFORE deployment
1. Latest PR #82 head must show passing Python unittest, geometry test, all 4 Windows Revit builds and verified QA ZIP. Recent GitHub Actions attempts reported failures before creating any steps/logs; investigate runner allocation/account restrictions, do NOT label current head CI-green.
2. Test on real Revit 2024/25/26/27 in throwaway RVT: select separate 2, 5, 10, 24 Floors with individual entrance and bedroom inputs; confirm preview, tags, native Room.Area, actual door hosting/swing, furniture origins/rotations, collision rejection, whole-batch Ctrl+Z.
3. Test no Python installed on user's PC and frozen Python QA exe present, UTF-8 Mongolian room names preserved, 20-second worker timeout and antivirus exception/no unsafe console.
4. Test per-unit negative scenarios: one missing/oversized/face-hosted Family; existing interiors, stacked floors, invalid outer walls, overlapping floors. No partial transactions or implicit changes.
5. Preference data is local per Windows user, NOT office-wide aggregated. Applied is logged only after commit, but Ctrl+Z still leaves an applied event; analytics are NOT exact net-adoption until undo reconciliation is implemented.
6. No real-time auto-update yet. Current WPF preview is modal, so changes to model while preview is open cannot safely auto-update. Implement modeless Revit UI + DocumentChanged dirty ids + deferred ExternalEvent model reads + background Python worker + debounce and cancellation, never Revit API on worker.
7. Rectangular, axis-aligned, four exterior walls only. L-shapes, complex units, one structural slab holding many apartments, windows, shafts, MEP conflicts, fire egress, daylight, current Mongolian BNbD/MNS checks are NOT implemented.
8. Native Family library is not shipped. Architectural suitability and exact size are not guaranteed by a successful C# compile; architect must review 30+ varied test examples before production.
9. PR #80 and PR #82 remain Draft; never merge #82 directly into main until parent resolved, and do not auto-install to employees.

## Next development in priority order
P0. Make latest CI green, verify signed/hash-tested QA installer, disposable RVT multi-unit host QA, accurate family/door collisions, rollback correctness, Undo-feedback reconciliation.
P1. Modeless realtime UI with DocumentChanged/ExternalEvent, selective dirty-unit regen, preview invalidation, latency/cancellation metrics.
P1. Shared slab with many unit boundaries, irregular polygons, shafts and columns, entry/window/daylight recognition, polygon constraint engine, no false compliance claims.
P1. Multiobjective/Pareto options with graph-based adjacency, clear room name and tags, dimension/door labels, fast similarity reuse.
P2. Opt-in anonymized aggregate export/import between staff PCs, contextual preference adaptation, controlled local model updates with offline benchmark.

## Verify locally
Python: python -m unittest discover -s revit-mcp/tests/RoomPlan.PythonTests -p test*.py -v
Geometry: dotnet run --project revit-mcp/tests/RoomPlan.Tests/RoomPlan.Tests.csproj -c Release
Windows: dotnet build revit-mcp/addin/RevitMcpAddin.csproj -c 'Release R24' -p:Platform=x64 -p:DeployToRevit=false (repeat R25, R26, R27)
QA bundle (not production deployment): powershell -NoProfile -ExecutionPolicy Bypass -File revit-mcp/installer/build-bundle.ps1 -Build -Isolated -Force -Channel qa
Verify: powershell -NoProfile -ExecutionPolicy Bypass -File revit-mcp/installer/verify-bundle.ps1

DO NOT mark production ready until live Revit host QA and current-head Actions both pass. Generated score is NOT a building-code compliance certificate.
