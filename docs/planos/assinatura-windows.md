# Assinatura do instalador do Windows (#102)

**Decisão do thiago (06/11/2026): o instalador não será assinado.** Registrado aqui para ninguém reabrir sem motivo novo.

## Consequências
- O Windows mostra o SmartScreen na primeira instalação ("Mais informações > Executar assim mesmo"); o grupo já sabe disso.
- O auto-update confia só no HTTPS e no hash do `latest.yml` servido pelo VPS; o `electron-updater` não confere o editor sem assinatura. O risco real é alguém invadir o VPS e trocar o instalador.

## Mitigações que ficam
- O workflow "Desktop (Windows)" publica o **SHA-256** do instalador no resumo da execução, para conferir.
- Manter o VPS protegido: SSH só por chave do usuário `kyo`, fail2ban e atualizações automáticas.

## Por que não Azure
Para referência: o Azure Trusted Signing não atende pessoa física no Brasil (só EUA e Canadá; organizações em EUA, Canadá, UE e Reino Unido). A alternativa seria um certificado OV (US$ 150–300/ano) com assinatura na nuvem.
