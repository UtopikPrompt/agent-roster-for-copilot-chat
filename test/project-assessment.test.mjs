import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { parseCustomization, root } from '../scripts/validate.mjs';

const read = relative => readFile(path.join(root, relative), 'utf8');
const load = async relative => parseCustomization(await read(relative), relative);
const agent = name => load(`agents/${name}.agent.md`);

const READ_VERB = /(^|[_/])(list|search|get|get_schema|search_paths|fetch|retrieve|read)(?=_|$)/;
const APPROVED_CAMEL_READ_OPERATIONS = new Set([
    'checkOperationStatus',
    'findFileOrFolder',
    'findSite',
    'getDefaultDocumentLibraryInSite',
    'getFileOrFolderMetadata',
    'getFileOrFolderMetadataByUrl',
    'getFolderChildren',
    'getForThrottlingTesting',
    'getSensitivityLabels',
    'listDocumentLibrariesInSite',
    'readSmallBinaryFile',
    'readSmallTextFile'
]);
const isReadTool = tool => READ_VERB.test(tool) || APPROVED_CAMEL_READ_OPERATIONS.has(tool.slice(tool.lastIndexOf('/') + 1));
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
const ADO_READ_TOOLS = [
    'ado-remote-mcp/core_list_orgs',
    'ado-remote-mcp/core_list_projects',
    'ado-remote-mcp/core_list_project_teams',
    'ado-remote-mcp/core_list_group_members',
    'ado-remote-mcp/work',
    'ado-remote-mcp/repo_pull_request',
    'ado-remote-mcp/repo_pull_request_thread',
    'ado-remote-mcp/repo_repository',
    'ado-remote-mcp/repo_branch',
    'ado-remote-mcp/repo_file',
    'ado-remote-mcp/repo_search_commits',
    'ado-remote-mcp/search_code',
    'ado-remote-mcp/wit_work_item',
    'ado-remote-mcp/wit_query',
    'ado-remote-mcp/wit_query_by_wiql',
    'ado-remote-mcp/wit_backlog',
    'ado-remote-mcp/wit_work_item_attachment',
    'ado-remote-mcp/search_workitem',
    'ado-remote-mcp/pipelines_build',
    'ado-remote-mcp/pipelines_build_log',
    'ado-remote-mcp/pipelines_definition',
    'ado-remote-mcp/pipelines_run',
    'ado-remote-mcp/pipelines_artifact',
    'ado-remote-mcp/wiki',
    'ado-remote-mcp/search_wiki',
    'ado-remote-mcp/testplan',
    'ado-remote-mcp/testplan_show_test_results_from_build_id',
    'ado-remote-mcp/testplan_test_run',
    'ado-remote-mcp/advsec_alerts'
];
const ADO_DIRECT_READ_TOOLS = [
    'ado-remote-mcp/core_list_orgs',
    'ado-remote-mcp/core_list_projects',
    'ado-remote-mcp/core_list_project_teams',
    'ado-remote-mcp/core_list_group_members',
    'ado-remote-mcp/repo_search_commits',
    'ado-remote-mcp/search_code',
    'ado-remote-mcp/search_workitem',
    'ado-remote-mcp/search_wiki'
];
const ADO_GROUPED_READ_TOOLS = ADO_READ_TOOLS.filter(tool => !ADO_DIRECT_READ_TOOLS.includes(tool));
// The ADO collector's only non-read entry: one workspace-only, user-confirmed evidence batch write.
const ADO_EVIDENCE_WRITE_TOOL = 'aro_write_evidence_batch';
const ADO_COLLECTOR_TOOLS = [...ADO_READ_TOOLS, ADO_EVIDENCE_WRITE_TOOL];
const ODSP_READ_TOOLS = [
    'onedrive-sharepoint/findFileOrFolder',
    'onedrive-sharepoint/findSite',
    'onedrive-sharepoint/getDefaultDocumentLibraryInSite',
    'onedrive-sharepoint/getFileOrFolderMetadata',
    'onedrive-sharepoint/getFileOrFolderMetadataByUrl',
    'onedrive-sharepoint/getFolderChildren',
    'onedrive-sharepoint/listDocumentLibrariesInSite',
    'onedrive-sharepoint/readSmallTextFile'
];
const SHAREPOINT_READ_TOOLS = [
    'onedrive-sharepoint/checkOperationStatus',
    'onedrive-sharepoint/findFileOrFolder',
    'onedrive-sharepoint/findSite',
    'onedrive-sharepoint/getDefaultDocumentLibraryInSite',
    'onedrive-sharepoint/getFileOrFolderMetadata',
    'onedrive-sharepoint/getFileOrFolderMetadataByUrl',
    'onedrive-sharepoint/getFolderChildren',
    'onedrive-sharepoint/getForThrottlingTesting',
    'onedrive-sharepoint/getSensitivityLabels',
    'onedrive-sharepoint/listDocumentLibrariesInSite',
    'onedrive-sharepoint/readSmallBinaryFile',
    'onedrive-sharepoint/readSmallTextFile'
];
const ADO_MUTATION_OPERATIONS = /create|update|delete|queue|approve|merge|cancel|link|run|do_action|call_function/i;
const ADO_PREFixed_PLACEHOLDER = /^mcp_|^ado[_]remote|mcp_azuredevops/i;
const ADO_RESULT_CAP = /\b(?:top|maxResults|max results|result cap|item cap|page cap|page limit|result limit|item limit)\b\s*[=:]?\s*\d+|\b(?:one|a single|single)[ -]continuation\b|\bat most one\b|\b(?:first|one) page only\b|\bonly the first page\b|\bfixed (?:item|result|page) (?:count|limit|maximum)\b/i;
const FIXED_MAX = /(?:max(?:imum)?|cap|limit)\s+(?:of\s+)?\d+\s+(?:items?|records?|documents?|results?|pages?|files?)/i;

// Fixture flags describe a trace; no runtime parser exists, so the expected outcome is checked against documented text.
const ADO_TRACE_CASES = [
    { name: 'exact tools exposed, invoked, canonical records delivered', toolExposed: true, invoked: true, canonical: true, outcome: 'P5_ELIGIBLE' },
    { name: 'exact tool not exposed by runtime', toolExposed: false, invoked: false, canonical: false, outcome: 'TOOL_ABSENT' },
    { name: 'exact tools invoked, output noncanonical', toolExposed: true, invoked: true, canonical: false, outcome: 'DATA_FORMAT' }
];
const ADO_OUTCOME_CONTRACT = {
    P5_ELIGIBLE: { collector: /every evidence record must carry every canonical field and full `evidence_id`/ },
    TOOL_ABSENT: { collector: /Tool absent: `BLOCKED`/ },
    DATA_FORMAT: { collector: /label this a `DATA_FORMAT`\/coverage issue, not a missing-tool or `Tool absent` result/ }
};
const adoTraceOutcome = ({ toolExposed, invoked, canonical }) => {
    if (!toolExposed) return 'TOOL_ABSENT';
    if (!invoked) return 'UNMODELED';
    return canonical ? 'P5_ELIGIBLE' : 'DATA_FORMAT';
};

test('ADO trace fixtures map to three distinct outcomes documented in the collector', async () => {
    const { body: collector } = await agent('ProjectEvidenceAzureDevOpsCollector');
    const outcomes = new Set();
    for (const testCase of ADO_TRACE_CASES) {
        const outcome = adoTraceOutcome(testCase);
        assert.equal(outcome, testCase.outcome, `${testCase.name}: fixture must classify as ${testCase.outcome}`);
        outcomes.add(outcome);
        const contract = ADO_OUTCOME_CONTRACT[outcome];
        if (contract.collector) assert.match(collector, contract.collector, `${testCase.name}: collector must document ${outcome}`);
    }
    assert.equal(outcomes.size, 3, 'fixtures must cover three distinct outcomes');
});

test('ADO bindings use exact ado-remote-mcp names and reject placeholders, wildcards, and mutations', async () => {
    const { metadata, body } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.deepEqual(metadata.tools, ADO_COLLECTOR_TOOLS);
    for (const tool of metadata.tools.filter(entry => entry !== ADO_EVIDENCE_WRITE_TOOL)) {
        assert.match(tool, /^ado-remote-mcp\/[^/*]+$/);
        assert.doesNotMatch(tool, ADO_PREFixed_PLACEHOLDER);
    }
    for (const tool of ADO_DIRECT_READ_TOOLS) {
        assert.ok(isReadTool(tool), `${tool} must carry a read verb`);
        assert.doesNotMatch(tool.slice('ado-remote-mcp/'.length), ADO_MUTATION_OPERATIONS);
    }
    assert.match(body, /Grouped tools that take an action or method parameter are bound but gated/);
    assert.doesNotMatch(body, /mcp_azuredevops[^`\s]*|ado_remote[^`\s]*|[^`]*\/\*/);
    assert.match(body, /Repository inventory requires a schema-verified read-only `ado-remote-mcp\/repo_repository` action/);
    assert.match(body, /Repository file reads require verified `ado-remote-mcp\/repo_file`/);
    assert.doesNotMatch(body, /remain excluded|Excluded because action or schema ambiguity is unresolved/);
    assert.match(body, /DATA_FORMAT`\/coverage issue/);
});

test('ADO collector validates projects first and bounds searches instead of inventing inventory', async () => {
    const { body } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.match(body, /call `ado-remote-mcp\/core_list_projects` once and match the actual response exactly/);
    assert.match(body, /Identity check:[^\n]*match the actual response exactly/);
    assert.match(body, /do not treat searches or project-name text as validation/);
    assert.match(body, /Use `ado-remote-mcp\/core_list_project_teams` for teams when requested and valid/);
    assert.match(body, /Repository inventory requires a schema-verified read-only `ado-remote-mcp\/repo_repository` action/);
    assert.match(body, /Use schema-provided page-size and continuation parameters only/);
    assert.match(body, /Record exact category scope, query, page\/offset or continuation state, result count, exhaustion evidence, and stop reason/);
    assert.match(body, /Convergence is a stop state, not completeness/);
});

test('ADO identity check accepts an actually invoked runtime alias only with exact org/project match', async () => {
    const { metadata, body } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.ok(metadata.tools.includes('ado-remote-mcp/core_list_projects'), 'canonical core_list_projects must remain allowlisted');
    assert.match(body, /Runtime alias: if the runtime actually invokes a differently named tool ID on the same `ado-remote-mcp` server for this same read operation/);
    assert.match(body, /Never derive aliases by string transformation or resemblance/);
    assert.match(body, /Record the server, the actual tool ID, and the returned organization and project as provenance/);
    assert.match(body, /returned organization and project exactly match the user-supplied scope/);
    assert.match(body, /organization\/project mismatch blocks only the affected scope/);
});

test('collector tool lists are read-only allowlists without wildcards or mutation names', async () => {
    for (const name of COLLECTORS) {
        const { metadata } = await agent(name);
        assert.ok(Array.isArray(metadata.tools), `${name}: tools must be an explicit list`);
        for (const tool of metadata.tools) {
            assert.doesNotMatch(tool, MUTATION, `${name}: ${tool} must not be a mutation or excluded tool`);
            if (tool === ADO_EVIDENCE_WRITE_TOOL) {
                assert.equal(name, 'ProjectEvidenceAzureDevOpsCollector', `${tool} may be bound only to the ADO collector`);
                continue;
            }
            if (name === 'ProjectEvidenceAzureDevOpsCollector' && ADO_GROUPED_READ_TOOLS.includes(tool)) continue;
            assert.ok(isReadTool(tool), `${name}: ${tool} must carry a read verb`);
        }
    }
});

test('read-operation classifier accepts approved camelCase ODSP reads and rejects unapproved camelCase names', () => {
    for (const tool of ODSP_READ_TOOLS) assert.ok(isReadTool(tool), `${tool} must be an approved read operation`);
    for (const tool of SHAREPOINT_READ_TOOLS) assert.ok(isReadTool(tool), `${tool} must be an approved read operation`);
    assert.equal(isReadTool('onedrive-sharepoint/getForThrottlingTesting'), true);
    assert.equal(isReadTool('onedrive-sharepoint/getSensitivityLabels'), true);
    assert.equal(isReadTool('onedrive-sharepoint/createFolder'), false);
    assert.equal(isReadTool('onedrive-sharepoint/setSensitivityLabelOnFile'), false);
    assert.equal(isReadTool('onedrive-sharepoint/getSiteByPath'), false);
});

test('SharePoint exact-target resolution and tenant discovery policy are separated', async () => {
    const { metadata, body } = await agent('ProjectEvidenceSharePointCollector');
    assert.deepEqual(metadata.tools, SHAREPOINT_READ_TOOLS, 'ProjectEvidenceSharePointCollector: exact SharePoint read allowlist must remain');
    assert.match(body, /Runtime aliases: for an operation in this agent's canonical read-only `tools:` allowlist/);
    assert.match(body, /accept a differently named operation only when this collector invocation's own bound tool inventory exposes its actual ID/);
    assert.match(body, /the MCP server identity plus readable schema or description unambiguously identify the same operation/);
    assert.match(body, /Invoke it using that actual exposed ID/);
    assert.match(body, /Never derive aliases by string transformation/);
    assert.match(body, /Aro\/main-session availability/);
    assert.match(body, /`\.mcp\.json`/);
    assert.match(body, /screenshots/);
    assert.match(body, /previous calls/);
    assert.match(body, /user claims as proof/);
    assert.match(body, /Do not expand the canonical allowlist/);
    assert.match(body, /all mutation operations remain prohibited/);
    assert.match(body, /Apply every safeguard for the canonical operation unchanged/);
    assert.match(body, /If no verified canonical ID or alias exists in this collector's own runtime, report `BLOCKED` for that operation/);
    assert.match(body, /Only when the user explicitly asks to test a named site and supplies the exact site display name/);
    assert.match(body, /explicit user-authorization evidence for this exact-name lookup must be present/i);
    assert.match(body, /If authorized and the readable runtime schema confirms a `searchQuery` argument is supported/i);
    assert.match(body, /make one call `onedrive-sharepoint\/findSite\(\{searchQuery: exact_name_from_input\}\)`/i);
    assert.match(body, /Do not call it with no arguments for this lookup/i);
    assert.match(body, /Tenant-wide discovery: allowed only when Aro supplies explicit evidence that the user separately authorized tenant-wide site discovery/i);
    assert.doesNotMatch(body, /(?:findSite|targeted lookup)[^\n]*(?:is prohibited|is banned|must not be called|may not be called|cannot be called)/i);
    assert.doesNotMatch(body, /(?:is prohibited|is banned|must not be called|may not be called|cannot be called)[^\n]*(?:findSite|targeted lookup)/i);
    assert.match(body, /Exact-target resolution: when Aro supplies an exact site URL or exact site identifier/);
    assert.match(body, /with exactly that URL or identifier as `searchQuery` solely to resolve or verify that target/);
    assert.match(body, /A zero-result response is `EMPTY`\/`NOT_FOUND` for that exact query/);
    assert.match(body, /Do not broaden or widen the value, add wildcards, use project\/team-name approximations, enumerate other sites/);
    assert.match(body, /Exact site-name resolution: when Aro supplies an exact site display name but no exact site URL or site identifier/);
    assert.match(body, /`?onedrive-sharepoint\/findSite`?\(\{searchQuery:\s*exact_name_from_(?:runtime_)?input\}\)/i);
    assert.doesNotMatch(body, /(?:searchQuery|siteId)\s*[:=]\s*(?:['"][^'"]+['"]|<[^>]+>|default(?:Site)?|displayName|siteName)/i);
    assert.doesNotMatch(body, /(?:searchQuery|query)[^\n]*\*/i);
    assert.match(body, /Accept only a complete, readable response with exactly one record whose display name exactly equals the supplied name and whose canonical site ID is present/);
    assert.match(body, /If the response is empty, unreadable, ambiguous, or missing the canonical ID/);
    assert.match(body, /report `EMPTY`\/`NOT_FOUND` as no match for that exact query only/i);
    assert.match(body, /Use only that record's canonical site ID for downstream calls/);
    assert.match(body, /Make no downstream library or file reads unless these gates pass/);
    assert.match(body, /Expose only the matching target record to downstream collection, never the whole inventory/i);
    assert.doesNotMatch(body, /(?:searchQuery|siteId)\s*[:=]\s*(?:displayName|display name|siteName|site name)/i);
    assert.match(body, /Without both, do not call `findSite` for discovery or use a broad query/);
    assert.match(body, /`tenant_site_discovery_authorized: true` and the user-authorization evidence must be present together/);
    assert.match(body, /call `onedrive-sharepoint\/findSite` only when the runtime operation schema confirms `searchQuery` is optional and may be omitted/);
    assert.match(body, /Call it with no `searchQuery` argument/);
    assert.match(body, /Discovery output is limited to site identifiers and URLs/);
    assert.match(body, /Never follow discovery hits with file\/folder tools, folder enumeration, document-library listing, or content reads/);
    for (const tool of metadata.tools) {
        assert.doesNotMatch(tool, MUTATION, `${tool} must not be a write operation`);
        assert.match(tool, /^onedrive-sharepoint\/[^/*]+$/);
    }
});

test('unbound source collectors fail closed while read-only collectors have exact allowlists', async () => {
    const sharePoint = await agent('ProjectEvidenceSharePointCollector');
    assert.deepEqual(sharePoint.metadata.tools, SHAREPOINT_READ_TOOLS, 'ProjectEvidenceSharePointCollector: exact SharePoint read allowlist must remain');
    const gitHub = await agent('ProjectEvidenceGitHubCollector');
    assert.deepEqual(gitHub.metadata.tools, [], 'ProjectEvidenceGitHubCollector: must have no tools bound until debug verification');
    assert.match(gitHub.body, /debug/i, 'ProjectEvidenceGitHubCollector: must state that debug verification is required');
    const m365 = await agent('ProjectEvidenceM365Collector');
    assert.deepEqual(m365.metadata.tools, ODSP_READ_TOOLS, 'ProjectEvidenceM365Collector: exact ODSP read allowlist must remain');
    assert.match(m365.body, /read-only OneDrive evidence/i, 'ProjectEvidenceM365Collector: must clearly own OneDrive only');
    assert.match(m365.body, /Out of scope: SharePoint/i, 'ProjectEvidenceM365Collector: SharePoint must remain explicitly out of scope');
    assert.match(m365.body, /not guaranteed by these tool schemas.*shared-operation names.*may be capable of addressing SharePoint/is, 'ProjectEvidenceM365Collector: must disclose the generic ODSP tool limitation');
    const ado = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.deepEqual(ado.metadata.tools, ADO_COLLECTOR_TOOLS, 'ADO collector must bind only its exact read tools plus the evidence batch write');
    const local = await agent('ProjectEvidenceLocalRepoCollector');
    assert.deepEqual(local.metadata.tools, ['read', 'search', 'aro_read_prior_assessment_store'], 'local repo collector exposes the exact prior-store tool');
});

test('SharePoint checkOperationStatus is bound only as read-only status lookup', async () => {
    const { body } = await agent('ProjectEvidenceSharePointCollector');
    assert.match(body, /`onedrive-sharepoint\/checkOperationStatus` is bound for read-only status lookup only/);
    assert.match(body, /Never use it to resume, retry, cancel, or complete a copy, move, upload, or other write/);
    assert.doesNotMatch(body, /Explicitly excluded, never call even if listed:[^\n]*checkOperationStatus/);
});

test('ADO grouped tools are bound but gated by P1-verified read-only actions', async () => {
    const { metadata, body } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.equal(new Set([...ADO_DIRECT_READ_TOOLS, ...ADO_GROUPED_READ_TOOLS]).size, metadata.tools.length - 1, 'read coverage excludes only the evidence batch write');
    assert.match(body, /For grouped\/mixed tools, inspect the schema and use only a read enum explicitly confirmed by that schema/);
    assert.match(body, /unverified action remains `BLOCKED`|Create, update, delete, run, queue, approve, merge, cancel, link/);
    assert.match(body, /A category is collected independently/);
});

test('repository tools are gated like other grouped ADO tools, not excluded', async () => {
    const { metadata, body } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.ok(metadata.tools.includes('ado-remote-mcp/repo_repository'));
    assert.ok(metadata.tools.includes('ado-remote-mcp/repo_file'));
    assert.match(body, /Repository inventory requires a schema-verified read-only `ado-remote-mcp\/repo_repository` action/);
    assert.match(body, /Repository file reads require verified `repo_file`/);
    assert.doesNotMatch(body, /remain excluded|never called for collection|neither tool is called for collection/);
    assert.match(body, /commit hits alone do not establish repository inventory/);
});

test('named grouped ADO categories route through the advisor to the collector; operations stay NO_MATCH', async () => {
    const { body: advisor } = await agent('ProjectAssessmentAdvisor');
    assert.match(advisor, /Grouped categories \(repositories, repository files, branches, pull requests/);
    assert.match(advisor, /explicitly named in the assessment scope also select ProjectEvidenceAzureDevOpsCollector/);
    assert.match(advisor, /do not return NO_MATCH for them/);
    assert.doesNotMatch(advisor, /Ambiguous grouped categories|are excluded, so return NO_MATCH/);
    assert.match(advisor, /Azure DevOps or GitHub operations that change state[^\n]*-> NO_MATCH/);

});

test('stale never-called repository wording is removed from README and docs', async () => {
    for (const file of ['README.md', 'docs/agents.md', 'docs/maintenance.md']) {
        const text = await readFile(path.join(root, file), 'utf8');
        assert.doesNotMatch(text, /never called for collection/, `${file}: stale repository exclusion wording`);
    }
});

test('M365 and SharePoint source routing keeps OneDrive and SharePoint ownership distinct', async () => {
    const { body: advisor } = await agent('ProjectAssessmentAdvisor');
    assert.match(advisor, /OneDrive files, folders, or item metadata -> ProjectEvidenceM365Collector/);
    assert.match(advisor, /SharePoint sites, libraries, or document scope -> ProjectEvidenceSharePointCollector/);
});

test('Aro delegates runtime inventory verification to collectors and does not own collection procedures', async () => {
    const { metadata, body } = await agent('Aro');
    assert.ok(!metadata.tools.some(tool => /read|search|mcp/i.test(tool)), 'Aro must not own source or inventory tools');
    assert.match(body, /Aro has no read, search, edit, build, collection, or diagnosis role/);
    assert.match(body, /ProjectEvidence.*Collector.*ProjectAssessmentAdvisor/);
    assert.doesNotMatch(body, /P0|P1|P2|P5|P7|tool-presence probe|runtime inventory gate/);
});

test('local collector P1 separates an empty destination from evidence', async () => {
    const { metadata } = await agent('Aro');
    assert.ok(!metadata.tools.some(tool => /read|search/i.test(tool)), 'Aro must keep no read/search tools');

    const { metadata: local, body: localBody } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.deepEqual(local.tools, ['read', 'search', 'aro_read_prior_assessment_store'], 'local collector exposes the exact prior-store tool');
    assert.match(localBody, /## P1 Local Preflight/);
    assert.match(localBody, /Establish destination usability, not source-repository identity/);
    assert.match(localBody, /A valid empty workspace is not evidence-source identity/);
    assert.match(localBody, /Do not list or scan the whole repository/);
    assert.match(localBody, /If no source artifacts exist, return `EMPTY` or `PARTIAL` from P2/);
    assert.match(localBody, /return `BLOCKED` naming it/);
});

test('ADO collector defers grouped and action-based categories with exact read coverage', async () => {
    const { metadata, body } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.deepEqual(metadata.tools, ADO_COLLECTOR_TOOLS);
    assert.match(body, /Repository inventory requires a schema-verified read-only `ado-remote-mcp\/repo_repository` action/);
    assert.match(body, /For grouped\/mixed tools, inspect the schema and use only a read enum explicitly confirmed by that schema/);
    assert.match(body, /<ORGANIZATION_INPUT>\/<PROJECT_INPUT>/);
    assert.match(body, /Organization and project are invocation inputs supplied by Aro/i);
    assert.match(body, /teams, membership/i);
    assert.match(body, /Requested categories may include projects, teams, membership/i);
    assert.doesNotMatch(body, /Excluded because action or schema ambiguity is unresolved/);
    assert.match(body, /pull requests and threads/i);
    assert.match(body, /These signals do not prove authority or delivery ownership/i);
    assert.match(body, /Unknown, unsupported, not-collected, or blocked categories are gaps, not negative findings/i);
});

test('team constitution stays evidence-gated and uses claim-status and UNKNOWN boundaries', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /Team constitution is in scope by default when evidence is available/);
    assert.match(body, /formal teams, members, roles and accountability/);
    assert.match(body, /delivery\/release\/QA\/security\/production responsibilities/);
    assert.match(body, /capacity and operating model/);
    assert.match(body, /on-call or approver relationships/);
    assert.match(body, /observed.*asserted.*inferred.*contradicted.*UNKNOWN/i);
    assert.match(body, /ADO membership or assignment alone does not prove role authority or delivery ownership/);
    assert.match(body, /Do not invent an org chart, role, owner, approver, capacity, team responsibility, or on-call relationship/);
    assert.match(body, /Every organization or ownership conclusion cites `evidence_id`/);
    assert.match(body, /Team constitution adds no routine clarification or inventory question/);
});


test('collectors are non-delegating, SharePoint is directly user-invocable, and collectors are not model-pinned', async () => {
    for (const name of WORKERS) {
        const { metadata } = await agent(name);
        assert.deepEqual(metadata.agents, [], `${name}: must not delegate`);
        assert.equal(metadata['user-invocable'], name === 'ProjectEvidenceSharePointCollector', `${name}: user-invocable metadata must match the direct diagnostic contract`);
        assert.equal(metadata.model, undefined, `${name}: must not pin a model`);
        for (const forbidden of ['edit', 'execute', 'todo', 'agent', 'runSubagent']) {
            assert.ok(!metadata.tools.includes(forbidden), `${name}: must not include ${forbidden}`);
        }
    }
});

test('advisor is tool-free and selection-only', async () => {
    const { metadata, body } = await agent('ProjectAssessmentAdvisor');
    assert.deepEqual(metadata.tools, []);
    assert.deepEqual(metadata.agents, []);
    assert.equal(metadata.model, undefined, 'advisor must not pin a model');
    assert.match(body, /Return only JSON/);
    assert.match(body, /Never collects evidence/);
    assert.match(body, /NO_MATCH/);
});

test('expert reads only evidence-store pages and does not collect or write', async () => {
    const { metadata, body } = await agent('ProjectAssessmentExpert');
    assert.deepEqual(metadata.tools, ['aro_read_evidence_batch_page']);
    assert.equal(metadata.tools.every(tool => tool === 'aro_read_evidence_batch_page'), true);
    assert.ok(!metadata.tools.some(tool => /source|ado|sharepoint|github|mcp|write|search/i.test(tool)));
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
    assert.match(body, /Read every in-scope batch page/i);
    assert.match(body, /receipt, batch status, manifest summary, coverage summary, or navigation summary is not an evidence record/i);
    assert.match(body, /PARTIAL but readable evidence may still produce useful findings/i);
    assert.match(body, /Zero readable records produce no unsupported findings/i);
});

test('P5 handoff requires terminal collection, complete pages, and permits readable partial evidence', async () => {
    const { metadata: expertMeta, body: expert } = await agent('ProjectAssessmentExpert');
    const { body: aro } = await agent('Aro');
    const { body: skill } = await load(SKILL);

    assert.match(skill, /Aro dispatches P5 only after all source families have terminal outcomes/);
    assert.match(skill, /every in-scope page receipt has been verified/);
    assert.match(skill, /P5 reads every bounded evidence page with `aro_read_evidence_batch_page`/);
    assert.deepEqual(expertMeta.tools, ['aro_read_evidence_batch_page']);
    assert.match(aro, /waits for every in-scope source family to reach a terminal state/);
    assert.match(aro, /Aro passes only run_id, scope_id, the run root, batch IDs, terminal statuses, and coverage\/sufficiency\/manifest summaries/);
    assert.match(aro, /never receives or forwards bulk evidence/);
    assert.doesNotMatch(aro, /Missing, unreadable, truncated, mismatched/);
    assert.match(expert, /Read every in-scope batch page using `aro_read_evidence_batch_page`/);
    assert.match(expert, /A receipt, batch status, manifest summary, coverage summary, or navigation summary is not an evidence record/);
    assert.match(expert, /PARTIAL` or `BLOCKED` with the exact gap/);
    assert.match(expert, /PARTIAL but readable evidence may still produce useful findings/);
    assert.match(expert, /Zero readable records produce no unsupported findings/);
    assert.match(skill, /Aro dispatches P5 only after all source families have terminal outcomes/);
    assert.match(skill, /Missing, unreadable, truncated, mismatched, or unverifiable pages prevent P5/);
    assert.match(skill, /P5 analyzes them as readable evidence and labels the overall assessment `PARTIAL`/);
    assert.match(skill, /no unsupported project-specific claims/);
});

test('assessment name is a subject, not an exact resource filter, when a source locator is supplied', async () => {
    const { body: skill } = await load('skills/project-assessment/SKILL.md');
    assert.match(skill, /source locator.*is the collection scope/);
    assert.match(skill, /assessment name in the prompt is the subject and title, not an exact repository, resource, or filter/);
    assert.match(skill, /never omit the supplied project/);
    const { body: expert } = await agent('ProjectAssessmentExpert');
    assert.match(expert, /Treat the assessment name as the subject only, never as an exact resource filter/);
    assert.match(expert, /an unmapped subject is a limitation, not a reason to narrow or omit the supplied project/);
});

test('SharePoint and M365 collectors report preauthorization failures as BLOCKED without access requests', async () => {
    for (const name of ['ProjectEvidenceSharePointCollector', 'ProjectEvidenceM365Collector']) {
        const { body } = await agent(name);
        assert.match(body, /AADSTS65002/, `${name}: must name the preauthorization error`);
        assert.match(body, /`BLOCKED`/, `${name}: must report BLOCKED`);
        assert.match(body, /do not request (tokens or )?access|Do not request tokens or access/, `${name}: must forbid access requests`);
    }
});

test('every collector reports absent tools as BLOCKED without substitution', async () => {
    for (const name of COLLECTORS) {
        const { body } = await agent(name);
        const absentToolStatus = {
            ProjectEvidenceAzureDevOpsCollector: /A missing exact tool is `BLOCKED`/,
            ProjectEvidenceGitHubCollector: /No allowlisted operation: `BLOCKED`/,
        }[name] ?? /Actual tool-not-found\/unavailable invocation result: `BLOCKED`/;
        assert.match(body, absentToolStatus, `${name}: absent tools must be BLOCKED`);
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
    assert.match(body, /project assessment: read-only Azure DevOps evidence collection.*ProjectEvidenceAzureDevOpsCollector.*ProjectAssessmentAdvisor/);
    assert.match(body, /GovDocumentationSuiteGenerator/, 'Aro must route documentation persistence to the writer');
    assert.match(body, /Aro has no read, search, edit, build, collection, or diagnosis role/);
});

test('Aro does not own assessment procedure retrieval or page reads, but gates P5 on all collector terminal states', async () => {
    const { metadata, body } = await agent('Aro');
    assert.ok(!metadata.tools.some(tool => /read|search/i.test(tool)), 'Aro must have no read/search tools');
    assert.match(body, /waits for every in-scope source family to reach a terminal state/);
    assert.match(body, /per-batch terminal statuses, receipts/);
    assert.match(body, /does not dispatch synthesis while collection is still running/);
    assert.match(body, /Aro passes only run_id, scope_id, the run root, batch IDs, terminal statuses, and coverage\/sufficiency\/manifest summaries/);
});

test('project assessment routes by specialist cue without embedded phase procedure', async () => {
    const { metadata, body } = await agent('Aro');
    assert.match(metadata.description, /project\s+assessment/i, 'Aro description must retain the assessment routing cue');
    assert.match(body, /project assessment: cross-source assessment synthesis.*ProjectAssessmentExpert.*ProjectAssessmentAdvisor/);
    assert.match(body, /Before the synthesis dispatch, Aro waits for every in-scope source family/);
    assert.doesNotMatch(body, /P0-P8|P7 persistence/);
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
    assert.ok(!aro.body.includes(ingestionLink), 'Aro must not embed the ingestion procedure contract');
    assert.ok(!aro.body.includes(assessmentLink), 'Aro must not embed the assessment procedure contract');
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
    const { body: skillBody } = await load('skills/project-assessment/SKILL.md');
    assert.match(skillBody, /not yet approved/);
});

test('maintenance documents completed implementation and separate runtime gates', async () => {
    const maintenance = await read('docs/maintenance.md');
    assert.match(maintenance, /The project-assessment workflow implementation is complete/);
    assert.match(maintenance, /Remote collection remains gated/);
    assert.match(maintenance, /persistence.*not exercised live|not exercised.*live/i);
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
    const { metadata, body } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.deepEqual(metadata.tools, ADO_COLLECTOR_TOOLS);
    assert.match(body, /A missing exact tool is `BLOCKED`|Call only exact `ado-remote-mcp\/\.\.\.` identifiers/);
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
        assert.equal(count, name === 'ProjectEvidenceAzureDevOpsCollector' ? 0 : 1, `${name}: Skill Loading section count must follow the approved contract`);
    }
});

test('advisor carries no skill links', async () => {
    const { body } = await agent('ProjectAssessmentAdvisor');
    assert.ok(!body.includes('](../skills/'), 'advisor must not link skills');
});

test('content language follows the prompt, asks once when ambiguous, and keeps filenames and roster boundary', async () => {
    const { body: skill } = await load(SKILL);
    assert.match(skill, /Deliverables are written only beneath `<target-root>\/docs\/project-assessment\/<run-id>\/`/);
    assert.match(skill, /Never write assessment artifacts into the agent-roster repository/);
    assert.match(skill, /Content language follows the user's assessment prompt/);
    assert.match(skill, /Filenames stay stable English package names/);
    assert.match(skill, /set the HTML `lang` attribute to that language/);
    assert.match(skill, /Quoted source text stays in its original language/);
    assert.match(skill, /Prohibited claims apply in any language/);

    const { body: expert } = await agent('ProjectAssessmentExpert');
    assert.match(expert, /written in the content language Aro supplies in the drafting payload/);
    assert.match(expert, /return NEEDS_INPUT to Aro without guessing one/);

    const { body: writer } = await agent('GovDocumentationSuiteGenerator');
    assert.match(writer, /Write package content exactly as supplied in its content language/);
    assert.match(writer, /Do not translate, transliterate, or rename files/);

    const maintenance = await read('docs/maintenance.md');
    assert.match(maintenance, /never into this roster repository/);
    assert.match(maintenance, /docs\/project-assessment\/<run-id>\//);
    assert.match(maintenance, /filenames stay stable English names/);

    const guide = await read('docs/advanced-task-prompts.md');
    assert.match(guide, /Report content follows the language of the prompt; the English package filenames do not change/);
});

test('writer persistence route refuses roster targets, preserves files, and reads back', async () => {
    const { body } = await agent('GovDocumentationSuiteGenerator');
    assert.match(body, /## Assessment Report Persistence/);
    assert.match(body, /Refuse a target root that is the agent-roster repository/i);
    assert.match(body, /Preserve existing files/i);
    assert.match(body, /never overwrite/i);
    assert.match(body, /exact confirmed P0 run root/i);
    assert.match(body, /never (?:choose|invent) (?:a )?(?:new|fresh) run (?:ID|root)/i);
    assert.match(body, /Read back every package file/i);
    assert.match(body, /executive-decision\.html/i);
    assert.match(body, /per-file status/i);
    assert.match(body, /Do not modify any source or evidence directory/i);
    assert.match(body, /Independent review of the persisted version is not part of this route/i);
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
const assessmentRouting = async () => {
    const { body } = await agent('Aro');
    return body;
};

test('default assessment chain members remain allowlisted and route through their required advisor', async () => {
    const { metadata, body } = await agent('Aro');
    const routing = await assessmentRouting();
    for (const name of CHAIN) {
        assert.ok(metadata.agents.includes(name), `Aro allowlist must include ${name}`);
        const row = new RegExp(`\\|[^\\n]*\\|\\s*${name}\\s*\\|\\s*${CHAIN_ADVISOR[name]}\\s*\\|`);
        assert.match(routing, row, `Aro routing index must route ${name} through ${CHAIN_ADVISOR[name]}`);
    }
    assert.doesNotMatch(routing, /P0-P8|Modernization chain:|Chain payloads/);
    assert.match(routing, /waits for every in-scope source family to reach a terminal state/);
});

test('Aro owns no assessment depth procedure', async () => {
    const routing = await assessmentRouting();
    assert.doesNotMatch(routing, /quick depth|full chain|omitted steps|P0-P8/);
    const { body: skill } = await load(SKILL);
    assert.match(skill, /quick|full|depth/i);
});

test('Aro chain payload and source boundaries belong outside the dispatcher', async () => {
    const routing = await assessmentRouting();
    assert.doesNotMatch(routing, /Chain payloads|P5 verbatim|do not retrieve procedures|Chain workers|further collection/);
    assert.match(routing, /pass only task context and acceptance\s+criteria/);
    assert.match(routing, /Aro has no read, search, edit, build, collection, or diagnosis role/);
});

test('chain workers keep their general tool lists and run in assessment mode with evidence-only boundaries', async () => {
    for (const name of CHAIN) {
        const { metadata, body } = await agent(name);
        assert.deepEqual(metadata.tools, ['read', 'search'], `${name}: general tool list must stay unchanged`);
        assert.deepEqual(metadata.agents, [], `${name}: must not delegate`);
        assert.equal(metadata['user-invocable'], false, `${name}: must not be user-invocable`);
        assert.equal(metadata.model, undefined, `${name}: must not pin a model`);
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
    assert.match(body, /Ask at most one critical clarification/);
    assert.match(body, /Mark blocked source areas NOT ASSESSED|remote source is unavailable|blocked source areas/);
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

test('skill reflects conditional business analysis and the report output bar', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /## Assessment Pipeline/);
    assert.match(body, /## Decision-Ready Report Contract/);
    assert.match(body, /A1|BusinessKnowledgeExpert|BusinessKnowledgeAdvisor/);
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

test('skill keeps framework references and disposition acceptance', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /learn\.microsoft\.com\/en-us\/azure\/well-architected\/pillars/);
    assert.match(body, /select-cloud-migration-strategy/);
    assert.match(body, /snippet-only, not independently verified/);
    assert.match(body, /Excluded: ISO 25010|ISO 25010 \(source version conflict/);
    assert.match(body, /## Migration Disposition/);
    assert.match(body, /## Cost Lifecycle/);
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

test('report package artifact map matches the registered skill', async () => {
    const { body } = await load(SKILL);
    const skillFiles = [...sectionBetween(body, '## Report Package', '## Stop and Resume').matchAll(/^- `([A-Za-z0-9-]+\.md)`/gm)].map(match => match[1]);
    assert.deepEqual(skillFiles, REPORT_PACKAGE, 'skill report package must list the 13 named files in order');
    for (const retired of ['source-coverage-register.md', 'strengths-risks.md', 'gaps.md', 'recommendations-roadmap.md']) {
        assert.ok(!skillFiles.includes(retired), `${retired} must be consolidated`);
    }
});

test('report package is labeled as a proposed synthesis and keeps the README as executive decision summary', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /proposed synthesis/);
    assert.match(body, /not an official Microsoft or AWS deliverable/);
    assert.match(body, /The proposed output layout is not yet approved/);
    assert.match(body, /`README\.md`: executive decision summary/);
    assert.match(body, /`business-requirements\.md`: requirements with evidence references, or NOT ASSESSED/);
});

test('report package reserves tool outputs as labeled source artifacts, not the narrative report', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /Tool-generated outputs:/);
    assert.match(body, /Azure Migrate assessments/);
    assert.match(body, /They are not this project's narrative report/);
});

test('reference basis lists the process sources and keeps vendor and optional caveats', async () => {
    const { body } = await load(SKILL);
    const sources = [
        'https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/plan/assess-workloads-for-cloud-migration',
        'https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/migrate/migration-wave-planning',
        'https://learn.microsoft.com/en-us/azure/migrate/discovery-methods-modes?view=migrate',
        'https://learn.microsoft.com/en-us/azure/migrate/concepts-dependency-visualization?view=migrate',
        'https://docs.aws.amazon.com/prescriptive-guidance/latest/application-portfolio-assessment-guide/introduction.html'
    ];
    for (const source of sources) {
        assert.ok(body.includes(source), `skill must cite ${source}`);
    }
    assert.match(body, /Microsoft and AWS pages are vendor-specific/);
    assert.match(body, /Google Cloud manual import and offline assessment material/);
});

test('Aro does not retain workflow phases or persistence procedures', async () => {
    const { body } = await agent('Aro');
    const text = body.replace(/\s+/g, ' ');
    assert.doesNotMatch(text, /\bP[0-8]\b|runtime inventory|tool-presence|checkpoint (?:mechanics|manifest|store)|report package|normali[sz]ation/i);
    assert.match(text, /Before a specialist dispatch, consult the required tool-free advisor/);
    assert.match(text, /Aro has no read, search, edit, build, collection, or diagnosis role/);
    assert.match(text, /GovDocumentationSuiteGenerator/);
    assert.match(text, /returns a persistence receipt/i);
    assert.doesNotMatch(text, /verify saved paths by read-back/i);
    const { body: skill } = await load(SKILL);
    assert.match(skill, /P0|P1|P2|P3|P4|P5|P6|P7|P8|persistence|runtime inventory/i);
});

test('Aro gates evidence batch writes separately from P7 report persistence', async () => {
    const { body } = await agent('Aro');
    const text = body.replace(/\s+/g, ' ');
    assert.match(text, /explicit evidence-save authorization and the exact run root and evidence write-list/i);
    assert.match(text, /Report persistence authorization does not by itself cover evidence batches/i);
    assert.match(text, /VS Code confirmation for each batch write/i);
    assert.doesNotMatch(text, /standard full assessment against a confirmed non-roster target does by default/i);
});

test('P0 target-root guidance is owned by the skill and local collector', async () => {
    const { body: skill } = await load(SKILL);
    assert.match(skill, /P0 target root is the open workspace folder\/repository root/);
    assert.match(skill, /never the active file directory or a guessed subfolder/);

    const { body: local } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.match(local, /Aro must supply the open workspace folder\/repository root/);
    assert.match(local, /Do not list or scan the whole repository/);
});

test('short trigger intake is owned by the advisor and skill', async () => {
    const { body: advisor } = await agent('ProjectAssessmentAdvisor');
    assert.match(advisor, /Do not ask for tool names, project names, scopes, resource URLs, or secrets/);

    const { body: skill } = await load(SKILL);
    assert.match(skill, /short\/default assessment of an unambiguous open project resolves the open destination only/);
});

test('local repository evidence requires explicit inclusion and does not block remote-named sources', async () => {
    const { body: advisor } = await agent('ProjectAssessmentAdvisor');
    const { body: local } = await agent('ProjectEvidenceLocalRepoCollector');
    const { body: skill } = await load(SKILL);

    assert.match(advisor, /only when the user explicitly includes the local repository as a source/);
    assert.match(advisor, /does not suppress SharePoint or other explicitly named sources/);
    assert.match(local, /Dispatched only when the user explicitly includes the local repository as a source/);
    assert.match(skill, /collects local evidence only when the user explicitly includes the local repository/);
    assert.match(skill, /remote sources only as named/);
});

test('remote source scope and destination scope are owned by the advisor and skill', async () => {
    const { body: advisor } = await agent('ProjectAssessmentAdvisor');
    assert.match(advisor, /Do not ask for identifiers already supplied|Do not ask for tool names, project names, scopes, resource URLs, secrets, or identifiers already supplied/);
    assert.match(advisor, /Source declarations and identifiers are scope, not retrieved evidence/);

    const { body: skill } = await load(SKILL);
    assert.match(skill, /destination root/);
    assert.match(skill, /never reinterpret open project as a collection source/i);
    assert.match(skill, /Preserve all user-supplied data sources and identifiers/);
    assert.match(skill, /dispatch each explicitly named remote collector independently/);
});

test('no-inventory remote source handling is owned by the advisor and skill', async () => {
    const { body: advisor } = await agent('ProjectAssessmentAdvisor');
    assert.match(advisor, /a source name or identifier alone is not evidence of authorization or retrieval success/i);
    assert.match(advisor, /collector validates exact scope and arguments, invokes the required allowlisted operation directly/i);
    assert.match(advisor, /An unavailable ADO source is not NO_MATCH/i);

    const { body: skill } = await load(SKILL);
    assert.match(skill, /dispatch each remote collector independently/i);
    assert.match(skill, /Invoke only an exact allowlisted operation with valid arguments/i);
    assert.match(skill, /Authentication or server availability is not evidence of read-only capability/i);
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
        if (name === 'ProjectEvidenceAzureDevOpsCollector') {
            assert.deepEqual(metadata.tools, ADO_COLLECTOR_TOOLS, `${name}: exact ADO read tools plus the evidence batch write must stay bound`);
            assert.match(collector, /`actual_retrieval_mode` is `live-connector` only when confirmed by an exact read tool, otherwise `UNKNOWN` or `BLOCKED`/);
        } else if (name === 'ProjectEvidenceM365Collector') {
            assert.deepEqual(metadata.tools, ODSP_READ_TOOLS, `${name}: exact ODSP read tools must stay bound`);
        } else if (name === 'ProjectEvidenceSharePointCollector') {
            assert.deepEqual(metadata.tools, SHAREPOINT_READ_TOOLS, `${name}: exact SharePoint read tools must stay bound`);
        } else {
            assert.deepEqual(metadata.tools, [], `${name}: no tools may be bound by the manifest update`);
        }
    }
});

test('local collector declares local-read-search as actual mode and links its manifest by batch_id', async () => {
    const { metadata, body } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.deepEqual(metadata.tools, ['read', 'search', 'aro_read_prior_assessment_store'], 'local collector exposes the exact prior-store tool');
    assert.match(body, /`actual_retrieval_mode`: `local-read-search` when the P1 preflight passes/);
    assert.match(body, /`UNKNOWN` when it returns `BLOCKED` or `ERROR` before any read/);
    assert.match(body, /Each record carries its `batch_id`/);
});

test('every collector outputs a collection-batch manifest with modes, all capability keys, and manifest in Output', async () => {
    for (const name of COLLECTORS) {
        const { body } = await agent(name);
        if (name === 'ProjectEvidenceAzureDevOpsCollector') {
            assert.match(body, /Return an inline, readable collection-batch manifest and canonical evidence records/);
            assert.match(body, /one manifest with scope, time window, retrieval mode, capability coverage, limitations, record count, and sufficiency state/);
        } else {
            assert.equal(body.split('## Collection-Batch Manifest').length - 1, 1, `${name}: must have exactly one manifest section`);
        }
        assert.match(body, name === 'ProjectEvidenceAzureDevOpsCollector'
            ? /`intended_retrieval_mode` comes from P0 or `UNKNOWN`/
            : /`intended_retrieval_mode`: the mode from Aro's P0 source plan/, `${name}: intended mode must come from P0`);
        for (const field of ['batch_id', 'actual_retrieval_mode', ...(name === 'ProjectEvidenceAzureDevOpsCollector' ? ['capability coverage'] : ['capability_coverage'])]) {
            assert.ok(body.includes(name === 'ProjectEvidenceAzureDevOpsCollector' && field === 'capability coverage' ? field : `\`${field}\``), `${name}: must reference ${field}`);
        }
        if (name !== 'ProjectEvidenceAzureDevOpsCollector') {
            for (const capability of CAPABILITIES) {
                assert.ok(body.includes(`\`${capability}\``), `${name}: must disclose ${capability}`);
            }
        }
        const output = body.slice(body.indexOf('## Output'));
        assert.match(output, /collection-batch manifest/, `${name}: Output must return the manifest`);
    }
});

test('prior assessment picker cancellation opens no store or invokes no loader', async () => {
    let registeredTool;
    let openCalls = 0;
    let loadCalls = 0;
    const vscode = {
        lm: { registerTool: (name, tool) => { if (name === 'aro_read_prior_assessment_store') registeredTool = tool; return { dispose() { } }; } },
        window: { showOpenDialog: async () => { openCalls += 1; return undefined; } },
        LanguageModelTextPart: class { constructor(value) { this.value = value; } },
        LanguageModelToolResult: class { constructor(content) { this.content = content; } }
    };
    const localRequire = createRequire(path.join(root, 'src/extension.js'));
    const module = { exports: {} };
    vm.runInNewContext(await readFile(path.join(root, 'src/extension.js'), 'utf8'), {
        module, exports: module.exports,
        require: name => name === 'vscode' ? vscode : name === './prior-assessment-store'
            ? { loadStore: async () => { loadCalls += 1; return { records: [] }; } }
            : localRequire(name), setTimeout, clearTimeout
    });
    module.exports.registerPriorAssessmentStoreTool({ subscriptions: [] });
    assert.ok(registeredTool);
    await assert.rejects(registeredTool.invoke({ input: { operation: 'list', pageSize: 20 } }), /did not select|no database was opened/i);
    assert.equal(openCalls, 1);
    assert.equal(loadCalls, 0);
});

test('prior SQLite instructions gate exact explicit paths and bounded FTS5 paging', async () => {
    const { body: local } = await agent('ProjectEvidenceLocalRepoCollector');
    const assessment = await readFile(path.join(root, 'skills/project-assessment/SKILL.md'), 'utf8');
    const ingestion = await readFile(path.join(root, 'skills/project-evidence-ingestion/SKILL.md'), 'utf8');

    assert.match(local, /exact prior-store tool is `aro_read_prior_assessment_store`/);
    assert.match(local, /operation` \(`search` or `list`\).*query.*cursor.*pageSize/s);
    assert.match(local, /Never infer a DB path, traverse directories, use globs or sibling discovery/);
    assert.match(local, /adjacent manifest is explicitly `UNVERIFIED_NOT_CRYPTOGRAPHICALLY_BOUND_TO_DB`/);
    assert.match(local, /not a vector index/);
    assert.match(local, /Never write or modify the source DB, any sidecar/);
    assert.match(local, /All reports and checkpoints stay beneath the current run root/);

    for (const text of [assessment, ingestion]) {
        assert.match(text, /PARTIAL|UNKNOWN/);
        assert.match(text, /cursor|bounded pages|bounded page/s);
        assert.match(text, /stable `batch_id`|stable batch ID/s);
        assert.match(text, /Never write|never write|Never modify|never modify/s);
    }
    const combined = `${local}\n${assessment}\n${ingestion}`;
    assert.match(combined, /\bnot a vector index\b/);
    assert.doesNotMatch(combined, /\bwalk outside\b/i);
    assert.doesNotMatch(combined, /\bis an? vector (?:index|database)\b|\bprovides vector search\b|\bimplements an? vector database\b/i);
});

test('prior assessment reuse is an exact, user-authorized, read-only package tool', async () => {
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    assert.ok(manifest.activationEvents.includes('onLanguageModelTool:aro_read_prior_assessment_store'));
    const tool = manifest.contributes.languageModelTools.find(entry => entry.name === 'aro_read_prior_assessment_store');
    assert.ok(tool, 'package must contribute the exact prior-store LM tool');
    assert.deepEqual(tool.inputSchema.required, ['operation']);
    assert.deepEqual(tool.inputSchema.properties.operation.enum, ['search', 'list']);
    assert.equal(tool.inputSchema.properties.query.maxLength, 200);
    assert.equal(tool.inputSchema.properties.cursor.minimum, 0);
    assert.equal(tool.inputSchema.properties.cursor.default, 0);
    assert.equal(tool.inputSchema.properties.pageSize.minimum, 1);
    assert.equal(tool.inputSchema.properties.pageSize.maximum, 20);
    assert.equal(tool.inputSchema.properties.pageSize.default, 20);
    assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['cursor', 'operation', 'pageSize', 'query']);
    assert.equal(tool.inputSchema.additionalProperties, false);

    const extension = await readFile(path.join(root, 'src/extension.js'), 'utf8');
    assert.match(extension, /registerTool\('aro_read_prior_assessment_store'/);
    assert.match(extension, /showOpenDialog/);
    assert.match(extension, /Adjacent evidence manifest/);
    assert.match(extension, /readOnly: true/);
    assert.doesNotMatch(extension, /execute\(|exec\(|spawn\(|shell/);

    const { metadata, body } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.deepEqual(metadata.tools, ['read', 'search', 'aro_read_prior_assessment_store']);
    assert.match(body, /user explicitly selects and confirms the exact SQLite file/);
    assert.match(body, /not live OneDrive collection/);
    assert.match(body, /comprehensive inventory/);
});

test('the contract bars assessment claims beyond batch capability and treats imports as scope-limited', async () => {
    const { body } = await load(INGESTION);
    assert.match(body, /Assessment workers must not make claims beyond the capability states of the batch/);
    assert.match(body, /is not evidence that the underlying source inventory is complete/);
    assert.match(body, /Numeric values such as CPU, memory, latency, or throughput are allowed when the batch collected them/);
    assert.match(body, /A capability with no entry is `unknown`, never `collected`/);
});

test('collector tool lists and remote boundaries remain explicit after the manifest update', async () => {
    for (const name of REMOTE_COLLECTORS) {
        const { metadata } = await agent(name);
        if (name === 'ProjectEvidenceAzureDevOpsCollector') {
            assert.deepEqual(metadata.tools, ADO_COLLECTOR_TOOLS, `${name}: exact ADO read allowlist plus the evidence batch write must remain`);
        } else if (name === 'ProjectEvidenceSharePointCollector') {
            assert.deepEqual(metadata.tools, SHAREPOINT_READ_TOOLS, `${name}: exact SharePoint read allowlist must remain`);
        } else if (name === 'ProjectEvidenceM365Collector') {
            assert.deepEqual(metadata.tools, ODSP_READ_TOOLS, `${name}: exact ODSP read allowlist must remain`);
        } else {
            assert.deepEqual(metadata.tools, [], `${name}: remote collector must keep tools: []`);
        }
        assert.deepEqual(metadata.agents, [], `${name}: must not delegate`);
    }
    const { metadata } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.deepEqual(metadata.tools, ['read', 'search', 'aro_read_prior_assessment_store'], 'local collector exposes the exact prior-store tool');
});

test('ingestion implementation records the manifest and actual retrieval mode', async () => {
    const { body } = await load(INGESTION);
    assert.match(body, /## Collection-Batch Manifest/);
    assert.match(body, /One manifest per source batch in a run/);
    assert.match(body, /`actual_retrieval_mode`/);
});

test('prior evidence resume is limited to user-supplied batches with reuse eligibility fields', async () => {
    const { body } = await load(INGESTION);
    const reuse = sectionBetween(body, '## Prior Evidence Reuse and Resume', '## Local Repository P1 Root Identity');
    assert.match(reuse, /No earlier run, output folder, or report is searched for or loaded/);
    for (const field of ['scope_id', 'batch_id', 'run_id', 'source', 'container', 'collection-batch manifest', 'coverage', 'sufficiency', 'navigation', 'remaining queue', 'final_page']) {
        assert.ok(reuse.includes(field), `reuse eligibility must name ${field}`);
    }
    assert.match(reuse, /A batch missing any required item is not reusable/);
});

test('prior reports are prior-report context and never normalized evidence in any layer', async () => {
    const { body } = await load(INGESTION);
    assert.match(body, /A prior report document is prior-report context/);
    assert.match(body, /it has no `evidence_id`, it is never a normalized record/);
    const { body: expert } = await agent('ProjectAssessmentExpert');
    assert.match(expert, /Prior-report context is not evidence/);
    const { body: skill } = await load(SKILL);
    assert.match(skill, /Prior-report context is never normalized into the record set/);
});

test('partial batches cannot pass P5 as complete and cannot evidence omitted pages', async () => {
    const { body } = await load(INGESTION);
    assert.match(body, /The batch never enters P5 as `COMPLETE`/);
    assert.match(body, /it is not evidence for any page or container it did not enumerate/);
    const { body: expert } = await agent('ProjectAssessmentExpert');
    assert.match(expert, /A `PARTIAL` or `BLOCKED` batch supports no `COMPLETE` claim and no evidence for pages or containers it did not enumerate/);
});

test('local reuse never claims unchanged without a supplied matching revision and UNKNOWN revision is re-checked', async () => {
    const { body: local } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.match(local, /Never report an item as `unchanged`/);
    assert.match(local, /Record `revision: UNKNOWN` for every item unless Aro supplies a revision as evidence/);
    assert.match(local, /Reuse of a prior local record without re-reading requires a known prior revision equal to a current revision that Aro supplied as evidence/);
    const { body } = await load(INGESTION);
    assert.match(body, /`reused` requires a known revision on both sides/);
    assert.match(body, /An `UNKNOWN` revision is never reused as unchanged/);
    assert.match(body, /\| `recheck` \|.*`revision` is `UNKNOWN`/);
});

test('changed, missing, and inaccessible local items get targeted re-check and deleted items stay gaps', async () => {
    const { body: local } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.match(local, /Re-check only the listed locators within the target root/);
    assert.match(local, /`rechecked-present`.*`missing`.*`inaccessible`/);
    assert.match(local, /Return a re-check entry for every listed item/);
    const { body } = await load(INGESTION);
    assert.match(body, /\| `changed` \|.*Targeted P2 collection/);
    assert.match(body, /\| `missing` \|.*Targeted P2 collection/);
    assert.match(body, /\| `inaccessible` \|.*Targeted P2 attempt/);
    assert.match(body, /\| `deleted` \|.*[Rr]ecorded as a gap that cites the prior `evidence_id`/);
    assert.match(body, /Deleted items remain gaps and are never dropped/);
});

test('continuation merge requires matching run, scope, and batch identity plus page markers', async () => {
    const { body } = await load(INGESTION);
    const merge = sectionBetween(body, '### Continuation Merge', '### Checkpoint Package');
    for (const term of ['run_id', 'scope_id', 'batch_id', '`page` and `final_page`']) {
        assert.ok(merge.includes(term), `continuation merge must require ${term}`);
    }
    assert.match(merge, /A reused batch is never merged with a continuation from a different `run_id`/);
});

test('one assessment run owns one shared root and P7/checkpoints receive it', async () => {
    const { body: skill } = await load(SKILL);
    const { body: writer } = await agent('GovDocumentationSuiteGenerator');

    assert.match(skill, /one unique (?:`?<run-root>`?|`[^`]*docs\/project-assessment\/[^`]*<run-id>\/[^`]*)`?/i);
    assert.match(skill, /no sibling run folders/i);
    assert.match(skill, /writer.*exact run root/i);

    assert.match(writer, /confirmed run root/i);
    assert.match(writer, /never (?:choose|invent) (?:a )?(?:new|fresh) run (?:ID|root)/i);
    assert.match(writer, /root index.*artifact.*status/i);

});

test('standard report persistence is default and progress checkpoints stay opt-in', async () => {
    const { body: skill } = await load(SKILL);
    const { body: writer } = await agent('GovDocumentationSuiteGenerator');

    assert.match(skill, /persistence is authorized by default when Aro confirms a non-roster target root/i);
    assert.match(skill, /only progress checkpoints remain opt-in and explicitly authorized/i);
    assert.match(writer, /standard P7 report persistence is preauthorized/i);
    assert.match(writer, /if the directory or any package file exists at P7, never overwrite/i);
    assert.match(writer, /read back every package file/i);
});

test('P7 defaults the full run to a unique non-overwrite open-project package path', async () => {
    const { body } = await load(INGESTION);
    const pkg = sectionBetween(body, '### Checkpoint Package', '## Local Repository P1 Root Identity');
    assert.match(pkg, /P7 default package route to the open project/);
    assert.match(pkg, /Never overwrite a run directory or package file/);
    assert.match(pkg, /Collectors and analysis workers never write it/);

    const { body: local } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.match(local, /You do not analyze, write, delegate, or run commands/);
    assert.match(local, /read.*search|read-only local repository evidence collector/i);
});

test('P6 requires a technical Markdown package and a standalone executive HTML decision page', async () => {
    const { body: skill } = await load(SKILL);
    assert.match(skill, /`executive-decision\.html`/);
    for (const filename of ['README.md', 'assessment-method-and-data.md', 'workload-portfolio.md', 'dependency-analysis.md', 'business-requirements.md', 'architecture-c4.md', 'code-doc-consistency.md', 'project-management.md', 'prioritized-findings.md', 'options-and-business-case.md', 'target-state.md', 'migration-roadmap.md', 'validation-log.md']) {
        assert.match(skill, new RegExp(`\`${filename}\``), `Report Package must include ${filename}`);
    }
    assert.match(skill, /Read back every file/);
    assert.match(skill, /[Pp]artial and BLOCKED assessments still create every package artifact/);
    assert.match(skill, /Go, Conditional Go, or No-Go/);
    assert.match(skill, /no health or completeness score/);
    assert.match(skill, /inline CSS and inline SVG only/);
    assert.match(skill, /no external dependencies, CDNs/);
    assert.match(skill, /Other README and export outputs are not converted to HTML/);
    assert.match(skill, /Mermaid is allowed in Markdown only/);
});

test('P6 report formats expand P0/P1 and include a non-guessing acronym glossary', async () => {
    const { body: expert } = await agent('ProjectAssessmentExpert');
    const { body: skill } = await load(SKILL);

    assert.match(expert, /P0.*scope and target.*P1.*pre-collection validation/i);
    assert.match(expert, /acronym\/abbreviation index or glossary/i);
    assert.match(expert, /UNKNOWN.*expansion is unavailable|expansion is unavailable.*UNKNOWN/i);

    assert.match(skill, /expand internal labels and acronyms on first use/i);
    assert.match(skill, /concise acronym\/abbreviation index or glossary/i);
    assert.match(skill, /P0.*scope and target.*P1.*pre-collection validation/i);
    assert.match(skill, /never guess a technical meaning/i);
    assert.match(skill, /HTML.*same concise acronym\/abbreviation index or glossary/i);
});

test('collector completeness rejects unreadable results and compact output retains canonical records', async () => {
    const { body: local } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.match(local, /compact but complete collection-batch manifest and the complete normalized evidence records/);
    assert.match(local, /Every record must include every canonical field in full/);
    assert.match(local, /Do not abbreviate IDs, omit required fields/);
    assert.match(local, /If a continuation dispatch is requested, return only a clearly bounded page/);
    assert.match(local, /same `batch_id`, `run_id`, and `scope_id`/);
    assert.match(local, /If that page would still externalize or be unreadable, return `PARTIAL` or `UNKNOWN`/);
});

test('ingested repository statement triggers bounded local discovery without a canonical batch ID', async () => {
    const { body: local } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.match(local, /A user statement that documents are already ingested in the open repository/);
    assert.match(local, /likely evidence locations/);
    assert.match(local, /Markdown, PDF, JSON, CSV/);
    assert.match(local, /Do not require a canonical `batch_id`/);
});

test('discovered local artifacts form partial records without canonical manifests', async () => {
    const { body: local } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.match(local, /`revision: UNKNOWN`/);
    assert.match(local, /repository-relative locator/);
    assert.match(local, /Without canonical batch manifests/);
    assert.match(local, /PARTIAL/);

    const { body: ingestion } = await load(INGESTION);
    assert.match(ingestion, /label the batch\/records `PARTIAL` with `UNKNOWN` coverage/);
    assert.match(ingestion, /constrained P5 analysis/);
    assert.match(ingestion, /Never claim COMPLETE/);
});

test('prior assessment reports are excluded and ADO exports remain local evidence', async () => {
    const { body: local } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.match(local, /exclude them as source evidence unless Aro or the user explicitly identifies a file as a source document/);
    assert.match(local, /ADO or Azure DevOps exports/);

    const { body: ingestion } = await load(INGESTION);
    assert.match(ingestion, /previous assessment README\/summary\/decision\/report-package artifacts/);
    assert.match(ingestion, /prior-report-context/);
    assert.match(ingestion, /Previous assessment reports remain excluded unless explicitly identified as source documents/);
});

test('absent local evidence returns a concise blocked or empty result without canonical batch demand', async () => {
    const { body: local } = await agent('ProjectEvidenceLocalRepoCollector');
    assert.match(local, /Search returns nothing: `EMPTY`/);
    assert.match(local, /never an instruction to ask the user for canonical records/);
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

test('authenticated ado-remote-mcp inventory is explicit and does not expand the collector allowlist', async () => {
    const { body: advisor } = await agent('ProjectAssessmentAdvisor');
    const { metadata: collectorMetadata, body: collector } = await agent('ProjectEvidenceAzureDevOpsCollector');
    const { body: ingestion } = await load(INGESTION);
    const { body: skill } = await load(SKILL);
    assert.deepEqual(collectorMetadata.tools, ADO_COLLECTOR_TOOLS);
    for (const [name, text] of Object.entries({ advisor, collector, ingestion, skill })) {
        assert.doesNotMatch(text, /unattested/i, `${name} must not describe an authenticated server as unattested`);
    }
});

test('wildcard and offset search pages never become complete inventory or P5 evidence', async () => {
    const { body: collector } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.match(collector, /Do not broaden organization, project, query, container, or time scope/);
    assert.match(collector, /do not treat searches or project-name text as validation/);
    assert.match(collector, /Convergence is a stop state, not completeness/);
});

test('P2 routing stays collector-owned and SharePoint tools remain explicitly bound', async () => {
    const { metadata: sharePoint } = await agent('ProjectEvidenceSharePointCollector');
    assert.deepEqual(sharePoint.tools, SHAREPOINT_READ_TOOLS);
});

test('externalized ADO output is conservative and continuation preserves batch identity', async () => {
    const { body: collector } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.match(collector, /Return an inline, readable collection-batch manifest and canonical evidence records/);
    assert.match(collector, /Paginate every accepted category until the source is exhausted or a concrete blocker is reached/);
    assert.match(collector, /Preserve the exact supplied `run_id`, `scope_id`, and P0 assessment run root, and include the `batch_id` allocated for this source batch/);
    assert.match(collector, /If no canonical evidence records can be returned, make no evidence claim/);
});

test('Aro generates run and scope identifiers, passes scope and subject separately, and never asks for campaign or batch IDs', async () => {
    const { body } = await agent('Aro');
    assert.match(body, /`run_id`: a new unique identifier generated by Aro/);
    assert.match(body, /`scope_id`: a new unique identifier generated by Aro/);
    assert.match(body, /`organization` and `project`: the exact values from the user's request, passed as separate scope fields/);
    assert.match(body, /`subject`: the assessment name, passed separately/);
    assert.match(body, /Aro never asks the user for run, scope, batch, or campaign identifiers/);
    assert.match(body, /Collectors allocate their own `batch_id`/);
    assert.match(body, /re-dispatches that read-only collector once/);
});

test('ADO collector takes run and scope from Aro, allocates batch_id per source batch, and never asks for it', async () => {
    const { body } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.match(body, /Use the exact `run_id` and `scope_id` Aro supplies; never create or replace them/);
    assert.match(body, /Allocate one new `batch_id` for this source batch, unique within the run/);
    assert.match(body, /Never ask the user or Aro for a `batch_id`/);
    assert.match(body, /report NEEDS_INPUT to Aro naming the field/);
    assert.doesNotMatch(body, /Confirm the exact supplied `run_id`, `scope_id`, and `batch_id`/);
});

test('ADO collector reports a tool as not exposed only from an actual invocation result', async () => {
    const { body } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.match(body, /Report a name as not exposed only from its actual invocation result/);
    assert.match(body, /A missing exact tool is `BLOCKED`/);
});

test('expert returns collection gaps to Aro and never asks the user for campaign, run, scope, or batch identifiers', async () => {
    const { body } = await agent('ProjectAssessmentExpert');
    assert.match(body, /Never ask the user for campaign, run, scope, or batch identifiers/);
    assert.match(body, /report that as a collection gap to Aro/);
});

test('ingestion contract makes the owning collector allocate batch_id per source batch', async () => {
    const { body } = await load(INGESTION);
    assert.match(body, /The collector that owns the batch allocates it; neither Aro nor the user supplies it/);
});

test('authentication is server context and exact bound tool availability remains independently required', async () => {
    const { body: collector } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.match(collector, /P1 makes no mutation/);
    assert.match(collector, /Authentication\/authorization failures are `BLOCKED` or explicit `DENIED`/);
    assert.match(collector, /Only the exact tool name plus a read-only schema\/action exposed in this invocation authorizes a call/);
    const { body: ingestion } = await load(INGESTION);
    assert.match(ingestion, /Authentication or server availability is not evidence of read-only capability/);
    assert.match(ingestion, /Invoke only an exact allowlisted operation with valid arguments/);
});

test('authenticated plus exact read-only inventory dispatches only the read-only Azure DevOps collector', async () => {
    const { metadata, body: advisor } = await agent('ProjectAssessmentAdvisor');
    assert.deepEqual(metadata.tools, []);
    assert.match(advisor, /selects ProjectEvidenceAzureDevOpsCollector when that candidate is supplied, even if the server is only authenticated/);
    assert.match(advisor, /never a collector and never InfraAzureDevOpsAgent for collection/);
});

test('Azure DevOps collector has only exact read tools with no wildcard, mutation, or InfraAzureDevOpsAgent entries', async () => {
    const { metadata, body } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.deepEqual(metadata.tools, ADO_COLLECTOR_TOOLS);
    assert.ok(!metadata.tools.some(tool => /\*|InfraAzureDevOps|create|update|delete|queue|approve|merge|cancel|link/i.test(tool)));
    assert.match(body, /Never use a wildcard, unlisted tool, shell command, `InfraAzureDevOpsAgent`, or MCP configuration\/profiles/);
    assert.match(body, /For grouped\/mixed tools, inspect the schema and use only a read enum explicitly confirmed by that schema/);
    assert.match(body, /Only the exact tool name plus a read-only schema\/action exposed in this invocation authorizes a call/);
});

// Fixture flags describe invocation outcomes from the collector's own direct read; no runtime is exercised here.
const ADO_INVOCATION_CASES = [
    { name: 'entire category invocation returns tool-not-found', invocation: 'TOOL_NOT_FOUND', outcome: 'BLOCKED_SOURCE_UNAVAILABLE' },
    { name: 'exact invocation succeeds with canonical records', invocation: 'SUCCESS_CANONICAL', outcome: 'P5_ELIGIBLE' },
    { name: 'exact invocation succeeds with unreadable data', invocation: 'SUCCESS_UNREADABLE', outcome: 'DATA_FORMAT' }
];
const ADO_INVOCATION_CONTRACT = {
    BLOCKED_SOURCE_UNAVAILABLE: { collector: /An actual tool-not-found\/unavailable result|If the entire category surface is absent or unreadable/ },
    P5_ELIGIBLE: { collector: /Every evidence record carries `batch_id`, `run_id`, `scope_id`/ },
    DATA_FORMAT: { collector: /A page externalized, unreadable, truncated, or noncanonical/ }
};
const adoInvocationOutcome = ({ invocation }) => {
    if (invocation === 'TOOL_NOT_FOUND') return 'BLOCKED_SOURCE_UNAVAILABLE';
    if (invocation === 'SUCCESS_UNREADABLE') return 'DATA_FORMAT';
    return 'P5_ELIGIBLE';
};

test('ADO invocation fixtures map actual failures and data outcomes without InfraAzureDevOpsAgent substitution', async () => {
    const { body: collector } = await agent('ProjectEvidenceAzureDevOpsCollector');
    const outcomes = new Set();
    for (const testCase of ADO_INVOCATION_CASES) {
        const outcome = adoInvocationOutcome(testCase);
        assert.equal(outcome, testCase.outcome, `${testCase.name}: fixture must classify as ${testCase.outcome}`);
        outcomes.add(outcome);
        assert.match(collector, ADO_INVOCATION_CONTRACT[outcome].collector, `${testCase.name}: collector must document ${outcome}`);
    }
    assert.equal(outcomes.size, 3, 'fixtures must cover three distinct outcomes');
    assert.match(collector, /Never use a wildcard, unlisted tool, shell command, `InfraAzureDevOpsAgent`/);
    assert.match(collector, /If the entire category surface is absent or unreadable, report that precise source blocker/);
});

test('ADO direct invocation keeps missing categories independent from verified categories', async () => {
    const { body: collector } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.match(collector, /Do not inventory or preflight tool exposure/);
    assert.match(collector, /A category is collected independently/);
    assert.match(collector, /actual tool-not-found\/unavailable result blocks only that category/);
    assert.match(collector, /If the entire category surface is absent or unreadable, report that precise source blocker/);
});

test('ADO direct invocation uses exact read tools and schemas without chat-established bindings', async () => {
    const { metadata, body: collector } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.deepEqual(metadata.tools, ADO_COLLECTOR_TOOLS);
    assert.match(collector, /Validate the requested category scopes and exact allowlisted operation arguments/);
    assert.match(collector, /Do not inventory or preflight tool exposure/);
    assert.match(collector, /Only the exact tool name plus a read-only schema\/action exposed in this invocation authorizes a call/);
    assert.match(collector, /P1 makes no mutation/);
    assert.match(collector, /Authentication\/authorization failures are `BLOCKED` or explicit `DENIED`/);
    const maintenance = await read('docs/maintenance.md');
    assert.match(maintenance, /chat validation does not establish them/);
});

test('ADO large responses follow exhaustive page markers, compact canonical records, and UNKNOWN repository inventory', async () => {
    const { body: collector } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.match(collector, /Use schema-provided page-size and continuation parameters only/);
    assert.match(collector, /Paginate every accepted category until the source is exhausted or a concrete blocker is reached/);
    assert.match(collector, /Record exact category scope, query, page\/offset or continuation state, result count, exhaustion evidence, and stop reason/);
    assert.match(collector, /navigation ledger entries and page\/final-page markers/);
    assert.match(collector, /Every evidence record carries `batch_id`, `run_id`, `scope_id`/);
    assert.match(collector, /No fixed item\/page\/result cap applies/);
    assert.match(collector, /A page externalized, unreadable, truncated, or noncanonical makes that batch `PARTIAL` or `BLOCKED` with `DATA_FORMAT`; exclude unread records from P5/);
    assert.match(collector, /An actual tool-not-found\/unavailable result is `BLOCKED`/);
    assert.match(collector, /Repository inventory requires a schema-verified read-only `ado-remote-mcp\/repo_repository` action/);
    assert.match(collector, /infer repository inventory from commits, search hits, or text names/);
});

test('every applicable collector and the ingestion skill require exhaustive no-cap collection and usage-signal coverage', async () => {
    const skill = await read('skills/project-evidence-ingestion/SKILL.md');
    assert.match(skill, /Too much read-only collection is never a problem/i);
    assert.match(skill, /usage, adoption, activity, and decision signals/i);
    assert.match(skill, /arbitrary item, page, document, or continuation count/i);
    assert.match(skill, /UNKNOWN` or `BLOCKED/i);

    for (const name of COLLECTORS) {
        const { body } = await agent(name);
        assert.match(body, /Collect exhaustively|Collection is exhaustive|Paginate every accepted category/i, `${name}: must state exhaustive or paginated collection`);
        assert.match(body, /usage, adoption, activity|usage.*decision signals/i, `${name}: must collect usage/adoption/activity/decision signals where exposed`);
        assert.match(body, /No fixed per-source item maximum|No fixed item\/page\/result cap applies|no arbitrary item/i, `${name}: must forbid a fixed collection cap`);
        assert.match(body, /UNKNOWN` or `BLOCKED|UNKNOWN or `BLOCKED|UNKNOWN\/BLOCKED/i, `${name}: unavailable categories must remain UNKNOWN/BLOCKED`);
    }
});

test('ADO collector and Aro ADO guidance define no arbitrary result cap', async () => {
    const { body: collector } = await agent('ProjectEvidenceAzureDevOpsCollector');
    const { body: aro } = await agent('Aro');
    assert.doesNotMatch(collector, ADO_RESULT_CAP, 'ADO collector must not define a top-N, first-page, or one-continuation cap');
    assert.match(collector, /Paginate every accepted category until the source is exhausted or a concrete blocker is reached/);
    const adoLines = aro.split('\n').filter(line => /ado-remote-mcp|Azure DevOps|\bADO\b/.test(line));
    for (const line of adoLines) {
        assert.doesNotMatch(line, ADO_RESULT_CAP, `Aro ADO guidance must not define a result cap: ${line.slice(0, 80)}`);
    }
});

test('supplied ado-remote-mcp server, organization, and project facts are never re-asked', async () => {
    const { body: collector } = await agent('ProjectEvidenceAzureDevOpsCollector');
    assert.match(collector, /Organization and project are invocation inputs supplied by Aro as `<ORGANIZATION_INPUT>\/<PROJECT_INPUT>`/);
    assert.match(collector, /match the actual response exactly/);
    assert.match(collector, /If either is missing, report NEEDS_INPUT/);
});

test('exact French continuation prompt has sufficient intake and constrained partial continuation', async () => {
    const { body: advisor } = await agent('ProjectAssessmentAdvisor');
    const { body: local } = await agent('ProjectEvidenceLocalRepoCollector');
    const { body: skill } = await load(SKILL);
    const guide = await read('docs/advanced-task-prompts.md');

    assert.match(advisor, /continuation request that says project documents are already ingested/);
    assert.match(advisor, /continuation that supplies the open project root|supplied open project root|resolved open repository/);
    assert.match(local, /A user statement that documents are already ingested/);
    assert.match(skill, /continuation prompt means resume prior assessment work rather than start blank/);
    assert.match(skill, /constrained continuation/);
    assert.match(guide, /Continue la génération d'une évaluation complète du projet/);
    assert.match(guide, /https:\/\/dev\.azure\.com\/\{organization\}\/\{project\}/);
    assert.match(guide, /Source: https:\/\/\{site-url\}/);
    assert.doesNotMatch(guide, /ITQ-SEAO|SEAO|spgouvqc|MCN-SEAO-Maintenance-volution/i);
    assert.match(guide, /Prior reports are context only/);
    assert.match(guide, /Persistence does not need a separate save-confirmation question/);

    assert.match(skill, /no health or completeness score while any in-scope source is incomplete/);
});

test('assessment skill reports one ADO inventory gap in P8 and keeps authenticated records separate from verification', async () => {
    const { body } = await load(SKILL);
    assert.match(body, /Authentication or server availability is context only, never proof of read-only capability/);
    assert.match(body, /continue other sources/);
    assert.match(body, /without serial prompts|one inventory gap once/);
});

test('source failures do not stop P5/P6 and zero records yield a status-only package', async () => {
    const { body: skill } = await load(SKILL);
    const { body: ingestion } = await load('skills/project-evidence-ingestion/SKILL.md');

    assert.match(skill, /A remote source that is unavailable remains BLOCKED/);
    assert.match(skill, /zero valid records/);
    assert.match(ingestion, /unreadable continuation only blocks its own source/);
});

test('progress checkpoints use exactly one append-only log per run with a replaced summary', async () => {
    const { body: skill } = await load(SKILL);
    const { body: ingestion } = await load('skills/project-evidence-ingestion/SKILL.md');
    const { body: writer } = await agent('GovDocumentationSuiteGenerator');
    const maintenance = await read('docs/maintenance.md');

    for (const text of [skill, ingestion, writer, maintenance]) {
        assert.match(text, /checkpoints\/progress-checkpoint\.md/);
    }
    assert.match(writer, /Progress log: write only the exact/);
    assert.match(writer, /sole exception to the no-overwrite rule/);
    assert.match(skill, /collect only deltas/i);
    assert.match(skill, /Never overwrite prior entries, create per-stage files/);
    assert.match(ingestion, /partial or summary-only collector results only as status\/context/i);
});

test('no assessment document expects per-stage or suffixed checkpoint files', async () => {
    const { body: skill } = await load(SKILL);
    const { body: ingestion } = await load('skills/project-evidence-ingestion/SKILL.md');
    const { body: writer } = await agent('GovDocumentationSuiteGenerator');
    const { body: expert } = await agent('ProjectAssessmentExpert');
    const maintenance = await read('docs/maintenance.md');

    for (const text of [skill, ingestion, writer, expert, maintenance]) {
        const mentions = text.match(/[^\n]*progress-checkpoint-after[^\n]*/g) ?? [];
        for (const line of mentions) {
            assert.match(line, /\b(?:never|not|avoid|no)\b/i, `suffixed checkpoint file must only be prohibited: ${line.slice(0, 120)}`);
        }
        assert.doesNotMatch(text, /checkpoints\/(?!progress-checkpoint\.md)[\w-]+\.md/, 'only the single progress log may be a checkpoint file');
    }
});

test('checkpoint writes need explicit authorization, stay separate from P7, and exclude local source by default', async () => {
    const { body: skill } = await load(SKILL);
    const { body: writer } = await agent('GovDocumentationSuiteGenerator');

    assert.match(skill, /checkpoints.*explicitly authorizes it|explicit save authorization naming the exact run root and write-list/i);
    assert.match(skill, /P7 report persistence is independent and authorized by default/);
    assert.match(writer, /only with explicit checkpoint save authorization/);
});

test('writer pins per-file delivered, conflict, mismatch, and not-written reporting with read-back comparison', async () => {
    const { body: writer } = await agent('GovDocumentationSuiteGenerator');
    const { body: skill } = await load(SKILL);
    assert.match(writer, /Read back every package file, including `executive-decision\.html`, and compare it with the content received/);
    assert.match(writer, /Maintain a root index naming every artifact and its status beneath this root, including final reports, standalone HTML, validation log, and progress checkpoint/);
    assert.match(writer, /Report exact relative paths and per-file status for delivered, conflict, mismatch, or not written\./);
    assert.match(writer, /If a path exists with different content, do not overwrite it\. Report the conflict with both paths and skip that file\./);
    assert.match(writer, /Report the conflict and leave existing content unchanged\./);
    assert.match(skill, /Read back every file at the same version and verify content, links, IDs\/citations, and package completeness/);
});

test('inline fallback returns the full package when the writer is unavailable or read-back fails', async () => {
    const { body: skill } = await load(SKILL);
    const { body: writer } = await agent('GovDocumentationSuiteGenerator');
    assert.match(skill, /Aro dispatches `GovDocumentationSuiteGenerator`; otherwise, or if persistence\/read-back fails, return the complete package content in chat\./);
    assert.match(writer, /If this session has no write tool, write nothing, report persistence as untested and not performed, and return the content to Aro\./);
});
