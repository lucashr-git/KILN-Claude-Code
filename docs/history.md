# Kiln — história, decisões e revisão comparativa

Registro consolidado de origem, decisões, erros do caminho, medições e comparação
com o oh-my-opencode-slim.

## História e decisões

*O que foi construído, como, por quê — e o que ficou de fora de propósito.*

O manual de uso está em [`usage.md`](usage.md). Este documento é o **porquê** de cada
peça: as decisões, os erros do caminho (que valem mais que os acertos), as
medições que fizemos no gateway, e a comparação honesta com a referência.

---

## 1. De onde veio

O ponto de partida foi o **oh-my-opencode-slim** (7.785 estrelas, ~14 mil
downloads/semana): um plugin de orquestração de agentes para o OpenCode. Ele
resolve um problema real e bem documentado — um agente sozinho, numa única
janela de contexto, degrada de três jeitos previsíveis:

1. **Preguiça agêntica** — declara terminado com trabalho pela metade;
2. **Viés auto-preferencial** — prefere o próprio achado a uma verificação
   independente;
3. **Deriva de objetivo** — perde o pedido original ao longo dos turnos.

O remédio do slim é estrutural: **especialistas com janela própria e objetivo
próprio**, coordenados por um orquestrador. O Kiln copia esse diagnóstico
inteiro — e muda o chão: **Claude Code** em vez de OpenCode, **gateway Flow da
CI&T** em vez de assinatura pessoal, **Sonnet 5 + Haiku 4.5** em vez de um
cardápio de provedores.

Essa mudança de chão importa mais do que parece, por um motivo: **metade do
que o slim implementa à mão, o Claude Code já traz nativo** (grafo de
subagents, loop, monitor, worktrees, simplify). Construir de novo seria
manter código pior que o do fabricante. O Kiln, então, é menos "um framework"
e mais **uma configuração afiada**: markdown, hooks de shell, um app Electron
e scripts de medição — quase nada que possa quebrar sozinho.

## 2. As decisões, na ordem em que doeram

**Port nativo, não preset do OpenCode.** Primeiro fork da conversa. Um preset
do OpenCode manteria o runtime deles; um port nativo ganha as ferramentas do
fabricante (LSP nativo, ultracode, Monitor) e perde a variedade de provedores.
Escolhemos profundidade num provedor só — decisão que o gateway depois tornou
obrigatória de qualquer jeito.

**Só Sonnet 5 e Haiku 4.5.** Quando você decidiu largar a assinatura pessoal e
viver só do gateway da CI&T, o desenho de custo virou de cabeça para baixo:
não existe mais "escala para o Opus". A diferença de preço que sobrou é
**sonnet × haiku** (grande) e, dentro do sonnet, o **effort** (low/medium/
high/xhigh). Todo o roteamento dos Claudinhos deriva dessas duas alavancas.

**`/kiln:hard` como substituto do modelo grande.** A pergunta central do
projeto foi: *como fazer um modelo menor entregar o que o maior entregava?*
A resposta que funcionou não é mágica, é processo: forçar observação antes de
teoria, três hipóteses concorrentes (a terceira desconfortável), investigação
paralela barata, e uma rodada adversarial em que um agente é pago para
**derrubar** a conclusão. Cada passo ataca um viés específico de modelo menor.
Dispara sozinho — você não precisa lembrar que ele existe.

**O conductor como thread principal.** O pulo do gato de configuração:
`settings.json` do plugin com `"agent": "conductor"`. Sem isso, o time existia
mas ninguém delegava — você teria que invocar cada agente à mão. Com isso,
toda mensagem sua já cai no gerente, e a delegação vira o padrão, não a
exceção. Foi a peça que fez o sistema *acontecer*.

**Claudinhos, em inglês, com nome de função.** Três rodadas de nomes: os do
slim (colidiam com a origem), depois português (maestro, olheiro…), depois
inglês para portabilidade de equipe — **conductor, scout, researcher, advisor,
builder, stylist, reader**. A regra que sobreviveu às três rodadas: o nome tem
que dizer o ofício. E o coletivo deixou de ser "golems" para ser **Claudinhos**.

**Voz local, não gateway.** O Flow não tem modelo de áudio (medimos: nenhum
`whisper|audio|stt` no `/v1/models`). A voz é opcional e o fluxo suportado do
Kiln é macOS-only; o ditado nativo do macOS é uma alternativa simples. O
`faster-whisper` local (`small`, multilíngue EN/PT-BR/ES) continua fora da
instalação padrão.

**Aprovação pelo avatar via `PreToolUse`.** A primeira versão usava o hook
`PermissionRequest` — e o clique em *allow* não fazia nada, porque esse hook
**honra só deny**. A documentação diz isso num canto; nós descobrimos testando
e conferindo o log. `PreToolUse` com `permissionDecision: allow` é o único
caminho que realmente aprova. Detalhe de design que importa: **silêncio nunca
aprova** — sem clique em ~110s, o hook sai e o terminal decide como sempre.

## 3. Comparação item a item com o slim

### Agentes (deles 8 × nossos 7)

| slim | Kiln | veredicto |
|---|---|---|
| Orchestrator | conductor | ✓ |
| Explorer | scout | ✓ |
| Oracle | advisor | ✓ |
| Librarian | researcher | ✓ |
| Designer | stylist | ✓ (+ Playwright para olhar a página) |
| Fixer | builder | ✓ |
| Observer (desligado por padrão) | reader (**ligado**) | ✓ |
| **Council** (consenso multi-modelo) | — | ✗ impossível: o gateway só tem Anthropic |

O Council é a única perda estrutural: perguntar a mesma coisa a provedores
diferentes e comparar. Mitigação (não substituição): o `/kiln:hard` ataca o
mesmo viés — "um modelo se convence da primeira explicação plausível" — por
**estrutura** (hipóteses forçadas + adversário) em vez de por **variedade**.

### Skills (8 × 8)

| slim | Kiln |
|---|---|
| codemap | `/kiln:codemap` — igual, **melhor**: detecção de mudança por hash |
| deepwork | `/kiln:deepwork` |
| verification-planning | `/kiln:verification-planning` — e dispara sozinho |
| simplify | `/simplify` **nativo** do Claude Code |
| worktrees | `isolation: worktree` **nativo** por agente |
| clonedeps | `/kiln:clonedeps` — com o caminho Maven para o mundo Java |
| reflect | `/kiln:reflect` |
| autoconfig do plugin | não portada **de propósito** (ver §6) |

E uma que o slim não tem: **`/kiln:hard`**.

### Ferramentas e capacidades

| Capacidade | slim | Kiln |
|---|---|---|
| LSP (definição, referências, diagnóstico) | próprio | **nativo** + jdtls/TS/pyright configurados |
| Rename workspace-wide | via LSP deles | não exposto no LSP nativo → coberto por `agrep` dry-run + edição |
| Busca AST (25 línguas) | próprio | `agrep` sobre o **mesmo** ast-grep |
| Doc de biblioteca | context7 | context7 ✓ |
| Código do GitHub | grep.app | grep.app ✓ |
| Busca de pesquisa | Exa | Exa ✓ + WebSearch nativo |
| Automação de navegador | skill Playwright | MCP Playwright (no stylist) ✓ |
| Tarefas em background | motor próprio | **nativo** (paralelo + notificação + cancelar) |
| Painéis ao vivo | tmux/Zellij | `Ctrl+O` no terminal + **avatar** |
| Troca de modelo em runtime | `/preset` | `/model` nativo + função `cc()` |
| Orquestração em grafo | Job Board à mão | `/effort ultracode` **nativo** |
| Loop | skill própria | `/loop` **nativo** |
| Observação de processo | — | Monitor **nativo** |
| Meta persistente | — | `/goal` **nativo** |
| Métricas de custo | **nenhuma** | por Claudinho, por modelo, por token |
| Avatar | janela genérica | sprite por Claudinho, aprovação, voz |
| Maturidade | 7.785 ⭐, 14k dl/semana | um usuário |

### Onde eles ganham, sem desculpa

**Council** (estrutural, já dito) e **maturidade** — milhares de pessoas
achando bug contra uma. Não tem atalho. É por isso que as métricas existem:
elas são o substituto de uma base de usuários.

### Onde nós ganhamos

Instrumentação (avatar com aprovação e voz, métricas por agente), os quatro
motores nativos, effort por agente, memória por agente, worktree por agente,
30+ eventos de hook — e o `/kiln:hard`.

## 4. Como funciona por dentro

```
você ──fala──▶ conductor (thread principal, sonnet high)
                 │ delega por descrição; portão rígido no advisor
   ┌──────┬──────┼──────────┬─────────┐
 scout researcher advisor  builder  stylist   reader
 haiku  sonnet-lo sonnet-xh sonnet-md sonnet-hi haiku
   │      │        │         │         │        │
  LSP  ctx7/grep  LSP+git  LSP+Edit  +Playwright Read
  agrep exa/web   agrep    +Bash
   └──────┴────────┴─────────┴─────────┴────────┘
        devolvem RESUMO, janelas separadas

hooks (settings.json):
  SessionStart  → kiln-track (zera estado) + kiln-open (sobe o avatar da sessão)
  SubagentStart → kiln-track add   ┐ arquivo $TMPDIR/kiln/<sessão>
  SubagentStop  → kiln-track drop  ┘ (avatar lê a cada 500ms)
  SessionEnd    → kiln-track wipe + kiln-close (fecha o avatar da sessão)
  PreToolUse    → kiln-approve (o cartão allow/deny)

aprovação (à prova de paralelo):
  hook escreve  <sessão>.<tool_use_id>.ask   (atômico: tmp+rename)
  avatar mostra o mais antigo; clique escreve <sessão>.<id>.ans
  hook (polling 100ms) lê SÓ o .ans do próprio id → devolve permissionDecision
  ESC/kill → trap limpa; boot do avatar → limpa órfãos; silêncio → terminal decide

voz:
  voice → MediaRecorder + medidor (Web Audio) → WAV/WebM →
  POST 127.0.0.1:8760/v1/audio/transcriptions (faster-whisper local, offline)
  → texto → clipboard → AppleScript foca SEU terminal e cola → você dá Enter
```

Decisões de engenharia que valem registro:

- **Arquivos, não sockets.** Toda a comunicação hook↔avatar é por arquivo em
  `$TMPDIR/kiln/`. Debugável com `cat`, sem daemon, sem porta — e o log de
  aprovação conta a história inteira de cada pedido.
- **Um arquivo por pedido de aprovação.** A primeira versão usava um arquivo
  único e um revisor independente provou que, com builders em paralelo, um
  clique podia aprovar um comando **que você nunca viu**. O protocolo por-id
  matou a classe inteira de bug.
- **O avatar mede a própria altura.** As primeiras versões calculavam altura
  por constantes e viviam cortando texto. Agora o renderer mede o conteúdo e
  avisa o main — a classe de bug "etiqueta cortada" morreu junto.
- **Sprites canônicos.** Os Claudinhos derivam do bichinho oficial do Claude
  Code: mesma silhueta, cor chapada, contorno branco. Variação **só** por
  expressão e adereço — o corpo é a marca. Fonte em `art/sprites.py`, grade de
  texto onde `#` é pixel.
- **CA da CI&T injetada no certifi.** A rede da empresa intercepta TLS e o
  `httpx` (que o Hugging Face usa) ignora variáveis de ambiente. O
  `install-voz.sh` injeta o certificado corporativo dentro do `certifi` do
  venv — e depois disso a voz roda offline para sempre (`HF_HUB_OFFLINE=1`).

## 5. Os erros do caminho (a parte mais útil deste documento)

**"O limite é 200k" — errado.** O bloqueio que vimos era do Claude Code local,
não do gateway. **"O teto medido é 400k" — errado de novo**: a mensagem de
erro dizia `limit 1000000` na mesma linha, e a leitura parou no número que
confirmava a expectativa. O teto real é **1M**, e o overhead real por sessão é
**5,6k** (0,6%) — o "482k de overhead" era artefato da sonda contando o mesmo
stdin duas vezes. *Lição: viés de ancoragem em diagnóstico é real e recorrente
— é literalmente o caso de uso do `/kiln:hard`.*

**"A rede da CI&T bloqueia o grep.app" — errado.** Três respostas insistindo
em bloqueio corporativo, pedido de teste em VPN e 4G… e a causa era uma linha
de JSON incompleta (`{"url": ...}` sem `"type": "http"`), escrita por nós. O
`curl` que **você** insistiu em rodar derrubou a certeza. *Lição: a explicação
plausível faz parar de procurar a verdadeira.*

**"O clique aprova" — não aprovava.** O hook `PermissionRequest` aceita o JSON
de resposta e ignora o `allow` silenciosamente. Só o log (`FIRE → DEVOLVIDO`
sem efeito) provou que a ponte funcionava e o destinatário não. *Lição:
instrumente antes de teorizar — o log de 4 linhas resolveu o que três turnos
de hipótese não resolveram.*

**O arquivo único de aprovação.** Um revisor independente (segundo passe, sem
ver o primeiro) achou o cenário: dois pedidos no mesmo segundo → mesmo id de
fallback → um clique aprova os dois, incluindo o que nunca apareceu na tela.
*Lição: revisão independente paga. O autor não acha o próprio bug estrutural.*

**Quatro bugs empilhados no botão de minimizar.** Barra invisível não recebe
clique no macOS; `no-drag` dentro de `drag` é instável; janela sem foco engole
o primeiro clique; `click` chega tarde. Consertar um só não resolvia — por
isso "o botão não funciona" sobreviveu a três correções. *Lição: sintoma único
pode ter causas empilhadas.*

**E o preload incompleto.** Três rodadas de correção no renderer sem efeito,
porque a ponte (`preload.js`) não expunha as funções — todo clique estourava
TypeError silencioso. *Lição: quando nada do que você muda tem efeito, o bug
está na camada que você não está olhando.*

## 6. O que ficou de fora — e por quê

| Não tem | Por quê |
|---|---|
| Council multi-modelo | impossível no gateway (só Anthropic); mitigado pelo `/kiln:hard` |
| Skill de autoconfiguração | com um usuário, editar `agents/*.md` direto é mais rápido e auditável; o `kiln-doctor` cobre a detecção de quebra |
| Transcrição pelo gateway | o Flow não tem modelo de áudio — medido, não suposto |
| Linux/Windows | não são plataformas suportadas pelo instalador/Kiln completo; voz permanece fora do fluxo padrão |
| Site tipo ohmyopencodeslim.com | é vitrine de produto público; antes vem repositório público, e antes disso vêm duas semanas de métricas |
| CrewAI / SDK externo | exigiria API key paga por token e perderia o cache de 97% |

## 7. As medições (fatos, não achismos)

| O quê | Resultado | Como medimos |
|---|---|---|
| Efforts aceitos pelo gateway | todos os 6, até `ultracode` | sondagem + teste real com workflow |
| Teto de contexto do gateway | **1.000.000** | a recusa literal: `limit 1000000` |
| Overhead por sessão | **5,6k** (0,6%) — MCP/agents/memória = 0 | `/context` |
| MCPs conectados | 5 (atlassian, context7, exa, grep, playwright) | `/mcp` |
| Aprovação avatar→chat | funciona (`FIRE → ALLOW` em 3s) | approve.log |
| Voz em português | transcrição correta, offline | teste real no avatar |
| Linha de base de delegação | **22%** fora da janela principal | claude-metrics, pré-Kiln |

## 8. Roadmap honesto

O que **não** precisa de mais nada para valer: o sistema está completo para o
uso diário. A próxima milha não é código — é **usar duas semanas e deixar o
`kiln-metrics` dizer** se a delegação está acontecendo.

O que pode vir depois, se o uso pedir:

1. **Suporte a Linux/Windows** — somente se o instalador deixar de ser macOS-only;
   por ora não é uma plataforma suportada.
2. **Site no GitHub Pages** com os Claudinhos animados — quando (se) o
   repositório virar público. Os sprites já renderizam em canvas web.
3. **Chamado à TI** para liberar `mcp.grep.app`… não: **desnecessário** — era
   a config, já funciona. (Mantido aqui como lembrete do erro.)
4. **`KILN_WHISPER_MODEL=medium`** se o PT-BR do `small` escorregar em termo
   técnico.
5. **Distribuir para o time**: usar o pacote publicado e `kiln install`; cópia
   manual não é o fluxo suportado.

O que **não** deve vir: mais peça antes de duas semanas de uso real. Construir
em cima de algo não usado é a armadilha padrão de ferramenta pessoal — e a
única defesa é o número do relatório semanal.

---

## Revisão comparativa com o oh-my-opencode-slim

Conferido item a item contra a documentação oficial deles em 19/08/2026
(ohmyopencodeslim.com e alvinunreal/oh-my-opencode-slim, 6.9k estrelas).

## 1. Agentes: 8 deles × 7 nossos

| slim | Kiln | situação |
|---|---|---|
| Orchestrator (gpt-5.6-terra medium) | orchestrator (sonnet high) | ✓ |
| Explorer (luna) | scout (haiku) | ✓ nome diferente |
| Oracle (sol high) | oracle (sonnet xhigh) | ✓ |
| Librarian (luna) | librarian (sonnet low) | ✓ |
| Designer (luna) | designer (sonnet high) | ✓ |
| Fixer (luna medium) | fixer (sonnet medium) | ✓ |
| Observer (desligado por padrão) | observer (haiku, LIGADO) | ✓ |
| Council (vários provedores) | — | ✗ impossível no gateway |

Council: pergunta a mesma coisa a provedores diferentes. Só temos Anthropic.
Substituto: /kiln:hard — hipóteses concorrentes + evidência + verificador
separado. Ataca o mesmo viés por estrutura em vez de variedade.

## 2. Skills: 8 × 8 (fechou hoje)

| slim | Kiln |
|---|---|
| codemap | /kiln:codemap ✓ (melhor: hash) |
| deepwork | /kiln:deepwork ✓ |
| verification-planning | /kiln:verification-planning ✓ (dispara sozinho) |
| simplify | /simplify NATIVO do Claude Code ✓ |
| worktrees | isolation: worktree NATIVO por golem ✓ |
| clonedeps | /kiln:clonedeps ✓ PORTADO HOJE (com caminho Maven) |
| reflect | /kiln:reflect ✓ PORTADO HOJE |
| autoconfig do plugin | edição direta + kiln-doctor.sh (~ decisão) |

/kiln:hard não existe no slim — é nosso.

## 3. Ferramentas: empate completo

LSP (nativo + jdtls/TS/pyright) · AST 25 línguas (agrep) ·
context7 ✓ · grep.app ✓ · Exa ✓ + WebSearch nativo.
Os três MCPs deles são os três do nosso .mcp.json.

## 4. Onde eles ganham

- Council multi-provedor (irrecuperável; mitigado, não substituído)
- /preset → coberto pelo /model nativo e pela função cc() do shell
- ping all agents → sem equivalente; modo de falha não existe aqui
- Maturidade: 6.9k estrelas × 1 usuário → por isso as métricas

## 5. Onde nós ganhamos

Companion deles: janela genérica + tmux. Nosso: sprite por golem, painel com
cronômetro, APROVAR/NEGAR permissão na janela (PermissionRequest de verdade),
ditado por voz, fechar com confirmação. E: ultracode, /loop, Monitor, /goal,
effort por golem, memory, worktree, 30+ hooks, métricas por golem.

## 6. Microfone: veredito do HTTP 500

"OpenAIProvider.__init__() missing responses_api_base" = LiteLLM dentro do
Flow sem modelo de áudio configurado. Não é consertável do nosso lado.
O botão agora explica e aponta o ditado nativo do macOS (Fn Fn).
Se o Flow ganhar áudio um dia, funciona sem mexer em nada
(ou aponte KILN_STT_URL/KILN_STT_KEY para outro serviço).

## 7. Resposta curta

Igual em agentes, skills e ferramentas — 100% do possível num gateway de
provedor único, desde hoje. Exceções nomeadas: Council (impossível) e
autoconfig (decisão). Em instrumentação, o Kiln passou na frente.

Para valer no disco: `bunx @lucashr/kiln@0.1.0 install`.
Novas: /kiln:clonedeps e /kiln:reflect
