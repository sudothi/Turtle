# Game Automations (desktop): plano

Status: **proposta, sem implementação.** Nada aqui vai para produção sem ok escrito do thiago.

A ideia: um painel "Game Automations" no app desktop, ao lado da Discoteca, que traz para dentro do Turtle as automações do cliente do League of Legends que hoje vivem em ferramentas soltas: o [Tiamat](https://github.com/369gabriel/tiamat) (Python/Textual) e o Quacky (Python/Flet, do próprio thiago). Depois, o mesmo painel pode abrigar "alguns jogos" (veja "Jogos" no fim).

Resumo da opinião: **vale fazer, mas só a parte de quebra-galho e com a tela do cliente, e não o pacote inteiro.** As duas ferramentas misturam coisas úteis ao grupo (aceitar partida, fila) com coisas que só servem a quem usa (cosméticos) e coisas que podem dar ban ou irritar o time (revelar lobby, instalock). Recomendo uma v1 pequena e segura.

## 1. Como as duas ferramentas funcionam (todas usam só o LCU local)

Nenhuma lê memória nem injeta nada no jogo. Elas descobrem a porta e o token do cliente (o Tiamat lê a linha de comando do `LeagueClientUx.exe` com `psutil`, as flags `--app-port` e `--remoting-auth-token`, e também `--riotclient-*` para a API do Riot Client) e chamam a API HTTPS local `https://127.0.0.1:<porta>` com basic auth `riot:<token>` (certificado próprio, por isso `verify=False`). As duas consultam o cliente em laços de 0,3 a 0,5 s. O que o Turtle já tem: `apps/desktop/src/games.ts` lê o `lockfile` e consulta `/lol-gameflow/v1/gameflow-phase` e `/lol-gameflow/v1/session` para a rich presence.

## 2. Inventário

Legenda de risco: **baixo** = o cliente aceita o mesmo que um clique seu, sem informação nova; **médio** = automatiza decisão dentro da seleção de campeões ou usa endpoint interno não documentado; **alto** = dá informação que o cliente esconde de propósito ou age de forma destrutiva.

| Função | Tiamat | Quacky | Endpoint LCU (principal) | Valor p/ o grupo | Risco Riot | Esforço | Veredito |
|---|---|---|---|---|---|---|---|
| Aceitar partida | sim | sim | `POST /lol-matchmaking/v1/ready-check/accept` | **alto** (ninguém perde a fila por estar na call) | baixo | pequeno | **v1** |
| Reiniciar UX do cliente | sim | sim | `POST /riotclient/kill-and-restart-ux` | médio (resolve cliente travado) | baixo | trivial | **v1** |
| Fila automática (Ragequeue; "jogar de novo") | sim | não | `POST /lol-lobby/v2/play-again`, `POST /lol-lobby/v2/lobby/matchmaking/search`, criação de lobby por `queueId` | médio | baixo a médio (é só repetir cliques, mas é loop automático) | médio | **v1** (com limite de repetições e só com o cliente aberto) |
| Ficar offline no chat | sim | sim | `POST /chat/v1/suspend` e `/chat/v1/resume` (API do Riot Client) | médio (jogar sem ser chamado) | baixo | pequeno | **v1** |
| Escolher campeão (Instalock, com reserva) | sim | sim | `PATCH /lol-champ-select/v1/session/actions/{id}` | médio, mas pode atrapalhar o time | médio | médio | **v1.5**, opcional e desligado por padrão |
| Banir campeão automático | sim | sim | mesmo endpoint, ação `ban` | médio | médio | pequeno (junto do Instalock) | **v1.5** |
| Esquiva instantânea (Dodge) | sim | sim | `POST /lol-login/v1/session/invoke?destination=lcdsServiceProxy&method=call&args=["","teambuilder-draft","quitV2",""]` | baixo | médio (invoca RPC interno; a penalidade de dodge continua valendo) | pequeno | **fora** |
| Revelar lobby (Lobby Reveal) | sim | sim | `GET /lol-champ-select/v1/session` + `/chat/v5/participants` e abre Porofessor/OP.GG/U.GG | médio | **alto** (mostra nomes que a ranqueada esconde; manda os nomes a sites terceiros) | médio | **fora** |
| Entrar em lobby por código (Camp Auto Joiner) | não | sim (lê a área de transferência) | `POST /lol-lobby/v1/tournaments/{código}/join` | médio | baixo, mas monitorar clipboard é invasivo | pequeno | **v2**, reimaginado (veja abaixo) |
| Trocar ícone de perfil | sim | sim | `PUT /lol-summoner/v1/current-summoner/icon`, `PUT /lol-chat/v1/me` | baixo | médio (o modo "só cliente" mostra ícones que você não tem) | pequeno | **fora** |
| Trocar fundo de perfil | sim | sim | `POST /lol-summoner/v1/current-summoner/summoner-profile` | baixo | médio | pequeno | **fora** |
| Trocar Riot ID | sim | sim | `POST /lol-summoner/v1/save-alias` | baixo (a troca real já existe no cliente) | médio | pequeno | **fora** |
| Emblemas/desafios do perfil | sim | sim | `POST /lol-challenges/v1/update-player-preferences/` | baixo | médio | pequeno | **fora** |
| Mensagem de status | sim | não | `PUT /lol-chat/v1/me` | baixo | baixo | trivial | **v2** (se pedirem) |
| Remover todos os amigos | sim | sim | `DELETE /lol-chat/v1/friends/{pid}` em loop | nenhum | baixo, mas destrutivo e irreversível | pequeno | **fora** |

Observação: Instalock e fila automática dependem também de `GET /lol-game-data/assets/v1/champion-summary.json` e `/lol-champ-select/v1/pickable-champion-ids` para saber o que está disponível.

## 3. Critérios e o que entra

Critérios, nesta ordem: (1) risco de ban e de violar os Termos da Riot; só usamos o LCU local, **nunca memória, injeção, nem informação que o cliente esconde**; (2) valor para o grupo de amigos; (3) esforço; (4) só Windows, só desktop.

**Entra na v1 (baixo risco, útil todo dia):**
1. Aceitar partida automaticamente (com atraso de 0 a 2 s configurável, como no Tiamat).
2. Reiniciar o cliente (UX).
3. Fila automática depois da partida (tipo de fila escolhido, no máximo N repetições, para quando você sai do cliente).
4. Ficar offline no chat (alternar).

**v1.5, atrás de confirmação e desligado por padrão:** escolher campeão (com reserva) e banir campeão. São automações dentro da seleção, mais perto da linha, e o instalock pode irritar o time (a gente joga com amigos, então o aviso na UI basta). Sugiro entregar só depois de a v1 rodar um tempo sem problemas.

**Fora, e eu sugiro não fazer nem como "modo avançado":** revelar lobby, esquiva instantânea via RPC interno, remover todos os amigos e os cosméticos que fingem itens (ícone/fundo/emblemas/Riot ID). O Turtle é open source e distribuído; colocar "revelar lobby" em um instalador público é o tipo de coisa que chama a atenção da Riot para o projeto inteiro, e os cosméticos não ajudam a chamada do grupo.

**Ideia nova, que só o Turtle consegue (v2):** em vez de monitorar a área de transferência, um botão "Chamar para o lobby" que usa o que o Turtle já sabe (quem do servidor está jogando LoL, pela rich presence) e manda um convite do Turtle com o código de lobby/torneio. Quem aceitar entra com o "entrar por código". Isso depende de mapear a conta Turtle com o Riot ID, então precisa de decisão do thiago (pergunta 3).

## 4. Riscos (sem rodeio)

- **O LCU não é uma API pública suportada.** Pelo que sei, a Riot tolera ferramentas locais de conveniência, mas não garante nada, e a política muda. Não consegui verificar a posição atual da Riot daqui; antes da v1 alguém precisa ler a política de desenvolvedores e os Termos do LoL, e eu recomendo que o thiago confirme com a Riot ou aceite o risco por escrito. Se a Riot desligar um endpoint, a função quebra (aceitável: é uma função isolada).
- **Conta do thiago e dos amigos:** o risco cai em quem liga a função, por isso tudo desligado por padrão, aviso na primeira ativação e rótulo de risco por função.
- **Quanto menos automatizar a decisão, menor o risco.** Aceitar partida e reiniciar o cliente são equivalentes a cliques. Pick/ban já é decisão automatizada.
- **Anti-cheat:** nada de ler memória, injetar DLL ou emular entrada. Fica só HTTP para `127.0.0.1`. Se o Vanguard estiver ativo no LoL do grupo, isso não muda nada para o LCU, mas qualquer coisa fora disso é inviável.
- **Instalador sem assinatura** (decisão do thiago de nunca assinar): o Windows SmartScreen já avisa hoje; um app que fala com o cliente do LoL tende a ser sinalizado por antivírus. Quem estiver na dúvida vê o código, é open source.
- **Cliente do LoL fora do padrão** (instalado em outra pasta): o `lockfile` hardcoded do `games.ts` falha. Melhor descobrir pela linha de comando do processo.

## 5. UI (onde fica)

- O botão da Discoteca (globo) aparece no painel de voz, ao lado de "Compartilhar tela", e no painel de voz da chamada. O Game Automations ganha **um botão irmão ao lado** (ícone de controle/joystick no estilo linocut), só visível quando `window.turtleDesktop?.automations` existe (ou seja, só no app desktop novo, no Windows).
- Ele abre um painel (mesmo padrão de painel/modal da Discoteca) com abas: **League of Legends** (lista de funções com interruptor, rótulo de risco, configurações inline, estado "cliente detectado/fechado") e **Jogos** (vazio por enquanto).
- O painel funciona também fora da chamada (aceitar partida precisa disso), então o botão ao lado do disco da voz não basta: o mesmo ícone entra também no `UserPanel`, visível sempre que o desktop é detectado.
- Um selinho de estado discreto (ex.: "Aceitar partida ligado") no painel do usuário para a pessoa nunca esquecer que tem automação ativa.

## 6. Arquitetura

**Onde roda:** no processo principal do Electron, em `apps/desktop/src/lcu/`. O renderer (o site) nunca recebe porta nem token do LCU.

```
apps/desktop/src/lcu/
  client.ts       descobre credenciais (processo do LeagueClientUx; lockfile como reserva), HTTPS local, WebSocket de eventos
  automations.ts  registro das funções: { id, risco, ligada, config, start(), stop() }
  features/       auto-accept.ts, restart-ux.ts, requeue.ts, chat-offline.ts (v1); champ-select.ts (v1.5)
```

- **Cliente único e compartilhado.** Refatora o `local()` e a leitura do lockfile do `games.ts` para `lcu/client.ts`; a rich presence passa a usá-lo (um só lugar que fala com o cliente).
- **Eventos em vez de polling.** O LCU expõe um WebSocket (`wss://127.0.0.1:<porta>`, mesmo basic auth, WAMP, assinar `OnJsonApiEvent`). Aceitar partida e a seleção de campeões reagem a `ready-check` e `champ-select` em tempo real, sem consultar a cada 0,5 s como as ferramentas atuais. Se o socket falhar, cai para consulta a cada 1 s.
- **IPC fechado (allowlist).** Canais `automations:list`, `automations:set` (id, ligada, config), `automations:run` (ações pontuais como reiniciar UX) e `automations:status` (evento para a UI), todos checando `fromApp(event.sender)`. Não existe um "proxy genérico de LCU": cada função chama só os endpoints que ela declara.
- **Preload.** `turtleDesktop.automations = { list, set, run, onStatus }`, opcional no tipo `TurtleDesktop` (`apps/client/src/desktop.ts`), como já é com `shareAudio`.
- **Ativar/desativar por função.** Tudo desligado na primeira execução. Estado e configurações guardados num JSON na pasta de dados do app (não no servidor, não no `localStorage`), para sobreviver a atualizações e valer para qualquer servidor/conta Turtle no mesmo PC. Interruptor geral ("pausar tudo") no topo do painel e no menu da bandeja.
- **Permissões e privacidade.** Confirmação na primeira vez que liga uma função com risco médio. Nada de automação vai para o servidor do Turtle: nem o estado, nem os logs. Log local curto (últimas ações) só para a pessoa ver "aceitou a partida às 21:03".
- **Segurança.** Só `127.0.0.1`; nada de seguir redirecionamento; validar o `queueId` e os ids de campeão contra o que o cliente informa; limite de repetições na fila automática; timeouts de 5 s como no Tiamat.
- **Entrega.** Código de processo principal só chega no instalador: **exige subir a versão do `apps/desktop/package.json` e publicar um instalador novo** (precisa de ok do thiago). O painel (renderer) vai com o deploy normal do site e se esconde sozinho se o desktop é antigo.
- **Testes.** Os módulos recebem o cliente LCU por injeção, então testamos com um servidor LCU falso (HTTP+WebSocket) em Node, no CI. Capturar a tela do cliente real não dá no container da nuvem; o teste com o LoL de verdade é do thiago no PC dele.

## 7. Web e Android

- **Web (navegador):** não mostra nada ativo. O navegador não alcança o LCU local (e não deve). No máximo um texto "disponível no app desktop" dentro do menu, se fizer sentido; sugiro não mostrar nada.
- **Android:** nada. Não há LCU no celular e o app é nativo Kotlin.
- **O que os outros veem:** nada das automações. Continua só a rich presence que já existe (jogo, fase, modo), que já tem opção de privacidade.

## 8. Jogos

O pedido falou "automatização **e alguns jogos**". Esse plano cobre só as automações do LoL. "Jogos" pode ser (a) mini-jogos dentro da chamada (quiz, desenho, etc., sincronizados pelo servidor como a Discoteca e visíveis também no web/Android) ou (b) integração com outros jogos do cliente (ex.: Valorant). São frentes diferentes, com tela e plano próprios; sugiro tratar depois, em outro plano, e deixar a aba "Jogos" reservada.

## 9. Recomendação

1. Fazer a **v1 com 4 funções**: aceitar partida, reiniciar UX, fila automática com limite, ficar offline no chat, mais o painel e a arquitetura acima (inclui refatorar o `games.ts`).
2. Pick/ban automático (**v1.5**) só depois, opcional e desligado.
3. **Não** fazer revelar lobby, esquiva via RPC, remover amigos nem os cosméticos que fingem itens.
4. Entrega em dois PRs: (a) `lcu/client.ts` + refatoração da presence + testes com LCU falso; (b) funções v1 + painel + IPC. Depois, versão nova do instalador.

Esforço aproximado: 3 a 5 dias de trabalho para a v1 (painel incluído), mais 1 a 2 para a v1.5.

## 10. Perguntas para o thiago

1. A v1 de 4 funções está boa, ou você quer algo do "fora" (principalmente revelar lobby)? Eu recomendo que não.
2. Pick/ban automático entra na v1 ou fica para depois (recomendo depois)?
3. Quer a ideia "chamar o grupo para o lobby" (v2)? Ela exige ligar o Riot ID à conta Turtle.
4. "Alguns jogos" são mini-jogos na chamada, outros jogos além do LoL, ou os dois? Quer plano separado?
5. Você aceita o risco com a Riot por escrito (ou prefere que eu primeiro leia a política de desenvolvedores e os Termos do LoL e resuma)?
