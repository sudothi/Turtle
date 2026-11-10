import { useContext } from "react";
import { shownName } from "@turtle/protocol";
import { Avatar, Icon } from "@turtle/ui";
import { fileUrl } from "../api";
import { DiscotecaContext } from "../discoteca";
import { useJukebox } from "../jukebox";

/** Cartão do convite no chat: quem convidou, a música que toca agora e quem está na chamada (passe o mouse para ver o nome). */
export function DiscotecaInvite({ channelId, from }: { channelId: string; from: string }) {
  const { voiceStates } = useContext(DiscotecaContext);
  const cur = useJukebox().states[channelId]?.current;
  const people = voiceStates.filter((v) => v.channelId === channelId);
  return (
    <div className="dc-invite">
      <div className="dc-invite-title"><Icon name="disco" size={18} /> <b>@{from}</b> está te convidando para uma discoteca!</div>
      <div className="dc-invite-now">
        {cur?.cover ? <img className="dc-invite-cover" src={cur.cover} alt="" width={44} height={44} draggable={false} /> : <span className="dc-invite-cover"><Icon name="music" size={20} /></span>}
        <span className="dc-invite-text">
          {cur ? <><b title={cur.title}>{cur.title}</b>{cur.artist && <span className="t-muted">{cur.artist}</span>}</> : <span className="t-muted">Nada tocando agora</span>}
        </span>
      </div>
      <div className="dc-invite-people" role="list" aria-label="Na chamada">
        {people.length === 0 && <span className="t-muted dc-invite-empty">Ninguém na chamada</span>}
        {people.map((p) => (
          <span key={p.userId} role="listitem" className="dc-invite-person" title={shownName(p)} aria-label={shownName(p)} tabIndex={0}>
            <Avatar name={shownName(p)} src={fileUrl(p.avatar)} size={32} />
          </span>
        ))}
      </div>
    </div>
  );
}
