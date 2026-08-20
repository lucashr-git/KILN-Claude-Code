# Kiln

Plugin do Claude Code com especialistas para descoberta, pesquisa, decisão e
implementação, além de codemap, LSP, busca e métricas.

## Instalação local para teste

Na raiz do repositório, instale `jq` e abra o Claude Code no projeto de trabalho:

```bash
brew install jq
cd /caminho/para/seu-projeto
claude --plugin-dir /caminho/para/kiln/plugin
```

`jq` é obrigatório para os hooks. O Kiln configura as ferramentas, mas não
instala todas as dependências delas.

Hoje não há um comando universal que instale o plugin e todas as dependências.
Depois que um marketplace GitHub for publicado, o fluxo poderá ser:

```bash
claude plugin marketplace add owner/repo
claude plugin install kiln@repo --yes
```

## Opcionais

### Avatar (Electron)

O companion Electron mostra o estado dos especialistas. Para ativá-lo:

```bash
cd /caminho/para/kiln/plugin/companion
npm install
```

Sem esse passo, o plugin continua funcionando sem avatar.

### Voz local

A voz é somente transcrição local com Whisper; não é necessária para usar o
plugin:

```bash
cd /caminho/para/kiln/plugin/voice
bash install-voz.sh
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
