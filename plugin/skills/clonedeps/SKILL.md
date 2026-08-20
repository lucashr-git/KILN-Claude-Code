---
name: clonedeps
description: Clona o código-fonte de dependências importantes para dentro de um workspace local ignorado pelo git, para os Claudinhos inspecionarem o interior das bibliotecas em vez de adivinhar pela documentação. Use quando um bug parece vir de uma dependência, quando o comportamento da biblioteca contradiz a doc, ou antes de depurar integração com framework.
disable-model-invocation: true
allowed-tools: Read, Write, Glob, Grep, Bash
---

# Clonedeps

Documentação mente por omissão; código-fonte não. Quando a dúvida é sobre o que
uma biblioteca **realmente faz**, traga o fonte dela para perto e leia.

## Onde fica

Tudo em `.kiln/deps/<nome-da-lib>/` na raiz do projeto. Garanta a linha
`.kiln/` no `.gitignore` antes de clonar — o fonte de terceiros nunca sobe no
repositório.

## Como trazer

Escolha o caminho mais barato que resolve:

1. **Maven (o caso Java/Spring):** `mvn dependency:sources` baixa os JARs de
   fonte para o repositório local (`~/.m2`). Para inspecionar uma lib
   específica, descompacte só ela:
   `unzip -o ~/.m2/repository/<grupo>/<artefato>/<versão>/*-sources.jar -d .kiln/deps/<artefato>`
2. **Git, versão exata:** `git clone --depth 1 --branch v<versão> <repo> .kiln/deps/<nome>`
   — a tag TEM que bater com a versão do lockfile/pom, senão você depura um
   código que não é o que roda.
3. **npm:** o fonte geralmente já está em `node_modules/<pacote>` — não clone;
   aponte o Claudinho para lá.

## Como usar depois

- `@scout` e `@advisor` passam a poder responder "o que o retry do
  `RestTemplate` faz de verdade?" lendo `.kiln/deps/spring-web/...` com LSP e
  `agrep`, em vez de especular.
- Cite sempre arquivo e linha da dependência na resposta — é a prova de que a
  leitura aconteceu.
- Terminou a investigação? `rm -rf .kiln/deps/<nome>` — isso é material de
  bancada, não parte do projeto.
