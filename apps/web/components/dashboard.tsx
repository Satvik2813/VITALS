'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bell,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Clock3,
  HeartPulse,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import type { Snapshot } from '../lib/types';
import { AuditList, Badge, BurdenPanel, ChartLegend, Conflict, request, Stat, stateLabels } from './shared';
import { BurdenChart } from './charts';
import { PatientDetail } from './patient';
import { DocumentGateway } from './documents';
type View = 'command' | 'trust' | 'analytics' | 'audit';
export default function Dashboard() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [view, setView] = useState<View>('command');
  const [selected, setSelected] = useState('p1');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [roundTrip, setRoundTrip] = useState(0);
  const refresh = useCallback(async () => {
    const start = performance.now();
    const value: Snapshot = await (await request('snapshot')).json();
    setRoundTrip(Math.round(performance.now() - start));
    setData(value);
    setError('');
  }, []);
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (mounted) await refresh();
      } catch (e) {
        if (mounted) setError((e as Error).message);
      }
      if (mounted) timer = setTimeout(poll, 1000);
    }
    poll();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  async function control(action: string) {
    setBusy(action);
    try {
      await request('demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      await refresh();
      if (action === 'reset') {
        setSelected('p1');
        setNotice('New run started. Previous documents and audit records are preserved.');
      }
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function acknowledge(id: string) {
    try {
      await request(`alerts/${id}/acknowledge`, { method: 'POST' });
      await refresh();
      setNotice('Alert acknowledged. Monitoring and physiological severity remain active.');
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  const patient = data?.patients.find((p) => p.id === selected) || data?.patients[0];
  const critical = data?.patients.filter((p) => p.risk.state === 'CRITICAL').length || 0;
  const watch = data?.patients.filter((p) => p.risk.state === 'WATCH').length || 0;
  const warning = data?.patients.filter((p) => p.risk.state === 'WARNING').length || 0;
  const attention = watch + warning;
  const stable = data?.patients.filter((p) => p.risk.state === 'NORMAL').length || 0;
  const securityCount = data?.documents.filter((d) => d.scan.quarantined).length || 0;
  const activeAlerts = data?.alerts.filter((alert) => !alert.acknowledged_at).length || 0;
  const stale =
    !!data && data.demo.playing && Date.now() - new Date(data.demo.last_ingested_at).getTime() > 15000;
  const title = {
    command: 'Clinical command center',
    trust: 'Document trust',
    analytics: 'Less noise. Clearer attention.',
    audit: 'A traceable chain of decisions.',
  }[view];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="VITALIS home">
          <span className="brand-mark">
            <Activity size={24} />
          </span>
          VITALIS<span className="brand-dot">•</span>
        </a>
        <div className="workspace-label">CLINICAL WORKSPACE</div>
        <nav aria-label="Main navigation">
          {(
            [
              { id: 'command', name: 'Command center', icon: LayoutDashboard },
              { id: 'trust', name: 'Document trust', icon: ShieldCheck },
              { id: 'analytics', name: 'Alert analytics', icon: Activity },
              { id: 'audit', name: 'Audit trail', icon: Clock3 },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={view === item.id ? 'nav-item active' : 'nav-item'}
              onClick={() => setView(item.id)}
              aria-current={view === item.id ? 'page' : undefined}
            >
              <item.icon size={19} />
              {item.name}
              {item.id === 'trust' && securityCount > 0 && <span className="nav-count">{securityCount}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="guard-card">
            <ShieldCheck size={23} />
            <strong>Context protection on</strong>
            <p>External records are screened before entering clinical context.</p>
            <span>
              <i />
              Zero-trust gateway
            </span>
          </div>
          <div className="clinician">
            <span className="doctor-avatar">DR</span>
            <div>
              <strong>Demo clinician</strong>
              <small>Clinical decision support</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>
              {view === 'command'
                ? 'Overview'
                : view === 'trust'
                  ? 'Document trust'
                  : view === 'analytics'
                    ? 'Alert analytics'
                    : 'Audit trail'}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="synthetic-label">SYNTHETIC DEMO</span>
            <span className={`stream-status ${error || stale ? 'disconnected' : ''}`}>
              <i />
              {error || stale
                ? 'Stream unavailable'
                : data?.demo.playing
                  ? 'Stream connected'
                  : 'Stream paused'}
            </span>
            <span className="topbar-divider" />
            <Bell size={18} />
            <span className="avatar-small">DR</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">ATTENTION, NOT DATA</div>
              <h1>{title}</h1>
              <p>
                {view === 'command'
                  ? 'A clear view of who needs you. And the evidence you can trust.'
                  : view === 'trust'
                    ? 'Protect the clinical context without losing the original record.'
                    : view === 'analytics'
                      ? 'Two alert systems. The same synthetic physiological stream.'
                      : 'From physiological evidence to protected clinical context.'}
              </p>
            </div>
            <div className="demo-controls">
              <button
                className="icon-button"
                title="Reset synthetic run"
                aria-label="Reset synthetic run"
                disabled={!!busy}
                onClick={() => control('reset')}
              >
                <RotateCcw size={17} />
              </button>
              <button
                className="secondary-button"
                disabled={!!busy || !data}
                onClick={() => control(data?.demo.playing ? 'pause' : 'play')}
              >
                {data?.demo.playing ? <Pause size={15} /> : <Play size={15} />}{' '}
                {data?.demo.playing ? 'Pause' : 'Resume'}
              </button>
              <button
                className="primary-button"
                disabled={!!busy || !data || data.demo.deteriorating}
                onClick={() => control('deteriorate')}
              >
                <Activity size={17} />
                {data?.demo.deteriorating ? 'Deterioration running' : 'Start deterioration'}
              </button>
            </div>
          </div>
          {(error || stale || data?.demo.error) && (
            <div className="error-banner" role="alert">
              <ShieldAlert size={19} />
              {error ||
                data?.demo.error ||
                'No fresh readings for 15 seconds. Displaying the last received observations.'}
            </div>
          )}
          {!data || !patient ? (
            <div className="loading-state">
              <LoaderCircle className="spin" size={30} />
              <h2>Connecting to the clinical stream</h2>
              <p>{error || 'Loading patient baselines and the current observation window…'}</p>
              <code>npm run dev</code>
            </div>
          ) : (
            <>
              <section className="stats-grid" aria-label="Monitoring summary">
                <Stat
                  label="Monitored patients"
                  value={data.patients.length}
                  icon={<Users size={20} />}
                  note={`${stable} stable · all synthetic`}
                />
                <Stat
                  label="Needs attention"
                  value={attention}
                  icon={<Activity size={20} />}
                  note={`${watch} watch · ${warning} warning`}
                  tone="amber"
                />
                <Stat
                  label="Critical patients"
                  value={critical}
                  icon={<HeartPulse size={20} />}
                  note={`${activeAlerts} active alert${activeAlerts === 1 ? '' : 's'}`}
                  tone={critical ? 'red' : ''}
                />
                <Stat
                  label="Security events"
                  value={securityCount}
                  icon={<ShieldCheck size={20} />}
                  note={
                    securityCount
                      ? `${securityCount} document quarantine${securityCount === 1 ? '' : 's'}`
                      : 'Gateway monitoring active'
                  }
                  tone="green"
                />
              </section>
              {view === 'command' && (
                <>
                  <div className="command-grid">
                    <section className="panel patient-queue">
                      <div className="section-heading">
                        <div>
                          <h2>
                            Patient queue <span className="count-pill">{data.patients.length}</span>
                          </h2>
                          <p>Prioritized by physiological urgency</p>
                        </div>
                        <span className="live-dot" />
                      </div>
                      <label className="search-field">
                        <Search size={16} />
                        <input
                          aria-label="Search patients"
                          placeholder="Find a patient…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      <div className="queue-list">
                        {data.patients
                          .filter((p) =>
                            `${p.name} ${p.condition}`.toLowerCase().includes(search.toLowerCase()),
                          )
                          .map((p) => (
                            <button
                              className={`patient-row ${p.id === selected ? 'selected' : ''} ${p.risk.state.toLowerCase()}`}
                              key={p.id}
                              onClick={() => setSelected(p.id)}
                            >
                              <div className="patient-row-top">
                                <span className="patient-avatar">{p.initials}</span>
                                <div className="patient-identity">
                                  <strong>{p.name}</strong>
                                  <small>
                                    {p.age} years · {p.sex} · {p.room}
                                  </small>
                                </div>
                                <span className={`state-indicator ${p.risk.state.toLowerCase()}`} />
                              </div>
                              <div className="patient-row-bottom">
                                <Badge state={p.risk.state} />
                                <span>
                                  SpO₂ <b>{p.vitals.spo2}%</b>
                                </span>
                                <span>
                                  NEWS2 <b>{p.risk.news2_score}</b>
                                </span>
                                {p.trust_conflict && <ShieldAlert size={15} className="red-text" />}
                              </div>
                            </button>
                          ))}
                        {!data.patients.some((p) =>
                          `${p.name} ${p.condition}`.toLowerCase().includes(search.toLowerCase()),
                        ) && <p className="empty-small">No matching patients.</p>}
                      </div>
                      <div className="queue-footer">
                        <Radio size={14} />1 sample / 2 sec · 1 simulated minute
                      </div>
                    </section>
                    <PatientDetail
                      patient={patient}
                      data={data}
                      refresh={refresh}
                      notify={setNotice}
                      acknowledge={acknowledge}
                    />
                  </div>
                  <div className="bottom-grid">
                    <BurdenPanel metrics={data.metrics} onExpand={() => setView('analytics')} />
                    <section className="panel recent-events">
                      <div className="section-heading">
                        <div>
                          <h2>Recent activity</h2>
                          <p>Every decision leaves a trace</p>
                        </div>
                        <button className="text-button" onClick={() => setView('audit')}>
                          View audit <ArrowRight size={14} />
                        </button>
                      </div>
                      <AuditList events={data.audit.slice(0, 4)} compact />
                    </section>
                  </div>
                </>
              )}
              {view === 'trust' && (
                <div className="trust-layout">
                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <h2>Clinical document gateway</h2>
                        <p>Screen → classify → isolate → assemble context</p>
                      </div>
                      <ShieldCheck size={22} />
                    </div>
                    <label className="patient-select">
                      Patient
                      <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                        {data.patients.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {stateLabels[p.risk.state]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {patient.trust_conflict && <Conflict patient={patient} />}
                    <DocumentGateway patient={patient} refresh={refresh} notify={setNotice} />
                  </section>
                  <section className="panel context-panel">
                    <div className="section-heading">
                      <div>
                        <h2>Protected clinical context</h2>
                        <p>{patient.name}</p>
                      </div>
                      <LockKeyhole size={20} />
                    </div>
                    <div className="context-physiology">
                      <span>LIVE PHYSIOLOGICAL EVIDENCE</span>
                      <Badge state={patient.risk.state} />
                      <strong>NEWS2 {patient.risk.news2_score}</strong>
                      <p>Computed from complete live observations. Documents cannot change this score.</p>
                    </div>
                    <h3>Screened historical facts</h3>
                    {patient.context.screened_historical_facts.length ? (
                      patient.context.screened_historical_facts.map((f, i) => (
                        <div className="fact-line" key={i}>
                          <span>{f.fact_type}</span>
                          <strong>
                            {f.value} {f.provenance.unit}
                          </strong>
                          <small>
                            Page {f.provenance.page}, line {f.provenance.line} · unverified
                          </small>
                        </div>
                      ))
                    ) : (
                      <p className="empty-small">No document facts admitted for this patient.</p>
                    )}
                    <div className="policy-note">
                      <ShieldCheck size={18} />
                      <p>
                        {patient.context.excluded_documents} document(s) excluded. Only numeric allowlisted
                        facts from passed scans can enter this context. Document instructions never enter the
                        risk engine.
                      </p>
                    </div>
                  </section>
                </div>
              )}
              {view === 'analytics' && (
                <>
                  <div className="analytics-hero">
                    <div>
                      <span className="eyebrow">MEASURED IN THIS RUN</span>
                      <strong>
                        {data.metrics.reduction_pct}
                        <span>%</span>
                      </strong>
                      <h2>lower demonstrated alert burden</h2>
                      <p>
                        Correlated attention events compared with one alert per violating parameter, per
                        sample.
                      </p>
                    </div>
                    <div className="analytics-counts">
                      <div>
                        <span>Naive threshold alerts</span>
                        <strong>{data.metrics.raw_threshold_alerts}</strong>
                      </div>
                      <ArrowRight />
                      <div>
                        <span>VITALIS attention events</span>
                        <strong className="green-text">{data.metrics.actionable_alerts}</strong>
                      </div>
                    </div>
                  </div>
                  <section className="panel analytics-chart">
                    <div className="section-heading">
                      <div>
                        <h2>Cumulative alert burden</h2>
                        <p>
                          Live counts from {data.metrics.samples.toLocaleString()} processed patient
                          observations
                        </p>
                      </div>
                      <ChartLegend />
                    </div>
                    <BurdenChart metrics={data.metrics} />
                  </section>
                  <div className="analytics-details">
                    <Stat
                      label="Known episodes detected"
                      value={`${data.metrics.episodes_detected}/${data.metrics.known_episodes}`}
                      icon={<CheckCheck size={20} />}
                      note="WARNING or CRITICAL in labelled episode"
                    />
                    <Stat
                      label="Detection delay"
                      value={
                        data.metrics.detection_delay_minutes === null
                          ? '—'
                          : `${data.metrics.detection_delay_minutes}m`
                      }
                      icon={<Clock3 size={20} />}
                      note="Simulated minutes after episode onset"
                    />
                    <Stat
                      label="False-positive events"
                      value={data.metrics.false_positive_events}
                      icon={<Bell size={20} />}
                      note="Escalations outside the labelled episode"
                    />
                    <Stat
                      label="Processing p95"
                      value={`${data.metrics.processing_p95_ms}ms`}
                      icon={<Activity size={20} />}
                      note="Scoring + writes, excludes commit/network"
                    />
                  </div>
                  <div className="method-note">
                    <CircleHelp size={20} />
                    <div>
                      <h3>What this comparison measures</h3>
                      <p>
                        The naive system also had {data.metrics.naive_alerting_samples} distinct alerting
                        patient-samples. VITALIS counts each upward attention transition, including Watch.
                        Duplicate states are not new events. Severe NEWS2 triggers bypass persistence. This
                        scenario demonstrates notification reduction, not clinical sensitivity or validation.
                        Dashboard API round trip: {roundTrip} ms; polling adds up to 1 second.
                      </p>
                    </div>
                  </div>
                </>
              )}
              {view === 'audit' && (
                <section className="panel full-audit">
                  <div className="section-heading">
                    <div>
                      <h2>Current run · audit timeline</h2>
                      <p>Most recent first · wall-clock timestamps · latest 200 events</p>
                    </div>
                    <span className="quiet-label">Run {data.demo.run_id.slice(0, 8)}</span>
                  </div>
                  <AuditList events={data.audit} />
                </section>
              )}
              <footer className="page-footer">
                <span>
                  <ShieldCheck size={14} />
                  Clinical decision support only. Synthetic adults. Clinician judgment remains final.
                </span>
                <span>
                  {data.demo.storage} · simulated minute {data.demo.minute}
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <ShieldCheck size={20} />
          <span>{notice}</span>
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
