// server/services.js
// Config, validation, Supabase (DB + storage) and email helpers.
import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'ADMIN_PASSCODE',
  'APP_URL',
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[config] Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.ADMIN_PASSCODE.length < 8) {
  console.error('[config] ADMIN_PASSCODE must be at least 8 characters');
  process.exit(1);
}

export const config = {
  port: Number(process.env.PORT || 4000),
  appUrl: process.env.APP_URL.replace(/\/+$/, ''),
  corsOrigins: (process.env.CORS_ORIGINS || process.env.APP_URL)
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  bucket: process.env.SUPABASE_BUCKET || 'asset-transfer-images',
  adminPasscode: process.env.ADMIN_PASSCODE,
  allowedDomains: (process.env.ALLOWED_EMAIL_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
  trustProxy: Number(process.env.TRUST_PROXY || 0),
  isProd: process.env.NODE_ENV === 'production',
};

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */
export class AppError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/* ------------------------------------------------------------------ */
/* Domain constants (must match supabase/schema.sql)                  */
/* ------------------------------------------------------------------ */
export const PLANTS = ['Varanavasi', 'Pondicherry', 'Mysore', 'Pantnagar'];
export const MECH_CONDITIONS = ['WORKING', 'PARTIAL', 'NOT_WORKING'];
export const ELEC_CONDITIONS = ['INTACT', 'LOOSE_CONNECTIONS', 'NOT_WORKING'];
export const ACTIONS = ['HOLD', 'REJECT', 'ACCEPT'];
export const LIMITS = {
  machineImages: { min: 3, max: 6 },
  electricalImages: { min: 1, max: 3 },
  actionImages: { min: 1, max: 3 },
  abnormalities: 5,
  fileSizeBytes: 5 * 1024 * 1024,
};

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */
const text = (max) => z.string().trim().min(1, 'Required').max(max);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Invalid email')
  .max(254)
  .refine(
    (v) => !config.allowedDomains.length || config.allowedDomains.includes(v.split('@')[1]),
    { message: 'Email domain is not allowed' }
  );

export const transferSchema = z
  .object({
    transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
    fromPlant: z.enum(PLANTS),
    toPlant: z.enum(PLANTS),
    providerEmail: email,
    receiverEmail: email,
    machineName: text(120),
    sapNo: text(50),
    equipmentNumber: text(50),
    mechanicalComponents: z
      .array(
        z.object({
          name: text(60),
          condition: z.enum(MECH_CONDITIONS),
          custom: z.boolean().default(false),
        })
      )
      .max(25),
    hasElectrical: z.boolean(),
    electricalCondition: z.enum(ELEC_CONDITIONS).nullable().optional(),
    abnormalities: z.array(z.string().trim().max(500)).max(LIMITS.abnormalities).default([]),
  })
  .superRefine((d, ctx) => {
    if (d.fromPlant === d.toPlant) {
      ctx.addIssue({ code: 'custom', path: ['toPlant'], message: 'To plant must differ from From plant' });
    }
    if (Number.isNaN(Date.parse(d.transferDate))) {
      ctx.addIssue({ code: 'custom', path: ['transferDate'], message: 'Invalid date' });
    }
    if (d.hasElectrical && !d.electricalCondition) {
      ctx.addIssue({ code: 'custom', path: ['electricalCondition'], message: 'Select electrical condition' });
    }
    const names = d.mechanicalComponents.map((c) => c.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: 'custom', path: ['mechanicalComponents'], message: 'Duplicate component names' });
    }
  })
  .transform((d) => ({
    ...d,
    electricalCondition: d.hasElectrical ? d.electricalCondition : null,
    abnormalities: d.abnormalities.filter(Boolean),
  }));

export const lookupSchema = z.object({
  assetNumber: z.string().trim().toUpperCase().regex(/^MAT-\d{6}-[A-Z0-9]{6}$/, 'Invalid asset number'),
  email: z.string().trim().toLowerCase().email('Invalid email'),
});

export const actionSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Invalid email'),
    action: z.enum(ACTIONS),
    reason: z.string().trim().max(1000).optional().default(''),
  })
  .superRefine((d, ctx) => {
    if (d.action !== 'ACCEPT' && d.reason.length < 3) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Reason is required' });
    }
  });

export function parseOrThrow(schema, input) {
  const r = schema.safeParse(input);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new AppError(422, 'Validation failed', `${first.path.join('.') || 'input'}: ${first.message}`);
  }
  return r.data;
}

/** Multipart fields arrive as a JSON string in `data`. */
export function parseJsonField(raw) {
  if (typeof raw !== 'string' || raw.length > 50_000) throw new AppError(400, 'Invalid request body');
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError(400, 'Invalid request body', 'data must be valid JSON');
  }
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Verify magic bytes so a renamed non-image can't be stored. */
export function isRealImage(file) {
  const b = file.buffer;
  if (!b || b.length < 12) return false;
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
  return (
    (file.mimetype === 'image/jpeg' && jpeg) ||
    (file.mimetype === 'image/png' && png) ||
    (file.mimetype === 'image/webp' && webp)
  );
}

export function assertFileCount(files, { min, max }, label) {
  const n = files?.length || 0;
  if (n < min || n > max) throw new AppError(422, 'Validation failed', `${label}: ${min}–${max} images required`);
  if (!files.every(isRealImage)) throw new AppError(422, 'Validation failed', `${label}: only JPEG/PNG/WebP images allowed`);
}

/* ------------------------------------------------------------------ */
/* Supabase                                                            */
/* ------------------------------------------------------------------ */
export const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

/** MAT-YYMMDD-XXXXXX  (32^6 ≈ 1 billion combinations per day) */
export function generateAssetNumber() {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000); // IST date
  const ymd = now.toISOString().slice(2, 10).replace(/-/g, '');
  const bytes = crypto.randomBytes(6);
  const suffix = Array.from(bytes, (x) => ALPHABET[x % ALPHABET.length]).join('');
  return `MAT-${ymd}-${suffix}`;
}

export async function uploadImages(assetNumber, folder, files) {
  const paths = [];
  try {
    for (const [i, f] of files.entries()) {
      const path = `${assetNumber}/${folder}/${i + 1}-${crypto.randomUUID()}.${MIME_EXT[f.mimetype]}`;
      const { error } = await db.storage.from(config.bucket).upload(path, f.buffer, {
        contentType: f.mimetype,
        upsert: false,
      });
      if (error) throw new AppError(502, 'Image upload failed', error.message);
      paths.push(path);
    }
    return paths;
  } catch (err) {
    await removeImages(paths);
    throw err;
  }
}

export async function removeImages(paths) {
  if (!paths?.length) return;
  const { error } = await db.storage.from(config.bucket).remove(paths);
  if (error) console.error('[storage] cleanup failed', { count: paths.length, error: error.message });
}

/** Replace storage paths with signed URLs valid for 1 hour. */
export async function signPaths(paths) {
  if (!paths?.length) return [];
  const { data, error } = await db.storage.from(config.bucket).createSignedUrls(paths, 3600);
  if (error) throw new AppError(502, 'Could not load images', error.message);
  return data.map((d) => d.signedUrl).filter(Boolean);
}

export async function withSignedImages(transfer, actions = []) {
  const [machine, electrical, ...actionImgs] = await Promise.all([
    signPaths(transfer.machine_images),
    signPaths(transfer.electrical_images),
    ...actions.map((a) => signPaths(a.images)),
  ]);
  return {
    ...transfer,
    machine_images: machine,
    electrical_images: electrical,
    actions: actions.map((a, i) => ({ ...a, images: actionImgs[i] })),
  };
}

/* ------------------------------------------------------------------ */
/* Email                                                               */
/* ------------------------------------------------------------------ */
const port = Number(process.env.SMTP_PORT);
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465, // 587 → STARTTLS
  requireTLS: port !== 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
});

export async function verifyMailer() {
  try {
    await mailer.verify();
    console.log('[mail] SMTP connection OK');
  } catch (err) {
    console.error('[mail] SMTP verification failed:', err.message);
  }
}

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS_META = {
  ON_HOLD: { label: 'On Hold', color: '#d97706' },
  ACCEPTED: { label: 'Accepted', color: '#059669' },
  REJECTED: { label: 'Rejected', color: '#dc2626' },
};

function layout(title, bodyHtml, cta) {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
    <tr><td style="background:#1e3a8a;color:#fff;padding:18px 24px;font-size:18px;font-weight:600">${esc(title)}</td></tr>
    <tr><td style="padding:24px;font-size:14px;line-height:1.6">${bodyHtml}
      ${cta ? `<p style="margin:24px 0 0"><a href="${esc(cta.href)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">${esc(cta.label)}</a></p>` : ''}
    </td></tr>
    <tr><td style="padding:14px 24px;background:#f8fafc;color:#64748b;font-size:12px">Machine Asset Transfer · automated message, please do not reply.</td></tr>
  </table></td></tr></table></body></html>`;
}

function row(label, value) {
  return `<tr><td style="padding:6px 0;color:#64748b;width:42%">${esc(label)}</td><td style="padding:6px 0;font-weight:600">${esc(value)}</td></tr>`;
}

export async function sendNewTransferEmail(t) {
  const link = `${config.appUrl}/receiver?asset=${encodeURIComponent(t.asset_number)}`;
  const html = layout(
    'New machine transfer awaiting your review',
    `<p>A machine is being transferred to <b>${esc(t.to_plant)}</b>. Please review the details and respond.</p>
     <table width="100%" style="border-collapse:collapse">
       ${row('Asset Number', t.asset_number)}
       ${row('Machine', t.machine_name)}
       ${row('SAP No / Equipment No', `${t.sap_no} / ${t.equipment_number}`)}
       ${row('From → To', `${t.from_plant} → ${t.to_plant}`)}
       ${row('Transfer Date', t.transfer_date)}
       ${row('Provider', t.provider_email)}
     </table>
     <p style="color:#64748b">Sign in with the asset number and your email address (${esc(t.receiver_email)}).</p>`,
    { href: link, label: 'Review Transfer' }
  );
  await mailer.sendMail({
    from: `"Asset Transfer" <${process.env.SMTP_USER}>`,
    to: t.receiver_email,
    cc: t.provider_email,
    subject: `[${t.asset_number}] Machine transfer: ${t.machine_name} (${t.from_plant} → ${t.to_plant})`,
    html,
  });
}

export async function sendStatusEmail(t, action) {
  const meta = STATUS_META[t.status];
  const html = layout(
    `Transfer ${meta.label}: ${t.asset_number}`,
    `<p>The receiver has updated the status of your machine transfer.</p>
     <p style="display:inline-block;padding:4px 12px;border-radius:999px;background:${meta.color};color:#fff;font-weight:600">${esc(meta.label)}</p>
     <table width="100%" style="border-collapse:collapse;margin-top:12px">
       ${row('Asset Number', t.asset_number)}
       ${row('Machine', t.machine_name)}
       ${row('From → To', `${t.from_plant} → ${t.to_plant}`)}
       ${row('Updated by', t.receiver_email)}
       ${row('Reason / Remarks', action.reason || '—')}
     </table>
     ${t.status === 'ON_HOLD' ? '<p>Please coordinate with the receiving plant. The receiver will accept or reject after discussion.</p>' : ''}`
  );
  await mailer.sendMail({
    from: `"Asset Transfer" <${process.env.SMTP_USER}>`,
    to: t.provider_email,
    cc: t.receiver_email,
    subject: `[${t.asset_number}] Transfer ${meta.label} — ${t.machine_name}`,
    html,
  });
}
