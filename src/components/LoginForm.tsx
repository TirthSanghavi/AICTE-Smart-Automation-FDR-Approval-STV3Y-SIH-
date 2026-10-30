"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

const DEMO_ACCOUNTS = [
  { label: "Institution admin", email: "admin@sunrise.demo", hint: "Sunrise Institute" },
  { label: "Scrutiny officer", email: "officer@aicte.demo", hint: "Queues and findings" },
  { label: "Departmental reviewer", email: "reviewer@aicte.demo", hint: "Clearances" },
  { label: "Competent authority", email: "authority@aicte.demo", hint: "Decisions" },
  { label: "Auditor", email: "auditor@aicte.demo", hint: "Read-only audit" },
  { label: "Institution viewer", email: "viewer@sunrise.demo", hint: "Read-only own data" },
  { label: "Other institution", email: "admin@lakeview.demo", hint: "Isolation demo" },
  { label: "System admin", email: "sysadmin@aicte.demo", hint: "Rules and clock" },
];

const DEMO_PASSWORD = "Demo@1234";

type ApiError = {
  code?: string;
  message?: string;
};

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@sunrise.demo");
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: ApiError }
        | null;
      if (!response.ok) {
        setError(body?.error ?? { message: "Sign-in failed." });
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError({ message: "Network error. Try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-form-wrap">
      <div className="eyebrow">Synthetic demo access</div>
      <h2>Sign in to the register</h2>
      <p className="page-head__desc">
        Choose a seeded demonstration role. No real institution, person or bank data is used.
      </p>

      <form className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <span className="field__hint">Every demo account uses {DEMO_PASSWORD}.</span>
        </div>
        {error ? (
          <div className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
            {error.code ? <span className="form-error__code">{error.code}</span> : null}
            {error.message}
          </div>
        ) : null}
        <button type="submit" className="btn btn--block" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="demo-accounts">
        <div className="demo-accounts__label">
          <span>Demo accounts</span>
          <span>Password shared</span>
        </div>
        <div className="demo-grid">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              className="demo-account"
              onClick={() => {
                setEmail(account.email);
                setPassword(DEMO_PASSWORD);
                setError(null);
              }}
            >
              <span className="demo-account__role">{account.label}</span>
              <span className="demo-account__email">{account.email}</span>
              <span className="field__hint">{account.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
