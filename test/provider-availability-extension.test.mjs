import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { root } from '../scripts/validate.mjs';

const localRequire = createRequire(path.join(root, 'src/extension.js'));
const providerModule = localRequire('../src/provider-availability.js');
const { PROVIDER_AVAILABILITY_KEY, WORKSPACE_PROVIDERS_SETTING } = providerModule;

// Values created inside the vm context have another realm's prototypes; copy them for deep-equality checks.
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

async function loadProviderHarness({ folder = true, workspaceValues = {}, globalDisabled, open = 'agentRoster.openModelInventory' } = {}) {
    const commands = new Map();
    const executed = [];
    const state = new Map();
    const updates = [];
    const errors = [];
    const warnings = [];
    const quickPicks = [];
    const posted = [];
    const panels = [];
    let panel;
    let receive;
    if (globalDisabled) state.set(PROVIDER_AVAILABILITY_KEY, { disabledProviders: globalDisabled });
    const models = [
        { id: 'cloud', name: 'Cloud', vendor: 'copilot' },
        { id: 'cli', name: 'CLI', vendor: 'copilotcli' },
        { id: 'local', name: 'Local', vendor: 'ollama' }
    ];
    const configuration = {
        get: () => undefined,
        inspect: key => ({ key, workspaceValue: workspaceValues[key] }),
        update: async (key, value, target) => {
            updates.push({ key, value, target });
            workspaceValues[key] = plain(value);
        }
    };
    const vscode = {
        EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} dispose() {} },
        TreeItem: class { constructor(label) { this.label = label; } },
        TreeItemCollapsibleState: { None: 0 },
        ThemeIcon: class { constructor(id) { this.id = id; } },
        ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
        lm: {
            registerTool: () => ({ dispose() {} }),
            selectChatModels: async () => models
        },
        workspace: {
            workspaceFolders: folder ? [{ name: 'repo' }] : undefined,
            getConfiguration: section => section === 'agentRoster.modelRecommendation' ? configuration : { get: (key, fallback) => fallback, inspect: () => undefined },
            onDidChangeConfiguration: () => ({ dispose() {} })
        },
        commands: {
            registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() {} }; },
            executeCommand: async name => { executed.push(name); }
        },
        window: {
            registerTreeDataProvider: () => ({ dispose() {} }),
            showQuickPick: async (choices, options) => { quickPicks.push({ choices, options }); return undefined; },
            showWarningMessage: message => { warnings.push(message); return Promise.resolve(undefined); },
            showErrorMessage: message => { errors.push(message); },
            createWebviewPanel: () => {
                panel = {
                    webview: {
                        cspSource: 'test',
                        asWebviewUri: uri => uri,
                        onDidReceiveMessage: handler => { receive = handler; },
                        postMessage: message => { posted.push(message); }
                    },
                    reveal: () => { panel.revealed = (panel.revealed || 0) + 1; },
                    onDidDispose: handler => { panel.disposeHandler = handler; }
                };
                panels.push(panel);
                return panel;
            }
        },
        Uri: { joinPath: (...parts) => parts.join('/') },
        ViewColumn: { One: 1 },
        LanguageModelTextPart: class { constructor(value) { this.value = value; } },
        LanguageModelToolResult: class { constructor(content) { this.content = content; } }
    };
    const module = { exports: {} };
    vm.runInNewContext(await readFile(path.join(root, 'src/extension.js'), 'utf8'), {
        module, exports: module.exports,
        require: name => name === 'vscode' ? vscode : localRequire(name), setTimeout, clearTimeout
    });
    const context = {
        subscriptions: [], extensionUri: 'extension',
        globalState: { get: key => state.get(key), update: async (key, value) => { state.set(key, value); } }
    };
    module.exports.activate(context);
    commands.get(open)();
    const settle = async () => {
        for (let index = 0; index < 20; index += 1) await new Promise(resolve => setImmediate(resolve));
    };
    const send = async message => {
        posted.length = 0;
        receive(message);
        await settle();
        return posted.slice();
    };
    return {
        send,
        settle,
        state: { get: key => plain(state.get(key)) },
        updates,
        errors,
        warnings,
        quickPicks,
        workspaceValues,
        panels,
        posted,
        context,
        executed,
        invoke: (name, ...args) => commands.get(name)(...args),
        dispose: () => panel.disposeHandler(),
        get panel() { return panel; }
    };
}

const payloadOf = messages => messages.find(message => message.type === 'providerAvailability');

test('Aro Learning reuses its panel and creates a fresh one after disposal', async () => {
    const harness = await loadProviderHarness({ open: 'agentRoster.openModelLearning' });
    const firstPanel = harness.panel;

    harness.invoke('agentRoster.openModelLearning');
    assert.equal(harness.panels.length, 1);
    assert.equal(firstPanel.revealed, 1);

    harness.dispose();
    harness.invoke('agentRoster.openModelLearning');
    assert.equal(harness.panels.length, 2);
    assert.notEqual(harness.panel, firstPanel);
});

test('the provider page opens as a separate webview and reports All by default', async () => {
    const harness = await loadProviderHarness();
    const messages = await harness.send({ type: 'ready' });
    const payload = payloadOf(messages);
    assert.equal(payload.global.allEnabled, true);
    assert.equal(payload.effective.mode, 'inherit');
    assert.equal(payload.effective.summary, 'All providers are enabled (global default).');
    assert.ok(payload.providers.every(provider => provider.effectiveEnabled));
    assert.match(harness.panel.webview.html, /provider-availability\.js/);
});

test('unchecking a provider globally persists the exclusion and enabling requires inventory', async () => {
    const harness = await loadProviderHarness();
    await harness.send({ type: 'ready' });
    let messages = await harness.send({ type: 'setGlobalProviderEnabled', provider: 'ollama', enabled: false });
    assert.deepEqual(harness.state.get(PROVIDER_AVAILABILITY_KEY), { disabledProviders: ['ollama'] });
    assert.equal(payloadOf(messages).global.allEnabled, false);
    assert.equal(payloadOf(messages).providers.find(provider => provider.vendor === 'ollama').effectiveEnabled, false);

    messages = await harness.send({ type: 'setGlobalProviderEnabled', provider: 'missing', enabled: true });
    assert.ok(messages.some(message => message.type === 'providerAvailabilityError' && /not available/.test(message.error)));
    assert.deepEqual(harness.state.get(PROVIDER_AVAILABILITY_KEY), { disabledProviders: ['ollama'] });
});

test('reset to All clears the global exclusion list', async () => {
    const harness = await loadProviderHarness({ globalDisabled: ['ollama'] });
    await harness.send({ type: 'ready' });
    const messages = await harness.send({ type: 'resetGlobalProviderAvailability' });
    assert.equal(harness.state.get(PROVIDER_AVAILABILITY_KEY), undefined);
    assert.equal(payloadOf(messages).global.allEnabled, true);
});

test('a workspace custom list re-enables a globally disabled provider and writes only workspace values', async () => {
    const harness = await loadProviderHarness({ globalDisabled: ['ollama'] });
    await harness.send({ type: 'ready' });
    await harness.send({ type: 'setWorkspaceProviderMode', mode: 'custom' });
    assert.deepEqual(harness.workspaceValues[WORKSPACE_PROVIDERS_SETTING], ['copilot', 'copilotcli']);
    const messages = await harness.send({ type: 'setWorkspaceProviderEnabled', provider: 'ollama', enabled: true });
    const payload = payloadOf(messages);
    assert.equal(payload.effective.mode, 'custom');
    assert.equal(payload.providers.find(provider => provider.vendor === 'ollama').effectiveEnabled, true);
    assert.deepEqual(harness.workspaceValues[WORKSPACE_PROVIDERS_SETTING].sort(), ['copilot', 'copilotcli', 'ollama']);
    assert.deepEqual(harness.state.get(PROVIDER_AVAILABILITY_KEY), { disabledProviders: ['ollama'] });
});

test('reset to inherit clears only the workspace provider setting', async () => {
    const harness = await loadProviderHarness({ globalDisabled: ['ollama'], workspaceValues: { [WORKSPACE_PROVIDERS_SETTING]: ['ollama'] } });
    await harness.send({ type: 'ready' });
    const messages = await harness.send({ type: 'setWorkspaceProviderMode', mode: 'inherit' });
    assert.equal(harness.workspaceValues[WORKSPACE_PROVIDERS_SETTING], undefined);
    assert.equal(payloadOf(messages).effective.mode, 'inherit');
    assert.deepEqual(harness.state.get(PROVIDER_AVAILABILITY_KEY), { disabledProviders: ['ollama'] });
});

test('workspace changes are rejected without a folder or outside custom mode', async () => {
    const noFolder = await loadProviderHarness({ folder: false });
    await noFolder.send({ type: 'ready' });
    let messages = await noFolder.send({ type: 'setWorkspaceProviderMode', mode: 'custom' });
    assert.ok(messages.some(message => message.type === 'providerAvailabilityError' && /Open a folder/.test(message.error)));
    assert.equal(noFolder.workspaceValues[WORKSPACE_PROVIDERS_SETTING], undefined);

    const inherit = await loadProviderHarness();
    await inherit.send({ type: 'ready' });
    messages = await inherit.send({ type: 'setWorkspaceProviderEnabled', provider: 'copilot', enabled: false });
    assert.ok(messages.some(message => message.type === 'providerAvailabilityError' && /Custom/.test(message.error)));
    assert.equal(inherit.workspaceValues[WORKSPACE_PROVIDERS_SETTING], undefined);
});

test('unknown or malformed provider messages are rejected without writes', async () => {
    const harness = await loadProviderHarness();
    await harness.send({ type: 'ready' });
    let messages = await harness.send({ type: 'deleteEverything' });
    assert.ok(messages.some(message => message.type === 'providerAvailabilityError'));
    messages = await harness.send({ type: 'setGlobalProviderEnabled', provider: 'ollama', enabled: 'yes' });
    assert.ok(messages.some(message => message.type === 'providerAvailabilityError' && /Invalid provider/.test(message.error)));
    assert.equal(harness.state.get(PROVIDER_AVAILABILITY_KEY), undefined);
    assert.deepEqual(harness.updates, []);
});

test('the sidebar and recommendation tool filter use the same resolved provider policy', () => {
    const { describeProviderAvailability } = providerModule;
    const payload = describeProviderAvailability({
        inventory: [{ vendor: 'copilot', modelCount: 1 }, { vendor: 'ollama', modelCount: 1 }],
        globalDisabledProviders: ['ollama'],
        workspace: { mode: 'custom', enabledProviders: ['ollama'], invalid: false },
        hasWorkspace: true
    });
    assert.equal(payload.effective.label, 'Workspace: 1 enabled');
    assert.equal(payload.providers.find(provider => provider.vendor === 'copilot').effectiveEnabled, false);
    assert.equal(payload.providers.find(provider => provider.vendor === 'ollama').effectiveEnabled, true);
});

test('stale stored provider IDs are reported and not dropped from the payload', () => {
    const { describeProviderAvailability } = providerModule;
    const payload = describeProviderAvailability({
        inventory: [{ vendor: 'copilot', modelCount: 2 }],
        globalDisabledProviders: ['retired'],
        workspace: { mode: 'inherit', enabledProviders: [], invalid: false },
        hasWorkspace: false
    });
    const retired = payload.providers.find(provider => provider.vendor === 'retired');
    assert.equal(retired.available, false);
    assert.equal(retired.globallyEnabled, false);
    assert.equal(payload.hasWorkspace, false);
});

const vendorsOf = models => [...new Set(models.map(model => model.vendor))].sort();

test('the catalog keeps every discovered model and reports enablement for each scope', async () => {
    const harness = await loadProviderHarness({ globalDisabled: ['ollama'] });
    const payload = payloadOf(await harness.send({ type: 'ready' }));
    assert.deepEqual(vendorsOf(payload.catalog), ['copilot', 'copilotcli', 'ollama']);
    assert.deepEqual(plain(payload.catalog.find(model => model.vendor === 'ollama').enabled), { global: false, workspace: false });
    assert.deepEqual(plain(payload.catalog.find(model => model.vendor === 'copilot').enabled), { global: true, workspace: true });
    assert.ok(payload.lockedProviders.includes('copilot'));
    assert.match(harness.panel.webview.html, /<th>Provider<\/th><th>Model selection<\/th><th>Type<\/th>/);
});

test('a workspace custom list enables a provider in the workspace scope while the global scope keeps it disabled', async () => {
    const harness = await loadProviderHarness({
        globalDisabled: ['ollama', 'copilot'],
        workspaceValues: { [WORKSPACE_PROVIDERS_SETTING]: ['ollama', 'copilot'] }
    });
    const payload = payloadOf(await harness.send({ type: 'ready' }));
    const enabledFor = vendor => plain(payload.catalog.find(model => model.vendor === vendor).enabled);
    assert.deepEqual(enabledFor('ollama'), { global: false, workspace: true });
    assert.deepEqual(enabledFor('copilot'), { global: false, workspace: true });
    assert.deepEqual(enabledFor('copilotcli'), { global: true, workspace: false });
});

test('inherit policy with no disabled providers enables every catalog row in both scopes', async () => {
    const harness = await loadProviderHarness();
    const payload = payloadOf(await harness.send({ type: 'ready' }));
    assert.deepEqual(vendorsOf(payload.catalog), ['copilot', 'copilotcli', 'ollama']);
    assert.ok(payload.catalog.every(model => model.enabled.global && model.enabled.workspace));
});

test('inherit policy follows the global list for both scopes when the workspace has no custom setting', async () => {
    const harness = await loadProviderHarness({ globalDisabled: ['copilotcli'] });
    const payload = payloadOf(await harness.send({ type: 'ready' }));
    const row = payload.catalog.find(model => model.vendor === 'copilotcli');
    assert.deepEqual(plain(row.enabled), { global: false, workspace: false });
});

test('catalog changes route through the Model Inventory and reject providers that are no longer discovered', async () => {
    const harness = await loadProviderHarness();
    await harness.send({ type: 'ready' });
    const messages = await harness.send({ type: 'setProviderSelected', vendor: 'missing', selected: false });
    assert.ok(messages.some(message => message.type === 'providerAvailabilityError' && /no longer available/.test(message.error)));
});

test('Model Learning shows recommendations only and links to the Model Inventory page', async () => {
    const harness = await loadProviderHarness({ open: 'agentRoster.openModelLearning' });
    const html = harness.panel.webview.html;
    assert.doesNotMatch(html, /view-tabs|inventory-view|show-excluded|id="model-count"/);
    assert.match(html, /<button id="open-model-inventory" type="button">Model Inventory<\/button>/);
    assert.match(html, /<button id="open-model-evaluation" type="button">Open Model Evaluation<\/button>/);
    await harness.send({ type: 'openModelInventory' });
    assert.deepEqual(harness.executed, ['agentRoster.openModelInventory']);
    const script = await readFile(path.join(root, 'media/model-learning-dashboard.js'), 'utf8');
    assert.doesNotMatch(script, /excludedModels|show-excluded|view-tabs|renderModels|renderProviders/);
    assert.match(script, /postMessage\(\{ type: 'openModelInventory' \}\)/);
});

test('Model Inventory opens the dedicated evaluation page with exact candidates', async () => {
    const harness = await loadProviderHarness();
    const html = harness.panel.webview.html;
    assert.match(html, /id="open-model-evaluation"[^>]*>Open Model Evaluation<\/button>/);
    await harness.send({ type: 'openModelEvaluation', candidates: [{ id: 'cloud', vendor: 'copilot' }] });
    assert.deepEqual(harness.executed, ['agentRoster.openModelEvaluation']);
    assert.ok(!harness.executed.includes('agentRoster.runModelEvaluation'));
    assert.equal(harness.quickPicks.length, 0);
});

test('inventory stale candidates do not open a QuickPick', async () => {
    const harness = await loadProviderHarness();
    await harness.send({ type: 'openModelEvaluation', candidates: [{ id: 'removed', vendor: 'copilot' }] });
    assert.deepEqual(harness.executed, ['agentRoster.openModelEvaluation']);
    assert.equal(harness.quickPicks.length, 0);
});

test('Model Evaluation command fallback retains the quick picker', async () => {
    const harness = await loadProviderHarness();
    await harness.invoke('agentRoster.runModelEvaluation');
    assert.equal(harness.quickPicks.length, 1);
});

test('opening the Model Inventory again reveals the open panel instead of creating another', async () => {
    const harness = await loadProviderHarness();
    assert.equal(harness.panels.length, 1);
    harness.posted.length = 0;
    await harness.invoke('agentRoster.openModelInventory');
    await harness.settle();
    assert.equal(harness.panels.length, 1);
    assert.equal(harness.panels[0].revealed, 1);
    assert.ok(harness.posted.some(message => message.type === 'selectScope' && message.scope === 'global'));
});

test('reopening with the workspace scope selects the Workspace tab on the existing panel', async () => {
    const harness = await loadProviderHarness();
    await harness.invoke('agentRoster.openModelInventory', 'workspace');
    await harness.settle();
    assert.equal(harness.panels.length, 1);
    assert.ok(harness.posted.some(message => message.type === 'selectScope' && message.scope === 'workspace'));
    const messages = await harness.send({ type: 'ready' });
    assert.ok(messages.some(message => message.type === 'selectScope' && message.scope === 'workspace'));
});

test('an unknown reveal scope falls back to the Global tab', async () => {
    const harness = await loadProviderHarness();
    await harness.invoke('agentRoster.openModelInventory', { scope: 'workspace' });
    await harness.settle();
    assert.ok(harness.posted.some(message => message.type === 'selectScope' && message.scope === 'global'));
});

test('disposing the Model Inventory clears the reference so the next open creates a fresh panel', async () => {
    const harness = await loadProviderHarness();
    harness.dispose();
    await harness.invoke('agentRoster.openModelInventory');
    assert.equal(harness.panels.length, 2);
    assert.equal(harness.panels[0].revealed, undefined);
    const payload = payloadOf(await harness.send({ type: 'ready' }));
    assert.equal(payload.global.allEnabled, true);
});

test('the inventory html exposes Global and Workspace tabs with Global selected by default', async () => {
    const harness = await loadProviderHarness();
    const html = harness.panel.webview.html;
    assert.match(html, /id="scope-tab-global"[^>]*data-scope="global"/);
    assert.match(html, /id="scope-tab-workspace"[^>]*data-scope="workspace"/);
    assert.match(html, /id="global-scope"/);
    assert.match(html, /id="workspace-scope"[^>]*hidden/);
});

test('each provider reports whether its effective state comes from the global or workspace list', async () => {
    const inherit = await loadProviderHarness({ globalDisabled: ['ollama'] });
    const inheritPayload = payloadOf(await inherit.send({ type: 'ready' }));
    assert.equal(inheritPayload.providers.find(provider => provider.vendor === 'ollama').effectiveSource, 'global');
    assert.equal(inheritPayload.providers.find(provider => provider.vendor === 'copilot').effectiveSource, 'global');

    const custom = await loadProviderHarness({ globalDisabled: ['ollama'], workspaceValues: { [WORKSPACE_PROVIDERS_SETTING]: ['copilot', 'ollama'] } });
    const customPayload = payloadOf(await custom.send({ type: 'ready' }));
    assert.equal(customPayload.effective.mode, 'custom');
    assert.equal(customPayload.providers.find(provider => provider.vendor === 'ollama').effectiveSource, 'workspace');
    assert.equal(customPayload.providers.find(provider => provider.vendor === 'ollama').effectiveEnabled, true);
});

// Loads the real webview script against a minimal DOM so tab switching is exercised without a browser.
async function loadScopeTabsScript() {
    const elements = new Map();
    const listeners = {};
    const posted = [];
    class FakeElement {
        constructor(id = '') {
            this.id = id;
            this.children = [];
            this.listeners = {};
            this.dataset = {};
            this.attributes = {};
            this.hidden = false;
            this.tabIndex = 0;
            this.textContent = '';
            this.className = '';
        }
        addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); }
        dispatch(type, event = {}) { for (const handler of this.listeners[type] || []) handler(event); }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        append(...nodes) { this.children.push(...nodes); }
        replaceChildren(...nodes) { this.children = [...nodes]; }
        focus() { this.focused = true; }
    }
    const add = (id, element = new FakeElement(id)) => { elements.set(id, element); return element; };
    add('provider-status');
    add('provider-message');
    add('effective-summary');
    add('reset-global');
    add('refresh-providers');
    add('global-summary');
    add('global-providers');
    add('workspace-note');
    add('workspace-providers');
    add('global-scope');
    add('workspace-scope').hidden = true;
    add('model-search').value = '';
    add('show-excluded');
    add('catalog-scope');
    add('provider-policy-note');
    add('model-count-label');
    add('open-model-evaluation');
    add('run-model-evaluation');
    add('providers');
    add('models');
    const tabs = add('scope-tabs');
    for (const scope of ['global', 'workspace']) {
        const tab = new FakeElement(`scope-tab-${scope}`);
        tab.dataset.scope = scope;
        tabs.children.push(tab);
        elements.set(tab.id, tab);
    }
    const document = {
        getElementById: id => elements.get(id) || null,
        createElement: () => new FakeElement(),
        querySelectorAll: () => []
    };
    const window = { addEventListener: (type, handler) => { listeners[type] = handler; } };
    const script = await readFile(path.join(root, 'media/provider-availability.js'), 'utf8');
    vm.runInNewContext(script, {
        document,
        window,
        acquireVsCodeApi: () => ({ postMessage: message => posted.push(message) })
    });
    return {
        posted,
        tab: scope => elements.get(`scope-tab-${scope}`),
        openEvaluation: () => elements.get('open-model-evaluation'),
        scopeVisible: scope => !elements.get(`${scope}-scope`).hidden,
        tabsElement: tabs,
        receive: data => listeners.message({ data })
    };
}

test('the webview script switches Global and Workspace tabs from clicks, arrow keys, and reveal messages', async () => {
    const page = await loadScopeTabsScript();
    assert.deepEqual(plain(page.posted), [{ type: 'ready' }]);
    page.receive({
        type: 'providerAvailability',
        inventoryError: '',
        providers: [],
        global: { disabledProviders: [] },
        workspace: { mode: 'inherit', enabledProviders: [] },
        effective: { summary: 'All providers enabled' },
        hasWorkspace: false,
        catalog: [
            { id: 'cloud', name: 'Cloud', vendor: 'copilot', family: 'Family', version: '1', selected: true, enabled: { global: true, workspace: true } },
            { id: 'local', name: 'Local', vendor: 'ollama', family: 'Family', version: '1', selected: false, enabled: { global: true, workspace: true } }
        ],
        providerTypes: {},
        lockedProviders: []
    });
    page.openEvaluation().dispatch('click');
    assert.deepEqual(plain(page.posted), [{ type: 'ready' }, { type: 'openModelEvaluation', candidates: [{ id: 'cloud', vendor: 'copilot' }] }]);
    assert.equal(page.scopeVisible('global'), true);
    assert.equal(page.scopeVisible('workspace'), false);

    page.tab('workspace').dispatch('click');
    assert.equal(page.scopeVisible('global'), false);
    assert.equal(page.scopeVisible('workspace'), true);
    assert.equal(page.tab('workspace').attributes['aria-selected'], 'true');
    assert.equal(page.tab('global').attributes['aria-selected'], 'false');

    page.tabsElement.dispatch('keydown', { key: 'ArrowLeft', target: page.tab('workspace') });
    assert.equal(page.scopeVisible('global'), true);
    assert.equal(page.tab('global').tabIndex, 0);

    page.tabsElement.dispatch('keydown', { key: 'ArrowRight', target: page.tab('global') });
    assert.equal(page.scopeVisible('workspace'), true);

    page.receive({ type: 'selectScope', scope: 'global' });
    assert.equal(page.scopeVisible('global'), true);
    assert.equal(page.scopeVisible('workspace'), false);
});
