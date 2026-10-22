// src/components/common/UI.jsx
// Shared UI primitives: layout, form controls, feedback, modals, image picker, lightbox.
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Camera, Check, ChevronLeft, ChevronRight, CircleCheck, Images, Info,
  LoaderCircle, TriangleAlert, X,
} from 'lucide-react';
import { STATUS, compressImage } from '../services/helpers';

// crypto.randomUUID() needs HTTPS; this works on plain-HTTP LAN testing too.
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */
export function AppShell({ title, subtitle, back = '/', actions, children, wide }) {
  return (
    <div className="shell">
      <header className="appbar">
        <div className="appbar-inner">
          {back ? (
            <Link to={back} className="icon-btn" aria-label="Back">
              <ArrowLeft size={20} />
            </Link>
          ) : (
            <span className="brand-dot" aria-hidden />
          )}
          <div className="appbar-title">
            <strong>{title}</strong>
            {subtitle && <small>{subtitle}</small>}
          </div>
          <div className="appbar-actions">{actions}</div>
        </div>
      </header>
      <main className={`container ${wide ? 'container-wide' : ''}`}>{children}</main>
    </div>
  );
}

export function Card({ title, icon: Icon, step, right, children, className = '', id }) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || right) && (
        <div className="card-head">
          {step != null && <span className="step">{step}</span>}
          {Icon && !step && <Icon size={18} className="card-icon" />}
          <h2>{title}</h2>
          {right && <div className="card-right">{right}</div>}
        </div>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Empty({ icon: Icon = Info, title, text, children }) {
  return (
    <div className="empty">
      <Icon size={34} />
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */
export function Field({ label, required, error, hint, children, className = '' }) {
  const id = useId();
  const child = typeof children === 'function' ? children(id) : children;
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      {label && (
        <label htmlFor={id}>
          {label} {required && <span className="req">*</span>}
        </label>
      )}
      {child}
      {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function Button({ variant = 'primary', icon: Icon, loading, block, size, disabled, children, className = '', ...rest }) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${block ? 'btn-block' : ''} ${size ? `btn-${size}` : ''} ${className}`}
      {...rest}
      disabled={loading || disabled}
    >
      {loading ? <LoaderCircle size={18} className="spin" /> : Icon && <Icon size={18} />}
      {children && <span>{children}</span>}
    </button>
  );
}

/** Pill selector; options: [{value,label,tone}] */
export function Segmented({ options, value, onChange, name, compact }) {
  return (
    <div className={`segmented ${compact ? 'segmented-compact' : ''}`} role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`seg seg-${o.tone || 'neutral'} ${value === o.value ? 'is-on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ checked, onChange, children }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} className={`chip ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="chip-box">{checked && <Check size={13} strokeWidth={3} />}</span>
      {children}
    </button>
  );
}

export function Switch({ checked, onChange, label, description }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`switch-row ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="switch-text">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <span className="switch"><span className="knob" /></span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */
export function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, tone: 'neutral' };
  return <span className={`badge badge-${s.tone}`}>{s.label}</span>;
}

export function Pill({ tone = 'neutral', children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Alert({ tone = 'info', title, children, onClose }) {
  const Icon = tone === 'success' ? CircleCheck : tone === 'info' ? Info : TriangleAlert;
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={18} />
      <div>
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {onClose && (
        <button type="button" className="alert-close" onClick={onClose} aria-label="Dismiss">
          <X size={16} />
        </button>
      )}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="spinner-wrap">
      <LoaderCircle size={28} className="spin" />
      <span>{label}</span>
    </div>
  );
}

export function UploadOverlay({ progress, label = 'Uploading' }) {
  return (
    <div className="overlay" role="alertdialog" aria-live="assertive">
      <div className="overlay-card">
        <LoaderCircle size={30} className="spin" />
        <strong>{progress < 100 ? `${label}… ${progress}%` : 'Saving…'}</strong>
        <div className="progress"><span style={{ width: `${progress}%` }} /></div>
        <small>Please keep this screen open</small>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */
export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', tone = 'primary', loading, onConfirm, onCancel }) {
  return (
    <Modal
      open={open}
      onClose={loading ? undefined : onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="muted">{message}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Image picker (camera + gallery, compression, previews)             */
/* images: [{ id, file, url }]  — parent owns the array               */
/* ------------------------------------------------------------------ */
export function ImagePicker({ label, required, images, onChange, min = 0, max = 6, hint, error }) {
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const latest = useRef(images);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [preview, setPreview] = useState(null);
  latest.current = images;

  // Free object URLs when the picker unmounts (prevents memory leaks on phones).
  useEffect(() => () => latest.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setLocalError('');
    const room = max - latest.current.length;
    if (files.length > room) setLocalError(`Only ${max} photos allowed — extra photos were skipped.`);
    setBusy(true);
    const added = [];
    for (const f of files.slice(0, Math.max(room, 0))) {
      try {
        const file = await compressImage(f);
        added.push({ id: uid(), file, url: URL.createObjectURL(file) });
      } catch (err) {
        setLocalError(err.message);
      }
    }
    setBusy(false);
    if (added.length) onChange([...latest.current, ...added]);
  };

  const remove = (id) => {
    const img = images.find((i) => i.id === id);
    if (img) URL.revokeObjectURL(img.url);
    onChange(images.filter((i) => i.id !== id));
  };

  const full = images.length >= max;
  const countTone = images.length >= min ? 'ok' : 'low';

  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <div className="picker-head">
        <label>{label} {required && <span className="req">*</span>}</label>
        <span className={`count count-${countTone}`}>{images.length}/{max}{min ? ` · min ${min}` : ''}</span>
      </div>

      <div className="thumbs">
        {images.map((img, i) => (
          <div className="thumb" key={img.id}>
            <img src={img.url} alt={`${label} ${i + 1}`} onClick={() => setPreview(i)} />
            <button type="button" className="thumb-del" onClick={() => remove(img.id)} aria-label="Remove photo"><X size={14} /></button>
            <span className="thumb-no">{i + 1}</span>
          </div>
        ))}
        {!full && (
          <>
            <button type="button" className="thumb-add" onClick={() => cameraRef.current?.click()} disabled={busy}>
              {busy ? <LoaderCircle size={22} className="spin" /> : <Camera size={22} />}
              <span>Camera</span>
            </button>
            <button type="button" className="thumb-add" onClick={() => galleryRef.current?.click()} disabled={busy}>
              <Images size={22} />
              <span>Gallery</span>
            </button>
          </>
        )}
      </div>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />

      {(error || localError) ? <span className="field-error">{error || localError}</span> : hint && <span className="field-hint">{hint}</span>}
      {preview != null && <Lightbox urls={images.map((i) => i.url)} index={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Read-only photo grid + lightbox                                     */
/* ------------------------------------------------------------------ */
export function PhotoGrid({ urls = [], label = 'Photo' }) {
  const [open, setOpen] = useState(null);
  if (!urls.length) return <p className="muted small">No photos</p>;
  return (
    <>
      <div className="thumbs">
        {urls.map((u, i) => (
          <button type="button" className="thumb" key={u} onClick={() => setOpen(i)}>
            <img src={u} alt={`${label} ${i + 1}`} loading="lazy" />
          </button>
        ))}
      </div>
      {open != null && <Lightbox urls={urls} index={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function Lightbox({ urls, index, onClose }) {
  const [i, setI] = useState(index);
  const go = (d) => setI((p) => (p + d + urls.length) % urls.length);
  const touchX = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <div
      className="lightbox"
      onClick={onClose}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - (touchX.current ?? 0);
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <img src={urls[i]} alt={`Photo ${i + 1}`} onClick={(e) => e.stopPropagation()} />
      <span className="lb-count">{i + 1} / {urls.length}</span>
      <button type="button" className="lb-btn lb-close" onClick={onClose} aria-label="Close"><X size={22} /></button>
      {urls.length > 1 && (
        <>
          <button type="button" className="lb-btn lb-prev" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Previous"><ChevronLeft size={26} /></button>
          <button type="button" className="lb-btn lb-next" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Next"><ChevronRight size={26} /></button>
        </>
      )}
    </div>
  );
}
