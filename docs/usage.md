# Kiln — Manual do Usuário

*Time de Claudinhos especialistas para o Claude Code, rodando no gateway Flow
da CI&T com Sonnet 5 e Haiku 4.5.*

Este é o manual de **uso**: o que existe, quando usar cada coisa, e como. A
história do projeto — por que cada decisão foi tomada, comparação com o
oh-my-opencode-slim, erros do caminho — está em [`history.md`](history.md).

---

## 1. Mapa rápido (cola isto na parede)

```
FALAR COM O TIME
  (só conversar)            o conductor delega sozinho — o normal é não invocar nada
  @scout onde fica X?       recon barato de codebase (haiku)
  @researcher como Y funciona?   doc oficial + GitHub + web
  @advisor vale a pena Z?   SÓ após 2 falhas ou decisão cara (é o lane mais caro)
  @builder implementa W     spec fechada, multi-arquivo
  @stylist                  interface visível ao usuário
  @reader analisa img.png   imagem/PDF/diagrama fora da sua janela

SKILLS
  /kiln:codemap             1x por repositório novo — o maior retorno do pacote
  /kiln:plan-run            antes de tarefa grande: escolhe o motor
  /kiln:hard                dispara SOZINHO em problema difícil
  /kiln:deepwork            trabalho que não cabe numa sessão
  /kiln:clonedeps           ler o fonte de uma dependência suspeita
  /kiln:reflect             fim de sessão longa: atrito → melhoria
  /kiln:verification-planning  dispara sozinho antes de mudança arriscada

MOTORES NATIVOS
  /effort ultracode         grafo: 3+ peças independentes + verificação
  /loop <o que checar>      repetir até condição bater
  "fica de olho em X e me avisa"   Monitor: esperar sem gastar token

MEDIR (1x por semana)
  kiln-metrics --since 7 --fonte gateway     → "fora da janela principal" vs 22%
```

---

## 2. Instalação

```bash
# 1. instalador publicado: marketplace, plugin, hooks e companion durável
bunx @lucashr/kiln@0.1.0 install

# 2. voz local por Whisper já é instalada pelo comando acima (download único)
#    use `kiln install --without-voice` para pulá-la explicitamente

# 3. diagnóstico da sessão: use os comandos do Claude Code
```

A voz usa somente Python 3.12 ou 3.13. Se nenhum estiver no `PATH`, `kiln
install` instala `python@3.12` via Homebrew, consulta `brew --prefix
python@3.12` e passa o executável ao instalador por `KILN_PYTHON`. Na execução
manual, `install-voz.sh` encerra antes de criar ou alterar o venv e orienta
`brew install python@3.12`.

Binários externos que o plugin usa se existirem (o doctor confere):
`jq` (obrigatório para os hooks), `ast-grep` (busca estrutural), `jdtls`
(LSP de Java), `typescript-language-server`, `pyright`.

Depois de instalar, **feche e reabra o Claude Code**. O cabeçalho deve mostrar
`@kiln:conductor` — é o sinal de que o time assumiu a thread principal.

Dentro do Claude Code, três verificações de 10 segundos:

| Comando | O que deve aparecer |
|---|---|
| `/context` | os 7 Claudinhos em *Custom agents*, tudo perto de 0 token |
| `/mcp` | 5 servidores conectados: atlassian, context7, exa, grep, playwright |
| `@scout onde fica X?` | resposta em `arquivo:linha` + o Claudinho no avatar |

---

## 3. Os 7 Claudinhos

Cada um roda em **janela de contexto própria** — o que ele lê não entra na sua.
Devolvem resumo, nunca conteúdo bruto. O nome diz a função:

| Claudinho | modelo | esforço | ofício |
|---|---|---|---|
| **conductor** | sonnet | high | rege e delega — é a thread principal, você fala com ele |
| **scout** | haiku | — | acha onde as coisas estão no código |
| **researcher** | sonnet | low | busca fora: doc oficial, GitHub, web |
| **advisor** | sonnet | xhigh | decisão difícil, review, debug que resistiu |
| **builder** | sonnet | medium | implementa spec fechada, multi-arquivo |
| **stylist** | sonnet | high | interface, layout, animação (tem Playwright) |
| **reader** | haiku | — | imagem/PDF/diagrama → texto estruturado |

### Quando usar cada um (e quando não)

**Você quase nunca invoca ninguém.** O conductor é a thread principal: você
conversa, ele decide quem chamar. O `@nome` explícito é para **forçar** quando
você já sabe o caminho.

**@scout** — "onde está o handler do webhook?", "que arquivos tocam a entidade
Payment?", "que padrões de retry existem aqui?". Ele tem LSP (definição,
referências, hierarquia de chamadas) e `agrep` (busca por estrutura de código,
não por texto). Devolve mapa em `arquivo:linha`, nunca cola conteúdo.
*Não use* quando você já sabe o arquivo e vai editar direto.

**@researcher** — "como o `@RetryableTopic` funciona na versão 3.1?", "como os
outros fazem idempotência de consumer Kafka?", "o que se sabe sobre esse erro
do Testcontainers?". Ordem de busca dele: **context7** (doc oficial da versão
certa) → **grep.app** (código real de milhões de repositórios públicos) →
**Exa** (discussão técnica) → WebSearch. Quando a doc e a prática divergem,
ele diz — e essa é a resposta mais valiosa que ele traz.
*Não use* para conhecimento geral de programação que o conductor já tem.

**@advisor** — o lane mais caro do sistema, e por isso tem um **portão**: só é
chamado se uma destas for verdade (e o conductor tem que dizer qual):
(a) a correção já falhou **duas vezes**; (b) é decisão de arquitetura **cara de
reverter**; (c) você precisa que alguém **derrube** uma hipótese que você
sustenta. Chamar o advisor "por precaução" é o erro mais caro do ambiente.
Ele é só-leitura: aconselha com `arquivo:linha`, não implementa.

**@builder** — mudança multi-arquivo com o "o quê" **já decidido**. Recebe spec,
executa, roda o LSP depois de cada edição (erro de tipo aparece sozinho) e
reporta com honestidade o que verificou e o que pulou. Teto de 40 turnos.
*Não use* quando falta decisão — spec ambígua ele devolve, não inventa.

**@stylist** — tudo que o usuário final vê: layout, hierarquia, animação. Tem
o Playwright para **abrir a página e olhar** o que renderizou, em vez de
confiar no que o código diz. Fraqueza declarada: texto — peça revisão de copy.

**@reader** — todo arquivo visual (screenshot, PDF, diagrama). Existe por um
motivo só: manter os **bytes da mídia fora da sua janela**. Passe o caminho
completo do arquivo.

### A lógica de custo (por que os modelos são esses)

No gateway só existem **Sonnet 5** e **Haiku 4.5**. Então:

- A diferença de preço que importa é **sonnet × haiku** — toda leitura e busca
  que puder ir para scout/reader (haiku) deve ir. É o filtro barato que
  protege sua janela.
- Entre os Claudinhos de sonnet, quem separa caro de barato é o **effort**:
  researcher em `low` (só busca e resume), builder em `medium` (executa, não
  decide), advisor em `xhigh` (é onde profundidade vira qualidade).
- Não existe Opus/Fable aqui. Quando o problema pediria um modelo maior, o
  caminho não é "pedir com mais ênfase" — é o `/kiln:hard` (seção 5).

---

## 4. As skills

| Skill | Dispara | Para quê |
|---|---|---|
| `/kiln:codemap` | manual | mapa do repositório, um `codemap.md` por pasta |
| `/kiln:plan-run` | manual | escolhe o motor de execução antes de tarefa grande |
| `/kiln:hard` | **sozinha** + manual | protocolo para problema difícil |
| `/kiln:verification-planning` | **sozinha** + manual | caminho de evidência antes de mudar código |
| `/kiln:deepwork` | manual | trabalho maior que uma sessão (estado em disco + revezamento) |
| `/kiln:clonedeps` | manual | traz o fonte de dependência para `.kiln/deps` e lê |
| `/kiln:reflect` | manual | atrito repetido da sessão → proposta de melhoria |

**`/kiln:codemap`** — rode **uma vez** ao entrar num repositório desconhecido.
Ele dispara um `@builder` por pasta em paralelo e escreve um `codemap.md` de
até 40 linhas em cada uma, dizendo o que existe ali e por quê. A partir daí,
toda pergunta lê o mapa em vez de dez arquivos — é o maior economizador de
contexto do pacote. Detecção por hash: rodar de novo só reprocessa o que mudou.

**`/kiln:hard`** — o substituto do modelo grande. Dispara sozinho quando o
conductor detecta: correção falhou 2×, causa raiz obscura, comportamento que
contradiz o código, ou decisão cara. O protocolo: observar antes de teorizar →
**três hipóteses** (a terceira desconfortável) → investigação paralela barata →
**rodada adversarial** (um advisor cujo único trabalho é derrubar a hipótese
sobrevivente) → caminho de evidência → releitura do alvo original. Não é
cerimônia: cada passo ataca um viés documentado de modelo menor.

**`/kiln:plan-run`** — te interroga (objetivo, critério de sucesso, quem
executa, quem verifica, teto de tentativas) e escolhe entre os quatro motores.
A pergunta 2 é a que importa: **como a máquina sabe que acabou?** Sem resposta,
ele se recusa — trabalho sem critério vira loop infinito educado.

**`/kiln:deepwork`** — para migração/auditoria/feature que passa de uma
sentada. Mantém estado em `.kiln/`, faz revezamento quando a janela enche, e o
trabalho sobrevive a compactação e a fechar o terminal.

**`/kiln:clonedeps`** — quando a biblioteca se comporta diferente da doc.
Traz o fonte dela para `.kiln/deps/` (no seu caso: `mvn dependency:sources` e
descompacta a lib suspeita) e aí scout/advisor respondem lendo o código real
da dependência, com prova em `arquivo:linha`.

**`/kiln:reflect`** — fim de sessão longa com idas e vindas. Procura três
coisas: correção pedida 2×, pergunta re-respondida, sequência manual repetida.
Cada atrito vira UMA proposta (regra, skill, ajuste de Claudinho, alias) — e
nada é implementado sem você escolher.

Duas do slim que você tem **nativas** (não precisam de skill): `/simplify`
(refactor que preserva comportamento) e worktrees (`isolation: worktree` já
está no frontmatter dos Claudinhos que editam).

---

## 5. Os motores de execução (todos nativos)

A regra de bolso do `/kiln:plan-run`:

| Situação | Motor | Como ligar |
|---|---|---|
| uma raia, verificável de uma vez | **direto** | só delega |
| 3+ peças independentes, ou precisa de verificação por outro olho | **grafo** | `/effort ultracode` + descreva o resultado |
| repetir trabalho até condição bater | **loop** | `/loop 5m checa o CI e conserta o que falhar` |
| só esperar um evento | **observação** | "fica de olho no log e me avisa quando sair exception" |

A regra que decide entre os dois últimos: se você ia ficar perguntando **"já
terminou?"** → Monitor (zero token enquanto espera). Se ia ficar **fazendo
algo** a cada verificação → Loop.

`ultracode` é por sessão (`/effort ultracode` de novo para sair). O effort
padrão das suas sessões é `high` (persistente no settings.json).

---

## 6. O avatar

Uma janela flutuante por sessão do Claude Code. Abre sozinha, fecha sozinha.

### Anatomia

```
[ nome-do-projeto            voice  –  × ]   ← barra (clique = minimizar)
[ needs approval · Bash                  ]   ← cartão de aprovação (quando há)
[   rm -rf build && mvn install          ]
[   [ allow ]        [ deny ]            ]
[ 🟦 scout        33s                    ]   ← painel: um mini claudinho por
[ 🟩 builder      42s                    ]     agente vivo, com cronômetro
[ +4 more                                ]
[            (claudinho)                 ]   ← o bicho: dorme (zzz) sem trabalho,
[            2 working                   ]     acorda quando o time trabalha
```

- **Minimizar**: clique na barra (ou no `–`, ou duplo clique no bicho, ou tecla
  `M`). Vira um cotoco só com o bicho; clique de novo devolve.
- **Fechar (`×`)**: pergunta antes — *"Close the avatar only? Your Claude Code
  session keeps running."* Fechar o avatar **nunca** mexe na sessão.
- Arraste a janela **pelo bicho**.

### Aprovação pela janela

Quando o Claude Code precisa de permissão (modo manual ⏸), o cartão âmbar
aparece com a ferramenta e o comando, e um `!` pula sobre o bicho. **allow**
aprova e o chat segue; **deny** nega. Se você não clicar em ~110s, o hook sai
de cena e o prompt normal do terminal decide — o avatar nunca trava a sessão.

Detalhes que importam:
- Só intercepta ferramentas que **mudam** algo (Bash, Write, Edit…). Leitura
  passa direto.
- Respeita os modos automáticos: em `acceptEdits`/`bypassPermissions` ele não
  aparece — você já disse que aceita tudo.
- Pedidos **paralelos** (vários builders) entram em fila, um por vez, cada um
  com id próprio — um clique nunca aprova o que você não viu.
- Diagnóstico: `cat "${TMPDIR:-/tmp}/kiln/approve.log"` conta a história de
  cada pedido (`FIRE` → `ALLOW/DENY/TIMEOUT`).

### Voz (ditado)

Clique **voice** → as 14 barrinhas dançam com sua voz (*● listening…*) →
fale → clique **voice** de novo. O texto transcrito **entra sozinho no campo
do chat** e o cartão diz *"filled in — just press Enter"*. Você revisa e dá
Enter. (Se a colagem automática não rolar, ele fica na área de transferência:
*"copied — Cmd+V in the chat"*.)

- **Offline e local**: Whisper `small` rodando na sua máquina. Nada vai para
  gateway nenhum.
- **Idiomas**: detecta sozinho — português, inglês e espanhol com boa
  qualidade (e mais ~96 idiomas).
- **Primeira transcrição** demora uns segundos a mais (modelo carregando).
- **macOS pede permissão de Acessibilidade** na primeira colagem — conceda uma
  vez em Ajustes → Privacidade e Segurança → Acessibilidade.

### Variáveis de ambiente (todas opcionais)

| Variável | Padrão | Para quê |
|---|---|---|
| `KILN_APPROVE_TIMEOUT` | 110 | segundos que o cartão espera seu clique |
| `KILN_WHISPER_MODEL` | small | `base` (rápido) · `small` · `medium` (melhor) |
| `KILN_STT_PORT` | 8760 | porta do servidor de voz local |
| `KILN_STT_URL` | — | usar outro endpoint de transcrição em vez do local |
| `KILN_TERMINAL_APP` | auto | força onde a voz cola (ex.: `iTerm2`) |
| `KILN_VOICE_MODE` | — | `clipboard` desliga a colagem automática |

---

## 7. Métricas — o ritual de uma vez por semana

```bash
kiln-metrics --since 7 --fonte gateway
# (alias de: python3 ~/.claude/claude-metrics.py)
```

Lê os transcripts locais (custa **zero** token) e quebra o gasto por Claudinho,
por modelo e por tipo de token. **Um número importa**: *trabalho fora da
janela principal*. É quanto do custo aconteceu nas janelas dos especialistas
em vez da sua.

Sua linha de base, medida antes do Kiln: **22%**. Se depois de uma semana de
uso real esse número não subiu, o time não está sendo usado — e aí o conserto
é nas regras de delegação do conductor, não em construir mais peça.

O `--fonte gateway` filtra só o que passou pela CI&T (sem misturar conta
pessoal). `--html r.html` gera relatório visual.

---

## 8. Ferramentas de manutenção

| Ferramenta | Para quê |
|---|---|
| `kiln-doctor.sh` | 20 checagens: o que está de pé e o que falta |
| `testar-avatar.sh` | sobe o avatar com 12 Claudinhos falsos + pedido de aprovação falso — testa tudo sem gastar token |
| `kiln install` | registra marketplace/enabledPlugins via Claude CLI |
| `limpar-sessoes.py --dias 30` | inventário/limpeza de estado velho do ~/.claude |
| `sondar-gateway.sh` | mede o gateway de verdade: efforts aceitos e teto de contexto |
| `ajustar-settings.py --janela 1m` | declara a janela de contexto no settings |
| `dieta-contexto.py` | mede o overhead de skills/agents/MCP por sessão |
| `checar-compatibilidade.py` | valida o plugin contra o SEU settings.json real |
| `install-voz.sh` | instala/atualiza o Whisper local; `kiln install` executa por padrão |

Logs quando algo estranhar: `/tmp/kiln-companion.log` (avatar),
`/tmp/kiln-stt.log` (voz), `$TMPDIR/kiln/approve.log` (aprovações).

---

## 9. Receitas do dia a dia (QA · Java/Spring)

**Entrar num repositório que você não conhece**
```
/kiln:codemap
@scout onde fica a configuração de transação?
```

**Bug que você já tentou consertar duas vezes**
```
@advisor a cobrança duplica no retry do webhook. Já tentei idempotência no
controller e lock otimista no service — nenhum resolveu.
```
(ou deixe: na segunda falha o conductor liga o `/kiln:hard` sozinho)

**Refactor em três módulos independentes**
```
/kiln:plan-run          → ele vai escolher o grafo
/effort ultracode
refatora os três controllers de pagamento para o novo PaymentGateway, um
builder por controller em paralelo, e um advisor que revê sem ter escrito
```

**Esperando o CI**
```
fica de olho no pipeline e me avisa quando terminar        ← Monitor
/loop checa o CI da branch e se falhar diagnostica e sobe a correção mínima
```

**Screenshot de bug / PDF de spec**
```
@reader analisa ~/Downloads/erro-tela-pagamento.png — que estado da UI é esse?
```

**Biblioteca se comportando diferente da doc**
```
/kiln:clonedeps
@scout o que o RestTemplate faz de verdade no retry? procura em .kiln/deps
```

**Fim de uma sessão longa e cheia de idas e vindas**
```
/kiln:reflect
```

---

## 10. Solução de problemas

| Sintoma | Causa provável | Conserto |
|---|---|---|
| Avatar não abre | Electron não instalado / hook não registrado | `kiln install` de novo; reabra o Claude Code |
| Avatar abre mas nenhum Claudinho aparece | falta `jq` | instale `jq` (Homebrew é opcional se ele já estiver no PATH) |
| Cliquei allow e o chat não andou | sessão antiga (hook velho) | feche TODAS as sessões claude e reabra |
| Cartão de aprovação não aparece | sessão em modo automático (correto: ele respeita) | `Shift+Tab` até o modo manual ⏸ |
| Voz: "local voice server not running" | primeiro boot do modelo demora | espere ~10s e clique de novo; `curl -s 127.0.0.1:8760/` |
| Voz: erro de rede na instalação | certificado da CI&T | o `install-voz.sh` já resolve (injeta a CA no certifi) |
| Voz não cola no chat | permissão de Acessibilidade não dada / terminal não detectado | conceda em Ajustes; ou `export KILN_TERMINAL_APP="iTerm2"` |
| `/mcp` sem grep/exa | falta `"type": "http"` no .mcp.json | reinstale — a versão atual já tem |
| grep.app "não alcançável" no doctor | é só o teste HEAD; MCP real usa POST | confie no `/mcp`, não no curl |
| Claudinhos fantasmas no doctor | sessões que morreram sem hook de fim | limpa sozinho em 4h; inofensivo |

---

## 11. Segurança

- Os tokens (Flow e Jira) moram em `~/.config/flow/env` com permissão 600 —
  **nunca** de volta no `.zshrc`, que é o arquivo que você abre na frente dos
  outros e cola em issues.
- Os dois tokens antigos apareceram em texto durante a configuração (num trace
  de shell e num settings colado). Se você ainda não **rotacionou** ambos —
  Flow no portal da CI&T, Jira em id.atlassian.com → API tokens — faça. Token
  exposto uma vez é token queimado.
- O hook de aprovação **nunca** aprova por padrão: silêncio = decide no
  terminal, como sempre foi. E ele não roda nos modos automáticos.

---

## 12. Onde mora cada coisa

```
~/Downloads/kiln/           ← fonte (edite aqui, publique/instale para valer)
  plugin/                   ← o plugin: agents/ skills/ .mcp.json .lsp.json
  companion/                ← o avatar (main.js, index.html, preload.js, sprites)
  hooks/                    ← os 4 hooks de shell
  art/sprites.py            ← editor dos sprites (grade de texto, # = pixel)
  *.py, *.sh                ← ferramentas de manutenção

~/.claude/
  skills/kiln/              ← plugin instalado (carrega sozinho em toda sessão)
  kiln/                     ← avatar instalado
  kiln-stt/                 ← Whisper local (venv + servidor)
  hooks/kiln-*.sh           ← hooks instalados
  claude-metrics.py         ← métricas
  settings.json             ← estado do usuário; CLI registra marketplace/plugins

$TMPDIR/kiln/               ← estado vivo (por sessão): agentes, pedidos, pids
```

Editar um Claudinho = editar `../plugin/agents/<nome>.md` e rodar `kiln install`.
Editar um sprite = mexer em `art/sprites.py` e rodar
`python3 art/sprites.py` (regenera as duas cópias do `golems.json`).
