import { flipperBackLeft, flipperBackRight, flipperFrontLeft, flipperFrontRight, head, shell } from "./turtle-parts";

/** Centro da tartaruga na marca (512x512): de onde as ondas se abrem. */
const CX = 256;
const CY = 270;

/** Arco de goiva: um trecho de círculo afinado nas duas pontas, como um corte de linogravura. */
function carvedArc(r: number, from: number, to: number, thick: number) {
  const steps = 24;
  const outer: string[] = [];
  const inner: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const a = ((from + (to - from) * u) * Math.PI) / 180;
    const t = (thick / 2) * Math.sin(Math.PI * u);
    const pt = (rr: number) => `${(CX + rr * Math.cos(a)).toFixed(1)} ${(CY + rr * Math.sin(a)).toFixed(1)}`;
    outer.push(pt(r + t));
    inner.unshift(pt(r - t));
  }
  return `M${outer.join("L")}L${inner.join("L")}Z`;
}

/** Poucos anéis de água em volta dela: [raio, ângulo inicial, ângulo final] (0° = direita, negativo = para cima). */
const rings: [number, number, number][][] = [
  [[300, -78, -52], [300, -30, 4]],
  [[352, -64, -38], [352, -12, 14]],
];

/**
 * Tartaruga da marca em peças (casco, cabeça e quatro nadadeiras) com animação idle:
 * as nadadeiras remam devagar, a cabeça olha para os lados de vez em quando
 * e dois anéis de água se abrem em volta dela.
 */
export function SwimmingTurtle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={`swim-turtle ${className ?? ""}`} aria-hidden="true">
      <g className="swim-water">
        {rings.map((ring, i) => (
          <g key={i} className={`ring ring${i + 1}`}>
            {ring.map(([r, from, to]) => (
              <path key={from} d={carvedArc(r, from, to, 7)} />
            ))}
          </g>
        ))}
      </g>
      <g className="swim-body">
        <path className="part fin fin-fl" d={flipperFrontLeft} />
        <path className="part fin fin-fr" d={flipperFrontRight} />
        <path className="part fin fin-bl" d={flipperBackLeft} />
        <path className="part fin fin-br" d={flipperBackRight} />
        <path className="part head" d={head} />
        <path className="part" d={shell} />
      </g>
    </svg>
  );
}
