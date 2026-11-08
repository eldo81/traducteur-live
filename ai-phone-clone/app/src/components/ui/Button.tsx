import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "bg-surface text-text border border-border hover:bg-surface-2",
  ghost: "bg-transparent text-primary hover:bg-primary-soft",
  danger: "bg-danger text-on-danger hover:opacity-90",
};
const SIZES: Record<Size, string> = {
  sm: "h-tap-sm px-4 text-sm font-semibold",
  md: "h-tap px-5 text-base font-semibold",
  lg: "h-14 px-5 text-lg w-full",
};

export const buttonClass = (variant: Variant = "primary", size: Size = "md", extra = "") =>
  `inline-flex items-center justify-center gap-2 rounded-md transition-[background-color,transform] duration-[var(--duration-fast)] active:scale-[.98] disabled:opacity-40 disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, className = "", children, type = "button", disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, size, className)}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span aria-hidden className="size-4 rounded-pill border-2 border-current border-t-transparent animate-spin" />}
      {children}
    </button>
  );
});
