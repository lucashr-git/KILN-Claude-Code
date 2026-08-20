---
name: plan-run
description: Decide COMO executar um trabalho não-trivial — direto, em grafo de subagents, em loop até uma condição, ou observando um processo — e monta a execução. Use antes de começar tarefa grande, migração, auditoria, correção que depende de CI, ou qualquer coisa que você ia repetir na mão.
disable-model-invocation: true
---

# Plan-run

Este é o passo que fica **entre** "entendi o pedido" e "comecei a trabalhar".
Ele escolhe o motor de execução certo — e todos os motores já existem no
Claude Code. Você não constrói nenhum, você escolhe.

## Os quatro motores

| Motor | O que é | Quando |
|---|---|---|
| **Direto** | Você faz, delegando ao Claudinho certo | Uma raia, resultado verificável de uma vez |
| **Grafo** | `/effort ultracode` — o Claude escreve um workflow que dispara e coordena subagents com dependências | Muitas peças independentes, ou o resultado precisa de verificação por outro olho |
| **Loop** | `/loop [intervalo] <prompt>` — repete até você parar ou até a condição bater | O trabalho depende de algo que muda com o tempo e você não controla |
| **Observação** | Monitor — roda um script em background e te avisa a cada linha de saída | Você está *esperando* um evento, não repetindo trabalho |

**A regra que decide entre Loop e Observação:** se você ia ficar perguntando
"já terminou?", é Monitor. Se você ia ficar *fazendo alguma coisa* a cada
verificação, é Loop. Polling manual é o pior dos dois.

## O interrogatório

Antes de escolher, responda — perguntando ao usuário o que você não sabe.
Faça isso em **uma** rodada de perguntas, não uma de cada vez.

1. **Objetivo.** O que precisa ser verdade no final?
2. **Critério de sucesso.** Como a máquina sabe que acabou? Escolha um:
   `teste` · `build` · `lint` · `comando específico` · `arquivo existe` ·
   `revisão do @advisor` · `julgamento humano`
   Para comando, qual é o comando exato. Para arquivo, qual é o caminho.
3. **Quem executa.** @builder, @stylist, ou direto?
4. **Quem verifica.** @advisor, o comando de teste, ou o usuário?
   *Nunca é quem executou.*
5. **Teto.** Quantas tentativas antes de escalar para o humano? (padrão: 3)
6. **Contexto obrigatório.** Que arquivos ou caminhos quem executa precisa ler
   antes de começar?

Se o usuário não souber responder o item 2, **pare**. Trabalho sem critério de
sucesso não deve rodar sozinho — vira loop infinito educado.

## Montagem

### Direto
Delegue com escopo e dono de validação nomeados. Sem cerimônia.

### Grafo
Ligue `/effort ultracode` e descreva o resultado. Ele planeja o workflow, roda
os subagents em janelas separadas e sintetiza. Use quando:
- há 3+ peças que não dependem uma da outra, **ou**
- o risco de "achou que terminou mas não terminou" é alto — o grafo força
  verificação por um agente que não fez o trabalho.

Custa mais token que fazer direto. Vale quando paralelismo ou verificação
independente pagam a coordenação.

### Loop
```
/loop 5m <o que checar e o que fazer se estiver ruim>
```
Sem intervalo, o Claude escolhe o ritmo sozinho (1 min a 1 h) conforme o que
observa. Para o loop padrão do projeto, escreva `.claude/loop.md` — vira o
prompt do `/loop` sem argumento.

Limites que importam: a sessão precisa estar aberta, tarefa recorrente expira
em 7 dias, e `Esc` para. Para algo que roda sem você, é Routine ou tarefa
agendada, não `/loop`.

### Observação
Peça o Monitor em português: *"fica de olho no log de erro e me avisa quando
aparecer exception"*. Ele roda o script em background e interrompe só quando
acontece algo. Não gasta token repetindo prompt.

## Registro

Para trabalho que passa de uma sessão, mantenha `.kiln/run/<slug>.md` com:
objetivo, critério de sucesso, decisões aceitas, fases e status, resultado das
validações, e o que ficou em aberto. Atualize depois de cada fase — é o que
sobrevive a uma compactação.

Adicione `.kiln/` ao `.gitignore` se ainda não estiver lá.
