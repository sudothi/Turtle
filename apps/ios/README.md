# Turtle para iPhone

React Native/Expo com build nativo próprio, LiveKit e Keychain. Alvo: iOS 26.0 ou posterior. A versão 0.4 acrescenta social, servidores/administração, perfil com imagens, câmera e recepção de telas ao chat e à voz nativos. O convite de cadastro não adiciona a conta a um servidor: use o botão + para entrar com um convite de servidor.

## Navegação e escopo

- **Barra de servidores:** tartaruga para mensagens diretas e ícones dos servidores, como na web/desktop e no Android. Selecionar um servidor atualiza a lista lateral de canais de texto/voz. O cabeçalho do servidor abre membros, opções de administração e atualização dos canais.
- **Mensagens diretas:** entrada para Amigos e lista de conversas existentes. Amigos tem filtros Online/Todos/Pendentes e busca por nome/usuário. Abrir um canal ou conversa mostra o histórico; voltar pelo botão ou gesto retorna à mesma seleção lateral.
- **Barra de perfil:** flutua na base sobre as duas colunas, com avatar, nome e presença/estado de voz. Tocar no perfil abre um painel inferior com configurações e controles da chamada ativa. O atalho à direita abre configurações ou a chamada. Configurações inclui conta, origem do servidor, áudio e saída da conta com confirmação.
- **Chamada:** modal com grade de participantes e controles de microfone, escuta, saída de áudio e desconexão. Fechar o modal mantém a chamada; a barra de voz no rodapé permite voltar a ela nas outras telas, inclusive membros e configurações.

A interface usa as mesmas cores tinta/papel, famílias Figtree/Bricolage Grotesque e desenhos vetoriais da web. Listas e categorias seguem a organização existente, com alvos de toque de pelo menos 44 pt no iPhone.

O chat de canal, DM e grupo compartilha um compositor acima do teclado, sugestões ao digitar `@` e mensagens em tempo real. O histórico carrega páginas antigas ao chegar ao início, preservando o trecho visível; novas mensagens oferecem um atalho quando você está lendo as antigas. A chamada é mantida pelo workspace autenticado, acima das rotas; trocar telas não recria Voice/Gateway.

Os rascunhos e textos pendentes são salvos no iPhone, separados por origem, conta e conversa; logout os remove. O texto do compositor passa a uma mensagem pendente **Enviando…**; a requisição só é enviada depois de salvar essa tentativa no iPhone. A confirmação HTTP ou o evento do gateway mostra a mensagem persistida uma única vez. Falhas deixam o texto visível como **Não enviada** ou **Envio sem confirmação**. **Tentar novamente** reaproveita a mesma identificação; não há reenvio automático ao reconectar ou reabrir o app. Mensagens definitivamente recusadas também podem voltar ao rascunho quando ele está vazio.

O backend desta entrega precisa estar atualizado antes do app: `POST /channels/:id/messages` confirma texto com um `requestId` UUID. A tabela `message_receipts`, criada pela migração idempotente de inicialização, impede duplicação e reenvio de mensagens já apagadas; guarda a impressão digital do conteúdo, sem manter seu texto após exclusão. O envio WebSocket antigo continua compatível. A paginação aceita `before`, `limit` e o novo desempate `beforeId`. Envio de anexos e ações de edição/exclusão continuam fora deste compositor. Social, servidores/administração e perfil têm telas nativas na versão 0.4.

## Testar pelo Xcode

Requer Mac com Xcode e SDK de iOS compatíveis, CocoaPods e iPhone com Modo Desenvolvedor ativado. Na raiz:

```sh
pnpm install
pnpm --filter @turtle/protocol build
pnpm ios:device
```

Conecte e desbloqueie o iPhone, aceite confiar no Mac e selecione o dispositivo quando solicitado. O Expo gera `apps/ios/ios`. Se precisar configurar assinatura, abra `apps/ios/ios/Turtle.xcworkspace` no Xcode, selecione o target Turtle em Signing & Capabilities e sua Personal Team (conta Apple gratuita), com assinatura automática. Use um bundle identifier próprio se o padrão não puder ser registrado. Reaplique essa escolha após regenerar o projeto, ou altere `ios.bundleIdentifier` em `app.config.ts`. Execute no dispositivo pelo Xcode ou repita o comando.

O build de desenvolvimento usa Metro no Mac. Para reiniciar Metro, rode `pnpm ios`; computador e telefone precisam se alcançar pela rede. Expo Go não suporta o módulo nativo LiveKit. Para testar sem Metro e com o app instalado pela AltStore, use o IPA Release abaixo.

Ao atualizar para 0.4, execute `pnpm ios:device` novamente: armazenamento, criptografia e seleção/recorte de imagens incluem módulos nativos. Só reiniciar o Metro não instala esses módulos no app antigo. Ao usar `pnpm ios`, o simulador selecionado deve já conter o build de desenvolvimento.

O endereço padrão é `https://app.ogturtle.xyz`. Na tela de login, **Configurar servidor** permite outra origem HTTPS. Para definir outro padrão no build, copie `.env.example` para `.env.local` nesta pasta e altere `EXPO_PUBLIC_API_ORIGIN`. As variáveis `EXPO_PUBLIC_*` entram no app; use apenas endereços públicos. O LiveKit vem da resposta autenticada do backend. Não há credenciais Apple nem chaves secretas LiveKit no app.

## Testar pela AltStore Classic

```sh
pnpm ios:ipa
```

O script faz prebuild, instala Pods e compila um archive Release sem assinatura, com JavaScript embutido. Empacota `apps/ios/release/Turtle-0.4.0-build5.ipa` para importação e reassinatura pela Classic. Não precisa de login EAS nem servidor Metro. A versão vem de `package.json`; o build number vem de `package.json` e o bundle ID de `app.config.ts`. Use uma nova versão/build ao distribuir atualizações. O diretório `ios` é gerado e os artefatos ficam ignorados pelo Git.

Instale AltServer no Mac/Windows e AltStore Classic no iPhone seguindo os guias oficiais abaixo. Cada participante usa sua própria conta Apple gratuita. Transfira o IPA ao iPhone, abra AltStore > My Apps > `+` e selecione-o. Autorize confiança/Modo Desenvolvedor quando solicitado. O fluxo de importação, reassinatura e renovação ainda exige validação no aparelho do grupo.

Contas gratuitas exigem renovação em 7 dias e têm limites de apps/App IDs; confira a disponibilidade na própria AltStore antes de instalar. Mantenha AltServer acessível e renove antes de vencer. Se expirar, reconecte ao AltServer para renovar; não desinstale como primeiro passo. Preservação de sessão após reinstalação, mudança de Team ID/bundle ID ou reassinatura não é garantida. Confira os guias oficiais [macOS](https://faq.altstore.io/altstore-classic/how-to-install-altstore-macos), [Windows](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows), [renovação](https://faq.altstore.io/altstore-classic/your-altstore) e [App IDs](https://faq.altstore.io/altstore-classic/app-ids).

## Roteiro de aceite em aparelho

1. Instale o IPA pela Classic. Entre com uma conta do Turtle e abra web/desktop com **outra conta**: a mesma identidade LiveKit derruba a chamada anterior.
2. Confira senha inválida, cadastro com convite inválido/válido, relançamento restaurando sessão e falta de rede preservando o token. Para entrar num servidor novo, use o botão + na barra de servidores e confira o convite antes de entrar.
3. Entre no mesmo canal de voz nos dois clientes. Teste **Só ouvir**, microfone permitido/negado, mudo, ensurdecer, participantes e saída via alto-falante/fones/Bluetooth. Retomar escuta não deve reabrir o microfone.
4. No IPA Release, converse por 30 minutos com tela bloqueada e troque de apps. Teste também com microfone fechado, só escuta e períodos de silêncio: esses casos podem ter limites diferentes de execução em segundo plano.
5. Faça Wi-Fi → celular, modo avião → reconexão e interrupção por ligação/Siri. Confira áudio e presença dos dois lados ao retornar. Saia da chamada e da conta e verifique que o microfone parou.
6. Renove e atualize pela mesma identidade de assinatura. Registre modelo, iOS, versão/build, método de instalação, tempo de chamada, comportamento, bateria e temperatura, sem incluir tokens, senhas ou URLs autenticadas do gateway.

Para a navegação da #48, validar também:

1. Compare com web/desktop: barra vertical de servidores, mensagens diretas, categorias de canais, seleção, tipografia e painel do usuário. Alterne servidores, abra canais/conversas e volte por botão/gesto, mantendo a seleção lateral.
2. Durante uma chamada, abrir outra conversa e outro servidor, membros e configurações; retornar pela barra. Confirmar que áudio e mudo permanecem iguais e que o microfone não reabre ao voltar de ensurdecer.
3. Tocar no cabeçalho do servidor, cancelar a ação e abrir/fechar membros. Abrir o painel pelo perfil, fechar pelo botão/fundo, acessar configurações e cancelar logout. Durante a chamada, testar os controles no painel e abrir a tela de áudio. Fechar o painel mantém a chamada.
4. Girar retrato/paisagem, buscar com teclado aberto e aumentar o tamanho de texto no iOS. Conferir controles e conteúdo sem rolagem horizontal; a barra flutuante deve respeitar a área inferior e o último item das duas listas deve continuar alcançável por rolagem. O painel de perfil deve permitir rolar suas ações.
5. Com VoiceOver, conferir nomes e seleção dos servidores/canais, categorias recolhíveis, filtros de amigos, campos de busca, ícones de ação, participantes e retorno dos modais. Não marcar VoiceOver como validado apenas por presença de rótulos no código.
6. Usar sem rede e tentar novamente. Ao perder acesso a conversa/servidor, o conteúdo inacessível deve ser removido e deve aparecer um erro compreensível.

## Aceite do chat (#49)

1. Com o backend atualizado, enviar texto em canal, DM e grupo. Conferir no segundo cliente uma única mensagem por envio, inclusive com dois toques rápidos e retentativa após queda da conexão.
2. Digitar `@`, escolher uma pessoa por toque e conferir o nome de exibição nos dois clientes. Editar/remover uma menção selecionada e testar nomes iguais, nomes com espaços e texto com 4000/4001 caracteres após codificação das menções.
3. Escrever rascunhos em duas conversas; alternar telas e relançar o app. Confirmar isolamento entre contas e remoção dos dados ao sair. Um envio sem confirmação restaurado não deve ser reenviado sozinho.
4. Rolar por mais de 50 mensagens; carregar outra página sem perder a posição. Receber mensagens enquanto lê as antigas, conferir o atalho de novas mensagens e voltar ao fim por toque.
5. Modo avião durante a escrita/envio, retorno à rede e mais de uma página recebida durante a desconexão. Conferir texto preservado, histórico sem lacunas/duplicação e recuperação de edições/exclusões de outro cliente.
6. Teclado aberto em retrato/paisagem, texto ampliado, VoiceOver e chamada ativa: compositor, sugestões, botões e barra de voz devem permanecer acessíveis. Registrar a validação no menor iPhone suportado; testes de unidade não comprovam posição visual ou foco do teclado.

## Limites da versão

Áudio usa WebRTC nativo e `UIBackgroundModes: audio`. A integração do SDK configura AVAudioSession nativamente. A presença ainda usa o gateway existente: é reenviada após reconexão/retorno, mas o backend a remove quando o WebSocket cai. Continuidade de presença/voz em todos os casos de suspensão exige a #54 e validação real. Não há CallKit/PushKit, push nem publicação da tela do iPhone nesta versão. Há câmera, recepção de telas e cartão de chamada recebida com o app ativo. O processo encerrado não continua a chamada. TURN/conectividade de redes restritas continua relacionado à #14.

Testes de unidade e build não comprovam áudio, permissões, entitlements ou duração em tela bloqueada. O aceite da #46 depende da instalação final em iPhone real; mantenha resultados não executados como pendentes.


## Paridade e distribuição da versão 0.4

O [guia iOS](../../docs/planos/ios.md) registra decisão de stack, iOS mínimo, matriz de capacidades, notas de distribuição, limites de push/tela e o roteiro completo de aceite físico das issues #45–#59. O IPA traz checksum e manifesto ao lado do arquivo. Atualize o build nativo para instalar os módulos de seleção/recorte de imagem; reiniciar Metro não basta.

Social, servidores, perfil e chamadas usam os mesmos tokens e fontes da navegação aprovada. Configurações dá acesso a perfil, bloqueados e administração (quando permitida). O botão + abre criação/entrada em servidor. Perfis de amigos/membros abrem DMs e ações sociais; conversas têm participantes/grupos e entrada para chamada.
