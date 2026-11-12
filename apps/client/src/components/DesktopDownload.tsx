import { useEffect, useState } from "react";
import { Button, Icon } from "@turtle/ui";
import { desktop } from "../desktop";

/** Pasta onde o Caddy serve o instalador e o manifesto do auto-update (infra/Caddyfile). */
export const DESKTOP_BASE = "/desktop/";

export interface DesktopRelease {
  version: string;
  file: string;
  size?: number;
  date?: string;
}

/** Lê o `latest.yml` do electron-builder sem biblioteca de YAML: só os campos que a página usa. */
export function parseLatestYml(text: string): DesktopRelease | null {
  const pick = (key: string) => text.match(new RegExp(`^\\s*-?\\s*${key}:\\s*['"]?([^'"\\r\\n]+?)['"]?\\s*$`, "m"))?.[1];
  const version = pick("version");
  const file = pick("path") ?? pick("url");
  if (!version || !file || !/\.exe$/i.test(file) || /[\\/]|\.\./.test(file)) return null;
  const size = Number(pick("size"));
  return { version, file, size: Number.isFinite(size) && size > 0 ? size : undefined, date: pick("releaseDate") };
}

/**
 * Nome do arquivo baixado: "Turtle-Setup@<domínio>.exe". O instalador lê o domínio do próprio nome
 * (apps/desktop/build/installer.nsh), então o app já abre neste servidor, sem a pessoa digitar nada.
 */
export function installerName(host: string): string | null {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) ? `Turtle-Setup@${host.toLowerCase()}.exe` : null;
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;
const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
};

type State = { kind: "loading" } | { kind: "ready"; release: DesktopRelease } | { kind: "missing" };

/** Configurações > App desktop: botão para baixar o instalador do Windows publicado no servidor. */
export function DesktopDownload() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const inApp = !!desktop();

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    fetch(`${DESKTOP_BASE}latest.yml`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => {
        const release = parseLatestYml(t);
        if (alive) setState(release ? { kind: "ready", release } : { kind: "missing" });
      })
      .catch(() => alive && setState({ kind: "missing" }));
    return () => {
      alive = false;
    };
  }, [attempt]);

  return (
    <div className="desktop-download">
      <div className="desktop-hero lino">
        <Icon name="screen" size={40} />
        <div>
          <b className="desktop-title">Turtle para Windows</b>
          <span className="t-muted">Abre sozinho, fica na bandeja, avisa de mensagem e se atualiza sozinho. Melhor para transmitir tela com o áudio do computador.</span>
        </div>
      </div>

      {inApp && <p className="desktop-note">Você já está usando o app desktop. Ele baixa as novas versões sozinho.</p>}

      {state.kind === "loading" && <p className="t-muted">Procurando a versão mais nova…</p>}

      {state.kind === "missing" && (
        <p className="desktop-note">O instalador ainda não foi publicado neste servidor. Peça o arquivo para o admin.</p>
      )}

      {state.kind === "ready" && (
        <div className="desktop-release">
          <a className="t-btn lino lg desktop-btn" href={`${DESKTOP_BASE}${encodeURIComponent(state.release.file)}`} download={installerName(location.hostname) ?? true}>
            <Icon name="download" size={20} />
            Baixar para Windows
          </a>
          <span className="t-muted">
            Versão {state.release.version}
            {state.release.size ? ` · ${mb(state.release.size)}` : ""}
            {state.release.date && day(state.release.date) ? ` · ${day(state.release.date)}` : ""}
          </span>
        </div>
      )}

      <hr className="t-divider" />
      <ol className="desktop-steps">
        <li>Baixe e abra o <b>Turtle-Setup</b>.</li>
        <li>
          Se o Windows mostrar <b>"O Windows protegeu o computador"</b>, clique em <b>Mais informações</b> e depois em <b>Executar assim mesmo</b>. Aparece porque o app não tem assinatura paga.
        </li>
        <li>Escolha a pasta, termine a instalação e entre com a mesma conta.</li>
      </ol>
      <p className="t-muted desktop-foot">Só Windows por enquanto. No celular e em outros sistemas, use o Turtle pelo navegador.</p>
      {state.kind === "missing" && (
        <Button size="sm" variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
          Tentar de novo
        </Button>
      )}
    </div>
  );
}
