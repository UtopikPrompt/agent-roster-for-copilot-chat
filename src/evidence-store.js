'use strict';

// Workspace-only evidence batch store. Batches are written beneath the open
// project's docs/project-assessment/<run-id>/evidence/<source-key>/ folder.
// This module keeps no VS Code state of its own; all project data goes through the injected file adapter.
// File access is injected so the logic is testable without VS Code.

const { createHash } = require('node:crypto');

const SCHEMA = 'aro.evidence-batch.v1';
const EVIDENCE_ROOT = ['docs', 'project-assessment'];
const SUFFICIENCY_RANK = Object.freeze({ COMPLETE: 0, PARTIAL: 1, UNKNOWN: 2, BLOCKED: 3 });
const SUFFICIENCY_VALUES = Object.freeze(Object.keys(SUFFICIENCY_RANK));
const MAX_RECORDS = 500;
const MAX_BATCH_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function coded(code, message) {
    const error = new Error(message ? `${code}: ${message}` : code);
    error.code = code;
    return error;
}

function safeSegment(value, label) {
    if (typeof value !== 'string' || !SAFE_SEGMENT.test(value) || value.includes('..')) {
        throw coded('INVALID_SEGMENT', `${label} must be a single safe name of letters, digits, dot, underscore, or hyphen`);
    }
    return value;
}

// Exactly one open workspace folder is a valid target. Zero or several folders need the user to choose.
function resolveWriteTarget(folders) {
    if (!Array.isArray(folders) || folders.length === 0) throw coded('NO_WORKSPACE', 'open a workspace folder before writing evidence');
    if (folders.length > 1) throw coded('AMBIGUOUS_WORKSPACE', 'several workspace folders are open; the user must select one target');
    return folders[0];
}

function batchSegments(runId, sourceKey, batchId) {
    return [...EVIDENCE_ROOT, safeSegment(runId, 'run_id'), 'evidence', safeSegment(sourceKey, 'source_key'), `${safeSegment(batchId, 'batch_id')}.json`];
}

function runEvidenceSegments(runId) {
    return [...EVIDENCE_ROOT, safeSegment(runId, 'run_id'), 'evidence'];
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function validateBatch(batch) {
    if (!batch || typeof batch !== 'object' || Array.isArray(batch)) throw coded('INVALID_BATCH', 'batch must be an object');
    safeSegment(batch.run_id, 'run_id');
    safeSegment(batch.source_key, 'source_key');
    safeSegment(batch.batch_id, 'batch_id');
    if (typeof batch.scope_id !== 'string' || batch.scope_id.length < 1 || batch.scope_id.length > 200) {
        throw coded('INVALID_BATCH', 'scope_id must be a non-empty string up to 200 characters');
    }
    if (!SUFFICIENCY_VALUES.includes(batch.sufficiency)) {
        throw coded('INVALID_BATCH', `sufficiency must be one of ${SUFFICIENCY_VALUES.join(', ')}`);
    }
    if (!Array.isArray(batch.records)) throw coded('INVALID_BATCH', 'records must be an array');
    if (batch.records.length > MAX_RECORDS) throw coded('BATCH_TOO_LARGE', `at most ${MAX_RECORDS} records per batch`);
    for (const record of batch.records) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) throw coded('INVALID_BATCH', 'each record must be an object');
        if (typeof record.evidence_id !== 'string' || record.evidence_id.length < 1 || record.evidence_id.length > 200) {
            throw coded('INVALID_BATCH', 'each record needs a non-empty evidence_id up to 200 characters');
        }
        if (record.batch_id !== batch.batch_id) throw coded('INVALID_BATCH', 'every record batch_id must equal the batch batch_id');
    }
    const normalized = {
        schema: SCHEMA,
        run_id: batch.run_id,
        scope_id: batch.scope_id,
        source_key: batch.source_key,
        batch_id: batch.batch_id,
        sufficiency: batch.sufficiency,
        record_count: batch.records.length,
        records: batch.records
    };
    const text = `${stableStringify(normalized)}\n`;
    if (Buffer.byteLength(text, 'utf8') > MAX_BATCH_BYTES) throw coded('BATCH_TOO_LARGE', 'batch exceeds the size cap');
    return { normalized, text };
}

function receipt(status, normalized, segments, text) {
    return {
        status,
        run_id: normalized.run_id,
        source_key: normalized.source_key,
        batch_id: normalized.batch_id,
        sufficiency: normalized.sufficiency,
        record_count: normalized.record_count,
        sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
        path: segments.join('/')
    };
}

// Adapter contract:
//   readText(segments) -> string | null            (null when absent)
//   writeNew(segments, text)                        (must fail with code 'EXISTS' instead of overwriting)
//   list(segments) -> [{ name, isDirectory }]       ([] when absent)
async function writeEvidenceBatch({ adapter, folders, batch, writeAuthorized }) {
    if (writeAuthorized !== true) throw coded('WRITE_NOT_AUTHORIZED', 'evidence writes require explicit user confirmation');
    resolveWriteTarget(folders);
    const { normalized, text } = validateBatch(batch);
    const segments = batchSegments(normalized.run_id, normalized.source_key, normalized.batch_id);

    const existing = await adapter.readText(segments);
    if (existing !== null) {
        if (existing === text) return receipt('already_recorded', normalized, segments, text);
        throw coded('BATCH_CONFLICT', 'a different batch with this batch_id already exists; it is never overwritten');
    }
    try {
        await adapter.writeNew(segments, text);
    } catch (error) {
        if (error?.code !== 'EXISTS') throw error;
        const raced = await adapter.readText(segments);
        if (raced === text) return receipt('already_recorded', normalized, segments, text);
        throw coded('BATCH_CONFLICT', 'a different batch with this batch_id already exists; it is never overwritten');
    }
    const readBack = await adapter.readText(segments);
    if (readBack !== text) throw coded('READBACK_MISMATCH', 'the written batch did not read back identically');
    return receipt('written', normalized, segments, text);
}

// Worst-status aggregation: any non-COMPLETE batch prevents a COMPLETE run.
function aggregateSufficiency(values) {
    if (values.length === 0) return 'UNKNOWN';
    return values.reduce((worst, value) => (SUFFICIENCY_RANK[value] > SUFFICIENCY_RANK[worst] ? value : worst), 'COMPLETE');
}

// Lists run folder names under docs/project-assessment; reads nothing inside them.
async function listEvidenceRuns({ adapter }) {
    return (await adapter.list(EVIDENCE_ROOT))
        .filter(entry => entry.isDirectory && SAFE_SEGMENT.test(entry.name))
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b));
}

async function readEvidenceStatus({ adapter, runId }) {
    const runSegments = runEvidenceSegments(runId);
    const sourceEntries = (await adapter.list(runSegments)).filter(entry => entry.isDirectory && SAFE_SEGMENT.test(entry.name));
    const batches = [];
    for (const source of sourceEntries.sort((a, b) => a.name.localeCompare(b.name))) {
        const files = (await adapter.list([...runSegments, source.name])).filter(entry => !entry.isDirectory && !entry.name.startsWith('.') && entry.name.endsWith('.json'));
        for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
            const segments = [...runSegments, source.name, file.name];
            const text = await adapter.readText(segments);
            if (text === null) continue;
            const modified_at = typeof adapter.modified === 'function' ? await adapter.modified(segments) : null;
            try {
                const parsed = JSON.parse(text);
                validateBatch(parsed);
                batches.push({
                    source_key: source.name,
                    batch_id: parsed.batch_id,
                    scope_id: parsed.scope_id,
                    sufficiency: parsed.sufficiency,
                    record_count: parsed.record_count,
                    modified_at,
                    sha256: createHash('sha256').update(text, 'utf8').digest('hex')
                });
            } catch {
                batches.push({ source_key: source.name, file: file.name, sufficiency: 'BLOCKED', error: 'UNREADABLE', modified_at });
            }
        }
    }
    const runSufficiency = aggregateSufficiency(batches.map(batch => batch.sufficiency));
    return {
        run_id: runId,
        batch_count: batches.length,
        batches,
        run_sufficiency: runSufficiency,
        complete_eligible: runSufficiency === 'COMPLETE'
    };
}

function validatePagingArgs(cursor, pageSize) {
    const offset = cursor ?? 0;
    const size = pageSize ?? DEFAULT_PAGE_SIZE;
    if (!Number.isSafeInteger(offset) || offset < 0) throw coded('INVALID_CURSOR', 'cursor must be a non-negative integer');
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PAGE_SIZE) throw coded('INVALID_PAGE_SIZE', `pageSize must be an integer from 1 to ${MAX_PAGE_SIZE}`);
    return { offset, size };
}

// Read-only: returns one bounded page of one batch's records in stored order, never reading other batches.
async function readBatchPage({ adapter, folders, runId, sourceKey, batchId, scopeId, cursor, pageSize }) {
    resolveWriteTarget(folders);
    const { offset, size } = validatePagingArgs(cursor, pageSize);
    const segments = batchSegments(runId, sourceKey, batchId);
    const where = `${runId}/${sourceKey}/${batchId}`;
    const text = await adapter.readText(segments);
    if (text === null) throw coded('BATCH_NOT_FOUND', `no batch ${where} exists in the open workspace folder`);

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw coded('MALFORMED_BATCH', `${where} is not valid JSON`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.records)) {
        throw coded('MALFORMED_BATCH', `${where} must be an object with a records array`);
    }
    if (parsed.run_id !== runId || parsed.source_key !== sourceKey || parsed.batch_id !== batchId) {
        throw coded('IDENTITY_MISMATCH', `${where} file identity does not match its path`);
    }
    if (scopeId !== undefined && parsed.scope_id !== scopeId) {
        throw coded('SCOPE_MISMATCH', `${where} belongs to scope ${parsed.scope_id}, not ${scopeId}`);
    }
    parsed.records.forEach((record, index) => {
        const valid = record && typeof record === 'object' && !Array.isArray(record)
            && typeof record.evidence_id === 'string' && record.evidence_id.length >= 1 && record.evidence_id.length <= 200
            && record.batch_id === batchId;
        if (!valid) throw coded('MALFORMED_RECORD', `${where} record index ${index} is malformed; the page is not returned`);
    });
    try {
        validateBatch(parsed);
    } catch (error) {
        throw coded('MALFORMED_BATCH', `${where}: ${error.message}`);
    }

    const total = parsed.records.length;
    const page = parsed.records.slice(offset, offset + size);
    const nextOffset = offset + page.length;
    const finalPage = nextOffset >= total;
    return {
        status: 'read',
        run_id: runId,
        scope_id: parsed.scope_id,
        source_key: sourceKey,
        batch_id: batchId,
        sufficiency: parsed.sufficiency,
        path: segments.join('/'),
        sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
        record_count: total,
        cursor: offset,
        page_size: size,
        returned_count: page.length,
        next_cursor: finalPage ? null : nextOffset,
        final_page: finalPage,
        records: page
    };
}

module.exports = {
    SCHEMA,
    SUFFICIENCY_VALUES,
    MAX_RECORDS,
    MAX_PAGE_SIZE,
    resolveWriteTarget,
    batchSegments,
    validateBatch,
    stableStringify,
    aggregateSufficiency,
    writeEvidenceBatch,
    listEvidenceRuns,
    readEvidenceStatus,
    readBatchPage
};
