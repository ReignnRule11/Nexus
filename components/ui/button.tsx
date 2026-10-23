import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn btn-primary",
  secondary: "btn btn-secondary",
  ghost: "btn btn-ghost",
  danger: "btn btn-danger",
};

export function Button({
  variant = "primary",
  className,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[VARIANT_CLASS[variant], className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
