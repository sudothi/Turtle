# iOS: decisão de plataforma, distribuição e aceite

Atualizado em 06/11/2026. Complementa as issues #45–#59; o estado de implementação fica nas PRs e o aceite físico nas issues. Código compilado não significa cenário aprovado em aparelho.

## Decisão de plataforma (#46/#47)

O Turtle para iPhone usa React Native/Expo com LiveKit/WebRTC **nativos**, sem WebView. Protocolo e validações vêm de `@turtle/protocol`; sessão fica no Keychain via SecureStore. A interface reproduz os papéis de cor de `packages/ui/src/tokens.css`, as fontes Figtree/Bricolage Grotesque, os ícones linocut e a organização de servidores/canais do desktop. Gestos e alvos de toque são adaptados ao iPhone.

| Alternativa | Manutenção e reaproveitamento | Chamadas e ciclo de vida | Decisão |
| --- | --- | --- | --- |
| React Native + LiveKit nativo | Compartilha TypeScript/protocolo; componentes nativos próprios | SDK nativo, AVAudioSession; ainda exige teste físico | Adotado na #73; mantido nas frentes seguintes |
| Swift/SwiftUI + LiveKit Swift | Cliente novo, contratos e estado reimplementados | Acesso direto ao SDK e às APIs do iOS | Viável, mas exigiria reescrever o cliente atual |
| Shell iOS com React web | Reutiliza mais interface web | WebView não comprova continuidade de áudio em suspensão nem captura | Não adotado |

O deployment target configurado é **iOS 26.0**. O mínimo é o do projeto gerado e do IPA, não uma promessa de suporte a versões anteriores. A compilação em simulador iOS 27 foi exercitada; a matriz física precisa incluir iOS 26 e outro aparelho/versão do grupo, quando disponíveis. O menor iPhone real aceito ainda precisa ser identificado na #59.

## Escopo da versão 0.4.0, build 4

- Autenticação por convite, restauração de sessão, navegação nativa e chat confirmado da #113.
- Amigos, pedidos, DMs/grupos, bloqueios e perfis públicos; leitura e não lidas no backend.
- Servidores/canais, papéis, convites de servidor, administração de contas e convites de conta.
- Edição de perfil, seleção nativa de imagens, recorte por toque/zoom e upload de avatar/banner.
- Voz, saída de áudio do sistema, volumes por pessoa, reconexão, câmera/troca de câmera, grade/foco e recepção de tela/áudio sob demanda.
- Atividade recebida (jogo/fase e chamada atual) e cartão de chamada recebida enquanto o app está ativo.

A migração de mensagens confirmadas da #113 precisa estar no backend antes de usar os envios HTTP. Nenhum deploy é feito pela criação do IPA ou merge de PR.

## Assinatura e capacidades (#46/#56/#57)

Hipótese de distribuição: **AltStore Classic**, cada amigo usando sua própria conta Apple e AltServer. PAL é outro modelo e não foi validado para este grupo; não substituir automaticamente Classic por PAL. Uma conta paga pode habilitar outros recursos, mas não faz parte do requisito do núcleo inicial.

| Capacidade | Evidência no cliente/na documentação | Decisão do build atual | Validação que falta |
| --- | --- | --- | --- |
| Keychain privado | SecureStore; sem grupo compartilhado configurado | Armazena só a sessão | Restauração após atualização/renovação e comportamento após troca de assinatura |
| Áudio em segundo plano | WebRTC nativo + `UIBackgroundModes: audio` | Habilitado; não garante execução de JS sem limite | 30 minutos com bloqueio, silêncio, só escuta e interrupções |
| APNs | A tabela da Apple não disponibiliza push na coluna de conta gratuita | Sem entitlement, tokens ou backend de push | Perfil final, caso o grupo escolha assinatura compatível |
| PushKit/CallKit | Não instalados/configurados | Sem chamada de sistema ou despertar remoto | Projeto específico após definição de assinatura e sinalização |
| Associated Domains | Capacidade depende de associação e perfil | Sem Universal Links; colar código/link é o caminho suportado | Domínio/perfil final, se desejado |
| App Groups | A tabela da Apple lista suporte, inclusive na coluna Apple Developer | Nenhum grupo é solicitado por este app | Remapeamento efetivo pela AltStore e perfil reassinado, antes de depender dele |
| Broadcast Extension | O SDK React Native instalado documenta extensão de broadcast + integração nativa | Ausente; não consome App ID adicional | Prova de extensão/grupo/assinatura e interoperabilidade antes de publicar tela |

**Distinção:** um archive sem assinatura não tem provisioning profile final. A tabela da Apple descreve possibilidades da conta; não comprova que um entitlement sobrevive à reassinatura de um IPA. Não declarar capacidade aprovada sem inspecionar o app efetivamente instalado.

### Notificações (#56)

No caminho gratuito adotado como hipótese, não implementar infraestrutura APNs nem pedir permissão de notificações sem um mecanismo de entrega disponível. O gateway fornece sinalização de chamadas com o app ativo: cartão Atender/Recusar, expiração e cancelamento. Não há toque sonoro ou notificação do sistema nesta entrega. Mensagens e não lidas são recuperadas ao abrir/retomar. App suspenso/encerrado não tem garantia de alerta.

Se a assinatura mudar, a próxima frente precisa comprovar o perfil final antes de cadastrar tokens; prever remoção no logout, preferências/prévias, deduplicação, bloqueios, permissões da conversa e abertura da rota correta. PushKit não é um mecanismo genérico para manter o processo executando.

### Compartilhar a tela do iPhone (#57)

Assistir à tela do desktop já tem fluxo próprio. Publicar a tela inteira do iPhone exige a extensão de broadcast descrita pelo SDK React Native, além de comunicação com o app e validação de App Group/assinatura. A documentação Swift diferencia captura do próprio app e broadcast; ela não substitui a integração exigida pela versão React Native instalada.

Sem prova da extensão após reassinatura, a versão atual **não oferece botão de publicar tela**. Configurações explica a limitação e mantém recepção de telas. Isso não prova inviabilidade da plataforma: evita incluir uma extensão não validada e consumir App IDs do grupo. Uma continuação da #57 deve testar início/fim pelo sistema, troca de app/bloqueio, áudio sem duplicar microfone, conteúdo protegido, encerramento e bateria/temperatura.

## Build e entrega (#58)

Em macOS com Xcode/SDK compatíveis e CocoaPods, após `pnpm install`:

```sh
pnpm ios:ipa
```

O script gera o projeto nativo a partir da configuração versionada, instala Pods, faz archive Release sem assinatura, inclui JavaScript e empacota o IPA. A versão e o build vêm de `apps/ios/package.json`; `app.config.ts` usa os mesmos valores. Saídas:

- `apps/ios/release/Turtle-0.4.0-build4.ipa`
- `apps/ios/release/Turtle-0.4.0-build4.ipa.sha256`
- `apps/ios/release/Turtle-0.4.0-build4.ipa.json`

O manifesto registra versão, build, bundle ID, iOS mínimo, commit e SHA-256. O script confere a versão do archive e a presença das descrições de câmera/microfone. Artefatos e o projeto gerado são ignorados pelo Git. O IPA é **para importar e reassinar**, não uma distribuição já assinada. Compartilhar o IPA e o checksum juntos pelo canal privado do grupo; não criar release pública nem source AltStore antes do aceite de instalação manual. Não há workflow automático de publicação.

Para conferir a transferência, rode na pasta do IPA:

```sh
shasum -a 256 -c Turtle-0.4.0-build4.ipa.sha256
```

Instalação: AltServer no computador, AltStore Classic no iPhone, importar o IPA em My Apps > + e seguir os pedidos de confiança/Modo Desenvolvedor. Cada participante usa a própria conta. No modelo gratuito, a documentação Classic informa renovação em sete dias, três apps ativos (AltStore ocupa uma vaga) e até dez App IDs registrados simultaneamente. Extensões usam App IDs adicionais. Conferir os limites que a instalação final mostrar.

Atualizar/renovar pela mesma identidade e bundle ID. Se expirar, tentar renovar com AltServer antes de desinstalar. Testar sessão/preferências na atualização por cima e ao voltar a uma versão compatível; troca de Team ID/bundle ID ou reinstalação pode perder dados/Keychain. Não garantir persistência nesses casos. Nunca compartilhar Apple IDs, tokens de sessão ou segredos LiveKit em notas de versão.

## Aceite físico e evidências (#59)

Use o IPA importado pelo mesmo caminho dos amigos e outra conta no web/desktop. A mesma identidade LiveKit em dois aparelhos encerra a conexão anterior.

| Área | Cenários | Estado nesta entrega |
| --- | --- | --- |
| Automação | Typecheck/testes do monorepo, export JS, build nativo Release | Conferidos; resultados específicos nas PRs |
| Visual | Telas reais com dados locais no simulador | Evidências locais; não substituem testes de interação |
| Instalação | Instalação limpa, atualização, renovação, expiração e rollback compatível | Pendente em instalação Classic real |
| Conta/social | Convite/login, pedidos, DM nova, grupo/limite, bloqueio nos dois sentidos | Backend/testes de contrato; interação cruzada física pendente |
| Servidores | Dois próprios, cargos, expulsão, convite de conta versus servidor, transferência e exclusão | Fluxos implementados; exercício físico pendente |
| Perfil | Edição, HEIC/EXIF, seletor negado/cancelado, gesto de recorte e remoção entre clientes | Geometria testada; seletor/gestos/captura física pendentes |
| Chat | Teclado, paginação, rascunhos, falhas ambíguas e retomada após mais de 50 mensagens | Estado/contratos testados; teclado/rolagem/VoiceOver físicos pendentes |
| Voz | 30 min bloqueado, escuta/silêncio, Bluetooth, Siri/ligação e sair/logout | Lógica testada; áudio e duração físicos pendentes |
| Rede | Wi-Fi/celular, modo avião, backend reiniciado, TURN/rede restrita | Recuperação testada; redes físicas pendentes |
| Vídeo/tela | Permissão, troca de câmera, orientação, foco, tela/áudio e ensurdecer | Política de assinaturas/volumes testada; mídia física pendente |
| Acessibilidade | Texto ampliado, VoiceOver, foco, teclado e safe areas | Rótulos/alvos implementados; aceite físico pendente |

Registrar por cenário: versão/build/commit do app, versão do backend, iPhone/iOS, assinatura/método de instalação, duração, resultado, bateria/temperatura e reprodução de falhas. Não incluir tokens, senhas ou URLs autenticadas. Resultados não executados continuam pendentes. As issues existentes #46/#54/#55/#56/#57/#58/#59 concentram esses pontos; não criar duplicatas.

O servidor continua usando o gateway como fonte da verdade de voz e remove a presença quando o socket fecha. O cliente reenvia seu estado ao reconectar, mas a continuidade de presença durante suspensão ainda depende de validação e pode exigir trabalho de backend na #54. TURN e backups mantêm seu escopo nas issues próprias.

## Fontes verificadas em 06/11/2026

- [Apple: capacidades iOS por tipo de conta](https://developer.apple.com/help/account/reference/supported-capabilities-ios/).
- [AltStore Classic: renovação e apps ativos](https://faq.altstore.io/altstore-classic/your-altstore).
- [AltStore Classic: App IDs e extensões](https://faq.altstore.io/altstore-classic/app-ids).
- [LiveKit: captura do próprio app e broadcast no SDK Swift](https://docs.livekit.io/transport/media/screenshare/).
- [LiveKit React Native: integração iOS de screen sharing](https://github.com/livekit/client-sdk-react-native#ios-2) (confirmada também no README da versão 3.1.0 instalada).
- [Expo ImagePicker](https://docs.expo.dev/versions/latest/sdk/imagepicker/) e [ImageManipulator](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/).


### Registro local de revisão visual (06/11)

Build Release no simulador iPhone 16e, iOS 26.1, com uma cópia do app sob bundle ID de QA e dados artificiais locais. A cópia não usa contas nem serviços de produção. Amigos, perfil público, edição de perfil, servidor, conversa e chamada foram renderizados. Foram conferidos os papéis de cor, fontes, hierarquia e acesso aos controles da chamada no enquadramento capturado. O cartão de chamada recebida foi ajustado para respeitar também a safe area superior.

As capturas e o harness ficam em `.local/ios/qa/`, ignorados pelo Git. Algumas capturas da sequência automática pegaram transições de rota; o enquadramento de chamada foi repetido com a rota fixa. Isso não foi considerado teste de toques, permissões, teclado, texto ampliado, VoiceOver, mídia ou navegação real. Esses cenários permanecem na #59.


A conferência do primeiro archive 0.4 detectou ausência das descrições de câmera/microfone: `cameraPermission: false`/`microphonePermission: false` do plugin ImagePicker removiam chaves também utilizadas pelo WebRTC. A configuração foi corrigida para preservar descrições explícitas em todos os plugins. O empacotamento agora valida essas chaves antes de criar o IPA; o archive inicial não foi considerado uma entrega válida.
