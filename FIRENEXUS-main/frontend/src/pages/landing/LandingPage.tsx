import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { ArrowDown, ArrowRight, ArrowUpRight, Activity, Satellite, Globe2, Layers3, Crosshair, Clock3, FileChartColumn, Menu, X, Radio, ShieldCheck, ScanLine, Database, Orbit } from 'lucide-react';
import { api } from '../../services/api';
import { useApiResource } from '../../hooks/useApi';
import type { FireObservation, OverviewMetrics } from '../../types/firenexus';
import './landing.css';

const EarthScene = lazy(() => import('./EarthScene'));
const rise = { hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.2, 0.7, 0.2, 1] as const } } };
const formatCount = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('en-US').format(value);

const capabilities = [
  { icon: Crosshair, n: '01', title: 'Active fire detection', body: 'Surface thermal anomalies from NASA MODIS and VIIRS observations, unified in one geospatial workspace.' },
  { icon: Layers3, n: '02', title: 'Sensor harmonization', body: 'Associate observations across instruments with transparent spatial and temporal matching.' },
  { icon: Clock3, n: '03', title: 'Temporal intelligence', body: 'Read seasonal patterns, anomalies and changing fire activity across time.' },
  { icon: Globe2, n: '04', title: 'Geospatial exploration', body: 'Move from global context to a region of interest with precise, map-first analysis.' },
  { icon: Activity, n: '05', title: 'Sensor comparison', body: 'Understand agreement, coverage and measurement differences between platforms.' },
  { icon: FileChartColumn, n: '06', title: 'Scientific reporting', body: 'Turn reproducible analyses into reports grounded in your loaded observation data.' },
];
const workflow = [
  ['01', 'Connect observations', 'Load NASA FIRMS exports or bring your own MODIS and VIIRS datasets.'],
  ['02', 'Explore the signal', 'Filter active fire observations by sensor, region, time and confidence.'],
  ['03', 'Harmonize sensors', 'Match observations into cross-sensor events with configurable tolerances.'],
  ['04', 'Make it actionable', 'Compare, analyze and generate a traceable scientific report.'],
];

function Metric({ label, value, detail, loading }: { label: string; value: string; detail: string; loading: boolean }) {
  const number = useMotionValue(0);
  const reducedMotion = useReducedMotion();
  const displayedNumber = useTransform(number, (current) => formatCount(Math.round(current)));
  useEffect(() => {
    const target = Number(value.replaceAll(',', ''));
    if (loading || !Number.isFinite(target)) return;
    const controls = animate(number, target, { duration: reducedMotion ? 0 : 1.1, ease: 'easeOut' });
    return () => controls.stop();
  }, [loading, number, reducedMotion, value]);
  return <motion.div className="metric-cell" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.5 }} transition={{ duration: 0.45 }}><div className="metric-value">{loading ? <span className="metric-skeleton" /> : value === '—' ? value : <motion.span>{displayedNumber}</motion.span>}</div><div className="metric-label">{label}</div><div className="metric-detail">{loading ? 'Retrieving from API' : detail}</div></motion.div>;
}

function Stats({ metrics, loading, error }: { metrics: OverviewMetrics | null; loading: boolean; error: Error | null }) {
  const unavailable = error ? 'API unavailable' : metrics?.status === 'no_dataset' ? 'No dataset loaded' : 'Not computed';
  return <section className="stats-section" id="signal"><div className="section-shell">
    <div className="stats-heading"><div><span className="eyebrow"><span className="pulse-dot" /> OBSERVATION NETWORK</span><h2>Grounded in <em>real signals.</em></h2></div><div className="live-status"><span className={`status-light ${error ? 'status-offline' : ''}`} />{loading ? 'CONNECTING TO API' : error ? 'API UNAVAILABLE' : metrics?.status === 'ready' ? 'DATA AVAILABLE' : 'AWAITING DATA'}</div></div>
    <div className="metrics-grid"><Metric label="Total detections" value={formatCount(metrics?.totalDetections)} detail={metrics?.totalDetections == null ? unavailable : 'Across loaded observations'} loading={loading} /><Metric label="MODIS observations" value={formatCount(metrics?.modisCount)} detail={metrics?.modisCount == null ? unavailable : 'Terra · Aqua'} loading={loading} /><Metric label="VIIRS observations" value={formatCount(metrics?.viirsCount)} detail={metrics?.viirsCount == null ? unavailable : 'Suomi-NPP · NOAA-20 · NOAA-21'} loading={loading} /><Metric label="Harmonized clusters" value={formatCount(metrics?.harmonizedDualSensorClusters)} detail={metrics?.harmonizedDualSensorClusters == null ? 'Run harmonization to compute' : 'Confirmed dual-sensor matches'} loading={loading} /></div>
    {error && <p className="api-note">Statistics could not be retrieved. Start the FIRENEXUS API to load current values.</p>}
  </div></section>;
}

export default function LandingPage() {
  const { data, loading, error } = useApiResource(() => api.getOverviewMetrics(), []);
  const observationsRes = useApiResource(() => api.getExplorerHotspots(), []);
  const observations: FireObservation[] = observationsRes.data?.items ?? [];
  const globeStatus = observationsRes.loading ? 'CONNECTING' : observationsRes.error ? 'API OFFLINE' : observationsRes.data?.total ? `${observationsRes.data.total.toLocaleString()} OBSERVATIONS` : observationsRes.data?.status === 'no_dataset' ? 'AWAITING DATA' : 'NO OBSERVATIONS';
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  return <div className="landing">
    <nav className="landing-nav"><Link to="/" className="brand-lockup" onClick={closeMenu}><span className="brand-mark"><Orbit size={20} /></span><span>FIRE<span>NEXUS</span><small>EARTH OBSERVATION INTELLIGENCE</small></span></Link>
      <div className={`nav-links ${menuOpen ? 'nav-links-open' : ''}`}><a href="#platform" onClick={closeMenu}>Platform</a><a href="#workflow" onClick={closeMenu}>How it works</a><a href="#mission" onClick={closeMenu}>Mission</a><Link className="mobile-app-link" to="/app" onClick={closeMenu}>Open platform <ArrowUpRight size={15} /></Link></div>
      <Link to="/app" className="nav-cta">Explore platform <ArrowUpRight size={15} /></Link><button className="menu-toggle" aria-label="Toggle navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
    </nav>

    <header className="hero">
      <div className="hero-grid" />
      <div className="hero-copy">
        <motion.div initial="hidden" animate="visible" variants={rise} className="hero-kicker"><span className="kicker-line" /> NASA EARTH OBSERVATION · WILDFIRE INTELLIGENCE</motion.div>
        <motion.h1 initial="hidden" animate="visible" variants={rise} transition={{ delay: 0.1 }}>See the signal.<br /><span>Understand the fire.</span></motion.h1>
        <motion.p initial="hidden" animate="visible" variants={rise} transition={{ delay: 0.2 }}>A global view of active fire, shaped by satellite observations. Explore, harmonize and interpret the changing signal on Earth.</motion.p>
        <motion.div className="hero-actions" initial="hidden" animate="visible" variants={rise} transition={{ delay: 0.3 }}><Link to="/app" className="button-primary">Enter the platform <ArrowRight size={17} /></Link><a href="#platform" className="button-quiet">Discover FIRENEXUS <ArrowDown size={15} /></a></motion.div>
        <motion.div className="hero-proof" initial="hidden" animate="visible" variants={rise} transition={{ delay: 0.4 }}><span><Satellite size={15} /> MODIS + VIIRS</span><i /><span><Radio size={15} /> NASA FIRMS compatible</span></motion.div>
      </div>
      <div className="earth-stage"><div className="earth-glow" /><div className="earth-canvas"><Suspense fallback={<div className="earth-fallback"><Globe2 /></div>}><EarthScene observations={observations.slice(0, 128)} /></Suspense></div>
        <div className="earth-tag earth-tag-top"><span className="tag-cross">+</span> ORBITAL VIEW <span>FIRENEXUS</span></div><div className="earth-tag earth-tag-bottom"><span className={`pulse-dot ${observationsRes.error ? 'pulse-offline' : ''}`} /> GLOBAL OBSERVATION LAYER <span>{globeStatus}</span></div>
        <div className="orbit-card"><span className="orbit-icon"><Satellite size={17} /></span><div><b>Multi-sensor view</b><small>Terra · Aqua · Suomi-NPP · NOAA</small></div></div>
      </div>
      <div className="hero-coordinate">GLOBAL VIEW <span>EARTH SYSTEMS / WGS 84</span></div>
      <a className="scroll-cue" href="#signal"><span /> SCROLL TO EXPLORE</a>
    </header>

    <Stats metrics={data} loading={loading} error={error} />

    <section className="capabilities section-shell" id="platform"><motion.div className="section-intro" initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.3 }} variants={rise}><span className="eyebrow">ONE PLANET. MANY SIGNALS.</span><h2>Intelligence for a<br /><em>changing Earth.</em></h2><p>FIRENEXUS brings satellite fire observations into a coherent environment for scientific discovery and operational insight.</p></motion.div>
      <div className="capability-grid">{capabilities.map(({ icon: Icon, n, title, body }, i) => <motion.article className="capability-card" key={title} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }} variants={rise} transition={{ delay: i * 0.06 }}><div className="cap-card-top"><span className="cap-icon"><Icon size={19} /></span><span>{n}</span></div><h3>{title}</h3><p>{body}</p><span className="cap-arrow"><ArrowUpRight size={16} /></span></motion.article>)}</div>
    </section>

    <section className="workflow-section" id="workflow"><div className="section-shell"><motion.div className="workflow-head" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={rise}><div><span className="eyebrow">FROM ORBIT TO INSIGHT</span><h2>A clear path from<br /><em>data to understanding.</em></h2></div><p>Every step stays connected to the source observations, with transparent methods and reproducible analysis.</p></motion.div>
      <div className="workflow-grid">{workflow.map(([number, title, body], i) => <motion.article key={number} className="workflow-step" initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.3 }} variants={rise} transition={{ delay: i * .08 }}><div className="step-number">{number}<span /></div><h3>{title}</h3><p>{body}</p></motion.article>)}</div>
    </div></section>

    <section className="data-section section-shell"><div className="data-orbit-art"><div className="data-ring ring-one" /><div className="data-ring ring-two" /><div className="data-core"><Database size={29} /><span>NASA<br />EARTH DATA</span></div><span className="data-node node-a" /><span className="data-node node-b" /><span className="data-node node-c" /></div><motion.div className="data-copy" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={rise}><span className="eyebrow">BUILT ON OPEN SCIENCE</span><h2>Trusted sources.<br /><em>Traceable insight.</em></h2><p>Designed around established NASA Earth observation sources. Bring your own data, preserve provenance and know exactly what is available in your analysis.</p><div className="source-list"><span><ShieldCheck size={16} /> NASA FIRMS</span><span><Satellite size={16} /> MODIS · Terra / Aqua</span><span><ScanLine size={16} /> VIIRS · Suomi-NPP / NOAA</span></div><span className="data-disclaimer">Coverage and metrics depend on the datasets loaded into your FIRENEXUS instance.</span></motion.div></section>

    <section className="mission-section" id="mission"><div className="mission-overlay" /><div className="mission-content section-shell"><motion.span className="eyebrow" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={rise}>OUR MISSION</motion.span><motion.h2 initial="hidden" whileInView="visible" viewport={{ once: true }} variants={rise}>A more complete picture<br />of <em>fire on Earth.</em></motion.h2><motion.p initial="hidden" whileInView="visible" viewport={{ once: true }} variants={rise}>When observations become understanding, communities and researchers can see the dynamics of a changing planet with greater clarity.</motion.p><motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={rise}><Link to="/app" className="button-primary">Explore the intelligence platform <ArrowRight size={17} /></Link></motion.div></div><span className="mission-coordinate">OBSERVE · CONNECT · UNDERSTAND</span></section>

    <footer className="landing-footer"><div className="footer-main section-shell"><div><Link to="/" className="brand-lockup"><span className="brand-mark"><Orbit size={20} /></span><span>FIRE<span>NEXUS</span><small>EARTH OBSERVATION INTELLIGENCE</small></span></Link><p>Satellite-powered wildfire intelligence for a changing planet.</p></div><div className="footer-links"><a href="#platform">Platform</a><a href="#workflow">How it works</a><a href="#mission">Our mission</a></div><Link to="/app" className="footer-cta">Enter platform <ArrowUpRight size={16} /></Link></div><div className="footer-bottom section-shell"><span>© 2026 FIRENEXUS · EARTH OBSERVATION INTELLIGENCE</span><span>Built for a clearer view of our planet.</span></div></footer>
  </div>;
}
