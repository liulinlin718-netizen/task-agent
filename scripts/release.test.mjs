import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { aggregate, expectedAssets, fileRecord, inspectInstaller, preflight, publish, releaseNotes, stage, targets } from './release.mjs';

const version = '2.1.0';
const tag = `v${version}`;
const commit = 'a'.repeat(40);

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'taskagent-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version, build: { productName: 'TaskAgent', artifactName: '${productName}-${version}-${os}-${arch}.${ext}' } }));
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }));
  await writeFile(path.join(root, 'CHANGELOG.md'), `# Changes\n\n## [${version}] - 2026-09-11\n\nRelease features.\n\n## [2.0.0] - 2026-05-12\n\nOld release.\n`);
  await mkdir(path.join(root, 'release', 'downloads'), { recursive: true });
  return preflight(root, tag, commit);
}

async function installers(config) {
  for (const target of targets) {
    for (const name of expectedAssets(version, target)) {
      const bytes = Buffer.alloc(2048, 1);
      if (name.endsWith('.dmg')) bytes.write('koly', bytes.length - 512);
      if (name.endsWith('.zip')) bytes.writeUInt32LE(0x04034b50, 0);
      if (name.endsWith('.exe')) bytes.write('MZ', 0);
      await writeFile(path.join(config.root, 'release', name), bytes);
    }
    const directory = await stage(config, target);
    await rename(directory, path.join(config.root, 'release', 'downloads', `release-${target}`));
  }
}

async function remoteFixture(config, options = {}) {
  await installers(config);
  await aggregate(config);
  const directory = path.join(config.root, 'release', 'publish');
  const records = await Promise.all((await readdir(directory)).map(name => fileRecord(path.join(directory, name))));
  const calls = [];
  let created = false;
  const remote = { draft: true, tag_name: tag, target_commitish: commit, body: config.notes,
    assets: records.map(record => ({ name: record.name, size: record.size, digest: `sha256:${record.sha256}`, state: 'uploaded' })) };
  const run = args => {
    calls.push(args);
    if (args[0] === 'api' && args[1].includes('/commits/')) return options.changedTag && created ? 'b'.repeat(40) : commit;
    if (args[0] === 'api' && args[1] === 'graphql') return JSON.stringify({ data: { repository: { release: created || options.existing ? { databaseId: 123 } : null } } });
    if (args[0] === 'api' && args[1].endsWith('/releases/123')) return JSON.stringify(options.remote ?? remote);
    if (args[0] === 'release' && args[1] === 'create') { assert.ok(args.includes('--draft')); created = true; return ''; }
    if (args[0] === 'release' && args[1] === 'upload') { if (options.uploadFailure) throw new Error('Upload failed'); return ''; }
    if (args[0] === 'release' && args[1] === 'download') {
      const destination = args[args.indexOf('--dir') + 1];
      for (const name of readdirSync(directory)) copyFileSync(path.join(directory, name), path.join(destination, name));
      if (options.corruptDownload) writeFileSync(path.join(destination, records[0].name), 'corrupted');
      return '';
    }
    if (args[0] === 'release' && args[1] === 'edit') return '';
    assert.fail(`Unexpected command: ${args.join(' ')}`);
  };
  return { calls, remote, run, env: { GITHUB_ACTIONS: 'true', GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: tag, GITHUB_REPOSITORY: 'owner/repo' } };
}

test('release notes select exactly the tagged version, excluding previous history', () => {
  const text = '# Changes\r\n## [2.1.0] - 2026-09-11\r\n\r\nNew features.\r\n## [2.0.0]\r\nOld features.';
  assert.equal(releaseNotes(text, version), 'New features.\n');
  assert.throws(() => releaseNotes(text, '2.2.0'), /exactly one/);
  assert.throws(() => releaseNotes(`${text}\n## [2.1.0]\nDuplicate`, version), /exactly one/);
  assert.throws(() => releaseNotes('## [2.1.0]\n\n', version), /empty/);
});

test('preflight refuses tag/version and lockfile mismatches', async t => {
  const config = await fixture(t);
  await assert.rejects(preflight(config.root, 'v2.0.0', commit), /exactly match/);
  await writeFile(path.join(config.root, 'package-lock.json'), JSON.stringify({ version: '2.0.0' }));
  await assert.rejects(preflight(config.root, tag, commit), /Lockfile version/);
});

test('all native manifests combine to five verified installers and exact checksums', async t => {
  const config = await fixture(t);
  await installers(config);
  const records = await aggregate(config);
  assert.equal(records.length, 5);
  assert.equal((await readdir(path.join(config.root, 'release', 'publish'))).length, 6);
  assert.equal(await readFile(path.join(config.root, 'release', 'publish', 'SHA256SUMS.txt'), 'utf8'), records.map(record => `${record.sha256}  ${record.name}\n`).join(''));
  assert.equal(await readFile(path.join(config.root, 'release', 'release-notes.md'), 'utf8'), 'Release features.\n');
});

test('incomplete platform sets cannot reach publication staging', async t => {
  const config = await fixture(t);
  await installers(config);
  await rm(path.join(config.root, 'release', 'downloads', 'release-win-x64'), { recursive: true });
  await assert.rejects(aggregate(config), /All three/);
  await assert.rejects(readdir(path.join(config.root, 'release', 'publish')), { code: 'ENOENT' });
});

test('a changed byte or unexpected asset is rejected before any publication staging', async t => {
  const config = await fixture(t);
  await installers(config);
  const directory = path.join(config.root, 'release', 'downloads', 'release-mac-arm64');
  const name = expectedAssets(version, 'mac-arm64')[0];
  const file = path.join(directory, name);
  const bytes = await readFile(file); bytes[300] ^= 1; await writeFile(file, bytes);
  await assert.rejects(aggregate(config), /checksum mismatch/);
  await copyFile(path.join(config.root, 'release', name), file);
  await writeFile(path.join(directory, 'unexpected.txt'), 'extra');
  await assert.rejects(aggregate(config), /Unexpected assets/);
});

test('mixed commits are rejected even if installer hashes are valid', async t => {
  const config = await fixture(t);
  await installers(config);
  const file = path.join(config.root, 'release', 'downloads', 'release-win-x64', 'manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8')); manifest.commit = 'b'.repeat(40);
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(aggregate(config), /same checked-out commit/);
});

test('a renamed text file cannot pass installer checks', async t => {
  const config = await fixture(t);
  for (const extension of ['dmg', 'zip', 'exe']) {
    const file = path.join(config.root, `fake.${extension}`);
    await writeFile(file, Buffer.alloc(2048));
    await assert.rejects(inspectInstaller(file), /Invalid/);
  }
});

test('successful publication creates a draft and verifies downloaded bytes before the final publish', async t => {
  const config = await fixture(t);
  const remote = await remoteFixture(config);
  await publish(config, remote);
  const mutations = remote.calls.filter(args => args[0] === 'release').map(args => args[1]);
  assert.deepEqual(mutations, ['create', 'upload', 'download', 'edit']);
  assert.ok(remote.calls.at(-1).includes('--draft=false'));
});

test('existing releases are refused without any mutation', async t => {
  const config = await fixture(t);
  const remote = await remoteFixture(config, { existing: true });
  await assert.rejects(publish(config, remote), /already exists/);
  assert.equal(remote.calls.filter(args => args[0] === 'release').length, 0);
});

for (const failure of ['uploadFailure', 'corruptDownload', 'changedTag']) {
  test(`${failure} leaves the release unpublished`, async t => {
    const config = await fixture(t);
    const remote = await remoteFixture(config, { [failure]: true });
    await assert.rejects(publish(config, remote));
    assert.equal(remote.calls.some(args => args[0] === 'release' && args[1] === 'edit'), false);
  });
}

test('remote checksum or asset omissions block publication', async t => {
  const config = await fixture(t);
  const remote = await remoteFixture(config);
  remote.remote.assets[0].digest = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(publish(config, remote), /Remote checksum mismatch/);
  assert.equal(remote.calls.some(args => args[1] === 'edit'), false);
});

test('changed local bytes after aggregation cannot create a draft', async t => {
  const config = await fixture(t);
  const remote = await remoteFixture(config);
  const file = path.join(config.root, 'release', 'publish', expectedAssets(version, 'win-x64')[0]);
  const bytes = readFileSync(file); bytes[400] ^= 1; await writeFile(file, bytes);
  await assert.rejects(publish(config, remote), /bytes changed/);
  assert.equal(remote.calls.some(args => args[0] === 'release'), false);
});
