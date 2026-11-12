// Native adapter of the existing artwork in packages/ui/src/Icon.tsx.
// Keep paths identical to the web icon set; no platform-specific icon vocabulary.
import Svg, { Path, Rect, Circle, G } from "react-native-svg";
import { colors } from "./theme";

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

const slash = <Path d="M3.5 3.5l17 17" strokeWidth="2.4" stroke="currentColor" />;

/** Ícones em grade 24×24. Formas cheias quando possível (linocut é bloco, não traço fino). */
const icons = {
  hash: <Path d="M9.5 3.5 7.5 20.5M16.5 3.5l-2 17M4 9h16.5M3.5 15H20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
  speaker: (
    <>
      <Path d="M3 9.2h4.2L12.5 4.5v15l-5.3-4.7H3z" fill="currentColor" />
      <Path d="M15.5 8.6a4.8 4.8 0 0 1 0 6.8M18.2 5.8a8.7 8.7 0 0 1 0 12.4" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </>
  ),
  mic: (
    <>
      <Rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor" />
      <Path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </>
  ),
  "mic-off": (
    <>
      <Rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor" />
      <Path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <Path d="M3.5 3.5l17 17" stroke="#0a0a0a" strokeWidth="5" />
      {slash}
    </>
  ),
  headphones: (
    <>
      <Path d="M3.5 15v-3a8.5 8.5 0 0 1 17 0v3" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <Path d="M2.5 14h5v7h-3a2 2 0 0 1-2-2zM21.5 14h-5v7h3a2 2 0 0 0 2-2z" fill="currentColor" />
    </>
  ),
  "headphones-off": (
    <>
      <Path d="M3.5 15v-3a8.5 8.5 0 0 1 17 0v3" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <Path d="M2.5 14h5v7h-3a2 2 0 0 1-2-2zM21.5 14h-5v7h3a2 2 0 0 0 2-2z" fill="currentColor" />
      <Path d="M3.5 3.5l17 17" stroke="#0a0a0a" strokeWidth="5" />
      {slash}
    </>
  ),
  settings: (
    <>
      <Path d={gearPath()} fill="currentColor" />
      <Circle cx="12" cy="12" r="3.2" fill="#0a0a0a" />
    </>
  ),
  plus: <Path d="M12 4.5v15M4.5 12h15" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
  "chevron-down": <Path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  "camera-flip": (
    <G fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5" />
      <Path d="M20 3.5v5h-5" />
      <Path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5" />
      <Path d="M4 20.5v-5h5" />
    </G>
  ),
  "chevron-left": <Path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  "chevron-right": <Path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  users: (
    <>
      <Circle cx="9" cy="8" r="3.8" fill="currentColor" />
      <Path d="M2 20.5a7 7 0 0 1 14 0z" fill="currentColor" />
      <Circle cx="17.2" cy="9" r="2.8" fill="currentColor" />
      <Path d="M17.5 20.5h4.5a5 5 0 0 0-7.3-4.4 8.5 8.5 0 0 1 2.8 4.4z" fill="currentColor" />
    </>
  ),
  lock: (
    <>
      <Rect x="4.5" y="10.5" width="15" height="10" rx="2" fill="currentColor" />
      <Path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  "user-plus": (
    <>
      <Circle cx="9" cy="8" r="3.8" fill="currentColor" />
      <Path d="M2 20.5a7 7 0 0 1 14 0z" fill="currentColor" />
      <Path d="M19 7v8M15 11h8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  "phone-off": <Path d="M2.3 13.8c5.4-5 14-5 19.4 0 .5.5.5 1.3 0 1.8l-2 2c-.4.4-1 .5-1.5.2l-2.9-1.5a1.3 1.3 0 0 1-.7-1.2v-2.2a11 11 0 0 0-5.2 0v2.2c0 .5-.3 1-.7 1.2l-2.9 1.5c-.5.3-1.1.2-1.5-.2l-2-2c-.5-.5-.5-1.3 0-1.8z" fill="currentColor" />,
  logout: <Path d="M14 4h5v16h-5M9.5 7.5 5 12l4.5 4.5M5.5 12H16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
  close: <Path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
  copy: (
    <>
      <Rect x="8" y="8" width="12.5" height="12.5" rx="2" fill="currentColor" />
      <Path d="M16 5.5V5a1.5 1.5 0 0 0-1.5-1.5h-9A1.5 1.5 0 0 0 4 5v9a1.5 1.5 0 0 0 1.5 1.5H6" fill="none" stroke="currentColor" strokeWidth="2.1" />
    </>
  ),
  ticket: <Path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5V9a3 3 0 0 0 0 6v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5V15a3 3 0 0 0 0-6zM14.5 5v14" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" strokeDasharray="0" />,
  check: <Path d="M4.5 12.5l5 5 10-11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />,
  signal: (
    <>
      <Rect x="3" y="15" width="4" height="6" rx="1" fill="currentColor" />
      <Rect x="10" y="10" width="4" height="11" rx="1" fill="currentColor" />
      <Rect x="17" y="4" width="4" height="17" rx="1" fill="currentColor" />
    </>
  ),
  video: (
    <>
      <Rect x="2.5" y="6" width="13" height="12" rx="2.5" fill="currentColor" />
      <Path d="M16.5 10.5 21.5 7v10l-5-3.5z" fill="currentColor" />
    </>
  ),
  "video-off": (
    <>
      <Rect x="2.5" y="6" width="13" height="12" rx="2.5" fill="currentColor" />
      <Path d="M16.5 10.5 21.5 7v10l-5-3.5z" fill="currentColor" />
      <Path d="M3.5 3.5l17 17" stroke="#0a0a0a" strokeWidth="5" />
      {slash}
    </>
  ),
  screen: (
    <>
      <Rect x="2.5" y="4" width="19" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <Path d="M12 7.5v6M9 10.2l3-3 3 3M8 21h8M12 17v4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  "screen-off": (
    <>
      <Rect x="2.5" y="4" width="19" height="13" rx="2" fill="currentColor" />
      <Path d="M8 21h8M12 17v4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  maximize: <Path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />,
  minimize: <Path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />,
  eye: (
    <>
      <Path d="M2 12s3.7-7 10-7 10 7 10 7-3.7 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <Circle cx="12" cy="12" r="3.3" fill="currentColor" />
    </>
  ),
  paperclip: <Path d="M20 11.5 12.2 19.3a5 5 0 0 1-7.1-7.1l8.1-8.1a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.8 1.8 0 0 1-2.6-2.6l7.3-7.3" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />,
  reply: <Path d="M10 4.5 2.8 11.3 10 18v-4.2c4.9 0 8.5 1.6 11.2 5.7-.7-6.3-4.3-10.4-11.2-11.2z" fill="currentColor" />,
  smile: <Path fillRule="evenodd" fill="currentColor" d="M12 2.5a9.5 9.5 0 1 0 0 19a9.5 9.5 0 1 0 0-19zM8.8 8.2a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2zM15.2 8.2a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2zM7.2 13.2h9.6a4.8 4.8 0 0 1-9.6 0z" />,
  pencil: (
    <>
      <Path d="M4 20l1-4.8L15.6 4.6a2 2 0 0 1 2.8 0l1 1a2 2 0 0 1 0 2.8L8.8 19z" fill="currentColor" />
      <Path d="M3.5 20.5h17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  trash: (
    <>
      <Path d="M3.5 6h17M9 6V3.5h6V6" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.5 8h13l-1 13h-11z" fill="currentColor" />
    </>
  ),
  file: (
    <>
      <Path d="M5 2.5h9l5 5v14H5z" fill="currentColor" />
      <Path d="M14 2.5v5h5" fill="none" stroke="#111111" strokeWidth="1.6" />
    </>
  ),
  download: (
    <>
      <Path d="M12 3v11M7 9.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M4 17v3.5h16V17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  moon: <Path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor" />,
  send: <Path d="M3 20.5 21.5 12 3 3.5l2.5 8.5zM5.5 12H13" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />,
  more: (
    <>
      <Circle cx="5" cy="12" r="2.4" fill="currentColor" />
      <Circle cx="12" cy="12" r="2.4" fill="currentColor" />
      <Circle cx="19" cy="12" r="2.4" fill="currentColor" />
    </>
  ),
  chat: <Path d="M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H10l-5 4v-4H4A1.5 1.5 0 0 1 2.5 16V6A1.5 1.5 0 0 1 4 4.5z" fill="currentColor" />,
  profile: (
    <>
      <Rect x="2.5" y="4" width="19" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <Path d="M14.5 4v16" stroke="currentColor" strokeWidth="2.2" />
      <Circle cx="18" cy="9" r="1.6" fill="currentColor" />
    </>
  ),
} as const;

export type IconName = keyof typeof icons;
export const iconNames = Object.keys(icons) as IconName[];

export function Icon({ name, size = 20, color = colors.muted }: { name: IconName; size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" color={color} accessible={false}>{icons[name]}</Svg>;
}
