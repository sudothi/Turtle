# Turtle para iPhone — prova inicial

React Native/Expo com build nativo próprio, LiveKit e Keychain. Alvo: iOS 26.0 ou posterior. Implementa login/cadastro por convite de conta, restauração de sessão, canais de voz dos servidores existentes, chamada com microfone ou só escuta, participantes, mudo, ensurdecer, saída de áudio do sistema e logout. O convite de cadastro não adiciona a conta a um servidor: entre no servidor pelo web/desktop nesta versão.

## Testar pelo Xcode

Requer Mac com Xcode e SDK de iOS compatíveis, CocoaPods e iPhone com Modo Desenvolvedor ativado. Na raiz:

```sh
pnpm install
pnpm --filter @turtle/protocol build
pnpm ios:device
```

Conecte e desbloqueie o iPhone, aceite confiar no Mac e selecione o dispositivo quando solicitado. O Expo gera `apps/ios/ios`. Se precisar configurar assinatura, abra `apps/ios/ios/Turtle.xcworkspace` no Xcode, selecione o target Turtle em Signing & Capabilities e sua Personal Team (conta Apple gratuita), com assinatura automática. Use um bundle identifier próprio se o padrão não puder ser registrado. Reaplique essa escolha após regenerar o projeto, ou altere `ios.bundleIdentifier` em `app.config.ts`. Execute no dispositivo pelo Xcode ou repita o comando.

O build de desenvolvimento usa Metro no Mac. Para reiniciar Metro, rode `pnpm ios`; computador e telefone precisam se alcançar pela rede. Expo Go não suporta o módulo nativo LiveKit. Para testar sem Metro e com o app instalado pela AltStore, use o IPA Release abaixo.

O endereço padrão é `https://app.ogturtle.xyz`. Na tela de login, **Configurar servidor** permite outra origem HTTPS. Para definir outro padrão no build, copie `.env.example` para `.env.local` nesta pasta e altere `EXPO_PUBLIC_API_ORIGIN`. As variáveis `EXPO_PUBLIC_*` entram no app; use apenas endereços públicos. O LiveKit vem da resposta autenticada do backend. Não há credenciais Apple nem chaves secretas LiveKit no app.

## Testar pela AltStore Classic

```sh
pnpm ios:ipa
```

O script faz prebuild, instala Pods e compila um archive Release sem assinatura, com JavaScript embutido. Empacota `apps/ios/release/Turtle-0.1.0.ipa` para importação e reassinatura pela Classic. Não precisa de login EAS nem servidor Metro. Build number e bundle ID ficam em `app.config.ts`; use uma nova versão/build ao distribuir atualizações. O diretório `ios` é gerado e os artefatos ficam ignorados pelo Git.

Instale AltServer no Mac/Windows e AltStore Classic no iPhone seguindo os guias oficiais abaixo. Cada participante usa sua própria conta Apple gratuita. Transfira o IPA ao iPhone, abra AltStore > My Apps > `+` e selecione-o. Autorize confiança/Modo Desenvolvedor quando solicitado. O fluxo de importação, reassinatura e renovação ainda exige validação no aparelho do grupo.

Contas gratuitas exigem renovação em 7 dias e têm limites de apps/App IDs; confira a disponibilidade na própria AltStore antes de instalar. Mantenha AltServer acessível e renove antes de vencer. Se expirar, reconecte ao AltServer para renovar; não desinstale como primeiro passo. Preservação de sessão após reinstalação, mudança de Team ID/bundle ID ou reassinatura não é garantida. Confira os guias oficiais [macOS](https://faq.altstore.io/altstore-classic/how-to-install-altstore-macos), [Windows](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows), [renovação](https://faq.altstore.io/altstore-classic/your-altstore) e [App IDs](https://faq.altstore.io/altstore-classic/app-ids).

## Roteiro de aceite em aparelho

1. Instale o IPA pela Classic. Entre com uma conta do Turtle e abra web/desktop com **outra conta**: a mesma identidade LiveKit derruba a chamada anterior.
2. Confira senha inválida, cadastro com convite inválido/válido, relançamento restaurando sessão e falta de rede preservando o token. Para entrar num servidor novo, use web/desktop e depois **Atualizar canais** no iPhone.
3. Entre no mesmo canal de voz nos dois clientes. Teste **Só ouvir**, microfone permitido/negado, mudo, ensurdecer, participantes e saída via alto-falante/fones/Bluetooth. Retomar escuta não deve reabrir o microfone.
4. No IPA Release, converse por 30 minutos com tela bloqueada e troque de apps. Teste também com microfone fechado, só escuta e períodos de silêncio: esses casos podem ter limites diferentes de execução em segundo plano.
5. Faça Wi-Fi → celular, modo avião → reconexão e interrupção por ligação/Siri. Confira áudio e presença dos dois lados ao retornar. Saia da chamada e da conta e verifique que o microfone parou.
6. Renove e atualize pela mesma identidade de assinatura. Registre modelo, iOS, versão/build, método de instalação, tempo de chamada, comportamento, bateria e temperatura, sem incluir tokens, senhas ou URLs autenticadas do gateway.

## Limites desta prova

Áudio usa WebRTC nativo e `UIBackgroundModes: audio`. A integração do SDK configura AVAudioSession nativamente. A presença ainda usa o gateway existente: é reenviada após reconexão/retorno, mas o backend a remove quando o WebSocket cai. Continuidade de presença/voz em todos os casos de suspensão exige a #54 e validação real. Não há CallKit/PushKit, push, chamadas recebidas, chat, DMs na interface, câmera ou transmissão de tela nesta prova. O processo encerrado não continua a chamada. TURN/conectividade de redes restritas continua relacionado à #14.

Testes de unidade e build não comprovam áudio, permissões, entitlements ou duração em tela bloqueada. O aceite da #46 depende da instalação final em iPhone real; mantenha resultados não executados como pendentes.
