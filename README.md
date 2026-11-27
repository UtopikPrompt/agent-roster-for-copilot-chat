# Aro: Agent Roster Orchestrator for Copilot Chat

**Tell Copilot what you need. Aro finds the right specialist.**

<p align="center">
	<img src="assets/banner.jpg" alt="Aro, a robot character surrounded by connected specialist nodes" width="640">
</p>

Aro Agent Roster is a VS Code extension that registers a curated set of GitHub Copilot Chat agents and reusable skills. It contributes the definitions in `agents/` and `skills/` to Copilot Chat, adds the Aro model-learning view and tools, and does not run its own agent runtime. Copilot Chat runs the agents.

## Get Started

Open Copilot Chat, choose **Aro** agent, and describe what you need. For example:

```text
I’m new to this project. Explain what it does and where I should start.
```

You can ask Aro to make a plan before changing anything. Review suggestions and approve changes through the usual Copilot prompts.

For complex, multi-specialist workflows, see [Advanced task prompts](docs/advanced-task-prompts.md).

## Where Definitions Live

- [agents/](agents/) holds one Markdown file per agent with its role, tools, routing, and task behavior. These files are the source of truth for agent capabilities.
- [skills/](skills/) holds reusable procedures that agents link to. Skills describe procedures; they never grant tools or authorization.
- `package.json` registers each agent and skill file under `contributes.chatAgents` and `contributes.chatSkills`. A definition is available in Copilot Chat only after it is registered.
- The roster currently has 52 agents (Aro, 8 advisors, and 43 specialists) and 11 skills.

## Aro (the dispatcher)

Aro is the intended starting point. It does not do specialist work itself. For each specialist call, Aro consults an advisor to choose one worker from the candidates it supplies, invokes that worker, and reconciles the result. Advisors and workers never delegate. See [Aro routing](docs/agents.md#aro-routing) for the sequence.

## Finding Capabilities

- [Agent catalog](docs/agents.md): every agent, its purpose, and how advisors route to it.
- [Skill catalog](docs/skills.md): every reusable skill and the task it covers.
- [Advanced task prompts](docs/advanced-task-prompts.md): multi-specialist workflows.
- [Contributing and maintenance](CONTRIBUTING.md): contributor and release guidance for this extension.
- [Project assessment guide](docs/project-assessment.md): how to request and interpret source-neutral assessments.

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

For project maintenance and contributor information, see [CONTRIBUTING.md](CONTRIBUTING.md).