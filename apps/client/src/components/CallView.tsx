import type { Channel, VoiceState } from "@turtle/protocol";
import { Avatar, Button, Icon, IconButton } from "@turtle/ui";
import type { CallParticipant, VoiceClient, VoiceSnapshot } from "../voice/client";
import { ChannelHeader } from "./ChatView";

const qualityLabel: Record<CallParticipant["quality"], string> = {
  excellent: "conexão ótima", good: "conexão boa", poor: "conexão ruim", lost: "sem conexão", unknown: "",
};

/** Palco da chamada de voz, no estilo do Discord: grade de cartões e barra de controles embaixo. */
export function CallView({ channel, snap, voice, members = [] }: { channel?: Channel; snap: VoiceSnapshot; voice: VoiceClient; members?: VoiceState[] }) {
  if (!channel) return null;
  const inThis = snap.channelId === channel.id && snap.status !== "idle";
  const here = members.filter((m) => m.channelId === channel.id);

  return (
    <section className="call">
      <ChannelHeader icon="speaker" name={channel.name}>
        {inThis && snap.status !== "connected" && <span className="t-muted call-state">{snap.status === "connecting" ? "conectando…" : "reconectando…"}</span>}
      </ChannelHeader>

      {!inThis ? (
        <div className="call-lobby lino-waves">
          <div className="call-lobby-faces">
            {here.length ? here.map((m) => <Avatar key={m.userId} name={m.username} size={72} />) : <Icon name="speaker" size={56} />}
          </div>
          <h2 className="t-display">{channel.name}</h2>
          <p className="t-muted">{here.length ? `${here.map((m) => m.username).join(", ")} ${here.length > 1 ? "estão" : "está"} na chamada.` : "Ninguém na chamada ainda."}</p>
          <Button size="lg" onClick={() => void voice.join(channel.id)}>
            Entrar na chamada
          </Button>
        </div>
      ) : (
        <>
          <div className="tiles" data-count={Math.min(snap.participants.length, 6)}>
            {snap.participants.map((p) => (
              <div key={p.id} className={`tile lino lino-lg ${p.speaking && !p.muted ? "speaking" : ""}`}>
                <Avatar name={p.name} size={88} speaking={p.speaking && !p.muted} />
                <div className="tile-name">
                  {p.muted && <Icon name="mic-off" size={16} />}
                  <span>
                    {p.name}
                    {p.isLocal && " (você)"}
                  </span>
                </div>
                {qualityLabel[p.quality] && <div className="tile-quality t-muted">{qualityLabel[p.quality]}</div>}
                {!p.isLocal && (
                  <input
                    className="tile-volume"
                    type="range" min={0} max={1} step={0.05} aria-label={`Volume de ${p.name}`}
                    value={snap.prefs.volumes[p.id] ?? 1}
                    onChange={(e) => voice.setVolume(p.id, Number(e.target.value))}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="call-controls lino lino-lg">
            <IconButton label="Mudo" aria-pressed={snap.muted} className={`big ${snap.muted ? "is-off" : ""}`} onClick={() => void voice.toggleMute()}>
              <Icon name={snap.muted ? "mic-off" : "mic"} size={24} />
            </IconButton>
            <IconButton label="Ensurdecer" aria-pressed={snap.deafened} className={`big ${snap.deafened ? "is-off" : ""}`} onClick={() => void voice.toggleDeafen()}>
              <Icon name={snap.deafened ? "headphones-off" : "headphones"} size={24} />
            </IconButton>
            <IconButton label="Sair da chamada" className="big hangup" onClick={() => void voice.leave()}>
              <Icon name="phone-off" size={26} />
            </IconButton>
          </div>
        </>
      )}
    </section>
  );
}
