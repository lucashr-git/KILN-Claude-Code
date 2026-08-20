---
name: verification-planning
description: Monta o caminho de evidência antes de mudar algo não-trivial — como ESTE sistema pode provar que a mudança está certa. Use antes de implementar feature, correção de bug, refactor ou mudança de comportamento com risco.
---

# Planejamento de verificação

O objetivo não é escolher uma técnica conhecida. É decidir **como este sistema
específico revela a verdade sobre esta mudança específica**.

## 1. Enuncie a afirmação

Qual comportamento precisa passar a ser verdade, e o que continua tendo que ser
verdade depois. Considere: o que muda, o que não pode quebrar, onde o
comportamento cruza uma fronteira (rede, transação, thread, processo), e qual
falha doeria mais.

*Pronto quando:* a afirmação, a incerteza real e as falhas que importam estão
concretas o bastante para investigar.

## 2. Derive o caminho de evidência

Tire do próprio sistema: entradas que você controla, efeitos que você observa,
transições de estado, invariantes, fronteiras, artefatos gerados, e a
capacidade de repetir ou desfazer um cenário.

Gere alternativas antes de escolher. Prefira o caminho que produz uma conclusão
confiável com custo, risco e esforço proporcionais.

*Pronto quando:* existe um caminho preferido, você sabe onde ele é fraco, e
tem uma alternativa mais barata e uma mais forte na manga.

## 3. Crie um instrumento, se precisar

Quando o sistema deixa a verdade indireta demais, construa a **menor**
capacidade que torna o estado relevante controlável, observável, repetível e
diagnosticável: um endpoint de inspeção, um log estruturado no ponto certo, uma
semente determinística, um fixture que reproduz o cenário do zero.

Decida de propósito se esse instrumento é temporário ou vai ficar. Instrumento
sem dono vira dívida.

*Pronto quando:* o caminho estabelece a afirmação de forma direta o bastante
para o risco em jogo.

## 4. Defina o orçamento

Liste as afirmações distintas. Para cada uma, **um** dono que a estabelece ou
refuta. Escolha a evidência mínima não-duplicada que cobre as afirmações e as
fronteiras que importam.

Reaproveite evidência enquanto o código, a entrada, o ambiente e o estado
continuarem válidos. Repetir verificação sem que nada tenha mudado é gasto sem
informação nova.

## Regras que não se negociam

- **Quem implementou não é quem verifica.** Se o @builder escreveu, quem confere
  é o comando de teste, o @advisor ou você.
- **"Pulei, e o motivo é X"** é resposta válida. Silêncio não é.
- Verificação que não pode falhar não é verificação. Se você não consegue
  descrever o resultado que te faria mudar de ideia, o teste não vale nada.
