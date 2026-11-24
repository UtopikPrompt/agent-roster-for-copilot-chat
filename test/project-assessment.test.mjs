import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parseCustomization, root } from '../scripts/validate.mjs';

const read = relative => readFile(path.join(root, relative), 'utf8');
const load = async relative => parseCustomization(await read(relative), relative);
const agent = name => load(`agents/${name}.agent.md`);

const READ_VERB = /(^|[_/])(list|search|get|get_schema|search_paths|fetch|retrieve|read)(?=_|$)/;
const COLLECTORS = [
    'ProjectEvidenceSharePointCollector',
    'ProjectEvidenceM365Collector',
    'ProjectEvidenceAzureDevOpsCollector',
    'ProjectEvidenceGitHubCollector',
    'ProjectEvidenceLocalRepoCollector'
];
const WORKERS = [...COLLECTORS, 'ProjectAssessmentExpert'];
const NEW_AGENTS = [...WORKERS, 'ProjectAssessmentAdvisor'];
const NEW_SKILLS = ['project-assessment', 'project-evidence-ingestion'];
const MUTATION = /create|update|delete|do_action|call_function|secret_scanning|list_agents|request_access|access_request|approve|merge|dispatch|token|\*/i;
const FIXED_MAX = /(?:max(?:imum)?|cap|limit)\s+(?:of\s+)?\d+\s+(?:items?|records?|documents?|results?|pages?|files?)/i;

test('collector tool lists are read-only allowlists without wildcards or mutation names', async () => {
    for (const name of COLLECTORS) {
        const { metadata } = await agent(name);
        assert.ok(Array.isArray(metadata.tools), `${name}: tools must be an explicit list`);
        for (const tool of metadata.tools) {
            assert.doesNotMatch(tool, MUTATION, `${name}: ${tool} must not be a mutation or excluded tool`);
            assert.match(tool, READ_VERB, `${name}: ${tool} must carry a read verb`);
        }
    }
});

test('source collectors fail closed with no tools bound until debug verification', async () => {
    for (const name of ['ProjectEvidenceSharePointCollector', 'ProjectEvidenceM365Collector', 'ProjectEvidenceAzureDevOpsCollector', 'ProjectEvidenceGitHubCollector']) {
        const { metadata, body } = await agent(name);
        assert.deepEqual(metadata.tools, [], `${name}: must have no tools bound until debug verification`);
        assert.match(body, /debug/i, `${name}: must state that debug verification is required`);
    }
    const local = await agent('ProjectEvidenceLocalRepoCollector');
    assert.deepEqual(local.metadata.tools, ['read', 'search'], 'local repo collector keeps read and search only');
});

test('Aro runtime gate uses supplied inventory, not an advisor probe, and names the verification owner', async () => {
    const { body } = await agent('Aro');
    assert.match(body, /Runtime inventory gate/);
    assert.doesNotMatch(body, /tool-presence probe/);
    assert.match(body, /does not ask an advisor to probe tools/);
    assert.match(body, /Aro is the verification owner/);
    assert.match(body, /independent review status is UNKNOWN/);
});

test('local collector P1 preflight is the only local exception and remote collectors stay undispatched', async () => {
    const { metadata, body } = await agent('Aro');
    assert.match(body, /Local exception: ProjectEvidenceLocalRepoCollector needs no supplied inventory/);
    assert.match(body, /reading only the root `package\.json` and `README\.md`/, 'preflight must be limited to root package.json and README.md');
    assert.match(body, /Do not ask the user for routine identity or tool inventory/);
    assert.match(body, /If the user named a different target, ask for that target/);
    assert.match(body, /stop and report the exact BLOCKED, ERROR, or NEEDS_INPUT/);
    assert.match(body, /Aro gains no read or search tool and never reads or searches the target itself/);
    assert.match(body, /Remote collectors \(SharePoint, M365, Azure DevOps, and GitHub\) remain BLOCKED and undispatched/);
    assert.match(body, /until their exact runtime tools and read-only profiles are supplied and verified/);
    assert.match(body, /The local exception does not authorize any remote collector/);
    assert.ok(!metadata.tools.some(tool => /read|search/i.test(tool)), 'Aro must keep no read/search tools');

    const { metadata: local, body: localBody } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.deepEqual(local.tools, ['read', 'search'], 'local collector keeps read and search only');
    assert.match(localBody, /## P1 Local Preflight/);
    assert.match(localBody, /Read only the target root `package\.json` and `README\.md`/);
    assert.match(localBody, /Do not search, list, or read any other path during preflight/);
    assert.match(localBody, /return `BLOCKED` naming it/);
    assert.match(localBody, /If neither can be read, return `ERROR`/);
});

test('ADO collector defers grouped and action-based categories as BLOCKED pending schema debug', async () => {
    const { body } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.match(body, /BLOCKED pending debug schema verification/);
    assert.match(body, /Grouped tools that take an action or method parameter are excluded until debug verifies/);
});


test('collectors are non-delegating, not user-invocable', async () => {
    for (const name of WORKERS) {
        const { metadata } = await agent(name);
        assert.deepEqual(metadata.agents, [], `${name}: must not delegate`);
        assert.equal(metadata['user-invocable'], false, `${name}: must not be user-invocable`);
        for (const forbidden of ['edit', 'execute', 'todo', 'agent', 'runSubagent']) {
            assert.ok(!metadata.tools.includes(forbidden), `${name}: must not include ${forbidden}`);
        }
    }
});

test('advisor is tool-free and selection-only', async () => {
    const { metadata, body } = await agent('ProjectAssessmentAdvisor');
    assert.deepEqual(metadata.tools, []);
    assert.deepEqual(metadata.agents, []);
    assert.match(body, /Return only JSON/);
    assert.match(body, /Never collects evidence/);
    assert.match(body, /NO_MATCH/);
});

test('expert is tool-free and does not collect or write', async () => {
    const { metadata, body } = await agent('ProjectAssessmentExpert');
    assert.deepEqual(metadata.tools, []);
    assert.deepEqual(metadata.agents, []);
    assert.match(body, /do not collect evidence from source systems/);
    assert.match(body, /Do not claim that files were saved/);
    assert.match(body, /Validate every supplied `evidence_id` against the same record/i);
    assert.match(body, /source:container:native_id@revision/);
    assert.match(body, /source:container:native_id@run:<run_id>/);
    assert.match(body, /revision is `UNKNOWN`/);
    assert.match(body, /identity_confidence/);
    assert.match(body, /missing or inconsistent/);
    assert.match(body, /do not silently rewrite/i);
    assert.match(body, /identify the mismatch and the required correction/i);
    assert.match(body, /never report overall evidence-ID compliance as PASS/i);
});

test('SharePoint and M365 collectors report preauthorization failures as BLOCKED without access requests', async () => {
    for (const name of ['ProjectEvidenceSharePointCollector', 'ProjectEvidenceM365Collector']) {
        const { body } = await agent(name);
        assert.match(body, /AADSTS65002/, `${name}: must name the preauthorization error`);
        assert.match(body, /`BLOCKED`/, `${name}: must report BLOCKED`);
        assert.match(body, /Do not request tokens or access/, `${name}: must forbid access requests`);
        assert.match(body, /WorkIQ server prefix as listed/, `${name}: must flag the unverified prefix`);
    }
});

test('every collector reports absent tools as BLOCKED without substitution', async () => {
    for (const name of COLLECTORS) {
        const { body } = await agent(name);
        assert.match(body, /Tool absent: `BLOCKED`/, `${name}: absent tools must be BLOCKED`);
        assert.match(body, /Do not substitute another tool/, `${name}: must forbid substitution`);
    }
});

test('no fixed per-source item maximum appears in new agents or skills', async () => {
    const files = [
        ...NEW_AGENTS.map(name => `agents/${name}.agent.md`),
        ...NEW_SKILLS.map(name => `skills/${name}/SKILL.md`),
        'agents/Aro.agent.md'
    ];
    for (const file of files) {
        assert.doesNotMatch(await read(file), FIXED_MAX, `${file}: must not define a fixed per-source maximum`);
    }
});

test('dispatcher has no MCP data tools and routes every new worker through the assessment advisor', async () => {
    const { metadata, body } = await agent('Aro');
    assert.ok(metadata.tools.includes('agent'), 'Aro must keep dispatch capability');
    assert.ok(
        !metadata.tools.some(tool => /mcp|workiq|azuredevops|ado-remote|github|sharepoint/i.test(tool)),
        'Aro must not hold MCP data tools'
    );
    for (const name of NEW_AGENTS) {
        assert.ok(metadata.agents.includes(name), `Aro allowlist must include ${name}`);
    }
    for (const name of WORKERS) {
        const row = new RegExp(`\\|[^\\n]*\\|\\s*${name}\\s*\\|\\s*ProjectAssessmentAdvisor\\s*\\|`);
        assert.match(body, row, `Aro routing index must route ${name} through ProjectAssessmentAdvisor`);
    }
    assert.match(body, /never routes assessment collection to InfraAzureDevOpsAgent/);
    assert.match(body, /GovDocumentationSuiteGenerator/, 'Aro must hand persistence to the writer');
    assert.match(body, /Aro does not write files itself/);
    assert.match(body, /reads back the exact version/);
    assert.doesNotMatch(body, /Report persistence is not part of the current implementation/);
});

test('Aro retrieves assessment procedures through the bundled tool before dispatch and never self-loads or runtime-discovers them', async () => {
    const { metadata, body } = await agent('Aro');
    assert.ok(!metadata.tools.some(tool => /read|search/i.test(tool)), 'Aro must have no read/search tools');
    assert.ok(metadata.tools.includes('UtopikPrompt.agent-roster-for-copilot-chat/aroGetSkillProcedure'), 'Aro must bind the bundled procedure tool');
    const start = body.indexOf('## Project Assessment Coordination');
    const end = body.indexOf('## Pre-Blocker Dispatch Gate');
    assert.ok(start !== -1 && end > start, 'assessment section must exist');
    const section = body.slice(start, end);
    assert.match(section, /Before any P2 dispatch, call `UtopikPrompt\.agent-roster-for-copilot-chat\/aroGetSkillProcedure` with `skill` set to `project-evidence-ingestion`/, 'ingestion procedure must be retrieved automatically before P2');
    assert.match(section, /Before the P5 dispatch, call it with `skill` set to `project-assessment` and again with `skill` set to `project-evidence-ingestion`/, 'both procedures must be retrieved automatically before P5');
    assert.match(section, /pass the returned complete text verbatim to each collector/, 'collectors receive the ingestion procedure');
    assert.match(section, /pass both returned complete texts verbatim to ProjectAssessmentExpert/, 'expert receives both assessment and ingestion procedures');
    assert.doesNotMatch(section, /pass the returned complete text verbatim to ProjectAssessmentExpert only/, 'expert must not regress to assessment-only procedure');
    assert.match(section, /Send it the two verbatim procedure texts retrieved for P5/, 'P5 payload must carry both procedures verbatim');
    assert.match(section, /Each worker receives only the procedures it needs/);
    assert.match(section, /call again with the next `part` until the result says final part, then concatenate the segments in order/, 'Aro must reassemble bounded procedure parts');
    assert.match(section, /If the tool call fails or returns no text, stop the assessment and report the exact tool failure/, 'tool failure must stop the assessment with the exact error');
    assert.match(section, /never asks the user to paste procedure text/, 'user must never be asked to paste bundled text');
    assert.doesNotMatch(section, /askQuestions/, 'assessment procedure retrieval must not use askQuestions');
    assert.match(section, /Aro never reads skill files directly, never resolves them through runtime discovery/);
    assert.doesNotMatch(section, /Load \[project-/, 'Aro must not load assessment skills itself');
    assert.doesNotMatch(section, /yourself/, 'Aro must not direct itself to load skills');
    assert.doesNotMatch(section, /runtime discovery and retry|resolve that named skill/i, 'assessment flow must not resolve skills by runtime discovery');
    const payloadStart = body.indexOf('## Worker Payload');
    const payloadEnd = body.indexOf('\n## ', payloadStart + 1);
    const payload = body.slice(payloadStart, payloadEnd);
    assert.match(payload, /except project-assessment and project-evidence-ingestion,\s+which Aro supplies as complete text under Project Assessment Coordination/, 'worker payload must exempt assessment procedures from runtime discovery');
});

test('a simple project assessment request defaults to the full chain with one consolidated result', async () => {
    const { metadata, body } = await agent('Aro');
    assert.match(metadata.description, /Do an assessment of this\s+project/i, 'Aro description must carry the plain assessment trigger');
    const start = body.indexOf('## Project Assessment Coordination');
    const end = body.indexOf('## Pre-Blocker Dispatch Gate');
    assert.ok(start !== -1 && end > start, 'assessment section must exist');
    const section = body.slice(start, end);
    assert.match(section, /means assess the project open at invocation with the full default P0-P8 chain/, 'plain request must default to the full chain');
    assert.match(section, /Aro returns one consolidated, reconciled user-facing result/, 'Aro must return one consolidated result');
});

test('assessment skills are registered, valid, and linked from agents that use them', async () => {
    const manifest = JSON.parse(await read('package.json'));
    const registered = manifest.contributes.chatSkills.map(entry => entry.path);
    for (const name of NEW_SKILLS) {
        assert.ok(registered.includes(`./skills/${name}/SKILL.md`), `${name} must be registered`);
        const { metadata } = await load(`skills/${name}/SKILL.md`);
        assert.equal(metadata.name, name, `${name}: frontmatter name must match directory`);
    }
    const ingestionLink = '](../skills/project-evidence-ingestion/SKILL.md)';
    const assessmentLink = '](../skills/project-assessment/SKILL.md)';
    for (const name of WORKERS) {
        const { body } = await agent(name);
        assert.ok(body.includes(ingestionLink), `${name}: must link the ingestion contract`);
    }
    const aro = await agent('Aro');
    assert.ok(aro.body.includes(ingestionLink), 'Aro must link the ingestion contract');
    assert.ok(aro.body.includes(assessmentLink), 'Aro must link the assessment procedure');
    const expert = await agent('ProjectAssessmentExpert');
    assert.ok(expert.body.includes(assessmentLink), 'Expert must link the assessment procedure');
});

test('evidence contract defines status values, sufficiency states, and UNKNOWN denominators', async () => {
    const { body } = await load('skills/project-evidence-ingestion/SKILL.md');
    for (const status of ['COMPLETE', 'PARTIAL', 'BLOCKED', 'DENIED', 'EMPTY', 'ERROR']) {
        assert.match(body, new RegExp(`\`${status}\``), `status ${status} must be defined`);
    }
    for (const state of ['INSUFFICIENT', 'CONVERGED', 'DEFERRED', 'BLOCKED', 'COMPLETE']) {
        assert.match(body, new RegExp(`\`${state}\``), `sufficiency ${state} must be defined`);
    }
    assert.match(body, /never as zero/);
    assert.match(body, /AADSTS65002/);
    assert.match(body, /do not call an access-request operation/);
});

test('GitHub collector and skill never describe unverified tools as available', async () => {
    const { body } = await agent('ProjectEvidenceGitHubCollector');
    assert.match(body, /run_secret_scanning/);
    assert.match(body, /exact runtime names are not verified/);
});

test('new agents and skills are registered and documented', async () => {
    const manifest = JSON.parse(await read('package.json'));
    const registeredAgents = manifest.contributes.chatAgents.map(entry => entry.path);
    const agentsDoc = await read('docs/agents.md');
    const readme = await read('README.md');
    const skillsDoc = await read('docs/skills.md');
    for (const name of NEW_AGENTS) {
        assert.ok(registeredAgents.includes(`./agents/${name}.agent.md`), `${name} must be registered`);
        assert.ok(agentsDoc.includes(`agents/${name}.agent.md`), `${name} must be listed in docs/agents.md`);
        assert.ok(readme.includes(`agents/${name}.agent.md`), `${name} must be listed in README.md`);
    }
    for (const name of NEW_SKILLS) {
        assert.ok(skillsDoc.includes(`skills/${name}/SKILL.md`), `${name} must be listed in docs/skills.md`);
        assert.ok(readme.includes(`skills/${name}/SKILL.md`), `${name} must be listed in README.md`);
    }
});

test('ADO collector fails closed on tools outside its allowlist', async () => {
    const { body } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.match(body, /fails closed as `BLOCKED`/);
});

test('SharePoint and M365 collectors explicitly exclude mutation and access-request tools', async () => {
    for (const name of ['ProjectEvidenceSharePointCollector', 'ProjectEvidenceM365Collector']) {
        const { body } = await agent(name);
        assert.match(body, /Explicitly excluded, never call even if listed/, `${name}: must state the exclusion list`);
        for (const tool of ['request_access', 'create_entity', 'delete_entity', 'do_action', 'update_entity']) {
            assert.match(body, new RegExp(`\`${tool}\``), `${name}: must exclude ${tool}`);
        }
    }
});

test('every worker has exactly one Skill Loading section', async () => {
    for (const name of WORKERS) {
        const { body } = await agent(name);
        const count = body.split('## Skill Loading').length - 1;
        assert.equal(count, 1, `${name}: must have exactly one Skill Loading section`);
    }
});

test('advisor carries no skill links', async () => {
    const { body } = await agent('ProjectAssessmentAdvisor');
    assert.ok(!body.includes('](../skills/'), 'advisor must not link skills');
});

test('writer persistence route refuses roster targets, preserves files, and reads back', async () => {
    const { body } = await agent('GovDocumentationSuiteGenerator');
    assert.match(body, /## Assessment Report Persistence/);
    assert.match(body, /Refuse a target root that is the agent-roster repository/);
    assert.match(body, /Preserve existing files/);
    assert.match(body, /Read back each written file/);
    assert.match(body, /Independent review of the persisted version is not part of this route/);
});

test('ingestion contract defines discovery stages D0-D6 and identity confidence', async () => {
    const { body } = await load('skills/project-evidence-ingestion/SKILL.md');
    for (let stage = 0; stage <= 6; stage++) {
        assert.match(body, new RegExp(`\\|\\s*D${stage}\\s*\\|`), `stage D${stage} must be defined`);
    }
    for (const term of ['identity_confidence', 'revision-pinned', 'run-scoped', 'unstable', 'marginal_expected_change']) {
        assert.match(body, new RegExp(term), `${term} must be defined`);
    }
});

test('maintenance counts match the package manifest', async () => {
    const manifest = JSON.parse(await read('package.json'));
    const maintenance = await read('docs/maintenance.md');
    const match = maintenance.match(/Verify all (\d+) definitions and (\d+) skills/);
    assert.ok(match, 'maintenance must state definition and skill counts');
    assert.equal(Number(match[1]), manifest.contributes.chatAgents.length, 'definition count must match chatAgents');
    assert.equal(Number(match[2]), manifest.contributes.chatSkills.length, 'skill count must match chatSkills');
});

test('new assessment text contains no personal absolute paths', async () => {
    const files = [
        ...NEW_AGENTS.map(name => `agents/${name}.agent.md`),
        ...NEW_SKILLS.map(name => `skills/${name}/SKILL.md`)
    ];
    for (const file of files) {
        assert.doesNotMatch(await read(file), /[A-Za-z]:\\Users\\|\/Users\/|\/home\//, `${file}: must not contain personal paths`);
    }
});

const SKILL = 'skills/project-assessment/SKILL.md';
const CHAIN = ['BusinessKnowledgeExpert', 'CodeProductModernizationExpert', 'CodeArchitectureExpert', 'CodeRebuildEngineer'];
const CHAIN_ADVISOR = {
    BusinessKnowledgeExpert: 'BusinessKnowledgeAdvisor',
    CodeProductModernizationExpert: 'CodeDomainAdvisor',
    CodeArchitectureExpert: 'CodeDomainAdvisor',
    CodeRebuildEngineer: 'CodeDomainAdvisor'
};
const assessmentSection = async () => {
    const { body } = await agent('Aro');
    const start = body.indexOf('## Project Assessment Coordination');
    const end = body.indexOf('## Pre-Blocker Dispatch Gate');
    assert.ok(start !== -1 && end > start, 'assessment section must exist');
    return body.slice(start, end);
};

test('default assessment runs the modernization chain in order through each required advisor', async () => {
    const { metadata, body } = await agent('Aro');
    const section = await assessmentSection();
    let previous = section.indexOf('ProjectAssessmentExpert');
    assert.ok(previous !== -1, 'P5 must dispatch ProjectAssessmentExpert first');
    for (const name of CHAIN) {
        const index = section.indexOf(name);
        assert.ok(index > previous, `${name} must follow the prior chain step`);
        previous = index;
        assert.ok(metadata.agents.includes(name), `Aro allowlist must include ${name}`);
        const row = new RegExp(`\\|[^\\n]*\\|\\s*${name}\\s*\\|\\s*${CHAIN_ADVISOR[name]}\\s*\\|`);
        assert.match(body, row, `Aro routing index must route ${name} through ${CHAIN_ADVISOR[name]}`);
    }
});

test('quick depth runs only on explicit user request and the full chain is the default', async () => {
    const section = await assessmentSection();
    assert.match(section, /Assessment depth: the default is the full chain/);
    assert.match(section, /only when the user explicitly asks/);
    assert.match(section, /list the omitted steps as not assessed/);
});

test('Aro chain payloads carry supplied outputs only and keep source access out of assessment mode', async () => {
    const section = await assessmentSection();
    assert.match(section, /Chain payloads carry only the outputs each step consumes/);
    assert.match(section, /Send the project-assessment procedure text retrieved at P5 verbatim/);
    assert.match(section, /do not retrieve procedures again for chain steps/);
    assert.match(section, /Chain workers do not read, search, or collect source material/);
    assert.match(section, /Aro reconciles conflicts across chain outputs and does not decide them/);
    assert.match(section, /only when the user authorizes further collection/);
});

test('chain workers keep their general tool lists and run in assessment mode with evidence-only boundaries', async () => {
    for (const name of CHAIN) {
        const { metadata, body } = await agent(name);
        assert.deepEqual(metadata.tools, ['read', 'search'], `${name}: general tool list must stay unchanged`);
        assert.deepEqual(metadata.agents, [], `${name}: must not delegate`);
        assert.equal(metadata['user-invocable'], false, `${name}: must not be user-invocable`);
        assert.match(body, /## Project Assessment Mode/, `${name}: must define assessment mode`);
        assert.match(body, /Do not read, search, or collect source material/, `${name}: must forbid source collection in assessment mode`);
        assert.match(body, /Do not write or persist files/, `${name}: must forbid writes in assessment mode`);
        assert.match(body, /Return gaps and missing inputs to Aro/, `${name}: must return gaps to Aro`);
        assert.match(body, /project-assessment procedure text Aro supplies/, `${name}: must apply the supplied assessment procedure`);
    }
});

test('chain workers and the expert define no fixed per-source maximum', async () => {
    for (const name of [...CHAIN, 'ProjectAssessmentExpert']) {
        assert.doesNotMatch(await read(`agents/${name}.agent.md`), FIXED_MAX, `${name}: must not define a fixed per-source maximum`);
    }
});

test('assessment skill defines the five-step default pipeline with evidence-only steps', async () => {
    const { body } = await load(SKILL);
    for (const name of ['ProjectAssessmentExpert', ...CHAIN]) {
        assert.match(body, new RegExp(name), `${name} must be a pipeline step`);
    }
    assert.match(body, /Every step consumes only the supplied evidence records and earlier step outputs/);
    assert.match(body, /No step reads or collects source material, writes files, or accepts decisions/);
});

test('scalability profile captures workload, data, recovery, budget, compliance, team, and compatibility fields', async () => {
    const { body } = await load(SKILL);
    for (const term of [/concurrency/i, /throughput/i, /data volume/i, /latency/i, /\bRTO\b/, /\bRPO\b/, /deployment/i, /budget/i, /compliance/i, /team size/i, /compatibility/i]) {
        assert.match(body, term, `profile must capture ${term}`);
    }
    assert.match(body, /`unknown`/, 'profile fields must allow unknown values');
});

test('unknown targets become explicit assumptions with scenario options and critical-only questions', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /explicit assumption/);
    assert.match(body, /scenario-based options/);
    assert.match(body, /conditions under which it holds/);
    assert.match(body, /Ask only for critical scope or access decisions/);
});

test('findings separate observed defects, risks, and unknowns and forbid arbitrary scores', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /observed defect/);
    assert.match(body, /\brisk\b/);
    assert.match(body, /an unknown/);
    assert.match(body, /Do not assign arbitrary scores/);
    assert.match(body, /Cite one or more `evidence_id` values/);
});

test('recommendations compare alternatives and define operability, rollback, measurable validation, and exit criteria', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /at least two viable alternatives/);
    assert.match(body, /operability burden/);
    assert.match(body, /rollback/);
    assert.match(body, /threshold/);
    assert.match(body, /phased exit criteria/);
});

test('scale and fashion guard blocks scale overclaims and unjustified stacks or microservices', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /No architecture is perfectly scalable independent of workload/);
    assert.match(body, /Do not recommend fashionable stacks/);
    assert.match(body, /microservices split unless/);
    assert.match(body, /Modern does not mean distributed/);
    const { body: expert } = await agent('ProjectAssessmentExpert');
    assert.match(expert, /Finding Quality/);
    assert.match(expert, /Scalability and Workload Profile/);
});

test('business analysis dispatches only on supplied business evidence and records NOT ASSESSED otherwise', async () => {
    const section = await assessmentSection();
    assert.match(section, /BusinessKnowledgeExpert via BusinessKnowledgeAdvisor, conditional/);
    assert.match(section, /dispatch only when supplied in-scope evidence or user-supplied context contains business policies, processes, requirements, data, or actor context/);
    assert.match(section, /skip the worker call, record business analysis as NOT ASSESSED with the exact missing source layers, and continue/);
    assert.match(section, /does not ask the user for a routine business inventory/);
    assert.match(section, /When step 1 is NOT ASSESSED, pass that record instead/);
    assert.match(section, /carrying any NOT ASSESSED record into its stated limitations/);
    const { body } = await load(SKILL);
    assert.match(body, /runs only when supplied in-scope evidence or user-supplied context contains business/);
    assert.match(body, /recorded as NOT ASSESSED with the exact missing source layers, and the chain continues/);
});

test('product modernization stays evidence-only when business analysis is skipped', async () => {
    const { body } = await agent('CodeProductModernizationExpert');
    assert.match(body, /When Aro records business analysis as NOT ASSESSED/);
    assert.match(body, /Do not invent stakeholder demand, user needs, or business value/);
    assert.match(body, /mark product and business opportunity conclusions as `UNKNOWN` or limited/);
});

test('assessment skill defines the decision-ready report contract parts', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /## Decision-Ready Report Contract/);
    for (const term of [/decision brief/i, /Root causes/, /Impact and ranking/, /Ranked recommendations/, /Transition state/, /Delivery and operating model/, /Phased roadmap/, /Experiments and acceptance criteria/, /What we cannot conclude/, /Next evidence/]) {
        assert.match(body, term, `contract must define ${term}`);
    }
    assert.match(body, /before its symptoms/, 'root causes must precede symptoms');
    assert.match(body, /Label each causal explanation `observed` or `inferred`/, 'causal claims must be labeled');
    assert.match(body, /least complex option/, 'recommendations must include the least complex option');
    assert.match(body, /transition architecture/);
    assert.match(body, /rollback path/);
    assert.match(body, /observable condition with its metric, threshold, and measurement method/);
});

test('report contract permits evidence-backed targets and forbids unsupported benchmark, cost, and ROI figures', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /Thresholds come from stated targets or are labeled `proposed`/);
    assert.match(body, /Estimates and ROI: omit unless supplied evidence supports them/);
    assert.match(body, /label each as an `estimate` or `proposed`/);
    assert.match(body, /Do not state ROI, payback, or savings without measured inputs/);
    assert.match(body, /Do not invent owners/);
    assert.match(body, /Do not supply a benchmark figure that the evidence does not contain/);
    assert.match(body, /Do not fabricate benchmark numbers, costs, compliance status, capacities, users, or owners/);
});

test('report quality contract requires scoped evidence, scenario records, scoped DORA metrics, and no superiority claims', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /## Report Quality Contract/);
    assert.match(body, /Completeness by scope: .*Claim completeness only for the declared scope/);
    assert.match(body, /Claim-to-evidence traceability: each claim cites `evidence_id` values/);
    assert.match(body, /## Quality-Attribute Scenario Record \(ATAM-inspired, not a full ATAM\)/);
    assert.match(body, /It is not a full ATAM evaluation/);
    assert.match(body, /`measurable_response` \| Metric, threshold, and measurement method/);
    assert.match(body, /A scenario without a measurable response is an unknown/);
    assert.match(body, /Scope each metric to one application or service/);
    assert.match(body, /source, time window, denominator, and definition version/);
    assert.match(body, /Do not compare teams or projects with these metrics/);
    assert.match(body, /Prohibited claims: do not write .*"best in market".*superiority claim/);
    assert.match(body, /No source in the Reference Basis verifies such a claim/);
});

test('quality lenses cover reliability, recovery, security, cost, performance, operations, and conditional sustainability', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /## Quality Lenses/);
    for (const lens of [/Reliability and resilience:/, /Recovery:/, /Security:/, /Cost optimization and financial limits:/, /Performance:/, /Operational excellence:/, /Sustainability:[^\n]*only when/]) {
        assert.match(body, lens, `quality lens must cover ${lens}`);
    }
    assert.match(body, /Otherwise record NOT ASSESSED/);
});

test('migration disposition defines the researched dispositions, one-per-workload rule, and UNKNOWN fallback', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /## Migration Disposition/);
    for (const disposition of ['Retire', 'Retain', 'Rehost', 'Replatform', 'Refactor', 'Rearchitect', 'Rebuild', 'Replace']) {
        assert.match(body, new RegExp(`\\|\\s*${disposition}\\s*\\|`), `${disposition} row must be defined`);
    }
    assert.match(body, /Exactly one disposition per workload row/);
    assert.match(body, /`UNKNOWN`/);
    assert.match(body, /NOT ASSESSED/);
    assert.match(body, /business driver/);
    assert.match(body, /key indicator/);
    assert.match(body, /alternative/);
    assert.match(body, /dependencies/);
    assert.match(body, /not a mechanical label/);
});

test('cost lifecycle is iterative and forbids invented values, savings, or ROI', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /## Cost Lifecycle/);
    assert.match(body, /Cost is iterative/);
    for (const stage of [/[Cc]urrent baseline/, /[Mm]igration and investment cost/, /[Ee]xpected target run cost/, /[Oo]ptimize and operate/, /remeasure/]) {
        assert.match(body, stage, `cost stage ${stage} must be defined`);
    }
    assert.match(body, /Do not invent cost values, savings, or ROI/);
});

test('reference basis cites the two read Microsoft sources with caveats and marks optional sources snippet-only', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /## Reference Basis/);
    assert.match(body, /https:\/\/learn\.microsoft\.com\/en-us\/azure\/well-architected\/pillars/);
    assert.match(body, /https:\/\/learn\.microsoft\.com\/en-us\/azure\/cloud-adoption-framework\/plan\/select-cloud-migration-strategy/);
    assert.ok(body.split('Read in full').length - 1 >= 2, 'both Microsoft sources must be marked read in full');
    assert.match(body, /vendor-specific/);
    assert.match(body, /not endorsements or a universal standard/);
    assert.match(body, /`snippet-only, not independently verified`/);
    for (const optional of ['https://aws.amazon.com/architecture/well-architected/', 'https://docs.cloud.google.com/architecture/framework/performance-optimization', 'https://www.finops.org/framework/phases/']) {
        assert.ok(body.includes(optional), `${optional} must be listed as optional reading`);
    }
    assert.match(body, /Do not rely on their detailed content as requirements/);
    assert.match(body, /Excluded: ISO 25010/);
});

const PROCESS_STAGES = [
    'Scope and Intake',
    'Ingestion and Discovery',
    'Normalize and Validate',
    'Dependency Discovery and Validation',
    'Cross-Source Findings',
    'Per-Workload Disposition',
    'Prioritize and Sequence Waves',
    'Report, Read-Back, and Validation'
];
const REPORT_PACKAGE = [
    'README.md',
    'assessment-method-and-data.md',
    'workload-portfolio.md',
    'dependency-analysis.md',
    'business-requirements.md',
    'architecture-c4.md',
    'code-doc-consistency.md',
    'project-management.md',
    'prioritized-findings.md',
    'options-and-business-case.md',
    'target-state.md',
    'migration-roadmap.md',
    'validation-log.md'
];
const sectionBetween = (text, startHeading, endHeading) => {
    const start = text.indexOf(startHeading);
    assert.ok(start >= 0, `${startHeading} must exist`);
    const end = text.indexOf(endHeading, start + startHeading.length);
    assert.ok(end > start, `${endHeading} must follow ${startHeading}`);
    return text.slice(start, end);
};

test('assessment process runs its eight stages in order before the report', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /## Assessment Process/);
    assert.match(body, /Run these stages in order/);
    const positions = PROCESS_STAGES.map(stage => body.indexOf(`### ${stage}`));
    positions.forEach((position, index) => assert.ok(position >= 0, `stage "${PROCESS_STAGES[index]}" must be defined`));
    for (let index = 1; index < positions.length; index++) {
        assert.ok(positions[index] > positions[index - 1], `stage "${PROCESS_STAGES[index]}" must follow "${PROCESS_STAGES[index - 1]}"`);
    }
});

test('ingestion modes define canonical capability limits and source-specific labels', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /## Ingestion Modes and Capabilities/);
    for (const mode of ['live-connector', 'continuous-appliance', 'one-time-snapshot-export', 'file-cmdb-import', 'manual-user-supplied', 'local-read-search', 'UNKNOWN']) {
        assert.ok(body.includes(`\`${mode}\``), `canonical retrieval mode ${mode} must be defined`);
    }
    for (const label of ['automated-discovery', 'offline-snapshot', 'file-import', 'mapped-export-reviewed', 'local-read']) {
        assert.ok(body.includes(`\`${label}\``), `source-specific mode_label ${label} must be distinguished`);
    }
    assert.match(body, /A `file-cmdb-import` supports only lift-and-shift/);
    assert.match(body, /No assessment claim may exceed the capability coverage/);
    assert.match(body, /Do not assume a capability that is not recorded/);
});

test('lineage and coverage rules require provenance, denominators, and missing-field gaps', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /`evidence_id`.*`batch_id`.*`source`.*`coverage`/);
    assert.match(body, /evidence record's `batch_id`.*collection-batch manifest/);
    assert.match(body, /Summarize mode and capability in reports by joining evidence records to manifests through `batch_id`/);
    assert.doesNotMatch(body, /`evidence_id`, `retrieval_mode`|dependency.*`retrieval_mode`/i);
    assert.match(body, /Record the point-in-time or version of each source/);
    assert.match(body, /Record coverage against a declared denominator, or `UNKNOWN`/);
    assert.match(body, /A missing field is a gap, never a zero/);
    assert.match(body, /Keep duplicates and conflicting records visible/);
});

test('dependency validation requires owner or architecture review before a dependency is validated', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /## Dependency Discovery and Validation|### Dependency Discovery and Validation/);
    assert.match(body, /Automated discovery can miss undocumented dependencies/);
    assert.match(body, /Mark a dependency `validated` only after an owner or architecture review confirms it/);
    assert.match(body, /Otherwise mark it `unvalidated`/);
    assert.match(body, /A dependency from a mode without dependency capability is `UNKNOWN`, not absent/);
});

test('wave planning groups dependent systems and keeps unvalidated dependencies out of waves without a risk', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /Group dependent systems into the same wave/);
    assert.match(body, /Detail the near-term wave with its dependencies, entry and exit gates, and rollback path/);
    assert.match(body, /Keep later waves higher-level and mark them `proposed`/);
    assert.match(body, /Do not place an unvalidated dependency in a wave without a stated risk and a validation step/);
});

test('numeric performance metrics are allowed when sourced rather than blanket-banned', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /Numeric performance metrics[^\n]*are allowed when the evidence contains them/);
    assert.match(body, /with source and time window/);
    assert.doesNotMatch(body, /no numeric performance metrics|never use numeric performance/i);
});

test('report package reserves tool outputs as labeled source artifacts, not the narrative report', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /Tool-generated outputs:/);
    assert.match(body, /Azure Migrate assessments/);
    assert.match(body, /They are not this project's narrative report/);
});

const INGESTION = 'skills/project-evidence-ingestion/SKILL.md';
const MODES = ['live-connector', 'continuous-appliance', 'one-time-snapshot-export', 'file-cmdb-import', 'manual-user-supplied', 'local-read-search', 'UNKNOWN'];
const CAPABILITIES = ['performance_metrics', 'dependency_analysis', 'configuration_inventory', 'identity_security', 'content_revision_history'];
const CAPABILITY_STATES = ['collected', 'not_collected', 'unsupported', 'unknown', 'not_applicable'];
const REMOTE_COLLECTORS = COLLECTORS.filter(name => name !== 'ProjectEvidenceLocalRepoCollector');

test('ingestion contract defines the collection-batch manifest, canonical modes, and capability states', async () => {
    const { body } = await load(INGESTION);
    assert.match(body, /## Collection-Batch Manifest/);
    for (const field of ['batch_id', 'intended_retrieval_mode', 'actual_retrieval_mode', 'mode_label', 'mode_proof', 'capability_coverage']) {
        assert.ok(body.includes(`\`${field}\``), `manifest field ${field} must be defined`);
    }
    for (const mode of MODES) assert.ok(body.includes(`\`${mode}\``), `retrieval mode ${mode} must be defined`);
    for (const capability of CAPABILITIES) assert.ok(body.includes(`\`${capability}\``), `capability ${capability} must be defined`);
    for (const state of CAPABILITY_STATES) assert.ok(body.includes(`\`${state}\``), `capability state ${state} must be defined`);
    assert.match(body, /Intended and actual modes are separate/);
    assert.match(body, /Never copy the intended mode into the actual mode/);
});

test('project-assessment mode labels map to the canonical vocabulary in the ingestion contract', async () => {
    const { body } = await load(INGESTION);
    for (const label of ['automated-discovery', 'offline-snapshot', 'file-import', 'mapped-export-reviewed', 'live-collector', 'local-read']) {
        assert.ok(body.includes(`\`${label}\``), `project-assessment label ${label} must be mapped`);
    }
});

test('evidence records link to the manifest by batch_id and never repeat retrieval mode or capability fields', async () => {
    const { body } = await load(INGESTION);
    const record = sectionBetween(body, '## Evidence Record', '## Coverage Rules');
    assert.match(record, /\| `batch_id` \|/, 'Evidence Record must carry batch_id');
    assert.doesNotMatch(record, /retrieval_mode|capability|actual_retrieval_mode/, 'Evidence Record must not repeat mode or capability fields');
});

test('blocked batches keep actual mode UNKNOWN and BLOCKED status in the contract and every remote collector', async () => {
    const { body } = await load(INGESTION);
    assert.match(body, /sets `actual_retrieval_mode` to `UNKNOWN` and `batch_status` to `BLOCKED`/);
    assert.match(body, /A difference is recorded as a gap, not silently replaced/);
    for (const name of REMOTE_COLLECTORS) {
        const { metadata, body: collector } = await agent(name);
        assert.deepEqual(metadata.tools, [], `${name}: no tools may be bound by the manifest update`);
        assert.match(collector, /`actual_retrieval_mode`: `UNKNOWN` while no tool is bound, so the batch stays `BLOCKED`/, `${name}: blocked actual mode must be UNKNOWN`);
        assert.match(collector, /Do not copy the intended mode into it/, `${name}: must forbid copying intended mode`);
    }
});

test('local collector declares local-read-search as actual mode and links its manifest by batch_id', async () => {
    const { metadata, body } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.deepEqual(metadata.tools, ['read', 'search'], 'local collector tool list must stay unchanged');
    assert.match(body, /`actual_retrieval_mode`: `local-read-search` when the P1 preflight passes/);
    assert.match(body, /`UNKNOWN` when it returns `BLOCKED` or `ERROR` before any read/);
    assert.match(body, /Each record carries its `batch_id`/);
});

test('every collector outputs a collection-batch manifest with modes, all capability keys, and manifest in Output', async () => {
    for (const name of COLLECTORS) {
        const { body } = await agent(name);
        assert.equal(body.split('## Collection-Batch Manifest').length - 1, 1, `${name}: must have exactly one manifest section`);
        assert.match(body, /`intended_retrieval_mode`: the mode from Aro's P0 source plan/, `${name}: intended mode must come from P0`);
        for (const field of ['batch_id', 'actual_retrieval_mode', 'capability_coverage']) {
            assert.ok(body.includes(`\`${field}\``), `${name}: must reference ${field}`);
        }
        for (const capability of CAPABILITIES) {
            assert.ok(body.includes(`\`${capability}\``), `${name}: must disclose ${capability}`);
        }
        const output = body.slice(body.indexOf('## Output'));
        assert.match(output, /collection-batch manifest/, `${name}: Output must return the manifest`);
    }
});

test('the contract bars assessment claims beyond batch capability and treats imports as scope-limited', async () => {
    const { body } = await load(INGESTION);
    assert.match(body, /Assessment workers must not make claims beyond the capability states of the batch/);
    assert.match(body, /is not evidence that the underlying source inventory is complete/);
    assert.match(body, /Numeric values such as CPU, memory, latency, or throughput are allowed when the batch collected them/);
    assert.match(body, /A capability with no entry is `unknown`, never `collected`/);
});

test('collector tool lists and remote no-tool boundaries are unchanged by the manifest update', async () => {
    for (const name of REMOTE_COLLECTORS) {
        const { metadata } = await agent(name);
        assert.deepEqual(metadata.tools, [], `${name}: remote collector must keep tools: []`);
        assert.deepEqual(metadata.agents, [], `${name}: must not delegate`);
    }
    const { metadata } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.deepEqual(metadata.tools, ['read', 'search'], 'local collector keeps read and search only');
});

test('Aro P6-P8 keep report contents complete and require explicit save consent', async () => {
    const { body } = await agent('Aro');
    assert.match(body, /P6 drafts the complete project-assessment Report Package/);
    assert.match(body, /every package filename becomes an actual document/);
    assert.match(body, /P7 runs only after explicit user authorization to save/);
    assert.match(body, /A plain assessment request is not write consent/);
    assert.match(body, /P8 is the single consolidated delivery/);
    assert.match(body, /If P7 was not authorized, include the full contents of every P6 package document/);
    assert.match(body, /an executive summary is not a substitute/);
});

test('collector completeness rejects unreadable results and compact output retains canonical records', async () => {
    const { body: aro } = await agent('Aro');
    assert.match(aro, /If a collector result is externalized, unreadable, truncated, or otherwise not retrievable as complete records/);
    assert.match(aro, /never proceed as if the full evidence was received/);
    assert.match(aro, /continuation dispatch/);
    assert.match(aro, /clearly mark `page` and `final_page`/);
    assert.match(aro, /must not omit required record fields or abbreviate IDs/);
    assert.match(aro, /stop project-specific P5 analysis and the downstream chain/);

    const { body: local } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.match(local, /compact but complete collection-batch manifest and the complete normalized evidence records/);
    assert.match(local, /Every record must include every canonical field in full/);
    assert.match(local, /Do not abbreviate IDs, omit required fields/);
    assert.match(local, /If a continuation dispatch is requested, return only a clearly bounded page/);
    assert.match(local, /same `batch_id`, `run_id`, and `scope_id`/);
    assert.match(local, /If that page would still externalize or be unreadable, return `PARTIAL` or `UNKNOWN`/);
});

test('ingestion records have standalone identity fields and canonical decode-once evidence IDs', async () => {
    const { body } = await load(INGESTION);
    const record = sectionBetween(body, '## Evidence Record', '## Coverage Rules');
    for (const field of ['container', 'native_id', 'locator']) {
        assert.ok(record.includes(`| \`${field}\` |`), `Evidence Record must contain standalone ${field}`);
    }
    assert.match(body, /Percent-encode each variable component/);
    assert.match(body, /encode every other byte as uppercase `%HH`/);
    assert.match(body, /Leave only RFC 3986 unreserved ASCII/);
    assert.match(body, /Percent-decode each segment once/);
    assert.match(body, /Re-encode the decoded fields by the canonical rules/);
    assert.match(body, /The result must equal the input string exactly/);

    const { body: expert } = await agent('ProjectAssessmentExpert');
    assert.match(expert, /Percent-decode each segment exactly once/);
    assert.match(expert, /canonical uppercase percent-encoding must equal the original `evidence_id` exactly/);
    assert.match(expert, /evidence-ID compliance as `PASS` only when every in-scope evidence ID belongs to an available full record/);
});
