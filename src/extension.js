const vscode = require('vscode');
const { randomBytes } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { loadStore } = require('./prior-assessment-store');
const { effectiveModelScope, getInventorySummary, getManagedPricing, hasSelectedLocalModel, isCopilotCloudVendor, isModelSelected, modelKey, modelKind, selectModels } = require('./model-pricing');
const {
    ACTIVITIES,
    compactModelRecommendations,
    DOMAINS,
    excludeUnavailableModels,
    getContextualLearningDashboard,
    getModelRecommendations,
    hasFinitePrice,
    normalizeScorecard,
    recordOutcome,
    TASK_CATEGORIES
} = require('./model-learning');
const { ADVISOR_PINNED_MODEL_KEY, getAdvisorFilteredModels, getAdvisorPinnedModel } = require('./advisor-pinning');
const {
    describeProviderAvailability,
    isProviderEnabled,
    normalizeProviderId,
    normalizeProviderIds,
    PROVIDER_AVAILABILITY_KEY,
    providerAvailabilityLabel,
    readWorkspaceProviderSetting,
    resolveProviderAvailability,
    WORKSPACE_PROVIDERS_SETTING
} = require('./provider-availability');

const LEARNING_STORAGE_KEY = 'agentRoster.modelLearning.scorecard.v1';
const INVENTORY_STORAGE_KEY = 'agentRoster.modelLearning.inventory.v1';
const MANUAL_SELECTIONS_KEY = 'agentRoster.modelLearning.manualSelections.v1';
const dashboardRefreshers = new Set();
let inventoryUpdates = Promise.resolve();

const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
function getInventoryPolicy(context) {
    const stored = context.globalState.get(INVENTORY_STORAGE_KEY) || {};
    return {
        scope: ['cloud', 'local'].includes(stored.scope) ? stored.scope : 'both',
        priority: ['local-first', 'cloud-first'].includes(stored.priority)
            ? stored.priority : stored.scope === 'local-first' ? 'local-first' : 'cloud-first',
        classifications: stored.classifications && typeof stored.classifications === 'object' && !Array.isArray(stored.classifications)
            ? stored.classifications : {},
        providerTypes: stored.providerTypes && typeof stored.providerTypes === 'object' && !Array.isArray(stored.providerTypes) ? stored.providerTypes : {},
        selections: stored.selections && typeof stored.selections === 'object' && !Array.isArray(stored.selections) ? stored.selections : {},
        localTiers: stored.localTiers && typeof stored.localTiers === 'object' && !Array.isArray(stored.localTiers) ? stored.localTiers : {},
        manualPriceTiers: stored.manualPriceTiers && typeof stored.manualPriceTiers === 'object' && !Array.isArray(stored.manualPriceTiers) ? stored.manualPriceTiers : {},
        localModelVendors: vscode.workspace.getConfiguration('agentRoster.modelLearning').get('localModelVendors', []),
        providerAvailability: getProviderAvailabilityState(context).effective
    };
}

// Reads only workspace values so a user-level setting cannot act as a hidden override.
function getWorkspacePreference() {
    const configuration = vscode.workspace.getConfiguration(WORKSPACE_PREFERENCE_SECTION);
    const read = key => {
        const value = configuration.inspect(key)?.workspaceValue;
        return typeof value === 'string' ? value : '';
    };
    return { preferredProvider: read('preferredProvider'), preferredModel: read('preferredModel') };
}

function saveInventoryPolicy(context, policy) {
    return context.globalState.update(INVENTORY_STORAGE_KEY, {
        scope: policy.scope, priority: policy.priority, classifications: policy.classifications,
        providerTypes: policy.providerTypes, selections: policy.selections,
        localTiers: policy.localTiers, manualPriceTiers: policy.manualPriceTiers
    });
}

function getManualSelections(context) {
    const stored = context.globalState.get(MANUAL_SELECTIONS_KEY);
    return Array.isArray(stored) ? stored.map(selection => selection?.domain === 'github-workflow'
        ? { ...selection, domain: 'documentation-governance' }
        : selection).filter(selection => selection
            && ACTIVITIES.includes(selection.activity)
            && DOMAINS.includes(selection.domain)
            && TASK_CATEGORIES.includes(selection.difficulty)
            && typeof selection.modelId === 'string'
            && selection.modelId.length > 0
            && typeof selection.vendor === 'string'
            && selection.vendor.length > 0) : [];
}

function getManualSelection(selections, context) {
    return selections.find(selection => selection.activity === context.activity
        && selection.domain === context.domain
        && selection.difficulty === context.difficulty) || null;
}

function enqueueInventoryUpdate(update) {
    const result = inventoryUpdates.then(update);
    inventoryUpdates = result.catch(() => { });
    return result;
}

function refreshLearningViews() {
    for (const refresh of dashboardRefreshers) void refresh();
}

const ADVISOR_PIN_DIFFICULTIES = ['simple', 'standard', 'complex'];

// Validates a pin against current availability, scope, selection, exclusions and every task difficulty before storing it.
async function applyAdvisorPinnedModel(context, pin, exclusions = {}) {
    if (pin === null) {
        await context.globalState.update(ADVISOR_PINNED_MODEL_KEY, null);
        return;
    }
    if (!pin || typeof pin !== 'object' || typeof pin.modelId !== 'string' || !pin.modelId || typeof pin.vendor !== 'string' || !pin.vendor) {
        throw new Error('Invalid advisor model.');
    }
    const models = await selectChatModelsWithTimeout();
    const policy = getInventoryPolicy(context);
    const scope = effectiveModelScope(models, policy);
    if (!models.some(model => model.id === pin.modelId && model.vendor === pin.vendor)) {
        throw new Error('Advisor model is not currently available. Refresh the inventory.');
    }
    const eligibleForEveryDifficulty = ADVISOR_PIN_DIFFICULTIES.every(difficulty => {
        const eligible = selectModels(models, policy.localModelVendors, policy.classifications, scope, { ...policy, taskCategory: difficulty });
        return excludeUnavailableModels(eligible, exclusions).some(model => model.id === pin.modelId && model.vendor === pin.vendor);
    });
    if (!eligibleForEveryDifficulty) {
        throw new Error('Advisor model is not eligible for the current scope, selection, exclusions, and every task difficulty.');
    }
    await context.globalState.update(ADVISOR_PINNED_MODEL_KEY, { modelId: pin.modelId, vendor: pin.vendor });
}

async function pinAdvisorModel(context) {
    try {
        const models = await selectChatModelsWithTimeout();
        const choices = models.map(model => ({
            label: `${model.name} (${model.vendor})`,
            value: { modelId: model.id, vendor: model.vendor }
        }));
        choices.push({ label: 'Use learned recommendation (no pin)', value: null });
        const choice = await vscode.window.showQuickPick(choices, {
            title: 'Pin advisor model',
            placeHolder: 'Select a model for advisor recommendations or clear the pin'
        });
        if (!choice) return;
        await enqueueInventoryUpdate(async () => {
            await applyAdvisorPinnedModel(context, choice.value);
            refreshLearningViews();
        });
    } catch (error) {
        void vscode.window.showErrorMessage(`Could not pin advisor model: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function createLearningSidebar(context) {
    const changes = new vscode.EventEmitter();
    const refresh = () => changes.fire();
    dashboardRefreshers.add(refresh);
    const item = (label, description, icon, command, tooltip) => {
        const row = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        row.description = description;
        row.iconPath = new vscode.ThemeIcon(icon);
        if (tooltip) row.tooltip = tooltip;
        if (command) row.command = { command, title: label };
        return row;
    };
    const openDashboard = 'agentRoster.openModelLearning';
    return {
        onDidChangeTreeData: changes.event,
        async getChildren(element) {
            if (element) return [];
            const scorecard = normalizeScorecard(context.globalState.get(LEARNING_STORAGE_KEY));
            const rows = [
                item('Open Aro Learning', '', 'dashboard', openDashboard)
            ];
            let models;
            try {
                models = await selectChatModelsWithTimeout();
            } catch (error) {
                rows.push(item('Models unavailable', '', 'warning', openDashboard, error instanceof Error ? error.message : String(error)));
                rows.push(item('Outcomes', String(scorecard.records.length), 'graph', openDashboard));
                return rows;
            }
            const policy = getInventoryPolicy(context);
            const summary = getInventorySummary(models, policy);
            const scopeLabel = { cloud: 'Cloud only', local: 'Local only', both: 'Both' }[summary.scope];
            rows.push(item('Scope', scopeLabel, 'settings-gear', 'agentRoster.changeModelScope'));
            rows.push(item('Priority', summary.scope === 'both' ? policy.priority === 'local-first' ? 'Local first' : 'Cloud first' : 'Not applicable', 'arrow-swap', summary.scope === 'both' ? 'agentRoster.changeModelPriority' : undefined));
            rows.push(item('Model inventory', providerAvailabilityLabel(policy.providerAvailability), 'plug', 'agentRoster.openModelInventory', 'Choose which providers Aro may use globally or for this workspace.'));
            const pinned = getAdvisorPinnedModel(context);
            rows.push(item('Advisor model', pinned ? pinned.modelId : 'Learned recommendation', 'pin', 'agentRoster.pinAdvisorModel'));
            rows.push(item('Selected models', `${summary.cloudCount} cloud / ${summary.localCount} local`, 'checklist', openDashboard));
            if (summary.unknownCount) rows.push(item('Unclassified selected', String(summary.unknownCount), 'warning', openDashboard));
            rows.push(item('Unrated local', String(summary.unratedLocalCount), summary.unratedLocalCount ? 'warning' : 'check', openDashboard));
            rows.push(item('Outcomes', String(scorecard.records.length), 'graph', openDashboard));
            const last = scorecard.records.at(-1);
            if (last) {
                const difficulty = last.difficulty || last.taskCategory;
                const context = last.activity ? {
                    activity: last.activity,
                    domain: last.domain,
                    difficulty
                } : { role: last.role, taskCategory: difficulty };
                const eligible = selectModels(models, policy.localModelVendors, policy.classifications, summary.scope, { ...policy, taskCategory: difficulty });
                const result = getModelRecommendations(scorecard, {
                    ...context, models: eligible,
                    getPricing: model => getManagedPricing(model, policy.localModelVendors, policy.classifications, policy.providerTypes, policy.manualPriceTiers),
                    getModelKind: model => modelKind(model, policy.localModelVendors, policy.classifications, policy.providerTypes),
                    preference: summary.scope === 'both' ? policy.priority === 'local-first' ? 'local' : 'cloud' : undefined,
                    workspacePreference: getWorkspacePreference()
                });
                const recommended = result.candidates.find(candidate => candidate.id === result.recommendedModelId);
                const fallback = difficulty === 'complex' && result.candidates.some(candidate => Number.isFinite(candidate.cost))
                    ? 'No learned recommendation' : 'No eligible model';
                const contextLabel = last.activity
                    ? `${last.activity} / ${last.domain} / ${difficulty}`
                    : `${last.role} / ${difficulty}`;
                rows.push(item(`Latest context: ${contextLabel}`, recommended ? `${recommended.name} (${recommended.vendor})` : fallback, 'lightbulb', openDashboard, 'Current recommendation for the most recently recorded outcome; not proof of the model used.'));
            } else {
                rows.push(item('Latest context', 'No recorded outcomes', 'lightbulb', openDashboard));
            }
            return rows;
        },
        getTreeItem(row) { return row; },
        dispose() { dashboardRefreshers.delete(refresh); changes.dispose(); }
    };
}

async function changeModelScope(context) {
    try {
        const models = await selectChatModelsWithTimeout();
        const policy = getInventoryPolicy(context);
        const choices = [{ label: 'Cloud only', value: 'cloud' }];
        if (hasSelectedLocalModel(models, policy)) choices.push({ label: 'Local only', value: 'local' }, { label: 'Both', value: 'both' });
        const choice = await vscode.window.showQuickPick(choices, { title: 'Model scope', placeHolder: 'Choose which models Aro may recommend' });
        if (!choice) return;
        await enqueueInventoryUpdate(async () => {
            const currentPolicy = getInventoryPolicy(context);
            const currentModels = await selectChatModelsWithTimeout();
            if (choice.value !== 'cloud' && !hasSelectedLocalModel(currentModels, currentPolicy)) throw new Error('Select a local model before using this scope.');
            currentPolicy.scope = choice.value;
            await saveInventoryPolicy(context, currentPolicy);
            refreshLearningViews();
        });
    } catch (error) {
        void vscode.window.showErrorMessage(`Could not change model scope: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function changeModelPriority(context) {
    try {
        const choice = await vscode.window.showQuickPick([
            { label: 'Cloud first', value: 'cloud-first' },
            { label: 'Local first', value: 'local-first' }
        ], { title: 'Model priority' });
        if (!choice) return;
        await enqueueInventoryUpdate(async () => {
            const policy = getInventoryPolicy(context);
            const models = await selectChatModelsWithTimeout();
            if (effectiveModelScope(models, policy) !== 'both') throw new Error('Priority is available only when both scopes are selected.');
            policy.priority = choice.value;
            await saveInventoryPolicy(context, policy);
            refreshLearningViews();
        });
    } catch (error) {
        void vscode.window.showErrorMessage(`Could not change model priority: ${error instanceof Error ? error.message : String(error)}`);
    }
}

const WORKSPACE_PREFERENCE_SECTION = 'agentRoster.modelRecommendation';

// Models a workspace preference may name: selected, classified, in the current scope, priced, for every difficulty.
function getWorkspacePreferenceCandidates(models, policy, scope) {
    const candidates = new Map();
    for (const taskCategory of TASK_CATEGORIES) {
        for (const model of selectModels(models, policy.localModelVendors, policy.classifications, scope, { ...policy, taskCategory })) {
            const pricing = getManagedPricing(model, policy.localModelVendors, policy.classifications, policy.providerTypes, policy.manualPriceTiers);
            if (hasFinitePrice(pricing)) candidates.set(`${model.vendor}\n${model.id}`, model);
        }
    }
    return [...candidates.values()];
}

// Read-only view for the dashboard. Saved values that are no longer eligible are reported, never removed.
function getWorkspacePreferenceView(models, policy, scope) {
    const { preferredProvider, preferredModel } = getWorkspacePreference();
    const candidates = getWorkspacePreferenceCandidates(models, policy, scope);
    const providers = [...new Set(candidates.map(model => model.vendor))].sort().map(vendor => ({
        vendor,
        models: candidates.filter(model => model.vendor === vendor)
            .map(model => ({ id: model.id, name: model.name }))
            .sort((left, right) => left.name.localeCompare(right.name))
    }));
    const provider = providers.find(item => item.vendor === preferredProvider);
    return {
        hasWorkspace: Boolean(vscode.workspace.workspaceFolders?.length),
        active: Boolean(preferredProvider || preferredModel),
        invalid: Boolean(preferredModel && !preferredProvider),
        preferredProvider,
        preferredModel,
        providerAvailable: !preferredProvider || Boolean(provider),
        modelAvailable: !preferredModel || Boolean(provider?.models.some(model => model.id === preferredModel)),
        providers
    };
}

// Writes only the two workspace preference keys. Profile removes them; other workspace settings are untouched.
async function applyWorkspacePreference(message, models, policy, scope) {
    if (!vscode.workspace.workspaceFolders?.length) throw new Error('Open a folder to set a workspace model preference.');
    const configuration = vscode.workspace.getConfiguration(WORKSPACE_PREFERENCE_SECTION);
    const target = vscode.ConfigurationTarget.Workspace;
    if (message.scope === 'profile') {
        await configuration.update('preferredProvider', undefined, target);
        await configuration.update('preferredModel', undefined, target);
        return;
    }
    if (message.scope !== 'workspace') throw new Error('Invalid workspace preference scope.');
    const vendor = message.preferredProvider;
    const modelId = message.preferredModel ?? '';
    if (typeof vendor !== 'string' || !vendor || typeof modelId !== 'string') throw new Error('Invalid workspace model preference.');
    const eligible = getWorkspacePreferenceCandidates(models, policy, scope);
    if (!eligible.some(model => model.vendor === vendor && (!modelId || model.id === modelId))) {
        throw new Error('Workspace preference is not an eligible model in the current scope. Refresh the inventory.');
    }
    await configuration.update('preferredProvider', vendor, target);
    await configuration.update('preferredModel', modelId || undefined, target);
}

// Reads the global exclusion list from globalState and the workspace override from workspace values only.
function getProviderAvailabilityState(context) {
    const stored = context.globalState.get(PROVIDER_AVAILABILITY_KEY);
    const globalDisabledProviders = normalizeProviderIds(stored?.disabledProviders);
    const workspace = readWorkspaceProviderSetting(vscode.workspace.getConfiguration(WORKSPACE_PREFERENCE_SECTION).inspect(WORKSPACE_PROVIDERS_SETTING)?.workspaceValue);
    return { globalDisabledProviders, workspace, effective: resolveProviderAvailability({ globalDisabledProviders, workspace }) };
}

// Built from unfiltered discovery so disabled providers stay visible and can be re-enabled.
function getProviderAvailabilityPayload(context, models) {
    const state = getProviderAvailabilityState(context);
    const counts = new Map();
    for (const model of models) {
        const vendor = normalizeProviderId(model.vendor);
        if (vendor) counts.set(vendor, (counts.get(vendor) || 0) + 1);
    }
    return describeProviderAvailability({
        inventory: [...counts].map(([vendor, modelCount]) => ({ vendor, modelCount })),
        globalDisabledProviders: state.globalDisabledProviders,
        workspace: state.workspace,
        hasWorkspace: Boolean(vscode.workspace.workspaceFolders?.length)
    });
}

const MODEL_CATALOG_ACTIONS = ['setModelSelected', 'setLocalTier', 'setManualPriceTier', 'setProviderSelected', 'setProviderType'];

function toModelSummary(model) {
    return {
        id: model.id,
        name: model.name,
        vendor: model.vendor,
        family: model.family,
        version: model.version,
        inputCost: model.inputCost,
        outputCost: model.outputCost,
        cacheCost: model.cacheCost,
        cacheWriteCost: model.cacheWriteCost,
        priceCategory: model.priceCategory
    };
}

// Raw discovery rows with enablement for both provider scopes. Provider policy never filters discovery before the catalog is built.
function getModelCatalogPayload(context, models) {
    const policy = getInventoryPolicy(context);
    const state = getProviderAvailabilityState(context);
    const globalOnly = resolveProviderAvailability({ globalDisabledProviders: state.globalDisabledProviders });
    const vendors = [...new Set(models.map(model => model.vendor))];
    return {
        catalog: models.map(toModelSummary).map(model => ({
            ...model,
            kind: modelKind(model, policy.localModelVendors, policy.classifications, policy.providerTypes),
            selected: isModelSelected(model, policy.localModelVendors, policy.classifications, policy.selections, policy.providerTypes),
            localTier: policy.localTiers[modelKey(model)] || 'unrated',
            pricing: getManagedPricing(model, policy.localModelVendors, policy.classifications, policy.providerTypes, policy.manualPriceTiers),
            enabled: {
                global: isProviderEnabled(model.vendor, globalOnly),
                workspace: isProviderEnabled(model.vendor, state.effective)
            }
        })),
        providerTypes: Object.fromEntries(vendors.map(vendor => [vendor, isCopilotCloudVendor(vendor) ? 'cloud' : policy.providerTypes[vendor] || (policy.localModelVendors.includes(vendor) ? 'local' : 'unknown')])),
        lockedProviders: vendors.filter(isCopilotCloudVendor)
    };
}

// Writes one model or provider catalog choice. Validation uses the fresh discovery snapshot; the caller refreshes every view.
async function applyModelCatalogChange(context, message, models) {
    const policy = getInventoryPolicy(context);
    const hadSelectedLocalModel = hasSelectedLocalModel(models, policy);
    if (['setModelSelected', 'setLocalTier', 'setManualPriceTier'].includes(message.type)) {
        const model = models.find(item => item.id === message.id && item.vendor === message.vendor);
        if (!model) throw new Error('Model is no longer available. Refresh the inventory.');
        const key = modelKey(model);
        if (message.type === 'setModelSelected') {
            if (typeof message.selected !== 'boolean') throw new Error('Invalid selection.');
            policy.selections = { ...policy.selections, [key]: message.selected };
        } else if (message.type === 'setLocalTier') {
            if (!['unrated', 'simple', 'standard', 'complex'].includes(message.tier)) throw new Error('Invalid local model tier.');
            if (modelKind(model, policy.localModelVendors, policy.classifications, policy.providerTypes) !== 'local') throw new Error('Only local models have capability tiers.');
            policy.localTiers = { ...policy.localTiers, [key]: message.tier };
        } else {
            if (!['unpriced', 'low', 'medium', 'high'].includes(message.tier)) throw new Error('Invalid price tier.');
            if (message.tier !== 'unpriced' && getManagedPricing(model, policy.localModelVendors, policy.classifications, policy.providerTypes).source !== 'unpriced') throw new Error('Manual price tiers apply only to unpriced models.');
            policy.manualPriceTiers = { ...policy.manualPriceTiers };
            if (message.tier === 'unpriced') delete policy.manualPriceTiers[key];
            else policy.manualPriceTiers[key] = message.tier;
        }
    } else {
        const providerModels = models.filter(item => item.vendor === message.vendor);
        if (!providerModels.length) throw new Error('Provider is no longer available. Refresh the inventory.');
        if (message.type === 'setProviderSelected') {
            if (typeof message.selected !== 'boolean') throw new Error('Invalid selection.');
            policy.selections = { ...policy.selections };
            for (const model of providerModels) policy.selections[modelKey(model)] = message.selected;
        } else {
            if (!['cloud', 'local', 'unknown'].includes(message.kind)) throw new Error('Invalid provider type.');
            if (isCopilotCloudVendor(message.vendor)) throw new Error('Copilot providers are always cloud.');
            policy.selections = { ...policy.selections };
            policy.classifications = { ...policy.classifications };
            for (const model of providerModels) {
                const key = modelKey(model);
                policy.selections[key] = isModelSelected(model, policy.localModelVendors, policy.classifications, policy.selections, policy.providerTypes);
                delete policy.classifications[key];
            }
            policy.providerTypes = { ...policy.providerTypes, [message.vendor]: message.kind };
        }
    }
    if (['setModelSelected', 'setProviderSelected', 'setProviderType'].includes(message.type) && hadSelectedLocalModel && !hasSelectedLocalModel(models, policy)) {
        policy.scope = 'cloud';
    }
    await saveInventoryPolicy(context, policy);
}

const PROVIDER_AVAILABILITY_ACTIONS = ['setGlobalProviderEnabled', 'resetGlobalProviderAvailability', 'setWorkspaceProviderMode', 'setWorkspaceProviderEnabled'];

// Validates every provider change. Enabling requires a provider in the current inventory; disabling may remove a stale ID.
async function applyProviderAvailabilityChange(context, message, models) {
    const inventoryVendors = new Set(models.map(model => normalizeProviderId(model.vendor)).filter(Boolean));
    const provider = normalizeProviderId(message.provider);
    const currentState = getProviderAvailabilityState(context);
    if (message.type === 'setGlobalProviderEnabled') {
        if (!provider || typeof message.enabled !== 'boolean') throw new Error('Invalid provider selection.');
        if (message.enabled && !inventoryVendors.has(provider)) throw new Error('Provider is not available. Refresh the provider list.');
        const disabledProviders = message.enabled
            ? currentState.globalDisabledProviders.filter(id => id !== provider)
            : normalizeProviderIds([...currentState.globalDisabledProviders, provider]);
        await context.globalState.update(PROVIDER_AVAILABILITY_KEY, disabledProviders.length ? { disabledProviders } : undefined);
        return;
    }
    if (message.type === 'resetGlobalProviderAvailability') {
        await context.globalState.update(PROVIDER_AVAILABILITY_KEY, undefined);
        return;
    }
    // Workspace changes write only the workspace provider setting.
    if (!vscode.workspace.workspaceFolders?.length) throw new Error('Open a folder to set workspace provider availability.');
    const configuration = vscode.workspace.getConfiguration(WORKSPACE_PREFERENCE_SECTION);
    const target = vscode.ConfigurationTarget.Workspace;
    if (message.type === 'setWorkspaceProviderMode') {
        if (message.mode === 'inherit') {
            await configuration.update(WORKSPACE_PROVIDERS_SETTING, undefined, target);
            return;
        }
        if (message.mode !== 'custom') throw new Error('Invalid workspace provider mode.');
        if (currentState.workspace.mode === 'custom') return;
        // Seed Custom with the providers currently enabled so switching does not change the effective policy.
        const seeded = [...inventoryVendors].filter(vendor => !currentState.globalDisabledProviders.includes(vendor)).sort();
        await configuration.update(WORKSPACE_PROVIDERS_SETTING, seeded, target);
        return;
    }
    if (message.type === 'setWorkspaceProviderEnabled') {
        if (!provider || typeof message.enabled !== 'boolean') throw new Error('Invalid provider selection.');
        if (currentState.workspace.mode !== 'custom') throw new Error('Switch this workspace to Custom before changing its providers.');
        if (message.enabled && !inventoryVendors.has(provider)) throw new Error('Provider is not available. Refresh the provider list.');
        const enabledProviders = message.enabled
            ? normalizeProviderIds([...currentState.workspace.enabledProviders, provider])
            : currentState.workspace.enabledProviders.filter(id => id !== provider);
        await configuration.update(WORKSPACE_PROVIDERS_SETTING, enabledProviders, target);
        return;
    }
    throw new Error('Unknown provider availability action.');
}

function activate(context) {
    context.subscriptions.push(registerModelLearningTools(context));
    context.subscriptions.push(registerSkillProcedureTool(context));
    context.subscriptions.push(registerPriorAssessmentStoreTool(context));
    context.subscriptions.push(vscode.commands.registerCommand('agentRoster.openModelLearning', () => openModelLearning(context)));
    context.subscriptions.push(vscode.commands.registerCommand('agentRoster.openModelInventory', scope => openModelInventory(context, scope)));
    context.subscriptions.push(vscode.commands.registerCommand('agentRoster.changeModelScope', () => changeModelScope(context)));
    context.subscriptions.push(vscode.commands.registerCommand('agentRoster.changeModelPriority', () => changeModelPriority(context)));
    context.subscriptions.push(vscode.commands.registerCommand('agentRoster.pinAdvisorModel', () => pinAdvisorModel(context)));
    const sidebar = createLearningSidebar(context);
    context.subscriptions.push(sidebar, vscode.window.registerTreeDataProvider('agentRoster.modelLearning', sidebar));
    if (typeof vscode.lm.onDidChangeChatModels === 'function') context.subscriptions.push(vscode.lm.onDidChangeChatModels(refreshLearningViews));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('agentRoster.modelLearning.localModelVendors') || event.affectsConfiguration('agentRoster.modelRecommendation')) refreshLearningViews();
    }));
}

function registerModelLearningTools(context) {
    const readTool = vscode.lm.registerTool('aroGetModelRecommendations', {
        prepareInvocation({ input }) {
            return { invocationMessage: `Reading learned model outcomes for ${input.activity} / ${input.domain} / ${input.difficulty}` };
        },
        async invoke({ input }) {
            const policy = getInventoryPolicy(context);
            const availableModels = await vscode.lm.selectChatModels();
            const scope = effectiveModelScope(availableModels, policy);
            const eligibleModels = selectModels(availableModels, policy.localModelVendors, policy.classifications, scope, { ...policy, taskCategory: input.difficulty });
            const manualSelection = getManualSelection(getManualSelections(context), input);
            const models = getAdvisorFilteredModels(context, excludeUnavailableModels(eligibleModels, { excludedModels: input.excludedModels, excludedProviders: input.excludedProviders }), policy, input, manualSelection);
            const scorecard = normalizeScorecard(context.globalState.get(LEARNING_STORAGE_KEY));
            const recommendations = getModelRecommendations(scorecard, {
                ...input,
                manualSelection,
                models: models.map(model => ({
                    id: model.id,
                    name: model.name,
                    vendor: model.vendor,
                    family: model.family,
                    version: model.version,
                    inputCost: model.inputCost,
                    outputCost: model.outputCost,
                    cacheCost: model.cacheCost,
                    cacheWriteCost: model.cacheWriteCost,
                    priceCategory: model.priceCategory
                })),
                getPricing: model => getManagedPricing(model, policy.localModelVendors, policy.classifications, policy.providerTypes, policy.manualPriceTiers),
                getModelKind: model => modelKind(model, policy.localModelVendors, policy.classifications, policy.providerTypes),
                preference: scope === 'both' ? policy.priority === 'local-first' ? 'local' : 'cloud' : undefined,
                workspacePreference: getWorkspacePreference()
            });
            const callId = randomBytes(16).toString('hex');
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(JSON.stringify({ ...compactModelRecommendations(recommendations), callId, modelScope: scope, modelPriority: scope === 'both' ? policy.priority : null }))
            ]);
        }
    });

    const recordTool = vscode.lm.registerTool('aroRecordModelOutcome', {
        prepareInvocation({ input }) {
            return { invocationMessage: `Recording verified ${input.outcome} for ${input.activity} / ${input.domain} / ${input.difficulty}` };
        },
        async invoke({ input }) {
            const scorecard = normalizeScorecard(context.globalState.get(LEARNING_STORAGE_KEY));
            const next = recordOutcome(scorecard, input);
            await context.globalState.update(LEARNING_STORAGE_KEY, next);
            const matching = next.records.filter(record => record.activity === input.activity
                && record.domain === input.domain
                && record.difficulty === input.difficulty
                && record.modelId === input.modelId);
            const successes = matching.filter(record => record.outcome === 'success').length;
            const failures = matching.length - successes;
            refreshLearningViews();
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(JSON.stringify({
                    stored: true,
                    modelId: input.modelId,
                    callId: input.callId,
                    activity: input.activity,
                    domain: input.domain,
                    difficulty: input.difficulty,
                    successes,
                    failures,
                    samples: matching.length,
                    score: Number(((successes + 1) / (matching.length + 2)).toFixed(3))
                }))
            ]);
        }
    });

    return {
        dispose() {
            readTool.dispose();
            recordTool.dispose();
        }
    };
}

// Hardcoded allowlist: the tool takes only a name from this list, never a path, so input cannot traverse the filesystem.
const BUNDLED_SKILLS = Object.freeze(['project-evidence-ingestion', 'project-assessment']);

// The host spills large tool results to a file the caller cannot read, so each call returns one bounded part.
const SKILL_PART_MAX_CHARS = 4000;

function splitSkillText(text) {
    const parts = [];
    let current = '';
    for (let line of text.match(/[^\n]*\n|[^\n]+/g) ?? []) {
        for (; line.length > SKILL_PART_MAX_CHARS; line = line.slice(SKILL_PART_MAX_CHARS)) {
            if (current) parts.push(current);
            current = '';
            parts.push(line.slice(0, SKILL_PART_MAX_CHARS));
        }
        if (current && current.length + line.length > SKILL_PART_MAX_CHARS) {
            parts.push(current);
            current = '';
        }
        current += line;
    }
    if (current) parts.push(current);
    return parts;
}

function registerSkillProcedureTool(context) {
    return vscode.lm.registerTool('aroGetSkillProcedure', {
        prepareInvocation({ input }) {
            return { invocationMessage: `Reading bundled procedure ${input?.skill}${input?.part ? ` part ${input.part}` : ''}` };
        },
        async invoke({ input }) {
            const skill = input?.skill;
            if (!BUNDLED_SKILLS.includes(skill)) throw new Error('Unknown bundled skill.');
            const part = input.part ?? 1;
            const text = await readFile(path.join(context.extensionPath, 'skills', skill, 'SKILL.md'), 'utf8');
            const parts = splitSkillText(text);
            if (!Number.isInteger(part) || part < 1 || part > parts.length) throw new Error(`Invalid part; ${skill} has parts 1 to ${parts.length}.`);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`skill=${skill} part=${part} of ${parts.length}${part < parts.length ? `; call again with part=${part + 1}` : '; final part'}. The next text block is the verbatim procedure segment; concatenate all parts in order.`),
                new vscode.LanguageModelTextPart(parts[part - 1])
            ]);
        }
    });
}

function registerPriorAssessmentStoreTool(context) {
    return vscode.lm.registerTool('aro_read_prior_assessment_store', {
        async prepareInvocation({ input }) {
            return { invocationMessage: `Prepare to select an exact prior assessment SQLite file for ${input.operation === 'search' ? 'searching documents' : 'listing documents'}` };
        },
        async invoke({ input }) {
            const selections = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'SQLite evidence store': ['sqlite', 'db'] },
                title: 'Select the exact prior assessment evidence.sqlite file'
            });
            if (!selections || selections.length !== 1) {
                throw new Error('The user did not select an exact prior assessment SQLite file; no database was opened.');
            }
            const sourcePath = selections[0].fsPath;
            const manifestSelections = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'Adjacent evidence manifest': ['json'] },
                title: 'Optional: select an adjacent manifest JSON explicitly confirming this SQLite corpus'
            });
            const manifestPath = manifestSelections?.length === 1 ? manifestSelections[0].fsPath : undefined;
            const readOnlyOpen = true;
            const result = await loadStore({
                selectedPath: sourcePath,
                manifestPath,
                operation: input.operation,
                query: input.query,
                cursor: input.cursor,
                pageSize: input.pageSize,
                readOnly: true
            });
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(JSON.stringify({
                    ...result,
                    authorization: 'user_selected_exact_file',
                    readOnlyOpen
                }))
            ]);
        }
    });
}

const modelLearningPanels = new WeakMap();

function openModelLearning(context) {
    const existing = modelLearningPanels.get(context);
    if (existing) {
        existing.panel.reveal(vscode.ViewColumn.One);
        void existing.refresh();
        return;
    }
    const panel = vscode.window.createWebviewPanel(
        'agentRosterModelLearning',
        'Aro Model Learning',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );
    const state = { panel, refresh: undefined };
    modelLearningPanels.set(context, state);

    let refreshPromise;
    let refreshRequested = false;
    let inventoryModels = [];
    const refresh = async () => {
        if (refreshPromise) {
            refreshRequested = true;
            return refreshPromise;
        }
        panel.webview.postMessage({ type: 'learningDashboardLoading' });
        refreshPromise = (async () => {
            const policy = getInventoryPolicy(context);
            const models = await selectChatModelsWithTimeout();
            const scorecard = normalizeScorecard(context.globalState.get(LEARNING_STORAGE_KEY));
            const summaries = models.map(toModelSummary);
            inventoryModels = summaries;
            const scope = effectiveModelScope(summaries, policy);
            const getPricing = model => getManagedPricing(model, policy.localModelVendors, policy.classifications, policy.providerTypes, policy.manualPriceTiers);
            const manualSelections = getManualSelections(context);
            const isEnabledInEffectivePolicy = model => isProviderEnabled(model.vendor, policy.providerAvailability);
            const toInventoryRow = model => ({
                ...model,
                kind: modelKind(model, policy.localModelVendors, policy.classifications, policy.providerTypes),
                selected: isModelSelected(model, policy.localModelVendors, policy.classifications, policy.selections, policy.providerTypes),
                localTier: policy.localTiers[modelKey(model)] || 'unrated',
                pricing: getPricing(model)
            });
            panel.webview.postMessage({
                type: 'learningDashboard',
                scope,
                priority: policy.priority,
                hasSelectedLocalModel: hasSelectedLocalModel(summaries, policy),
                models: summaries.filter(isEnabledInEffectivePolicy).map(toInventoryRow),
                dashboard: getContextualLearningDashboard(scorecard, summaries, getPricing, {
                    getModelsForTask: difficulty => selectModels(summaries, policy.localModelVendors, policy.classifications, scope, { ...policy, taskCategory: difficulty }),
                    getManualSelection: context => getManualSelection(manualSelections, context),
                    getModelKind: model => modelKind(model, policy.localModelVendors, policy.classifications, policy.providerTypes),
                    preference: scope === 'both' ? policy.priority === 'local-first' ? 'local' : 'cloud' : undefined,
                    workspacePreference: getWorkspacePreference()
                }),
                pinnedAdvisorModel: getAdvisorPinnedModel(context),
                workspacePreference: getWorkspacePreferenceView(summaries, policy, scope),
                recordCount: scorecard.records.length
            });
        })().catch(error => {
            panel.webview.postMessage({ type: 'learningDashboardError', error: error instanceof Error ? error.message : String(error) });
        }).finally(() => {
            refreshPromise = undefined;
            if (refreshRequested) {
                refreshRequested = false;
                void refresh();
            }
        });
        return refreshPromise;
    };

    dashboardRefreshers.add(refresh);
    panel.webview.onDidReceiveMessage(message => {
        if (message.type === 'ready' || message.type === 'refreshLearning') void refresh();
        if (message.type === 'openModelInventory') {
            void vscode.commands.executeCommand('agentRoster.openModelInventory');
            return;
        }
        if (message.type === 'setWorkspacePreference') {
            void enqueueInventoryUpdate(async () => {
                const policy = getInventoryPolicy(context);
                const scope = effectiveModelScope(inventoryModels, policy);
                await applyWorkspacePreference(message, inventoryModels, policy, scope);
                if (refreshPromise) await refreshPromise;
                refreshLearningViews();
            }).catch(error => {
                panel.webview.postMessage({ type: 'learningDashboardError', error: error instanceof Error ? error.message : String(error) });
            });
            return;
        }
        if (message.type === 'setAdvisorPinnedModel') {
            void enqueueInventoryUpdate(async () => {
                await applyAdvisorPinnedModel(context, message.model, {
                    excludedModels: message.excludedModels,
                    excludedProviders: message.excludedProviders
                });
                if (refreshPromise) await refreshPromise;
                refreshLearningViews();
            }).catch(error => {
                panel.webview.postMessage({ type: 'learningDashboardError', error: error instanceof Error ? error.message : String(error) });
            });
            return;
        }
        if (['chooseManualModel', 'useLearnedModel'].includes(message.type)) {
            void enqueueInventoryUpdate(async () => {
                const learningContext = {
                    activity: message.activity,
                    domain: message.domain,
                    difficulty: message.difficulty
                };
                if (!ACTIVITIES.includes(learningContext.activity) || !DOMAINS.includes(learningContext.domain)
                    || !TASK_CATEGORIES.includes(learningContext.difficulty)) throw new Error('Invalid recommendation context.');
                const selections = getManualSelections(context).filter(selection => !(
                    selection.activity === learningContext.activity
                    && selection.domain === learningContext.domain
                    && selection.difficulty === learningContext.difficulty));
                if (message.type === 'chooseManualModel') {
                    const policy = getInventoryPolicy(context);
                    const scope = effectiveModelScope(inventoryModels, policy);
                    const eligibleModels = selectModels(inventoryModels, policy.localModelVendors, policy.classifications, scope, {
                        ...policy,
                        taskCategory: learningContext.difficulty
                    });
                    const scorecard = normalizeScorecard(context.globalState.get(LEARNING_STORAGE_KEY));
                    const recommendations = getModelRecommendations(scorecard, {
                        ...learningContext,
                        models: eligibleModels,
                        getPricing: model => getManagedPricing(model, policy.localModelVendors, policy.classifications, policy.providerTypes, policy.manualPriceTiers),
                        getModelKind: model => modelKind(model, policy.localModelVendors, policy.classifications, policy.providerTypes),
                        preference: scope === 'both' ? policy.priority === 'local-first' ? 'local' : 'cloud' : undefined,
                        workspacePreference: getWorkspacePreference()
                    });
                    const choices = recommendations.candidates.filter(candidate => Number.isFinite(candidate.cost)).map(candidate => ({
                        label: candidate.name,
                        description: candidate.vendor,
                        detail: `${candidate.pricing.budgetClass}; ${candidate.samples} exact / ${candidate.pooledSamples} pooled outcomes`,
                        modelId: candidate.id,
                        vendor: candidate.vendor
                    }));
                    if (!choices.length) throw new Error('No eligible priced models are available for this context and scope.');
                    const choice = await vscode.window.showQuickPick(choices, {
                        title: `Manual model: ${learningContext.activity} / ${learningContext.domain} / ${learningContext.difficulty}`,
                        placeHolder: 'Choose a model for this context'
                    });
                    if (!choice) {
                        refreshLearningViews();
                        return;
                    }
                    selections.push({ ...learningContext, modelId: choice.modelId, vendor: choice.vendor });
                }
                await context.globalState.update(MANUAL_SELECTIONS_KEY, selections);
                if (refreshPromise) await refreshPromise;
                refreshLearningViews();
            }).catch(error => {
                panel.webview.postMessage({ type: 'learningDashboardError', error: error instanceof Error ? error.message : String(error) });
            });
            return;
        }
        if (['setModelScope', 'setModelPriority'].includes(message.type)) {
            void enqueueInventoryUpdate(async () => {
                const policy = getInventoryPolicy(context);
                if (message.type === 'setModelScope') {
                    if (!['cloud', 'local', 'both'].includes(message.scope)) throw new Error('Invalid model scope.');
                    if (message.scope !== 'cloud' && !hasSelectedLocalModel(inventoryModels, policy)) throw new Error('Select a local model before using this scope.');
                    policy.scope = message.scope;
                } else {
                    if (!['local-first', 'cloud-first'].includes(message.priority)) throw new Error('Invalid model priority.');
                    if (effectiveModelScope(inventoryModels, policy) !== 'both') throw new Error('Model priority is available only when both scopes are selected.');
                    policy.priority = message.priority;
                }
                await saveInventoryPolicy(context, policy);
                if (refreshPromise) await refreshPromise;
                refreshLearningViews();
            }).catch(error => {
                panel.webview.postMessage({ type: 'learningDashboardError', error: error instanceof Error ? error.message : String(error) });
            });
        }
    }, null, context.subscriptions);
    state.refresh = refresh;
    panel.onDidDispose(() => {
        dashboardRefreshers.delete(refresh);
        if (modelLearningPanels.get(context) === state) modelLearningPanels.delete(context);
    }, null, context.subscriptions);
    panel.webview.html = getLearningHtml(panel.webview, context.extensionUri);
}

// One Model Inventory panel per extension context. Writes go through validated handlers; each successful save refreshes recommendations and the dashboard.
// Opening again reveals and refreshes the existing panel instead of creating a duplicate; disposal clears the reference.
const MODEL_INVENTORY_SCOPES = ['global', 'workspace'];
const modelInventoryPanels = new WeakMap();

function openModelInventory(context, scope = 'global') {
    const requestedScope = MODEL_INVENTORY_SCOPES.includes(scope) ? scope : 'global';
    const existing = modelInventoryPanels.get(context);
    if (existing) {
        existing.scope = requestedScope;
        existing.panel.reveal(vscode.ViewColumn.One);
        existing.panel.webview.postMessage({ type: 'selectScope', scope: requestedScope });
        void existing.refresh();
        return;
    }
    const panel = vscode.window.createWebviewPanel(
        'agentRosterModelInventory',
        'Aro Model Inventory',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );
    const state = { panel, scope: requestedScope, refresh: undefined };
    modelInventoryPanels.set(context, state);
    let requestId = 0;
    const refresh = async () => {
        const current = ++requestId;
        panel.webview.postMessage({ type: 'providerAvailabilityLoading' });
        let models = [];
        let inventoryError = '';
        try {
            models = await selectChatModelsWithTimeout();
        } catch (error) {
            inventoryError = error instanceof Error ? error.message : String(error);
        }
        if (current !== requestId) return;
        try {
            panel.webview.postMessage({ type: 'providerAvailability', inventoryError, ...getProviderAvailabilityPayload(context, models), ...getModelCatalogPayload(context, models) });
        } catch (error) {
            panel.webview.postMessage({ type: 'providerAvailabilityError', error: error instanceof Error ? error.message : String(error) });
        }
    };
    state.refresh = refresh;
    dashboardRefreshers.add(refresh);
    panel.webview.onDidReceiveMessage(message => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'ready') {
            panel.webview.postMessage({ type: 'selectScope', scope: state.scope });
            void refresh();
            return;
        }
        if (message.type === 'refreshProviderAvailability') {
            void refresh();
            return;
        }
        const isCatalogAction = MODEL_CATALOG_ACTIONS.includes(message.type);
        if (!isCatalogAction && !PROVIDER_AVAILABILITY_ACTIONS.includes(message.type)) {
            panel.webview.postMessage({ type: 'providerAvailabilityError', error: 'Unknown provider availability action.' });
            return;
        }
        void enqueueInventoryUpdate(async () => {
            const models = await selectChatModelsWithTimeout();
            if (isCatalogAction) await applyModelCatalogChange(context, message, models);
            else await applyProviderAvailabilityChange(context, message, models);
            refreshLearningViews();
        }).catch(error => {
            panel.webview.postMessage({ type: 'providerAvailabilityError', error: error instanceof Error ? error.message : String(error) });
            void refresh();
        });
    }, null, context.subscriptions);
    panel.onDidDispose(() => {
        dashboardRefreshers.delete(refresh);
        if (modelInventoryPanels.get(context) === state) modelInventoryPanels.delete(context);
    }, null, context.subscriptions);
    panel.webview.html = getModelInventoryHtml(panel.webview, context.extensionUri);
}

function getModelInventoryHtml(webview, extensionUri) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'provider-availability.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'model-learning-dashboard.css'));
    const nonce = randomBytes(16).toString('base64');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Aro Model Inventory</title>
</head>
<body>
  <header>
    <h1>Aro Model Inventory</h1>
    <p>Choose which providers Aro may use. The Global list applies to every workspace; a Workspace override replaces it in this workspace only.</p>
  </header>
  <main>
    <div id="provider-status" class="model-load-status is-loading" role="status" aria-live="polite" aria-busy="true">
      <span id="provider-message">Loading model inventory...</span>
      <button id="refresh-providers" type="button">Refresh</button>
    </div>
    <div id="scope-tabs" class="page-tabs" role="tablist" aria-label="Inventory scope">
      <button id="scope-tab-global" type="button" role="tab" aria-selected="true" aria-controls="global-scope" data-scope="global" tabindex="0">Global</button>
      <button id="scope-tab-workspace" type="button" role="tab" aria-selected="false" aria-controls="workspace-scope" data-scope="workspace" tabindex="-1">Workspace</button>
    </div>
    <section id="global-scope" class="view-panel provider-section" role="tabpanel" aria-labelledby="scope-tab-global">
      <div class="toolbar"><h2>Global (all workspaces)</h2><button id="reset-global" type="button">Reset to All</button></div>
      <p id="global-summary" class="provider-summary"></p>
      <p class="provider-hint">Unchecked providers are excluded in every workspace unless that workspace uses a custom list.</p>
      <div class="table-wrap"><table><thead><tr><th>Enabled</th><th>Provider</th><th>Models</th><th>Global state</th></tr></thead><tbody id="global-providers"></tbody></table></div>
    </section>
    <section id="workspace-scope" class="view-panel provider-section" role="tabpanel" aria-labelledby="scope-tab-workspace" hidden>
      <h2>This workspace</h2>
      <p id="effective-summary" class="provider-summary"></p>
      <fieldset class="provider-mode" id="workspace-mode">
        <legend>Workspace override</legend>
        <label><input type="radio" name="workspace-mode" value="inherit"> Inherit global</label>
        <label><input type="radio" name="workspace-mode" value="custom"> Custom</label>
      </fieldset>
      <p id="workspace-note" class="provider-hint" aria-live="polite"></p>
      <div class="table-wrap"><table><thead><tr><th>Enabled</th><th>Provider</th><th>Models</th><th>Global state</th><th>Effective here</th></tr></thead><tbody id="workspace-providers"></tbody></table></div>
    </section>
    <section id="model-catalog" class="catalog-section" aria-labelledby="catalog-heading">
      <div class="toolbar"><h2 id="catalog-heading">Models</h2><span id="model-count-label">0 models</span></div>
      <p id="catalog-scope" class="provider-hint" aria-live="polite"></p>
      <div class="inventory-content">
        <div class="provider-policy"><p id="provider-policy-note" class="provider-hint" aria-live="polite"></p><label><input id="show-excluded" type="checkbox"> Show excluded providers and models</label></div>
        <label class="inventory-search">Search models <input id="model-search" type="search" placeholder="Name or provider"></label>
        <h3>Providers</h3>
        <div class="table-wrap"><table><thead><tr><th>Provider</th><th>Model selection</th><th>Type</th></tr></thead><tbody id="providers"></tbody></table></div>
        <h3>Models</h3>
        <div class="table-wrap"><table><thead><tr><th>Use</th><th>Model</th><th>Provider / family</th><th>Tier</th><th>Price / 1M tokens</th><th>Source</th></tr></thead><tbody id="models"></tbody></table></div>
      </div>
    </section>
  </main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

async function selectChatModelsWithTimeout() {
    let timeout;
    try {
        return await Promise.race([
            vscode.lm.selectChatModels(),
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error(
                    'Model discovery timed out after 15 seconds. Check Copilot sign-in and model provider availability, then refresh.'
                )), MODEL_DISCOVERY_TIMEOUT_MS);
            })
        ]);
    } finally {
        clearTimeout(timeout);
    }
}

function getLearningHtml(webview, extensionUri) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'model-learning-dashboard.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'model-learning-dashboard.css'));
    const nonce = randomBytes(16).toString('base64');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
    <title>Aro Model Learning</title>
</head>
<body>
  <header>
        <h1>Aro Model Learning</h1>
                <p>Recommendations learn from verified outcomes for each activity, domain, and difficulty.</p>
  </header>
        <p class="notice">Aro stores context labels, the requested model ID, verified outcome code, and optional measured duration or cost. It stores no prompts or responses. Tool and environment failures are not model failures; runtime model resolution is not independently verified.</p>
  <main>
            <div id="learning-status" class="model-load-status is-loading" role="status" aria-live="polite" aria-busy="true">
                <span id="learning-message">Loading Aro's scorecard...</span>
            </div>
        <section id="recommendations-view" class="view-panel">
            <div class="toolbar"><div class="recommendations-heading"><h2>Learned recommendations</h2><div class="advisor-default"><label for="advisor-default-model">Aro &amp; advisors default</label><select id="advisor-default-model"></select></div></div><div class="recommendations-actions"><button id="open-model-inventory" type="button">Model Inventory</button><button id="refresh-learning" type="button">Refresh</button></div></div>
            <fieldset class="scope-controls" id="model-scope"><legend>Model scope</legend><label><input type="radio" name="model-scope" value="cloud"> Cloud only</label><label><input type="radio" name="model-scope" value="local" disabled> Local only</label><label><input type="radio" name="model-scope" value="both" disabled> Both</label><label for="model-priority">Priority <select id="model-priority" disabled><option value="cloud-first">Cloud first</option><option value="local-first">Local first</option></select></label></fieldset>
            <fieldset class="workspace-preference" id="workspace-preference"><legend>Workspace model preference</legend><div class="preference-scope" role="radiogroup" aria-label="Preference scope"><label><input type="radio" name="preference-scope" id="preference-scope-profile" value="profile" checked> Profile</label><label><input type="radio" name="preference-scope" id="preference-scope-workspace" value="workspace"> Workspace</label></div><div class="preference-fields" id="workspace-preference-fields"><label>Provider <select id="workspace-provider"></select></label><label>Model <select id="workspace-model"></select></label><button id="clear-workspace-preference" type="button">Reset to profile</button></div><p id="workspace-preference-status" class="preference-status" aria-live="polite"></p></fieldset>
            <fieldset class="context-controls" id="learning-context"><legend>Filter recommendation table</legend><div class="activity-filter"><span id="domain-filter-label">Domain</span><div id="domain-tabs" class="activity-tabs" role="tablist" aria-labelledby="domain-filter-label"></div></div><div class="activity-filter"><span id="activity-filter-label">Activity</span><div id="activity-tabs" class="activity-tabs" role="tablist" aria-labelledby="activity-filter-label"></div></div></fieldset>
            <p id="context-count" class="context-count" aria-live="polite"></p>
            <div class="table-wrap" id="recommendations-panel" role="tabpanel" aria-labelledby="activity-tab-all" tabindex="0"><table><thead><tr><th id="context-activity-heading">Activity</th><th id="context-domain-heading">Domain</th><th id="context-difficulty-heading">Difficulty</th><th>Recommended model</th><th>Evidence</th><th>Price</th></tr></thead><tbody id="recommendations"></tbody></table></div>
        </section>
  </main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function deactivate() { }

module.exports = { activate, deactivate, registerPriorAssessmentStoreTool };