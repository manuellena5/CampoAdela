// Sincronización con el Google Sheet vía Apps Script.
// Ciclo: push de pendientes (lotes de 100) → pull paginado desde lastSync (páginas de 500) →
// merge (last-write-wins por `modificado`) → guardar lastSync → subir el log de errores.
//
// Emite progreso { etapa, total, hecho, detalle, porcentaje }:
//   preparando → enviando → recibiendo → aplicando → listo | error
// Nunca corren dos sincronizaciones a la vez.

import { APPS_SCRIPT_URL } from './config.js';
import { db, TABLAS_SYNC, alCambiarDatos } from './db.js';
import * as ajustes from './ajustes.js';
import { normalizarMovimiento } from './dominio.js';
import { llamar } from './api.js';
import { procesarCola } from './storage.js';
import { ErrorRed, notificarError } from './errores.js';
import { toast } from './lib/dom.js';

const LOTE_PUSH = 100;
const PAGINA_PULL = 500;
const LOTE_APLICAR = 200;
const LOTE_LOG = 100;
const MAX_HISTORIAL = 10;

// Tramo del porcentaje total que ocupa cada etapa.
const TRAMOS = { preparando: [0, 5], enviando: [5, 45], recibiendo: [45, 80], aplicando: [80, 99], listo: [100, 100], error: [0, 0] };

// estado: 'sin-config' | 'sin-conexion' | 'sincronizando' | 'ok' | 'pendientes' | 'error'
// error: null | { codigo, mensaje, id } (mensaje amigable del último sync fallido)
let estado = { estado: 'ok', pendientes: 0, error: null, progreso: null };
const oyentes = new Set();
const oyentesProgreso = new Set();
let enCurso = null;
let timerGuardado = null;

export function alCambiarEstado(fn) {
  oyentes.add(fn);
  fn(estado);
  return () => oyentes.delete(fn);
}

/** Suscripción al progreso del sync en curso: fn({ etapa, total, hecho, detalle, porcentaje }). */
export function alProgresoSync(fn) {
  oyentesProgreso.add(fn);
  if (estado.progreso) fn(estado.progreso);
  return () => oyentesProgreso.delete(fn);
}

export function estadoActual() {
  return estado;
}

export function sincronizando() {
  return Boolean(enCurso);
}

function setEstado(cambios) {
  estado = { ...estado, ...cambios };
  oyentes.forEach((fn) => fn(estado));
}

function progreso(etapa, total = 0, hecho = 0, detalle = '') {
  const [a, b] = TRAMOS[etapa];
  const fraccion = total ? Math.min(hecho / total, 1) : (etapa === 'listo' ? 1 : 0);
  const p = { etapa, total, hecho, detalle, porcentaje: Math.round(a + (b - a) * fraccion) };
  oyentesProgreso.forEach((fn) => fn(p));
  setEstado({ progreso: p });
}

// ---------------------------------------------------------------- Pendientes

export async function pendientesPorEntidad() {
  const r = {};
  for (const t of TABLAS_SYNC) r[t] = await db.table(t).filter((x) => x.pendiente).count();
  r.comprobantes = await db.archivos.count();
  r.errores = await db.logErrores.filter((e) => !e.enviado).count();
  return r;
}

export async function contarPendientes() {
  const p = await pendientesPorEntidad();
  return TABLAS_SYNC.reduce((s, t) => s + p[t], 0) + p.comprobantes;
}

// Recalcula el estado "en reposo" según conexión, último error y pendientes.
async function refrescarEstado() {
  if (enCurso) return;
  const pendientes = await contarPendientes();
  let e;
  if (!APPS_SCRIPT_URL || !(await ajustes.obtener('clave'))) e = 'sin-config';
  else if (!navigator.onLine) e = 'sin-conexion';
  else if (estado.error) e = 'error';
  else e = pendientes ? 'pendientes' : 'ok';
  setEstado({ estado: e, pendientes });
}

// ---------------------------------------------------------------- Merge

// Sin `pendiente` (es solo local).
function paraEnviar(registro) {
  const { pendiente, ...resto } = registro;
  return resto;
}

// Registro remoto listo para guardar local (con campos derivados, sin pendiente).
function paraGuardar(tabla, remoto) {
  const reg = tabla === 'movimientos' ? normalizarMovimiento(remoto) : remoto;
  return { ...reg, pendiente: false };
}

// Aplica un registro remoto si es más nuevo (o igual) que el local.
// Devuelve 'nuevo' | 'modificado' | 'borrado' | null (sin cambios).
async function mergeRegistro(tabla, remoto) {
  const local = await db.table(tabla).get(remoto.id);
  if (local && String(local.modificado) > String(remoto.modificado)) return null; // gana el local
  if (local && !local.pendiente && local.modificado === remoto.modificado) return null; // ya estaba
  await db.table(tabla).put(paraGuardar(tabla, remoto));
  if (remoto.borrado && !local?.borrado) return 'borrado';
  return local ? 'modificado' : 'nuevo';
}

const trozos = (lista, n) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));

// ---------------------------------------------------------------- Ciclo

async function ciclo(resultado) {
  const usuario = await ajustes.obtener('usuario');
  const contar = (t, tipo) => {
    resultado.recibidos[t] ??= { nuevos: 0, modificados: 0, borrados: 0 };
    resultado.recibidos[t][`${tipo}s`]++;
  };

  // 0. Preparando: comprobantes en cola (al subirse actualizan comprobanteUrl, que viaja en el push).
  progreso('preparando', 0, 0, 'Revisando cambios locales');
  const { error: errorComprobantes } = await procesarCola();
  if (errorComprobantes) resultado.errorComprobantes = errorComprobantes;

  // 1. Push en lotes (en orden de entidades: primero las referencias, al final los movimientos).
  const pendientes = [];
  for (const t of TABLAS_SYNC) {
    for (const r of await db.table(t).filter((x) => x.pendiente).toArray()) pendientes.push([t, r]);
  }
  progreso('enviando', pendientes.length, 0, pendientes.length ? '' : 'Nada para enviar');
  let hechos = 0;
  for (const lote of trozos(pendientes, LOTE_PUSH)) {
    const cuerpo = {};
    for (const [t, r] of lote) (cuerpo[t] ??= []).push(paraEnviar(r));
    const res = await llamar('push', cuerpo);
    await db.transaction('rw', TABLAS_SYNC.map((t) => db.table(t)), async () => {
      for (const [t, enviado] of lote) {
        if (!(res.aceptados?.[t] || []).includes(enviado.id)) continue;
        // Solo se limpia si no se volvió a editar mientras se sincronizaba.
        const actual = await db.table(t).get(enviado.id);
        if (actual && actual.modificado === enviado.modificado) await db.table(t).update(enviado.id, { pendiente: false });
        resultado.enviados++;
      }
      // El servidor tenía una versión más nueva: se toma.
      for (const [t, remotos] of Object.entries(res.rechazados || {})) {
        for (const remoto of remotos) {
          const local = await db.table(t).get(remoto.id);
          if (!local || String(local.modificado) <= String(remoto.modificado)) {
            await db.table(t).put(paraGuardar(t, remoto));
            contar(t, 'modificado');
          }
        }
      }
    });
    hechos += lote.length;
    progreso('enviando', pendientes.length, hechos);
  }

  // 2. Pull paginado.
  const desde = (await ajustes.obtener('lastSync')) || 0;
  const recibidos = [];
  let cursor = null;
  let hayMas = true;
  let total = 0;
  let nuevoSyncTs = null;
  progreso('recibiendo', 0, 0, 'Consultando cambios');
  while (hayMas) {
    const res = await llamar('pull', { desde, limite: PAGINA_PULL, cursor });
    nuevoSyncTs ??= res.syncTs; // el de la primera página: lo que cambie durante la paginación se trae la próxima vez
    if (res.entidades) {
      // Apps Script anterior (sin paginado): todo en una sola respuesta.
      for (const t of TABLAS_SYNC) for (const r of res.entidades[t] || []) recibidos.push([t, r]);
      total = recibidos.length;
      hayMas = false;
    } else {
      for (const t of TABLAS_SYNC) for (const r of res.registros?.[t] || []) recibidos.push([t, r]);
      total = Math.max(res.totalPendiente || 0, recibidos.length);
      hayMas = Boolean(res.hayMas);
      cursor = res.cursor;
    }
    progreso('recibiendo', total, recibidos.length);
  }

  // 3. Aplicar (merge) en lotes.
  progreso('aplicando', recibidos.length, 0);
  let aplicados = 0;
  for (const lote of trozos(recibidos, LOTE_APLICAR)) {
    await db.transaction('rw', TABLAS_SYNC.map((t) => db.table(t)), async () => {
      for (const [t, remoto] of lote) {
        const tipo = await mergeRegistro(t, remoto);
        if (!tipo) continue;
        contar(t, tipo);
        if (t === 'movimientos' && tipo === 'nuevo' && remoto.cargadoPor && remoto.cargadoPor !== usuario) {
          resultado.deOtros[remoto.cargadoPor] = (resultado.deOtros[remoto.cargadoPor] || 0) + 1;
        }
      }
    });
    aplicados += lote.length;
    progreso('aplicando', recibidos.length, aplicados);
  }

  // 4. lastSync
  await ajustes.guardar('lastSync', nuevoSyncTs);
  await ajustes.guardar('ultimaSyncLocal', new Date().toISOString());

  // 5. Log de errores → pestaña "Errores" del Sheet (si falla, se reintenta en el próximo sync).
  await subirLog();
}

async function subirLog() {
  try {
    const pendientes = await db.logErrores.filter((e) => !e.enviado).toArray();
    for (const lote of trozos(pendientes, LOTE_LOG)) {
      const entradas = lote.map(({ id, enviado, ...e }) => e);
      await llamar('log', { entradas });
      await db.transaction('rw', db.logErrores, async () => {
        for (const e of lote) {
          // Si se repitió mientras se subía, queda pendiente para mandar el total actualizado.
          const actual = await db.logErrores.get(e.id);
          if (actual && actual.repeticiones === e.repeticiones) await db.logErrores.update(e.id, { enviado: true });
        }
      });
    }
  } catch (err) {
    // No se registra en el log (evita un bucle); p. ej. un Apps Script sin la acción "log".
    console.warn('No se pudo subir el log de errores', err);
  }
}

// ---------------------------------------------------------------- Resultado

async function guardarHistorial(entrada) {
  try {
    await db.historialSync.add(entrada);
    const total = await db.historialSync.count();
    if (total > MAX_HISTORIAL) {
      const viejas = await db.historialSync.orderBy('id').limit(total - MAX_HISTORIAL).primaryKeys();
      await db.historialSync.bulkDelete(viejas);
    }
  } catch (err) {
    console.warn('No se pudo guardar el historial de sincronización', err);
  }
}

export async function historialSync() {
  return db.historialSync.orderBy('id').reverse().toArray();
}

// "Llegaron 3 movimientos nuevos (2 de Martin, 1 de Manuel)"
async function avisarDatosDeOtros(deOtros) {
  const total = Object.values(deOtros).reduce((s, n) => s + n, 0);
  if (!total) return;
  const nombres = Object.fromEntries((await db.hermanos.toArray()).map((h) => [h.id, h.nombre]));
  const detalle = Object.entries(deOtros).sort((a, b) => b[1] - a[1])
    .map(([id, cant]) => `${cant.toLocaleString('es-AR')} de ${nombres[id] || 'otro hermano'}`).join(', ');
  const n = (x) => x.toLocaleString('es-AR');
  toast(`Llegaron ${n(total)} movimiento${total === 1 ? '' : 's'} nuevo${total === 1 ? '' : 's'} (${detalle})`, { tipo: 'info', duracion: 6000 });
}

// ---------------------------------------------------------------- Ejecución

/** Ejecuta un ciclo completo. Si ya hay uno en curso, devuelve ese (no se superponen). */
export function sincronizar() {
  if (enCurso) return enCurso;
  enCurso = ejecutar().finally(() => {
    enCurso = null;
    return refrescarEstado();
  });
  return enCurso;
}

async function ejecutar() {
  if (!APPS_SCRIPT_URL || !navigator.onLine) return { ok: false, cambios: 0 };
  // Sin clave todavía (primer uso): no es un error, el indicador muestra "Sin configurar".
  if (!(await ajustes.obtener('clave'))) return { ok: false, cambios: 0 };
  const inicio = Date.now();
  const resultado = { enviados: 0, recibidos: {}, deOtros: {} };
  setEstado({ estado: 'sincronizando', progreso: null }); // sin arrastrar el 100% del sync anterior
  let salida;
  try {
    await ciclo(resultado);
    const cambios = Object.values(resultado.recibidos).reduce((s, r) => s + r.nuevos + r.modificados + r.borrados, 0);
    let error = null;
    if (resultado.errorComprobantes) {
      error = await notificarError(resultado.errorComprobantes, { accion: 'subir comprobante' }, { reintentar: sincronizar });
    }
    progreso('listo');
    setEstado({ error: error ? { codigo: error.codigo, mensaje: `Comprobantes: ${error.mensaje}`, id: error.id } : null });
    await guardarHistorial({
      fecha: new Date(inicio).toISOString(), duracionMs: Date.now() - inicio, resultado: 'ok',
      enviados: resultado.enviados, recibidos: resultado.recibidos, cambios,
    });
    if (cambios) window.dispatchEvent(new CustomEvent('datos-sincronizados', { detail: { cambios } }));
    await avisarDatosDeOtros(resultado.deOtros);
    salida = { ok: true, cambios, resultado };
  } catch (err) {
    const etapa = estado.progreso?.etapa || '';
    const amigable = await notificarError(err, { accion: 'sincronizar', datos: { etapa } }, { reintentar: sincronizar });
    progreso('error', 0, 0, amigable.mensaje);
    setEstado({ error: { codigo: amigable.codigo, mensaje: amigable.mensaje, id: amigable.id } });
    await guardarHistorial({
      fecha: new Date(inicio).toISOString(), duracionMs: Date.now() - inicio, resultado: 'error',
      enviados: resultado.enviados, recibidos: resultado.recibidos, codigo: amigable.codigo, mensaje: amigable.mensaje,
    });
    salida = { ok: false, cambios: 0, error: estado.error };
  }
  return salida;
}

// Disparadores: al guardar (con demora corta para agrupar cambios), al volver la conexión.
export function iniciarSync() {
  alCambiarDatos(() => {
    refrescarEstado();
    if (!navigator.onLine) {
      // Sin conexión: los datos quedan en el teléfono (se agrupa si se guardan varios seguidos).
      notificarError(new ErrorRed('Guardado sin conexión'), { accion: 'guardar sin conexión' }, { nivel: 'advertencia' });
      return;
    }
    clearTimeout(timerGuardado);
    timerGuardado = setTimeout(() => sincronizar(), 1500);
  });
  window.addEventListener('online', () => sincronizar());
  window.addEventListener('offline', () => refrescarEstado());
  return sincronizar(); // al abrir la app
}
