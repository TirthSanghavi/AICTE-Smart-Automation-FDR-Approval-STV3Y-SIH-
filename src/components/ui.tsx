import Link from "next/link";
import type { ReactNode } from "react";
import { humanize, statusTone } from "@/lib/constants";

export function Badge({
  children,
  tone = "neutral",
  solid = false,
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "attention" | "critical" | "simulated" | "muted";
  solid?: boolean;
}) {
  return (
    <span className={`badge ${solid ? "badge--solid" : `badge--${tone}`}`}>
      {children}
    </span>
  );
}

export function StatusBadge({
  value,
  label,
}: {
  value: string | null | undefined;
  label?: string;
}) {
  if (!value) return <Badge tone="muted">Not set</Badge>;
  const tone = statusTone(value) as
    | "neutral"
    | "good"
    | "attention"
    | "critical"
    | "simulated"
    | "muted";
  return <Badge tone={tone}>{label ?? humanize(value)}</Badge>;
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function CardHead({
  title,
  description,
  action,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="card__head">
      <div>
        <h2 className="card__title" id={id}>
          {title}
        </h2>
        {description ? <div className="card__desc">{description}</div> : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function CardBody({
  children,
  flush = false,
}: {
  children: ReactNode;
  flush?: boolean;
}) {
  return <div className={`card__body${flush ? " card__body--flush" : ""}`}>{children}</div>;
}

export function Stat({
  label,
  value,
  detail,
  href,
  attention = false,
  money = false,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  href?: string;
  attention?: boolean;
  money?: boolean;
}) {
  const body = (
    <>
      <span className="stat__label">{label}</span>
      <span className={`stat__value${money ? " stat__value--money" : ""}`}>{value}</span>
      {detail ? <span className="stat__detail">{detail}</span> : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={`stat${attention ? " stat--attention" : ""}`}>
        {body}
      </Link>
    );
  }
  return <div className={`stat${attention ? " stat--attention" : ""}`}>{body}</div>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__title">{title}</div>
      {description ? <p className="empty__desc">{description}</p> : null}
      {action}
    </div>
  );
}

export function Notice({
  tone = "quiet",
  title,
  children,
}: {
  tone?: "quiet" | "danger" | "info" | "warn";
  title?: ReactNode;
  children: ReactNode;
}) {
  const className =
    tone === "danger"
      ? "notice notice--danger"
      : tone === "info"
        ? "notice notice--info"
        : tone === "warn"
          ? "notice"
          : "notice notice--quiet";
  return (
    <div className={className}>
      {title ? <div className="notice__title">{title}</div> : null}
      {children}
    </div>
  );
}

export function PageHead({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <div className="page-head__desc">{description}</div> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {description ? <div className="section-title__desc">{description}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function Initials({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return <span className="avatar">{initials || "—"}</span>;
}

export function DefinitionList({
  items,
  tight = false,
}: {
  items: { label: string; value: ReactNode }[];
  tight?: boolean;
}) {
  return (
    <dl className={`dl${tight ? " dl--tight" : ""}`}>
      {items.map((item) => (
        <div key={item.label} style={{ display: "contents" }}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
