const { app, BrowserWindow, ipcMain, screen, clipboard, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

// O runtime só contém estado desta conta e desta sessão. O companion não é
// um cofre contra outro processo do mesmo UID; isto apenas evita permissões
// acidentais e colisões entre sessões.
process.umask(0o077);

// ---------------------------------------------------------------- identidade
// Uma janela POR SESSÃO. O hook passa qual sessão é esta.
const SESSION = process.env.KILN_SESSION || 'avulsa';
const LABEL = process.env.KILN_LABEL || '';
const PARENT_PID = Number(process.env.KILN_PARENT_PID || 0);

function safeName(value) {
  const text = String(value || '');
  if (text && text !== '.' && text !== '..' && /^[A-Za-z0-9._-]+$/.test(text)) return text;
  return crypto.createHash('sha256').update(text).digest('hex');
}

const SESSION_KEY = safeName(SESSION);
const USER_ID = typeof process.getuid === 'function' ? String(process.getuid()) : 'unknown';
const RUNTIME_ROOT = process.env.KILN_RUNTIME_ROOT ||
  path.join(process.env.TMPDIR || os.tmpdir(), 'kiln-' + USER_ID);
const STATE_DIR = process.env.KILN_RUNTIME_DIR || path.join(RUNTIME_ROOT, SESSION_KEY);
const STATE_FILE = path.join(STATE_DIR, 'agents');
const PID_FILE = path.join(STATE_DIR, 'pid');
function tokenPath(id, suffix) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(id || '')) || id === '.' || id === '..') return null;
  return path.join(STATE_DIR, id + suffix);
}
function askPath(id) { return tokenPath(id, '.ask'); }
function ansPath(id) { return tokenPath(id, '.ans'); }

try {
  fs.mkdirSync(RUNTIME_ROOT, { recursive: true, mode: 0o700 });
  fs.chmodSync(RUNTIME_ROOT, 0o700);
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(STATE_DIR, 0o700);
} catch (e) { console.error('[kiln] não consegui preparar o runtime:', e.message); }

const SHEET = JSON.parse(fs.readFileSync(path.join(__dirname, 'golems.json'), 'utf8'));

// ------------------------------------------------------------------ medidas
// UM bicho só, sempre. Quando há Claudinhos trabalhando, um painel compacto cresce
// para CIMA dele — em vez de abrir uma janela nova por agente.
const CELL = 3;
const WIDTH = 196;
const BAR_H = 18;
const HERO_H = SHEET.h * CELL + 24;         // sprite + etiqueta (sem cortar)
const ROW_H = 24;                           // uma linha de Claudinho no painel (bate com o CSS)
const PANEL_PAD = 13;                       // respiro interno + margem do painel
const MAIS_H = 14;                          // a linha "+N rodando"
const MAX_LINHAS = 8;
const ASK_H = 84;                           // cartão de aprovação
const NUB_W = SHEET.w * 2 + 16;             // minimizado: só o bicho, pequeno
const NUB_H = BAR_H + SHEET.h * 2 + 4;

// altura de janela para n Claudinhos vivos
function layout(n, temPedido) {
  let h = BAR_H + HERO_H;
  if (temPedido) h += ASK_H;
  if (n > 0) {
    const linhas = Math.min(n, MAX_LINHAS);
    h += PANEL_PAD + linhas * ROW_H + (n > MAX_LINHAS ? MAIS_H : 0);
  }
  return { width: WIDTH, height: h };
}

let win;
let collapsed = false;
let ultimoN = -1;
let pedido = null;
let alturaRenderer = 0;   // o renderer mede o próprio conteúdo e avisa
// A única autoridade de aprovação é o processo main. Este estado é efêmero e
// pertence somente a esta instância/sessão; nunca é persistido nem indexado por
// ferramenta.
let allowAllSession = false;

// macOS ignora setBounds quando resizable é false. Libera, aplica, trava.
// Ancora no canto inferior direito: cresce para a esquerda e para cima.
function ajustarJanela(width, height) {
  if (!win || win.isDestroyed()) return;
  const [cw, ch] = win.getSize();
  if (cw === width && ch === height) return;
  const [x, y] = win.getPosition();
  win.setResizable(true);
  win.setBounds({ x: x + (cw - width), y: y + (ch - height), width, height });
  win.setResizable(false);
  console.log('[kiln] janela ' + cw + 'x' + ch + ' -> ' + width + 'x' + height);
}

// ------------------------------------------------------------------- estado
function readAgents() {
  try {
    const out = [];
    for (const line of fs.readFileSync(STATE_FILE, 'utf8').split('\n')) {
      const [id, type, started] = line.split('\t');
      if (id && type) out.push({ id, type, started: Number(started) * 1000 || Date.now() });
    }
    return out;
  } catch { return []; }
}

function readAsk() {
  try {
    const files = fs.readdirSync(STATE_DIR)
      .filter((f) => /^[A-Za-z0-9._-]+\.ask$/.test(f));
    if (!files.length) return null;
    files.sort((a, b) => {                       // o mais antigo primeiro = fila justa
      try { return fs.statSync(path.join(STATE_DIR, a)).mtimeMs
                 - fs.statSync(path.join(STATE_DIR, b)).mtimeMs; } catch { return 0; }
    });
    for (const file of files) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(STATE_DIR, file), 'utf8'));
        const id = file.slice(0, -4);
        if (!j || j.id !== id || j.requestId !== id ||
            !/^[0-9a-f]{64}$/.test(String(j.nonce || '')) ||
            !Number.isFinite(Number(j.expiresAt))) continue;
        if (Date.now() >= Number(j.expiresAt)) {
          writeAnswer(j, 'deny');
          continue;
        }
        // O hook pode já ter sido respondido entre dois pulsos. O answer é
        // definitivo: não reapresente nem substitua uma decisão aceita.
        if (ansPath(id) && fs.existsSync(ansPath(id))) continue;
        return j;
      } catch { /* arquivo ainda sendo substituído ou inválido: fechado */ }
    }
    return null;
  } catch { return null; }
}
// apaga pedidos/respostas órfãos DESTA sessão — evita fantasma de hook morto
function limparPedidos() {
  try {
    for (const f of fs.readdirSync(STATE_DIR)) {
      if (!/^[A-Za-z0-9._-]+\.ask$/.test(f)) continue;
      const id = f.slice(0, -4);
      // Um .ans significa que o hook já recebeu uma decisão. Nunca o apague
      // durante o startup: o hook ainda pode estar prestes a consumi-lo.
      if (ansPath(id) && fs.existsSync(ansPath(id))) continue;
      try { fs.unlinkSync(path.join(STATE_DIR, f)); } catch { /* já foi */ }
    }
  } catch { /* dir ainda não existe */ }
}

// Quantas outras janelas do Kiln já existem — para empilhar sem sobrepor.
function slotIndex() {
  try {
    return fs.readdirSync(RUNTIME_ROOT)
      .filter((f) => f !== SESSION_KEY)
      .filter((f) => {
        const pid = path.join(RUNTIME_ROOT, f, 'pid');
        try {
          if (!fs.statSync(pid).isFile()) return false;
          process.kill(Number(fs.readFileSync(pid, 'utf8')), 0);
          return true;
        } catch { return false; }
      }).length;
  } catch { return 0; }
}

// -------------------------------------------------------------- ciclo de vida
function parentAlive() {
  if (!PARENT_PID) return true;              // sem pid, não temos como julgar
  try { process.kill(PARENT_PID, 0); return true; } catch { return false; }
}

function anyClaudeAlive() {
  try {
    const { execSync } = require('node:child_process');
    execSync('pgrep -x claude >/dev/null 2>&1 || pgrep -f "claude " >/dev/null 2>&1',
      { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function writePid() {
  try {
    const tmp = PID_FILE + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    fs.writeFileSync(tmp, String(process.pid), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, PID_FILE);
  }
  catch { /* segue o jogo */ }
}
function clearPid() {
  try {
    if (Number(fs.readFileSync(PID_FILE, 'utf8')) === process.pid) fs.unlinkSync(PID_FILE);
  } catch { /* já foi */ }
}

function atomicWrite(file, value) {
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, value, { encoding: 'utf8' });
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* já foi */ }
    console.error('[kiln] resposta não foi gravada:', e.message);
    return false;
  }
}

function writeAnswer(ask, decisao) {
  if (!ask || !['allow', 'deny'].includes(decisao) ||
      !ask.id || ask.id !== ask.requestId ||
      !/^[0-9a-f]{64}$/.test(String(ask.nonce || '')) ||
      !Number.isFinite(Number(ask.expiresAt)) ||
      (Date.now() >= Number(ask.expiresAt) && decisao !== 'deny')) return false;
  const answer = ansPath(ask.requestId);
  if (!answer) return false;
  // Nunca sobrescreva uma resposta que o hook já pode ter aceitado.
  if (fs.existsSync(answer)) return false;
  const ok = atomicWrite(answer, JSON.stringify({
    requestId: ask.requestId, nonce: ask.nonce, decisao
  }));
  if (ok) {
    try { fs.unlinkSync(askPath(ask.requestId)); } catch { /* já foi */ }
  }
  return ok;
}

function emitApprovalState() {
  if (win && !win.isDestroyed())
    win.webContents.send('approval-state', { allowAllSession });
}

function pedidoDoPayload(payload) {
  const p = payload || {};
  const rid = p.requestId || p.id;
  if (!rid || rid !== p.id || !p.nonce || !/^[A-Za-z0-9._-]+$/.test(rid) ||
      !/^[0-9a-f]{64}$/.test(String(p.nonce))) return null;
  const askFile = askPath(rid);
  if (!askFile) return null;
  try {
    const ask = JSON.parse(fs.readFileSync(askFile, 'utf8'));
    if (!ask || ask.id !== rid || ask.requestId !== rid || ask.nonce !== p.nonce)
      return null;
    return ask;
  } catch { return null; }
}

function decidir(payload, decisao, habilitarTudo) {
  const ask = pedidoDoPayload(payload);
  if (!ask || !['allow', 'deny'].includes(decisao)) return false;
  if (!writeAnswer(ask, decisao)) return false;
  if (habilitarTudo) {
    allowAllSession = true;
    emitApprovalState();
    console.log('[kiln] aprovação para toda esta sessão ligada');
  }
  pedido = null;
  if (win && !win.isDestroyed()) win.webContents.send('ask', null);
  return true;
}

// ------------------------------------------------------------------- janela
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const idx = slotIndex();
  const dim = layout(readAgents().length, false);
  // as janelas de outras sessões empilham para cima, usando a altura cheia
  const alturaCheia = layout(MAX_LINHAS, false).height;
  const y = workArea.y + workArea.height - dim.height - 24 - idx * (alturaCheia + 10);

  const expectedPage = pathToFileURL(path.join(__dirname, 'index.html')).toString();
  win = new BrowserWindow({
    width: dim.width, height: dim.height,
    x: workArea.x + workArea.width - dim.width - 24,
    y: Math.max(workArea.y + 8, y),
    frame: false, transparent: true, hasShadow: false,
    alwaysOnTop: true, resizable: false, movable: true,
    skipTaskbar: true, focusable: true, acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  // O companion só navega para a página local que ele próprio carrega.
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== expectedPage) event.preventDefault();
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (url !== expectedPage) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'index.html'));

  // sem isto, console.log do renderer some — e é lá que mora o aviso de
  // sprite faltando e a confirmação do clique no botão
  win.webContents.on('console-message', (_e, _lvl, msg) => {
    if (String(msg).indexOf('[kiln]') === 0) console.log(msg);
  });
  win.webContents.on('render-process-gone', (_e, d) =>
    console.error('[kiln] renderer morreu:', JSON.stringify(d)));
  win.webContents.on('did-fail-load', (_e, code, desc) =>
    console.error('[kiln] falhou ao carregar:', code, desc));
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('meta', { label: LABEL, session: SESSION });
    emitApprovalState();
  });

  // pulso: manda o estado e ajusta a janela ao número de Claudinhos
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const agents = readAgents();
    if (agents.length !== ultimoN) {
      ultimoN = agents.length;
      console.log('[kiln] ' + STATE_FILE + ' -> ' + agents.length + ' agente(s): '
        + agents.map(function (a) { return a.type; }).join(', '));
    }
    let novo = readAsk();
    // A aprovação global é uma decisão da sessão, não uma lista de ferramentas.
    if (novo && allowAllSession) {
      if (writeAnswer(novo, 'allow')) {
        console.log('[kiln] AUTO-allow (all-session) id=' + novo.id);
        novo = null;
      }
    }
    const apareceu = novo && (!pedido || pedido.id !== novo.id);
    pedido = novo;
    win.webContents.send('ask', pedido);          // reenvia sempre: envio perdido não trava
    if (apareceu) {
      console.log('[kiln] aprovação pedida: ' + pedido.tool + ' id=' + pedido.id);
      if (collapsed) {                            // minimizado não pode esconder decisão
        collapsed = false;
        win.webContents.send('collapsed', false);
      }
      try { win.showInactive(); } catch { /* já visível */ }
    }
    if (!collapsed) {
      const dim = layout(agents.length, !!pedido);
      ajustarJanela(WIDTH, alturaRenderer || dim.height);
    }
    win.webContents.send('agents', agents);
  }, 500);

  // vigia: se o Claude Code que me abriu morreu, eu fecho
  setInterval(() => {
    if (parentAlive()) return;
    if (anyClaudeAlive() && fs.existsSync(STATE_FILE)) return;  // ainda pode ser útil
    app.quit();
  }, 15000);
}

// minimizar = encolher para um cotoco, não sumir. Clicar de novo devolve.
ipcMain.on('toggle-collapse', () => {
  console.log('[kiln] toggle recebido no main');
  if (!win || win.isDestroyed()) return;
  collapsed = !collapsed;
  if (collapsed) {
    ajustarJanela(NUB_W, NUB_H);
  } else {
    const dim = layout(readAgents().length, !!pedido);
    ajustarJanela(WIDTH, alturaRenderer || dim.height);
  }
  win.webContents.send('collapsed', collapsed);
});


// ------------------------------------------------------------- ditado (fala)
// O Electron grava; a transcrição vai para o Whisper local; o texto volta para a
// área de transferência. Não existe jeito suportado de digitar dentro de uma
// sessão interativa do Claude Code — então o último passo é seu Cmd+V.
const STT_PORT = Number(process.env.KILN_STT_PORT || 8760);
function cfgFala() {
  return { base: 'http://127.0.0.1:' + STT_PORT, local: true };
}

// sobe o servidor de voz local sozinho, se estiver instalado (install-voz.sh)
function portaAberta(port) {
  return new Promise((res) => {
    const net = require('node:net');
    const sock = net.connect(port, '127.0.0.1');
    const fim = (ok) => { try { sock.destroy(); } catch {} res(ok); };
    sock.on('connect', () => fim(true));
    sock.on('error', () => fim(false));
    setTimeout(() => fim(false), 400);
  });
}
async function garantirWhisper() {
  const { base } = cfgFala();
  let health = await esperarWhisper(base, 1);
  if (health) return health;

  const dir = process.env.KILN_STT_DIR || path.join(os.homedir(), '.claude', 'kiln-stt');
  const script = path.join(dir, 'kiln-stt-server.py');
  if (!fs.existsSync(script)) return null;              // não instalado — tudo bem
  if (await portaAberta(STT_PORT)) return esperarWhisper(base, 8);
  const win = process.platform === 'win32';
  const cand = win ? [path.join(dir, 'venv', 'Scripts', 'python.exe'), 'python']
                   : [path.join(dir, 'venv', 'bin', 'python'), 'python3'];
  const py = cand.find((p) => (p.indexOf(path.sep) >= 0 ? fs.existsSync(p) : true)) || cand[cand.length - 1];
  try {
    const log = fs.openSync(path.join(STATE_DIR, 'stt.log'), 'a', 0o600);
    require('node:child_process')
      .spawn(py, [script], { detached: true, stdio: ['ignore', log, log] }).unref();
    console.log('[kiln] servidor de voz local iniciando (' + py + ')');
  } catch (e) { console.log('[kiln] não subi o whisper: ' + e.message); }
  return esperarWhisper(base, 8);
}

function esperar(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// O health é consultado antes de transcrever. Falhas não são cacheadas: um
// servidor que ainda está carregando o modelo pode se recuperar no próximo uso.
async function esperarWhisper(base, tentativas) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(base + '/v1/models');
      if (r.ok) {
        const j = await r.json();
        if (j && (j.status === 'ok' || Array.isArray(j.data) || Array.isArray(j.models))) return j;
      }
    } catch { /* inicialização transitória */ }
    if (i + 1 < tentativas) await esperar(250);
  }
  return null;
}

// Mantém apenas sucesso, nunca uma falha transitória.
let modeloAudioCache = null;
async function descobrirModeloAudio(base, health) {
  if (modeloAudioCache) return modeloAudioCache;
  if (health && health.model) {
    modeloAudioCache = health.model;
    return modeloAudioCache;
  }
  try {
    const r = await fetch(base + '/v1/models');
    if (r.ok) {
      const j = await r.json();
      const ids = (j.data || j.models || []).map((m) => (m.id || m.name || '')).filter(Boolean);
      const achado = ids.find((id) => /whisper|transcri|speech.?to.?text|stt|audio/i.test(id)) || ids[0];
      if (achado) modeloAudioCache = achado;
      console.log('[kiln] modelo Whisper local: ' + (achado || 'NENHUM'));
      return achado || null;
    }
  } catch (e) { console.log('[kiln] não listei modelos: ' + e.message); }
  return null;
}

async function transcrever(buf, mime) {
  // SessionStart não inicia processos nem dispara download. Só o uso
  // explícito do microfone pode iniciar o servidor local.
  const { base } = cfgFala();
  const health = await garantirWhisper();
  const model = await descobrirModeloAudio(base, health);
  if (!model) return { erro:
    "local voice server not running yet — run install-voz.sh once, then it auto-starts (first run downloads the model)." };
  const url = base + '/v1/audio/transcriptions';
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(buf)], { type: mime || 'audio/webm' }), 'fala.webm');
  fd.append('model', model);
  let r;
  try {
    r = await fetch(url, { method: 'POST', body: fd });
  } catch (e) { return { erro: 'network: ' + e.message }; }
  if (!r.ok) {
    const t = (await r.text().catch(() => '')).slice(0, 200);
    if (r.status === 404) return { erro: 'servidor Whisper local sem /v1/audio/transcriptions' };
    return { erro: 'HTTP ' + r.status + ' ' + t };
  }
  let j; try { j = await r.json(); } catch { return { erro: 'response is not JSON' }; }
  const texto = (j.text || '').trim();
  if (!texto) return { erro: 'came back empty' };
  clipboard.writeText(texto);
  const colado = colarNoTerminal();   // preenche o terminal; você aperta Enter
  return { texto, colado };
}

// --- colar no terminal (modo "preenche, você aperta Enter") -----------------
// macOS: lembramos qual app você estava usando (o terminal) enquanto trabalha,
// consultando o app em foco de tempos em tempos MENOS quando você está gravando
// (aí o avatar é que está em foco). Assim colamos no lugar certo, não no avatar.
let gravandoAgora = false;
let terminalAlvo = process.env.KILN_TERMINAL_APP || null;
function rastrearTerminal() {
  if (process.platform !== 'darwin' || gravandoAgora) return;
  require('node:child_process').execFile('osascript',
    ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'],
    { timeout: 1500 }, (err, stdout) => {
      if (err) return;
      const nome = String(stdout).trim();
      if (nome && !/electron|kiln/i.test(nome)) terminalAlvo = nome;
    });
}
if (process.platform === 'darwin') setInterval(rastrearTerminal, 2000);

ipcMain.on('gravando', (_e, ligado) => { gravandoAgora = !!ligado; });

// cola o que está na área de transferência no terminal, SEM apertar Enter
function colarNoTerminal() {
  if (process.platform !== 'darwin') return false;      // por ora só macOS
  if (process.env.KILN_VOICE_MODE === 'clipboard') return false;
  const app = (terminalAlvo || 'Terminal').replace(/"/g, '');
  const script = 'tell application "' + app + '" to activate\n'
    + 'delay 0.2\n'
    + 'tell application "System Events" to keystroke "v" using command down';
  try { require('node:child_process').execFile('osascript', ['-e', script]); return true; }
  catch (e) { console.log('[kiln] colar falhou: ' + e.message); return false; }
}

ipcMain.handle('transcrever', (_e, buf, mime) => transcrever(buf, mime));

// a altura vem medida do conteúdo — nada de constante desalinhada cortando texto
ipcMain.on('altura', (_e, h) => {
  if (collapsed) return;                 // minimizado não redefine a altura cheia
  alturaRenderer = Math.max(60, Math.min(900, Number(h) || 0));
  if (win && !win.isDestroyed()) ajustarJanela(WIDTH, alturaRenderer);
});

// a decisão do usuário volta por arquivo — o hook está bloqueado esperando.
// O nonce é emitido pelo hook e devolvido pelo preload; sem os dois vínculos,
// uma resposta antiga ou de outro pedido nunca é aceita.
ipcMain.on('approval:allow-one', (_e, payload) => decidir(payload, 'allow', false));
ipcMain.on('approval:enable-all-and-allow', (_e, payload) => decidir(payload, 'allow', true));
ipcMain.on('approval:disable-all', () => {
  allowAllSession = false;
  emitApprovalState();
  console.log('[kiln] aprovação para toda esta sessão desligada');
});
ipcMain.on('approval:deny-one', (_e, payload) => decidir(payload, 'deny', false));

// Compatibilidade com o companion antigo (index.html não faz parte desta
// mudança). O renderer não envia ferramenta nem mantém a autoridade.
ipcMain.on('responder', (_e, payload) => {
  const decisao = payload && payload.decisao;
  if (decisao === 'always') decidir(payload, 'allow', true);
  else if (decisao === 'allow') decidir(payload, 'allow', false);
  else if (decisao === 'deny') decidir(payload, 'deny', false);
});

// fechar = encerra o avatar desta sessão. Volta no próximo `claude`.
ipcMain.on('fechar', () => { console.log('[kiln] fechado pelo usuário'); app.quit(); });

app.on('window-all-closed', () => app.quit());
app.on('before-quit', clearPid);
process.on('exit', clearPid);
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => { clearPid(); process.exit(0); }));

app.whenReady().then(() => {
  // sem isto o getUserMedia do renderer é negado sem nem perguntar
  try {
    const expectedPage = pathToFileURL(path.join(__dirname, 'index.html')).toString();
    const isKilnMicrophoneRequest = (webContents, permission, details) => {
      if (!webContents) return false;
      const requestingUrl = details && details.requestingUrl || webContents.getURL();
      return permission === 'media' && win && webContents === win.webContents &&
        webContents.getURL() === expectedPage &&
        (!details || requestingUrl === expectedPage || requestingUrl === 'file://');
    };
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      callback(isKilnMicrophoneRequest(webContents, permission, details));
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) =>
      isKilnMicrophoneRequest(webContents, permission, { requestingUrl: requestingOrigin }));
  } catch { /* versão antiga do Electron */ }
  limparPedidos();                 // só após isto a sessão fica pronta
  writePid();
  try {
    const boot = path.join(STATE_DIR, '.boot');
    fs.unlinkSync(boot);
  } catch { /* já foi removido */ }
  if (app.dock) app.dock.hide();
  createWindow();
});
