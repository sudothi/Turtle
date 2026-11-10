import { requireNativeModule } from "expo";
import type { CallAudio } from "./call-lifecycle";

export const callAudio = requireNativeModule<CallAudio>("TurtleCallAudio");
