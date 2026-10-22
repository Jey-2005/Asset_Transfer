// src/components/pages/ReceiverPage.jsx
// Asset Receiver: open a transfer with Asset Number + email, then Accept / Hold / Reject.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CircleCheck, CirclePause, CircleX, KeyRound, LogOut, PackageCheck, RefreshCw, Send } from 'lucide-react';
import { Alert, AppShell, Button, Card, ConfirmDialog, Field, ImagePicker, Spinner, UploadOverlay } from '../common/UI';
import TransferView from '../common/TransferView';
import { api } from '../services/api';
import { ASSET_RE, LIMITS, isEmail } from '../services/helpers';

const OPTIONS = [
  { value: 'ACCEPT', label: 'Satisfied', icon: CircleCheck, tone: 'success', desc: 'Machine received in acceptable condition' },
  { value: 'HOLD', label: 'Hold', icon: CirclePause, tone: 'warn', desc: 'Needs discussion before decision' },
  { value: 'REJECT', label: 'Reject', icon: CircleX, tone: 'danger', desc: 'Transfer completely rejected' },
];

/* ------------------------------------------------------------------ */
function LoginCard({ initialAsset, onSuccess }) {
  const [asset, setAsset] = useState(initialAsset || '');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const a = asset.trim().toUpperCase();
    const errs = {};
    if (!ASSET_RE.test(a)) errs.asset = 'Format: MAT-YYMMDD-XXXXXX';
    if (!isEmail(email)) errs.email = 'Enter a valid email';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setLoading(true);
    setError('');
    try {
      const res = await api.lookupTransfer(a, email.trim().toLowerCase());
      onSuccess({ assetNumber: a, email: email.trim().toLowerCase(), transfer: res.data });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="login" onSubmit={submit} noValidate>
      <div className="login-icon"><PackageCheck size={30} /></div>
      <h1>Receive a Machine</h1>
      <p className="muted">Enter the asset number from the transfer email and your email address.</p>
      <Field label="Asset Number" required error={errors.asset}>
        {(id) => (
          <input id={id} className="input input-mono" placeholder="MAT-261021-ABC234" autoCapitalize="characters" autoComplete="off"
            value={asset} onChange={(e) => setAsset(e.target.value.toUpperCase())} />
        )}
      </Field>
      <Field label="Your Email" required error={errors.email}>
        {(id) => <input id={id} className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" icon={KeyRound} loading={loading} block>View Transfer</Button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
function ActionPanel({ transfer, email, onDone }) {
  const [action, setAction] = useState('');
  const [reason, setReason] = useState('');
  const [images, setImages] = useState([]);
  const [errors, setErrors] = useState({});
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');

  const options = transfer.status === 'ON_HOLD' ? OPTIONS.filter((o) => o.value !== 'HOLD') : OPTIONS;
  const opt = OPTIONS.find((o) => o.value === action);
  const reasonRequired = action && action !== 'ACCEPT';

  const choose = (v) => {
    setAction(v);
    setErrors({});
    setError('');
  };

  const validate = () => {
    const e = {};
    if (!action) e.action = 'Choose an option';
    if (reasonRequired && reason.trim().length < 3) e.reason = 'Reason is required';
    const { min, max } = LIMITS.actionImages;
    if (images.length < min || images.length > max) e.images = `Add ${min}–${max} photos`;
    setErrors(e);
    return !Object.keys(e).length;
  };

  const send = async () => {
    setConfirm(false);
    setProgress(0);
    setError('');
    try {
      const res = await api.submitAction(transfer.asset_number, { email, action, reason: reason.trim() }, images.map((i) => i.file), setProgress);
      images.forEach((i) => URL.revokeObjectURL(i.url));
      onDone(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Card title={transfer.status === 'ON_HOLD' ? 'Final Decision' : 'Your Response'} icon={Send} className="action-card">
      {transfer.status === 'ON_HOLD' && <Alert tone="warn">This transfer is on hold. After internal discussion, accept or reject it.</Alert>}

      <div className={`choice-grid choice-${options.length}`}>
        {options.map((o) => (
          <button key={o.value} type="button" className={`choice choice-${o.tone} ${action === o.value ? 'is-on' : ''}`} onClick={() => choose(o.value)} aria-pressed={action === o.value}>
            <o.icon size={24} />
            <strong>{o.label}</strong>
            <small>{o.desc}</small>
          </button>
        ))}
      </div>
      {errors.action && <span className="field-error">{errors.action}</span>}

      {action && (
        <div className="stack-sm reveal">
          <Field label={reasonRequired ? 'Reason' : 'Remarks'} required={reasonRequired} error={errors.reason} hint={!reasonRequired ? 'Optional' : undefined}>
            {(id) => (
              <textarea id={id} className="input" rows={3} maxLength={1000}
                placeholder={reasonRequired ? 'Explain why…' : 'Any remarks (optional)'}
                value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
          </Field>
          <ImagePicker label="Photos" required min={LIMITS.actionImages.min} max={LIMITS.actionImages.max}
            images={images} onChange={setImages} error={errors.images}
            hint={action === 'ACCEPT' ? 'Photos of the machine as received.' : 'Photos supporting the reason.'} />
          {error && <Alert tone="danger" title="Could not submit">{error}</Alert>}
          <Button variant={opt.tone} icon={opt.icon} block onClick={() => validate() && setConfirm(true)}>
            Submit — {opt.label}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        title={`${opt?.label} this transfer?`}
        message={
          action === 'HOLD'
            ? 'The provider will be notified. You can accept or reject later.'
            : 'This is a final decision and cannot be changed. The provider will be notified by email.'
        }
        confirmLabel={`Yes, ${opt?.label}`}
        tone={opt?.tone}
        onCancel={() => setConfirm(false)}
        onConfirm={send}
      />
      {progress != null && <UploadOverlay progress={progress} />}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
export default function ReceiverPage() {
  const [params] = useSearchParams();
  const [session, setSession] = useState(null); // { assetNumber, email, transfer }
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!session) return;
    setRefreshing(true);
    setError('');
    try {
      const res = await api.lookupTransfer(session.assetNumber, session.email);
      setSession((s) => ({ ...s, transfer: res.data }));
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) window.scrollTo({ top: 0 });
  }, [session?.assetNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDone = async (data) => {
    setNotice({
      tone: data.status === 'REJECTED' ? 'danger' : data.status === 'ON_HOLD' ? 'warn' : 'success',
      text: data.emailSent ? 'Status updated and provider notified by email.' : 'Status updated, but the email to the provider failed. Please inform them directly.',
    });
    await refresh();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const logout = () => {
    setSession(null);
    setNotice(null);
  };

  const t = session?.transfer;
  const open = t && ['PENDING', 'ON_HOLD'].includes(t.status);

  return (
    <AppShell
      title={t ? 'Review Transfer' : 'Asset Receiver'}
      subtitle={t ? session.email : 'Sign in with asset number'}
      actions={t && (
        <>
          <button type="button" className="icon-btn" onClick={refresh} aria-label="Refresh" disabled={refreshing}><RefreshCw size={18} className={refreshing ? 'spin' : ''} /></button>
          <button type="button" className="icon-btn" onClick={logout} aria-label="Sign out"><LogOut size={18} /></button>
        </>
      )}
    >
      {!session && <LoginCard initialAsset={params.get('asset')} onSuccess={setSession} />}

      {session && !t && <Spinner />}

      {t && (
        <div className="stack">
          {notice && <Alert tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Alert>}
          {error && <Alert tone="danger" onClose={() => setError('')}>{error}</Alert>}
          <TransferView transfer={t} />
          {open ? (
            <ActionPanel key={t.status} transfer={t} email={session.email} onDone={onDone} />
          ) : (
            <Alert tone={t.status === 'ACCEPTED' ? 'success' : 'danger'} title={`Transfer ${t.status === 'ACCEPTED' ? 'accepted' : 'rejected'}`}>
              This transfer is closed. No further action is required.
            </Alert>
          )}
        </div>
      )}
    </AppShell>
  );
}
