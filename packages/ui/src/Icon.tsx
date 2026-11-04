import type { SVGProps } from "react";

/** Engrenagem gerada (8 dentes), para não depender de pacote de ícones. */
function gearPath() {
  const teeth = 8;
  const pts: string[] = [];
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 4 === 0 || i % 4 === 1 ? 10 : 7.6;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

const slash = <path d="M3.5 3.5l17 17" strokeWidth="2.4" stroke="currentColor" />;

/** Ícones em grade 24×24. Formas cheias quando possível (linocut é bloco, não traço fino). */
const icons = {
  hash: <path d="M9.5 3.5 7.5 20.5M16.5 3.5l-2 17M4 9h16.5M3.5 15H20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
  speaker: (
    <>
      <path d="M3 9.2h4.2L12.5 4.5v15l-5.3-4.7H3z" fill="currentColor" />
      <path d="M15.5 8.6a4.8 4.8 0 0 1 0 6.8M18.2 5.8a8.7 8.7 0 0 1 0 12.4" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </>
  ),
  mic: (
    <>
      <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </>
  ),
  "mic-off": (
    <>
      <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M3.5 3.5l17 17" stroke="var(--slash-gap, #0a0a0a)" strokeWidth="5" />
      {slash}
    </>
  ),
  headphones: (
    <>
      <path d="M3.5 15v-3a8.5 8.5 0 0 1 17 0v3" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M2.5 14h5v7h-3a2 2 0 0 1-2-2zM21.5 14h-5v7h3a2 2 0 0 0 2-2z" fill="currentColor" />
    </>
  ),
  "headphones-off": (
    <>
      <path d="M3.5 15v-3a8.5 8.5 0 0 1 17 0v3" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M2.5 14h5v7h-3a2 2 0 0 1-2-2zM21.5 14h-5v7h3a2 2 0 0 0 2-2z" fill="currentColor" />
      <path d="M3.5 3.5l17 17" stroke="var(--slash-gap, #0a0a0a)" strokeWidth="5" />
      {slash}
    </>
  ),
  settings: (
    <>
      <path d={gearPath()} fill="currentColor" />
      <circle cx="12" cy="12" r="3.2" fill="var(--slash-gap, #0a0a0a)" />
    </>
  ),
  plus: <path d="M12 4.5v15M4.5 12h15" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
  "chevron-down": <path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  "chevron-right": <path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.8" fill="currentColor" />
      <path d="M2 20.5a7 7 0 0 1 14 0z" fill="currentColor" />
      <circle cx="17.2" cy="9" r="2.8" fill="currentColor" />
      <path d="M17.5 20.5h4.5a5 5 0 0 0-7.3-4.4 8.5 8.5 0 0 1 2.8 4.4z" fill="currentColor" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" fill="currentColor" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  "user-plus": (
    <>
      <circle cx="9" cy="8" r="3.8" fill="currentColor" />
      <path d="M2 20.5a7 7 0 0 1 14 0z" fill="currentColor" />
      <path d="M19 7v8M15 11h8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  "phone-off": <path d="M2.3 13.8c5.4-5 14-5 19.4 0 .5.5.5 1.3 0 1.8l-2 2c-.4.4-1 .5-1.5.2l-2.9-1.5a1.3 1.3 0 0 1-.7-1.2v-2.2a11 11 0 0 0-5.2 0v2.2c0 .5-.3 1-.7 1.2l-2.9 1.5c-.5.3-1.1.2-1.5-.2l-2-2c-.5-.5-.5-1.3 0-1.8z" fill="currentColor" />,
  logout: <path d="M14 4h5v16h-5M9.5 7.5 5 12l4.5 4.5M5.5 12H16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
  close: <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
  copy: (
    <>
      <rect x="8" y="8" width="12.5" height="12.5" rx="2" fill="currentColor" />
      <path d="M16 5.5V5a1.5 1.5 0 0 0-1.5-1.5h-9A1.5 1.5 0 0 0 4 5v9a1.5 1.5 0 0 0 1.5 1.5H6" fill="none" stroke="currentColor" strokeWidth="2.1" />
    </>
  ),
  ticket: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5V9a3 3 0 0 0 0 6v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5V15a3 3 0 0 0 0-6zM14.5 5v14" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" strokeDasharray="0" />,
  check: <path d="M4.5 12.5l5 5 10-11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />,
  signal: (
    <>
      <rect x="3" y="15" width="4" height="6" rx="1" fill="currentColor" />
      <rect x="10" y="10" width="4" height="11" rx="1" fill="currentColor" />
      <rect x="17" y="4" width="4" height="17" rx="1" fill="currentColor" />
    </>
  ),
  video: (
    <>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" fill="currentColor" />
      <path d="M16.5 10.5 21.5 7v10l-5-3.5z" fill="currentColor" />
    </>
  ),
  "video-off": (
    <>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" fill="currentColor" />
      <path d="M16.5 10.5 21.5 7v10l-5-3.5z" fill="currentColor" />
      <path d="M3.5 3.5l17 17" stroke="var(--slash-gap, #0a0a0a)" strokeWidth="5" />
      {slash}
    </>
  ),
  screen: (
    <>
      <rect x="2.5" y="4" width="19" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 7.5v6M9 10.2l3-3 3 3M8 21h8M12 17v4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  "screen-off": (
    <>
      <rect x="2.5" y="4" width="19" height="13" rx="2" fill="currentColor" />
      <path d="M8 21h8M12 17v4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  maximize: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />,
  minimize: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />,
  eye: (
    <>
      <path d="M2 12s3.7-7 10-7 10 7 10 7-3.7 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3.3" fill="currentColor" />
    </>
  ),
  send: <path d="M3 20.5 21.5 12 3 3.5l2.5 8.5zM5.5 12H13" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />,
} as const;

export type IconName = keyof typeof icons;
export const iconNames = Object.keys(icons) as IconName[];

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" {...rest}>
      {icons[name]}
    </svg>
  );
}
