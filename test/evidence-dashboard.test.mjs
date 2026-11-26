import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dashboard = require('../src/evidence-dashboard.js');
const store = require('../src/evidence-store.js');
const { buildEvidenceDashboard, escapeHtml, renderEvidenceDashboardHtml } = dashboard;
const { writeEvidenceBatch } = store;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function memoryAdapter() {
    const files = new Map();
    const dirsOf = segs => {
        const prefix = segs.length ? segs.join('/') + '/' : '';
        const names = new Map();
        for (const key of files.keys()) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.slice(prefix.length).split('/');
            names.set(rest[0], rest.length > 1);
        }
        return [...names].map(([name, isDirectory]) => ({ name, isDirectory }));
    };
    return {
        files,
        async readText(segs) { return files.has(segs.join('/')) ? files.get(segs.join('/')) : null; },
        async writeNew(segs, text) {
            const key = segs.join('/');
            if (files.has(key)) { const error = new Error('exists'); error.code = 'EXISTS'; throw error; }
            files.set(key, text);
        },
        async list(segs) { return dirsOf(segs); },
        async modified() { return Date.parse('2026-01-02T03:04:05Z'); }
    };
}

const FOLDERS = ['C:/target-project'];
const batch = (overrides = {}) => {
    const merged = {
        run_id: 'run-2026-001',
        scope_id: 'scope-alpha',
        source_key: 'azure-devops',
        batch_id: 'b001',
        sufficiency: 'COMPLETE',
        ...overrides
    };
    merged.records = [{ evidence_id: 'ev-1', batch_id: merged.batch_id, title: 'SECRET-RECORD-TITLE' }];
    return merged;
};
const authorized = { writeAuthorized: true, folders: FOLDERS };

test('no workspace, ambiguous workspace and no snapshots return explicit states without reading', async () => {
    const adapter = memoryAdapter();
    assert.equal((await buildEvidenceDashboard({ adapter: undefined, folders: [] })).state, 'NO_WORKSPACE');
    assert.equal((await buildEvidenceDashboard({ adapter: undefined, folders: ['C:/a', 'C:/b'] })).state, 'AMBIGUOUS_WORKSPACE');
    assert.equal((await buildEvidenceDashboard({ adapter, folders: FOLDERS })).state, 'NO_EVIDENCE');
});

test('runs show COMPLETE, PARTIAL, BLOCKED and UNKNOWN with worst-status run rollup and no record content', async () => {
    const adapter = memoryAdapter();
    await writeEvidenceBatch({ adapter, ...authorized, batch: batch({ batch_id: 'ok', sufficiency: 'COMPLETE' }) });
    await writeEvidenceBatch({ adapter, ...authorized, batch: batch({ batch_id: 'part', source_key: 'github', sufficiency: 'PARTIAL' }) });
    const view = await buildEvidenceDashboard({ adapter, folders: FOLDERS });
    assert.equal(view.state, 'OK');
    const [run] = view.runs;
    assert.equal(run.run_id, 'run-2026-001');
    assert.equal(run.status, 'PARTIAL');
    assert.equal(run.batch_count, 2);
    assert.equal(run.last_update, '2026-01-02T03:04:05.000Z');
    assert.deepEqual(run.gaps, [{ source_key: 'github', batch: 'part', reason: 'PARTIAL' }]);

    const html = renderEvidenceDashboardHtml(view, { cspSource: 'x', nonce: 'abc123' });
    assert.match(html, />PARTIAL</);
    assert.match(html, />COMPLETE</);
    assert.ok(!html.includes('SECRET-RECORD-TITLE'), 'record content must never be rendered');
});

test('a BLOCKED batch and an unreadable file keep the run non-complete', async () => {
    const adapter = memoryAdapter();
    await writeEvidenceBatch({ adapter, ...authorized, batch: batch({ batch_id: 'ok', sufficiency: 'COMPLETE' }) });
    adapter.files.set('docs/project-assessment/run-2026-001/evidence/azure-devops/broken.json', '{not json');
    const view = await buildEvidenceDashboard({ adapter, folders: FOLDERS });
    assert.equal(view.runs[0].status, 'BLOCKED');
    assert.ok(view.runs[0].gaps.some(gap => gap.reason === 'UNREADABLE'));
});

test('an unreadable run is reported as BLOCKED instead of failing the dashboard', async () => {
    const adapter = memoryAdapter();
    await writeEvidenceBatch({ adapter, ...authorized, batch: batch() });
    const failing = { ...adapter, async list(segs) { if (segs.at(-1) === 'evidence') throw new Error('boom'); return adapter.list(segs); } };
    const view = await buildEvidenceDashboard({ adapter: failing, folders: FOLDERS });
    assert.equal(view.runs[0].status, 'BLOCKED');
    assert.equal(view.runs[0].gaps[0].reason, 'READ_FAILED');
});

test('rendered HTML has a strict CSP, no script, and escapes stored text', () => {
    const view = {
        state: 'OK',
        runs: [{
            run_id: 'run-1', status: 'UNKNOWN', batch_count: 1, last_update: null,
            coverage: [{ source_key: 'src', batch_count: 1, record_count: 0, scopes: ['<img src=x onerror=alert(1)>'], status: 'UNKNOWN' }],
            gaps: [{ source_key: 'src', batch: '"><script>', reason: 'UNKNOWN' }],
            batches: []
        }]
    };
    const html = renderEvidenceDashboardHtml(view, { cspSource: 'vscode-resource:', nonce: 'n0nce' });
    assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'nonce-n0nce';"/);
    assert.ok(!/<script/i.test(html), 'no script element may be rendered');
    assert.ok(!html.includes('<img src=x'), 'scope text must be escaped');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!html.includes('"><script>'));
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('no-workspace and no-evidence messages render without run data', () => {
    const html = renderEvidenceDashboardHtml({ state: 'NO_WORKSPACE', runs: [] }, { nonce: 'n' });
    assert.match(html, /Open a folder/);
    assert.ok(!/<table/.test(html));
});

test('the dashboard module keeps no VS Code state and never touches ADO source data', async () => {
    const source = await readFile(path.join(repoRoot, 'src', 'evidence-dashboard.js'), 'utf8');
    assert.ok(!/globalState|workspaceState|storage|require\('vscode'\)/.test(source));
    const extension = await readFile(path.join(repoRoot, 'src', 'extension.js'), 'utf8');
    const body = extension.slice(extension.indexOf('async function openEvidenceDashboard'), extension.indexOf('function registerEvidenceBatchTool'));
    assert.ok(body.length > 0);
    assert.ok(!/globalState|workspaceState|storage|globalStorage/.test(body));
});

test('the command is registered and declared for activation and the palette', async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
    assert.ok(pkg.activationEvents.includes('onCommand:agentRoster.openEvidenceDashboard'));
    assert.ok(pkg.contributes.commands.some(command => command.command === 'agentRoster.openEvidenceDashboard' && command.title === 'Agent Roster: Open Evidence Dashboard'));
    const extension = await readFile(path.join(repoRoot, 'src', 'extension.js'), 'utf8');
    assert.match(extension, /registerCommand\('agentRoster\.openEvidenceDashboard'/);
});

test('listEvidenceRuns returns sorted run folders only', async () => {
    const adapter = memoryAdapter();
    await writeEvidenceBatch({ adapter, ...authorized, batch: batch({ run_id: 'run-b' }) });
    await writeEvidenceBatch({ adapter, ...authorized, batch: batch({ run_id: 'run-a' }) });
    assert.deepEqual(await store.listEvidenceRuns({ adapter }), ['run-a', 'run-b']);
});
