/** Ponte com o app Android (Capacitor). No navegador normal tudo isto é ignorado. */
type TurtleCallPlugin = {
  start(o: { title: string; text: string }): Promise<{ started: boolean; reason?: string }>;
  stop(): Promise<void>;
};

const plugin = (): TurtleCallPlugin | undefined =>
  (window as unknown as { Capacitor?: { Plugins?: { TurtleCall?: TurtleCallPlugin } } }).Capacitor?.Plugins?.TurtleCall;

/** true dentro do APK do Turtle (o app acrescenta "TurtleAndroid" ao user agent). */
export const isNativeApp = typeof navigator !== "undefined" && /TurtleAndroid/.test(navigator.userAgent);

/** Serviço em primeiro plano: mantém a chamada viva com a tela bloqueada ou o app em segundo plano. */
export const callService = {
  start(text: string) {
    if (!isNativeApp) return;
    plugin()?.start({ title: "Turtle", text }).catch(() => {});
  },
  stop() {
    if (!isNativeApp) return;
    plugin()?.stop().catch(() => {});
  },
};
