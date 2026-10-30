"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

type ApiError = {
  code?: string;
  message?: string;
  details?: { field?: string; issue: string }[];
};

export function ApiForm({
  action,
  method = "POST",
  submitLabel,
  children,
  successMessage = "Saved.",
  redirectTo,
  redirectFromResponse,
  confirmText,
  className = "form",
  buttonClassName = "btn",
  disabled = false,
  note,
}: {
  action: string;
  method?: "POST" | "PUT" | "PATCH";
  submitLabel: string;
  children?: ReactNode;
  successMessage?: string;
  redirectTo?: string;
  redirectFromResponse?: { path: string; base: string };
  confirmText?: string;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
  note?: ReactNode;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmText && !window.confirm(confirmText)) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload: Record<string, unknown> = {};
    for (const [key, value] of data.entries()) {
      if (typeof value !== "string") continue;
      const existing = payload[key];
      if (existing === undefined) {
        payload[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        payload[key] = [existing, value];
      }
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(action, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as
        | ({ error?: ApiError } & Record<string, unknown>)
        | null;
      if (!response.ok) {
        setError(
          body?.error ?? {
            message: "The action could not be completed. No changes were saved.",
          },
        );
        return;
      }
      setSuccess(successMessage);
      formRef.current?.reset();
      router.refresh();
      if (redirectFromResponse) {
        const value = redirectFromResponse.path
          .split(".")
          .reduce<unknown>((acc, key) =>
            acc && typeof acc === "object"
              ? (acc as Record<string, unknown>)[key]
              : undefined,
          body ?? undefined);
        if (typeof value === "string" && value) {
          router.push(`${redirectFromResponse.base}/${value}`);
          return;
        }
      }
      if (redirectTo) router.push(redirectTo);
    } catch {
      setError({ message: "Network error. Check your connection and try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} className={className} onSubmit={handleSubmit}>
      {children}
      {error ? (
        <div className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
          {error.code ? <span className="form-error__code">{error.code}</span> : null}
          {error.message ?? "The action failed."}
          {error.details && error.details.length > 0 ? (
            <ul>
              {error.details.map((detail, index) => (
                <li key={`${detail.field ?? "detail"}-${index}`}>{detail.issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {success ? (
        <div className="form-success" role="status">
          {success}
        </div>
      ) : null}
      <div className="btn-row">
        <button type="submit" className={buttonClassName} disabled={pending || disabled}>
          {pending ? "Working…" : submitLabel}
        </button>
        {note ? <span className="form-note">{note}</span> : null}
      </div>
    </form>
  );
}
