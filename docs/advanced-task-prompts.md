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
Assess [subject] for [goal] using [active workspace or exactly named sources/material] and [user-provided rubric or the general framework]. Declare scope first, record provenance and coverage, label uncertainty, and separate evidence-backed findings from assumptions. Use one report document per relevant audience. Mark unavailable areas `UNKNOWN` or `NOT ASSESSED`; produce no completeness or health score when coverage is incomplete. Return the report content in the response. Persistence happens only when I explicitly authorize saving and confirm a non-roster target path through a separate handoff to the documentation writer.
```

Short form. Aro runs the full default assessment of the open project and returns one consolidated result in chat. When nothing is saved, that result contains the actual content of every named report-package document. Files are not written unless you explicitly authorize saving (P7) with target paths; the package is never saved automatically. You do not need to paste agent instructions or name agents:

```text
Do an assessment of this project.
```

Remote sources still need their approved tools and access, and persistence still needs an explicit save request and a confirmed target path.

## Tips

- Ask for an As-Is System Reference when you need current-state evidence only; ask
  for a modernization assessment when you also need product and technical proposals.
- Name a bounded scope when the repository contains multiple products or workloads.
- For multi-stage work, request the complete assessment and its report index/resume
  point; do not turn discovery reports into numbered implementation phases.
- Persistence, implementation, migration, and deployment require explicit request
  and authorization for those actions.