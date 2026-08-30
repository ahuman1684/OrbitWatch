import { useState, useEffect, useRef } from 'react';

export default function NotificationBell({ conjunctions, onFocus }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(new Set());
  const [pulse, setPulse] = useState(false);
  const seenRef = useRef(new Set());
  const wrapRef = useRef(null);

  const criticals = conjunctions.filter((c) => c.riskLevel === 'critical');
  const visible = criticals.filter((c) => !dismissed.has(`${c.i}_${c.j}`));

  // Pulse briefly when a genuinely new critical conjunction first appears.
  useEffect(() => {
    const fresh = criticals.some((c) => {
      const key = `${c.i}_${c.j}`;
      if (seenRef.current.has(key)) return false;
      seenRef.current.add(key);
      return true;
    });
    if (fresh) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 2200);
      return () => clearTimeout(t);
    }
  }, [criticals]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const dismiss = (c) => setDismissed((prev) => new Set(prev).add(`${c.i}_${c.j}`));

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button
        className={`bell-btn ${pulse ? 'pulse' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Critical conjunction alerts"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {visible.length > 0 && <span className="bell-badge">{visible.length}</span>}
      </button>

      {open && (
        <div className="glass-panel bell-popover">
          <div className="panel-header">
            <span>Critical Conjunctions</span>
            <span className="mono text-danger">{visible.length}</span>
          </div>
          <div className="bell-popover-list">
            {visible.length === 0 ? (
              <div className="empty">No active critical conjunctions</div>
            ) : (
              visible.map((c) => (
                <div key={`${c.i}_${c.j}`} className="bell-item">
                  <div className="toast-title">⚠ CRITICAL CONJUNCTION</div>
                  <div className="toast-text">{c.name1} ↔ {c.name2}</div>
                  <div className="toast-dist">
                    Closest approach: <strong>{c.distKm.toFixed(2)} km</strong> · TCA {c.time.toUTCString().slice(17, 22)} UTC
                  </div>
                  <div className="toast-actions">
                    <button className="toast-btn primary" onClick={() => { onFocus(c); dismiss(c); }}>Track</button>
                    <button className="toast-btn" onClick={() => dismiss(c)}>Dismiss</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
