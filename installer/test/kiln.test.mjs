import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { install, parseInstallOptions, pathsFor, rollback, runPreflight } from '../bin/kiln.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = join(process.cwd());

async function createFakeCommand(bin, name) {
  const script = name === 'claude'
    ? '#!/bin/sh\nif [ "$1" = "plugin" ] && [ "$2" = "marketplace" ] && [ "$3" = "list" ]; then printf "[]\\n"; elif [ "$1" = "plugin" ] && [ "$2" = "list" ]; then printf "[]\\n"; fi\n'
    : name === 'python3.12'
      ? '#!/bin/sh\nprintf "Python 3.12.0\\n"\n'
      : '#!/bin/sh\nprintf "1.0.0\\n"\n';
  await writeFile(join(bin, name), script);
  await chmod(join(bin, name), 0o755);
}

function fakeCommandRunner({ jq = true, calls = [] } = {}) {
  let marketplace = null;
  let plugin = null;
  return async (command, args = [], options = {}) => {
    calls.push({ command, args, options });
    if (command === 'jq' && !jq) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    if (command === 'python3.12') return { stdout: 'Python 3.12.9\n', stderr: '' };
    if (command === 'python3.13') throw Object.assign(new Error('not found'), { code: 'ENOENT' });
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
  await mkdir(join(source, 'plugin', 'voice'), { recursive: true });
  await writeFile(join(source, 'plugin', 'voice', 'install-voz.sh'), '#!/bin/sh\n');
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

test('flag --without-voice é aceita com --dry-run', () => {
  assert.deepEqual(parseInstallOptions(['--dry-run', '--without-voice']), {
    dryRun: true,
    withoutVoice: true,
  });
  assert.throws(() => parseInstallOptions(['--voice']), /Opção desconhecida/);
});

test('instalador manual rejeita Python 3.14 antes de criar o venv', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kiln-voice-test-'));
  const destination = join(root, 'stt');
  const unsupported = join(root, 'python3.14');
  const script = join(process.cwd(), 'plugin', 'voice', 'install-voz.sh');
  await writeFile(unsupported, '#!/bin/sh\nprintf "3.14\\n"\n');
  await chmod(unsupported, 0o755);

  try {
    let failure;
    try {
      await execFileAsync('bash', [script], {
        env: { ...process.env, HOME: root, KILN_STT_DIR: destination, KILN_PYTHON: unsupported },
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    assert.match(failure.stderr, /Python 3\.12 ou 3\.13 é obrigatório/);
    assert.match(failure.stderr, /brew install python@3\.12/);
    await assert.rejects(stat(destination));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
    assert.match(messages.join('\n'), /download único do modelo de voz Whisper 'small'/i);
    assert.equal(calls.some(({ command, args }) => command === 'npm' && args[0] === 'ci'), false);
    assert.equal(calls.some(({ command }) => command === 'bash'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('install --dry-run anuncia Homebrew para Python quando não há 3.12/3.13', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kiln-test-'));
  const source = join(root, 'source');
  const paths = pathsFor(join(root, 'home'));
  const calls = [];
  const messages = [];
  await createPayload(source);
  const base = fakeCommandRunner({ calls });
  const runCommand = async (command, args = [], options = {}) => {
    if (command === 'python3.12' || command === 'python3.13') {
      calls.push({ command, args, options });
      throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    }
    return base(command, args, options);
  };

  try {
    await install({
      dryRun: true,
      platform: 'darwin',
      sourceRoot: source,
      paths,
      deps: { ...(await import('node:fs/promises')), runCommand },
      logger: { info: (message) => messages.push(message), warn: (message) => messages.push(message) },
    });
    assert.match(messages.join('\n'), /`brew install python@3\.12`/);
    assert.match(messages.join('\n'), /`brew --prefix python@3\.12`/);
    assert.match(messages.join('\n'), /KILN_PYTHON/);
    assert.equal(calls.some(({ command, args }) => command === 'brew' && args.join(' ') === 'install python@3.12'), false);
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
    assert.ok(calls.some(({ command, args }) => command === 'bash' && args[0] === join(paths.durable, 'plugin', 'voice', 'install-voz.sh')));
    assert.ok(calls.some(({ command, args }) => command === 'claude' && args.join(' ') === `plugin marketplace add ${paths.durable} --scope user`));
    assert.ok(calls.some(({ command, args }) => command === 'claude' && args.includes('--scope') && args.includes('user')));
    assert.equal(calls.some(({ command, args }) => command === 'claude' && args.slice(0, 3).join(' ') === 'plugin marketplace list' && args.includes('--scope')), false);
    assert.equal(calls.some(({ command, args }) => command === 'claude' && args.slice(0, 2).join(' ') === 'plugin list' && args.includes('--scope')), false);
    assert.equal(calls.some(({ command, args }) => command === 'claude' && args.slice(0, 4).join(' ') === 'plugin marketplace update' && args.includes('--scope')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('install prepara Python 3.12 via Homebrew e passa KILN_PYTHON para a voz', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kiln-test-'));
  const source = join(root, 'source');
  const paths = pathsFor(join(root, 'home'));
  const calls = [];
  await createPayload(source);
  const base = fakeCommandRunner({ calls });
  const runCommand = async (command, args = [], options = {}) => {
    if (command === 'python3.12' || command === 'python3.13') {
      calls.push({ command, args, options });
      throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    }
    if (command === 'brew' && args.join(' ') === '--prefix python@3.12') {
      calls.push({ command, args, options });
      return { stdout: '/opt/homebrew/opt/python@3.12\n', stderr: '' };
    }
    return base(command, args, options);
  };

  try {
    await install({
      platform: 'darwin',
      sourceRoot: source,
      paths,
      deps: { ...(await import('node:fs/promises')), runCommand },
      logger: { info() {}, warn() {} },
    });
    assert.ok(calls.some(({ command, args }) => command === 'brew' && args.join(' ') === 'install python@3.12'));
    assert.ok(calls.some(({ command, args }) => command === 'brew' && args.join(' ') === '--prefix python@3.12'));
    const voiceCall = calls.find(({ command, args }) => command === 'bash' && args[0].endsWith('/install-voz.sh'));
    assert.equal(voiceCall.options.env.KILN_PYTHON, '/opt/homebrew/opt/python@3.12/bin/python3.12');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('install --without-voice não executa o instalador de voz', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kiln-test-'));
  const source = join(root, 'source');
  const paths = pathsFor(join(root, 'home'));
  const calls = [];
  await createPayload(source);

  try {
    await install({
      platform: 'darwin',
      withoutVoice: true,
      sourceRoot: source,
      paths,
      deps: { ...(await import('node:fs/promises')), runCommand: fakeCommandRunner({ calls }) },
      logger: { info() {}, warn() {} },
    });
    assert.equal(calls.some(({ command }) => command === 'bash'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('falha de voz falha a instalação e reverte a cópia durável', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kiln-test-'));
  const source = join(root, 'source');
  const paths = pathsFor(join(root, 'home'));
  const calls = [];
  await createPayload(source);
  const base = fakeCommandRunner({ calls });
  const runCommand = async (command, args = [], options = {}) => {
    if (command === 'bash') {
      calls.push({ command, args, options });
      throw new Error('download do Whisper falhou');
    }
    return base(command, args, options);
  };

  try {
    await assert.rejects(
      install({ platform: 'darwin', sourceRoot: source, paths, deps: { ...(await import('node:fs/promises')), runCommand }, logger: { info() {}, warn() {} } }),
      /Falha na instalação da voz local|download do Whisper falhou/i,
    );
    await assert.rejects(stat(paths.durable));
    assert.ok(calls.some(({ command }) => command === 'bash'));
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
    if (command === 'python3.12') return { stdout: 'Python 3.12.9\n', stderr: '' };
    if (command === 'python3.13') throw Object.assign(new Error('not found'), { code: 'ENOENT' });
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

test('binário empacotado executa pelo symlink do npm', { skip: platform() !== 'darwin' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'kiln-package-test-'));
  const fakeBin = join(root, 'fake-bin');
  const installRoot = join(root, 'consumer');
  const home = join(root, 'home');

  try {
    await mkdir(fakeBin);
    await createFakeCommand(fakeBin, 'claude');
    await createFakeCommand(fakeBin, 'jq');
    await createFakeCommand(fakeBin, 'python3.12');

    const packed = await execFileAsync('npm', ['pack', '--json', '--pack-destination', root], { cwd: repoRoot });
    const metadata = JSON.parse(packed.stdout);
    assert.equal(metadata.length, 1);
    const archive = join(root, metadata[0].filename);

    await execFileAsync('npm', ['install', '--prefix', installRoot, '--no-save', '--ignore-scripts', archive], { cwd: repoRoot });
    const binary = join(installRoot, 'node_modules', '.bin', 'kiln');
    assert.equal((await lstat(binary)).isSymbolicLink(), true);
    await stat(binary);

    const result = await execFileAsync(binary, ['install', '--dry-run'], {
      cwd: installRoot,
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}${delimiter}${process.env.PATH || ''}`,
      },
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /Dry run: nenhuma alteração foi feita/);
    assert.match(output, /Dry run: payload seria instalado em/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
