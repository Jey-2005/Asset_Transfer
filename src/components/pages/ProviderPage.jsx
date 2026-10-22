// src/components/pages/ProviderPage.jsx
// Asset Provider: create a machine transfer.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, Cpu, Plus, Send, Share2, Trash2, TriangleAlert, Truck, Wrench, Factory } from 'lucide-react';
import {
  Alert, AppShell, Button, Card, Chip, Field, ImagePicker, Segmented, Switch, UploadOverlay,
} from '../common/UI';
import { CopyButton } from '../common/TransferView';
import { api } from '../services/api';
import {
  DEFAULT_COMPONENTS, ELEC_CONDITIONS, LIMITS, MECH_CONDITIONS, PLANTS, todayISO, validateTransfer,
} from '../services/helpers';

const initialForm = () => ({
  transferDate: todayISO(),
  fromPlant: '',
  toPlant: '',
  providerEmail: '',
  receiverEmail: '',
  machineName: '',
  sapNo: '',
  equipmentNumber: '',
  machineImages: [],
  components: DEFAULT_COMPONENTS.map((name) => ({ id: name, name, custom: false, selected: false, condition: '' })),
  hasElectrical: false,
  electricalCondition: '',
  electricalImages: [],
  abnormalities: [''],
});

export default function ProviderPage() {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [newComp, setNewComp] = useState('');
  const [progress, setProgress] = useState(null);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState(null);

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const onFromChange = (v) => {
    setForm((f) => ({ ...f, fromPlant: v, toPlant: f.toPlant === v ? '' : f.toPlant }));
    setErrors((e) => ({ ...e, fromPlant: undefined }));
  };

  const toPlants = useMemo(() => PLANTS.filter((p) => p !== form.fromPlant), [form.fromPlant]);
  const selected = form.components.filter((c) => c.selected);

  /* ---- components ---- */
  const updateComp = (id, patch) => {
    setForm((f) => ({ ...f, components: f.components.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    setErrors((e) => ({ ...e, components: undefined }));
  };
  const addComp = () => {
    const name = newComp.trim();
    if (!name) return;
    if (form.components.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setErrors((e) => ({ ...e, components: `"${name}" already exists` }));
      return;
    }
    setForm((f) => ({
      ...f,
      components: [...f.components, { id: `c-${Date.now()}`, name: name.slice(0, 60), custom: true, selected: true, condition: '' }],
    }));
    setNewComp('');
    setErrors((e) => ({ ...e, components: undefined }));
  };
  const removeComp = (id) => setForm((f) => ({ ...f, components: f.components.filter((c) => c.id !== id) }));

  /* ---- abnormalities ---- */
  const setAbn = (i, v) => set('abnormalities', form.abnormalities.map((a, idx) => (idx === i ? v : a)));
  const addAbn = () => form.abnormalities.length < LIMITS.abnormalities && set('abnormalities', [...form.abnormalities, '']);
  const removeAbn = (i) => set('abnormalities', form.abnormalities.filter((_, idx) => idx !== i));

  const toggleElectrical = (on) =>
    setForm((f) => ({ ...f, hasElectrical: on, ...(on ? {} : { electricalCondition: '' }) }));

  /* ---- submit ---- */
  const submit = async (e) => {
    e.preventDefault();
    setSubmitError('');
    const errs = validateTransfer(form);
    setErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => document.querySelector('.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return;
    }

    const payload = {
      transferDate: form.transferDate,
      fromPlant: form.fromPlant,
      toPlant: form.toPlant,
      providerEmail: form.providerEmail.trim(),
      receiverEmail: form.receiverEmail.trim(),
      machineName: form.machineName.trim(),
      sapNo: form.sapNo.trim(),
      equipmentNumber: form.equipmentNumber.trim(),
      mechanicalComponents: selected.map(({ name, condition, custom }) => ({ name: name.trim(), condition, custom })),
      hasElectrical: form.hasElectrical,
      electricalCondition: form.hasElectrical ? form.electricalCondition : null,
      abnormalities: form.abnormalities.map((a) => a.trim()).filter(Boolean),
    };

    setProgress(0);
    try {
      const res = await api.createTransfer(
        payload,
        form.machineImages.map((i) => i.file),
        form.hasElectrical ? form.electricalImages.map((i) => i.file) : [],
        setProgress
      );
      setResult({ ...res.data, receiverEmail: payload.receiverEmail });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setProgress(null);
    }
  };

  const reset = () => {
    [...form.machineImages, ...form.electricalImages].forEach((i) => URL.revokeObjectURL(i.url));
    setForm(initialForm());
    setErrors({});
    setResult(null);
  };

  /* ---- success screen ---- */
  if (result) {
    const share = () =>
      navigator.share?.({ title: 'Machine Asset Transfer', text: `Asset Number: ${result.assetNumber}` }).catch(() => {});
    return (
      <AppShell title="Transfer Submitted" subtitle="Asset Provider">
        <div className="success">
          <CircleCheck size={56} />
          <h1>Transfer created</h1>
          <p className="muted">Share this asset number with the receiving plant.</p>
          <div className="asset-big">{result.assetNumber}<CopyButton text={result.assetNumber} /></div>
          {result.emailSent ? (
            <Alert tone="success">Email sent to <b className="break">{result.receiverEmail}</b></Alert>
          ) : (
            <Alert tone="warn" title="Email could not be sent">The transfer is saved. Please share the asset number with the receiver manually.</Alert>
          )}
          <div className="btn-row">
            {navigator.share && <Button variant="ghost" icon={Share2} onClick={share}>Share</Button>}
            <Button icon={Plus} onClick={reset}>New Transfer</Button>
          </div>
          <Link to="/" className="link">Back to home</Link>
        </div>
      </AppShell>
    );
  }

  /* ---- form ---- */
  return (
    <AppShell title="New Asset Transfer" subtitle="Asset Provider">
      <form className="stack form" onSubmit={submit} noValidate>
        <Card title="Transfer Details" step={1}>
          <div className="grid-2">
            <Field label="Date" required error={errors.transferDate}>
              {(id) => <input id={id} className="input" type="date" value={form.transferDate} max={todayISO()} onChange={(e) => set('transferDate', e.target.value)} />}
            </Field>
            <Field label="Asset Number" hint="Generated on submit">
              {(id) => <input id={id} className="input input-ghost" value="Auto-generated" readOnly tabIndex={-1} />}
            </Field>
            <Field label="From Plant" required error={errors.fromPlant}>
              {(id) => (
                <select id={id} className="input" value={form.fromPlant} onChange={(e) => onFromChange(e.target.value)}>
                  <option value="">Select plant</option>
                  {PLANTS.map((p) => <option key={p}>{p}</option>)}
                </select>
              )}
            </Field>
            <Field label="To Plant" required error={errors.toPlant}>
              {(id) => (
                <select id={id} className="input" value={form.toPlant} onChange={(e) => set('toPlant', e.target.value)} disabled={!form.fromPlant}>
                  <option value="">{form.fromPlant ? 'Select plant' : 'Select From first'}</option>
                  {toPlants.map((p) => <option key={p}>{p}</option>)}
                </select>
              )}
            </Field>
            <Field label="Provider Email" required error={errors.providerEmail}>
              {(id) => <input id={id} className="input" type="email" inputMode="email" autoComplete="email" placeholder="you@company.com" value={form.providerEmail} onChange={(e) => set('providerEmail', e.target.value)} />}
            </Field>
            <Field label="Receiver Email" required error={errors.receiverEmail}>
              {(id) => <input id={id} className="input" type="email" inputMode="email" placeholder="receiver@company.com" value={form.receiverEmail} onChange={(e) => set('receiverEmail', e.target.value)} />}
            </Field>
          </div>
        </Card>

        <Card title="Machine Details" step={2}>
          <div className="grid-3">
            <Field label="Machine Name" required error={errors.machineName} className="span-full-sm">
              {(id) => <input id={id} className="input" maxLength={120} value={form.machineName} onChange={(e) => set('machineName', e.target.value)} />}
            </Field>
            <Field label="SAP No" required error={errors.sapNo}>
              {(id) => <input id={id} className="input" maxLength={50} value={form.sapNo} onChange={(e) => set('sapNo', e.target.value)} />}
            </Field>
            <Field label="Equipment No" required error={errors.equipmentNumber}>
              {(id) => <input id={id} className="input" maxLength={50} value={form.equipmentNumber} onChange={(e) => set('equipmentNumber', e.target.value)} />}
            </Field>
          </div>
          <ImagePicker
            label="Machine Photos"
            required
            min={LIMITS.machineImages.min}
            max={LIMITS.machineImages.max}
            images={form.machineImages}
            onChange={(v) => set('machineImages', v)}
            error={errors.machineImages}
            hint="Capture all sides — front, back, left, right."
          />
        </Card>

        <Card title="Mechanical Components" step={3} right={<span className="muted small">{selected.length} selected</span>}>
          <div className="chips">
            {form.components.map((c) => (
              <Chip key={c.id} checked={c.selected} onChange={(v) => updateComp(c.id, { selected: v, ...(v ? {} : { condition: '' }) })}>
                {c.name}
              </Chip>
            ))}
          </div>

          <div className="add-row">
            <input className="input" placeholder="Add other component" maxLength={60} value={newComp}
              onChange={(e) => setNewComp(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addComp())} />
            <Button variant="soft" icon={Plus} onClick={addComp} disabled={!newComp.trim()}>Add</Button>
          </div>

          {selected.length > 0 && (
            <div className="cond-list">
              {selected.map((c) => (
                <div className={`cond-row ${!c.condition && errors.components ? 'cond-missing' : ''}`} key={c.id}>
                  <div className="cond-name">
                    <Wrench size={15} />
                    <span>{c.name}</span>
                    {c.custom && (
                      <button type="button" className="icon-btn icon-btn-sm danger" onClick={() => removeComp(c.id)} aria-label={`Remove ${c.name}`}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                  <Segmented compact name={`${c.name} condition`} options={MECH_CONDITIONS} value={c.condition} onChange={(v) => updateComp(c.id, { condition: v })} />
                </div>
              ))}
            </div>
          )}
          {errors.components && <div className="has-error"><span className="field-error">{errors.components}</span></div>}
        </Card>

        <Card title="Electrical Components" step={4}>
          <Switch
            checked={form.hasElectrical}
            onChange={toggleElectrical}
            label="Machine has electrical components"
            description="Panel, wiring, sensors, PLC, drives"
          />
          {form.hasElectrical && (
            <div className="stack-sm reveal">
              <Field label="Condition" required error={errors.electricalCondition}>
                <Segmented name="Electrical condition" options={ELEC_CONDITIONS} value={form.electricalCondition} onChange={(v) => set('electricalCondition', v)} />
              </Field>
              <ImagePicker
                label="Electrical Photos"
                required
                min={LIMITS.electricalImages.min}
                max={LIMITS.electricalImages.max}
                images={form.electricalImages}
                onChange={(v) => set('electricalImages', v)}
                error={errors.electricalImages}
                hint="Open the panel door and capture components with wiring."
              />
            </div>
          )}
        </Card>

        <Card title="Abnormalities" step={5} right={<span className="muted small">Optional</span>}>
          <div className="stack-sm">
            {form.abnormalities.map((a, i) => (
              <div className="abn-row" key={i}>
                <span className="abn-no">{i + 1}</span>
                <textarea className="input" rows={2} maxLength={500} placeholder="Describe the abnormality" value={a} onChange={(e) => setAbn(i, e.target.value)} />
                {form.abnormalities.length > 1 && (
                  <button type="button" className="icon-btn icon-btn-sm danger" onClick={() => removeAbn(i)} aria-label="Remove abnormality"><Trash2 size={15} /></button>
                )}
              </div>
            ))}
            {form.abnormalities.length < LIMITS.abnormalities && (
              <Button variant="soft" icon={Plus} onClick={addAbn}>Add Abnormality ({form.abnormalities.length}/{LIMITS.abnormalities})</Button>
            )}
          </div>
        </Card>

        {submitError && <Alert tone="danger" title="Submission failed" onClose={() => setSubmitError('')}>{submitError}</Alert>}

        <div className="sticky-bar">
          <div className="sticky-summary">
            <span><Factory size={14} /> {form.fromPlant || '—'} → {form.toPlant || '—'}</span>
            <span><Truck size={14} /> {form.machineImages.length} photos · <Wrench size={14} /> {selected.length}{form.hasElectrical && <> · <Cpu size={14} /></>}
              {Object.keys(errors).some((k) => errors[k]) && <> · <TriangleAlert size={14} className="txt-danger" /></>}
            </span>
          </div>
          <Button type="submit" icon={Send} loading={progress != null}>Submit</Button>
        </div>
      </form>
      {progress != null && <UploadOverlay progress={progress} label="Uploading photos" />}
    </AppShell>
  );
}
