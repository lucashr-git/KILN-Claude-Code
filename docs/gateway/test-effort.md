# O `effort` funciona no gateway do Flow?

Importa porque, sem Opus, **o effort é a principal alavanca de custo entre os
golems de sonnet**. Se ele não passar pelo gateway, `librarian` em `low` e
`oracle` em `xhigh` custam igual, e o roteamento perde metade da graça.

Risco de deixar configurado: **nenhum**. A documentação diz que um nível não
suportado cai para o maior nível suportado abaixo dele. Não quebra, só é ignorado.

## Teste 1 — o mais rápido (10 segundos)

Dentro do Claude Code:

```
/effort
```

- Abriu o menu e deixou escolher `xhigh` → o modelo aceita effort.
- Não aparece, ou avisa que não se aplica → não aceita.

Depois, `/status` mostra a configuração ativa da sessão.

## Teste 2 — o que prova de verdade (2 minutos)

O effort muda quanto o modelo *pensa*. Isso aparece nos tokens de saída.

1. Sessão nova: `/effort low`, e peça algo com raciocínio de verdade:
   *"explique o trade-off entre lock otimista e idempotência para retry de webhook"*
2. Outra sessão nova: `/effort xhigh`, **exatamente a mesma pergunta**.
3. Compare:

```bash
python3 ~/.claude/claude-metrics.py --since 1 --by-session
```

- Saída muito maior no xhigh (tipicamente 2× ou mais) → **effort funciona**.
- Saída praticamente igual → o gateway não está repassando.

## Se não funcionar

Não desfaça nada. Só mude a expectativa:

- Tire `effort` do frontmatter dos golems (vira ruído no arquivo).
- O @oracle deixa de valer pela profundidade e passa a valer só pela disciplina
  (somente leitura, LSP, foco em estratégia). Ainda útil, mas menos.
- A economia real passa a ser **só** haiku × sonnet — ou seja, o @scout e o
  @observer ficam ainda mais importantes. Delegue toda busca e toda leitura
  pesada para eles.

E vale abrir um chamado com o time do Flow: repassar o parâmetro de effort é
mudança pequena no proxy e devolve controle de custo pra todo mundo lá.
