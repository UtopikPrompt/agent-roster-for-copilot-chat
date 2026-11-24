# Model Evaluation Worksheet: Aro Routing & Task Trials

## Objective
Conduct a paired trial evaluation of candidate models for Aro's routing and task execution roles. Compare against the currently eligible configured baseline for each activity/domain/difficulty using representative tasks.

### Scope
- **Candidate Models**:
  - Mistral Large 4: User-reported capabilities; model ID, vendor, and eligibility unverified.
  - Mistral Small 2603: User-reported capabilities; model ID, vendor, and eligibility unverified.
  - Ministral 8B 2512: User-reported capabilities; model ID, vendor, and eligibility unverified.
  - Devstral Medium 2512: User-reported possible deprecation; lifecycle status unverified.
- **Baseline**: The currently eligible configured model for each activity/domain/difficulty.

### Metadata Verification
- Verify exact model ID, vendor, model argument, and eligible Aro scope as a precondition for all trials. Only the Large 4 endpoint alias `mistral-large-4-0-8` was supplied; IDs/model arguments for other candidates were not supplied. User-reported metadata/context is unverified pending endpoint/runtime check.

# Candidate Matrix

| Model                     | Context Window | Tools/Features                     | Eligibility Notes                          |
|--------------------------|-----------------|------------------------------------|---------------------------------------------|
| Mistral Large 4          | 1,048,576      | Vision, tools                      | Core candidate; model ID, vendor, and eligibility unverified.
| Mistral Small 2603       | 262,144         | Vision, tools                      | Core candidate; model ID, vendor, and eligibility unverified.
| Ministral 8B 2512        | 262,144         | Vision, tools                      | Core candidate; model ID, vendor, and eligibility unverified.
| Devstral Medium 2512    | 262,144         | Tools (coding-focused)             | Possible deprecation; lifecycle status unverified. Optional control for coding tasks.

**Out of Scope**: GLM (non-Mistral), specialized OCR/audio/embedding/moderation models.

## Trial Controls
- **Paired Trials**: Each candidate vs. the currently eligible configured baseline for each activity/domain/difficulty. Trials must be repeated under identical prompts/tool setup/conditions.
- **Tasks**:
  - **Advisor Tasks**: Routing decisions for complex domain queries (e.g., multi-step workflows).
  - **Worker Tasks**: Task acceptance, tool selection, and argument handling (e.g., API calls, file operations).
- **Vision/Large-Context Probes**: Only if explicitly supported by the candidate.

## Task Acceptance Criteria

### Advisor Routing
- **Valid Candidate**: Selected agent is a valid allowlisted candidate for the task.
- **Grounded Selection**: Selection/reasoning is grounded in supplied task, stack signals, and constraints.
- **Status Appropriateness**: Status (e.g., MATCH, NEEDS_INPUT, NO_MATCH) is used appropriately.
- **No Execution Claims**: No claims of worker execution or tool invocation by the advisor.

### Worker Task Execution
- **Correctness**: Task acceptance, tool selection, and arguments match the observable requirements.
- **Completeness**: All required steps are executed without omission.
- **Safety**: No unsafe or unauthorized tool/argument combinations.
- **Error Handling**: Graceful handling of edge cases and errors without unsafe fallbacks.

### Vision/Large-Context Probes
- Only conducted if explicitly supported by the candidate model and runtime environment.
- Acceptance criteria: Output aligns with observable input requirements and domain constraints.

## Trial Log Template
### Trial ID: `Trial-XX`
**Task Type**: [Advisor/Worker]
**Activity/Domain/Difficulty**: [Specify]
**Pair/Repeat/Order**: [Specify]

| Field                                      | Value                                                                                     |
|---------------------------------------------|---------------------------------------------------------------------------------------------|
| Task ID                                    | `Trial-XX`                                                                                 |
| Candidate Requested Identity                | [Model Name/ID]                                                                                |
| Candidate Resolved Identity                 | [Actual Model ID/Vendor]                                                                      |
| Baseline Requested Identity                 | [Model Name/ID]                                                                                |
| Baseline Resolved Identity                  | [Actual Model ID/Vendor]                                                                      |
| Candidate Model Argument/Vendor/ID         | [Explicit model argument or vendor ID if applicable]                                          |
| Baseline Model Argument/Vendor/ID           | [Explicit model argument or vendor ID if applicable]                                          |
| Acceptance Criteria                          | [Specify task-specific criteria]                                                            |
| Outcome/Evidence                            | `pass`/`fail`/`notes`                                                                       |
| Latency (ms)                                | [Measured, if applicable]                                                                  |
| Cost                                         | [Measured, if applicable]                                                                  |

**Notes**: [Additional context, edge cases, or observations]

## Notes
- **Metadata Claims**: Recorded as-is (e.g., context window, tool support).
- **Measured Outcomes**: Latency/cost recorded separately only when trustworthy runtime measurements exist.
- **Baseline**: Defined per trial as the currently eligible configured model for each activity/domain/difficulty.
- **Deprecated Models**: Devstral Medium 2512 remains as a user-reported coding comparison candidate; lifecycle status unverified.

**Aro Learning Policy**:
- Records only observable quality outcomes (`incorrect`, `incomplete`, `acceptance_failed`, `unsafe`).
- Provider/quota/tool/environment failures are not quality failures.
- Context is metadata, not quality evidence.
- Latency/cost are separate and only from trustworthy runtime measurements.

**Selection Guidance**:
- Repeated paired evidence across relevant task types.
- Required behaviors pass acceptance criteria.
- Exact model eligible in configured scope.
- Human review before changing preferences.

---