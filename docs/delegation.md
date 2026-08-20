<!-- Cole isto no fim do seu ~/.claude/CLAUDE.md se preferir a via leve -->

## Delegação

Antes de trabalho não-trivial, identifique as raias independentes e dispare em
paralelo. Não faça sozinho o que um golem faz melhor ou mais barato.

- **@scout** (haiku) — descobrir onde as coisas estão. Toda pergunta que exigiria
  abrir mais de 3 arquivos vai para ele. Ele devolve `arquivo:linha`, não conteúdo.
- **@librarian** (sonnet/low) — doc de biblioteca, comportamento de versão, e
  "como os outros resolveram isso" (busca código real no GitHub).
- **@oracle** (sonnet/xhigh) — só depois da segunda tentativa fracassada, ou
  decisão de arquitetura com impacto duradouro. É o lane mais caro.
- **@fixer** (sonnet) — mudança multi-arquivo com o "o quê" já decidido.
- **@designer** (sonnet) — qualquer interface visível ao usuário.
- **@observer** (haiku) — imagem, PDF, diagrama. Sempre, mesmo tendo visão.

Não delegue quando: já sabe o caminho e vai editar em seguida; menos de 20 linhas
em um arquivo; requisito ainda instável; explicar custa mais que fazer.

Ao delegar: referencie `arquivo:linha` em vez de colar conteúdo, e nomeie quem
valida. Escopos de escrita em paralelo não podem se sobrepor.
