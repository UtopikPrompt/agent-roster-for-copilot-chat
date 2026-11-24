const { isProviderEnabled } = require('./provider-availability');

const PRICE_SNAPSHOT_DATE = '2026-11-16';

const MODEL_PRICES = {
    claudefable5: [1000, 5000],
    claudefable51: [1000, 5000],
    claudefable52: [800, 4000],
    claudehaiku45: [100, 500],
    claudehaiku55: [10, 50],
    claudeopus48: [500, 2500],
    claudeopus48fastmode: [1000, 5000],
    claudeopus5: [500, 2500],
    claudeopus55: [400, 2000],
    claudesonnet5: [200, 1000],
    claudesonnet55: [200, 1000],
    gemini38flash: [75, 375],
    gemini4argon: [200, 1000],
    gemini4carbon: [200, 1000],
    gemini4hydrogen: [150, 750],
    gpt52: [175, 1400],
    gpt53codex: [175, 1400],
    gpt56luna: [20, 120],
    gpt56sol: [400, 2000],
    gpt56terra: [200, 1200],
    gpt6astra: [1000, 5000],
    gpt6luna: [10, 50],
    gpt6sol: [200, 1000],
    gpt61sol: [200, 1000],
    gpt61terra: [100, 500],
    grok46: [100, 600],
    grok47: [200, 600],
    kimik3: [300, 1500],
    maicode11flash: [20, 120]
};

const ALIASES = {
    claudeopus48fastmodepreview: 'claudeopus48fastmode',
    claudeopus48fast: 'claudeopus48fastmode',
    gemini38flashpreview: 'gemini38flash',
    maicode11flashpreview: 'maicode11flash'
};

function normalizeModelName(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/preview/g, '')
        .replace(/[^a-z0-9]/g, '');
}

function classifyPrice(...rates) {
    const knownRates = rates.filter(rate => Number.isFinite(rate) && rate >= 0);
    if (knownRates.length === 0) return 'unpriced';
    const highestRate = Math.max(...knownRates);
    if (highestRate <= 150) return 'low';
    if (highestRate <= 1000) return 'medium';
    return 'high';
}

function getModelPricing(model) {
    const nativeInputCost = Number.isFinite(model?.inputCost) ? model.inputCost : null;
    const nativeOutputCost = Number.isFinite(model?.outputCost) ? model.outputCost : null;
    const nativeCacheCost = Number.isFinite(model?.cacheCost) ? model.cacheCost : null;
    const nativeCacheWriteCost = Number.isFinite(model?.cacheWriteCost) ? model.cacheWriteCost : null;
    const nativePriceCategory = String(model?.priceCategory || '').toLowerCase();
    const knownNativeCategory = ['low', 'medium', 'high'].includes(nativePriceCategory) ? nativePriceCategory : null;
    if (knownNativeCategory || [nativeInputCost, nativeOutputCost, nativeCacheCost, nativeCacheWriteCost].some(rate => rate !== null)) {
        return {
            inputCost: nativeInputCost,
            outputCost: nativeOutputCost,
            cacheCost: nativeCacheCost,
            cacheWriteCost: nativeCacheWriteCost,
            budgetClass: knownNativeCategory || classifyPrice(nativeInputCost, nativeOutputCost, nativeCacheCost, nativeCacheWriteCost),
            source: 'vscode',
            snapshotDate: null
        };
    }

    const keys = [model?.name, model?.family, model?.id?.split('/').pop()]
        .map(normalizeModelName)
        .filter(Boolean);
    const key = keys.map(candidate => ALIASES[candidate] || candidate).find(candidate => MODEL_PRICES[candidate]);

    if (!key) {
        return {
            inputCost: null,
            outputCost: null,
            cacheCost: null,
            cacheWriteCost: null,
            budgetClass: 'unpriced',
            source: 'unpriced',
            snapshotDate: PRICE_SNAPSHOT_DATE
        };
    }

    const [inputCost, outputCost] = MODEL_PRICES[key];
    return {
        inputCost,
        outputCost,
        cacheCost: null,
        cacheWriteCost: null,
        budgetClass: classifyPrice(inputCost, outputCost),
        source: 'snapshot',
        snapshotDate: PRICE_SNAPSHOT_DATE
    };
}

function isCopilotCloudVendor(vendor) {
    return vendor === 'copilot' || vendor === 'copilotcli';
}

function selectModelVendors(models, localModelVendors) {
    const localVendors = new Set(localModelVendors.filter(vendor => typeof vendor === 'string' && !isCopilotCloudVendor(vendor)));
    return models.filter(model => isCopilotCloudVendor(model.vendor) || localVendors.has(model.vendor));
}

function getLocalPricing() {
    return {
        inputCost: 0,
        outputCost: 0,
        cacheCost: null,
        cacheWriteCost: null,
        budgetClass: 'low',
        source: 'local',
        snapshotDate: null
    };
}

function getSelectionPricing(model, localModelVendors) {
    return !isCopilotCloudVendor(model.vendor) && localModelVendors.includes(model.vendor)
        ? getLocalPricing() : getModelPricing(model);
}

function modelKey(model) {
    return JSON.stringify([model.vendor, model.id]);
}

function getCapabilityTier(model, options = {}) {
    const key = modelKey(model);
    const tiers = options.capabilityTiers || options.localTiers || {};
    const tier = String(tiers[key] || 'unrated').toLowerCase();
    return ['unrated', 'simple', 'standard', 'complex', 'high'].includes(tier) ? tier : 'unrated';
}

function modelKind(model, localModelVendors, classifications = {}, providerTypes = {}) {
    if (isCopilotCloudVendor(model.vendor)) return 'cloud';
    const explicit = classifications[modelKey(model)];
    if (['cloud', 'local'].includes(explicit)) return explicit;
    if (['cloud', 'local', 'unknown'].includes(providerTypes[model.vendor])) return providerTypes[model.vendor];
    return localModelVendors.includes(model.vendor) ? 'local' : 'unknown';
}

function modelClassification(model, localModelVendors, classifications = {}, providerTypes = {}) {
    if (classifications[modelKey(model)] === 'excluded') return 'excluded';
    const kind = modelKind(model, localModelVendors, classifications, providerTypes);
    return kind === 'unknown' ? 'excluded' : kind;
}

function isModelSelected(model, localModelVendors, classifications = {}, selections = {}, providerTypes = {}) {
    const selected = selections[modelKey(model)];
    return typeof selected === 'boolean' ? selected : modelClassification(model, localModelVendors, classifications, providerTypes) !== 'excluded';
}

function hasSelectedLocalModel(models, policy) {
    return models.some(model => modelKind(model, policy.localModelVendors, policy.classifications, policy.providerTypes) === 'local'
        && isProviderEnabled(model.vendor, policy.providerAvailability)
        && isModelSelected(model, policy.localModelVendors, policy.classifications, policy.selections, policy.providerTypes));
}

function effectiveModelScope(models, policy) {
    if (policy.scope === 'local') return 'local';
    return hasSelectedLocalModel(models, policy) ? policy.scope : 'cloud';
}

function getInventorySummary(models, policy) {
    const selected = models.filter(model => isProviderEnabled(model.vendor, policy.providerAvailability)
        && isModelSelected(model, policy.localModelVendors, policy.classifications, policy.selections, policy.providerTypes));
    const localModels = selected.filter(model => modelKind(model, policy.localModelVendors, policy.classifications, policy.providerTypes) === 'local');
    return {
        scope: effectiveModelScope(models, policy),
        hasLocal: localModels.length > 0,
        cloudCount: selected.filter(model => modelKind(model, policy.localModelVendors, policy.classifications, policy.providerTypes) === 'cloud').length,
        localCount: localModels.length,
        unknownCount: selected.filter(model => modelKind(model, policy.localModelVendors, policy.classifications, policy.providerTypes) === 'unknown').length,
        unratedLocalCount: localModels.filter(model => getCapabilityTier(model, policy) === 'unrated').length
    };
}

function selectModels(models, localModelVendors, classifications, scope, options = {}) {
    return models.filter(model => {
        const kind = modelKind(model, localModelVendors, classifications, options.providerTypes);
        if (!isProviderEnabled(model.vendor, options.providerAvailability)) return false;
        if (!isModelSelected(model, localModelVendors, classifications, options.selections, options.providerTypes) || kind === 'unknown') return false;
        if (scope === 'cloud' || scope === 'local') {
            if (kind !== scope) return false;
        }
        if (options.taskCategory) {
            const tier = getCapabilityTier(model, options);
            const task = options.taskCategory;
            const rank = { unrated: 0, simple: 1, standard: 2, complex: 3, high: 4 };
            const required = { simple: 0, standard: 2, complex: 3 }[task];
            if (typeof required === 'number' && rank[tier] < required) return false;
        }
        return true;
    });
}

function getManagedPricing(model, localModelVendors, classifications, providerTypes, manualPriceTiers = {}) {
    if (modelKind(model, localModelVendors, classifications, providerTypes) === 'local') {
        return getLocalPricing();
    }
    const pricing = getModelPricing(model);
    const manualTier = manualPriceTiers[modelKey(model)];
    if (pricing.budgetClass === 'unpriced' && ['low', 'medium', 'high'].includes(manualTier)) {
        return { ...pricing, budgetClass: manualTier, source: 'manual', snapshotDate: null };
    }
    return pricing;
}

module.exports = { PRICE_SNAPSHOT_DATE, classifyPrice, effectiveModelScope, getCapabilityTier, getInventorySummary, getManagedPricing, getModelPricing, getSelectionPricing, hasSelectedLocalModel, isCopilotCloudVendor, isModelSelected, modelClassification, modelKey, modelKind, normalizeModelName, selectModels, selectModelVendors };