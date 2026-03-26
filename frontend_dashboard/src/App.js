import React, { useMemo, useState } from "react";
import "./App.css";

/**
 * Create deterministic mock time-series data for the demo dashboard.
 * - Baseline is smooth and predictable.
 * - Actual follows baseline with noise, with a few injected anomalies.
 */
function buildMockSeries() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() - 23);

  const points = [];
  for (let i = 0; i < 24; i += 1) {
    const t = new Date(start.getTime() + i * 60 * 60 * 1000);
    const hour = t.getHours();

    // Baseline: gentle daily pattern (kW)
    const baseline =
      68 +
      10 * Math.sin(((i - 6) / 24) * Math.PI * 2) +
      (hour >= 18 ? 6 : 0) +
      (hour >= 8 && hour <= 11 ? 3 : 0);

    // Actual: baseline + small deterministic variation (no randomness to keep stable in demos)
    const variation = (i % 5) - 2; // [-2..+2]
    let actual = baseline + variation;

    // Inject anomalies (spike/drop)
    const anomalyHours = new Set([5, 14, 19]);
    if (anomalyHours.has(i)) {
      actual = i === 14 ? baseline + 22 : baseline - 18;
    }

    points.push({
      ts: t,
      label: t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      baseline: Math.round(baseline * 10) / 10,
      actual: Math.round(actual * 10) / 10,
    });
  }

  return points;
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
function computeAnomalies(data, thresholdKw) {
  return data.map((d) => ({
    ...d,
    delta: Math.round((d.actual - d.baseline) * 10) / 10,
    isAnomaly: Math.abs(d.actual - d.baseline) >= thresholdKw,
  }));
}

/**
 * Build demo alerts based on anomaly points and a couple of additional mock rules.
 */
function buildAlerts(anomalySeries) {
  const alerts = [];

  anomalySeries.forEach((d) => {
    if (!d.isAnomaly) return;

    const severity = Math.abs(d.delta) >= 20 ? "critical" : "warning";
    alerts.push({
      id: `${d.ts.toISOString()}-${severity}`,
      ts: d.ts,
      time: d.label,
      severity,
      title: d.delta > 0 ? "High consumption anomaly" : "Unexpected load drop",
      detail:
        d.delta > 0
          ? `Actual ${d.actual} kW is +${d.delta} kW over baseline (${d.baseline} kW).`
          : `Actual ${d.actual} kW is ${d.delta} kW under baseline (${d.baseline} kW).`,
    });
  });

  // Add a couple of static "system" alerts for demo richness.
  alerts.push(
    {
      id: "system-meter-latency",
      ts: new Date(Date.now() - 1000 * 60 * 22),
      time: new Date(Date.now() - 1000 * 60 * 22).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      severity: "info",
      title: "Telemetry running in Demo Mode",
      detail: "Dashboard uses offline mock data. No backend connection required.",
    },
    {
      id: "system-efficiency",
      ts: new Date(Date.now() - 1000 * 60 * 55),
      time: new Date(Date.now() - 1000 * 60 * 55).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      severity: "warning",
      title: "Efficiency drift detected",
      detail: "Baseline alignment drifted 1.7% over the past 6 hours (demo).",
    }
  );

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
  const [thresholdKw, setThresholdKw] = useState(12);

  const series = useMemo(() => buildMockSeries(), []);
  const anomalySeries = useMemo(() => computeAnomalies(series, thresholdKw), [series, thresholdKw]);
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
          <div className="vg-statusPill" role="status" aria-label="System status">
            <span className="vg-statusDot" aria-hidden="true" />
            Offline-ready
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
              <div className="vg-kpiMeta">Threshold {thresholdKw} kW</div>
            </div>
          </div>

          <div className="vg-card vg-chartCard">
            <div className="vg-cardHeader">
              <div>
                <h2 className="vg-cardTitle">Consumption Analytics</h2>
                <p className="vg-cardSubtitle">Actual vs Baseline (kW) • Anomalies highlighted</p>
              </div>

              <div className="vg-controls">
                <label className="vg-control">
                  <span className="vg-controlLabel">Anomaly threshold</span>
                  <div className="vg-sliderRow">
                    <input
                      className="vg-slider"
                      type="range"
                      min="6"
                      max="20"
                      value={thresholdKw}
                      onChange={(e) => setThresholdKw(Number(e.target.value))}
                      aria-label="Anomaly threshold in kW"
                    />
                    <span className="vg-sliderValue">{thresholdKw} kW</span>
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
                    <span className="vg-alertHint">Demo alert</span>
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
