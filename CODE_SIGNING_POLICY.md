# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Os executáveis do Data Gateway publicados em [Releases](https://github.com/hendellacardoso/api-gateway-desktop/releases)
(`DataGateway-Setup-<versão>.exe` e `DataGateway-Portable-<versão>.exe`) são compilados a partir deste repositório pelo
[GitHub Actions](.github/workflows/build.yml) e assinados pelo SignPath somente após aprovação manual de cada versão.

## Team roles / Equipe

| Papel | Membros |
|---|---|
| Committers and reviewers (autores e revisores) | [Hendell Alves Cardoso](https://github.com/hendellacardoso) |
| Approvers (aprovam cada assinatura) | [Hendell Alves Cardoso](https://github.com/hendellacardoso) |

Contribuições externas (pull requests) são revisadas por um revisor antes de entrar na branch `main`.
Todos os membros usam autenticação de dois fatores no GitHub e no SignPath.

## Privacy policy / Política de privacidade

This program will not transfer any information to other networked systems unless specifically requested by the user
or the person installing or operating it.

O Data Gateway não envia dados para a API2Dev nem para terceiros. Ele se conecta apenas aos bancos de dados que o
administrador cadastrar e responde somente às requisições feitas à API que o próprio administrador publicar.
As configurações ficam em um banco local (`%APPDATA%\Data Gateway`) no computador onde o programa está instalado.

## Contato

Problemas de segurança ou dúvidas sobre a assinatura: suporte@api2dev.com.br
