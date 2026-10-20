# REVIT BIM-AI — ARCHITECTURE FREEZE
## Regulatory Intelligence + BIM + Multimodal AI

> **Status:** Architecture / planning document  
> **Implementation status:** Do not implement until this architecture freeze is reviewed and approved.  
> **Primary goal:** Build a local/private AI-powered Mongolian AEC/BIM intelligence platform centered around Revit.

> **SUPERSEDED — 2026-08-30.** This document is superseded by
> [`docs/bim-ai/REVIT_BIM_AI_Architecture_Freeze_v2.md`](./REVIT_BIM_AI_Architecture_Freeze_v2.md).
> v2 contains sections 1–39 of this file unchanged, plus 45 new sections (40–84) carrying the owner's
> full requirement: multi-team discipline-aware intelligence, passive real-time compliance, and
> zero disruption to the modeller's workflow.
> **Where this document and v2 disagree, v2 is the authority.**
> v1 is retained unmodified for history — do not edit it; make every correction in v2.

---

# 1. PRODUCT VISION

We are building a long-term AI-powered BIM / architectural intelligence platform centered around Revit.

The ultimate system should be capable of:

1. Understanding natural language requirements.
2. Understanding Revit BIM models.
3. Understanding 2D drawings, floor plans, sketches, diagrams, and eventually concept images.
4. Converting text and visual design intent into structured BIM intent.
5. Generating 2D and 3D architectural/modeling outputs.
6. Creating and modifying Revit elements through a deterministic execution layer.
7. Checking models against:
   - company standards
   - project standards
   - BIM standards
   - Mongolian construction regulations
   - accessibility requirements
   - fire/life-safety requirements
   - applicable engineering constraints
8. Explaining violations with traceable rule references.
9. Suggesting corrections.
10. Safely applying corrections.
11. Learning from verified human decisions and corrections.
12. Continuously improving through controlled model versions.
13. Preserving company-specific knowledge separately from globally reusable domain knowledge.
14. Supporting multiple companies in the future without cross-company confidential-data leakage.

The first production target is **Level 2 / Level 2.5** regulatory + BIM checking.

The architecture must nevertheless be designed from the beginning so it can evolve toward **Level 4**:

> Text + Image + Sketch + Revit → Understand → Plan → Generate → Validate → Explain → Correct → Learn.

---

# 2. CURRENT PRODUCT CONTEXT

The existing product is already a functioning Revit Add-in and website/backend ecosystem.

Important current characteristics:

- Existing Revit Add-in functionality is already production-oriented.
- Existing response behavior has been described as approximately 250 ms for core operations, but this must be measured formally rather than assumed.
- The Add-in already performs work/report-related operations.
- The Add-in is connected to the company's ERP system.
- A local intent classifier and training infrastructure already exist.
- The system has telemetry and an existing learning/training path.
- The Add-in has not yet been fully deployed across all employee PCs.
- Formal advanced multimodal AI training has not yet begun.
- Real company engineering workflow and correction data are available as future learning data.
- The current deterministic system must remain functional while AI capability is added.

Do not rewrite working functionality unnecessarily.

---

# 3. CORE STRATEGIC PRINCIPLE

We are **not** trying to beat Autodesk by training a general-purpose foundation model from scratch.

The product should become a:

> **Mongolian AEC / BIM Regulatory Intelligence Platform**

with domain-specific value derived from:

- verified BIM workflow data
- Mongolian construction regulations
- standards
- engineering decisions
- company standards
- project requirements
- human corrections
- BIM relationships
- multimodal examples
- long-term feedback loops

Autodesk/Revit is an execution environment and platform.

The product's moat is the **domain intelligence, verified data, rule system, workflow knowledge, and learning infrastructure**.

---

# 4. NO EXTERNAL AI API AS A PRODUCTION REQUIREMENT

Production must not depend on paid external LLM APIs.

Target architecture:

- local inference
- self-hosted inference
- company/private data
- self-controlled model lifecycle
- self-controlled datasets
- self-controlled evaluation
- self-controlled deployment

Compute costs such as GPUs, servers, electricity, or temporary training infrastructure are acceptable.

Commercial AI APIs are not required runtime dependencies.

Claude/Anthropic may be used by the developer during development as an engineering accelerator, but Claude is **not** the production model.

---

# 5. CLAUDE'S ROLE

Claude is a development accelerator, not the production AI.

Claude may:

- inspect the repository
- design architecture
- write code
- write tests
- create migrations
- create training pipelines
- create evaluation tooling
- debug
- benchmark
- document
- generate implementation plans

The production AI must be separately controlled.

Conceptually:

```text
CLAUDE
  ↓
builds the system

YOUR LOCAL AI
  ↓
runs the product

HUMAN ARCHITECTS / ENGINEERS
  ↓
provide professional ground truth

GPU
  ↓
provides compute
```

---

# 6. FOUR KNOWLEDGE DOMAINS

The knowledge system must explicitly separate:

## 6.1 Universal BIM Knowledge

Examples:

- what a wall is
- BIM relationships
- Revit concepts
- general spatial reasoning
- generic architectural concepts

## 6.2 Mongolian / Regulatory Knowledge

Examples:

- БНбД
- СНиП
- УББ
- БД
- MNS
- applicable fire/life-safety requirements
- accessibility requirements
- parking requirements
- building planning requirements
- other applicable standards

This layer can be globally shared where legally and operationally appropriate.

## 6.3 Company Private Knowledge

Examples:

- company standards
- approved families
- templates
- naming conventions
- workflows
- internal design practices
- internal checklists
- internal engineering decisions

This knowledge is tenant-isolated.

## 6.4 Project Knowledge

Examples:

- project-specific requirements
- client requirements
- project standards
- project-specific exceptions
- current model state
- approved project decisions

Project knowledge is scoped only to the applicable project.

---

# 7. REGULATORY DOCUMENT INTELLIGENCE

A large library of PDF documents is available.

The documents include multiple categories such as:

- БНбД
- СНиП
- УББ
- БД
- MNS
- other construction/regulatory standards

The filenames themselves are metadata and document identity, not the complete source of truth.

Do not simply fine-tune a language model on raw PDFs and consider the regulatory problem solved.

The document system must transform PDFs into a traceable, versioned, structured regulatory knowledge layer.

---

# 8. PDF INGESTION PIPELINE

Target pipeline:

```text
PDF
  ↓
Document Identification
  ↓
Metadata Extraction
  ↓
Text / Table / Image Extraction
  ↓
Section Segmentation
  ↓
Rule Candidate Extraction
  ↓
Rule Normalization
  ↓
Human Verification
  ↓
Versioned Rule Publication
```

The pipeline must support:

- native PDFs
- scanned PDFs
- image-based PDFs
- table-heavy documents
- old encoding / Cyrillic problems
- documents with diagrams
- documents with formulas
- documents with references to other standards

Every document should have identifiable metadata.

---

# 9. DOCUMENT VERSIONING

A document must not be treated as timeless.

Track at minimum:

- document_id
- document_type
- document_number
- title
- version / revision
- publication date
- effective date
- supersedes
- superseded_by
- jurisdiction
- status
- source file hash
- ingestion timestamp

The AI must be able to distinguish:

```text
CURRENT
SUPERSEDED
DRAFT
UNKNOWN
```

Where applicability cannot be determined, the system should return `UNCERTAIN`.

---

# 10. RULE EXTRACTION

A regulatory document should produce structured rule candidates.

Example conceptual structure:

```json
{
  "rule_id": "FIRE-EXIT-001",
  "document": "BNbD-XX-XX",
  "document_type": "BNbD",
  "section": "4.2.3",
  "page": 87,
  "version": "2026",
  "effective_date": "YYYY-MM-DD",
  "jurisdiction": "MN",
  "applicability": "...",
  "inputs": [
    "floor_area",
    "occupancy",
    "building_type"
  ],
  "condition": "...",
  "formula": "...",
  "threshold": "...",
  "unit": "...",
  "exceptions": [],
  "severity": "critical",
  "verification_state": "verified"
}
```

The exact schema must be finalized after repository inspection.

---

# 11. REGULATORY RULE ENGINE

Deterministic numeric or regulatory calculations must not depend exclusively on an LLM.

Preferred flow:

```text
Project / Revit Input
        ↓
Applicable Rule Selection
        ↓
Deterministic Calculation
        ↓
Compliance Result
```

Possible states:

- PASS
- WARNING
- VIOLATION
- UNCERTAIN
- NOT_APPLICABLE

Every result must be traceable to:

- rule_id
- document
- section
- page
- version
- calculation inputs
- calculation output
- assumptions
- source

The system must not fabricate a rule.

---

# 12. EXAMPLE: AREA / EXIT CHECK

Conceptual flow:

```text
Floor area = 230 m²
Building type = X
Occupancy = Y
        ↓
Find applicable rule
        ↓
Calculate required exits
        ↓
Existing exits = 1
Required exits = 2
        ↓
VIOLATION
```

The user should see:

```text
❌ NON-COMPLIANT

Existing exits: 1
Required exits: 2

Why:
[explanation]

Source:
Document ...
Section ...
Page ...
Version ...

Calculation:
...
```

The exact numeric requirement must always come from the verified applicable rule.

---

# 13. EXAMPLE: PARKING CHECK

Conceptually:

```text
Project type = X
Applicable area = 700 m²
Applicable parking ratio = verified rule
        ↓
Calculate requirement
        ↓
Required parking = N
Provided parking = M
        ↓
PASS / VIOLATION
```

The AI must not invent ratios such as "7 spaces per 100 m²".

It must identify:

- which document
- which section
- which condition
- which formula
- which project inputs

produced the result.

---

# 14. WEBSITE AI

The website is not merely a chatbot.

It should eventually support:

### Regulatory questions

- What regulations apply?
- What does this section mean?
- What is the source?
- What exceptions exist?
- What calculations are required?

### Calculations

- How many parking spaces are required?
- How many exits are required?
- What minimum dimensions apply?
- What is the applicable threshold?

### Project analysis

- Check this project.
- What is missing?
- What violations exist?
- Which requirements are uncertain?

### BIM analysis

- Analyze this Revit model.
- Find possible issues.
- Explain the affected elements.
- Recommend corrections.

---

# 15. REVIT AI — INITIAL PRODUCTION CAPABILITY

The first production MVP should support:

```text
Revit Model
   ↓
Analyze
   ↓
Detect compliance issues
   ↓
Show affected element
   ↓
Explain
   ↓
Show source
   ↓
Recommend correction
```

The user should not need to manually remember every rule.

---

# 16. PASSIVE COMPLIANCE MONITORING

One of the core future requirements is that the user does not always have to ask.

Conceptual flow:

```text
Architect modifies Revit model
        ↓
Relevant model change detected
        ↓
Determine affected objects
        ↓
Determine relevant rules
        ↓
Run fast deterministic checks
        ↓
If needed, run AI reasoning
        ↓
Create finding
        ↓
Notify architect
```

Example:

```text
⚠️ Potential regulatory violation

Current:
1 exit

Required:
2 exits

Source:
BNbD ...
Section ...
Page ...

[Show in Model]
[How to Fix?]
[Dismiss]
```

The purpose is to catch errors before project submission/review.

---

# 17. FUTURE SAFE AUTO-FIX

Level 4 must support:

```text
Violation
   ↓
Suggested fix
   ↓
Structured BIM intent
   ↓
Validate
   ↓
Dry run
   ↓
Preview
   ↓
TransactionGroup
   ↓
Execute
   ↓
Post-validation
   ↓
Commit or Rollback
```

Do not allow the production AI to directly execute arbitrary raw C# as its preferred control path.

The AI should generate typed, validated actions.

---

# 18. TYPED BIM INTENT

Future AI-to-Revit communication should use structured intent.

Conceptual example:

```json
{
  "action": "create_wall",
  "level": "Level 1",
  "start": {
    "x": 0,
    "y": 0
  },
  "end": {
    "x": 4500,
    "y": 0
  },
  "height": 3000,
  "wall_type": "APPROVED-WALL-200"
}
```

The deterministic Revit execution layer performs the actual operation.

The AI is the planner.

The deterministic executor is the actor.

---

# 19. MULTIMODAL AI

The long-term system must support:

- text
- screenshots
- floor plans
- 2D drawings
- hand sketches
- diagrams
- concept images
- Revit model data

Target flow:

```text
TEXT / IMAGE / SKETCH / REVIT
            ↓
Multimodal Perception
            ↓
Semantic Representation
            ↓
Spatial Reasoning
            ↓
BIM Intent
            ↓
Validation
            ↓
Revit Execution
```

The AI must explicitly distinguish:

- KNOWN
- INFERRED
- ASSUMED
- UNKNOWN

Do not silently invent unsupported dimensions, geometry, standards, or requirements.

---

# 20. LEVEL 4 TARGET

The final target is:

```text
                    USER
                      │
          ┌───────────┼────────────┐
          ▼           ▼            ▼
         TEXT       IMAGE        REVIT
          │           │            │
          └───────────┼────────────┘
                      ▼
               MULTIMODAL AI
                      │
                      ▼
               DESIGN INTENT
                      │
                      ▼
              SPATIAL REASONING
                      │
                      ▼
                BIM PLANNING
                      │
              ┌───────┴────────┐
              ▼                ▼
        COMPLIANCE          GEOMETRY
         ENGINE             ENGINE
              │                │
              └───────┬────────┘
                      ▼
                REVIT EXECUTOR
                      │
                      ▼
                    REVIT
                      │
                      ▼
                POST-CHECK
                      │
                      ▼
              HUMAN APPROVAL
                      │
                      ▼
              VERIFIED DATA
                      │
                      ▼
              MODEL IMPROVEMENT
```

This architecture should be designed now, but implementation must be incremental.

---

# 21. DATA COLLECTION

Real engineering work is a primary future learning source.

Potential data includes:

- Revit element changes
- model states
- user actions
- AI suggestions
- AI rejections
- human corrections
- senior approvals
- rule results
- final accepted state
- project context
- version information
- workflow events
- relevant ERP workflow information

RAW DATA IS NOT TRAINING DATA.

---

# 22. CANONICAL EVENT MODEL

The future event model must preserve chronological causality.

A sequence such as:

```text
CREATE
→ MOVE
→ CHANGE TYPE
→ ADD DOOR
→ HUMAN CORRECTION
→ APPROVE
```

must remain reconstructable.

Do not overwrite previous events because a newer event targets the same element.

Every event should eventually be traceable through fields such as:

- event_id
- session_id
- project_id
- company_id
- document_id
- model_state_id
- parent_event_id
- actor_id / actor_role
- event_type
- timestamp
- Revit version
- Add-in version
- model version
- rule version
- source
- validation state
- provenance

The exact schema must be finalized after repository inspection.

---

# 23. DATA TRUST MODEL

Define an explicit source taxonomy:

- HUMAN
- HUMAN_CORRECTED
- HUMAN_VERIFIED
- RULE_VERIFIED
- SYNTHETIC
- AI_GENERATED
- IMPORTED
- UNKNOWN

The dataset system must preserve these labels permanently.

Do not silently merge AI-generated data with verified human data.

---

# 24. DATA LIFECYCLE

The target lifecycle is:

```text
RAW
 ↓
CLEANED
 ↓
REVIEWED
 ↓
VERIFIED
 ↓
TRAINING-ELIGIBLE
```

Rejected examples should remain separately identifiable where useful.

The system must preserve:

- who reviewed
- when reviewed
- what was changed
- why it was accepted/rejected
- which rule/model/version was involved

---

# 25. SELF-IMPROVEMENT

Uncontrolled self-training is prohibited.

Do NOT implement:

```text
AI OUTPUT
→ automatically train
→ replace production model
```

Preferred lifecycle:

```text
REAL WORK
   ↓
DATA CAPTURE
   ↓
VERIFICATION
   ↓
CURATED DATASET
   ↓
TRAINING
   ↓
MODEL VERSION
   ↓
GOLDEN EVALUATION
   ↓
REGRESSION TEST
   ↓
HUMAN APPROVAL
   ↓
DEPLOY
   ↓
MONITOR
   ↓
REAL WORK
```

This is the controlled continuous learning loop.

---

# 26. GOLDEN DATASETS

Maintain separate conceptual datasets:

## 26.1 CURATED-TRAIN

Verified data that is eligible for model training.

## 26.2 GOLDEN-EVAL

Frozen evaluation set.

Normal training pipelines must never modify it.

## 26.3 GOLDEN-REGRESSION

Known historical failures and difficult cases.

Examples:

- wrong door placement
- wrong room relationship
- wrong parking calculation
- wrong exit requirement
- wrong sheet naming
- wrong regulation interpretation

Every new model must be tested against these.

---

# 27. MODEL VERSIONING

Every model must be reproducible and traceable.

At minimum record:

- model_version
- dataset_version
- dataset_sha256
- source files
- training configuration
- toolchain version
- git commit
- evaluation results
- deployment date

Avoid an ambiguous "latest" model.

Every production model must be rollback-able.

---

# 28. REGRESSION TESTING

A newer model is not automatically a better model.

Evaluate separately:

- intent classification
- BIM reasoning
- regulatory reasoning
- geometry
- Revit execution
- image understanding
- sketch understanding
- company standards
- Mongolian regulations
- known failure cases

A model that improves one area but regresses a critical area must be rejected.

---

# 29. COMPANY DATA ISOLATION

Private company knowledge must not silently enter the global knowledge layer.

Conceptually:

```text
GLOBAL
 ├── Universal BIM
 ├── Mongolian regulations
 └── generalized knowledge

COMPANY A
 ├── private standards
 ├── internal families
 ├── workflows
 └── private projects

COMPANY B
 ├── private standards
 ├── internal families
 ├── workflows
 └── private projects
```

Future shared learning must be explicitly controlled, permissioned, and appropriately generalized/anonymized.

---

# 30. PERFORMANCE ARCHITECTURE

Do not use a single blanket "250 ms" requirement.

Measure first.

Use separate budgets for:

- intent routing
- model loading
- UI interaction
- Revit execution
- tool round-trip
- background AI
- telemetry
- ChangeReport/digest
- vision inference

For measurable layers record:

- p50
- p95
- p99
- max
- error rate

Distinguish:

- MEASURED
- PROVISIONAL
- FINAL SLO

A provisional budget is not an architectural fact.

---

# 31. AI MUST NOT BLOCK THE REVIT HOT PATH

Never place heavy inference inside:

1. `RevitToolBus` ExternalEvent handler
2. `ChangeTracker.OnDocumentChanged`
3. deterministic trusted paths

Preferred architecture:

```text
FAST PATH
- deterministic checks
- lightweight models
- immediate Revit operations

AI PATH
- deep reasoning
- vision
- complex analysis
- generation
```

Heavy AI work should be asynchronous and cancellable.

---

# 32. BACKGROUND AI EXECUTION

`async` does not mean unlimited.

Every long-running AI operation should have:

- CancellationToken
- explicit user cancellation
- per-operation timeout
- bounded retry
- bounded concurrency
- failure state
- resource protection
- observable status

Do not reuse an unrelated 180-second HTTP timeout for AI inference.

AI inference should use a dedicated transport and cancellation policy.

---

# 33. SECURITY

Treat these as sensitive:

- BIM files
- architectural drawings
- customer project data
- company standards
- training datasets
- model checkpoints
- ERP data
- credentials
- employee telemetry

Implement:

- authentication
- authorization
- tenant isolation
- least privilege
- secure token lifecycle
- audit logging
- data retention
- deletion mechanisms
- controlled training usage

Every current security finding from the repository audit must be threat-modeled before implementation.

Do not assume an audit's suggested minimal fix is automatically sufficient.

---

# 34. EMPLOYEE / HUMAN DATA GOVERNANCE

If employee actions are collected for learning:

- document what is collected
- document why it is collected
- define retention
- define who can access it
- define whether it can be used for training
- preserve appropriate access controls
- avoid unnecessary personal information

Employee feedback is a learning signal, but is not automatically regulatory truth.

---

# 35. REGULATORY UNCERTAINTY

The system must be able to say:

```text
PASS
WARNING
VIOLATION
UNCERTAIN
```

It must not force uncertain situations into PASS or FAIL.

Examples of uncertainty:

- unclear applicability
- conflicting documents
- outdated regulation
- missing project context
- incomplete drawing information
- unsupported assumption

The system should surface what is missing rather than silently inventing it.

---

# 36. LEGAL / PROFESSIONAL POSITIONING

The system should be treated as:

> **engineering decision-support + automation**

unless and until it has the required legal/certification framework to claim otherwise.

Avoid outputs such as:

> "This building is legally certified."

Preferred language:

> "Checked against rule set X, version Y."

and:

> "Potential violation detected."

with source references and assumptions.

---

# 37. WEBSITE / REVIT RESPONSIBILITY SPLIT

Conceptually:

```text
WEBSITE
 ├── regulatory knowledge
 ├── rule management
 ├── project analysis
 ├── model/evaluation management
 ├── training management
 └── analytics

REVIT ADD-IN
 ├── live model observation
 ├── fast checks
 ├── affected-element visualization
 ├── interactive AI
 ├── safe execution
 └── feedback capture
```

The domain/business logic should remain as platform-independent as practical.

Revit-specific execution should live behind a clear adapter boundary.

---

# 38. MIGRATION PRINCIPLE

Do not rewrite the existing production system to add AI.

Prefer:

```text
EXISTING SYSTEM
      +
NEW INTELLIGENCE LAYERS
```

instead of:

```text
REWRITE EVERYTHING
```

Current working functionality remains the baseline.

---

# 39. IMPLEMENTATION PHASES

## PHASE 1A — Production Safety

Fix and validate:

- authentication
- tenant isolation
- token lifecycle
- data exposure
- agent endpoint security
- tool allowlist
- recovery
- shutdown/teardown
- unsafe production paths

No new AI capability is required.

---

## PHASE 1B — Data Integrity / Learning Foundation

Implement:

- immutable event history
- provenance
- version tracking
- source attribution
- review lifecycle
- training eligibility
- dataset manifests
- data lineage
- company/project boundaries

This phase is foundational for future AI.

---

## PHASE 1C — Measurement

Implement:

- end-to-end latency measurements
- Revit queue latency
- tool execution timings
- model loading metrics
- telemetry cost
- background AI metrics
- p50/p95/p99
- error rates

---

## PHASE 2 — Regulatory Intelligence

Implement:

- document registry
- PDF ingestion
- section extraction
- rule candidates
- rule verification UI
- versioned rules
- deterministic rule engine
- source traceability

---

## PHASE 3 — Revit Regulatory Checker

Implement:

- project inspection
- element extraction
- rule applicability
- compliance findings
- source references
- affected element highlighting
- correction recommendations

---

## PHASE 4 — Local AI Inference

Implement:

- self-hosted inference server
- local model lifecycle
- model versioning
- dedicated inference transport
- cancellation
- monitoring

---

## PHASE 5 — Text → Structured BIM Intent

Implement:

```text
Natural language
↓
Intent
↓
Structured BIM plan
↓
Validation
↓
Revit execution
```

---

## PHASE 6 — Revit Understanding

Implement:

- BIM semantic graph
- spatial relationships
- model summarization
- model QA
- complex reasoning

---

## PHASE 7 — AI Recommendations / Auto-Fix

Implement:

- structured action plans
- preview
- dry-run
- TransactionGroup
- rollback
- post-validation

---

## PHASE 8 — Multimodal

Implement:

- floor-plan understanding
- sketch understanding
- image parsing
- concept interpretation
- text + image fusion

---

## PHASE 9 — Controlled Model Improvement

Implement:

- verified training data
- fine-tuning/adaptation
- golden evaluation
- regression
- model promotion
- rollback

---

## PHASE 10 — Level 4

Target:

```text
TEXT / IMAGE / SKETCH
        ↓
ARCHITECTURAL INTENT
        ↓
LAYOUT
        ↓
2D / 3D
        ↓
BIM
        ↓
REVIT
        ↓
COMPLIANCE
        ↓
CORRECTION
```

---

# 40. FIRST MVP

The first production MVP should be:

## AI Regulatory + BIM Checker

Input:

- verified regulatory documents
- Revit model
- project context

Output:

```text
PASS
WARNING
VIOLATION
UNCERTAIN
```

with:

- source
- section
- page
- version
- calculation
- affected Revit elements
- recommended correction

No autonomous generation is required for the first MVP.

---

# 41. SUCCESS CRITERIA

The platform is successful when:

1. Existing Add-in functionality remains stable.
2. Current fast operations remain fast.
3. Local/private inference is possible.
4. Regulatory data is versioned and traceable.
5. Human corrections are structured learning signals.
6. Company knowledge is isolated.
7. New models can be evaluated and rejected.
8. Revit AI actions are validated before execution.
9. Image/sketch uncertainty is explicit.
10. Regulatory results are source-traceable.
11. Continuous learning is controlled and reversible.
12. The system can eventually support multiple companies.
13. The system can eventually support multimodal Level-4 BIM generation.

---

# 42. FINAL ARCHITECTURAL PRINCIPLE

The product should continuously evolve through:

```text
REAL WORK
    ↓
DATA
    ↓
VERIFICATION
    ↓
DATASET
    ↓
TRAINING
    ↓
EVALUATION
    ↓
MODEL
    ↓
PRODUCTION
    ↓
REAL WORK
```

Not:

```text
AI OUTPUT
    ↓
AUTOMATIC SELF-TRAINING
    ↓
NEW MODEL
    ↓
MORE AI OUTPUT
```

The goal is a **controlled, measurable, private, reversible, self-improving BIM intelligence system**.

---

# 43. CURRENT NEXT STEP

Before implementation:

1. Complete the architecture-freeze audit.
2. Finalize the canonical event model.
3. Finalize the regulatory document/rule model.
4. Finalize the trust/provenance model.
5. Finalize the Golden-Eval strategy.
6. Finalize tenant/company isolation.
7. Finalize performance budgets.
8. Finalize AI/Revit execution boundaries.
9. Review and approve the implementation order.

Only after this architecture freeze is approved should Builder Claude begin production implementation.

---

# 44. IMPLEMENTATION GUARDRAIL FOR CLAUDE

When implementing any phase:

1. Inspect the real repository first.
2. State what currently exists.
3. State exactly what will change.
4. Make the smallest safe change.
5. Run relevant tests.
6. Run build/static checks.
7. Run integration tests where available.
8. Measure performance where relevant.
9. Report all changes.
10. Report assumptions.
11. Report unresolved risks.
12. Do not silently modify unrelated systems.

When destructive, irreversible, security-sensitive, or ambiguous behavior is encountered, stop that operation and explain the risk rather than guessing.

---

# 45. MASTER PRINCIPLE

The system should eventually behave like:

> **Cursor for BIM / Architecture + Mongolian Regulatory Intelligence**

It should understand the project, detect problems proactively, explain why they are problems, identify the exact regulatory source, recommend the correct solution, and eventually execute validated fixes and generate new BIM models.

The short-term product is a **trusted compliance and BIM intelligence layer**.

The long-term product is a **self-improving multimodal architectural/BIM engineer**.
