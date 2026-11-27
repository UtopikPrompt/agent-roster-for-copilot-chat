# Advanced Multi-Specialist Task Prompts

Select **Aro** in Copilot Chat, then adapt a prompt below. These are task requests,
not commands to a particular worker: Aro selects the required advisors and
specialists, sequences dependent work, and reconciles their results. State the
repository, product, or component scope; label unknown constraints as unknown.

## Current-State Discovery

```text
Build the As-Is System Reference for [repository]. Scope the assessment to [system/components]. Document evidence-backed business behavior, data and integration boundaries, architecture views, coverage, unknowns, and contradictions. Keep this current-state only; do not propose redesign or implement changes.
```

## Modernization Assessment

```text
Assess [repository/product] for software modernization. Combine evidence-backed business needs and rules, product feature recommendations, target architecture options, migration readiness, and a dependency-based roadmap. Keep observed facts, inferences, and proposals distinct. Include an optional 7 Rs assessment by application/workload where useful; do not force a disposition. Do not implement, migrate, or deploy.
```

## Architecture Decision

```text
For [system and scope], compare target architecture options against [requirements, constraints, or supplied assessment]. Cover component boundaries, data ownership, interfaces, security/trust boundaries, dependencies, tradeoffs, and unresolved decisions. Treat recommendations as proposals, not approvals or implementation instructions.
```

## Migration Readiness

```text
Assess migration readiness for [system/workloads] moving from [current environment] to [target environment]. Identify application and data dispositions, prerequisites, dependency order, integration transitions, validation, cutover, rollback, and unresolved decisions. Use evidence or mark assumptions and unknowns; do not execute migration or invent costs, dates, or approvals.
```

## Specification Review And Handoff

```text
Review [specification/package and version] against [requirements or acceptance criteria], then prepare a portable implementation handoff for [approved scope]. Report evidence gaps, contradictions, acceptance scenarios, dependencies, work packages, validation gates, and decisions still needed. Keep proposed scope separate from approved scope; do not implement.
```

## Project Assessment

```text
Assess [target project] for [goal] across [approved sources, e.g. repository, SharePoint site, Azure DevOps project]. Declare scope first, collect read-only evidence per source, and report source status, coverage, and sufficiency per area. Sources whose tools are not bound at runtime are BLOCKED and unassessed until the runtime tool inventory is supplied. Mark BLOCKED or unassessed areas explicitly and produce no completeness or health score while any in-scope source is incomplete. At P0 create or choose one unique `docs/project-assessment/<run-id>/` root and reuse it for every source, phase, checkpoint, and final artifact. Never create sibling run folders or top-level phase-suffix directories. Return the report content in the response and save the full report package to that exact root by default. Never overwrite existing output. An explicit don't-save request keeps it chat-only, and an explicit alternate destination replaces the default.
```

Short form. Aro runs the full default assessment of the target project named in the request and saves the full report package to the open workspace folder, which is the output destination only. The open repository is never an implied source; its evidence is collected only when the request explicitly includes the local repository as a source. A request that names no evidence source gets one critical clarification before collection. The result also reports exact relative paths and per-file delivery status. If nothing is saved, that result contains the actual content of every named report-package document. You do not need to paste agent instructions or name agents:

```text
Do an assessment of [target project] using [approved sources].
```

To continue an existing project assessment without repeating intake, name the project and state the supplied sources; the open workspace folder remains the report destination only. For example:

```text
Continue la génération d'une évaluation complète du projet [Summary - Overview](https://dev.azure.com/{organization}/{project}), Des documents déjà ingérés sont disponibles. Source: https://{site-url}
```

Obtain `{organization}`, `{project}`, and `{site-url}` only from the current user request or an authorized upstream payload. They are placeholders, not defaults. This continuation means resume prior work: reuse compatible prior run data from the output destination's `docs/project-assessment/` tree after reuse checks, search the local repository for ingested source artifacts only if it is explicitly included as a source, keep the Azure DevOps URL and SharePoint site in scope, and continue with readable evidence. Prior reports are context only. Remote sources unavailable through read-only tools are BLOCKED and other sources continue. P5/P6 may produce constrained partial analysis with explicit limitations, but completeness and a final go/no-go must not be claimed. The full technical Markdown package and standalone executive HTML are saved by default to the run root: a new run root only for a new assessment or an incompatible prior run. They are returned in chat for an explicit chat-only override or if writer write/read tools are unavailable.

Remote sources still need their approved read-only tools and access. Persistence does not need a separate save-confirmation question for normal assessment prompts. Report content follows the language of the prompt; the English package filenames do not change.

## Tips

- Ask for an As-Is System Reference when you need current-state evidence only; ask
  for a modernization assessment when you also need product and technical proposals.
- Name a bounded scope when the repository contains multiple products or workloads.
- For multi-stage work, request the complete assessment and its report index/resume
  point; do not turn discovery reports into numbered implementation phases.
- Persistence, implementation, migration, and deployment require explicit request
  and authorization for those actions.