import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The module is CommonJS (like the extension host); load it the same way.
const require = createRequire(import.meta.url);
const store = require('../src/evidence-store.js');
const { aggregateSufficiency, readBatchPage, readEvidenceStatus, resolveWriteTarget, writeEvidenceBatch } = store;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function memoryAdapter() {
    const files = new Map();
    const calls = { writeNew: 0 };
    const dirsOf = segs => {
        const prefix = segs.join('/') + '/';
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
        calls,
        async readText(segs) { return files.has(segs.join('/')) ? files.get(segs.join('/')) : null; },
        async writeNew(segs, text) {
            calls.writeNew += 1;
            const key = segs.join('/');
            if (files.has(key)) { const error = new Error('exists'); error.code = 'EXISTS'; throw error; }
            files.set(key, text);
        },
        async list(segs) { return dirsOf(segs); }
    };
}

const FOLDERS = ['C:/target-project'];
const RUN = 'run-2026-001';
const batch = (overrides = {}) => ({
    run_id: RUN,
    scope_id: 'scope-alpha',
    source_key: 'azure-devops',
    batch_id: 'b001',
    sufficiency: 'PARTIAL',
    records: [{ evidence_id: 'ev-1', batch_id: 'b001', title: 'record one' }],
    ...overrides
});
const authorized = { writeAuthorized: true, folders: FOLDERS };

test('write target: no workspace and ambiguous workspace throw, one folder is accepted', () => {
    assert.throws(() => resolveWriteTarget([]), /NO_WORKSPACE/);
    assert.throws(() => resolveWriteTarget(undefined), /NO_WORKSPACE/);
    assert.throws(() => resolveWriteTarget(['C:/a', 'C:/b']), /AMBIGUOUS_WORKSPACE/);
    assert.equal(resolveWriteTarget(['C:/a']), 'C:/a');
});

test('writes are refused without write authorization and never touch the adapter', async () => {
    const adapter = memoryAdapter();
    await assert.rejects(writeEvidenceBatch({ adapter, folders: FOLDERS, batch: batch() }), /WRITE_NOT_AUTHORIZED/);
    await assert.rejects(writeEvidenceBatch({ adapter, folders: FOLDERS, batch: batch(), writeAuthorized: 'yes' }), /WRITE_NOT_AUTHORIZED/);
    assert.equal(adapter.calls.writeNew, 0);
    assert.equal(adapter.files.size, 0);
});

test('absent or ambiguous workspace blocks the write before any file operation', async () => {
    const adapter = memoryAdapter();
    await assert.rejects(writeEvidenceBatch({ adapter, folders: [], batch: batch(), writeAuthorized: true }), /NO_WORKSPACE/);
    await assert.rejects(writeEvidenceBatch({ adapter, folders: ['C:/a', 'C:/b'], batch: batch(), writeAuthorized: true }), /AMBIGUOUS_WORKSPACE/);
    assert.equal(adapter.calls.writeNew, 0);
});

test('a batch is written only under the run evidence folder for its source', async () => {
    const adapter = memoryAdapter();
    const receipt = await writeEvidenceBatch({ adapter, ...authorized, batch: batch() });
    assert.equal(receipt.status, 'written');
    assert.equal(receipt.path, `docs/project-assessment/${RUN}/evidence/azure-devops/b001.json`);
    assert.deepEqual([...adapter.files.keys()], [receipt.path]);
    assert.equal(receipt.record_count, 1);
    assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
    assert.equal(receipt.path.includes('C:/'), false, 'receipt must not expose absolute paths');
});

test('same content re-sent after an interruption is idempotent and does not rewrite', async () => {
    const adapter = memoryAdapter();
    const first = await writeEvidenceBatch({ adapter, ...authorized, batch: batch() });
    const second = await writeEvidenceBatch({ adapter, ...authorized, batch: batch() });
    assert.equal(first.status, 'written');
    assert.equal(second.status, 'already_recorded');
    assert.equal(second.sha256, first.sha256);
    assert.equal(adapter.calls.writeNew, 1);
});

test('different content under an existing batch_id is refused and the original is preserved', async () => {
    const adapter = memoryAdapter();
    await writeEvidenceBatch({ adapter, ...authorized, batch: batch() });
    const original = adapter.files.get(`docs/project-assessment/${RUN}/evidence/azure-devops/b001.json`);
    await assert.rejects(
        writeEvidenceBatch({ adapter, ...authorized, batch: batch({ records: [{ evidence_id: 'ev-2', batch_id: 'b001' }] }) }),
        /BATCH_CONFLICT/
    );
    assert.equal(adapter.files.get(`docs/project-assessment/${RUN}/evidence/azure-devops/b001.json`), original);
});

test('a racing writer that hits EXISTS resolves to idempotent success or conflict, never overwrite', async () => {
    const adapter = memoryAdapter();
    const key = `docs/project-assessment/${RUN}/evidence/azure-devops/b001.json`;
    const probe = memoryAdapter();
    await writeEvidenceBatch({ adapter: probe, ...authorized, batch: batch() });
    const canonical = probe.files.get(key);
    // The first existence check misses; a concurrent writer lands the identical batch before writeNew runs.
    let reads = 0;
    const racing = {
        ...adapter,
        async readText(segs) {
            reads += 1;
            return reads === 1 ? null : (adapter.files.get(segs.join('/')) ?? null);
        },
        async writeNew(segs, text) {
            adapter.files.set(segs.join('/'), canonical);
            return adapter.writeNew(segs, text);
        }
    };
    const receipt = await writeEvidenceBatch({ adapter: racing, ...authorized, batch: batch() });
    assert.equal(receipt.status, 'already_recorded');
    assert.equal(adapter.files.get(key), canonical);
});

test('resume: status lists earlier batches so the collector can skip recorded ones', async () => {
    const adapter = memoryAdapter();
    await writeEvidenceBatch({ adapter, ...authorized, batch: batch({ batch_id: 'b001', sufficiency: 'COMPLETE' }) });
    await writeEvidenceBatch({ adapter, ...authorized, batch: batch({ batch_id: 'b002', sufficiency: 'PARTIAL', records: [] }) });
    const status = await readEvidenceStatus({ adapter, runId: RUN });
    assert.equal(status.batch_count, 2);
    assert.deepEqual(status.batches.map(b => b.batch_id), ['b001', 'b002']);
    const resumed = await writeEvidenceBatch({ adapter, ...authorized, batch: batch({ batch_id: 'b001', sufficiency: 'COMPLETE' }) });
    assert.equal(resumed.status, 'already_recorded');
});

test('no COMPLETE upgrade: any PARTIAL batch keeps the run from being COMPLETE', async () => {
    const adapter = memoryAdapter();
    await writeEvidenceBatch({ adapter, ...authorized, batch: batch({ batch_id: 'b001', sufficiency: 'COMPLETE' }) });
    await writeEvidenceBatch({ adapter, ...authorized, batch: batch({ batch_id: 'b002', sufficiency: 'PARTIAL', records: [] }) });
    const status = await readEvidenceStatus({ adapter, runId: RUN });
    assert.equal(status.run_sufficiency, 'PARTIAL');
    assert.equal(status.complete_eligible, false);
    // A later attempt to record the same batch as COMPLETE is a conflict, not an upgrade.
    await assert.rejects(
        writeEvidenceBatch({ adapter, ...authorized, batch: batch({ batch_id: 'b002', sufficiency: 'COMPLETE', records: [] }) }),
        /BATCH_CONFLICT/
    );
    assert.equal((await readEvidenceStatus({ adapter, runId: RUN })).run_sufficiency, 'PARTIAL');
});

test('aggregate sufficiency is worst-status and empty runs are UNKNOWN', () => {
    assert.equal(aggregateSufficiency([]), 'UNKNOWN');
    assert.equal(aggregateSufficiency(['COMPLETE', 'COMPLETE']), 'COMPLETE');
    assert.equal(aggregateSufficiency(['COMPLETE', 'PARTIAL']), 'PARTIAL');
    assert.equal(aggregateSufficiency(['PARTIAL', 'UNKNOWN']), 'UNKNOWN');
    assert.equal(aggregateSufficiency(['COMPLETE', 'BLOCKED', 'PARTIAL']), 'BLOCKED');
});

test('invalid batches are rejected before any write', async () => {
    const cases = [
        [batch({ batch_id: '../escape' }), /INVALID_SEGMENT/],
        [batch({ source_key: 'a/b' }), /INVALID_SEGMENT/],
        [batch({ run_id: '..' }), /INVALID_SEGMENT/],
        [batch({ sufficiency: 'DONE' }), /INVALID_BATCH/],
        [batch({ records: [{ evidence_id: 'ev-1', batch_id: 'other' }] }), /INVALID_BATCH/],
        [batch({ records: [{ batch_id: 'b001' }] }), /INVALID_BATCH/],
        [batch({ scope_id: '' }), /INVALID_BATCH/],
        [batch({ records: Array.from({ length: store.MAX_RECORDS + 1 }, (_, i) => ({ evidence_id: `ev-${i}`, batch_id: 'b001' })) }), /BATCH_TOO_LARGE/]
    ];
    for (const [candidate, pattern] of cases) {
        const adapter = memoryAdapter();
        await assert.rejects(writeEvidenceBatch({ adapter, ...authorized, batch: candidate }), pattern);
        assert.equal(adapter.calls.writeNew, 0);
    }
});

test('status reports malformed batch files as BLOCKED instead of COMPLETE', async () => {
    const adapter = memoryAdapter();
    await writeEvidenceBatch({ adapter, ...authorized, batch: batch({ batch_id: 'b001', sufficiency: 'COMPLETE' }) });
    adapter.files.set(`docs/project-assessment/${RUN}/evidence/azure-devops/broken.json`, '{not json');
    const status = await readEvidenceStatus({ adapter, runId: RUN });
    assert.equal(status.run_sufficiency, 'BLOCKED');
    assert.ok(status.batches.some(b => b.error === 'UNREADABLE'));
});

test('store module never uses globalState, workspaceState, or extension storage', async () => {
    const source = await readFile(path.join(repoRoot, 'src', 'evidence-store.js'), 'utf8');
    assert.doesNotMatch(source, /globalState|workspaceState|storageUri|globalStorageUri|require\(['"]vscode['"]\)/);
});

test('extension registers the write tool with a VS Code confirmation gate and workspace-only adapter', async () => {
    const extension = await readFile(path.join(repoRoot, 'src', 'extension.js'), 'utf8');
    assert.match(extension, /registerTool\('aro_write_evidence_batch'/);
    assert.match(extension, /confirmationMessages/);
    assert.match(extension, /workspace\.fs/);
    const block = extension.slice(extension.indexOf("registerTool('aro_write_evidence_batch'"));
    assert.doesNotMatch(block.slice(0, 4000), /globalState|workspaceState|globalStorageUri|storageUri/);
});

test('package.json declares the write tool and its activation event', async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
    const tool = pkg.contributes.languageModelTools.find(entry => entry.name === 'aro_write_evidence_batch');
    assert.ok(tool, 'aro_write_evidence_batch must be declared');
    assert.ok(pkg.activationEvents.includes('onLanguageModelTool:aro_write_evidence_batch'));
    assert.deepEqual(tool.inputSchema.required, ['operation']);
});

const pageRecords = (batchId, count) => Array.from({ length: count }, (_, i) => ({
    evidence_id: `${batchId}-ev-${String(i).padStart(3, '0')}`,
    batch_id: batchId,
    title: `record ${i}`,
    details: { position: i, nested: { keep: true } }
}));
const pageArgs = (overrides = {}) => ({ adapter: null, folders: FOLDERS, runId: RUN, sourceKey: 'azure-devops', batchId: 'b001', ...overrides });

async function seedPagedBatch(adapter, { batchId = 'b001', count = 45, scope = 'scope-alpha', runId = RUN, sourceKey = 'azure-devops' } = {}) {
    await writeEvidenceBatch({
        adapter, ...authorized,
        batch: { run_id: runId, scope_id: scope, source_key: sourceKey, batch_id: batchId, sufficiency: 'PARTIAL', records: pageRecords(batchId, count) }
    });
}

test('read pages: consecutive pages concatenate to the full batch in stored order with the last page flagged', async () => {
    const adapter = memoryAdapter();
    await seedPagedBatch(adapter, { count: 45 });
    const collected = [];
    let cursor = 0;
    const pages = [];
    for (; ;) {
        const page = await readBatchPage({ ...pageArgs({ adapter, cursor, pageSize: 20 }) });
        pages.push(page);
        collected.push(...page.records);
        if (page.final_page) break;
        cursor = page.next_cursor;
    }
    assert.deepEqual(pages.map(p => p.returned_count), [20, 20, 5]);
    assert.deepEqual(pages.map(p => p.next_cursor), [20, 40, null]);
    assert.deepEqual(pages.map(p => p.final_page), [false, false, true]);
    assert.equal(collected.length, 45);
    assert.deepEqual(collected.map(r => r.evidence_id), pageRecords('b001', 45).map(r => r.evidence_id));
});

test('read pages preserve complete record fields and nested details', async () => {
    const adapter = memoryAdapter();
    await seedPagedBatch(adapter, { count: 3 });
    const page = await readBatchPage({ ...pageArgs({ adapter }) });
    assert.deepEqual(page.records, pageRecords('b001', 3));
    assert.equal(page.records[2].details.nested.keep, true);
});

test('read page returns identity, status, path, and hash without absolute paths', async () => {
    const adapter = memoryAdapter();
    await seedPagedBatch(adapter, { count: 2 });
    const page = await readBatchPage({ ...pageArgs({ adapter }) });
    assert.equal(page.status, 'read');
    assert.equal(page.run_id, RUN);
    assert.equal(page.scope_id, 'scope-alpha');
    assert.equal(page.source_key, 'azure-devops');
    assert.equal(page.batch_id, 'b001');
    assert.equal(page.sufficiency, 'PARTIAL');
    assert.equal(page.record_count, 2);
    assert.equal(page.path, `docs/project-assessment/${RUN}/evidence/azure-devops/b001.json`);
    assert.match(page.sha256, /^[a-f0-9]{64}$/);
    assert.equal(page.path.includes('C:/'), false);
});

test('read page boundaries: empty batch is a single final empty page; cursor past end is empty and final', async () => {
    const adapter = memoryAdapter();
    await seedPagedBatch(adapter, { batchId: 'b002', count: 0 });
    const empty = await readBatchPage({ ...pageArgs({ adapter, batchId: 'b002' }) });
    assert.deepEqual(empty.records, []);
    assert.equal(empty.final_page, true);
    assert.equal(empty.next_cursor, null);
    await seedPagedBatch(adapter, { count: 5 });
    const past = await readBatchPage({ ...pageArgs({ adapter, cursor: 50 }) });
    assert.deepEqual(past.records, []);
    assert.equal(past.final_page, true);
});

test('read page validates cursor and page size bounds before any read', async () => {
    const adapter = memoryAdapter();
    await seedPagedBatch(adapter, { count: 3 });
    const bad = [
        [{ cursor: -1 }, /INVALID_CURSOR/],
        [{ cursor: 1.5 }, /INVALID_CURSOR/],
        [{ pageSize: 0 }, /INVALID_PAGE_SIZE/],
        [{ pageSize: store.MAX_PAGE_SIZE + 1 }, /INVALID_PAGE_SIZE/]
    ];
    for (const [overrides, pattern] of bad) {
        await assert.rejects(readBatchPage({ ...pageArgs({ adapter, ...overrides }) }), pattern);
    }
});

test('read page is run, source, and batch isolated and refuses a missing batch', async () => {
    const adapter = memoryAdapter();
    await seedPagedBatch(adapter, { count: 2, runId: 'run-other' });
    await seedPagedBatch(adapter, { count: 3, sourceKey: 'github' });
    await seedPagedBatch(adapter, { count: 4 });
    const own = await readBatchPage({ ...pageArgs({ adapter, sourceKey: 'azure-devops' }) });
    assert.equal(own.record_count, 4);
    await assert.rejects(readBatchPage({ ...pageArgs({ adapter, batchId: 'b999' }) }), /BATCH_NOT_FOUND/);
    await assert.rejects(readBatchPage({ ...pageArgs({ adapter, runId: 'run-missing' }) }), /BATCH_NOT_FOUND/);
    const github = await readBatchPage({ ...pageArgs({ adapter, sourceKey: 'github' }) });
    assert.equal(github.record_count, 3);
});

test('read page refuses a batch from a different scope when scopeId is asserted', async () => {
    const adapter = memoryAdapter();
    await seedPagedBatch(adapter, { count: 2, scope: 'scope-alpha' });
    await assert.rejects(readBatchPage({ ...pageArgs({ adapter, scopeId: 'scope-beta' }) }), /SCOPE_MISMATCH/);
    const page = await readBatchPage({ ...pageArgs({ adapter, scopeId: 'scope-alpha' }) });
    assert.equal(page.record_count, 2);
});

test('read page rejects unsafe run, source, and batch identifiers before any read', async () => {
    const adapter = memoryAdapter();
    const reads = { count: 0 };
    const counting = { ...adapter, async readText(segs) { reads.count += 1; return adapter.readText(segs); } };
    for (const overrides of [{ runId: '../etc' }, { sourceKey: 'a/b' }, { batchId: '..' }, { runId: undefined }]) {
        await assert.rejects(readBatchPage({ ...pageArgs({ adapter: counting, ...overrides }) }), /INVALID_SEGMENT/);
    }
    assert.equal(reads.count, 0);
});

test('read page surfaces a malformed record by batch and index instead of skipping it', async () => {
    const adapter = memoryAdapter();
    await seedPagedBatch(adapter, { count: 3 });
    const key = `docs/project-assessment/${RUN}/evidence/azure-devops/b001.json`;
    const parsed = JSON.parse(adapter.files.get(key));
    parsed.records[1] = { evidence_id: 'bad-1', batch_id: 'other-batch' };
    adapter.files.set(key, JSON.stringify(parsed));
    await assert.rejects(readBatchPage({ ...pageArgs({ adapter }) }), error => {
        assert.equal(error.code, 'MALFORMED_RECORD');
        assert.match(error.message, new RegExp(`${RUN}/azure-devops/b001 record index 1`));
        return true;
    });
});

test('read page surfaces unparseable and identity-mismatched batch files with their batch identity', async () => {
    const adapter = memoryAdapter();
    const key = `docs/project-assessment/${RUN}/evidence/azure-devops/b001.json`;
    adapter.files.set(key, '{not json');
    await assert.rejects(readBatchPage({ ...pageArgs({ adapter }) }), error => error.code === 'MALFORMED_BATCH' && error.message.includes('b001'));
    const other = memoryAdapter();
    await seedPagedBatch(other, { count: 1 });
    const parsed = JSON.parse(other.files.get(`docs/project-assessment/${RUN}/evidence/azure-devops/b001.json`));
    parsed.source_key = 'github';
    adapter.files.set(key, JSON.stringify(parsed));
    await assert.rejects(readBatchPage({ ...pageArgs({ adapter }) }), /IDENTITY_MISMATCH/);
});

test('read page never reads outside the single open workspace folder and its evidence store', async () => {
    const adapter = memoryAdapter();
    await seedPagedBatch(adapter, { count: 1 });
    const seen = [];
    const spying = { ...adapter, async readText(segs) { seen.push(segs.join('/')); return adapter.readText(segs); } };
    await readBatchPage({ ...pageArgs({ adapter: spying }) });
    assert.equal(seen.length, 1);
    assert.match(seen[0], /^docs\/project-assessment\/[^/]+\/evidence\/[^/]+\/[^/]+\.json$/);
    await assert.rejects(readBatchPage({ ...pageArgs({ adapter: spying, folders: ['C:/a', 'C:/b'] }) }), /AMBIGUOUS_WORKSPACE/);
    await assert.rejects(readBatchPage({ ...pageArgs({ adapter: spying, folders: [] }) }), /NO_WORKSPACE/);
    assert.equal(seen.length, 1, 'no read occurs when the workspace target is invalid');
});

test('read page module code has no write or storage capability', async () => {
    const source = await readFile(path.join(repoRoot, 'src', 'evidence-store.js'), 'utf8');
    const start = source.indexOf('async function readBatchPage');
    const body = source.slice(start, source.indexOf('module.exports'));
    assert.doesNotMatch(body, /writeNew|writeFile|rename|createDirectory|delete/);
});

test('extension registers a least-privilege read tool with no confirmation or write path', async () => {
    const extension = await readFile(path.join(repoRoot, 'src', 'extension.js'), 'utf8');
    assert.match(extension, /registerTool\('aro_read_evidence_batch_page'/);
    const start = extension.indexOf("registerTool('aro_read_evidence_batch_page'");
    const block = extension.slice(start, extension.indexOf('function deactivate', start));
    assert.doesNotMatch(block, /confirmationMessages|writeEvidenceBatch|writeNew|globalState|workspaceState|storageUri/);
    assert.match(block, /readBatchPage/);
});

test('package.json declares the read tool with a bounded read-only schema', async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
    const tool = pkg.contributes.languageModelTools.find(entry => entry.name === 'aro_read_evidence_batch_page');
    assert.ok(tool, 'aro_read_evidence_batch_page must be declared');
    assert.ok(pkg.activationEvents.includes('onLanguageModelTool:aro_read_evidence_batch_page'));
    assert.deepEqual(tool.inputSchema.required, ['runId', 'sourceKey', 'batchId']);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.inputSchema.properties.pageSize.maximum, 50);
    assert.equal(tool.inputSchema.properties.cursor.minimum, 0);
    assert.doesNotMatch(JSON.stringify(tool.inputSchema), /"path"|"write"/);
});
