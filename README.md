# Aro: Agent Roster Orchestrator for Copilot Chat

**Tell Copilot what you need. Aro finds the right specialist.**

<p align="center">
	<img src="assets/banner.jpg" alt="Aro, a robot character surrounded by connected specialist nodes" width="640">
</p>

This extension adds 57 focused helpers to GitHub Copilot Chat: 48 specialists, 8 advisors, and Aro. They can help explain a project, solve coding problems, plan changes, improve documentation, and more. Aro is the starting point: describe your task in your own words, and it brings in a helper suited to the work.

## Get Started

Open Copilot Chat, choose **Aro** agent, and describe what you need. For example:

```text
I’m new to this project. Explain what it does and where I should start.
```

You can ask Aro to make a plan before changing anything. Review suggestions and approve changes through the usual Copilot prompts.

For complex, multi-specialist workflows, see [Advanced task prompts](docs/advanced-task-prompts.md).

## Aro (the orchestrator)

Aro is the starting point for the roster. Describe what you need, and Aro consults an advisor to choose a specialist, then coordinates the task and synthesizes the result. For Aro’s routing sequence and model-selection details, see [the agent guide](docs/agents.md#aro-routing).

## Advisors

Advisors help Aro choose the right specialist for a task. They select a route; the selected agent does the work.

<details>
<summary>Browse all 8 advisors</summary>

| Advisor | Purpose |
| --- | --- |
| [BusinessKnowledgeAdvisor](agents/BusinessKnowledgeAdvisor.agent.md) | Select specialists for business needs, rules, processes, and impact questions. |
| [CodeBackendAdvisor](agents/CodeBackendAdvisor.agent.md) | Select backend approaches for APIs, frameworks, GraphQL/tRPC, and databases. |
| [CodeDomainAdvisor](agents/CodeDomainAdvisor.agent.md) | Select coding, product-modernization, architecture, and rebuild specialists. |
| [CodeFrontendAdvisor](agents/CodeFrontendAdvisor.agent.md) | Select frontend specialists for Next.js, Vite/React, or design systems. |
| [DocsGovernanceAdvisor](agents/DocsGovernanceAdvisor.agent.md) | Select documentation and governance specialists for ADRs, GitHub, and research. |
| [InfraDevOpsAdvisor](agents/InfraDevOpsAdvisor.agent.md) | Select DevOps specialists for infrastructure, deployment, and security work. |
| [ProjectAssessmentAdvisor](agents/ProjectAssessmentAdvisor.agent.md) | Select one read-only evidence collector or the cross-source analysis worker for a project assessment. |
| [UtilityAdvisor](agents/UtilityAdvisor.agent.md) | Select specialists for agent diagnostics, brainstorming, and checkpoints. |

</details>

## Agents

The roster includes 48 specialist agents, selected by Aro with help from the advisors above.

<details>
<summary>Browse all 57 agents</summary>

| Agent | Purpose |
| --- | --- |
| [AgentOptimizer](agents/AgentOptimizer.agent.md) | Analyze and optimize VS Code agents, including tools, triggers, skills, and instructions. |
| [Brainstorm](agents/Brainstorm.agent.md) | Generate architectural alternatives, edge cases, and code-pattern options. |
| [BusinessKnowledgeExpert](agents/BusinessKnowledgeExpert.agent.md) | Produce evidence-grounded business-rule, process, and impact analyses. |
| [CodeArchitectureExpert](agents/CodeArchitectureExpert.agent.md) | Document current architecture or propose a target architecture from supplied evidence. |
| [CodeComfyUICustomNodeSpecialist](agents/CodeComfyUICustomNodeSpecialist.agent.md) | Develop and debug ComfyUI custom nodes, packs, and frontend extensions. |
| [CodeContextSchemaAuditor](agents/CodeContextSchemaAuditor.agent.md) | Audit schemas, dependencies, configuration, and environment constraints. |
| [CodeDatabaseORMGenerator](agents/CodeDatabaseORMGenerator.agent.md) | Generate database schemas, migrations, indexes, and ORM setup. |
| [CodeDesignSystemSpecialist](agents/CodeDesignSystemSpecialist.agent.md) | Build shared UI components, design tokens, themes, and documentation. |
| [CodeExpressSpecialist](agents/CodeExpressSpecialist.agent.md) | Implement and debug Express APIs using repository conventions. |
| [CodeFastApiSpecialist](agents/CodeFastApiSpecialist.agent.md) | Scaffold and implement FastAPI services with Pydantic and SQLAlchemy. |
| [CodeFrameworkDiagnostician](agents/CodeFrameworkDiagnostician.agent.md) | Diagnose framework errors and validate local dependencies. |
| [CodeGeneralist](agents/CodeGeneralist.agent.md) | Implement, review, debug, or refactor when no specialist fits. |
| [CodeGraphQLTRPCAgent](agents/CodeGraphQLTRPCAgent.agent.md) | Build GraphQL APIs and tRPC services. |
| [CodeMockupWireframeSpecialist](agents/CodeMockupWireframeSpecialist.agent.md) | Produce direct, readable screen and flow mockups. |
| [CodeNextJsSpecialist](agents/CodeNextJsSpecialist.agent.md) | Build and maintain Next.js applications and APIs. |
| [CodeProductModernizationExpert](agents/CodeProductModernizationExpert.agent.md) | Assess product modernization opportunities and define target workflows. |
| [CodeQualityGuardrailReviewer](agents/CodeQualityGuardrailReviewer.agent.md) | Independently review specifications, designs, and code for defects and risks. |
| [CodeReactViteSpecialist](agents/CodeReactViteSpecialist.agent.md) | Build React and Vite frontends with TypeScript. |
| [CodeRebuildEngineer](agents/CodeRebuildEngineer.agent.md) | Produce an evidence-linked As-Is System Reference or integrate supplied reports. |
| [CodeSpringBootSpecialist](agents/CodeSpringBootSpecialist.agent.md) | Implement and debug Spring Boot services using existing project conventions. |
| [ContextSummarizer](agents/ContextSummarizer.agent.md) | Create concise checkpoints for long or interrupted sessions. |
| [GovArchitectureRecordsExpert](agents/GovArchitectureRecordsExpert.agent.md) | Draft and maintain ADRs, RFCs, and architecture records. |
| [GovDocumentationSuiteGenerator](agents/GovDocumentationSuiteGenerator.agent.md) | Write repository documentation and generate documentation suites. |
| [GovGitWorkflowAgent](agents/GovGitWorkflowAgent.agent.md) | Manage authorized Git branches, commits, pushes, pull requests, and recovery. |
| [GovGithubAgent](agents/GovGithubAgent.agent.md) | Plan agent capabilities and manage GitHub issue triage and filing. |
| [GovOfficeDocumentGenerator](agents/GovOfficeDocumentGenerator.agent.md) | Create and validate PowerPoint and Visio deliverables. |
| [GovWebResearchAgent](agents/GovWebResearchAgent.agent.md) | Research current web sources and return evidence-linked findings. |
| [InfraAzureDevOpsAgent](agents/InfraAzureDevOpsAgent.agent.md) | Read and, after confirmation, change Azure DevOps work items, repos, pull requests, and wiki pages. |
| [InfraCIDiagnostics](agents/InfraCIDiagnostics.agent.md) | Diagnose CI and GitHub Actions failures and propose minimal fixes. |
| [InfraCloudDeploymentAgent](agents/InfraCloudDeploymentAgent.agent.md) | Design and implement cross-cloud deployment and provisioning. |
| [InfraDevContainerSpecialist](agents/InfraDevContainerSpecialist.agent.md) | Configure development containers and workspace environments. |
| [InfraIaCGenerator](agents/InfraIaCGenerator.agent.md) | Generate and validate Terraform, Pulumi, Bicep, and ARM infrastructure. |
| [InfraKubernetesEngineer](agents/InfraKubernetesEngineer.agent.md) | Engineer Kubernetes manifests, networking, RBAC, and operations. |
| [InfraLLMInferenceSpecialist](agents/InfraLLMInferenceSpecialist.agent.md) | Diagnose and configure local LLM inference and model capacity. |
| [InfraMCPServerGenerator](agents/InfraMCPServerGenerator.agent.md) | Scaffold MCP servers and editor integrations. |
| [InfraMonorepoManager](agents/InfraMonorepoManager.agent.md) | Coordinate package dependencies, versions, and affected builds. |
| [InfraObservabilitySpecialist](agents/InfraObservabilitySpecialist.agent.md) | Set up logging, tracing, metrics, and monitoring. |
| [InfraPerformanceProfiler](agents/InfraPerformanceProfiler.agent.md) | Profile Python and Node.js CPU or memory performance. |
| [InfraReleaseManager](agents/InfraReleaseManager.agent.md) | Prepare releases, changelogs, and stage-specific publication plans. |
| [InfraSecurityAuthAgent](agents/InfraSecurityAuthAgent.agent.md) | Design and diagnose authentication, authorization, RBAC, and secrets. |
| [InfraTestInfrastructureGenerator](agents/InfraTestInfrastructureGenerator.agent.md) | Generate test suites, fixtures, mocks, coverage, and CI gates. |
| [MultiLanguageBuilder](agents/MultiLanguageBuilder.agent.md) | Coordinate Python, Node.js, and TypeScript builds and dependencies. |
| [ProjectAssessmentExpert](agents/ProjectAssessmentExpert.agent.md) | Analyze supplied evidence records across documentation, code, architecture, requirements, and delivery, with gaps visible. |
| [ProjectEvidenceAzureDevOpsCollector](agents/ProjectEvidenceAzureDevOpsCollector.agent.md) | Collect read-only Azure DevOps evidence for projects, teams, code, wiki, work-item, and commit search through exact `ado-remote-mcp` tool IDs. Grouped tools are bound but used only for P1-verified read-only actions; repository tools use the same P1 gate. |
| [ProjectEvidenceGitHubCollector](agents/ProjectEvidenceGitHubCollector.agent.md) | Collect read-only GitHub code scanning alerts for a project assessment. Its allowlist is empty, so collection is BLOCKED until allowlisted operations are added. |
| [ProjectEvidenceLocalRepoCollector](agents/ProjectEvidenceLocalRepoCollector.agent.md) | Collect read-only local target-repository evidence using read and search only. |
| [ProjectEvidenceM365Collector](agents/ProjectEvidenceM365Collector.agent.md) | Read-only OneDrive evidence collector. SharePoint remains owned by the separate SharePoint collector; generic ODSP tool names do not establish a technical source boundary. |
| [ProjectEvidenceSharePointCollector](agents/ProjectEvidenceSharePointCollector.agent.md) | Collect read-only SharePoint documents, libraries, and site metadata through the exact bound `onedrive-sharepoint` read allowlist, including read-only `checkOperationStatus` status lookup. SharePoint list items are not covered. Runtime binding and preauthorization are verified at P1; failures are BLOCKED. |

</details>

## Skills

The extension also includes 12 reusable guides for common tasks, such as investigating a problem, improving an interface, preparing a release, or writing technical documents.

<details>
<summary>Browse all 12 skills</summary>

| Skill | Area | Use it for |
| --- | --- | --- |
| [agent-model-benchmark](skills/agent-model-benchmark/SKILL.md) | Evaluation | Explicit, paired, read-only model trials with fixed rubrics and verified usage telemetry. |
| [container-display-operations](skills/container-display-operations/SKILL.md) | Operations | Containerized display scheduling, timezones, restart behavior, and host/device access boundaries. |
| [frontend-experience-quality](skills/frontend-experience-quality/SKILL.md) | Frontend | Responsive interfaces, design-system consistency, and functional interaction checks. |
| [go-contract-validation](skills/go-contract-validation/SKILL.md) | Backend | Go interfaces and provider adapters, especially cancellation, deadlines, idempotency, cleanup, and error propagation. |
| [identity-failure-isolation](skills/identity-failure-isolation/SKILL.md) | Security | CI authentication and authorization diagnosis using sanitized OIDC, GitHub App, tenant, and secret-reference evidence. |
| [markdown-mermaid-delivery](skills/markdown-mermaid-delivery/SKILL.md) | Documentation | Native Markdown and readable Mermaid diagrams with honest rendering status. |
| [progressive-investigation](skills/progressive-investigation/SKILL.md) | Investigation | Scoped debugging and review from a concrete anchor, falsifiable hypothesis, and cheapest discriminating check. |
| [project-assessment](skills/project-assessment/SKILL.md) | Assessment | Cross-source project assessment procedure with scope, dimensions, evidence-linked analysis, and visible gaps. |
| [project-evidence-ingestion](skills/project-evidence-ingestion/SKILL.md) | Assessment | Read-only evidence record contract: provenance, identity confidence, discovery stages, dynamic budgets, coverage denominators, sufficiency states, blocked results, and redaction. |
| [release-contract-preflight](skills/release-contract-preflight/SKILL.md) | Release | Artifact provenance, overlays, storage ownership, rollback, and stage-specific authorization. |
| [secure-development-bootstrap](skills/secure-development-bootstrap/SKILL.md) | Environment | Development setup across local hosts, SSH, containers, and Codespaces, including safe secret delivery. |
| [specification-handoff](skills/specification-handoff/SKILL.md) | Planning | Turning approved specifications into portable implementation handoffs with requirements, acceptance criteria, and evidence. |

</details>

## Aro Model Learning (Experimental)

Open the **Agent Roster** activity-bar view and select **Open Aro Learning** to see price-aware recommendations by specialist role and task type. A contextual UCB-style policy balances observed outcomes, conservative exploration, and model price. Aro records outcomes only after checking explicit acceptance criteria; ambiguous failures do not count against a model. Exploration is limited to low-risk simple or standard tasks. The scorecard is stored in this VS Code profile and contains no prompts or responses. Aro can request the recommended subagent model when the runtime accepts its exact ID; actual model resolution may not be observable. Rates use native metadata when available and a dated snapshot fallback otherwise. This updates recommendations, not model weights or training data.

<p align="center">
	<img src="assets/aro-learning-dashboard.png" alt="Aro Recommendations view showing Domain and Activity filters, a manual model choice with its learned suggestion, and illustrative outcomes" width="800">
</p>

<p align="center">
	<img src="assets/aro-learning-inventory.png" alt="Aro Model inventory view showing illustrative provider selection, provider types, and model settings" width="800">
</p>

Both screenshots use illustrative models, rates, and outcomes.

Recommendation scoring considers the full eligible inventory, but the tool returns a bounded shortlist to reduce chat context. The shortlist includes the top candidates and eligible provider, learned, and configured Copilot fallbacks where available; its truncation flag indicates when other eligible candidates were omitted.

Aro selects models automatically and separately for advisor and specialist calls, without inspecting or changing the user's chat model. Advisor recommendations appear in the table by task type; there is no manual advisor-model selector. For confirmed provider or model availability failures, Aro can requery with temporary exclusions and make at most three subagent attempts within the configured scope and priority. Provider failures are not scored as model-quality failures, and operations with uncertain side effects are not repeated. Advisor routing outcomes are recorded only when correctness can be independently verified. Fallback depends on the runtime exposing enough failure detail; a VS Code vendor ID is not proof of a separate credit pool.

For complex tasks, the dashboard shows no learned recommendation until an eligible model has at least two recorded outcomes for that role and task. Aro may still use an eligible configured fallback. Two outcomes are a minimum sample, not proof of quality; the displayed price tier is not a capability rating.

The sidebar shows the current scope and priority, selected cloud and local counts, unrated local models, outcome count, and the current recommendation for the most recently recorded role and task. Select the scope or priority row to change it; open the dashboard for the complete inventory and scorecard. The latest-context recommendation is recalculated from current settings and is not proof of which model ran.

Use **Model scope** to select Cloud only, Local only, or Both. Local only and Both are available when at least one local model is checked, even if it is unrated. Explicitly clearing the last checked local model changes the scope to Cloud only. If no selected local model is currently available, Both effectively uses Cloud only, while Local only remains local and reports the limitation; temporary discovery changes do not overwrite the saved scope. With Both selected, choose Cloud first or Local first in **Priority**. The preferred group is tried first, falling back to the other when no eligible priced model is available for the task. Priority defaults to Cloud first and is retained when switching scopes.

In **Model inventory**, use each checkbox to include or exclude a model, or use the provider buttons to select or clear all of a provider's models, including those hidden by search. The provider, family and version come from VS Code model metadata. Under **Provider types**, assign other providers as Cloud or Local; unknown providers are not eligible. The `copilot` and `copilotcli` vendors are always Cloud; vendors in the machine setting `agentRoster.modelLearning.localModelVendors` default to Local. Existing per-model classifications remain in effect until their provider type is explicitly changed, except the fixed Copilot cloud providers.

The shared **Tier** column shows a price-derived tier for cloud models and a manually assigned capability tier for local models. For local models, Low supports simple tasks, Medium supports simple and standard tasks, and High supports all categories. Unrated local models are not eligible. Price is only a proxy, not verified evidence of model capability. Only mark providers you know are local as Local: local token charges are treated as zero, without estimating hardware or energy costs. For an unpriced cloud model, choose a manual price tier in its row to make it eligible; this is a rough selection estimate, not a quoted token rate, and native or snapshot pricing takes precedence if it later becomes available. Choices are stored in the VS Code profile and do not erase outcome history. Runtime support for requesting a particular subagent model is not guaranteed.

To prefer a model for Aro's recommendations in one workspace, open **Aro Learning** and use **Workspace model preference** in **Recommendations**. Choose **Workspace** to pick a provider from the currently eligible models and optionally one exact model; choose **Profile** or **Reset to profile** to remove the workspace override so the learned and manual profile recommendations apply. The choice is stored only in workspace settings as `agentRoster.modelRecommendation.preferredProvider` (an exact VS Code vendor ID) and `agentRoster.modelRecommendation.preferredModel` (an exact model ID, which requires the provider). User settings are not changed, and other workspace settings are preserved. The control is disabled when no folder is open. The preference is a soft ordering among eligible models: it does not change eligibility, scope, priority, pricing, or complex-task evidence rules, and it does not override manual selections. Without an override, recommendations are unchanged. The recommendation output reports the status as `applied`, `not-selected`, `no-eligible-match`, `invalid`, or `not-configured`, so any fallback is visible.

Run **Agent Roster: Open Model Inventory** (also available as **Model inventory** in the Aro Learning page and sidebar) to open one **Model Inventory** page with **Global** and **Workspace** tabs. **Global** sets which providers Aro may use in every workspace; it starts with all providers enabled, and **Reset to All** clears its exclusions. **Workspace** shows the effective choice for the open folder: **Inherit global** follows the Global list, while **Custom** replaces it for this workspace only, so a workspace can re-enable a provider disabled globally. Each provider row shows whether its state comes from the global or workspace list. The page reuses an open panel when the command runs again, and it refreshes when settings change. Provider choices stored in the workspace are written only to workspace settings.

## Privacy And Permissions

The extension contributes two Aro model-learning tools backed by this VS Code profile's global state. Outcome records contain the requested model ID, role, task category, outcome, fixed evidence code, timestamp and optional worker name; the scorecard retains at most 1,000 records. The profile also stores inventory choices, including provider and model identifiers, scope, priority, selections and manual tiers. The local-provider vendor setting is machine-scoped. The learning feature does not store prompts or responses. Other agent tasks use tools available in Copilot Chat. Review proposed changes and permission prompts before approving them.

## License

This project is available under the [PolyForm Noncommercial License 1.0.0](LICENSE). It permits noncommercial use; commercial use requires separate permission from the rights holder. See the license for full terms.

For project maintenance and contributor information, see [maintenance](docs/maintenance.md).