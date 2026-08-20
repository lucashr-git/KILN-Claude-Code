# Kiln

Plugin do Claude Code com especialistas para descoberta, pesquisa, decisão e
implementação, além de codemap, LSP, busca e métricas.

## Instalação publicada (macOS)

Pré-requisitos: Claude Code, Node.js/npm e `jq` no `PATH`. Se `jq` estiver
ausente, o instalador usa Homebrew para instalá-lo:

```bash
bunx @lucashr/kiln@0.1.0 install
```

Confira primeiro sem alterações:

```bash
bunx @lucashr/kiln@0.1.0 install --dry-run
```

O marketplace é copiado para `~/.local/share/kiln/marketplace`, o plugin é
instalado/atualizado no escopo user do Claude Code e a voz local é instalada por
padrão. O Whisper faz um download único do modelo e depois trabalha localmente.
Use `--without-voice` para pulá-la explicitamente. A instalação usa somente
Python 3.12 ou 3.13; quando ambos faltam, `kiln install` executa
`brew install python@3.12`, consulta `brew --prefix python@3.12` e passa o
executável por `KILN_PYTHON`. O Claude CLI registra o
marketplace e `enabledPlugins`; o instalador não edita diretamente `settings.json`,
tokens Flow ou arquivos `env`. `rollback` troca a cópia durável pela anterior e
reconcilia o registro sem remover estado pré-existente.

## Instalação local para teste

Na raiz do repositório, instale `jq` se necessário e abra o Claude Code no projeto de trabalho:

```bash
brew install jq
cd /caminho/para/seu-projeto
claude --plugin-dir /caminho/para/kiln/plugin
```

`jq` é obrigatório para os hooks. O Kiln configura as ferramentas, mas não
instala todas as dependências opcionais delas.

## Configuração do Claude e do Flow

O instalador não configura credenciais nem edita `env` ou tokens. Autentique o
Claude Code e configure o Flow pelos mecanismos oficiais da sua organização.
Durante a instalação, o Claude CLI registra o marketplace e `enabledPlugins`;
outras configurações do usuário são preservadas.

Verificação simples: abra o Claude Code com o plugin e execute `/kiln:codemap`:

```bash
claude --plugin-dir /caminho/para/kiln/plugin
```

Instalação concisa: se necessário, instale `jq` com `brew install jq`. O plugin
não instala as demais dependências opcionais.

## Componentes opcionais

### Avatar (Electron)

O companion Electron mostra o estado dos especialistas. Para ativá-lo:

```bash
cd /caminho/para/kiln/plugin/companion
npm install
```

Sem esse passo, o plugin continua funcionando sem avatar.

### Voz local

A voz é transcrição local com Whisper e já é instalada por `kiln install`. O
download do modelo acontece uma única vez. Para instalar manualmente ou reparar
uma instalação:

```bash
cd /caminho/para/kiln/plugin/voice
bash install-voz.sh
```

O instalador manual aceita somente Python 3.12 ou 3.13. Se nenhum deles existir,
ele sai antes de criar ou alterar o venv e orienta:

```bash
brew install python@3.12
```

## Uso rápido

Dentro do Claude Code:

```text
/kiln:codemap
@researcher pesquise como esta biblioteca trata retries
@advisor avalie o risco deste refactor
@builder implemente esta mudança conforme a especificação
```

Os especialistas usam contexto separado e devolvem resumos curtos. O contexto
de 1M está configurado e `/effort` é aceito pelo gateway; o conteúdo útil é
menor por causa da sobrecarga de prompt, ferramentas e anexos. Consulte as
[medições do gateway](../docs/gateway/measurements.md) para os números.

Mais detalhes: [uso diário](../docs/usage.md), [arquitetura](../docs/architecture.md)
e [modelos de execução](../docs/execution-models.md).

MIT.
