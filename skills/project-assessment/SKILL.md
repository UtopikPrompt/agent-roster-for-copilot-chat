---
name: project-assessment
description: "Shared procedure for a general, evidence-linked assessment of a user-defined subject across health/readiness, architecture and technical quality, requirements alignment, and other relevant dimensions, with visible uncertainty and audience-specific reports."
---

# Project Assessment

Use within the current agent's tool list and the user's authorized scope. This skill never grants tools, delegation, writes, source access, or authorization.

## Scope and Subject

- The subject is the user-defined target. The active workspace is the default assessment subject/material boundary only when no other subject or scope is supplied; it is not a claim that external sources are connected or discoverable.
- The orchestrator performs source-neutral intake through advisor-selected general read-only specialists. It must not create roles organized around external source families or imply automatic discovery of external sources. If no suitable read-only worker/tool exists for an affected area, mark that area UNKNOWN/NOT ASSESSED.
- Additional material is in scope only when the user explicitly names and authorizes it. Do not infer, discover, or add neighboring repositories, services, sites, records, or prior-run context. Request named material only when needed to resolve a stated evidence gap.
- Record the subject, audiences, goal, rubric, approved material, exclusions, dimensions, and point-in-time boundaries before synthesis.
- If no rubric is supplied, use a consistent framework covering health/readiness, architecture and technical quality, alignment with user-provided requirements, strengths, weaknesses, risks, gaps, and other dimensions relevant to the subject.
- Ask only for critical subject, rubric, audience, or authorization decisions. Never manufacture missing requirements.

## Evidence Contract

- Use only supplied or authorized material. Preserve stable references, source or origin where known, scope, revision or point in time, availability, coverage, conflicts, and uncertainty.
- Represent each item with the minimum fields needed to trace a claim: reference or ID, scope, status, coverage or denominator, claim basis, and known limitations.
- Valid statuses are COMPLETE, PARTIAL, BLOCKED, DENIED, EMPTY, ERROR, or UNKNOWN as applicable to the assessment contract. Missing evidence is a gap, not zero or false.
- Do not normalize away conflicts or mismatches. Keep contradictory material visible and identify what would resolve it.
- Cite a stable reference for every evidence-backed finding. Label assumptions and proposals separately.
- No score, grade, percentage, or completeness claim is allowed without a declared method and denominator.

## Assessment Process

1. Confirm the subject, scope, audience, dimensions, rubric, and source boundary.
2. Inventory only the authorized material and classify coverage and availability for each relevant area.
3. Normalize supplied material into traceable evidence while preserving provenance and limitations.
4. Compare coverage with the subject and rubric. Mark unsupported dimensions NOT ASSESSED and constrained dimensions PARTIAL or BLOCKED.
5. Analyze requirements alignment, architecture and technical quality, operational readiness, delivery practice, strengths, weaknesses, risks, conflicts, and gaps that are relevant to the subject.
6. Produce findings with evidence references, claim basis, confidence, conflicts, and unassessed areas.
7. Draft separate substantive deliverables for each relevant audience. Do not merge different audiences into one generic summary.
8. Run only the checks authorized by the scope and record checks performed and omitted.

## Quality Rules

- Distinguish observed, asserted, inferred, contradicted, and unknown claims.
- A source or area that is BLOCKED, DENIED, ERROR, or EMPTY informs no unqualified finding; it remains visible in the coverage register.
- Do not silently treat an absence of a material in the supplied set as proof of absence from the subject.
- Do not invent data, dates, requirements, dependencies, ownership, or test results.
- Reconcile conflicts in the evidence and explain the unresolved side rather than choosing a side without support.
- When material is incomplete, state what conclusions remain bounded and what explicitly named additional material could reduce uncertainty.

## Domain Selection

- Choose domain dimensions from the subject and supplied material. Do not apply a fixed rubric or specialist chain by default beyond the general framework.
- Select only relevant business, architecture, technical quality, product, or other general specialists through advisor-first routing. Invoke a rebuild specialist only for an explicit rebuild, migration, or roadmap request supported by evidence; otherwise omit rebuild analysis as NOT ASSESSED.

- Business or policy subjects may assess goals, requirements, processes, responsibilities, stakeholder impact, and traceability.
- Technical subjects may assess architecture, interfaces, data, security, reliability, scalability, maintainability, operations, testing, and delivery.
- Product subjects may assess needs, priorities, capabilities, tradeoffs, target requirements, and modernization options.
- Organizational subjects may assess readiness, governance, ownership, process, capability, dependencies, and change risk.
- Add or omit dimensions explicitly; omitted dimensions are NOT ASSESSED.

## Report Package

Use document names and sections appropriate to the subject and audiences. Common deliverables include:

- `assessment-summary.md`: status, subject, scope, principal findings, uncertainty, and the next evidence needed.
- `assessment-method-and-data.md`: rubric, authorized material, coverage, provenance, limitations, assumptions, and validation performed.
- `requirements-alignment.md`: user-provided requirements and their evidence-backed alignment, gaps, or conflicts, or NOT ASSESSED.
- `architecture-and-quality.md`: architecture, technical quality, risks, tradeoffs, and relevant operating concerns.
- `readiness-and-roadmap.md`: readiness, priorities, proposed phases, gates, dependencies, and rollback or contingency only when relevant.
- `audience-specific sections or documents`: tailored findings for executives, operators, engineers, owners, or other named audiences.

The report package is content only unless Aro obtains explicit save authorization and confirmed write paths. Persistence belongs to `GovDocumentationSuiteGenerator`; this skill and assessment workers do not write or claim saved files.

## Finding Quality

Every finding should state:

- the claim;
- the evidence references supporting or contradicting it;
- claim basis and confidence;
- coverage or denominator;
- conflicts or missing information;
- impact and severity only when supported;
- proposed action or owner only as a proposal when ownership is unknown;
- whether the finding is final, partial, or NOT ASSESSED.

## Handoff

Return findings, coverage, conflicts, gaps, and complete audience document drafts to Aro. If a conclusion requires additional material, identify the exact missing material but do not add or retrieve it unless the user explicitly names and authorizes it.
