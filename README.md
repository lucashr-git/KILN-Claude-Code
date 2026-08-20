# Kiln

Kiln é um plugin do [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
que organiza especialistas para descobrir, pesquisar, avaliar e implementar
mudanças em um repositório. Os papéis principais são `researcher`, `advisor` e
`builder`; o plugin também oferece codemap, LSP, busca e métricas.

## Pré-requisitos e suporte

- Claude Code instalado e funcionando.
- `jq` no `PATH` (obrigatório para os hooks).
- macOS: é a única plataforma em que o Kiln completo é suportado e testado hoje.
- O Claude Code também suporta macOS, Linux e Windows, mas Linux e Windows ainda
  não são suportados pelo Kiln. iOS não executa o Claude Code localmente.
- Node/npm e Python só são necessários para os componentes opcionais que você
  escolher, como avatar e voz.

## Testar pelo diretório local

Na raiz deste repositório, instale o pré-requisito obrigatório e abra o Claude
Code no projeto que quer trabalhar:

```bash
brew install jq
cd /caminho/para/seu-projeto
claude --plugin-dir /caminho/para/kiln/plugin
```

Teste rápido dentro do Claude Code:

```text
/kiln:codemap
@researcher como esta biblioteca recomenda tratar retries?
@advisor qual é o risco desta mudança?
```

Para implementar uma mudança já decidida, use `@builder`. O contexto configurado
é de 1M de tokens e o gateway aceita `/effort`; o conteúdo útil é menor por causa
do prompt, ferramentas e anexos. As medições detalhadas ficam em
[`docs/gateway/measurements.md`](docs/gateway/measurements.md).

Hoje não existe uma instalação universal de um único comando que instale o Kiln e
todas as suas dependências. No futuro, depois que um marketplace GitHub for
publicado, o fluxo poderá ser:

```bash
claude plugin marketplace add owner/repo
claude plugin install kiln@repo --yes
```

## Documentação

- [`plugin/README.md`](plugin/README.md) — instalação e componentes do plugin.
- [`docs/usage.md`](docs/usage.md) — uso no dia a dia.
- [`docs/architecture.md`](docs/architecture.md) — arquitetura e fluxo.
- [`docs/execution-models.md`](docs/execution-models.md) — motores de execução.
- [`docs/gateway/measurements.md`](docs/gateway/measurements.md) — medições detalhadas.
- [`docs/gateway/context-1m.md`](docs/gateway/context-1m.md) — contexto de 1M.
- [`docs/gateway/test-effort.md`](docs/gateway/test-effort.md) — teste de `effort`.
