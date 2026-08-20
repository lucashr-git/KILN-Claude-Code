# O que o gateway do Flow realmente faz

Medido em 19/08/2026 com `sondar-gateway.sh`. Custou ~$4 de token da empresa.
São fatos, não suposição — se alguém questionar, o comando reproduz.

## Janela de contexto

| | |
|---|---|
| Limite informado pela API | **1.000.000 tokens** |
| Contexto configurado no Claude Code | **1.000.000 tokens — resolvido** |
| Conteúdo aceito numa chamada única | 400k (600k falhou por somar com a sobrecarga) |
| O que o Claude Code assumia antes | 200k |

O 200k era suposição dele para um id de modelo que não reconhece
(`bedrock/anthropic.claude-5-sonnet`), não limite do Flow. O contexto de 1M está
configurado com:

```json
"CLAUDE_CODE_MAX_CONTEXT_TOKENS": "1000000"
```

Importante: 1M é o limite configurado, não 1M de conteúdo útil. Prompt do
sistema, definições de ferramentas, MCPs e anexos ocupam parte da requisição.
Os números detalhados dessa sobrecarga estão abaixo.

## Sobrecarga por requisição — investigar

Da mensagem de erro do teste de 600k:

```
requisição   1.087.822
conversa       605.569
             ───────────
sobrecarga     482.253   ← system prompt + definições de ferramenta + anexos
```

Se esse número se confirmar no uso normal, é o maior problema de eficiência do
ambiente: metade da janela nasce ocupada, e cada subagent recarrega.

**Confirmar com `/context` dentro do Claude Code.** Parte pode ser artefato do
teste (2,2 MB por stdin podem ter contado como anexo E como conversa).

Suspeitos, em ordem: definições de ferramenta dos 7 plugins da empresa, os 3
MCPs, e as descrições de skills. Corte com `/plugin` → desabilitar o que não
usa na semana.

## Níveis de esforço

Todos aceitos: `low` `medium` `high` `xhigh` `max` `ultracode`.

O gateway aceita `/effort` e repassa os níveis. Isso valida o roteamento do
Kiln: `researcher` em `low` e `advisor` em `xhigh` fazem diferença real. E
`ultracode` (xhigh + workflows) está disponível — vale testar em tarefa com 3+
peças independentes.

## Divergência de modelo

| Fonte | Valor |
|---|---|
| `~/.zshrc` (instalador do Flow) | `bedrock/anthropic.claude-4-6-sonnet` |
| `~/.claude/settings.json` | `anthropic.claude-5-sonnet` ← **vence** |

Funciona hoje, mas Sonnet 4.6 **não suporta `xhigh`**. Se a precedência mudar, o
`advisor` cai para `high` em silêncio. Resolver com:

```bash
python3 ~/Downloads/kiln/corrigir-modelo-shell.py --comentar
```

Se o bloco for gerado por instalador da CI&T, ele volta no próximo update — aí
o conserto de verdade é avisar o time do Flow que a variável está velha.

## Reproduzir

```bash
bash ~/Downloads/kiln/sondar-gateway.sh            # só esforço, de graça
bash ~/Downloads/kiln/sondar-gateway.sh --rapido   # passa de 200k? ~$0.75
bash ~/Downloads/kiln/sondar-gateway.sh --contexto # teto exato, até ~$7
```
