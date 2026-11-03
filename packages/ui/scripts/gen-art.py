"""Gera as texturas linocut do Turtle (assets/waves.svg e assets/carve.svg).
Determinístico (seed fixa). Rodar: python3 packages/ui/scripts/gen-art.py"""
import math, random, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "assets"
rnd = random.Random(7)

def stroke(points, widths):
    """Polígono de um corte de goiva: linha central + largura variável (pontas afinadas)."""
    left, right = [], []
    for i, ((x, y), w) in enumerate(zip(points, widths)):
        x2, y2 = points[min(i + 1, len(points) - 1)]
        x1, y1 = points[max(i - 1, 0)]
        dx, dy = x2 - x1, y2 - y1
        n = math.hypot(dx, dy) or 1
        nx, ny = -dy / n, dx / n
        left.append((x + nx * w / 2, y + ny * w / 2))
        right.append((x - nx * w / 2, y - ny * w / 2))
    pts = left + right[::-1]
    return "M" + " ".join(f"{x:.0f} {y:.0f}" for x, y in pts) + "Z"

def waves(W=1600, H=1000, gap=28, sea=430):
    """Céu com estrelas em cima, mar de ondas entalhadas embaixo (ondas crescem com a profundidade)."""
    paths = []
    row = 0
    for y0 in range(sea, H + 60, gap):
        row += 1
        depth = (y0 - sea) / (H - sea)
        phase = row * 0.55 + rnd.uniform(-0.25, 0.25)
        amp = 6 + 22 * depth
        freq = 0.011 - 0.004 * depth
        x = rnd.uniform(-200, 0)
        while x < W:
            length = rnd.uniform(180, 520)
            pts, ws = [], []
            n = max(4, int(length / 14))
            base = rnd.uniform(3, 6) + 5 * depth
            for i in range(n + 1):
                t = i / n
                xx = x + t * length
                yy = y0 + amp * math.sin(xx * freq + phase) + rnd.uniform(-0.8, 0.8)
                taper = math.sin(math.pi * t) ** 0.6
                pts.append((xx, yy))
                ws.append(max(0.6, base * taper * rnd.uniform(0.85, 1.1)))
            paths.append(stroke(pts, ws))
            x += length + rnd.uniform(16, 70)
    stars = []
    for _ in range(34):
        cx, cy, r = rnd.uniform(0, W), rnd.uniform(20, sea - 60), rnd.uniform(5, 14)
        a0 = rnd.uniform(0, 1)
        pts = []
        for k in range(8):
            rr = r if k % 2 == 0 else r * 0.32
            a = a0 + k * math.pi / 4
            pts.append(f"{cx + rr * math.cos(a):.0f} {cy + rr * math.sin(a):.0f}")
        stars.append("M" + " ".join(pts) + "Z")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">'
            f'<path fill="#f5f3ee" d="{"".join(paths)}"/><path fill="#f5f3ee" d="{"".join(stars)}"/></svg>')

def carve(S=240):
    """Ladrilho de marcas curtas de goiva para fundos de painel (bem sutil, uso com opacidade baixa)."""
    paths = []
    for _ in range(38):
        L = rnd.uniform(10, 34)
        x, y = rnd.uniform(4, S - L - 4), rnd.uniform(4, S - 4)
        ang = rnd.uniform(-0.25, 0.25)
        n = 5
        pts = [(x + i / n * L * math.cos(ang), y + i / n * L * math.sin(ang) + rnd.uniform(-0.4, 0.4)) for i in range(n + 1)]
        ws = [max(0.4, rnd.uniform(1.4, 2.6) * math.sin(math.pi * i / n) ** 0.5) for i in range(n + 1)]
        paths.append(stroke(pts, ws))
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}"><path fill="#fff" d="{"".join(paths)}"/></svg>'

(OUT / "waves.svg").write_text(waves())
(OUT / "carve.svg").write_text(carve())
print("ok", (OUT / "waves.svg").stat().st_size, (OUT / "carve.svg").stat().st_size)
