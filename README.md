# Kiln

Kiln é um plugin do [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
que organiza especialistas para descobrir, pesquisar, avaliar e implementar
mudanças em um repositório. Os papéis principais são `researcher`, `advisor` e
`builder`; o plugin também oferece codemap, LSP, busca e métricas.

## Pré-requisitos e suporte

- Claude Code instalado e funcionando.
- Node.js e npm no `PATH`.
- `jq` no `PATH` (obrigatório para os hooks; o instalador pode instalá-lo via
  Homebrew se necessário).
- macOS: é a única plataforma em que o Kiln completo é suportado e testado hoje.
- O Claude Code também suporta macOS, Linux e Windows, mas Linux e Windows ainda
  não são suportados pelo Kiln. iOS não executa o Claude Code localmente.

## Instalação publicada

Use a versão fixa para tornar a instalação reproduzível:

```bash
bunx @lucashr/kiln@0.1.0 install
```

O comando faz preflight de Claude Code, Node/npm e `jq`; se `jq` não estiver
instalado, pede ao Homebrew para instalá-lo (Homebrew não é necessário quando
`jq` já está no `PATH`). Ele copia o marketplace
para `~/.local/share/kiln/marketplace`, instala o Electron do companion com
`npm ci` e registra/instala `kiln@kiln-cc` no escopo user do Claude Code.

Antes de alterar qualquer coisa, confira o plano:

```bash
bunx @lucashr/kiln@0.1.0 install --dry-run
```

Para trocar a cópia durável pela versão anterior:

```bash
bunx @lucashr/kiln@0.1.0 rollback
```

O instalador atual é somente macOS. Ele chama o Claude CLI, que registra o
marketplace e `enabledPlugins` no estado do Claude Code; não edita diretamente
`settings.json`, `env` ou tokens Flow. `rollback` reconcilia esse registro com a
cópia anterior sem remover estado pré-existente. A instalação mantém uma cópia
anterior. Voz é explicitamente opcional e fica fora do fluxo padrão.

## Configuração do Claude e do Flow

O instalador não configura credenciais. Autentique o Claude Code e configure
eventuais variáveis do Flow pelo mecanismo oficial da sua organização; nunca
cole tokens nesta documentação. O registro feito pela instalação é apenas o
marketplace e `enabledPlugins`, via Claude CLI, preservando as demais
configurações do usuário.

Instalação concisa para teste local (instale `jq` somente se ainda não o tiver),
abra o projeto e inicie o Claude Code com o plugin local:

```bash
brew install jq
cd /caminho/para/seu-projeto
claude --plugin-dir /caminho/para/kiln/plugin
```

Verificação simples: dentro do Claude Code, execute `/kiln:codemap` e confirme
que ele responde sobre o repositório.

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

## Documentação

- [`plugin/README.md`](plugin/README.md) — instalação e componentes do plugin.
- [`docs/usage.md`](docs/usage.md) — uso no dia a dia.
- [`docs/architecture.md`](docs/architecture.md) — arquitetura e fluxo.
- [`docs/execution-models.md`](docs/execution-models.md) — motores de execução.
- [`docs/gateway/measurements.md`](docs/gateway/measurements.md) — medições detalhadas.
- [`docs/gateway/context-1m.md`](docs/gateway/context-1m.md) — contexto de 1M.
- [`docs/gateway/test-effort.md`](docs/gateway/test-effort.md) — teste de `effort`.
