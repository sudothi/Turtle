# Servidores (plano)

Qualquer conta cria até 2 servidores (como dona) e entra em quantos quiser por convite. Cada servidor tem canais de texto e voz, membros e convites próprios. Entra num PR próprio antes do marco 3. O que existe hoje vira o servidor "Turtle".

## Regras

- Limite: 2 servidores como dono; apagar ou passar a posse libera a vaga.
- Convite de servidor: código/link, validade padrão 7 dias, limite de usos opcional; também serve para criar conta.
- Membro sai quando quiser; dono só sai depois de passar a posse; apagar pede o nome do servidor.

| Ação | Dono | Admin | Membro |
| --- | --- | --- | --- |
| Ver canais, conversar, entrar em chamadas | sim | sim | sim |
| Criar convites | sim | sim | sim |
| Criar, renomear e apagar canais | sim | sim | não |
| Expulsar membros | sim | só membros | não |
| Promover ou rebaixar admin | sim | não | não |
| Renomear, ícone, apagar, passar a posse | sim | não | não |

## Banco de dados

| Tabela | Colunas principais | Observação |
| --- | --- | --- |
| `servers` (nova) | id, name, icon, owner_id, created_at | nome 2 a 40 caracteres |
| `server_members` (nova) | server_id, user_id, role, joined_at | chave (server_id, user_id) |
| `server_invites` (nova) | code, server_id, created_by, expires_at, max_uses, uses | |
| `channels` (muda) | + server_id | nome único por servidor |
| `invites` (fica) | igual | só convites de conta do admin |

Migração: cria "Turtle" com dono = primeiro admin, todos viram membros, canais atuais ligados a ele. Limite de 2 checado em transação.

## API e gateway

Toda rota e evento passam a checar se a pessoa é membro do servidor do canal.

| Rota | Quem pode |
| --- | --- |
| `GET /servers` | qualquer conta |
| `POST /servers` | qualquer conta, até 2 como dono |
| `PATCH` / `DELETE /servers/:id`, `POST /servers/:id/transfer` | dono |
| `GET /servers/:id/channels`, `GET /servers/:id/members` | membro |
| `POST /servers/:id/channels` | dono e admin |
| `PATCH` / `DELETE /servers/:id/members/:user` | dono e admin (ou o próprio, para sair) |
| `POST /servers/:id/invites` | membro |
| `GET /invites/:code` | público |
| `POST /invites/:code/join` | qualquer conta |

Gateway: mensagens, canais, presença e voz só para membros; eventos de servidor e de membros; expulso cai da chamada. LiveKit não muda.

## App

Coluna de servidores (já desenhada no redesign: `ServerRail` aceita `servers/activeId/onSelect/onCreate/onJoin`), criar, entrar com convite, menu do servidor no topo dos canais (`HeaderMenu`), configurações (nome, ícone, membros, convites, posse, apagar), lista "Online" por servidor, lembrar último servidor e canal.

## Decisões em aberto

- [ ] Admin do Turtle também limitado a 2?
- [ ] Convite de servidor cria conta?
- [ ] Validade padrão: 7 dias, 1 dia ou sem validade?
- [ ] Três papéis bastam?
