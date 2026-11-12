# Turtle Setup

Assistente de linha de comando que instala o Turtle numa VPS Ubuntu 24.04 a partir do seu computador. Faz o que o [guia manual](../../docs/hospedar-em-vps.md) faz, em ordem e com verificações: confere o DNS, entra na VPS por SSH, instala Docker, liga o firewall (liberando o SSH antes), baixa o Turtle, sobe tudo com `infra/selfhost/install.sh`, agenda o backup e entrega o link de convite da conta admin.

## Como usar

Precisa de Node 22+ e do cliente `ssh` (já vem no Windows 10+, macOS e Linux). Na VPS: usuário comum com sudo sem senha e a sua **chave pública** em `~/.ssh/authorized_keys`.

```sh
node tools/turtle-setup/turtle-setup.mjs
# ou, sem perguntas:
node tools/turtle-setup/turtle-setup.mjs --ip 203.0.113.10 --domain seudominio.com --user ubuntu --yes
```

Opções: `--port 22`, `--key ~/.ssh/chave`, `--app app.outro.com --lk lk.outro.com`, `--no-firewall`, `--dry-run` (só mostra os comandos que rodaria).

## Segurança

- Nunca pede, recebe nem guarda senha ou chave privada: o `ssh` usa `BatchMode` (só chave/ssh-agent). Na primeira conexão aceita a impressão digital do servidor (`accept-new`).
- Os segredos (`.env`) são gerados **na VPS** pelo `install.sh`. O assistente só lê o código do primeiro convite, no fim, para montar o link; não imprime o `.env`.
- Tudo que vai para um comando remoto (IP, domínio, usuário, porta) é validado com regras estritas antes.
- Pode ser repetido: com `.env` existente ele só atualiza os contêineres e mantém os segredos.

## O que ele não faz

Não mexe na porta do SSH nem desliga login por senha; não gera apps Android/iOS (o app aponta para o servidor por link de convite `turtle://`, veja `docs/planos/app-dev-instalador.md`); não publica o instalador do desktop (veja "App desktop do seu servidor" no guia).

Testes: `node --test tools/turtle-setup/test/turtle-setup.test.mjs`.
