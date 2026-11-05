import { channelSchema, loginBody, registerBody, serverSchema, userSchema, voiceTokenSchema } from "@turtle/protocol";
import { z } from "zod";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** Only the public origin is configurable. Never put server or Apple secrets here. */
export function apiOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Use a origem HTTPS do servidor, sem caminho, usuário ou senha.");
  }
  return url.origin;
}

const authResponse = z.object({ token: z.string().min(1), user: userSchema });
export type Credentials = z.infer<typeof registerBody>;

export class Api {
  readonly origin: string;
  constructor(origin: string, private readonly token?: string, private readonly transport: typeof fetch = fetch) {
    this.origin = apiOrigin(origin);
  }

  gatewayUrl() {
    const url = new URL("/ws", this.origin);
    url.protocol = "wss:";
    url.searchParams.set("token", this.token ?? "");
    return url.toString();
  }

  private async request<Schema extends z.ZodTypeAny>(path: string, schema: Schema, body?: unknown): Promise<z.output<Schema>> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15_000);
    try {
      const response = await this.transport(`${this.origin}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abort.signal,
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsed = z.object({ error: z.string() }).safeParse(data);
        throw new ApiError(response.status, parsed.success ? parsed.data.error : `O servidor respondeu com erro ${response.status}.`);
      }
      const parsed = schema.safeParse(data);
      if (!parsed.success) throw new Error("Resposta incompatível do servidor. Confira a versão do app.");
      return parsed.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (abort.signal.aborted) throw new Error("O servidor demorou a responder. Tente novamente.");
      if (error instanceof TypeError) throw new Error("Não foi possível conectar. Confira sua conexão e o endereço do servidor.");
      throw error;
    } finally { clearTimeout(timer); }
  }

  login = (username: string, password: string) => this.request("/auth/login", authResponse, loginBody.parse({ username, password }));
  register = (credentials: Credentials) => this.request("/auth/register", authResponse, registerBody.parse(credentials));
  me = () => this.request("/me", userSchema);
  servers = () => this.request("/servers", z.array(serverSchema));
  channels = (id: string) => this.request(`/servers/${encodeURIComponent(id)}/channels`, z.array(channelSchema));
  voiceToken = (id: string) => this.request(`/voice/${encodeURIComponent(id)}/token`, voiceTokenSchema, {});
}
