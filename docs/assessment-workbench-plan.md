# Assessment Workbench Proposal

**Status:** Proposal  
**Scope:** Separation of the project-assessment runtime and the VS Code agent roster  
**Implementation:** Not authorized by this document

## Purpose

Create a standalone assessment workbench that can execute project assessments independently of the existing roster VS Code extension. This plan is documentation only. It does not authorize repository creation, code movement, package changes, deletions, or implementation.

## Decision Summary

### Decided boundaries

- The assessment workbench is a separate, standalone repository and application/runtime from the existing agent-roster VS Code extension.
- The roster repository remains the authority for agent definitions, advisor definitions, skill definitions, routing, and Aro runtime behavior.
- Aro remains in the roster repository and keeps the thin-dispatcher role described by the existing roster architecture.
- Assessment-specific execution code and tests move to the workbench rather than remaining part of the roster extension.
- M365 and Microsoft Graph connectors must be read-only and use least privilege. Collection is source-authorized, scoped, and never uses write, delete, or administrative operations.
- Evidence collection remains honest about `COMPLETE`, `PARTIAL`, `UNKNOWN`, and `BLOCKED` state. Missing or denied evidence is never inferred as absence or lack of use.
- Local-first proof of concept is required before a runtime selection beyond the smallest implementation is made.
- Output artifacts are written only to a user-selected folder outside source repositories. The open workspace or source checkout is an output destination only by explicit selection and is never an implied evidence source.
- Existing local edits in both repositories are preserved. No migration step may overwrite, move, revert, or delete them.
- Runtime selection will be evidence-based and limited to MAF, LangGraph, or a smaller runtime unless a later decision adds another option.
- Versioned contracts are required for runs, evidence, coverage, checkpoints, approvals, and receipts.
- Prompts and adaptations are pinned, packaged, and referenced by bundle identity and version. They must not be duplicated into the workbench as competing sources of truth.

### Open decisions

- Repository name and initial ownership model.
- Primary workbench language, service boundary, and local execution environment.
- User interface form for the proof of concept.
- Which M365/Graph API surfaces are the first supported collection targets.
- Identity, tenant, consent, and secret-management model for approved connectors.
- Storage format and retention policy for local checkpoints and evidence.
- Exact checkpoint/resume semantics and supported resume history.
- Exact approval state model and user-sign-off UX.
- Whether MAF or LangGraph satisfies checkpoint/resume and approval tests before a smaller runtime is selected.
- Initial supported source list and evidence-batch granularity.
- Commercial, licensing, and publication constraints for the workbench.

## Target Separation

### Roster repository

The existing repository continues to own:

- `Aro.agent.md` and Aro dispatch/routing behavior.
- Agent and advisor definitions.
- Shared skill procedures.
- Agent/skill registrations and catalog synchronization.
- Roster-specific structural validation and VSIX packaging.
- Model-selection policy and model-learning behavior owned by the roster extension.
- Documentation that describes the roster and its runtime.

The roster must not become the implementation owner for workbench execution, remote assessment orchestration, or workbench persistence.

### Workbench repository

The standalone workbench owns:

- Assessment orchestration and run lifecycle.
- Source authorization and scope validation.
- Collector invocation and evidence normalization.
- Read-only M365/Graph connector adapters.
- Coverage calculation and sufficiency reporting.
- Checkpoint creation, validation, resume, and retention.
- Approval capture and receipt creation.
- Output routing and persistence to the user-selected destination.
- Workbench-specific unit, integration, contract, and runtime tests.
- Runtime adapter code chosen for MAF, LangGraph, or a smaller implementation.

The workbench consumes roster definitions and pinned prompt bundles by contract. It does not fork or duplicate them.

## Source of Truth and Adaptation

Agent and skill definitions remain authoritative in the roster repository.

For each workbench release:

1. Record the exact roster revision or portable bundle identity.
2. Pin a prompt/adaptation bundle that identifies the required agent and skill versions.
3. Validate bundle compatibility before starting a run.
4. Reject or report incompatible bundles rather than silently merging versions.
5. Preserve provenance from agent/skill bundle version through run, evidence, report, approval, and receipt records.

Adaptations may provide workbench-specific packaging or parameterization, but they must not create competing copies of agent or skill source. Changes to role behavior require the normal roster change process and synchronized agent, routing, catalog, and test updates.

## Contract Set

The following contracts are package boundaries and must be versioned together where behavior depends on them:

- **Run contract:** run identity, source scope, requested goal, status, timestamps, bundle identity, source authorization, and selected output destination.
- **Evidence contract:** source identity, provenance, collection state, item/batch identity, confidence, redaction state, pagination status, and evidence status.
- **Coverage contract:** one denominator for the run, area/source disposition, confidence, blockers, unknowns, and sufficiency state. Coverage may not convert `PARTIAL`, `UNKNOWN`, or `BLOCKED` into completeness.
- **Checkpoint contract:** checkpoint identity, run identity, sequence/revision, completed steps, pending steps, durable state, evidence references, and compatibility version.
- **Approval contract:** approval identity, run/checkpoint references, decision, approver, scope, timestamp, and explicit acceptance or rejection state.
- **Receipt contract:** persisted artifact identity, destination, checksum or equivalent integrity evidence, read-back result, source run/checkpoint/approval references, and save status.

Contracts require schema validation, forward-compatibility policy, migration rules, and examples for every terminal state. Contract changes require workbench tests and separate release validation.

## M365 and Microsoft Graph Access

Connectors are read-only and least privilege.

Required controls:

- Explicit source authorization and exact scope before collection.
- Delegated or application permissions limited to the minimum approved read scopes.
- No write, delete, update, invitation, member-management, policy-change, or administrative capability.
- Pagination and bounded retries with concrete blocker reporting.
- Tenant/site/project/user scope bound to the current request.
- Tool or API availability failures reported as `BLOCKED`, not substituted by chat assumptions or another source.
- Durable source identity and permission context in evidence provenance.
- Redaction, secret exclusion, and access classification before persistence.
- Separate approval for scopes that expand beyond the initially authorized source set.

The proof of concept should use only a neutral test tenant or explicitly authorized source. No personal, customer, tenant, or site identity is a default.

## Staged Plan

### Stage 0: Ownership and migration design

**Exit criteria:**

- Standalone workbench repository boundary is approved.
- Roster/workbench ownership matrix is recorded.
- Current local edits and migration exclusions are identified.
- Contract boundaries and initial status model are reviewed.
- No source repositories are modified.

### Stage 1: Local proof of concept

**Exit criteria:**

- A local source can start a run and produce evidence, coverage, checkpoint, approval, receipt, and terminal status records.
- Local-only evidence is collected through read-only adapters.
- A run pauses at a checkpoint and resumes without repeating already completed work.
- An approval gate blocks dependent work until approved and records the approval decision.
- Output writes only to a user-selected folder outside the source repos.
- Existing files are preserved and read-back is verified.
- Roster prompts are consumed as a pinned bundle rather than copied.

### Stage 2: Runtime checkpoint and approval trial

Run equal proof-of-concept acceptance scenarios against:

1. MAF.
2. LangGraph.
3. A smaller runtime selected for the smallest implementation that satisfies the contract.

Evaluate:

- Checkpoint persistence and exact resume.
- Approval pause/resume behavior.
- Cancellation and retry semantics.
- Error propagation and rollback.
- Testability and observability.
- Operational complexity and dependency surface.
- Model/tool portability.
- Source-of-truth and bundle compatibility.

Selection is provisional until the acceptance scenarios pass. The runtime decision remains open until evidence is recorded.

### Stage 3: Contract implementation

**Exit criteria:**

- Versioned run, evidence, coverage, checkpoint, approval, and receipt schemas exist in the workbench.
- Schema validation is automated in tests.
- Migration or compatibility behavior is defined for old contract versions.
- Bundle identity is carried through run artifacts.
- Cross-contract references are validated.

### Stage 4: Read-only source adapters

Start with local source evidence. Add M365/Graph connector proof only after the local checkpoint and approval lifecycle is working.

**Exit criteria:**

- Least-privilege permissions are documented and verified.
- Read-only operations are allowlisted and mutation operations are unavailable or blocked.
- Source authorization, exact scope, pagination, and blocker behavior are tested.
- Denied, unavailable, and unsupported categories remain visible and partial rather than inferred as absence.
- A neutral test identity is used for connector validation.

### Stage 5: Migration from assessment execution code

Before moving code:

1. Inventory assessment-specific code and tests currently owned by the roster.
2. Distinguish reusable roster procedures from workbench execution implementation.
3. Preserve roster agent/skill and package surfaces unchanged unless separately authorized.
4. Move or copy each workbench implementation unit in a reversible patch sequence.
5. Update workbench tests while retaining separate roster validation.
6. Remove roster-specific assessment execution code only after workbench acceptance gates pass.

No package registration or manifest change is part of this plan until implementation is separately approved.

### Stage 6: End-to-end validation and rollout decision

**Exit criteria:**

- Local and approved remote paths pass workbench tests.
- Roster structural tests remain green in their own repository.
- Contract compatibility tests pass.
- Resume, approval, rollback, and receipt tests pass.
- M365/Graph least-privilege validation has evidence.
- Workbench output is verified outside source repositories.
- Migration can be reversed without losing evidence or user edits.
- Any unresolved blocker is reported as `UNKNOWN` or `PARTIAL`, not hidden or guessed.

## Test Ownership and Validation

### Roster repository

The roster repository owns:

- Agent/skill metadata and registration tests.
- Aro routing allowlist tests.
- Prompt bundle and skill extraction validation.
- VSIX/package behavior tests.
- Existing extension unit tests.

These tests validate roster authority and packaging. They do not validate workbench runtime behavior.

### Workbench repository

The workbench owns:

- Run lifecycle tests.
- Evidence normalization and source-state tests.
- Coverage denominator and sufficiency tests.
- Checkpoint and resume tests.
- Approval-gate tests.
- Receipt read-back and integrity tests.
- M365/Graph connector authorization and read-only operation tests.
- Runtime selection acceptance scenarios.
- Persistence and output-destination tests.

### Separate validation

Both repositories run independent test, lint, packaging, and integration gates. Cross-repository compatibility validation tests the pinned bundle and contract versions but does not merge the repositories or their test ownership.

Static tests do not prove live model resolution, tenant consent, Graph availability, or remote runtime behavior. Live validation remains separate and evidence-backed.

## Migration Gates

A migration step is complete only when all applicable gates pass:

1. **Scope gate:** no code or file outside the approved migration slice changes.
2. **Edit-preservation gate:** preexisting and concurrent workspace edits remain unchanged.
3. **Authority gate:** roster definitions remain canonical and workbench copies are pinned adaptations, not competing sources.
4. **Contract gate:** versioned schemas and compatibility checks pass.
5. **Runtime gate:** resume and approval tests pass in the selected runtime.
6. **Security gate:** connectors are read-only, scoped, authorized, and least privilege.
7. **Persistence gate:** artifacts are written only to the selected destination and read back successfully.
8. **Validation gate:** roster and workbench tests pass independently, with cross-contract checks separate.
9. **Rollback gate:** the prior state can be restored without losing existing edits or evidence.

## Risks and Mitigations

- **Runtime choice becomes an architectural lock-in:** require checkpoint/approval acceptance tests before selection and keep runtime adapters behind contracts.
- **Prompt duplication causes authority drift:** pin bundle identity and validate compatible roster revisions; change prompts in the roster source of truth.
- **Connector overreach:** use read-only operation allowlists, least privilege, exact source scope, and authorization checks.
- **Evidence becomes a false completeness signal:** preserve source statuses and coverage denominators; never infer absence from blocked data.
- **Resume reprocesses or skips work:** use checkpoint identity, sequence/version, references, and idempotency tests.
- **Approval becomes unenforceable:** make approval state machine and receipt part of the run contract; block dependent work without valid approval.
- **Migration overwrites local work:** preserve worktrees, compare diffs, avoid destructive Git operations, and require explicit user approval before removing implementation.
- **Output contaminates source repositories:** default to the user-selected external folder and reject implicit destination fallbacks.
- **Contract drift splits repositories:** run pinned cross-repository compatibility validation and explicit versioned migrations.
- **Live connector behavior differs from static configuration:** separate live smoke tests and record unavailable tools or denied permissions as `BLOCKED`.
- **Assessment execution remains accidentally embedded in the roster:** enforce ownership tests and package inventory reviews.

## Rollback and Preservation

- Snapshot or inventory existing repository edits before migration work begins.
- Do not use destructive operations such as reset, checkout, or bulk overwrite to recover or migrate state.
- Preserve user-created files and uncommitted edits even if they are unrelated to the migration.
- Treat a migration conflict as a blocker, not authority to overwrite it.
- Keep implementation moves reversible until separate stage validation passes.
- Preserve evidence and checkpoint files independently of source-code rollback.
- Roll back package or contract changes only in their owning repository.
- If a runtime trial fails, retain the smaller passing implementation and mark MAF/LangGraph trial state as not selected or incomplete.
- Report rollback status and preserved file paths to the user.

## Questions Not Yet Resolved

1. What repository name and initial maintainer/owner model should the workbench use?
2. Which primary language and local runtime should seed the proof of concept?
3. Which UI surface is required for the first workbench?
4. Which M365/Graph evidence categories are in first scope?
5. What identity and consent model is approved for the neutral test environment?
6. What exact read-only permission set can support the first scope with least privilege?
7. Where and how will checkpoints and evidence be retained locally?
8. What evidence and checkpoint retention periods are required?
9. Which checkpoint granularity and resume history are sufficient?
10. Who can approve each run, checkpoint, and output scope?
11. What approval metadata and UX are required for a legally or operationally meaningful decision?
12. Will MAF or LangGraph satisfy the acceptance scenarios, or should the workbench use a smaller runtime?
13. How should contract migrations behave across workbench releases?
14. Which output formats are required in the first release?
15. What license and distribution constraints apply to the standalone workbench?
16. Is a local-only proof sufficient as a go/no-go gate, or is one live read-only connector smoke test required before migration?

## Proposed Next Action

Proceed only after separate approval with Stage 0: confirm the workbench boundary, owner, repository name, initial runtime environment, output policy, and first local proof-of-concept scope. No repository or implementation work is authorized by this proposal.
