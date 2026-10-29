# Assinatura digital gratuita (SignPath Foundation) — passo a passo

O GitHub Actions (`.github/workflows/build.yml`) já compila, testa e publica o Data Gateway.
Para os executáveis saírem **assinados**, é preciso configurar o SignPath uma única vez.

## 1. Pedir a adesão ao SignPath Foundation

1. Acesse <https://signpath.org> → **Apply** (formulário para projetos open source).
2. Informe:
   - Repositório: `https://github.com/hendellacardoso/Data-Gateway`
   - Licença: MIT
   - Página do projeto e da política: `https://github.com/hendellacardoso/Data-Gateway/blob/main/CODE_SIGNING_POLICY.md`
   - Build: GitHub Actions (workflow `Build e Release`)
3. Antes de enviar, publique pelo menos um Release (mesmo sem assinatura) com `publicar-versao.bat`:
   o SignPath exige que a versão já esteja publicada e que a página de download descreva o programa.
4. Aguarde a análise (é feita por pessoas; pode levar algumas semanas). Ative a autenticação de dois fatores no GitHub
   (Settings → Password and authentication) — é obrigatória.

## 2. Configurar o SignPath (depois de aprovado)

No painel <https://app.signpath.io>:

1. **Trusted Build Systems** → adicione **GitHub.com** e vincule ao projeto.
2. Instale o **SignPath GitHub App** e dê acesso ao repositório `Data-Gateway`.
3. **Projects** → projeto com slug **`data-gateway`** (ou anote o slug criado pela Foundation).
4. **Artifact Configuration** → cole o conteúdo de [`.signpath/artifact-configuration.xml`](.signpath/artifact-configuration.xml).
5. **Signing Policies** → use a política de release (slug **`release-signing`**, ou anote o slug existente)
   e confirme você como **Approver**.
6. **Users** → crie um usuário do tipo **CI** com permissão de *submitter* na política e gere o **API Token**.
7. Anote o **Organization ID** (aparece na URL e em *Organization → Settings*).

## 3. Configurar o GitHub

Em `https://github.com/hendellacardoso/Data-Gateway/settings/secrets/actions`:

| Tipo | Nome | Valor |
|---|---|---|
| Secret | `SIGNPATH_API_TOKEN` | o token do usuário CI |
| Variable | `SIGNPATH_ORGANIZATION_ID` | o ID da organização |
| Variable | `SIGNPATH_PROJECT_SLUG` | `data-gateway` (só se for diferente) |
| Variable | `SIGNPATH_POLICY_SLUG` | `release-signing` (só se for diferente) |

## 4. Publicar uma versão

1. Aumente `"version"` no `package.json` (ex.: `1.2.1`).
2. Dê dois cliques em **`publicar-versao.bat`** — ele envia o código e cria a tag `v1.2.1`.
3. Em **Actions** o build roda (≈10 min). Ao chegar em *Assinar no SignPath*, você recebe o pedido:
   aprove em <https://app.signpath.io> → *Signing Requests*.
4. O **Release** aparece com `DataGateway-Setup-1.2.1.exe`, `DataGateway-Portable-1.2.1.exe` e `SHA256SUMS.txt`, assinados.

Sem as variáveis do SignPath, a tag gera o Release com os executáveis **sem assinatura** (útil para o passo 1.3).

## Observações

- Assinar remove o aviso de "Editor desconhecido". O **SmartScreen** também usa reputação: nas primeiras semanas
  ainda pode aparecer um aviso, que diminui conforme o programa é baixado e usado.
- Toda alteração entra pelo repositório; contribuições externas (pull requests) devem ser revisadas antes do merge.
- A página do projeto (README e site) precisa manter a seção **Code signing policy**.
