# Migration And Maintenance

## Content Selection

The initial migration reads the user-supplied prompt directory without modifying it. At migration it retained 49 agent definitions (the roster has since grown; current counts are under Validation), their routing hierarchy and tool allowlists, and the existing model benchmark skill. Aro retains its ordered model preferences and task-aware per-call selection; the six advisors that pin `Claude Haiku 5.5` (CodeBackend, CodeDomain, CodeFrontend, DocsGovernance, InfraDevOps, and Utility) retain that economical preference. ProjectAssessmentAdvisor has no model pin and falls under Aro's per-call selection. Aro consults its profile-local model-learning tool before advisor and specialist calls and requests an eligible exact model argument when supported, independently of the chat model. Configured or fallback choices must remain eligible within the selected scope; if scope or a suitable model cannot be verified, Aro reports the limitation. Confirmed availability failures can trigger bounded re-queries with request-local exclusions, but uncertain side effects must not be repeated. Requested model IDs do not prove runtime resolution.

The package excludes source Git metadata, Python caches, generated reports, historical improvement notes and client-editor settings. The separately maintained Microsoft Foundry skill bundle is not vendored: its dependencies, service assumptions and redistribution terms need an independent review. Install it separately when required.

Useful roster descriptions become the [agent catalog](agents.md). Runtime routing remains embedded in Orchestrator rather than relying on that documentation.

## Contextual Model Learning

Model outcomes are recorded per advisor or specialist call using `activity`, `domain`, and `difficulty`, not as one label for an entire multi-agent task. Activities describe the call (`advise`, `implement`, `analyze`, `review`, `document`, or `operate`); domains describe its subject; difficulty remains `simple`, `standard`, or `complex`. Aro classifies each dispatch from its routing context and records only verified outcome codes, the requested model ID, and optional agent identity.

Recommendations prefer exact context evidence. Related evidence is weighted conservatively: `0.5` for the same activity and domain at another difficulty, `0.2` for a match on activity or domain, and `0.1` for relevant version-1 records. Two exact outcomes qualify as learned evidence; otherwise, at least four effective weighted outcomes are needed for pooled evidence. Complex calls are not recommended from exploration alone. Each recommendation returns an opaque per-call ID; Aro records that ID with the verified outcome so repeated identical contexts remain distinguishable. It is not a conversation/session identifier. The dashboard identifies pooled evidence and reports exact and pooled counts separately.

Users may pin a manually chosen model for one exact activity/domain/difficulty context or restore its learned choice. Pins are stored separately from outcome records and do not count as evidence. A pinned model must remain eligible and priced under the active model scope; when it is unavailable, Aro reports that state rather than silently substituting another model.

Version-1 scorecard records remain readable and intact under the existing profile storage key; the next recorded outcome writes them alongside version-2 contextual records. Legacy labels are treated only as weak pooled evidence because they do not establish all three dimensions. `durationMs` and `costUsd` are optional and must be trustworthy measured values supplied by the runtime; model price lists are not per-call cost measurements. Prompts and responses are never stored.

## Extraction Decisions

The [extraction map](extraction-map.json) records the canonical source agent, original headings and every consuming agent for each of the nine extracted skills. The benchmark skill is retained separately, not counted as a new extraction. Shared procedures have one skill entry point; the relevant agent sections now link to that procedure and must load it before acting.

Authorization, existing-edit protection, current-contract policy, final test/lint obligations and role restrictions remain inline. These are baseline constraints, not optional task skills. Each shared-skill consumer has one `Skill Loading` section covering all its workflow links; do not repeat that baseline at every link or put this prerequisite inside a skill. Validation requires exactly one loading policy per consumer. Skill loading never overrides a role's narrower permissions. Tool-free advisors do not need to load skills.

The personal roster's former rule requiring every procedure to be embedded has intentionally changed for this extension: required shared workflows are packaged alongside the agents and registered through `chatSkills`. No runtime access to the original profile directory is required. Skill links are package-relative, not relative to the repository being assessed. Load skills by name from runtime-discovered locations or verified procedure content supplied by Aro; never guess installation paths or search personal profiles. If unavailable, return the skill name and failed lookup to Aro for discovery-based resolution and retry. Do not fabricate the procedure; block only dependent work and continue independent authorized analysis.

Read-only analysis workers return complete findings and artifact content to Aro. They do not need edit tools to perform analysis or delegate persistence themselves. For requested artifacts, Aro consults DocsGovernanceAdvisor, invokes GovDocumentationSuiteGenerator with complete content and destination paths, and reads back saved artifacts before claiming persistence. An analyst's missing edit tools are not evidence that the writer route is unavailable.

The Git worker's embedded PR procedure no longer requires separately installed PR skills; available skills can enrich it. Existing direct invocation of that worker is preserved. Model benchmarking is explicitly manual-only; it is separate from task-aware model selection and never changes model preferences.

## Project Assessment Collectors

Project assessment collectors are read-only and never delegate. Four source collectors (SharePoint, Microsoft 365, Azure DevOps, and GitHub) have `tools: []`: they are BLOCKED until debug binds exact tool names and verifies read-only behavior. Candidate names are kept in each body as PENDING, not active. Only ProjectEvidenceLocalRepoCollector has tools bound (`read` and `search`), and Git metadata stays UNKNOWN because no read-only Git tool is bound. The WorkIQ server prefix, the grouped Azure DevOps tool schemas, and each MCP server's read-only mode are unverified. Any tool that is absent or refused must report BLOCKED, never a substitute. The Azure DevOps collector is distinct from InfraAzureDevOpsAgent, which remains read and write. Assessment report persistence is defined as a writer route (GovDocumentationSuiteGenerator) that runs only with explicit user save authorization and a confirmed non-roster target path, and it reports saved files only after read-back. This route is defined but not tested or exercised live; until a debug run reads back a saved file, report persistence as not performed.

## Source Layout

- `agents/`: packaged custom agent definitions.
- `skills/<name>/SKILL.md`: packaged, independently discoverable workflows.
- `src/`: extension-host activation, model-learning tools, policy and pricing.
- `media/`: Aro Learning dashboard assets.
- `docs/agents.md`: role catalog; `docs/skills.md`: shared workflow catalog.
- `docs/extraction-map.json`: shared-workflow provenance and consumers.
- `scripts/validate.mjs` and `test/`: structural lint and regression tests; not shipped in the VSIX.
- `scripts/import-customizations.mjs`: initial bulk extraction utility, not a synchronization service. It requires an explicit source path and refuses to overwrite existing agents/skills. It was used for initial migration; subsequent portability fixes live in the checked-in assets. Do not rerun it over this maintained tree.

When changing a role, synchronize its name/file, manifest contribution, Orchestrator allowlist and routing cues, advisor selection cues, catalog and affected tests. When changing a shared workflow, edit its skill once and verify all consumers. Do not add blanket tool permissions or fixed user paths.

## Validation

Run `npm test` and `npm run lint`, then `npm run vscode:prepublish` for the combined gate. Run `npm run package` and inspect package contents when packaging behavior or contributed assets change. The extension-host entry point is `src/extension.js`; it uses stable VS Code APIs and does not declare proposed APIs.

Before distribution, test the actual VSIX in a clean VS Code profile with Copilot enabled:

1. Install the VSIX, reload if prompted, and open a fresh chat.
2. Verify Aro and the Git worker in the agent picker. Verify all 57 definitions and 12 skills in Chat: Open Customizations, including hidden worker agents.
3. Give Aro a small read-only task and verify it invokes the indexed worker rather than merely describing a delegation.
4. Invoke `/markdown-mermaid-delivery` with a small documentation request. Verify the skill content loads from the installed extension.
5. Give a frontend worker a scoped request through Orchestrator and verify the linked quality skill loads without a client-profile search.
6. Confirm the benchmark is not selected automatically and is available explicitly as `/agent-model-benchmark`.
7. Repeat discovery, delegation and skill loading in an intended SSH/container window. Check missing-tool reporting without broadening permissions.
8. In an unrelated repository without this package's `agents/` or `skills/` directories, request an As-Is System Reference. Verify the investigation skill loads from the installed extension, not a guessed target-relative path. Verify Aro obtains specialist findings, routes complete content through the advisor-selected documentation writer, and reads back the reference, coverage register and target repository's `docs/system-reference/README.md` resume point. This target README is separate from the extension repository's root README. In a separate controlled trial, supply an unavailable required skill location and verify named dependency recovery, no fabricated procedure, and continuation of independent authorized work. Record analysis and persistence status separately if writer invocation or tools fail.
9. Open Aro Learning and verify sidebar counts, scope and priority controls, and that it has no inventory tab. Run **Agent Roster: Open Model Inventory** twice to confirm one panel is reused, then check that its Global and Workspace provider tabs, effective-source labels, and model rows are present. In a fresh Aro chat, give a low-risk read-only task with verifiable acceptance criteria; inspect the recommendation calls before both advisor and worker dispatch and confirm any genuinely verified outcome appears after refresh and reload. Check that the bounded shortlist respects scope and indicates truncation. In a controlled failure test, verify confirmed unavailability leads to request-local exclusions and bounded retries without recording a quality failure. Test local-only selection only when a configured local provider and runtime support are available; do not manufacture outcomes or infer actual model resolution from the requested ID.

Static tests and VSIX packaging do not prove live model behavior, remote discovery, authentication or MCP availability. Record those smoke results separately. The project uses the [PolyForm Noncommercial License 1.0.0](../LICENSE); commercial use requires separate permission. Verify rights to all included content and publisher ownership before Marketplace publication. Local packaging does not grant those rights or publish the extension.