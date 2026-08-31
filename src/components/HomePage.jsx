export default function HomePage({ entered, onEnter }) {
  return (
    <div className={`home-overlay ${entered ? 'home-hidden' : ''}`}>
      <div className="home-content">
        <div className="home-logo">
          <span className="home-logo-dot" />
          <div className="home-logo-ring" />
        </div>
        <div className="home-title">OrbitWatch</div>
        <div className="home-tagline">Space Debris Tracking &amp; Conjunction Risk Dashboard</div>
        <div className="home-sub">Live orbital data · Zero paid APIs</div>

        <button className="home-enter-btn" onClick={onEnter}>
          Enter Dashboard
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      <div className="home-team">
        <div className="home-team-label">Team</div>
        <div className="home-team-names">
          Kartik Thalore, GajendraNath Soren, Anubhab Das, Sakshi, Mohd. Ayan, Saswat
        </div>
      </div>
    </div>
  );
}
