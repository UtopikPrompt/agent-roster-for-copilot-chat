(() => {
    const vscode = acquireVsCodeApi();
    const byId = id => document.getElementById(id);
    const statusElement = byId('provider-status');
    const messageElement = byId('provider-message');
    let payload = null;
    let actionError = '';
    let catalog = [];
    let providerTypes = {};
    let lockedProviders = [];
    let activeScope = 'global';

    function setStatus(message, state) {
        statusElement.className = `model-load-status ${state}`;
        statusElement.setAttribute('aria-busy', String(state === 'is-loading'));
        messageElement.textContent = message;
    }

    function post(message) {
        setStatus('Saving provider availability...', 'is-loading');
        vscode.postMessage(message);
    }

    function emptyRow(columns, text) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = columns;
        cell.textContent = text;
        row.append(cell);
        return row;
    }

    function cellWith(text) {
        const cell = document.createElement('td');
        cell.textContent = text;
        return cell;
    }

    // Builds one provider row. A null onChange renders a dash instead of a toggle.
    function providerRow(provider, { checked, disabled, label, onChange, states }) {
        const row = document.createElement('tr');
        const toggleCell = document.createElement('td');
        if (onChange) {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = checked;
            checkbox.disabled = disabled;
            checkbox.setAttribute('aria-label', label);
            checkbox.addEventListener('change', () => onChange(checkbox.checked));
            toggleCell.append(checkbox);
        } else {
            toggleCell.textContent = '\u2014';
        }
        const name = cellWith(provider.vendor);
        if (!provider.available) {
            const small = document.createElement('small');
            small.textContent = 'Not in current inventory';
            name.append(document.createElement('br'), small);
        }
        const count = cellWith(provider.available ? String(provider.modelCount) : '0');
        row.append(toggleCell, name, count, ...states.map(text => cellWith(text)));
        return row;
    }

    function renderGlobal() {
        const excluded = payload.global.disabledProviders.length;
        const customWorkspace = payload.hasWorkspace && payload.workspace.mode === 'custom';
        byId('global-summary').textContent = `${excluded
            ? `${excluded} provider(s) disabled globally.`
            : 'All providers are enabled globally (default).'}${customWorkspace ? ' This workspace uses its own list, so these choices do not change it here.' : ''}`;
        const body = byId('global-providers');
        body.replaceChildren();
        if (!payload.providers.length) {
            body.append(emptyRow(4, 'No providers have been discovered yet.'));
        }
        for (const provider of payload.providers) {
            body.append(providerRow(provider, {
                checked: provider.globallyEnabled,
                disabled: !provider.available && !provider.globallyEnabled,
                label: `Enable ${provider.vendor} globally`,
                onChange: enabled => post({ type: 'setGlobalProviderEnabled', provider: provider.vendor, enabled }),
                states: [provider.globallyEnabled ? 'Enabled globally' : 'Disabled globally']
            }));
        }
        byId('reset-global').disabled = payload.global.allEnabled;
    }

    function renderWorkspace() {
        const { hasWorkspace, workspace } = payload;
        for (const radio of document.querySelectorAll('input[name="workspace-mode"]')) {
            radio.checked = radio.value === workspace.mode;
            radio.disabled = !hasWorkspace;
        }
        const custom = workspace.mode === 'custom';
        byId('workspace-note').textContent = !hasWorkspace
            ? 'Open a folder to set a workspace override. The global list applies.'
            : custom
                ? `Checked providers are enabled in this workspace, regardless of the global list.${workspace.invalid ? ' Some stored entries are invalid and were ignored.' : ''}`
                : 'This workspace inherits the global list.';
        const body = byId('workspace-providers');
        body.replaceChildren();
        if (!payload.providers.length) {
            body.append(emptyRow(5, 'No providers have been discovered yet.'));
        }
        for (const provider of payload.providers) {
            const globalState = provider.globallyEnabled ? 'Enabled globally' : 'Disabled globally';
            const source = provider.effectiveSource === 'workspace' ? 'workspace list' : 'global list';
            const effective = `${provider.effectiveEnabled ? 'Enabled' : 'Disabled'} (${source})`;
            body.append(providerRow(provider, {
                checked: provider.workspaceEnabled,
                disabled: !hasWorkspace || !custom || (!provider.available && !provider.workspaceEnabled),
                label: `Enable ${provider.vendor} in this workspace`,
                onChange: custom ? enabled => post({ type: 'setWorkspaceProviderEnabled', provider: provider.vendor, enabled }) : null,
                states: [globalState, effective]
            }));
        }
    }

    // Model and provider catalog. Enablement is computed per scope on the server; this view only picks the active scope.
    function postCatalog(message, text) {
        setStatus(text, 'is-loading');
        vscode.postMessage(message);
    }

    function appendExcludedStatus(cell) {
        const status = document.createElement('small');
        status.className = 'excluded-status';
        status.textContent = 'Excluded by provider policy';
        cell.append(status);
    }

    function renderCatalog() {
        const showExcluded = byId('show-excluded').checked;
        const query = byId('model-search').value.trim().toLowerCase();
        const rows = catalog.map(row => ({ ...row, excluded: row.enabled?.[activeScope] === false }));
        const excludedRows = rows.filter(row => row.excluded);
        const excludedProviders = new Set(excludedRows.map(row => row.vendor)).size;
        const scopeName = activeScope === 'global' ? 'Global' : 'Workspace';
        byId('catalog-scope').textContent = `${scopeName} scope. Provider choices decide which models are eligible for recommendations in this scope.`;
        byId('provider-policy-note').textContent = excludedRows.length
            ? `${excludedRows.length} model(s) from ${excludedProviders} provider(s) are excluded in ${scopeName.toLowerCase()} scope${showExcluded ? ' and shown below.' : ' and hidden.'}`
            : `No discovered models are excluded in ${scopeName.toLowerCase()} scope.`;
        const visibleRows = rows.filter(row => showExcluded || !row.excluded);
        const matchingRows = visibleRows.filter(row => [row.name, row.id, row.vendor, row.family]
            .some(value => String(value || '').toLowerCase().includes(query)));
        byId('model-count-label').textContent = query ? `${matchingRows.length} / ${visibleRows.length} models` : `${visibleRows.length} models`;
        renderProviderTable(rows, showExcluded);
        renderModelTable(matchingRows);
    }

    function renderProviderTable(rows, showExcluded) {
        const body = byId('providers');
        body.replaceChildren();
        const vendors = [...new Set(rows.map(row => row.vendor))].sort();
        for (const vendor of vendors) {
            const providerRows = rows.filter(row => row.vendor === vendor);
            const excluded = providerRows.every(row => row.excluded);
            if (excluded && !showExcluded) continue;
            const selectedCount = providerRows.filter(row => row.selected).length;
            const allSelected = selectedCount === providerRows.length;
            const provider = cellWith(vendor);
            if (excluded) appendExcludedStatus(provider);
            const selection = document.createElement('td');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'provider-filter';
            button.textContent = `${selectedCount} / ${providerRows.length} selected`;
            button.setAttribute('aria-pressed', allSelected ? 'true' : selectedCount ? 'mixed' : 'false');
            button.setAttribute('aria-label', `${allSelected ? 'Deselect' : 'Select'} all models from ${vendor}`);
            button.addEventListener('click', () => postCatalog({ type: 'setProviderSelected', vendor, selected: !allSelected }, 'Saving provider selection...'));
            selection.append(button);
            const typeCell = document.createElement('td');
            if (lockedProviders.includes(vendor)) {
                typeCell.textContent = 'Cloud';
            } else {
                const type = document.createElement('select');
                type.setAttribute('aria-label', `Model type for ${vendor}`);
                for (const [value, label] of [['unknown', 'Unknown'], ['cloud', 'Cloud'], ['local', 'Local']]) {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = label;
                    type.append(option);
                }
                type.value = providerTypes[vendor] || 'unknown';
                type.addEventListener('change', () => postCatalog({ type: 'setProviderType', vendor, kind: type.value }, 'Saving provider type...'));
                typeCell.append(type);
            }
            body.append(emptyOrRow(provider, selection, typeCell));
        }
        if (!body.children.length) body.append(emptyRow(3, 'No providers to show in this scope.'));
    }

    function emptyOrRow(...cells) {
        const row = document.createElement('tr');
        row.append(...cells);
        return row;
    }

    function renderModelTable(rows) {
        const body = byId('models');
        body.replaceChildren();
        if (!rows.length) {
            body.append(emptyRow(6, 'No models match this view.'));
            return;
        }
        for (const model of rows) {
            const use = document.createElement('td');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = model.selected;
            checkbox.setAttribute('aria-label', `Use ${model.name} (${model.vendor})`);
            checkbox.addEventListener('change', () => postCatalog({ type: 'setModelSelected', id: model.id, vendor: model.vendor, selected: checkbox.checked }, 'Saving model selection...'));
            use.append(checkbox);
            const name = cellWith(model.name);
            const id = document.createElement('small');
            id.textContent = model.id;
            name.append(id);
            const provider = cellWith(`${model.vendor} / ${model.family} (${model.version})`);
            if (model.excluded) appendExcludedStatus(provider);
            const tier = document.createElement('td');
            tier.textContent = `${model.capabilityTier || model.localTier || 'unrated'} | ${model.evidenceStatus || 'unknown'} | ${model.evidenceSourceCount || 0} sources`;
            tier.title = (model.evidenceSources || []).join(', ') || 'No capability evidence';
            const rates = [
                `In ${model.pricing?.inputCost ?? '-'}`,
                `Out ${model.pricing?.outputCost ?? '-'}`,
                `Cache ${model.pricing?.cacheCost ?? '-'}`,
                `Write ${model.pricing?.cacheWriteCost ?? '-'}`
            ];
            const source = model.pricing?.budgetClass === 'unpriced' || model.pricing?.source === 'unpriced'
                ? 'Unknown'
                : model.pricing?.source === 'vscode'
                    ? 'Native'
                    : model.pricing?.source === 'snapshot'
                        ? `Snapshot ${model.pricing.snapshotDate}`
                        : model.pricing?.source === 'local'
                            ? 'Local (no token charge)'
                            : model.pricing?.source === 'manual'
                                ? 'Manual tier'
                                : 'Unknown';
            body.append(emptyOrRow(use, name, provider, tier, cellWith(rates.join(' / ')), cellWith(source)));
        }
    }

    // Switches the visible scope tab. Used by user clicks, arrow keys, and extension reveal messages.
    function selectScope(scope) {
        for (const tab of byId('scope-tabs').children) {
            const selected = tab.dataset.scope === scope;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
        }
        byId('global-scope').hidden = scope !== 'global';
        byId('workspace-scope').hidden = scope !== 'workspace';
        activeScope = scope;
        renderCatalog();
    }

    function render(message) {
        payload = message;
        byId('effective-summary').textContent = payload.hasWorkspace
            ? payload.effective.summary
            : `${payload.effective.summary} Open a folder to set a workspace override.`;
        renderGlobal();
        renderWorkspace();
        catalog = Array.isArray(message.catalog) ? message.catalog : [];
        providerTypes = message.providerTypes || {};
        lockedProviders = Array.isArray(message.lockedProviders) ? message.lockedProviders : [];
        renderCatalog();
        if (actionError) {
            // Shown once after the refresh that follows a rejected change.
            setStatus(`Could not save provider availability: ${actionError}`, 'is-error');
            actionError = '';
            return;
        }
        if (message.inventoryError) {
            setStatus(`Could not discover providers: ${message.inventoryError}. Showing saved choices.`, 'is-error');
            return;
        }
        const available = payload.providers.filter(provider => provider.available).length;
        setStatus(available
            ? `${available} provider(s) discovered. Changes apply to recommendations and the Aro Learning dashboard.`
            : 'No chat model providers are available. Sign in to Copilot or add a provider, then refresh.', 'is-ready');
    }

    for (const tab of byId('scope-tabs').children) {
        tab.addEventListener('click', () => selectScope(tab.dataset.scope));
    }
    byId('scope-tabs').addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        const tabs = Array.from(byId('scope-tabs').children);
        const offset = event.key === 'ArrowRight' ? 1 : tabs.length - 1;
        const next = tabs[(tabs.indexOf(event.target) + offset) % tabs.length];
        next.focus();
        selectScope(next.dataset.scope);
    });
    byId('reset-global').addEventListener('click', () => post({ type: 'resetGlobalProviderAvailability' }));
    byId('refresh-providers').addEventListener('click', () => {
        setStatus('Loading provider availability...', 'is-loading');
        vscode.postMessage({ type: 'refreshProviderAvailability' });
    });
    for (const radio of document.querySelectorAll('input[name="workspace-mode"]')) {
        radio.addEventListener('change', () => {
            if (radio.checked) post({ type: 'setWorkspaceProviderMode', mode: radio.value });
        });
    }

    byId('model-search').addEventListener('input', renderCatalog);
    byId('show-excluded').addEventListener('change', renderCatalog);
    byId('open-model-evaluation').addEventListener('click', () => {
        const candidates = catalog
            .filter(model => model.selected)
            .map(model => ({ id: model.id, vendor: model.vendor }))
            .filter(candidate => typeof candidate.id === 'string' && candidate.id.trim() && typeof candidate.vendor === 'string' && candidate.vendor.trim());
        setStatus('Opening model evaluation...', 'is-loading');
        vscode.postMessage({ type: 'openModelEvaluation', candidates });
    });
    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'providerAvailability') {
            render(message);
        } else if (message.type === 'selectScope') {
            selectScope(message.scope);
        } else if (message.type === 'providerAvailabilityLoading') {
            setStatus('Loading provider availability...', 'is-loading');
        } else if (message.type === 'providerAvailabilityError') {
            actionError = message.error;
            setStatus(`Could not save provider availability: ${message.error}`, 'is-error');
        }
    });

    setStatus('Loading provider availability...', 'is-loading');
    vscode.postMessage({ type: 'ready' });
})();
