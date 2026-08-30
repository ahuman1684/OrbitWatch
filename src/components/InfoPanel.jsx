import { getPosition, julianToDate } from '../lib/orbital';

const EARTH_RADIUS_KM = 6371;
const MU = 398600.4418; // km^3/s^2, standard gravitational parameter of Earth

// Illustrative orbit-shape sketch. Real LEO eccentricities are ~0.0001-0.01
// (visually indistinguishable from a circle), so we exaggerate for legibility
// and say so — this is explicitly schematic, not to scale.
function OrbitSketch({ ecco }) {
  const visualEcco = Math.min(ecco * 10, 0.82);
  const rx = 38;
  const ry = rx * Math.sqrt(1 - visualEcco * visualEcco);
  const cx = 50 - rx * visualEcco;

  return (
    <svg width="100%" height="88" viewBox="0 0 100 90" style={{ display: 'block' }}>
      <ellipse cx={cx} cy="45" rx={rx} ry={ry} fill="none" stroke="var(--accent)" strokeOpacity="0.4" strokeWidth="1.2" strokeDasharray="3 2" />
      <circle cx="50" cy="45" r="7" fill="#12345a" stroke="var(--accent)" strokeWidth="1" />
      <circle cx={cx + rx} cy="45" r="2" fill="var(--warning)" />
    </svg>
  );
}

function InfoRow({ label, value, className }) {
  return (
    <div className="stat-row">
      <span className="text-muted">{label}</span>
      <span className={`mono ${className || ''}`}>{value}</span>
    </div>
  );
}

export default function InfoPanel({ selected, simTime }) {
  if (!selected) {
    return (
      <aside className="glass-panel info-panel">
        <div className="empty-state">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
          </svg>
          <div className="empty-state-text">
            Click any object on the globe or in the sidebar to inspect its orbital parameters.
          </div>
        </div>
      </aside>
    );
  }

  const { satrec } = selected;
  const pos = getPosition(satrec, simTime);

  // Derived elements — real math from the same TLE data already loaded,
  // not fabricated: a = (mu / n^2)^(1/3), apogee/perigee from a and e.
  const meanMotionRadSec = satrec.no / 60;
  const semiMajorAxis = Math.cbrt(MU / meanMotionRadSec ** 2);
  const perigeeAlt = semiMajorAxis * (1 - satrec.ecco) - EARTH_RADIUS_KM;
  const apogeeAlt = semiMajorAxis * (1 + satrec.ecco) - EARTH_RADIUS_KM;

  const epochDate = julianToDate(satrec.jdsatepoch);
  const epochAgeDays = (simTime.getTime() - epochDate.getTime()) / 86400000;

  return (
    <aside className="glass-panel info-panel">
      <div className="panel-header">
        <span className="info-name">{selected.name}</span>
        <span className={`mono ${selected.type === 'debris' ? 'text-muted' : 'text-accent'}`} style={{ fontSize: 9.5 }}>
          {selected.type === 'satellite' ? 'ACTIVE' : 'DEBRIS'}
        </span>
      </div>

      <div className="info-content">
        <InfoRow label="Altitude" value={pos ? `${pos.altKm.toFixed(0)} km` : '—'} />
        <InfoRow label="Velocity" value={pos ? `${pos.speedKms.toFixed(2)} km/s` : '—'} />
        <InfoRow label="Position" value={pos ? `${pos.lat.toFixed(1)}°, ${pos.lon.toFixed(1)}°` : '—'} />

        <div className="info-section-label">Orbit Shape</div>
        <OrbitSketch ecco={satrec.ecco} />
        <div className="sketch-caption">illustrative — eccentricity exaggerated for clarity</div>

        <InfoRow label="Eccentricity" value={satrec.ecco.toFixed(4)} />
        <InfoRow label="Apogee alt."  value={`${apogeeAlt.toFixed(0)} km`} />
        <InfoRow label="Perigee alt." value={`${perigeeAlt.toFixed(0)} km`} />
        <InfoRow label="Inclination" value={`${selected.inclination.toFixed(2)}°`} />
        <InfoRow label="RAAN"        value={`${((satrec.nodeo * 180) / Math.PI).toFixed(2)}°`} />
        <InfoRow label="Arg. Perigee" value={`${((satrec.argpo * 180) / Math.PI).toFixed(2)}°`} />

        <div className="info-section-label">TLE / Timing</div>
        <InfoRow label="Period" value={`${selected.periodMin.toFixed(1)} min`} />
        <InfoRow
          label="Sim time since epoch"
          value={`${epochAgeDays.toFixed(2)} d`}
          className={epochAgeDays > 1 ? 'text-warning' : 'text-accent'}
        />
        <InfoRow label="B* drag term" value={satrec.bstar.toExponential(2)} />
      </div>
    </aside>
  );
}
