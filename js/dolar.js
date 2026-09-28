// Cotización del dólar (valor de venta), MEP u Oficial.
//  - Hoy: dolarapi.com (la fecha real sale de fechaActualizacion).
//  - Fechas anteriores: api.argentinadatos.com por fecha puntual. Esa API rellena fines de semana y
//    feriados con el valor del último día hábil pero devuelve la fecha pedida: por eso se calcula el
//    último día hábil (fines de semana + feriados) y ese va a `tcFecha`.
//  - Cache en la tabla `cotizaciones`; sin conexión se usa la última conocida con estado 'a_confirmar'.

import { db, actualizar } from './db.js';
import * as ajustes from './ajustes.js';
import { hoyISO, fechaAR } from './lib/formato.js';
import { calcularMontos } from './dominio.js';

const CASA = { MEP: 'bolsa', OFICIAL: 'oficial' };
const TIMEOUT_MS = 12000;
const REFRESCO_FERIADOS_MS = 7 * 24 * 3600 * 1000;

export const TIPOS_DOLAR = [['MEP', 'MEP'], ['OFICIAL', 'Oficial']];

async function getJSON(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// ---- Fechas (texto YYYY-MM-DD, sin zona horaria)

function diaAnterior(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function esFinDeSemana(fecha) {
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return dia === 0 || dia === 6;
}

// Feriados nacionales del año (cacheados en ajustes). Si no hay forma de obtenerlos, lista vacía.
async function feriados(anio) {
  const clave = `feriados-${anio}`;
  const cache = await ajustes.obtener(clave);
  if (cache && Date.now() - cache.cuando < REFRESCO_FERIADOS_MS) return new Set(cache.fechas);
  if (navigator.onLine) {
    try {
      const lista = await getJSON(`https://api.argentinadatos.com/v1/feriados/${anio}`);
      if (Array.isArray(lista)) {
        const fechas = lista.map((f) => f.fecha);
        await ajustes.guardar(clave, { fechas, cuando: Date.now() });
        return new Set(fechas);
      }
    } catch { /* se usa el cache viejo o nada */ }
  }
  return new Set(cache?.fechas || []);
}

// Último día hábil (no fin de semana ni feriado) en o antes de `fecha`.
export async function ultimoDiaHabil(fecha) {
  let d = fecha;
  for (let i = 0; i < 15; i++) {
    if (!esFinDeSemana(d) && !(await feriados(d.slice(0, 4))).has(d)) return d;
    d = diaAnterior(d);
  }
  return fecha;
}

// ---- Cache

async function guardarCache(tipo, fecha, valor, fechaReal) {
  await db.cotizaciones.put({ tipo, fecha, valor, fechaReal });
  const ultima = await ajustes.obtener(`cotizacion-${tipo}`);
  if (!ultima || fechaReal >= ultima.fecha) await ajustes.guardar(`cotizacion-${tipo}`, { valor, fecha: fechaReal });
}

// Última cotización conocida de un tipo (para trabajar sin conexión).
export async function ultimaConocida(tipo) {
  return (await ajustes.obtener(`cotizacion-${tipo}`)) || null;
}

// ---- Consulta

async function deApiHoy(tipo) {
  const r = await getJSON(`https://dolarapi.com/v1/dolares/${CASA[tipo]}`);
  if (!r || !(r.venta > 0)) throw new Error('Cotización no disponible');
  return { valor: r.venta, fechaReal: r.fechaActualizacion ? fechaAR(r.fechaActualizacion) : hoyISO() };
}

async function deApiHistorica(tipo, fecha) {
  let d = await ultimoDiaHabil(fecha);
  // Si ese día todavía no está publicado (p. ej. ayer), se busca hacia atrás.
  for (let i = 0; i < 10; i++) {
    const r = await getJSON(`https://api.argentinadatos.com/v1/cotizaciones/dolares/${CASA[tipo]}/${d.replaceAll('-', '/')}`);
    if (r && r.venta > 0) return { valor: r.venta, fechaReal: d };
    d = await ultimoDiaHabil(diaAnterior(d));
  }
  throw new Error('Cotización no disponible');
}

/**
 * Cotización de venta para `tipo` ('MEP' | 'OFICIAL') en `fecha` (YYYY-MM-DD).
 * Devuelve { tc, tcFecha, tcEstado: 'api' | 'a_confirmar' } o null si no hay ninguna disponible.
 */
export async function obtenerCotizacion(tipo, fecha) {
  const hoy = hoyISO();
  const esHoyOFuturo = fecha >= hoy;
  const clave = esHoyOFuturo ? hoy : fecha;
  const cache = await db.cotizaciones.get([tipo, clave]);

  // Fechas pasadas ya consultadas: el valor no cambia.
  if (cache && !esHoyOFuturo) return { tc: cache.valor, tcFecha: cache.fechaReal, tcEstado: 'api' };

  if (navigator.onLine) {
    try {
      const { valor, fechaReal } = esHoyOFuturo ? await deApiHoy(tipo) : await deApiHistorica(tipo, fecha);
      await guardarCache(tipo, clave, valor, fechaReal);
      return { tc: valor, tcFecha: fechaReal, tcEstado: 'api' };
    } catch (err) {
      console.warn('No se pudo obtener la cotización', err);
    }
  }

  // Hoy, sin conexión, pero ya consultada hoy: sirve.
  if (cache) return { tc: cache.valor, tcFecha: cache.fechaReal, tcEstado: 'api' };

  const ultima = await ultimaConocida(tipo);
  return ultima ? { tc: ultima.valor, tcFecha: ultima.fecha, tcEstado: 'a_confirmar' } : null;
}

// ---- Movimientos "a confirmar"

export async function movimientosAConfirmar() {
  return db.movimientos.filter((m) => !m.borrado && m.tcEstado === 'a_confirmar').toArray();
}

// Vuelve a buscar la cotización de los movimientos "a confirmar". Devuelve cuántos se actualizaron.
export async function recalcularAConfirmar() {
  let actualizados = 0;
  for (const m of await movimientosAConfirmar()) {
    const c = await obtenerCotizacion(m.tipoDolar, m.fecha);
    if (!c || c.tcEstado !== 'api') continue;
    await actualizar('movimientos', m.id, {
      tc: c.tc, tcFecha: c.tcFecha, tcEstado: 'api',
      ...calcularMontos(m.moneda, m.montoOriginal, c.tc),
    });
    actualizados++;
  }
  return actualizados;
}
