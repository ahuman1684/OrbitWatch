import { useRef, useState, useMemo } from 'react';
import { useCesium } from './hooks/useCesium';
import { computeAltitudeDensity } from './lib/orbital';
import Sidebar from './components/Sidebar';
import InfoPanel from './components/InfoPanel';
import TimeScrubber from './components/TimeScrubber';
import NotificationBell from './components/NotificationBell';
import DensityRing from './components/DensityRing';

export default function App() {
  const containerRef = useRef(null);
  const cesium = useCesium(containerRef);
  const [showDensity, setShowDensity] = useState(false);

  const density = useMemo(() => {
    if (!cesium.satellites.length) return [];
    return computeAltitudeDensity(cesium.satellites, cesium.simTime);
  }, [cesium.satellites, cesium.simTime]);

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

      <div className="overlay">
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

        <InfoPanel selected={cesium.selected} simTime={cesium.simTime} />

        {showDensity && <DensityRing density={density} />}

        <NotificationBell conjunctions={cesium.conjunctions} onFocus={cesium.flyToConjunction} />
      </div>
    </div>
  );
}
