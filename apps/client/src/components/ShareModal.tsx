import { Button, Modal } from "@turtle/ui";
import { desktop } from "../desktop";
import { screenProfiles, type ScreenProfileId } from "../voice/prefs";
import type { VoiceClient, VoiceSnapshot } from "../voice/client";

/** Escolha de qualidade e áudio antes de transmitir a tela ou uma janela. */
export function ShareModal({ snap, voice, onClose }: { snap: VoiceSnapshot; voice: VoiceClient; onClose: () => void }) {
  const { screenProfile, screenAudio } = snap.prefs;
  return (
    <Modal
      title="Transmitir tela"
      subtitle={desktop() ? "Depois de começar, você escolhe a tela ou a janela." : "Depois de começar, o navegador pede para você escolher a tela, a janela ou a aba."}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onClose();
              void voice.startScreen();
            }}
          >
            Começar a transmitir
          </Button>
        </>
      }
    >
      <fieldset className="share-profiles">
        <legend className="t-muted">Qualidade</legend>
        {(Object.keys(screenProfiles) as ScreenProfileId[]).map((id) => {
          const p = screenProfiles[id];
          return (
            <label key={id} className="share-option lino">
              <input type="radio" name="profile" checked={screenProfile === id} onChange={() => voice.setScreenProfile(id)} />
              <span>
                <b>{p.label}</b>
                <span className="t-muted"> · até {p.bitrate / 1_000_000} Mb/s</span>
                <br />
                <span className="t-muted">{p.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <label className="share-audio">
        <input type="checkbox" checked={screenAudio} onChange={(e) => voice.setScreenAudio(e.target.checked)} />
        <span>
          Incluir o áudio do computador
          <br />
          <span className="t-muted">Use fone de ouvido, senão a voz dos outros volta para a chamada como eco.</span>
        </span>
      </label>
    </Modal>
  );
}
