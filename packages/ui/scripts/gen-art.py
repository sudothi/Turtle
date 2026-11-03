"""Gera as texturas linocut do Turtle (assets/carve.svg).
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

(OUT / "carve.svg").write_text(carve())
print("ok", (OUT / "carve.svg").stat().st_size)
