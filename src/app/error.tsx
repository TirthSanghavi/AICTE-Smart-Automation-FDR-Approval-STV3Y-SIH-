"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="login-shell">
      <div className="empty" style={{ gridColumn: "1 / -1", alignSelf: "center" }}>
        <h1 className="empty__title">Something went wrong</h1>
        <p className="empty__desc">
          This screen could not be loaded. No changes were saved. Try again, or return to the
          sign-in page.
          {error.digest ? <span className="mono"> · Ref {error.digest}</span> : null}
        </p>
        <div className="btn-row" style={{ justifyContent: "center" }}>
          <button type="button" className="btn" onClick={() => reset()}>
            Try again
          </button>
          <a href="/login" className="btn btn--ghost">
            Go to sign in
          </a>
        </div>
      </div>
    </main>
  );
}
