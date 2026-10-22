// server/index.js
// Thin API layer: the only component that holds the Supabase service key
// and the SMTP password. The React app talks only to this server.
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import {
  config, AppError, LIMITS, db,
  transferSchema, lookupSchema, actionSchema, parseOrThrow, parseJsonField,
  assertFileCount, generateAssetNumber, uploadImages, removeImages, withSignedImages,
  sendNewTransferEmail, sendStatusEmail, verifyMailer,
} from './services.js';

const app = express();
if (config.trustProxy) app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

/* ------------------------------------------------------------------ */
/* Middleware                                                          */
/* ------------------------------------------------------------------ */
app.use(helmet());
app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin / server-to-server (no Origin header) and configured origins only.
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      cb(new AppError(403, 'Origin not allowed'));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'x-admin-key'],
    maxAge: 600,
  })
);
app.use(express.json({ limit: '50kb' }));

// Request log (no bodies / emails logged)
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - t0}ms`));
  next();
});

const limiter = (windowMin, max) =>
  rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later' },
  });

app.use('/api', limiter(15, 300));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.fileSizeBytes, files: 9, fields: 5, fieldSize: 50_000 },
  fileFilter(_req, file, cb) {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    cb(new AppError(422, 'Validation failed', 'Only JPEG/PNG/WebP images allowed'));
  },
});

function requireAdmin(req, _res, next) {
  const given = Buffer.from(String(req.get('x-admin-key') || ''));
  const expected = Buffer.from(config.adminPasscode);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return next(new AppError(401, 'Invalid admin passcode'));
  }
  next();
}

const ok = (res, data, message = 'OK', status = 200) => res.status(status).json({ success: true, message, data });

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */
app.get('/api/health', (_req, res) => ok(res, { uptime: process.uptime() }));

// Provider: create transfer
app.post(
  '/api/transfers',
  limiter(15, 30),
  upload.fields([
    { name: 'machineImages', maxCount: LIMITS.machineImages.max },
    { name: 'electricalImages', maxCount: LIMITS.electricalImages.max },
  ]),
  async (req, res) => {
    const data = parseOrThrow(transferSchema, parseJsonField(req.body.data));
    const machineFiles = req.files?.machineImages || [];
    const elecFiles = req.files?.electricalImages || [];

    assertFileCount(machineFiles, LIMITS.machineImages, 'Machine photos');
    if (data.hasElectrical) assertFileCount(elecFiles, LIMITS.electricalImages, 'Electrical photos');
    else if (elecFiles.length) throw new AppError(422, 'Validation failed', 'Electrical photos sent without electrical components');

    let assetNumber = generateAssetNumber();
    const uploaded = [];
    try {
      const machinePaths = await uploadImages(assetNumber, 'machine', machineFiles);
      uploaded.push(...machinePaths);
      const elecPaths = data.hasElectrical ? await uploadImages(assetNumber, 'electrical', elecFiles) : [];
      uploaded.push(...elecPaths);

      const { data: row, error } = await db
        .from('asset_transfers')
        .insert({
          asset_number: assetNumber,
          transfer_date: data.transferDate,
          from_plant: data.fromPlant,
          to_plant: data.toPlant,
          provider_email: data.providerEmail,
          receiver_email: data.receiverEmail,
          machine_name: data.machineName,
          sap_no: data.sapNo,
          equipment_number: data.equipmentNumber,
          machine_images: machinePaths,
          mechanical_components: data.mechanicalComponents,
          has_electrical: data.hasElectrical,
          electrical_condition: data.electricalCondition,
          electrical_images: elecPaths,
          abnormalities: data.abnormalities,
        })
        .select()
        .single();

      if (error) {
        // 23505 = unique violation (asset number collision — astronomically rare)
        throw new AppError(error.code === '23505' ? 409 : 500, 'Unable to create transfer', config.isProd ? undefined : error.message);
      }

      let emailSent = true;
      try {
        await sendNewTransferEmail(row);
      } catch (err) {
        emailSent = false;
        console.error('[mail] new-transfer email failed', { asset: row.asset_number, error: err.message });
      }

      return ok(res, { assetNumber: row.asset_number, emailSent }, 'Transfer created successfully', 201);
    } catch (err) {
      await removeImages(uploaded);
      throw err;
    }
  }
);

// Receiver: view transfer (asset number + receiver email)
app.post('/api/transfers/lookup', limiter(15, 40), async (req, res) => {
  const { assetNumber, email } = parseOrThrow(lookupSchema, req.body);

  const { data: t, error } = await db.from('asset_transfers').select('*').eq('asset_number', assetNumber).maybeSingle();
  if (error) throw new AppError(500, 'Unable to load transfer');

  // Same message for "not found" and "wrong email" — don't reveal which asset numbers exist.
  if (!t || t.receiver_email.toLowerCase() !== email) {
    throw new AppError(404, 'No transfer found for this asset number and email');
  }

  const { data: actions, error: aErr } = await db
    .from('transfer_actions').select('*').eq('transfer_id', t.id).order('created_at');
  if (aErr) throw new AppError(500, 'Unable to load transfer history');

  ok(res, await withSignedImages(t, actions));
});

// Receiver: Hold / Reject / Accept
app.post(
  '/api/transfers/:assetNumber/actions',
  limiter(15, 20),
  upload.fields([{ name: 'images', maxCount: LIMITS.actionImages.max }]),
  async (req, res) => {
    const { assetNumber } = parseOrThrow(lookupSchema.pick({ assetNumber: true }), { assetNumber: req.params.assetNumber });
    const body = parseOrThrow(actionSchema, parseJsonField(req.body.data));
    const files = req.files?.images || [];
    assertFileCount(files, LIMITS.actionImages, 'Photos');

    const paths = await uploadImages(assetNumber, `actions/${body.action.toLowerCase()}`, files);

    const { data: t, error } = await db.rpc('record_transfer_action', {
      p_asset_number: assetNumber,
      p_actor_email: body.email,
      p_action: body.action,
      p_reason: body.reason,
      p_images: paths,
    });

    if (error) {
      await removeImages(paths);
      const map = {
        TRANSFER_NOT_FOUND: [404, 'No transfer found for this asset number and email'],
        NOT_RECEIVER: [404, 'No transfer found for this asset number and email'],
        TRANSFER_CLOSED: [409, 'This transfer is already closed'],
        ALREADY_ON_HOLD: [409, 'This transfer is already on hold'],
        INVALID_ACTION: [422, 'Invalid action'],
      };
      const hit = Object.keys(map).find((k) => error.message?.includes(k));
      if (hit) throw new AppError(...map[hit]);
      throw new AppError(500, 'Unable to update transfer', config.isProd ? undefined : error.message);
    }

    let emailSent = true;
    try {
      await sendStatusEmail(t, body);
    } catch (err) {
      emailSent = false;
      console.error('[mail] status email failed', { asset: t.asset_number, error: err.message });
    }

    ok(res, { status: t.status, emailSent }, 'Status updated');
  }
);

// Admin: list (no images — keeps payload small)
app.get('/api/admin/transfers', limiter(15, 120), requireAdmin, async (_req, res) => {
  const { data, error } = await db
    .from('asset_transfers')
    .select('id, asset_number, transfer_date, from_plant, to_plant, provider_email, receiver_email, machine_name, sap_no, equipment_number, has_electrical, status, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw new AppError(500, 'Unable to load transfers');
  ok(res, data);
});

// Admin: single transfer with images + history
app.get('/api/admin/transfers/:assetNumber', limiter(15, 120), requireAdmin, async (req, res) => {
  const { assetNumber } = parseOrThrow(lookupSchema.pick({ assetNumber: true }), { assetNumber: req.params.assetNumber });
  const { data: t, error } = await db.from('asset_transfers').select('*').eq('asset_number', assetNumber).maybeSingle();
  if (error) throw new AppError(500, 'Unable to load transfer');
  if (!t) throw new AppError(404, 'Transfer not found');
  const { data: actions, error: aErr } = await db.from('transfer_actions').select('*').eq('transfer_id', t.id).order('created_at');
  if (aErr) throw new AppError(500, 'Unable to load transfer history');
  ok(res, await withSignedImages(t, actions));
});

app.use('/api', (_req, _res, next) => next(new AppError(404, 'Endpoint not found')));

/* ------------------------------------------------------------------ */
/* Error handler                                                       */
/* ------------------------------------------------------------------ */
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({
      success: false,
      message: 'Upload rejected',
      error: err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 5 MB or smaller' : err.message,
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid JSON body' });
  }
  const status = err instanceof AppError ? err.status : 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    success: false,
    message: err instanceof AppError ? err.message : 'Internal server error',
    ...(err?.detail ? { error: err.detail } : {}),
  });
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`[api] listening on :${config.port}  (CORS: ${config.corsOrigins.join(', ')})`);
    verifyMailer();
  });
}

// Export the app so Vercel can run it as a serverless function
export default app;
