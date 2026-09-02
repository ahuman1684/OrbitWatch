import { useEffect, useRef, useState, useCallback } from 'react';
import * as Cesium from 'cesium';
import {
  fetchObjects,
  buildSatellites,
  getPosition,
  computeOrbitPath,
  computeGroundTrack,
  computeConjunctions,
  meanEpochDate,
  simulateNudge,
  DEMO_SCENARIOS,
} from '../lib/orbital';

// TLE cache TTL is a few hours; re-check on this cadence so a refresh is
// picked up promptly and conjunctions stay current with wall-clock time —
// matches "recomputed... on a periodic timer (every 15 min)".
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

const COLORS = {
  satellite: Cesium.Color.fromCssColorString('#3B82F6'),
  debris:    Cesium.Color.fromCssColorString('#94A3B8'),
  critical:  Cesium.Color.fromCssColorString('#EF4444'),
  warning:   Cesium.Color.fromCssColorString('#F59E0B'),
};

const ESRI_IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS_URL  = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

function offlineImageryProvider() {
  return new Cesium.TileMapServiceImageryProvider({
    url: Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
  });
}

// Real satellite-photo Earth imagery when the network is up; a guaranteed
// offline-safe bundled texture when it isn't. Same resilience pattern as
// fetchObjects() in lib/orbital.js — never let a live dependency blank the globe.
//
// The Viewer is always constructed synchronously with the offline texture
// (delaying construction behind an await left the globe surface black in
// testing — its tile pipeline wants to be wired up in the same tick the
// Viewer is created). Once the ESRI probe resolves, this *swaps* the base
// layer via remove+add rather than stacking a second layer on top — adding
// on top of an already-settled globe didn't reliably force new tile
// requests either.
async function upgradeToSatelliteImagery(viewer, isLive) {
  try {
    const probe = await fetch(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/0/0/0',
      { signal: AbortSignal.timeout(3500) }
    );
    if (!isLive() || !probe.ok) return null;

    const offlineLayer = viewer.imageryLayers.get(0);
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: ESRI_IMAGERY_URL,
        credit: 'Esri, Maxar, Earthstar Geographics',
        maximumLevel: 17,
      })
    );
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({ url: ESRI_LABELS_URL, maximumLevel: 17 })
    );
    if (offlineLayer) viewer.imageryLayers.remove(offlineLayer, true);
    return 'esri';
  } catch (e) {
    console.info('Satellite imagery unavailable, staying on bundled offline Earth texture.');
    return null;
  }
}

// Lat/long graticule — reference grid + degree labels so a viewer can read
// off the exact coordinates of a trajectory or conjunction point on demand.
function buildGraticule(viewer) {
  const line = Cesium.Color.fromCssColorString('#7FB2FF').withAlpha(0.28);
  const emph = Cesium.Color.fromCssColorString('#7FB2FF').withAlpha(0.5);
  const labelColor = Cesium.Color.fromCssColorString('#CBD5E1');
  const entities = [];

  for (let lon = -180; lon < 180; lon += 30) {
    const coords = [];
    for (let lat = -85; lat <= 85; lat += 5) coords.push(lon, lat);
    entities.push(viewer.entities.add({
      graticule: true,
      show: false,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(coords),
        width: 1,
        material: lon === 0 ? emph : line,
        arcType: Cesium.ArcType.NONE,
      },
    }));
  }

  for (let lat = -60; lat <= 60; lat += 30) {
    const coords = [];
    for (let lon = -180; lon <= 180; lon += 10) coords.push(lon, lat);
    entities.push(viewer.entities.add({
      graticule: true,
      show: false,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(coords),
        width: 1,
        material: lat === 0 ? emph : line,
        arcType: Cesium.ArcType.NONE,
      },
    }));
  }

  const labelStyle = {
    font: '10px "JetBrains Mono", monospace',
    fillColor: labelColor,
    outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
    outlineWidth: 2,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
  };

  [-60, -30, 30, 60].forEach((lat) => {
    entities.push(viewer.entities.add({
      graticule: true,
      show: false,
      position: Cesium.Cartesian3.fromDegrees(0, lat),
      label: { text: `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`, ...labelStyle },
    }));
  });

  [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180].forEach((lon) => {
    entities.push(viewer.entities.add({
      graticule: true,
      show: false,
      position: Cesium.Cartesian3.fromDegrees(lon, 0),
      label: {
        text: lon === 0 ? '0°' : `${Math.abs(lon)}°${lon > 0 ? 'E' : 'W'}`,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        ...labelStyle,
      },
    }));
  });

  return entities;
}

// Colored core + dark outline reads clearly against any background — ocean
// blue, desert tan, or cloud white — unlike a glow, which needs a dark
// background to show up against. Fully opaque so type/risk colors (blue
// satellite / gray debris / orange warning / red critical) stay distinct
// even over busy imagery.
function trajectoryMaterial(color) {
  return new Cesium.PolylineOutlineMaterialProperty({
    color,
    outlineWidth: 1,
    outlineColor: Cesium.Color.BLACK.withAlpha(0.55),
  });
}
const ORBIT_WIDTH = 2.2;

// Distinct bright highlight for the currently-selected object's trajectory —
// deliberately unlike any type/risk color so "this is the one you clicked"
// is unambiguous regardless of what it's colored underneath.
function highlightMaterial() {
  return new Cesium.PolylineOutlineMaterialProperty({
    color: Cesium.Color.WHITE,
    outlineWidth: 2,
    outlineColor: Cesium.Color.fromCssColorString('#3B82F6'),
  });
}
const HIGHLIGHT_WIDTH = 3.4;

function normalColorFor(sat, conj) {
  const risk = conj.find((c) => c.i === sat.id || c.j === sat.id);
  return risk ? COLORS[risk.riskLevel] : COLORS[sat.type];
}

export function useCesium(containerRef) {
  const viewerRef       = useRef(null);
  const satsRef         = useRef([]);
  const entityMapRef    = useRef(new Map());   // id -> point entity
  const orbitMapRef     = useRef(new Map());   // id -> orbit polyline
  const conjLinesRef    = useRef([]);          // conjunction line entities
  const graticuleRef    = useRef([]);          // lat/long grid entities
  const lastTickRef     = useRef(0);
  const conjTokenRef    = useRef(0);           // guards overlapping/stale conjunction computations
  const highlightedIdRef = useRef(null);       // sat id whose trajectory is highlighted (selected)
  const dataSourceRef   = useRef('live');      // 'live' | 'demo' — read inside closures/timers
  const demoScenarioRef = useRef('mixed');     // key into DEMO_SCENARIOS — read inside closures
  const refreshFnRef    = useRef(null);        // set once the init effect defines refreshData
  const groundTrackRef  = useRef(null);        // single ground-track polyline (selected object only)
  const trailRef        = useRef(null);        // single comet-trail polyline (selected object only)
  const trailPointsRef  = useRef([]);          // rolling recent-position buffer for the trail
  const playTimersRef   = useRef([]);          // pending timeouts for the guided demo sequence
  const conjunctionsRef = useRef([]);          // kept in sync with `conjunctions` state for use in delayed callbacks

  const [loading, setLoading]           = useState(true);
  const [satellites, setSatellites]     = useState([]);
  const [conjunctions, setConjunctions] = useState([]);
  const [simTime, setSimTime]           = useState(new Date());
  const [epochTime, setEpochTime]       = useState(null);
  const [selected, setSelected]         = useState(null);
  const [selectedConjunction, setSelectedConjunction] = useState(null);
  const [imagerySource, setImagerySource] = useState(null); // 'esri' | 'offline'
  const [dataStale, setDataStale]       = useState(false);
  const [hasData, setHasData]           = useState(true); // false only once a load has actually failed
  // Capture date of the bundled snapshot, set only when live + cache both
  // failed and we fell back to it — so the UI can label the data honestly.
  const [snapshotCapturedAt, setSnapshotCapturedAt] = useState(null);
  const [dataSource, setDataSource]     = useState('live'); // 'live' | 'demo'
  const [demoScenario, setDemoScenarioState] = useState('mixed'); // key into DEMO_SCENARIOS
  const [playingDemo, setPlayingDemo]   = useState(false);

  // toggles
  const [showOrbits, setShowOrbits]         = useState(true);
  const [showDebris, setShowDebris]         = useState(true);
  const [showSatellites, setShowSatellites] = useState(true);
  const [showRisk, setShowRisk]             = useState(true);
  const [showLines, setShowLines]           = useState(true);
  const [showGraticule, setShowGraticule]   = useState(false);
  // When on (default), selecting an object hides every other trajectory so
  // only the selected one's path remains; off restores the "all shown" view.
  const [isolateTrajectory, setIsolateTrajectory] = useState(true);

  // ── Init viewer ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    Cesium.Ion.defaultAccessToken = '';

    const viewer = new Cesium.Viewer(containerRef.current, {
      imageryProvider: offlineImageryProvider(),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      creditContainer: document.createElement('div'),
    });

    viewer.scene.backgroundColor    = Cesium.Color.fromCssColorString('#050A14');
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.globe.enableLighting = true;
    viewer.clock.multiplier         = 60;
    viewer.clock.shouldAnimate      = true;
    viewerRef.current = viewer;
    setImagerySource('offline');

    graticuleRef.current = buildGraticule(viewer);

    upgradeToSatelliteImagery(viewer, () => viewerRef.current === viewer).then((source) => {
      if (source && viewerRef.current === viewer) setImagerySource(source);
    });

    // click handler
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      if (Cesium.defined(picked) && picked.id?.satId !== undefined) {
        const sat = satsRef.current.find((s) => s.id === picked.id.satId);
        setSelected(sat || null);
      } else {
        setSelected(null);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Fetches TLEs for the given source and rebuilds satellite records +
    // conjunctions. Called on mount, on a wall-clock timer (live only), and
    // whenever switchDataSource() swaps live/demo — never tied to simTime.
    async function refreshData(isFirstLoad, source) {
      let tles, stale, gotData, snapshotAt = null;
      if (source === 'demo') {
        tles = DEMO_SCENARIOS[demoScenarioRef.current].tles;
        stale = false;
        gotData = true;
      } else {
        const result = await fetchObjects();
        tles = result.tles;
        stale = result.stale;
        gotData = result.hasData;
        snapshotAt = result.usedSnapshot ? result.snapshotCapturedAt : null;
      }
      if (viewerRef.current !== viewer) return; // unmounted before fetch resolved

      setDataStale(stale);
      setHasData(gotData);
      setSnapshotCapturedAt(snapshotAt);

      const sats = buildSatellites(tles);
      const countChanged = sats.length !== satsRef.current.length;
      satsRef.current = sats;
      setSatellites(sats);

      let anchor;
      if (isFirstLoad) {
        // Anchor the clock to the TLE epoch, not wall-clock time — SGP4
        // error compounds propagating far from epoch (see meanEpochDate).
        // Live data's epoch tracks real time closely; demo data's epoch is
        // fixed in the past (Jan 2024), so this matters even more there.
        anchor = meanEpochDate(sats);
        setEpochTime(anchor);
        setSimTime(anchor);
        viewer.clock.currentTime = Cesium.JulianDate.fromDate(anchor);
      } else {
        anchor = Cesium.JulianDate.toDate(viewer.clock.currentTime);
      }

      if (isFirstLoad || countChanged) {
        renderEntities(viewer, sats, anchor);
        setSelected(null); // old selection may reference a destroyed entity
        setSelectedConjunction(null);
        highlightedIdRef.current = null;
        // Not tracked in entityMapRef/orbitMapRef, so renderEntities() doesn't
        // clean these up — clear explicitly or they're orphaned on rebuild.
        clearGroundTrack(viewer);
        clearTrail(viewer);
      }

      // Conjunction detection is decoupled from the scrubber. For live data
      // it's anchored to real wall-clock "now" (epoch tracks real time
      // closely); for demo data — fixed historical elements — it's anchored
      // to the TLE epoch instead, the same reasoning as the clock above.
      const conjCenter = source === 'demo' ? meanEpochDate(sats) : new Date();
      const token = ++conjTokenRef.current;
      const conj = await computeConjunctions(sats, conjCenter);
      if (viewerRef.current !== viewer || token !== conjTokenRef.current) return;
      setConjunctions(conj);
      recolorEntities(sats, conj);
      drawConjunctionLines(viewer, sats, conj, Cesium.JulianDate.toDate(viewer.clock.currentTime));

      if (isFirstLoad) setLoading(false);
    }

    refreshFnRef.current = refreshData;

    refreshData(true, dataSourceRef.current).then(() => {
      if (viewerRef.current !== viewer) return;
      // animation loop — always reads satsRef.current so a later refresh's
      // rebuilt satellite records are picked up, not a stale closure.
      viewer.scene.preRender.addEventListener(() => {
        const t = Cesium.JulianDate.toDate(viewer.clock.currentTime);
        if (t.getTime() - lastTickRef.current > 400) {
          lastTickRef.current = t.getTime();
          updatePositions(satsRef.current, t);
          updateConjunctionLines(satsRef.current, t);
          if (highlightedIdRef.current !== null) {
            const sat = satsRef.current.find((s) => s.id === highlightedIdRef.current);
            const pos = sat && getPosition(sat.satrec, t);
            if (pos) updateTrail(viewer, pos.cartesian);
          }
          setSimTime(new Date(t));
        }
      });
    });

    // Demo data is static — no point re-fetching/re-anchoring it every cycle.
    const refreshIntervalId = setInterval(() => {
      if (dataSourceRef.current === 'live') refreshData(false, 'live');
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(refreshIntervalId);
      handler.destroy();
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [containerRef]);

  // ── Render all entities ──────────────────────────────────────────────────
  // Actually removes the previous entities from the scene, not just the
  // tracking maps — otherwise switching data sources (or any count-changing
  // refresh) leaves the old points/orbits orphaned but still rendered.
  function renderEntities(viewer, sats, now) {
    entityMapRef.current.forEach((e) => viewer.entities.remove(e));
    orbitMapRef.current.forEach((o) => viewer.entities.remove(o));
    entityMapRef.current.clear();
    orbitMapRef.current.clear();

    sats.forEach((sat) => {
      const pos = getPosition(sat.satrec, now);
      if (!pos) return;
      const color = COLORS[sat.type];

      const point = viewer.entities.add({
        satId: sat.id,
        position: pos.cartesian,
        point: {
          pixelSize: sat.type === 'satellite' ? 8 : 5,
          color,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
          outlineWidth: 2,
        },
        label: {
          text: sat.name,
          font: '11px "JetBrains Mono", monospace',
          fillColor: Cesium.Color.WHITE.withAlpha(0.9),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(12, -8),
          show: false,
        },
      });
      entityMapRef.current.set(sat.id, point);

      const orbit = viewer.entities.add({
        polyline: {
          positions: computeOrbitPath(sat.satrec, now),
          width: ORBIT_WIDTH,
          material: trajectoryMaterial(color),
          arcType: Cesium.ArcType.NONE,
        },
      });
      orbitMapRef.current.set(sat.id, orbit);
    });
  }

  // ── Ground track + comet trail — richer detail for whatever's selected,
  // rather than more always-on clutter across every object. ──────────────
  function showGroundTrack(viewer, sat, now) {
    clearGroundTrack(viewer);
    if (!sat) return;
    groundTrackRef.current = viewer.entities.add({
      polyline: {
        positions: computeGroundTrack(sat.satrec, now),
        width: 1.5,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.WHITE.withAlpha(0.5),
          dashLength: 6,
        }),
        arcType: Cesium.ArcType.NONE,
        clampToGround: false,
      },
    });
  }

  function clearGroundTrack(viewer) {
    if (groundTrackRef.current) {
      viewer.entities.remove(groundTrackRef.current);
      groundTrackRef.current = null;
    }
  }

  function updateTrail(viewer, cartesianPosition) {
    const buf = trailPointsRef.current;
    buf.push(cartesianPosition);
    if (buf.length > 30) buf.shift();
    if (buf.length < 2) return;

    if (trailRef.current) {
      trailRef.current.polyline.positions = buf.slice();
    } else {
      trailRef.current = viewer.entities.add({
        polyline: {
          positions: buf.slice(),
          width: 3,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.28,
            color: Cesium.Color.WHITE.withAlpha(0.85),
          }),
          arcType: Cesium.ArcType.NONE,
        },
      });
    }
  }

  function clearTrail(viewer) {
    trailPointsRef.current = [];
    if (trailRef.current) {
      viewer.entities.remove(trailRef.current);
      trailRef.current = null;
    }
  }

  function updatePositions(sats, now) {
    sats.forEach((sat) => {
      const e = entityMapRef.current.get(sat.id);
      if (!e) return;
      const p = getPosition(sat.satrec, now);
      if (p) e.position = p.cartesian;
    });
  }

  // ── Recolor based on risk ────────────────────────────────────────────────
  // Skips the currently-highlighted (selected) entity, if any — its
  // trajectory stays on the highlight material until deselected rather than
  // being overwritten back to its type/risk color on every recolor pass.
  function recolorEntities(sats, conj) {
    sats.forEach((sat) => {
      const e = entityMapRef.current.get(sat.id);
      const o = orbitMapRef.current.get(sat.id);
      if (!e) return;

      const color = normalColorFor(sat, conj);
      e.point.color = color;
      e.point.outlineColor = Cesium.Color.BLACK.withAlpha(0.6);
      if (o && sat.id !== highlightedIdRef.current) {
        o.polyline.material = trajectoryMaterial(color);
      }
    });
  }

  // ── Conjunction connecting lines ─────────────────────────────────────────
  function drawConjunctionLines(viewer, sats, conj, now) {
    conjLinesRef.current.forEach((l) => viewer.entities.remove(l));
    conjLinesRef.current = [];

    conj.forEach((c) => {
      const p1 = getPosition(sats[c.i].satrec, now);
      const p2 = getPosition(sats[c.j].satrec, now);
      if (!p1 || !p2) return;

      const line = viewer.entities.add({
        conjKey: `${c.i}_${c.j}`,
        polyline: {
          positions: [p1.cartesian, p2.cartesian],
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: COLORS[c.riskLevel].withAlpha(0.8),
            dashLength: 8,
          }),
          arcType: Cesium.ArcType.NONE,
        },
      });
      conjLinesRef.current.push(line);
    });
  }

  function updateConjunctionLines(sats, now) {
    conjLinesRef.current.forEach((line) => {
      const [i, j] = line.conjKey.split('_').map(Number);
      const p1 = getPosition(sats[i].satrec, now);
      const p2 = getPosition(sats[j].satrec, now);
      if (p1 && p2) {
        line.polyline.positions = [p1.cartesian, p2.cartesian];
      }
    });
  }

  // ── Public actions ──────────────────────────────────────────────────────
  const switchDataSource = useCallback((source) => {
    if (dataSourceRef.current === source || !refreshFnRef.current) return;
    dataSourceRef.current = source;
    setDataSource(source);
    setLoading(true);
    refreshFnRef.current(true, source);
  }, []);

  const setDemoScenario = useCallback((key) => {
    if (demoScenarioRef.current === key || !DEMO_SCENARIOS[key]) return;
    demoScenarioRef.current = key;
    setDemoScenarioState(key);
    if (dataSourceRef.current === 'demo' && refreshFnRef.current) {
      setLoading(true);
      refreshFnRef.current(true, 'demo');
    }
  }, []);

  const setSpeed = useCallback((mult) => {
    if (viewerRef.current) viewerRef.current.clock.multiplier = mult;
  }, []);

  const jumpToTime = useCallback((jsDate) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(jsDate);
    lastTickRef.current = 0; // force update next frame
  }, []);

  const flyToSat = useCallback((satId) => {
    const viewer = viewerRef.current;
    const e = entityMapRef.current.get(satId);
    if (viewer && e) {
      viewer.flyTo(e, {
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-30), 2500000),
      });
      e.label.show = true;
      setSelected(satsRef.current.find((s) => s.id === satId));
    }
  }, []);

  const flyToConjunction = useCallback((conj) => {
    flyToSat(conj.i);
    const e2 = entityMapRef.current.get(conj.j);
    if (e2) e2.label.show = true;
  }, [flyToSat]);

  // Focuses a conjunction AND marks it "active" for the detail/mitigation
  // panel — flyToConjunction alone (used by search results etc.) doesn't.
  const selectConjunction = useCallback((conj) => {
    setSelectedConjunction(conj);
    flyToConjunction(conj);
  }, [flyToConjunction]);

  // Illustrative what-if: nudge object A of the active conjunction along its
  // own velocity direction by `nudgeMeters` and report the resulting miss
  // distance/Pc. Not a real burn simulation — see simulateNudge's own doc.
  const simulateMitigation = useCallback((nudgeMeters) => {
    if (!selectedConjunction) return null;
    const satA = satsRef.current.find((s) => s.id === selectedConjunction.i);
    const satB = satsRef.current.find((s) => s.id === selectedConjunction.j);
    if (!satA || !satB) return null;
    return simulateNudge(satA.satrec, satB.satrec, selectedConjunction.time, nudgeMeters);
  }, [selectedConjunction]);

  const stopDemo = useCallback(() => {
    playTimersRef.current.forEach(clearTimeout);
    playTimersRef.current = [];
    setPlayingDemo(false);
  }, []);

  // Short guided showcase: focus the most severe conjunction in the current
  // demo scenario, hold, then return to the overview. Deliberately modest in
  // scope (2 beats, not a long scripted tour) so it stays robust rather than
  // depending on a chain of camera-fly animations completing exactly on time.
  const playDemo = useCallback(() => {
    stopDemo();
    const worst = conjunctionsRef.current[0]; // already sorted by distance
    if (!worst) return;
    setPlayingDemo(true);

    const schedule = (fn, delay) => {
      playTimersRef.current.push(setTimeout(fn, delay));
    };
    schedule(() => selectConjunction(worst), 700);
    schedule(() => {
      setSelected(null);
      setSelectedConjunction(null);
      setPlayingDemo(false);
    }, 7000);
  }, [stopDemo, selectConjunction]);

  useEffect(() => {
    conjunctionsRef.current = conjunctions;
  }, [conjunctions]);

  // Cancel any pending guided-demo steps on unmount so they don't fire
  // setState calls against a torn-down component.
  useEffect(() => () => playTimersRef.current.forEach(clearTimeout), []);

  // ── Toggle effects ──────────────────────────────────────────────────────
  // Single source of truth for per-entity visibility: type filters (Debris/
  // Satellites), the orbit-paths master switch, and isolate-on-select all
  // combine here rather than fighting over `.show` in separate effects.
  // Re-runs on `satellites` too so a rebuilt entity set (data source switch,
  // live refresh with a changed count) picks up the current toggle state
  // instead of defaulting to Cesium's show:true.
  useEffect(() => {
    satsRef.current.forEach((s) => {
      const e = entityMapRef.current.get(s.id);
      const o = orbitMapRef.current.get(s.id);
      const typeVisible = s.type === 'debris' ? showDebris : showSatellites;
      if (e) e.show = typeVisible;
      if (o) {
        const isSelected = selected && s.id === selected.id;
        o.show = typeVisible && showOrbits && (!isolateTrajectory || !selected || isSelected);
      }
    });
  }, [showOrbits, showDebris, showSatellites, isolateTrajectory, selected, satellites]);

  useEffect(() => {
    if (satsRef.current.length && conjunctions.length) {
      recolorEntities(satsRef.current, showRisk ? conjunctions : []);
    }
  }, [showRisk, conjunctions]);

  useEffect(() => {
    conjLinesRef.current.forEach((l) => (l.show = showLines));
  }, [showLines]);

  useEffect(() => {
    graticuleRef.current.forEach((e) => (e.show = showGraticule));
  }, [showGraticule]);

  // Highlight the selected object's trajectory so it's unambiguous which
  // path belongs to it; revert the previously-highlighted one back to its
  // normal type/risk color first.
  useEffect(() => {
    const prevId = highlightedIdRef.current;
    if (prevId !== null && prevId !== (selected?.id ?? null)) {
      const o = orbitMapRef.current.get(prevId);
      const e = entityMapRef.current.get(prevId);
      const sat = satsRef.current.find((s) => s.id === prevId);
      if (o && sat) {
        o.polyline.material = trajectoryMaterial(normalColorFor(sat, conjunctions));
        o.polyline.width = ORBIT_WIDTH;
      }
      if (e) {
        e.point.outlineColor = Cesium.Color.BLACK.withAlpha(0.6);
        e.point.outlineWidth = 2;
      }
      highlightedIdRef.current = null;
      if (viewerRef.current) {
        clearGroundTrack(viewerRef.current);
        clearTrail(viewerRef.current);
      }
    }

    if (selected) {
      const o = orbitMapRef.current.get(selected.id);
      const e = entityMapRef.current.get(selected.id);
      if (o) {
        o.polyline.material = highlightMaterial();
        o.polyline.width = HIGHLIGHT_WIDTH;
      }
      if (e) {
        e.point.outlineColor = Cesium.Color.WHITE;
        e.point.outlineWidth = 3;
      }
      highlightedIdRef.current = selected.id;
      if (viewerRef.current && highlightedIdRef.current !== prevId) {
        trailPointsRef.current = [];
        showGroundTrack(viewerRef.current, selected, simTime);
      }
    }
  }, [selected, conjunctions]);

  return {
    loading,
    satellites,
    conjunctions,
    simTime,
    epochTime,
    selected,
    setSelected,
    selectedConjunction,
    imagerySource,
    dataStale,
    hasData,
    snapshotCapturedAt,
    dataSource,
    demoScenario,
    playingDemo,
    // actions
    switchDataSource,
    setDemoScenario,
    setSpeed,
    jumpToTime,
    flyToSat,
    flyToConjunction,
    selectConjunction,
    simulateMitigation,
    playDemo,
    stopDemo,
    // toggles
    showOrbits, setShowOrbits,
    showDebris, setShowDebris,
    showSatellites, setShowSatellites,
    showRisk, setShowRisk,
    showLines, setShowLines,
    showGraticule, setShowGraticule,
    isolateTrajectory, setIsolateTrajectory,
  };
}
