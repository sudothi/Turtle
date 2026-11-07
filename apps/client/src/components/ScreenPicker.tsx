import { useEffect, useState } from "react";
import { Button, Icon, Modal } from "@turtle/ui";
import { desktop, type PickRequest, type PickSource } from "../desktop";

/** Seletor de tela/janela do app desktop. No navegador o próprio navegador mostra o seu. */
export function ScreenPicker() {
  const [req, setReq] = useState<PickRequest>();
  const [chosen, setChosen] = useState<string>();

  useEffect(
    () =>
      desktop()?.onPickScreen((r) => {
        setChosen(r.sources.find((s) => s.kind === "screen")?.id ?? r.sources[0]?.id);
        setReq(r);
      }),
    [],
  );
  if (!req) return null;

  const answer = (id: string | null) => {
    desktop()?.pickScreen(id);
    setReq(undefined);
  };
  const group = (kind: PickSource["kind"], title: string) => {
    const list = req.sources.filter((s) => s.kind === kind);
    if (!list.length) return null;
    return (
      <section>
        <h3 className="t-muted picker-title">{title}</h3>
        <div className="picker-grid">
          {list.map((s) => (
            <button key={s.id} type="button" className={`picker-item lino ${chosen === s.id ? "is-chosen" : ""}`} aria-pressed={chosen === s.id} onClick={() => setChosen(s.id)} onDoubleClick={() => answer(s.id)}>
              <img src={s.thumbnail} alt="" />
              <span className="picker-name">
                {s.icon && <img className="picker-icon" src={s.icon} alt="" />}
                <span>{s.name}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  };

  return (
    <Modal
      title="O que transmitir?"
      subtitle={
        req.audio
          ? "Com áudio: na tela inteira vai o som do PC todo, menos o Turtle; numa janela, só o som daquele programa."
          : "Escolha uma tela ou uma janela."
      }
      onClose={() => answer(null)}
      footer={
        <>
          <Button variant="ghost" onClick={() => answer(null)}>
            Cancelar
          </Button>
          <Button disabled={!chosen} onClick={() => answer(chosen ?? null)}>
            <Icon name="screen" size={18} /> Transmitir
          </Button>
        </>
      }
    >
      <div className="picker">
        {group("screen", "Telas")}
        {group("window", "Janelas")}
      </div>
    </Modal>
  );
}
