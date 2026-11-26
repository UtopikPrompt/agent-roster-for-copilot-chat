import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { parseCustomization, resolveAsset, root, validate } from '../scripts/validate.mjs';

test('parses YAML metadata and retains the procedure', () => {
    const result = parseCustomization('---\nname: sample\ndescription: "Use when: testing"\n---\n# Procedure\n', 'sample');
    assert.equal(result.metadata.name, 'sample');
    assert.equal(result.body, '# Procedure\n');
});

test('rejects missing metadata and duplicate YAML keys', () => {
    for (const text of ['# No metadata', '---\nname: sample\n---\nBody', '---\nname: sample\nname: duplicate\ndescription: test\n---\nBody']) {
        assert.throws(() => parseCustomization(text, 'invalid'));
    }
});

test('resolves portable assets without permitting package traversal', () => {
    const base = path.resolve('fixture');
    assert.equal(resolveAsset(base, './agents/Example.agent.md'), path.join(base, 'agents', 'Example.agent.md'));
    for (const target of ['../outside.md', '.', 'agents\\Example.agent.md', path.resolve('outside.md')]) {
        assert.throws(() => resolveAsset(base, target));
    }
});

test('validates the complete council and all extracted workflow consumers', async () => {
    assert.deepEqual(await validate(), { agents: 57, skills: 12 });
});

test('Azure DevOps agent is a read-first, non-delegating worker routed through InfraDevOpsAdvisor', async () => {
    const name = 'InfraAzureDevOpsAgent';
    const { metadata, body } = parseCustomization(await readFile(path.join(root, `agents/${name}.agent.md`), 'utf8'), name);
    assert.equal(metadata.name, name);
    assert.deepEqual(metadata.tools, ['read', 'search', 'ado-remote-mcp/*']);
    assert.deepEqual(metadata.agents, []);
    assert.equal(metadata.model, undefined, 'workers must not pin a model without measured evidence');
    assert.equal(metadata['user-invocable'], false);
    assert.match(body, /explicit user confirmation/);
    assert.match(body, /Externally consequential/);
    assert.match(body, /Destructive/);
    assert.match(body, /Do not delegate/);
    assert.match(body, /Do not inventory or preflight the runtime tool list/);

    assert.match(body, /## Connection Check/);
    assert.match(body, /Prefer `core_list_orgs` when organization context is missing/);
    assert.match(body, /use `core_list_projects` when the organization is known/);
    assert.match(body, /authentication or authorization error/);
    assert.match(body, /connection error/);
    assert.match(body, /empty or no data/);
    assert.match(body, /does not prove that a local process is running/);
    assert.match(body, /## Organization and Project Discovery/);
    assert.match(body, /Probe only when a required identifier is missing or cannot be verified/);
    assert.match(body, /If discovery returns no match or several plausible targets, return NEEDS_INPUT/);
    assert.match(body, /## Endpoint Organization Context/);
    assert.match(body, /so it may provide a default organization\. Do not ask the user to repeat it/);
    assert.match(body, /do not read MCP configuration files to discover it/);
    assert.match(body, /On read-only calls, omit the organization argument when the tool schema makes it optional so the endpoint can supply its default\./);
    assert.match(body, /Request an explicit organization only after the tool indicates it is required and no configured default can be used/);
    assert.match(body, /Never infer or fabricate one/);
    assert.match(body, /do not infer that the configured organization is inaccessible/);
    assert.doesNotMatch(body, /When the organization is missing, call `core_list_orgs`/);
    assert.match(body, /only an unscoped endpoint \(`https:\/\/mcp\.dev\.azure\.com`, with no organization in the URL\) can pass a different organization per call/);
    assert.match(body, /Results remain constrained by the authenticated user's Azure DevOps access/);
    assert.match(body, /An organization-specific URL cannot reach other organizations/);
    assert.match(body, /regardless of tool name or family, and whether the call uses a generic dispatcher `action` parameter/);
    for (const family of ['work items', 'pipeline runs', 'wiki pages', 'test plans', 'Enterprise Live Migration', 'future tool family']) {
        assert.match(body, new RegExp(family));
    }
    assert.match(body, /Read-only calls need no confirmation/);
    assert.match(body, /behavioral prompt rules, not enforcement/);
    assert.match(body, /`X-MCP-Readonly: true`/);

    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    assert.ok(manifest.contributes.chatAgents.some(entry => entry.path === `./agents/${name}.agent.md`));

    const aro = parseCustomization(await readFile(path.join(root, 'agents/Aro.agent.md'), 'utf8'), 'Aro');
    assert.ok(aro.metadata.agents.includes(name));
    assert.match(aro.body, /\| Azure DevOps operations or changes \(work items, Azure Repos or pull requests, pipelines, wiki\) through the Azure DevOps MCP; not project assessment evidence \| InfraAzureDevOpsAgent \| InfraDevOpsAdvisor \|/);

    const advisor = await readFile(path.join(root, 'agents/InfraDevOpsAdvisor.agent.md'), 'utf8');
    assert.match(advisor, /Azure DevOps work items.*-> `InfraAzureDevOpsAgent`/);

    const docs = await readFile(path.join(root, 'docs/agents.md'), 'utf8');
    assert.match(docs, /\[InfraAzureDevOpsAgent\]\(\.\.\/agents\/InfraAzureDevOpsAgent\.agent\.md\)/);
    const readme = await readFile(path.join(root, 'README.md'), 'utf8');
    assert.match(readme, /\[InfraAzureDevOpsAgent\]\(agents\/InfraAzureDevOpsAgent\.agent\.md\)/);
});

test('GovWebResearchAgent fetches supplied URLs with web/fetch independent of SearXNG', async () => {
    const name = 'GovWebResearchAgent';
    const { metadata, body } = parseCustomization(await readFile(path.join(root, `agents/${name}.agent.md`), 'utf8'), name);
    const text = body.replace(/\s+/g, ' ');
    assert.deepEqual(metadata.tools, ['read', 'search', 'web/fetch', 'io.github.ihor-sokoliuk/mcp-searxng/*']);
    assert.ok(!metadata.tools.includes('azure-mcp/search'));
    assert.deepEqual(metadata.agents, []);
    const procedure = text.split('## Research Procedure ')[1]?.split(/ ## /)[0];
    assert.ok(procedure, 'Missing research procedure');
    assert.match(procedure, /Fetch every directly supplied public URL with the declared `web\/fetch` tool\. This does not depend on SearXNG/);
    assert.match(procedure, /use `web_url_read` only for a real required SearXNG-backed read with valid arguments/);
    assert.match(procedure, /Do not inspect tool exposure before a real search/);
    assert.match(procedure, /mark\s+search-dependent work `BLOCKED`/);
    assert.match(procedure, /Never use `azure-mcp\/search` as public web search/);
    assert.doesNotMatch(text, /Read relevant result URLs with `web_url_read`/);
    assert.match(text, /Cite only pages actually fetched/);
});

test('Aro routes direct public URL fetching through web/fetch with SearXNG optional', async () => {
    const { body } = parseCustomization(await readFile(path.join(root, 'agents/Aro.agent.md'), 'utf8'), 'Aro');
    const cue = body.replace(/\s+/g, ' ');
    assert.match(cue, /Direct public URL fetching uses .{1,40}declared `web\/fetch` tool and does not depend on SearXNG/);
    assert.match(cue, /SearXNG search is optional and is invoked only for a real authorized search, not tested for presence in a separate preflight/);
});

test('Aro learns model outcomes by contextual activity, domain, and difficulty', async () => {
    const { metadata, body: rawBody } = parseCustomization(await readFile(path.join(root, 'agents/Aro.agent.md'), 'utf8'), 'Aro');
    const body = rawBody.replace(/\r\n/g, '\n');
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const extensionId = `${manifest.publisher}.${manifest.name}`;
    assert.deepEqual(metadata.model, ['GPT-6 Luna', 'Claude Haiku 5.5']);
    assert.ok(metadata.tools.includes(`${extensionId}/aroGetModelRecommendations`));
    assert.ok(metadata.tools.includes(`${extensionId}/aroRecordModelOutcome`));
    const modelSelection = body.split('## Model Selection and Learning\n')[1]?.split(/^## /m)[0];
    assert.ok(modelSelection, 'Missing model selection guidance');
    const text = modelSelection.replace(/\s+/g, ' ');
    assert.match(text, /aroGetModelRecommendations/);
    assert.match(text, /selectionMode/);
    for (const mode of ['manual', 'manual-unavailable', 'fallback']) {
        assert.match(text, new RegExp(`\`${mode}\``));
    }
    assert.match(text, /recommendedModelId/);
    assert.match(text, /modelArgument/);
    assert.match(text, /`learned`, `pooled`, or an eligible `explore`/);
    assert.match(text, /never bypass the selected model scope/i);
    assert.match(text, /aroRecordModelOutcome/);
    for (const field of ['activity', 'domain', 'difficulty', 'callId']) {
        assert.match(text, new RegExp(`\`${field}\``));
    }
    assert.match(text, /bounded shortlist/);
    assert.match(text, /Before each advisor or specialist call/);
    assert.match(text, /never inspect, mirror, or change the user's Aro chat model/i);
    assert.match(text, /`excludedModels`/);
    assert.match(text, /`excludedProviders`/);
    assert.match(text, /at most three subagent attempts/);
    assert.match(text, /Never retry a potentially mutating worker unless evidence shows it did not start/);
    assert.match(text, /Valid JSON, an allowlisted name, or a worker's later result alone is not proof/);
    assert.match(text, /Do not score routing mistakes, missing input, unsupported models, tool failures/);
    assert.match(text, /Claude Haiku 5\.5 \(copilot\)/);
    assert.match(text, /low-risk/);
    assert.match(text, /Claude Sonnet 5\.5 \(copilot\)/);
    assert.match(text, /materially complex/);
});

test('preserves economical model preferences on configured selection advisors', async () => {
    const advisors = ['CodeBackendAdvisor', 'CodeDomainAdvisor', 'CodeFrontendAdvisor', 'DocsGovernanceAdvisor', 'InfraDevOpsAdvisor', 'UtilityAdvisor'];
    for (const name of advisors) {
        const { metadata } = parseCustomization(await readFile(path.join(root, `agents/${name}.agent.md`), 'utf8'), name);
        assert.equal(metadata.model, 'Claude Haiku 5.5', `${name}: expected economical advisor model preference`);
    }
});

test('Aro resolves procedure gaps and owns persistence for read-only assessment workers', async () => {
    const { body } = parseCustomization(await readFile(path.join(root, 'agents/Aro.agent.md'), 'utf8'), 'Aro');
    const text = body.replace(/\s+/g, ' ');
    assert.match(text, /runtime-discovered locations and complete findings rather than paths guessed from the target repository/);
    assert.match(text, /retry the affected scope/);
    assert.match(text, /continue independent authorized work/);
    assert.match(text, /consult DocsGovernanceAdvisor and invoke GovDocumentationSuiteGenerator/);
    assert.match(text, /verify saved paths by read-back/i);
    assert.match(text, /only after the writer route fails or lacks its required tools/i);
    const worker = parseCustomization(await readFile(path.join(root, 'agents/CodeRebuildEngineer.agent.md'), 'utf8'), 'CodeRebuildEngineer');
    assert.deepEqual(worker.metadata.tools, ['read', 'search']);
    assert.deepEqual(worker.metadata.agents, []);
    assert.match(worker.body, /Return complete findings, artifact content and\s+proposed paths to Aro/);
    assert.match(worker.body, /Missing edit tools do not block read-only analysis/);
    assert.match(worker.body, /return its skill name and failed lookup to Aro/);
});

async function fixture(context) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-roster-'));
    context.after(() => rm(directory, { recursive: true, force: true }));
    for (const folder of ['agents', 'skills/sample', 'docs']) {
        await mkdir(path.join(directory, folder), { recursive: true });
    }
    const manifest = {
        contributes: {
            chatAgents: [{ path: './agents/Aro.agent.md' }, { path: './agents/ExampleAdvisor.agent.md' }],
            chatSkills: [{ path: './skills/sample/SKILL.md' }]
        }
    };
    await writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest));
    await writeFile(path.join(directory, 'docs/extraction-map.json'), '[]');
    await writeFile(path.join(directory, 'agents/Aro.agent.md'), '---\nname: Aro\ndescription: Dispatch\ntools: [agent]\nagents: [ExampleAdvisor]\n---\nRoute to ExampleAdvisor.\n');
    await writeFile(path.join(directory, 'agents/ExampleAdvisor.agent.md'), '---\nname: ExampleAdvisor\ndescription: Select\ntools: []\n---\nChoose a worker.\n');
    await writeFile(path.join(directory, 'skills/sample/SKILL.md'), '---\nname: sample\ndescription: Use for tests\n---\nRun a test.\n');
    return directory;
}

test('accepts a complete minimal extension fixture', async context => {
    assert.deepEqual(await validate(await fixture(context)), { agents: 2, skills: 1 });
});

test('rejects broken bundled skill links', async context => {
    const directory = await fixture(context);
    await writeFile(path.join(directory, 'agents/ExampleAdvisor.agent.md'), '---\nname: ExampleAdvisor\ndescription: Select\ntools: []\n---\nRead [missing](../skills/missing/SKILL.md).\n');
    await assert.rejects(validate(directory), /ENOENT/);
});

test('requires agent-level discovery and recovery guidance for extracted skills', async context => {
    const directory = await fixture(context);
    await writeFile(path.join(directory, 'docs/extraction-map.json'), JSON.stringify([
        { skill: 'sample', agents: ['Aro'], sections: [] }
    ]));
    const filename = path.join(directory, 'agents/Aro.agent.md');
    const original = await readFile(filename, 'utf8');
    const reference = 'Read [sample](../skills/sample/SKILL.md).';
    const guidance = [
        'The link is package-relative, not target-workspace-relative.',
        'Load by skill name from the runtime-discovered location.',
        'If unavailable, return the skill name and failed lookup to Aro.'
    ];
    for (const [index, error] of [
        /ambiguous skill path base/,
        /missing skill discovery guidance/,
        /missing procedure recovery handoff/
    ].entries()) {
        await writeFile(filename, `${original}\n${reference}\n\n## Skill Loading\n${guidance.filter((sentence, position) => position !== index).join(' ')}\n`);
        await assert.rejects(validate(directory), error);
    }
    await writeFile(filename, `${original}\n${reference}\n\n## Skill Loading\n${guidance.join(' ')}\n`);
    assert.deepEqual(await validate(directory), { agents: 2, skills: 1 });
    await writeFile(filename, `${original}\n${reference}\n\n## Skill Loading\n${guidance.join(' ')}\n\n## Skill Loading\nRepeated policy.\n`);
    await assert.rejects(validate(directory), /exactly one skill-loading policy/);
});

test('rejects role tool escalation', async context => {
    const directory = await fixture(context);
    await writeFile(path.join(directory, 'agents/ExampleAdvisor.agent.md'), '---\nname: ExampleAdvisor\ndescription: Select\ntools: [execute]\n---\nChoose a worker.\n');
    await assert.rejects(validate(directory), /tool-free/);
});

test('rejects unregistered customizations', async context => {
    const directory = await fixture(context);
    await writeFile(path.join(directory, 'agents/Hidden.agent.md'), '---\nname: Hidden\ndescription: Hidden\ntools: []\n---\nHidden.\n');
    await assert.rejects(validate(directory), /Unregistered customization/);
});

test('rejects skill directory and frontmatter name mismatches', async context => {
    const directory = await fixture(context);
    await writeFile(path.join(directory, 'skills/sample/SKILL.md'), '---\nname: mismatch\ndescription: Use for tests\n---\nRun a test.\n');
    await assert.rejects(validate(directory), /mismatch/);
});

test('rejects a stale dispatcher allowlist', async context => {
    const directory = await fixture(context);
    await writeFile(path.join(directory, 'agents/Aro.agent.md'), '---\nname: Aro\ndescription: Dispatch\ntools: [agent]\nagents: []\n---\nExampleAdvisor.\n');
    await assert.rejects(validate(directory), /allowlist/);
});

test('rejects references to skills missing from the extraction registry', async context => {
    const directory = await fixture(context);
    await writeFile(path.join(directory, 'docs/extraction-map.json'), '[{"skill":"missing","agents":["ExampleAdvisor"],"sections":[]}]');
    await assert.rejects(validate(directory), /Unregistered extracted skill/);
});

test('Aro model learning is automatic, persistent, and has no manual benchmark UI', async () => {
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.main, './src/extension.js');
    assert.ok(manifest.activationEvents.includes('onCommand:agentRoster.openModelLearning'));
    assert.ok(manifest.activationEvents.includes('onView:agentRoster.modelLearning'));
    assert.ok(manifest.contributes.commands.some(command => command.command === 'agentRoster.openModelLearning'));
    assert.ok(manifest.contributes.viewsContainers.activitybar.some(container => container.id === 'agentRoster' && container.icon === 'assets/aro-wireframe.svg'));
    assert.ok(manifest.contributes.views.agentRoster.some(view => view.id === 'agentRoster.modelLearning' && view.type === undefined));
    for (const name of ['aroGetModelRecommendations', 'aroRecordModelOutcome']) {
        const tool = manifest.contributes.languageModelTools.find(entry => entry.name === name);
        assert.ok(tool);
        assert.equal(tool.canBeReferencedInPrompt, true);
        assert.equal(tool.toolReferenceName, name);
    }
    const readTool = manifest.contributes.languageModelTools.find(entry => entry.name === 'aroGetModelRecommendations');
    const recordTool = manifest.contributes.languageModelTools.find(entry => entry.name === 'aroRecordModelOutcome');
    assert.deepEqual(readTool.inputSchema.required, ['activity', 'domain', 'difficulty']);
    assert.deepEqual(recordTool.inputSchema.required, ['activity', 'domain', 'difficulty', 'modelId', 'outcome', 'evidenceCode']);
    assert.equal(recordTool.inputSchema.properties.metrics.additionalProperties, false);
    const aro = await readFile(path.join(root, 'agents/Aro.agent.md'), 'utf8');
    const extensionId = `${manifest.publisher}.${manifest.name}`;
    for (const name of ['aroGetModelRecommendations', 'aroRecordModelOutcome']) {
        assert.ok(aro.includes(`${extensionId}/${name}`));
    }
    assert.equal(manifest.browser, undefined);
    assert.equal(manifest.enabledApiProposals, undefined);
    assert.equal(manifest.dependencies, undefined);
    const extension = await readFile(path.join(root, 'src/extension.js'), 'utf8');
    assert.match(extension, /registerTreeDataProvider\('agentRoster\.modelLearning'/);
    assert.doesNotMatch(extension, /registerWebviewViewProvider\('agentRoster\.modelLearning'/);
    assert.match(extension, /vscode\.lm\.registerTool\('aroGetModelRecommendations'/);
    assert.match(extension, /vscode\.lm\.registerTool\('aroRecordModelOutcome'/);
    assert.match(extension, /context\.globalState\.update\(LEARNING_STORAGE_KEY/);
    assert.match(extension, /getContextualLearningDashboard/);
    // Dashboard and provider availability pages each declare the same restrictive CSP.
    assert.equal((extension.match(/img-src \$\{webview\.cspSource\}/g) || []).length, 2);
    assert.doesNotMatch(extension, /message\.type === 'benchmark'/);
    assert.doesNotMatch(extension, /model\.sendRequest/);
    assert.match(extension, /getManagedPricing\(model, policy\.localModelVendors, policy\.classifications, policy\.providerTypes, policy\.manualPriceTiers\)/);
    assert.match(extension, /selectModels\(availableModels, policy\.localModelVendors, policy\.classifications, scope/);
    assert.match(extension, /getModelsForTask: difficulty => selectModels\(summaries/);
    assert.deepEqual(manifest.contributes.configuration.properties['agentRoster.modelLearning.localModelVendors'].default, []);
    for (const key of ['preferredProvider', 'preferredModel']) {
        const setting = manifest.contributes.configuration.properties[`agentRoster.modelRecommendation.${key}`];
        assert.equal(setting.type, 'string');
        assert.equal(setting.scope, 'window');
        assert.equal(setting.default, '');
    }
    assert.match(extension, /function getWorkspacePreference\(\)/);
    assert.equal(extension.match(/workspacePreference: getWorkspacePreference\(\)/g).length, 4);
    assert.match(extension, /affectsConfiguration\('agentRoster\.modelRecommendation'\)/);
    const modelRecommendationReadme = await readFile(path.join(root, 'README.md'), 'utf8');
    assert.match(modelRecommendationReadme, /agentRoster\.modelRecommendation\.preferredProvider/);
    assert.match(modelRecommendationReadme, /agentRoster\.modelRecommendation\.preferredModel/);
    const handlerRegistration = extension.indexOf('panel.webview.onDidReceiveMessage(message =>', extension.indexOf('function openModelLearning'));
    const htmlAssignment = extension.indexOf('panel.webview.html = getLearningHtml', extension.indexOf('function openModelLearning'));
    assert.ok(handlerRegistration >= 0 && handlerRegistration < htmlAssignment);
    assert.match(extension, /selectChatModelsWithTimeout/);
    assert.match(extension, /MODEL_DISCOVERY_TIMEOUT_MS = 15_000/);
    assert.match(extension, /id="activity-tabs" class="activity-tabs" role="tablist"/);
    assert.match(extension, /id="domain-tabs" class="activity-tabs" role="tablist"/);
    assert.doesNotMatch(extension, /id="view-tabs"|id="inventory-view"|id="model-count"/);
    assert.match(extension, /id="model-catalog"/);
    assert.ok(extension.indexOf('id="domain-filter-label"') < extension.indexOf('id="activity-filter-label"'));
    const recommendationHeading = extension.indexOf('<div class="recommendations-heading"><h2>Learned recommendations</h2>');
    const advisorDefaultLabel = extension.indexOf('<label for="advisor-default-model">Aro &amp; advisors default</label>');
    const recommendationActions = extension.indexOf('<div class="recommendations-actions">');
    assert.ok(recommendationHeading >= 0 && advisorDefaultLabel > recommendationHeading && recommendationActions > advisorDefaultLabel);
    assert.match(extension, /class="recommendations-actions"><button id="open-model-inventory" type="button">Model Inventory<\/button><button id="refresh-learning" type="button">Refresh<\/button>/);
    assert.match(extension, /<th>Provider<\/th><th>Model selection<\/th><th>Type<\/th><\/tr><\/thead><tbody id="providers">/);
    assert.doesNotMatch(extension, /provider-settings|provider-types|provider-controls/);
    const recommendationsViewIndex = extension.indexOf('id="recommendations-view"');
    const modelScopeIndex = extension.indexOf('id="model-scope"');
    assert.ok(modelScopeIndex > recommendationsViewIndex);
    assert.doesNotMatch(extension, /id="context-difficulty"/);
    assert.match(extension, /id="context-count"/);
    assert.doesNotMatch(extension, /class="advisor-model"/);
    assert.match(extension, /id="context-activity-heading">Activity<\/th><th id="context-domain-heading">Domain<\/th><th id="context-difficulty-heading">Difficulty<\/th><th>Recommended model<\/th><th>Evidence<\/th><th>Price<\/th>/);
    const dashboard = await readFile(path.join(root, 'media/model-learning-dashboard.js'), 'utf8');
    assert.match(dashboard, /refreshLearning/);
    assert.match(dashboard, /vscode\.postMessage\(\{ type: 'ready' \}\)/);
    assert.match(dashboard, /recommendedModelId/);
    assert.doesNotMatch(dashboard, /toggle-inventory/);
    assert.doesNotMatch(dashboard, /sendRequest|benchmark|textarea|scorecard.*set/i);
    const dashboardStyles = await readFile(path.join(root, 'media/model-learning-dashboard.css'), 'utf8');
    assert.match(dashboardStyles, /\.context-controls\s*\{[^}]*flex-direction:\s*column/);
    assert.match(dashboardStyles, /\.recommendations-heading\s*\{[^}]*flex-direction:\s*column/);
});

test('maintenance and privacy documentation describe the learning runtime', async () => {
    const maintenance = await readFile(path.join(root, 'docs/maintenance.md'), 'utf8');
    const readme = await readFile(path.join(root, 'README.md'), 'utf8');
    const instructions = await readFile(path.join(root, '.github/copilot-instructions.md'), 'utf8');
    assert.match(maintenance, /extension-host entry point is `src\/extension\.js`/);
    assert.doesNotMatch(maintenance, /no runtime extension-host entry point/i);
    assert.match(readme, /outcome, fixed evidence code, timestamp and optional worker name/);
    assert.match(readme, /profile also stores inventory choices/i);
    assert.match(readme, /src="assets\/aro-learning-dashboard\.png"/);
    const screenshot = await readFile(path.join(root, 'assets/aro-learning-dashboard.png'));
    assert.deepEqual(screenshot.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.match(instructions, /extension host also implements the Aro model-learning tools/i);
    assert.match(instructions, /Future edits must preserve Aro's thin-dispatcher purpose/i);
    assert.match(instructions, /do not give Aro domain, read, search, edit, build, collection, or diagnosis duties/i);
    assert.doesNotMatch(instructions, /should not gain activation code/i);
});

test('Aro consults the required domain advisor before every specialist dispatch', async () => {
    const { body } = parseCustomization(await readFile(path.join(root, 'agents/Aro.agent.md'), 'utf8'), 'Aro');
    const text = body.replace(/\s+/g, ' ');
    assert.match(text, /Before every specialist dispatch, invoke the relevant advisor/);
    assert.match(text, /Before every specialist dispatch, invoke the relevant advisor and consult it for each distinct specialist selection/);
    assert.match(text, /\| Selection Cue \| Worker \| Required Advisor \|/);
    assert.doesNotMatch(text, /Optional Advisor/);
    assert.match(text, /Pre-Blocker Dispatch Gate/);
    assert.match(text, /Report BLOCKED only when the specialist invocation or a required operation actually fails with tool-not-found\/unavailable/);
    assert.match(text, /confirm the exact worker is in your `agents` allowlist/);
    assert.match(text, /Invoke that exact worker with the agent-dispatch tool\. Never substitute local research, diagnosis, or an unrelated tool\./);
    assert.match(text, /Report BLOCKED only when the specialist invocation or a required operation actually fails with tool-not-found\/unavailable/);
    assert.match(text, /Name the unavailable tool or capability and stop/);
    assert.match(text, /Do not infer no access from an uninspected runtime/);
    assert.match(text, /Do not infer no access from an uninspected runtime/);
    assert.match(text, /use an organization URL, project, or configuration as a workaround/);
    assert.doesNotMatch(text, /(?:ask|request)[^.]*(?:organization|project|URL)[^.]*(?:callable|enable)/i);
    assert.doesNotMatch(text, /(?:provide|enter|paste)\s+the organization URL\s*\(/i);
});

test('Azure DevOps worker and Aro reject organization-URL workarounds for missing discovery tools', async () => {
    const worker = parseCustomization(await readFile(path.join(root, 'agents/InfraAzureDevOpsAgent.agent.md'), 'utf8'), 'InfraAzureDevOpsAgent').body;
    const aro = parseCustomization(await readFile(path.join(root, 'agents/Aro.agent.md'), 'utf8'), 'Aro').body.replace(/\s+/g, ' ');
    for (const body of [worker, aro]) {
        assert.doesNotMatch(body, /Provide the organization URL/i);
        assert.doesNotMatch(body, /or enable the Azure DevOps tools so I can check access/i);
    }
    assert.match(worker, /Never infer or fabricate one/);
    assert.match(worker, /Do not ask for an organization when the endpoint may supply default context/);
    assert.match(worker, /Request an explicit organization only after the tool indicates it is required and no configured default can be used/);
    assert.match(aro, /use an organization URL, project, or configuration as a workaround/);
    assert.doesNotMatch(aro, /(?:ask|request)[^.]*(?:organization|project|URL)[^.]*(?:callable|enable)/i);
});

test('Azure DevOps worker states the endpoint default organization rule', async () => {
    const worker = parseCustomization(await readFile(path.join(root, 'agents/InfraAzureDevOpsAgent.agent.md'), 'utf8'), 'InfraAzureDevOpsAgent').body;
    assert.ok(worker.includes('The endpoint may provide a default organization. The agent does not know its configured value and must not read MCP configuration to discover it. On read-only calls, omit the organization argument when the tool schema makes it optional so the endpoint can supply its default.'));
});

test('advisor scopes and shared skill consumers stay aligned', async () => {
    const utility = parseCustomization(await readFile(path.join(root, 'agents/UtilityAdvisor.agent.md'), 'utf8'), 'UtilityAdvisor');
    assert.match(utility.body, /Explicit divergent brainstorming of alternatives, edge cases, or code patterns/);
    assert.match(utility.body, /technical architecture recommendations belong to\s+`CodeDomainAdvisor`/);

    const business = parseCustomization(await readFile(path.join(root, 'agents/BusinessKnowledgeAdvisor.agent.md'), 'utf8'), 'BusinessKnowledgeAdvisor');
    assert.match(business.body, /Persistence-only or formatting-only requests for supplied analysis/);
    assert.match(business.body, /Return `NO_MATCH` rather than selecting a documentation worker/);
    assert.doesNotMatch(business.body, /GovDocumentationSuiteGenerator/);

    const designSystem = parseCustomization(await readFile(path.join(root, 'agents/CodeDesignSystemSpecialist.agent.md'), 'utf8'), 'CodeDesignSystemSpecialist');
    assert.match(designSystem.body, /\]\(\.\.\/skills\/frontend-experience-quality\/SKILL\.md\)/);
    const builder = parseCustomization(await readFile(path.join(root, 'agents/MultiLanguageBuilder.agent.md'), 'utf8'), 'MultiLanguageBuilder');
    assert.doesNotMatch(builder.body, /go-contract-validation/);

    const extractions = JSON.parse(await readFile(path.join(root, 'docs/extraction-map.json'), 'utf8'));
    assert.ok(extractions.find(entry => entry.skill === 'frontend-experience-quality').agents.includes('CodeDesignSystemSpecialist'));
    assert.deepEqual(extractions.find(entry => entry.skill === 'go-contract-validation').agents, ['CodeGeneralist']);
});

test('Aro surfaces evidence-based roster gaps without automatic filing', async () => {
    const { body } = parseCustomization(await readFile(path.join(root, 'agents/Aro.agent.md'), 'utf8'), 'Aro');
    const text = body.replace(/\s+/g, ' ');
    assert.match(text, /## Roster Gap Signals/);
    assert.match(text, /current-conversation evidence/);
    assert.match(text, /Never create an agent, skill, issue, or project automatically/);
    assert.match(text, /consult DocsGovernanceAdvisor and dispatch GovGithubAgent/);
    assert.match(text, /if filing tools or a verified destination are unavailable, provide the draft/);
});

test('sidebar quick controls and status follow saved model policy and outcomes', async () => {
    const tools = new Map();
    const commands = new Map();
    const state = new Map();
    let models = [
        { id: 'cloud', name: 'Cloud', vendor: 'copilot', inputCost: 10, outputCost: 50 },
        { id: 'local', name: 'Local', vendor: 'ollama' },
        { id: 'unknown', name: 'Unknown', vendor: 'other' }
    ];
    state.set('agentRoster.modelLearning.inventory.v1', {
        scope: 'both', priority: 'cloud-first', providerTypes: { ollama: 'local' },
        selections: { '["other","unknown"]': true },
        localTiers: { '["ollama","local"]': 'standard' }
    });
    let sidebar;
    let nextChoice;
    let choices;
    let refreshes = 0;
    let failDiscovery = false;
    const vscode = {
        EventEmitter: class { constructor() { this.event = () => ({ dispose() { } }); } fire() { refreshes += 1; } dispose() { } },
        TreeItem: class { constructor(label) { this.label = label; } },
        TreeItemCollapsibleState: { None: 0 },
        ThemeIcon: class { constructor(id) { this.id = id; } },
        lm: {
            registerTool: (name, tool) => { tools.set(name, tool); return { dispose() { } }; },
            selectChatModels: async () => { if (failDiscovery) throw new Error('provider unavailable'); return models; }
        },
        workspace: { getConfiguration: () => ({ get: () => [], inspect: () => undefined }), onDidChangeConfiguration: () => ({ dispose() { } }) },
        commands: { registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() { } }; } },
        window: {
            registerTreeDataProvider: (name, provider) => { sidebar = provider; return { dispose() { } }; },
            showQuickPick: async items => { choices = items; return items.find(item => item.value === nextChoice); },
            showErrorMessage: message => { throw new Error(message); }
        },
        LanguageModelTextPart: class { constructor(value) { this.value = value; } },
        LanguageModelToolResult: class { constructor(content) { this.content = content; } }
    };
    const localRequire = createRequire(path.join(root, 'src/extension.js'));
    const module = { exports: {} };
    vm.runInNewContext(await readFile(path.join(root, 'src/extension.js'), 'utf8'), {
        module, exports: module.exports,
        require: name => name === 'vscode' ? vscode : localRequire(name), setTimeout, clearTimeout
    });
    module.exports.activate({
        subscriptions: [],
        globalState: { get: key => state.get(key), update: async (key, value) => { state.set(key, value); } }
    });
    let rows = await sidebar.getChildren();
    const row = label => rows.find(item => item.label === label);
    assert.equal(row('Scope').description, 'Both');
    assert.equal(row('Priority').description, 'Cloud first');
    assert.equal(row('Advisor model').description, 'Learned recommendation');
    assert.equal(row('Selected models').description, '1 cloud / 1 local');
    assert.equal(row('Unclassified selected').description, '1');
    assert.equal(row('Unrated local').description, '0');
    assert.equal(row('Outcomes').description, '0');
    assert.equal(row('Latest context').description, 'No recorded outcomes');
    nextChoice = 'local';
    await commands.get('agentRoster.changeModelScope')();
    rows = await sidebar.getChildren();
    assert.equal(row('Scope').description, 'Local only');
    assert.equal(row('Priority').command, undefined);
    nextChoice = 'both';
    await commands.get('agentRoster.changeModelScope')();
    nextChoice = 'local-first';
    await commands.get('agentRoster.changeModelPriority')();
    assert.equal(state.get('agentRoster.modelLearning.inventory.v1').priority, 'local-first');
    await tools.get('aroRecordModelOutcome').invoke({
        input: {
            role: 'coding', taskCategory: 'simple', modelId: 'local', outcome: 'success', evidenceCode: 'acceptance_passed'
        }
    });
    rows = await sidebar.getChildren();
    assert.equal(row('Priority').description, 'Local first');
    assert.equal(row('Outcomes').description, '1');
    assert.equal(row('Latest context: coding / simple').description, 'Local (ollama)');
    assert.ok(refreshes >= 4);
    models = models.filter(model => model.vendor !== 'ollama');
    nextChoice = 'local';
    await commands.get('agentRoster.changeModelScope')();
    assert.deepEqual(Array.from(choices, choice => choice.value), ['cloud']);
    failDiscovery = true;
    rows = await sidebar.getChildren();
    assert.match(row('Models unavailable').tooltip, /provider unavailable/);
    assert.equal(row('Outcomes').description, '1');
});

test('sidebar scope changes refresh a dashboard already loading', { timeout: 3000 }, async () => {
    const commands = new Map();
    const state = new Map();
    state.set('agentRoster.modelLearning.inventory.v1', {
        scope: 'both', priority: 'cloud-first', providerTypes: { ollama: 'local' }
    });
    const models = [{ id: 'cloud', vendor: 'copilot' }, { id: 'local', vendor: 'ollama' }];
    let releaseDiscovery;
    const discoveryGate = new Promise(resolve => { releaseDiscovery = resolve; });
    let delayDiscovery = true;
    let resolveUpdated;
    const updated = new Promise(resolve => { resolveUpdated = resolve; });
    const messages = [];
    const panel = {
        webview: {
            cspSource: 'test', asWebviewUri: uri => uri,
            onDidReceiveMessage: handler => { panel.receive = handler; },
            postMessage: message => {
                if (message.type === 'learningDashboard') {
                    messages.push(message.scope);
                    if (message.scope === 'local') resolveUpdated();
                }
            }
        },
        onDidDispose() { }
    };
    const vscode = {
        EventEmitter: class { constructor() { this.event = () => ({ dispose() { } }); } fire() { } dispose() { } },
        TreeItem: class { constructor(label) { this.label = label; } },
        TreeItemCollapsibleState: { None: 0 }, ThemeIcon: class { },
        lm: {
            registerTool: () => ({ dispose() { } }),
            selectChatModels: async () => {
                if (delayDiscovery) { delayDiscovery = false; await discoveryGate; }
                return models;
            }
        },
        workspace: { getConfiguration: () => ({ get: () => [], inspect: () => undefined }), onDidChangeConfiguration: () => ({ dispose() { } }) },
        commands: { registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() { } }; } },
        window: {
            registerTreeDataProvider: () => ({ dispose() { } }), createWebviewPanel: () => panel,
            showQuickPick: async choices => choices.find(choice => choice.value === 'local'),
            showErrorMessage: message => { throw new Error(message); }
        },
        Uri: { joinPath: (...parts) => parts.join('/') }, ViewColumn: { One: 1 }
    };
    const localRequire = createRequire(path.join(root, 'src/extension.js'));
    const module = { exports: {} };
    vm.runInNewContext(await readFile(path.join(root, 'src/extension.js'), 'utf8'), {
        module, exports: module.exports,
        require: name => name === 'vscode' ? vscode : localRequire(name), setTimeout, clearTimeout
    });
    module.exports.activate({
        subscriptions: [], extensionUri: 'extension',
        globalState: { get: key => state.get(key), update: async (key, value) => { state.set(key, value); } }
    });
    commands.get('agentRoster.openModelLearning')();
    panel.receive({ type: 'ready' });
    await commands.get('agentRoster.changeModelScope')();
    assert.equal(state.get('agentRoster.modelLearning.inventory.v1').scope, 'local');
    releaseDiscovery();
    await updated;
    assert.deepEqual(messages, ['both', 'local']);
});

async function loadSkillProcedureTools() {
    const tools = new Map();
    const vscode = {
        EventEmitter: class { constructor() { this.event = () => ({ dispose() { } }); } fire() { } dispose() { } },
        TreeItem: class { constructor(label) { this.label = label; } },
        TreeItemCollapsibleState: { None: 0 },
        ThemeIcon: class { constructor(id) { this.id = id; } },
        lm: {
            registerTool: (name, tool) => { tools.set(name, tool); return { dispose() { } }; },
            selectChatModels: async () => []
        },
        workspace: { getConfiguration: () => ({ get: () => [], inspect: () => undefined }), onDidChangeConfiguration: () => ({ dispose() { } }) },
        commands: { registerCommand: () => ({ dispose() { } }) },
        window: {
            registerTreeDataProvider: () => ({ dispose() { } }),
            showQuickPick: async () => undefined,
            showErrorMessage: message => { throw new Error(message); }
        },
        LanguageModelTextPart: class { constructor(value) { this.value = value; } },
        LanguageModelToolResult: class { constructor(content) { this.content = content; } }
    };
    const localRequire = createRequire(path.join(root, 'src/extension.js'));
    const module = { exports: {} };
    vm.runInNewContext(await readFile(path.join(root, 'src/extension.js'), 'utf8'), {
        module, exports: module.exports,
        require: name => name === 'vscode' ? vscode : localRequire(name), setTimeout, clearTimeout
    });
    module.exports.activate({
        subscriptions: [], extensionPath: root,
        globalState: { get: () => undefined, update: async () => { } }
    });
    return tools;
}

test('bundled skill procedure tool is contributed with a two-name schema and no path input', async () => {
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    assert.ok(manifest.activationEvents.includes('onLanguageModelTool:aroGetSkillProcedure'));
    const tool = manifest.contributes.languageModelTools.find(entry => entry.name === 'aroGetSkillProcedure');
    assert.ok(tool, 'aroGetSkillProcedure must be contributed');
    assert.equal(tool.toolReferenceName, 'aroGetSkillProcedure');
    assert.deepEqual(tool.inputSchema, {
        type: 'object',
        properties: {
            skill: { type: 'string', enum: ['project-evidence-ingestion', 'project-assessment'] },
            part: { type: 'integer', minimum: 1 }
        },
        required: ['skill'],
        additionalProperties: false
    });
    const source = await readFile(path.join(root, 'src/extension.js'), 'utf8');
    assert.match(source, /lm\.registerTool\('aroGetSkillProcedure'/);
    assert.match(source, /context\.subscriptions\.push\(registerSkillProcedureTool\(context\)\)/);
    const tools = await loadSkillProcedureTools();
    assert.ok(tools.has('aroGetSkillProcedure'), 'activation must register the tool');
});

test('bundled skill procedure tool returns bounded parts that reassemble each allowlisted skill verbatim', async () => {
    const tool = (await loadSkillProcedureTools()).get('aroGetSkillProcedure');
    for (const skill of ['project-evidence-ingestion', 'project-assessment']) {
        const expected = await readFile(path.join(root, 'skills', skill, 'SKILL.md'), 'utf8');
        let assembled = '';
        let total = 1;
        for (let part = 1; part <= total; part++) {
            const result = await tool.invoke({ input: part === 1 ? { skill } : { skill, part } });
            assert.equal(result.content.length, 2);
            const status = result.content[0].value;
            total = Number(/part=\d+ of (\d+)/.exec(status)[1]);
            assert.match(status, new RegExp(`part=${part} of ${total}`));
            assert.ok(result.content[1].value.length <= 4000, `${skill} part ${part} must stay bounded`);
            assembled += result.content[1].value;
        }
        assert.ok(total > 1, `${skill} must be split into several parts`);
        assert.equal(assembled, expected, `${skill} must reassemble verbatim`);
    }
});

test('bundled skill procedure tool rejects out-of-range or non-integer parts', async () => {
    const tool = (await loadSkillProcedureTools()).get('aroGetSkillProcedure');
    for (const part of [0, -1, 1.5, '1', 999]) {
        await assert.rejects(tool.invoke({ input: { skill: 'project-evidence-ingestion', part } }), /Invalid part/, String(part));
    }
});

test('bundled skill procedure tool rejects names outside the allowlist and path-like values', async () => {
    const tool = (await loadSkillProcedureTools()).get('aroGetSkillProcedure');
    const rejected = [
        undefined, {}, { skill: '' }, { skill: 'project-assessment ' }, { skill: 'Project-Assessment' },
        { skill: 'project-evidence-ingestion/../project-assessment' }, { skill: '../../package.json' },
        { skill: '..\\..\\package.json' }, { skill: 'skills/project-assessment/SKILL.md' },
        { skill: path.join(root, 'package.json') }, { skill: 'constructor' }, { skill: '__proto__' },
        { skill: ['project-assessment'] }, { skill: 'AroGetSkillProcedure' }
    ];
    for (const input of rejected) {
        await assert.rejects(tool.invoke({ input }), /Unknown bundled skill/, JSON.stringify(input));
    }
});

test('inventory changes persist and affect dashboard and recommendation tool', async () => {
    const tools = new Map();
    const commands = new Map();
    const state = new Map();
    state.set('agentRoster.modelLearning.inventory.v1', {
        scope: 'local-first',
        providerTypes: { copilotcli: 'local' },
        classifications: { '["copilotcli","cli"]': 'local' },
        selections: { '["copilotcli","cli"]': false }
    });
    state.set('agentRoster.modelLearning.manualSelections.v1', [{
        activity: 'operate', domain: 'github-workflow', difficulty: 'standard', modelId: 'cloud', vendor: 'copilot'
    }]);
    const models = [
        { id: 'cloud', name: 'Cloud', vendor: 'copilot', inputCost: 10, outputCost: 50 },
        { id: 'unpriced', name: 'Unpriced model', vendor: 'copilot' },
        { id: 'cli', name: 'CLI', vendor: 'copilotcli', inputCost: 20, outputCost: 100 },
        { id: 'local', name: 'Local', vendor: 'ollama' }
    ];
    let panel;
    let inventoryPanel;
    let catalog = null;
    let quickPickChoices = [];
    const vscode = {
        EventEmitter: class { constructor() { this.event = () => ({ dispose() { } }); } fire() { } dispose() { } },
        TreeItem: class { constructor(label) { this.label = label; } },
        TreeItemCollapsibleState: { None: 0 },
        ThemeIcon: class { constructor(id) { this.id = id; } },
        lm: {
            registerTool: (name, tool) => { tools.set(name, tool); return { dispose() { } }; },
            selectChatModels: async () => models
        },
        workspace: { getConfiguration: () => ({ get: () => [], inspect: () => undefined }), onDidChangeConfiguration: () => ({ dispose() { } }) },
        commands: { registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() { } }; } },
        window: {
            registerTreeDataProvider: () => ({ dispose() { } }),
            showQuickPick: async choices => {
                quickPickChoices = choices;
                return choices.find(choice => choice.modelId === 'cloud');
            },
            createWebviewPanel: (viewType, title) => {
                const created = {
                    posted: [],
                    webview: {
                        cspSource: 'test',
                        asWebviewUri: uri => uri,
                        onDidReceiveMessage: handler => { created.receive = handler; },
                        postMessage: message => {
                            created.posted.push(message);
                            if (['learningDashboard', 'learningDashboardError'].includes(message.type)) created.resolve?.(message);
                        }
                    },
                    reveal() { },
                    onDidDispose() { }
                };
                if (title === 'Aro Model Inventory') inventoryPanel = created;
                else panel = created;
                return created;
            }
        },
        Uri: { joinPath: (...parts) => parts.join('/') },
        ViewColumn: { One: 1 },
        LanguageModelTextPart: class { constructor(value) { this.value = value; } },
        LanguageModelToolResult: class { constructor(content) { this.content = content; } }
    };
    const localRequire = createRequire(path.join(root, 'src/extension.js'));
    const module = { exports: {} };
    const source = await readFile(path.join(root, 'src/extension.js'), 'utf8');
    vm.runInNewContext(source, {
        module, exports: module.exports,
        require: name => name === 'vscode' ? vscode : localRequire(name),
        setTimeout, clearTimeout
    });
    const context = {
        subscriptions: [], extensionUri: 'extension',
        globalState: { get: key => state.get(key), update: async (key, value) => { state.set(key, value); } }
    };
    module.exports.activate(context);
    commands.get('agentRoster.openModelLearning')();
    const nextDashboard = () => new Promise(resolve => { panel.resolve = resolve; });
    const settle = async () => { for (let index = 0; index < 20; index += 1) await new Promise(resolve => setImmediate(resolve)); };
    const catalogChange = async message => {
        const response = nextDashboard();
        inventoryPanel.receive(message);
        const update = await response;
        await settle();
        catalog = inventoryPanel.posted.filter(entry => entry.type === 'providerAvailability').at(-1);
        return update;
    };
    let response = nextDashboard();
    panel.receive({ type: 'ready' });
    let dashboard = await response;
    commands.get('agentRoster.openModelInventory')();
    inventoryPanel.receive({ type: 'ready' });
    await settle();
    catalog = inventoryPanel.posted.filter(entry => entry.type === 'providerAvailability').at(-1);
    assert.equal(dashboard.scope, 'cloud');
    assert.equal(dashboard.hasSelectedLocalModel, false);
    assert.equal(dashboard.priority, 'local-first');
    assert.equal(catalog.catalog.find(model => model.id === 'local').kind, 'unknown');
    assert.equal(catalog.catalog.find(model => model.id === 'cli').kind, 'cloud');
    assert.equal(catalog.providerTypes.copilotcli, 'cloud');
    assert.ok(catalog.lockedProviders.includes('copilot'));
    assert.ok(catalog.lockedProviders.includes('copilotcli'));
    const migratedPin = dashboard.dashboard.find(row => row.activity === 'operate'
        && row.domain === 'documentation-governance' && row.difficulty === 'standard');
    assert.equal(migratedPin.manualSelection.modelId, 'cloud');
    const migratedPinResult = await tools.get('aroGetModelRecommendations').invoke({
        input: {
            activity: 'operate', domain: 'documentation-governance', difficulty: 'standard'
        }
    });
    assert.equal(JSON.parse(migratedPinResult.content[0].value).selectionMode, 'manual');
    for (const vendor of ['copilot', 'copilotcli']) {
        inventoryPanel.posted.length = 0;
        inventoryPanel.receive({ type: 'setProviderType', vendor, kind: 'local' });
        await settle();
        const rejected = inventoryPanel.posted.find(message => message.type === 'providerAvailabilityError');
        assert.match(rejected.error, /always cloud/);
    }
    const initialResult = await tools.get('aroGetModelRecommendations').invoke({ input: { role: 'coding', taskCategory: 'simple' } });
    assert.equal(JSON.parse(initialResult.content[0].value).modelScope, 'cloud');
    response = nextDashboard();
    panel.receive({ type: 'setModelScope', scope: 'both' });
    const unavailableScope = await response;
    assert.equal(unavailableScope.type, 'learningDashboardError');
    assert.match(unavailableScope.error, /Select a local model/);
    assert.equal(state.get('agentRoster.modelLearning.inventory.v1').scope, 'local-first');
    dashboard = await catalogChange({ type: 'setProviderType', vendor: 'ollama', kind: 'local' });
    assert.equal(catalog.catalog.find(model => model.id === 'local').kind, 'local');
    dashboard = await catalogChange({ type: 'setModelSelected', id: 'local', vendor: 'ollama', selected: true });
    assert.equal(catalog.catalog.find(model => model.id === 'local').selected, true);
    assert.equal(dashboard.hasSelectedLocalModel, true);
    response = nextDashboard();
    panel.receive({ type: 'setModelScope', scope: 'both' });
    dashboard = await response;
    assert.equal(dashboard.scope, 'both');
    assert.equal(dashboard.dashboard.find(row => row.activity === 'implement' && row.domain === 'coding' && row.difficulty === 'simple').recommendedModelId, 'cloud');
    response = nextDashboard();
    panel.receive({ type: 'chooseManualModel', activity: 'implement', domain: 'coding', difficulty: 'simple' });
    dashboard = await response;
    assert.ok(quickPickChoices.some(choice => choice.modelId === 'cloud' && choice.vendor === 'copilot'));
    const pinnedRow = dashboard.dashboard.find(row => row.activity === 'implement' && row.domain === 'coding' && row.difficulty === 'simple');
    assert.equal(pinnedRow.manualSelection.modelId, 'cloud');
    assert.equal(pinnedRow.selectionMode, 'manual');
    const contextualManualResult = await tools.get('aroGetModelRecommendations').invoke({
        input: {
            activity: 'implement', domain: 'coding', difficulty: 'simple'
        }
    });
    assert.equal(JSON.parse(contextualManualResult.content[0].value).selectionMode, 'manual');
    assert.equal(JSON.parse(contextualManualResult.content[0].value).recommendedModelId, 'cloud');
    response = nextDashboard();
    panel.receive({ type: 'useLearnedModel', activity: 'implement', domain: 'coding', difficulty: 'simple' });
    dashboard = await response;
    assert.equal(state.get('agentRoster.modelLearning.manualSelections.v1').some(selection => selection.activity === 'implement'
        && selection.domain === 'coding' && selection.difficulty === 'simple'), false);
    assert.notEqual(dashboard.dashboard.find(row => row.activity === 'implement' && row.domain === 'coding' && row.difficulty === 'simple').selectionMode, 'manual');
    dashboard = await catalogChange({ type: 'setLocalTier', id: 'local', vendor: 'ollama', tier: 'standard' });
    assert.equal(catalog.catalog.find(model => model.id === 'local').localTier, 'standard');
    response = nextDashboard();
    panel.receive({ type: 'setModelScope', scope: 'local' });
    dashboard = await response;
    assert.equal(dashboard.scope, 'local');
    assert.equal(dashboard.dashboard.find(row => row.activity === 'implement' && row.domain === 'coding' && row.difficulty === 'simple').recommendedModelId, 'local');
    const result = await tools.get('aroGetModelRecommendations').invoke({ input: { role: 'coding', taskCategory: 'simple' } });
    const recommendation = JSON.parse(result.content[0].value);
    assert.equal(recommendation.modelScope, 'local');
    assert.equal(recommendation.modelPriority, null);
    assert.equal(recommendation.recommendedModelId, 'local');
    assert.deepEqual(recommendation.candidates.map(candidate => candidate.id), ['local']);
    const disconnectedLocal = models.pop();
    const offlineResult = await tools.get('aroGetModelRecommendations').invoke({ input: { role: 'coding', taskCategory: 'simple' } });
    assert.equal(JSON.parse(offlineResult.content[0].value).modelScope, 'local');
    assert.equal(JSON.parse(offlineResult.content[0].value).recommendedModelId, null);
    assert.equal(state.get('agentRoster.modelLearning.inventory.v1').scope, 'local');
    models.push(disconnectedLocal);
    response = nextDashboard();
    panel.receive({ type: 'setModelScope', scope: 'both' });
    await response;
    response = nextDashboard();
    panel.receive({ type: 'setModelPriority', priority: 'local-first' });
    dashboard = await response;
    assert.equal(dashboard.scope, 'both');
    assert.equal(dashboard.priority, 'local-first');
    assert.equal(dashboard.dashboard.find(row => row.activity === 'implement' && row.domain === 'coding' && row.difficulty === 'simple').recommendedModelId, 'local');
    const advisorResult = await tools.get('aroGetModelRecommendations').invoke({ input: { role: 'advisor', taskCategory: 'simple' } });
    assert.equal(JSON.parse(advisorResult.content[0].value).recommendedModelId, 'local');
    const advisorFallback = await tools.get('aroGetModelRecommendations').invoke({ input: { role: 'advisor', taskCategory: 'simple', excludedProviders: ['ollama'] } });
    assert.equal(JSON.parse(advisorFallback.content[0].value).recommendedModelId, 'cloud');
    assert.equal(state.has('agentRoster.modelLearning.scorecard.v1'), false);
    const contextualResult = await tools.get('aroGetModelRecommendations').invoke({
        input: {
            activity: 'advise', domain: 'coding', difficulty: 'standard'
        }
    });
    const contextualRecommendation = JSON.parse(contextualResult.content[0].value);
    assert.match(contextualRecommendation.callId, /^[0-9a-f]{32}$/);
    const contextualOutcome = await tools.get('aroRecordModelOutcome').invoke({
        input: {
            activity: 'advise', domain: 'coding', difficulty: 'standard', agent: 'CodeDomainAdvisor',
            callId: contextualRecommendation.callId, modelId: 'local', outcome: 'success', evidenceCode: 'acceptance_passed',
            metrics: { durationMs: 900, costUsd: 0.01 }
        }
    });
    assert.equal(JSON.parse(contextualOutcome.content[0].value).activity, 'advise');
    assert.equal(state.get('agentRoster.modelLearning.scorecard.v1').records.at(-1).metrics.durationMs, 900);
    assert.equal(state.get('agentRoster.modelLearning.scorecard.v1').records.at(-1).callId, contextualRecommendation.callId);
    assert.equal(contextualRecommendation.activity, 'advise');
    assert.equal(contextualRecommendation.domain, 'coding');
    assert.equal(contextualRecommendation.difficulty, 'standard');
    assert.equal(contextualRecommendation.recommendedModelId, 'local');
    assert.equal(dashboard.dashboard.find(row => row.activity === 'implement' && row.domain === 'coding' && row.difficulty === 'complex').recommendedModelId, null);
    assert.equal(dashboard.dashboard.find(row => row.activity === 'implement' && row.domain === 'coding' && row.difficulty === 'complex').eligibleCount, 1);
    const complexResult = await tools.get('aroGetModelRecommendations').invoke({ input: { role: 'coding', taskCategory: 'complex' } });
    assert.equal(JSON.parse(complexResult.content[0].value).modelPriority, 'local-first');
    assert.equal(JSON.parse(complexResult.content[0].value).recommendedModelId, null);
    assert.equal(JSON.parse(complexResult.content[0].value).selectionMode, 'fallback');
    assert.ok(JSON.parse(complexResult.content[0].value).candidates.some(candidate => candidate.id === 'cloud'));
    const temporarilyUnavailable = models.pop();
    const unavailableResult = await tools.get('aroGetModelRecommendations').invoke({ input: { role: 'coding', taskCategory: 'simple' } });
    assert.equal(JSON.parse(unavailableResult.content[0].value).modelScope, 'cloud');
    assert.equal(state.get('agentRoster.modelLearning.inventory.v1').scope, 'both');
    models.push(temporarilyUnavailable);
    response = nextDashboard();
    panel.receive({ type: 'setModelPriority', priority: 'cloud-first' });
    dashboard = await response;
    assert.equal(dashboard.priority, 'cloud-first');
    assert.equal(dashboard.dashboard.find(row => row.activity === 'implement' && row.domain === 'coding' && row.difficulty === 'simple').recommendedModelId, 'cloud');
    const cloudResult = await tools.get('aroGetModelRecommendations').invoke({ input: { role: 'coding', taskCategory: 'simple' } });
    assert.equal(JSON.parse(cloudResult.content[0].value).recommendedModelId, 'cloud');
    response = nextDashboard();
    panel.receive({ type: 'setModelScope', scope: 'local' });
    await response;
    dashboard = await catalogChange({ type: 'setProviderSelected', vendor: 'ollama', selected: false });
    assert.equal(catalog.catalog.find(model => model.id === 'local').selected, false);
    assert.equal(dashboard.scope, 'cloud');
    assert.equal(dashboard.hasSelectedLocalModel, false);
    assert.equal(dashboard.dashboard.find(row => row.activity === 'implement' && row.domain === 'coding' && row.difficulty === 'simple').recommendedModelId, 'cloud');
    const afterRemoval = await tools.get('aroGetModelRecommendations').invoke({ input: { role: 'coding', taskCategory: 'simple' } });
    assert.equal(JSON.parse(afterRemoval.content[0].value).modelScope, 'cloud');
    assert.equal(state.get('agentRoster.modelLearning.inventory.v1').scope, 'cloud');
    dashboard = await catalogChange({ type: 'setProviderSelected', vendor: 'ollama', selected: true });
    assert.equal(catalog.catalog.find(model => model.id === 'local').selected, true);
    response = nextDashboard();
    panel.receive({ type: 'setModelScope', scope: 'local' });
    await response;
    commands.get('agentRoster.openModelLearning')();
    response = nextDashboard();
    panel.receive({ type: 'ready' });
    dashboard = await response;
    assert.equal(dashboard.scope, 'local');
    assert.equal(dashboard.priority, 'cloud-first');
    assert.equal(dashboard.models.find(model => model.id === 'local').localTier, 'standard');
    assert.equal(dashboard.models.find(model => model.id === 'local').selected, true);
    response = nextDashboard();
    panel.receive({ type: 'setModelScope', scope: 'both' });
    dashboard = await response;
    assert.equal(dashboard.priority, 'cloud-first');
    assert.equal(dashboard.dashboard.find(row => row.activity === 'implement' && row.domain === 'coding' && row.difficulty === 'simple').recommendedModelId, 'cloud');
    dashboard = await catalogChange({ type: 'setManualPriceTier', id: 'unpriced', vendor: 'copilot', tier: 'medium' });
    assert.equal(dashboard.models.find(model => model.id === 'unpriced').pricing.source, 'manual');
    response = nextDashboard();
    panel.receive({ type: 'setModelScope', scope: 'cloud' });
    await response;
    const manualResult = await tools.get('aroGetModelRecommendations').invoke({ input: { role: 'coding', taskCategory: 'simple' } });
    assert.equal(JSON.parse(manualResult.content[0].value).candidates.find(candidate => candidate.id === 'unpriced').pricing.budgetClass, 'medium');
    dashboard = await catalogChange({ type: 'setModelSelected', id: 'cloud', vendor: 'copilot', selected: false });
    assert.equal(dashboard.dashboard.find(row => row.activity === 'implement' && row.domain === 'coding' && row.difficulty === 'simple').recommendedModelId, 'unpriced');
    dashboard = await catalogChange({ type: 'setManualPriceTier', id: 'unpriced', vendor: 'copilot', tier: 'unpriced' });
    assert.equal(dashboard.dashboard.find(row => row.activity === 'implement' && row.domain === 'coding' && row.difficulty === 'simple').recommendedModelId, null);
    models.push(...Array.from({ length: 60 }, (_, index) => ({
        id: `additional-${index}`, name: `Additional ${index}`, vendor: 'copilot', inputCost: 10, outputCost: 50
    })));
    const compactResult = await tools.get('aroGetModelRecommendations').invoke({ input: { role: 'coding', taskCategory: 'simple' } });
    const compact = JSON.parse(compactResult.content[0].value);
    assert.equal(compact.eligibleCount, 60);
    assert.equal(compact.unpricedCount, 1);
    assert.equal(compact.truncated, true);
    assert.ok(compact.candidates.length <= 8);
    assert.ok(compact.candidates.some(candidate => candidate.id === compact.recommendedModelId));
    assert.ok(Buffer.byteLength(compactResult.content[0].value) < 3500);
    await catalogChange({ type: 'setModelSelected', id: 'cli', vendor: 'copilotcli', selected: true });
    const fallbackResult = await tools.get('aroGetModelRecommendations').invoke({
        input: {
            role: 'coding', taskCategory: 'simple', excludedProviders: ['copilot']
        }
    });
    const fallback = JSON.parse(fallbackResult.content[0].value);
    assert.equal(fallback.modelScope, 'cloud');
    assert.equal(fallback.recommendedModelId, 'cli');
    assert.ok(fallback.candidates.every(candidate => candidate.vendor !== 'copilot'));
    response = nextDashboard();
    panel.receive({ type: 'setModelScope', scope: 'local' });
    await response;
    const localExhausted = await tools.get('aroGetModelRecommendations').invoke({
        input: {
            role: 'coding', taskCategory: 'simple', excludedModels: [{ id: 'local', vendor: 'ollama' }]
        }
    });
    const exhausted = JSON.parse(localExhausted.content[0].value);
    assert.equal(exhausted.modelScope, 'local');
    assert.equal(exhausted.recommendedModelId, null);
    assert.equal(exhausted.candidates.length, 0);
    const restored = await tools.get('aroGetModelRecommendations').invoke({ input: { role: 'coding', taskCategory: 'simple' } });
    assert.equal(JSON.parse(restored.content[0].value).recommendedModelId, 'local');
});

async function loadWorkspacePreferenceHarness({ workspaceFolders, workspaceValues = {}, updateError }) {
    const commands = new Map();
    const state = new Map();
    const updates = [];
    const warnings = [];
    const errors = [];
    let panel;
    state.set('agentRoster.modelLearning.inventory.v1', {
        scope: 'both',
        providerTypes: { ollama: 'local', copilotcli: 'cloud' },
        classifications: {},
        selections: {},
        localTiers: { '["ollama","local"]': 'simple' }
    });
    const models = [
        { id: 'cloud', name: 'Cloud', vendor: 'copilot', inputCost: 10, outputCost: 50 },
        { id: 'cli', name: 'CLI', vendor: 'copilotcli', inputCost: 20, outputCost: 100 },
        { id: 'local', name: 'Local', vendor: 'ollama' }
    ];
    // A user-level value must never leak into the workspace-only read.
    const configuration = {
        get: () => 'user-level',
        inspect: key => ({ key, workspaceValue: workspaceValues[key] }),
        update: async (key, value, target) => {
            if (updateError) throw new Error(updateError);
            updates.push({ key, value, target });
            workspaceValues[key] = value;
        }
    };
    const vscode = {
        EventEmitter: class { constructor() { this.event = () => ({ dispose() { } }); } fire() { } dispose() { } },
        TreeItem: class { constructor(label) { this.label = label; } },
        TreeItemCollapsibleState: { None: 0 },
        ThemeIcon: class { constructor(id) { this.id = id; } },
        ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
        lm: {
            registerTool: () => ({ dispose() { } }),
            selectChatModels: async () => models
        },
        workspace: {
            workspaceFolders,
            getConfiguration: section => section === 'agentRoster.modelRecommendation' ? configuration : { get: (key, fallback) => fallback, inspect: () => undefined },
            onDidChangeConfiguration: () => ({ dispose() { } })
        },
        commands: { registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() { } }; } },
        window: {
            registerTreeDataProvider: () => ({ dispose() { } }),
            showQuickPick: async () => undefined,
            showWarningMessage: message => { warnings.push(message); return Promise.resolve(undefined); },
            showErrorMessage: message => { errors.push(message); },
            createWebviewPanel: () => {
                panel = {
                    webview: {
                        cspSource: 'test',
                        asWebviewUri: uri => uri,
                        onDidReceiveMessage: handler => { panel.receive = handler; },
                        postMessage: message => { if (['learningDashboard', 'learningDashboardError'].includes(message.type)) panel.resolve(message); }
                    },
                    onDidDispose() { }
                };
                return panel;
            }
        },
        Uri: { joinPath: (...parts) => parts.join('/') },
        ViewColumn: { One: 1 },
        LanguageModelTextPart: class { constructor(value) { this.value = value; } },
        LanguageModelToolResult: class { constructor(content) { this.content = content; } }
    };
    const localRequire = createRequire(path.join(root, 'src/extension.js'));
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
    commands.get('agentRoster.openModelLearning')();
    const send = async message => {
        const response = new Promise(resolve => { panel.resolve = resolve; });
        panel.receive(message);
        return response;
    };
    return { send, updates, warnings, errors, workspaceValues, vscode };
}

test('workspace preference is read from workspace values only and reported in the dashboard payload', async () => {
    const harness = await loadWorkspacePreferenceHarness({ workspaceFolders: [{ name: 'repo' }], workspaceValues: { preferredProvider: 'copilot', preferredModel: 'cloud' } });
    const dashboard = await harness.send({ type: 'ready' });
    assert.equal(dashboard.type, 'learningDashboard');
    const preference = dashboard.workspacePreference;
    assert.equal(preference.hasWorkspace, true);
    assert.equal(preference.active, true);
    assert.equal(preference.preferredProvider, 'copilot');
    assert.equal(preference.preferredModel, 'cloud');
    assert.equal(preference.providerAvailable, true);
    assert.equal(preference.modelAvailable, true);
    assert.ok(preference.providers.find(provider => provider.vendor === 'copilot').models.some(model => model.id === 'cloud'));

    const profile = await loadWorkspacePreferenceHarness({ workspaceFolders: [{ name: 'repo' }] });
    const unset = (await profile.send({ type: 'ready' })).workspacePreference;
    assert.equal(unset.active, false);
    assert.equal(unset.preferredProvider, '');
    assert.equal(unset.preferredModel, '');
});

test('workspace selection writes only the two workspace keys and keeps unrelated settings', async () => {
    const harness = await loadWorkspacePreferenceHarness({ workspaceFolders: [{ name: 'repo' }], workspaceValues: { unrelated: 'kept' } });
    await harness.send({ type: 'ready' });
    const exact = await harness.send({ type: 'setWorkspacePreference', scope: 'workspace', preferredProvider: 'copilot', preferredModel: 'cloud' });
    assert.equal(exact.type, 'learningDashboard');
    assert.equal(exact.workspacePreference.preferredModel, 'cloud');
    assert.deepEqual(harness.updates.map(({ key, value, target }) => [key, value, target]), [
        ['preferredProvider', 'copilot', harness.vscode.ConfigurationTarget.Workspace],
        ['preferredModel', 'cloud', harness.vscode.ConfigurationTarget.Workspace]
    ]);

    harness.updates.length = 0;
    const providerOnly = await harness.send({ type: 'setWorkspacePreference', scope: 'workspace', preferredProvider: 'copilot', preferredModel: '' });
    assert.equal(providerOnly.workspacePreference.preferredProvider, 'copilot');
    assert.equal(harness.workspaceValues.preferredModel, undefined);
    assert.equal(harness.workspaceValues.unrelated, 'kept');
});

test('profile scope clears only the two workspace preference keys', async () => {
    const harness = await loadWorkspacePreferenceHarness({
        workspaceFolders: [{ name: 'repo' }],
        workspaceValues: { preferredProvider: 'copilot', preferredModel: 'cloud', unrelated: 'kept' }
    });
    await harness.send({ type: 'ready' });
    const result = await harness.send({ type: 'setWorkspacePreference', scope: 'profile' });
    assert.equal(result.type, 'learningDashboard');
    assert.equal(result.workspacePreference.active, false);
    assert.deepEqual(harness.updates.map(({ key, value }) => [key, value]), [['preferredProvider', undefined], ['preferredModel', undefined]]);
    assert.equal(harness.workspaceValues.unrelated, 'kept');
});

test('invalid, ineligible, or folderless workspace writes are rejected without changing settings', async () => {
    const harness = await loadWorkspacePreferenceHarness({ workspaceFolders: [{ name: 'repo' }] });
    await harness.send({ type: 'ready' });
    for (const message of [
        { scope: 'workspace', preferredProvider: 'missing', preferredModel: '' },
        { scope: 'workspace', preferredProvider: 'copilot', preferredModel: 'gone' },
        { scope: 'workspace', preferredProvider: 'copilot', preferredModel: 'cli' },
        { scope: 'workspace', preferredProvider: 42, preferredModel: '' },
        { scope: 'workspace', preferredProvider: '', preferredModel: 'cloud' },
        { scope: 'unknown' }
    ]) {
        const result = await harness.send({ type: 'setWorkspacePreference', ...message });
        assert.equal(result.type, 'learningDashboardError', JSON.stringify(message));
    }
    assert.deepEqual(harness.updates, []);

    const folderless = await loadWorkspacePreferenceHarness({ workspaceFolders: undefined });
    await folderless.send({ type: 'ready' });
    const blocked = await folderless.send({ type: 'setWorkspacePreference', scope: 'profile' });
    assert.equal(blocked.type, 'learningDashboardError');
    assert.match(blocked.error, /Open a folder/);
    assert.deepEqual(folderless.updates, []);
});

test('workspace write failures are reported to the dashboard', async () => {
    const harness = await loadWorkspacePreferenceHarness({ workspaceFolders: [{ name: 'repo' }], updateError: 'read-only' });
    await harness.send({ type: 'ready' });
    const result = await harness.send({ type: 'setWorkspacePreference', scope: 'workspace', preferredProvider: 'copilot', preferredModel: '' });
    assert.equal(result.type, 'learningDashboardError');
    assert.match(result.error, /read-only/);
});

test('a saved workspace model that is no longer eligible is reported, not removed', async () => {
    const harness = await loadWorkspacePreferenceHarness({ workspaceFolders: [{ name: 'repo' }], workspaceValues: { preferredProvider: 'copilot', preferredModel: 'gone' } });
    const preference = (await harness.send({ type: 'ready' })).workspacePreference;
    assert.equal(preference.providerAvailable, true);
    assert.equal(preference.modelAvailable, false);
    assert.equal(harness.workspaceValues.preferredModel, 'gone');
    assert.deepEqual(harness.updates, []);
});

test('the Settings-opening configure command is removed from the manifest, sidebar, and documentation', async () => {
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.activationEvents.some(event => event.includes('configureWorkspaceModelPreferences')), false);
    assert.equal(manifest.contributes.commands.some(command => command.command.includes('configureWorkspaceModelPreferences')), false);
    const extension = await readFile(path.join(root, 'src/extension.js'), 'utf8');
    assert.doesNotMatch(extension, /configureWorkspaceModelPreferences|Configure workspace model preferences|openWorkspaceSettings/);
    const readme = await readFile(path.join(root, 'README.md'), 'utf8');
    assert.doesNotMatch(readme, /configureWorkspaceModelPreferences|Configure workspace model preferences/);
});

test('learning webview sends scope, priority, and recommendation changes', async () => {
    const elements = new Map();
    const messages = [];
    let receive;
    class Element {
        constructor() { this.children = []; this.listeners = {}; this.value = ''; this.dataset = {}; this.attributes = {}; }
        addEventListener(type, handler) { this.listeners[type] = handler; }
        setAttribute(name, value) { this.attributes[name] = value; }
        focus() { this.focused = true; }
        append(...children) { this.children.push(...children); }
        replaceChildren() { this.children = []; }
    }
    for (const id of ['models', 'model-search', 'model-count', 'model-count-label', 'provider-policy-note', 'show-excluded', 'open-model-inventory', 'recommendations', 'recommendations-panel', 'recommendations-view', 'inventory-view', 'view-tabs', 'learning-status', 'learning-message', 'refresh-learning', 'advisor-default-model', 'model-scope', 'model-priority', 'providers', 'activity-tabs', 'domain-tabs', 'context-count', 'context-activity-heading', 'context-domain-heading', 'context-difficulty-heading', 'preference-scope-profile', 'preference-scope-workspace', 'workspace-preference-fields', 'workspace-provider', 'workspace-model', 'clear-workspace-preference', 'workspace-preference-status']) {
        elements.set(id, new Element());
    }
    const scopeControls = ['cloud', 'local', 'both'].map(value => Object.assign(new Element(), { name: 'model-scope', value }));
    const document = {
        getElementById: id => elements.get(id),
        createElement: () => new Element(),
        querySelectorAll: selector => selector.startsWith('#model-scope input') ? scopeControls : []
    };
    const source = await readFile(path.join(root, 'media/model-learning-dashboard.js'), 'utf8');
    vm.runInNewContext(source, {
        document,
        window: { addEventListener: (type, handler) => { if (type === 'message') receive = handler; } },
        acquireVsCodeApi: () => ({ postMessage: message => messages.push(JSON.parse(JSON.stringify(message))) })
    });
    assert.equal(messages[0].type, 'ready');
    assert.equal(elements.get('activity-tabs').children.length, 7);
    assert.equal(elements.get('activity-tabs').children[0].textContent, 'All');
    assert.equal(elements.get('domain-tabs').children.length, 6);
    assert.equal(elements.get('domain-tabs').children[0].textContent, 'All');
    receive({
        data: {
            type: 'learningDashboard', models: [
                { id: 'm', name: 'Model', vendor: 'ollama', kind: 'local', selected: true, localTier: 'unrated', pricing: {} },
                { id: 'c', name: 'Cloud', vendor: 'copilot', kind: 'cloud', selected: true, pricing: { source: 'unpriced', budgetClass: 'unpriced' } },
                { id: 'cli', name: 'CLI', vendor: 'copilotcli', kind: 'cloud', selected: true, pricing: { source: 'vscode', budgetClass: 'high' } }
            ], excludedModels: [], providerPolicyLabel: 'All providers', providerTypes: { ollama: 'local', copilot: 'cloud', copilotcli: 'cloud' }, lockedProviders: ['copilot', 'copilotcli'], dashboard: [
                { activity: 'implement', domain: 'coding', difficulty: 'simple', recommendedModelId: 'c', recommendedVendor: 'copilot', learnedRecommendedModelId: 'c', learnedRecommendedVendor: 'copilot', sampleCount: 4, pooledSampleCount: 2, selectionMode: 'pooled', candidates: [{ id: 'c', name: 'Cloud', vendor: 'copilot', selectionMode: 'pooled', evidenceSource: 'mixed', samples: 3, pooledSamples: 2, successes: 3, failures: 1, score: 2 / 3, averageDurationMs: 1250, averageCostUsd: 0.0123, pricing: { source: 'vscode', budgetClass: 'low' } }] },
                { activity: 'advise', domain: 'infrastructure', difficulty: 'complex', recommendedModelId: 'm', recommendedVendor: 'ollama', learnedRecommendedModelId: 'c', learnedRecommendedVendor: 'copilot', manualSelection: { modelId: 'm', vendor: 'ollama' }, sampleCount: 0, pooledSampleCount: 0, selectionMode: 'manual', eligibleCount: 1, candidates: [{ id: 'm', name: 'Model', vendor: 'ollama', selectionMode: 'manual', pricing: { source: 'local', budgetClass: 'low' } }, { id: 'c', name: 'Cloud', vendor: 'copilot', selectionMode: 'learned', pricing: { source: 'vscode', budgetClass: 'low' } }] }
            ], recordCount: 6, scope: 'both', priority: 'cloud-first', hasSelectedLocalModel: true, pinnedAdvisorModel: { modelId: 'c', vendor: 'copilot' }
        }
    });
    assert.equal(elements.get('recommendations').children.length, 2);
    assert.equal(elements.get('recommendations').children[0].children.length, 6);
    assert.equal(elements.get('recommendations').children[0].children[0].textContent, 'Implement');
    assert.equal(elements.get('recommendations').children[0].children[1].textContent, 'Coding');
    assert.equal(elements.get('recommendations').children[0].children[2].textContent, 'Simple');
    assert.equal(elements.get('context-count').textContent, 'Showing 2 of 2 contexts');
    assert.equal(elements.get('recommendations').children[0].children[4].children[0].textContent, '3 exact / 2 pooled');
    assert.equal(elements.get('recommendations').children[0].children[4].children[1].textContent, '3 pass / 1 fail; 67% smoothed score');
    assert.equal(elements.get('recommendations').children[0].children[5].textContent, 'low');
    assert.match(elements.get('recommendations').children[0].children[3].children[0].title, /Selection mode: Pooled evidence/);
    assert.match(elements.get('recommendations').children[0].children[3].children[0].title, /Average measured duration: 1250 ms/);
    assert.match(elements.get('recommendations').children[0].children[5].title, /Price source: Native rate/);
    const learnedCell = elements.get('recommendations').children[0].children[3];
    assert.equal(learnedCell.children.length, 1);
    assert.equal(learnedCell.children[0].textContent, 'Cloud (copilot)');
    assert.match(learnedCell.children[0].attributes['aria-label'], /Choose manual model/);
    const manualCell = elements.get('recommendations').children[1].children[3];
    assert.equal(manualCell.children[0].textContent, 'Model (ollama)');
    assert.equal(manualCell.children[1].textContent, 'X');
    assert.equal(manualCell.children[1].attributes['aria-label'].startsWith('Clear manual selection'), true);
    assert.equal(manualCell.children[2].textContent, 'Suggested: Cloud (copilot)');
    assert.equal(elements.get('context-domain-heading').hidden, false);
    const advisorDefault = elements.get('advisor-default-model');
    assert.deepEqual(advisorDefault.children.map(option => option.textContent), ['Learned recommendations', 'Model (ollama)', 'Cloud (copilot)', 'CLI (copilotcli)']);
    assert.equal(advisorDefault.children[0].value, '');
    assert.equal(advisorDefault.value, JSON.stringify(['copilot', 'c']));
    assert.equal(elements.get('pin-advisor-model'), undefined);
    assert.notEqual(elements.get('context-difficulty-heading').hidden, true);
    elements.get('activity-tabs').children[0].listeners.keydown({ key: 'ArrowRight', preventDefault() { } });
    assert.equal(elements.get('recommendations').children.length, 1);
    assert.equal(elements.get('context-count').textContent, 'Showing 1 of 2 contexts');
    assert.equal(elements.get('recommendations').children[0].children[0].hidden, true);
    assert.equal(elements.get('context-activity-heading').hidden, true);
    const implementTab = elements.get('activity-tabs').children.find(tab => tab.dataset.filterValue === 'implement');
    implementTab.listeners.click();
    assert.equal(elements.get('recommendations').children.length, 1);
    assert.equal(elements.get('context-count').textContent, 'Showing 1 of 2 contexts');
    assert.equal(elements.get('activity-tabs').children.find(tab => tab.dataset.filterValue === 'implement').focused, true);
    elements.get('domain-tabs').children[0].listeners.keydown({ key: 'ArrowRight', preventDefault() { } });
    assert.equal(elements.get('recommendations').children.length, 1);
    assert.equal(elements.get('recommendations').children[0].children[1].hidden, true);
    assert.equal(elements.get('context-domain-heading').hidden, true);
    assert.equal(elements.get('recommendations').children[0].children[2].hidden, undefined);
    assert.equal(elements.get('context-difficulty-heading').hidden, undefined);
    assert.equal(elements.get('domain-tabs').children.find(tab => tab.dataset.filterValue === 'coding').focused, true);
    elements.get('domain-tabs').children.find(tab => tab.dataset.filterValue === 'all').listeners.click();
    assert.equal(elements.get('recommendations').children[0].children[1].hidden, false);
    assert.equal(elements.get('context-domain-heading').hidden, false);
    assert.equal(elements.get('model-priority').disabled, false);
    assert.equal(scopeControls[1].disabled, false);
    assert.equal(scopeControls[2].disabled, false);
    assert.equal(elements.get('model-priority').value, 'cloud-first');
    elements.get('model-priority').listeners.change({ target: { value: 'local-first' } });
    assert.deepEqual(messages.at(-1), { type: 'setModelPriority', priority: 'local-first' });
    const manualOverride = elements.get('recommendations').children[0].children[3];
    manualOverride.children[0].listeners.click();
    assert.deepEqual(messages.at(-1), {
        type: 'chooseManualModel', activity: 'implement', domain: 'coding', difficulty: 'simple'
    });
    manualCell.children[1].listeners.click();
    assert.deepEqual(messages.at(-1), {
        type: 'useLearnedModel', activity: 'advise', domain: 'infrastructure', difficulty: 'complex'
    });
    elements.get('model-scope').listeners.change({ target: { name: 'model-scope', value: 'local' } });
    assert.deepEqual(messages.at(-1), { type: 'setModelScope', scope: 'local' });
    advisorDefault.value = '';
    advisorDefault.listeners.change();
    assert.deepEqual(messages.at(-1), { type: 'setAdvisorPinnedModel', model: null });
    advisorDefault.value = advisorDefault.children[1].value;
    advisorDefault.listeners.change();
    assert.deepEqual(messages.at(-1), { type: 'setAdvisorPinnedModel', model: { modelId: 'm', vendor: 'ollama' } });
    assert.equal(messages.some(message => message.type === 'pinAdvisorModel'), false);
    receive({ data: { type: 'learningDashboard', models: [], excludedModels: [], providerPolicyLabel: 'All providers', providerTypes: {}, lockedProviders: [], dashboard: [], recordCount: 0, scope: 'cloud', priority: 'local-first', hasSelectedLocalModel: false, pinnedAdvisorModel: { modelId: 'gone', vendor: 'x' } } });
    assert.deepEqual(advisorDefault.children.map(option => option.textContent), ['Learned recommendations', 'Unavailable: gone (x)']);
    assert.equal(advisorDefault.value, JSON.stringify(['x', 'gone']));
    assert.equal(elements.get('model-priority').disabled, true);
    assert.equal(elements.get('model-priority').value, 'local-first');
    assert.equal(scopeControls[0].disabled, false);
    assert.equal(scopeControls[0].checked, true);
    assert.equal(scopeControls[1].disabled, true);
    assert.equal(scopeControls[2].disabled, true);
});

test('advisor default pin is validated, cleared, and yields to manual overrides', async () => {
    const tools = new Map();
    const commands = new Map();
    const state = new Map();
    const PIN_KEY = 'agentRoster.modelLearning.advisorPinnedModel.v1';
    const MANUAL_KEY = 'agentRoster.modelLearning.manualSelections.v1';
    state.set('agentRoster.modelLearning.inventory.v1', {
        scope: 'both',
        providerTypes: { ollama: 'local', copilotcli: 'cloud' },
        classifications: {},
        selections: {},
        localTiers: { '["ollama","local"]': 'simple' }
    });
    const models = [
        { id: 'cloud', name: 'Cloud', vendor: 'copilot', inputCost: 10, outputCost: 50 },
        { id: 'cli', name: 'CLI', vendor: 'copilotcli', inputCost: 20, outputCost: 100 },
        { id: 'local', name: 'Local', vendor: 'ollama' }
    ];
    let panel;
    const vscode = {
        EventEmitter: class { constructor() { this.event = () => ({ dispose() { } }); } fire() { } dispose() { } },
        TreeItem: class { constructor(label) { this.label = label; } },
        TreeItemCollapsibleState: { None: 0 },
        ThemeIcon: class { constructor(id) { this.id = id; } },
        lm: {
            registerTool: (name, tool) => { tools.set(name, tool); return { dispose() { } }; },
            selectChatModels: async () => models
        },
        workspace: { getConfiguration: () => ({ get: () => [], inspect: () => undefined }), onDidChangeConfiguration: () => ({ dispose() { } }) },
        commands: { registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() { } }; } },
        window: {
            registerTreeDataProvider: () => ({ dispose() { } }),
            showQuickPick: async () => undefined,
            createWebviewPanel: () => {
                panel = {
                    webview: {
                        cspSource: 'test',
                        asWebviewUri: uri => uri,
                        onDidReceiveMessage: handler => { panel.receive = handler; },
                        postMessage: message => { if (['learningDashboard', 'learningDashboardError'].includes(message.type)) panel.resolve(message); }
                    },
                    onDidDispose() { }
                };
                return panel;
            }
        },
        Uri: { joinPath: (...parts) => parts.join('/') },
        ViewColumn: { One: 1 },
        LanguageModelTextPart: class { constructor(value) { this.value = value; } },
        LanguageModelToolResult: class { constructor(content) { this.content = content; } }
    };
    const localRequire = createRequire(path.join(root, 'src/extension.js'));
    const module = { exports: {} };
    const source = await readFile(path.join(root, 'src/extension.js'), 'utf8');
    vm.runInNewContext(source, {
        module, exports: module.exports,
        require: name => name === 'vscode' ? vscode : localRequire(name),
        setTimeout, clearTimeout
    });
    const context = {
        subscriptions: [], extensionUri: 'extension',
        globalState: { get: key => state.get(key), update: async (key, value) => { state.set(key, value); } }
    };
    module.exports.activate(context);
    assert.equal(typeof commands.get('agentRoster.pinAdvisorModel'), 'function');
    commands.get('agentRoster.openModelLearning')();
    const send = async message => {
        const response = new Promise(resolve => { panel.resolve = resolve; });
        panel.receive(message);
        return response;
    };
    await send({ type: 'ready' });

    let result = await send({ type: 'setAdvisorPinnedModel', model: { modelId: 'local', vendor: 'ollama' } });
    assert.equal(result.type, 'learningDashboardError');
    assert.match(result.error, /not eligible/);
    result = await send({ type: 'setAdvisorPinnedModel', model: { modelId: 'gone', vendor: 'copilot' } });
    assert.match(result.error, /not currently available/);
    result = await send({ type: 'setAdvisorPinnedModel', model: { modelId: 'cloud', vendor: 'copilot' }, excludedProviders: ['copilot'] });
    assert.match(result.error, /not eligible/);
    result = await send({ type: 'setAdvisorPinnedModel', model: 'cloud' });
    assert.match(result.error, /Invalid advisor model/);
    assert.equal(state.has(PIN_KEY), false);

    let dashboard = await send({ type: 'setAdvisorPinnedModel', model: { modelId: 'cloud', vendor: 'copilot' } });
    assert.equal(dashboard.type, 'learningDashboard');
    assert.equal(JSON.stringify(dashboard.pinnedAdvisorModel), JSON.stringify({ modelId: 'cloud', vendor: 'copilot' }));
    assert.equal(JSON.stringify(state.get(PIN_KEY)), JSON.stringify({ modelId: 'cloud', vendor: 'copilot' }));

    const pinnedResult = await tools.get('aroGetModelRecommendations').invoke({ input: { activity: 'advise', domain: 'coding', difficulty: 'standard' } });
    assert.equal(JSON.parse(pinnedResult.content[0].value).recommendedModelId, 'cloud');

    state.set(MANUAL_KEY, [{ activity: 'advise', domain: 'coding', difficulty: 'standard', modelId: 'cli', vendor: 'copilotcli' }]);
    const overrideResult = await tools.get('aroGetModelRecommendations').invoke({ input: { activity: 'advise', domain: 'coding', difficulty: 'standard' } });
    assert.equal(JSON.parse(overrideResult.content[0].value).selectionMode, 'manual');
    assert.equal(JSON.parse(overrideResult.content[0].value).recommendedModelId, 'cli');
    state.set(MANUAL_KEY, []);

    dashboard = await send({ type: 'setAdvisorPinnedModel', model: null });
    assert.equal(dashboard.type, 'learningDashboard');
    assert.equal(dashboard.pinnedAdvisorModel, null);
    assert.equal(state.get(PIN_KEY), null);
});