(() => {
    const vscode = acquireVsCodeApi();
    const activityLabels = { advise: 'Advise', implement: 'Implement', analyze: 'Analyze', review: 'Review', document: 'Document', operate: 'Operate' };
    const domainLabels = {
        coding: 'Coding', business: 'Business', 'documentation-governance': 'Documentation and governance',
        infrastructure: 'Infrastructure', 'cross-domain': 'Cross-domain'
    };
    let models = [];
    let dashboard = [];
    let activeActivity = 'all';
    let activeDomain = 'all';
    let scope = 'both';
    let priority = 'cloud-first';
    let hasSelectedLocalModel = false;
    let pinnedAdvisorModel = null;
    let workspacePreference = normalizeWorkspacePreference(null);
    let preferenceScope = 'profile';
    let learningLoading = false;
    let activeEvaluationType = 'evaluation';
    let evaluationTrials = [];

    const byId = id => document.getElementById(id);

    function renderFilterTabs(containerId, prefix, selected, labels, onSelect) {
        const container = byId(containerId);
        container.replaceChildren();
        const options = [['all', 'All'], ...Object.entries(labels)];
        for (const [value, label] of options) {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.id = `${prefix}-${value}`;
            tab.dataset.filterValue = value;
            tab.textContent = label;
            tab.tabIndex = value === selected ? 0 : -1;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(value === selected));
            tab.setAttribute('aria-controls', 'recommendations-panel');
            tab.addEventListener('click', () => onSelect(value, true));
            tab.addEventListener('keydown', event => {
                const index = options.findIndex(([option]) => option === value);
                const nextIndex = event.key === 'ArrowRight' ? (index + 1) % options.length
                    : event.key === 'ArrowLeft' ? (index - 1 + options.length) % options.length
                        : event.key === 'Home' ? 0
                            : event.key === 'End' ? options.length - 1 : -1;
                if (nextIndex < 0) return;
                event.preventDefault();
                onSelect(options[nextIndex][0], true);
            });
            container.append(tab);
        }
    }

    function renderActivityTabs() {
        renderFilterTabs('activity-tabs', 'activity-tab', activeActivity, activityLabels, selectActivity);
    }

    function renderDomainTabs() {
        renderFilterTabs('domain-tabs', 'domain-tab', activeDomain, domainLabels, selectDomain);
    }

    function renderEvaluationTabs() {
        const container = byId('evaluation-tabs');
        if (!container) return;
        container.replaceChildren();
        
        const tabs = [
            ['evaluation', 'Model Evaluation'], 
            ['all', 'All']
        ];
        
        for (const [value, label] of tabs) {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.id = `evaluation-tab-${value}`;
            tab.dataset.filterValue = value;
            tab.textContent = label;
            tab.tabIndex = value === activeEvaluationType ? 0 : -1;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(value === activeEvaluationType));
            tab.setAttribute('aria-controls', 'evaluation-panel');
            tab.addEventListener('click', () => selectEvaluationType(value, true));
            tab.addEventListener('keydown', event => {
                const index = tabs.findIndex(([option]) => option === value);
                const nextIndex = event.key === 'ArrowRight' ? (index + 1) % tabs.length
                    : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
                        : event.key === 'Home' ? 0
                            : event.key === 'End' ? tabs.length - 1 : -1;
                if (nextIndex < 0) return;
                event.preventDefault();
                selectEvaluationType(tabs[nextIndex][0], true);
            });
            container.append(tab);
        }
    }

    function selectActivity(activity, focus = false) {
        activeActivity = activity;
        renderActivityTabs();
        if (focus) Array.from(byId('activity-tabs').children).find(tab => tab.dataset.filterValue === activity)?.focus();
        renderDashboard();
    }

    function selectDomain(domain, focus = false) {
        activeDomain = domain;
        renderDomainTabs();
        if (focus) Array.from(byId('domain-tabs').children).find(tab => tab.dataset.filterValue === domain)?.focus();
        renderDashboard();
    }

    function selectEvaluationType(type, focus = false) {
        activeEvaluationType = type;
        renderEvaluationTabs();
        renderEvaluationDashboard();
        
        if (focus) {
            const tab = document.querySelector(`#evaluation-tab-${type}`);
            if (tab) tab.focus();
        }
    }

    function renderDashboard() {
        const body = byId('recommendations');
        body.replaceChildren();
        const matchingRows = dashboard.filter(item => (activeActivity === 'all' || item.activity === activeActivity)
            && (activeDomain === 'all' || item.domain === activeDomain));
        byId('context-activity-heading').hidden = activeActivity !== 'all';
        byId('context-domain-heading').hidden = activeDomain !== 'all';
        byId('recommendations-panel').setAttribute('aria-labelledby', `activity-tab-${activeActivity} domain-tab-${activeDomain}`);
        byId('context-count').textContent = `Showing ${matchingRows.length} of ${dashboard.length} contexts`;
        for (const cell of matchingRows) {
            const row = document.createElement('tr');
            const activityCell = document.createElement('td');
            activityCell.hidden = activeActivity !== 'all';
            activityCell.textContent = activityLabels[cell.activity];
            const domainCell = document.createElement('td');
            domainCell.hidden = activeDomain !== 'all';
            domainCell.textContent = domainLabels[cell.domain];
            const difficultyCell = document.createElement('td');
            const difficultyLabel = `${cell.difficulty[0].toUpperCase()}${cell.difficulty.slice(1)}`;
            difficultyCell.textContent = difficultyLabel;
            const recommendation = document.createElement('td');
            const recommended = cell.candidates.find(model => model.id === cell.recommendedModelId
                && (!cell.recommendedVendor || model.vendor === cell.recommendedVendor));
            const learnedRecommendation = cell.candidates.find(model => model.id === cell.learnedRecommendedModelId
                && model.vendor === cell.learnedRecommendedVendor);
            const manualModel = cell.manualSelection && models.find(model => model.id === cell.manualSelection.modelId
                && model.vendor === cell.manualSelection.vendor);
            const manualChoice = document.createElement('button');
            manualChoice.type = 'button';
            manualChoice.className = 'manual-model-selection';
            manualChoice.textContent = cell.manualSelection
                ? cell.selectionMode === 'manual-unavailable'
                    ? `Unavailable: ${manualModel?.name || cell.manualSelection.modelId} (${manualModel?.vendor || cell.manualSelection.vendor})`
                    : `${manualModel?.name || cell.manualSelection.modelId} (${manualModel?.vendor || cell.manualSelection.vendor})`
                : recommended ? `${recommended.name} (${recommended.vendor})` : 'Choose model';
            manualChoice.setAttribute('aria-label', `${cell.manualSelection ? 'Change' : 'Choose'} manual model for ${activityLabels[cell.activity]}, ${domainLabels[cell.domain]}, ${difficultyLabel}`);
            const selectionMode = cell.selectionMode === 'manual' ? 'Manual override'
                : cell.selectionMode === 'manual-unavailable' ? 'Manual pin unavailable'
                    : cell.selectionMode === 'pooled' ? 'Pooled evidence'
                        : recommended?.selectionMode === 'explore' ? 'Exploring'
                            : recommended?.evidenceSource === 'mixed' ? 'Exact and pooled evidence'
                                : recommended ? 'Exact evidence' : 'Fallback';
            const priceSource = recommended?.pricing?.budgetClass === 'unpriced' || recommended?.pricing?.source === 'unpriced'
                ? 'Unknown'
                : recommended?.pricing?.source === 'vscode'
                    ? 'Native rate'
                    : recommended?.pricing?.source === 'snapshot'
                        ? `Rate snapshot ${recommended.pricing.snapshotDate}`
                        : recommended?.pricing?.source === 'local'
                            ? 'Local (no token charge)'
                            : recommended?.pricing?.source === 'manual'
                                ? 'Manual tier'
                                : 'Unknown';
            manualChoice.title = [
                `Selection mode: ${selectionMode}`,
                cell.manualSelection && learnedRecommendation ? `Learned suggestion: ${learnedRecommendation.name} (${learnedRecommendation.vendor})` : null,
                Number.isFinite(recommended?.averageDurationMs) ? `Average measured duration: ${Math.round(recommended.averageDurationMs)} ms` : null,
                Number.isFinite(recommended?.averageCostUsd) ? `Average measured cost: ${new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(recommended.averageCostUsd)}` : null,
                `Price source: ${priceSource}`
            ].filter(Boolean).join('\n');
            manualChoice.addEventListener('click', () => {
                setStatus('Opening manual model picker...', 'is-loading');
                vscode.postMessage({ type: 'chooseManualModel', activity: cell.activity, domain: cell.domain, difficulty: cell.difficulty });
            });
            recommendation.append(manualChoice);
            let reset;
            if (cell.manualSelection) {
                reset = document.createElement('button');
                reset.type = 'button';
                reset.className = 'use-learned-model';
                reset.textContent = 'X';
                reset.title = 'Clear manual selection';
                reset.setAttribute('aria-label', `Clear manual selection for ${activityLabels[cell.activity]}, ${domainLabels[cell.domain]}, ${difficultyLabel}`);
                reset.addEventListener('click', () => {
                    setStatus('Restoring learned recommendation...', 'is-loading');
                    vscode.postMessage({ type: 'useLearnedModel', activity: cell.activity, domain: cell.domain, difficulty: cell.difficulty });
                });
                recommendation.append(reset);
            }
            if (cell.manualSelection) {
                const learnedLabel = document.createElement('small');
                learnedLabel.textContent = learnedRecommendation
                    ? `Suggested: ${learnedRecommendation.name} (${learnedRecommendation.vendor})`
                    : 'No learned suggestion available';
                recommendation.append(learnedLabel);
            }
            const price = document.createElement('td');
            price.textContent = recommended?.pricing?.budgetClass === 'unpriced'
                ? 'Unknown'
                : recommended?.pricing?.budgetClass || 'Unknown';
            price.title = `Price source: ${priceSource}${recommended?.pricing?.snapshotDate ? ` (${recommended.pricing.snapshotDate})` : ''}`;
            const evidence = document.createElement('td');
            const sampleCount = document.createElement('div');
            sampleCount.textContent = recommended
                ? `${recommended.samples} exact / ${recommended.pooledSamples} pooled`
                : `${cell.sampleCount} exact / ${cell.pooledSampleCount} pooled overall`;
            const quality = document.createElement('small');
            quality.textContent = recommended
                ? `${recommended.successes} pass / ${recommended.failures} fail; ${Math.round(recommended.score * 100)}% smoothed score`
                : cell.selectionMode === 'manual-unavailable' ? 'Pinned model unavailable'
                    : cell.difficulty === 'complex' && cell.eligibleCount ? 'Needs 2 exact or 4 pooled outcomes' : 'No outcome evidence';
            evidence.title = 'The smoothed score is a ranking signal, not a probability.';
            evidence.append(sampleCount, quality);
            row.append(activityCell, domainCell, difficultyCell, recommendation, evidence, price);
            body.append(row);
        }
    }

    function advisorOptionValue(model) {
        return JSON.stringify([model.vendor, model.modelId ?? model.id]);
    }

    function renderAdvisorDefault() {
        const select = byId('advisor-default-model');
        select.replaceChildren();
        const learned = document.createElement('option');
        learned.value = '';
        learned.textContent = 'Learned recommendations';
        select.append(learned);
        for (const model of models) {
            const option = document.createElement('option');
            option.value = advisorOptionValue(model);
            option.textContent = `${model.name} (${model.vendor})`;
            select.append(option);
        }
        if (pinnedAdvisorModel && !models.some(model => model.id === pinnedAdvisorModel.modelId && model.vendor === pinnedAdvisorModel.vendor)) {
            const unavailable = document.createElement('option');
            unavailable.value = advisorOptionValue(pinnedAdvisorModel);
            unavailable.textContent = `Unavailable: ${pinnedAdvisorModel.modelId} (${pinnedAdvisorModel.vendor})`;
            select.append(unavailable);
        }
        select.value = pinnedAdvisorModel ? advisorOptionValue(pinnedAdvisorModel) : '';
    }

    function normalizeWorkspacePreference(value) {
        const providers = Array.isArray(value?.providers)
            ? value.providers.filter(provider => typeof provider?.vendor === 'string' && Array.isArray(provider.models))
            : [];
        return {
            hasWorkspace: value?.hasWorkspace === true,
            active: value?.active === true,
            invalid: value?.invalid === true,
            preferredProvider: typeof value?.preferredProvider === 'string' ? value.preferredProvider : '',
            preferredModel: typeof value?.preferredModel === 'string' ? value.preferredModel : '',
            providerAvailable: value?.providerAvailable !== false,
            modelAvailable: value?.modelAvailable !== false,
            providers
        };
    }

    function createOption(value, label) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        return option;
    }

    function syncPreferenceScope() {
        if (workspacePreference.active) preferenceScope = 'workspace';
    }

    function describeWorkspacePreference() {
        const state = workspacePreference;
        if (!state.hasWorkspace) return 'Open a folder to set a workspace preference. Profile recommendations apply; user settings are not changed.';
        if (!state.active && !state.providers.length) return 'No eligible discovered model is available for a workspace preference in this scope. Select models in the inventory first.';
        if (preferenceScope === 'workspace' && !state.active) return 'Choose a provider to save a workspace preference. Until then, profile recommendations apply.';
        if (!state.active) return 'Profile: no workspace preference. Learned and manual profile recommendations apply.';
        if (state.invalid) return 'The saved workspace setting names a model without a provider, so Aro ignores it. Reset to profile to clear it.';
        if (!state.providerAvailable) return `Workspace preference: ${state.preferredProvider} has no eligible model in this scope, so Aro ignores it until one is eligible.`;
        if (!state.modelAvailable) return `Workspace preference: ${state.preferredModel} is not eligible in this scope, so Aro ignores it.`;
        const provider = state.providers.find(item => item.vendor === state.preferredProvider);
        const model = provider?.models.find(item => item.id === state.preferredModel);
        const target = state.preferredModel ? `${state.preferredProvider} / ${model?.name || state.preferredModel}` : `${state.preferredProvider} (any eligible model)`;
        return `Workspace preference: ${target}. Aro prefers it among eligible models; manual selections still take precedence.`;
    }

    function renderWorkspacePreference() {
        const state = workspacePreference;
        byId('preference-scope-profile').checked = preferenceScope === 'profile';
        byId('preference-scope-workspace').checked = preferenceScope === 'workspace';
        byId('workspace-preference-fields').hidden = preferenceScope !== 'workspace';
        const providerSelect = byId('workspace-provider');
        providerSelect.replaceChildren();
        if (!state.preferredProvider) providerSelect.append(createOption('', 'Choose provider'));
        for (const provider of state.providers) providerSelect.append(createOption(provider.vendor, provider.vendor));
        if (state.preferredProvider && !state.providerAvailable) providerSelect.append(createOption(state.preferredProvider, `Unavailable: ${state.preferredProvider}`));
        providerSelect.value = state.preferredProvider;
        const selectedProvider = providerSelect.value;
        const provider = state.providers.find(item => item.vendor === selectedProvider);
        const matchesSaved = selectedProvider === state.preferredProvider;
        const modelSelect = byId('workspace-model');
        modelSelect.replaceChildren(createOption('', 'Any eligible model'));
        for (const model of provider?.models || []) modelSelect.append(createOption(model.id, model.name));
        if (matchesSaved && state.preferredModel && !state.modelAvailable) modelSelect.append(createOption(state.preferredModel, `Unavailable: ${state.preferredModel}`));
        modelSelect.value = matchesSaved ? state.preferredModel : '';
        byId('workspace-preference-status').textContent = describeWorkspacePreference();
        updateWorkspacePreferenceControls();
    }

    function updateWorkspacePreferenceControls() {
        const state = workspacePreference;
        const locked = learningLoading || !state.hasWorkspace;
        byId('preference-scope-profile').disabled = locked;
        byId('preference-scope-workspace').disabled = locked;
        byId('workspace-provider').disabled = locked || !state.providers.length;
        byId('workspace-model').disabled = locked || !byId('workspace-provider').value;
        byId('clear-workspace-preference').disabled = locked || !state.active;
    }

    function saveWorkspacePreference(preferredProvider, preferredModel) {
        preferenceScope = 'workspace';
        setStatus('Saving workspace model preference...', 'is-loading');
        vscode.postMessage({ type: 'setWorkspacePreference', scope: 'workspace', preferredProvider, preferredModel });
    }

    function resetWorkspacePreference() {
        preferenceScope = 'profile';
        if (!workspacePreference.active) {
            renderWorkspacePreference();
            return;
        }
        setStatus('Restoring profile recommendations...', 'is-loading');
        vscode.postMessage({ type: 'setWorkspacePreference', scope: 'profile' });
    }

    function setStatus(message, state) {
        learningLoading = state === 'is-loading';
        const status = byId('learning-status');
        status.className = `model-load-status ${state}`;
        status.setAttribute('aria-busy', String(state === 'is-loading'));
        byId('learning-message').textContent = message;
        byId('refresh-learning').disabled = state === 'is-loading';
        byId('advisor-default-model').disabled = state === 'is-loading';
        byId('model-priority').disabled = state === 'is-loading' || scope !== 'both' || !hasSelectedLocalModel;
        for (const control of document.querySelectorAll('#model-scope input')) {
            control.disabled = state === 'is-loading'
                || (control.name === 'model-scope' && control.value !== 'cloud' && !hasSelectedLocalModel);
        }
        updateWorkspacePreferenceControls();
    }

    function refresh() {
        setStatus('Updating recommendations from Aro’s recent outcomes...', 'is-loading');
        vscode.postMessage({ type: 'refreshLearning' });
    }

    byId('refresh-learning').addEventListener('click', refresh);
    byId('advisor-default-model').addEventListener('change', () => {
        const value = byId('advisor-default-model').value;
        const [vendor, modelId] = value ? JSON.parse(value) : [];
        setStatus('Saving Aro and advisor default model...', 'is-loading');
        vscode.postMessage({ type: 'setAdvisorPinnedModel', model: value ? { modelId, vendor } : null });
    });
    byId('open-model-inventory').addEventListener('click', () => vscode.postMessage({ type: 'openModelInventory' }));
    byId('open-model-evaluation').addEventListener('click', () => vscode.postMessage({ type: 'openModelEvaluation' }));
    renderActivityTabs();
    renderDomainTabs();
    renderEvaluationTabs();
    byId('model-scope').addEventListener('change', event => {
        if (event.target.name !== 'model-scope') return;
        setStatus('Saving model scope...', 'is-loading');
        vscode.postMessage({ type: 'setModelScope', scope: event.target.value });
    });
    byId('model-priority').addEventListener('change', event => {
        if (scope !== 'both') return;
        setStatus('Saving model priority...', 'is-loading');
        vscode.postMessage({ type: 'setModelPriority', priority: event.target.value });
    });
    byId('preference-scope-profile').addEventListener('change', resetWorkspacePreference);
    byId('clear-workspace-preference').addEventListener('click', resetWorkspacePreference);
    byId('preference-scope-workspace').addEventListener('change', () => {
        preferenceScope = 'workspace';
        renderWorkspacePreference();
    });
    byId('workspace-provider').addEventListener('change', () => {
        const vendor = byId('workspace-provider').value;
        if (vendor) saveWorkspacePreference(vendor, '');
    });
    byId('workspace-model').addEventListener('change', () => {
        saveWorkspacePreference(byId('workspace-provider').value, byId('workspace-model').value);
    });
    function renderEvaluationDashboard() {
        const container = byId('evaluation-panel');
        if (!container) return;
        container.replaceChildren();

        if (!evaluationTrials.length) {
            const message = document.createElement('div');
            message.className = 'evaluation-message';
            message.textContent = 'No completed trials yet. Run the fixed backend-advisor evaluation to store two trials per selected candidate.';
            container.appendChild(message);
            return;
        }

        const list = document.createElement('div');
        list.className = 'table-wrap';
        const table = document.createElement('table');
        table.innerHTML = '<thead><tr><th>Requested model</th><th>Trial</th><th>Status</th><th>Outcome</th><th>Duration</th><th>Resolved identity</th></tr></thead><tbody></tbody>';
        const body = table.querySelector('tbody');
        for (const trial of evaluationTrials.slice().reverse()) {
            const row = document.createElement('tr');
            const requested = trial.requested || {};
            const cells = [
                `${requested.id || 'unknown'} (${requested.vendor || 'unknown'})`,
                String(trial.trial),
                trial.status === 'blocked' ? `Blocked: ${trial.blockedType || 'invocation'}` : trial.status,
                trial.status === 'blocked' ? 'Not scored' : `${trial.outcome}: ${trial.evidenceCode || ''}`,
                Number.isFinite(trial.durationMs) ? `${Math.round(trial.durationMs)} ms` : 'Unverified',
                trial.resolvedIdentity ? `${trial.resolvedIdentity.id || 'unknown'} (${trial.resolvedIdentity.vendor || 'unknown'})` : 'Unverified'
            ];
            for (const value of cells) {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.append(cell);
            }
            if (trial.reason) row.title = trial.reason;
            if (trial.error) row.title = trial.error;
            body.append(row);
        }
        list.append(table);
        container.append(list);
    }

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'learningDashboard') {
            models = message.models;
            dashboard = message.dashboard;
            scope = message.scope;
            priority = message.priority;
            hasSelectedLocalModel = message.hasSelectedLocalModel;
            pinnedAdvisorModel = message.pinnedAdvisorModel ?? null;
            workspacePreference = normalizeWorkspacePreference(message.workspacePreference);
            syncPreferenceScope();
            for (const control of document.querySelectorAll('#model-scope input')) control.checked = control.value === scope;
            byId('model-priority').value = priority;
            renderAdvisorDefault();
            renderWorkspacePreference();
            evaluationTrials = Array.isArray(message.evaluation?.trials) ? message.evaluation.trials : [];
            renderDashboard();
            renderEvaluationDashboard();
            setStatus(scope === 'local' && !hasSelectedLocalModel
                ? `Local only: no selected local model available. ${message.recordCount} outcomes stored.`
                : `${message.recordCount} verified outcomes stored in this VS Code profile.`, 'is-ready');
        } else if (message.type === 'learningDashboardError') {
            for (const control of document.querySelectorAll('#model-scope input')) control.checked = control.value === scope;
            byId('model-priority').value = priority;
            renderAdvisorDefault();
            workspacePreference = normalizeWorkspacePreference(message.workspacePreference ?? workspacePreference);
            syncPreferenceScope();
            renderWorkspacePreference();
            setStatus(`Could not load learning data: ${message.error}`, 'is-error');
        } else if (message.type === 'learningDashboardLoading') {
            setStatus('Loading model rates and Aro outcome history...', 'is-loading');
        } else if (message.type === 'modelEvaluationDashboard') {
            models = message.models;
            renderEvaluationDashboard();
            setStatus('Evaluating models...', 'is-loading');
        }
    });

    setStatus('Loading model rates and Aro outcome history...', 'is-loading');
    renderWorkspacePreference();
    vscode.postMessage({ type: 'ready' });
})();
