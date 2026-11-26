'use strict';

// Read-only dashboard model over the open workspace's evidence batches. Shows batch metadata only;
// record content is never copied into the view model or the HTML. No VS Code state is read or written.

const { listEvidenceRuns, readEvidenceStatus } = require('./evidence-store');

const STATUS_LABELS = Object.freeze({
    COMPLETE: 'COMPLETE',
    PARTIAL: 'PARTIAL',
    BLOCKED: 'BLOCKED',
    UNKNOWN: 'UNKNOWN'
});

function normalizeStatus(value) {
    return Object.hasOwn(STATUS_LABELS, value) ? value : 'UNKNOWN';
}

function latestTimestamp(values) {
    const times = values.filter(value => Number.isFinite(value));
    return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function summarizeCoverage(batches) {
    const bySource = new Map();
    for (const batch of batches) {
        const entry = bySource.get(batch.source_key) ?? { source_key: batch.source_key, batch_count: 0, record_count: 0, scopes: new Set(), statuses: [] };
        entry.batch_count += 1;
        entry.record_count += Number.isFinite(batch.record_count) ? batch.record_count : 0;
        if (batch.scope_id) entry.scopes.add(batch.scope_id);
        entry.statuses.push(normalizeStatus(batch.sufficiency));
        bySource.set(batch.source_key, entry);
    }
    return [...bySource.values()]
        .sort((a, b) => a.source_key.localeCompare(b.source_key))
        .map(entry => ({
            source_key: entry.source_key,
            batch_count: entry.batch_count,
            record_count: entry.record_count,
            scopes: [...entry.scopes].sort(),
            status: worstOf(entry.statuses)
        }));
}

// Mirrors the store's worst-status rule so the dashboard never upgrades a run.
function worstOf(statuses) {
    const rank = { COMPLETE: 0, PARTIAL: 1, UNKNOWN: 2, BLOCKED: 3 };
    if (statuses.length === 0) return 'UNKNOWN';
    return statuses.reduce((worst, value) => (rank[value] > rank[worst] ? value : worst), 'COMPLETE');
}

function summarizeRun(status) {
    const batches = status.batches.map(batch => ({
        source_key: batch.source_key,
        batch_id: batch.batch_id ?? null,
        file: batch.file ?? null,
        scope_id: batch.scope_id ?? null,
        sufficiency: normalizeStatus(batch.sufficiency),
        record_count: Number.isFinite(batch.record_count) ? batch.record_count : null,
        error: batch.error ?? null,
        modified_at: Number.isFinite(batch.modified_at) ? batch.modified_at : null,
        sha256_prefix: typeof batch.sha256 === 'string' ? batch.sha256.slice(0, 12) : null
    }));
    const gaps = batches
        .filter(batch => batch.sufficiency !== 'COMPLETE')
        .map(batch => ({
            source_key: batch.source_key,
            batch: batch.batch_id ?? batch.file,
            reason: batch.error ?? batch.sufficiency
        }));
    if (batches.length === 0) gaps.push({ source_key: null, batch: null, reason: 'no batches recorded' });
    return {
        run_id: status.run_id,
        status: normalizeStatus(status.run_sufficiency),
        batch_count: status.batch_count,
        last_update: latestTimestamp(batches.map(batch => batch.modified_at)),
        coverage: summarizeCoverage(status.batches),
        gaps,
        batches
    };
}

// Returns a view model; never throws for a missing folder, missing evidence, or a single unreadable run.
async function buildEvidenceDashboard({ adapter, folders }) {
    if (!Array.isArray(folders) || folders.length === 0) return { state: 'NO_WORKSPACE', runs: [] };
    if (folders.length > 1) return { state: 'AMBIGUOUS_WORKSPACE', runs: [] };
    const runIds = await listEvidenceRuns({ adapter });
    if (runIds.length === 0) return { state: 'NO_EVIDENCE', runs: [] };
    const runs = [];
    for (const runId of runIds) {
        try {
            runs.push(summarizeRun(await readEvidenceStatus({ adapter, runId })));
        } catch {
            runs.push({
                run_id: runId, status: 'BLOCKED', batch_count: 0, last_update: null, coverage: [],
                gaps: [{ source_key: null, batch: null, reason: 'READ_FAILED' }], batches: []
            });
        }
    }
    return { state: 'OK', runs };
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

const STATE_MESSAGES = Object.freeze({
    NO_WORKSPACE: 'Open a folder to view its evidence. Evidence is read only from the open workspace folder.',
    AMBIGUOUS_WORKSPACE: 'Several workspace folders are open. Open a single folder to view its evidence.',
    NO_EVIDENCE: 'No evidence snapshots found under docs/project-assessment/ in the open folder.'
});

function renderBadge(status) {
    const label = STATUS_LABELS[normalizeStatus(status)];
    return `<span class="badge badge-${label.toLowerCase()}">${label}</span>`;
}

function renderTable(headers, rows) {
    return `<table><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function renderRun(run) {
    const coverage = run.coverage.length
        ? renderTable(['Source', 'Status', 'Batches', 'Records', 'Scopes'], run.coverage.map(entry => `<tr><td>${escapeHtml(entry.source_key)}</td><td>${renderBadge(entry.status)}</td><td>${entry.batch_count}</td><td>${entry.record_count}</td><td>${escapeHtml(entry.scopes.join(', ') || 'none')}</td></tr>`))
        : '<p>No batches recorded for this run.</p>';
    const gaps = run.gaps.length
        ? `<ul>${run.gaps.map(gap => `<li>${escapeHtml(gap.source_key ? `${gap.source_key} / ${gap.batch ?? 'unknown batch'}: ` : '')}${escapeHtml(gap.reason)}</li>`).join('')}</ul>`
        : '<p>No gaps: every batch is COMPLETE.</p>';
    const batches = run.batches.length
        ? renderTable(['Source', 'Batch', 'Scope', 'Status', 'Records', 'Last update', 'SHA-256 prefix'], run.batches.map(batch => `<tr><td>${escapeHtml(batch.source_key)}</td><td>${escapeHtml(batch.batch_id ?? batch.file ?? 'unknown')}</td><td>${escapeHtml(batch.scope_id ?? '')}</td><td>${renderBadge(batch.sufficiency)}${batch.error ? ` <small>${escapeHtml(batch.error)}</small>` : ''}</td><td>${batch.record_count ?? ''}</td><td>${escapeHtml(batch.modified_at ? new Date(batch.modified_at).toISOString() : 'unknown')}</td><td><code>${escapeHtml(batch.sha256_prefix ?? '')}</code></td></tr>`))
        : '';
    return `<section class="run" aria-labelledby="run-${escapeHtml(run.run_id)}">
  <h2 id="run-${escapeHtml(run.run_id)}">Run ${escapeHtml(run.run_id)} ${renderBadge(run.status)}</h2>
  <p>Batches: ${run.batch_count} &middot; Last update: ${escapeHtml(run.last_update ?? 'unknown')}</p>
  <h3>Coverage</h3>
  ${coverage}
  <h3>Gaps</h3>
  ${gaps}
  ${batches ? `<h3>Batches</h3>${batches}` : ''}
</section>`;
}

function renderEvidenceDashboardHtml(view, { nonce }) {
    const body = view.state === 'OK'
        ? view.runs.map(renderRun).join('\n')
        : `<p class="notice">${escapeHtml(STATE_MESSAGES[view.state] ?? view.message ?? 'Evidence could not be read.')}</p>`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${escapeHtml(nonce)}';">
  <title>Aro Evidence Dashboard</title>
  <style nonce="${escapeHtml(nonce)}">
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 1rem; }
    table { border-collapse: collapse; margin: 0.5rem 0 1rem; }
    th, td { border: 1px solid var(--vscode-panel-border); padding: 0.3rem 0.6rem; text-align: left; vertical-align: top; }
    .badge { border-radius: 3px; padding: 0.1rem 0.4rem; font-weight: 600; border: 1px solid currentColor; }
    .badge-complete { color: var(--vscode-testing-iconPassed); }
    .badge-partial { color: var(--vscode-editorWarning-foreground); }
    .badge-blocked { color: var(--vscode-errorForeground); }
    .badge-unknown { color: var(--vscode-descriptionForeground); }
    .notice { border-left: 3px solid var(--vscode-editorInfo-foreground); padding-left: 0.6rem; }
  </style>
</head>
<body>
  <header>
    <h1>Aro Evidence Dashboard</h1>
    <p>Read from docs/project-assessment/ in the open workspace folder. Shows batch metadata only; record content is not displayed. Refresh by running the command again.</p>
  </header>
  <main>
${body}
  </main>
</body>
</html>`;
}

module.exports = {
    STATUS_LABELS,
    buildEvidenceDashboard,
    escapeHtml,
    renderEvidenceDashboardHtml,
    summarizeRun
};
