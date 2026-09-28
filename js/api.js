// Llamadas al Apps Script: POST { clave, accion, datos } → { ok, error?, datos? }.

import { APPS_SCRIPT_URL } from './config.js';
import * as ajustes from './ajustes.js';

const TIMEOUT_MS = 60000;

export async function llamar(accion, datos, { timeout = TIMEOUT_MS } = {}) {
  const clave = await ajustes.obtener('clave');
  // text/plain evita el preflight de CORS (Apps Script no responde OPTIONS).
  const resp = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ clave, accion, datos }),
    // Con señal débil un request puede quedar colgado; Apps Script "en frío" tarda varios segundos.
    signal: AbortSignal.timeout(timeout),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  let json;
  try {
    json = await resp.json();
  } catch {
    throw new Error('Respuesta inválida del servidor (¿URL del Apps Script correcta?)');
  }
  if (!json.ok) throw new Error(json.error || 'Error del servidor');
  return json.datos;
}

// Mensaje legible para un error de red / servidor.
export function mensajeError(err) {
  if (err.name === 'TimeoutError') return 'El servidor tardó demasiado en responder';
  if (err instanceof TypeError) return 'No se pudo contactar al servidor';
  return err.message;
}
