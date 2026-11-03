(function () {
  const { useState } = React;
  const D = window.AresiumData;
  const { t } = window.AresiumPages;

  function EmptyDashboard() {
    const handleError = async (e) => {
      try {
        await window.AresiumUpload.send(e.target.files);
        await D.refresh();
      } catch (err) {
        setError(err.message);
      }
    };
    const ref = React.useRef(null);
    const [error, setError] = useState("");
    return <main className="empty-dashboard">
      <img
        src="brand/hermes.png"
        width="50"
        height="50"
        alt="Aresium"
      />
      <h1>
        {t("No data yet")}
      </h1>
      <input
        ref={ref}
        style={{
          display: "none"
        }}
        type="file"
        accept=".csv,.xml"
        multiple
        onChange={handleError}
      />
      <button
        className="recat-btn primary"
        onClick={() => ref.current.click()}
      >
        {t("Import data")}
      </button>
      <a
        className="md-edit"
        href="/demo?tour=1"
      >
        {t("Start tour")}
      </a>
      {error && <p role="alert">
        {error}
      </p>}
    </main>;
  }
  Object.assign(window.AresiumViews, {
    EmptyDashboard
  });
  Object.assign(window, {
    EmptyDashboard
  });
})();
