const { contextBridge, ipcRenderer } = require('electron');

let pedidoAtual = null;

function payloadAtual(id) {
  if (!pedidoAtual || !pedidoAtual.id || !pedidoAtual.nonce ||
      pedidoAtual.requestId !== pedidoAtual.id) return null;
  if (id != null && id !== pedidoAtual.id && id !== pedidoAtual.requestId) return null;
  return { ...pedidoAtual };
}

function decidir(channel, id) {
  const payload = payloadAtual(id);
  if (payload) ipcRenderer.send(channel, payload);
}

function responder(id, decisao, tool) {
  // `tool` permanece na assinatura pública por compatibilidade. A decisão
  // usa o pedido recebido pelo main, incluindo seus vínculos de segurança.
  void tool;
  if (decisao === 'allow') decidir('approval:allow-one', id);
  else if (decisao === 'deny') decidir('approval:deny-one', id);
  else if (decisao === 'always') decidir('approval:enable-all-and-allow', id);
}

contextBridge.exposeInMainWorld('kiln', {
  onAgents:    (cb) => ipcRenderer.on('agents',    (_e, a) => cb(a)),
  onMeta:      (cb) => ipcRenderer.on('meta',      (_e, m) => cb(m)),
  onCollapsed: (cb) => ipcRenderer.on('collapsed', (_e, c) => cb(c)),
  onApprovalState: (cb) => ipcRenderer.on('approval-state', (_e, s) => cb(!!(s && s.allowAllSession))),
  onAsk:       (cb) => ipcRenderer.on('ask',       (_e, p) => {
    pedidoAtual = p && p.id ? p : null;
    cb(p);
  }),
  onApprovalRequest: (cb) => ipcRenderer.on('ask', (_e, p) => {
    pedidoAtual = p && p.id ? p : null;
    cb(p);
  }),
  toggleCollapse: ()          => ipcRenderer.send('toggle-collapse'),
  allowOne:       (id) => decidir('approval:allow-one', id),
  enableAllAndAllow: (id) => decidir('approval:enable-all-and-allow', id),
  disableAll:     () => ipcRenderer.send('approval:disable-all'),
  denyOne:        (id) => decidir('approval:deny-one', id),
  // Compatibilidade com o HTML existente; decisões continuam sendo validadas
  // e executadas pelo main, sem ferramenta ou estado de aprovação no renderer.
  responder,
  fechar:         ()          => ipcRenderer.send('fechar'),
  transcrever:    (buf, mime) => ipcRenderer.invoke('transcrever', buf, mime),
  altura:         (h)         => ipcRenderer.send('altura', h),
  gravando:       (b)         => ipcRenderer.send('gravando', b),
});
