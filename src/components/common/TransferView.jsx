// src/components/common/TransferView.jsx
// Read-only view of a transfer — shared by Receiver and Admin pages.
import { useState } from 'react';
import { ArrowRight, Check, ClipboardList, Copy, Cpu, History, Images, TriangleAlert, Wrench } from 'lucide-react';
import { Card, Pill, PhotoGrid, StatusBadge } from './UI';
import { ACTION_LABEL, ELEC_CONDITIONS, MECH_CONDITIONS, fmtDate, fmtDateTime, labelOf, toneOf } from '../services/helpers';

export function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      window.prompt('Copy the asset number:', text); // clipboard blocked (non-HTTPS / permissions)
    }
  };
  return (
    <button type="button" className="icon-btn icon-btn-sm" onClick={copy} aria-label="Copy">
      {done ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );
}

const ACTION_TONE = { HOLD: 'warn', REJECT: 'danger', ACCEPT: 'success' };

export default function TransferView({ transfer: t }) {
  const comps = t.mechanical_components || [];
  return (
    <div className="stack">
      {/* Hero */}
      <section className="hero">
        <div className="hero-top">
          <span className="asset-no">{t.asset_number}<CopyButton text={t.asset_number} /></span>
          <StatusBadge status={t.status} />
        </div>
        <h1>{t.machine_name}</h1>
        <div className="route">
          <span>{t.from_plant}</span>
          <ArrowRight size={16} />
          <span>{t.to_plant}</span>
        </div>
        <dl className="kv kv-hero">
          <div><dt>Date</dt><dd>{fmtDate(t.transfer_date)}</dd></div>
          <div><dt>SAP No</dt><dd>{t.sap_no}</dd></div>
          <div><dt>Equipment No</dt><dd>{t.equipment_number}</dd></div>
        </dl>
      </section>

      <Card title="Contacts" icon={ClipboardList}>
        <dl className="kv">
          <div className="kv-wide"><dt>Provider</dt><dd className="break">{t.provider_email}</dd></div>
          <div className="kv-wide"><dt>Receiver</dt><dd className="break">{t.receiver_email}</dd></div>
          <div><dt>Submitted</dt><dd>{fmtDateTime(t.created_at)}</dd></div>
          <div><dt>Last update</dt><dd>{fmtDateTime(t.updated_at)}</dd></div>
        </dl>
      </Card>

      <Card title="Machine Photos" icon={Images} right={<span className="muted small">{t.machine_images?.length || 0}</span>}>
        <PhotoGrid urls={t.machine_images} label="Machine photo" />
      </Card>

      <Card title="Mechanical Components" icon={Wrench}>
        {comps.length ? (
          <ul className="list">
            {comps.map((c) => (
              <li key={c.name}>
                <span>{c.name}{c.custom && <em className="tag">custom</em>}</span>
                <Pill tone={toneOf(MECH_CONDITIONS, c.condition)}>{labelOf(MECH_CONDITIONS, c.condition)}</Pill>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No mechanical components listed</p>
        )}
      </Card>

      <Card title="Electrical Components" icon={Cpu}>
        {t.has_electrical ? (
          <div className="stack-sm">
            <div className="row-between">
              <span>Condition</span>
              <Pill tone={toneOf(ELEC_CONDITIONS, t.electrical_condition)}>{labelOf(ELEC_CONDITIONS, t.electrical_condition)}</Pill>
            </div>
            <PhotoGrid urls={t.electrical_images} label="Electrical photo" />
          </div>
        ) : (
          <p className="muted small">Machine has no electrical components</p>
        )}
      </Card>

      <Card title="Abnormalities" icon={TriangleAlert}>
        {t.abnormalities?.length ? (
          <ol className="numbered">
            {t.abnormalities.map((a, i) => <li key={i}>{a}</li>)}
          </ol>
        ) : (
          <p className="muted small">None reported</p>
        )}
      </Card>

      {t.actions?.length > 0 && (
        <Card title="Receiver History" icon={History}>
          <ol className="timeline">
            {t.actions.map((a) => (
              <li key={a.id} className={`tl-${ACTION_TONE[a.action]}`}>
                <div className="row-between">
                  <strong>{ACTION_LABEL[a.action]}</strong>
                  <span className="muted small">{fmtDateTime(a.created_at)}</span>
                </div>
                <p className="muted small break">{a.actor_email}</p>
                {a.reason && <p className="tl-reason">{a.reason}</p>}
                <PhotoGrid urls={a.images} label="Receiver photo" />
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
