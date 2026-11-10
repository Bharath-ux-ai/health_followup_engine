"use client";

import { forwardRef, useEffect, useId, useRef } from "react";
import { Loader2, X } from "lucide-react";
import { cx } from "@/lib/format";

// ---- Button -------------------------------------------------------------------------
type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-gradient-to-r from-violet-600 to-violet-700 text-white hover:from-violet-700 hover:to-violet-800 shadow-sm shadow-violet-600/25 active:scale-[0.98]",
  secondary: "bg-white text-ink border border-slate-200/90 hover:bg-slate-50/90 hover:border-slate-300 shadow-xs active:scale-[0.98]",
  ghost: "text-ink-2 hover:bg-slate-100/70 hover:text-ink active:scale-[0.98]",
  danger: "bg-white text-rose-600 border border-rose-200/90 hover:bg-rose-50/80 hover:border-rose-300 active:scale-[0.98]",
  success: "bg-gradient-to-r from-emerald-600 to-emerald-700 text-white hover:from-emerald-700 hover:to-emerald-800 shadow-sm shadow-emerald-600/20 active:scale-[0.98]",
};

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: React.ReactNode }>(
  function Button({ variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-all duration-150 select-none disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:scale-100",
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
      <span className="mb-1.5 block text-[13px] font-semibold text-ink-2 tracking-tight">{label}</span>
      {children}
      {error ? <span className="mt-1.5 block text-xs font-medium text-rose-600">{error}</span> : hint ? <span className="mt-1.5 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const inputCls = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-ink placeholder:text-slate/80 shadow-xs transition-all duration-150 hover:border-slate-300 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/10 disabled:bg-slate-50 disabled:cursor-not-allowed";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputCls, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(inputCls, "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2214%22 height=%2214%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%235b6271%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:14px] bg-[right_14px_center] bg-no-repeat pr-9 cursor-pointer", className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(inputCls, "h-auto min-h-24 py-2.5 leading-relaxed", className)} {...rest} />;
});

export function Checkbox({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; description?: React.ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 rounded-md border-slate-300 text-violet-700 accent-violet-700 focus:ring-violet-500/20" />
      <label htmlFor={id} className="text-sm leading-snug text-ink select-none cursor-pointer">
        <span className="font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted leading-relaxed">{description}</span>}
      </label>
    </div>
  );
}

// ---- Layout --------------------------------------------------------------------------------
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("print-card rounded-2xl border border-slate-200/80 bg-white/95 shadow-[var(--shadow-card)] transition-all duration-200 hover:shadow-[var(--shadow-card-hover)]", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, icon }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 text-violet-700">{icon}</div>}
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold tracking-tight text-ink">{title}</h2>
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
        {eyebrow && <div className="mb-1 text-xs font-bold tracking-wider text-violet-700 uppercase">{eyebrow}</div>}
        <h1 className="text-[28px] leading-tight font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = "default", icon, onClick, active }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "ok" | "warn" | "danger" | "violet"; icon?: React.ReactNode; onClick?: () => void; active?: boolean }) {
  const tones = {
    default: { text: "text-ink", border: "border-slate-200/80", bg: "bg-white", iconBg: "bg-slate-100 text-slate-700" },
    ok: { text: "text-emerald-700", border: "border-emerald-200/80", bg: "bg-gradient-to-br from-white via-white to-emerald-50/40", iconBg: "bg-emerald-100 text-emerald-700" },
    warn: { text: "text-amber-700", border: "border-amber-200/80", bg: "bg-gradient-to-br from-white via-white to-amber-50/40", iconBg: "bg-amber-100 text-amber-700" },
    danger: { text: "text-rose-600", border: "border-rose-200/90", bg: "bg-gradient-to-br from-rose-50/40 via-white to-rose-50/30", iconBg: "bg-rose-100 text-rose-600" },
    violet: { text: "text-violet-700", border: "border-violet-200/80", bg: "bg-gradient-to-br from-white via-white to-violet-50/50", iconBg: "bg-violet-100 text-violet-700" },
  };
  const Comp = onClick ? "button" : "div";
  const cfg = tones[tone];
  return (
    <Comp
      onClick={onClick}
      className={cx(
        "print-card group flex flex-col rounded-2xl border p-4 sm:p-5 text-left shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)] cursor-pointer select-none",
        cfg.bg,
        active ? "border-violet-600 ring-2 ring-violet-500/20 shadow-sm" : cfg.border,
        onClick && "hover:border-violet-400",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-muted tracking-tight">{label}</span>
        {icon && <span className={cx("grid size-8 place-items-center rounded-xl", cfg.iconBg)}>{icon}</span>}
      </div>
      <span className={cx("tabular mt-3 text-[30px] leading-none font-extrabold tracking-tight", cfg.text)}>{value}</span>
      {hint && <span className="mt-2.5 text-xs text-muted leading-tight">{hint}</span>}
    </Comp>
  );
}

// ---- Feedback -------------------------------------------------------------------------------
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-5 animate-spin text-violet-700", className)} />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm font-medium text-muted">
      <Spinner /> {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-xl bg-slate-200/70", className)} />;
}

export function EmptyState({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-3.5 grid size-12 place-items-center rounded-2xl bg-violet-50 text-violet-700 shadow-xs ring-1 ring-violet-200/60">{icon}</div>}
      <p className="text-[15px] font-bold text-ink">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-muted leading-relaxed">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3.5 text-sm text-rose-700 shadow-xs">
      <span className="font-medium">{text}</span>
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
    info: "border-blue-200 bg-blue-50/80 text-blue-900",
    warn: "border-amber-200 bg-amber-50/80 text-amber-900",
    danger: "border-rose-200 bg-rose-50/80 text-rose-900",
    ok: "border-emerald-200 bg-emerald-50/80 text-emerald-900",
    violet: "border-violet-200 bg-violet-50/80 text-violet-900",
  }[tone];
  return (
    <div className={cx("rounded-2xl border p-4 text-sm shadow-xs", t, className)}>
      {title && <p className="font-bold tracking-tight">{title}</p>}
      {children && <div className={cx("text-ink-2/90 leading-relaxed", !!title && "mt-1.5")}>{children}</div>}
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
      className={cx("m-auto w-[calc(100%-2rem)] rounded-3xl border border-slate-200/90 bg-white p-0 text-ink shadow-[var(--shadow-pop)] backdrop:bg-ink/50 backdrop:backdrop-blur-sm animate-rise", wide ? "max-w-3xl" : "max-w-lg")}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4.5">
            <div>
              <h2 className="text-base font-bold text-ink tracking-tight">{title}</h2>
              {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
            </div>
            <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate hover:bg-slate-100 hover:text-ink transition-colors">
              <X className="size-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2.5 border-t border-slate-100 bg-slate-50/70 px-6 py-3.5">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---- Tabs -------------------------------------------------------------------------------------
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode; count?: number; tone?: "danger" }[] }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto rounded-2xl border border-slate-200/80 bg-slate-100/70 p-1.5 shadow-xs" role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cx(
            "flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-1.5 text-[13px] font-semibold transition-all select-none",
            value === it.value ? "bg-white text-ink shadow-xs" : "text-muted hover:text-ink hover:bg-white/50",
          )}
        >
          {it.label}
          {typeof it.count === "number" && (
            <span className={cx("tabular rounded-full px-1.5 py-0.2 text-[11px] font-bold", it.tone === "danger" ? "bg-rose-100 text-rose-700" : value === it.value ? "bg-slate-100 text-ink" : "bg-slate-200 text-muted")}>
              {it.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---- Table primitives -------------------------------------------------------------------------
export function Table({ children, className }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cx("w-full text-left text-sm", className)}>{children}</table>
    </div>
  );
}

export function Th({ className, children, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cx("border-b border-slate-200 bg-slate-50/80 px-4 py-3 text-[12px] font-bold text-muted uppercase tracking-wider whitespace-nowrap", className)} {...rest}>
      {children}
    </th>
  );
}

export function Td({ className, children, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cx("border-b border-slate-100 px-4 py-3.5 text-sm text-ink-2 transition-colors", className)} {...rest}>
      {children}
    </td>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3.5 text-[13px] text-muted">
      <span className="tabular font-medium">
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
