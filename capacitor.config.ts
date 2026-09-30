import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.aayat.assistant",
  appName: "Myra",
  webDir: "dist",
  android: {
    allowMixedContent: false,
  },
};

export default config;
