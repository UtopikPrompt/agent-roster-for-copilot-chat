---
name: project-assessment
description: "Shared procedure for a read-only, cross-source assessment of a target project across documentation, source code, architecture, business requirements, issues and work items, and delivery practice, with evidence-linked findings and visible gaps."
---

# Project Assessment

Use within the current agent's tool list and the user's authorized scope. This skill never grants tools, delegation, writes, or source access. Collection is performed by the read-only collectors. Analysis is performed on the evidence records they return.

## Scope and Target

- P0 target root is the open workspace folder/repository root and, for project-assessment documents, the destination root; never the active file directory or a guessed subfolder. A prior assessment folder that no longer exists does not invalidate the current open workspace destination. For an open-project assessment, use that root unless the user explicitly names a different destination. Never reinterpret open project as a collection source. With multiple folders, ask at most one question naming every folder if destination ambiguity remains.
- At P0, create or choose one unique `<run-root>` beneath the target root for the entire assessment: `<target-root>/docs/project-assessment/<run-id>/`. Reuse and pass that exact run root through P2 collectors, P3/P4/P5, the modernization chain, checkpoints, and P7. Per-source and per-phase files are nested beneath it (`evidence/ado`, `evidence/local`, `phases/p5`, `checkpoints/`); no sibling run folders or top-level phase-suffix directories are allowed. Resume continues the existing run root; a new assessment creates a different unique run root.
- P1 establishes only that the exact open destination is readable and usable, and that the local collector has `read` and `search`. It must not require repository manifests or a README for a valid empty workspace. Recognized source identity signals such as `package.json`, `README.md`, `*.sln`, `*.slnx`, `*.csproj`, `pom.xml`, `build.gradle`, `build.gradle.kts`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `composer.json`, or clearly bounded solution/repository metadata are optional P2 evidence metadata, not P1 prerequisites.
- P1 reads/searches only the exact target root. Preserve user-supplied source IDs and URLs as scope. After required advisor selection, dispatch each explicitly named remote collector independently so it can inspect only its own declared runtime tool list; it may return source-local `BLOCKED` if tools or read-only behavior are absent. Never require the user to supply an inventory.
- Preserve all user-supplied data sources and identifiers exactly, including SharePoint URLs, Azure DevOps projects/teams, GitHub repositories, and source names. The exact source URLs/identifiers in the prompt define in-scope sources without follow-up. Do not ask again for project names or organization URLs already supplied. A scope declaration or identifier is not evidence that collection occurred.
- No-inventory routine: a source name or identifier alone is not evidence of bound tools. Do not ask for routine tool names, project names, scopes, resource URLs, secrets, or source identifiers. After required advisor selection, dispatch each remote collector independently. It inspects only its own declared tool list and reports source-local `BLOCKED` if tools or read-only behavior are absent. Do not inspect arbitrary MCP configuration or expand tools. Authentication or server availability is context only, never proof of read-only capability. Mark blocked source areas NOT ASSESSED and continue other sources; report each distinct blocker once without serial prompts.
- Declare the scope after one critical target clarification if needed. Otherwise declare the open local target and proceed; approved remote sources are not inferred from names alone.
- Report assessment output under the target project only when Aro has confirmed the target root and write paths with the user and dispatches `GovDocumentationSuiteGenerator`. Otherwise return the complete content in the response. Writing is never performed by this skill or by analysis workers. A short/default assessment of an unambiguous open project proceeds on local evidence without remote-source intake.

## Dimensions

Assess each approved dimension, and mark a dimension as not assessed when its evidence is missing:

- documentation
- source code
- architecture
- business requirements
- issues and work items
- delivery and project-management practices
- team constitution
- strengths and weaknesses

### Team Constitution

Team constitution is in scope by default when evidence is available. It includes formal teams, members, roles and accountability, ownership, delivery/release/QA/security/production responsibilities, capacity and operating model, and on-call or approver relationships.

- Classify each conclusion as `observed`, `asserted`, `inferred`, `contradicted`, or `UNKNOWN`, and keep the source basis visible.
- An ADO membership or assignment alone does not prove role authority or delivery ownership. A formal team name also does not prove responsibility for an application or release.
- Do not invent an org chart, role, owner, approver, capacity, team responsibility, or on-call relationship.
- Every organization or ownership conclusion cites `evidence_id` where evidence exists. Unsupported conclusions are `INFERRED` or `UNKNOWN`/NOT ASSESSED; mark evidence gaps explicitly.
- Contradictory records remain visible with their `evidence_id` values. A source that is `BLOCKED`, `DENIED`, `ERROR`, or `EMPTY` does not make the missing constitution fact negative evidence.
- Team constitution adds no routine clarification or inventory question. Use supplied evidence and continue with explicit unknowns.

## Assessment Process

Run these stages in order. Each stage records its outputs and limits before the next stage starts. This process is a proposed synthesis of common migration-assessment practice. It is not an official Microsoft or AWS deliverable.

### Scope and Intake

- Confirm P0 destination root before P2. For exactly one open workspace folder, use that repository root directly. For multiple folders, ask at most once naming the folders if destination ambiguity remains. For no open folder, ask once for the target repository/destination. Never derive the destination from the active file or from a supplied remote source URL. For the open-project short trigger, retain supplied remote source identifiers in scope but do not ask routine scope or setup questions; use the local collector and record remote families COLLECTABLE only if exact inventory matches, otherwise BLOCKED or PARTIAL.
- Run P1 before D0-D6 local discovery. P1 may perform only a bounded accessibility check and root-bounded tool verification in the exact destination; a repository root signal is optional and never a reason to stop P1. P2 may then search likely evidence locations and use any recognized source manifest it finds. Never scan parent/child paths or the whole repository to repair or invent destination identity; an empty destination continues as EMPTY/PARTIAL evidence, not NEEDS_INPUT.
- Accept prior evidence only when the user supplied it. Check each prior batch against the reuse eligibility rules in [project-evidence-ingestion](../project-evidence-ingestion/SKILL.md). A batch with canonical batch and coverage records resumes at P3, or at P5 when a P4 gate result for the same run is also supplied. Unchanged reused evidence is not re-collected; changed, missing, or inaccessible items return to P2 as targeted collection. Prior reports are prior-report context only.
- A prior SQLite source is P2 evidence only after the user confirms one exact DB path through the picker. The current open workspace remains the target/output root and owns one run root; the DB remains a separate source declaration and never becomes an output root or source of implied sibling discovery. Call only `aro_read_prior_assessment_store` with `operation`, optional `query`, `cursor`, and `pageSize` 1-20. Never pass a path, SQL, wildcard, directory, or sibling path. It provides FTS5 extracted text, not a vector index or comprehensive inventory. Bounded search may return conservative best-effort redacted excerpts; listing returns no raw excerpt. Merge only complete matching pages under one stable batch ID; otherwise retain PARTIAL/UNKNOWN and the navigation queue. Adjacent manifests are UNVERIFIED unless cryptographically bound. Never write the DB, sidecars, source folders, or analysis folders; retain reports/checkpoints under the run root.
- If the user says ingested documents already exist in the open repository and supplies source URLs/IDs, dispatch the local collector to search the repository for those source artifacts. A continuation prompt means resume prior assessment work rather than start blank. The exact open target and report destination remain the current workspace/repository root unless the user names a different target. Reuse readable corpus exports, normalized records, manifests, and prior completed analysis outputs found locally; prior report documents are context only and never primary evidence. Never ask again for target, source URLs, tool names, credentials, or canonical IDs when the prompt supplies these values. This statement is an instruction, not evidence: existence and completeness must be verified locally. Search likely evidence directories and Markdown/PDF/JSON/CSV/manifest exports without demanding a batch_id. If readable records exist, analyze them as PARTIAL/UNKNOWN coverage and continue the downstream chain with explicit constraints. Previous assessment README/summary/decision/report-package files are excluded unless the user explicitly names them as source documents.
- Write the source plan: for each source, its intended canonical `retrieval_mode` (see Ingestion Modes and Capabilities) and what that mode can and cannot show. A source with no confirmed mode is recorded as `UNKNOWN`.
- Ask at most one critical clarification, only when the target root is absent or the request names a different target. Do not ask routine tool, source, project, scope, URL, or secret questions.
- For a constrained continuation, permit partial P5/P6 when readable current or prior evidence remains. A remote source that is unavailable remains BLOCKED and is not a reason to discard readable evidence or stop the full downstream package. An unreadable continuation affects only that source and related claims. Continue P3-P6 with other verified sources or prior valid records. A source that has no readable normalized records is NOT ASSESSED; report limitations and unknowns explicitly and never claim completeness or a final go/no-go. If zero valid records exist, produce status-only P6 deliverables with no fabricated findings or GO decision.

### Ingestion and Discovery

- Ingest each source only through its declared mode. Create or update the collection-batch manifest with `actual_retrieval_mode` and the capabilities the batch actually supplied: performance data, dependency data, configuration discovery, identity/security information, and content revision history. An unconfirmed capability is `unknown`.
- Discovery produces candidate inventory items and candidate dependencies. A candidate is not a fact until it passes the validation stages below.

### Normalize and Validate

- Map every record to the evidence contract in [project-evidence-ingestion](../project-evidence-ingestion/SKILL.md): `evidence_id`, `run_id`, `scope_id`, `batch_id`, `source`, `adapter`, `collector`, `locator`, `revision`, `retrieved_at`, `status`, `coverage`, `claim_status`, and `identity_confidence`. Retrieval mode and capability coverage live only in the manifest.
- Record the point-in-time or version of each source. The assessment describes the evidence as of that point; newer performance or configuration data can change it.
- Record coverage against a declared denominator, or `UNKNOWN`. List missing fields per record and per workload. A missing field is a gap, never a zero.
- Keep duplicates and conflicting records visible with each `evidence_id`. Do not resolve a conflict by choosing a side without evidence.
- Prior-report context is never normalized into the record set and never receives an `evidence_id`.
- A successful import shows only that the import succeeded. It is not evidence of completeness; completeness requires a declared denominator.

### Dependency Discovery and Validation

- Record each dependency with its `evidence_id` and `claim_status`. Trace the dependency to mode and capability by joining `evidence_id` to the evidence record's `batch_id`, then to the collection-batch manifest. Dependencies can come from discovery, configuration, documentation, or interviews.
- Automated discovery can miss undocumented dependencies. Validate dependencies with workload owners, interviews, or architecture reviews.
- Mark a dependency `validated` only after an owner or architecture review confirms it. Otherwise mark it `unvalidated`.
- A dependency from a mode without dependency capability is `UNKNOWN`, not absent.

### Cross-Source Findings

- Apply the Analysis Rules and Finding Quality to validated and unvalidated evidence alike, and label the basis of each finding.
- Numeric performance metrics (for example CPU, memory, disk IOPS, network, peak load, or SLA targets) are allowed when the evidence contains them, with source and time window. Do not replace a sourced measurement with an estimate.

### Per-Workload Disposition

- Build the workload portfolio: one row per in-scope workload, with configuration (for example VM size, OS, storage, and licensing when supplied), security and identity inventory, criticality and lifecycle when known, dependencies, and readiness.
- Assign one disposition under the Migration Disposition rules, or `UNKNOWN` or NOT ASSESSED. A disposition rests on the manifests joined to its evidence records: `file-cmdb-import` supports lift-and-shift only.

### Prioritize and Sequence Waves

- Rank items by the Decision-Ready Report Contract rules.
- Group dependent systems into the same wave. Detail the near-term wave with its dependencies, entry and exit gates, and rollback path. Keep later waves higher-level and mark them `proposed`.
- Do not place an unvalidated dependency in a wave without a stated risk and a validation step.

### Report, Read-Back, and Validation

- Draft the report package under Report Package. Each claim cites `evidence_id` values or is labeled as an unknown, an assumption, or `proposed`.
- Persist the package by default beneath the exact P0 run root for a normal full assessment. The writer receives the confirmed target root and exact run root; never choose a new run ID or never invent a fresh run root midway. Never overwrite an existing directory or package file. A no-overwrite conflict is reported and the existing content is preserved. An explicit don't-save or chat-only override stays in chat. An explicit alternate destination replaces the default. Read back every file at the same version and verify content, links, IDs/citations, and package completeness.
- Record checks run and checks not run in `validation-log.md`. Independent review is outside this skill.

## Ingestion Modes and Capabilities

Each canonical mode has different coverage. No assessment claim may exceed the capability coverage of the collection-batch manifest joined through `batch_id`. Capability limits come from the Microsoft pages in the Reference Basis, read on 2026-11-22; confirm them against the cited page before relying on them.

| Canonical `retrieval_mode` | Source implementation examples | Capabilities and limits |
| --- | --- | --- |
| `live-connector` | Read-only project evidence connector or collector | Capabilities are those recorded in the batch manifest. Performance and dependency evidence exist only when their capability entries show them. |
| `continuous-appliance` | Appliance-based discovery, for example Azure Migrate appliance discovery with mode_label: `automated-discovery` | Can include continuous discovery, performance-based assessment, dependency analysis, and guest discovery when those features are enabled. Record which features ran. |
| `one-time-snapshot-export` | Offline snapshot collection or Azure Migrate snapshot export with mode_label: `offline-snapshot` | Provides a point-in-time snapshot with performance data. Provides no dependency analysis unless capability evidence explicitly shows it. |
| `file-cmdb-import` | CSV, RVTools, CMDB, or Azure Migrate inventory export with a source-specific `mode_label` such as `file-import` or `mapped-export-reviewed` | Shows only what the file contains. It lacks runtime performance and dependency evidence unless the manifest explicitly records them; mapping proposals require human review. A `file-cmdb-import` supports lift-and-shift only. |
| `manual-user-supplied` | Content supplied directly by the user | Capabilities are limited to what the supplied content contains. Record applicability and limitations in the batch manifest. |
| `local-read-search` | Local repository read and search with mode_label: `local-read` | Files and configuration only. No runtime performance or dependency data. Git state is `UNKNOWN` unless a read-only Git tool supplied it. |
| `UNKNOWN` | Source blocked or mode not confirmed | Makes no completeness claim and supplies no capability state beyond manifest entries. |

The source-specific labels above are `mode_label` values, not canonical `retrieval_mode` values. Preserve labels and map them to the canonical mode in `mode_proof`.

Rules:

- Record canonical `actual_retrieval_mode` and capability limits in each collection-batch manifest. Do not assume a capability that is not recorded.
- Link every evidence record to its manifest by `batch_id`. Do not repeat `retrieval_mode` or capability fields on evidence records, dependencies, or findings.
- Summarize mode and capability in reports by joining evidence records to manifests through `batch_id`.
- A `file-cmdb-import` supports only lift-and-shift. Other dispositions need evidence from another applicable capability.
- Vendor-specific behavior, such as Azure Migrate capture or polling intervals and agent deprecation dates, is recorded as a source fact at the read date. It is not a general requirement.

Tool-generated outputs: Azure Migrate assessments (Azure VM, Azure SQL, App Service, and Azure VMware Solution) and TCO benchmark reports are produced by the tool from discovered or imported data. Attach them as source artifacts with their tool and source-specific `mode_label`; record the canonical mode in the collection-batch manifest. They are not this project's narrative report.

## Analysis Rules

- Analysis is cross-source. Do not separate findings by source. Show which sources support, contradict, or fail to cover each finding.
- Every finding cites one or more `evidence_id` values and traces their `batch_id` values to collection manifests. A claim without evidence or manifest linkage is recorded as a gap.
- Keep conflicts visible in both the finding and the register. Do not resolve a conflict by choosing a side without evidence.
- No score, grade, health rating, or percentage without a declared denominator.
- A source that is `BLOCKED`, `DENIED`, `ERROR`, or `EMPTY` is labeled in every area it would have informed. Do not produce a completeness or health score while any in-scope source is not `COMPLETE`.
- Distinguish `observed` from `asserted` and `inferred` claims, using each record's `claim_status`.

## Assessment Pipeline

A request to assess a target project runs the full chain by default. Quick or inventory-only depth applies only when the user explicitly asks for it; then stop after the step the user named and list the omitted steps as not assessed.

1. Evidence synthesis (ProjectAssessmentExpert): findings, gaps, conflicts, and dimension status from the supplied evidence records.
2. Business needs and rules (BusinessKnowledgeExpert, conditional): runs only when supplied in-scope evidence or user-supplied context contains business policies, processes, requirements, data, or actor context. Otherwise business analysis is recorded as NOT ASSESSED with the exact missing source layers, and the chain continues. Do not invent requirements.
3. Capability dispositions and target-product requirements (CodeProductModernizationExpert): keep, improve, replace, remove, or add per capability, from the step 1 findings and step 2 catalogues.
4. Target architecture and scalability options (CodeArchitectureExpert): options and technical contracts grounded in the step 3 requirements and the scalability profile below.
5. Integrated decision and roadmap (CodeRebuildEngineer): decision summary, open decisions, and phased roadmap integrating steps 1 to 4.

Every step consumes only the supplied evidence records and earlier step outputs. No step reads or collects source material, writes files, or accepts decisions. Gaps return to the dispatcher.

## Scalability and Workload Profile

Capture each field as `observed` (with evidence IDs), `asserted`, or `unknown`. Do not invent values.

- Current and forecast workload: users, concurrency, requests or jobs per unit time, and throughput.
- Data volume and growth: current volume, forecast volume, growth rate, retention, and known hotspots.
- Latency and availability targets, including recovery time objective (RTO) and recovery point objective (RPO).
- Missing workload, data, or other profile values are `unknown`, never zero or silently omitted.
- Deployment: environments, regions, hosting constraints, and external service dependencies.
- Budget envelope and cost sensitivity.
- Security and compliance obligations that constrain placement or data handling.
- Team size, skills, operating model, and on-call capacity.
- Compatibility requirements: clients, APIs, data formats, and integrations that must keep working.

Ask the user only for critical scope or access decisions. Otherwise, when a target is unknown, state an explicit assumption with its basis, label it `proposed`, and present scenario-based options (for example, current load, a stated growth multiple, and a stated peak). For each option, state the conditions under which it holds.

## Finding Quality

- Classify each item as an observed defect (seen directly in evidence), a risk (plausible consequence not yet demonstrated), or an unknown (evidence absent or contradictory).
- Cite one or more `evidence_id` values for every item. An item without an evidence ID is an unknown.
- State impact, severity, or confidence only when supplied evidence supports it, and give the basis. Do not assign arbitrary scores or ratings without a declared denominator and method.
- Show source conflicts inside the finding.

## Recommendation Standard

Each modernization or architecture recommendation:

- Compares at least two viable alternatives, including the least complex option that can meet the stated targets, and records why each was kept or rejected.
- States costs, risks, operability burden, and dependencies on other capabilities or teams.
- Defines migration and rollback steps and the compatibility constraints they must preserve.
- Names measurable validation: workload scenario, metric, threshold, and measurement method. Adjectives such as scalable, reliable, or fast are not validation.
- Sets phased exit criteria, where each phase names an observable condition that must hold before the next phase starts.

## Scale and Fashion Guard

- No architecture is perfectly scalable independent of workload. A scalability statement is valid only for a named workload scenario and its stated conditions.
- Do not recommend fashionable stacks, frameworks, cloud services, or a microservices split unless supplied evidence and the workload profile justify it. Name the evidence that would change the recommendation.
- Modern does not mean distributed. A modular monolith or a managed service within the current stack is a valid option when it meets the stated targets.

## Decision-Ready Report Contract

The report must help a reader decide what to change and why. Each step fills the parts its inputs support. Omit a part only by stating it as `UNKNOWN` or NOT ASSESSED with the missing input.

- Executive decision brief (`README.md`): the recommended decision, the two or three findings that drive it, the conditions that would change it, and the confidence in each part with its basis. Business and technical goals are stated as evidenced, or as `proposed` with a basis.
- Root causes (`prioritized-findings.md`): for each problem, name the system constraint behind it (for example coupling, data ownership, release path, test coverage, or operational ownership) before its symptoms. Label each causal explanation `observed` or `inferred`. Prefer one root cause with its symptoms over a list of symptoms.
- Impact and ranking (`prioritized-findings.md`): state business or operational impact only when evidence supports it, otherwise `UNKNOWN`. Rank items by urgency and value, and give the basis for each rank (for example an observed failure, change frequency in evidence, or a stated constraint). Severity and confidence are stated with their basis, never as a numeric score.
- Ranked recommendations (`options-and-business-case.md`): order recommendations by the ranking above. Each compares at least two viable alternatives, including the least complex option that can meet the stated targets. For each alternative, record why it was kept or rejected, its tradeoffs, the conditions under which it holds, and the decision that selects it.
- Transition state: the target state, the transition architecture (what runs during migration, coexistence, and data or interface compatibility), dependencies between steps, and the rollback path for each step.
- Delivery and operating model: delivery sequence, operating implications (release, on-call, ownership, skills), and security, cost, and risk implications. Each is stated as evidenced, proposed, or `UNKNOWN`. Name roles only where evidence or a labeled proposal supports them. Do not invent owners.
- Phased roadmap: phases with phased exit criteria. Each exit criterion is an observable condition with its metric, threshold, and measurement method.
- Experiments and acceptance criteria: measurable validation for each recommendation, with workload scenario, metric, threshold, and measurement method. Thresholds come from stated targets or are labeled `proposed`. Do not supply a benchmark figure that the evidence does not contain.
- Estimates and ROI: omit unless supplied evidence supports them. When present, label each as an `estimate` or `proposed`, state its assumptions and basis, and state its uncertainty range. Do not state ROI, payback, or savings without measured inputs.
- Unknowns: a `What we cannot conclude` list of claims the evidence does not support, including the scalability and fashion limits below.
- Next evidence: the decisions the user must make, and the highest-value next evidence or measurement in priority order, each with the question it would answer.
- Do not fabricate benchmark numbers, costs, compliance status, capacities, users, or owners.

## Report Quality Contract

- Completeness by scope: state the declared scope and denominator. Each in-scope item is evidenced, dispositioned with a reason, or `UNKNOWN`. Claim completeness only for the declared scope.
- Claim-to-evidence traceability: each claim cites `evidence_id` values, or is labeled as an assumption, unknown, or `proposed`.
- Explicit assumptions and unknowns: each assumption states its basis and status. Unsupported claims appear in the What we cannot conclude list.
- Alternatives: each recommendation has at least two viable alternatives (Recommendation Standard).
- Measurable validation: each recommendation names a workload scenario, metric, threshold, and measurement method.
- Prohibited claims: do not write "ultimate", "best in market", "best on the market", "better than everything available", "industry-leading", or any similar superiority claim. No source in the Reference Basis verifies such a claim. Describe findings only as evidenced against the declared scope.
- Format checks are not validation. A report that follows this contract is not thereby correct.

## Quality Lenses

Assess each lens that the declared scope or the user's request includes. Record a lens as `UNKNOWN` or NOT ASSESSED when its evidence is missing, and as out of scope when the scope excludes it. Cite `evidence_id` values for every observation; a lens statement without one is an unknown.

- Reliability and resilience: observed failure modes, dependency failure handling, and availability evidence.
- Recovery: backup, restore, and failover evidence measured against the stated RTO and RPO. Name the drill that would verify an untested recovery claim.
- Security: observed protection and threat-mitigation controls (identity, secrets handling, data protection, dependency and configuration hygiene). Do not state compliance status without evidence.
- Cost optimization and financial limits: cost model, budget envelope, and waste signals, following the Cost Lifecycle below.
- Performance: measured latency, throughput, and resource use against the workload profile. A performance claim without a measurement is an unknown.
- Operational excellence: observability (logs, metrics, traces, alerting), safe deployment (release path, rollback, change frequency), and on-call ownership.
- Sustainability: include only when the scope or the user asks for it, or when measured evidence supports a finding. Otherwise record NOT ASSESSED.

## Quality-Attribute Scenario Record (ATAM-inspired, not a full ATAM)

Use this lightweight record for architecture, reliability, and performance findings. It adapts scenario elicitation from the SEI ATAM collection. It is not a full ATAM evaluation: it has no utility tree, stakeholder workshop, risk or non-risk review, or sensitivity and tradeoff point analysis. Fill one record per finding:

| Field | Content |
| --- | --- |
| `scenario_id` | Stable identifier within the report |
| `business_driver` | Evidence-backed driver with `evidence_id`, or `UNKNOWN` |
| `attribute` | A lens from Quality Lenses, for example reliability, performance, or recovery |
| `stimulus_context` | Triggering event or condition, with environment and named workload scenario |
| `response` | What the system does, as observed or as proposed |
| `measurable_response` | Metric, threshold, and measurement method, from a stated target or labeled `proposed` |
| `evidence_ids` | Cited `evidence_id` values; none means `UNKNOWN` |
| `claim_status` | `observed`, `asserted`, `inferred`, `contradicted`, or `unknown` |
| `target` | Observed baseline, or a `proposed` target with its basis |

Rules:

- A scenario without a measurable response is an unknown, not a defect finding.
- A scenario does not set rank. Ranking follows the Decision-Ready Report Contract.

## Delivery and Project-Management Metrics (DORA-based, source-specific)

The DORA guide defines five measures: change lead time, deployment frequency, failed deployment recovery time, change fail rate, and deployment rework rate. Treat them as a source-specific metric set, not a universal project-management health score. Apply these rules:

- Use a metric only when evidence supplies it. Absent data is `UNKNOWN`, never zero.
- Scope each metric to one application or service. Do not blend services into one figure.
- Record, for each value, its source, time window, denominator, and definition version.
- Metric definitions changed over time. Do not compare values across periods or sources unless their definitions are reconciled.
- Treat throughput (change lead time, deployment frequency) and instability (change fail rate, failed deployment recovery time, deployment rework rate) together. Do not report one group alone as a health signal.
- Do not compare teams or projects with these metrics, and do not use them as individual or team goals.
- Do not produce a composite score or grade from these metrics.
- Record an owner only when supplied. Note where ownership is siloed and limits interpretation.

## Migration Disposition

Assign each in-scope workload one disposition from the table below, or record `UNKNOWN` or NOT ASSESSED. A disposition is a recommendation under evidence, not a mechanical label. Split a workload that has distinct parts into separate rows.

| Disposition | Working meaning (confirm against the cited Microsoft page before use) |
| --- | --- |
| Retire | The workload is no longer needed, duplicated, or unused. |
| Retain | The workload stays as it is for a stated reason, such as a dependency, a constraint, or a later planned change. |
| Rehost | The workload moves with little or no change to its code. |
| Replatform | The workload moves with limited changes to use a platform capability. |
| Refactor | The code changes to fit the target platform, with the architecture largely kept. |
| Rearchitect | The application architecture changes to meet the target. |
| Rebuild | The workload is rewritten on the target platform. |
| Replace | The workload is replaced by another product or service. |

Rules:

- Each disposition requires an evidence-backed business driver and at least one key indicator with a baseline, a target, and a measurement method. Targets are stated or labeled `proposed`. Without them the disposition is `UNKNOWN`.
- For each workload, record at least one alternative that was considered, with its tradeoffs and whether it was kept or rejected. Record its dependencies on other workloads, data, interfaces, teams, and compliance obligations.
- Do not derive a disposition from workload type or a platform preference. Name the evidence that would change it.
- Exactly one disposition per workload row. If evidence conflicts, show the conflict and record `UNKNOWN`.

Report each workload in `workload-portfolio.md` as: workload | disposition | business driver (`evidence_id` or `UNKNOWN`) | key indicator (baseline, target, measurement method) | alternatives and tradeoffs | dependencies.

## Cost Lifecycle

Cost is iterative. Repeat these stages whenever the workload or the target changes:

1. Current baseline: observed run cost and usage, with `evidence_id` values. Use `UNKNOWN` when no billing or usage evidence is supplied.
2. Migration and investment cost: one-time and ongoing change costs, taken only from supplied figures or labeled `proposed` with assumptions.
3. Expected target run cost: stated only when supplied pricing or sizing evidence supports a target model. Otherwise `UNKNOWN`. Label it `estimate` with its assumptions and uncertainty range.
4. Optimize and operate: remeasure the baseline after each change, compare it with the budget envelope and financial limits, and record waste findings with evidence. The result is the input to stage 1 of the next cycle.

Do not invent cost values, savings, or ROI. Do not state payback or return without measured inputs.

## Report Package

The package below is a proposed synthesis for this project. It is not an official Microsoft or AWS deliverable. The proposed output layout is not yet approved. Use these names so that a later persistence step can map them directly. A file exists only for a distinct reader task.

- `README.md`: executive decision summary with the recommended decision, the two or three findings that drive it, the conditions that would change it, and confidence with its basis. Also cover status, resume point, and next action. Business and technical goals are stated as evidenced or `proposed`.
- `assessment-method-and-data.md`: scope, source plan, ingestion and retrieval modes, provenance (lineage and point-in-time), source coverage register with denominators and `UNKNOWN` items, missing fields, gaps, and limitations. Consolidates the earlier coverage register and gaps list.
- `workload-portfolio.md`: inventory, configuration, criticality and lifecycle when known, security and identity inventory, readiness, and one disposition per row.
- `dependency-analysis.md`: dependency register with `evidence_id`, `batch_id`, `claim_status`, and validation status, plus discovery limits and unvalidated dependencies. Mode and capability are joined from the manifest for reporting.
- `business-requirements.md`: requirements with evidence references, or NOT ASSESSED with the exact missing source layers.
- `architecture-c4.md`: observed current-state architecture (context, container, component).
- `code-doc-consistency.md`: where documentation and code agree or disagree.
- `project-management.md`: delivery and project-management practice.
- `prioritized-findings.md`: root-cause findings, evidence-backed strengths, and ranked risks. Consolidates the earlier strengths and risks file.
- `options-and-business-case.md`: alternatives for each recommendation, and only evidence-backed costs. Cost values follow the Cost Lifecycle; otherwise `UNKNOWN` or NOT ASSESSED.
- `target-state.md`: target architecture, transition and coexistence, compatibility constraints, and the rollback path per step.
- `migration-roadmap.md`: waves, dependency grouping, gates, rollback, phased exit criteria, and experiments with acceptance criteria.
- `validation-log.md`: checks run, checks not run, and their results.

Rules:

- Filenames are stable across revisions. Revision data lives in document metadata.
- Existing files and directories are preserved. Never overwrite; report a conflict and leave existing content unchanged.
- Default save root: the exact P0 run root `<open-target-root>/docs/project-assessment/<run-id>/`. A normal full assessment authorizes this write by standing instruction; explicit don't-save/chat-only or an alternate destination overrides it. The P7 writer receives this run root and must not choose a new run ID or sibling folder. Nested evidence, `phases/`, `checkpoints/`, Markdown reports, and `executive-decision.html` all stay beneath it.
- Partial and BLOCKED assessments still create every package artifact, including the standalone executive HTML, even when evidence is absent. Partial and BLOCKED assessments use accurate PARTIAL/BLOCKED/NOT ASSESSED status, scope, limitations, exact missing sources/reasons, and concrete next evidence/steps. If zero valid records exist, create a status-only package with no fabricated findings or GO decision. Never create a product go/no-go claim without evidence.
- Mark a business section NOT ASSESSED when its sources are absent. Do not invent a requirement.
- Technical package: the Markdown files above carry the detailed technical content. `architecture-c4.md` covers context, container, and component views, and `target-state.md` covers the target architecture. Within these files, add data, interface, trust-boundary, and deployment views; Dev, QA, production, and DevOps practice; tests and regression prevention; schemas and diagrams where evidence supports them; and risks, evidence gaps, unknowns, and assumptions. Mermaid is allowed in Markdown only. Use one read-only architecture or documentation owner from the chain outputs where appropriate.
- For both the technical Markdown package and the executive HTML, expand internal labels and acronyms on first use and include a concise acronym/abbreviation index or glossary. At minimum, define `P0` as "scope and target" and `P1` as "runtime inventory gate"; do not leave readers to infer report-internal labels. Expand other abbreviations only from supplied evidence or their unambiguous supplied meaning. If an expansion cannot be established, retain the original label with `UNKNOWN` or explicitly state that the expansion is unavailable; never guess a technical meaning.
- Executive HTML decision page: P6 also drafts a standalone document, `executive-decision.html`, as the default executive deliverable for project assessments only. Other README and export outputs are not converted to HTML. It contains, in order: the headline decision (Go, Conditional Go, or No-Go); decision confidence with its evidence basis; key metrics only where supplied evidence contains them; no health or completeness score while any in-scope source is incomplete; executive summary; current-state diagnosis; target recommendation; major risks and mitigations; regression and operability gates; decisions and approvals needed; phased next steps (30/60/90 days or phases); and limitations. Include the same concise acronym/abbreviation index or glossary before the detailed decision content and mark missing expansions UNKNOWN. Use semantic HTML, a responsive viewport, inline CSS and inline SVG only, and a print-friendly layout. Use no external dependencies, CDNs, runtime rendering, secrets, or invented metrics. Mark missing values UNKNOWN.

## Stop and Resume

- Navigation stops per area on `CONVERGED`, `BLOCKED`, or `DEFERRED`, and for the whole run only when every area has a sufficiency state.
- Save a progress checkpoint after P0/P1, each source P2 attempt, P3/P4, and P5/chain stages. The checkpoint is a checkpoint-only write beneath the exact P0 run root, for example `<run-root>/checkpoints/progress-checkpoint.md`; it is separate from and does not replace P7 final report persistence. The existing P7 gate remains for final reports. Resume continues the existing run root; never choose a fresh run ID or sibling folder midway. Never overwrite, and include run/scope, source status, batch ids, accepted record refs, completed phase, pending queue, failures/gaps, and next phase.
- Resume from the latest readable checkpoint, use existing valid evidence and analysis outputs, and collect only deltas. Do not treat prior reports as source evidence. If the writer is unavailable, state `checkpoint not persisted`, preserve the checkpoint in chat for resume, and continue P3-P6.
- Record the resume point, remaining queue, and blocked sources in the source coverage register in `assessment-method-and-data.md`.
- Resume reuses only supplied prior records that pass the reuse eligibility rules in [project-evidence-ingestion](../project-evidence-ingestion/SKILL.md). Completed containers are reused only when eligible; a later run must not assume containers were saved unless the user supplied the checkpoint package.
- Prior report documents are prior-report context only, never normalized evidence.

## Reference Basis

These references are examples, not endorsements or a universal standard. They are vendor-specific, and their versions and dates are not confirmed.

- Read in full: [Microsoft Azure Well-Architected Framework pillars](https://learn.microsoft.com/en-us/azure/well-architected/pillars). Source of the workload concerns, design principles, and tradeoffs behind the Quality Lenses.
- Read in full: [Select your cloud migration strategies](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/plan/select-cloud-migration-strategy). Source of the Migration Disposition choices.
- Read, body truncated before later sections: [Assess your workloads for cloud migration](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/plan/assess-workloads-for-cloud-migration). Source of the workload inventory fields (performance metrics, configuration, security and identity inventory). It notes that automated discovery may miss undocumented dependencies and that an assessment is point-in-time.
- Read: [Migration wave planning](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/migrate/migration-wave-planning). Source of dependency grouping into waves and the detailed near-term wave.
- Read: [Azure Migrate assessment types](https://learn.microsoft.com/en-us/azure/migrate/concepts-assessment-overview?view=migrate). Source of the tool-generated assessment outputs, which are not this project's report.
- Read: [Azure Migrate discovery methods and modes](https://learn.microsoft.com/en-us/azure/migrate/discovery-methods-modes?view=migrate). Source of the ingestion mode capabilities.
- Read: [Azure Migrate dependency analysis](https://learn.microsoft.com/en-us/azure/migrate/concepts-dependency-visualization?view=migrate). Its polling, sending, and agent deprecation details are source facts at the read date, not general requirements.
- Read: [AWS Application portfolio assessment guide](https://docs.aws.amazon.com/prescriptive-guidance/latest/application-portfolio-assessment-guide/introduction.html). Source of the stakeholder, portfolio discovery, dependency, rationalization, and iterative grouping steps.
- Read: [AWS Detailed portfolio discovery](https://docs.aws.amazon.com/prescriptive-guidance/latest/strategy-migration/detailed-portfolio-discovery.html). Context for the 7Rs dispositions. Its labels differ from the Migration Disposition table, which is not mapped one-to-one.
- Microsoft and AWS pages are vendor-specific and describe product behavior as of 2026-11-22. Their content may change.
- Optional reading, `snippet-only, not independently verified`: [AWS Well-Architected](https://aws.amazon.com/architecture/well-architected/), [Google Cloud performance optimization pillar](https://docs.cloud.google.com/architecture/framework/performance-optimization), and [FinOps Foundation, FinOps Phases](https://www.finops.org/framework/phases/). Do not rely on their detailed content as requirements.
- Excluded: ISO 25010. Its sources conflicted on version and the ISO page was not accessible, so no ISO quality characteristic is cited or used.
- Not used as requirements: Google Cloud manual import and offline assessment material (snippets only) and NIST (not searched).
- Read: [SEI ATAM Collection](https://www.sei.cmu.edu/library/architecture-tradeoff-analysis-method-collection/), collection page dated 2018-02-14, read 2026-11-22. Basis for the Quality-Attribute Scenario Record only. Its "leading method" wording is self-description, not independent comparative evidence. This skill does not conduct a full ATAM evaluation.
- Read: [DORA software delivery performance metrics](https://dora.dev/guides/dora-metrics/), undated page, read 2026-11-22. Basis for the five-measure set and the scope and misuse rules. Not a universal project-management health score.
- Read, first part only: [DORA history of software delivery metrics](https://dora.dev/insights/dora-metrics-history), dated 2026-01-02. Metric definitions changed over time, so definition versions are recorded.
- Limits: no authoritative source was verified for a market-leading or better-than-everything-available claim, and none is made. ISO 25010 remains excluded. The SPACE paper full text was inaccessible (snippets only) and is not relied on.

Evidence contract, status values, and navigation ledger fields are defined in [project-evidence-ingestion](../project-evidence-ingestion/SKILL.md).
