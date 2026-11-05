# Turtle para Android

O app Android é uma casca (Capacitor) que abre o Turtle de `https://app.ogturtle.xyz` dentro de um WebView
e acrescenta o que o navegador não faz sozinho: um **serviço em primeiro plano** que mantém a chamada
viva com a tela bloqueada. Como a interface vem do servidor, **atualizar o site atualiza o app**; só é
preciso gerar um APK novo quando muda a parte nativa (esta pasta).

## Instalar para testar

1. No GitHub, abra **Actions → Android (APK)** e escolha a execução mais recente (ou clique em
   *Run workflow* para gerar uma nova).
2. Em **Artifacts**, baixe `turtle-android` (um zip com `turtle.apk`) e passe o `turtle.apk` para o celular.
3. No celular, abra o arquivo. O Android vai pedir para permitir a instalação de apps desta origem
   (*fontes desconhecidas*); autorize só para o app que você usou para abrir o arquivo.
4. Na primeira chamada, aceite as permissões de microfone, câmera e notificações.

## O que já funciona / o que falta

- Funciona: tudo da versão web em layout de celular, chamadas, ver tela compartilhada, conversas, chamada
  continua com a tela bloqueada (notificação "Na chamada").
- Ainda não: **compartilhar a tela do celular** (o WebView não oferece; é a etapa 6) e notificações push (etapa 7).
- Sem internet: aparece a página "Sem conexão" com botão para tentar de novo.

## Chave de assinatura (para o app poder ser atualizado por cima)

O Android só atualiza um app se o novo APK for assinado com a **mesma chave** do instalado. Sem configurar
nada, o CI assina com a chave de debug (serve para testar, mas cada ambiente pode ter uma diferente).
Para uma chave fixa, crie uma vez:

```bash
keytool -genkeypair -v -keystore turtle.jks -alias turtle -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 turtle.jks   # copie a saída
```

Em **Settings → Secrets and variables → Actions** do repositório, crie:

| Segredo | Valor |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | saída do `base64` acima |
| `ANDROID_KEYSTORE_PASSWORD` | senha do keystore |
| `ANDROID_KEY_ALIAS` | `turtle` |
| `ANDROID_KEY_PASSWORD` | senha da chave |

Guarde o `turtle.jks` e as senhas em lugar seguro (nunca no repositório): perder a chave obriga a
desinstalar o app e instalar de novo.

## Desenvolvimento

Precisa de JDK 21 e Android SDK (o CI já tem). Na pasta do repositório:

```bash
pnpm install
pnpm --filter @turtle/mobile sync     # cap sync android
pnpm --filter @turtle/mobile apk      # gera android/app/build/outputs/apk/release/*.apk
pnpm --filter @turtle/mobile icones   # regera os ícones a partir de assets/turtle-mark-paper.svg
```

Plugin nativo: `android/app/src/main/java/xyz/ogturtle/app/` (`TurtleCallPlugin` + `CallService`). O site
o chama por `window.Capacitor.Plugins.TurtleCall` (ver `apps/client/src/native.ts`).
