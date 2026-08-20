# A janela de contexto está sendo cortada em 200k

O Claude Code avisa:

> "anthropic.claude-5-sonnet" is not a model this version of Claude Code
> recognizes, so auto-compact will keep this session within 200k tokens

O Sonnet 5 tem janela de **1M**. Como o id vem do gateway e não começa com
`claude-`, o Claude Code assume 200k e compacta cedo demais — você perde 800k
de janela sem motivo.

## A correção

Acrescente ao `env` do seu `~/.claude/settings.json`:

```json
"CLAUDE_CODE_MAX_CONTEXT_TOKENS": "1000000"
```

## Antes de confiar em 1M

Quem serve o modelo é o Flow, sobre Bedrock. **Confirme com o time do Flow se a
janela de 1M está habilitada lá.** Se não estiver, declarar 1M faz a requisição
falhar quando o contexto passar do limite real, em vez de compactar antes.

Teste barato: coloque 1M, trabalhe numa sessão longa e observe. Se começar a dar
erro de contexto acima de ~200k, volte para `"200000"` e cobre o time.
