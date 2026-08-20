---
name: codemap
description: Cria e mantém um mapa hierárquico do repositório — um codemap.md por pasta — para que os Claudinhos leiam o mapa em vez de varrer arquivos. Operação cara; use ao entrar num repositório desconhecido ou quando o mapa estiver velho.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep
---

# Codemap

Um `codemap.md` por pasta dizendo o que existe ali e por quê. Depois disso o
scout lê o mapa em vez de abrir dez arquivos. É o maior economizador de
contexto do conjunto.

## 1. Já existe estado?

```bash
node ${CLAUDE_SKILL_DIR}/scripts/codemap.mjs changes --root .
```

"sem estado" → passo 2. Listas → passo 4.

## 2. Inicializar

Olhe a estrutura do repositório antes de escolher os padrões. Inclua **só
código e configuração de origem**. Exclua teste, documentação, build e
dependência — sempre.

```bash
node ${CLAUDE_SKILL_DIR}/scripts/codemap.mjs init --root . \
  --include "src/main/**/*.java" --include "pom.xml" \
  --exclude "**/*Test.java" --exclude "target/**"
```

A saída traz `folders`: as pastas que precisam de mapa.

## 3. Escrever os mapas

Para **cada pasta** da lista, despache um `@builder` — uma pasta por builder, em
paralelo, escopos que não se sobrepõem. Instrução para cada um:

> Leia os arquivos de origem em `<pasta>` e escreva `<pasta>/codemap.md`.
> No máximo 40 linhas. Estrutura:
> - **Papel**: o que essa pasta faz no sistema, 1-2 linhas
> - **Peças**: uma linha por arquivo — o que é e o símbolo público principal
> - **Depende de**: pastas ou módulos que ela usa
> - **Usado por**: quem depende dela, se der para saber
> - **Cuidados**: invariante, armadilha, acoplamento não óbvio
>
> Sem exemplo de código. Sem assinatura inteira. Descreva, não transcreva.

Quando todos voltarem:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/codemap.mjs stamp --root .
```

## 4. Atualizar só o que mudou

`changes` devolve `folders` afetadas. Um `@builder` por pasta afetada para
**atualizar** (não reescrever) o `codemap.md` dela. Depois, `stamp`.

## Regras

- `.kiln/` no `.gitignore`. Os `codemap.md` **vão** para o git — são documentação.
- Nenhum `codemap.md` passa de 40 linhas. Mapa longo derrota o propósito.
- Mudou de propósito, reescreva. Só ganhou um arquivo, edite.
