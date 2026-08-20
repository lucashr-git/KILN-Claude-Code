import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install, pathsFor, rollback, runPreflight } from '../bin/kiln.mjs';

function fakeCommandRunner({ jq = true, calls = [] } = {}) {
  let marketplace = null;
  let plugin = null;
  return async (command, args = [], options = {}) => {
    calls.push({ command, args, options });
    if (command === 'jq' && !jq) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    if (command === 'npm' && args[0] === 'ci') {
      await mkdir(join(options.cwd, 'node_modules', '.bin'), { recursive: true });
      const electron = join(options.cwd, 'node_modules', '.bin', 'electron');
      await writeFile(electron, '#!/bin/sh\n');
      await chmod(electron, 0o755);
    }
    if (command.endsWith('/electron')) return { stdout: 'v33.4.11\n', stderr: '' };
    if (command === 'claude' && args.join(' ') === 'plugin marketplace list --json') {
      return { stdout: JSON.stringify(marketplace ? [marketplace] : []), stderr: '' };
    }
    if (command === 'claude' && args.join(' ') === 'plugin list --json') {
      return { stdout: JSON.stringify(plugin ? [plugin] : []), stderr: '' };
    }
    if (command === 'claude' && args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
      marketplace = { name: 'kiln-cc', source: 'directory', path: args[3] };
    }
    if (command === 'claude' && args[0] === 'plugin' && args[1] === 'install') {
      plugin = { name: 'kiln', version: '0.1.0', source: marketplace?.path, scope: 'user' };
    }
    if (command === 'claude' && args[0] === 'plugin' && args[1] === 'uninstall') plugin = null;
    return { stdout: '', stderr: '' };
  };
}

async function createPayload(source) {
  await mkdir(join(source, 'plugin', 'companion'), { recursive: true });
  await mkdir(join(source, 'plugin', '.claude-plugin'), { recursive: true });
  await mkdir(join(source, '.claude-plugin'), { recursive: true });
  await writeFile(join(source, 'plugin', 'companion', 'package.json'), '{}');
  await writeFile(join(source, 'plugin', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'kiln', version: '0.1.0' }));
  await writeFile(join(source, '.claude-plugin', 'marketplace.json'), '{}');
}

test('preflight aceita macOS sem Homebrew quando jq já existe', async () => {
  const result = await runPreflight({
    platform: 'darwin',
    deps: { runCommand: async (command) => {
      if (command === 'brew') throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return { stdout: '', stderr: '' };
    } },
  });
  assert.equal(result.ok, true);
});

test('preflight é mockável e anuncia instalação de jq no dry-run', async () => {
  const calls = [];
  const messages = [];
  const result = await runPreflight({
    platform: 'darwin',
    dryRun: true,
    deps: { runCommand: fakeCommandRunner({ jq: false, calls }) },
    logger: { info: (message) => messages.push(message), warn: (message) => messages.push(message) },
  });

  assert.equal(result.ok, true);
  assert.match(messages.join('\n'), /brew install jq/);
  assert.equal(calls.some(({ command, args }) => command === 'brew' && args[0] === 'install'), false);
});

test('install --dry-run não cria o diretório durável nem toca em ~/.claude', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kiln-test-'));
  const source = join(root, 'source');
  const paths = pathsFor(join(root, 'home'));
  const calls = [];
  const messages = [];
  await createPayload(source);

  try {
    await install({
      dryRun: true,
      platform: 'darwin',
      sourceRoot: source,
      paths,
      deps: {
        runCommand: fakeCommandRunner({ calls }),
        access: (path, mode) => import('node:fs/promises').then(({ access }) => access(path, mode)),
        lstat: (path) => import('node:fs/promises').then(({ lstat }) => lstat(path)),
      },
      logger: { info: (message) => messages.push(message), warn: (message) => messages.push(message) },
    });
    await assert.rejects(stat(paths.durable));
    assert.match(messages.join('\n'), /nenhuma alteração/i);
    assert.equal(calls.some(({ command, args }) => command === 'npm' && args[0] === 'ci'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('install aborta antes do staging quando kiln-cc aponta para outra origem', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kiln-test-'));
  const source = join(root, 'source');
  const paths = pathsFor(join(root, 'home'));
  await createPayload(source);
  const runCommand = async (command, args = [], options = {}) => {
    if (command === 'claude' && args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'list') {
      return { stdout: JSON.stringify([{ name: 'kiln-cc', source: 'directory', path: '/other/kiln' }]), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  try {
    await assert.rejects(
      install({ platform: 'darwin', sourceRoot: source, paths, deps: { ...(await import('node:fs/promises')), runCommand }, logger: { info() {}, warn() {} } }),
      /conflitante/i,
    );
    await assert.rejects(stat(paths.durable));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('install usa staging, npm ci e os comandos do Claude em escopo user', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kiln-test-'));
  const source = join(root, 'source');
  const paths = pathsFor(join(root, 'home'));
  const calls = [];
  await createPayload(source);

  try {
    await install({
      platform: 'darwin',
      sourceRoot: source,
      paths,
      deps: { ...(await import('node:fs/promises')), runCommand: fakeCommandRunner({ calls }) },
      logger: { info() {}, warn() {} },
    });
    assert.equal(await readFile(join(paths.durable, 'plugin', 'companion', 'package.json'), 'utf8'), '{}');
    assert.ok(calls.some(({ command, args }) => command === 'npm' && args[0] === 'ci'));
    assert.ok(calls.some(({ command, args }) => command === 'claude' && args.join(' ') === `plugin marketplace add ${paths.durable} --scope user`));
    assert.ok(calls.some(({ command, args }) => command === 'claude' && args.includes('--scope') && args.includes('user')));
    assert.equal(calls.some(({ command, args }) => command === 'claude' && args.slice(0, 3).join(' ') === 'plugin marketplace list' && args.includes('--scope')), false);
    assert.equal(calls.some(({ command, args }) => command === 'claude' && args.slice(0, 2).join(' ') === 'plugin list' && args.includes('--scope')), false);
    assert.equal(calls.some(({ command, args }) => command === 'claude' && args.slice(0, 4).join(' ') === 'plugin marketplace update' && args.includes('--scope')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('inventory aceita marketplace sem scope quando source aponta para a cópia durável', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kiln-test-'));
  const source = join(root, 'source');
  const paths = pathsFor(join(root, 'home'));
  await createPayload(source);
  let plugin = null;
  const marketplace = { name: 'kiln-cc', source: 'directory', path: paths.durable };
  const base = fakeCommandRunner();
  const runCommand = async (command, args = [], options = {}) => {
    if (command === 'claude' && args.join(' ') === 'plugin marketplace list --json') {
      return { stdout: JSON.stringify([marketplace]), stderr: '' };
    }
    if (command === 'claude' && args.join(' ') === 'plugin list --json') {
      return { stdout: JSON.stringify(plugin ? [plugin] : []), stderr: '' };
    }
    if (command === 'claude' && args[1] === 'install') {
      plugin = { name: 'kiln', version: '0.1.0', source: paths.durable, scope: 'user' };
    }
    return base(command, args, options);
  };
  try {
    await install({ platform: 'darwin', sourceRoot: source, paths, deps: { ...(await import('node:fs/promises')), runCommand }, logger: { info() {}, warn() {} } });
    await stat(paths.durable);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('install normal reinstala quando a versão ativa do cache está antiga', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kiln-test-'));
  const source = join(root, 'source');
  const paths = pathsFor(join(root, 'home'));
  const calls = [];
  await createPayload(source);
  let marketplace = { name: 'kiln-cc', source: paths.durable, scope: 'user' };
  let plugin = { name: 'kiln', version: '0.0.1', source: paths.durable, scope: 'user' };
  const runCommand = async (command, args = [], options = {}) => {
    calls.push({ command, args, options });
    if (command === 'npm' && args[0] === 'ci') {
      await mkdir(join(options.cwd, 'node_modules', '.bin'), { recursive: true });
      const electron = join(options.cwd, 'node_modules', '.bin', 'electron');
      await writeFile(electron, '#!/bin/sh\n');
      await chmod(electron, 0o755);
    }
    if (command.endsWith('/electron')) return { stdout: 'v33.4.11\n', stderr: '' };
    if (command === 'claude' && args.join(' ') === 'plugin marketplace list --json') return { stdout: JSON.stringify([marketplace]), stderr: '' };
    if (command === 'claude' && args.join(' ') === 'plugin list --json') return { stdout: JSON.stringify([plugin]), stderr: '' };
    if (command === 'claude' && args[1] === 'uninstall') plugin = null;
    if (command === 'claude' && args[1] === 'install') plugin = { name: 'kiln', version: '0.1.0', source: paths.durable, scope: 'user' };
    return { stdout: '', stderr: '' };
  };
  try {
    await install({ platform: 'darwin', sourceRoot: source, paths, deps: { ...(await import('node:fs/promises')), runCommand }, logger: { info() {}, warn() {} } });
    assert.ok(calls.some(({ command, args }) => command === 'claude' && args.join(' ') === 'plugin uninstall kiln@kiln-cc --scope user --yes'));
    assert.ok(calls.some(({ command, args }) => command === 'claude' && args.join(' ') === 'plugin install kiln@kiln-cc --scope user --yes'));
    assert.equal(calls.some(({ command, args }) => command === 'claude' && args.join(' ') === 'plugin marketplace update kiln-cc --scope user'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rollback troca a cópia atual e reconcilia o estado do Claude', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kiln-test-'));
  const paths = pathsFor(join(root, 'home'));
  await mkdir(join(paths.durable, 'plugin', 'companion', 'node_modules', '.bin'), { recursive: true });
  await mkdir(join(paths.previous, 'plugin', 'companion', 'node_modules', '.bin'), { recursive: true });
  await mkdir(join(paths.durable, 'plugin', '.claude-plugin'), { recursive: true });
  await mkdir(join(paths.previous, 'plugin', '.claude-plugin'), { recursive: true });
  await writeFile(join(paths.durable, 'plugin', 'companion', 'main.js'), 'new');
  await writeFile(join(paths.previous, 'plugin', 'companion', 'main.js'), 'old');
  await writeFile(join(paths.durable, 'plugin', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'kiln', version: '0.2.0' }));
  await writeFile(join(paths.previous, 'plugin', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'kiln', version: '0.1.0' }));
  for (const companion of [join(paths.durable, 'plugin', 'companion'), join(paths.previous, 'plugin', 'companion')]) {
    const electron = join(companion, 'node_modules', '.bin', 'electron');
    await writeFile(electron, '#!/bin/sh\n');
    await chmod(electron, 0o755);
  }
  try {
    await rollback({
      platform: 'darwin',
      paths,
      deps: { ...(await import('node:fs/promises')), runCommand: fakeCommandRunner() },
      logger: { info() {}, warn() {} },
    });
    assert.equal(await readFile(join(paths.durable, 'plugin', 'companion', 'main.js'), 'utf8'), 'old');
    assert.equal(await readFile(join(paths.previous, 'plugin', 'companion', 'main.js'), 'utf8'), 'new');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejeita symlink em qualquer ancestral do home antes de criar o lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kiln-test-'));
  const home = join(root, 'home');
  const source = join(root, 'source');
  await mkdir(home);
  await createPayload(source);
  await symlink(root, join(home, '.local'));
  const paths = pathsFor(home);
  try {
    await assert.rejects(
      install({ platform: 'darwin', sourceRoot: source, paths, deps: { ...(await import('node:fs/promises')), runCommand: fakeCommandRunner() }, logger: { info() {}, warn() {} } }),
      /simbólico/i,
    );
    await assert.rejects(stat(paths.lock));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('recupera lock sem owner antigo por mtime e não deixa lock após falha inicial', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kiln-test-'));
  const source = join(root, 'source');
  const paths = pathsFor(join(root, 'home'));
  await createPayload(source);
  await mkdir(paths.lock, { recursive: true });
  await writeFile(join(paths.lock, 'owner.json'), '{malformed');
  const old = new Date(Date.now() - 11 * 60 * 1000);
  await utimes(paths.lock, old, old);
  try {
    await install({ platform: 'darwin', sourceRoot: source, paths, deps: { ...(await import('node:fs/promises')), runCommand: fakeCommandRunner() }, logger: { info() {}, warn() {} } });
    await assert.rejects(stat(paths.lock));

    const fs = await import('node:fs/promises');
    const failingDeps = {
      ...fs,
      runCommand: fakeCommandRunner(),
      writeFile: async (path, ...args) => {
        if (path === join(paths.lock, 'owner.json')) throw new Error('owner write failed');
        return fs.writeFile(path, ...args);
      },
    };
    await assert.rejects(install({ platform: 'darwin', sourceRoot: source, paths, deps: failingDeps, logger: { info() {}, warn() {} } }), /owner write failed/);
    await assert.rejects(stat(paths.lock));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pós-instalação aceita marketplace criado com scope user sem scope no inventário', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kiln-test-'));
  const source = join(root, 'source');
  const paths = pathsFor(join(root, 'home'));
  await createPayload(source);
  const calls = [];
  const base = fakeCommandRunner({ calls });
  let added = false;
  const runCommand = async (command, args = [], options = {}) => {
    if (command === 'claude' && args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') added = true;
    if (added && command === 'claude' && args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'list') {
      return { stdout: JSON.stringify([{ name: 'kiln-cc', source: 'directory' }]), stderr: '' };
    }
    return base(command, args, options);
  };
  try {
    await install({ platform: 'darwin', sourceRoot: source, paths, deps: { ...(await import('node:fs/promises')), runCommand }, logger: { info() {}, warn() {} } });
    await stat(paths.durable);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
