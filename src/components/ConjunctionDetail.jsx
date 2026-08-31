import { useState, useMemo } from 'react';

function formatPc(pc) {
  if (pc == null) return '—';
  if (pc < 1e-12) return '< 1e-12';
  return pc.toExponential(2);
}

export default function ConjunctionDetail({ conjunction, onClose, onSimulate, onDismiss }) {
  const [nudge, setNudge] = useState(0);

  const simulated = useMemo(() => {
    if (nudge === 0) return null;
    return onSimulate(nudge);
  }, [nudge, onSimulate, conjunction]);

  if (!conjunction) return null;
  const c = conjunction;

  return (
    <aside className="glass-panel info-panel conjunction-detail">
      <div className="panel-header">
        <span>Conjunction Detail</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="info-content">
        <div className="info-name" style={{ marginBottom: 4 }}>{c.name1} <span className="text-muted">↔</span> {c.name2}</div>
        <span className={`risk-badge ${c.riskLevel}`}>{c.riskLevel.toUpperCase()}</span>

        <div className="stat-row" style={{ marginTop: 10 }}>
          <span className="text-muted">Miss distance</span>
          <span className="mono">{c.distKm.toFixed(3)} km</span>
        </div>
        <div className="stat-row">
          <span className="text-muted">TCA (UTC)</span>
          <span className="mono">{c.time.toUTCString().slice(5, 22)}</span>
        </div>
        <div className="stat-row">
          <span className="text-muted">Relative velocity</span>
          <span className="mono">{c.relativeVelocityKmS != null ? `${c.relativeVelocityKmS.toFixed(2)} km/s` : '—'}</span>
        </div>
        <div className="stat-row">
          <span className="text-muted" title="Simplified 2D encounter-plane estimate (Pc ≈ HBR²/2σ² · e^(−d²/2σ²)), using typical published SGP4 error growth as σ since TLEs carry no real covariance data. Not a rigorous agency-grade probability.">
            Estimated Pc ⓘ
          </span>
          <span className="mono text-warning">{formatPc(c.pcEstimate)}</span>
        </div>

        <div className="info-section-label">Avoidance What-If</div>
        <div className="mitigation-caption">
          Illustrative only — simulates nudging {c.name1} along its own velocity direction, not a real burn/orbit propagation.
        </div>
        <input
          type="range"
          min="-1000"
          max="1000"
          step="10"
          value={nudge}
          onChange={(e) => setNudge(Number(e.target.value))}
          className="mitigation-slider"
          aria-label="Simulated along-track nudge in meters"
        />
        <div className="mitigation-value mono">{nudge > 0 ? '+' : ''}{nudge} m nudge</div>

        {simulated && (
          <div className={`mitigation-result ${simulated.newRisk || 'safe'}`}>
            <div className="stat-row">
              <span className="text-muted">New miss distance</span>
              <span className="mono">{simulated.newDistKm.toFixed(3)} km</span>
            </div>
            <div className="stat-row">
              <span className="text-muted">New estimated Pc</span>
              <span className="mono">{formatPc(simulated.newPc)}</span>
            </div>
            <div className="stat-row">
              <span className="text-muted">Resulting tier</span>
              <span className={`mono ${simulated.newRisk ? `text-${simulated.newRisk === 'critical' ? 'danger' : 'warning'}` : 'text-accent'}`}>
                {simulated.newRisk ? simulated.newRisk.toUpperCase() : 'CLEARED'}
              </span>
            </div>
          </div>
        )}

        <div className="toast-actions" style={{ marginTop: 12 }}>
          <button className="toast-btn" onClick={() => onDismiss(c)}>Dismiss</button>
        </div>
      </div>
    </aside>
  );
}
