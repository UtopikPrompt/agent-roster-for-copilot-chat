import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, lstat, symlink, readFile, copyFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

let DatabaseSync;
try {
    ({ DatabaseSync } = await import('node:sqlite'));
} catch {
    DatabaseSync = null;
}
import priorStore from '../src/prior-assessment-store.js';

async function makeStore() {
    if (!DatabaseSync) throw new Error('SQLite support is unavailable in this Node runtime; use a supported VS Code runtime or local JSON/CSV export instead.');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'prior-store-'));
    const file = path.join(dir, 'evidence.sqlite');
    const db = new DatabaseSync(file);
    db.exec(`
        CREATE TABLE documents (rowid INTEGER PRIMARY KEY, rel_path TEXT, sha256 TEXT, extraction_status TEXT);
        CREATE TABLE runs (run_id TEXT PRIMARY KEY);
        CREATE VIRTUAL TABLE docs_fts USING fts5(title, body);
        CREATE INDEX ix_documents_status ON documents(extraction_status);
    `);
    db.prepare('INSERT INTO runs(run_id) VALUES (?)').run('run-1');
    db.prepare('INSERT INTO documents(rowid, rel_path, sha256, extraction_status) VALUES (?, ?, ?, ?)').run(10, 'docs/a.txt', 'abc', 'extracted');
    db.prepare('INSERT INTO docs_fts(rowid, title, body) VALUES (?, ?, ?)').run(10, 'A', 'Needle in prior extracted text');
    db.close();
    return { dir, file };
}

test('prior store is read-only, fixed-schema, bounded, and canonically mapped', async () => {
    const fixture = await makeStore();
    try {
        const result = await priorStore.loadStore({ selectedPath: fixture.file, operation: 'search', query: 'Needle', pageSize: 1, sqliteApi: { DatabaseSync } });
        assert.equal(result.reuse, true);
        assert.equal(result.coverage, 'UNKNOWN');
        assert.equal(result.completeness, 'UNKNOWN');
        assert.equal(result.records.length, 1);
        assert.doesNotMatch(result.records[0].locator, /^(?:[A-Za-z]:[\\/]|\/|docs\/a\.txt$)/);
        assert.match(result.records[0].locator, /^documents\/[a-f0-9]{64}$/);
        assert.doesNotMatch(JSON.stringify(result), /evidence\.sqlite|C:\\|source_path|manifest_metadata:.*\{.*run/i);
        assert.match(result.records[0].evidence_id, /^prior%20local%20SQLite%20corpus:/);
        assert.equal(result.records[0].container, result.store_id);
        assert.ok(result.records[0].retrieved_at);
        assert.equal(result.records[0].status, 'COMPLETE');
        assert.match(result.reuse_label, /not live OneDrive/i);
    } finally {
        await rm(fixture.dir, { recursive: true, force: true });
    }
});

test('prior store treats FTS input literally and safely', async () => {
    const fixture = await makeStore();
    try {
        for (const query of ['"', 'Needle OR text', 'Need*', '"unterminated', 'AND NOT']) {
            const result = await priorStore.loadStore({ selectedPath: fixture.file, operation: 'search', query, pageSize: 20, sqliteApi: { DatabaseSync } });
            assert.equal(Array.isArray(result.records), true);
        }
        assert.equal(priorStore.literalFtsQuery('A "quote" OR *'), '"A ""quote"" OR *"');
    } finally {
        await rm(fixture.dir, { recursive: true, force: true });
    }
});

test('prior store package declares a VS Code runtime and guards SQLite availability', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(typeof packageJson.engines?.vscode, 'string');
});

test('prior store fails safely when SQLite API is unavailable', async () => {
    const fixture = await makeStore();
    try {
        await assert.rejects(priorStore.loadStore({ selectedPath: fixture.file, sqliteApi: {} }), /SQLite support is unavailable/i);
    } finally {
        await rm(fixture.dir, { recursive: true, force: true });
    }
});

test('prior store verifies an explicitly supplied adjacent manifest and rejects mismatches', async () => {
    const fixture = await makeStore();
    try {
        const manifestPath = path.join(fixture.dir, 'evidence-manifest.json');
        await writeFile(manifestPath, JSON.stringify({
            manifest: 'seao-evidence-manifest/1',
            scope_id: 'synthetic-corpus',
            coverage: 'PARTIAL'
        }));

        const accepted = await priorStore.loadStore({
            selectedPath: fixture.file,
            manifestPath,
            operation: 'list',
            pageSize: 20,
            sqliteApi: { DatabaseSync }
        });
        assert.equal(accepted.manifest_metadata.manifest_present, true);
        assert.equal(accepted.manifest_metadata.manifest_id, 'seao-evidence-manifest/1');
        assert.equal(accepted.manifest_metadata.verification, 'UNVERIFIED_NOT_CRYPTOGRAPHICALLY_BOUND_TO_DB');
        assert.doesNotMatch(JSON.stringify(accepted.manifest_metadata), /synthetic-corpus|scope_id|scope/);

        await writeFile(manifestPath, JSON.stringify({ manifest: 'other-format/1', scope_id: 'synthetic-corpus' }));
        await assert.rejects(priorStore.loadStore({
            selectedPath: fixture.file,
            manifestPath,
            sqliteApi: { DatabaseSync }
        }), /does not identify seao-evidence-manifest\/1/);

        await writeFile(manifestPath, JSON.stringify({ manifest: 'seao-evidence-manifest/1' }));
        const withoutScope = await priorStore.loadStore({
            selectedPath: fixture.file,
            manifestPath,
            sqliteApi: { DatabaseSync }
        });
        assert.equal(withoutScope.manifest_metadata.verification, 'UNVERIFIED_NOT_CRYPTOGRAPHICALLY_BOUND_TO_DB');
        assert.equal(withoutScope.coverage, 'UNKNOWN');

        const outside = path.join(path.dirname(fixture.dir), 'outside-manifest.json');
        await writeFile(outside, JSON.stringify({ manifest: 'seao-evidence-manifest/1', scope_id: 'outside' }));
        await assert.rejects(priorStore.loadStore({
            selectedPath: fixture.file,
            manifestPath: outside,
            sqliteApi: { DatabaseSync }
        }), /adjacent/);
        await rm(outside, { force: true });
    } finally {
        await rm(fixture.dir, { recursive: true, force: true });
    }
});

test('prior store read-only calls do not mutate the SQLite file', async () => {
    const fixture = await makeStore();
    try {
        const before = await readFile(fixture.file);
        await priorStore.loadStore({ selectedPath: fixture.file, operation: 'list', pageSize: 20, sqliteApi: { DatabaseSync } });
        await priorStore.loadStore({ selectedPath: fixture.file, operation: 'search', query: 'Needle', pageSize: 20, sqliteApi: { DatabaseSync } });
        const after = await readFile(fixture.file);
        assert.deepEqual(after, before);
    } finally {
        await rm(fixture.dir, { recursive: true, force: true });
    }
});

test('prior store redacts sensitive excerpts and keeps safe metadata', () => {
    assert.equal(priorStore.redactExcerpt('Contact jane@example.com with password=secret'), null);
    assert.equal(priorStore.redactExcerpt('Bearer eyJabc.def.ghi'), null);
    assert.equal(priorStore.redactExcerpt('ordinary engineering text'), 'ordinary engineering text');
});

test('prior store rejects authorization ambiguity, symlinks, SQL, and unsupported schema', async (t) => {
    await assert.rejects(priorStore.loadStore({ operation: 'search', query: 'x', sqliteApi: { DatabaseSync } }), /selected by the user/i);

    const fixture = await makeStore();
    try {
        await assert.rejects(priorStore.loadStore({ selectedPath: fixture.file, operation: 'search', query: 'x', pageSize: 21, sqliteApi: { DatabaseSync } }), /pageSize/i);

        const link = path.join(fixture.dir, 'linked.sqlite');
        try {
            await symlink(fixture.file, link);
            await assert.rejects(priorStore.loadStore({ selectedPath: link, sqliteApi: { DatabaseSync } }), /symlink/i);
        } catch (error) {
            if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
                t.skip('Windows denied symlink creation due to insufficient privileges.');
                return;
            }
            throw error;
        }

        const bad = path.join(fixture.dir, 'bad.sqlite');
        const db = new DatabaseSync(bad);
        db.exec('CREATE TABLE wrong (value TEXT)');
        db.close();
        await assert.rejects(priorStore.loadStore({ selectedPath: bad, sqliteApi: { DatabaseSync } }), /Unsupported SQLite schema/);
        await assert.rejects(priorStore.loadStore({ selectedPath: fixture.file, operation: 'DROP TABLE documents', sqliteApi: { DatabaseSync } }), /Unsupported operation/);

        const missingColumns = path.join(fixture.dir, 'missing-columns.sqlite');
        const missingDb = new DatabaseSync(missingColumns);
        missingDb.exec(`CREATE TABLE documents (rowid INTEGER PRIMARY KEY, rel_path TEXT); CREATE TABLE runs (run_id TEXT); CREATE VIRTUAL TABLE docs_fts USING fts5(title, body);`);
        missingDb.close();
        await assert.rejects(priorStore.loadStore({ selectedPath: missingColumns, sqliteApi: { DatabaseSync } }), /missing sha256, extraction_status|Unsupported SQLite schema/);

        const nonFts = path.join(fixture.dir, 'non-fts.sqlite');
        const nonFtsDb = new DatabaseSync(nonFts);
        nonFtsDb.exec(`CREATE TABLE documents (rowid INTEGER PRIMARY KEY, rel_path TEXT, sha256 TEXT, extraction_status TEXT); CREATE TABLE runs (run_id TEXT); CREATE TABLE docs_fts (title TEXT, body TEXT);`);
        nonFtsDb.close();
        await assert.rejects(priorStore.loadStore({ selectedPath: nonFts, sqliteApi: { DatabaseSync } }), /not FTS5/);

        const malformed = path.join(fixture.dir, 'malformed.sqlite');
        await writeFile(malformed, 'this is not sqlite');
        await assert.rejects(priorStore.loadStore({ selectedPath: malformed, sqliteApi: { DatabaseSync } }), /Unable to open|Unsupported|malformed|file/i);
    } finally {
        await rm(fixture.dir, { recursive: true, force: true });
    }
});

test('prior store rejects WAL and journal sidecars without changing them', async () => {
    const fixture = await makeStore();
    try {
        for (const suffix of ['-wal', '-shm', '-journal']) {
            const sidecar = `${fixture.file}${suffix}`;
            await writeFile(sidecar, `synthetic${suffix}`);
            const before = await readFile(sidecar);
            await assert.rejects(priorStore.loadStore({ selectedPath: fixture.file, sqliteApi: { DatabaseSync } }), /sidecar is present/i);
            const after = await readFile(sidecar);
            assert.deepEqual(after, before);
            await rm(sidecar, { force: true });
        }
        const names = await readdir(fixture.dir);
        assert.equal(names.some(name => ['-wal', '-shm', '-journal'].some(suffix => name.endsWith(suffix))), false);
    } finally {
        await rm(fixture.dir, { recursive: true, force: true });
    }
});

test('prior store uses DB-content identity across copied paths and exposes real page counts', async () => {
    const fixture = await makeStore();
    const copyDir = await mkdtemp(path.join(os.tmpdir(), 'prior-store-copy-'));
    const renamedFile = path.join(copyDir, 'renamed.sqlite');
    try {
        await copyFile(fixture.file, renamedFile);
        const first = await priorStore.loadStore({ selectedPath: fixture.file, operation: 'list', pageSize: 20, sqliteApi: { DatabaseSync } });
        const second = await priorStore.loadStore({ selectedPath: renamedFile, operation: 'list', pageSize: 20, sqliteApi: { DatabaseSync } });
        assert.equal(first.store_id, second.store_id);
        assert.equal(first.records[0].container, second.records[0].container);
        assert.equal(first.records[0].evidence_id, second.records[0].evidence_id);
        assert.equal(first.db_hash_sha256.length, 64);
        assert.equal(first.batch_register.input_count, 1);
        assert.equal(first.batch_register.output_count, 1);
        assert.equal(first.batch_register.sufficiency_state, 'PARTIAL');
        assert.equal(first.navigation_ledger.length, 1);
        assert.equal(first.final_page, true);
    } finally {
        await rm(fixture.dir, { recursive: true, force: true });
        await rm(copyDir, { recursive: true, force: true });
    }
});

test('prior store paginates three FTS search matches with a stable batch and unambiguous counts', async () => {
    const fixture = await makeStore();
    try {
        const db = new DatabaseSync(fixture.file);
        db.prepare('INSERT INTO documents(rowid, rel_path, sha256, extraction_status) VALUES (?, ?, ?, ?)').run(30, 'docs/b.txt', 'b'.repeat(64), 'extracted');
        db.prepare('INSERT INTO docs_fts(rowid, title, body) VALUES (?, ?, ?)').run(30, 'B', 'Needle second');
        db.prepare('INSERT INTO documents(rowid, rel_path, sha256, extraction_status) VALUES (?, ?, ?, ?)').run(55, 'docs/c.txt', 'c'.repeat(64), 'extracted');
        db.prepare('INSERT INTO docs_fts(rowid, title, body) VALUES (?, ?, ?)').run(55, 'C', 'Needle third');
        db.close();

        const page1 = await priorStore.loadStore({ selectedPath: fixture.file, operation: 'search', query: 'Needle', cursor: 0, pageSize: 1, sqliteApi: { DatabaseSync } });
        const page2 = await priorStore.loadStore({ selectedPath: fixture.file, operation: 'search', query: 'Needle', cursor: page1.next_cursor, pageSize: 1, sqliteApi: { DatabaseSync } });
        const page3 = await priorStore.loadStore({ selectedPath: fixture.file, operation: 'search', query: 'Needle', cursor: page2.next_cursor, pageSize: 1, sqliteApi: { DatabaseSync } });

        assert.deepEqual([page1.page, page2.page, page3.page], [1, 2, 3]);
        assert.deepEqual([page1.cursor, page2.cursor, page3.cursor], [0, 1, 2]);
        assert.deepEqual([page1.navigation_ledger[0].evidence_before, page2.navigation_ledger[0].evidence_before, page3.navigation_ledger[0].evidence_before], [0, 1, 2]);
        assert.deepEqual([page1.final_page, page2.final_page, page3.final_page], [false, false, true]);
        assert.deepEqual([page1.page_record_count, page2.page_record_count, page3.page_record_count], [1, 1, 1]);
        assert.deepEqual([page1.response_page.record_count, page2.response_page.record_count, page3.response_page.record_count], [1, 1, 1]);
        assert.equal(page1.batch_id, page2.batch_id);
        assert.equal(page2.batch_id, page3.batch_id);
        assert.equal(page1.scope_id, page2.scope_id);
        assert.equal(page2.scope_id, page3.scope_id);
        assert.equal(page1.run_id, page2.run_id);
        assert.equal(page2.run_id, page3.run_id);
        assert.deepEqual([page1.response_page.record_count, page2.response_page.record_count, page3.response_page.record_count], [1, 1, 1]);
        assert.deepEqual([page1.batch_register.output_count, page2.batch_register.output_count, page3.batch_register.output_count], [1, 2, 3]);
        for (const page of [page1, page2, page3]) {
            assert.equal(page.batch_register.input_count, 3);
            assert.equal(page.batch_manifest.record_count, 3);
            assert.equal(page.navigation_ledger[0].evidence_before, page.cursor);
        }
        assert.deepEqual([page1.navigation_ledger[0].step_id, page2.navigation_ledger[0].step_id, page3.navigation_ledger[0].step_id], [
            'prior-store-page:1', 'prior-store-page:2', 'prior-store-page:3'
        ]);
        assert.deepEqual([page1.navigation_ledger[0].status, page2.navigation_ledger[0].status, page3.navigation_ledger[0].status], ['PARTIAL', 'PARTIAL', 'DONE']);

        const capabilityKeys = ['performance_metrics', 'dependency_analysis', 'configuration_inventory', 'identity_security', 'content_revision_history'];
        assert.deepEqual(Object.keys(page1.batch_manifest.capability_coverage), capabilityKeys);
        for (const key of capabilityKeys) {
            assert.equal(page1.batch_manifest.capability_coverage[key].state, 'unknown');
            assert.equal(page1.batch_manifest.capability_coverage[key].assessment, 'NOT_ASSESSED');
            assert.match(page1.batch_manifest.capability_coverage[key].limitations, /Unavailable from this prior-SQLite extracted-text store/);
        }
    } finally {
        await rm(fixture.dir, { recursive: true, force: true });
    }
});

test('prior store paginates list mode across sparse rowids with ordinal cursors', async () => {
    const fixture = await makeStore();
    try {
        const db = new DatabaseSync(fixture.file);
        db.prepare('INSERT INTO documents(rowid, rel_path, sha256, extraction_status) VALUES (?, ?, ?, ?)').run(30, 'docs/b.txt', 'b'.repeat(64), 'extracted');
        db.prepare('INSERT INTO documents(rowid, rel_path, sha256, extraction_status) VALUES (?, ?, ?, ?)').run(55, 'docs/c.txt', 'c'.repeat(64), 'extracted');
        db.close();

        const page1 = await priorStore.loadStore({ selectedPath: fixture.file, operation: 'list', cursor: 0, pageSize: 1, sqliteApi: { DatabaseSync } });
        const page2 = await priorStore.loadStore({ selectedPath: fixture.file, operation: 'list', cursor: page1.next_cursor, pageSize: 1, sqliteApi: { DatabaseSync } });
        const page3 = await priorStore.loadStore({ selectedPath: fixture.file, operation: 'list', cursor: page2.next_cursor, pageSize: 1, sqliteApi: { DatabaseSync } });
        const pages = [page1, page2, page3];

        assert.deepEqual(pages.map(page => page.page), [1, 2, 3]);
        assert.deepEqual(pages.map(page => page.cursor), [0, 1, 2]);
        assert.deepEqual(pages.map(page => page.next_cursor), [1, 2, null]);
        assert.deepEqual(pages.map(page => page.page_record_count), [1, 1, 1]);
        assert.deepEqual(pages.map(page => page.response_page.record_count), [1, 1, 1]);
        assert.deepEqual(pages.map(page => page.batch_register.output_count), [1, 2, 3]);
        assert.deepEqual(pages.map(page => page.final_page), [false, false, true]);
        assert.deepEqual(pages.map(page => page.navigation_ledger[0].evidence_before), [0, 1, 2]);

        assert.equal(page1.batch_id, page2.batch_id);
        assert.equal(page2.batch_id, page3.batch_id);

        const opaqueNativeIds = pages.map(page => page.records[0].native_id);
        const sparseRows = [
            [10, 'docs/a.txt'],
            [30, 'docs/b.txt'],
            [55, 'docs/c.txt']
        ];
        const expectedNativeIds = sparseRows.map(([rowid, relPath]) => {
            const identity = `${page1.db_hash_sha256}\0rowid:${rowid}\0path:${relPath}`;
            return `documents/${createHash('sha256').update(identity, 'utf8').digest('hex')}`;
        });
        assert.deepEqual(opaqueNativeIds, expectedNativeIds);
        assert.equal(new Set(opaqueNativeIds).size, 3);

        const opaqueEvidenceIds = pages.map(page => page.records[0].evidence_id);
        assert.equal(new Set(opaqueEvidenceIds).size, 3);
    } finally {
        await rm(fixture.dir, { recursive: true, force: true });
    }
});

test('prior store never exposes sensitive-looking document paths in identifiers or JSON', async () => {
    const fixture = await makeStore();
    try {
        const sensitiveName = 'HR confidential/jane@contoso.com-password-reset.txt';
        const db = new DatabaseSync(fixture.file);
        db.prepare('UPDATE documents SET rel_path = ? WHERE rowid = 10').run(sensitiveName);
        db.close();

        const result = await priorStore.loadStore({ selectedPath: fixture.file, operation: 'list', pageSize: 20, sqliteApi: { DatabaseSync } });
        const record = result.records[0];
        assert.doesNotMatch(record.native_id, /HR|jane|password|\.txt/i);
        assert.doesNotMatch(record.evidence_id, /HR|jane|password|\.txt/i);
        assert.doesNotMatch(record.locator, /HR|jane|password|\.txt/i);
        assert.doesNotMatch(JSON.stringify(result), /HR confidential|jane@contoso\.com|password-reset\.txt/i);
        assert.match(record.native_id, /^documents\/[a-f0-9]{64}$/);
    } finally {
        await rm(fixture.dir, { recursive: true, force: true });
    }
});

test('prior store rejects readOnly false explicitly', async () => {
    const fixture = await makeStore();
    try {
        await assert.rejects(priorStore.loadStore({
            selectedPath: fixture.file,
            readOnly: false,
            sqliteApi: { DatabaseSync }
        }), /read-only/i);
    } finally {
        await rm(fixture.dir, { recursive: true, force: true });
    }
});

test('prior store rejects cursors beyond input_count without ledger metadata', async () => {
    const fixture = await makeStore();
    try {
        await assert.rejects(priorStore.loadStore({
            selectedPath: fixture.file,
            operation: 'list',
            cursor: 2,
            sqliteApi: { DatabaseSync }
        }), /cursor 2 exceeds input_count 1/i);

        await assert.rejects(priorStore.loadStore({
            selectedPath: fixture.file,
            operation: 'search',
            query: 'Needle',
            cursor: 4,
            sqliteApi: { DatabaseSync }
        }), /cursor 4 exceeds input_count 1/i);

        const finalPage = await priorStore.loadStore({
            selectedPath: fixture.file,
            operation: 'list',
            cursor: 1,
            pageSize: 1,
            sqliteApi: { DatabaseSync }
        });
        assert.equal(finalPage.page_record_count, 0);
        assert.equal(finalPage.final_page, true);
        assert.equal(finalPage.batch_register.output_count, 1);
        assert.equal(finalPage.navigation_ledger[0].evidence_before, 1);
        assert.equal(finalPage.navigation_ledger[0].evidence_after, 1);
    } finally {
        await rm(fixture.dir, { recursive: true, force: true });
    }
});

test('prior store bounds cursors and discloses best-effort privacy', async () => {
    const fixture = await makeStore();
    try {
        for (const cursor of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
            await assert.rejects(priorStore.loadStore({ selectedPath: fixture.file, cursor, sqliteApi: { DatabaseSync } }), /safe integer|non-negative/i);
        }
        const result = await priorStore.loadStore({ selectedPath: fixture.file, sqliteApi: { DatabaseSync } });
        assert.match(result.privacy_notice, /not a PII guarantee/i);
        assert.doesNotMatch(JSON.stringify(result), /evidence\.sqlite|C:\\|source_path|manifest_metadata\.scope/i);
    } finally {
        await rm(fixture.dir, { recursive: true, force: true });
    }
});
