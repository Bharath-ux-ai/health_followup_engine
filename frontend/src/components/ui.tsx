"use client";

import { forwardRef, useEffect, useId, useRef } from "react";
import { Loader2, X } from "lucide-react";
import { cx } from "@/lib/format";

// ---- Button -------------------------------------------------------------------------
type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-violet-700 text-white hover:bg-violet-800 shadow-sm",
  secondary: "bg-white text-ink border border-silver-2 hover:bg-off",
  ghost: "text-ink-2 hover:bg-silver/60",
  danger: "bg-white text-danger border border-danger/30 hover:bg-danger-50",
  success: "bg-ok text-white hover:brightness-95 shadow-sm",
};

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: React.ReactNode }>(
  function Button({ variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55",
          size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
          VARIANTS[variant],
          className,
        )}
        {...rest}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
        {children}
      </button>
    );
  },
);

// ---- Form fields ---------------------------------------------------------------------------
export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const inputCls = "h-10 w-full rounded-lg border border-silver-2 bg-white px-3 text-sm text-ink placeholder:text-slate focus:border-violet focus:outline-none focus:ring-3 focus:ring-violet/15 disabled:bg-off";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputCls, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(inputCls, "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%235f6672%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(inputCls, "h-auto min-h-24 py-2 leading-relaxed", className)} {...rest} />;
});

export function Checkbox({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; description?: React.ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 rounded border-silver-2 accent-violet-700" />
      <label htmlFor={id} className="text-sm leading-snug text-ink">
        {label}
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </label>
    </div>
  );
}

// ---- Layout --------------------------------------------------------------------------------
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("print-card rounded-2xl border border-silver bg-white shadow-[var(--shadow-card)]", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, icon }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-silver px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 text-violet-700">{icon}</div>}
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-semibold tracking-wide text-violet-700 uppercase">{eyebrow}</div>}
        <h1 className="text-[26px] leading-tight font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = "default", icon, onClick, active }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "ok" | "warn" | "danger" | "violet"; icon?: React.ReactNode; onClick?: () => void; active?: boolean }) {
  const tones = {
    default: "text-ink",
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
    violet: "text-violet-700",
  };
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cx(
        "print-card group flex flex-col rounded-2xl border bg-white p-4 text-left shadow-[var(--shadow-card)] transition-colors",
        active ? "border-violet ring-2 ring-violet/15" : "border-silver",
        onClick && "hover:border-violet/50",
        tone === "danger" && "border-danger/30 bg-danger-50/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-muted">{label}</span>
        {icon && <span className={cx("opacity-80", tones[tone])}>{icon}</span>}
      </div>
      <span className={cx("tabular mt-2 text-[28px] leading-none font-bold tracking-tight", tones[tone])}>{value}</span>
      {hint && <span className="mt-2 text-xs text-muted">{hint}</span>}
    </Comp>
  );
}

// ---- Feedback -------------------------------------------------------------------------------
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-5 animate-spin text-violet", className)} />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted">
      <Spinner /> {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-silver/70", className)} />;
}

export function EmptyState({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 grid size-12 place-items-center rounded-full bg-violet-50 text-violet-700">{icon}</div>}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/25 bg-danger-50 px-4 py-3 text-sm text-danger">
      <span>{text}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warn" | "danger" | "ok" | "violet"; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const t = {
    info: "border-info/20 bg-info-50 text-info",
    warn: "border-warn/25 bg-warn-50 text-warn",
    danger: "border-danger/25 bg-danger-50 text-danger",
    ok: "border-ok/25 bg-ok-50 text-ok",
    violet: "border-violet/25 bg-violet-50 text-violet-800",
  }[tone];
  return (
    <div className={cx("rounded-xl border px-4 py-3 text-sm", t, className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cx("text-ink-2", !!title && "mt-1")}>{children}</div>}
    </div>
  );
}

// ---- Modal -----------------------------------------------------------------------------------
export function Modal({ open, onClose, title, subtitle, children, footer, wide }: { open: boolean; onClose: () => void; title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx("m-auto w-[calc(100%-2rem)] rounded-2xl border border-silver bg-white p-0 text-ink shadow-[var(--shadow-pop)] backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]", wide ? "max-w-3xl" : "max-w-lg")}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-silver px-5 py-4">
            <div>
              <h2 className="text-base font-bold">{title}</h2>
              {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
            </div>
            <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate hover:bg-off hover:text-ink">
              <X className="size-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-silver bg-off/60 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---- Tabs -------------------------------------------------------------------------------------
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode; count?: number; tone?: "danger" }[] }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-silver bg-white p-1" role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cx(
            "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors",
            value === it.value ? "bg-ink text-white" : "text-muted hover:bg-off hover:text-ink",
          )}
        >
          {it.label}
          {it.count !== undefined && (
            <span className={cx("tabular rounded-full px-1.5 text-[11px]", value === it.value ? "bg-white/20" : it.tone === "danger" && it.count > 0 ? "bg-danger text-white" : "bg-silver text-ink-2")}>{it.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---- Table ------------------------------------------------------------------------------------
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <th className={cx("border-b border-silver bg-off/70 px-4 py-2.5 text-left text-xs font-semibold tracking-wide text-muted uppercase", className)}>{children}</th>
);
export const Td = ({ children, className, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cx("border-b border-silver/70 px-4 py-3 align-middle", className)} {...rest}>
    {children}
  </td>
);

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between border-t border-silver px-4 py-3 text-[13px] text-muted">
      <span className="tabular">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
