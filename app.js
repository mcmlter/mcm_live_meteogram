/* =============================================================
   MCM Live Meteogram — app.js
   D3 v7  |  Static GitHub Pages deployment
   ============================================================= */

'use strict';

// ─── Constants ────────────────────────────────────────────────
const STATIONS = ['boym', 'brhm', 'caam', 'cohm', 'exem', 'frlm', 'ho2m', 'hodm', 'tarm', 'vaam', 'viam'];

const STATION_NAMES = {
  boym: 'Lake Bonney',
  brhm: 'Lake Brownworth',
  caam: 'Canada Glacier',
  cohm: 'Commonwealth Glacier',
  exem: "Explorer's Cove",
  frlm: 'Lake Fryxell',
  ho2m: 'Lake Hoare',
  hodm: 'Howard Glacier',
  tarm: 'Taylor Glacier',
  vaam: 'Lake Vanda',
  viam: 'Victoria Valley',
  mism: 'Miers Valley',
  frsm: 'Friis Hills',
  flmm: 'Mt. Fleming',
};

function stationLabel(code) {
  return STATION_NAMES[code] || code.toUpperCase();
}

const MS_TO_KT = 1.94384;
const GAP_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours → line break

// One color per station (up to 11)
const PALETTE = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#475569', '#92400e'
];

const PANELS = [
  { id: 'temperature', field: 'air_temp_3m', label: 'Temperature', unit: '°C', fmt: v => v.toFixed(1) },
  { id: 'humidity', field: 'rel_hum_3m', label: 'Relative Humidity', unit: '%', fmt: v => v.toFixed(1) },
  { id: 'pressure', field: 'barom_pres', label: 'Barometric Pressure', unit: 'hPa', fmt: v => v.toFixed(1) },
  { id: 'solar', field: 'sw_rad_in', label: 'Solar Radiation', unit: 'W/m²', fmt: v => v.toFixed(2) },
  { id: 'wind', field: 'wind_spd_avg', label: 'Wind Speed & Direction', unit: 'kt', fmt: v => v.toFixed(1), isWind: true },
  { id: 'battery', field: 'battv_min', label: 'Battery Voltage', unit: 'V', fmt: v => v.toFixed(2) },
];

const MARGIN = { top: 10, right: 20, bottom: 30, left: 58 };
const PANEL_HEIGHT = 160; // inner chart height in px

// ─── State ────────────────────────────────────────────────────
const state = {
  activeStations: [],      // array of station codes currently selected
  cache: new Map(),        // code → parsed data array
  timeDomain: null,        // domain [start, end] in UTC+13 time (null = auto from presets/data)
  panelVisible: Object.fromEntries(PANELS.map(p => [p.id, p.id !== 'battery'])),
  manualY: {},             // per-panel manual Y domain: { panelId: [min, max] }
  // shared D3 scales (time axis linked across panels)
  xScale: null,
  transform: d3.zoomIdentity,
};

// ─── Helpers ─────────────────────────────────────────────────
function stationFile(code) {
  return `mcm_met/met_${code}.csv`;
}

function stationColor(code) {
  const idx = STATIONS.indexOf(code);
  return PALETTE[idx % PALETTE.length];
}

function num(v) {
  // Parse a CSV string field → number or null. Handles 0 correctly (unlike `+v || null`).
  if (v === '' || v === null || v === undefined) return null;
  const n = +v;
  return isNaN(n) ? null : n;
}

function toLocalISOString(d) {
  const pad = n => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function parseInputDate(val) {
  if (!val) return null;
  let s = val.trim().replace(' ', 'T');
  if (s.length === 16) s += ':00';
  if (!s.endsWith('Z')) s += 'Z';
  return new Date(s);
}

function parseRow(d) {
  let time = null;
  if (d.timestamp_utc) {
    // d.timestamp_utc is formatted like "2026-06-24T17:00:00+13:00"
    // The timestamp numbers (17:00:00) represent the UTC+13 local station time.
    // Parse the ISO string as UTC ('Z') so d3.scaleUtc and d3.utcFormat
    // display wall-clock UTC+13 time without offset shifting.
    let ts = d.timestamp_utc.trim().replace(' ', 'T');
    if (ts.length >= 19) {
      ts = ts.slice(0, 19) + 'Z';
    }
    time = new Date(ts);
  }
  return {
    time,
    temp: num(d.air_temp_3m),
    humidity: num(d.rel_hum_3m),
    pressure: num(d.barom_pres),
    solar: num(d.sw_rad_in),
    wind_spd: d.wind_spd_avg !== '' && d.wind_spd_avg != null ? num(d.wind_spd_avg) * MS_TO_KT : null,
    wind_dir: num(d.wind_direction),
    battery: num(d.battv_min),
  };
}

function fieldForPanel(p, row) {
  const map = {
    temperature: row.temp,
    humidity: row.humidity,
    pressure: row.pressure,
    solar: row.solar,
    wind: row.wind_spd,
    battery: row.battery,
  };
  return map[p.id];
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('status-bar');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
}

// ─── Data loading ─────────────────────────────────────────────
async function loadStation(code) {
  if (state.cache.has(code)) return state.cache.get(code);
  setStatus(`Loading ${stationLabel(code)}…`);
  try {
    const raw = await d3.csv(stationFile(code));
    if (raw.length === 0) {
      state.cache.set(code, []);
      setStatus('');
      return [];
    }
    const rows = raw
      .map(parseRow)
      .filter(r => r.time instanceof Date && !isNaN(r.time))
      .sort((a, b) => a.time - b.time);
    state.cache.set(code, rows);
    setStatus('');
    return rows;
  } catch (e) {
    setStatus(`Error loading ${stationLabel(code)}: ${e.message}`, true);
    state.cache.set(code, []);
    return [];
  }
}

// ─── Overall time extent across all loaded stations ────────────
function globalExtent() {
  let min = Infinity, max = -Infinity;
  for (const rows of state.cache.values()) {
    if (!rows.length) continue;
    if (rows[0].time < min) min = rows[0].time;
    if (rows[rows.length - 1].time > max) max = rows[rows.length - 1].time;
  }
  if (!isFinite(min)) return null;
  return [new Date(min), new Date(max)];
}

function effectiveTimeDomain() {
  if (state.timeDomain) return state.timeDomain;
  const ext = globalExtent();
  if (!ext) return [new Date(Date.now() - 7 * 24 * 3600000), new Date()];
  // Default to 7 days before max data timestamp to match default active "7 d" preset
  const end = ext[1];
  const start = new Date(end.getTime() - 7 * 24 * 3600000);
  return [start, end];
}

// ─── Chart drawing ────────────────────────────────────────────

/** Build or retrieve the shared SVG+scale for a panel */
function getOrCreatePanelSvg(panelId, extraBottom = 0) {
  const container = document.querySelector(`#panel-${panelId} .panel-svg-container`);
  const W = container.clientWidth || 900;
  const innerW = W - MARGIN.left - MARGIN.right;
  const innerH = PANEL_HEIGHT;
  const totalH = innerH + MARGIN.top + MARGIN.bottom + extraBottom;

  let svg = d3.select(container).select('svg');
  if (svg.empty()) {
    svg = d3.select(container)
      .append('svg')
      .attr('width', W)
      .attr('height', totalH);
    svg.append('g').attr('class', 'chart-root')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);
  } else {
    svg.attr('width', W).attr('height', totalH);
  }

  // Clip path restricting data lines/dots to the plot area (prevents
  // manual y-axis scaling from letting lines/points render past the axes).
  let defs = svg.select('defs');
  if (defs.empty()) defs = svg.append('defs');
  let clip = defs.select(`#clip-${panelId}`);
  if (clip.empty()) {
    clip = defs.append('clipPath').attr('id', `clip-${panelId}`);
    clip.append('rect');
  }
  clip.select('rect').attr('x', 0).attr('y', 0).attr('width', innerW).attr('height', innerH);

  return { svg, innerW, innerH };
}

function buildXScale(innerW) {
  const [t0, t1] = effectiveTimeDomain();
  return d3.scaleUtc().domain([t0, t1]).range([0, innerW]);
}

/** Draw (or redraw) a scalar panel (temp, humidity, pressure, solar) */
function drawScalarPanel(panel, datasets) {
  const panelEl = document.getElementById(`panel-${panel.id}`);
  if (!panelEl) return;

  // Remove old no-data message
  const oldMsg = panelEl.querySelector('.no-data-msg');
  if (oldMsg) oldMsg.remove();

  const { svg, innerW, innerH } = getOrCreatePanelSvg(panel.id);
  const root = svg.select('.chart-root');

  // Filter datasets to those that have data for this field
  const activeDatasets = datasets.filter(({ rows }) => {
    return rows.some(r => fieldForPanel(panel, r) !== null);
  });

  // --- Add Y-axis controls to header if missing ---
  let controls = panelEl.querySelector('.y-controls');
  if (!controls) {
    const header = panelEl.querySelector('.panel-header');
    controls = document.createElement('div');
    controls.className = 'y-controls';
    controls.innerHTML = `
      <label>Y-Min <input type="number" class="y-min" step="any" placeholder="Auto"></label>
      <label>Y-Max <input type="number" class="y-max" step="any" placeholder="Auto"></label>
      <button class="y-auto-btn">Auto</button>
    `;
    header.appendChild(controls);

    const minIn = controls.querySelector('.y-min');
    const maxIn = controls.querySelector('.y-max');
    const autoBtn = controls.querySelector('.y-auto-btn');

    const updateManual = () => {
      const mn = parseFloat(minIn.value);
      const mx = parseFloat(maxIn.value);
      if (isNaN(mn) && isNaN(mx)) {
        delete state.manualY[panel.id];
      } else {
        const cur = state.manualY[panel.id] || [null, null];
        state.manualY[panel.id] = [isNaN(mn) ? cur[0] : mn, isNaN(mx) ? cur[1] : mx];
      }
      redrawPanels();
    };

    minIn.addEventListener('change', updateManual);
    maxIn.addEventListener('change', updateManual);
    autoBtn.addEventListener('click', () => {
      minIn.value = '';
      maxIn.value = '';
      delete state.manualY[panel.id];
      redrawPanels();
    });
  }
  // Sync inputs with state
  const manual = state.manualY[panel.id];
  controls.querySelector('.y-min').value = manual && manual[0] !== null ? manual[0] : '';
  controls.querySelector('.y-max').value = manual && manual[1] !== null ? manual[1] : '';

  if (activeDatasets.length === 0) {
    root.selectAll('*').remove();
    const container = document.querySelector(`#panel-${panel.id} .panel-svg-container`);
    d3.select(container).select('svg').remove();
    panelEl.querySelector('.panel-svg-container').innerHTML =
      `<p class="no-data-msg">No ${panel.label.toLowerCase()} data available for selected station(s).</p>`;
    return;
  }

  const xScale = buildXScale(innerW);
  const [t0, t1] = effectiveTimeDomain();

  // Compute y domain across currently displayed data in active time window
  let allVals = [];
  for (const { rows } of activeDatasets) {
    for (const r of rows) {
      if (r.time >= t0 && r.time <= t1) {
        const v = fieldForPanel(panel, r);
        if (v !== null) allVals.push(v);
      }
    }
  }
  let [yMin, yMax] = d3.extent(allVals);
  if (yMin === undefined) {
    // Fallback if no data in current visible time window
    const unconstrained = activeDatasets.flatMap(d => d.rows).map(r => fieldForPanel(panel, r)).filter(v => v !== null);
    [yMin, yMax] = d3.extent(unconstrained);
    if (yMin === undefined) [yMin, yMax] = [0, 10];
  }
  let yPad = (yMax - yMin) * 0.08 || 1;

  if (manual) {
    if (manual[0] !== null) { yMin = manual[0]; yPad = 0; }
    if (manual[1] !== null) { yMax = manual[1]; yPad = 0; }
  }

  const yScale = d3.scaleLinear()
    .domain([yMin - yPad, yMax + yPad])
    .range([innerH, 0])
    .nice();

  // Clear & redraw axes
  root.selectAll('.axis,.grid,.data-layer').remove();

  // Grid lines
  const gridG = root.append('g').attr('class', 'grid');
  gridG.selectAll('line')
    .data(yScale.ticks(5))
    .join('line')
    .attr('class', 'grid-line')
    .attr('x1', 0).attr('x2', innerW)
    .attr('y1', d => yScale(d)).attr('y2', d => yScale(d));

  // X axis
  root.append('g').attr('class', 'axis x-axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(6).tickSizeOuter(0));

  // Y axis
  root.append('g').attr('class', 'axis y-axis')
    .call(d3.axisLeft(yScale).ticks(5).tickSizeOuter(0));

  // Break lines at gaps: split rows into contiguous segments

  for (const { code, rows } of activeDatasets) {
    const color = stationColor(code);
    const [t0, t1] = effectiveTimeDomain();
    const visible = rows.filter(r => r.time >= t0 && r.time <= t1);

    const g = root.append('g').attr('class', 'data-layer')
      .attr('clip-path', `url(#clip-${panel.id})`);

    // Line (broken at gaps)
    // We need a proper gap-aware line: split into segments
    const segments = splitOnGaps(visible, r => fieldForPanel(panel, r));
    for (const seg of segments) {
      g.append('path')
        .datum(seg)
        .attr('class', 'data-line')
        .attr('stroke', color)
        .attr('d', d3.line()
          .defined(r => fieldForPanel(panel, r) !== null)
          .x(r => xScale(r.time))
          .y(r => yScale(fieldForPanel(panel, r))));
    }

    // Dots — subsample to avoid overplotting at "all data" scales
    const dotStep = Math.max(1, Math.floor(visible.length / (innerW / 4)));
    const dotData = visible.filter((_, i) => i % dotStep === 0 && fieldForPanel(panel, _) !== null);
    g.selectAll('circle')
      .data(dotData)
      .join('circle')
      .attr('class', 'data-dot')
      .attr('cx', r => xScale(r.time))
      .attr('cy', r => yScale(fieldForPanel(panel, r)))
      .attr('r', 2.5)
      .attr('fill', color)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1);
  }

  attachZoom(svg, panel.id, innerW, innerH);
  attachCrosshair(svg, panel.id, xScale, yScale, innerW, innerH, activeDatasets, panel);
}

/** Split a row array into contiguous segments (break on time gaps > threshold or null value) */
function splitOnGaps(rows, valueGetter) {
  const segs = [];
  let cur = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const v = valueGetter(r);
    const prev = rows[i - 1];
    const gapTime = i > 0 && (r.time - prev.time) > GAP_THRESHOLD_MS;
    if (gapTime && cur.length) { segs.push(cur); cur = []; }
    if (v !== null) cur.push(r);
    else if (cur.length) { segs.push(cur); cur = []; }
  }
  if (cur.length) segs.push(cur);
  return segs;
}

// ─── Wind direction arrow drawing ─────────────────────────────
const ARROW_ROW_H = 16;      // vertical space per station's arrow row
const ARROW_TOP_PAD = 18;    // clearance below x-axis tick labels before first row
const ARROW_LABEL_H = 14;    // space for the averaging-period caption

/** Round a duration up to the nearest 30-minute increment (min 30 min). */
function roundToHalfHour(ms) {
  const HALF_HR = 30 * 60000;
  return Math.max(HALF_HR, Math.round(ms / HALF_HR) * HALF_HR);
}

/** Human-readable duration in half-hour increments, e.g. "30 min", "1.5 hr", "2 d" */
function formatDuration(ms) {
  const rounded = roundToHalfHour(ms);
  const min = rounded / 60000;
  if (min < 60) return `${min} min`;
  const hr = min / 60;
  if (hr < 48) return `${hr % 1 === 0 ? hr : hr.toFixed(1)} hr`;
  const days = hr / 24;
  return `${days % 1 === 0 ? days : days.toFixed(1)} d`;
}

/**
 * Circular mean of a set of compass-bearing directions (degrees, 0=N, 90=E).
 * Returns null if no valid directions.
 */
function circularMeanDeg(rows, getDir) {
  let sx = 0, sy = 0, n = 0;
  for (const r of rows) {
    const d = getDir(r);
    if (d === null || d === undefined) continue;
    const rad = d * Math.PI / 180;
    sx += Math.sin(rad);
    sy += Math.cos(rad);
    n++;
  }
  if (!n) return null;
  const deg = Math.atan2(sx, sy) * 180 / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Draw a small arrow at the origin of `g`, pointing toward `dirTo_deg`
 * (compass bearing, 0=N/up, clockwise) — i.e. the direction the wind blows TO.
 */
function drawWindArrow(g, dirTo_deg, color) {
  const LEN = 11;
  const inner = g.append('g').attr('transform', `rotate(${dirTo_deg})`);
  inner.append('line')
    .attr('x1', 0).attr('y1', LEN / 2)
    .attr('x2', 0).attr('y2', -LEN / 2)
    .attr('stroke', color)
    .attr('stroke-width', 1.5);
  inner.append('path')
    .attr('d', `M0,${-LEN / 2 - 3} L-3,${-LEN / 2 + 2} L3,${-LEN / 2 + 2} Z`)
    .attr('fill', color);
}

/** Draw the wind panel — speed line/dots (like other panels) plus
 *  direction arrows in per-station rows below the x-axis. */
function drawWindPanel(datasets) {
  const panelEl = document.getElementById('panel-wind');
  if (!panelEl) return;
  const oldMsg = panelEl.querySelector('.no-data-msg');
  if (oldMsg) oldMsg.remove();

  const activeDatasets = datasets.filter(({ rows }) =>
    rows.some(r => r.wind_spd !== null)
  );

  const extraBottom = ARROW_TOP_PAD + Math.max(1, activeDatasets.length) * ARROW_ROW_H + ARROW_LABEL_H;
  const { svg, innerW, innerH } = getOrCreatePanelSvg('wind', extraBottom);
  const root = svg.select('.chart-root');

  // --- Add Y-axis controls to header if missing ---
  let controls = panelEl.querySelector('.y-controls');
  if (!controls) {
    const header = panelEl.querySelector('.panel-header');
    controls = document.createElement('div');
    controls.className = 'y-controls';
    controls.innerHTML = `
      <label>Y-Min <input type="number" class="y-min" step="any" placeholder="Auto"></label>
      <label>Y-Max <input type="number" class="y-max" step="any" placeholder="Auto"></label>
      <button class="y-auto-btn">Auto</button>
    `;
    header.appendChild(controls);

    const minIn = controls.querySelector('.y-min');
    const maxIn = controls.querySelector('.y-max');
    const autoBtn = controls.querySelector('.y-auto-btn');

    const updateManual = () => {
      const mn = parseFloat(minIn.value);
      const mx = parseFloat(maxIn.value);
      if (isNaN(mn) && isNaN(mx)) {
        delete state.manualY['wind'];
      } else {
        const cur = state.manualY['wind'] || [null, null];
        state.manualY['wind'] = [isNaN(mn) ? cur[0] : mn, isNaN(mx) ? cur[1] : mx];
      }
      redrawPanels();
    };

    minIn.addEventListener('change', updateManual);
    maxIn.addEventListener('change', updateManual);
    autoBtn.addEventListener('click', () => {
      minIn.value = '';
      maxIn.value = '';
      delete state.manualY['wind'];
      redrawPanels();
    });
  }

  const manual = state.manualY['wind'];
  controls.querySelector('.y-min').value = manual && manual[0] !== null ? manual[0] : '';
  controls.querySelector('.y-max').value = manual && manual[1] !== null ? manual[1] : '';

  if (activeDatasets.length === 0) {
    root.selectAll('*').remove();
    const container = document.querySelector('#panel-wind .panel-svg-container');
    d3.select(container).select('svg').remove();
    panelEl.querySelector('.panel-svg-container').innerHTML =
      '<p class="no-data-msg">No wind data available for selected station(s).</p>';
    return;
  }

  const xScale = buildXScale(innerW);
  const [t0, t1] = effectiveTimeDomain();

  // Y scale: wind speed in knots
  let allSpeeds = [];
  for (const { rows } of activeDatasets) {
    for (const r of rows) {
      if (r.wind_spd !== null && r.time >= t0 && r.time <= t1) allSpeeds.push(r.wind_spd);
    }
  }
  let maxSpd = d3.max(allSpeeds);
  if (maxSpd === undefined) maxSpd = 10;
  let yMin = 0, yMax = maxSpd * 1.12 || 10;
  if (manual) {
    if (manual[0] !== null) yMin = manual[0];
    if (manual[1] !== null) yMax = manual[1];
  }

  const yScale = d3.scaleLinear()
    .domain([yMin, yMax])
    .range([innerH, 0])
    .nice();

  root.selectAll('.axis,.grid,.data-layer,.arrow-layer,.arrow-caption').remove();

  // Grid
  const gridG = root.append('g').attr('class', 'grid');
  gridG.selectAll('line')
    .data(yScale.ticks(5))
    .join('line')
    .attr('class', 'grid-line')
    .attr('x1', 0).attr('x2', innerW)
    .attr('y1', d => yScale(d)).attr('y2', d => yScale(d));

  // Axes
  root.append('g').attr('class', 'axis x-axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(6).tickSizeOuter(0));

  root.append('g').attr('class', 'axis y-axis')
    .call(d3.axisLeft(yScale).ticks(5).tickSizeOuter(0));

  // --- Speed line + dots per station (clipped to plot area) ---
  for (const { code, rows } of activeDatasets) {
    const color = stationColor(code);
    const visible = rows.filter(r => r.time >= t0 && r.time <= t1);

    const g = root.append('g').attr('class', 'data-layer')
      .attr('clip-path', 'url(#clip-wind)');

    const segments = splitOnGaps(visible, r => r.wind_spd);
    for (const seg of segments) {
      g.append('path')
        .datum(seg)
        .attr('class', 'data-line')
        .attr('stroke', color)
        .attr('d', d3.line()
          .defined(r => r.wind_spd !== null)
          .x(r => xScale(r.time))
          .y(r => yScale(r.wind_spd)));
    }

    const dotStep = Math.max(1, Math.floor(visible.length / (innerW / 4)));
    const dotData = visible.filter((r, i) => i % dotStep === 0 && r.wind_spd !== null);
    g.selectAll('circle')
      .data(dotData)
      .join('circle')
      .attr('class', 'data-dot')
      .attr('cx', r => xScale(r.time))
      .attr('cy', r => yScale(r.wind_spd))
      .attr('r', 2.5)
      .attr('fill', color)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1);
  }

  // --- Direction arrows: one row per station below the x-axis ---
  // Target ~1 arrow per BUCKET_PX, but snap the actual averaging
  // window to a 30-min increment so it matches the caption exactly.
  const BUCKET_PX = 35;
  const targetDurationMs = (t1 - t0) / Math.max(1, Math.round(innerW / BUCKET_PX));
  const bucketDurationMs = roundToHalfHour(targetDurationMs);
  const numBuckets = Math.max(1, Math.round((t1 - t0) / bucketDurationMs));
  const bucketW = innerW / numBuckets;

  activeDatasets.forEach(({ code, rows }, stationIdx) => {
    const color = stationColor(code);
    const rowY = innerH + ARROW_TOP_PAD + stationIdx * ARROW_ROW_H + ARROW_ROW_H / 2;
    const arrowG = root.append('g').attr('class', 'arrow-layer');

    for (let i = 0; i < numBuckets; i++) {
      const xStart = i * bucketW, xEnd = (i + 1) * bucketW;
      const tStart = xScale.invert(xStart), tEnd = xScale.invert(xEnd);
      const bucketRows = rows.filter(r => r.time >= tStart && r.time < tEnd && r.wind_dir !== null);
      if (!bucketRows.length) continue;
      const meanFrom = circularMeanDeg(bucketRows, r => r.wind_dir);
      if (meanFrom === null) continue;
      const dirTo = (meanFrom + 180) % 360; // blowing TO
      const cx = (xStart + xEnd) / 2;
      drawWindArrow(
        arrowG.append('g').attr('transform', `translate(${cx},${rowY})`),
        dirTo, color
      );
    }
  });

  // Label explaining the averaging period represented by each arrow
  const labelY = innerH + ARROW_TOP_PAD + Math.max(1, activeDatasets.length) * ARROW_ROW_H + ARROW_LABEL_H - 3;
  root.append('text')
    .attr('class', 'arrow-caption')
    .attr('x', innerW / 2)
    .attr('y', labelY)
    .attr('text-anchor', 'middle')
    .attr('fill', 'var(--text-muted)')
    .attr('font-size', 10.5)
    .text(`↓ arrows show mean direction (blowing to), avg. per ${formatDuration(bucketDurationMs)}`);

  attachZoom(svg, 'wind', innerW, innerH);
  attachCrosshair(svg, 'wind', xScale, yScale, innerW, innerH, activeDatasets, PANELS.find(p => p.id === 'wind'),
    r => {
      if (r.wind_dir === null || r.wind_dir === undefined) return '';
      const dirTo = (r.wind_dir + 180) % 360;
      return ` → ${Math.round(dirTo)}° ${degToCardinal(dirTo)}`;
    });
}

// ─── Zoom/pan (linked) ────────────────────────────────────────
const zoomBehaviors = new Map(); // panelId → d3.zoom

function attachZoom(svg, panelId, innerW, innerH) {
  const root = svg.select('.chart-root');

  let overlay = root.select('.zoom-overlay');
  let isNew = false;
  if (overlay.empty()) {
    overlay = root.append('rect')
      .attr('class', 'zoom-overlay')
      .attr('fill', 'none')
      .attr('pointer-events', 'all');
    isNew = true;
  }
  overlay.attr('width', innerW).attr('height', innerH);

  let zoom = zoomBehaviors.get(panelId);
  if (!zoom) {
    zoom = d3.zoom()
      .scaleExtent([1, 1000]) // Allow zooming deeply
      .on('zoom', (event) => {
        if (!event.sourceEvent) return; // Ignore programmatic zoom calls

        const ext = globalExtent();
        if (!ext) return;
        const baseScale = d3.scaleUtc().domain(ext).range([0, innerW]);

        state.timeDomain = event.transform.rescaleX(baseScale).domain();

        // Sync transforms across all panels without triggering events
        for (const [id, otherZoom] of zoomBehaviors.entries()) {
          if (id !== panelId) {
            const otherOverlay = d3.select(`#panel-${id} .zoom-overlay`);
            if (!otherOverlay.empty()) {
              otherOverlay.node().__zoom = event.transform;
            }
          }
        }

        redrawPanels();
      });
    zoomBehaviors.set(panelId, zoom);
  }

  if (isNew) overlay.call(zoom);

  // Sync this overlay's D3 state with the current timeDomain (e.g. if preset changed)
  const ext = globalExtent();
  if (ext && state.timeDomain) {
    const baseScale = d3.scaleUtc().domain(ext).range([0, innerW]);
    const k = (ext[1] - ext[0]) / (state.timeDomain[1] - state.timeDomain[0]);
    const tx = -k * baseScale(state.timeDomain[0]);
    const t = d3.zoomIdentity.translate(tx, 0).scale(k);
    overlay.node().__zoom = t;
  }
}

// ─── Crosshair tooltip ───────────────────────────────────────
/** Convert a compass bearing (degrees) to a 16-point cardinal label. */
function degToCardinal(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

function attachCrosshair(svg, panelId, xScale, yScale, innerW, innerH, datasets, panel, extraFn) {
  const root = svg.select('.chart-root');
  const tooltip = document.getElementById('tooltip');
  // Move zoom overlay to top so it receives pointer events
  const overlay = root.select('.zoom-overlay');

  overlay
    .on('mousemove', function (event) {
      const [mx] = d3.pointer(event);
      const t = xScale.invert(mx);
      // Find nearest point per station
      let lines = [];
      for (const { code, rows } of datasets) {
        const [t0, t1] = effectiveTimeDomain();
        const vis = rows.filter(r => r.time >= t0 && r.time <= t1 && fieldForPanel(panel, r) !== null);
        if (!vis.length) continue;
        const bisect = d3.bisector(r => r.time).center;
        const idx = bisect(vis, t);
        const r = vis[idx];
        if (!r) continue;
        lines.push({ code, val: fieldForPanel(panel, r), time: r.time, row: r });
      }
      if (!lines.length) return;
      const timeStr = d3.utcFormat('%Y-%m-%d %H:%M UTC+13')(lines[0].time);
      const rows = lines.map(l =>
        `<div class="tooltip-row">
           <span class="tooltip-label" style="color:${stationColor(l.code)}">${stationLabel(l.code)}</span>
           <span class="tooltip-value">${panel.fmt(l.val)} ${panel.unit}${extraFn ? extraFn(l.row) : ''}</span>
         </div>`
      ).join('');
      tooltip.innerHTML = `<div class="tooltip-time">${timeStr}</div>${rows}`;
      tooltip.classList.add('visible');
      tooltip.setAttribute('aria-hidden', 'false');
      const svgRect = svg.node().getBoundingClientRect();
      const tx = Math.min(event.clientX + 14, window.innerWidth - 230);
      const ty = Math.min(event.clientY - 10, window.innerHeight - 120);
      tooltip.style.left = tx + 'px';
      tooltip.style.top = ty + 'px';
    })
    .on('mouseleave', () => {
      tooltip.classList.remove('visible');
      tooltip.setAttribute('aria-hidden', 'true');
    });
}

// ─── Redraw all visible panels ────────────────────────────────
async function redrawPanels() {
  if (!state.activeStations.length) {
    for (const p of PANELS) {
      const panelEl = document.getElementById(`panel-${p.id}`);
      if (!panelEl) continue;
      const container = panelEl.querySelector('.panel-svg-container');
      d3.select(container).select('svg').remove();
      container.innerHTML = '<p class="no-data-msg">Select one or more stations to view data.</p>';
    }
    return;
  }

  // Load all active stations (cached after first fetch)
  const datasets = await Promise.all(
    state.activeStations.map(async code => ({
      code,
      rows: await loadStation(code),
    }))
  );

  // Sync custom date inputs with effective time domain
  const [startD, endD] = effectiveTimeDomain();
  const startInput = document.getElementById('date-start');
  const endInput = document.getElementById('date-end');
  if (startInput && endInput && startD && endD && document.activeElement !== startInput && document.activeElement !== endInput) {
    startInput.value = toLocalISOString(startD);
    endInput.value = toLocalISOString(endD);
  }

  // Scalar panels
  for (const panel of PANELS) {
    const panelEl = document.getElementById(`panel-${panel.id}`);
    if (!panelEl) continue;
    if (!state.panelVisible[panel.id]) {
      panelEl.classList.add('hidden');
      continue;
    }
    panelEl.classList.remove('hidden');

    if (panel.isWind) {
      drawWindPanel(datasets);
    } else {
      drawScalarPanel(panel, datasets);
    }
  }

  updateLegend();
}

// ─── Legend ───────────────────────────────────────────────────
function updateLegend() {
  const el = document.getElementById('legend');
  el.innerHTML = state.activeStations.map(code => `
    <div class="legend-item">
      <span class="legend-swatch" style="background:${stationColor(code)}"></span>
      ${stationLabel(code)}
    </div>
  `).join('');
}

// ─── Station dropdown ─────────────────────────────────────────
function buildStationDropdown() {
  const ul = document.getElementById('station-dropdown');
  ul.innerHTML = '';
  for (const code of STATIONS) {
    const isVaam = code === 'vaam';
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.dataset.code = code;
    if (isVaam) li.classList.add('no-data');
    li.innerHTML = `
      <span class="check" aria-hidden="true"></span>
      <span>${stationLabel(code)}</span>
      ${isVaam ? '<em style="font-size:11px;color:#aaa">(no data)</em>' : ''}
    `;
    if (!isVaam) {
      li.addEventListener('click', () => toggleStation(code, li));
    }
    ul.appendChild(li);
  }
}

function toggleStation(code, li) {
  const idx = state.activeStations.indexOf(code);
  if (idx === -1) {
    state.activeStations.push(code);
    li.setAttribute('aria-selected', 'true');
    li.querySelector('.check').textContent = '✓';
  } else {
    state.activeStations.splice(idx, 1);
    li.setAttribute('aria-selected', 'false');
    li.querySelector('.check').textContent = '';
  }
  updateDropdownLabel();
  redrawPanels();
}

function updateDropdownLabel() {
  const label = document.getElementById('station-dropdown-label');
  if (!state.activeStations.length) {
    label.textContent = 'Select stations…';
  } else {
    label.textContent = state.activeStations.map(stationLabel).join(', ');
  }
}

function initDropdownToggle() {
  const btn = document.getElementById('station-dropdown-btn');
  const ul = document.getElementById('station-dropdown');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = ul.hidden === false;
    ul.hidden = open;
    btn.setAttribute('aria-expanded', String(!open));
  });
  document.addEventListener('click', () => {
    ul.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  });
  ul.addEventListener('click', e => e.stopPropagation());
}

// ─── Time range controls ──────────────────────────────────────
function initTimeControls() {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const hours = btn.dataset.hours;

      if (hours === 'all') {
        state.timeDomain = globalExtent();
      } else {
        const ext = globalExtent();
        const end = ext ? ext[1] : new Date();
        const start = new Date(end.getTime() - hours * 3600000);
        state.timeDomain = [start, end];
      }
      redrawPanels();
    });
  });

  // Pre-fill custom datetime inputs with midnight so users don't have to enter a time
  const startInput = document.getElementById('date-start');
  const endInput = document.getElementById('date-end');

  const ext = globalExtent();
  const endD = ext ? ext[1] : new Date();
  const startD = new Date(endD.getTime() - 7 * 24 * 3600 * 1000);

  const toLocalISOString = (d) => {
    const pad = n => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00`;
  };

  if (!startInput.value) startInput.value = toLocalISOString(startD);
  if (!endInput.value) endInput.value = toLocalISOString(endD);

  document.getElementById('apply-range-btn').addEventListener('click', () => {
    const s = document.getElementById('date-start').value;
    const e = document.getElementById('date-end').value;
    if (s && e) {
      state.timeDomain = [new Date(s), new Date(e)];
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      redrawPanels();
    }
  });
}

// ─── Panel toggle checkboxes ──────────────────────────────────
function initPanelToggles() {
  document.querySelectorAll('[data-panel]').forEach(cb => {
    if (cb.type !== 'checkbox') return;
    cb.addEventListener('change', () => {
      const id = cb.dataset.panel;
      state.panelVisible[id] = cb.checked;
      const panelEl = document.getElementById(`panel-${id}`);
      if (panelEl) panelEl.classList.toggle('hidden', !cb.checked);
      redrawPanels(); // Force a redraw so newly visible panels are populated
    });
  });
}

// ─── Window resize ────────────────────────────────────────────
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    // Remove existing SVGs so they're redrawn at new width
    document.querySelectorAll('.panel-svg-container svg').forEach(s => s.remove());
    redrawPanels();
  }, 200);
});

// ─── Bootstrap ───────────────────────────────────────────────
function init() {
  buildStationDropdown();
  initDropdownToggle();
  initTimeControls();
  initPanelToggles();

  // Default: load first available station
  const defaultStation = 'boym';
  state.activeStations = [defaultStation];
  const li = document.querySelector(`[data-code="${defaultStation}"]`);
  if (li) {
    li.setAttribute('aria-selected', 'true');
    li.querySelector('.check').textContent = '✓';
  }
  updateDropdownLabel();
  redrawPanels();
}

document.addEventListener('DOMContentLoaded', init);