---
name: reflect
description: Revisa o trabalho recente da sessão procurando atrito repetido — o mesmo tipo de correção pedida duas vezes, a mesma pergunta re-respondida, o mesmo passo manual — e propõe a melhoria reutilizável correspondente - uma skill nova, uma regra, um ajuste num Claudinho ou um comando. Use no fim de uma sessão longa ou depois de terminar um trabalho que teve idas e vindas.
disable-model-invocation: true
allowed-tools: Read, Glob, Grep
---

# Reflect

Atrito que se repete é especificação de ferramenta que ainda não existe. Esta
skill transforma o incômodo de hoje na melhoria de amanhã — é o substituto de
uma base de usuários quando a base é uma pessoa só.

## O processo

1. **Releia a sessão** (ou o diff do dia) procurando exatamente três coisas:
   - correção que o usuário pediu **mais de uma vez** com outras palavras;
   - pergunta que você respondeu **de novo** porque a resposta não ficou em lugar nenhum;
   - sequência de passos manuais que apareceu **duas vezes ou mais**.
2. **Para cada atrito, proponha UMA melhoria**, a menor que elimina o atrito:
   - se é conhecimento que se perde → regra em `.claude/rules/` ou linha no `CLAUDE.md` do projeto;
   - se é processo que se repete → skill nova em `skills/` (três parágrafos bastam);
   - se é comportamento de um Claudinho → ajuste no `agents/<Claudinho>.md`;
   - se é comando de shell recorrente → alias ou script em `bin/`.
3. **Entregue como lista curta**: atrito observado → melhoria proposta → onde
   ela mora. NÃO implemente nada sem o usuário escolher — reflexão sem filtro
   vira entulho de configuração.

## O teste de qualidade

Uma proposta boa passa nisto: *"se isso existisse no começo da sessão, quantos
minutos teriam sobrado?"* Se a resposta é "quase nenhum", corte a proposta.
