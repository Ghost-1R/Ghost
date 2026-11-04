export default function WorkspaceLoading() {
  return (
    <div className="stack" aria-busy="true">
      <div className="page-head">
        <div>
          <p className="eyebrow">Ghost</p>
          <h1>Loading</h1>
        </div>
      </div>
      <div className="panel skeleton-panel" />
      <div className="panel skeleton-panel" />
    </div>
  );
}
