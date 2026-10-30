export default function InstitutionsLoading() {
  return (
    <div className="stack" aria-busy="true">
      <div className="eyebrow">Loading…</div>
      <div className="card">
        <div className="card__body">
          <div className="empty">
            <div className="empty__title">Loading institutions…</div>
            <p className="empty__desc">Fetching the directory for your role.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
