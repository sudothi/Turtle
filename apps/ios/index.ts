import { registerGlobals } from "@livekit/react-native";
import { registerRootComponent } from "expo";
import App from "./src/App";

registerGlobals();
registerRootComponent(App);
