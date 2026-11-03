# Marco 3: tela e câmera (plano)

Câmera e compartilhamento de tela ou janela (com áudio do sistema no Windows) na mesma chamada LiveKit da voz. No servidor muda só a permissão do token e o estado da chamada.

Pronto quando: jogo em 1080p30 por 30 min com CPU do emissor abaixo de 25% e atraso abaixo de 300 ms.

## Qualidade

Tela em H.264 (encoder de hardware no Windows: NVENC, QuickSync ou AMF), uma camada por tela, sem simulcast.

| Perfil | Resolução | Taxa máx. | Bitrate máx. | Prioriza |
| --- | --- | --- | --- | --- |
| 1080p30 (padrão) | 1920×1080 | 30 fps | 6 Mb/s | nitidez |
| 720p60 | 1280×720 | 60 fps | 4 Mb/s | fluidez |
| 1080p60 | 1920×1080 | 60 fps | 9 Mb/s | fluidez |
| Câmera | 1280×720 | 30 fps | 1,7 Mb/s (simulcast 3 camadas) | — |

- Áudio da tela: Opus estéreo 128 kb/s, sem cancelamento de eco nem supressão de ruído.
- Pior caso no servidor (2 telas 1080p60, 5 pessoas assistindo): cerca de 90 Mb/s de saída.

## Como vai funcionar

- Servidor: token libera câmera, tela e áudio da tela; estado de voz ganha `camera` e `screen`.
- Cliente: câmera e transmissão no VoiceClient, perfis, volume separado de voz e de transmissão, ensurdecer cala os dois, dynacast/adaptiveStream pausam vídeo fora da tela.
- Desktop (Electron, Windows): seletor próprio (`setDisplayMediaRequestHandler` + `desktopCapturer`), áudio do sistema por loopback, preload com contextIsolation e sandbox, script de dev, `onlyBuiltDependencies` para o pnpm baixar o Electron, atalho para `webrtc-internals`.

## Interface

Botões Câmera e Transmitir no bloco "Voz conectada" (seta escolhe perfil e áudio do computador); grade com cartão por pessoa e por transmissão; foco ao clicar; tela cheia; AO VIVO na barra lateral; prévia própria com resolução, fps e encoder; câmera e perfil padrão nas configurações.

## Riscos

| Risco | Mitigação | Teste |
| --- | --- | --- |
| Eco da chamada no áudio da tela (loopback captura tudo) | `restrictOwnAudio`; se não funcionar no Electron, áudio do computador começa desligado | amigo diz se se ouve |
| Encoder por software | H.264 preferindo hardware, encoder visível no cartão | MediaFoundation no webrtc-internals, CPU < 25% |
| Jogo em tela cheia exclusiva fica preto | capturar janela ou usar janela sem bordas | 2 ou 3 jogos do grupo |
| Banda do servidor | uma camada por tela, pausa fora da tela | 2 telas 1080p60 com 4+ pessoas |

## Ordem

1. Servidor (token e estado) com testes.
2. VoiceClient: câmera, transmissão, perfis, volumes.
3. Interface.
4. Desktop: preload, seletor, áudio do sistema, dev, diagnóstico.
5. Teste ponta a ponta no navegador e PR; depois teste no Windows com jogo.

## Decisões em aberto

- [ ] Perfil padrão 1080p30 ou 1080p60?
- [ ] Áudio do computador começa ligado ou desligado?
- [ ] Assistir transmissão automático ou com botão "Assistir"?
