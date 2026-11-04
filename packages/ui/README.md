# @turtle/ui

Design system do Turtle: layout do Discord, só tinta e papel, com cara de gravura em linóleo.

## Uso
```tsx
import "@turtle/ui/styles.css";            // tokens + base + componentes (uma vez, na raiz)
import { LinoDefs, Button, TextField, Avatar, Modal, Icon, IconButton, TurtleLogo, TurtleMark } from "@turtle/ui";

<LinoDefs />                               // filtros SVG do efeito linocut (uma vez, na raiz)
```
O pacote exporta o código-fonte (sem build): o Vite do client compila direto.

## Tokens (`src/tokens.css`)
- Tinta: `--ink-0` (#000, barra de servidores) até `--ink-5`. Papel: `--paper` (#f5f3ee). Texto: `--text`, `--text-muted`, `--text-faint`.
- Superfícies: `--bg-rail`, `--bg-sidebar`, `--bg-chat`, `--bg-panel`, `--bg-input`, `--bg-hover`, `--bg-active`.
- Tipo: `--font-body` (Figtree), `--font-display` (Bricolage Grotesque, pesos 800 para títulos). Escala `--fs-xs` a `--fs-2xl`.
- Espaço `--sp-1..6`, raios `--radius-*`, medidas `--rail-w`, `--sidebar-w`, `--members-w`, `--header-h`.
- Sem cor de destaque: estados usam inversão (papel sobre tinta), borda tracejada (erro) e anel de papel (falando).

## Linocut
- `.lino`: a "chapa" (fundo/borda/raio) vai num pseudo-elemento. **Dentro do app é lisa, estilo Discord.** Só em um container `.lino-live` (hoje, só o login) a chapa ganha a borda de goiva irregular e animada (filtro `#lino-boil`, a semente do ruído troca em passos, como traço à mão; parada com `prefers-reduced-motion`). Ajuste com `--lino-bg`, `--lino-border`, `--lino-radius`; `.lino-lg` usa entalhe mais forte.
- `.carve`: textura sutil de marcas de goiva (`assets/carve.svg`).
- A textura sai de `scripts/gen-art.py` (determinístico).

## Componentes
`Button` (primary, secondary, outline, ghost, danger; sm/md/lg), `IconButton` (sempre com `label`), `TextField` (rótulo em caixa alta, erro no rótulo como no Discord), `Avatar` (inicial + 4 padrões estáveis por nome, bolinha de status, anel de fala), `Modal`, `Icon` (ícones próprios 24×24), `TurtleLogo` / `TurtleMark`.

## Logo
- `assets/turtle-logo-black.svg`: quadrado preto, tartaruga branca (ícone principal, favicon).
- `assets/turtle-logo-white.svg`: quadrado branco, tartaruga preta.
- `assets/turtle-mark.svg`: só a tartaruga em `currentColor`.
- `assets/turtle-logo-source.png`: arte original. Vetorizada com potrace (upscale 4×, blur leve, `--alphamax 1.2 --opttolerance 1`) e otimizada com svgo.
- PNG/ICO gerados: `apps/client/public/` (favicon, apple-touch, 192, 512) e `apps/desktop/build/` (icon.png 1024, icon.ico).
