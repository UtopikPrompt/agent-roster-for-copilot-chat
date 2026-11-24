const CAPABILITY_TIERS = ['unrated', 'simple', 'standard', 'complex', 'high'];
const EVIDENCE_SOURCES = ['Epoch ECI', 'Artificial Analysis', 'Stanford AI Index', 'HELM', 'Aro Local Evaluation'];
const EVIDENCE_STATUSES = ['verified', 'stale', 'unknown'];
const CONFIDENCE_LEVELS = ['exact', 'provider', 'vendor', 'model'];

function modelKey(model) {
    return JSON.stringify([model?.vendor || '', model?.id || model?.modelId || '']);
}

function normalizeTier(value) {
    const tier = String(value || '').trim().toLowerCase();
    return CAPABILITY_TIERS.includes(tier) ? tier : 'unrated';
}

function normalizeBenchmarkDimensions(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const allowed = ['reasoning', 'coding', 'agents', 'vision', 'toolUse', 'context', 'multimodal'];
    const result = {};
    for (const dimension of allowed) {
        const entry = value[dimension];
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            const normalized = {};
            for (const field of ['score', 'percentile', 'rank']) {
                if (typeof entry[field] === 'number' && Number.isFinite(entry[field])) normalized[field] = entry[field];
            }
            if (Object.keys(normalized).length) result[dimension] = normalized;
        } else if (typeof entry === 'number' && Number.isFinite(entry)) {
            result[dimension] = { score: entry };
        }
    }
    return result;
}

function normalizeAlias(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const exactName = typeof value.exactName === 'string' ? value.exactName : '';
    const vendor = typeof value.vendor === 'string' ? value.vendor : '';
    const modelId = typeof value.modelId === 'string' ? value.modelId : '';
    if (!exactName && !vendor && !modelId) return null;
    return {
        ...(exactName ? { exactName } : {}),
        ...(vendor ? { vendor } : {}),
        ...(modelId ? { modelId } : {})
    };
}

function normalizeCapabilityEvidenceRecord(input) {
    if (!input || typeof input !== 'object') throw new TypeError('Capability evidence record is required.');
    const source = EVIDENCE_SOURCES.includes(input.source) ? input.source : null;
    if (!source) throw new TypeError('Unknown capability evidence source.');
    if (typeof input.sourceUrl !== 'string' || !/^https:\/\//i.test(input.sourceUrl.trim())) {
        throw new TypeError('Capability evidence requires an https source URL.');
    }
    if (typeof input.retrievedAt !== 'string' || !input.retrievedAt.trim()) {
        throw new TypeError('Capability evidence requires retrievedAt.');
    }
    if (typeof input.alias !== 'object' || !input.alias || typeof input.alias.vendor !== 'string' || typeof input.alias.modelId !== 'string') {
        throw new TypeError('Capability evidence requires an exact provider-qualified alias.');
    }
    const alias = normalizeAlias(input.alias);
    if (!alias?.vendor || !alias?.modelId) throw new TypeError('Capability evidence alias requires vendor and modelId.');
    const aliases = Array.isArray(input.aliases)
        ? input.aliases.map(normalizeAlias).filter(Boolean)
        : (input.aliases && typeof input.aliases === 'object' ? [normalizeAlias(input.aliases)].filter(Boolean) : []);
    if (!aliases.some(item => item.vendor === alias.vendor && item.modelId === alias.modelId)) aliases.unshift(alias);
    const status = EVIDENCE_STATUSES.includes(input.status) ? input.status : 'unknown';
    const confidence = CONFIDENCE_LEVELS.includes(input.confidence) ? input.confidence : 'model';
    const record = {
        source,
        sourceUrl: input.sourceUrl.trim(),
        retrievedAt: input.retrievedAt.trim(),
        ...(typeof input.sourceVersion === 'string' && input.sourceVersion.trim() ? { sourceVersion: input.sourceVersion.trim() } : {}),
        ...(typeof input.releaseDate === 'string' && input.releaseDate.trim() ? { releaseDate: input.releaseDate.trim() } : {}),
        alias,
        aliases,
        ...(typeof input.score === 'number' && Number.isFinite(input.score) ? { score: input.score } : {}),
        ...(typeof input.percentile === 'number' && Number.isFinite(input.percentile) ? { percentile: input.percentile } : {}),
        ...(typeof input.rank === 'number' && Number.isFinite(input.rank) ? { rank: input.rank } : {}),
        benchmarkDimensions: normalizeBenchmarkDimensions(input.benchmarkDimensions),
        confidence,
        status,
        normalizedCapabilityTierProposal: normalizeTier(input.normalizedCapabilityTierProposal),
        rationale: typeof input.rationale === 'string' ? input.rationale.trim() : ''
    };
    return record;
}

function normalizeEvidenceStore(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value.records : value;
    const records = Array.isArray(source) ? source : (source && typeof source === 'object' ? Object.values(source) : []);
    const byKey = new Map();
    for (const item of records) {
        try {
            const record = normalizeCapabilityEvidenceRecord(item);
            const key = JSON.stringify([record.alias.vendor, record.alias.modelId]);
            byKey.set(key, record);
        } catch (_) {}
    }
    return { schemaVersion: 1, records: Array.from(byKey.values()) };
}

function recordCapabilityEvidence(store, input) {
    const record = normalizeCapabilityEvidenceRecord(input);
    const state = normalizeEvidenceStore(store);
    const key = JSON.stringify([record.alias.vendor, record.alias.modelId]);
    const records = state.records.filter(existing => JSON.stringify([existing.alias.vendor, existing.alias.modelId]) !== key);
    records.push(record);
    return { schemaVersion: 1, records };
}

function exactAliasMatches(record, model) {
    if (!record || !model) return false;
    const vendor = typeof model.vendor === 'string' ? model.vendor : '';
    const modelId = typeof model.id === 'string' ? model.id : (typeof model.modelId === 'string' ? model.modelId : '');
    const exactName = typeof model.name === 'string' ? model.name : '';
    return record.aliases.some(alias => {
        if (alias.vendor && alias.vendor !== vendor) return false;
        if (alias.modelId && alias.modelId !== modelId) return false;
        if (alias.exactName && alias.exactName !== exactName) return false;
        return Boolean(alias.vendor && alias.modelId);
    });
}

function evidenceForModel(store, model) {
    const state = normalizeEvidenceStore(store);
    return state.records.filter(record => exactAliasMatches(record, model));
}

function highestVerifiedExternalTier(records) {
    let highest = 'unrated';
    const rank = { unrated: 0, simple: 1, standard: 2, complex: 3, high: 4 };
    for (const record of records || []) {
        if (record.status !== 'verified') continue;
        const proposal = normalizeTier(record.normalizedCapabilityTierProposal);
        if (rank[proposal] > rank[highest]) highest = proposal;
    }
    return highest;
}

function deriveCapabilityTier(input = {}) {
    const existing = normalizeTier(input.existingTier);
    if (input.providerBlocked || input.rejected || input.streamBlocked || input.controlBlocked) return existing;
    const local = input.localEvidence || {};
    if (Array.isArray(input.blockedEvidenceKinds) && input.blockedEvidenceKinds.some(kind => ['provider', 'stream', 'control', 'rejected'].includes(kind))) {
        return existing;
    }
    const externalHighest = highestVerifiedExternalTier(input.externalRecords);
    if (externalHighest === 'high') return 'high';

    const repeatedPasses = Array.isArray(local.repeatedPasses)
        ? local.repeatedPasses
        : (typeof local.repeatedPasses === 'number' ? Array.from({ length: local.repeatedPasses }, (_, index) => index) : []);
    const contexts = Array.isArray(local.contexts) ? local.contexts : repeatedPasses;
    const repeatedAcrossComplexTasks = repeatedPasses.length >= 2 && contexts.some(context => {
        const value = typeof context === 'object' ? JSON.stringify(context).toLowerCase() : String(context).toLowerCase();
        return value.includes('complex') || value.includes('coding') || value.includes('advisor');
    });
    if (repeatedAcrossComplexTasks && rankAtLeast(existing, 'complex')) return 'complex';
    if (local.repeatedPasses >= 2 || repeatedPasses.length >= 2 && repeatedAcrossComplexTasks) return 'complex';

    if (local.strictCompletedPasses > 0 || local.strictCompleted === true) return rankAtLeast(existing, 'standard') ? existing : 'standard';

    if (rankAtLeast(externalHighest, 'complex') && rankAtLeast(existing, 'complex')) return existing;
    if (rankAtLeast(externalHighest, 'simple') && rankAtLeast(externalHighest, existing)) return externalHighest;
    return existing;
}

function rankAtLeast(left, right) {
    const rank = { unrated: 0, simple: 1, standard: 2, complex: 3, high: 4 };
    return rank[normalizeTier(left)] >= rank[normalizeTier(right)];
}

module.exports = {
    CAPABILITY_TIERS,
    EVIDENCE_SOURCES,
    EVIDENCE_STATUSES,
    deriveCapabilityTier,
    evidenceForModel,
    exactAliasMatches,
    highestVerifiedExternalTier,
    modelKey,
    normalizeCapabilityEvidenceRecord,
    normalizeEvidenceStore,
    normalizeTier,
    recordCapabilityEvidence
};
