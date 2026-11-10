import type { SVGProps } from "react";

/** Entalhe (a linha "cortada" do linocut): traço na cor do fundo por cima da forma cheia. */
const cut = { fill: "none", stroke: "var(--slash-gap, #0a0a0a)", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const line = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Ícones dos sons do soundboard (grade 24×24, formas cheias com entalhes, preto e branco). */
const soundIcons = {
  turtle: (
    <>
      <path d="M3 16a8 7.5 0 0 1 16 0z" fill="currentColor" />
      <circle cx="20.5" cy="13" r="2.3" fill="currentColor" />
      <path d="M5 16.5v3h3v-3M14 16.5v3h3v-3" fill="currentColor" />
      <path d="M7 15.5l2-4h4l2 4M9 11.5l2-3 2 3" {...cut} />
    </>
  ),
  fish: (
    <>
      <path d="M2.5 12c3-5 9-6.5 14-3l5-3.5v13l-5-3.5c-5 3.5-11 2-14-3z" fill="currentColor" />
      <circle cx="7" cy="11" r="1.2" fill="var(--slash-gap, #0a0a0a)" />
      <path d="M11 8.5c1 2 1 5 0 7M14 9.5c.6 1.6.6 3.4 0 5" {...cut} />
    </>
  ),
  cat: (
    <>
      <path d="M4 21V9l-.5-6 5 4h7l5-4-.5 6v12z" fill="currentColor" />
      <path d="M8.5 12.5h1.5M14 12.5h1.5M12 15v1.5M10 17.5c1 .8 3 .8 4 0M2 15l5 .5M2 18l5-.5M22 15l-5 .5M22 18l-5-.5" {...cut} />
    </>
  ),
  star: (
    <>
      <path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z" fill="currentColor" />
      <path d="M12 7v6M9 12l3 1 3-1" {...cut} />
    </>
  ),
  wave: (
    <>
      <path d="M2 20c0-7 4-13 11-13 4 0 6.5 2.5 6.5 5.5 0 2.2-1.6 3.8-3.6 3.8-1.8 0-3-1.2-3-2.8 2 0 2.6-2.5.6-2.5C10 11 8 15 8.5 20z" fill="currentColor" />
      <path d="M2 21.5h20" {...line} />
      <path d="M5 17c.5-3 2-5.5 4.5-7" {...cut} />
    </>
  ),
  shell: (
    <>
      <path d="M12 3c5.5 0 9 4.5 9 10l-3 6H6l-3-6c0-5.5 3.5-10 9-10z" fill="currentColor" />
      <path d="M9.5 19h5l-1 2.5h-3z" fill="currentColor" />
      <path d="M12 5v13M12 18L7 7M12 18l5-11M12 18L4.5 11M12 18l7.5-7" {...cut} />
    </>
  ),
  bubble: (
    <>
      <circle cx="10" cy="13" r="7.5" fill="currentColor" />
      <circle cx="19" cy="5.5" r="3" fill="currentColor" />
      <path d="M6 10.5a4.5 4.5 0 0 1 3-3" {...cut} />
    </>
  ),
  horn: (
    <>
      <path d="M2.5 9h4l11-5.5v17L6.5 15h-4z" fill="currentColor" />
      <path d="M6.5 15l1.5 6h3l-1-5" fill="currentColor" />
      <path d="M19.5 8.5l2-1M20 12h2M19.5 15.5l2 1" {...line} />
      <path d="M6.5 9.5v5M10 8v8" {...cut} />
    </>
  ),
  bell: (
    <>
      <path d="M12 2.5c4 0 6.5 3 6.5 7v4.5l2 3.5h-17l2-3.5V9.5c0-4 2.5-7 6.5-7z" fill="currentColor" />
      <circle cx="12" cy="20" r="2" fill="currentColor" />
      <path d="M9 6.5c-1 1-1.5 2.3-1.5 3.8V13" {...cut} />
    </>
  ),
  drum: (
    <>
      <path d="M3 9v8c0 2 4 3.5 9 3.5s9-1.5 9-3.5V9" fill="currentColor" />
      <ellipse cx="12" cy="8.5" rx="9" ry="3.3" fill="currentColor" />
      <path d="M3 9c0 2 4 3.5 9 3.5S21 11 21 9M6 13l3 6M12 13.5v6.5M18 13l-3 6" {...cut} />
      <path d="M8 4L5 1.5M16 4l3-2.5" {...line} />
    </>
  ),
  skull: (
    <>
      <path d="M12 2.5c5 0 8.5 3.5 8.5 8 0 2.6-1.2 4.4-3 5.5V20h-11v-4c-1.8-1.1-3-2.9-3-5.5 0-4.5 3.5-8 8.5-8z" fill="currentColor" />
      <circle cx="8.5" cy="11" r="2.1" fill="var(--slash-gap, #0a0a0a)" />
      <circle cx="15.5" cy="11" r="2.1" fill="var(--slash-gap, #0a0a0a)" />
      <path d="M12 13.5l-1 2h2zM10 17.5v2.5M14 17.5v2.5" {...cut} />
    </>
  ),
  heart: (
    <>
      <path d="M12 21C5 16.5 2.5 12.5 2.5 8.7A4.9 4.9 0 0 1 12 6.4a4.9 4.9 0 0 1 9.5 2.3c0 3.8-2.5 7.8-9.5 12.3z" fill="currentColor" />
      <path d="M6 8.5c.3-1.2 1.2-2 2.4-2.2" {...cut} />
    </>
  ),
  laugh: (
    <>
      <circle cx="12" cy="12" r="9.5" fill="currentColor" />
      <path d="M7 9.5l2 1-2 1M17 9.5l-2 1 2 1" {...cut} />
      <path d="M6.5 13.5h11a5.5 5.5 0 0 1-11 0z" fill="var(--slash-gap, #0a0a0a)" />
    </>
  ),
  ghost: (
    <>
      <path d="M4.5 21.5V11a7.5 7.5 0 0 1 15 0v10.5l-2.5-2-2.5 2-2.5-2-2.5 2-2.5-2z" fill="currentColor" />
      <ellipse cx="9.3" cy="10.5" rx="1.3" ry="1.9" fill="var(--slash-gap, #0a0a0a)" />
      <ellipse cx="14.7" cy="10.5" rx="1.3" ry="1.9" fill="var(--slash-gap, #0a0a0a)" />
      <path d="M10.5 15.5h3" {...cut} />
    </>
  ),
  bomb: (
    <>
      <circle cx="10.5" cy="14" r="7.5" fill="currentColor" />
      <path d="M14.5 6.5l2 2" stroke="currentColor" strokeWidth="3.5" />
      <path d="M16.5 7.5c1-2.5 2.5-3.5 4-3" {...line} />
      <path d="M20.5 1.5v1.5M22.5 4.5H21M22 2l-1 1" {...line} strokeWidth={1.6} />
      <path d="M6.5 12a4.5 4.5 0 0 1 3-3" {...cut} />
    </>
  ),
  crown: (
    <>
      <path d="M2.5 7.5l5 4.5L12 4l4.5 8 5-4.5-2 12h-15z" fill="currentColor" />
      <path d="M5.5 16.5h13" {...cut} />
      <circle cx="12" cy="13" r="1.3" fill="var(--slash-gap, #0a0a0a)" />
    </>
  ),
  moon: (
    <>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor" />
      <circle cx="9" cy="14" r="1.6" fill="var(--slash-gap, #0a0a0a)" />
      <circle cx="13.5" cy="17.5" r="1" fill="var(--slash-gap, #0a0a0a)" />
      <path d="M17 3.5v3M15.5 5h3" {...line} strokeWidth={1.6} />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="5.5" fill="currentColor" />
      <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" {...line} />
      <path d="M9.5 10.5a3 3 0 0 1 2-2" {...cut} />
    </>
  ),
  anchor: (
    <>
      <circle cx="12" cy="4.5" r="2.3" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 7v14M8 10.5h8" {...line} strokeWidth={2.8} />
      <path d="M3.5 13.5c.5 4.5 4 7.5 8.5 7.5s8-3 8.5-7.5l-2.5 1.5M3.5 13.5l2.5 1.5" {...line} strokeWidth={2.6} />
    </>
  ),
  duck: (
    <>
      <path d="M3 13c1.5 0 3 .5 4.5 1.5 1-1 2-2 2-3.5a4.5 4.5 0 0 1 9 0c0 .8-.2 1.5-.5 2.2 2 1 3 3 3 4.8 0 2.5-3 4-8 4-6.5 0-10-3.5-10-9z" fill="currentColor" />
      <path d="M18.3 9.5l3.7.8-3.4 1.6" fill="currentColor" />
      <circle cx="15.5" cy="9.5" r="1.1" fill="var(--slash-gap, #0a0a0a)" />
      <path d="M8 16c2 1.5 5 1.8 8 .5" {...cut} />
    </>
  ),
} as const;

export type SoundIconName = keyof typeof soundIcons;
export const soundIconNames = Object.keys(soundIcons) as SoundIconName[];

export function SoundIcon({ name, size = 24, ...rest }: { name: string; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" {...rest}>
      {soundIcons[name as SoundIconName] ?? soundIcons.star}
    </svg>
  );
}
