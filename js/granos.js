// Granos: stock en cada acopio, liquidaciones (ventas) y lo que se va cobrando. Funciones puras.
//
// Cada registro de la tabla `granos` es de un tipo:
//   ENTREGA      kilos que entraron a un acopio (cosecha). Suma stock.
//   LIQUIDACION  venta de kilos a un precio por quintal. Resta stock. Tiene gastos (comisión, flete,
//                paritaria, sellado…) que se descuentan del bruto, y una fecha de cobro estimada.
//   COBRO        plata que entró por una liquidación (liquidacionId). Genera, o se vincula a,
//                un movimiento de ingreso "Venta de grano" (movimientoId). No mueve stock.
//   AJUSTE       kilos que se suman (+) o restan (−) del stock sin plata de por medio: merma,
//                diferencia de balanza, kilos para semilla…
// El stock es por campaña + grano + acopio. Nada de esto guarda estados: todo sale de las cuentas.

import { KG_POR_QQ } from './calculos.js';

export const TIPOS_GRANO = {
  ENTREGA: { icono: '🌾', nombre: 'Entrega al acopio' },
  LIQUIDACION: { icono: '📋', nombre: 'Liquidación' },
  COBRO: { icono: '💰', nombre: 'Cobro' },
  AJUSTE: { icono: '⚖️', nombre: 'Ajuste de kilos' },
};

// Diferencia que se considera "cobrado del todo" (redondeos de la liquidación).
const TOLERANCIA_ARS = 1;

const num = (x) => Number(x) || 0;
export const redondeoKg = (n) => Math.round(num(n) * 100) / 100;
const clave = (r) => `${r.campanaId || ''}|${r.grano || ''}|${r.acopio || ''}`;

/** Kilos que un registro suma (+) o resta (−) del stock. */
export function efectoStock(r) {
  if (!r || r.borrado) return 0;
  if (r.tipo === 'ENTREGA') return num(r.kg);
  if (r.tipo === 'LIQUIDACION') return -num(r.kg);
  if (r.tipo === 'AJUSTE') return num(r.kg); // con signo
  return 0;
}

/** Importes de una liquidación sin cobros: bruto = qq × precio; neto = bruto − gastos. */
export function importesLiquidacion(l) {
  const bruto = (num(l.kg) / KG_POR_QQ) * num(l.precioQq);
  return { bruto, gastos: num(l.gastos), neto: bruto - num(l.gastos) };
}

/** Monto de un cobro: el del movimiento vinculado (si existe y no está borrado) o el guardado. */
export function montoCobro(c, movPorId) {
  const mov = c.movimientoId ? movPorId[c.movimientoId] : null;
  return mov && !mov.borrado ? num(mov.montoARS) : num(c.monto);
}

/**
 * Stock agrupado: [{ campanaId, grano, kg, acopios: [{ acopio, kg }] }], sin los que dan 0.
 * `campanaId` opcional para filtrar.
 */
export function stockGranos(granos, campanaId) {
  const porClave = new Map();
  for (const r of granos) {
    if (r.borrado || (campanaId && r.campanaId !== campanaId)) continue;
    const ef = efectoStock(r);
    if (!ef && r.tipo !== 'ENTREGA') continue;
    const k = clave(r);
    porClave.set(k, { campanaId: r.campanaId || '', grano: r.grano || '', acopio: r.acopio || '', kg: (porClave.get(k)?.kg || 0) + ef });
  }
  const grupos = new Map();
  for (const s of porClave.values()) {
    const kg = redondeoKg(s.kg);
    const g = `${s.campanaId}|${s.grano}`;
    if (!grupos.has(g)) grupos.set(g, { campanaId: s.campanaId, grano: s.grano, kg: 0, acopios: [] });
    const grupo = grupos.get(g);
    grupo.kg = redondeoKg(grupo.kg + kg);
    if (Math.abs(kg) > 0.005) grupo.acopios.push({ acopio: s.acopio, kg });
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, acopios: g.acopios.sort((a, b) => b.kg - a.kg) }))
    .filter((g) => g.acopios.length);
}

/** Kilos en stock de una combinación campaña + grano + acopio. */
export function stockEn(granos, campanaId, grano, acopio) {
  const k = clave({ campanaId, grano, acopio });
  return redondeoKg(granos.filter((r) => !r.borrado && clave(r) === k).reduce((s, r) => s + efectoStock(r), 0));
}

/**
 * Liquidaciones con lo cobrado y lo que falta: { ...liq, bruto, gastos, neto, cobros, cobrado, pendiente, cobrada }.
 * Más nuevas primero.
 */
export function liquidaciones(granos, movimientos) {
  const movPorId = Object.fromEntries(movimientos.map((m) => [m.id, m]));
  return granos.filter((r) => !r.borrado && r.tipo === 'LIQUIDACION').map((l) => {
    const cobros = granos.filter((c) => !c.borrado && c.tipo === 'COBRO' && c.liquidacionId === l.id)
      .map((c) => ({ ...c, montoReal: montoCobro(c, movPorId) }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    const { bruto, gastos, neto } = importesLiquidacion(l);
    const cobrado = cobros.reduce((s, c) => s + c.montoReal, 0);
    const pendiente = neto - cobrado;
    return { ...l, bruto, gastos, neto, cobros, cobrado, pendiente, cobrada: pendiente <= TOLERANCIA_ARS };
  }).sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/**
 * Quintales que representa un cobro, proporcional a lo que cubre del neto de su liquidación.
 * Así la suma de los cobros de una liquidación da sus quintales (y el rinde de la campaña cierra).
 */
export function quintalesDeCobro(liq, monto) {
  const { neto } = importesLiquidacion(liq);
  const qq = num(liq.kg) / KG_POR_QQ;
  if (!(neto > 0)) return qq;
  return Math.round(qq * Math.min(num(monto) / neto, 1) * 100) / 100;
}

/** Error si dar de alta/editar `nuevo` (reemplazando a `viejo`) deja negativo el stock de su acopio; '' si está bien. */
export function errorStock(granos, viejo, nuevo) {
  const base = stockEn(granos, nuevo.campanaId, nuevo.grano, nuevo.acopio);
  const mismoLugar = viejo && clave(viejo) === clave(nuevo);
  const queda = redondeoKg(base - (mismoLugar ? efectoStock(viejo) : 0) + efectoStock(nuevo));
  if (queda >= -0.005) return '';
  const hay = redondeoKg(base - (mismoLugar ? efectoStock(viejo) : 0));
  return `En ${nuevo.acopio || 'ese acopio'} hay ${hay.toLocaleString('es-AR')} kg de ${nuevo.grano || 'grano'} en esa campaña: no alcanza.`;
}
