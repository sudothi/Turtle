import Svg, { Path } from "react-native-svg";
import { TURTLE_PATH } from "./turtle-path";
import { colors } from "./theme";

export function TurtleMark({ size = 32, color = colors.paper }: { size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 512 512" accessible={false}><Path fill={color} d={TURTLE_PATH} /></Svg>;
}
