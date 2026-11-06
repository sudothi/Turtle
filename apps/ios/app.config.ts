import type { ExpoConfig } from "expo/config";
import { version, iosBuildNumber } from "./package.json";

const config: ExpoConfig = {
  name: "Turtle",
  slug: "turtle-ios",
  version,
  platforms: ["ios"],
  orientation: "default",
  userInterfaceStyle: "dark",
  ios: {
    bundleIdentifier: "xyz.ogturtle.mobile",
    buildNumber: iosBuildNumber,
    supportsTablet: false,
    infoPlist: {
      UIBackgroundModes: ["audio"],
      NSMicrophoneUsageDescription: "O Turtle usa o microfone quando você entra em uma chamada com voz.",
      NSCameraUsageDescription: "O Turtle usa a câmera quando você ativa o vídeo em uma chamada.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    ["expo-build-properties", { ios: { deploymentTarget: "26.0" } }],
    "expo-secure-store",
    ["expo-image-picker", { photosPermission: "Escolha uma foto para seu avatar ou banner no Turtle.", cameraPermission: false, microphonePermission: false }],
    "@livekit/react-native-expo-plugin",
    ["@config-plugins/react-native-webrtc", {
      microphonePermission: "Permita o microfone para falar nas chamadas do Turtle.",
      cameraPermission: "Permita a câmera para ativar o vídeo nas chamadas do Turtle.",
    }],
  ],
};

export default config;
