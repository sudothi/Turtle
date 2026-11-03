import { useId, type InputHTMLAttributes } from "react";

/** Campo no estilo do Discord: rótulo em caixa alta em cima, erro ao lado do rótulo. */
export function TextField({
  label,
  hint,
  error,
  className = "",
  ...input
}: { label: string; hint?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={`t-field ${error ? "has-error" : ""} ${className}`}>
      <label className="t-field-label" htmlFor={id}>
        {label}
        {input.required && <span className="req" aria-hidden="true">*</span>}
        {error && <span className="t-field-error"> — {error}</span>}
      </label>
      <span className="t-input-wrap lino">
        <input id={id} className="t-input" aria-invalid={error ? true : undefined} {...input} />
      </span>
      {hint && <span className="t-field-hint">{hint}</span>}
    </div>
  );
}
