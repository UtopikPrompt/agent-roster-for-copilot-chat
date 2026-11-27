import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parseCustomization, root } from '../scripts/validate.mjs';

const read = relative => readFile(path.join(root, relative), 'utf8');
const load = async relative => parseCustomization(await read(relative), relative);
const agent = name => load(`agents/${name}.agent.md`);

const ASSESSMENT_AGENTS = ['ProjectAssessmentAdvisor', 'ProjectAssessmentExpert'];
const ASSESSMENT_SKILLS = ['project-assessment'];

for (const name of ASSESSMENT_AGENTS) {
    test(`${name} is registered and non-delegating`, async () => {
        const manifest = JSON.parse(await read('package.json'));
        assert.ok(manifest.contributes.chatAgents.some(entry => entry.path === `./agents/${name}.agent.md`));
        const { metadata } = await agent(name);
        assert.deepEqual(metadata.tools, []);
        assert.deepEqual(metadata.agents, []);
        assert.equal(metadata['user-invocable'], false);
    });
}

test('obsolete evidence collector agents are deleted and unregistered', async () => {
    const manifest = JSON.parse(await read('package.json'));
    const registrations = manifest.contributes.chatAgents.map(entry => entry.path);
    for (const name of [
        'ProjectEvidenceAzureDevOpsCollector',
        'ProjectEvidenceGitHubCollector',
        'ProjectEvidenceLocalRepoCollector',
        'ProjectEvidenceM365Collector',
        'ProjectEvidenceSharePointCollector'
    ]) {
        assert.ok(!registrations.includes(`./agents/${name}.agent.md`));
        await assert.rejects(readFile(path.join(root, 'agents', `${name}.agent.md`), 'utf8'));
    }
});

test('assessment advisor chooses supplied domain specialists, not collectors', async () => {
    const { metadata, body } = await agent('ProjectAssessmentAdvisor');
    assert.deepEqual(metadata.tools, []);
    assert.deepEqual(metadata.agents, []);
    assert.match(body, /Select only candidates supplied in the call/);
    assert.match(body, /NO_MATCH/);
    assert.doesNotMatch(body, /Collector|ProjectEvidence|source family|source-family/i);
});

test('assessment expert synthesizes supplied or authorized material without collection or writes', async () => {
    const { metadata, body } = await agent('ProjectAssessmentExpert');
    assert.deepEqual(metadata.tools, []);
    assert.deepEqual(metadata.agents, []);
    assert.match(body, /supplied|authorized/i);
    assert.match(body, /do not collect/i);
    assert.match(body, /write files|do not write/i);
    assert.match(body, /NOT ASSESSED|UNKNOWN|PARTIAL|BLOCKED/i);
    assert.doesNotMatch(body, /ProjectEvidence|Collector|fixed source|source-family/i);
});

test('project assessment skill is general and source-neutral', async () => {
    const manifest = JSON.parse(await read('package.json'));
    assert.ok(manifest.contributes.chatSkills.some(entry => entry.path === './skills/project-assessment/SKILL.md'));
    assert.ok(!manifest.contributes.chatSkills.some(entry => entry.path.includes('project-evidence-ingestion')));

    const { metadata, body } = await load('skills/project-assessment/SKILL.md');
    assert.equal(metadata.name, 'project-assessment');
    assert.match(body, /active workspace/i);
    assert.match(body, /explicitly names and authorizes/i);
    assert.match(body, /health\/readiness/i);
    assert.match(body, /architecture and technical quality/i);
    assert.match(body, /alignment with user-provided requirements/i);
    assert.match(body, /separate substantive deliverables for each relevant audience/i);
    assert.match(body, /advisor-selected general read-only specialists/i);
    assert.match(body, /no suitable read-only worker\/tool.*UNKNOWN\/NOT ASSESSED/i);
    assert.match(body, /NOT ASSESSED|UNKNOWN|PARTIAL|BLOCKED/i);
    assert.doesNotMatch(body, /ProjectEvidence|collector workflow|source-family|fixed source family|live-collector/i);
});

test('Aro uses the general assessment flow and retains no collector routing', async () => {
    const { metadata, body } = await agent('Aro');
    assert.ok(metadata.agents.includes('ProjectAssessmentAdvisor'));
    assert.ok(metadata.agents.includes('ProjectAssessmentExpert'));
    assert.doesNotMatch(metadata.agents.join(','), /ProjectEvidence/);

    const start = body.indexOf('## Project Assessment Coordination');
    const end = body.indexOf('## Pre-Blocker Dispatch Gate');
    assert.ok(start !== -1 && end > start);
    const section = body.slice(start, end);
    assert.match(section, /any user-defined subject/i);
    assert.match(section, /active workspace/i);
    assert.match(section, /explicitly name/i);
    assert.match(section, /separate substantive document for every relevant audience/i);
    assert.match(section, /ProjectAssessmentAdvisor.*ProjectAssessmentExpert/i);
    assert.match(section, /no fixed modernization\/rebuild chain|no fixed specialist chain/i);
    assert.match(section, /CodeRebuildEngineer only when/i);
    assert.match(section, /active workspace is the default|advisor-selected general read-only/i);
    assert.doesNotMatch(section, /ProjectEvidence|collector|source-family|source family|run it for every default assessment/i);
});

test('Aro procedure tool exposes only the general assessment skill', async () => {
    const manifest = JSON.parse(await read('package.json'));
    const tool = manifest.contributes.languageModelTools.find(entry => entry.name === 'aroGetSkillProcedure');
    assert.ok(tool);
    assert.deepEqual(tool.inputSchema.properties.skill.enum, ASSESSMENT_SKILLS);

    const source = await read('src/extension.js');
    assert.match(source, /BUNDLED_SKILLS = Object\.freeze\(\['project-assessment'\]\)/);
    assert.doesNotMatch(source, /project-evidence-ingestion|ProjectEvidence/i);
});

test('assessment guide records general scope and no fixed source workflow', async () => {
    const guide = await read('docs/project-assessment.md');
    assert.match(guide, /active workspace/i);
    assert.match(guide, /explicitly name and authorize/i);
    assert.match(guide, /no fixed source family or connector workflow/i);
    assert.match(guide, /separate substantive report for each relevant audience/i);
    assert.doesNotMatch(guide, /ProjectEvidence|evidence collector|source adapters|SharePoint|Microsoft 365|Azure DevOps|GitHub/i);
});

test('assessment catalogs contain no collector or evidence-ingestion entries', async () => {
    const manifest = JSON.parse(await read('package.json'));
    const registrations = JSON.stringify(manifest.contributes.chatAgents).concat(JSON.stringify(manifest.contributes.chatSkills));
    assert.doesNotMatch(registrations, /ProjectEvidence|project-evidence-ingestion/);

    for (const file of ['README.md', 'CONTRIBUTING.md', 'docs/agents.md', 'docs/advanced-task-prompts.md', 'docs/project-assessment.md', 'docs/skills.md']) {
        const text = await read(file);
        assert.doesNotMatch(text, /ProjectEvidence|project-evidence-ingestion/i, `${file} must not catalog removed assessment roles`);
    }
});
