// Sincronización con el Google Sheet vía Apps Script.
// Ciclo: push de pendientes → pull desde lastSync → merge (last-write-wins por `modificado`) → guardar lastSync.

import { APPS_SCRIPT_URL } from './config.js';
import { db, TABLAS_SYNC, alCambiarDatos } from './db.js';
import * as ajustes from './ajustes.js';

const TIMEOUT_MS = 60000;

// estado: 'sin-config' | 'sin-conexion' | 'sincronizando' | 'ok' | 'pendientes' | 'error'
let estado = { estado: 'ok', pendientes: 0, error: '' };
const oyentes = new Set();
let enCurso = null;
let timerGuardado = null;

export function alCambiarEstado(fn) {
  oyentes.add(fn);
  fn(estado);
  return () => oyentes.delete(fn);
}

export function estadoActual() {
  return estado;
}

function setEstado(cambios) {
  estado = { ...estado, ...cambios };
  oyentes.forEach((fn) => fn(estado));
}

export async function contarPendientes() {
  let total = 0;
  for (const t of TABLAS_SYNC) total += await db.table(t).filter((r) => r.pendiente).count();
  return total;
}

// Recalcula el estado "en reposo" según conexión y pendientes.
async function refrescarEstado(extra = {}) {
  const pendientes = await contarPendientes();
  let e;
  if (!APPS_SCRIPT_URL) e = 'sin-config';
  else if (!navigator.onLine) e = 'sin-conexion';
  else if (extra.error) e = 'error';
  else e = pendientes ? 'pendientes' : 'ok';
  setEstado({ estado: e, pendientes, error: extra.error || '' });
}

async function llamar(accion, datos) {
  const clave = await ajustes.obtener('clave');
  // text/plain evita el preflight de CORS (Apps Script no responde OPTIONS).
  const resp = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ clave, accion, datos }),
    // Con señal débil un request puede quedar colgado; Apps Script "en frío" tarda varios segundos.
    signal: AbortSignal.timeout(TIMEOUT_MS),
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

// Sin `pendiente` (es solo local).
function paraEnviar(registro) {
  const { pendiente, ...resto } = registro;
  return resto;
}

// Aplica un registro remoto si es más nuevo (o igual) que el local.
// Devuelve true si cambió algo.
async function mergeRegistro(tabla, remoto) {
  const local = await db.table(tabla).get(remoto.id);
  if (local && String(local.modificado) > String(remoto.modificado)) return false; // gana el local
  if (local && !local.pendiente && local.modificado === remoto.modificado) return false; // ya estaba
  await db.table(tabla).put({ ...remoto, pendiente: false });
  return true;
}

async function ciclo() {
  let cambios = 0;

  // 1. push
  const envio = {};
  for (const t of TABLAS_SYNC) {
    const pend = await db.table(t).filter((r) => r.pendiente).toArray();
    if (pend.length) envio[t] = pend;
  }
  if (Object.keys(envio).length) {
    const cuerpo = Object.fromEntries(Object.entries(envio).map(([t, regs]) => [t, regs.map(paraEnviar)]));
    const res = await llamar('push', cuerpo);
    await db.transaction('rw', TABLAS_SYNC.map((t) => db.table(t)), async () => {
      for (const [t, regs] of Object.entries(envio)) {
        const aceptados = new Set(res.aceptados?.[t] || []);
        for (const enviado of regs) {
          if (!aceptados.has(enviado.id)) continue;
          // Solo se limpia si no se volvió a editar mientras se sincronizaba.
          const actual = await db.table(t).get(enviado.id);
          if (actual && actual.modificado === enviado.modificado) await db.table(t).update(enviado.id, { pendiente: false });
        }
        // El servidor tenía una versión más nueva: se toma.
        for (const remoto of res.rechazados?.[t] || []) {
          const local = await db.table(t).get(remoto.id);
          if (!local || String(local.modificado) <= String(remoto.modificado)) {
            await db.table(t).put({ ...remoto, pendiente: false });
            cambios++;
          }
        }
      }
    });
  }

  // 2. pull + 3. merge
  const desde = (await ajustes.obtener('lastSync')) || 0;
  const res = await llamar('pull', { desde });
  await db.transaction('rw', TABLAS_SYNC.map((t) => db.table(t)), async () => {
    for (const t of TABLAS_SYNC) {
      for (const remoto of res.entidades?.[t] || []) {
        if (await mergeRegistro(t, remoto)) cambios++;
      }
    }
  });

  // 4. lastSync
  await ajustes.guardar('lastSync', res.syncTs);
  await ajustes.guardar('ultimaSyncLocal', new Date().toISOString());
  return cambios;
}

// Ejecuta un ciclo completo. Si ya hay uno en curso, devuelve ese.
export function sincronizar() {
  if (enCurso) return enCurso;
  enCurso = (async () => {
    if (!APPS_SCRIPT_URL || !navigator.onLine) {
      await refrescarEstado();
      return { ok: false, cambios: 0 };
    }
    const clave = await ajustes.obtener('clave');
    if (!clave) {
      await refrescarEstado({ error: 'Falta la clave compartida' });
      return { ok: false, cambios: 0 };
    }
    setEstado({ estado: 'sincronizando' });
    try {
      const cambios = await ciclo();
      await refrescarEstado();
      if (cambios) window.dispatchEvent(new CustomEvent('datos-sincronizados', { detail: { cambios } }));
      return { ok: true, cambios };
    } catch (err) {
      console.warn('Error de sincronización', err);
      const mensaje = err.name === 'TimeoutError' ? 'El servidor tardó demasiado en responder'
        : err instanceof TypeError ? 'No se pudo contactar al servidor'
        : err.message;
      await refrescarEstado({ error: mensaje });
      return { ok: false, cambios: 0, error: mensaje };
    }
  })().finally(() => { enCurso = null; });
  return enCurso;
}

// Disparadores: al guardar (con demora corta para agrupar cambios), al volver la conexión.
export function iniciarSync() {
  alCambiarDatos(() => {
    refrescarEstado();
    clearTimeout(timerGuardado);
    timerGuardado = setTimeout(() => { if (navigator.onLine) sincronizar(); }, 1500);
  });
  window.addEventListener('online', () => sincronizar());
  window.addEventListener('offline', () => refrescarEstado());
  return sincronizar(); // al abrir la app
}
