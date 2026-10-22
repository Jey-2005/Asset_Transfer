// src/components/services/helpers.js
// Constants, formatting, image compression and client-side validation.
// Server re-validates everything — these checks are for UX only.

export const PLANTS = ['Varanavasi', 'Pondicherry', 'Mysore', 'Pantnagar'];

export const DEFAULT_COMPONENTS = ['Cylinders', 'Fixtures', 'Conveyors', 'Safety Doors', 'End Effectors'];

export const MECH_CONDITIONS = [
  { value: 'WORKING', label: 'Working', tone: 'success' },
  { value: 'PARTIAL', label: 'Partial', tone: 'warn' },
  { value: 'NOT_WORKING', label: 'Not Working', tone: 'danger' },
];

export const ELEC_CONDITIONS = [
  { value: 'INTACT', label: 'Everything Intact', tone: 'success' },
  { value: 'LOOSE_CONNECTIONS', label: 'Loose Connections', tone: 'warn' },
  { value: 'NOT_WORKING', label: 'Not Working', tone: 'danger' },
];

export const STATUS = {
  PENDING: { label: 'Pending', tone: 'info' },
  ON_HOLD: { label: 'On Hold', tone: 'warn' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};

export const ACTION_LABEL = { HOLD: 'Put on Hold', REJECT: 'Rejected', ACCEPT: 'Satisfied / Accepted' };

export const LIMITS = {
  machineImages: { min: 3, max: 6 },
  electricalImages: { min: 1, max: 3 },
  actionImages: { min: 1, max: 3 },
  abnormalities: 5,
  maxFileBytes: 5 * 1024 * 1024,
};

export const ASSET_RE = /^MAT-\d{6}-[A-Z0-9]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const labelOf = (list, value) => list.find((o) => o.value === value)?.label ?? value ?? '—';
export const toneOf = (list, value) => list.find((o) => o.value === value)?.tone ?? 'neutral';

/** Local date as YYYY-MM-DD (not UTC — avoids "yesterday" before 5:30 AM IST). */
export const todayISO = () => new Date().toLocaleDateString('en-CA');

export const fmtDate = (v) =>
  v ? new Date(v.length === 10 ? `${v}T00:00:00` : v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (v) =>
  v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

/* ------------------------------------------------------------------ */
/* Image compression — phone photos are 3–8 MB; shrink before upload  */
/* ------------------------------------------------------------------ */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function compressImage(file, maxDim = 1600, quality = 0.82) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Browser can't decode it (e.g. HEIC on Chrome). Accept the original only if the server accepts it.
    if (ALLOWED_TYPES.includes(file.type) && file.size <= LIMITS.maxFileBytes) return file;
    throw new Error(`"${file.name}" is not a supported image. Use JPG or PNG (set camera to "Most Compatible").`);
  }

  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error(`Could not process "${file.name}"`);
  if (blob.size > LIMITS.maxFileBytes) throw new Error(`"${file.name}" is too large even after compression`);
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */
export const isEmail = (v) => EMAIL_RE.test(String(v || '').trim());

export function validateTransfer(f) {
  const e = {};
  if (!f.transferDate) e.transferDate = 'Select a date';
  if (!f.fromPlant) e.fromPlant = 'Select from plant';
  if (!f.toPlant) e.toPlant = 'Select to plant';
  else if (f.toPlant === f.fromPlant) e.toPlant = 'Must differ from From plant';
  if (!isEmail(f.providerEmail)) e.providerEmail = 'Enter a valid email';
  if (!isEmail(f.receiverEmail)) e.receiverEmail = 'Enter a valid email';
  if (!f.machineName.trim()) e.machineName = 'Required';
  if (!f.sapNo.trim()) e.sapNo = 'Required';
  if (!f.equipmentNumber.trim()) e.equipmentNumber = 'Required';

  const { min, max } = LIMITS.machineImages;
  if (f.machineImages.length < min || f.machineImages.length > max) e.machineImages = `Add ${min}–${max} photos`;

  const selected = f.components.filter((c) => c.selected);
  if (selected.some((c) => !c.condition)) e.components = 'Select the condition for every selected component';
  if (f.components.some((c) => c.custom && !c.name.trim())) e.components = 'Custom component name is required';
  const names = selected.map((c) => c.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) e.components = 'Duplicate component names';

  if (f.hasElectrical) {
    if (!f.electricalCondition) e.electricalCondition = 'Select condition';
    const r = LIMITS.electricalImages;
    if (f.electricalImages.length < r.min || f.electricalImages.length > r.max) e.electricalImages = `Add ${r.min}–${r.max} photos`;
  }
  return e;
}

/* ------------------------------------------------------------------ */
/* CSV export (admin) — guards against spreadsheet formula injection  */
/* ------------------------------------------------------------------ */
export function downloadCsv(filename, rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

/** sessionStorage can throw in private mode — treat as "not stored". */
export const session = {
  get(k) {
    try { return sessionStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { sessionStorage.setItem(k, v); } catch { /* storage unavailable: user re-enters passcode on refresh */ }
  },
  remove(k) {
    try { sessionStorage.removeItem(k); } catch { /* storage unavailable */ }
  },
};
