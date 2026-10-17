# Site de download do Data Gateway — api2dev.com.br

Site estático com servidor Node **sem dependências** (não precisa de `npm install`).
Ele escuta em **127.0.0.1:5010** e o Caddy publica em **https://api2dev.com.br**. `www.api2dev.com.br` redireciona para o domínio principal.

```
site\
  server.js            servidor (páginas, /api/versao, /download/instalador, /download/portatil, /saude)
  public\              página (index.html, css, js, imagens e prints)
  downloads\           os .exe oferecidos para download (copiados pelo publicar.bat)
  dados\downloads.json contador de downloads (criado automaticamente)
  logs\                logs do serviço e do Caddy
  caddy\               site-datagateway.caddy (gerado)
  deploy\              publicar.bat, caddy.bat, servico.bat e scripts
  iniciar-local.bat    roda o site sem serviço, só para testar
```

## Publicar

1. Gere os executáveis do aplicativo com `..\gerar-instalador.bat`. Eles vão para `..\release`.
2. Dê dois cliques em `site\deploy\publicar.bat`. O script pede permissão de Administrador e faz o seguinte:
   - Para o serviço `SiteDataGateway` e confere se a porta 5010 está livre.
   - Copia `DataGateway-Setup-<versão>.exe` e `DataGateway-Portable-<versão>.exe` de `..\release` para `downloads`. A versão vem do `package.json`; as versões antigas vão para `downloads\antigos`.
   - Envia o projeto para o GitHub.
   - Cria ou atualiza o serviço do Windows `SiteDataGateway` com o NSSM. O serviço inicia com o Windows e reinicia se cair.
   - Testa `http://127.0.0.1:5010/saude`.
   - Gera `caddy\site-datagateway.caddy`, inclui o `import` no `C:\Caddy\Caddyfile` (com backup) e roda `caddy validate` e `caddy reload`.

   Opções:
   - `publicar.bat /semgit`: não envia para o GitHub.
   - `publicar.bat /semcaddy`: não altera o Caddy.
   - `publicar.bat /semexe`: não copia os executáveis.

O DNS de `api2dev.com.br` e de `www.api2dev.com.br` precisa apontar para este servidor. Se você usa a Cloudflare, o IP real do visitante é repassado.

## Outros comandos

- `deploy\caddy.bat`: só refaz a configuração do Caddy.
  - `deploy\caddy.bat -CorrigirAcentos` também conserta acentos estragados no Caddyfile, como `IdentificaÃ§Ã£o`.
- `deploy\servico.bat`: mostra o status, inicia, para, reinicia, exibe os logs ou remove o serviço.
- Para trocar a porta ou o domínio, edite `PORTA` e `DOMINIO` no início do `publicar.bat`.

## Lançar uma versão nova do aplicativo

Atualize a versão no `package.json` do aplicativo, rode `gerar-instalador.bat` e depois `site\deploy\publicar.bat`.
O site mostra automaticamente a versão, o tamanho e o SHA-256 dos arquivos que estão em `downloads`.
