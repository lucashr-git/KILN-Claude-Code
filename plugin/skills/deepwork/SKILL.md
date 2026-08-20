---
name: deepwork
description: Trabalho que não cabe numa sessão — migração, refactor grande, feature multi-fase, auditoria de repositório. Mantém estado em disco e faz revezamento quando a janela enche, para o trabalho sobreviver à compactação e a fechar o terminal. Use quando a tarefa vai passar de uma sentada.
---

# Deepwork

Trabalho grande morre de duas formas: a janela enche e a compactação come o
plano, ou você fecha o terminal e volta amanhã sem saber onde parou.

A solução não é uma janela maior. É **o estado morar no disco**, não na cabeça.

Não use para tarefa que cabe numa sessão. O custo aqui é manter um arquivo
atualizado, e isso só se paga em trabalho longo.

---

## O arquivo de estado

Um arquivo, criado no começo, atualizado ao longo:

```
.kiln/deepwork/<slug>.md
```

Adicione ao `.gitignore` se ainda não estiver:

```
.kiln/
```

Ele não segue template rígido. Precisa conter, na ordem que fizer sentido:

- **Objetivo** — a frase original, escrita uma vez e **nunca reescrita**. É o
  antídoto contra deriva: no fim você compara o resultado com ela, não com a
  versão que você lembra.
- **Restrições** — o que não pode quebrar.
- **Decisões aceitas** — cada uma com o porquê em uma linha. Sem isso você
  redecide a mesma coisa três vezes.
- **Fases** — o que está feito, o que está em andamento, o que falta.
- **Evidência** — o que foi validado, com que comando, e o resultado.
- **Aberto** — dúvidas, bloqueios, o que ficou pra depois.

**Referencie arquivos por caminho, nunca cole conteúdo.** O arquivo de estado é
um índice, não um depósito. Se ele passar de 150 linhas, ele virou o problema.

Atualize depois de: decisão aceita, fase concluída, validação executada,
mudança de escopo. Não a cada edição de código.

---

## Revezamento — quando a janela enche

Rode `/context`. Passou de ~70% e ainda falta trabalho? **Não continue empurrando.**
A qualidade cai antes de você perceber, e a compactação decide sozinha o que
descartar.

Faça a passagem:

1. Atualize o arquivo de estado com onde você parou, **em nível de detalhe que
   permita outra pessoa continuar sem te perguntar nada**.
2. Escreva um bloco `## Retomada` no fim, com:
   - o próximo passo concreto, no imperativo
   - os arquivos que quem continuar precisa abrir primeiro
   - o que já foi tentado e não funcionou — isso evita repetir o erro
3. Encerre a sessão. Abra outra.
4. Na sessão nova, primeira mensagem: *"leia `.kiln/deepwork/<slug>.md` e
   continue de onde parou"*.

A sessão nova começa com janela limpa e o contexto que importa — não os 200k de
tentativa que já foram descartados. **Isso não soma janela**: troca contexto
acumulado por contexto destilado, que quase sempre é melhor.

---

## Delegação em trabalho longo

- **Descoberta** vai para `@scout` (haiku). Numa migração você vai descobrir
  muito e decidir pouco — mantenha essa proporção no custo também.
- **Fases independentes em paralelo**, uma por `@builder`, com escopos de escrita
  que **não se sobrepõem**. Duas raias no mesmo arquivo é retrabalho garantido.
- **Verificação por quem não implementou**, sempre. Em trabalho longo o viés de
  "já está quase" é o que mais custa.
- Se as fases forem muitas e independentes, considere `/effort ultracode`: ele
  monta o grafo e sintetiza. Custa mais token e paga em trabalho que se
  paraleliza de verdade.

## Antes de declarar pronto

Abra o arquivo de estado e leia o **Objetivo** — a frase original, não a que
você lembra.

- Ela virou verdade?
- As restrições continuam inteiras?
- O que está em **Aberto** pode mesmo ficar aberto?

Trabalho longo raramente falha por erro técnico. Falha por resolver *um*
problema e achar que era *o* problema.
