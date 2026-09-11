import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const targets = ['mac-arm64', 'mac-x64', 'win-x64'];

export function expectedAssets(version, target) {
  assert.match(version, /^\d+\.\d+\.\d+$/, 'Release version must be stable semver');
  assert.ok(targets.includes(target), `Unknown release target: ${target}`);
  return (target.startsWith('mac-') ? ['dmg', 'zip'] : ['exe'])
    .map(extension => `TaskAgent-${version}-${target}.${extension}`);
}

export function releaseNotes(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const headings = lines.flatMap((line, index) => /^## /.test(line) ? [{ line, index }] : []);
  const matches = headings.filter(({ line }) => /^## \[([^\]]+)\](?: - \d{4}-\d{2}-\d{2})?\s*$/.exec(line)?.[1] === version);
  assert.equal(matches.length, 1, `CHANGELOG.md must contain exactly one ## [${version}] section`);
  const start = matches[0].index;
  const end = headings.find(heading => heading.index > start)?.index ?? lines.length;
  const notes = lines.slice(start + 1, end).join('\n').trim();
  assert.ok(notes.length > 0, 'Release notes must not be empty');
  return `${notes}\n`;
}

export async function preflight(root, tag, commit) {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'Release version must be stable semver');
  assert.equal(tag, `v${pkg.version}`, 'Git tag must exactly match package.json version');
  assert.equal(lock.version, pkg.version, 'Lockfile version differs from package.json');
  assert.equal(lock.packages?.['']?.version, pkg.version, 'Lockfile root package version differs');
  assert.equal(pkg.build?.productName, 'TaskAgent', 'Installer productName changed');
  assert.equal(pkg.build?.artifactName, '${productName}-${version}-${os}-${arch}.${ext}', 'Installer artifactName must include OS and architecture');
  assert.match(commit, /^[a-f\d]{40}$/, 'Expected the exact Git commit SHA');
  const notes = releaseNotes(await readFile(path.join(root, 'CHANGELOG.md'), 'utf8'), pkg.version);
  return { root, tag, commit, version: pkg.version, notes };
}

export async function fileRecord(file) {
  const stat = await lstat(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Expected a regular file: ${file}`);
  assert.ok(stat.size > 0, `Empty release file: ${file}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { name: path.basename(file), size: stat.size, sha256: hash.digest('hex') };
}

export async function inspectInstaller(file) {
  const stat = await lstat(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size >= 1024, `Invalid installer file: ${file}`);
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(64);
    await handle.read(head, 0, head.length, 0);
    if (file.endsWith('.zip')) assert.equal(head.readUInt32LE(0), 0x04034b50, 'Invalid ZIP header');
    else if (file.endsWith('.exe')) assert.equal(head.toString('ascii', 0, 2), 'MZ', 'Invalid Windows executable');
    else if (file.endsWith('.dmg')) {
      const trailer = Buffer.alloc(4);
      await handle.read(trailer, 0, 4, stat.size - 512);
      assert.equal(trailer.toString('ascii'), 'koly', 'Invalid DMG trailer');
    } else assert.fail(`Unexpected installer extension: ${file}`);
  } finally { await handle.close(); }
}

export async function verifyExecutable(target, executable) {
  assert.ok(targets.includes(target), `Unknown target: ${target}`);
  const expectedPlatform = target.startsWith('mac-') ? 'darwin' : 'win32';
  const expectedArch = target.split('-')[1];
  assert.equal(process.platform, expectedPlatform, 'Packaged tests must run on their native OS');
  assert.equal(process.arch, expectedArch, 'Packaged tests must run on their native CPU architecture');
  if (expectedPlatform === 'darwin') {
    const result = spawnSync('lipo', ['-archs', executable], { encoding: 'utf8' });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expectedArch === 'x64' ? 'x86_64' : 'arm64', 'Unexpected Mach-O architecture');
  } else {
    const handle = await open(executable, 'r');
    try {
      const dos = Buffer.alloc(64);
      await handle.read(dos, 0, dos.length, 0);
      assert.equal(dos.toString('ascii', 0, 2), 'MZ');
      const pe = Buffer.alloc(6);
      await handle.read(pe, 0, pe.length, dos.readUInt32LE(60));
      assert.equal(pe.readUInt32LE(0), 0x00004550, 'Invalid PE executable');
      assert.equal(pe.readUInt16LE(4), 0x8664, 'Expected Windows x64 executable');
    } finally { await handle.close(); }
  }
}

export async function stage(config, target) {
  const names = expectedAssets(config.version, target);
  const output = path.join(config.root, 'release', 'staging', target);
  await mkdir(output, { recursive: true });
  assert.equal((await readdir(output)).length, 0, 'Staging directory must be empty');
  const files = [];
  for (const name of names) {
    const source = path.join(config.root, 'release', name);
    await inspectInstaller(source);
    await copyFile(source, path.join(output, name));
    files.push(await fileRecord(path.join(output, name)));
  }
  await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify({ schema: 1, tag: config.tag, commit: config.commit, target, files }, null, 2)}\n`);
  return output;
}

export async function aggregate(config) {
  const input = path.join(config.root, 'release', 'downloads');
  const output = path.join(config.root, 'release', 'publish');
  assert.deepEqual((await readdir(input)).sort(), targets.map(target => `release-${target}`).sort(), 'All three native build artifacts are required');
  const records = [];
  for (const target of targets) {
    const directory = path.join(input, `release-${target}`);
    const names = expectedAssets(config.version, target);
    assert.deepEqual((await readdir(directory)).sort(), [...names, 'manifest.json'].sort(), `Unexpected assets for ${target}`);
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    assert.equal(manifest.schema, 1);
    assert.equal(manifest.tag, config.tag, 'Artifact version differs from release tag');
    assert.equal(manifest.commit, config.commit, 'Artifacts must come from the same checked-out commit');
    assert.equal(manifest.target, target);
    assert.ok(Array.isArray(manifest.files));
    assert.deepEqual(manifest.files.map(file => file.name).sort(), names.sort(), 'Incomplete manifest');
    for (const name of names) {
      const file = path.join(directory, name);
      await inspectInstaller(file);
      const record = await fileRecord(file);
      assert.deepEqual(record, manifest.files.find(item => item.name === name), `Installer checksum mismatch: ${name}`);
      records.push({ ...record, file });
    }
  }
  // Nothing is staged for publication until every manifest and byte stream has passed.
  await mkdir(output, { recursive: true });
  assert.equal((await readdir(output)).length, 0, 'Publish directory must be empty');
  records.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const record of records) await copyFile(record.file, path.join(output, record.name));
  await writeFile(path.join(output, 'SHA256SUMS.txt'), records.map(record => `${record.sha256}  ${record.name}\n`).join(''));
  await writeFile(path.join(config.root, 'release', 'release-notes.md'), config.notes);
  return records;
}

function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `gh ${args.slice(0, 2).join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export function validateRemoteAssets(release, config, expected) {
  assert.equal(release.draft, true, 'Assets may only be added to an unpublished draft');
  assert.equal(release.tag_name, config.tag);
  assert.equal(release.target_commitish, config.commit);
  assert.equal(release.body.trim(), config.notes.trim(), 'Release notes changed');
  assert.deepEqual(release.assets.map(asset => asset.name).sort(), expected.map(file => file.name).sort(), 'Remote release asset set is incomplete');
  for (const record of expected) {
    const remote = release.assets.find(asset => asset.name === record.name);
    assert.equal(remote.state, 'uploaded', `Upload incomplete: ${record.name}`);
    assert.equal(remote.size, record.size, `Remote file size mismatch: ${record.name}`);
    if (remote.digest) assert.equal(remote.digest, `sha256:${record.sha256}`, `Remote checksum mismatch: ${record.name}`);
  }
}

export async function publish(config, { run = gh, env = process.env } = {}) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Publishing is restricted to the release workflow');
  assert.equal(env.GITHUB_REF_TYPE, 'tag');
  assert.equal(env.GITHUB_REF_NAME, config.tag);
  const repo = env.GITHUB_REPOSITORY;
  assert.match(repo ?? '', /^[\w.-]+\/[\w.-]+$/, 'Expected the current GitHub repository');
  const [owner, name] = repo.split('/');
  // REST's /releases/tags lookup only finds published releases. GraphQL also
  // finds drafts, which must never be silently overwritten on a rerun.
  const findRelease = () => {
    const response = JSON.parse(run(['api', 'graphql', '-f',
      'query=query($owner:String!,$name:String!,$tag:String!){repository(owner:$owner,name:$name){release(tagName:$tag){databaseId}}}',
      '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `tag=${config.tag}`]));
    assert.ok(response.data?.repository, 'Could not inspect repository releases');
    return response.data.repository.release?.databaseId ?? null;
  };
  const checkTag = () => assert.equal(run(['api', `repos/${repo}/commits/${config.tag}`, '--jq', '.sha']), config.commit, 'Remote tag no longer identifies the verified commit');
  checkTag();
  assert.equal(findRelease(), null, 'A release already exists for this tag; inspect it instead of overwriting it');
  const directory = path.join(config.root, 'release', 'publish');
  const names = [...targets.flatMap(target => expectedAssets(config.version, target)), 'SHA256SUMS.txt'].sort();
  assert.deepEqual((await readdir(directory)).sort(), names, 'Unexpected publication files');
  const records = await Promise.all(names.map(name => fileRecord(path.join(directory, name))));
  const checksums = records.filter(file => file.name !== 'SHA256SUMS.txt').map(file => `${file.sha256}  ${file.name}\n`).join('');
  assert.equal(await readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8'), checksums, 'Installer bytes changed after aggregation');
  const notesFile = path.join(config.root, 'release', 'release-notes.md');
  assert.equal(await readFile(notesFile, 'utf8'), config.notes);
  run(['release', 'create', config.tag, '--repo', repo, '--verify-tag', '--target', config.commit,
    '--draft', '--title', `TaskAgent ${config.tag}`, '--notes-file', notesFile]);
  const releaseId = findRelease();
  assert.ok(Number.isSafeInteger(releaseId) && releaseId > 0, 'Created draft release was not found');
  const endpoint = `repos/${repo}/releases/${releaseId}`;
  // Any subsequent failure leaves a draft, never a partially public release.
  run(['release', 'upload', config.tag, '--repo', repo, ...names.map(name => path.join(directory, name))]);
  validateRemoteAssets(JSON.parse(run(['api', endpoint])), config, records);
  const downloaded = await mkdtemp(path.join(tmpdir(), 'taskagent-release-verify-'));
  try {
    run(['release', 'download', config.tag, '--repo', repo, '--dir', downloaded]);
    assert.deepEqual((await readdir(downloaded)).sort(), names);
    for (const record of records) assert.deepEqual(await fileRecord(path.join(downloaded, record.name)), record, `Downloaded release checksum mismatch: ${record.name}`);
    // Recheck after the download so an unexpected edit cannot be published silently.
    validateRemoteAssets(JSON.parse(run(['api', endpoint])), config, records);
    checkTag();
    run(['release', 'edit', config.tag, '--repo', repo, '--verify-tag', '--draft=false', '--latest']);
  } finally { await rm(downloaded, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, target, executable] = process.argv.slice(2);
    const config = await preflight(process.cwd(), process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME, process.env.GITHUB_SHA);
    if (command === 'preflight') console.log(`Validated ${config.tag} and its CHANGELOG.md section`);
    else if (command === 'executable') await verifyExecutable(target, path.resolve(executable));
    else if (command === 'stage') { await stage(config, target); console.log(`Validated and hashed ${target} installers`); }
    else if (command === 'aggregate') { await aggregate(config); console.log('Verified five installers from all three native builds'); }
    else if (command === 'publish') { await publish(config); console.log(`Published ${config.tag}: five verified installers and SHA256SUMS.txt`); }
    else throw new Error('Usage: node scripts/release.mjs preflight|executable <target> <path>|stage <target>|aggregate|publish');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
