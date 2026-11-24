const assert = require('assert');
const { recordOutcome, normalizeScorecard } = require('../src/model-learning');

// Test recording an outcome with vendor field
const scorecard = normalizeScorecard({ schemaVersion: 1, records: [] });
const input = {
    role: 'coding',
    taskCategory: 'simple',
    modelId: 'model1',
    vendor: 'vendor1',
    outcome: 'success',
    evidenceCode: 'acceptance_passed',
};

const updatedScorecard = recordOutcome(scorecard, input);
assert.strictEqual(updatedScorecard.records.length, 1);
assert.strictEqual(updatedScorecard.records[0].vendor, 'vendor1');

console.log('Test passed: Recorded outcome with vendor field.');

// Test normalizeScorecard function
const testScorecard = {
    schemaVersion: 1,
    records: [{
        role: 'coding',
        taskCategory: 'simple',
        modelId: 'model1',
        vendor: 'vendor1',
        outcome: 'success',
        evidenceCode: 'acceptance_passed',
        recordedAt: new Date().toISOString(),
    }],
};

const normalized = normalizeScorecard(testScorecard);
assert.strictEqual(normalized.records.length, 1);
assert.strictEqual(normalized.records[0].vendor, 'vendor1');

console.log('Test passed: Normalized scorecard with vendor field.');