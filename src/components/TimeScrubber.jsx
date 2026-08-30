import { useState, useRef } from 'react';

const SPEEDS = [
  { label: '1×',   value: 1 },
  { label: '60×',  value: 60 },
  { label: '300×', value: 300 },
  { label: '1h×',  value: 3600 },
];

// Scrub range relative to the TLE-epoch anchor (see App.jsx / useCesium),
// not a wall-clock calendar day — conjunctions are detected in a 24h window
// starting at that epoch, so the range has to line up with it or some
// flagged events end up unreachable on the slider.
const MIN_OFFSET = -6 * 3600;  // seconds
const MAX_OFFSET = 24 * 3600;

export default function TimeScrubber({ simTime, baseTime, onScrub, onSpeed }) {
  const [speed, setSpeed] = useState(60);
  const baseNowRef = useRef(baseTime?.getTime() ?? Date.now());
  const lockedRef = useRef(!!baseTime);
  if (baseTime && !lockedRef.current) {
    baseNowRef.current = baseTime.getTime();
    lockedRef.current = true;
  }

  const offset = Math.round((simTime.getTime() - baseNowRef.current) / 1000);
  const clamped = Math.max(MIN_OFFSET, Math.min(MAX_OFFSET, offset));
  const pct = ((clamped - MIN_OFFSET) / (MAX_OFFSET - MIN_OFFSET)) * 100;

  const handleSlider = (e) => {
    const val = Number(e.target.value); // 0..1000
    const secs = MIN_OFFSET + (val / 1000) * (MAX_OFFSET - MIN_OFFSET);
    onScrub(new Date(baseNowRef.current + secs * 1000));
  };

  const pickSpeed = (v) => {
    setSpeed(v);
    onSpeed(v);
  };

  const offsetLabel = () => {
    const h = clamped / 3600;
    if (Math.abs(h) < 0.05) return 'EPOCH';
    const sign = h > 0 ? '+' : '−';
    return `${sign}${Math.abs(h).toFixed(1)}h`;
  };

  return (
    <div className="glass-panel time-scrubber">
      <div className="scrubber-top">
        <span className="scrubber-time mono">{simTime.toUTCString().slice(5, 25)} UTC</span>
        <span className={`scrubber-offset ${clamped !== 0 ? 'shifted' : ''}`}>{offsetLabel()}</span>
      </div>

      <div className="scrubber-track-wrap">
        <input
          type="range"
          min="0"
          max="1000"
          value={((clamped - MIN_OFFSET) / (MAX_OFFSET - MIN_OFFSET)) * 1000}
          onChange={handleSlider}
          className="scrubber-slider"
          style={{ '--pct': `${pct}%` }}
          aria-label="Time scrubber"
        />
        <div className="scrubber-nowmark" style={{ left: `${(6 / 30) * 100}%` }} />
      </div>

      <div className="scrubber-bottom">
        <span className="scrubber-tick">−6h</span>
        <div className="speed-group">
          {SPEEDS.map((s) => (
            <button
              key={s.value}
              className={`speed-btn ${speed === s.value ? 'active' : ''}`}
              onClick={() => pickSpeed(s.value)}
              aria-label={`Set speed to ${s.label}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="scrubber-tick">+24h</span>
      </div>
    </div>
  );
}
