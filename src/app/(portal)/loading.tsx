export default function PortalLoading() {
  return (
    <div className="stack" aria-busy="true">
      <div className="eyebrow">Loading…</div>
      <div className="stat-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <div className="stat" key={index}>
            <span className="stat__label"> </span>
            <span className="stat__value">    </span>
            <span className="stat__detail"> </span>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card__body">
          <div className="empty">
            <div className="empty__title">Loading…</div>
            <p className="empty__desc">Fetching records for your role.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
