; Servidor no nome do instalador: "Turtle-Setup@app.exemplo.com.exe" grava o endereço em
; %APPDATA%\Turtle\server.json (lido por apps/desktop/src/server-config.ts), e a pessoa nunca digita o
; domínio. A página de download de cada servidor já baixa o arquivo com esse nome. Sem o "@" (instalador
; oficial, atualização automática) nada é gravado e vale o servidor que já estava configurado.
!macro customInstall
  StrCpy $0 $EXEFILE 13
  StrCmp $0 "Turtle-Setup@" 0 turtleServerDone
  StrCpy $0 $EXEFILE "" 13
  StrLen $1 $0
  IntOp $1 $1 - 4
  IntCmp $1 3 0 turtleServerDone 0
  StrCpy $0 $0 $1
  CreateDirectory "$APPDATA\Turtle"
  FileOpen $2 "$APPDATA\Turtle\server.json" w
  FileWrite $2 '{"server":"https://$0"}'
  FileClose $2
  turtleServerDone:
!macroend

; Personalização do instalador NSIS (o electron-builder carrega build/installer.nsh sozinho).
; "Iniciar o Turtle com o Windows": caixa na última tela (desmarcada por padrão). Marcada, grava a entrada
; de inicialização do usuário no mesmo formato do app.setLoginItemSettings (main.ts), com --hidden para abrir
; direto na bandeja. Em atualização (silenciosa) não há tela final, então a escolha da pessoa é mantida.

!define TURTLE_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define TURTLE_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"

!macro customFinishPage
  Function TurtleAutoStart
    WriteRegStr HKCU "${TURTLE_RUN_KEY}" "${PRODUCT_NAME}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --hidden'
    ; Se a pessoa tinha desativado no Gerenciador de Tarefas, marcar a caixa reativa.
    DeleteRegValue HKCU "${TURTLE_APPROVED_KEY}" "${PRODUCT_NAME}"
  FunctionEnd

  ; Igual à tela final padrão do electron-builder (abrir o Turtle ao terminar), mais a caixa abaixo.
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Iniciar o Turtle com o Windows"
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION TurtleAutoStart
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnInstall
  ; Atualização desinstala a versão antiga e instala a nova: aí a entrada precisa ficar.
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "${TURTLE_RUN_KEY}" "${PRODUCT_NAME}"
    DeleteRegValue HKCU "${TURTLE_APPROVED_KEY}" "${PRODUCT_NAME}"
  ${endIf}
!macroend
