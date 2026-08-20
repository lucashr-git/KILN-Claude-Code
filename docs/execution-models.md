# Kiln — loop, grafo, e a potência real

Resposta às três perguntas: **vale a pena criar um loop?**, **ou um grafo?**, e
**qual é a potência real que temos comparada com a deles?** No fim, onde e como
você usa isso no dia a dia.

Tudo conferido na documentação oficial em 19/08/2026.

---

## 1. Loop ou grafo? Nem um nem outro — os dois já existem

Essa é a descoberta que muda o plano. O Claude Code tem **quatro motores de
execução nativos**. O oh-my-opencode implementa versões caseiras de três deles
em TypeScript. Construir os nossos seria refazer trabalho pior.

| Motor | O que faz | No OMOS | No Claude Code |
|---|---|---|---|
| **Grafo** | Escreve um script que dispara e coordena subagents com dependências | Orchestrator + Background Job Board, à mão | `/effort ultracode` — **nativo** |
| **Loop** | Repete um prompt até a condição bater | skill `loop-engineering` | `/loop` — **nativo** |
| **Observação** | Roda algo em background e avisa quando muda | não tem | Monitor — **nativo** |
| **Meta persistente** | Continua trabalhando rumo a uma condição, turno a turno | não tem | `/goal` — **nativo** |

### O que é o grafo, na prática

`/effort ultracode` faz o Claude **escrever um script JavaScript de
orquestração para a tarefa** — que dispara subagents, decide qual modelo cada
um usa, se roda em worktree isolada, e coordena as dependências. É literalmente
"graph engineering", e vem pronto.

Ele existe para resolver três falhas que aparecem quando um agente trabalha
sozinho numa janela só:

- **preguiça agêntica** — dizer que terminou com progresso parcial;
- **viés auto-preferencial** — preferir o próprio achado a uma verificação independente;
- **deriva de objetivo** — perder o pedido original ao longo dos turnos.

O combate é estrutural: janelas separadas e objetivo próprio por subagent. É o
mesmo remédio que o OMOS aplica — só que aqui não precisa manter código.

### O que é o loop, na prática

```
/loop 5m checa se o CI passou e conserta o que falhou
/loop     checa CI e comentários de review     ← sem intervalo, ele escolhe o ritmo
```

Sem intervalo, o Claude escolhe o próprio ritmo entre 1 minuto e 1 hora,
baseado no que observou — espera pouco enquanto o build corre, espera muito
quando fica quieto. Ele imprime o intervalo e o motivo a cada rodada, e pode
encerrar sozinho quando termina.

E tem um detalhe: `.claude/loop.md` no projeto vira o prompt padrão do `/loop`
sem argumento. É o `loop-engineering` do OMOS, em um arquivo de markdown.

### A regra que decide entre loop e observação

> Se você ia ficar perguntando **"já terminou?"** → Monitor.
> Se você ia ficar **fazendo alguma coisa** a cada verificação → Loop.

Monitor roda um script em background e te interrompe só quando sai uma linha
nova. Não gasta token repetindo prompt. Polling manual é o pior dos dois mundos
e é o que a maioria das pessoas faz.

### Então o que eu construí

Uma skill de **três parágrafos e seis perguntas**, `/kiln:plan-run`, que é o
"Grill" do OMOS adaptado: ela te interroga (objetivo, critério de sucesso, quem
executa, quem verifica, teto de tentativas, contexto obrigatório) e depois
**escolhe qual dos quatro motores usar** e monta a execução.

O valor não está no motor. Está em não deixar você começar sem critério de
sucesso — que é o que transforma loop em loop infinito educado.

---

## 2. A lacuna maior fechou sozinha: o LSP é nativo

Eu disse na análise anterior que LSP era a maior vantagem deles. Fui checar de
novo com mais cuidado: **o Claude Code tem uma ferramenta `LSP` embutida.**

Ela faz:

- pular para a definição de um símbolo
- achar todas as referências
- tipo em uma posição
- listar símbolos de um arquivo
- procurar símbolo por nome no projeto inteiro
- achar implementações de uma interface
- rastrear hierarquia de chamadas

E, depois de cada edição, **reporta erro de tipo automaticamente** — sem passo
de build separado.

A ferramenta fica inativa até você configurar um language server. Era só isso
que faltava. O plugin já traz `.lsp.json` configurado para **Java (jdtls)**,
TypeScript e Python. Você instala o binário, o resto liga sozinho.

Para você especificamente isso é o item de maior impacto do pacote inteiro:
você trabalha com Java e Spring, e o `jdtls` transforma "procura `PaymentService`
no projeto" de seis greps com falso positivo em uma chamada exata.

---

## 3. Potência: nós × eles, agora de verdade

### Capacidade bruta

| Capacidade | oh-my-opencode-slim | Kiln | Quem ganha |
|---|---|---|---|
| Inteligência de código (LSP) | ferramentas próprias | ferramenta **nativa** + config de Java, TS, Python | **empate — mas a nossa é do fabricante** |
| Busca estrutural (AST) | 25 linguagens | `agrep` sobre ast-grep, as mesmas linguagens | empate |
| Doc de biblioteca | Context7 | Context7 | empate |
| Busca de código no GitHub | grep.app | **grep.app** (MCP remoto, sem instalar) | empate |
| Busca web de pesquisa | Exa | **Exa** (MCP remoto) + WebSearch nativo | **nós** |
| Mapa de repositório | codemap | codemap portado, com detecção por hash | empate |
| Orquestração em grafo | à mão em TS | **nativa** (`ultracode`) | **nós** |
| Loop | skill própria | **nativo** (`/loop` + `loop.md`) | **nós** |
| Observação de processo | não tem | **Monitor nativo** | **nós** |
| Meta persistente | não tem | **`/goal` nativo** | **nós** |
| Consenso multi-modelo | Council, vários provedores | não dá — só modelos Anthropic | **eles** |
| Isolamento de escrita | não tem | `isolation: worktree` | **nós** |
| Memória por agente | não tem | `memory:` | **nós** |
| Regras por caminho | não tem | `.claude/rules` com `paths:` | **nós** |
| Hooks | um punhado | 30+ eventos | **nós** |
| Métricas de custo | **nenhuma** | por golem, por modelo, por tipo de token | **nós** |
| Avatares | janela genérica | um por golem, derivado do bichinho oficial | **nós** |
| Maturidade | 7.785 estrelas, 14 mil downloads/semana | um usuário | **eles, de longe** |

### Janela e modelo

| | OMOS no OpenCode | Kiln no Claude Code |
|---|---|---|
| Janela do modelo principal | o que o provedor der | **1M configurado; conteúdo útil menor por causa da sobrecarga** |
| Modelo por agente | qualquer provedor | Anthropic: haiku e sonnet |
| Custo | por token, sempre | conforme o gateway e a conta em uso |
| Esforço de raciocínio por agente | não tem | `effort: low…ultracode`, aceito pelo gateway |

O ponto que resume tudo: **eles ganham em variedade de provedor, nós ganhamos
em profundidade dentro de um só.**

### A lacuna que sobrou

**Maturidade.** Só isso, e não tem atalho: eles têm milhares de pessoas
achando bug, o Kiln tem você. É exatamente por isso que as métricas importam
tanto — elas são o seu substituto para uma base de testadores.

As duas lacunas de capacidade fecharam, e fecharam *melhor*: o `grep.app` e o
Exa são MCPs **remotos**, `https://mcp.grep.app` e `https://mcp.exa.ai/mcp`.
Sem instalar nada, sem chave de API para uso normal. O OMOS empacota os dois;
nós só apontamos para eles.

Isso muda a ordem de busca do @researcher, e essa ordem é o ganho de verdade:

| A pergunta é… | Ferramenta |
|---|---|
| "como essa biblioteca funciona?" | context7 — doc oficial da versão certa |
| "como os outros resolveram isso?" | grep.app — código real em milhões de repositórios |
| "o que se sabe sobre esse erro?" | Exa — busca de pesquisa |

Doc oficial responde *como deveria funcionar*. O grep.app responde *como as
pessoas realmente fazem*. Quando os dois divergem, essa divergência é a
informação mais valiosa da pesquisa — e o @researcher tem instrução explícita
para apontar isso.

---

## 4. Onde você vai usar, e como

Quatro cenários reais, do seu dia a dia de Java/Spring.

### Cenário A · Entrar num projeto que você não conhece

```
/kiln:codemap
```

Ele mapeia o repositório, dispara um `@builder` por pasta em paralelo, e escreve
um `codemap.md` de no máximo 40 linhas em cada uma. Roda uma vez; depois só
atualiza o que mudou.

**A partir daí**, toda pergunta sobre o projeto lê o mapa em vez de dez
arquivos. É o investimento com maior retorno de contexto do pacote.

### Cenário B · Bug que você já tentou consertar duas vezes

```
@advisor a cobrança duplica no retry do webhook. Já tentei idempotência
no controller e lock otimista no service, nenhum resolveu.
```

O `@advisor` roda com esforço `xhigh`, tem LSP para ver o acoplamento
real (não o que o README diz) e `agrep` para achar o padrão repetido. Ele lê
muito e devolve pouco — o custo pesado fica na janela dele.

**Quando escalar para o advisor:** depois da segunda tentativa fracassada. Antes
disso é caro sem motivo.

### Cenário C · Refactor multi-arquivo

```
/kiln:plan-run
```

Ele te interroga: objetivo, critério de sucesso (`mvn test` passando?), quem
executa, quem verifica, teto de tentativas. Aí escolhe o motor:

- 3+ módulos independentes → **grafo** (`ultracode`), um `@builder` por módulo
  em worktree isolada, e um verificador que não é quem escreveu
- um módulo só → **direto**, um `@builder` com spec fechada

E antes de qualquer edição, `/kiln:verification-planning` define **como este
sistema prova** que a mudança está certa. Sem isso você descobre o problema em
produção.

### Cenário D · Esperando o CI

```
fica de olho no pipeline e me avisa quando terminar
```

Monitor. Roda em background, te interrompe quando sai o resultado, e você
continua trabalhando na mesma sessão. Zero token gasto enquanto espera.

Se você quer que ele **conserte** o que falhar, aí é loop:

```
/loop checa o CI da branch, e se falhar pega o log, diagnostica e sobe a correção mínima
```

---

## 5. Como tudo se encaixa

```
                        você
                         │
                      conductor
                         │
        ┌────────────────┼──────────────┬───────────────┐
        ▼                ▼              ▼               ▼
     @scout          @researcher     @advisor       @builder
     haiku            sonnet          sonnet         sonnet
       │                 │              │               │
    LSP + agrep      Context7      LSP + git      LSP + Edit
       │                 │              │               │
       └── devolve mapa ─┴── devolve ───┴── devolve ────┘
                 tudo comprimido, em janelas separadas

  motores:  direto · grafo (ultracode) · loop · monitor
  em cima:  hooks rastreiam quem está vivo → avatares na tela
  embaixo:  transcripts → claude-metrics.py → custo por golem
```

Três camadas, e cada uma tem um trabalho:

- **Os golems** fazem o trabalho em janelas separadas e devolvem resumo.
- **Os motores** decidem se isso acontece uma vez, em paralelo, ou em repetição.
- **A instrumentação** (avatares e métricas) te mostra se está funcionando.

A terceira camada é a que o OMOS não tem, e é a que responde "isso melhorou?"
sem depender de sensação.

---

## 6. Primeiros passos

```bash
# 1. instale os binários que você usa
brew install jdtls ast-grep

# 2. aponte o Claude Code para o plugin
claude --plugin-dir ~/.claude/plugins/kiln

# 3. meça ANTES de qualquer coisa
python3 scripts/claude-metrics.py --since 30

# 4. num projeto seu
/kiln:codemap
@scout onde fica a configuração de transação?
```

Guarde o número do passo 3. Sua linha de base hoje é **2% do custo fora da
janela principal**. Se em duas semanas isso não tiver subido, o pacote não está
sendo usado — e aí o problema é o hábito, não a ferramenta.

---

## Referências

- [Tools reference](https://code.claude.com/docs/en/tools-reference) — as ferramentas `LSP` e `Monitor`
- [Scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks) — `/loop`, `loop.md`, jitter, expiração
- [Workflows](https://code.claude.com/docs/en/workflows) e [A harness for every task](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code)
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference) — `.lsp.json`, `.mcp.json`, `bin/`, `monitors/`
- [Model configuration](https://code.claude.com/docs/en/model-config) — modelos, effort, ultracode
- [oh-my-opencode-slim](https://ohmyopencodeslim.com/) — a referência que originou tudo isso
