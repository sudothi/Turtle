# Discoteca: fazer o YouTube tocar sempre (plano)

## Problema
Na VPS, o YouTube responde "Sign in to confirm you're not a bot" para o yt-dlp. É bloqueio por IP de datacenter, intermitente: alguns vídeos baixam, outros falham sempre. Medido em 2026-11-10 dentro do container: Rick Astley baixou, `ytsearch1:` funcionou, SoundCloud funcionou, outro vídeo falhou de forma consistente (mesmo tentando os clientes tv e visionos do yt-dlp). Disco, permissão, node e yt-dlp estão ok, então é só reputação do IP.

Meta do thiago: a discoteca toca **música inteira, sempre**. Sem prévia de 30 s (já removida do caminho de falha).

## O que já está feito (PR #185)
- Música da busca tenta até 3 vídeos candidatos antes de desistir.
- Se todos falharem, a faixa é pulada com aviso (sem prévia).
- Cache em disco: cada música só é baixada uma vez, então o volume de pedidos ao YouTube é baixo (~30 contas).

## Opções para o YouTube parar de barrar

| # | Opção | Confiabilidade esperada | Custo/risco | Manutenção |
|---|---|---|---|---|
| A | **Cookies** de uma conta Google descartável (`--cookies`) | Alta | Credencial na VPS fora do git; a conta pode ser sinalizada | Cookie expira/rotaciona; reexportar de vez em quando |
| B | **Sair por IP residencial**: túnel (WireGuard/Tailscale) da VPS até o PC ou um Raspberry em casa, e o yt-dlp usa `--proxy socks5://...` | Alta (IP de casa não é barrado) | PC/Pi ligado 24h; baixa a banda de casa (~4 MB por música) | Baixa, mas depende da internet de casa |
| D | **Proxy residencial pago** só para o yt-dlp | Alta | Mensalidade; serviço externo | Baixa |
| E | **Baixar no aparelho de quem pôs a música** (app desktop/Android usa o IP de casa e envia o áudio ao servidor) | Alta | Muito código; web puro não consegue | Alta |
| F | Fontes sem bloqueio (SoundCloud/Bandcamp) como complemento | Boa, mas o catálogo é menor | Nenhum | Baixa |

## Plano (revisado em 2026-11-10)
Descartados: iframe do YouTube (thiago não gostou) e tudo que for **contornar** a checagem anti-bot do YouTube (PO token forjado, IPv6 rotativo, WARP). A checagem de segurança do ambiente bloqueou esse tipo de medição, e a discoteca deve ficar dentro do que o YouTube aceita: ou o pedido sai de um IP normal, ou vem autenticado.

Caminhos que ficam, em ordem de preferência:
1. **Worker em casa** (opção B): o pedido ao YouTube sai do IP residencial do thiago, como qualquer uso normal, via túnel (WireGuard/Tailscale) do servidor até o PC ou um Raspberry. Sem credencial de conta.
2. **Cookies da conta do thiago** (opção A): autenticação legítima; o YouTube deixa de pedir "confirme que não é um robô". Cookie fica só na VPS (fora do git) e vence de tempos em tempos.
3. **SoundCloud e Bandcamp** (opção F), que já funcionam na VPS, como complemento de catálogo.

O servidor tenta até 3 vídeos candidatos; se todos falharem, pula com aviso claro (nunca prévia).

## Decisões que são do thiago
- Qual caminho: **B** (casa), **A** (cookies de conta descartável) ou **D** (proxy pago)?
- Se for A: criar uma conta Google só para isso e me passar o cookies.txt (vai só para a VPS, nunca para o repositório).
- Se for B: o PC ou um Raspberry em casa fica ligado e com WireGuard/Tailscale?

## Termos de uso
Baixar áudio do YouTube vai contra os termos dele. O Turtle é privado (~30 contas, sem fins comerciais), mas o risco continua. Cookie de conta pessoal aumenta o risco para essa conta, por isso só conta descartável.
