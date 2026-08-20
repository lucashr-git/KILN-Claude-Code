#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { cp, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { promisify } from 'node:util';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { homedir, platform as hostPlatform } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const PACKAGE_VERSION = '0.1.0';
const ELECTRON_VERSION = '33.4.11';
const MARKETPLACE_NAME = 'kiln-cc';
const PLUGIN_SPEC = `kiln@${MARKETPLACE_NAME}`;

const defaultLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

function defaultRunCommand(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

const defaultDeps = {
  runCommand: defaultRunCommand,
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
};

export function pathsFor(home = homedir()) {
  const dataRoot = resolve(home, '.local', 'share', 'kiln');
  return {
    dataRoot,
    durable: join(dataRoot, 'marketplace'),
    previous: join(dataRoot, 'marketplace.previous'),
    lock: join(dataRoot, 'install.lock'),
  };
}

function commandFailure(error) {
  return error && typeof error === 'object' ? error : new Error(String(error));
}

async function commandAvailable(command, deps) {
  try {
    await deps.runCommand(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check host requirements. The command runner is injected so this can be
 * exercised without installing anything on the caller's machine.
 */
export async function runPreflight({
  platform = hostPlatform(),
  dryRun = false,
  deps = defaultDeps,
  logger = defaultLogger,
} = {}) {
  if (platform !== 'darwin') {
    return {
      ok: false,
      reason: 'unsupported-platform',
      message: `Kiln installer: sistema não suportado (${platform}). Por enquanto, use macOS.`,
    };
  }

  // Homebrew is only needed when jq is absent. A macOS machine with jq from
  // another package manager is a supported installation.
  const required = ['claude', 'node', 'npm'];
  const missing = [];
  for (const command of required) {
    if (!(await commandAvailable(command, deps))) missing.push(command);
  }

  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'missing-prerequisite',
      missing,
      message: `Kiln installer: pré-requisitos ausentes: ${missing.join(', ')}. Instale-os e tente novamente.`,
    };
  }

  const jqAvailable = await commandAvailable('jq', deps);
  if (!jqAvailable) {
    if (!(await commandAvailable('brew', deps))) {
      return {
        ok: false,
        reason: 'missing-prerequisite',
        missing: ['jq', 'brew'],
        message: 'Kiln installer: jq não foi encontrado e Homebrew também não está disponível para instalá-lo.',
      };
    }
    if (dryRun) {
      logger.warn('Ação planejada: jq está ausente; executaria `brew install jq`.');
    } else {
      logger.info('jq não encontrado; executando `brew install jq`...');
      try {
        await deps.runCommand('brew', ['install', 'jq']);
      } catch (error) {
        return {
          ok: false,
          reason: 'jq-install-failed',
          message: `Não foi possível instalar jq via Homebrew: ${formatCommandError(error)}`,
        };
      }
      if (!(await commandAvailable('jq', deps))) {
        return {
          ok: false,
          reason: 'jq-unavailable',
          message: 'Homebrew terminou, mas jq ainda não está disponível no PATH.',
        };
      }
    }
  }

  return { ok: true, jqAvailable };
}

function formatCommandError(error) {
  const failure = commandFailure(error);
  const stderr = typeof failure.stderr === 'string' ? failure.stderr.trim() : '';
  return stderr || failure.message || 'comando falhou';
}

function pathIsInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith('/'));
}

function validatePaths(paths) {
  // Production paths are fixed below ~/.local/share/kiln. Tests may inject a
  // complete temporary path set, but each mutable path must remain in dataRoot.
  if (!paths.dataRoot || !paths.durable || !paths.previous || !paths.lock) {
    throw new Error('Caminhos do instalador incompletos.');
  }
  if (!pathIsInside(paths.dataRoot, paths.durable) || !pathIsInside(paths.dataRoot, paths.previous) || !pathIsInside(paths.dataRoot, paths.lock)) {
    throw new Error('Caminho do instalador fora do diretório de dados permitido.');
  }
  if (resolve(paths.durable) === resolve(paths.previous) || resolve(paths.durable) === resolve(paths.lock)) {
    throw new Error('Caminhos do instalador colidem.');
  }
}

async function assertNoSymlinkComponents(path, deps, rootPath = null) {
  const absolute = resolve(path);
  const fsRealpath = deps.realpath || realpath;
  const root = rootPath ? resolve(rootPath) : null;
  if (root && !pathIsInside(root, absolute)) {
    throw new Error(`Caminho do instalador fora do diretório permitido: ${absolute}`);
  }
  const existingAncestors = [];
  let candidate = absolute;

  // Walk all lexical ancestors, not just the first existing target. Checking
  // only the target and its immediate parent leaves a symlink in a deeper
  // ancestor usable as an escape hatch.
  while (true) {
    if (!root || pathIsInside(root, candidate)) {
      try {
        const stat = await deps.lstat(candidate);
        if (stat.isSymbolicLink()) {
          throw new Error(`Caminho simbólico não é aceito pelo instalador: ${candidate}`);
        }
        existingAncestors.push({ path: candidate, stat });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    const parent = dirname(candidate);
    if (parent === candidate || (root && candidate === root)) break;
    candidate = parent;
  }

  if (existingAncestors.length === 0) return;
  const anchor = existingAncestors.at(-1)?.path || candidate;
  const anchorReal = await fsRealpath(anchor);
  for (const { path: current, stat } of existingAncestors) {
    if (current !== absolute && !stat.isDirectory()) {
      throw new Error(`Pai do caminho não é um diretório: ${current}`);
    }
    const currentReal = await fsRealpath(current);
    if (!pathIsInside(anchorReal, currentReal)) {
      throw new Error(`Caminho real fora do diretório permitido: ${current}`);
    }
  }

  if (root) {
    try {
      const rootReal = await fsRealpath(root);
      if (!pathIsInside(rootReal, anchorReal)) {
        throw new Error(`Caminho real fora do diretório permitido: ${absolute}`);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

async function assertMutablePath(path, deps, rootPath = null) {
  await assertNoSymlinkComponents(path, deps, rootPath);
}

async function assertDirectory(path, deps, rootPath = null) {
  await assertNoSymlinkComponents(path, deps, rootPath);
  const stat = await deps.lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Caminho não é um diretório regular: ${path}`);
  }
}

async function exists(path, deps) {
  try {
    const stat = await deps.lstat(path);
    if (stat.isSymbolicLink()) {
      throw new Error(`Caminho simbólico não é aceito pelo instalador: ${path}`);
    }
    return true;
  } catch (error) {
    if (error?.message?.includes('Caminho simbólico')) throw error;
    return false;
  }
}

const LOCK_STALE_MS = 10 * 60 * 1000;

function homeForDataRoot(dataRoot) {
  return resolve(dataRoot, '..', '..', '..');
}

async function acquireLock(paths, deps) {
  const homeRoot = homeForDataRoot(paths.dataRoot);
  let owned = false;
  try {
    await assertMutablePath(paths.dataRoot, deps, homeRoot);
    await deps.mkdir(paths.dataRoot, { recursive: true, mode: 0o700 });
    await assertMutablePath(paths.dataRoot, deps, homeRoot);
    await assertMutablePath(paths.lock, deps, homeRoot);
    try {
      await deps.mkdir(paths.lock, { mode: 0o700 });
      owned = true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      await assertMutablePath(paths.lock, deps, homeRoot);
      let owner = null;
      try {
        owner = JSON.parse(await deps.readFile(join(paths.lock, 'owner.json'), 'utf8'));
      } catch {
        // A missing or malformed owner is recoverable only by the directory's
        // age. It cannot be attributed to a dead PID safely.
      }

      const ownerIsWellFormed = owner && typeof owner === 'object'
        && Number.isInteger(Number(owner.pid)) && Number(owner.pid) > 0
        && Number.isFinite(Number(owner.startedAt));
      if (ownerIsWellFormed) {
        const pid = Number(owner.pid);
        const age = Date.now() - Number(owner.startedAt);
        let alive = true;
        try { process.kill(pid, 0); } catch (killError) { alive = killError?.code !== 'ESRCH'; }
        if (Number.isNaN(age) || age < LOCK_STALE_MS || alive) {
          throw new Error(`Outro processo já está instalando Kiln (lock: ${paths.lock}).`);
        }
      } else {
        let lockStat;
        try {
          lockStat = await deps.lstat(paths.lock);
        } catch {
          throw new Error(`Lock existente não pôde ser verificado; não será removido: ${paths.lock}`);
        }
        const age = Date.now() - Number(lockStat.mtimeMs);
        if (!Number.isFinite(age) || age < LOCK_STALE_MS) {
          throw new Error(`Outro processo já está instalando Kiln (lock: ${paths.lock}).`);
        }
      }

      // A stale lock has been proven safe by owner metadata or by mtime.
      await deps.rm(paths.lock, { recursive: true, force: false });
      await deps.mkdir(paths.lock, { mode: 0o700 });
      owned = true;
    }

    const ownerPath = join(paths.lock, 'owner.json');
    await assertMutablePath(ownerPath, deps, homeRoot);
    await deps.writeFile(ownerPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { mode: 0o600 });
    return async () => {
      await assertMutablePath(paths.lock, deps, homeRoot);
      await deps.rm(paths.lock, { recursive: true, force: true });
    };
  } catch (error) {
    // Do not leave a lock behind when initialization fails (including a
    // failed owner.json write). Only remove a directory created by us.
    if (owned) {
      try { await deps.rm(paths.lock, { recursive: true, force: true }); } catch { /* preserve original error */ }
    }
    throw error;
  }
}

async function copyPayload(sourceRoot, staging, deps) {
  const sourcePlugin = resolve(sourceRoot, 'plugin');
  const sourceMarketplace = resolve(sourceRoot, '.claude-plugin');
  const isPayloadPath = (source) => {
    const parts = source.split('/');
    return !parts.includes('node_modules') && !parts.includes('.git') && !parts.includes('.claude') && !parts.some((part) => part === '.env' || part.startsWith('.env.'));
  };
  await assertDirectory(sourcePlugin, deps, resolve(sourceRoot));
  await assertDirectory(sourceMarketplace, deps, resolve(sourceRoot));
  await deps.cp(sourcePlugin, join(staging, 'plugin'), {
    recursive: true,
    filter: isPayloadPath,
  });
  await deps.cp(sourceMarketplace, join(staging, '.claude-plugin'), {
    recursive: true,
    filter: isPayloadPath,
  });
}

async function installElectron(staging, deps) {
  const companion = join(staging, 'plugin', 'companion');
  await assertDirectory(companion, deps, resolve(staging));
  await deps.runCommand('npm', ['ci'], { cwd: companion });

  return verifyElectron(companion, deps);
}

async function verifyElectron(companion, deps) {
  const electron = join(companion, 'node_modules', '.bin', 'electron');
  const electronStat = await deps.lstat(electron);
  let executable = electron;
  if (electronStat.isSymbolicLink()) {
    executable = await (deps.realpath || realpath)(electron);
    if (!pathIsInside(join(companion, 'node_modules'), executable)) {
      throw new Error('Executável Electron aponta para fora do companion staging.');
    }
  }
  const executableStat = await deps.lstat(executable);
  if (!executableStat.isFile() || !(executableStat.mode & 0o111)) {
    throw new Error('Electron instalado não é um executável regular.');
  }
  let version;
  try {
    ({ stdout: version } = await deps.runCommand(executable, ['--version'], { cwd: companion }));
  } catch (error) {
    throw new Error(`Não foi possível executar o Electron instalado: ${formatCommandError(error)}`);
  }
  const actual = String(version || '').trim().match(/v?(\d+\.\d+\.\d+)/)?.[1];
  if (actual !== ELECTRON_VERSION) {
    throw new Error(`Versão do Electron inválida: esperada ${ELECTRON_VERSION}, encontrada ${actual || 'desconhecida'}.`);
  }
  return { executable, version: actual };
}

async function verifyDurable(paths, deps) {
  const homeRoot = homeForDataRoot(paths.dataRoot);
  await assertDirectory(paths.durable, deps, homeRoot);
  await assertDirectory(join(paths.durable, 'plugin'), deps, homeRoot);
  await assertDirectory(join(paths.durable, 'plugin', 'companion'), deps, homeRoot);
  return verifyElectron(join(paths.durable, 'plugin', 'companion'), deps);
}

function sourceRootFromModule() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function tempName(prefix) {
  return join(prefix, `.${prefix.split('/').pop()}-${process.pid}-${randomUUID()}`);
}

function plannedCommands(paths) {
  return [
    ['npm', ['ci'], join(paths.durable, 'plugin', 'companion')],
    ['claude', ['plugin', 'marketplace', 'add', paths.durable, '--scope', 'user'], undefined],
    ['claude', ['plugin', 'install', PLUGIN_SPEC, '--scope', 'user', '--yes'], undefined],
  ];
}

function voiceInstallerPath(paths) {
  return join(paths.durable, 'plugin', 'voice', 'install-voz.sh');
}

function voiceModel() {
  return process.env.KILN_WHISPER_MODEL || 'small';
}

function logInstallSuccess(logger, withoutVoice) {
  logger.info('');
  logger.info('    /\\/\\');
  logger.info('   /####\\');
  logger.info('  |# o o#|');
  logger.info('  |#|[]|#|');
  logger.info('  |#|##|#|');
  logger.info('  |__||__|');
  logger.info('');
  if (withoutVoice) {
    logger.info('Kiln e avatar estão prontos. A voz local foi pulada por opção.');
  } else {
    logger.info('Kiln, avatar e voz local estão prontos.');
  }
  logger.info('Próximo comando: claude');
}

const VOICE_PYTHON_FORMULA = 'python@3.12';

function supportedPythonVersion(result) {
  const output = `${result?.stdout || ''}\n${result?.stderr || ''}`;
  const match = output.match(/Python\s+3\.(12|13)(?:\.|\s|$)/i);
  return match ? `3.${match[1]}` : null;
}

async function findSupportedVoicePython(deps) {
  const configured = String(process.env.KILN_PYTHON || '').trim();
  const candidates = [...new Set([configured, 'python3.12', 'python3.13'].filter(Boolean))];
  for (const candidate of candidates) {
    try {
      const result = await deps.runCommand(candidate, ['--version']);
      if (supportedPythonVersion(result)) return candidate;
    } catch {
      // Try the next supported interpreter name.
    }
  }
  return null;
}

/**
 * Ensure that the voice installer receives a Python version with PyAV wheels.
 * The Homebrew path is injected so the formula does not need to be linked into
 * PATH, and dry-run only reports the commands without running installation.
 */
export async function prepareVoicePython({ dryRun = false, deps = defaultDeps, logger = defaultLogger } = {}) {
  const existing = await findSupportedVoicePython(deps);
  if (existing) return { python: existing, installed: false };

  if (!(await commandAvailable('brew', deps))) {
    throw new Error('Python 3.12 ou 3.13 não foi encontrado. Instale o Homebrew e execute `brew install python@3.12`, ou configure KILN_PYTHON.');
  }

  if (dryRun) {
    logger.info('Dry run: Python 3.12/3.13 ausente; executaria `brew install python@3.12`.');
    logger.info('Dry run: executaria `brew --prefix python@3.12` e passaria o executável via KILN_PYTHON.');
    return { python: null, installed: true };
  }

  logger.info('Python 3.12/3.13 não encontrado; executando `brew install python@3.12`...');
  try {
    await deps.runCommand('brew', ['install', VOICE_PYTHON_FORMULA]);
  } catch (error) {
    throw new Error(`Não foi possível instalar Python via Homebrew: ${formatCommandError(error)}`);
  }

  let prefixResult;
  try {
    prefixResult = await deps.runCommand('brew', ['--prefix', VOICE_PYTHON_FORMULA]);
  } catch (error) {
    throw new Error(`Não foi possível descobrir o Python instalado via Homebrew: ${formatCommandError(error)}`);
  }
  const prefix = String(prefixResult?.stdout || '').trim();
  if (!prefix) throw new Error('Homebrew não retornou o prefixo de python@3.12.');
  const python = join(prefix, 'bin', 'python3.12');
  logger.info(`Python da voz: KILN_PYTHON=${python}`);
  return { python, installed: true };
}

async function installVoice(paths, deps, python) {
  const script = voiceInstallerPath(paths);
  const homeRoot = homeForDataRoot(paths.dataRoot);
  // The voice installer is part of the already-swapped, verified payload.
  await assertMutablePath(script, deps, homeRoot);
  const scriptStat = await deps.lstat(script);
  if (!scriptStat.isFile() || scriptStat.isSymbolicLink()) {
    throw new Error(`Instalador de voz não é um arquivo regular: ${script}`);
  }
  try {
    const env = { ...process.env };
    if (python) env.KILN_PYTHON = python;
    await deps.runCommand('bash', [script], { cwd: dirname(script), env });
  } catch (error) {
    throw new Error(`Falha na instalação da voz local: ${formatCommandError(error)}`);
  }
}

function parseJsonOutput(output) {
  try { return JSON.parse(String(output || '')); } catch { return null; }
}

function entriesFrom(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['marketplaces', 'plugins', 'items', 'data', 'installed']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return Object.entries(value).map(([name, entry]) => ({ name, ...(entry && typeof entry === 'object' ? entry : { value: entry }) }));
}

function sourceOf(entry) {
  // Marketplace list uses `installLocation` for a checked-out local source;
  // `source` may only be the kind of source (for example, "github").
  const value = entry && (entry.path || entry.location || entry.directory || entry.installLocation || entry.install_location || entry.installPath || entry.install_path || entry.cachePath || entry.cache || entry.source || (typeof entry.value === 'string' ? entry.value : null));
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return value.path || value.location || value.directory || value.installLocation || value.install_location || value.source || value.installPath || value.install_path || value.cachePath || value.cache;
  return null;
}

function marketplaceSourceOf(entry) {
  const source = sourceOf(entry);
  if (!source) return null;
  // Claude may expose only the source kind (for example, "directory") and
  // omit the actual path. That is not an origin we can validate.
  if (typeof entry?.source === 'string' && source === entry.source
    && ['directory', 'github', 'git', 'url', 'npm'].includes(source.toLowerCase())) return null;
  return source;
}

function scopeOf(entry) {
  const scope = entry && (entry.scope ?? entry.installScope ?? entry.install_scope ?? entry.installationScope);
  if (scope == null) return 'unknown';
  if (Array.isArray(scope)) {
    return scope.some((value) => String(value).toLowerCase() === 'user') ? 'user' : 'other';
  }
  return String(scope).toLowerCase() === 'user' ? 'user' : 'other';
}

function isMarketplaceEntry(entry) {
  return entry?.name === MARKETPLACE_NAME || entry?.marketplace === MARKETPLACE_NAME;
}

function isPluginEntry(entry) {
  const marketplace = entry?.marketplace;
  return entry?.name === 'kiln'
    || entry?.id === PLUGIN_SPEC
    || entry?.plugin === PLUGIN_SPEC
    || entry?.plugin === 'kiln'
    || marketplace === MARKETPLACE_NAME
    || marketplace?.name === MARKETPLACE_NAME
    || marketplace?.id === MARKETPLACE_NAME;
}

async function commandOutput(deps, args) {
  try {
    const result = await deps.runCommand('claude', args);
    const output = String(result?.stdout || '');
    return { output, known: output.trim().length > 0 };
  } catch {
    if (args.includes('--json')) {
      try {
        const result = await deps.runCommand('claude', args.filter((arg) => arg !== '--json'));
        const output = String(result?.stdout || '');
        return { output, known: output.trim().length > 0 };
      } catch {
        // Unknown state is safer than making a destructive assumption.
      }
    }
    return { output: '', known: false };
  }
}

async function inspectClaudeState(paths, deps, { marketplaceCreatedByTransaction = false } = {}) {
  // `list` is an inventory of every scope. The current Claude CLI rejects
  // --scope on both list commands; marketplace entries without scope need
  // source or transaction provenance, while plugins still require user.
  const marketplace = await commandOutput(deps, ['plugin', 'marketplace', 'list', '--json']);
  const plugin = await commandOutput(deps, ['plugin', 'list', '--json']);
  const marketplaceJson = parseJsonOutput(marketplace.output);
  const pluginJson = parseJsonOutput(plugin.output);
  const marketplaceMatches = entriesFrom(marketplaceJson).filter(isMarketplaceEntry);
  const pluginMatches = entriesFrom(pluginJson).filter(isPluginEntry);
  const marketplaceEntry = marketplaceMatches.find((entry) => {
    const scope = scopeOf(entry);
    if (scope === 'user') return true;
    if (scope === 'unknown') {
      const source = marketplaceSourceOf(entry);
      return sourceMatches(source, paths.durable) || (marketplaceCreatedByTransaction && !source);
    }
    return false;
  }) || null;
  const pluginEntry = pluginMatches.find((entry) => scopeOf(entry) === 'user') || null;
  const marketplaceTextHasName = marketplace.output.includes(MARKETPLACE_NAME);
  const pluginTextHasName = plugin.output.includes(PLUGIN_SPEC) || plugin.output.includes('kiln@') || /\bkiln\b/.test(plugin.output);
  const marketplaceSourceConflict = marketplaceMatches.some((entry) => {
    const source = marketplaceSourceOf(entry);
    return Boolean(source) && !sourceMatches(source, paths.durable);
  });
  return {
    marketplace: marketplaceEntry || (!marketplaceJson && marketplaceTextHasName ? { name: MARKETPLACE_NAME, raw: marketplace.output } : null),
    plugin: pluginEntry || (!pluginJson && pluginTextHasName ? { name: 'kiln', raw: plugin.output } : null),
    marketplaceScopeUnknown: Boolean(marketplaceMatches.some((entry) => {
      const scope = scopeOf(entry);
      if (scope === 'user') return false;
      const source = marketplaceSourceOf(entry);
      return !(scope === 'unknown' && (sourceMatches(source, paths.durable) || (marketplaceCreatedByTransaction && !source)));
    }) || (!marketplaceJson && marketplaceTextHasName)),
    marketplaceSourceConflict,
    marketplaceExpectedSource: paths.durable,
    pluginScopeUnknown: Boolean(pluginMatches.some((entry) => scopeOf(entry) === 'unknown') || (!pluginJson && pluginTextHasName)),
    marketplaceKnown: marketplace.known,
    pluginKnown: plugin.known,
  };
}

function assertKnownUserInventory(state) {
  if (state.marketplaceSourceConflict) {
    throw new Error(`Marketplace ${MARKETPLACE_NAME} conflitante detectado; origem diferente de ${state.marketplaceExpectedSource}.`);
  }
  if (state.marketplaceScopeUnknown) {
    throw new Error(`Marketplace ${MARKETPLACE_NAME} foi encontrado, mas o escopo user não pôde ser comprovado; instalação abortada.`);
  }
  if (state.pluginScopeUnknown) {
    throw new Error(`${PLUGIN_SPEC} foi encontrado, mas o escopo user não pôde ser comprovado; instalação abortada.`);
  }
}

function sourceMatches(source, durable) {
  if (!source) return false;
  return resolve(String(source)) === resolve(durable);
}

async function assertMarketplaceSafe(paths, deps) {
  const state = await inspectClaudeState(paths, deps);
  assertKnownUserInventory(state);
  if (!state.marketplace) return state;
  const source = marketplaceSourceOf(state.marketplace) || (state.marketplace.raw?.includes(resolve(paths.durable)) ? paths.durable : null);
  if (!source && state.marketplace.raw) {
    throw new Error(`Marketplace ${MARKETPLACE_NAME} já existe, mas a origem não pôde ser confirmada; instalação abortada para não sobrescrevê-la.`);
  }
  if (!sourceMatches(source, paths.durable)) {
    throw new Error(`Marketplace ${MARKETPLACE_NAME} conflitante detectado; origem diferente de ${paths.durable}.`);
  }
  return state;
}

function pluginVersionOf(entry) {
  const candidates = [
    entry?.version,
    entry?.installedVersion,
    entry?.installed_version,
    entry?.pluginVersion,
    entry?.plugin_version,
    entry?.metadata?.version,
  ];
  return candidates.find((value) => typeof value === 'string' && value.length > 0) || null;
}

async function durablePluginVersion(paths, deps) {
  try {
    const manifest = JSON.parse(await deps.readFile(join(paths.durable, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

async function pluginVersionFromSource(source, deps) {
  if (!source) return null;
  const root = resolve(String(source));
  const candidates = [
    join(root, '.claude-plugin', 'plugin.json'),
    join(root, 'plugin.json'),
    join(root, 'plugin', '.claude-plugin', 'plugin.json'),
  ];
  for (const candidate of candidates) {
    try {
      const manifest = JSON.parse(await deps.readFile(candidate, 'utf8'));
      if (typeof manifest.version === 'string') return manifest.version;
    } catch {
      // A cache entry may expose only one of the layouts above.
    }
  }
  return null;
}

async function activePluginVersion(state, deps) {
  const listedVersion = pluginVersionOf(state.plugin);
  if (listedVersion) return listedVersion;
  const candidateSources = [
    sourceOf(state.plugin),
    state.plugin?.cachePath,
    state.plugin?.cache,
    state.plugin?.installPath,
    state.plugin?.install_path,
  ].filter(Boolean);
  for (const source of candidateSources) {
    const version = await pluginVersionFromSource(source, deps);
    if (version) return version;
  }
  return null;
}

async function pluginIsActiveForDurable(state, paths, deps, expectedVersion) {
  if (!state.plugin || !expectedVersion) return false;
  // A source path can remain unchanged while Claude is still serving an old
  // cached plugin. The manifest version is therefore the required proof.
  return (await activePluginVersion(state, deps)) === expectedVersion;
}

async function reinstallUserPlugin(paths, deps) {
  await deps.runCommand('claude', ['plugin', 'uninstall', PLUGIN_SPEC, '--scope', 'user', '--yes']);
  await deps.runCommand('claude', ['plugin', 'install', PLUGIN_SPEC, '--scope', 'user', '--yes']);
}

async function runClaudeInstall(paths, deps, logger, before, { proveActive = false, transactionState = null } = {}) {
  let marketplaceCreatedByTransaction = Boolean(transactionState?.marketplaceCreatedByTransaction);
  const markMarketplaceCreated = () => {
    marketplaceCreatedByTransaction = true;
    if (transactionState) transactionState.marketplaceCreatedByTransaction = true;
  };
  if (before.marketplace) {
    try {
      await deps.runCommand('claude', ['plugin', 'marketplace', 'update', MARKETPLACE_NAME]);
    } catch (error) {
      if (!proveActive) throw error;
      // Rollback must not trust an update that failed to refresh the
      // registered source. Re-register only the user-scoped marketplace.
      await deps.runCommand('claude', ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME, '--scope', 'user']);
      await deps.runCommand('claude', ['plugin', 'marketplace', 'add', paths.durable, '--scope', 'user']);
      markMarketplaceCreated();
    }
  } else {
    await deps.runCommand('claude', ['plugin', 'marketplace', 'add', paths.durable, '--scope', 'user']);
    markMarketplaceCreated();
  }
  let pluginUpdateFailed = false;
  if (before.plugin) {
    try {
      await deps.runCommand('claude', ['plugin', 'update', PLUGIN_SPEC]);
    } catch {
      pluginUpdateFailed = true;
    }
  } else {
    await deps.runCommand('claude', ['plugin', 'install', PLUGIN_SPEC, '--scope', 'user', '--yes']);
  }
  const expectedVersion = await durablePluginVersion(paths, deps);
  if (!expectedVersion) {
    throw new Error('plugin.json não expõe uma versão verificável para o plugin durável.');
  }
  let after = await inspectClaudeState(paths, deps, { marketplaceCreatedByTransaction });
  assertKnownUserInventory(after);
  const marketplaceSource = marketplaceSourceOf(after.marketplace);
  if (!marketplaceSource && !marketplaceCreatedByTransaction) {
    throw new Error(`Marketplace ${MARKETPLACE_NAME} não expõe a origem após a instalação.`);
  }
  if (marketplaceSource && !sourceMatches(marketplaceSource, paths.durable)) {
    throw new Error(`Marketplace ${MARKETPLACE_NAME} não aponta para a cópia durável após a instalação.`);
  }
  if (!after.marketplaceKnown || !after.pluginKnown || !after.plugin) {
    throw new Error(`${PLUGIN_SPEC} não foi encontrado no Claude Code após a instalação.`);
  }
  if (pluginUpdateFailed || !(await pluginIsActiveForDurable(after, paths, deps, expectedVersion))) {
    await reinstallUserPlugin(paths, deps);
    after = await inspectClaudeState(paths, deps, { marketplaceCreatedByTransaction });
    assertKnownUserInventory(after);
    if (!after.plugin || !(await pluginIsActiveForDurable(after, paths, deps, expectedVersion))) {
      throw new Error(`${PLUGIN_SPEC} não comprovou a versão/cache ativa correspondente ao plugin.json.`);
    }
  }
  if (proveActive && !(await pluginIsActiveForDurable(after, paths, deps, expectedVersion))) {
    throw new Error(`${PLUGIN_SPEC} não comprovou a versão/cache ativa da cópia durável após rollback.`);
  }
  logger.info('Claude Code confirmou o marketplace/plugin (quando a versão do CLI expõe listagem).');
  return after;
}

async function stateRestored(before, after, marketplaceSource, pluginVersion, deps) {
  if (!after.marketplaceKnown || !after.pluginKnown || after.marketplaceSourceConflict || after.marketplaceScopeUnknown || after.pluginScopeUnknown) return false;
  if (Boolean(after.marketplace) !== Boolean(before.marketplace)) return false;
  if (before.marketplace) {
    const source = marketplaceSourceOf(after.marketplace);
    if (!source || !sourceMatches(source, marketplaceSource)) return false;
  }
  if (Boolean(after.plugin) !== Boolean(before.plugin)) return false;
  if (before.plugin && pluginVersion && (await activePluginVersion(after, deps)) !== pluginVersion) return false;
  return true;
}

async function restoreClaudeState(before, paths, deps, { marketplaceCreatedByTransaction = false } = {}) {
  // Reconciliation is intentionally command-based rather than editing
  // ~/.claude. Each destructive operation has a compensating add/install,
  // and the final inventory is required to prove the target state.
  const marketplaceSource = marketplaceSourceOf(before.marketplace) || paths.durable;
  const pluginVersion = pluginVersionOf(before.plugin) || await durablePluginVersion(paths, deps);
  const failures = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let current;
    try {
      current = await inspectClaudeState(paths, deps, { marketplaceCreatedByTransaction });
      assertKnownUserInventory(current);
    } catch (error) {
      failures.push(error);
      continue;
    }

    if (before.marketplace) {
      const source = marketplaceSourceOf(current.marketplace);
      const matches = current.marketplace && source && sourceMatches(source, marketplaceSource);
      if (!matches) {
        if (current.marketplace) {
          try { await deps.runCommand('claude', ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME, '--scope', 'user']); } catch (error) { failures.push(error); }
        }
        try { await deps.runCommand('claude', ['plugin', 'marketplace', 'add', marketplaceSource, '--scope', 'user']); } catch (error) { failures.push(error); }
      }
    } else if (current.marketplace) {
      try { await deps.runCommand('claude', ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME, '--scope', 'user']); } catch (error) { failures.push(error); }
    }

    let afterMarketplace;
    try {
      afterMarketplace = await inspectClaudeState(paths, deps, { marketplaceCreatedByTransaction });
    } catch (error) { failures.push(error); continue; }
    try { assertKnownUserInventory(afterMarketplace); } catch (error) { failures.push(error); continue; }

    if (before.plugin) {
      const activeVersion = afterMarketplace.plugin ? await activePluginVersion(afterMarketplace, deps) : null;
      const matches = Boolean(afterMarketplace.plugin) && (!pluginVersion || activeVersion === pluginVersion);
      if (!matches) {
        if (afterMarketplace.plugin) {
          try { await deps.runCommand('claude', ['plugin', 'uninstall', PLUGIN_SPEC, '--scope', 'user', '--yes']); } catch (error) { failures.push(error); }
        }
        try { await deps.runCommand('claude', ['plugin', 'install', PLUGIN_SPEC, '--scope', 'user', '--yes']); } catch (error) { failures.push(error); }
      }
    } else if (afterMarketplace.plugin) {
      try { await deps.runCommand('claude', ['plugin', 'uninstall', PLUGIN_SPEC, '--scope', 'user', '--yes']); } catch (error) { failures.push(error); }
    }

    const verified = await inspectClaudeState(paths, deps, { marketplaceCreatedByTransaction });
    if (await stateRestored(before, verified, marketplaceSource, pluginVersion, deps)) return verified;
  }

  const detail = failures.map(formatCommandError).filter(Boolean).join('; ');
  throw new Error(`Não foi possível restaurar e comprovar o estado do Claude Code${detail ? `: ${detail}` : '.'}`);
}

async function removeIfExists(path, deps, rootPath = null) {
  await assertMutablePath(path, deps, rootPath);
  await deps.rm(path, { recursive: true, force: true });
}

async function safeRename(from, to, deps, rootPath = null) {
  await assertMutablePath(from, deps, rootPath);
  await assertMutablePath(to, deps, rootPath);
  await deps.rename(from, to);
}

async function swapIntoPlace(staging, paths, deps) {
  const homeRoot = homeForDataRoot(paths.dataRoot);
  const oldPrevious = tempName(paths.dataRoot);
  await assertMutablePath(staging, deps, homeRoot);
  await assertMutablePath(paths.durable, deps, homeRoot);
  await assertMutablePath(paths.previous, deps, homeRoot);
  await assertMutablePath(oldPrevious, deps, homeRoot);
  const oldDurable = await exists(paths.durable, deps);
  const oldPreviousExists = await exists(paths.previous, deps);
  let durableMoved = false;
  try {
    if (oldPreviousExists) {
      await safeRename(paths.previous, oldPrevious, deps, homeRoot);
    }
    if (oldDurable) {
      await safeRename(paths.durable, paths.previous, deps, homeRoot);
      durableMoved = true;
    }
    await safeRename(staging, paths.durable, deps, homeRoot);
    return {
      rollback: async () => {
        await removeIfExists(paths.durable, deps, homeRoot);
        if (durableMoved) await safeRename(paths.previous, paths.durable, deps, homeRoot);
        if (oldPreviousExists) await safeRename(oldPrevious, paths.previous, deps, homeRoot);
      },
      commit: async () => {
        if (oldPreviousExists) await removeIfExists(oldPrevious, deps, homeRoot);
      },
    };
  } catch (error) {
    await removeIfExists(staging, deps, homeRoot);
    if (durableMoved && !(await exists(paths.durable, deps))) await safeRename(paths.previous, paths.durable, deps, homeRoot);
    if (oldPreviousExists && (await exists(oldPrevious, deps))) await safeRename(oldPrevious, paths.previous, deps, homeRoot);
    throw error;
  }
}

/** Install the packaged marketplace. No filesystem mutation occurs for dryRun. */
export async function install({
  dryRun = false,
  withoutVoice = false,
  platform = hostPlatform(),
  sourceRoot = sourceRootFromModule(),
  paths = pathsFor(),
  deps = defaultDeps,
  logger = defaultLogger,
} = {}) {
  validatePaths(paths);
  const preflight = await runPreflight({ platform, dryRun, deps, logger });
  if (!preflight.ok) throw new Error(preflight.message);

  const sourcePlugin = resolve(sourceRoot, 'plugin');
  const sourceMarketplace = resolve(sourceRoot, '.claude-plugin');
  if (!(await exists(sourcePlugin, deps)) || !(await exists(sourceMarketplace, deps))) {
    throw new Error('Payload do Kiln incompleto: plugin/ ou .claude-plugin/ não encontrado.');
  }

  // This check is intentionally before lock acquisition, staging, or any
  // durable rename. A same-named marketplace owned by another installation is
  // never updated implicitly.
  const claudeBefore = await assertMarketplaceSafe(paths, deps);

  if (dryRun) {
    logger.info('Dry run: nenhuma alteração foi feita em ~/.claude ou no diretório durável.');
    logger.info(`Dry run: payload seria instalado em ${paths.durable}.`);
    for (const [command, args, cwd] of plannedCommands(paths)) {
      logger.info(`Dry run: ${command} ${args.join(' ')}${cwd ? ` (cwd: ${cwd})` : ''}`);
    }
    if (withoutVoice) {
      logger.info('Dry run: voz local seria explicitamente ignorada por --without-voice.');
    } else {
      await prepareVoicePython({ dryRun: true, deps, logger });
      logger.info(`Dry run: bash ${voiceInstallerPath(paths)} (cwd: ${join(paths.durable, 'plugin', 'voice')})`);
      logger.info(`Dry run: download único do modelo de voz Whisper '${voiceModel()}'.`);
    }
    return { dryRun: true, preflight, paths };
  }

  const releaseLock = await acquireLock(paths, deps);
  const staging = tempName(paths.dataRoot);
  const transactionState = { marketplaceCreatedByTransaction: !claudeBefore.marketplace };
  let rollbackCopy = null;
  try {
    await deps.mkdir(staging, { recursive: false, mode: 0o700 });
    logger.info('Etapa 1/4: preparando Kiln...');
    await copyPayload(sourceRoot, staging, deps);
    logger.info('Etapa 2/4: preparando o avatar...');
    await installElectron(staging, deps);
    rollbackCopy = await swapIntoPlace(staging, paths, deps);
    try {
      await verifyDurable(paths, deps);
      logger.info('Etapa 3/4: conectando Kiln ao Claude Code...');
      await runClaudeInstall(paths, deps, logger, claudeBefore, { transactionState });
      await verifyDurable(paths, deps);
      if (withoutVoice) {
        logger.info('Voz local ignorada por --without-voice.');
      } else {
        logger.info(`Etapa 4/4: preparando voz local (Whisper '${voiceModel()}')...`);
        const voicePython = await prepareVoicePython({ deps, logger });
        await installVoice(paths, deps, voicePython.python);
      }
    } catch (error) {
      logger.warn('Falha na validação/instalação; revertendo a cópia durável para a versão anterior.');
      let failure = error;
      try {
        await rollbackCopy.rollback();
      } catch (rollbackError) {
        failure = new Error(`${failure.message}; falha ao restaurar a cópia durável: ${formatCommandError(rollbackError)}`);
      }
      rollbackCopy = null;
      try {
        await restoreClaudeState(claudeBefore, paths, deps, transactionState);
      } catch (reconcileError) {
        failure = new Error(`${failure.message}; falha ao compensar o estado do Claude Code: ${formatCommandError(reconcileError)}`);
      }
      throw failure;
    }
    await rollbackCopy.commit();
    rollbackCopy = null;
    logger.info(`Kiln ${PACKAGE_VERSION} instalado/atualizado em escopo user.`);
    logger.info('O Claude CLI registra marketplace/enabledPlugins; o instalador não edita env nem tokens.');
    logger.info(withoutVoice ? 'Voz local foi pulada explicitamente.' : 'Voz local instalada por padrão.');
    logInstallSuccess(logger, withoutVoice);
    return { dryRun: false, preflight, paths };
  } finally {
    await removeIfExists(staging, deps, homeForDataRoot(paths.dataRoot));
    await releaseLock();
  }
}

export async function rollback({
  platform = hostPlatform(),
  paths = pathsFor(),
  deps = defaultDeps,
  logger = defaultLogger,
} = {}) {
  validatePaths(paths);
  if (platform !== 'darwin') {
    throw new Error(`Kiln installer: sistema não suportado (${platform}). Por enquanto, use macOS.`);
  }
  const claudeBefore = await assertMarketplaceSafe(paths, deps);
  const releaseLock = await acquireLock(paths, deps);
  const temporary = tempName(paths.dataRoot);
  const homeRoot = homeForDataRoot(paths.dataRoot);
  const transactionState = { marketplaceCreatedByTransaction: !claudeBefore.marketplace };
  try {
    await assertMutablePath(paths.previous, deps, homeRoot);
    await assertMutablePath(paths.durable, deps, homeRoot);
    await assertMutablePath(temporary, deps, homeRoot);
    if (!(await exists(paths.previous, deps))) {
      throw new Error(`Nenhuma cópia anterior para rollback em ${paths.previous}.`);
    }
    if (await exists(paths.durable, deps)) await safeRename(paths.durable, temporary, deps, homeRoot);
    await safeRename(paths.previous, paths.durable, deps, homeRoot);
    await verifyDurable(paths, deps);
    // Keep Claude's existing registration; refresh it so marketplace and the
    // enabled plugin now resolve the reverted durable copy.
    await runClaudeInstall(paths, deps, logger, claudeBefore, { proveActive: true, transactionState });
    if (await exists(temporary, deps)) await safeRename(temporary, paths.previous, deps, homeRoot);
    logger.info(`Cópia durável revertida. Marketplace atual: ${paths.durable}`);
    logger.info('Marketplace e plugin do Claude Code reconciliados sem remover estado pré-existente.');
    return { paths };
  } catch (error) {
    let failure = error;
    if (await exists(temporary, deps)) {
      try {
        // `temporary` is the pre-rollback durable copy. The current durable
        // path is the previous copy and must remain available at `previous`.
        if (await exists(paths.durable, deps)) await removeIfExists(paths.durable, deps, homeRoot);
        await safeRename(temporary, paths.durable, deps, homeRoot);
      } catch (restoreError) {
        failure = new Error(`${failure.message}; falha ao restaurar a cópia durável: ${formatCommandError(restoreError)}`);
      }
    }
    try {
      await restoreClaudeState(claudeBefore, paths, deps, transactionState);
    } catch (reconcileError) {
      failure = new Error(`${failure.message}; falha ao compensar o estado do Claude Code: ${formatCommandError(reconcileError)}`);
    }
    throw failure;
  } finally {
    await removeIfExists(temporary, deps, homeForDataRoot(paths.dataRoot));
    await releaseLock();
  }
}

function usage() {
  return [
    'Uso:',
    '  kiln install [--dry-run] [--without-voice]',
    '  kiln rollback',
    '',
    'macOS only. A instalação padrão instala voz local com um download único do modelo.',
    'Use --without-voice para pular explicitamente a instalação de voz.',
  ].join('\n');
}

export function parseInstallOptions(flags) {
  const invalid = flags.filter((flag) => flag !== '--dry-run' && flag !== '--without-voice');
  if (invalid.length > 0) throw new Error(`Opção desconhecida: ${invalid.join(', ')}`);
  return {
    dryRun: flags.includes('--dry-run'),
    withoutVoice: flags.includes('--without-voice'),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...flags] = argv;
  if (command === '--help' || command === '-h' || !command) {
    console.log(usage());
    return 0;
  }
  if (command === '--version' || command === '-v') {
    console.log(PACKAGE_VERSION);
    return 0;
  }
  if (command === 'install') {
    await install(parseInstallOptions(flags));
    return 0;
  }
  if (command === 'rollback') {
    if (flags.length > 0) throw new Error(`Opção desconhecida: ${flags.join(', ')}`);
    await rollback();
    return 0;
  }
  throw new Error(`Comando desconhecido: ${command}\n\n${usage()}`);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    // A directly invoked file should still work if the filesystem changes
    // between argv inspection and resolution; imports must remain inert.
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`Kiln installer: ${error.message}`);
    process.exitCode = 1;
  });
}
