// src/components/pages/AdminPage.jsx
// Admin: read-only dashboard of all transfers.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Download, Inbox, KeyRound, LayoutDashboard, LogOut, RefreshCw, Search } from 'lucide-react';
import { Alert, AppShell, Button, Card, Empty, Field, Modal, Spinner, StatusBadge } from '../common/UI';
import TransferView from '../common/TransferView';
import { api } from '../services/api';
import { PLANTS, STATUS, downloadCsv, fmtDate, session } from '../services/helpers';

const KEY = 'mat_admin_key';

function AdminLogin({ onLogin }) {
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!key) return setError('Enter the admin passcode');
    setLoading(true);
    setError('');
    try {
      const res = await api.adminList(key);
      onLogin(key, res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="login" onSubmit={submit} noValidate>
      <div className="login-icon"><LayoutDashboard size={30} /></div>
      <h1>Admin Dashboard</h1>
      <p className="muted">Enter the admin passcode to view all transfers.</p>
      <Field label="Passcode" required>
        {(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={key} onChange={(e) => setKey(e.target.value)} />}
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" icon={KeyRound} loading={loading} block>Sign in</Button>
    </form>
  );
}

export default function AdminPage() {
  const [key, setKey] = useState(() => session.get(KEY));
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ALL');
  const [plant, setPlant] = useState('');
  const [detail, setDetail] = useState(null); // { loading, data, error, asset }

  const logout = useCallback(() => {
    session.remove(KEY);
    setKey(null);
    setRows(null);
  }, []);

  const load = useCallback(async (k = key) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.adminList(k);
      setRows(res.data);
    } catch (err) {
      if (err.status === 401) logout();
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [key, logout]);

  useEffect(() => {
    if (key && !rows) load(key);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const onLogin = (k, data) => {
    session.set(KEY, k);
    setKey(k);
    setRows(data);
  };

  const openDetail = async (asset) => {
    setDetail({ loading: true, asset });
    try {
      const res = await api.adminGet(key, asset);
      setDetail({ data: res.data, asset });
    } catch (err) {
      setDetail({ error: err.message, asset });
    }
  };

  /* ---- derived ---- */
  const counts = useMemo(() => {
    const c = { ALL: rows?.length || 0, PENDING: 0, ON_HOLD: 0, ACCEPTED: 0, REJECTED: 0 };
    rows?.forEach((r) => (c[r.status] += 1));
    return c;
  }, [rows]);

  const flows = useMemo(() => {
    const m = new Map();
    rows?.forEach((r) => {
      const k = `${r.from_plant}→${r.to_plant}`;
      m.set(k, { from: r.from_plant, to: r.to_plant, n: (m.get(k)?.n || 0) + 1 });
    });
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  }, [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rows || []).filter((r) =>
      (status === 'ALL' || r.status === status) &&
      (!plant || r.from_plant === plant || r.to_plant === plant) &&
      (!term || [r.asset_number, r.machine_name, r.sap_no, r.equipment_number, r.provider_email, r.receiver_email]
        .some((v) => v?.toLowerCase().includes(term)))
    );
  }, [rows, q, status, plant]);

  const exportCsv = () =>
    downloadCsv(`asset-transfers-${new Date().toLocaleDateString('en-CA')}.csv`, [
      ['Asset Number', 'Date', 'From', 'To', 'Machine', 'SAP No', 'Equipment No', 'Electrical', 'Provider', 'Receiver', 'Status', 'Created', 'Updated'],
      ...filtered.map((r) => [
        r.asset_number, r.transfer_date, r.from_plant, r.to_plant, r.machine_name, r.sap_no, r.equipment_number,
        r.has_electrical ? 'Yes' : 'No', r.provider_email, r.receiver_email, STATUS[r.status]?.label, r.created_at, r.updated_at,
      ]),
    ]);

  if (!key) {
    return (
      <AppShell title="Admin" subtitle="Dashboard">
        <AdminLogin onLogin={onLogin} />
      </AppShell>
    );
  }

  const maxFlow = flows[0]?.n || 1;

  return (
    <AppShell
      wide
      title="Admin Dashboard"
      subtitle={rows ? `${rows.length} transfers` : 'Loading…'}
      actions={
        <>
          <button type="button" className="icon-btn" onClick={() => load()} aria-label="Refresh" disabled={loading}><RefreshCw size={18} className={loading ? 'spin' : ''} /></button>
          <button type="button" className="icon-btn" onClick={logout} aria-label="Sign out"><LogOut size={18} /></button>
        </>
      }
    >
      {error && <Alert tone="danger" onClose={() => setError('')}>{error}</Alert>}
      {!rows ? (
        <Spinner />
      ) : (
        <div className="stack">
          {/* KPI tiles double as status filters */}
          <div className="kpis">
            {[['ALL', 'Total', 'primary'], ...Object.entries(STATUS).map(([k, v]) => [k, v.label, v.tone])].map(([k, label, tone]) => (
              <button key={k} type="button" className={`kpi kpi-${tone} ${status === k ? 'is-on' : ''}`} onClick={() => setStatus(k)} aria-pressed={status === k}>
                <span>{label}</span>
                <strong>{counts[k]}</strong>
              </button>
            ))}
          </div>

          <div className="dash-grid">
            <Card title="Top Plant Routes" className="flows-card">
              {flows.length ? (
                <ul className="flows">
                  {flows.map((f) => (
                    <li key={`${f.from}-${f.to}`}>
                      <span className="flow-label">{f.from} <ArrowRight size={13} /> {f.to}</span>
                      <span className="flow-bar"><span style={{ width: `${(f.n / maxFlow) * 100}%` }} /></span>
                      <strong>{f.n}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">No data yet</p>
              )}
            </Card>

            <Card
              title="Transfers"
              className="list-card"
              right={<Button variant="ghost" size="sm" icon={Download} onClick={exportCsv} disabled={!filtered.length}>CSV</Button>}
            >
              <div className="filters">
                <div className="search">
                  <Search size={16} />
                  <input className="input" placeholder="Search asset, machine, SAP, email…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
                </div>
                <select className="input" value={plant} onChange={(e) => setPlant(e.target.value)} aria-label="Filter by plant">
                  <option value="">All plants</option>
                  {PLANTS.map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>

              {filtered.length ? (
                <div className="tlist">
                  <div className="tlist-head" aria-hidden>
                    <span>Asset / Machine</span><span>Route</span><span>Date</span><span>Status</span>
                  </div>
                  {filtered.map((r) => (
                    <button type="button" key={r.id} className="trow" onClick={() => openDetail(r.asset_number)}>
                      <span className="trow-main">
                        <strong>{r.machine_name}</strong>
                        <small className="mono">{r.asset_number}</small>
                      </span>
                      <span className="trow-route">{r.from_plant} <ArrowRight size={12} /> {r.to_plant}</span>
                      <span className="trow-date">{fmtDate(r.transfer_date)}</span>
                      <span className="trow-status"><StatusBadge status={r.status} /></span>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty icon={Inbox} title="No transfers found" text={rows.length ? 'Try changing the filters.' : 'Transfers will appear here once submitted.'} />
              )}
            </Card>
          </div>
        </div>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.asset || ''} wide>
        {detail?.loading && <Spinner />}
        {detail?.error && <Alert tone="danger">{detail.error}</Alert>}
        {detail?.data && <TransferView transfer={detail.data} />}
      </Modal>
    </AppShell>
  );
}
