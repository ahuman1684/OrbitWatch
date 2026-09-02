import { useState, useMemo, useRef, useEffect } from 'react';
import { DEMO_SCENARIOS, RISK_THRESHOLDS } from '../lib/orbital';

export default function Sidebar({ cesium, showDensity, setShowDensity }) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('conjunctions'); // 'conjunctions' | 'objects'
  const [fullList, setFullList] = useState(false); // pins the list open regardless of search
  const wrapRef = useRef(null);

  const { satellites, conjunctions, loading } = cesium;
  const critical = conjunctions.filter((c) => c.riskLevel === 'critical').length;
  const closest = conjunctions.length
    ? Math.min(...conjunctions.map((c) => c.distKm)).toFixed(1)
    : '—';

  const isOpen = fullList || query.trim().length > 0;

  const filteredSats = useMemo(() => {
    if (!query) return satellites;
    const q = query.toLowerCase();
    return satellites.filter((s) => s.name.toLowerCase().includes(q));
  }, [query, satellites]);

  const filteredConjunctions = useMemo(() => {
    if (!query) return conjunctions;
    const q = query.toLowerCase();
    return conjunctions.filter(
      (c) => c.name1.toLowerCase().includes(q) || c.name2.toLowerCase().includes(q)
    );
  }, [query, conjunctions]);

  // Click outside the search + reveal panel collapses it (clears the query,
  // the single source of truth for open/closed) — skipped while pinned open.
  useEffect(() => {
    if (!isOpen || fullList) return;
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setQuery('');
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [isOpen, fullList]);

  const onSearchKeyDown = (e) => {
    if (e.key === 'Escape') {
      setQuery('');
      e.currentTarget.blur();
    }
  };

  return (
    <aside className="glass-panel sidebar">
      <div className="logo-row">
        <span className="logo-dot" />
        <div>
          <div className="logo-text">OrbitWatch</div>
          <div className="logo-sub">SPACE DEBRIS TRACKING SYSTEM</div>
        </div>
      </div>

      <div className="source-switch">
        <button
          className={`source-btn ${cesium.dataSource === 'live' ? 'active' : ''}`}
          onClick={() => cesium.switchDataSource('live')}
        >
          Live Data
        </button>
        <button
          className={`source-btn ${cesium.dataSource === 'demo' ? 'active' : ''}`}
          onClick={() => cesium.switchDataSource('demo')}
        >
          Demo Data
        </button>
      </div>

      {cesium.dataSource === 'demo' && (
        <div className="scenario-row">
          <select
            className="scenario-select"
            value={cesium.demoScenario}
            onChange={(e) => cesium.setDemoScenario(e.target.value)}
            aria-label="Demo scenario"
          >
            {Object.entries(DEMO_SCENARIOS).map(([key, s]) => (
              <option key={key} value={key}>{s.label}</option>
            ))}
          </select>
          <button
            className="play-demo-btn"
            onClick={() => (cesium.playingDemo ? cesium.stopDemo() : cesium.playDemo())}
            disabled={!cesium.conjunctions.length}
          >
            {cesium.playingDemo ? '■ Stop' : '▶ Play Demo'}
          </button>
        </div>
      )}

      {cesium.dataSource === 'demo' ? (
        <div className="stale-indicator demo">◆ {DEMO_SCENARIOS[cesium.demoScenario].description}</div>
      ) : !cesium.hasData ? (
        <div className="stale-indicator">⚠ Live orbital data unavailable — check network connection</div>
      ) : cesium.snapshotCapturedAt ? (
        <div className="stale-indicator">
          ⚠ Live fetch unavailable — showing bundled catalogue snapshot from{' '}
          {new Date(cesium.snapshotCapturedAt).toISOString().slice(0, 10)}
        </div>
      ) : cesium.dataStale ? (
        <div className="stale-indicator">⚠ Showing cached TLE data — live refresh unavailable</div>
      ) : null}

      <div className="sidebar-stats">
        <div className="stat-box">
          <div className="stat-label">Tracked</div>
          <div className="stat-value">{satellites.length || '—'}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Risks</div>
          <div className="stat-value text-warning">{conjunctions.length}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Critical</div>
          <div className="stat-value text-danger">{critical}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Closest</div>
          <div className="stat-value text-danger" style={{ fontSize: 14 }}>{closest}<span style={{ fontSize: 9 }}> km</span></div>
        </div>
      </div>

      <div className="control-grid">
        <Toggle label="Satellites"    isActive={cesium.showSatellites} onClick={() => cesium.setShowSatellites((v) => !v)} />
        <Toggle label="Debris"        isActive={cesium.showDebris}     onClick={() => cesium.setShowDebris((v) => !v)} />
        <Toggle label="Orbit Paths"   isActive={cesium.showOrbits}     onClick={() => cesium.setShowOrbits((v) => !v)} />
        <Toggle label="Risk Colors"   isActive={cesium.showRisk}       onClick={() => cesium.setShowRisk((v) => !v)} />
        <Toggle label="Risk Lines"    isActive={cesium.showLines}      onClick={() => cesium.setShowLines((v) => !v)} />
        <Toggle label="Lat/Long Grid" isActive={cesium.showGraticule}  onClick={() => cesium.setShowGraticule((v) => !v)} />
        <Toggle label="Density Ring"  isActive={showDensity}           onClick={() => setShowDensity((v) => !v)} />
      </div>

      <div className="control-grid" style={{ paddingTop: 0 }}>
        <Toggle
          label="Isolate trajectory on select"
          isActive={cesium.isolateTrajectory}
          onClick={() => cesium.setIsolateTrajectory((v) => !v)}
          wide
        />
        <Toggle label="Full List (pin conjunctions/objects open)" isActive={fullList} onClick={() => setFullList((v) => !v)} wide />
      </div>

      <div className="risk-legend">
        <span className="legend-item" title={`Miss distance < ${RISK_THRESHOLDS.criticalKm} km`}>
          <span className="legend-dot dot-critical" />Critical
        </span>
        <span className="legend-item" title={`Miss distance ${RISK_THRESHOLDS.criticalKm}–${RISK_THRESHOLDS.warningKm} km`}>
          <span className="legend-dot dot-warning" />Warning
        </span>
        <span className="legend-item" title="Debris / rocket body">
          <span className="legend-dot dot-debris" />Debris
        </span>
      </div>

      <div className="search-reveal-wrap" ref={wrapRef}>
        <div className="search-wrap">
          <input
            className="search-input"
            placeholder="Search objects or conjunctions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
          />
        </div>

        <div className={`reveal-panel ${isOpen ? 'open' : ''}`}>
          <div className="reveal-panel-inner">
            <div className="tab-row">
              <button className={`tab ${tab === 'conjunctions' ? 'active' : ''}`} onClick={() => setTab('conjunctions')}>
                Conjunctions
              </button>
              <button className={`tab ${tab === 'objects' ? 'active' : ''}`} onClick={() => setTab('objects')}>
                Objects
              </button>
            </div>

            <div className="list-container">
              {loading ? (
                <div style={{ padding: '0 var(--space-3)' }}>
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="skeleton" style={{ height: 46, marginBottom: 8, borderRadius: 'var(--radius)' }} />
                  ))}
                </div>
              ) : tab === 'conjunctions' ? (
                <ConjunctionList conjunctions={filteredConjunctions} simTime={cesium.simTime} onFocus={cesium.selectConjunction} />
              ) : (
                <ObjectList sats={filteredSats} onFocus={cesium.flyToSat} />
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Toggle({ label, isActive, onClick, wide }) {
  return (
    <div
      className={`toggle-switch ${isActive ? 'active' : ''} ${wide ? 'wide' : ''}`}
      onClick={onClick}
      role="switch"
      aria-checked={isActive}
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <span className="toggle-label">{label}</span>
      <div className="toggle-track"><div className="toggle-thumb" /></div>
    </div>
  );
}

function ConjunctionList({ conjunctions, simTime, onFocus }) {
  if (!conjunctions.length) return <div className="empty">No conjunctions match</div>;

  return conjunctions.slice(0, 20).map((c, idx) => {
    const mins = (c.time.getTime() - simTime.getTime()) / 60000;
    const countdown = Math.abs(mins) < 0.5 ? 'NOW' : mins > 0 ? `T-${mins.toFixed(0)}m` : `T+${Math.abs(mins).toFixed(0)}m`;

    return (
      <div
        key={idx}
        className={`list-item ${c.riskLevel}`}
        style={{ animationDelay: `${idx * 0.02}s` }}
        onClick={() => onFocus(c)}
        tabIndex={0}
        role="button"
        onKeyDown={(e) => e.key === 'Enter' && onFocus(c)}
      >
        <div className="conj-row-top">
          <span className="conj-pair">{c.name1} <span className="conj-sep">↔</span> {c.name2}</span>
        </div>
        <div className="conj-row-bottom">
          <span className={`risk-badge ${c.riskLevel}`}>{c.riskLevel.toUpperCase()}</span>
          <span className="mono text-muted" style={{ fontSize: 10.5 }}>{c.distKm.toFixed(2)} km</span>
          <span className="conj-countdown">{countdown}</span>
        </div>
      </div>
    );
  });
}

function ObjectList({ sats, onFocus }) {
  if (!sats.length) return <div className="empty">No matches</div>;
  return sats.map((s) => (
    <div
      key={s.id}
      className="list-item"
      onClick={() => onFocus(s.id)}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => e.key === 'Enter' && onFocus(s.id)}
    >
      <div className="object-row">
        <span className={`obj-dot ${s.type}`} />
        <div>
          <div className="obj-name">{s.name}</div>
          <div className="obj-sub">
            {s.type === 'satellite' ? 'Satellite' : 'Debris'} · {s.inclination.toFixed(1)}° · {s.periodMin.toFixed(0)} min
          </div>
        </div>
      </div>
    </div>
  ));
}
