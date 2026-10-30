export default function Loading() {
  return (
    <main className="login-shell" aria-busy="true">
      <div className="empty" style={{ gridColumn: "1 / -1", alignSelf: "center" }}>
        <div className="empty__title">Loading…</div>
        <p className="empty__desc">Preparing the register. Synthetic demo data only.</p>
      </div>
    </main>
  );
}
