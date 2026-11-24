const crypto = require('node:crypto');

const plainTextControlPrompt = 'Reply with exactly: EVALUATION_OK';
const CANDIDATE_REJECTIONS_KEY = 'agentRoster.modelEvaluation.rejections.v1';

const BACKEND_ROUTING_PROMPT = 'Classify each case using only the supplied candidate list. A: Fix an existing FastAPI dependency that validates a request with Pydantic; preserve the stack. B: Add an index and reversible migration to an existing Prisma schema, with no HTTP changes. C: Build an API; language, framework, requirements, and existing stack are unspecified. Candidates: CodeDatabaseORMGenerator for database schema/ORM/migrations; CodeGraphQLTRPCAgent for GraphQL/tRPC; CodeFastApiSpecialist for FastAPI/Pydantic; CodeExpressSpecialist for Express; CodeSpringBootSpecialist for Spring. Return only JSON array A/B/C with status, exact agent or null, reason, and missing_context.';

function fixedPilotTasks() {
    return [{
        id: 'code-backend-advisor-routing',
        role: 'advisor',
        activity: 'advise',
        domain: 'coding',
        difficulty: 'standard',
        prompt: BACKEND_ROUTING_PROMPT
    }];
}

function pairTwoTrials(candidates, tasks = fixedPilotTasks()) {
    if (!Array.isArray(candidates)) return [];
    return candidates.flatMap(candidate => tasks.flatMap(task => [
        { candidate, task, trial: 1, pairId: `${candidateKey(candidate)}:${task.id}:1` },
        { candidate, task, trial: 2, pairId: `${candidateKey(candidate)}:${task.id}:2` }
    ]));
}

function candidateKey(candidate) {
    return JSON.stringify([candidate?.vendor || '', candidate?.id || '']);
}

function normalizeStringArray(value) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .filter(item => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean)));
}

function normalizeCandidateRejections(input) {
    const source = input && Array.isArray(input.rejections)
        ? input.rejections
        : (Array.isArray(input) ? input : []);
    const rejections = new Map();
    for (const item of source) {
        if (!item || typeof item !== 'object') continue;
        const vendor = typeof item.vendor === 'string' ? item.vendor.trim() : '';
        const modelId = typeof item.modelId === 'string'
            ? item.modelId.trim()
            : (typeof item.id === 'string' ? item.id.trim() : '');
        if (!vendor || !modelId) continue;
        const key = `${vendor}\u0000${modelId}`;
        const rejectedAt = typeof item.rejectedAt === 'string' && item.rejectedAt.trim()
            ? item.rejectedAt.trim()
            : new Date(0).toISOString();
        const reasonCode = typeof item.reasonCode === 'string' && item.reasonCode.trim()
            ? item.reasonCode.trim()
            : 'human_review';
        const normalized = {
            vendor,
            modelId,
            rejectedAt,
            reasonCode,
            sourceTrialIds: normalizeStringArray(item.sourceTrialIds),
            sourceCallIds: normalizeStringArray(item.sourceCallIds)
        };
        if (typeof item.reasonText === 'string' && item.reasonText.trim()) {
            normalized.reasonText = item.reasonText.trim();
        }
        rejections.set(key, normalized);
    }
    return { schemaVersion: 1, rejections: Array.from(rejections.values()) };
}

function listCandidateRejections(input) {
    return normalizeCandidateRejections(input).rejections;
}

function findCandidateRejection(input, candidate) {
    if (!candidate) return undefined;
    const vendor = typeof candidate.vendor === 'string' ? candidate.vendor.trim() : '';
    const modelId = typeof candidate.modelId === 'string'
        ? candidate.modelId.trim()
        : (typeof candidate.id === 'string' ? candidate.id.trim() : '');
    if (!vendor || !modelId) return undefined;
    return listCandidateRejections(input).find(item => item.vendor === vendor && item.modelId === modelId);
}

function rejectCandidateRejection(input, candidate, details = {}) {
    const state = normalizeCandidateRejections(input);
    if (!candidate) return state;
    const vendor = typeof candidate.vendor === 'string' ? candidate.vendor.trim() : '';
    const modelId = typeof candidate.modelId === 'string'
        ? candidate.modelId.trim()
        : (typeof candidate.id === 'string' ? candidate.id.trim() : '');
    if (!vendor || !modelId) return state;
    const next = normalizeCandidateRejections(state);
    const rejections = next.rejections.filter(item => !(item.vendor === vendor && item.modelId === modelId));
    const rejection = {
        vendor,
        modelId,
        rejectedAt: typeof details.rejectedAt === 'string' && details.rejectedAt.trim()
            ? details.rejectedAt.trim()
            : new Date().toISOString(),
        reasonCode: typeof details.reasonCode === 'string' && details.reasonCode.trim()
            ? details.reasonCode.trim()
            : 'human_review',
        sourceTrialIds: normalizeStringArray(details.sourceTrialIds),
        sourceCallIds: normalizeStringArray(details.sourceCallIds)
    };
    if (typeof details.reasonText === 'string' && details.reasonText.trim()) {
        rejection.reasonText = details.reasonText.trim();
    }
    rejections.push(rejection);
    return { schemaVersion: 1, rejections };
}

function clearCandidateRejection(input, candidate) {
    const state = normalizeCandidateRejections(input);
    const vendor = typeof candidate?.vendor === 'string' ? candidate.vendor.trim() : '';
    const modelId = typeof candidate?.modelId === 'string'
        ? candidate.modelId.trim()
        : (typeof candidate?.id === 'string' ? candidate.id.trim() : '');
    if (!vendor || !modelId) return state;
    return {
        schemaVersion: 1,
        rejections: state.rejections.filter(item => !(item.vendor === vendor && item.modelId === modelId))
    };
}

function evaluationCandidates(models, options = {}) {
    if (!Array.isArray(models)) return [];
    const seen = new Set();
    const candidates = models.filter(model => {
        if (!model || typeof model !== 'object') return false;
        if (typeof model.vendor !== 'string' || !model.vendor.trim()) return false;
        if (typeof model.id !== 'string' || !model.id.trim()) return false;
        if (model.capabilities && typeof model.capabilities === 'object') {
            if (model.capabilities.chat === false || model.capabilities.instruction === false) return false;
        }
        if (model.supportsChat === false || model.supportsInstruction === false) return false;
        const key = candidateKey(model);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    if (options && typeof options.limit === 'number' && Number.isInteger(options.limit) && options.limit >= 0) {
        return candidates.slice(0, options.limit);
    }
    return candidates;
}

function sanitizeEvaluationError(error) {
    const raw = error instanceof Error ? error.message : String(error || '');
    return raw.replace(/\u0000/g, '').replace(/[\r\n\t]+/g, ' ').trim();
}

function classifyBlocked(error) {
    const raw = error instanceof Error ? `${error.name} ${error.message}` : String(error || '');
    const text = raw.toLowerCase();
    if (/timed? ?out|timeout|deadline/.test(text)) return 'timeout';
    if (/quota|rate.?limit|resource exhausted|too many requests|429/.test(text)) return 'quota';
    if (/model.*(?:not found|unavailable)|unknown model|404/.test(text)) return 'model_not_found';
    if (/network|econn|enotfound|fetch failed|socket|connection/.test(text)) return 'network';
    if (/provider|vendor|401|403|authentication|authorization/.test(text)) return 'provider';
    if (/routing|route.*(?:failed|unavailable)|not available/.test(text)) return 'routing';
    return 'invocation';
}

function classifyTechnicalConfiguration(error, phase, modelSelection) {
    const raw = error instanceof Error ? `${error.name} ${error.message}` : String(error || '');
    const text = raw.toLowerCase();
    const selection = modelSelection && typeof modelSelection === 'object'
        ? JSON.stringify(modelSelection).toLowerCase()
        : '';
    if (/invalid inventory contract|invalid inventory|inventory contract|missing required (?:vendor|id)|missing (?:vendor|id)|vendor and id/.test(text)
        || /missing capability|chat capability|instruction capability|capabilities\.(?:chat|instruction)/.test(text)
        || /exact (?:model )?(?:match|selection)|exact model mismatch|requested model.*(?:does not match|mismatch)|model.*(?:configuration|config).*(?:mismatch|invalid)|configuration.*(?:mismatch|invalid)/.test(text)
        || /invalid.*(?:model|configuration|config)|(?:model|configuration|config).*not supported/.test(text)
        || /exact_model|model_selection.*(?:invalid|mismatch)/.test(`${text} ${selection}`)) {
        return 'rejected_technical_configuration';
    }
    return null;
}

function classifyProviderBoundary(error, blockedType, phase) {
    const boundaryTypes = new Set([
        'auth', 'provider', 'quota', 'network', 'timeout', 'model_not_found',
        'routing', 'invocation', 'invalid_response', 'invalid_response_stream'
    ]);
    if (boundaryTypes.has(blockedType)) return 'incompatible_provider_boundary';

    const raw = error instanceof Error ? `${error.name} ${error.message}` : String(error || '');
    if (/authentication|authorization|401|403|quota|rate.?limit|429|network|econn|enotfound|fetch failed|timed? ?out|timeout|deadline|model.*(?:not found|unavailable)|404|routing|invalid response (?:text )?stream|invalid_response/.test(raw.toLowerCase())) {
        return 'incompatible_provider_boundary';
    }
    return null;
}

function classifyTrial(result) {
    if (!result || typeof result !== 'object') return null;
    if (result.strictSkipped === true || result.status === 'strict_skipped') return 'not_applicable';
    if (result.status === 'completed_success' || result.status === 'success' || result.outcome === 'success') return 'correct_answer';
    if (result.status === 'completed_failure' || result.status === 'control_fail' || result.status === 'control_mismatch') {
        return 'incorrect_answer_rubric';
    }
    if (result.trialKind === 'plain_control' && result.status === 'control_pass') return 'correct_answer';
    return null;
}

function classifyEvaluationError(error, phase = 'pre_invocation') {
    const blockedType = classifyBlocked(error);
    const reason = sanitizeEvaluationError(error);
    const allowedPhases = new Set(['pre_invocation', 'model_selection', 'send_request', 'response_stream', 'response_parse', 'timeout', 'quota', 'provider', 'network', 'routing', 'model_not_found', 'invocation']);
    const normalizedPhase = allowedPhases.has(phase) ? phase : 'pre_invocation';
    const classificationPhase = ['timeout', 'quota', 'provider', 'network', 'routing', 'invocation'].includes(blockedType)
        ? blockedType
        : (blockedType === 'model_not_found' && normalizedPhase === 'model_selection' ? 'model_selection' : normalizedPhase);
    return {
        phase: classificationPhase,
        blockedType,
        reason,
        error: reason
    };
}

function summarizeModelCoverage(candidates, trials) {
    if (!Array.isArray(candidates)) candidates = [];
    if (!Array.isArray(trials)) trials = [];

    const groups = new Map();
    for (const candidate of candidates) {
        if (!candidate || typeof candidate !== 'object') continue;
        if (typeof candidate.vendor !== 'string' || !candidate.vendor.trim()) continue;
        if (typeof candidate.id !== 'string' || !candidate.id.trim()) continue;
        const vendor = candidate.vendor.trim();
        const id = candidate.id.trim();
        const key = candidateKey({ vendor, id });
        if (!groups.has(key)) {
            groups.set(key, {
                candidate: { ...candidate, vendor, id },
                controlStatus: 'never_evaluated',
                strictStatus: 'never_evaluated',
                attemptSlots: new Set(),
                latestIndex: -1,
                latestTimestamp: null
            });
        }
    }

    for (let index = 0; index < trials.length; index += 1) {
        const trial = trials[index];
        const requested = trial?.requested || {};
        if (typeof requested.vendor !== 'string' || !requested.vendor.trim()) continue;
        if (typeof requested.id !== 'string' || !requested.id.trim()) continue;
        const key = candidateKey({ vendor: requested.vendor.trim(), id: requested.id.trim() });
        const group = groups.get(key);
        if (!group) continue;

        const timestamp = typeof trial.recordedAt === 'string' && trial.recordedAt
            ? trial.recordedAt
            : (typeof trial.updatedAt === 'string' && trial.updatedAt ? trial.updatedAt : null);
        if (timestamp) {
            const parsed = Date.parse(timestamp);
            if (Number.isFinite(parsed) && (!group.latestTimestamp || parsed > Date.parse(group.latestTimestamp))) {
                group.latestTimestamp = timestamp;
            }
        }
        if (group.latestIndex < index) group.latestIndex = index;

        if (trial.trialKind === 'plain_control') {
            const realControl = trial.status === 'completed_success'
                || trial.status === 'pass'
                || trial.status === 'control_pass'
                || trial.status === 'blocked'
                || trial.status === 'control_block'
                || trial.status === 'control_fail'
                || trial.status === 'control_mismatch';
            if (!realControl) continue;
            group.attemptSlots.add(`control:${typeof trial.pairId === 'string' && trial.pairId ? trial.pairId : 'plain-control'}`);
            if (trial.status === 'completed_success' || trial.status === 'pass' || trial.status === 'control_pass') {
                if (group.controlStatus === 'never_evaluated') group.controlStatus = 'control_passed';
            } else {
                if (group.controlStatus === 'never_evaluated') group.controlStatus = 'control_blocked';
            }
        } else if (trial.trialKind === 'strict_routing') {
            if (trial.strictSkipped === true || trial.status === 'strict_skipped') continue;
            if (typeof trial.pairId !== 'string' || !trial.pairId.trim()) continue;
            if (typeof trial.taskId !== 'string' || !trial.taskId.trim()) continue;
            if (!Number.isInteger(trial.trial) && typeof trial.trial !== 'string') continue;

            group.attemptSlots.add(`strict:${trial.pairId.trim()}:${trial.taskId.trim()}:${String(trial.trial)}`);
            if (trial.status === 'completed_success' || trial.status === 'completed_failure') {
                group.strictStatus = 'strict_completed';
            } else if (trial.status === 'blocked' && group.strictStatus !== 'strict_completed') {
                group.strictStatus = 'strict_blocked';
            }
        }
    }

    return Array.from(groups.values()).map(group => {
        let coverageStatus = 'never_evaluated';
        if (group.strictStatus === 'strict_completed') coverageStatus = 'strict_completed';
        else if (group.controlStatus === 'control_blocked') coverageStatus = 'control_blocked';
        else if (group.strictStatus === 'strict_blocked') coverageStatus = 'strict_blocked';
        else if (group.controlStatus === 'control_passed') coverageStatus = 'control_passed';

        const result = {
            ...group.candidate,
            coverageStatus,
            controlStatus: group.controlStatus,
            strictStatus: group.strictStatus,
            attemptCount: group.attemptSlots.size
        };
        if (group.latestTimestamp) result.lastEvaluatedAt = group.latestTimestamp;
        return result;
    });
}

function summarizeEvaluationTrials(trials) {
    if (!Array.isArray(trials)) trials = [];
    const failureClasses = {
        rejected_technical_configuration: 0,
        incompatible_provider_boundary: 0,
        incorrect_answer_rubric: 0,
        correct_answer: 0,
        not_applicable: 0
    };
    const candidateMap = new Map();
    for (const trial of trials) {
        if (trial?.trialKind === 'strict_routing'
            && (trial.strictSkipped === true || trial.status === 'strict_skipped')) continue;
        const requested = trial?.requested || {};
        const vendor = typeof requested.vendor === 'string' && requested.vendor.trim() ? requested.vendor : 'unknown';
        const id = typeof requested.id === 'string' && requested.id.trim() ? requested.id : 'unknown';
        const key = `${vendor}\u0000${id}`;
        if (!candidateMap.has(key)) candidateMap.set(key, { provider: vendor, model: id, controls: { pass: 0, fail: 0, block: 0 }, strict: { completed: 0, blocked: 0 } });
        const group = candidateMap.get(key);
        if (typeof trial?.failureClass === 'string' && Object.prototype.hasOwnProperty.call(failureClasses, trial.failureClass)) {
            failureClasses[trial.failureClass] += 1;
        }
        if (trial?.trialKind === 'plain_control') {
            if (trial.status === 'control_pass') group.controls.pass += 1;
            else if (trial.status === 'control_fail') group.controls.fail += 1;
            else group.controls.block += 1;
        } else if (trial?.trialKind === 'strict_routing') {
            if (trial.status === 'blocked') group.strict.blocked += 1;
            else if (trial.status === 'completed_success' || trial.status === 'completed_failure') group.strict.completed += 1;
        }
    }

    const providers = new Map();
    for (const candidate of candidateMap.values()) {
        if (!providers.has(candidate.provider)) providers.set(candidate.provider, { provider: candidate.provider, candidates: 0, controlPass: 0, controlFail: 0, controlBlock: 0, strictCompleted: 0, strictBlocked: 0 });
        const provider = providers.get(candidate.provider);
        provider.candidates += 1;
        provider.controlPass += candidate.controls.pass;
        provider.controlFail += candidate.controls.fail;
        provider.controlBlock += candidate.controls.block;
        provider.strictCompleted += candidate.strict.completed;
        provider.strictBlocked += candidate.strict.blocked;
    }

    const providerList = Array.from(providers.values());
    const totalControlPass = providerList.reduce((sum, item) => sum + item.controlPass, 0);
    const totalControlFail = providerList.reduce((sum, item) => sum + item.controlFail, 0);
    const totalControlBlock = providerList.reduce((sum, item) => sum + item.controlBlock, 0);
    const strictCompleted = providerList.reduce((sum, item) => sum + item.strictCompleted, 0);
    const strictBlocked = providerList.reduce((sum, item) => sum + item.strictBlocked, 0);

    let verdict = 'Mixed';
    if (!candidateMap.size) verdict = 'Mixed';
    else if (totalControlBlock && !totalControlPass && !totalControlFail) verdict = 'Blocked at provider boundary';
    else if (totalControlFail && !totalControlPass && !strictCompleted) verdict = 'Model-rubric-mismatch';
    else if (strictCompleted && strictBlocked === 0 && trials.every(trial => trial?.trialKind !== 'strict_routing' || trial.status === 'completed_success')) verdict = 'Provider-compatible';
    else if (strictCompleted > 0) verdict = 'Mixed';

    return {
        providerCount: providerList.length,
        candidateCount: candidateMap.size,
        controlPass: totalControlPass,
        controlFail: totalControlFail,
        controlBlock: totalControlBlock,
        strictCompleted,
        strictBlocked,
        control: { pass: totalControlPass, fail: totalControlFail, block: totalControlBlock },
        strict: { completed: strictCompleted, blocked: strictBlocked },
        failureClasses,
        providers: providerList,
        verdict
    };
}

function acceptBackendRoutingResponse(text) {
    let value;
    try {
        value = JSON.parse(text.trim());
    } catch {
        return { accepted: false, evidenceCode: 'acceptance_failed', reason: 'Response was not a JSON array.' };
    }
    if (!Array.isArray(value) || value.length !== 3) {
        return { accepted: false, evidenceCode: 'acceptance_failed', reason: 'Response did not contain exactly A/B/C.' };
    }
    const byId = new Map(value.map(item => [item?.A ? 'A' : item?.B ? 'B' : item?.C ? 'C' : item?.id, item]).filter(([key]) => key));
    const expected = {
        A: 'CodeFastApiSpecialist',
        B: 'CodeDatabaseORMGenerator',
        C: null
    };
    const cCase = value.find(item => item?.id === 'C' || item?.case === 'C' || item?.C);
    for (const item of value) {
        if (!item || typeof item !== 'object') return { accepted: false, evidenceCode: 'acceptance_failed', reason: 'A routing entry was not an object.' };
    }
    // Accept the fixed answer in either conventional lower-case or exact A/B/C object forms.
    const normalized = {};
    for (const item of value) {
        const id = item.id || item.case || item.label;
        if (typeof id === 'string') normalized[id.toUpperCase()] = item;
    }
    if (Object.keys(normalized).length !== 3) {
        return { accepted: false, evidenceCode: 'acceptance_failed', reason: 'Response did not identify exactly A, B, and C.' };
    }
    for (const id of ['A', 'B', 'C']) {
        const item = normalized[id];
        const status = typeof item.status === 'string' ? item.status.toLowerCase() : '';
        if (item.agent !== expected[id] && item.agent !== null) {
            return { accepted: false, evidenceCode: 'incorrect', reason: `${id} routed to the wrong agent or shape.` };
        }
        if (id === 'C') {
            if (item.agent !== null || status !== 'needs_input' && status !== 'needs-input') {
                return { accepted: false, evidenceCode: 'incorrect', reason: 'C did not preserve NEEDS_INPUT routing.' };
            }
        } else if (item.agent !== expected[id]) {
            return { accepted: false, evidenceCode: 'incorrect', reason: `${id} did not route to ${expected[id]}.` };
        }
    }
    return { accepted: true, evidenceCode: 'acceptance_passed', reason: 'Routing JSON matched the fixed rubric.' };
}

function makeCallId() {
    return crypto.randomBytes(16).toString('hex');
}

function buildEvaluationChatMessages(prompt, vscodeApi) {
    if (!vscodeApi || !vscodeApi.LanguageModelChatMessage || typeof vscodeApi.LanguageModelChatMessage.User !== 'function') {
        throw new Error('VS Code LanguageModelChatMessage.User is unavailable.');
    }
    return [vscodeApi.LanguageModelChatMessage.User(prompt)];
}

async function normalizeSendRequestResponse(runtimeResponse) {
    try {
        if (!runtimeResponse || typeof runtimeResponse !== 'object') {
            return { blocked: 'invalid_response' };
        }
        const text = runtimeResponse.text;
        if (!text || typeof text !== 'object' || typeof text[Symbol.asyncIterator] !== 'function') {
            return { blocked: 'invalid_response' };
        }

        let normalized = '';
        for await (const chunk of text) {
            if (typeof chunk !== 'string') return { blocked: 'invalid_response' };
            normalized += chunk;
        }
        return { text: normalized };
    } catch {
        return { blocked: 'invalid_response' };
    }
}

function resolvedIdentity(model, runtimeResponse) {
    if (!model || typeof model !== 'object') return undefined;
    const sources = [
        runtimeResponse,
        runtimeResponse?.metadata,
        runtimeResponse?._metadata,
        model.metadata,
        model._metadata
    ].filter(source => source && typeof source === 'object');
    for (const source of sources) {
        const metadata = source.metadata || source._metadata || source;
        const id = metadata.resolvedModelId || metadata.resolvedModel?.id || metadata.modelId;
        const vendor = metadata.resolvedVendor || metadata.resolvedModel?.vendor;
        if (typeof id === 'string' && id
            && typeof vendor === 'string' && vendor) {
            return { id, vendor };
        }
    }
    return undefined;
}

const normalizeMockRuntimeResponse = normalizeSendRequestResponse;
const normalizeRuntimeResponseText = normalizeSendRequestResponse;

module.exports = {
    BACKEND_ROUTING_PROMPT,
    CANDIDATE_REJECTIONS_KEY,
    REJECTION_STORAGE_KEY: CANDIDATE_REJECTIONS_KEY,
    plainTextControlPrompt,
    acceptBackendRoutingResponse,
    candidateKey,
    normalizeCandidateRejections,
    normalizeRejections: normalizeCandidateRejections,
    listCandidateRejections,
    listRejections: listCandidateRejections,
    findCandidateRejection,
    rejectCandidateRejection,
    normalizeCandidateRejectionState: normalizeCandidateRejections,
    rejectCandidate: rejectCandidateRejection,
    clearCandidateRejection,
    clearRejection: clearCandidateRejection,
    classifyBlocked,
    classifyTechnicalConfiguration,
    classifyProviderBoundary,
    classifyTrial,
    summarizeModelCoverage,
    classifyEvaluationError,
    summarizeEvaluationTrials,
    fixedPilotTasks,
    makeCallId,
    normalizeSendRequestResponse,
    normalizeMockRuntimeResponse,
    normalizeRuntimeResponseText,
    buildEvaluationChatMessages,
    evaluationCandidates,
    pairTwoTrials,
    resolvedIdentity
};
