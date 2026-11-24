import assert from 'node:assert/strict';
import test from 'node:test';
import learningModule from '../src/model-learning.js';
import pricingModule from '../src/model-pricing.js';
import advisorPinning from '../src/advisor-pinning.js';
const { compactModelRecommendations, emptyScorecard, excludeUnavailableModels, getContextualLearningDashboard, getLearningDashboard, getModelRecommendations, normalizeScorecard, recordOutcome } = learningModule;
const getPricing = model => ({ inputCost: model.inputCost, outputCost: model.outputCost, budgetClass: model.budgetClass });

test('fallback exclusions distinguish an exact model from a whole provider', () => {
    const models = [
        { id: 'shared', vendor: 'copilot' },
        { id: 'shared', vendor: 'other-cloud' },
        { id: 'second', vendor: 'copilot' },
        { id: 'local', vendor: 'ollama' }
    ];
    const exact = excludeUnavailableModels(models, { excludedModels: [{ id: 'shared', vendor: 'copilot' }] });
    assert.deepEqual(exact.map(model => `${model.vendor}/${model.id}`), ['other-cloud/shared', 'copilot/second', 'ollama/local']);
    const provider = excludeUnavailableModels(models, { excludedProviders: ['copilot'] });
    assert.deepEqual(provider.map(model => `${model.vendor}/${model.id}`), ['other-cloud/shared', 'ollama/local']);
    assert.equal(models.length, 4);
    assert.throws(() => excludeUnavailableModels(models, { excludedProviders: Array(21).fill('copilot') }), /at most 20/);
    assert.throws(() => excludeUnavailableModels(models, { excludedModels: [{ id: 'shared' }] }), /model ID and vendor/);
});

test('compact recommendations retain the winner, learned and configured fallbacks without returning the full inventory', () => {
    const models = Array.from({ length: 60 }, (_, index) => ({
        id: `local-${index}`, name: `Local ${index}`, vendor: 'ollama', inputCost: 0, outputCost: 0
    }));
    models.push(
        { id: 'haiku', name: 'Claude Haiku 5.5', vendor: 'copilot', inputCost: 10, outputCost: 50 },
        { id: 'sonnet', name: 'Claude Sonnet 5.5', vendor: 'copilot', inputCost: 200, outputCost: 1000 },
        { id: 'unpriced', name: 'Unknown', vendor: 'copilot' }
    );
    let scorecard = emptyScorecard();
    for (let index = 0; index < 2; index += 1) {
        scorecard = recordOutcome(scorecard, { role: 'coding', taskCategory: 'simple', modelId: 'local-59', outcome: 'failure', evidenceCode: 'acceptance_failed' });
    }
    const result = getModelRecommendations(scorecard, {
        role: 'coding', taskCategory: 'simple', models, getPricing,
        getModelKind: model => model.vendor === 'ollama' ? 'local' : 'cloud', preference: 'local'
    });
    const compact = compactModelRecommendations(result);
    assert.equal(compact.recommendedModelId, result.recommendedModelId);
    assert.equal(compact.candidates[0].id, result.recommendedModelId);
    assert.ok(compact.candidates.some(candidate => candidate.id === 'local-59'));
    assert.ok(compact.candidates.some(candidate => candidate.id === 'haiku'));
    assert.ok(compact.candidates.some(candidate => candidate.id === 'sonnet'));
    assert.equal(compact.candidates.some(candidate => candidate.id === 'unpriced'), false);
    assert.ok(compact.candidates.length <= 8);
    assert.equal(compact.eligibleCount, 63);
    assert.equal(compact.unpricedCount, 1);
    assert.equal(compact.truncated, true);
    const originalRanks = compact.candidates.map(candidate => result.candidates.findIndex(original => original.id === candidate.id && original.vendor === candidate.vendor));
    assert.deepEqual(originalRanks, [...originalRanks].sort((left, right) => left - right));
    assert.ok(Buffer.byteLength(JSON.stringify(compact)) < 3500);
    assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(result)) / 3);
});

test('unknown price remains eligible for recommendation and evaluation selection', () => {
    const unknownModel = { id: 'unknown-price', name: 'Unknown Price', vendor: 'copilot' };
    const result = getModelRecommendations(emptyScorecard(), {
        role: 'coding', taskCategory: 'standard', models: [unknownModel],
        getPricing: model => pricingModule.getManagedPricing(model, [], {}, {}),
        getCapabilityTier: () => 'standard', getModelKind: () => 'cloud'
    });
    assert.equal(result.recommendedModelId, 'unknown-price');
    assert.equal(result.candidates[0].pricing.budgetClass, 'unpriced');
    assert.equal(result.candidates[0].pricing.source, 'unpriced');
});

test('compact recommendations report an empty or unpriced inventory honestly', () => {
    const result = getModelRecommendations(emptyScorecard(), {
        role: 'coding', taskCategory: 'simple', models: [{ id: 'unknown', vendor: 'copilot' }], getPricing
    });
    const compact = compactModelRecommendations(result);
    assert.equal(compact.recommendedModelId, 'unknown');
    assert.equal(compact.selectionMode, 'explore');
    assert.equal(compact.eligibleCount, 1);
    assert.equal(compact.unpricedCount, 1);
    assert.equal(compact.candidates[0].id, 'unknown');
    assert.equal(compact.truncated, false);
});

test('sidebar inventory summary counts only selected cloud and unrated local models', () => {
    const models = [
        { id: 'cloud', vendor: 'copilot' },
        { id: 'cli', vendor: 'copilotcli' },
        { id: 'local', vendor: 'ollama' },
        { id: 'disabled', vendor: 'ollama' }
    ];
    const policy = {
        scope: 'both', localModelVendors: ['ollama'], classifications: {}, providerTypes: {},
        selections: { [pricingModule.modelKey(models[3])]: false }, localTiers: {}
    };
    assert.deepEqual(pricingModule.getInventorySummary(models, policy), {
        scope: 'both', hasLocal: true, cloudCount: 2, localCount: 1, unknownCount: 0, unratedLocalCount: 1
    });
    policy.localTiers[pricingModule.modelKey(models[2])] = 'standard';
    assert.equal(pricingModule.getInventorySummary(models, policy).unratedLocalCount, 0);
    policy.selections[pricingModule.modelKey(models[2])] = false;
    assert.equal(pricingModule.getInventorySummary(models, policy).scope, 'cloud');
});

test('sidebar inventory summary ignores selected models from providers disabled by policy', () => {
    const models = [
        { id: 'cloud', vendor: 'copilot' },
        { id: 'local', vendor: 'ollama' }
    ];
    const policy = {
        scope: 'both', localModelVendors: ['ollama'], classifications: {}, providerTypes: {},
        selections: {}, localTiers: {}, providerAvailability: { mode: 'inherit', enabledProviders: [], disabledProviders: ['ollama'] }
    };
    assert.deepEqual(pricingModule.getInventorySummary(models, policy), {
        scope: 'cloud', hasLocal: false, cloudCount: 1, localCount: 0, unknownCount: 0, unratedLocalCount: 0
    });
});

test('Copilot and Copilot CLI remain cloud despite stored local overrides', () => {
    for (const vendor of ['copilot', 'copilotcli']) {
        const model = { id: 'model', vendor, inputCost: 10, outputCost: 50 };
        const classifications = { [pricingModule.modelKey(model)]: 'local' };
        assert.equal(pricingModule.modelKind(model, [vendor], classifications, { [vendor]: 'local' }), 'cloud');
        assert.equal(pricingModule.getManagedPricing(model, [vendor], classifications, { [vendor]: 'local' }).source, 'vscode');
        assert.equal(pricingModule.isModelSelected(model, [], {}, {}, {}), true);
    }
});

test('local scope availability depends on selected local models, not task eligibility', () => {
    const models = [{ id: 'local', vendor: 'ollama' }, { id: 'cloud', vendor: 'copilot' }];
    const policy = { scope: 'both', localModelVendors: ['ollama'], classifications: {}, selections: {}, providerTypes: {}, localTiers: {} };
    assert.equal(pricingModule.hasSelectedLocalModel(models, policy), true);
    assert.equal(pricingModule.effectiveModelScope(models, policy), 'both');
    assert.deepEqual(pricingModule.selectModels(models, policy.localModelVendors, {}, 'both', { ...policy, taskCategory: 'simple' }).map(model => model.id), ['local', 'cloud']);
    policy.selections[pricingModule.modelKey(models[0])] = false;
    assert.equal(pricingModule.hasSelectedLocalModel(models, policy), false);
    assert.equal(pricingModule.effectiveModelScope(models, policy), 'cloud');
    assert.equal(pricingModule.effectiveModelScope([], { ...policy, scope: 'local' }), 'local');
});

test('a manual price tier makes an unpriced cloud model eligible without inventing token rates', () => {
    const model = { id: 'new-model', name: 'New model', vendor: 'copilot' };
    const manualPriceTiers = { [pricingModule.modelKey(model)]: 'medium' };
    const pricing = pricingModule.getManagedPricing(model, [], {}, {}, manualPriceTiers);
    assert.equal(pricing.source, 'manual');
    assert.equal(pricing.budgetClass, 'medium');
    assert.equal(pricing.inputCost, null);
    assert.equal(pricing.outputCost, null);
    const result = getModelRecommendations(emptyScorecard(), {
        role: 'coding', taskCategory: 'simple', models: [model],
        getPricing: candidate => pricingModule.getManagedPricing(candidate, [], {}, {}, manualPriceTiers)
    });
    assert.equal(result.recommendedModelId, 'new-model');
    assert.equal(pricingModule.getManagedPricing({ ...model, inputCost: 10 }, [], {}, {}, manualPriceTiers).source, 'vscode');
    assert.equal(pricingModule.getManagedPricing(model, [], {}, {}, {}).budgetClass, 'unpriced');
});

test('local-first and cloud-first prefer eligible priced models and fall back when necessary', () => {
    const models = [
        { id: 'cloud', vendor: 'copilot', inputCost: 10, outputCost: 50 },
        { id: 'local', vendor: 'ollama', inputCost: 0, outputCost: 0 }
    ];
    const options = { role: 'coding', taskCategory: 'simple', models, getPricing, getModelKind: model => model.vendor === 'ollama' ? 'local' : 'cloud' };
    assert.equal(getModelRecommendations(emptyScorecard(), { ...options, preference: 'local' }).recommendedModelId, 'local');
    assert.equal(getModelRecommendations(emptyScorecard(), { ...options, preference: 'cloud' }).recommendedModelId, 'cloud');
    assert.equal(getModelRecommendations(emptyScorecard(), { ...options, models: [models[0]], preference: 'local' }).recommendedModelId, 'cloud');
    const unpricedCloud = { id: 'unpriced', vendor: 'copilot' };
    assert.ok(['unpriced', 'local'].includes(getModelRecommendations(emptyScorecard(), { ...options, models: [unpricedCloud, models[1]], preference: 'cloud' }).recommendedModelId));
});

test('workspace preference is absent or invalid by default and leaves recommendations unchanged', () => {
    const models = [
        { id: 'cheap', vendor: 'copilot', inputCost: 1, outputCost: 2 },
        { id: 'other', vendor: 'other', inputCost: 10, outputCost: 50 }
    ];
    const options = { role: 'coding', taskCategory: 'simple', models, getPricing };
    assert.equal(getModelRecommendations(emptyScorecard(), options).recommendedModelId, 'cheap');
    for (const workspacePreference of [undefined, { preferredProvider: '', preferredModel: '' }, { preferredProvider: [], preferredModel: [] }]) {
        const result = getModelRecommendations(emptyScorecard(), { ...options, workspacePreference });
        assert.equal(result.recommendedModelId, 'cheap');
        assert.deepEqual(result.workspacePreference, { status: 'not-configured' });
    }
    const modelOnly = getModelRecommendations(emptyScorecard(), { ...options, workspacePreference: { preferredProvider: '', preferredModel: 'other' } });
    assert.equal(modelOnly.recommendedModelId, 'cheap');
    assert.deepEqual(modelOnly.workspacePreference, { status: 'invalid' });
});

test('a workspace provider preference orders eligible models and reports when applied', () => {
    const models = [
        { id: 'cheap', vendor: 'copilot', inputCost: 1, outputCost: 2 },
        { id: 'preferred', vendor: 'other', inputCost: 10, outputCost: 50 }
    ];
    const result = getModelRecommendations(emptyScorecard(), {
        role: 'coding', taskCategory: 'simple', models, getPricing,
        workspacePreference: { preferredProvider: 'other', preferredModel: '' }
    });
    assert.equal(result.recommendedModelId, 'preferred');
    assert.deepEqual(result.workspacePreference, { status: 'applied', vendor: 'other', modelId: null });
    assert.deepEqual(compactModelRecommendations(result).workspacePreference, result.workspacePreference);
});

test('an exact workspace model preference requires the matching provider', () => {
    const models = [
        { id: 'cheap', vendor: 'copilot', inputCost: 1, outputCost: 2 },
        { id: 'pricey', vendor: 'copilot', inputCost: 10, outputCost: 50 },
        { id: 'pricey', vendor: 'other', inputCost: 10, outputCost: 50 }
    ];
    const options = { role: 'coding', taskCategory: 'simple', models, getPricing };
    const exact = getModelRecommendations(emptyScorecard(), { ...options, workspacePreference: { preferredProvider: 'other', preferredModel: 'pricey' } });
    assert.equal(exact.recommendedVendor, 'other');
    assert.deepEqual(exact.workspacePreference, { status: 'applied', vendor: 'other', modelId: 'pricey' });
    const mismatch = getModelRecommendations(emptyScorecard(), { ...options, workspacePreference: { preferredProvider: 'other', preferredModel: 'cheap' } });
    assert.equal(mismatch.recommendedModelId, 'cheap');
    assert.equal(mismatch.recommendedVendor, 'copilot');
    assert.deepEqual(mismatch.workspacePreference, { status: 'no-eligible-match', vendor: 'other', modelId: 'cheap' });
});

test('a missing or unpriced workspace preference falls back to existing behavior explicitly', () => {
    const models = [
        { id: 'cheap', vendor: 'copilot', inputCost: 1, outputCost: 2 },
        { id: 'unpriced', vendor: 'other' }
    ];
    const missingProvider = getModelRecommendations(emptyScorecard(), {
        role: 'coding', taskCategory: 'simple', models, getPricing,
        workspacePreference: { preferredProvider: 'missing', preferredModel: '' }
    });
    assert.equal(missingProvider.recommendedModelId, 'cheap');
    assert.deepEqual(missingProvider.workspacePreference, { status: 'no-eligible-match', vendor: 'missing', modelId: null });
    const unpriced = getModelRecommendations(emptyScorecard(), {
        role: 'coding', taskCategory: 'simple', models, getPricing,
        workspacePreference: { preferredProvider: 'other', preferredModel: 'unpriced' }
    });
    assert.equal(unpriced.recommendedModelId, 'unpriced');
    assert.deepEqual(unpriced.workspacePreference, { status: 'applied', vendor: 'other', modelId: 'unpriced' });
});

test('manual selections outrank a workspace preference and report it as not selected', () => {
    const models = [
        { id: 'cheap', vendor: 'copilot', inputCost: 1, outputCost: 2 },
        { id: 'preferred', vendor: 'other', inputCost: 10, outputCost: 50 }
    ];
    const result = getModelRecommendations(emptyScorecard(), {
        activity: 'implement', domain: 'coding', difficulty: 'simple', models, getPricing,
        manualSelection: { modelId: 'cheap', vendor: 'copilot' },
        workspacePreference: { preferredProvider: 'other', preferredModel: '' }
    });
    assert.equal(result.recommendedModelId, 'cheap');
    assert.equal(result.selectionMode, 'manual');
    assert.deepEqual(result.workspacePreference, { status: 'not-selected', vendor: 'other', modelId: null });
});

test('workspace preference never bypasses the complex-task evidence rule', () => {
    const models = [
        { id: 'learned', vendor: 'copilot', inputCost: 10, outputCost: 50 },
        { id: 'preferred', vendor: 'other', inputCost: 1, outputCost: 2 }
    ];
    let scorecard = emptyScorecard();
    for (let index = 0; index < 2; index += 1) {
        scorecard = recordOutcome(scorecard, { role: 'coding', taskCategory: 'complex', modelId: 'learned', outcome: 'success', evidenceCode: 'acceptance_passed' });
    }
    const options = { role: 'coding', taskCategory: 'complex', models, getPricing, workspacePreference: { preferredProvider: 'other', preferredModel: '' } };
    const unlearned = getModelRecommendations(scorecard, options);
    assert.equal(unlearned.recommendedModelId, 'learned');
    assert.deepEqual(unlearned.workspacePreference, { status: 'not-selected', vendor: 'other', modelId: null });
    for (let index = 0; index < 2; index += 1) {
        scorecard = recordOutcome(scorecard, { role: 'coding', taskCategory: 'complex', modelId: 'preferred', outcome: 'success', evidenceCode: 'acceptance_passed' });
    }
    const learned = getModelRecommendations(scorecard, options);
    assert.equal(learned.recommendedModelId, 'preferred');
    assert.equal(learned.workspacePreference.status, 'applied');
});

test('model scope and individual classification control eligibility and pricing', () => {
    const models = [
        { id: 'cloud', vendor: 'copilot', inputCost: 10, outputCost: 50 },
        { id: 'local', vendor: 'ollama' },
        { id: 'remote', vendor: 'other', inputCost: 20, outputCost: 100 },
        { id: 'disabled', vendor: 'copilot', inputCost: 1, outputCost: 2 }
    ];
    const classifications = {
        [pricingModule.modelKey(models[2])]: 'cloud',
        [pricingModule.modelKey(models[3])]: 'excluded'
    };
    assert.deepEqual(pricingModule.selectModels(models, ['ollama'], classifications, 'cloud').map(model => model.id), ['cloud', 'remote']);
    assert.deepEqual(pricingModule.selectModels(models, ['ollama'], classifications, 'local').map(model => model.id), ['local']);
    assert.deepEqual(pricingModule.selectModels(models, ['ollama'], classifications, 'both').map(model => model.id), ['cloud', 'local', 'remote']);
    assert.equal(pricingModule.getManagedPricing(models[1], ['ollama'], classifications).source, 'local');
    assert.equal(pricingModule.getManagedPricing(models[2], ['ollama'], classifications).source, 'vscode');
    assert.equal(pricingModule.modelClassification(models[2], [], {}), 'excluded');
    assert.deepEqual(pricingModule.selectModels(models, [], classifications, 'local'), []);
    const emptyResult = getModelRecommendations(emptyScorecard(), {
        role: 'coding', taskCategory: 'simple', models: [], getPricing
    });
    assert.equal(emptyResult.recommendedModelId, null);
    assert.equal(emptyResult.selectionMode, 'fallback');
});

test('only Copilot and explicitly configured local vendors are eligible', () => {
    const models = [
        { id: 'copilot-model', vendor: 'copilot', name: 'Cloud' },
        { id: 'local-model', vendor: 'ollama', name: 'Local' },
        { id: 'other-model', vendor: 'remote', name: 'Other' }
    ];
    assert.deepEqual(pricingModule.selectModelVendors(models, []).map(model => model.id), ['copilot-model']);
    const selected = pricingModule.selectModelVendors(models, ['ollama']);
    assert.deepEqual(selected.map(model => model.id), ['copilot-model', 'local-model']);
    const result = getModelRecommendations(emptyScorecard(), {
        role: 'coding', taskCategory: 'simple', models: selected,
        getPricing: model => pricingModule.getSelectionPricing(model, ['ollama'])
    });
    assert.ok(['copilot-model', 'local-model'].includes(result.recommendedModelId));
    assert.equal(result.candidates.find(model => model.id === 'local-model').pricing.source, 'local');
});

test('removing a local vendor hides it from recommendations without deleting its outcomes', () => {
    const models = [
        { id: 'cloud', vendor: 'copilot', inputCost: 10, outputCost: 50 },
        { id: 'local', vendor: 'ollama' }
    ];
    const scorecard = recordOutcome(emptyScorecard(), {
        role: 'coding', taskCategory: 'simple', modelId: 'local', outcome: 'success', evidenceCode: 'acceptance_passed'
    });
    const eligible = pricingModule.selectModelVendors(models, []);
    const result = getModelRecommendations(scorecard, { role: 'coding', taskCategory: 'simple', models: eligible, getPricing });
    const row = getLearningDashboard(scorecard, eligible, getPricing).find(item => item.role === 'coding' && item.taskCategory === 'simple');
    assert.equal(result.recommendedModelId, 'cloud');
    assert.equal(row.recommendedModelId, 'cloud');
    assert.equal(result.candidates.some(model => model.id === 'local'), false);
    assert.equal(scorecard.records[0].modelId, 'local');
});

test('a verified failure lowers only that model, role, and task score', () => {
    let scorecard = emptyScorecard();
    scorecard = recordOutcome(scorecard, {
        role: 'coding', taskCategory: 'simple', modelId: 'cheap-a', outcome: 'success', evidenceCode: 'acceptance_passed'
    });
    scorecard = recordOutcome(scorecard, {
        role: 'coding', taskCategory: 'simple', modelId: 'cheap-a', outcome: 'success', evidenceCode: 'acceptance_passed'
    });
    scorecard = recordOutcome(scorecard, {
        role: 'coding', taskCategory: 'simple', modelId: 'cheap-b', outcome: 'failure', evidenceCode: 'acceptance_failed'
    });

    const models = [
        { id: 'cheap-a', name: 'Model A', vendor: 'copilot', inputCost: 10, outputCost: 50, budgetClass: 'low' },
        { id: 'cheap-b', name: 'Model B', vendor: 'copilotcli', inputCost: 12, outputCost: 60, budgetClass: 'low' },
        { id: 'complex-c', name: 'Model C', vendor: 'copilot', inputCost: 200, outputCost: 1000, budgetClass: 'medium' }
    ];
    const recommendations = getModelRecommendations(scorecard, { role: 'coding', taskCategory: 'simple', models, getPricing });

    assert.equal(recommendations.recommendedModelId, 'cheap-a');
    assert.equal(recommendations.candidates.find(model => model.id === 'cheap-a').modelArgument, 'Model A (copilot)');
    assert.equal(recommendations.candidates.find(model => model.id === 'cheap-a').score, 0.75);
    assert.equal(recommendations.candidates.find(model => model.id === 'cheap-b').score, 1 / 3);
    assert.equal(recommendations.candidates.find(model => model.id === 'complex-c').samples, 0);
});

test('complex tasks retain eligible fallbacks but do not recommend unlearned exploration', () => {
    const scorecard = recordOutcome(emptyScorecard(), {
        role: 'review', taskCategory: 'complex', modelId: 'model-a', outcome: 'failure', evidenceCode: 'incorrect'
    });
    const result = getModelRecommendations(scorecard, {
        role: 'review',
        taskCategory: 'complex',
        models: [{ id: 'model-a', name: 'Model A', vendor: 'copilot', inputCost: 200, outputCost: 1000 }],
        getPricing
    });

    assert.equal(result.recommendedModelId, null);
    assert.equal(result.selectionMode, 'fallback');
    assert.equal(result.candidates[0].selectionMode, 'explore');
    const compact = compactModelRecommendations(result);
    assert.equal(compact.selectionMode, 'fallback');
    assert.equal(compact.candidates[0].id, 'model-a');
    const dashboard = getLearningDashboard(scorecard, [{ id: 'model-a', name: 'Model A', vendor: 'copilot', inputCost: 200, outputCost: 1000 }], getPricing);
    const row = dashboard.find(item => item.role === 'review' && item.taskCategory === 'complex');
    assert.equal(row.recommendedModelId, null);
    assert.equal(row.eligibleCount, 1);
});

test('complex tasks recommend learned models before cheaper unlearned candidates', () => {
    let scorecard = emptyScorecard();
    for (let index = 0; index < 2; index += 1) {
        scorecard = recordOutcome(scorecard, { role: 'coding', taskCategory: 'complex', modelId: 'learned', outcome: 'success', evidenceCode: 'acceptance_passed' });
    }
    const models = [
        { id: 'cheap', name: 'Cheap', vendor: 'copilot', inputCost: 10, outputCost: 50 },
        { id: 'learned', name: 'Learned', vendor: 'copilot', inputCost: 200, outputCost: 1000 }
    ];
    const result = getModelRecommendations(scorecard, { role: 'coding', taskCategory: 'complex', models, getPricing });
    assert.equal(result.recommendedModelId, 'learned');
    assert.equal(result.selectionMode, 'learned');
    assert.equal(compactModelRecommendations(result).candidates[0].id, 'learned');
    const row = getLearningDashboard(scorecard, models, getPricing).find(item => item.role === 'coding' && item.taskCategory === 'complex');
    assert.equal(row.recommendedModelId, 'learned');
    assert.equal(row.candidates[0].id, 'learned');
});

test('dashboard marks cold-start choices as exploration and then learns from repeated outcomes', () => {
    const models = [{ id: 'model-a', name: 'Model A', vendor: 'copilot', inputCost: 10, outputCost: 50 }];
    let scorecard = recordOutcome(emptyScorecard(), {
        role: 'coding', taskCategory: 'simple', modelId: 'model-a', outcome: 'success', evidenceCode: 'acceptance_passed'
    });
    let row = getLearningDashboard(scorecard, models, getPricing).find(item => item.role === 'coding' && item.taskCategory === 'simple');
    assert.equal(row.recommendedModelId, 'model-a');
    assert.equal(row.candidates.find(model => model.id === 'model-a').selectionMode, 'explore');
    assert.equal(row.sampleCount, 1);

    scorecard = recordOutcome(scorecard, {
        role: 'coding', taskCategory: 'simple', modelId: 'model-a', outcome: 'success', evidenceCode: 'acceptance_passed'
    });
    row = getLearningDashboard(scorecard, models, getPricing).find(item => item.role === 'coding' && item.taskCategory === 'simple');
    assert.equal(row.recommendedModelId, 'model-a');
    assert.equal(row.sampleCount, 2);
    assert.equal(row.candidates.find(model => model.id === 'model-a').selectionMode, 'learned');
});

test('verified repeated failures move simple-task selection from cheap to better-priced alternative', () => {
    let scorecard = emptyScorecard();
    for (let index = 0; index < 3; index += 1) {
        scorecard = recordOutcome(scorecard, {
            role: 'coding', taskCategory: 'simple', modelId: 'cheap', outcome: 'failure', evidenceCode: 'acceptance_failed'
        });
    }
    const models = [
        { id: 'cheap', name: 'Cheap', vendor: 'copilot', inputCost: 10, outputCost: 50 },
        { id: 'balanced', name: 'Balanced', vendor: 'copilot', inputCost: 200, outputCost: 1000 }
    ];
    const result = getModelRecommendations(scorecard, { role: 'coding', taskCategory: 'simple', models, getPricing });
    assert.equal(result.recommendedModelId, 'balanced');
    assert.equal(result.selectionMode, 'explore');
});

test('requires objective evidence and does not persist prompts or outputs', () => {
    assert.throws(() => recordOutcome(emptyScorecard(), {
        role: 'coding', taskCategory: 'simple', modelId: 'model-a', outcome: 'failure'
    }), /objective model-quality failure code/);

    const scorecard = recordOutcome(emptyScorecard(), {
        role: 'coding', taskCategory: 'simple', modelId: 'model-a', outcome: 'failure', evidenceCode: 'incorrect',
        prompt: 'private prompt', response: 'private response'
    });
    assert.deepEqual(Object.keys(scorecard.records[0]).sort(), [
        'evidenceCode', 'modelId', 'outcome', 'recordedAt', 'role', 'taskCategory'
    ]);
    assert.equal(normalizeScorecard(scorecard).records.length, 1);
});

test('local capability tiers limit task eligibility and require explicit ratings', () => {
    const models = [{ id: 'local', vendor: 'ollama' }, { id: 'cloud', vendor: 'copilot' }];
    const select = (taskCategory, localTiers) => pricingModule.selectModels(models, ['ollama'], {}, 'both', { taskCategory, localTiers });
    assert.deepEqual(select('simple', {}).map(model => model.id), ['local', 'cloud']);
    const localTiers = { [pricingModule.modelKey(models[0])]: 'standard' };
    assert.deepEqual(select('simple', localTiers).map(model => model.id), ['local', 'cloud']);
    assert.deepEqual(select('standard', localTiers).map(model => model.id), ['local']);
    assert.deepEqual(select('complex', localTiers).map(model => model.id), []);
    assert.deepEqual(pricingModule.selectModels(models, ['ollama'], {}, 'both', { taskCategory: 'simple', localTiers, selections: { [pricingModule.modelKey(models[0])]: false } }).map(model => model.id), ['cloud']);
    assert.deepEqual(pricingModule.selectModels(models, ['ollama'], {}, 'both', { taskCategory: 'simple', localTiers, providerTypes: { ollama: 'unknown' } }).map(model => model.id), ['cloud']);
    assert.equal(pricingModule.modelKind(models[1], [], {}, { copilot: 'unknown' }), 'cloud');
});

test('contextual outcomes retain verified metadata without storing prompt content', () => {
    const legacy = { schemaVersion: 1, records: [{
        role: 'coding', taskCategory: 'simple', modelId: 'old', outcome: 'success',
        evidenceCode: 'acceptance_passed', recordedAt: '2026-01-01T00:00:00.000Z'
    }] };
    const scorecard = recordOutcome(legacy, {
        activity: 'advise', domain: 'coding', difficulty: 'standard', agent: 'CodeDomainAdvisor',
        modelId: 'model-a', callId: 'opaque-call-id', outcome: 'success', evidenceCode: 'acceptance_passed',
        metrics: { durationMs: 1200, costUsd: 0.03 }, prompt: 'private prompt', response: 'private response'
    });

    assert.equal(scorecard.schemaVersion, 2);
    assert.equal(scorecard.records.length, 2);
    assert.equal(scorecard.records[0].role, 'coding');
    assert.equal(scorecard.records[1].activity, 'advise');
    assert.equal(scorecard.records[1].domain, 'coding');
    assert.equal(scorecard.records[1].callId, 'opaque-call-id');
    assert.equal(scorecard.records[1].metrics.durationMs, 1200);
    assert.equal(scorecard.records[1].metrics.costUsd, 0.03);
    assert.equal('prompt' in scorecard.records[1], false);
    assert.equal(normalizeScorecard(legacy).records.length, 1);
    assert.throws(() => recordOutcome(emptyScorecard(), {
        activity: 'advise', domain: 'coding', difficulty: 'simple', modelId: 'model-a',
        outcome: 'success', evidenceCode: 'acceptance_passed', metrics: { durationMs: -1 }
    }), /non-negative measured/);
});

test('contextual recommendations pool related evidence and expose its source', () => {
    let scorecard = emptyScorecard();
    for (let index = 0; index < 8; index += 1) {
        scorecard = recordOutcome(scorecard, {
            activity: 'advise', domain: 'coding', difficulty: 'standard', modelId: 'model-a',
            outcome: index < 6 ? 'success' : 'failure',
            evidenceCode: index < 6 ? 'acceptance_passed' : 'incorrect',
            metrics: { durationMs: 1000 + index * 100 }
        });
    }
    scorecard = recordOutcome(scorecard, {
        activity: 'implement', domain: 'coding', difficulty: 'standard', modelId: 'model-b',
        outcome: 'success', evidenceCode: 'acceptance_passed'
    });
    const models = [
        { id: 'model-a', name: 'Model A', vendor: 'copilot', inputCost: 10, outputCost: 50 },
        { id: 'model-b', name: 'Model B', vendor: 'copilot', inputCost: 200, outputCost: 1000 }
    ];
    const result = getModelRecommendations(scorecard, {
        activity: 'advise', domain: 'coding', difficulty: 'complex', models, getPricing
    });
    const candidate = result.candidates.find(model => model.id === 'model-a');

    assert.equal(result.selectionMode, 'pooled');
    assert.equal(result.recommendedModelId, 'model-a');
    assert.equal(candidate.samples, 0);
    assert.equal(candidate.pooledSamples, 8);
    assert.equal(candidate.effectiveSamples, 4);
    assert.equal(candidate.evidenceSource, 'pooled');
    assert.equal(candidate.averageDurationMs, 1350);
    assert.equal(result.candidates.find(model => model.id === 'model-b').effectiveSamples, 0.2);
    const row = getContextualLearningDashboard(scorecard, models, getPricing)
        .find(item => item.activity === 'advise' && item.domain === 'coding' && item.difficulty === 'complex');
    assert.equal(row.sampleCount, 0);
    assert.equal(row.pooledSampleCount, 9);
    assert.equal(row.selectionMode, 'pooled');

    const compact = compactModelRecommendations(result);
    assert.equal(compact.activity, 'advise');
    assert.equal(compact.domain, 'coding');
    assert.equal(compact.difficulty, 'complex');
    assert.equal(compact.candidates.find(model => model.id === 'model-a').evidenceSource, 'pooled');
});

test('legacy scorecards contribute only low-weight pooled evidence', () => {
    const scorecard = normalizeScorecard({ schemaVersion: 1, records: [{
        role: 'coding', taskCategory: 'simple', modelId: 'legacy-model', outcome: 'success',
        evidenceCode: 'acceptance_passed', recordedAt: '2026-01-01T00:00:00.000Z'
    }] });
    const dashboard = getContextualLearningDashboard(scorecard, [
        { id: 'legacy-model', name: 'Legacy', vendor: 'copilot', inputCost: 10, outputCost: 50 }
    ], getPricing);
    const row = dashboard.find(item => item.activity === 'advise' && item.domain === 'coding' && item.difficulty === 'simple');

    assert.equal(scorecard.records.length, 1);
    assert.equal(row.sampleCount, 0);
    assert.equal(row.pooledSampleCount, 1);
    assert.equal(row.selectionMode, 'explore');
});

test('legacy GitHub workflow records migrate to the Documentation and Governance domain', () => {
    const scorecard = normalizeScorecard({ schemaVersion: 2, records: [{
        activity: 'operate', domain: 'github-workflow', difficulty: 'standard', modelId: 'legacy',
        outcome: 'success', evidenceCode: 'acceptance_passed', recordedAt: '2026-01-01T00:00:00.000Z'
    }] });

    assert.equal(scorecard.records.length, 1);
    assert.equal(scorecard.records[0].domain, 'documentation-governance');
});

test('manual model selections override only the exact context and preserve the selected candidate', () => {
    const models = [
        { id: 'learned', name: 'Learned', vendor: 'copilot', inputCost: 10, outputCost: 50 },
        { id: 'pinned', name: 'Pinned', vendor: 'copilot', inputCost: 200, outputCost: 1000 }
    ];
    let scorecard = emptyScorecard();
    for (let index = 0; index < 3; index += 1) {
        scorecard = recordOutcome(scorecard, {
            activity: 'implement', domain: 'coding', difficulty: 'simple', modelId: 'learned',
            outcome: 'success', evidenceCode: 'acceptance_passed'
        });
    }
    const options = { activity: 'implement', domain: 'coding', difficulty: 'simple', models, getPricing };
    const manual = getModelRecommendations(scorecard, { ...options, manualSelection: { modelId: 'pinned', vendor: 'copilot' } });
    const compact = compactModelRecommendations(manual);

    assert.equal(manual.recommendedModelId, 'pinned');
    assert.equal(manual.recommendedVendor, 'copilot');
    assert.equal(manual.selectionMode, 'manual');
    assert.equal(manual.candidates[0].id, 'pinned');
    assert.equal(compact.candidates[0].id, 'pinned');
    assert.equal(compact.candidates[0].selectionMode, 'manual');
    assert.equal(getModelRecommendations(scorecard, { ...options, difficulty: 'complex' }).recommendedModelId, null);

    const unavailable = getModelRecommendations(scorecard, {
        ...options,
        models: [{ id: 'pinned', name: 'Pinned', vendor: 'copilot' }],
        manualSelection: { modelId: 'pinned', vendor: 'copilot' }
    });
    assert.equal(unavailable.recommendedModelId, 'pinned');
    assert.equal(unavailable.selectionMode, 'manual');
});

// --- Test pinned model functionality ---

test('pinned model for advisors is persisted', () => {
    const context = { globalState: { get: () => ({ modelId: 'test-model', vendor: 'test-vendor' }) } };
    const result = advisorPinning.getAdvisorPinnedModel(context);
    assert.deepEqual(result, { modelId: 'test-model', vendor: 'test-vendor' });
    
    // Test fallback to null if no pinned model
    context.globalState.get = () => null;
    assert.strictEqual(advisorPinning.getAdvisorPinnedModel(context), null);
});

test('pinned model precedence in model recommendations', () => {
    const context = { globalState: { get: () => ({ modelId: 'pinned-model', vendor: 'test-vendor' }) } };
    
    const models = [
        { id: 'pinned-model', vendor: 'test-vendor', name: 'Pinned Model', inputCost: 0, outputCost: 0 },
        { id: 'other-model', vendor: 'other-vendor', name: 'Other Model', inputCost: 10, outputCost: 50 }
    ];
    
    const policy = { scope: 'both', localModelVendors: [], classifications: {}, providerTypes: {}, selections: {} };
    const taskContext = { activity: 'advise', domain: 'coding', difficulty: 'simple' };
    
    const filteredModels = advisorPinning.getAdvisorFilteredModels(context, models, policy, taskContext);
    assert.strictEqual(filteredModels.length, 1);
    assert.strictEqual(filteredModels[0].id, 'pinned-model');
});

test('fallback to learned recommendations when pinned model is unavailable', () => {
    const context = { globalState: { get: () => ({ modelId: 'unavailable-model', vendor: 'test-vendor' }) } };
    
    const models = [
        { id: 'other-model', vendor: 'other-vendor', name: 'Other Model', inputCost: 10, outputCost: 50 }
    ];
    
    const policy = { scope: 'both', localModelVendors: [], classifications: {}, providerTypes: {}, selections: {} };
    const taskContext = { activity: 'advise', domain: 'coding', difficulty: 'simple' };
    
    const filteredModels = advisorPinning.getAdvisorFilteredModels(context, models, policy, taskContext);
    assert.strictEqual(filteredModels.length, 1);
    assert.strictEqual(filteredModels[0].id, 'other-model');
});

test('manual selections for an advisor context outrank the pinned default', () => {
    const context = { globalState: { get: () => ({ modelId: 'pinned-model', vendor: 'test-vendor' }) } };

    const models = [
        { id: 'pinned-model', vendor: 'test-vendor', name: 'Pinned Model', inputCost: 0, outputCost: 0 },
        { id: 'manual-model', vendor: 'other-vendor', name: 'Manual Model', inputCost: 10, outputCost: 50 }
    ];

    const policy = { scope: 'both', localModelVendors: [], classifications: {}, providerTypes: {}, selections: {} };
    const taskContext = { activity: 'advise', domain: 'coding', difficulty: 'simple' };
    const manualSelection = { activity: 'advise', domain: 'coding', difficulty: 'simple', modelId: 'manual-model', vendor: 'other-vendor' };

    const filteredModels = advisorPinning.getAdvisorFilteredModels(context, models, policy, taskContext, manualSelection);
    assert.deepEqual(filteredModels.map(model => model.id), ['pinned-model', 'manual-model']);
});