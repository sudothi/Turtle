# Turtle para Android (nativo)

App Android **nativo** (Kotlin + Jetpack Compose), sem WebView. Toda a interface, o visual e o comportamento
estão neste app; o servidor (`https://app.ogturtle.xyz`) é usado só para dados: login, mensagens, voz e arquivos.
O visual segue o do site (preto e branco, estilo linogravura), com a barra lateral como gaveta: arraste da
borda esquerda para abrir; arraste para o lado, toque fora ou use "voltar" para fechar.

> O app anterior baseado em WebView continua em `apps/mobile` até este cobrir tudo.

## Instalar para testar

1. No GitHub, abra **Actions → Android nativo (APK)**, escolha a execução mais recente (ou *Run workflow*).
2. Em **Artifacts**, baixe `turtle-android-nativo` (zip com `turtle-nativo.apk`) e passe o APK para o celular.
3. Abra o APK no celular e permita a instalação de fontes desconhecidas para o app que você usou para abrir.

## Estado

- Pronto: login e criação de conta com convite, gaveta com servidores, canais, conversas e amigos, não lidas.
- Também: chat e DMs em tempo real (WebSocket).
- Próximas etapas: chamadas de voz/câmera/ver telas (LiveKit), compartilhar tela, notificações.

## Chave de assinatura

O Android só atualiza um app com APK assinado pela **mesma chave**. Sem configurar nada, o CI assina com a chave de
debug (serve para testar). Para chave fixa, crie uma vez:

```bash
keytool -genkeypair -v -keystore turtle.jks -alias turtle -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 turtle.jks
```

Em **Settings → Secrets and variables → Actions** crie `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` (`turtle`) e `ANDROID_KEY_PASSWORD`. Guarde o `turtle.jks` e as senhas fora do repositório.

## Desenvolvimento

Precisa de JDK 17+ e Android SDK (ou Android Studio: abra a pasta `apps/android`).

```bash
cd apps/android
./gradlew testDebugUnitTest      # testes
./gradlew assembleRelease        # APK em app/build/outputs/apk/release/
./gradlew assembleRelease -PserverUrl=http://10.0.2.2:3000   # apontar para outro servidor
```

Código: `app/src/main/java/xyz/ogturtle/turtle` — `data/` (modelos e API, espelham `packages/protocol`),
`ui/` (telas e tema), `AppViewModel.kt` (estado).
