# Data Gateway Desktop

Aplicativo desktop (Windows) que transforma tabelas de bancos de dados existentes em **APIs REST seguras**, configuradas visualmente — sem escrever SQL e sem expor o banco à internet.

**Stack:** Electron 37 · React 18 · Vite 5 · JavaScript · Node.js · SQLite (better-sqlite3) · CSS
**Bancos suportados:** SQL Server · PostgreSQL · MySQL · MariaDB · SQLite

---

## Como executar

Pré-requisitos: **Node.js 20 ou 22** (LTS) no Windows.

```bash
npm install          # instala dependências e compila o better-sqlite3 para o Electron (postinstall)
npm run dev          # Vite (painel) + Electron com recarga do painel
```

Na primeira execução o app pede a criação do **usuário administrador**.

### Enviar para o GitHub

Dê dois cliques em `enviar-git.bat`. Na primeira vez ele inicializa o repositório, configura o remoto
`https://github.com/hendellacardoso/api-gateway-desktop.git`, pede nome/e-mail (se ainda não configurados) e a mensagem do commit,
e faz o `push` para a branch `main`. `node_modules`, `dist`, `release` e bancos `.db` ficam fora (via `.gitignore`).

### Gerar o instalador (.exe)

```bash
npm run dist
```

Gera `release/Data Gateway Setup 1.0.0.exe` (NSIS): instala o aplicativo, cria atalhos (Área de Trabalho e Menu Iniciar), permite escolher a pasta e cria o desinstalador.
O diretório de dados é criado no primeiro uso em `%APPDATA%\Data Gateway` (banco interno, chave mestra e uploads).
A opção **Iniciar com Windows** é controlada pelo próprio app (Tray ou Configurações) e abre o Gateway minimizado (`--hidden`).

> Ícone gerado a partir de `imagens/logotipo.png`: `build/icon.ico` (executável, instalador e atalhos), `assets/icon.ico`/`icon.png` (janela) e `assets/tray.png` (bandeja, apenas o símbolo da nuvem para ficar legível em 16–32 px).

---

## Arquitetura

```text
src/
├── main/                    Electron Main Process
│   ├── main.js              ciclo de vida, instância única, inicialização do serviço
│   ├── window.js            BrowserWindow seguro (contextIsolation, sandbox, CSP)
│   ├── tray.js              menu do System Tray
│   ├── ipc/handlers.js      canal IPC único com whitelist de ações + sessão no main
│   └── services/startup.js  iniciar com o Windows
├── preload/preload.js       expõe somente window.gateway.invoke / on
├── renderer/                React (painel)
│   ├── pages/               Dashboard, Bancos, Endpoints, wizard/, Tokens, Testador, Logs…
│   ├── components/ layouts/ hooks/ services/ stores/ styles/
├── server/                  Backend / API REST (Express)
│   ├── server.js            GatewayServer (start/stop/restart, HTTP/HTTPS)
│   ├── context.js           contexto compartilhado (painel + API)
│   ├── routes/              /api/v1 dinâmico, /docs (Swagger UI), /openapi.json
│   ├── middleware/          headers de segurança, CORS, rate limit, logs, erros
│   ├── services/            CRUD, conversão de tipos, pool de conexões, cache de metadados
│   ├── drivers/             DatabaseDriver + SqlServer/Postgres/MySql(MariaDB)/Sqlite
│   ├── query-builder/       Query Builder seguro + dialetos
│   ├── authentication/      tokens Bearer e permissões
│   ├── uploads/             multipart, validação, filesystem ou banco
│   ├── logging/             GW_LOG e GW_AUDITORIA
│   ├── openapi/             gerador OpenAPI 3
│   ├── security/            hash de senha (scrypt), segredos (DPAPI / AES-GCM)
│   └── admin/               ações do painel (usadas via IPC)
└── database/
    ├── connection.js        abre data-gateway.db (WAL, foreign keys)
    ├── migrations/          migrations versionadas (GW_MIGRACAO)
    └── repositories/        configuração e endpoints
```

### Fluxo de uma requisição

```text
Authorization: Bearer → token (hash SHA-256) → status/expiração → endpoint publicado (whitelist)
→ permissão do token para a operação → validação de parâmetros/JSON/tipos
→ Query Builder (identificadores da configuração + valores parametrizados) → driver com pool → JSON
```

### Adicionar um novo banco

1. Crie `server/drivers/NovoDriver.js` estendendo `DatabaseDriver` (connect, query, execute e descoberta).
2. Adicione o dialeto em `server/query-builder/dialects.js`.
3. Registre em `server/drivers/index.js` e inclua o tipo no `CHECK` de `GW_BANCO` via nova migration.

---

## Interface

- **Barra de status** (rodapé): status do Gateway e URL, conexões com pool ativo/falhas, endpoints publicados, tokens ativos,
  requisições e erros do dia, tempo médio, última requisição, ambiente, versão e hora. Atualiza a cada 5 s; os itens são clicáveis.
- **Sobre** (Sistema → Sobre e menu do Tray): logotipo (`imagens/logotipo.png`), desenvolvedor, e-mail, WhatsApp, website e versões.

## Segurança (resumo)

- O banco nunca é exposto; a API só aceita endpoints/campos/filtros/ordenações **configurados** (whitelist).
- Todo valor do cliente vira **parâmetro**; identificadores vêm somente do SQLite interno e são escapados pelo dialeto. `LIKE` escapa `%`, `_` e `[`.
- Parâmetros desconhecidos na URL são rejeitados (`400`); token na URL é recusado.
- Paginação obrigatória com máximo configurável por endpoint; timeout de consultas; rate limit por token.
- Senhas do painel: **scrypt** + salt. Tokens: exibidos uma vez, armazenados como **SHA-256**.
- Senhas de banco: **DPAPI** do Windows (Electron `safeStorage`); fallback AES-256-GCM com chave mestra local.
- Erros em produção não retornam stack trace nem mensagens internas do banco.
- Upload: whitelist de extensões, bloqueio de executáveis/scripts, limite de tamanho e quantidade, nomes sanitizados, sem sobrescrita.
- Painel: `contextIsolation`, `sandbox`, `nodeIntegration: false`, CSP, navegação bloqueada e IPC validando a origem.
- Logs não gravam valores de filtros nem corpos (somente nomes de parâmetros); auditoria de login, configuração, tokens, inclusões, alterações, exclusões e uploads.
- Backup `.datagateway`: senhas de banco só são exportadas criptografadas com frase-senha; tokens apenas como hash.

---

## API gerada

| Operação | Rota | Permissão do token |
|---|---|---|
| Consulta paginada | `GET /api/v1/{endpoint}?page=1&pageSize=50&sort=nome&direction=asc&<filtros>&expand=<rel>` | Consultar |
| Por ID | `GET /api/v1/{endpoint}/{id}` | Consultar por ID |
| Inclusão | `POST /api/v1/{endpoint}` (JSON) | Incluir |
| Alteração | `PUT` / `PATCH /api/v1/{endpoint}/{id}` (JSON) | Alterar |
| Exclusão física ou lógica | `DELETE /api/v1/{endpoint}/{id}` | Excluir |
| Upload | `POST /api/v1/{endpoint}/{id}/arquivos` (multipart, campo `arquivos`) | Upload |
| Arquivos | `GET /api/v1/{endpoint}/{id}/arquivos[/{arquivoId}]` | Consultar por ID |

Outros: `GET /health`, `GET /docs` (Swagger UI), `GET /openapi.json`.
Códigos de erro: `AUTHENTICATION_ERROR`, `AUTHORIZATION_ERROR`, `VALIDATION_ERROR`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `CONFLICT`, `DATABASE_ERROR`, `CONNECTION_ERROR`, `UPLOAD_ERROR`, `RATE_LIMIT`, `INTERNAL_ERROR`.

---

## Testes

Os testes rodam fora do Electron, então o `better-sqlite3` precisa estar compilado para o Node:

```bash
npm run rebuild:node   # compila better-sqlite3 para o Node
npm test               # testes de ponta a ponta (SQLite) + Query Builder
npm run postinstall    # volta a compilar para o Electron antes de rodar o app
```

Testes opcionais contra bancos reais (`tests/externos.test.js`):

```bash
# PostgreSQL: banco "erp", schema "vendas" com tabelas clientes / cliente_endereco
set GW_PG_PORT=5432& set GW_PG_PASSWORD=...& npm test
# MySQL/MariaDB: banco "erp", usuário "gw"
set GW_MY_PORT=3306& set GW_MY_PASSWORD=...& set GW_MY_TYPE=mariadb& npm test
```

---

## Preparado para o futuro (não implementado na v1)

- **Relay remoto:** seção `relay` reservada em `GW_CONFIG`; o `GatewayServer` e o `CrudService` são independentes do transporte, permitindo um cliente de túnel persistente que encaminhe requisições ao mesmo pipeline.
- Novos drivers, GraphQL, webhooks, cache e multiempresa podem ser adicionados sobre `context.js` sem alterar o núcleo.
