export default function AboutModal({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass-panel about-modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span>Why This Matters</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="info-content about-content">
          <p>
            Low Earth Orbit holds an estimated 1M+ debris fragments larger than 1cm — most
            of it from two events this dashboard tracks directly.
          </p>

          <div className="about-event">
            <div className="about-event-title">Fengyun-1C · 11 Jan 2007</div>
            <p>
              China's anti-satellite missile test destroyed its own defunct weather
              satellite, creating <strong>3,531 cataloged fragments</strong> — the single
              largest debris-generating event in spaceflight history. Roughly 2,300 pieces
              are still tracked today.
            </p>
          </div>

          <div className="about-event">
            <div className="about-event-title">Cosmos 2251 / Iridium 33 · 10 Feb 2009</div>
            <p>
              The first accidental collision between two intact satellites — a defunct
              Russian military satellite and an active Iridium communications satellite —
              produced <strong>~2,370 fragments</strong> in a single instant.
            </p>
          </div>

          <p>
            Both fields are still up there, still being tracked, and still capable of
            triggering further collisions — the <em>Kessler syndrome</em> scenario where
            debris begets more debris. That's the risk this dashboard is built to catch
            before it happens, not after.
          </p>

          <div className="open-data-badge">
            ◆ Built entirely on free, open data — CelesTrak (TLEs) + Esri (imagery).
            No paid APIs, no commercial tracking service required. Any institution can
            run this.
          </div>
        </div>
      </div>
    </div>
  );
}
