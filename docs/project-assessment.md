# Project Assessment

Use Aro for a general assessment of a project, system, organization, process, product, or portfolio. Aro is the dispatcher bridge: it coordinates relevant advisers and specialists, reconciles their findings, and keeps report persistence separate from analysis.

## Start An Assessment

The active workspace is the default material boundary. If you also need another repository, document, service, or set of records, explicitly name and authorize that material in the same request. There is no fixed source family or connector workflow, and Aro does not infer access or substitute prior-run context.

```text
Do an assessment of this project.
```

For a more specific request:

```text
Assess [subject] for [goal]. Use [active workspace or exactly named material] and [user-provided rubric or the general framework]. The relevant audiences are [audiences].
```

## What The Assessment Covers

When you do not provide a rubric, the assessment may cover:

- health or readiness;
- architecture and technical quality;
- alignment with user-provided requirements;
- strengths and weaknesses;
- risks and gaps;
- operating, delivery, governance, security, or stakeholder concerns relevant to the subject.

Only applicable dimensions are analyzed. A missing or blocked area is not presented as a passing or failing result.

## Evidence And Uncertainty

The report distinguishes observed, asserted, inferred, contradicted, and unknown claims. Findings cite stable evidence references and preserve source scope, point-in-time context, conflicts, and limitations.

- `UNKNOWN` means the evidence needed to reach a conclusion is unavailable.
- `PARTIAL` means the evidence covers only part of the dimension or rubric.
- `BLOCKED` means authorized evidence or a required capability could not be used.
- `NOT ASSESSED` means the dimension is outside the declared scope or not sufficiently relevant to analyze.

No health score, readiness grade, percentage, or completeness claim is produced without a declared method and denominator.

## Reports And Audiences

A request can produce a separate substantive report for each relevant audience, such as executives, operators, engineers, owners, or auditors. A generic summary does not replace a report tailored to a distinct audience.

Common report content includes:

- principal findings and status;
- scope, rubric, authorized material, and coverage;
- evidence references and limitations;
- requirements alignment;
- architecture and technical quality;
- readiness, priorities, risks, and proposed next evidence.

The detailed procedure is maintained in the [`project-assessment` skill](../skills/project-assessment/SKILL.md). Aro and the assessment agents use that source of truth instead of a separate implementation plan.

## Saving A Report

Returning report content is not permission to write files. Saving requires a separate, explicit authorization and a confirmed, non-roster target path. Aro routes the complete content to the documentation writer and reports persistence only after that writer confirms the saved files and paths.
