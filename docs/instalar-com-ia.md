# Instalar o Turtle com ajuda de uma IA

A forma mais simples: você compra a VPS e o domínio, e uma IA com acesso ao terminal da VPS faz o resto seguindo este roteiro.

## Antes de começar (você faz)

1. **Alugue uma VPS** Ubuntu 24.04 (2 vCPU / 4 GB ou mais, tráfego generoso). Anote o **IP público**.
2. **Registre um domínio** (ou use um que já tenha).
3. No DNS do domínio crie dois registros **A** para o IP da VPS: `app.SEUDOMINIO` e `lk.SEUDOMINIO`. Se usar Cloudflare, deixe **sem proxy** (nuvem cinza).
4. Garanta um jeito de a IA rodar comandos na VPS:
   - **Mais seguro:** você abre o terminal da VPS (SSH ou terminal do painel do provedor) e roda lá o que a IA mandar, colando as saídas de volta. Funciona com qualquer chat.
   - **Com agente de código** (Claude Code, Codex etc.) instalado na VPS ou com SSH por **chave** (nunca entregue senha ou chave privada em um chat).

> Dica: não cole segredos (senhas, chaves, o `.env`) no chat da IA. O roteiro abaixo já evita isso: os segredos são gerados na própria VPS.

## O prompt

Copie tudo abaixo, troque `SEUDOMINIO.COM` e `IP_DA_VPS` e cole na IA.

````text
Você vai instalar o Turtle (chat privado estilo Discord, com voz, tela e câmera; open source) numa VPS Ubuntu 24.04 minha, usando o Docker Compose do próprio repositório. Fale em português, explique cada passo em uma frase e peça minha confirmação antes de qualquer ação destrutiva ou que possa me trancar para fora da VPS (firewall, SSH).

Dados:
- Domínio do app: app.SEUDOMINIO.COM
- Domínio da voz (LiveKit): lk.SEUDOMINIO.COM
- IP da VPS: IP_DA_VPS
- Repositório: https://github.com/sudothi/turtle

Regras:
- Nunca me peça senhas, chaves privadas ou tokens, e não imprima o conteúdo do .env (só o BOOTSTRAP_INVITE no fim, que eu preciso para criar a conta admin).
- Não invente passos: leia infra/selfhost/install.sh, infra/selfhost/docker-compose.yml e docs/hospedar-em-vps.md do repositório e siga o que está lá.
- Não rode nada com sudo além do necessário e não mude a porta do SSH nem desligue o login por senha sem eu confirmar.
- Se um passo falhar, mostre o erro, diga a causa provável e corrija antes de seguir.

Passos:
1. Confirme que estou numa VPS Ubuntu 24.04 (`lsb_release -a`), com usuário comum e sudo. Rode `sudo apt update && sudo apt -y upgrade`.
2. Verifique o DNS: `dig +short app.SEUDOMINIO.COM` e `dig +short lk.SEUDOMINIO.COM` precisam devolver IP_DA_VPS. Se não, pare e me diga o que ajustar no DNS (registros A, sem proxy) e espere eu confirmar.
3. Instale ca-certificates, curl, git, ufw, fail2ban e o Docker com Compose v2 (script oficial get.docker.com). Coloque meu usuário no grupo docker.
4. Firewall (UFW): negar entrada por padrão e liberar SOMENTE 22/tcp (confira a porta real do SSH antes!), 80/tcp, 443/tcp, 7881/tcp, 7882/udp e 3478/udp. Me avise para liberar as mesmas portas no firewall do painel do provedor, se houver. Só ative o UFW depois de confirmar que o SSH está liberado.
5. Clone o repositório, entre em `infra/selfhost` e rode `./install.sh app.SEUDOMINIO.COM lk.SEUDOMINIO.COM --up`. Acompanhe `docker compose logs -f app` até o app responder.
6. Verifique: `docker compose ps` (tudo rodando/saudável) e `curl -fsS https://app.SEUDOMINIO.COM/health`. Se o certificado HTTPS falhar, olhe `docker compose logs caddy` (quase sempre é DNS ainda não propagado ou porta 80/443 fechada).
7. Configure o backup diário: coloque `infra/selfhost/backup.sh` no cron do meu usuário (`0 7 * * *`), rode uma vez para testar e me diga onde os arquivos ficam. Me lembre de copiar essa pasta para fora da VPS de vez em quando.
8. Me entregue: o link `https://app.SEUDOMINIO.COM/convite/<BOOTSTRAP_INVITE>` para criar a primeira conta (admin), e as instruções de uso: depois de criar a conta, Configurações > Administração gera convites para os amigos; para testar a voz, entre em um canal de voz com dois dispositivos.
9. Se a voz não conectar, diagnostique: portas 7881/tcp, 7882/udp, 3478/udp no UFW e no painel do provedor, `docker compose logs livekit` e o DNS de lk.SEUDOMINIO.COM.
10. Termine com um resumo do que foi instalado, onde estão os arquivos (`infra/selfhost/.env` guarda os segredos; não compartilhe), como atualizar (`git pull` e `docker compose up -d --build app`, depois de rodar o backup) e o que eu devo guardar.
````

## O que a IA deve produzir

- Site em `https://app.SEUDOMINIO.COM` com HTTPS válido.
- Voz funcionando entre dois dispositivos.
- Backup diário no cron.
- Um link de convite para a conta admin.

Se algo travar, o guia manual com explicações está em [hospedar-em-vps.md](hospedar-em-vps.md).
