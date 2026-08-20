# Kiln — arquitetura

Visão consolidada do sistema: o que foi construído, como as peças se relacionam,
como o contexto e os tokens se comportam, e quais decisões orientam o desenho.

## Visão do produto e das peças

**Um time de Claudinhos que trabalham no seu Claude Code — e um jeito de ver e medir o que eles fazem.**

Nome: **Kiln** é o forno onde o barro é temperado e vira coisa dura. Os agentes são os *Claudinhos* — criaturas de barro que executam exatamente a instrução que recebem, que é literalmente o que um subagent é. O bichinho do Claude Code é cor de barro cozido. O forno e as criaturas: uma metáfora só, e ela se explica sozinha quando você vê o avatar.

---

## 1. Em uma frase

Em vez de um Claude fazendo tudo sozinho na mesma janela até ela encher, um **orquestrador** distribui o trabalho para **Claudinhos especialistas** — cada um com sua própria memória, seu próprio modelo e sua própria conta de custo — e você **vê e mede** isso acontecendo.

---

## 2. As quatro peças

### Peça 1 · O time (projetado, ainda não instalado)

Sete arquivos de texto em `~/.claude/agents/`. Cada um é um Claudinho com um ofício:

| Claudinho | Ofício | Modelo | Por quê |
|---|---|---|---|
| conductor | Planeja e distribui. Não implementa | opus | Errar o roteamento custa a tarefa inteira |
| scout | Acha coisa no código. Devolve mapa, nunca arquivo | haiku | É busca, não decisão |
| researcher | Pesquisa doc e web | sonnet | É buscar e resumir |
| advisor | Arquitetura, bug difícil, review | opus | É onde profundidade vira qualidade |
| builder | Implementa spec fechada | sonnet | O "o quê" já foi decidido |
| visual | UI/UX | sonnet | Julgamento visual descritível |
| leitor | Imagem, PDF, diagrama | haiku | Extrair conteúdo |

**A parte que faz diferença:** cada Claudinho roda numa janela de contexto separada. Ele lê 200 mil tokens de documentação e te devolve 700. Sua janela recebe os 700.

### Peça 2 · Os avatares (pronto)

Uma janelinha transparente flutuando na tela. Um Claudinho por subagent trabalhando. Sobe sozinha quando o Claude Code abre, dorme (`zzz`) quando ninguém está trabalhando.

Cada Claudinho é o bichinho oficial do Claude Code — mesma silhueta, mesma cor chapada, mesmo contorno de adesivo. O que muda é **a expressão e o adereço**, exatamente como o kit oficial varia:

| Claudinho | Cara | Adereço |
|---|---|---|
| conductor | olhos quadrados, o clássico | coroa |
| scout | `> <` focado | antena |
| researcher | arregalado | livro |
| advisor | pensativo | halo |
| builder | `^ ^` determinado | chave |
| visual | brilho nos olhos | pincel |
| leitor | lente | luneta |
| ocioso | dormindo | zzz |

Andam, piscam fora de sincronia um do outro, e mostram há quantos segundos estão na lida.

**Custo em token: zero.** Os hooks são scripts locais e a janela só lê um arquivo.

### Peça 3 · As métricas (pronto)

`claude-metrics.py` lê os transcripts que o Claude Code já grava e responde: para onde foi o token, quanto custou cada modelo, quanto custou cada Claudinho, e quatro números de eficiência. Sem servidor, sem coletor, sem gastar token.

### Peça 4 · As decisões (o trabalho invisível)

Metade do valor foi descobrir o que **não** fazer:

- **CrewAI: não.** Exige chave de API e cobra por token. Sua assinatura não vale lá. Esta conversa custaria $24 em API.
- **Agent SDK: só se for rodar sem você.** Também é cobrança por token.
- **Reimplementar orquestração em background: não.** O Claude Code já dispara subagents em paralelo e te avisa quando terminam.
- **Council multi-modelo: não porta.** Você só tem modelos Anthropic aqui.

---

## 3. Como funciona, do jeito mais simples

Você pede: *"o webhook de pagamento tá duplicando cobrança, arruma"*.

```
   você
    │
    ▼
 conductor  ── "primeiro descobre, depois decide, depois implementa"
    ├──► scout      "onde está o handler?"          ┐ rodam ao
    └──► researcher  "como o SDK trata retry?"       ┘ mesmo tempo
                    ↓ devolvem 15 e 20 linhas
 conductor  decide a estratégia
    └──► builder      "adiciona idempotência em X:42, valida com o teste Z"
                    ↓ devolve o que mudou e se passou
 conductor  confere e responde
```

Na tela, enquanto isso: dois Claudinhos andando (ciano e azul), depois um verde, depois todos dormem.

**A diferença:** sua janela viu 35 linhas de resumo em vez de 12 arquivos inteiros.

---

## 4. O que temos, o que não temos

Comparando com o oh-my-opencode-slim:

### Eles têm e nós ainda não

| O que | Por que importa | Dá para ter? |
|---|---|---|
| ~~Ferramentas de LSP~~ | **Fechado.** A ferramenta `LSP` é nativa do Claude Code; faltava só configurar. Java, TS e Python já vêm no plugin | ✅ pronto |
| ~~Busca AST~~ | **Fechado.** `bin/agrep` sobre ast-grep | ✅ pronto |
| ~~MCPs de pesquisa~~ | **Fechado.** context7 + grep.app + Exa já configurados | ✅ pronto |
| **Skills** (`codemap`, `deepwork`) | O codemap é o maior economizador de contexto | Parcial — `codemap`, `plan-run` e `verification-planning` prontos; falta `deepwork` |
| **Instalador de um comando** | `bunx … install` e acabou | Parcial — o plugin está montado, falta publicar num marketplace |
| **Presets da comunidade** | Trocar o time inteiro de modelo de uma vez | Parcial — `/model` e `availableModels` |
| **7.785 estrelas e 14 mil downloads/semana** | Maturidade e gente testando | Não, e tudo bem |

### Nós temos e eles não

| O que | Por que importa |
|---|---|
| **Métricas de custo e eficiência por agente** | Eles não medem nada. Você mede antes e depois de cada mudança |
| **Avatar por agente, derivado do bichinho oficial** | O companion deles é uma janela genérica. O nosso identifica quem está trabalhando |
| **Workflows dinâmicos nativos** (`/effort ultracode`) | O Claude Code escreve o próprio orquestrador para a tarefa. Eles fazem isso à mão em TypeScript |
| **Regras por caminho** (`.claude/rules/` com `paths:`) | Regra de frontend não ocupa contexto quando você está no backend |
| **Memória por subagent** (`memory:`) | O builder aprende como o seu projeto funciona e lembra na próxima sessão |
| **Worktree isolada** (`isolation: worktree`) | Dois Claudinhos escrevendo em paralelo sem se atropelar |
| **30+ eventos de hook** | Eles têm um punhado. Dá para automatizar coisa que lá não dá |
| **Opus com 1M de contexto incluído** | Vantagem da assinatura Max que o OpenCode não te dá |

### O placar honesto

Nós ganhamos em **medição, visualização e infraestrutura nativa**. Eles ganham em **capacidade bruta de ferramenta** — LSP e busca AST são reais e nós não temos.

---

## 5. O plano de eficiência

Você marcou as quatro prioridades. Nesta ordem, porque cada uma habilita a próxima:

### Fase 1 · Fechar as lacunas de capacidade
LSP + `ast-grep` + os MCPs de pesquisa. **É a que mais move o ponteiro** — dá ao scout e ao researcher ferramenta de verdade em vez de grep e busca genérica. Um scout com AST acha em uma chamada o que hoje leva seis.

### Fase 2 · Skills portadas
`codemap` primeiro. Um `codemap.md` por pasta com detecção por hash: o Claudinho lê o mapa, não os arquivos. Depois `deepwork` e `verification-planning`.

### Fase 3 · Empacotar como plugin
`.claude-plugin/plugin.json` com agents, skills, hooks, `.mcp.json`, `.lsp.json` e o avatar juntos. Um comando instala tudo, versionado no git.

### Fase 4 · Painel de eficiência contínuo
As métricas rodando sozinhas, com histórico, mostrando se cada fase melhorou ou piorou. **É o que transforma isso de "parece melhor" em "é melhor, e aqui está a prova".**

Sua linha de base já está registrada: **2% do custo fora da janela principal, 97% de aproveitamento de cache.** É contra esse número que as quatro fases vão ser julgadas.

---

## 6. Instalação do que já está pronto

```bash
mkdir -p ~/.claude/hooks
cp hooks/*.sh ~/.claude/hooks/ && chmod +x ~/.claude/hooks/*.sh
cp -R companion ~/.claude/kiln
cd ~/.claude/kiln && npm install          # baixa o Electron, uma vez só
```

Some o conteúdo de `settings-snippet.json` no seu `~/.claude/settings.json` (mescle a chave `hooks`, não substitua).

Testar sem o Claude Code:

```bash
mkdir -p "${TMPDIR:-/tmp}/kiln"
printf 'a\tscout\t%s\nb\toracle\t%s\n' $(date +%s) $(date +%s) > "${TMPDIR:-/tmp}/kiln/teste"
cd ~/.claude/kiln && npm start
```

Métricas:

```bash
python3 claude-metrics.py --since 30 --html relatorio.html
```

### Mexer nos Claudinhos

Tudo em `art/sprites.py`, e tudo é grade de texto — `#` é pixel aceso:

| O quê | Onde |
|---|---|
| Silhueta (padrão oficial, melhor não mexer) | `BODY` |
| Expressão de cada Claudinho | `FACES` + `AGENT_FACE` |
| Adereços | `PROPS` |
| Cores | `COLORS` |
| Animação da caminhada | `WALK` |

Depois de editar: `python3 sprites.py` regenera o `golems.json` que o avatar consome.

---

## Contexto, motores e economia

Explicação do que existe, como o contexto realmente funciona, onde o token vai,
e o que dá pra fazer agora. Verificado na documentação oficial em 19/08/2026.

---

## 1. A pergunta do contexto: dois agentes somam janela?

**Não.** E vale entender por quê, porque a intuição contrária custa caro.

Cada chamada ao modelo tem **uma** janela. Duas janelas de 200k não viram 400k,
do mesmo jeito que dois copos de 300ml não viram um copo de 600ml. Não existe
"conectar dois modelos para somar contexto" — o que existe são quatro técnicas
que resolvem o problema real (processar mais material do que cabe) sem precisar
de uma janela maior.

### Técnica 1 · Compressão na fronteira  ✅ já temos

O subagent lê 200k e devolve 700. Sua janela recebe 700.

Isso não aumenta a janela, aumenta o **alcance**. É a diferença entre "quanto
cabe na sua mesa" e "quanto você consegue ler". Nos seus números: os subagents
ingeriram 71,2M de conteúdo novo e devolveram 3,1M — **23× de compressão**.

### Técnica 2 · Partição e síntese  ✅ já temos, via `ultracode`

O mais próximo de "somar contexto" que existe. Divide o material em N fatias,
um agente por fatia, cada um devolve um resumo, um sintetiza.

Material processado = **N × janela**. Com 5 agentes de 200k você atravessa 1M
de material — só que nunca com tudo junto na mesma cabeça ao mesmo tempo.

O limite é real: se a conclusão exigir ver a fatia 1 e a fatia 5 **ao mesmo
tempo**, a partição perde a relação. Serve para varredura, auditoria e busca.
Não serve para raciocínio que precisa do todo simultâneo.

### Técnica 3 · Estado no disco  ✅ já temos, via `codemap` e `.kiln/run/`

O contexto que não cabe na janela mora em arquivo. O `codemap.md` de cada pasta
é isso: em vez de segurar o repositório inteiro na cabeça, o agente lê o mapa da
pasta que importa agora.

Memória ilimitada, com custo de releitura. É a técnica mais subestimada das
quatro, e a mais barata.

### Técnica 4 · Revezamento  ⬜ dá pra montar

O agente A trabalha até a janela encher, escreve um documento de passagem
(objetivo, decisões aceitas, o que falta, onde parou) e o agente B começa limpo
lendo esse documento.

É sequencial, não paralelo, e perde nuance — mas preserva o fio da meada em
trabalho que dura mais que uma janela. O `/golem:plan-run` já manda registrar
isso em `.kiln/run/<slug>.md`; falta automatizar a passagem.

### E os "dois agentes que se conversam"? Existe — e não é o que parece

O Claude Code tem **agent teams** (experimental): vários Claude Code
independentes, cada um com sua janela, que **mandam mensagem direto um pro
outro** por um mailbox em `~/.claude/teams/`, compartilham uma lista de tarefas,
e podem discordar entre si.

```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

Isso é literalmente dois agentes conversando. Mas **não soma contexto**: cada um
continua com a janela dele, e cada mensagem trocada consome janela dos dois.
O que teams resolve é outra coisa — **ancoragem**. Um agente sozinho acha uma
explicação plausível e para de procurar. Cinco agentes tentando refutar a teoria
uns dos outros chegam na causa raiz de verdade.

> ⚠️ **Cuidado com o nosso desenho.** Com teams ligado, um subagent que o Claude
> nomear vira teammate — e teammate **não devolve resultado**, só avisa que
> terminou. Um fluxo que espera o retorno do subagent trava. Nosso orquestrador
> é exatamente esse tipo de fluxo. Ligue teams só quando for usar teams, e
> desligue depois (`"0"` no user settings vence o export do shell).

### Antes de qualquer arquitetura: sua janela está cortada pela metade

Você roda Sonnet 5, que tem **1M de janela**. Mas o id vem do gateway
(`anthropic.claude-5-sonnet`), o Claude Code não reconhece, e assume **200k**.

Você está perdendo 800k por um detalhe de configuração. Nenhuma técnica de
partição compensa isso. Está em [`gateway/context-1m.md`](gateway/context-1m.md) — é uma linha.

---

## 2. O que temos hoje

### As três camadas

```
  MOTORES        direto · grafo (ultracode) · loop · monitor · teams
     │           quem decide se o trabalho roda uma vez, em paralelo ou em repetição
     ▼
  GOLEMS         orchestrator · scout · librarian · oracle · fixer · designer · observer
     │           quem faz, cada um em sua janela, devolvendo resumo
     ▼
  INSTRUMENTOS   avatares na tela · claude-metrics · kiln-doctor
                 como você sabe se está funcionando
```

### Os golems e o que cada um tem na mão

| Golem | Modelo | Effort | Ferramentas próprias |
|---|---|---|---|
| orchestrator | sonnet | high | é a thread principal (via `settings.json`) |
| oracle | sonnet | xhigh | LSP, agrep, git log/diff — só leitura |
| designer | sonnet | high | LSP, edição |
| fixer | sonnet | medium | LSP, edição, bash |
| librarian | sonnet | low | context7 + grep.app + Exa |
| scout | haiku | — | LSP, agrep, grep, glob — só leitura |
| observer | haiku | — | leitura de imagem e PDF |

### As capacidades

| O quê | Estado |
|---|---|
| Inteligência de código (LSP: definição, referências, hierarquia, tipos) | ✅ jdtls para Java, TS, Python |
| Busca por estrutura, não por texto (`agrep`) | ✅ ast-grep |
| Doc oficial de biblioteca | ✅ context7 |
| Código real de milhões de repositórios | ✅ grep.app (MCP remoto) |
| Busca de pesquisa | ✅ Exa (MCP remoto) |
| Mapa do repositório com detecção por hash | ✅ `/kiln:codemap` |
| Escolha do motor de execução | ✅ `/kiln:plan-run` |
| Caminho de evidência antes de mudar | ✅ `/kiln:verification-planning` |
| Avatar por sessão, um golem por subagent | ✅ |
| Custo e eficiência por golem e por modelo | ✅ `claude-metrics.py` |
| Diagnóstico da instalação | ✅ `kiln-doctor.sh` |

---

## 3. Os cinco motores

Nenhum foi construído por nós. Todos são nativos — o mérito do Kiln é saber
**quando usar cada um**.

| Motor | Como se chama | Quando |
|---|---|---|
| **Direto** | delegar ao golem certo | uma raia, resultado verificável de uma vez |
| **Grafo** | `/effort ultracode` | muitas peças independentes, ou precisa de verificação por outro olho |
| **Loop** | `/loop [intervalo] <prompt>` | depende de algo que muda com o tempo e você não controla |
| **Observação** | Monitor (peça em português) | você está *esperando* um evento, não repetindo trabalho |
| **Time** | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | hipóteses concorrentes, revisão por lentes que discordam |

**A regra que evita o erro mais comum:** se você ia ficar perguntando "já
terminou?", é Monitor. Se ia ficar *fazendo alguma coisa* a cada verificação, é
Loop. Polling manual é o pior dos dois e é o que quase todo mundo faz.

---

## 4. A economia de token

### A verdade contraintuitiva

**Delegar não reduz o total de tokens. Redistribui.** Cada subagent nasce com
system prompt próprio + CLAUDE.md + a tarefa. O total processado sobe. O ganho
vem de três lugares diferentes:

1. **Janela** — o pesado acontece numa janela que é descartada no fim.
2. **Preço** — leitura em haiku custa uma fração de leitura em sonnet.
3. **Retrabalho** — o mais valioso e o menos visível. Refazer custa o dobro.

### No seu ambiente, a conta mudou

Sem Opus e sem Fable, só existem dois preços: **sonnet** e **haiku**. Isso tem
duas consequências diretas:

- **O @scout virou a principal economia.** É o único lane barato. Toda leitura
  pesada que não passar por ele é dinheiro deixado na mesa.
- **Entre os golems de sonnet, quem separa caro de barato é o `effort`.** Por
  isso @librarian roda em `low` e @oracle em `xhigh`. **Se o Flow não repassar o
  parâmetro, essa metade da economia não existe** — teste com
  [`gateway/test-effort.md`](gateway/test-effort.md).

### Sua linha de base

```
trabalho fora da janela principal    22%
aproveitamento de cache              95%
custo de entrada por delegação       93.7k tokens
compressão dos subagents             23×
```

O número que mais chama atenção é o **93.7k de custo de entrada**. Ele significa:
**delegar tarefa que custaria menos de ~94k tokens é prejuízo.** Vale investigar
o tamanho do seu CLAUDE.md — cada subagent recarrega esse arquivo.

---

## 5. O que dá pra fazer agora que não dava

| Antes | Agora |
|---|---|
| grep pra achar um símbolo, com falso positivo | `find references` do LSP, exato, uma chamada |
| procurar padrão por texto | `agrep '@Transactional public $R $M($$$)'` — por estrutura |
| ler 12 arquivos pra entender uma pasta | ler o `codemap.md` de 40 linhas |
| "acho que essa lib faz assim" | doc oficial da versão + como 1M de repositórios realmente fazem |
| descobrir erro de tipo no build | LSP reporta a cada edição |
| "acho que ficou melhor" | número antes e depois |
| não saber o que o Claude está fazendo | golem andando na tela, com nome e cronômetro |

---

## 6. O que fazer, em ordem

1. **`CLAUDE_CODE_MAX_CONTEXT_TOKENS`** — recupera 800k de janela. Uma linha.
   Confirme com o time do Flow antes ([`gateway/context-1m.md`](gateway/context-1m.md)).
2. **Testar o effort** — dois minutos, e decide se metade do roteamento tem
   efeito ([`gateway/test-effort.md`](gateway/test-effort.md)).
3. **Medir o CLAUDE.md** — é o suspeito do custo de entrada de 93.7k.
4. **Rodar `/kiln:codemap`** num projeto de verdade. Maior retorno de contexto
   do pacote.
5. **Daqui a uma semana**, `claude-metrics.py --since 7`. Se "fora da janela
   principal" passar dos 22%, funcionou.

Não faça ainda: ligar agent teams. Conflita com o orquestrador (§1).
