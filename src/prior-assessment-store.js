const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MAX_PAGE_SIZE = 20;
const MAX_SEARCH_LENGTH = 200;
const SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'];

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function resolveAuthorizedStore(selectedPath) {
    if (typeof selectedPath !== 'string' || !selectedPath.trim()) {
        throw new Error('An exact SQLite file must be selected by the user.');
    }
    const absolute = path.resolve(selectedPath);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error('Symbolic-link SQLite files are not allowed.');
    if (!stat.isFile()) throw new Error('The selected SQLite path is not a regular file.');
    const real = await fs.realpath(absolute);
    const realStat = await fs.lstat(real);
    const normalizeCase = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (realStat.isSymbolicLink() || normalizeCase(real) !== normalizeCase(absolute)) {
        throw new Error('The selected SQLite path must resolve without a symlink or path alias.');
    }
    return real;
}

function requireColumns(connection, table, required) {
    let rows;
    try {
        rows = connection.prepare(`PRAGMA table_info('${table}')`).all();
    } catch (error) {
        throw new Error(`Unsupported SQLite schema: cannot inspect ${table}.`);
    }
    const columns = new Set(rows.map(row => row.name));
    const missing = required.filter(column => !columns.has(column));
    if (missing.length) {
        throw new Error(`Unsupported SQLite schema: ${table} is missing ${missing.join(', ')}.`);
    }
}

function validateSchema(connection) {
    let objects;
    try {
        objects = connection.prepare("SELECT name, type, sql FROM sqlite_schema WHERE name IN ('documents', 'runs', 'docs_fts')").all();
    } catch (error) {
        throw new Error('Unsupported or unreadable SQLite database.');
    }
    const byName = new Map(objects.map(row => [row.name, row]));
    for (const name of ['documents', 'runs']) {
        const object = byName.get(name);
        if (!object || object.type !== 'table') throw new Error(`Unsupported SQLite schema: missing table ${name}.`);
    }
    const fts = byName.get('docs_fts');
    if (!fts || fts.type !== 'table') throw new Error('Unsupported SQLite schema: missing FTS5 table docs_fts.');
    if (!/\bfts5\b/i.test(fts.sql || '')) throw new Error('Unsupported SQLite schema: docs_fts is not FTS5.');

    requireColumns(connection, 'documents', ['rel_path', 'sha256', 'extraction_status']);
    requireColumns(connection, 'runs', ['run_id']);
    requireColumns(connection, 'docs_fts', ['title', 'body']);
}

function normalizeStatus(value) {
    if (typeof value !== 'string' || !value.trim()) return 'UNKNOWN';
    const normalized = value.trim().toUpperCase();
    if (['COMPLETE', 'COMPLETED', 'EXTRACTED', 'SUCCESS', 'SUCCEEDED'].includes(normalized)) return 'COMPLETE';
    if (['PARTIAL', 'PENDING', 'RUNNING', 'PROCESSING', 'IN_PROGRESS'].includes(normalized)) return 'PARTIAL';
    if (['FAILED', 'FAILURE', 'ERROR'].includes(normalized)) return 'ERROR';
    if (normalized === 'BLOCKED') return 'BLOCKED';
    if (normalized === 'DENIED') return 'DENIED';
    if (normalized === 'EMPTY') return 'EMPTY';
    return 'UNKNOWN';
}

function hashOpaque(value) {
    return createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 16);
}

async function assertNoDatabaseSidecars(sourcePath) {
    for (const suffix of SIDECAR_SUFFIXES) {
        try {
            await fs.lstat(`${sourcePath}${suffix}`);
            throw new Error(`SQLite sidecar is present (${suffix}); refusing to open because WAL correctness cannot be proven without writes.`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                if (error instanceof Error && error.message.includes('SQLite sidecar is present')) throw error;
                throw new Error(`Unable to verify SQLite sidecar absence: ${error.message}`);
            }
        }
    }
}

async function fingerprintDatabase(sourcePath) {
    const stat = await fs.lstat(sourcePath);
    const content = await fs.readFile(sourcePath);
    return {
        sha256: createHash('sha256').update(content).digest('hex'),
        size: stat.size,
        mtimeMs: stat.mtimeMs
    };
}

function redactExcerpt(value, limit = 500) {
    if (typeof value !== 'string' || !value) return null;
    const compact = value.replace(/\s+/g, ' ').trim();
    if (!compact || compact.includes('\0') || compact.length > 10000) return null;
    const sensitive = [
        /[A-Z]:\\[^\s]+/i,
        /(?:^|\s)\/(?:Users|home)\/[^\s]+/i,
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
        /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/,
        /\b(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|bearer|connection[_ -]?string)\b\s*[:=]/i,
        /(?:^|[?&])(access[_-]?token|refresh[_-]?token|code|password)=[^&\s]+/i,
        /\b(?:eyJ[A-Z0-9_-]+\.[A-Z0-9_-]+\.[A-Z0-9_-]+|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Z0-9]{20,})\b/i,
        /\b\d{3}-\d{2}-\d{4}\b/
    ];
    if (sensitive.some(pattern => pattern.test(compact))) return null;
    return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

function percentEncode(value) {
    return encodeURIComponent(String(value)).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function literalFtsQuery(value) {
    return `"${value.trim().replace(/"/g, '""')}"`;
}

function canonicalEvidenceId(source, container, nativeId, revision, runId) {
    if (revision && revision !== 'UNKNOWN') {
        return `${percentEncode(source)}:${percentEncode(container)}:${percentEncode(nativeId)}@${percentEncode(revision)}`;
    }
    return `${percentEncode(source)}:${percentEncode(container)}:${percentEncode(nativeId)}@run:${percentEncode(runId || 'UNKNOWN')}`;
}

async function readManifest(sourcePath, manifestPath, dbHash) {
    if (typeof manifestPath !== 'string' || !manifestPath.trim()) {
        return { manifest_present: false, verification: 'NOT_SUPPLIED', db_hash_sha256: dbHash, status: 'UNKNOWN', coverage: 'UNKNOWN' };
    }

    const absolute = path.resolve(manifestPath);
    const dbDirectory = path.dirname(sourcePath);
    if (path.dirname(absolute) !== dbDirectory) {
        throw new Error('The supplied manifest must be adjacent to the selected SQLite file.');
    }

    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 256 * 1024) {
        throw new Error('The supplied manifest must be a regular, non-symlink JSON file of 256 KB or less.');
    }

    let manifest;
    try {
        manifest = JSON.parse(await fs.readFile(absolute, 'utf8'));
    } catch (error) {
        throw new Error('The supplied manifest is not valid JSON.');
    }
    if (!isPlainObject(manifest)) throw new Error('The supplied manifest must be a JSON object.');

    const markerKeys = ['manifest', 'manifest_id', 'manifest_type', 'schema', 'schema_id', 'schema_version', 'format', 'format_version'];
    const marker = markerKeys
        .map(key => manifest[key])
        .find(value => value === 'seao-evidence-manifest/1');
    if (marker !== 'seao-evidence-manifest/1') {
        throw new Error('The supplied manifest does not identify seao-evidence-manifest/1.');
    }

    return {
        manifest_present: true,
        manifest_id: 'seao-evidence-manifest/1',
        verification: 'UNVERIFIED_NOT_CRYPTOGRAPHICALLY_BOUND_TO_DB',
        db_hash_sha256: dbHash,
        status: 'UNKNOWN',
        coverage: 'UNKNOWN'
    };
}

function canonicalRecord(row, runId, storeId, dbHash, retrievedAt, batchId, scopeId) {
    const rawSha = typeof row.sha256 === 'string' ? row.sha256.trim().toLowerCase() : '';
    const sha = /^[a-f0-9]{64}$/.test(rawSha) ? rawSha : null;
    const relPath = typeof row.rel_path === 'string' ? row.rel_path.trim() : '';
    const safeRelative = relPath && !path.isAbsolute(relPath) && !relPath.split(/[\\/]+/).includes('..')
        ? relPath.replace(/\\+/g, '/').replace(/^\.\//, '')
        : null;
    const rowid = Number.isSafeInteger(row.rowid) && row.rowid >= 0 ? row.rowid : null;
    const identityInput = safeRelative
        ? `${dbHash}\u0000rowid:${rowid ?? 'UNKNOWN'}\u0000path:${safeRelative}`
        : rowid !== null
            ? `${dbHash}\u0000rowid:${rowid}`
            : null;
    const nativeId = identityInput
        ? `documents/${createHash('sha256').update(identityInput, 'utf8').digest('hex')}`
        : 'UNKNOWN';
    const locator = nativeId;
    const revision = sha || 'UNKNOWN';
    const canonicalRunId = typeof runId === 'string' && runId && runId !== 'MULTIPLE_RUNS' ? runId : runId === 'MULTIPLE_RUNS' ? 'MULTIPLE_RUNS' : 'UNKNOWN';
    const source = 'prior local SQLite corpus';
    const container = `prior-store:${dbHash}`;
    const evidenceId = canonicalEvidenceId(source, container, nativeId, revision, canonicalRunId);
    return {
        evidence_id: evidenceId,
        run_id: canonicalRunId,
        scope_id: scopeId,
        batch_id: batchId,
        source,
        adapter: 'prior-sqlite-corpus-import',
        collector: 'aro_read_prior_assessment_store',
        container,
        native_id: nativeId,
        locator,
        revision,
        retrieved_at: retrievedAt,
        status: normalizeStatus(row.extraction_status),
        coverage: 'UNKNOWN',
        claim_status: 'inferred',
        identity_confidence: sha ? 'revision-pinned' : canonicalRunId === 'UNKNOWN' || nativeId === 'UNKNOWN' ? 'unstable' : 'run-scoped'
        ,excerpt: redactExcerpt(row.body)
    };
}

async function loadStore({ selectedPath, manifestPath, operation = 'list', query = '', cursor = 0, pageSize = 20, readOnly = true, sqliteApi }) {
    if (readOnly !== true) throw new Error('Prior assessment SQLite access must be read-only.');
    if (!['list', 'search'].includes(operation)) throw new Error('Unsupported operation; use list or search.');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        throw new Error(`pageSize must be an integer from 1 to ${MAX_PAGE_SIZE}.`);
    }
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > Number.MAX_SAFE_INTEGER - pageSize) {
        throw new Error('cursor must be a non-negative safe integer that leaves room for the page size.');
    }
    if (typeof query !== 'string' || query.length > MAX_SEARCH_LENGTH) throw new Error(`query must be text no longer than ${MAX_SEARCH_LENGTH} characters.`);

    const sourcePath = await resolveAuthorizedStore(selectedPath);
    let api = sqliteApi;
    if (!api) {
        try { api = require('node:sqlite'); } catch (error) { throw new Error('SQLite support is unavailable in this VS Code runtime; use a local JSON/CSV export instead.'); }
    }
    if (!api.DatabaseSync) throw new Error('SQLite support is unavailable in this VS Code runtime; use a local JSON/CSV export instead.');

    await assertNoDatabaseSidecars(sourcePath);
    const beforeFingerprint = await fingerprintDatabase(sourcePath);
    const verifiedPath = await fs.realpath(sourcePath);
    const verifiedStat = await fs.lstat(verifiedPath);
    if (verifiedStat.isSymbolicLink() || verifiedStat.isDirectory() || verifiedPath !== sourcePath) {
        throw new Error('The selected SQLite file changed after confirmation; no database was opened.');
    }

    let connection;
    try {
        connection = new api.DatabaseSync(sourcePath, { readOnly: true, immutable: true });
    } catch (error) {
        throw new Error(`Unable to open the selected SQLite file read-only: ${error.message}`);
    }

    try {
        validateSchema(connection);
        const runRows = connection.prepare('SELECT run_id FROM runs ORDER BY run_id ASC LIMIT 20').all();
        const runId = runRows.length === 1 ? runRows[0].run_id : runRows.length > 1 ? 'MULTIPLE_RUNS' : 'UNKNOWN';
        let rows;
        let inputCount;
        if (operation === 'search') {
            if (!query.trim()) throw new Error('search requires a non-empty query.');
            const literalQuery = literalFtsQuery(query);
            inputCount = connection.prepare(`
                SELECT COUNT(*) AS count
                FROM docs_fts
                JOIN documents AS d ON d.rowid = docs_fts.rowid
                WHERE docs_fts MATCH ?
            `).get(literalQuery)?.count ?? 0;
            rows = connection.prepare(`
                SELECT d.rowid AS rowid, d.rel_path, d.sha256, d.extraction_status,
                       substr(COALESCE(docs_fts.body, ''), 1, 500) AS body
                FROM docs_fts
                JOIN documents AS d ON d.rowid = docs_fts.rowid
                WHERE docs_fts MATCH ?
                ORDER BY d.rowid ASC
                LIMIT ? OFFSET ?
            `).all(literalQuery, pageSize + 1, cursor);
        } else {
            inputCount = connection.prepare('SELECT COUNT(*) AS count FROM documents').get()?.count ?? 0;
            rows = connection.prepare(`
                SELECT d.rowid AS rowid, d.rel_path, d.sha256, d.extraction_status, NULL AS body
                FROM documents AS d
                ORDER BY d.rowid ASC
                LIMIT ? OFFSET ?
            `).all(pageSize + 1, cursor);
        }
        const safeInputCount = Number.isSafeInteger(inputCount) && inputCount >= 0 ? inputCount : 0;
        if (cursor > safeInputCount) {
            throw new Error(`cursor ${cursor} exceeds input_count ${safeInputCount}; cursor must not be beyond the end of the matching results.`);
        }
        const afterFingerprint = await fingerprintDatabase(sourcePath);
        await assertNoDatabaseSidecars(sourcePath);
        if (afterFingerprint.sha256 !== beforeFingerprint.sha256 || afterFingerprint.size !== beforeFingerprint.size || afterFingerprint.mtimeMs !== beforeFingerprint.mtimeMs) {
            throw new Error('The selected SQLite file changed during import; no database records were accepted.');
        }

        const manifest = await readManifest(sourcePath, manifestPath, beforeFingerprint.sha256);
        const hasMore = rows.length > pageSize;
        const page = rows.slice(0, pageSize);
        const pageRecordCount = page.length;
        const nextCursor = hasMore ? cursor + pageRecordCount : null;
        const pageNumber = Math.floor(cursor / pageSize) + 1;
        const outputCount = Math.min(cursor + pageRecordCount, safeInputCount);
        const retrievedAt = new Date().toISOString();
        const storeId = `prior-store:${beforeFingerprint.sha256}`;
        const scopeId = 'prior-assessment-corpus';
        const opaqueRunRows = runRows.map(row => typeof row.run_id === 'string' && row.run_id
            ? `prior-run:${hashOpaque(row.run_id)}` : 'prior-run:UNKNOWN').slice(0, 20);
        const runIdSafe = runId === 'UNKNOWN' ? 'UNKNOWN' : runId === 'MULTIPLE_RUNS'
            ? 'MULTIPLE_RUNS' : `prior-run:${hashOpaque(runId)}`;
        const batchId = runIdSafe === 'UNKNOWN' || runIdSafe === 'MULTIPLE_RUNS'
            ? `prior-batch:${hashOpaque(`${storeId}:${runIdSafe}`)}`
            : `prior-batch:${hashOpaque(`${storeId}:${runIdSafe}`)}`;
        return {
            reuse: true,
            reuse_label: 'Reuse of prior local SQLite corpus, not live OneDrive collection',
            completeness: 'UNKNOWN',
            coverage: 'UNKNOWN',
            source: 'prior local SQLite corpus',
            store_id: storeId,
            run_ids: opaqueRunRows,
            run_id: runIdSafe,
            scope_id: scopeId,
            batch_id: batchId,
            batch_manifest: {
                batch_id: batchId,
                run_id: runIdSafe,
                scope_id: scopeId,
                source: 'prior local SQLite corpus',
                adapter: 'prior-sqlite-corpus-import',
                collector: 'aro_read_prior_assessment_store',
                container: storeId,
                intended_retrieval_mode: 'UNKNOWN',
                actual_retrieval_mode: 'file-cmdb-import',
                mode_label: 'prior local SQLite corpus',
                mode_proof: 'User-confirmed SQLite file opened with readOnly=true and immutable=true',
                batch_status: 'PARTIAL',
                scope: 'The whole selected prior SQLite corpus query scope',
                time_window: 'UNKNOWN',
                capability_coverage: {
                    performance_metrics: { state: 'unknown', assessment: 'NOT_ASSESSED', scope: 'UNKNOWN', time_window: 'UNKNOWN', limitations: 'Unavailable from this prior-SQLite extracted-text store.' },
                    dependency_analysis: { state: 'unknown', assessment: 'NOT_ASSESSED', scope: 'UNKNOWN', time_window: 'UNKNOWN', limitations: 'Unavailable from this prior-SQLite extracted-text store.' },
                    configuration_inventory: { state: 'unknown', assessment: 'NOT_ASSESSED', scope: 'UNKNOWN', time_window: 'UNKNOWN', limitations: 'Unavailable from this prior-SQLite extracted-text store.' },
                    identity_security: { state: 'unknown', assessment: 'NOT_ASSESSED', scope: 'UNKNOWN', time_window: 'UNKNOWN', limitations: 'Unavailable from this prior-SQLite extracted-text store.' },
                    content_revision_history: { state: 'unknown', assessment: 'NOT_ASSESSED', scope: 'UNKNOWN', time_window: 'UNKNOWN', limitations: 'Unavailable from this prior-SQLite extracted-text store.' }
                },
                known_limitations: ['Manifest scope strings are not trusted as DB-bound scope.', 'No live OneDrive inventory is claimed.', 'Redaction is conservative and excerpts can be suppressed.'],
                record_count: Number.isSafeInteger(inputCount) && inputCount >= 0 ? inputCount : 0,
                db_hash_sha256: beforeFingerprint.sha256,
                manifest_verification: manifest.verification
            },
            batch_register: {
                batch_id: batchId,
                phase: 'P2',
                input_count: safeInputCount,
                output_count: outputCount,
                sufficiency_state: 'PARTIAL',
                checkpoint: 'Counts describe the whole query scope; output was bounded to the current response page.'
            },
            navigation_ledger: [{
                step_id: `prior-store-page:${pageNumber}`,
                trigger: 'user-confirmed prior SQLite import',
                area: 'selected prior SQLite corpus',
                evidence_before: cursor,
                evidence_after: outputCount,
                marginal_expected_change: 'estimated page records only',
                status: hasMore ? 'PARTIAL' : 'DONE',
                remaining_queue: hasMore ? ['continue with next cursor'] : [],
                stop_reason: hasMore ? 'bounded continuation page available' : 'page exhausted'
            }],
            manifest_metadata: manifest,
            manifest_coverage: manifest?.coverage ?? 'UNKNOWN',
            page: pageNumber,
            page_size: pageSize,
            page_record_count: pageRecordCount,
            cursor,
            next_cursor: nextCursor,
            final_page: !hasMore,
            response_page: {
                page: pageNumber,
                page_size: pageSize,
                record_count: page.length,
                cursor,
                next_cursor: nextCursor,
                final_page: !hasMore
            },
            db_hash_sha256: beforeFingerprint.sha256,
            privacy_notice: 'Redaction is best-effort regex-based; it is not a PII guarantee and does not establish safety for sensitive text.',
            records: page.map(row => canonicalRecord(row, runIdSafe, storeId, beforeFingerprint.sha256, retrievedAt, batchId, scopeId))
        };
    } finally {
        connection.close();
    }
}

module.exports = {
    MAX_PAGE_SIZE,
    canonicalEvidenceId,
    canonicalRecord,
    literalFtsQuery,
    loadStore,
    readManifest,
    redactExcerpt,
    normalizeStatus,
    resolveAuthorizedStore,
    validateSchema
};
