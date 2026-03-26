import React, { useMemo, useState } from "react";
import "./App.css";

/**
 * Create deterministic mock time-series data for the demo dashboard.
 * - Baseline is smooth and predictable.
 * - Actual follows baseline with noise, with a few injected anomalies.
 */
function parseCSV(text) {
  const lines = text.trim().split('\n').map(line => line.trim()).filter(line => line);
  if (lines.length < 2) throw new Error("CSV must contain a header and at least one data row.");
  
  const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
  
  const timeIdx = headers.findIndex(h => h === 'time' || h === 'timestamp' || h === 'date');
  const actualIdx = headers.findIndex(h => h === 'actual' || h === 'value' || h === 'consumption');
  const baselineIdx = headers.findIndex(h => h === 'baseline');

  if (timeIdx === -1 || actualIdx === -1) {
    throw new Error("CSV must contain 'time' and 'actual' columns.");
  }

  let data = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    if (cols.length <= Math.max(timeIdx, actualIdx)) continue;

    const ts = new Date(cols[timeIdx]);
    if (isNaN(ts.getTime())) throw new Error(`Invalid date format on row ${i + 1}`);

    const actual = parseFloat(cols[actualIdx]);
    if (isNaN(actual)) throw new Error(`Invalid numeric actual value on row ${i + 1}`);

    let baseline = undefined; 
    if (baselineIdx !== -1 && cols[baselineIdx]) {
      const bVal = parseFloat(cols[baselineIdx]);
      if (!isNaN(bVal)) baseline = bVal;
    }

    data.push({ ts, actual, baseline });
  }
  
  data.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  data = computeRollingBaseline(data);
  return data;
}

function computeRollingBaseline(data) {
  // Compute a rolling 4-week (28 days) baseline if missing
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return data.map((d, i) => {
    if (d.baseline !== undefined) return d;
    
    // Look back up to 28 days to calculate a rolling average for the baseline
    let sum = 0;
    let count = 0;
    const cutoff = d.ts.getTime() - 28 * MS_PER_DAY;
    
    for (let j = i - 1; j >= 0; j--) {
      if (data[j].ts.getTime() < cutoff) break;
      sum += data[j].actual;
      count++;
    }
    
    const baseline = count > 0 ? sum / count : d.actual;
    return { ...d, baseline };
  });
}

function buildMockSeries() {
  const points = [];
  const end = new Date();
  end.setMinutes(0, 0, 0);
  // Generate 60 days of hourly data to have enough history for a 4-week rolling baseline
  const start = new Date(end.getTime() - 60 * 24 * 60 * 60 * 1000);

  for (let t = start.getTime(); t <= end.getTime(); t += 60 * 60 * 1000) {
    const date = new Date(t);
    const hour = date.getHours();
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

    // Baseline: gentle daily pattern (kW)
    let baseline = 68 + 10 * Math.sin(((hour - 6) / 24) * Math.PI * 2);
    if (!isWeekend) baseline += (hour >= 8 && hour <= 18 ? 10 : 0);

    // Actual: baseline + small deterministic variation
    const variation = (date.getDate() % 5) - 2; 
    let actual = baseline + variation;

    // Inject anomalies
    if (date.getDate() % 7 === 0 && hour === 14) actual += 25;
    if (date.getDate() % 11 === 0 && hour === 5) actual -= 18;

    points.push({
      ts: date,
      baseline: Math.round(baseline * 10) / 10,
      actual: Math.round(actual * 10) / 10,
    });
  }

  // Baseline is already calculated for mock, but we format properly
  return points;
}

function aggregateData(data, viewMode) {
  if (!data || data.length === 0) return [];
  
  const end = data[data.length - 1].ts;
  let startTime;
  
  if (viewMode === 'daily') {
    startTime = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  } else if (viewMode === 'weekly') {
    startTime = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else {
    startTime = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const filtered = data.filter(d => d.ts >= startTime);
  if (viewMode === 'daily') {
    // Return hourly
    return filtered.map(d => ({
      ...d,
      label: d.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }));
  }

  // Aggregate by day for weekly/monthly
  const dailyGroups = {};
  filtered.forEach(d => {
    const dayStr = d.ts.toISOString().split('T')[0];
    if (!dailyGroups[dayStr]) {
      dailyGroups[dayStr] = { ts: d.ts, sumActual: 0, sumBaseline: 0, count: 0 };
    }
    dailyGroups[dayStr].sumActual += d.actual;
    dailyGroups[dayStr].sumBaseline += d.baseline;
    dailyGroups[dayStr].count += 1;
  });

  return Object.values(dailyGroups).map(g => ({
    ts: g.ts,
    label: g.ts.toLocaleDateString([], { month: 'short', day: 'numeric' }),
    actual: Math.round((g.sumActual / g.count) * 10) / 10,
    baseline: Math.round((g.sumBaseline / g.count) * 10) / 10
  })).sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

/**
 * Convert data points into SVG polyline points.
 */
function toPolylinePoints(data, xScale, yScale, getY) {
  return data
    .map((d, i) => `${xScale(i)},${yScale(getY(d))}`)
    .join(" ");
}

/**
 * Basic chart scales for SVG.
 */
function buildScales(data, width, height, padding, yMin, yMax) {
  const innerW = Math.max(1, width - padding.left - padding.right);
  const innerH = Math.max(1, height - padding.top - padding.bottom);

  const xScale = (i) => padding.left + (i * innerW) / Math.max(1, data.length - 1);

  const yScale = (v) => {
    const clamped = Math.min(yMax, Math.max(yMin, v));
    const t = (clamped - yMin) / Math.max(1e-9, yMax - yMin);
    // Invert for SVG coordinate system
    return padding.top + (1 - t) * innerH;
  };

  return { xScale, yScale, innerW, innerH };
}

/**
 * Determine anomalies based on deviation from baseline.
 */
function computeAnomalies(data, thresholdPct) {
  return data.map((d) => {
    const thresholdValue = d.baseline * (1 + thresholdPct / 100);
    return {
      ...d,
      delta: Math.round((d.actual - d.baseline) * 10) / 10,
      isAnomaly: d.actual > thresholdValue,
    };
  });
}

/**
 * Build demo alerts based on anomaly points and a couple of additional mock rules.
 */
function buildAlerts(anomalySeries) {
  const alerts = [];

  anomalySeries.forEach((d) => {
    if (!d.isAnomaly) return;

    const pctDelta = ((d.actual - d.baseline) / d.baseline) * 100;
    const severity = pctDelta >= 30 ? "critical" : "warning";
    alerts.push({
      id: `${d.ts.toISOString()}-${severity}`,
      ts: d.ts,
      time: d.ts.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      severity,
      title: "Anomaly Detected",
      detail: `Usage reached ${d.actual.toFixed(1)} kW, a deviation of +${Math.round(pctDelta)}% above the baseline of ${d.baseline.toFixed(1)} kW.`,
      pctDelta: Math.round(pctDelta)
    });
  });

  // Add a system info alert for context
  alerts.push({
    id: "system-meter-latency",
    ts: new Date(Date.now() - 1000 * 60 * 22),
    time: new Date(Date.now() - 1000 * 60 * 22).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    severity: "info",
    title: "System Info",
    detail: "Anomaly detection algorithm actively monitoring for deviations above baseline.",
  });

  // Sort newest first
  return alerts.sort((a, b) => b.ts.getTime() - a.ts.getTime());
}

function formatKw(v) {
  return `${v.toFixed(1)} kW`;
}

function severityLabel(severity) {
  if (severity === "critical") return "Critical";
  if (severity === "warning") return "Warning";
  return "Info";
}

// PUBLIC_INTERFACE
function App() {
  const [thresholdPct, setThresholdPct] = useState(20);
  const [csvData, setCsvData] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [viewMode, setViewMode] = useState('daily');

  const rawSeries = useMemo(() => csvData || buildMockSeries(), [csvData]);
  const series = useMemo(() => aggregateData(rawSeries, viewMode), [rawSeries, viewMode]);
  const anomalySeries = useMemo(() => computeAnomalies(series, thresholdPct), [series, thresholdPct]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadError(null);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsedData = parseCSV(evt.target.result);
        setCsvData(parsedData);
      } catch (err) {
        setUploadError(err.message);
        setCsvData(null);
      }
    };
    reader.onerror = () => {
      setUploadError("Failed to read file.");
    };
    reader.readAsText(file);
    e.target.value = null; // reset input
  };
  const alerts = useMemo(() => buildAlerts(anomalySeries), [anomalySeries]);

  const latest = anomalySeries[anomalySeries.length - 1];
  const lastDelta = latest.actual - latest.baseline;

  const kpis = useMemo(() => {
    const avgActual = anomalySeries.reduce((acc, d) => acc + d.actual, 0) / anomalySeries.length;
    const avgBaseline = anomalySeries.reduce((acc, d) => acc + d.baseline, 0) / anomalySeries.length;
    const maxActual = Math.max(...anomalySeries.map((d) => d.actual));
    const anomalies = anomalySeries.filter((d) => d.isAnomaly).length;

    return {
      avgActual,
      avgBaseline,
      maxActual,
      anomalies,
    };
  }, [anomalySeries]);

  // Chart layout (static sizes to keep simple; responsive via viewBox + container)
  const chartW = 920;
  const chartH = 320;
  const padding = { top: 18, right: 18, bottom: 34, left: 44 };

  const allValues = anomalySeries.flatMap((d) => [d.actual, d.baseline]);
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const yPad = Math.max(6, (rawMax - rawMin) * 0.12);
  const yMin = Math.floor((rawMin - yPad) / 5) * 5;
  const yMax = Math.ceil((rawMax + yPad) / 5) * 5;

  const { xScale, yScale } = buildScales(anomalySeries, chartW, chartH, padding, yMin, yMax);

  const baselinePath = toPolylinePoints(anomalySeries, xScale, yScale, (d) => d.baseline);
  const actualPath = toPolylinePoints(anomalySeries, xScale, yScale, (d) => d.actual);

  const yTicks = 4;
  const yTickValues = Array.from({ length: yTicks + 1 }).map((_, idx) => {
    const t = idx / yTicks;
    return yMin + (yMax - yMin) * (1 - t);
  });

  return (
    <div className="vg-app">
      <div className="vg-topbar">
        <div className="vg-brand">
          <div className="vg-logo" aria-hidden="true">
            VG
          </div>
          <div className="vg-brandText">
            <div className="vg-titleRow">
              <h1 className="vg-title">VoltGuard</h1>
              <span className="vg-demoBadge" title="Offline demo using mock/static data">
                Demo Mode
              </span>
            </div>
            <p className="vg-subtitle">Energy Management System • Offline Analytics Demo</p>
          </div>
        </div>

        <div className="vg-topbarRight">
          {uploadError && <div className="vg-uploadError">{uploadError}</div>}
          <div className="vg-uploadBtn">
            <input 
              type="file" 
              accept=".csv" 
              className="vg-uploadInput" 
              onChange={handleFileUpload} 
              aria-label="Upload CSV data"
            />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            Upload CSV
          </div>
          <div className="vg-statusPill" role="status" aria-label="System status">
            <span className="vg-statusDot" aria-hidden="true" style={{ background: csvData ? "var(--vg-primary)" : "var(--vg-success)" }} />
            {csvData ? "Custom Data" : "Offline-ready"}
          </div>
        </div>
      </div>

      <main className="vg-main">
        <section className="vg-left">
          <div className="vg-kpiGrid" aria-label="Key performance indicators">
            <div className="vg-card vg-kpiCard">
              <div className="vg-kpiLabel">Current Actual</div>
              <div className="vg-kpiValue">{formatKw(latest.actual)}</div>
              <div className={`vg-kpiDelta ${lastDelta >= 0 ? "up" : "down"}`}>
                {lastDelta >= 0 ? "+" : ""}
                {lastDelta.toFixed(1)} kW vs baseline
              </div>
            </div>

            <div className="vg-card vg-kpiCard">
              <div className="vg-kpiLabel">Avg Actual (24h)</div>
              <div className="vg-kpiValue">{formatKw(kpis.avgActual)}</div>
              <div className="vg-kpiMeta">Baseline avg {formatKw(kpis.avgBaseline)}</div>
            </div>

            <div className="vg-card vg-kpiCard">
              <div className="vg-kpiLabel">Peak Actual</div>
              <div className="vg-kpiValue">{formatKw(kpis.maxActual)}</div>
              <div className="vg-kpiMeta">Last 24 hours</div>
            </div>

            <div className="vg-card vg-kpiCard">
              <div className="vg-kpiLabel">Anomalies</div>
              <div className="vg-kpiValue">{kpis.anomalies}</div>
              <div className="vg-kpiMeta">Threshold +{thresholdPct}%</div>
            </div>
          </div>

          <div className="vg-card vg-chartCard">
            <div className="vg-cardHeader">
              <div>
                <h2 className="vg-cardTitle">Consumption Analytics</h2>
                <p className="vg-cardSubtitle">Actual vs Baseline (kW) • 4-Week Rolling Baseline</p>
              </div>

              <div className="vg-controls" style={{ gap: '16px' }}>
                <div className="vg-control">
                  <span className="vg-controlLabel">View</span>
                  <div className="vg-sliderRow" style={{ background: 'rgba(17, 24, 39, 0.03)', padding: '2px', borderRadius: '8px', border: '1px solid var(--vg-border)' }}>
                    {['daily', 'weekly', 'monthly'].map(mode => (
                      <button
                        key={mode}
                        onClick={() => setViewMode(mode)}
                        style={{
                          background: viewMode === mode ? 'white' : 'transparent',
                          border: 'none',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: viewMode === mode ? '700' : '600',
                          color: viewMode === mode ? 'var(--vg-primary)' : 'var(--vg-muted)',
                          cursor: 'pointer',
                          boxShadow: viewMode === mode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="vg-control">
                  <span className="vg-controlLabel">Anomaly threshold (%)</span>
                  <div className="vg-sliderRow">
                    <input
                      className="vg-slider"
                      type="range"
                      min="5"
                      max="50"
                      value={thresholdPct}
                      onChange={(e) => setThresholdPct(Number(e.target.value))}
                      aria-label="Anomaly threshold in percentage"
                    />
                    <span className="vg-sliderValue">+{thresholdPct}%</span>
                  </div>
                </label>
              </div>
            </div>

            <div className="vg-chartWrap" role="img" aria-label="Line chart of actual vs baseline power consumption">
              <svg className="vg-chart" viewBox={`0 0 ${chartW} ${chartH}`} preserveAspectRatio="none">
                {/* Grid & axes */}
                <rect x="0" y="0" width={chartW} height={chartH} fill="transparent" />
                {yTickValues.map((v, idx) => {
                  const y = yScale(v);
                  return (
                    <g key={`y-tick-${idx}`}>
                      <line x1={padding.left} x2={chartW - padding.right} y1={y} y2={y} className="vg-gridLine" />
                      <text x={padding.left - 10} y={y + 4} textAnchor="end" className="vg-axisLabel">
                        {Math.round(v)}
                      </text>
                    </g>
                  );
                })}

                {/* X axis labels (every 3 hours) */}
                {anomalySeries.map((d, i) => {
                  if (i % 3 !== 0 && i !== anomalySeries.length - 1) return null;
                  const x = xScale(i);
                  return (
                    <text key={`x-${i}`} x={x} y={chartH - 10} textAnchor="middle" className="vg-axisLabel">
                      {d.label}
                    </text>
                  );
                })}

                {/* Baseline line */}
                <polyline points={baselinePath} className="vg-line vg-lineBaseline" />

                {/* Actual line */}
                <polyline points={actualPath} className="vg-line vg-lineActual" />

                {/* Points */}
                {anomalySeries.map((d, i) => {
                  const x = xScale(i);
                  const y = yScale(d.actual);

                  return (
                    <g key={`pt-${i}`}>
                      <circle cx={x} cy={y} r={d.isAnomaly ? 4.6 : 3.2} className={d.isAnomaly ? "vg-pointAnomaly" : "vg-point"} />
                      {/* Tooltip via <title> keeps it simple and dependency-free */}
                      <title>
                        {d.label} • Actual {d.actual} kW • Baseline {d.baseline} kW • Δ {d.delta >= 0 ? "+" : ""}
                        {d.delta} kW
                      </title>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="vg-legend" aria-label="Chart legend">
              <div className="vg-legendItem">
                <span className="vg-legendSwatch baseline" aria-hidden="true" />
                Baseline
              </div>
              <div className="vg-legendItem">
                <span className="vg-legendSwatch actual" aria-hidden="true" />
                Actual
              </div>
              <div className="vg-legendItem">
                <span className="vg-legendSwatch anomaly" aria-hidden="true" />
                Anomaly point
              </div>
            </div>
          </div>
        </section>

        <aside className="vg-right" aria-label="Alerts panel">
          <div className="vg-card vg-alertsCard">
            <div className="vg-cardHeader tight">
              <div>
                <h2 className="vg-cardTitle">Alerts</h2>
                <p className="vg-cardSubtitle">High/low consumption events (mock)</p>
              </div>
              <div className="vg-alertCount" aria-label={`${alerts.length} alerts`}>
                {alerts.length}
              </div>
            </div>

            <div className="vg-alertList" role="list">
              {alerts.slice(0, 8).map((a) => (
                <div key={a.id} className={`vg-alertItem ${a.severity}`} role="listitem">
                  <div className="vg-alertTop">
                    <span className={`vg-sevDot ${a.severity}`} aria-hidden="true" />
                    <div className="vg-alertTitle">{a.title}</div>
                    <div className="vg-alertTime">{a.time}</div>
                  </div>
                  <div className="vg-alertDetail">{a.detail}</div>
                  <div className="vg-alertFooter">
                    <span className={`vg-sevPill ${a.severity}`}>{severityLabel(a.severity)}</span>
                    {a.pctDelta !== undefined ? (
                      <span className="vg-alertHint">Deviation: +{a.pctDelta}%</span>
                    ) : (
                      <span className="vg-alertHint">System</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="vg-alertsFooterNote">
              This is a hackathon demo dashboard. Data is static/offline and updates are not required.
            </div>
          </div>
        </aside>
      </main>

      <footer className="vg-footer">
        <div className="vg-footerLeft">
          <span className="vg-footerLabel">VoltGuard EMS</span>
          <span className="vg-footerDot" aria-hidden="true" />
          <span className="vg-footerMuted">Offline Demo</span>
        </div>
        <div className="vg-footerRight">
          <span className="vg-footerMuted">
            Tip: Hover points on the chart for readings. Anomalies are marked in red.
          </span>
        </div>
      </footer>
    </div>
  );
}

export default App;
