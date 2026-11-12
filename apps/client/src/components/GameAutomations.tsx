import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button, Icon, IconButton, type IconName } from "@turtle/ui";
import type { AutoConfig, AutoStatus, Champion, DesktopAutomations, RevealProvider, RevealResult } from "../desktop";
import { copyText } from "../clipboard";

/**
 * Game Automations (só no app desktop): aceitar partida, pick e ban automáticos e as ferramentas da
 * seleção de campeões do LoL. Tudo roda no processo principal do Electron, direto no cliente do jogo
 * (API local); aqui só ficam a tela e as configurações. Nada disso passa pelo servidor do Turtle.
 */
const api = (): DesktopAutomations | undefined => window.turtleDesktop?.automations;
export const hasAutomations = () => !!api();

// Liga/desliga o recurso inteiro (Configurações > App desktop). Começa desligado: só aparece para quem ativar.
const ENABLED_KEY = "turtle.gameAutomations";
const ENABLED_EVENT = "turtle:game-automations";
const readEnabled = () => {
  try { return localStorage.getItem(ENABLED_KEY) === "1"; } catch { return false; }
};
export function setGameAutomationsEnabled(on: boolean) {
  try { localStorage.setItem(ENABLED_KEY, on ? "1" : "0"); } catch { /* sem armazenamento */ }
  // Desativar o recurso também desliga as automações que estavam rodando no desktop.
  if (!on) void api()?.set({ accept: { on: false }, pick: { on: false }, ban: { on: false } });
  window.dispatchEvent(new Event(ENABLED_EVENT));
}
export function useGameAutomationsEnabled() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(ENABLED_EVENT, cb);
      window.addEventListener("storage", cb);
      return () => { window.removeEventListener(ENABLED_EVENT, cb); window.removeEventListener("storage", cb); };
    },
    () => hasAutomations() && readEnabled(),
  );
}

export const RANDOM = -1;
const PHASES: Record<string, string> = {
  None: "No menu",
  Lobby: "No lobby",
  Matchmaking: "Na fila",
  CheckedIntoTournament: "No torneio",
  ReadyCheck: "Partida encontrada",
  ChampSelect: "Seleção de campeões",
  GameStart: "Carregando partida",
  InProgress: "Em partida",
  Reconnect: "Reconectar",
  WaitingForStats: "Fim de partida",
  PreEndOfGame: "Fim de partida",
  EndOfGame: "Fim de partida",
};
const PROVIDERS: { id: RevealProvider; label: string }[] = [
  { id: "porofessor", label: "Porofessor" },
  { id: "opgg", label: "OP.GG" },
  { id: "ugg", label: "U.GG" },
];

// Lista e ícones dos campeões: vêm do cliente do LoL (e ficam guardados no computador pelo desktop).
let champList: Promise<Champion[]> | undefined;
const loadChampions = () => {
  champList ??= (api()?.champions() ?? Promise.resolve([])).then((l) => {
    if (!l.length) champList = undefined; // cliente fechado na primeira vez: tenta de novo depois
    return l;
  });
  return champList;
};
const icons = new Map<number, Promise<string | null>>();
const loadIcon = (id: number) => {
  let p = icons.get(id);
  if (!p) {
    p = api()?.icon(id).then((v) => { if (!v) icons.delete(id); return v; }) ?? Promise.resolve(null);
    icons.set(id, p);
  }
  return p;
};

function useChampions(want: boolean) {
  const [list, setList] = useState<Champion[]>([]);
  useEffect(() => {
    if (!want) return;
    let alive = true;
    void loadChampions().then((l) => alive && setList(l));
    return () => { alive = false; };
  }, [want]);
  return list;
}

function ChampIcon({ id, name, size = 40 }: { id: number | null; name?: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!id || id <= 0) return;
    let alive = true;
    void loadIcon(id).then((v) => alive && setSrc(v));
    return () => { alive = false; };
  }, [id]);
  const style = { width: size, height: size };
  if (id === RANDOM) return <span className="ga-champ-icon ga-random" style={style} aria-hidden="true">?</span>;
  if (!id) return <span className="ga-champ-icon ga-none" style={style} aria-hidden="true"><Icon name="plus" size={Math.round(size * 0.45)} /></span>;
  return src ? <img className="ga-champ-icon" src={src} alt="" style={style} draggable={false} /> : <span className="ga-champ-icon" style={style} aria-hidden="true">{(name ?? "?").slice(0, 2)}</span>;
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`ga-switch ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
      <span className="ga-switch-knob" />
    </button>
  );
}

function Delay({ value, onChange, label }: { value: number; onChange: (ms: number) => void; label: string }) {
  return (
    <label className="ga-delay">
      <span>Espera</span>
      <input type="range" min={0} max={2000} step={100} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <b>{(value / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s</b>
    </label>
  );
}

type Slot = "pick" | "fallback" | "ban";
const SLOT_TITLE: Record<Slot, string> = { pick: "Campeão principal", fallback: "Campeão reserva", ban: "Campeão para banir" };

function ChampPicker({ slot, champions, current, onPick, onBack }: { slot: Slot; champions: Champion[]; current: number | null; onPick: (id: number | null) => void; onBack: () => void }) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const shown = useMemo(() => {
    const t = norm(q);
    return t ? champions.filter((c) => norm(c.name).includes(t) || norm(c.alias).includes(t)) : champions;
  }, [q, champions]);
  return (
    <div className="ga-picker">
      <div className="ga-picker-head">
        <IconButton label="Voltar" onClick={onBack}><Icon name="arrow-left" size={18} /></IconButton>
        <b>{SLOT_TITLE[slot]}</b>
      </div>
      <div className="jb-search">
        <Icon name="search" size={16} />
        <input
          ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar campeão" aria-label="Buscar campeão"
          onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) onPick(shown[0].id); if (e.key === "Escape") { e.stopPropagation(); onBack(); } }}
        />
      </div>
      {!champions.length ? (
        <p className="ga-empty t-muted">Abra o cliente do League of Legends uma vez para carregar a lista de campeões.</p>
      ) : (
        <div className="ga-grid" role="listbox" aria-label={SLOT_TITLE[slot]}>
          {!q && slot === "pick" && (
            <button role="option" aria-selected={current === RANDOM} className={`ga-tile ${current === RANDOM ? "on" : ""}`} onClick={() => onPick(RANDOM)}>
              <ChampIcon id={RANDOM} size={44} /><span>Aleatório</span>
            </button>
          )}
          {!q && slot !== "pick" && (
            <button role="option" aria-selected={current === null} className={`ga-tile ${current === null ? "on" : ""}`} onClick={() => onPick(null)}>
              <ChampIcon id={null} size={44} /><span>Nenhum</span>
            </button>
          )}
          {shown.map((c) => (
            <button key={c.id} role="option" aria-selected={current === c.id} className={`ga-tile ${current === c.id ? "on" : ""}`} onClick={() => onPick(c.id)} title={c.name}>
              <ChampIcon id={c.id} name={c.name} size={44} /><span>{c.name}</span>
            </button>
          ))}
          {!shown.length && <p className="ga-empty t-muted">Nenhum campeão com esse nome.</p>}
        </div>
      )}
    </div>
  );
}

function SlotButton({ label, id, champions, disabled, onClick }: { label: string; id: number | null; champions: Champion[]; disabled?: boolean; onClick: () => void }) {
  const name = id === RANDOM ? "Aleatório" : champions.find((c) => c.id === id)?.name ?? (id ? "Campeão" : "Escolher");
  return (
    <button className={`ga-slot ${id ? "" : "empty"}`} disabled={disabled} onClick={onClick}>
      <ChampIcon id={id} name={name} size={36} />
      <span className="ga-slot-text"><small>{label}</small><b>{name}</b></span>
      <Icon name="chevron-right" size={16} />
    </button>
  );
}

function Feature({ icon, title, hint, on, onToggle, children }: { icon: IconName; title: string; hint: string; on: boolean; onToggle: (on: boolean) => void; children?: React.ReactNode }) {
  return (
    <section className={`ga-card lino ${on ? "on" : ""}`}>
      <div className="ga-row">
        <span className="ga-row-icon" aria-hidden="true"><Icon name={icon} size={18} /></span>
        <span className="ga-row-text"><b>{title}</b><span className="t-muted">{hint}</span></span>
        <Switch on={on} label={title} onChange={onToggle} />
      </div>
      {children && <div className="ga-card-body">{children}</div>}
    </section>
  );
}

const clock = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function Panel({ config, status, setConfig, place }: { config: AutoConfig; status: AutoStatus; setConfig: (p: { [K in keyof AutoConfig]?: Partial<AutoConfig[K]> }) => void; place?: { left: number; bottom: number } }) {
  const [slot, setSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDodge, setConfirmDodge] = useState(false);
  const [reveal, setReveal] = useState<RevealResult | null>(null);
  const [copied, setCopied] = useState(false);
  const champions = useChampions(true);
  const open = status.client === "open";
  const inSelect = status.phase === "ChampSelect";

  useEffect(() => { if (!inSelect) { setReveal(null); setConfirmDodge(false); } }, [inSelect]);
  useEffect(() => {
    if (!confirmDodge) return;
    const t = setTimeout(() => setConfirmDodge(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDodge]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);
  useEffect(() => { if (open) void loadChampions(); }, [open]);

  const run = async (which: "reveal" | "dodge" | "restart") => {
    const a = api();
    if (!a || busy) return;
    setBusy(which);
    setError(null);
    try {
      if (which === "reveal") {
        const r = await a.tool("reveal");
        if (r.ok) setReveal(r.result); else setError(r.error);
      } else {
        const r = await a.tool(which);
        if (!r.ok) setError(r.error);
      }
    } finally {
      setBusy(null);
      setConfirmDodge(false);
    }
  };
  const pickChamp = (id: number | null) => {
    if (slot === "pick") setConfig({ pick: { champion: id, on: id !== null ? true : config.pick.on } });
    if (slot === "fallback") setConfig({ pick: { fallback: id } });
    if (slot === "ban") setConfig({ ban: { champion: id, on: id !== null ? true : config.ban.on } });
    setSlot(null);
  };
  const last = status.log[0];
  const notice = error ?? (last ? `${clock(last.at)} · ${last.text}` : null);

  return (
    <div className="sb-panel ga-panel lino lino-lg" role="dialog" aria-label="Game Automations" style={place}>
      <div className="sb-head">
        <b className="t-display">Game Automations</b>
        <span className={`ga-status ${open ? "open" : ""}`} title={status.me?.name}>
          <span className="ga-dot" aria-hidden="true" />
          {open ? PHASES[status.phase ?? "None"] ?? "Cliente aberto" : "LoL fechado"}
        </span>
      </div>
      <div className="ga-tabs" role="tablist">
        <button role="tab" aria-selected="true" className="ga-tab on">League of Legends</button>
        <button role="tab" aria-selected="false" className="ga-tab" disabled title="Em breve">Jogos <small>em breve</small></button>
      </div>

      {slot ? (
        <ChampPicker slot={slot} champions={champions} current={slot === "pick" ? config.pick.champion : slot === "fallback" ? config.pick.fallback : config.ban.champion} onPick={pickChamp} onBack={() => setSlot(null)} />
      ) : (
        <div className="ga-body">
          {open && status.me && <p className="ga-me t-muted">Conectado como <b>{status.me.name}</b></p>}
          <div className="ga-sub t-muted">Automação</div>
          <Feature icon="check" title="Aceitar partida" hint="Aceita a fila assim que a partida aparece" on={config.accept.on} onToggle={(on) => setConfig({ accept: { on } })}>
            {config.accept.on && <Delay label="Espera para aceitar" value={config.accept.delayMs} onChange={(delayMs) => setConfig({ accept: { delayMs } })} />}
          </Feature>
          <Feature icon="swords" title="Escolher campeão" hint="Mostra o campeão ao time e trava na sua vez" on={config.pick.on} onToggle={(on) => (on && !config.pick.champion ? setSlot("pick") : setConfig({ pick: { on } }))}>
            <div className="ga-slots">
              <SlotButton label="Principal" id={config.pick.champion} champions={champions} onClick={() => setSlot("pick")} />
              <SlotButton label="Reserva" id={config.pick.fallback} champions={champions} onClick={() => setSlot("fallback")} />
            </div>
            {config.pick.on && <Delay label="Espera para travar" value={config.pick.delayMs} onChange={(delayMs) => setConfig({ pick: { delayMs } })} />}
          </Feature>
          <Feature icon="close" title="Banir campeão" hint="Bane na sua vez, menos se um aliado quiser ele" on={config.ban.on} onToggle={(on) => (on && !config.ban.champion ? setSlot("ban") : setConfig({ ban: { on } }))}>
            <div className="ga-slots">
              <SlotButton label="Banir" id={config.ban.champion} champions={champions} onClick={() => setSlot("ban")} />
            </div>
            {config.ban.on && <Delay label="Espera para banir" value={config.ban.delayMs} onChange={(delayMs) => setConfig({ ban: { delayMs } })} />}
          </Feature>

          <div className="ga-sub t-muted">Ferramentas</div>
          <div className="ga-tools">
            <button className="ga-tool lino" disabled={!inSelect || !!busy} onClick={() => void run("reveal")} title={inSelect ? "Mostra os nomes do seu time" : "Só na seleção de campeões"}>
              <Icon name="eye" size={22} />
              <b>{busy === "reveal" ? "Revelando…" : "Revelar lobby"}</b>
              <small>Nomes do seu time</small>
            </button>
            <button
              className={`ga-tool lino ${confirmDodge ? "danger" : ""}`} disabled={!inSelect || !!busy}
              onClick={() => (confirmDodge ? void run("dodge") : setConfirmDodge(true))}
              title={inSelect ? "Sai da seleção sem fechar o cliente" : "Só na seleção de campeões"}
            >
              <Icon name="logout" size={22} />
              <b>{busy === "dodge" ? "Saindo…" : confirmDodge ? "Confirmar?" : "Esquivar"}</b>
              <small>{confirmDodge ? "Clique de novo" : "Sem reiniciar o cliente"}</small>
            </button>
            <button className="ga-tool lino" disabled={!open || !!busy} onClick={() => void run("restart")} title={open ? "Reinicia a interface do cliente" : "Abra o cliente do LoL"}>
              <Icon name="refresh" size={22} />
              <b>{busy === "restart" ? "Reiniciando…" : "Reiniciar cliente"}</b>
              <small>Quando ele travar</small>
            </button>
          </div>

          {reveal && (
            <section className="ga-reveal lino">
              <div className="ga-reveal-head">
                <b>Seu time · {reveal.region.toUpperCase()}</b>
                <IconButton label="Fechar" onClick={() => setReveal(null)}><Icon name="close" size={14} /></IconButton>
              </div>
              <ol className="ga-players">
                {reveal.players.map((p) => {
                  const [name, tag] = [p.slice(0, p.lastIndexOf("#")), p.slice(p.lastIndexOf("#") + 1)];
                  return <li key={p}><b>{name}</b><span className="t-muted">#{tag}</span></li>;
                })}
              </ol>
              <div className="ga-reveal-act">
                <div className="ga-seg" role="radiogroup" aria-label="Site">
                  {PROVIDERS.map((pr) => (
                    <button key={pr.id} role="radio" aria-checked={config.reveal.provider === pr.id} className={config.reveal.provider === pr.id ? "on" : ""} onClick={() => setConfig({ reveal: { provider: pr.id } })}>{pr.label}</button>
                  ))}
                </div>
                <IconButton label={copied ? "Copiado" : "Copiar nomes"} onClick={() => { void copyText(reveal.players.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  <Icon name={copied ? "check" : "copy"} size={16} />
                </IconButton>
                <Button size="sm" onClick={() => void api()?.open(reveal.links[config.reveal.provider])}>
                  Abrir <Icon name="external" size={14} />
                </Button>
              </div>
            </section>
          )}
        </div>
      )}

      <div className="sb-foot t-muted">
        {notice ? <span role="status" className={error ? "sb-notice ga-error" : "sb-notice"}>{notice}</span> : <span>Tudo roda no seu computador, direto no cliente do LoL.</span>}
      </div>
    </div>
  );
}

/**
 * Game Automations: ícone ao lado da discoteca na chamada (`compact` no painel de voz, grande nos controles)
 * ou, fora da chamada, a faixa `strip` acima da barra do usuário (mesmo lugar do bloco "Voz conectada").
 * Só aparece no desktop novo e para quem ativou nas configurações.
 */
export function GameAutomationsButton({ compact, strip }: { compact?: boolean; strip?: boolean }) {
  const enabled = useGameAutomationsEnabled();
  return enabled ? <GameAutomationsInner compact={compact || strip} strip={strip} /> : null;
}

function GameAutomationsInner({ compact, strip }: { compact?: boolean; strip?: boolean }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; bottom: number }>();
  const [config, setConfigState] = useState<AutoConfig | null>(null);
  const [status, setStatus] = useState<AutoStatus>({ client: "closed", phase: null, me: null, log: [] });
  const box = useRef<HTMLDivElement>(null);
  const a = api();

  useEffect(() => {
    if (!a) return;
    let alive = true;
    void a.get().then((r) => { if (alive && r) { setConfigState(r.config); setStatus(r.status); } });
    const off = a.onStatus((s) => alive && setStatus(s));
    return () => { alive = false; off(); };
  }, [a]);
  useEffect(() => {
    if (!a || !open) return;
    a.watch(true);
    return () => a.watch(false);
  }, [a, open]);
  // A faixa precisa saber quando o LoL abre mesmo sem automação ligada.
  useEffect(() => {
    if (!a || !strip) return;
    a.background?.(true);
    return () => a.background?.(false);
  }, [a, strip]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!box.current?.contains(t) && !t.closest?.(".ga-panel")) setOpen(false);
    };
    // Esc na busca de campeão só volta para a lista (o seletor cuida disso).
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement).closest?.(".ga-picker") && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!a) return null;

  const setConfig = (patch: { [K in keyof AutoConfig]?: Partial<AutoConfig[K]> }) => {
    setConfigState((c) => (c ? ({ accept: { ...c.accept, ...patch.accept }, pick: { ...c.pick, ...patch.pick }, ban: { ...c.ban, ...patch.ban }, reveal: { ...c.reveal, ...patch.reveal } }) : c));
    void a.set(patch).then((c) => c && setConfigState(c));
  };
  const toggle = () => {
    if (open) return setOpen(false);
    const r = box.current?.getBoundingClientRect();
    if (r) {
      const w = Math.min(440, innerWidth - 32);
      const want = compact ? r.left : r.left + r.width / 2 - w / 2;
      setPlace({ left: Math.max(16, Math.min(want, innerWidth - w - 16)), bottom: innerHeight - r.top + 10 });
    }
    setOpen(true);
  };
  const live = !!config && (config.accept.on || config.pick.on || config.ban.on);
  const panel = open && config && createPortal(<Panel config={config} status={status} setConfig={setConfig} place={place} />, document.body);
  if (strip) {
    // Fora da chamada só aparece com o cliente do LoL aberto ou alguma automação ligada.
    if (!open && !live && status.client !== "open") return null;
    const on = config ? [config.accept.on && "Aceitar", config.pick.on && "Pick", config.ban.on && "Ban"].filter(Boolean) as string[] : [];
    const where = status.client === "open" ? PHASES[status.phase ?? "None"] ?? "Cliente aberto" : "LoL fechado";
    return (
      <div className={`ga-strip ${open ? "open" : ""} ${status.client === "open" ? "lol-open" : ""}`} ref={box}>
        <button className="ga-strip-btn" aria-expanded={open} aria-label="Game Automations" onClick={toggle}>
          <span className="ga-strip-icon" aria-hidden="true"><Icon name="gamepad" size={18} /></span>
          <span className="ga-strip-text">
            <b>{where}<span className="ga-dot" aria-hidden="true" /></b>
            <span className="t-muted">{on.length ? `${on.join(" · ")} ligado${on.length > 1 ? "s" : ""}` : "Automações desligadas"}</span>
          </span>
          <Icon name="chevron-right" size={16} />
        </button>
        {panel}
      </div>
    );
  }
  return (
    <div className={`sb-anchor ${compact ? "side" : ""}`} ref={box}>
      <IconButton
        label={live ? "Game Automations (ligado)" : "Game Automations"} aria-expanded={open} aria-pressed={open}
        className={`${compact ? "" : "big"} ${open ? "is-on" : ""} ${live ? "ga-live" : ""}`} onClick={toggle}
      >
        <Icon name="gamepad" size={compact ? 20 : 24} />
      </IconButton>
      {panel}
    </div>
  );
}

/** Configurações > Game Automations: ativar o recurso (a seção só existe no app desktop novo). */
export function GameAutomationsSetting() {
  const enabled = useGameAutomationsEnabled();
  if (!hasAutomations()) return null;
  return (
    <section className="ga-setting lino">
      <span className="ga-row-icon" aria-hidden="true"><Icon name="gamepad" size={18} /></span>
      <span className="ga-row-text">
        <b>Game Automations</b>
        <span className="t-muted">Aceitar partida, pick e ban automáticos e ferramentas da seleção do League of Legends. Na chamada fica ao lado da discoteca; fora dela, aparece acima da sua barra de usuário quando o LoL está aberto.</span>
      </span>
      <Switch on={enabled} label="Ativar Game Automations" onChange={setGameAutomationsEnabled} />
    </section>
  );
}
