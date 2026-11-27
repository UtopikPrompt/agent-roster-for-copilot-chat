import assert from 'node:assert/strict';
import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

export const root = fileURLToPath(new URL('../', import.meta.url));

export function parseCustomization(text, filename) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
    assert.ok(match, `${filename}: missing YAML frontmatter`);
    const document = parseDocument(match[1], { uniqueKeys: true });
    assert.equal(document.errors.length, 0, `${filename}: ${document.errors.join(', ')}`);
    const metadata = document.toJS();
    assert.ok(metadata && typeof metadata === 'object', `${filename}: invalid metadata`);
    assert.ok(typeof metadata.name === 'string' && metadata.name.trim(), `${filename}: missing name`);
    assert.ok(typeof metadata.description === 'string' && metadata.description.trim(), `${filename}: missing description`);
    assert.ok(match[2].trim(), `${filename}: empty procedure`);
    return { metadata, body: match[2] };
}

export function resolveAsset(base, relativePath) {
    assert.equal(typeof relativePath, 'string', 'Asset path must be a string');
    assert.ok(!path.isAbsolute(relativePath) && !relativePath.includes('\\'), `Nonportable path: ${relativePath}`);
    const resolved = path.resolve(base, relativePath);
    assert.ok(resolved.startsWith(`${path.resolve(base)}${path.sep}`), `Path escapes package: ${relativePath}`);
    return resolved;
}

async function filesUnder(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const groups = await Promise.all(entries.map(async entry => {
        const filename = path.join(directory, entry.name);
        assert.ok(!entry.isSymbolicLink(), `Symlink is not portable: ${filename}`);
        return entry.isDirectory() ? filesUnder(filename) : [filename];
    }));
    return groups.flat();
}

export async function validate(base = root) {
    const manifest = JSON.parse(await readFile(path.join(base, 'package.json'), 'utf8'));
    const agentEntries = manifest.contributes.chatAgents;
    const skillEntries = manifest.contributes.chatSkills;
    assert.ok(agentEntries.length > 0, 'No agents contributed');
    assert.ok(skillEntries.length > 0, 'No skills contributed');
    const names = new Set();
    const skillNames = new Set();
    const contributed = new Set();
    const agents = [];
    const allFiles = [...await filesUnder(path.join(base, 'agents')), ...await filesUnder(path.join(base, 'skills'))];

    for (const [kind, entries] of [['agent', agentEntries], ['skill', skillEntries]]) {
        for (const entry of entries) {
            const filename = resolveAsset(base, entry.path);
            assert.equal(await realpath(filename), filename, `Unexpected asset indirection: ${entry.path}`);
            assert.ok(!contributed.has(filename), `Duplicate contribution: ${entry.path}`);
            contributed.add(filename);
            const text = await readFile(filename, 'utf8');
            const { metadata, body } = parseCustomization(text, entry.path);
            assert.ok(!names.has(metadata.name), `Duplicate name: ${metadata.name}`);
            names.add(metadata.name);
            assert.ok(!/[A-Za-z]:[\\/](?:Users|home)[\\/]|\/Users\/|\/home\//i.test(text), `${entry.path}: personal absolute path`);
            if (kind === 'agent') {
                assert.equal(path.basename(filename), `${metadata.name}.agent.md`);
                assert.ok(Array.isArray(metadata.tools), `${entry.path}: missing tool restrictions`);
                if (metadata.name.endsWith('Advisor')) assert.deepEqual(metadata.tools, [], `${metadata.name}: advisor must be tool-free`);
                if (metadata.name !== 'Aro') {
                    assert.ok(!metadata.tools.some(tool => /^(agent|runSubagent)(\/|$)/.test(tool)), `${metadata.name}: nested delegation`);
                    assert.ok(!metadata.agents || metadata.agents.length === 0, `${metadata.name}: worker allowlist`);
                }
                if (metadata.model !== undefined) {
                    const models = Array.isArray(metadata.model) ? metadata.model : [metadata.model];
                    assert.ok(models.length > 0 && models.every(model => typeof model === 'string' && model.trim()), `${metadata.name}: invalid model preference`);
                }
                agents.push({ metadata, body });
            } else {
                assert.equal(path.basename(filename), 'SKILL.md');
                assert.equal(path.basename(path.dirname(filename)), metadata.name, `${entry.path}: skill directory/name mismatch`);
                assert.match(metadata.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
                assert.ok(metadata.name.length <= 64 && metadata.description.length <= 1024, `${entry.path}: oversized skill metadata`);
                skillNames.add(metadata.name);
            }
            for (const link of body.matchAll(/\]\(([^\s)#]+)(?:#[^\s)]*)?\)/g)) {
                if (/^(?:https?:|mailto:)/.test(link[1])) continue;
                const target = path.relative(base, path.resolve(path.dirname(filename), decodeURIComponent(link[1])));
                await realpath(resolveAsset(base, target.split(path.sep).join('/')));
            }
        }
    }
    for (const filename of allFiles.filter(filename => filename.endsWith('.agent.md') || path.basename(filename) === 'SKILL.md')) {
        assert.ok(contributed.has(filename), `Unregistered customization: ${path.relative(base, filename)}`);
    }
    const dispatcher = agents.find(agent => agent.metadata.name === 'Aro');
    assert.ok(dispatcher, 'Missing Aro');
    const expected = agents.filter(agent => agent !== dispatcher).map(agent => agent.metadata.name).sort();
    assert.deepEqual([...dispatcher.metadata.agents].sort(), expected, 'Dispatcher allowlist must match roster');
    for (const name of expected) assert.ok(dispatcher.body.includes(name), `Missing routing cue: ${name}`);
    const extractions = JSON.parse(await readFile(path.join(base, 'scripts', 'extraction-map.json'), 'utf8'));
    for (const extraction of extractions) {
        assert.ok(skillNames.has(extraction.skill), `Unregistered extracted skill: ${extraction.skill}`);
        assert.ok(extraction.agents.length > 0, `Unused extracted skill: ${extraction.skill}`);
        for (const name of extraction.agents) {
            const agent = agents.find(agent => agent.metadata.name === name);
            assert.ok(agent, `Unknown extraction consumer: ${name}`);
            assert.ok(agent.body.includes(`](../skills/${extraction.skill}/SKILL.md)`), `${name}: missing skill link`);
            assert.equal([...agent.body.matchAll(/^## Skill Loading\r?$/gm)].length, 1, `${name}: expected exactly one skill-loading policy`);
            const loading = agent.body.split(/^## Skill Loading\r?$/m)[1].split(/^## /m)[0];
            assert.match(loading, /not target-workspace-relative/, `${name}: ambiguous skill path base`);
            assert.match(loading, /runtime-discovered location/, `${name}: missing skill discovery guidance`);
            assert.match(loading, /return the skill name and failed lookup to Aro/, `${name}: missing procedure recovery handoff`);
            for (const heading of extraction.sections) {
                const section = agent.body.split(`## ${heading}\n`)[1]?.split(/^## /m)[0];
                if (section) {
                    assert.ok(section.trim().startsWith('When this workflow is relevant, read and follow the bundled ['), `${name}: duplicated extracted section ${heading}`);
                    assert.ok(!/^(?:\d+\.|-) /m.test(section), `${name}: inline procedure duplicates ${extraction.skill}`);
                }
            }
        }
    }
    return { agents: agentEntries.length, skills: skillEntries.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const counts = await validate();
        console.log(`Validated ${counts.agents} agents and ${counts.skills} skills.`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}