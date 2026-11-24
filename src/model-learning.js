const ROLES = ['advisor', 'coding', 'documentation', 'infrastructure', 'review'];
const TASK_CATEGORIES = ['simple', 'standard', 'complex'];
const ACTIVITIES = ['advise', 'implement', 'analyze', 'review', 'document', 'operate'];
const DOMAINS = ['coding', 'business', 'documentation-governance', 'infrastructure', 'cross-domain'];
const OUTCOMES = ['success', 'failure'];
const FAILURE_CODES = ['incorrect', 'incomplete', 'acceptance_failed', 'unsafe'];
const MAX_RECORDS = 1000;
const EXPLORE_WEIGHT = { simple: 0.35, standard: 0.24, complex: 0.12 };

function emptyScorecard() {
    return { schemaVersion: 1, records: [] };
}

function normalizeScorecard(value) {
    const records = Array.isArray(value?.records) ? value.records : [];
    const migratedRecords = records.map(record => record?.domain === 'github-workflow'
        ? { ...record, domain: 'documentation-governance' }
        : record);
    return {
        schemaVersion: 2,
        records: migratedRecords.filter(record => record
            && (isLearningContext(record) || (ROLES.includes(record.role) && TASK_CATEGORIES.includes(record.taskCategory)))
            && typeof record.modelId === 'string'
            && (typeof record.vendor === 'string' || record.vendor === null || record.vendor === undefined)
            && OUTCOMES.includes(record.outcome)
            && (record.outcome === 'success'
                ? record.evidenceCode === 'acceptance_passed'
                : FAILURE_CODES.includes(record.evidenceCode))
            && typeof record.recordedAt === 'string')
            .slice(-MAX_RECORDS)
    };
}

function recordOutcome(scorecardValue, input) {
    const contextual = ['activity', 'domain', 'difficulty'].some(key => input[key] !== undefined);
    if (!contextual && !ROLES.includes(input.role)) throw new TypeError('Unknown model-learning role.');
    if (contextual && (!ACTIVITIES.includes(input.activity) || !DOMAINS.includes(input.domain) 
        || !TASK_CATEGORIES.includes(input.difficulty))) {
        throw new TypeError('Unknown model-learning activity or domain.');
    }
    if (!contextual && !TASK_CATEGORIES.includes(input.taskCategory)) throw new TypeError('Unknown task difficulty.');
    if (typeof input.modelId !== 'string' || input.modelId.length === 0 || input.modelId.length > 300) {
        throw new TypeError('A requested model ID is required.');
    }
    if (input.callId !== undefined && (typeof input.callId !== 'string' || input.callId.length === 0 || input.callId.length > 100)) {
        throw new TypeError('Call ID must be a non-empty string of at most 100 characters.');
    }
    if (!OUTCOMES.includes(input.outcome)) throw new TypeError('Outcome must be success or failure.');
    if (input.outcome === 'success' && input.evidenceCode !== 'acceptance_passed') {
        throw new TypeError('Success requires verified acceptance checks.');
    }
    if (input.outcome === 'failure' && !FAILURE_CODES.includes(input.evidenceCode)) {
        throw new TypeError('Failure requires an objective model-quality failure code.');
    }
    if (input.metrics !== undefined && (!input.metrics || typeof input.metrics !== 'object'
        || Array.isArray(input.metrics)
        || Object.keys(input.metrics).some(key => !['durationMs', 'costUsd'].includes(key))
        || Object.entries(input.metrics).some(([key, value]) => !Number.isFinite(value) || value < 0
            || (key === 'durationMs' && value > 604800000) || (key === 'costUsd' && value > 1000000)))) {
        throw new TypeError('Metrics must contain only non-negative measured durationMs or costUsd values.');
    }

    const scorecard = normalizeScorecard(scorecardValue);
    const record = {
        ...(contextual ? {
            activity: input.activity,
            domain: input.domain,
            difficulty: input.difficulty
        } : {
            role: input.role,
            taskCategory: input.taskCategory
        }),
        modelId: input.modelId,
        ...(input.vendor !== undefined ? { vendor: input.vendor } : {}),
        outcome: input.outcome,
        evidenceCode: input.evidenceCode,
        ...(contextual && input.callId ? { callId: input.callId } : {}),
        ...(contextual && typeof input.agent === 'string' && input.agent.length <= 100 ? { agent: input.agent } : {}),
        ...(input.metrics && Object.keys(input.metrics).length ? { metrics: { ...input.metrics } } : {}),
        ...(typeof input.worker === 'string' && input.worker.length <= 100 ? { worker: input.worker } : {}),
        recordedAt: new Date().toISOString()
    };
    return normalizeScorecard({ records: [...scorecard.records, record] });
}

function isLearningContext(value) {
    return Boolean(value && typeof value === 'object'
        && ACTIVITIES.includes(value.activity)
        && DOMAINS.includes(value.domain)
        && TASK_CATEGORIES.includes(value.difficulty));
}

function excludeUnavailableModels(models, { excludedModels = [], excludedProviders = [] } = {}) {
    if (!Array.isArray(excludedModels) || excludedModels.length > 20
        || excludedModels.some(model => !model || typeof model.id !== 'string' || !model.id || typeof model.vendor !== 'string' || !model.vendor)) {
        throw new TypeError('Excluded models must be an array of at most 20 model ID and vendor pairs.');
    }
    if (!Array.isArray(excludedProviders) || excludedProviders.length > 20
        || excludedProviders.some(vendor => typeof vendor !== 'string' || !vendor)) {
        throw new TypeError('Excluded providers must be an array of at most 20 vendor IDs.');
    }
    const modelKeys = new Set(excludedModels.map(model => JSON.stringify([model.vendor, model.id])));
    const providers = new Set(excludedProviders);
    return models.filter(model => !providers.has(model.vendor) && !modelKeys.has(JSON.stringify([model.vendor, model.id])));
}

function legacyDomain(role) {
    return {
        coding: 'coding',
        documentation: 'documentation-governance',
        infrastructure: 'infrastructure',
        review: 'cross-domain'
    }[role];
}

function contextWeight(record, context) {
    if (!context.contextual) {
        return record.role === context.role && record.taskCategory === context.difficulty ? 1 : 0;
    }
    if (!isLearningContext(record)) {
        if (record.role === 'advisor') return context.activity === 'advise' ? 0.1 : 0;
        return legacyDomain(record.role) === context.domain ? 0.1 : 0;
    }
    if (record.activity === context.activity && record.domain === context.domain) {
        return record.difficulty === context.difficulty ? 1 : 0.5;
    }
    if (record.activity === context.activity || record.domain === context.domain) return 0.2;
    return 0;
}

function averageMetric(records, key, context) {
    const values = records
        .filter(record => Number.isFinite(record.metrics?.[key]))
        .map(record => ({ value: record.metrics[key], weight: contextWeight(record, context) }));
    const totalWeight = values.reduce((total, entry) => total + entry.weight, 0);
    return totalWeight ? values.reduce((total, entry) => total + entry.value * entry.weight, 0) / totalWeight : null;
}

// Soft ordering among eligible candidates; manual selections still take precedence.
function normalizeWorkspacePreference(value) {
    const vendor = typeof value?.preferredProvider === 'string' ? value.preferredProvider.trim() : '';
    const modelId = typeof value?.preferredModel === 'string' ? value.preferredModel.trim() : '';
    if (!vendor && !modelId) return null;
    return vendor ? { vendor, modelId: modelId || null } : { invalid: true };
}

function matchesWorkspacePreference(candidate, preference) {
    return Boolean(preference && !preference.invalid
        && candidate.vendor === preference.vendor
        && (!preference.modelId || candidate.id === preference.modelId));
}

function describeWorkspacePreference(preference, candidates, recommended) {
    if (!preference) return { status: 'not-configured' };
    if (preference.invalid) return { status: 'invalid' };
    const eligibleMatch = candidates.some(candidate => matchesWorkspacePreference(candidate, preference));
    const status = !eligibleMatch ? 'no-eligible-match'
        : recommended && matchesWorkspacePreference(recommended, preference) ? 'applied' : 'not-selected';
    return { status, vendor: preference.vendor, modelId: preference.modelId };
}

function getModelRecommendations(scorecardValue, options) {
    const { role, models, getPricing, getModelKind, getCapabilityTier, preference } = options;
    const workspacePreference = normalizeWorkspacePreference(options.workspacePreference);
    const contextual = isLearningContext(options);
    const difficulty = contextual ? options.difficulty : options.taskCategory;
    const context = {
        contextual,
        activity: options.activity,
        domain: options.domain,
        difficulty,
        role
    };
    const scorecard = normalizeScorecard(scorecardValue);
    const historyForContext = scorecard.records.filter(record => contextWeight(record, context) > 0);
    const candidates = models.map(model => {
        const history = scorecard.records.filter(record => (
            record.modelId === model.id && 
            (record.vendor === undefined || record.vendor === model.vendor || record.vendor === null)
        ) && contextWeight(record, context) > 0);
        const exactSamples = history.filter(record => contextWeight(record, context) === 1).length;
        const effectiveSamples = history.reduce((total, record) => total + contextWeight(record, context), 0);
        const weightedSuccesses = history.reduce((total, record) => total + (record.outcome === 'success' ? contextWeight(record, context) : 0), 0);
        const weightedFailures = effectiveSamples - weightedSuccesses;
        const successes = history.filter(record => record.outcome === 'success').length;
        const failures = history.length - successes;
        const pricing = getPricing(model);
        return {
            id: model.id,
            name: model.name,
            vendor: model.vendor,
            modelArgument: `${model.name} (${model.vendor})`,
            family: model.family,
            kind: getModelKind ? getModelKind(model) : undefined,
            capabilityTier: getCapabilityTier ? getCapabilityTier(model) : 'unrated',
            pricing,
            successes,
            failures,
            samples: exactSamples,
            pooledSamples: history.length - exactSamples,
            effectiveSamples,
            weightedSuccesses,
            weightedFailures,
            score: (weightedSuccesses + 1) / (effectiveSamples + 2),
            evidenceSource: exactSamples && history.length > exactSamples ? 'mixed' : exactSamples ? 'exact' : history.length ? 'pooled' : 'none',
            averageDurationMs: averageMetric(history, 'durationMs', context),
            averageCostUsd: averageMetric(history, 'costUsd', context),
            exploration: Math.min(1, Math.sqrt(Math.log(historyForContext.length + models.length + 1) / (effectiveSamples + 1))),
            cost: priceOf(pricing)
        };
    });

    for (const candidate of candidates) {
        const tierRank = { unrated: 0, simple: 1, standard: 2, complex: 3, high: 4 };
        candidate.utility = candidate.score + EXPLORE_WEIGHT[difficulty] * candidate.exploration
            + 0.01 * (tierRank[candidate.capabilityTier] || 0);
        candidate.selectionMode = candidate.samples >= 2 ? 'learned' : candidate.effectiveSamples >= 4 ? 'pooled' : 'explore';
    }
    candidates.sort((left, right) =>
        (difficulty === 'complex' ? Number(['learned', 'pooled'].includes(right.selectionMode)) - Number(['learned', 'pooled'].includes(left.selectionMode)) : 0)
        || (workspacePreference ? Number(matchesWorkspacePreference(right, workspacePreference)) - Number(matchesWorkspacePreference(left, workspacePreference)) : 0)
        || (preference ? Number(right.kind === preference) - Number(left.kind === preference) : 0)
        || right.utility - left.utility
        || right.score - left.score
        || left.id.localeCompare(right.id));

    const learnedRecommendation = candidates.find(candidate =>
        difficulty !== 'complex' || ['learned', 'pooled'].includes(candidate.selectionMode));
    const manualSelection = contextual && options.manualSelection ? options.manualSelection : null;
    const manualCandidate = manualSelection && candidates.find(candidate => candidate.id === manualSelection.modelId
        && candidate.vendor === manualSelection.vendor);
    const manualUnavailable = Boolean(manualSelection && !manualCandidate);
    if (manualCandidate) {
        manualCandidate.selectionMode = 'manual';
        candidates.splice(candidates.indexOf(manualCandidate), 1);
        candidates.unshift(manualCandidate);
    }
    const recommended = manualSelection
        ? manualUnavailable ? undefined : manualCandidate
        : candidates.find(candidate =>
            difficulty !== 'complex' || ['learned', 'pooled'].includes(candidate.selectionMode));
    return {
        ...(contextual ? { activity: context.activity, domain: context.domain, difficulty } : { role, taskCategory: difficulty }),
        recommendedModelId: recommended?.id || null,
        recommendedVendor: recommended?.vendor || null,
        learnedRecommendedModelId: learnedRecommendation?.id || null,
        learnedRecommendedVendor: learnedRecommendation?.vendor || null,
        manualSelection,
        selectionMode: manualSelection ? manualUnavailable ? 'manual-unavailable' : 'manual' : recommended?.selectionMode || 'fallback',
        workspacePreference: describeWorkspacePreference(workspacePreference, candidates, recommended),
        candidates
    };
}

function compactModelRecommendations(result) {
    const eligible = result.candidates;

    const selected = [];
    const keys = new Set();
    const recommendedCandidate = eligible.find(candidate => candidate.id === result.recommendedModelId
        && (candidate.vendor === result.recommendedVendor || result.recommendedVendor === null || result.recommendedVendor === undefined));
    const learnedCandidate = eligible.find(candidate => candidate.id === result.learnedRecommendedModelId
        && (candidate.vendor === result.learnedRecommendedVendor || result.learnedRecommendedVendor === null || result.learnedRecommendedVendor === undefined));
    const add = candidate => {
        if (!candidate) return;
        const key = JSON.stringify([candidate.vendor, candidate.id]);
        if (keys.has(key)) return;
        keys.add(key);
        selected.push(candidate);
    };
    add(recommendedCandidate);
    add(learnedCandidate);
    eligible.slice(0, 3).forEach(add);
    const preferredKind = eligible[0]?.kind;
    if (preferredKind) add(eligible.find(candidate => candidate.kind && candidate.kind !== preferredKind));
    for (const kind of ['local', 'cloud']) {
        add(eligible.find(candidate => candidate.kind === kind && candidate.selectionMode === 'learned'));
    }
    for (const modelArgument of ['Claude Haiku 5.5 (copilot)', 'Claude Sonnet 5.5 (copilot)']) {
        add(eligible.find(candidate => candidate.modelArgument === modelArgument));
    }
    const rank = new Map(eligible.map((candidate, index) => [candidate, index]));
    selected.sort((left, right) => rank.get(left) - rank.get(right));
    if (recommendedCandidate) selected.unshift(...selected.splice(selected.indexOf(recommendedCandidate), 1));
    return {
        role: result.role,
        taskCategory: result.taskCategory,
        recommendedModelId: result.recommendedModelId,
        recommendedVendor: result.recommendedVendor,
        learnedRecommendedModelId: result.learnedRecommendedModelId,
        learnedRecommendedVendor: result.learnedRecommendedVendor,
        manualSelection: result.manualSelection,
        selectionMode: result.selectionMode,
        workspacePreference: result.workspacePreference,
        activity: result.activity,
        domain: result.domain,
        difficulty: result.difficulty,
        candidates: selected.map(candidate => ({
            id: candidate.id,
            name: candidate.name,
            vendor: candidate.vendor,
            modelArgument: candidate.modelArgument,
            kind: candidate.kind,
            capabilityTier: candidate.capabilityTier,
            selectionMode: candidate.selectionMode,
            samples: candidate.samples,
            pooledSamples: candidate.pooledSamples,
            effectiveSamples: Number(candidate.effectiveSamples.toFixed(2)),
            successes: candidate.successes,
            failures: candidate.failures,
            score: Number(candidate.score.toFixed(3)),
            evidenceSource: candidate.evidenceSource,
            averageDurationMs: candidate.averageDurationMs,
            averageCostUsd: candidate.averageCostUsd,
            pricing: { budgetClass: candidate.pricing.budgetClass, source: candidate.pricing.source }
        })),
        eligibleCount: eligible.length,
        unpricedCount: result.candidates.filter(candidate => !Number.isFinite(candidate.cost)).length,
        truncated: selected.length < eligible.length
    };
}

function getLearningDashboard(scorecardValue, models, getPricing, options = {}) {
    const scorecard = normalizeScorecard(scorecardValue);
    return ROLES.flatMap(role => TASK_CATEGORIES.map(taskCategory => {
        const recommendation = getModelRecommendations(scorecard, {
            role, taskCategory, models: options.getModelsForTask ? options.getModelsForTask(taskCategory) : models,
            getPricing, getModelKind: options.getModelKind, getCapabilityTier: options.getCapabilityTier, preference: options.preference, workspacePreference: options.workspacePreference
        });
        const sampleCount = scorecard.records.filter(record => record.role === role && record.taskCategory === taskCategory).length;
        return {
            role,
            taskCategory,
            sampleCount,
            recommendedModelId: recommendation.recommendedModelId,
            eligibleCount: recommendation.candidates.length,
            candidates: recommendation.candidates.slice(0, 3)
        };
    }));
}

function getContextualLearningDashboard(scorecardValue, models, getPricing, options = {}) {
    const scorecard = normalizeScorecard(scorecardValue);
    return ACTIVITIES.flatMap(activity => DOMAINS.flatMap(domain => TASK_CATEGORIES.map(difficulty => {
        const recommendation = getModelRecommendations(scorecard, {
            activity, domain, difficulty, models: options.getModelsForTask ? options.getModelsForTask(difficulty) : models,
            getPricing, getModelKind: options.getModelKind, getCapabilityTier: options.getCapabilityTier, preference: options.preference, workspacePreference: options.workspacePreference,
            manualSelection: options.getManualSelection ? options.getManualSelection({ activity, domain, difficulty }) : undefined
        });
        const exactSamples = scorecard.records.filter(record => contextWeight(record, { contextual: true, activity, domain, difficulty }) === 1).length;
        const pooledSamples = scorecard.records.filter(record => contextWeight(record, { contextual: true, activity, domain, difficulty }) > 0
            && contextWeight(record, { contextual: true, activity, domain, difficulty }) < 1).length;
        return {
            activity,
            domain,
            difficulty,
            sampleCount: exactSamples,
            pooledSampleCount: pooledSamples,
            recommendedModelId: recommendation.recommendedModelId,
            recommendedVendor: recommendation.recommendedVendor,
            learnedRecommendedModelId: recommendation.learnedRecommendedModelId,
            learnedRecommendedVendor: recommendation.learnedRecommendedVendor,
            manualSelection: recommendation.manualSelection,
            selectionMode: recommendation.selectionMode,
            eligibleCount: recommendation.candidates.length,
            candidates: recommendation.candidates.slice(0, 3)
        };
    })));
}

function priceOf(pricing) {
    const rates = [pricing?.inputCost, pricing?.outputCost, pricing?.cacheCost, pricing?.cacheWriteCost]
        .filter(rate => Number.isFinite(rate) && rate >= 0);
    if (rates.length) return Math.max(...rates);
    return { low: 75, medium: 575, high: 1001 }[pricing?.budgetClass] ?? Number.POSITIVE_INFINITY;
}

function hasFinitePrice(pricing) {
    return Number.isFinite(priceOf(pricing));
}


module.exports = {
    ACTIVITIES,
    compactModelRecommendations,
    DOMAINS,
    excludeUnavailableModels,
    FAILURE_CODES,
    hasFinitePrice,
    OUTCOMES,
    ROLES,
    TASK_CATEGORIES,
    emptyScorecard,
    getLearningDashboard,
    getContextualLearningDashboard,
    getModelRecommendations,
    normalizeScorecard,
    recordOutcome,
};