import { useEffect, useState } from "react";

/** Respeita "reduzir movimento" do sistema: bordas paradas. */
function useReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof matchMedia !== "undefined" && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * Filtros SVG do efeito linocut. Renderize uma vez na raiz do app.
 * Animação de repouso: a semente do ruído troca em passos ("traço fervendo", como desenho à mão),
 * então toda borda .lino fica se mexendo de leve, sem mexer no texto.
 */
export function LinoDefs({ animate = true }: { animate?: boolean }) {
  const reduced = useReducedMotion();
  const boil = animate && !reduced;
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        <filter id="lino-rough" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="4" result="noise">
            {boil && <animate attributeName="seed" values="4;11;23;7;16" dur="1.25s" calcMode="discrete" repeatCount="indefinite" />}
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="lino-rough-lg" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="9" result="noise">
            {boil && <animate attributeName="seed" values="9;2;30;14" dur="1.1s" calcMode="discrete" repeatCount="indefinite" />}
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}
