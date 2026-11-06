import type { ExpoConfig } from "expo/config";
import { version } from "./package.json";

const config: ExpoConfig = {
  name: "Turtle",
  slug: "turtle-ios",
  version,
  platforms: ["ios"],
  orientation: "default",
  userInterfaceStyle: "dark",
  ios: {
    bundleIdentifier: "xyz.ogturtle.mobile",
    buildNumber: "3",
    supportsTablet: false,
    infoPlist: {
      UIBackgroundModes: ["audio"],
      NSMicrophoneUsageDescription: "O Turtle usa o microfone quando você entra em uma chamada com voz.",
      NSCameraUsageDescription: "O Turtle usará a câmera em chamadas de vídeo quando esse recurso estiver disponível.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    ["expo-build-properties", { ios: { deploymentTarget: "26.0" } }],
    "expo-secure-store",
    "@livekit/react-native-expo-plugin",
    ["@config-plugins/react-native-webrtc", {
      microphonePermission: "Permita o microfone para falar nas chamadas do Turtle.",
      cameraPermission: "A câmera será usada quando as chamadas de vídeo estiverem disponíveis.",
    }],
  ],
};

export default config;
