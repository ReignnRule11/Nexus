import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
};

export function Field({ id, label, hint, error, required, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span className="required-mark"> required</span> : null}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  error?: string;
  hintId?: string;
};

export function Input({ error, hintId, className, ...props }: InputProps) {
  const describedBy = [hintId, error ? `${props.id}-error` : undefined]
    .filter(Boolean)
    .join(" ");
  return (
    <input
      className={["control", className].filter(Boolean).join(" ")}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy || undefined}
      {...props}
    />
  );
}

export function Textarea({
  error,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }) {
  return (
    <textarea
      className={["control control-area", className].filter(Boolean).join(" ")}
      aria-invalid={error ? true : undefined}
      aria-describedby={error && props.id ? `${props.id}-error` : undefined}
      {...props}
    />
  );
}

export function Select({
  error,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { error?: string; children: ReactNode }) {
  return (
    <select
      className={["control", className].filter(Boolean).join(" ")}
      aria-invalid={error ? true : undefined}
      aria-describedby={error && props.id ? `${props.id}-error` : undefined}
      {...props}
    >
      {children}
    </select>
  );
}
