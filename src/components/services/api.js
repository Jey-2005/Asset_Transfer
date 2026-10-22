// src/components/services/api.js
// All HTTP calls. The browser never talks to Supabase or SMTP directly.
import axios from 'axios';

const http = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL || ''}/api`,
  timeout: 120_000, // photo uploads on plant Wi-Fi / 4G can be slow
});

/** Normalise every failure into Error(message) with .status */
http.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const body = err.response?.data;
    let message = body?.error || body?.message;
    if (!message) {
      if (err.code === 'ECONNABORTED') message = 'Request timed out. Check your connection and try again.';
      else if (!err.response) message = 'Cannot reach server. Check your connection.';
      else message = `Request failed (${err.response.status})`;
    }
    const e = new Error(message);
    e.status = err.response?.status;
    return Promise.reject(e);
  }
);

const multipart = (data, fileGroups) => {
  const fd = new FormData();
  fd.append('data', JSON.stringify(data));
  Object.entries(fileGroups).forEach(([field, files]) => files.forEach((f) => fd.append(field, f)));
  return fd;
};

const progress = (cb) => (cb ? { onUploadProgress: (e) => e.total && cb(Math.round((e.loaded / e.total) * 100)) } : {});

export const api = {
  createTransfer: (data, machineImages, electricalImages, onProgress) =>
    http.post('/transfers', multipart(data, { machineImages, electricalImages }), progress(onProgress)),

  lookupTransfer: (assetNumber, email) => http.post('/transfers/lookup', { assetNumber, email }),

  submitAction: (assetNumber, data, images, onProgress) =>
    http.post(`/transfers/${encodeURIComponent(assetNumber)}/actions`, multipart(data, { images }), progress(onProgress)),

  adminList: (key) => http.get('/admin/transfers', { headers: { 'x-admin-key': key } }),

  adminGet: (key, assetNumber) =>
    http.get(`/admin/transfers/${encodeURIComponent(assetNumber)}`, { headers: { 'x-admin-key': key } }),
};
