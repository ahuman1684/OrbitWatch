import { useRef, useState, useMemo } from 'react';
import { useCesium } from './hooks/useCesium';
import { computeAltitudeDensity, conjunctionsToCSV } from './lib/orbital';
import Sidebar from './components/Sidebar';
import InfoPanel from './components/InfoPanel';
import ConjunctionDetail from './components/ConjunctionDetail';
import TimeScrubber from './components/TimeScrubber';
import NotificationBell from './components/NotificationBell';
import DensityRing from './components/DensityRing';
import HomePage from './components/HomePage';
import AboutModal from './components/AboutModal';

function downloadCSV(conjunctions) {
  const csv = conjunctionsToCSV(conjunctions);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orbitwatch-conjunctions-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function App() {
  const containerRef = useRef(null);
  const cesium = useCesium(containerRef);
  const [showDensity, setShowDensity] = useState(false);
  const [entered, setEntered] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  const density = useMemo(() => {
    if (!cesium.satellites.length) return [];
    return computeAltitudeDensity(cesium.satellites, cesium.simTime);
  }, [cesium.satellites, cesium.simTime]);

  const closeConjunction = () => cesium.setSelectedConjunction(null);

  return (
    <div className="app-shell">
      <div className="globe-wrap">
        <div ref={containerRef} className="cesium-container" />
        {cesium.imagerySource && (
          <div className="imagery-credit">
            {cesium.imagerySource === 'esri'
              ? 'Imagery: Esri, Maxar, Earthstar Geographics'
              : 'Imagery: bundled offline texture (no network)'}
          </div>
        )}
      </div>

      <div className={`overlay ${entered ? '' : 'overlay-hidden'}`}>
        <Sidebar cesium={cesium} showDensity={showDensity} setShowDensity={setShowDensity} />

        {cesium.loading && (
          <div className="status-badge glass-panel">
            <span className="spinner" /> Loading orbital data…
          </div>
        )}

        {!cesium.loading && (
          <TimeScrubber
            simTime={cesium.simTime}
            baseTime={cesium.epochTime}
            onScrub={cesium.jumpToTime}
            onSpeed={cesium.setSpeed}
          />
        )}

        {cesium.selectedConjunction ? (
          <ConjunctionDetail
            conjunction={cesium.selectedConjunction}
            onClose={closeConjunction}
            onDismiss={closeConjunction}
            onSimulate={cesium.simulateMitigation}
          />
        ) : (
          <InfoPanel selected={cesium.selected} simTime={cesium.simTime} />
        )}

        {showDensity && <DensityRing density={density} />}

        <div className="header-icons">
          <button className="icon-circle-btn" onClick={() => setShowAbout(true)} aria-label="About this system" title="Why this matters">
            ⓘ
          </button>
          <button
            className="icon-circle-btn"
            onClick={() => downloadCSV(cesium.conjunctions)}
            aria-label="Export conjunctions as CSV"
            title="Export conjunctions (CSV)"
            disabled={!cesium.conjunctions.length}
          >
            ⬇
          </button>
          <NotificationBell conjunctions={cesium.conjunctions} onFocus={cesium.selectConjunction} />
        </div>
      </div>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}

      <HomePage entered={entered} onEnter={() => setEntered(true)} />
    </div>
  );
}
