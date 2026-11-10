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
| C | **PO token** com o plugin `bgutil-ytdlp-pot-provider` (container ao lado do api) | Média: ajuda em vídeos barrados por falta de token, não resolve IP queimado | Grátis; mais uma peça no compose | Frágil: o YouTube muda; atualizar yt-dlp e plugin |
| D | **Proxy residencial pago** só para o yt-dlp | Alta | Mensalidade; serviço externo | Baixa |
| E | **Baixar no aparelho de quem pôs a música** (app desktop/Android usa o IP de casa e envia o áudio ao servidor) | Alta | Muito código; web puro não consegue | Alta |
| H | **IPv6 rotativo**: a VPS tem um bloco /64; o yt-dlp sai por um endereço aleatório do bloco a cada pedido (o que bots de música do Discord fazem) | Média: o YouTube às vezes bane o bloco inteiro | Grátis | Média |
| I | **Cloudflare WARP** como proxy local (container `wireproxy`) | Média: os IPs do WARP também são barrados às vezes | Grátis | Baixa |
| F | Fontes sem bloqueio (SoundCloud/Bandcamp) como complemento | Boa, mas o catálogo é menor | Nenhum | Baixa |

## Plano em camadas (decisão: o iframe foi descartado pelo thiago)
O servidor tenta, nesta ordem, até uma funcionar: **saída direta (com PO token) → saída alternativa (IPv6 rotativo / WARP / túnel de casa) → cookies**. Só sobe uma camada quando a anterior falhar, então o dia a dia usa a mais simples e a mais cara só entra quando precisa. O `yt-dlp` fica sempre atualizado (versão fixa no Dockerfile, trocada por PR quando o YouTube mudar).

## Recomendação
1. **Medir antes de decidir** (1 hora, sem mudar produção): a sessão no PC roda na VPS um teste de 30 músicas populares variadas (busca do Deezer → `find` → download) e anota a taxa de sucesso em cada configuração: (0) hoje, (1) com PO token, (2) IPv6 rotativo, (3) WARP, (4) túnel de casa, (5) cookies. As configurações 1 a 3 são grátis e sem credencial; rodam em containers temporários, removidos no fim. Resultado: uma tabela com % de sucesso e tempo médio.
2. **Escolha provável**: **B (túnel para casa)** se o PC do thiago fica ligado, porque não usa credencial de conta e é o que mais se parece com um usuário normal. Se não ficar, **A (cookies)** com conta descartável e aviso no painel quando o cookie vencer. **C** entra como reforço barato junto de qualquer uma.
3. **Implementação no código** (pequena, igual para A/B/C): `YTDLP_ARGS` já aceita `--cookies` e `--proxy`; falta só montar o arquivo/volume no compose e documentar. Detalhe a acrescentar: aviso claro "o YouTube pediu login" no painel e um endpoint/log para saber quando o cookie venceu.
4. **Plano B permanente**: erro claro no painel e fila continua andando. Nunca prévia.

## Decisões que são do thiago
- Qual caminho: **B** (casa), **A** (cookies de conta descartável) ou **D** (proxy pago)?
- Se for A: criar uma conta Google só para isso e me passar o cookies.txt (vai só para a VPS, nunca para o repositório).
- Se for B: o PC ou um Raspberry em casa fica ligado e com WireGuard/Tailscale?

## Termos de uso
Baixar áudio do YouTube vai contra os termos dele. O Turtle é privado (~30 contas, sem fins comerciais), mas o risco continua. Cookie de conta pessoal aumenta o risco para essa conta, por isso só conta descartável.
