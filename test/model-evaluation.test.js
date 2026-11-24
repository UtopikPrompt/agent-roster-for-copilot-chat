const test = require('node:test');
const assert = require('node:assert/strict');
const {
    acceptBackendRoutingResponse,
    candidateKey,
    classifyBlocked,
    classifyTechnicalConfiguration,
    classifyProviderBoundary,
    classifyTrial,
    classifyEvaluationError,
    plainTextControlPrompt,
    summarizeEvaluationTrials,
    summarizeModelCoverage,
    buildEvaluationChatMessages,
    evaluationCandidates,
    normalizeSendRequestResponse,
    fixedPilotTasks,
    pairTwoTrials,
    resolvedIdentity,
    CANDIDATE_REJECTIONS_KEY,
    normalizeCandidateRejections,
    listCandidateRejections,
    rejectCandidateRejection,
    clearCandidateRejection
} = require('../src/model-evaluation');
const { emptyScorecard, recordOutcome } = require('../src/model-learning');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('candidate rejections persist normalized provider-qualified records without trial mutation', () => {
    assert.equal(CANDIDATE_REJECTIONS_KEY, 'agentRoster.modelEvaluation.rejections.v1');
    const trials = [{ status: 'blocked', requested: { vendor: 'alpha', id: 'shared' } }];
    const trialsBefore = JSON.parse(JSON.stringify(trials));
    const rejected = rejectCandidateRejection({ schemaVersion: 1, rejections: [] },
        { vendor: ' alpha ', id: ' shared ' },
        { reasonCode: ' human_review ', reasonText: ' Keep evidence ', sourceTrialIds: ['p1'], sourceCallIds: ['c1'] });
    assert.equal(rejected.rejections.length, 1);
    assert.deepEqual(rejected.rejections[0].sourceTrialIds, ['p1']);
    assert.deepEqual(rejected.rejections[0].sourceCallIds, ['c1']);
    assert.equal(rejected.rejections[0].vendor, 'alpha');
    assert.equal(rejected.rejections[0].modelId, 'shared');
    assert.deepEqual(trials, trialsBefore);
});

test('candidate rejection normalization keeps duplicate model IDs separate and clearing is provider-qualified', () => {
    const state = normalizeCandidateRejections([
        { vendor: 'alpha', modelId: 'shared', reasonCode: 'human_review', rejectedAt: '2026-01-01T00:00:00Z' },
        { vendor: 'beta', modelId: 'shared', reasonCode: 'human_review', rejectedAt: '2026-01-02T00:00:00Z' }
    ]);
    assert.equal(listCandidateRejections(state).length, 2);
    const cleared = clearCandidateRejection(state, { vendor: 'alpha', id: 'shared' });
    assert.deepEqual(cleared.rejections.map(item => item.vendor), ['beta']);
    assert.equal(clearCandidateRejection(state, { vendor: 'gamma', id: 'shared' }).rejections.length, 2);
});

test('rejections are human-only and never inferred from blocked or rubric trial status', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8')
        + fs.readFileSync(path.join(__dirname, '../src/model-evaluation.js'), 'utf8');
    assert.doesNotMatch(source, /rejectCandidateRejection\([^;]*(?:blocked|failureClass|strict_completed)/);
    const state = normalizeCandidateRejections({ rejections: [] });
    assert.deepEqual(state.rejections, []);
});

test('dedicated rejected filters and rerun selection exclude rejections from incomplete and all', () => {
    const source = fs.readFileSync(path.join(__dirname, '../media/model-evaluation.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
    assert.match(source, /coverageFilter === 'rejected'/);
    assert.match(source, /coverageFilter === 'rejected'\) return isRejected\(model\)/);
    assert.match(source, /coverageFilter === 'all'.*return true/s);
    assert.match(source, /coverageFilter === 'incomplete'.*strict_completed/s);
    assert.match(source, /'clearCandidateRejection'/);
    assert.match(source, /checkbox\.disabled = isRejected\(model\)/);
    assert.match(html, /<option value="rejected">Rejected<\/option>/);
    assert.match(html, /Excluded \$\{excludedCount\}/);
});

test('fixed pilot prompt and rubric accept only the three routing answers', () => {
    const tasks = fixedPilotTasks();
    assert.equal(tasks.length, 1);
    assert.match(tasks[0].prompt, /CodeFastApiSpecialist/);
    assert.match(tasks[0].prompt, /CodeDatabaseORMGenerator/);
    const accepted = acceptBackendRoutingResponse(JSON.stringify([
        { id: 'A', status: 'success', agent: 'CodeFastApiSpecialist', reason: 'FastAPI stack', missing_context: null },
        { id: 'B', status: 'success', agent: 'CodeDatabaseORMGenerator', reason: 'ORM migration', missing_context: null },
        { id: 'C', status: 'needs_input', agent: null, reason: 'Stack unspecified', missing_context: 'language and framework' }
    ]));
    assert.equal(accepted.accepted, true);
});

test('two trials pair each candidate and task independently', () => {
    const candidates = [{ id: 'same', vendor: 'alpha' }, { id: 'same', vendor: 'beta' }];
    const pairs = pairTwoTrials(candidates, fixedPilotTasks());
    assert.equal(pairs.length, 4);
    assert.equal(pairs.filter(pair => pair.candidate.vendor === 'alpha').length, 2);
    assert.equal(pairs.filter(pair => pair.trial === 1).length, 2);
    assert.equal(pairs.filter(pair => pair.trial === 2).length, 2);
    assert.notEqual(candidateKey(candidates[0]), candidateKey(candidates[1]));
});

test('evaluation candidates are provider-qualified, deduplicated, and preserve inventory order', () => {
    const models = [
        { id: 'shared', vendor: 'alpha', name: 'Alpha', capabilities: { chat: true } },
        { id: 'shared', vendor: 'beta', name: 'Beta', capabilities: { instruction: true } },
        { id: 'shared', vendor: 'alpha', name: 'Alpha duplicate', capabilities: { chat: true } },
        { id: 'chat-disabled', vendor: 'gamma', capabilities: { chat: false } },
        { id: 'instruction-disabled', vendor: 'delta', supportsInstruction: false },
        { id: 'unknown', vendor: 'epsilon', capabilities: { chat: undefined, instruction: null, toolCalling: false } },
        { id: 'family-only', vendor: 'copilot', family: 'Contoso', name: 'Contoso Model' }
    ];
    const candidates = evaluationCandidates(models);
    assert.deepEqual(candidates.map(candidateKey), [
        candidateKey(models[0]),
        candidateKey(models[1]),
        candidateKey(models[5]),
        candidateKey(models[6])
    ]);
});

test('evaluation candidates reject explicit chat/instruction false but allow unknown capability', () => {
    assert.equal(evaluationCandidates([{ id: 'chat', vendor: 'a', capabilities: { chat: false } }]).length, 0);
    assert.equal(evaluationCandidates([{ id: 'instruction', vendor: 'a', capabilities: { instruction: false } }]).length, 0);
    assert.equal(evaluationCandidates([{ id: 'legacy-chat', vendor: 'a', supportsChat: false }]).length, 0);
    assert.equal(evaluationCandidates([{ id: 'unknown', vendor: 'a', capabilities: {} }]).length, 1);
    assert.equal(evaluationCandidates([{ id: 'unknown', vendor: 'a', capabilities: { chat: 'unknown', instruction: null } }]).length, 1);
});

test('evaluation candidates do not infer provider or capability from name or family', () => {
    const models = [
        { id: 'one', vendor: 'unrelated-provider', name: 'Mistral Fast', family: 'Mistral', capabilities: { chat: true } },
        { id: 'two', vendor: 'another-provider', name: 'Totally Different', family: 'Other', capabilities: {} },
        { id: 'three', vendor: ' ', name: 'Mistral' },
        { id: '', vendor: 'valid-provider', name: 'Mistral' }
    ];
    assert.deepEqual(evaluationCandidates(models).map(model => model.id), ['one', 'two']);
});

test('model evaluation source contains no provider-specific shortlist or UI copy', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/model-evaluation.js'), 'utf8')
        + fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
    const dashboard = fs.readFileSync(path.join(__dirname, '../media/model-learning-dashboard.js'), 'utf8');
    assert.doesNotMatch(source, /mistralShortlist|No Mistral-provider|Select Mistral-provider|customendpoint/i);
    assert.doesNotMatch(dashboard, /mistral|customendpoint/i);
    assert.doesNotMatch(dashboard, /selected\s+(?:Mistral-provider|[\w-]*provider)[ -]+(?:model|candidate)/i);
});

test('runModelEvaluation filters inventory with effective provider availability', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
    assert.match(source, /getProviderAvailabilityState\(context\)\.effective/);
    assert.match(source, /inventory\.filter\(model\s*=>\s*isProviderEnabled\(model\.vendor,\s*providerAvailability\)\)/);
    assert.doesNotMatch(source, /providerScore|rankModels|availableInventory\.sort/);
});

test('runModelEvaluation has provider-qualified inventory candidates and no picker in inventory mode', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
    assert.match(source, /async function runModelEvaluation\(context, inventoryCandidates, options = \{\}\)/);
    assert.match(source, /typeof candidate\.id !== 'string'.*typeof candidate\.vendor !== 'string'/);
    assert.match(source, /if \(inventoryCandidates !== undefined\)[\s\S]*const eligible = evaluationCandidates\(availableInventory\)/);
    const inventoryBranch = source.slice(
        source.indexOf('if (inventoryCandidates !== undefined)'),
        source.indexOf('} else {', source.indexOf('if (inventoryCandidates !== undefined)'))
    );
    assert.doesNotMatch(inventoryBranch, /showQuickPick/);
    assert.match(source.slice(source.indexOf('} else {', source.indexOf('if (inventoryCandidates !== undefined)'))), /showQuickPick/);
});

test('invocation, provider, quota, network, routing, model and timeout failures stay blocked', () => {
    assert.equal(classifyBlocked(new Error('network fetch failed')), 'network');
    assert.equal(classifyBlocked(new Error('quota exceeded 429')), 'quota');
    assert.equal(classifyBlocked(new Error('provider authentication failed')), 'provider');
    assert.equal(classifyBlocked(new Error('unknown model not found')), 'model_not_found');
    assert.equal(classifyBlocked(new Error('routing unavailable')), 'routing');
    assert.equal(classifyBlocked(new Error('request timed out')), 'timeout');
    assert.equal(classifyBlocked(new Error('sendRequest rejected')), 'invocation');
});

test('three-class failure taxonomy covers configuration, provider boundary, rubric, and skip', () => {
    assert.equal(classifyTechnicalConfiguration(new Error('Exact model mismatch'), 'model_selection', { id: 'candidate' }), 'rejected_technical_configuration');
    assert.equal(classifyTechnicalConfiguration(new Error('Missing chat capability'), 'pre_invocation'), 'rejected_technical_configuration');
    assert.equal(classifyTechnicalConfiguration(new Error('Invalid inventory contract'), 'pre_invocation'), 'rejected_technical_configuration');
    assert.equal(classifyProviderBoundary(new Error('Authentication failed'), 'provider', 'send_request'), 'incompatible_provider_boundary');
    assert.equal(classifyProviderBoundary(new Error('Invalid response text stream'), 'invocation', 'response_stream'), 'incompatible_provider_boundary');

    assert.equal(classifyTrial({ status: 'completed_failure', trialKind: 'strict_routing' }), 'incorrect_answer_rubric');
    assert.equal(classifyTrial({ status: 'control_fail', trialKind: 'plain_control' }), 'incorrect_answer_rubric');
    assert.equal(classifyTrial({ status: 'control_mismatch', trialKind: 'plain_control' }), 'incorrect_answer_rubric');
    assert.equal(classifyTrial({ status: 'strict_skipped', strictSkipped: true }), 'not_applicable');
    assert.equal(classifyTrial({ status: 'completed_success', trialKind: 'strict_routing' }), 'correct_answer');
});

test('completed trial records omit failure class on success and synthetic skips remain unclassified', () => {
    const strictSource = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
    assert.match(strictSource, /acceptance\.accepted \? \{\} : \{ failureClass: classifyTrial/);
    assert.doesNotMatch(strictSource, /status: 'completed_success',[\s\S]*failureClass/);
    assert.match(strictSource, /failureClass: 'not_applicable'/);

    const mediaSource = fs.readFileSync(path.join(__dirname, '../media/model-evaluation.js'), 'utf8');
    assert.match(mediaSource, /<th>Failure class<\/th>/);
    assert.match(mediaSource, /Rejected technical configuration/);
    assert.match(mediaSource, /Incompatible provider boundary/);
    assert.match(mediaSource, /Incorrect answer rubric/);
});

test('timeout state is declared outside the sendRequest try block', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
    assert.match(source, /const started = Date\.now\(\);\s*let timedOut = false;/);
    assert.doesNotMatch(source, /let timedOut = false;\s*const timeout/);
});

test('evaluation chat messages use one LanguageModelChatMessage.User message', () => {
    const textPartInstances = [];
    const vscodeApi = {
        LanguageModelChatMessage: {
            User(prompt) {
                return { role: 'user', content: [{ type: 'text', text: prompt }] };
            }
        },
        LanguageModelTextPart: class {
            constructor(value) {
                textPartInstances.push(value);
                this.value = value;
            }
        }
    };

    const messages = buildEvaluationChatMessages('Route this task', vscodeApi);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'user');
    assert.deepEqual(messages[0].content, [{ type: 'text', text: 'Route this task' }]);
    assert.equal(textPartInstances.length, 0);
});

test('real evaluation sendRequest keeps chat messages, empty options, and cancellation token', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
    const sendRequestBlock = source.slice(source.indexOf('runtimeResponse = await model.sendRequest('));

    assert.match(sendRequestBlock, /runtimeResponse = await model\.sendRequest\(\s*buildEvaluationChatMessages\(pair\.task\.prompt, vscode\),\s*\{\},\s*requestToken\.token\s*\)/);
    assert.doesNotMatch(sendRequestBlock, /new vscode\.LanguageModelTextPart\(pair\.task\.prompt\)/);
});

test('sendRequest mock response matrix normalizes exact text shapes and blocks malformed results', async () => {
    async function* strings(...chunks) {
        for (const chunk of chunks) yield chunk;
    }
    async function* objects(...chunks) {
        for (const chunk of chunks) yield chunk;
    }

    assert.deepEqual(await normalizeSendRequestResponse(undefined), { blocked: 'invalid_response' });
    assert.deepEqual(await normalizeSendRequestResponse(null), { blocked: 'invalid_response' });
    assert.deepEqual(await normalizeSendRequestResponse({}), { blocked: 'invalid_response' });
    assert.deepEqual(await normalizeSendRequestResponse({ text: null }), { blocked: 'invalid_response' });
    assert.deepEqual(await normalizeSendRequestResponse({ text: {} }), { blocked: 'invalid_response' });
    assert.deepEqual(await normalizeSendRequestResponse({ text: 'plain text' }), { blocked: 'invalid_response' });
    assert.deepEqual(await normalizeSendRequestResponse({ text: strings('hello', ' world') }), { text: 'hello world' });
    assert.deepEqual(await normalizeSendRequestResponse({ text: objects({ value: 'hello' }, { value: ' world' }) }), { blocked: 'invalid_response' });
    assert.deepEqual(await normalizeSendRequestResponse({ text: strings('exact'), metadata: null }), { text: 'exact' });
});

test('sendRequest normalization blocks throwing text getters', async () => {
    const runtimeResponse = {};
    Object.defineProperty(runtimeResponse, 'text', {
        get() {
            throw new Error('text getter failed');
        }
    });

    assert.deepEqual(await normalizeSendRequestResponse(runtimeResponse), { blocked: 'invalid_response' });
});

test('sendRequest normalization blocks throwing async iterator getters', async () => {
    const text = {};
    Object.defineProperty(text, Symbol.asyncIterator, {
        get() {
            throw new Error('async iterator getter failed');
        }
    });

    assert.deepEqual(await normalizeSendRequestResponse({ text }), { blocked: 'invalid_response' });
});

test('sendRequest normalization blocks sync iterable text and throwing iterators', async () => {
    const syncIterable = {
        *[Symbol.iterator]() {
            yield 'hello';
        }
    };
    const throwingIterator = {
        [Symbol.asyncIterator]() {
            throw new Error('iterator failed');
        }
    };

    assert.deepEqual(await normalizeSendRequestResponse({ text: syncIterable }), { blocked: 'invalid_response' });
    assert.deepEqual(await normalizeSendRequestResponse({ text: throwingIterator }), { blocked: 'invalid_response' });
});

test('sendRequest normalization blocks primitive and object chunks', async () => {
    async function* primitiveChunks() {
        yield 42;
    }
    async function* objectChunks() {
        yield { value: 'hello' };
    }

    assert.deepEqual(await normalizeSendRequestResponse({ text: primitiveChunks() }), { blocked: 'invalid_response' });
    assert.deepEqual(await normalizeSendRequestResponse({ text: objectChunks() }), { blocked: 'invalid_response' });
});

test('sendRequest normalization preserves valid async string chunks', async () => {
    async function* strings(...chunks) {
        for (const chunk of chunks) yield chunk;
    }

    assert.deepEqual(await normalizeSendRequestResponse({ text: strings('valid', ' ', 'text') }), { text: 'valid text' });
});

test('completed responses use an outer runtimeResponse variable', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
    assert.match(source, /let responseText = '';\s*let runtimeResponse;/);
    assert.match(source, /runtimeResponse = await model\.sendRequest\(/);
    assert.match(source, /const normalizedResponse = await normalizeSendRequestResponse\(runtimeResponse\)/);
    assert.match(source, /if \(normalizedResponse\.blocked\)/);
    assert.doesNotMatch(source, /String\(chunk \|\| ''\)/);
    assert.match(source, /const resolvedModel = resolvedIdentity\(model, runtimeResponse\);/);
    assert.doesNotMatch(source, /const resolvedModel = resolvedIdentity\(model, response\);/);
});

test('resolved identity is captured only from explicit runtime metadata', () => {
    assert.equal(resolvedIdentity({ vendor: 'mistral-a', id: 'requested' }), undefined);
    assert.equal(resolvedIdentity({ vendor: 'mistral-a', id: 'requested' }, { metadata: {} }), undefined);
    assert.deepEqual(resolvedIdentity({ vendor: 'mistral-a', metadata: { resolvedModelId: 'fallback', resolvedVendor: 'wrong-vendor' } }, {
        metadata: { resolvedModelId: 'resolved-1', resolvedVendor: 'runtime-vendor' }
    }), {
        id: 'resolved-1', vendor: 'runtime-vendor'
    });
});

test('only accepted completed responses enter success scorecards', () => {
    const scorecard = recordOutcome(emptyScorecard(), {
        activity: 'advise', domain: 'coding', difficulty: 'standard',
        modelId: 'mistral-1', vendor: 'mistral-a', callId: 'call-1',
        outcome: 'success', evidenceCode: 'acceptance_passed',
        metrics: { durationMs: 42 }
    });
    assert.equal(scorecard.records.length, 1);
    assert.equal(scorecard.records[0].vendor, 'mistral-a');
    assert.equal(scorecard.records[0].callId, 'call-1');
    assert.equal(scorecard.records[0].metrics.durationMs, 42);
});

test('dedicated evaluation command and panel assets are registered', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    const source = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
    assert.ok(manifest.activationEvents.includes('onCommand:agentRoster.openModelEvaluation'));
    assert.ok(manifest.contributes.commands.some(command => command.command === 'agentRoster.openModelEvaluation'));
    assert.match(source, /const modelEvaluationPanels = new WeakMap\(\)/);
    assert.match(source, /function openModelEvaluation\(context, candidates\)/);
    assert.match(source, /getModelEvaluationHtml\(panel\.webview, context\.extensionUri\)/);
    assert.ok(fs.existsSync(path.join(__dirname, '../media/model-evaluation.js')));
    assert.ok(fs.existsSync(path.join(__dirname, '../media/model-evaluation.css')));
});

test('plain-text control is exact and phase classification preserves blocked reason', () => {
    assert.equal(plainTextControlPrompt, 'Reply with exactly: EVALUATION_OK');
    assert.equal(classifyEvaluationError(new Error('quota exceeded 429'), 'send_request').phase, 'quota');
    assert.equal(classifyEvaluationError(new Error('request timed out'), 'send_request').phase, 'timeout');
    assert.equal(classifyEvaluationError(new Error('provider authentication failed'), 'send_request').blockedType, 'provider');
    assert.equal(classifyEvaluationError(new Error('network fetch failed'), 'send_request').reason, 'network fetch failed');
    assert.equal(classifyEvaluationError(new Error('Unknown model'), 'model_selection').phase, 'model_selection');
});

test('model coverage dedupes rerun slots and appends rerun attempts', () => {
    const candidates = [{ vendor: 'alpha', id: 'a' }];
    const trials = [
        { requested: { vendor: 'alpha', id: 'a' }, trialKind: 'plain_control', pairId: 'control', status: 'control_pass', trial: 1, recordedAt: '2026-01-01T00:00:00Z' },
        { requested: { vendor: 'alpha', id: 'a' }, trialKind: 'strict_routing', pairId: 'p', taskId: 'task', trial: 1, status: 'completed_success', recordedAt: '2026-01-02T00:00:00Z' },
        { requested: { vendor: 'alpha', id: 'a' }, trialKind: 'strict_routing', pairId: 'p', taskId: 'task', trial: 1, status: 'completed_success', recordedAt: '2026-01-03T00:00:00Z' },
        { requested: { vendor: 'alpha', id: 'a' }, trialKind: 'strict_routing', pairId: 'rerun-skip', taskId: 'task', trial: 2, status: 'strict_skipped' }
    ];
    const coverage = summarizeModelCoverage(candidates, trials);
    assert.equal(coverage.length, 1);
    assert.equal(coverage[0].attemptCount, 2);
    assert.equal(coverage[0].coverageStatus, 'strict_completed');
    assert.equal(coverage[0].lastEvaluatedAt, '2026-01-03T00:00:00Z');
});

test('model coverage excludes synthetic strict rows and provider-qualified duplicate IDs stay separate', () => {
    const candidates = [{ vendor: 'alpha', id: 'shared' }, { vendor: 'beta', id: 'shared' }, { vendor: 'gamma', id: 'never' }];
    const trials = [
        { requested: { vendor: 'alpha', id: 'shared' }, trialKind: 'plain_control', status: 'control_block', pairId: 'control' },
        { requested: { vendor: 'alpha', id: 'shared' }, trialKind: 'strict_routing', pairId: 'p', taskId: 'task', trial: 1, status: 'blocked', strictSkipped: true },
        { requested: { vendor: 'alpha', id: 'shared' }, trialKind: 'strict_routing', pairId: 'q', taskId: 'task', trial: 2, status: 'strict_skipped' },
        { requested: { vendor: 'beta', id: 'shared' }, trialKind: 'strict_routing', status: 'blocked', pairId: 'missing-task', trial: 1 }
    ];
    const coverage = summarizeModelCoverage(candidates, trials);
    assert.deepEqual(coverage.map(item => item.coverageStatus), ['control_blocked', 'never_evaluated', 'never_evaluated']);
    assert.equal(coverage[0].attemptCount, 1);
});

test('model coverage lists never evaluated and strict completed/blocked statuses', () => {
    const candidates = [{ vendor: 'a', id: 'none' }, { vendor: 'a', id: 'complete' }, { vendor: 'a', id: 'blocked' }];
    const trials = [
        { requested: { vendor: 'a', id: 'complete' }, trialKind: 'plain_control', status: 'control_pass', pairId: 'c1' },
        { requested: { vendor: 'a', id: 'complete' }, trialKind: 'strict_routing', status: 'completed_failure', pairId: 'p1', taskId: 'task', trial: 1 },
        { requested: { vendor: 'a', id: 'blocked' }, trialKind: 'strict_routing', status: 'blocked', pairId: 'p2', taskId: 'task', trial: 1 }
    ];
    const coverage = summarizeModelCoverage(candidates, trials);
    assert.deepEqual(coverage.map(item => item.coverageStatus), ['never_evaluated', 'strict_completed', 'strict_blocked']);
    assert.equal(coverage[0].lastEvaluatedAt, undefined);
});

test('dedicated page renders coverage filter, badges, summary, and no automatic run', () => {
    const source = fs.readFileSync(path.join(__dirname, '../media/model-evaluation.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
    assert.match(source, /Never evaluated/);
    assert.match(source, /Control only/);
    assert.match(source, /Strict evaluated/);
    assert.match(source, /coverageFilter = 'incomplete'/);
    assert.match(source, /coverageStatus === 'strict_blocked'/);
    assert.match(source, /coverage-badge/);
    assert.match(html, /<option value="incomplete">Incomplete<\/option>/);
    assert.match(html, /summarizeModelCoverage/);
    assert.match(html, /enrichedCandidates/);
    assert.match(source, /vscode\.postMessage\(\{ type: 'ready' \}\)/);
});

test('coverage filter source replaces selections and does not post evaluation or reload payload', () => {
    const source = fs.readFileSync(path.join(__dirname, '../media/model-evaluation.js'), 'utf8');
    const changeBlock = source.slice(source.indexOf("byId('coverage-filter').addEventListener('change'"), source.indexOf("byId('run-evaluation').addEventListener('click'"));
    assert.match(changeBlock, /selected = new Set\(candidates\.filter\(matchesCoverageSelection\)\.map\(candidateKey\)\)/);
    assert.match(source, /return model\.coverageStatus !== 'strict_completed';/);
    assert.match(source, /coverageFilter = 'incomplete';[\s\S]*candidates\.filter\(matchesCoverageSelection\)/);
    assert.match(source, /coverageFilter === 'incomplete'/);
    assert.match(source, /model\.coverageStatus === 'strict_blocked'/);
    assert.doesNotMatch(changeBlock, /postMessage|trials\s*=|candidates\s*=|evaluationSummary\s*=/);
});

test('coverage filter browser harness applies all values and replace-selection behavior', () => {
    class FakeElement {
        constructor(id = '') {
            this.id = id;
            this.value = '';
            this.checked = false;
            this.disabled = false;
            this.textContent = '';
            this.children = [];
            this.attributes = {};
            this.listeners = {};
        }
        addEventListener(type, listener) {
            this.listeners[type] = listener;
        }
        dispatch(type, event = {}) {
            if (this.listeners[type]) this.listeners[type](event);
        }
        replaceChildren(...children) {
            this.children = children;
        }
        append(...children) {
            this.children.push(...children);
        }
        setAttribute(name, value) {
            this.attributes[name] = value;
        }
        querySelector() {
            return new FakeElement();
        }
    }

    const ids = ['evaluation-status-line', 'candidate-list', 'result-count', 'coverage-summary', 'evaluation-summary', 'evaluation-verdict', 'evaluation-results', 'run-evaluation', 'cancel-evaluation', 'progress-status', 'evaluation-progress', 'coverage-filter', 'refresh-evaluation', 'select-all-candidates', 'clear-candidates'];
    const elements = new Map(ids.map(id => [id, new FakeElement(id)]));
    const createdCheckboxes = [];
    const document = {
        getElementById: id => elements.get(id),
        createElement(tag) {
            const element = new FakeElement();
            element.tagName = tag;
            if (tag === 'input') createdCheckboxes.push(element);
            return element;
        }
    };
    let messageListener;
    const window = { addEventListener(type, listener) { if (type === 'message') messageListener = listener; } };
    const posted = [];
    const candidates = [
        { vendor: 'a', id: 'never', name: 'Never', coverageStatus: 'never_evaluated' },
        { vendor: 'a', id: 'control-pass', name: 'Control Pass', coverageStatus: 'control_passed' },
        { vendor: 'a', id: 'control-block', name: 'Control Block', coverageStatus: 'control_blocked' },
        { vendor: 'a', id: 'strict-pass', name: 'Strict Pass', coverageStatus: 'strict_completed' },
        { vendor: 'a', id: 'strict-block', name: 'Strict Block', coverageStatus: 'strict_blocked' }
    ];

    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../media/model-evaluation.js'), 'utf8'), {
        document,
        window,
        acquireVsCodeApi: () => ({ postMessage: message => posted.push(message) }),
        Set
    });

    messageListener({ data: { type: 'modelEvaluation', candidates, evaluation: { trials: [] }, evaluationSummary: null } });

    assert.equal(elements.get('coverage-filter').value, 'incomplete');
    assert.equal(elements.get('result-count').textContent, '4 selected / 12 operations');

    const expected = { all: 5, incomplete: 4, never: 1, evaluated: 4, control: 2, strict: 2 };
    for (const [filter, count] of Object.entries(expected)) {
        elements.get('coverage-filter').value = filter;
        elements.get('coverage-filter').dispatch('change', { target: elements.get('coverage-filter') });
        assert.equal(elements.get('result-count').textContent, `${count} selected / ${count * 3} operations`, filter);
    }

    elements.get('coverage-filter').value = 'never';
    elements.get('coverage-filter').dispatch('change', { target: elements.get('coverage-filter') });
    const neverCheckbox = createdCheckboxes.find(element => element.attributes['aria-label'] === 'Evaluate Never');
    assert.ok(neverCheckbox);
    neverCheckbox.checked = false;
    neverCheckbox.dispatch('change');
    assert.equal(elements.get('result-count').textContent, '0 selected / 0 operations');

    elements.get('select-all-candidates').dispatch('click');
    assert.equal(elements.get('result-count').textContent, '1 selected / 3 operations');
    elements.get('clear-candidates').dispatch('click');
    assert.equal(elements.get('result-count').textContent, '0 selected / 0 operations');

    elements.get('coverage-filter').value = 'all';
    elements.get('coverage-filter').dispatch('change', { target: elements.get('coverage-filter') });
    const strictCompletedCheckbox = createdCheckboxes.find(element => element.attributes['aria-label'] === 'Evaluate Strict Pass');
    assert.ok(strictCompletedCheckbox, 'strict_completed remains visible under All');
    assert.equal(strictCompletedCheckbox.checked, true, 'strict_completed is selected under All as a full rerun');
    elements.get('run-evaluation').dispatch('click');
    const rerunMessages = posted.filter(message => message.type === 'runModelEvaluation');
    assert.equal(rerunMessages.length, 1);
    assert.deepEqual(rerunMessages[0].candidates.map(candidate => candidate.id), ['never', 'control-pass', 'control-block', 'strict-pass', 'strict-block']);

    assert.equal(posted.filter(message => message.type === 'runModelEvaluation').length, 1);
    const readyMessages = posted.filter(message => message.type === 'ready');
    assert.equal(readyMessages.length, 1);
    assert.equal(String(readyMessages[0].type), 'ready');
});

test('provider and model summaries classify controls and strict trial completion', () => {
    const trials = [
        { requested: { vendor: 'alpha', id: 'a' }, trialKind: 'plain_control', status: 'control_pass' },
        { requested: { vendor: 'alpha', id: 'a' }, trialKind: 'strict_routing', status: 'completed_success' },
        { requested: { vendor: 'alpha', id: 'a' }, trialKind: 'strict_routing', status: 'completed_success' },
        { requested: { vendor: 'beta', id: 'b' }, trialKind: 'plain_control', status: 'control_block' },
        { requested: { vendor: 'beta', id: 'b' }, trialKind: 'strict_routing', status: 'blocked', strictSkipped: true }
    ];
    const summary = summarizeEvaluationTrials(trials);
    assert.equal(summary.providerCount, 2);
    assert.equal(summary.controlPass, 1);
    assert.equal(summary.controlBlock, 1);
    assert.equal(summary.strictCompleted, 2);
    assert.equal(summary.strictBlocked, 0);
    assert.equal(summary.verdict, 'Mixed');
});

test('provider summary counts a real strict blocked row but excludes a synthetic strict skip', () => {
    const summary = summarizeEvaluationTrials([
        { requested: { vendor: 'alpha', id: 'synthetic' }, trialKind: 'strict_routing', status: 'strict_skipped', strictSkipped: true },
        { requested: { vendor: 'beta', id: 'real' }, trialKind: 'strict_routing', status: 'blocked' }
    ]);
    assert.equal(summary.strictBlocked, 1);
    assert.equal(summary.candidateCount, 1);
});

test('blocked plain controls and skipped strict trials add no quality outcome', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
    assert.match(source, /plainTextControlPrompt/);
    assert.match(source, /if \(!controlPassed\)/);
    assert.match(source, /strictSkipped: true/);
    assert.doesNotMatch(source.slice(source.indexOf('if (!controlPassed)'), source.indexOf('for (const pair of pairTwoTrials([candidate]', source.indexOf('if (!controlPassed)'))), /recordOutcome/);
    assert.deepEqual(summarizeEvaluationTrials([
        { requested: { vendor: 'alpha', id: 'a' }, trialKind: 'plain_control', status: 'control_block' },
        { requested: { vendor: 'alpha', id: 'a' }, trialKind: 'strict_routing', status: 'blocked', strictSkipped: true }
    ]).verdict, 'Blocked at provider boundary');
});

test('dedicated evaluation accepts exact preselection and renders persisted trials', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
    const script = fs.readFileSync(path.join(__dirname, '../media/model-evaluation.js'), 'utf8');
    assert.match(source, /preselected: state\.preselected/);
    assert.match(source, /candidateKey\(pair\)/);
    assert.match(source, /options\.cancellation/);
    assert.doesNotMatch(source.slice(source.indexOf('function openModelEvaluation'), source.indexOf('async function selectChatModelsWithTimeout')), /showQuickPick/);
    assert.match(script, /trial\.status === 'blocked' \? 'trial-blocked' : 'trial-completed'/);
    assert.match(script, /Resolved identity/);
    assert.match(script, /Reason\/error/);
});

test('three-operation count is consistent and no undefined pairs references remain', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
    const script = fs.readFileSync(path.join(__dirname, '../media/model-evaluation.js'), 'utf8');
    assert.match(source, /const operationTotal = candidates\.length \* 3/);
    assert.match(source, /total: operationTotal/);
    assert.match(source, /completed} of \$\{operationTotal\} operations completed or blocked/);
    assert.doesNotMatch(source, /pairs\.length/);
    assert.match(script, /count \* 3\} operations/);
    assert.doesNotMatch(script, /count \* 2\} trials/);
});

test('Inventory and Learning expose the dedicated evaluation page instead of direct run controls', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8');
    const inventoryScript = fs.readFileSync(path.join(__dirname, '../media/provider-availability.js'), 'utf8');
    const learningScript = fs.readFileSync(path.join(__dirname, '../media/model-learning-dashboard.js'), 'utf8');
    assert.match(source, /Open Model Evaluation/, 'sidebar or page copy');
    assert.match(inventoryScript, /type: 'openModelEvaluation'/);
    assert.doesNotMatch(inventoryScript, /type: 'runModelEvaluation'/);
    assert.match(learningScript, /type: 'openModelEvaluation'/);
    assert.doesNotMatch(source.slice(source.indexOf('function getLearningHtml'), source.indexOf('function deactivate')), /id="evaluation-view"|id="evaluation-panel"|id="evaluation-tabs"/);
});

test('dedicated result table uses native provider-qualified candidate foldables without model ranking', () => {
    const script = fs.readFileSync(path.join(__dirname, '../media/model-evaluation.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../media/model-evaluation.css'), 'utf8');
    assert.match(script, /document\.createElement\('details'\)/);
    assert.match(script, /document\.createElement\('summary'\)/);
    assert.match(script, /section\.open = rows\.length > 0/);
    assert.match(script, /candidateGroups = new Map/);
    assert.match(script, /candidateKey\(\{ vendor: requested\.vendor \|\| 'unknown', id: requested\.id \|\| 'unknown' \}\)/);
    assert.match(script, /\$\{candidate\.vendor \|\| 'unknown'\} \/ \$\{candidate\.id\} \| \$\{disposition\} \| \$\{rows\.length\} row/);
    assert.match(script, /syntheticSkip = trial\.strictSkipped === true \|\| trial\.status === 'strict_skipped'/);
    assert.match(script, /\? 'Skipped'/);
    assert.match(script, /\? 'Not applicable'/);
    assert.match(script, /trials\.slice\(\)\.reverse\(\)/);
    assert.doesNotMatch(script, /trialGroupKey|incompatible_provider_boundary.*label|rejected_technical_configuration.*label/);
    assert.doesNotMatch(script, /rank|sortByQuality|modelQuality|providerScore/i);
    assert.match(css, /\.evaluation-result-group summary/);
    assert.match(css, /\.evaluation-result-group \.table-wrap/);
});

test('Rejected and synthetic skips remain candidate-disposition or nested trial evidence', () => {
    const script = fs.readFileSync(path.join(__dirname, '../media/model-evaluation.js'), 'utf8');
    assert.match(script, /const disposition = isRejected\(candidate\)[\s\S]*\? 'Rejected'/);
    assert.match(script, /if \(!rows\.length && !isRejected\(candidate\)\) continue/);
    assert.match(script, /failureClassText = syntheticSkip[\s\S]*\? 'Not applicable'/);
    assert.match(script, /trial\.failureClass === 'rejected'[\s\S]*\? 'Rejected'/);
    assert.doesNotMatch(script, /const groups = \[|group\.label|trialGroupKey/);
});

test('candidate result browser grouping separates duplicate IDs and nests reruns and skips', () => {
    class FakeElement {
        constructor(tagName = '') {
            this.tagName = tagName;
            this.open = false;
            this.textContent = '';
            this.innerHTML = '';
            this.children = [];
            this.attributes = {};
            this.listeners = {};
        }
        addEventListener(type, listener) { this.listeners[type] = listener; }
        dispatch(type, event = {}) { if (this.listeners[type]) this.listeners[type](event); }
        replaceChildren(...children) { this.children = children; }
        append(...children) { this.children.push(...children); }
        setAttribute(name, value) { this.attributes[name] = value; }
        querySelector(selector) {
            if (!this._tbody) this._tbody = new FakeElement('tbody');
            return this._tbody;
        }
    }

    const ids = ['evaluation-status-line', 'candidate-list', 'result-count', 'coverage-summary', 'evaluation-summary', 'evaluation-verdict', 'evaluation-results', 'run-evaluation', 'cancel-evaluation', 'progress-status', 'evaluation-progress', 'coverage-filter', 'refresh-evaluation', 'select-all-candidates', 'clear-candidates'];
    const elements = new Map(ids.map(id => [id, new FakeElement(id)]));
    const document = {
        getElementById: id => elements.get(id),
        createElement: tag => new FakeElement(tag)
    };
    let messageListener;
    const window = { addEventListener(type, listener) { if (type === 'message') messageListener = listener; } };

    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../media/model-evaluation.js'), 'utf8'), {
        document,
        window,
        acquireVsCodeApi: () => ({ postMessage: () => {} }),
        Set
    });

    messageListener({ data: {
        type: 'modelEvaluation',
        candidates: [
            { vendor: 'alpha', id: 'shared', name: 'Alpha Shared', coverageStatus: 'strict_completed' },
            { vendor: 'beta', id: 'shared', name: 'Beta Shared', coverageStatus: 'strict_completed' },
            { vendor: 'gamma', id: 'rejected', name: 'Gamma Rejected', coverageStatus: 'never_evaluated', rejected: true }
        ],
        evaluation: { trials: [
            { requested: { vendor: 'alpha', id: 'shared' }, pairId: 'p', trial: 1, status: 'completed_success', trialKind: 'strict_routing' },
            { requested: { vendor: 'alpha', id: 'shared' }, pairId: 'rerun-p', trial: 2, status: 'completed_success', trialKind: 'strict_routing' },
            { requested: { vendor: 'alpha', id: 'shared' }, pairId: 'skip-p', trial: 3, status: 'strict_skipped', strictSkipped: true, trialKind: 'strict_routing' },
            { requested: { vendor: 'beta', id: 'shared' }, pairId: 'b', trial: 1, status: 'completed_failure', failureClass: 'incorrect_answer_rubric', trialKind: 'strict_routing' }
        ] }
    } });

    const sections = elements.get('evaluation-results').children;
    assert.equal(sections.length, 3);
    assert.equal(sections.filter(section => section.tagName === 'details').length, 3);
    const summaries = sections.map(section => section.children[0].textContent);
    assert.match(summaries[0], /Alpha Shared \| alpha \/ shared \| Strict completed \| 3 rows/);
    assert.match(summaries[1], /Beta Shared \| beta \/ shared \| Strict completed \| 1 row/);
    assert.match(summaries[2], /Gamma Rejected \| gamma \/ rejected \| Rejected \| 0 rows/);
    assert.equal(sections[0].open, true);
    assert.equal(sections[1].open, true);
    assert.equal(sections[2].open, false);

    const alphaTableBody = sections[0].children[1].children[0].querySelector('tbody');
    assert.equal(alphaTableBody.children.length, 3);
    const alphaSkipRow = alphaTableBody.children.find(row => row.children.length && row.children[2].textContent === 'Skipped');
    assert.ok(alphaSkipRow);
    assert.equal(alphaSkipRow.children[5].textContent, 'Not applicable');
});

test('live status updates merge duplicate model IDs by requested provider and preserve rerun rows', () => {
    class FakeElement {
        constructor(tagName = '') {
            this.tagName = tagName;
            this.open = false;
            this.textContent = '';
            this.innerHTML = '';
            this.children = [];
            this.attributes = {};
            this.listeners = {};
        }
        addEventListener(type, listener) { this.listeners[type] = listener; }
        dispatch(type, event = {}) { if (this.listeners[type]) this.listeners[type](event); }
        replaceChildren(...children) { this.children = children; }
        append(...children) { this.children.push(...children); }
        setAttribute(name, value) { this.attributes[name] = value; }
        querySelector() {
            if (!this._tbody) this._tbody = new FakeElement('tbody');
            return this._tbody;
        }
    }

    const ids = ['evaluation-status-line', 'candidate-list', 'result-count', 'coverage-summary', 'evaluation-summary', 'evaluation-verdict', 'evaluation-results', 'run-evaluation', 'cancel-evaluation', 'progress-status', 'evaluation-progress', 'coverage-filter', 'refresh-evaluation', 'select-all-candidates', 'clear-candidates'];
    const elements = new Map(ids.map(id => [id, new FakeElement(id)]));
    const document = {
        getElementById: id => elements.get(id),
        createElement: tag => new FakeElement(tag)
    };
    let messageListener;
    const window = { addEventListener(type, listener) { if (type === 'message') messageListener = listener; } };

    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../media/model-evaluation.js'), 'utf8'), {
        document,
        window,
        acquireVsCodeApi: () => ({ postMessage: () => {} }),
        Set
    });

    messageListener({ data: {
        type: 'modelEvaluation',
        candidates: [
            { vendor: 'alpha', id: 'shared', name: 'Alpha Shared', coverageStatus: 'strict_completed' },
            { vendor: 'beta', id: 'shared', name: 'Beta Shared', coverageStatus: 'strict_completed' }
        ],
        evaluation: { trials: [
            { requested: { vendor: 'alpha', id: 'shared' }, pairId: 'alpha-p', trial: 1, status: 'completed_success', trialKind: 'strict_routing' },
            { requested: { vendor: 'alpha', id: 'shared' }, pairId: 'alpha-rerun', trial: 2, status: 'completed_success', trialKind: 'strict_routing' },
            { requested: { vendor: 'beta', id: 'shared' }, pairId: 'alpha-p', trial: 1, status: 'completed_failure', trialKind: 'strict_routing' }
        ] }
    } });

    messageListener({ data: { type: 'modelEvaluationStatus', running: true, trial: {
        requested: { vendor: 'alpha', id: 'shared' }, pairId: 'alpha-p', trial: 1, status: 'blocked', blockedType: 'timeout', trialKind: 'strict_routing'
    } } });
    messageListener({ data: { type: 'modelEvaluationStatus', running: true, trial: {
        requested: { vendor: 'beta', id: 'shared' }, pairId: 'alpha-p', trial: 1, status: 'completed_success', trialKind: 'strict_routing'
    } } });

    const sections = elements.get('evaluation-results').children;
    assert.equal(sections.length, 2);
    assert.match(sections[0].children[0].textContent, /Alpha Shared \| alpha \/ shared \| Strict completed \| 2 rows/);
    assert.match(sections[1].children[0].textContent, /Beta Shared \| beta \/ shared \| Strict completed \| 1 row/);

    const alphaRows = sections[0].children[1].children[0].querySelector('tbody').children;
    assert.equal(alphaRows.length, 2);
    assert.equal(alphaRows.find(row => row.children[1]?.textContent === '1').children[2].textContent, 'blocked');
    const betaRows = sections[1].children[1].children[0].querySelector('tbody').children;
    assert.equal(betaRows.length, 1);
    assert.equal(betaRows[0].children[2].textContent, 'completed_success');
});
