// Llamadas al Apps Script: POST { clave, accion, datos } → { ok, error?, datos? }.
// Las fallas salen como errores tipados (ErrorRed / ErrorClave / ErrorServidor): ver errores.js.

import { APPS_SCRIPT_URL } from './config.js';
import * as ajustes from './ajustes.js';
import { ErrorRed, ErrorClave, ErrorServidor, mensajeAmigable } from './errores.js';

const TIMEOUT_MS = 60000;

export async function llamar(accion, datos, { timeout = TIMEOUT_MS } = {}) {
  const clave = await ajustes.obtener('clave');
  let resp;
  try {
    // text/plain evita el preflight de CORS (Apps Script no responde OPTIONS).
    resp = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ clave, accion, datos }),
      // Con señal débil un request puede quedar colgado; Apps Script "en frío" tarda varios segundos.
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    // Sin conexión, DNS, CORS o timeout. No se guarda el payload (puede tener la clave).
    throw new ErrorRed(`${accion}: sin respuesta del servidor`, { causa: err });
  }
  if (!resp.ok) throw new ErrorServidor(`${accion}: HTTP ${resp.status}`);
  let json;
  try {
    json = await resp.json();
  } catch (err) {
    throw new ErrorServidor(`${accion}: la respuesta no es JSON (¿URL del Apps Script correcta?)`, { causa: err });
  }
  if (!json.ok) {
    if (json.codigo === 'CLAVE') throw new ErrorClave(`${accion}: clave rechazada`);
    throw new ErrorServidor(`${accion}: ${json.error || 'error sin detalle'}`);
  }
  return json.datos;
}

// Mensaje amigable para un error de red / servidor (compatibilidad con código anterior).
export function mensajeError(err) {
  return mensajeAmigable(err).mensaje;
}
