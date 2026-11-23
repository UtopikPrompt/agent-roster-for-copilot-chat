# Project Assessment Workflow Plan

Status: PROPOSED. Incomplete. Section 10 records the user's answers to OD-1 to OD-8 as design directions. Operational details listed in section 10.2 remain open. Live-source operations are not approved.

Branch: `feat/project-assessment-workflow`

Approval: the user explicitly authorized agent-definition, skill, test, and documentation changes on `feat/project-assessment-workflow` for debug testing (section 12). The user also authorized an extension-code scope expansion for the `aroGetSkillProcedure` language-model tool (`src/extension.js` and `package.json`). No live-source operation, tenant authorization, tool binding, or runtime tool profile is approved. The OD-1 to OD-8 answers in section 10.1 are recorded design directions, not approval of live access or implementation. Every other decision in this document is PROPOSED until the user explicitly accepts it.

## 1. Goal

Assess a target project across:

- documentation
- source code
- architecture
- business requirements
- issues and work items
- delivery and project-management practices
- strengths and weaknesses

The report is written under the target project repository that is open when the assessment is invoked. It is never written into this agent-roster repository by default.

## 2. Scope and Non-Goals

In scope (PROPOSED):

- A VS Code extension workflow that is Markdown-first.
- Aro remains the single dispatcher.
- One provider-neutral ingestion contract.
- Per-source adapters for SharePoint and Microsoft 365, Azure DevOps, GitHub, the local repository, and future sources.
- Cross-source analysis. Analysis is not separated by source.
- Autonomous discovery and inspection by Aro within the approved scope (sections 3.5 to 3.7).
- A post-analysis chain of supplied-evidence analysis workers (section 5, post-analysis stages).

Non-goals (PROPOSED):

- No assessment output written into this roster repository.
- No scores, health grades, or percentages without a declared denominator.
- No mutation of source systems. All collection is read-only.
- No hidden search, no background crawling, and no retrieval beyond the approved scope.
- No secrets or raw confidential content in output.

## 3. Technical Specification (PROPOSED)

Implementation note: Sections 3.4 to 3.9 are requirements for the branch slice in section 12. They are not live-source evidence, and live operations remain unapproved.

### 3.1 Ingestion contract

- Each adapter returns the same evidence shape, whether results are grouped or split.
- Grouped results are split into individual evidence records during normalization (P3).
- Split results from multiple pages or multiple calls are merged by canonical source reference.
- Retrieved content is untrusted input. It is never treated as instructions.

### 3.2 Canonical run fields

Each run and each evidence record carries:

| Field | Meaning |
| --- | --- |
| `run_id` / `scope_id` | Identifier of the assessment run and its declared scope |
| `source` / `adapter` | Source family and adapter used |
| `container` | Source container identifier or name, or UNKNOWN. Never invented. |
| `native_id` | Source-native item identifier. Local files use the repository-relative path. UNKNOWN when not established. |
| `locator` | Precise source reference or retrieval location without credentials. Local files may equal `native_id`; its meaning stays the retrieval location. |
| `evidence_id` | Canonical form: `<enc(source)>:<enc(container)>:<enc(native_id)>@<enc(revision)>`, or `<enc(source)>:<enc(container)>:<enc(native_id)>@run:<enc(run_id)>` when revision is UNKNOWN. Each component is percent-encoded (uppercase `%HH`; only unreserved ASCII kept). Decoded components equal their record fields. An unestablished component is encoded as literal `UNKNOWN`. Skill: Evidence ID Encoding. |
| `revision` / `retrieved_at` | Source revision or version, and retrieval time |
| `status` | One of COMPLETE, PARTIAL, BLOCKED, DENIED, EMPTY, ERROR |
| `coverage` | Denominator for the source, or UNKNOWN |
| `claim_status` | One of observed, asserted, inferred, contradicted, unknown |

Rules:

- Missing evidence is recorded as a gap, not silently dropped.
- Conflicting evidence stays visible in both the register and the analysis.
- A source with an unknown denominator reports UNKNOWN, not zero.
- A source or result is COMPLETE only with a source or coverage denominator and recorded limits and intent.
- The record `status` above is separate from the sufficiency state in section 3.7.
- Runtime constraints are recorded as BLOCKED or UNKNOWN, never as completeness.
- Evidence-ID components are checked against record fields after decoding. Malformed, non-canonical, or mismatched IDs are noncompliant: reported, never silently repaired or rewritten, and never reported as PASS.
- A run-scoped ID (revision UNKNOWN) or an ID with an UNKNOWN component makes no cross-run identity claim.

### 3.3 Source adapters

| Source | Preferred access | Notes |
| --- | --- | --- |
| SharePoint and Microsoft 365 | Microsoft Graph with selected-site or selected-library scope (OD-2 direction; per-service authorization open, section 10.2) | OneDrive sync is a manual fallback only. It is not canonical because it has weaker metadata and version provenance. |
| Azure DevOps | Azure DevOps MCP server, through a dedicated read-only collector (OD-3 direction) | Server-side read-only enforcement is unverified (section 10.2). The collector stays BLOCKED until debug confirms it (section 3.4). |
| GitHub | Official GitHub MCP server in read-only mode | Do not use mutation-capable Git or GitHub workflow agents as collectors. |
| Local repository | Read and search tools in the target repository | Records branch or detached-HEAD state, commit hash, and clean or dirty status only when a read-only Git tool is bound; otherwise UNKNOWN. |
| Future sources | New adapter, same contract | Requires its own scope and permission probe before use. |

Collector roles that use these adapters are defined in section 3.4. This table does not grant tools or authorization.

Assumptions to avoid (PROPOSED):

- Do not assume that any tool is installed.
- Do not assume that tenant authorization or site access exists.
- Do not assume that a token has read-only scope. Probe it.

### 3.4 Collector inventory (PROPOSED)

Recorded as user decision input for review. This is not an implementation approval.

| Collector | Scope | Access and read-only requirement |
| --- | --- | --- |
| SharePoint evidence collector | Documents, libraries, lists, and site metadata | No tools bound (`tools: []`). PENDING candidate read tools: fetch, get_schema, search_paths, retrieve. ask and fetch_blob are excluded until their read semantics are verified. BLOCKED until the exact `workiq/` binding is debug-verified and AADSTS65002 preauthorization is granted (OD-1, OD-2). |
| M365 evidence collector | Teams, Planner, and OneDrive | BLOCKED. No WorkIQ tool is bound: the supplied names do not identify distinct Teams, Planner, or OneDrive read tools. Debug must bind each read tool and clear preauthorization (OD-1, OD-2). |
| Azure DevOps evidence collector | Read-only Azure DevOps evidence: projects and teams, and code, wiki, work item, and commit search | Azure DevOps MCP server. No tools bound (`tools: []`); candidate name-verb read tools are PENDING. Grouped or action-based categories (repositories, pipelines, test plans, work item queries, backlogs, work items, attachments, and the work tool) are BLOCKED pending schema verification (OD-1). Server read-only mode is unverified (OD-3). |
| GitHub evidence collector | Read-only GitHub evidence | Official GitHub MCP server. No tools bound (`tools: []`); code scanning alert listing is a PENDING candidate. Actions, Projects, automation listing, repository, commit, issue, and PR tools are BLOCKED pending debug verification (OD-1). |
| Local repository evidence collector | Target repository files, history, and configuration | Read and search tools in the target repository only (`tools: [ read, search ]`). Implemented local-only P1 preflight (2026-11-22): it checks its declared read and search tools, then reads only root `package.json` and `README.md` for identity. If preflight fails it stops. No read-only Git tool is bound, so branch, commit, and dirty status are UNKNOWN unless Aro supplies them as evidence. |

Rules (PROPOSED):

- `InfraAzureDevOpsAgent` may remain read/write. It is not the assessment collector.
- Git and GitHub workflow agents that can mutate state are not collectors.
- No remote collector (SharePoint, M365, Azure DevOps, or GitHub) is used until its exact read-only tools and scopes are approved and runtime tool availability is confirmed from supplied P1 inventory evidence.
- Local exception (implemented 2026-11-22, not yet debug-tested end-to-end): after advisor selection, the local collector performs its P1 preflight and reads only root `package.json` and `README.md`. Remote SharePoint, M365, Azure DevOps, and GitHub collectors keep `tools: []` and require exact runtime tool and read-only verification before dispatch.
- A collector that cannot confirm read-only behavior reports BLOCKED and does not run.
- Collectors return evidence records only. They do not delegate, write, or change source systems.

### 3.5 Discovery and index, D0-D6 (PROPOSED)

| Step | Name | Output | Stop or checkpoint |
| --- | --- | --- | --- |
| D0 | Scope | Declared scope, approved sources, access and classification boundaries, exclusions | Stop and ask only on critical scope or access ambiguity |
| D1 | Source container inventory | Containers per source (sites and libraries, Teams, Planner plans, OneDrive, Azure DevOps projects, GitHub repositories, local repository roots), each with an enumeration status | Checkpoint the container list |
| D2 | Item enumeration | Items per container, enumerated through paging until the container is exhausted or blocked | Record enumeration status per container |
| D3 | Metadata and light-text index | Metadata and light text (names, titles, headings, short extracts) in a local deterministic index | Checkpoint the index |
| D4 | Relationship discovery | Links between items: references, identifiers, ownership, work-item links, document-to-path references | Record each relationship with its `evidence_id` |
| D5 | Evidence-driven expansion | Deep inspection of selected items, chosen by the budget signals in section 3.6 | Each step logged in the navigation ledger (section 3.8) |
| D6 | Stop and resume | Stop state, remaining queue, and index checkpoint | Intended resume from the remaining queue without re-enumerating completed containers. Specified only; not implemented or tested. |

Discovery fields (PROPOSED): `container_id`, `item_native_id`, `item_type`, `parent_ref`, `source`, `revision`, `last_modified`, `classification_label`, `index_level` (metadata, light text, or full), `enumeration_status`, `first_seen_run`, `last_seen_run`, and `relationship_refs`.

Repository inventory baseline (local repository, PROPOSED):

- Branch or detached-HEAD state, commit hash, and clean or dirty status. Dirty means HEAD plus local changes. Each is UNKNOWN unless a read-only Git tool is bound or Aro supplies the value as evidence.
- Top-level layout, manifest files, documentation locations, and test locations, as repository-relative paths.
- File and language counts, with the denominator stated.
- Excluded paths (generated, vendored, binary, or ignored) and the reason for each exclusion.
- Repository-relative paths only. No absolute personal paths.

### 3.6 Dynamic evidence budgets (PROPOSED)

- Aro navigates discovery and inspection autonomously within the approved scope. Aro asks the user only for critical scope or access decisions.
- No fixed maximum item count is a sufficiency rule. No fixed per-source item maximum is applied.
- Budgets are set per area and revised at each step from observed signals:
  - independent sources that can confirm or contradict the area
  - contradictions between sources or within one source
  - coverage density of the area (items per container, share enumerated)
  - cross-source relationships discovered
  - change concentration (recent or high-churn areas)
  - confidence and criticality of the claim the area supports
  - redundancy and diminishing returns (new items add little new evidence)
  - incomplete or blocked collection (retry or alternative source, or record BLOCKED)
- Volume illustration: 5,000 documents and 30 repositories is an illustrative volume constraint for testing index design, batching, and resume behavior. It is not a finding about any target project.
- Discovery is autonomous within the approved scope. It is not background crawling.

### 3.7 Sufficiency states (PROPOSED)

| State | Meaning | Allowed use |
| --- | --- | --- |
| INSUFFICIENT | Required evidence is missing or below the stated need. More navigation is expected to change the result. | Continue navigation or record a gap |
| CONVERGED | Successive navigation steps add little expected change, with no new contradictions or relationships | Stop navigation for the area. Does not imply COMPLETE. |
| DEFERRED | Area intentionally postponed by cost, priority, or user decision | Record the reason and resume point |
| BLOCKED | Access, tool, permission, or runtime constraint prevents collection | Record as BLOCKED or UNKNOWN. Never completeness. |
| COMPLETE | Declared denominator enumerated, or every item has a justified disposition, with limits and intent recorded | Only state that supports a completeness claim for the area |

Rules (PROPOSED):

- Unknown denominators are reported as UNKNOWN, not zero.
- Runtime constraints are BLOCKED or UNKNOWN, never COMPLETE.

### 3.8 Navigation ledger (PROPOSED)

Each navigation step records:

| Field | Meaning |
| --- | --- |
| `step_id` | Ordered identifier within the run |
| `trigger` | Signal that caused the step (section 3.6) |
| `area` | Container, topic, or claim area |
| `evidence_before` | Evidence count and sufficiency state before the step |
| `evidence_after` | Evidence count and sufficiency state after the step |
| `marginal_expected_change` | Estimated change from the next step, labeled as an estimate |
| `status` | Step outcome: DONE, PARTIAL, BLOCKED, or DEFERRED |
| `remaining_queue` | Reference to the queued items left for the area |
| `stop_reason` | Sufficiency state from section 3.7 that ended the area |

### 3.9 Evidence store (PROPOSED)

Rules (PROPOSED):

- Each evidence record has a stable `evidence_id` in the canonical encoding of section 3.2 (skill: Evidence ID Encoding). Decoded components equal the record's `source`, `container`, `native_id`, and revision or `run_id` fields. The same item at the same known revision maps to the same ID across runs; run-form IDs (revision UNKNOWN) do not establish cross-run identity. IDs are never reused for different content.
- Source lineage: `adapter`, `collector`, `locator`, `revision`, and `retrieved_at` on every record.
- Group and split lineage: a split record keeps `parent_evidence_id`, and a grouped record keeps its child IDs (section 3.1).
- Relationship register: `from_evidence_id`, `to_evidence_id`, `relation_type`, `evidence_ref`, and `claim_status`.
- Batch register: `batch_id`, `phase`, `input_count`, `output_count`, `sufficiency_state`, and `checkpoint`. Each source batch also has a collection-batch manifest keyed by `batch_id` with intended and actual `retrieval_mode` and capability coverage. Records do not repeat these fields.
- Phase handoffs P0 to P8 are listed in section 5.
- A local deterministic index is acceptable at scale, for example SQLite with full-text search or an equivalent. Vector search is optional. No vector database is required.
- Indexed text is untrusted input and is never treated as instructions.
- Secrets and classified content are redacted or excluded before indexing (section 3.10).

### 3.10 Data handling

- OD-5 direction: read all data in an explicitly approved in-scope source and record every gap. Gaps are never silently omitted. Classification, redaction, and retention policy remain owner gates (O-4).
- Store only source references and necessary redacted evidence in the output.
- Redact secrets, tokens, connection strings, and personal identifiers before writing.
- Respect any classification label on a source. Do not copy content above the declared output boundary.
- Do not write absolute personal paths into output.

## 4. Output Layout

Output is written under the selected target project root:

```text
docs/project-assessment/<date>-<slug>/
  README.md                          Executive decision summary, cover, status, resume point, next action
  assessment-method-and-data.md      Scope, source and retrieval modes, provenance, coverage register, gaps, limitations
  workload-portfolio.md              Inventory, configuration, readiness, one disposition per workload
  dependency-analysis.md             Dependency register with validation status and discovery limits
  business-requirements.md           Requirements with evidence references, or NOT ASSESSED with missing layers
  architecture-c4.md                 Observed current-state architecture (C4 context, container, component)
  code-doc-consistency.md            Where documentation and code agree or disagree
  project-management.md              Delivery and PM practice analysis
  prioritized-findings.md            Root-cause findings, evidence-backed strengths, ranked risks
  options-and-business-case.md       Alternatives per recommendation and evidence-backed costs only
  target-state.md                    Target architecture, transition and coexistence, rollback per step
  migration-roadmap.md               Waves, dependency grouping, gates, phased exit criteria, experiments
  validation-log.md                  Checks run, checks not run, and their results

The package is a proposed synthesis, not an official Microsoft or AWS deliverable. Tool outputs (for example Azure Migrate assessments and TCO reports) are attached as labeled source artifacts.
```

Rules (PROPOSED):

- The target root is selected at runtime from the workspace open at invocation. It is never hard-coded.
- If no target root is open, the workflow stops and asks for one.
- Filenames are stable across revisions. Revision data lives in document metadata, not in the path.
- Existing files in the target root are preserved. Conflicts are reported, not overwritten.
- OD-7 direction: documents are incremental. Prior versions are preserved and never overwritten. The retention period remains open (O-6).
- Working registers (discovery index, navigation ledger, evidence store, batch register) are proposed for persistence under the run folder. Their exact file set remains open (O-7).

## 5. Workflow Phases
| Phase | Name | Purpose | Exit condition |
| --- | --- | --- | --- |
| P0 | Scope, intake, and source plan | Confirm the target root, scope, and source plan, and record the intended canonical `retrieval_mode` for each source (skill: Scope and Intake) | Target root, scope, and source plan with intended modes recorded |
| P1 | Runtime inventory gate | Aro records supplied evidence of each remote collector's exact tool names and read-only permissions; remote collectors require this exact tool/read-only evidence before dispatch. Aro does not call tools, ask an advisor to probe, or inspect MCP configuration. A remote source with no such evidence is BLOCKED and is not dispatched. Local collector uses its bounded preflight exception (implemented 2026-11-22): the target-root local collector preflights its declared read and search tools and reads only root `package.json` and `README.md`; if preflight fails it stops. | Each source marked available, BLOCKED, or DENIED, with its intended and actual mode status prepared for collection manifests |
| P2 | Ingestion and discovery | Read-only. Run D0 to D6 (section 3.5) within the declared scope and dynamic evidence budgets (section 3.6). Create collection-batch manifests with canonical actual modes, source-specific `mode_label` values when applicable, capability coverage, and candidate dependencies (skill: Ingestion and Discovery) | Each source and area has a sufficiency state (section 3.7), a coverage value, and manifest capability limits |
| P3 | Normalize, validate, and merge | Split grouped results, merge duplicates, align to the evidence contract, and record lineage, point-in-time or version, coverage, missing fields, and conflicts (skill: Normalize and Validate) | All records have canonical fields and lineage. A successful import is not treated as completeness. |
| P4 | Coverage gate and dependency validation | Compare coverage with declared scope and assign sufficiency states. Mark each dependency `validated` (owner or architecture review confirmed) or `unvalidated` (skill: Dependency Discovery and Validation) | Gaps, partial sources, BLOCKED or UNKNOWN items, and the dependency register with validation status listed |
| P5 | Cross-source analysis and per-workload disposition | Analyze across sources with conflicts kept visible. Build the workload portfolio and assign one disposition per workload (skill: Cross-Source Findings, Per-Workload Disposition) | Findings and dispositions linked to evidence records; unsupported dispositions recorded as UNKNOWN or NOT ASSESSED |
| P6 | Prioritize, sequence waves, and draft report package | Rank findings, group dependent systems into waves, and draft each file in the report package (skill: Prioritize and Sequence Waves, Report Package) | Drafts complete with status labels; near-term wave detailed and later waves higher-level |
| P7 | Persistence | Only with explicit user save authorization. The user confirms a non-roster target root and write paths; the writer persists them and reads back the saved files. Specified, not yet exercised. | Files written and read back; independent review is not part of this slice |
| P8 | Read-back and verification | Read files back, check links, and check that all claims cite evidence | Validation log written |

Phase handoffs (PROPOSED):

| Phase | Handoff artifact | Consumed by |
| --- | --- | --- |
| P0 | Target root, declared scope, and source plan with intended retrieval modes | P1 |
| P1 | Runtime inventory evidence per collector, approved read-only tool profiles, and source plan intended modes | P2 |
| P2 | Discovery index, batch register, collection-batch manifests, navigation ledger, raw evidence records, and candidate dependencies | P3 |
| P3 | Normalized evidence store with stable `evidence_id`, lineage, point-in-time or version, coverage, missing-field lists, and relationship register | P4 |
| P4 | Sufficiency state per source and area, gap list, and dependency register with validation status | P5 |
| P5 | Findings and per-workload dispositions linked to `evidence_id` values, with conflicts kept visible | P6 |
| P6 | Report package drafts with status labels, and wave sequence with gates | P7 |
| P7 | Persisted files and read-back results at the same version | P8 |
| P8 | Read-back results and validation log | Run close |
| Synthesis, A1 to A4 | Prior supplied reports and evidence only, in sequence | Next chain stage, then P6 |

Post-analysis stages (PROPOSED; implemented as the default sequence, not debug-tested end-to-end):

| Stage | Worker (advisor) | Input | Output |
| --- | --- | --- | --- |
| Synthesis | ProjectAssessmentExpert | Evidence records, sufficiency states, and P5 findings | Cross-source synthesis linked to `evidence_id` values |
| A1 | BusinessKnowledgeExpert (BusinessKnowledgeAdvisor), conditional | Prior supplied reports and evidence, dispatched only when in-scope business evidence or user business context is supplied | Business analysis from supplied inputs; otherwise NOT ASSESSED with the missing source layers |
| A2 | CodeProductModernizationExpert (CodeDomainAdvisor) | Prior supplied reports and evidence | Modernization analysis from supplied inputs |
| A3 | CodeArchitectureExpert (CodeDomainAdvisor) | Prior supplied reports and evidence | Architecture analysis from supplied inputs |
| A4 | CodeRebuildEngineer (CodeDomainAdvisor) | Prior supplied reports and evidence | Migration and validation roadmap from supplied inputs |

Chain rules (PROPOSED):

- Default sequence: Synthesis, then A1 to A4 in order. A1 is skipped and recorded as NOT ASSESSED when no in-scope business evidence or user business context is supplied. Aro consults the relevant advisor before each dispatch and validates the selection.
- Report output bar: the Decision-Ready Report Contract in the project-assessment skill (decision brief, root causes, ranked recommendations, transition state, experiments, unknowns, and estimate limits).
- Chain workers receive prior supplied reports and evidence only. They do not re-collect source evidence and do not modify files.
- The quick or inventory-only flow runs only when the user explicitly requests it.
- Chain outputs feed the P6 section drafts. Persistence remains under P7 authorization.

Partial continuation (PROPOSED):

- If one source fails, the workflow continues with the remaining sources.
- Affected sections are labeled with the source status, for example PARTIAL or BLOCKED.
- No completeness or health score is produced when any in-scope source is not COMPLETE.

## 6. Agent Changes (PROPOSED)

| Agent | Proposed change | Gate |
| --- | --- | --- |
| `agents/Aro.agent.md` | Add the new agents to the allowlist, add assessment entries to the routing index, and add assessment phases to coordination. Aro retrieves `project-evidence-ingestion` via `aroGetSkillProcedure` before P2, and both `project-evidence-ingestion` and `project-assessment` before P5 (2026-11-22). Aro has no general workspace read or search tools. | Single-dispatcher rule preserved. Advisor is consulted before each specialist dispatch. |
| `agents/CodeDomainAdvisor.agent.md` | No assessment routing change. The dedicated advisor is kept instead (OD-4, decided). | Not used for assessment selection. |
| `agents/DocsGovernanceAdvisor.agent.md` | Persistence route, if needed | Only if the writer route requires it |
| `agents/GovDocumentationSuiteGenerator.agent.md` | Persist to a confirmed non-roster target root, only with explicit save authorization, and verify the written files by read-back | Documentation-only write scope. No sibling code changes. |
| `agents/InfraAzureDevOpsAgent.agent.md` | No change for assessment. Stays read/write and is not the assessment collector. The Azure DevOps evidence collector (section 3.4) is a separate read-only role. | Not a collector. Any future change requires its own read-only gate. |
| `agents/ProjectAssessmentExpert.agent.md` (new) | Cross-source analysis worker. Tool-free: consumes supplied evidence records only. No delegation and no writes. Checks `evidence_id` components against record fields and does not report PASS on a mismatch (2026-11-22; not yet debug-tested). | Harness validation (OD-8) required before enabling |
| `agents/ProjectAssessmentAdvisor.agent.md` (new) | Tool-free advisor. Selects from the assessment candidates supplied by Aro. Retained as the dedicated advisor (OD-4, decided). | Selection boundaries not yet validated (OD-8) |
| `agents/ProjectEvidenceCollector.agent.md` (new, optional) | Not created. The five role-specific collectors in section 3.4 exist instead. | Not needed for this slice. |
| `agents/ProjectEvidenceLocalRepoCollector.agent.md` (new) | Local-only collector with the P1 preflight described in section 3.4. Remote collectors are not changed by this exception. | Debug-tested for P1 and P2 only (2026-11-22). |
| `agents/BusinessKnowledgeExpert.agent.md`, `agents/CodeProductModernizationExpert.agent.md`, `agents/CodeArchitectureExpert.agent.md`, `agents/CodeRebuildEngineer.agent.md` (existing) | Chain stages A1 to A4 in the default assessment sequence (section 5), routed through BusinessKnowledgeAdvisor or CodeDomainAdvisor. Consume supplied reports and evidence only. No re-collection and no file changes. | Advisor selection before each dispatch. Chain behavior not debug-tested. |

Constraints (PROPOSED):

- Advisors return a selection only. Aro validates the selection and invokes the worker.
- Advisors and workers never delegate.
- No new agent until its tools and harness behavior can be validated.
- Git and GitHub workflow agents that can mutate state are not collectors.
- Model frontmatter is not pinned by this plan for workers or for the advisor. `ProjectAssessmentAdvisor` has no `model` pin; its selection follows Aro's per-call model policy. Model choice otherwise follows the existing model policy.

## 7. Skills (PROPOSED)

| Skill | Purpose | Linked from |
| --- | --- | --- |
| `skills/project-assessment/SKILL.md` | Shared assessment process (scope, ingestion modes, normalization, dependency validation, per-workload disposition, wave sequencing, report package). Requires measurable workload and scalability context (or UNKNOWN), labeled unknowns and assumptions, evidence-linked findings, alternatives and tradeoffs, a prioritized migration and validation roadmap, and a decision-ready report contract (decision brief, root causes, ranked recommendations, transition state, experiments, unknowns, and estimate limits). Forbids ungrounded claims of perfect scalability and fashion-driven architecture choices. Also defines a lightweight ATAM-inspired quality-attribute scenario record (not a full ATAM), DORA metric handling rules (source-specific, scoped, absent data as UNKNOWN), and a report quality contract (completeness by scope, claim-to-evidence traceability, prohibited superiority claims). | ProjectAssessmentExpert, Aro |
| `skills/project-evidence-ingestion/SKILL.md` | Portable contract, provenance, coverage, grouping and splitting, redaction, untrusted-content rules, partial-result rules, discovery index, sufficiency states, navigation ledger, evidence store rules, collection-batch manifest with intended and actual retrieval modes and capability coverage | The five collectors, ProjectAssessmentExpert, and Aro |

Each new or modified agent links the applicable skill. Skills never grant tools or authorization.

## 8. Registrations and Documentation (PROPOSED)

- `package.json`: register the new agents and skills, and contribute the `aroGetSkillProcedure` language-model tool (2026-11-22). `src/extension.js` registers it with a hardcoded allowlist of `project-evidence-ingestion` and `project-assessment`. It reads only those bundled files under the installed extension path, accepts a skill name rather than a path, and rejects other or path-like values. Aro has no general workspace read tools.
- `docs/agents.md`: add the new agents and the changed routing.
- `docs/skills.md`: add the new skills.
- `README.md`: update agent and skill counts.
- `docs/advanced-task-prompts.md`: add an assessment prompt example.
- `docs/maintenance.md`: add maintenance notes for the assessment workflow.
- Focused tests and fixtures under `test/`.
- `docs/extraction-map.json`: update only if extraction consumers or procedures actually change. Do not invent provenance entries.

## 9. Implementation Sequence and Acceptance

Sequence (branch slice in section 12 authorized; live-source steps are not):

1. Finalize scope, contract, and runtime tool inventory.
2. Write the skills and test fixtures.
3. Write the advisor and worker definitions, then update routing.
4. Update registrations and documentation.
5. Run static tests, lint, the prepublish task, and packaging.

Required fixtures (PROPOSED):

- Bundled input (one grouped result) and split input (multiple records from paged calls).
- A missing source.
- A partially collected source.
- A duplicate record across two sources.
- A conflict between two sources.
- A paged container interrupted mid-enumeration, then resumed from the remaining queue.
- A container blocked by a runtime constraint, recorded as BLOCKED with no completeness claim.

Acceptance checks (PROPOSED):

- No mutation tools are referenced by any collector.
- No personal paths appear in any agent, skill, or fixture.
- No claim of live source access appears without evidence.
- Every claim in the report links to an evidence record.
- All output is written under the selected target root.
- Live-source smoke tests run only after authorization and tools exist.
- No collector runs before its exact read-only tools and scopes are approved and runtime availability is confirmed.
- No COMPLETE status appears without a denominator and recorded limits.
- No fixed per-source item maximum appears in any agent, skill, or fixture.
- Every navigation step has a ledger entry with a stop reason.
- The assessment procedure requires measurable workload or scalability context, or records it as UNKNOWN.
- No ungrounded claim of perfect scalability and no fashion-driven architecture recommendation appears.
- Chain stages consume supplied reports and evidence only and do not re-collect or write files.
- Business analysis runs only when business evidence or user business context is supplied; otherwise it is recorded as NOT ASSESSED with the missing layers, and no requirement is invented.
- The report includes a decision brief, root-cause findings with labeled inference, ranked recommendations with alternatives, and no estimate, ROI, benchmark, owner, or compliance claim without supplied evidence.
- Each in-scope workload has at most one migration disposition, or `UNKNOWN` or NOT ASSESSED, with an evidence-backed business driver and key indicator (project-assessment skill, Migration Disposition).
- Cost is recorded in iterative stages with no invented cost value, savings, or ROI (project-assessment skill, Cost Lifecycle).
- Every source batch carries a collection-batch manifest with intended and actual canonical `retrieval_mode` and capability coverage, and its records link to it by `batch_id` (project-evidence-ingestion skill). Reports join evidence to manifests through `batch_id`; no assessment claim exceeds the manifest capability coverage (project-assessment skill, Ingestion Modes and Capabilities).
- No completeness claim is inferred from a successful import without a declared denominator.
- No dependency is treated as validated without an owner or architecture review, and no wave relies on an unvalidated dependency without a stated risk.
- The report package file set matches the project-assessment skill, and the README remains the executive decision summary.
- Numeric performance metrics are allowed when sourced, with source and time window.
- Each quality-attribute scenario record has a business driver, attribute, stimulus and context, response, measurable response, `evidence_id` values, claim status, and an observed or proposed target. It is labeled ATAM-inspired and is not a full ATAM evaluation (PROPOSED).
- DORA-based delivery metrics are used only when evidence supplies them, are scoped per service or application, record source, time window, denominator, and definition version, and are never compared across teams or projects or used as goals. Absent data is `UNKNOWN` (PROPOSED).
- The report contains no claim of ultimate, best-in-market, or better-than-everything-available quality (PROPOSED).
- P6 requires the actual full content of every named report-package document. An executive-summary-only response does not satisfy P6 (PROPOSED).
- P8 begins with status and a clear delivery status. When P7 is not authorized, the entire package content is returned in chat. The P7 gate (explicit save consent, path, write list, and read-back) is unchanged (PROPOSED).
- Chat output labels each file as delivered in chat or persisted and read back. No file is labeled persisted without read-back evidence (PROPOSED).
- Aro does not proceed on externalized, unreadable, or summary-only collector responses. One targeted continuation may page readable canonical records with the same batch context and page markers, but an unreadable or incomplete continuation stops P5 and the downstream chain; otherwise the source or analysis stays PARTIAL or BLOCKED (PROPOSED). This is an agent/runtime contract, not a repository retrieval API.
- Local collector output is compact but complete: no abbreviated IDs and no omitted contract fields. Raw excerpts and incidental path dumps are removed before any contract field is dropped (PROPOSED).
- Evidence records require `container`, `native_id`, and `locator`, with canonical UTF-8 percent-encoding for IDs. ProjectAssessmentExpert decodes once, validates canonical form and exact fields, and reports NOT VERIFIABLE or UNKNOWN for incomplete or summarized records, never PASS (PROPOSED).
- Focused regression tests cover the short trigger, the output package and report contract, collector output, and the ID schema (PROPOSED).

Commands to run when implementation is approved: `npm test`, `npm run lint`, `npm run vscode:prepublish`, and `npm run package` if packaging or contributed assets change. These are not run by this plan. Results dated 2026-11-22 are recorded in section 12.

## 10. Decisions and Open Details

### 10.1 User design decisions (closed as design direction)

These answers set plan direction only. They do not approve live-source access, tenant authorization, tool bindings, or implementation.

| ID | User answer | Status and boundary |
| --- | --- | --- |
| OD-1 | Bounded allowlists | Closed as direction. Exact runtime tool names, scopes, and read-only proofs remain open (O-1). |
| OD-2 | Graph selected scope | Closed as provider direction. Per-service authorization and capabilities remain open (O-2). |
| OD-3 | Dedicated read-only collector | Closed as architecture direction. Server-side enforcement remains unverified (O-3). |
| OD-4 | Keep the dedicated advisor (`ProjectAssessmentAdvisor`) | Decided. Keep the advisor; do not remove it. This supersedes the earlier recommendation to reuse `CodeDomainAdvisor`. |
| OD-5 | "All data can be read. We need all information. do not leave gap behind" | Closed as intent: broad completeness, no silently omitted gaps, limited to an explicitly approved in-scope source. It does not define classification, redaction, or retention policy (O-4). |
| OD-6 | "Same as the professionnals does" | Closed as intent: align PM analysis with professional practice. No standard (PMI, PRINCE2, or Agile) is selected, and no metric, threshold, or denominator is defined (O-5). |
| OD-7 | "Add documents are incremental" | Closed as direction: documents are incremental, and prior versions are preserved and not overwritten. Retention period remains open (O-6). |
| OD-8 | Layered tests (automated plus Extension Development Host); SQLite full-text search if an index is needed | Closed as design direction, with adaptive navigation and no fixed source caps. Runtime P5, mismatch-guard, chain, index, and budget implementation are not validated or completed (O-7). |

### 10.2 Unresolved operational details (OPEN)

| ID | Open detail | Gate |
| --- | --- | --- |
| O-1 | Exact runtime tool names, scopes, and read-only proof per collector (section 3.4) | Runtime probe and approval before any dispatch. Not assumed. |
| O-2 | Per-service Graph authorization, consent, and capabilities for SharePoint and Microsoft 365, including AADSTS65002 preauthorization | Tenant authorization. |
| O-3 | Server-side read-only enforcement for the Azure DevOps MCP session, and whether `InfraAzureDevOpsAgent` is the adapter | Debug confirmation. |
| O-4 | Classification, redaction, and retention policy, with owner | Owner input before any real-source run. |
| O-5 | PM standard selection, metric thresholds, and denominators | Needed before any PM metric is reported. |
| O-6 | Retention period for incremental report versions | Owner input under O-4. |
| O-7 | Harness validation of agent behavior, discovery index implementation (section 3.9), and dynamic budget implementation (section 3.6) | Needed before new agents are added. |

## 11. Research References

These are research references, not verified tenant configuration. They describe public product behavior and are subject to change.

- SharePoint resource type: https://learn.microsoft.com/en-us/graph/api/resources/sharepoint
- Selected permissions overview: https://learn.microsoft.com/en-us/graph/permissions-selected-overview
- Paging: https://learn.microsoft.com/en-us/graph/paging
- Azure DevOps MCP server overview: https://learn.microsoft.com/en-us/azure/devops/mcp-server/mcp-server-overview?view=azure-devops
- GitHub MCP server: https://github.com/github/github-mcp-server
- Microsoft Agent 365 tooling servers overview: https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview

Assessment process sources (read 2026-11-22; vendor-specific; the first is truncated before later sections; not verified tenant configuration):
- CAF Assess your workloads for cloud migration: https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/plan/assess-workloads-for-cloud-migration
- CAF Migration wave planning: https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/migrate/migration-wave-planning
- Azure Migrate assessment types: https://learn.microsoft.com/en-us/azure/migrate/concepts-assessment-overview?view=migrate
- Azure Migrate discovery methods and modes: https://learn.microsoft.com/en-us/azure/migrate/discovery-methods-modes?view=migrate
- Azure Migrate dependency analysis: https://learn.microsoft.com/en-us/azure/migrate/concepts-dependency-visualization?view=migrate
- AWS Application portfolio assessment guide: https://docs.aws.amazon.com/prescriptive-guidance/latest/application-portfolio-assessment-guide/introduction.html
- AWS Detailed portfolio discovery: https://docs.aws.amazon.com/prescriptive-guidance/latest/strategy-migration/detailed-portfolio-discovery.html
- Not used as requirements: Google Cloud manual import and offline assessment (snippets only), NIST (not searched), FinOps (snippet only).

Framework references used by the project-assessment skill (examples, not endorsements or a universal standard; vendor-specific, versions not confirmed):

- Read in full: Microsoft Azure Well-Architected Framework pillars, https://learn.microsoft.com/en-us/azure/well-architected/pillars
- Read in full: Select your cloud migration strategies, https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/plan/select-cloud-migration-strategy
- Optional, `snippet-only, not independently verified`: AWS Well-Architected, https://aws.amazon.com/architecture/well-architected/; Google Cloud performance optimization pillar, https://docs.cloud.google.com/architecture/framework/performance-optimization; FinOps Foundation FinOps Phases, https://www.finops.org/framework/phases/
- Excluded: ISO 25010 (source version conflict; ISO page returned 403).

Documentation research added 2026-11-22 (verified sources; used as design basis, not validated requirements):

- Read: [SEI ATAM Collection](https://www.sei.cmu.edu/library/architecture-tradeoff-analysis-method-collection/), collection page dated 2018-02-14. Basis for the lightweight quality-attribute scenario record only. Its "leading method" wording is self-description, not independent comparative evidence. The plan does not claim a full ATAM.
- Read: [DORA software delivery performance metrics](https://dora.dev/guides/dora-metrics/), undated page, read 2026-11-22. Basis for the five-measure, source-specific metric set and its scope and misuse warnings. Not a universal project-management health score.
- Read, first part only: [DORA history of software delivery metrics](https://dora.dev/insights/dora-metrics-history), dated 2026-01-02. Metric definitions changed over time, so each value records its definition version and historical values are not compared without reconciling definitions.
- Limits: no authoritative source was verified for a market-leading or better-than-everything-available claim. Such claims are prohibited. ISO 25010 remains excluded (primary page returned 403). SPACE remains unverified (full text inaccessible, snippets only) and is not relied on.

## 12. Status Summary

- Status: Overall plan PROPOSED and incomplete. OD-1 to OD-8 have user answers recorded as design directions in section 10.1; OD-4 is decided. Operational details in section 10.2 (O-1 to O-7) remain open. Live-source work is not complete.
- Design-direction update (2026-11-22): this plan records the user answers only. No live access, tool binding, tenant authorization, source collection, persistence, or implementation was performed or approved by this update.
- Branch slice: implemented in part, not fully validated end-to-end (as of 2026-11-22). Authorized by the user for agent definitions, skills, tests, and docs on `feat/project-assessment-workflow`, for debug testing, and for the `aroGetSkillProcedure` extension-code scope expansion. The slice covers the agent, skill, test, and documentation edits, plus the `aroGetSkillProcedure` extension-code change in `src/extension.js` and `package.json`. Not authorized: querying or connecting to MCP sources, consent or authentication changes, editing `mcp.json`, source-system access, tenant changes, live collection, writing current assessment output, commits, or pushes.
- Current verification (2026-11-22; P6/P8 delivery, collector contract, and evidence-ID update; command runs in this session):
  - `node --test test/project-assessment.test.mjs`: 72/72 passed, including the new regression tests and final expert wording.
  - `npm test`: 176/176 passed.
  - `npm run lint`: exit 0, validated 57 agents and 12 skills.
  - `npm run vscode:prepublish`: exit 0 (tests and lint passed).
  - `npm run package -- --out agent-assessment-report-delivery-20261122.vsix`: exit 0, new 95-file package, 825,551 bytes. The path was absent before the run and no existing VSIX was overwritten.
  - Implemented: P6 requires full content of every named package document; P8 starts with status and delivery status, and returns the entire package in chat when P7 is not authorized; the P7 save gate is unchanged. Aro stops on externalized, unreadable, or summary-only collector responses and allows one targeted retry that must preserve full IDs and canonical fields. Local collector output is compact but complete. Evidence records require `container`, `native_id`, and `locator`, with canonical UTF-8 percent-encoding; ProjectAssessmentExpert decodes once and reports NOT VERIFIABLE or UNKNOWN for incomplete records.
  - Not verified: installation or activation of the new VSIX in an Extension Development Host; any real target assessment, so the new P6/P8 behavior, collector contract, encoded evidence validator, P5 identity validation, mismatch guard, and analysis chain are unexercised; report persistence (none persisted). Remote-source operations and tenant or profile gates remain separate and unapproved.
  - Status: overall plan stays PROPOSED and incomplete. Do not claim all agents are runtime-ready.
- Current next action (single): install and reload `agent-assessment-report-delivery-20261122.vsix` in the Extension Development Host, then run exactly `Do an assessment of this project.` Capture the report delivery output, the P5 result, and the collector results. Runtime P5, the mismatch guard, the post-analysis chain, remote access, and persistence remain unverified and unapproved.
  - This update does not claim that all agents are runtime-ready or that remote sources are usable. Remote/tenant authorization and persistence gates remain closed and are tracked separately.

### Historical, superseded run records

The entries below are kept for history. They do not describe the current package or the current next action.

- Superseded verification (2026-11-22; replaced by the current verification above; kept for history):
  - `node --test test/project-assessment.test.mjs`: 67/67 passed.
  - `npm test`: 171/171 passed, after correcting one stale Azure DevOps routing-text assertion in `test/validate.test.mjs`. The current Aro route itself was not changed by that repair.
  - `npm run lint`: exit 0, validated 57 agents and 12 skills.
  - `npm run vscode:prepublish`: exit 0 (runs npm test and lint).
  - `npm run package -- --out agent-roster-validation-20261122-145509.vsix`: exit 0, produced a new 95-file, 797.72 KB VSIX at that workspace-relative path. The existing `agent-roster-for-copilot-chat-0.0.0.vsix` dated 2026-11-19 was preserved.
  - Skill procedure tool returns bounded parts, and Aro has a reassembly instruction. Focused procedure tests and lint passed. Live Extension Development Host behavior is unverified. The 4000-character part size is not confirmed against a documented host threshold.
  - The package was built but not installed or activated. No live source or MCP collection or persistence was performed.
- Historical validation (dated 2026-11-22, before the newest assessment edits; not current):
  - `node --test test/project-assessment.test.mjs`: exit 0, 26/26 pass.
  - `npm run lint`: exit 0, validated 57 agents and 12 skills.
  - Latest full `npm test` (run before the local preflight, P5, and expert edits): 127/128 pass. The one failure is unrelated, at `test/validate.test.mjs` (Azure DevOps routing-text mismatch). The full suite has not been rerun since the latest edits.
  - `npm run package` previously failed in its `vscode:prepublish` pretest because of that failure. Packaging is not verified. Do not claim prepublish passed.
- Current verification for the newest chain and procedure edits, and for the conditional business analysis and report contract edits (2026-11-22): unrun. `node --test test/project-assessment.test.mjs` and `npm run lint` were not run, because the implementation session had no command tool. The new tests are unverified. No current test, lint, prepublish, or package success is claimed. Superseded: the 2026-11-22 short-trigger verification above records passing `npm test`, `npm run lint`, `npm run vscode:prepublish`, and `npm run package`.
- Short-trigger and report-quality verification (2026-11-22; command runs in this session; supersedes the unrun entries for the framework-reference, process, collection-batch, and research updates):
  - Aro's description includes the exact short request `Do an assessment of this project`. Aro's Project Assessment Coordination treats short requests as the full default P0-P8 chain and returns one consolidated user-facing result. The user-facing prompt guide includes the exact line `Do an assessment of this project.`
  - `test/project-assessment.test.mjs` adds simple-trigger and report-quality-contract regression tests. Focused trigger test: 1/1 passed. Report-quality test: 1/1 passed. Full assessment test file: 68/68 passed, after correcting the punctuation of this plan's status line.
  - `npm test`: 173/173 passed.
  - `npm run lint`: exit 0, validated 57 agents and 12 skills.
  - `npm run vscode:prepublish`: exit 0 (reran tests and lint).
  - `npm run package -- --out agent-assessment-single-prompt-20261122.vsix`: exit 0, created a new 95-file package (821,338 bytes; vsce reports 802.09 KB). The output was absent before the run; existing VSIX artifacts were preserved.
  - Research-informed edits: lightweight ATAM-inspired quality-attribute scenarios (not a full ATAM); guarded per-service DORA metric handling with definition versions; prohibition on unsupported market-superiority claims. Sources and caveats are recorded in section 11 and the skill references.
  - Not verified: installation or activation of the new VSIX; the updated trigger in the Extension Development Host; a successful P5 with full evidence and procedures; the synthetic mismatch-guard result; the post-analysis chain; manifest-vocabulary alignment; any remote source or read-only profile; live collection; report persistence.
- Debug run (2026-11-22; superseded, not the latest run):
  - Skill retrieval worked. ProjectAssessmentAdvisor selected the local collector. P1 preflight passed. The collector returned two run-scoped records within the two-file scope.
  - At P5, Aro first omitted `project-evidence-ingestion`, so the expert correctly returned NEEDS_INPUT. After a retry with both procedures, the expert passed but reported an evidence-ID source-label mismatch while still reporting compliance PASS.
  - Aro was then changed to send both procedures automatically at P5, and the expert was changed to check `evidence_id` components against record fields and not report PASS on mismatch. These two changes are NOT yet debug-tested.
  - No remote collection or report persistence occurred.
  - Post-analysis chain (Synthesis, then A1 to A4): implemented as the default sequence. Not debug-tested. No live collection or report persistence occurred.
- Framework-reference refinement (2026-11-22): quality lenses, migration disposition table, iterative cost lifecycle, and reference basis added to the project-assessment skill; acceptance checks, references, and focused tests added. Not run: this session had no command tool, so `node --test test/project-assessment.test.mjs` and `npm run lint` are unverified.
- Extension Development Host smoke test (2026-11-22; user-supplied runtime results, not re-run by this session):
  - Verified: `aroGetSkillProcedure` returned multipart text. Aro retrieved project-evidence-ingestion parts 1-4 and project-assessment parts 1-8 in order (12/12 total).
  - Verified: the required advisor selected the local repository collector.
  - Verified: P1 preflight passed. The collector checked read/search and read root `package.json` and `README.md`. It identified the open workspace as `code-oss-dev`, version `1.147.0`.
  - Verified: P2 returned a manifest and 13 run-scoped evidence IDs in batch `local-read-batch-1`. Actual mode `local-read-search`, mode label `local-read`. Repository scope coverage and denominator `UNKNOWN`. Batch `CONVERGED` only for this smoke-test batch. No remote/MCP source access or persistence occurred.
  - Reported, not validated row by row: IDs use `local:repository:<slug>@run:local-assessment-2026-11-22-1`, and the summary states that slugs and run suffix match the record summary and that records link to the batch. Full records were not printed, so the row-level evidence field and batch-link checks remain unverified. Manifest `dependency_analysis=collected` covers only declared dependencies and workspace membership, not the resolved or runtime graph.
  - Unverified (P5): the first call did not meet acceptance because procedure content was condensed despite retrieval. A corrected call with full procedure text returned its result as an externalized session resource that could not be read, so the exact analysis output and whether the expert received all parts are unverified.
  - Unverified (mismatch guard): the synthetic mismatched evidence ID was kept separate and did not receive a PASS from Aro, but the expert's response is unavailable, so the guard is not validated.
  - Not assessed (chain): the post-analysis chain did not proceed. Business analysis is NOT ASSESSED because no business context or evidence was supplied.
  - Trailing read/search logs are unrelated and do not establish broader collection.
- Open for debug: exact GitHub runtime tool IDs for each deferred category, the WorkIQ `workiq/` prefix, the M365 WorkIQ tool binding, the AADSTS65002 preauthorization, grouped Azure DevOps tool schemas and action enums, Azure DevOps read-only enforcement, and each MCP server's read-only mode.
- Process refinement (2026-11-22): the assessment process, ingestion modes, dependency validation, wave sequencing, and the 12-file report package were added to the project-assessment skill, and this plan was updated to match. Tests were added to `test/project-assessment.test.mjs`. Not run: this session had no command tool, so `node --test test/project-assessment.test.mjs` and `npm run lint` are unverified. No live ingestion, collection, persistence, or test success is claimed. The ingestion contract and collectors did not define `retrieval_mode` at that point; the collection-batch manifest update below adds it.
- Collection-batch manifest update (2026-11-22): the ingestion contract adds a collection-batch manifest per source batch, with `intended_retrieval_mode` from P0 and `actual_retrieval_mode` from P2, a canonical retrieval-mode vocabulary, and capability coverage states (`collected`, `not_collected`, `unsupported`, `unknown`, `not_applicable`). Records link to it by `batch_id` and do not repeat mode or capability fields. The five collectors emit the manifest and report a blocked actual mode as `UNKNOWN`. Assessment workers may not claim beyond a batch's capability states. Not run: this session had no command tool, so `node --test test/project-assessment.test.mjs` and `npm run lint` are unverified. No source access, live ingestion, or tool binding was added.
- Documentation research update (2026-11-22): the project-assessment skill, this plan's research section and skill row, and the advanced task prompts were updated with the verified SEI and DORA references and their limits. This is a documentation-only change. It does not approve remote source access, tenant authorization, tool binding, or report persistence, and it does not change the P7 write gate or the decisions in section 10. Tests and lint were not run for this change. Superseded: the 2026-11-22 short-trigger verification above ran `npm test` (173/173) and `npm run lint` (exit 0) after this change.
- Next action (as of 2026-11-22; superseded by the current next action above):
  1. Install the packaged VSIX (`agent-assessment-single-prompt-20261122.vsix`) and run it in the Extension Development Host.
  2. Submit exactly `Do an assessment of this project.` and record runtime outcomes: trigger routing, the P0-P8 chain, P5 with full evidence and procedures, the synthetic mismatch guard, the post-analysis chain, and the consolidated result.
  3. Keep remote/tenant authorization and report persistence gates separate; this step does not open them.
  4. OD-4 remains decided; O-1 to O-7 (section 10.2) remain open.
- Prior next action (superseded by the latest next action above; kept for history):
  1. Request one corrected P5 invocation that receives verbatim reassembled procedures (project-evidence-ingestion and project-assessment) and returns a short inline structured result, not an externalized transcript.
  2. After P5 passes, validate the synthetic evidence-ID mismatch separately.
  3. Proceed to the post-analysis chain (Synthesis, then A1 to A4) only after P5 passes.
  4. Align the manifest outputs and the project-assessment skill's retrieval-mode table with the canonical vocabulary in the ingestion contract, then debug-verify the collection-batch manifest in the five collector outputs.
  5. OD-4 is decided: keep `ProjectAssessmentAdvisor`. Keep operational details O-1 to O-7 (section 10.2) open until the user closes them.
  6. Keep remote-source operations open. Explicitly authorized live-source work only. No tool bindings or live source approvals exist yet.
