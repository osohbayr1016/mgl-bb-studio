# MGL — Агааржуулалтын урьдчилсан тооцоо (Revit)

## Scope / implementation status

This feature branch adds a **working implementation candidate**, not a verified, approved HVAC design package. It requires a Windows Revit host test before distribution. Nothing is auto-installed, auto-run, or merged into main.

- Entry: **MGL → Инженер / MEP → Агаарын тооцоо** (`MglVentilation`).
- Uses existing authenticated Revit add-in and unified Tool Catalog/Ribbon. Compatible source paths target R24/net48 and R25–R27/net8/net10.
- Offline, native C# Revit API, no Python, AI model or paid API.
- The independent unit-tested core is under `addin/Ventilation/Core/`; the Revit adapter and WPF worksheet are under `addin/Ventilation/Revit/`.
- Read-only preview, configurable per-room or bulk design inputs; CSV export; explicitly confirmed writing of preliminary **Specified Supply Airflow** to eligible MEP Spaces only.
- No automatic duct drawing or network pressure balancing.

## Recommended method (considered alternatives)

| Approach | Pros | Risks | Choice |
| --- | --- | --- | --- |
| Revit-native API + deterministic calculation + engineer approval | Versionable, offline, reads true Space/Room model, can undo writes | Requires approved rate profiles and host QA | **Implemented** |
| Dynamo graphs/scripts | Easy to prototype in Revit | Dynamo package/version dependency; hard to audit and regression test | Prototype only |
| Python + Revit bridge | Good analytical ecosystem | Extra runtime/security/deployment; doesn't solve missing normative inputs | Not required |
| Excel-only | Easy human review | Weak BIM links, sync/drift, manual export | CSV provided as an adjunct |
| AI auto-design | Natural-language assistance | May fabricate code clauses and unsafe engineering values | **Never authoritative** |
| Third-party duct-sizing software | Specialized system/network friction tools | Licensing/integration and different model of truth | May integrate later |

## Engineering calculations and interpretation

All units shown to users are **SI**; Autodesk's internal length/area/volume/airflow units are converted with `UnitUtils`, never treated as SI.

1. With a placed MEP Space, read number/name, level, area (m²), volume (m³), existing specified supply. Prefer Space over Room to avoid double counting. If no placed Spaces exist, read host Rooms; if none, loaded linked Rooms. Rooms are report-only.
2. **ACH** method (if engineer supplies air changes per hour): `V_ACH[L/s] = Volume[m³] × ACH × 1000/3600`. This is a schematic supply airflow from a specified air-change assumption; it does **not** independently determine how much outdoor air is required.
3. **Outdoor air** method (if engineer supplies rates): `Vbz = Pz × Rp + Az × Ra` (L/s), `Voz = Vbz/Ez`. Each of Pz, Rp, Ra and Ez must reflect a reviewed space/program, with `Ez` explicitly supplied and positive. This is a **zone outdoor-air calculation**, not a full recirculating multizone AHU outdoor-air intake (`Vot`).
4. Schematic **supply minimum** is `max(V_ACH, Voz)` *if* one or both methods is supplied. This is a preliminary ventilation-only bound and must be reconciled with design heating/cooling airflow, pressurization, exhaust/makeup air, infiltration, humidity and operating conditions. It is **not** proof of comfort or regulatory compliance.
5. If exhaust was explicitly entered, display `supply−exhaust` as a *preliminary return/makeup balance* and flag negative balance (write-back blocked for that row).
6. If a velocity was explicitly supplied: `D_ideal = sqrt(4 × (V[L/s]/1000) / (π × v[m/s])) × 1000` mm for one **ideal round branch**. The closest upper bound from an illustrative built-in list is shown as a *suggestion* only; the list is **not** a verified manufacturer/nominal size table. Does not calculate noise, friction, fan pressure or fittings.

### Guardrails

- **Never assign code minimum ACH/person density/Rp/Ra/Ez without an approved rule source.** Null is unknown, **not zero**.
- For incomplete/invalid rows, show errors and return no result; no write-back for those rows. Invalid geometry, non-finite or negative input, missing occupancy for positive Rp, missing volume for ACH, missing Ez for outdoor method are rejected.
- A validated result is labeled **calculated / engineer review needed**, *not* code-compliant.
- When applying, show an explicit second confirmation, preflight all parameter writes, use a single Revit Transaction, and roll back on failure. Do not write Room or linked data.
- CSV includes raw assumptions, calculated values, source, errors and a disclaimer. Do not send results to the ERP or to a remote server.
- Because a user may select only some independent hypotheses, a room design may still be incomplete: system designer must verify all governing criteria outside this tool.

## Mongolian normative references

Primary framework to inspect for applicability, **not automatically encoded as values**: **БНбД 41-01-11** (`Халаалт, агаар сэлгэлт ба кондиционер`), amendments and the applicable occupancy-specific BNbD/MNS documents. Validate the **current revised edition**, relevant clauses/tables, building type and indoor/outdoor design conditions before loading approved rate profiles. The legalinfo annex and ministerial order note amendments in 2022.

- Official: https://legalinfo.mn/mn/detail?lawId=205498
- Official order: https://legalinfo.mn/mn/detail?lawId=7564
- Autodesk Space API: https://help.autodesk.com/cloudhelp/2026/ENU/Revit-API-MainReference/files/html/b2c8970e-e554-8d73-06db-b65712c8a2e5.htm
- Revit specified vs calculated flow: https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/How-is-the-Supply-Return-Airflow-calculated-for-a-Space-in-Revit.html

To implement automatic occupancy-based rules, first build an **approved, versioned rulepack**:
`{code, edition, clause, room_type, building_type, effective_dates, ACH, Rp, Ra, Ez, exhaust, applicability, reviewed_by}`. Every suggestion must cite a specific adopted clause. Missing/ambiguous mapping blocks approval rather than guessing.

## Smoke / fire warning

This general ventilation worksheet **must not** calculate or control smoke exhaust, stair pressurization, CO management, kitchens with hazardous vapors, laboratory hoods, explosion-rated extraction, fire-damper sizing, stair smoke control or any other life-safety process. Those require special code and hazard engineering, approved scenario/design inputs and independent review.

## Local validation

The isolated calculation core can be exercised without installing Revit:

```powershell
dotnet run --project revit-mcp/tests/Ventilation.Tests/Ventilation.Tests.csproj
```

Build with an appropriate Windows .NET SDK + NuGet references:

```powershell
dotnet build revit-mcp/addin/RevitMcpAddin.csproj -c "Release R24" -p:Platform=x64
dotnet build revit-mcp/addin/RevitMcpAddin.csproj -c "Release R27" -p:Platform=x64
```

Use an **isolated scratch Revit** install and test model. Building does not grant permission to install/replace the company's deployed add-in.

## Mandatory Revit-host smoke test (not yet completed)

- [ ] Revit 2024 and 2027: Ribbon MEP panel appears for correct team, licensing enforced; File/Family/no project availability works
- [ ] Ten placed Spaces and corresponding architectural linked Rooms: **exactly ten** worksheet rows
- [ ] Model with no Spaces: host Rooms used and all write-back disallowed; linked-only source supported
- [ ] 20 m² / 60 m³, ACH=3 -> 50 L/s; 100 m², 10 people, Rp=5, Ra=0.3, Ez=0.8 -> 100 L/s
- [ ] Blank values do not produce zero or 'pass'; missing Ez/volume and invalid cells block result/write
- [ ] Cancel button or dismissal leaves model unchanged; CSV opens with Mongolian text and doesn't execute formulas
- [ ] Writing confirmed Space flow displays converted L/s and exact same result in Revit UI; all-or-nothing rollback on locked/read-only parameter
- [ ] A single Ctrl+Z restores original values; re-run does not create duplicate objects
- [ ] Change Space volume/geometry, reopen and confirm recalculation is from current model, not stale cache


## Incremental implementation — 2026-10-15 second pass

### Implemented in the draft branch (not yet host-verified)

- Fixed broken `VentilationRow.BalanceLs` member mapping, WPF `Binding` collision,
  and Space occupants/ACH built-in parameter identifiers.
- Imported explicitly engineer-reviewed rate-profile CSVs with mandatory
  code, edition, clause, room type, reviewer and review date; unknown rates are
  `null`, never invented. Profile selection applies only to highlighted rooms
  after confirmation. If a user changes profile-backed rates, the original
  reference is invalidated in the worksheet.
- Revit `Space.ActualSupplyAirflow` compared with calculated schematic supply.
  **5% / 5 L/s** is a software *diagnostic display threshold*, not a legally
  approved or project-specific airflow tolerance. Actual airflow depends on
  actual terminals and systems; writing Specified Supply does not make it match.
- Unplaced or unenclosed Spaces/Rooms now appear with explicit invalid geometry
  instead of being silently filtered out.
- Separate `Сувгийн даралт…` worksheet: manually imported *radial* duct
  hierarchy; flow accumulation, velocity-only round duct suggestion, Darcy-
  Weisbach + engineer-specified local resistance K, critical path pressure,
  explicit fan reserve and optional estimated electrical power with specified
  efficiency. No automatic Revit connectors, duct routing or AHU selection.
- Additional C# core assertions in `tests/Ventilation.Tests/Program.cs`.

### Engineer-reviewed profile CSV contract

Use **UTF-8 CSV** with exactly this header:

```csv
id,code,edition,clause,room_type,reviewed_by,review_date,ach,rp,ra,ez,exhaust_ls
```

At least one positive ACH or Rp/Ra value is required. Ez is mandatory if
outdoor-air rates are used. `review_date` must be `yyyy-MM-dd`. Values are
**not bundled with this feature**: no Mongolian code rate can be claimed without
verifying the actual official current rule, applicability and review. Imported
review metadata is provided by the CSV author; the program cannot authenticate
the reviewer, original regulation or amendment status. Import alone does not
certify compliance. Occupancy assumptions are never inferred from name matching.

### Radial duct network CSV contract

Open the separate duct-network screen from the existing ventilation dialog.
The input CSV format is:

```csv
id,parent_id,terminal_ls,length_m,roughness_mm,loss_k
trunk,,0,10,0.1,1
branch_a,trunk,40,5,0.1,1
branch_b,trunk,60,7,0.1,2
```

The numbers above are **synthetic test geometry**, not design criteria.
The user explicitly supplies density, dynamic viscosity, maximum design
velocity, fan reserve, and optional overall fan efficiency in the UI.
`terminal_ls` is airflow consumed by the branch's terminal(s), not already
accumulated trunk flow. Empty `parent_id` connects to a common fan header.
The network must be an acyclic radial hierarchy; missing parents, loops,
unprovided fitting losses, non-finite values and oversize branches reject the
entire calculation. Formula: `Δp = (f L/D + ΣK) × ρv²/2` for each round
duct, with laminar `f=64/Re` or Swamee-Jain turbulent approximation.
The reported fan pressure is the most resistive terminal path **plus explicitly
entered reserve**. The calculation DOES NOT verify duct connector direction,
elbow families, natural flow balancing, leakage, terminal pressure, sound,
fan curves or manufacturer selections. It produces a reviewable CSV report,
**never Revit duct geometry**.

### Save and restore room assumptions (explicit, no automatic persistence)

Use **Оролт хадгалах** to export a separate re-importable UTF-8 assumptions
CSV. **Оролт сэргээх** imports only when every saved
`UniqueId + Source` matches a current Revit Space/Room row; duplicate,
stale, foreign-model and malformed rows reject the entire import *before
applying any worksheet changes*. The user sees a confirmation and can cancel.
Only occupants, ACH, Rp, Ra, Ez, exhaust and schematic duct velocity are
restored. Current Revit area/volume and terminal airflow are always re-read;
no old geometry, calculated result, code-source attestation or engineer
approval can be restored. Linked Rooms are preview-only on model write-back.

Header:
```csv
UniqueId,Source,Occupants,ACH,Rp,Ra,Ez,ExhaustLs,VelocityMs
```

The normal **CSV тайлан** is a full output report, not the assumptions import
file. Select **Оролт хадгалах** specifically for reusable inputs.

### Read-only real Revit duct/system audit

Inside **Сувгийн даралт…**, click **Revit систем аудит** to inspect the
currently open project directly, without model transactions or modifications.
The audit CSV lists real `MechanicalSystem` elements, their
`IsWellConnected` state, and Revit's system flow and critical pressure
**only if connected and available**; it lists existing `Duct` segments,
lengths, owning system names and number of unconnected HVAC end connectors.
An end connector can intentionally be open, so it is an *audit finding*, not
proof of a design defect. A separate **Аудит CSV** saves the read-only result.
Native Revit API calculations are intentionally **not** merged with the
manually entered radial duct-tree calculation; orientation, connector-family
losses and branch classification have not been independently verified.
The dialog is modal under the add-in external command, so model reads occur
within the command's Revit API context. Revit 2024–2027 host QA remains pending.

### Release gate still blocked

- GitHub Actions `Revit Ventilation Core` and `Revit Room Plan Geometry`
  continue reporting failed checks with empty/inaccessible job logs. It is
  impossible to distinguish runner/account initialization problems from
  code problems from the available GitHub data. **Do not say tests passed**.
- Local .NET SDK and Windows Revit host are unavailable in this environment.
  `RevitMcpAddin` R24–R27 compilation and real Revit validation are pending.
- No approved building-code rate tables, fan catalogs, acoustic limits,
  ASHRAE/BNbD multizone AHU calculations, automatic duct topology extraction,
  auto-routing, equipment selections, thermal loads, fire/smoke design, or
  PDF/XLSX design packages have been implemented.
- Release/merge/deployment must be blocked until compilation, CI, signed
  independent hand-calculation fixtures, representative model host QA and
  licensed MEP engineer review pass.

## Outstanding work to reach a **full system** (deliberately not claimed implemented)

1. **Norm-profile engine**: parse approved BNbD/MNS rate tables with clause IDs, occupancy categories, latest revisions, revision approval audit and applicability gates.
2. **MEP system topology**: terminals/connectors/ducts/fittings/air handling units; detect disconnected ports, loops, duplicate systems, branch direction, supply/return/exhaust classification.
3. **System calculations**: diversity, multiple-zone recirculation efficiency, building design OA intake, supply/return/makeup balance, mixed-air properties, heat gain/loss and duty cycles.
4. **Duct sizing**: material roughness, rectangular equivalent diameter, velocity/noise limits, friction, dynamic pressure, elbows/fittings loss coefficients, critical path, fan total static pressure, damper balancing.
5. **Revit output**: explicit reviewed duct/terminal placement and resizing, schedule generation, tags, diagrams, schedules + PDF/XLSX reporting, deterministic Revit transactions with previews.
6. **Independent validation**: real architect/MEP gold projects, hand-calculated fixtures signed off by a qualified engineer, R24–R27 host-test matrix, all changes reversible, release gating.

Do not label this feature as complete HVAC system engineering until these are verified.
