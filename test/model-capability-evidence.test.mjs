import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import capability from '../src/model-capability-evidence.js';

function record(overrides = {}) {
    return {
        source: 'HELM',
        sourceUrl: 'https://example.org/evidence',
        retrievedAt: '2026-11-23T00:00:00.000Z',
        sourceVersion: '2026.11',
        releaseDate: '2026-11-20',
        alias: { exactName: 'Exact Model', vendor: 'provider-a', modelId: 'model-a' },
        aliases: [{ exactName: 'Exact Model', vendor: 'provider-a', modelId: 'model-a' }],
        score: 82,
        percentile: 91,
        rank: 3,
        benchmarkDimensions: { reasoning: { percentile: 95 }, coding: { score: 88 } },
        confidence: 'exact',
        status: 'verified',
        normalizedCapabilityTierProposal: 'complex',
        rationale: 'Verified external benchmark evidence.',
        ...overrides
    };
}

test('capability evidence normalizes source records and benchmark fields', () => {
    const normalized = capability.normalizeCapabilityEvidenceRecord(record());
    assert.equal(normalized.source, 'HELM');
    assert.equal(normalized.alias.vendor, 'provider-a');
    assert.equal(normalized.benchmarkDimensions.coding.score, 88);
    assert.equal(normalized.normalizedCapabilityTierProposal, 'complex');
});

test('exact alias matching never guesses names, providers, or model IDs', () => {
    const normalized = capability.normalizeCapabilityEvidenceRecord(record());
    assert.equal(capability.exactAliasMatches(normalized, { vendor: 'provider-a', id: 'model-a', name: 'Exact Model' }), true);
    assert.equal(capability.exactAliasMatches(normalized, { vendor: 'provider-b', id: 'model-a', name: 'Exact Model' }), false);
    assert.equal(capability.exactAliasMatches(normalized, { vendor: 'provider-a', id: 'model-a', name: 'Different Name' }), false);
    assert.equal(capability.exactAliasMatches(normalized, { vendor: 'provider-a', id: 'model-b', name: 'Exact Model' }), false);
});

test('stale and unknown evidence do not increase tier', () => {
    const stale = [capability.normalizeCapabilityEvidenceRecord(record({ status: 'stale' }))];
    const unknown = [capability.normalizeCapabilityEvidenceRecord(record({ status: 'unknown' }))];
    assert.equal(capability.deriveCapabilityTier({ existingTier: 'simple', externalRecords: stale }), 'simple');
    assert.equal(capability.deriveCapabilityTier({ existingTier: 'simple', externalRecords: unknown }), 'simple');
});

test('provider, stream, control, and rejection blocks prevent tier increase', () => {
    const evidence = [capability.normalizeCapabilityEvidenceRecord(record())];
    for (const block of ['providerBlocked', 'streamBlocked', 'controlBlocked', 'rejected']) {
        assert.equal(capability.deriveCapabilityTier({ existingTier: 'unrated', externalRecords: evidence, [block]: true }), 'unrated');
    }
});

test('local strict and repeated pass evidence derives standard and complex tiers', () => {
    assert.equal(capability.deriveCapabilityTier({ existingTier: 'unrated', localEvidence: { strictCompleted: true } }), 'standard');
    assert.equal(capability.deriveCapabilityTier({
        existingTier: 'standard',
        localEvidence: { repeatedPasses: ['advisor coding complex', 'coding complex'] }
    }), 'complex');
});

test('verified external evidence proposes high tier and provider-qualified duplicates stay separate', () => {
    const high = capability.normalizeCapabilityEvidenceRecord(record({ normalizedCapabilityTierProposal: 'high' }));
    assert.equal(capability.deriveCapabilityTier({ existingTier: 'complex', externalRecords: [high] }), 'high');
    const state = capability.recordCapabilityEvidence(null, record());
    const duplicate = capability.recordCapabilityEvidence(state, record({ alias: { exactName: 'Other Model', vendor: 'provider-b', modelId: 'model-a' }, aliases: [{ exactName: 'Other Model', vendor: 'provider-b', modelId: 'model-a' }] }));
    assert.equal(duplicate.records.length, 2);
});

test('unknown price does not synthesize capability tier or pricing evidence', () => {
    const existing = { '[[vendor,model]]': 'unrated' };
    assert.equal(capability.normalizeTier(existing['[[vendor,model]]']), 'unrated');
    assert.equal(capability.deriveCapabilityTier({ existingTier: 'unrated', externalRecords: [] }), 'unrated');

    const extension = fs.readFileSync(path.join(process.cwd(), 'src/extension.js'), 'utf8');
    assert.doesNotMatch(extension, /derivedTiers|tiersChanged/);
});

test('unknown pricing UI and preserved native snapshot manual local labels', () => {
    const provider = fs.readFileSync(path.join(process.cwd(), 'media/provider-availability.js'), 'utf8');
    const evaluation = fs.readFileSync(path.join(process.cwd(), 'media/model-evaluation.js'), 'utf8');
    const dashboard = fs.readFileSync(path.join(process.cwd(), 'media/model-learning-dashboard.js'), 'utf8');
    for (const source of [provider, evaluation, dashboard]) {
        assert.match(source, /Unknown/);
    }
    assert.match(provider, /Native/);
    assert.match(provider, /Snapshot/);
    assert.match(provider, /Manual tier/);
    assert.match(provider, /Local \(no token charge\)/);
    assert.match(dashboard, /Native rate/);
    assert.match(dashboard, /Rate snapshot/);
    assert.match(dashboard, /Manual tier/);
    assert.match(dashboard, /Local \(no token charge\)/);
});

test('there are no guessed Mistral alias mappings', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/model-capability-evidence.js'), 'utf8').toLowerCase();
    assert.doesNotMatch(source, /mistral/);
});
