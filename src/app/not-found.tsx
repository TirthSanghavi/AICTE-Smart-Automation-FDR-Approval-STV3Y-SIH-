import Link from "next/link";

export default function NotFound() {
  return (
    <main className="login-shell">
      <div className="empty" style={{ gridColumn: "1 / -1", alignSelf: "center" }}>
        <h1 className="empty__title">Page not found</h1>
        <p className="empty__desc">
          That address does not exist in this prototype. Records you cannot see also return
          this screen rather than revealing whether they exist.
        </p>
        <div className="btn-row" style={{ justifyContent: "center" }}>
          <Link href="/" className="btn">
            Back to the register
          </Link>
          <Link href="/login" className="btn btn--ghost">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
