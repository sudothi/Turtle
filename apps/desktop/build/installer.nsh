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
