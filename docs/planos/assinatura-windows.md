# Assinatura do instalador do Windows (#102)

Hoje o `Turtle-Setup-*.exe` não é assinado: o Windows mostra o SmartScreen e o auto-update confia só no HTTPS e no hash do `latest.yml` do VPS. Quem invadir o VPS instalaria qualquer programa no grupo.

## O que já está no repositório
- O workflow "Desktop (Windows)" assina com **Azure Trusted Signing** quando os segredos existem; sem eles, gera sem assinatura como antes.
- Sempre publica o **SHA-256** do instalador no resumo da execução (conferência manual enquanto não houver assinatura).

## Qual escolher (conferido na doc da Microsoft em 06/11)
- **Azure Trusted/Artifact Signing** (~US$ 9,99/mês): pessoa física só nos EUA e Canadá; organizações só em EUA, Canadá, UE e Reino Unido. **Brasil não entra**, nem com CNPJ. Descartado.
- **Certificado OV** (~US$ 150–300/ano, vale no mundo todo): a chave fica em token/HSM. Para o CI usar um provedor com assinatura na nuvem (ex.: SSL.com eSigner) e trocar os flags `azureSignOptions` pelo CodeSignTool do provedor.
- **EV**: US$ 400+/ano; desde 2024 não tira o SmartScreen na hora, então não compensa.
- Em qualquer opção o SmartScreen só some depois que a reputação se acumula; assinar com o mesmo editor em todas as versões ajuda.
- Hoje o risco real é o VPS ser invadido e empurrar um instalador falso; sem assinatura, o `electron-updater` não consegue conferir o editor.

## O que falta (precisa do thiago)
1. Decidir entre Azure Trusted Signing (cerca de US$ 10/mês; confirmar se aceita pessoa física no Brasil) e certificado OV tradicional.
2. Criar o Environment `windows-signing` no GitHub e preencher:
   - segredos: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
   - variáveis: `AZURE_SIGN_ENDPOINT`, `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`, `AZURE_SIGN_PUBLISHER`
3. Ligar o job ao Environment (`environment: windows-signing` em `desktop.yml`) depois de criado.
4. Com o app assinado, o `electron-updater` confere `publisherName` antes de instalar.

Nenhum segredo vai no código. Com certificado OV, trocar os flags `azureSignOptions` por `certificateFile`/`certificatePassword` vindos de segredos.
