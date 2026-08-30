const COLORS = { low: '#3B82F6', mid: '#F59E0B', high: '#EF4444' };

export default function DensityRing({ density }) {
  if (!density?.length) return null;

  const max = Math.max(...density.map((d) => d.count), 1);
  const total = density.reduce((sum, b) => sum + b.count, 0);

  return (
    <div className="glass-panel density-panel">
      <svg width="88" height="88" viewBox="0 0 100 100" style={{ flexShrink: 0 }}>
        {density.map((band, idx) => {
          const radius = 12 + idx * 8; // max 44 + strokeWidth/2 stays inside 50-unit half-viewBox
          const circumference = 2 * Math.PI * radius;
          const frac = band.count / max;
          const intensity = frac > 0.66 ? 'high' : frac > 0.33 ? 'mid' : 'low';
          const offset = circumference - frac * circumference;

          return (
            <circle
              key={band.label}
              cx="50" cy="50" r={radius}
              fill="none"
              stroke={COLORS[intensity]}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={band.count ? offset : circumference}
              opacity={0.85}
              transform="rotate(-90 50 50)"
            />
          );
        })}
        <text x="50" y="46" textAnchor="middle" className="density-total" fontSize="17">{total}</text>
        <text x="50" y="60" textAnchor="middle" fill="var(--muted)" fontSize="7" fontFamily="var(--font-mono)">TRACKED</text>
      </svg>

      <div className="density-legend">
        {density.map((band, idx) => {
          const frac = band.count / max;
          const intensity = frac > 0.66 ? 'high' : frac > 0.33 ? 'mid' : 'low';
          return (
            <div key={band.label} className="density-legend-row">
              <span className="legend-dot" style={{ background: COLORS[intensity] }} />
              <span className="density-legend-label">{band.label}</span>
              <span className="density-legend-count">{band.count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
