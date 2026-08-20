---
name: hard
description: Protocolo para problema difícil. ATIVE SOZINHO quando: uma correção já falhou duas vezes, a causa raiz não é óbvia depois de investigar, o comportamento contradiz o que o código diz, ou a decisão é de arquitetura e cara de reverter. Também para — bug que resistiu a tentativas, causa raiz obscura, decisão de arquitetura, comportamento que ninguém explica. Substitui "joga pro modelo maior" por um processo que um modelo menor executa com o mesmo resultado. Use quando a resposta óbvia já falhou.
---

# Modo difícil

Um modelo maior investiga antes de agir, considera hipóteses concorrentes e
verifica o próprio trabalho sem que ninguém peça. Um modelo menor faz tudo isso
também — **quando o processo obriga**. Este é o processo.

Não use para tarefa normal. O custo aqui é real: várias delegações, uma rodada
adversarial. Use quando a resposta óbvia já falhou, ou quando errar sai caro.

---

## Regra zero: não teorize antes de observar

A falha mais comum de modelo menor é pular direto para a explicação plausível.
Antes de qualquer hipótese, colete **fato**:

- a mensagem de erro literal, não a sua paráfrase
- o estado real (log, valor, resposta HTTP, conteúdo da tabela)
- o que muda entre o caso que funciona e o que falha

Se você não consegue observar o problema, **o primeiro trabalho é tornar o
problema observável**. Um log no ponto certo vale mais que três hipóteses.

*Não avance sem pelo menos uma observação concreta escrita abaixo.*

---

## 1. Enuncie o alvo

Uma frase: o que precisa passar a ser verdade.
Uma frase: o que não pode quebrar no caminho.

Escreva em `.kiln/hard/<slug>.md`. Você vai reler isso no passo 6 — é o antídoto
contra deriva de objetivo, que é a segunda falha mais comum.

## 2. Force três hipóteses

Duas não bastam: com duas você escolhe a preferida. Liste **três**, e a terceira
tem que ser desconfortável — a que assume que o problema **não está onde você
acha que está**.

Para cada uma, responda antes de investigar:

> Qual UMA observação mataria esta hipótese na hora?

Se você não consegue responder, a hipótese está vaga demais. Reescreva.

## 3. Investigue em paralelo, barato

Uma delegação por hipótese, ao mesmo tempo:

- `@scout` (haiku) quando a resposta está no código — LSP para achar
  definição, referências e hierarquia de chamadas; `agrep` para achar o padrão
- `@researcher` quando depende de biblioteca ou comportamento externo — doc
  oficial da versão certa, e como outros projetos realmente fazem

Cada um volta com a observação que mata ou sustenta a hipótese dele. **Não peça
opinião, peça evidência.** Opinião de três agentes é ruído; evidência de três
agentes é triangulação.

## 4. Rodada adversarial — o passo que não se pula

Sobrou uma hipótese. Agora ela vai apanhar.

Despache `@advisor` com este mandato exato:

> A hipótese é: `<hipótese>`. As evidências são: `<evidências>`.
> Seu trabalho **não** é confirmar. É derrubar. Encontre o caso em que essa
> explicação falha, a evidência que foi interpretada com viés, ou a causa
> alternativa que produz os mesmos sintomas. Se depois de tentar de verdade
> você não conseguir derrubar, diga isso — e diga qual foi o ataque mais forte
> que você tentou.

Isso existe porque um agente sozinho encontra uma explicação plausível e para
de procurar. É o viés que mais custa caro, e é exatamente o que um modelo maior
resiste melhor por conta própria.

**Se o advisor derrubar, volte ao passo 2 com o que aprendeu.** Isso não é
fracasso, é o protocolo funcionando.

## 5. Caminho de evidência antes de mexer

Só agora, com a hipótese sobrevivente, defina **como este sistema prova** que a
correção funcionou. Use `/kiln:verification-planning`.

Regra que não se negocia: **quem implementa não é quem verifica.** Se o `@builder`
escreveu, quem confere é o comando de teste, o `@advisor`, ou você.

## 6. Releia o passo 1

Antes de declarar pronto, abra `.kiln/hard/<slug>.md` e responda:

- o alvo do passo 1 virou verdade? (a frase original, não a que você lembra)
- o que não podia quebrar continua inteiro?
- o que ficou sem resposta?

Deriva de objetivo é silenciosa: você resolve *um* problema e acha que era *o*
problema. Este passo custa 30 segundos e pega isso.

---

## Escalando quando ainda não resolveu

Em ordem, e só avance quando o anterior falhar:

1. **Mais contexto, não mais raciocínio.** Se a resposta errada veio de
   informação faltando, aumentar effort não ajuda — a orientação oficial é
   explícita: o conserto é a montante, no contexto. Rode `/kiln:codemap`, use o
   LSP, traga a doc certa.
2. **`/effort xhigh`** na sessão, e refaça o passo 4.
3. **Painel de lentes.** Três `@advisor` em paralelo, cada um com um mandato
   diferente: um ataca por corretude, um por concorrência/estado, um por
   fronteira (rede, transação, tempo). Três ângulos acham o que um repete.
4. **`/loop` contra um critério.** Se existe um teste que diz sim ou não, deixe
   iterar até passar. Um modelo menor que itera contra evidência real bate um
   modelo maior que responde uma vez.

## O que NÃO compensa capacidade

- Reformular o mesmo prompt com mais ênfase
- Pedir "pense com cuidado" — o effort faz isso, adjetivo não
- Empilhar agentes sem mandatos distintos: cinco agentes com a mesma instrução
  dão a mesma resposta cinco vezes, e você paga cinco vezes
