// Cálculos de resumen de campaña y cuentas entre hermanos (funciones puras).

import { PAGO_CAJA } from './dominio.js';

export const KG_POR_QQ = 100;
const MONEDAS = { ARS: 'montoARS', USD: 'montoUSD' };

const sumar = (lista, campo) => lista.reduce((s, m) => s + (Number(m[campo]) || 0), 0);
const importes = (lista) => ({ ARS: sumar(lista, 'montoARS'), USD: sumar(lista, 'montoUSD') });

/**
 * Resumen de una campaña. Solo entran los movimientos con esa campaña
 * (los gastos sin campaña no entran en el margen).
 */
export function resumenCampana(campana, movimientos, categorias, subcategorias) {
  const ha = Number(campana.hectareas) || 0;
  const movs = movimientos.filter((m) => !m.borrado && m.campanaId === campana.id);
  const tipoDe = Object.fromEntries(categorias.map((c) => [c.id, c.tipo]));
  const gastos = movs.filter((m) => tipoDe[m.categoriaId] === 'gasto');
  const ingresos = movs.filter((m) => tipoDe[m.categoriaId] === 'ingreso');
  const porHa = (x) => ({ ARS: ha ? x.ARS / ha : 0, USD: ha ? x.USD / ha : 0 });
  const orden = (a, b) => a.orden - b.orden;

  const totalGastos = importes(gastos);

  // Gastos por categoría y subcategoría
  const gastosPorCategoria = categorias.filter((c) => c.tipo === 'gasto').sort(orden)
    .map((c) => {
      const deCat = gastos.filter((m) => m.categoriaId === c.id);
      if (!deCat.length) return null;
      const subs = subcategorias.filter((s) => s.categoriaId === c.id).sort(orden)
        .map((s) => ({ id: s.id, nombre: s.nombre, total: importes(deCat.filter((m) => m.subcategoriaId === s.id)) }))
        .filter((s) => s.total.ARS || s.total.USD);
      const sinSub = deCat.filter((m) => !m.subcategoriaId || !subcategorias.some((s) => s.id === m.subcategoriaId));
      if (sinSub.length && subs.length) subs.push({ id: '', nombre: 'Sin subcategoría', total: importes(sinSub) });
      const total = importes(deCat);
      return { id: c.id, nombre: c.nombre, total, porHa: porHa(total), subcategorias: subs.map((s) => ({ ...s, porHa: porHa(s.total) })) };
    })
    .filter(Boolean);

  // Ingresos por categoría, con quintales
  const ingresosPorCategoria = categorias.filter((c) => c.tipo === 'ingreso').sort(orden)
    .map((c) => {
      const deCat = ingresos.filter((m) => m.categoriaId === c.id);
      if (!deCat.length) return null;
      const qq = sumar(deCat, 'quintales');
      return { id: c.id, nombre: c.nombre, total: importes(deCat), qq, kg: qq * KG_POR_QQ };
    })
    .filter(Boolean);

  const totalIngresos = importes(ingresos);
  const qqIngresos = sumar(ingresos, 'quintales');
  const margen = { ARS: totalIngresos.ARS - totalGastos.ARS, USD: totalIngresos.USD - totalGastos.USD };

  return {
    hectareas: ha,
    cantidad: movs.length,
    gastos: { total: totalGastos, porHa: porHa(totalGastos), porCategoria: gastosPorCategoria },
    ingresos: {
      total: totalIngresos,
      porHa: porHa(totalIngresos),
      porCategoria: ingresosPorCategoria,
      qq: qqIngresos,
      kg: qqIngresos * KG_POR_QQ,
      precioQq: {
        ARS: qqIngresos ? totalIngresos.ARS / qqIngresos : 0,
        USD: qqIngresos ? totalIngresos.USD / qqIngresos : 0,
      },
    },
    margen: { total: margen, porHa: porHa(margen) },
    rindeQqHa: ha ? qqIngresos / ha : 0,
  };
}

/**
 * Cuentas entre hermanos sobre TODOS los movimientos (incluidos los sin campaña).
 * - Gastos: cada uno "pagó" lo propio + ⅓ de lo pagado por la Caja común; le corresponde ⅓ del total.
 * - Ingresos: si un hermano cobró a su nombre, retiene plata de todos (resta en su saldo).
 * - Saldo > 0: los demás le deben. Saldo < 0: debe.
 * `hermanos`: los que participan del reparto (los activos).
 */
export function cuentasEntreHermanos(movimientos, categorias, hermanos) {
  const tipoDe = Object.fromEntries(categorias.map((c) => [c.id, c.tipo]));
  const movs = movimientos.filter((m) => !m.borrado);
  const n = hermanos.length || 1;
  const resultado = {};

  for (const [mon, campo] of Object.entries(MONEDAS)) {
    const total = (tipo, filtro = () => true) =>
      movs.filter((m) => tipoDe[m.categoriaId] === tipo && filtro(m)).reduce((s, m) => s + (Number(m[campo]) || 0), 0);
    const esCaja = (m) => !m.pagoId || m.pagoId === PAGO_CAJA;

    const gastosTotal = total('gasto');
    const gastosCaja = total('gasto', esCaja);
    const ingresosTotal = total('ingreso');
    const ingresosCaja = total('ingreso', esCaja);

    const filas = hermanos.map((h) => {
      const pagoPropio = total('gasto', (m) => m.pagoId === h.id);
      const cobroPropio = total('ingreso', (m) => m.pagoId === h.id);
      const pago = pagoPropio + gastosCaja / n;
      const cobro = cobroPropio + ingresosCaja / n;
      const correspondeGasto = gastosTotal / n;
      const correspondeIngreso = ingresosTotal / n;
      const saldo = (pago - correspondeGasto) - (cobro - correspondeIngreso);
      return { id: h.id, nombre: h.nombre, pagoPropio, pago, correspondeGasto, cobroPropio, cobro, correspondeIngreso, saldo };
    });

    resultado[mon] = {
      gastosTotal, gastosCaja, ingresosTotal, ingresosCaja,
      filas,
      transferencias: sugerirTransferencias(filas, mon === 'ARS' ? 1 : 0.01),
    };
  }

  // Pagos a hermanos que ya no participan del reparto (inactivos): se informan aparte.
  const ids = new Set(hermanos.map((h) => h.id));
  resultado.sinReparto = movs.filter((m) => m.pagoId && m.pagoId !== PAGO_CAJA && !ids.has(m.pagoId)).length;
  return resultado;
}

// Quién le paga a quién, con la menor cantidad de transferencias (greedy). Ignora saldos menores a `tolerancia`.
export function sugerirTransferencias(filas, tolerancia = 1) {
  const deudores = filas.filter((f) => f.saldo < -tolerancia).map((f) => ({ ...f, resta: -f.saldo })).sort((a, b) => b.resta - a.resta);
  const acreedores = filas.filter((f) => f.saldo > tolerancia).map((f) => ({ ...f, resta: f.saldo })).sort((a, b) => b.resta - a.resta);
  const transferencias = [];
  let i = 0;
  let j = 0;
  while (i < deudores.length && j < acreedores.length) {
    const monto = Math.min(deudores[i].resta, acreedores[j].resta);
    if (monto > tolerancia) transferencias.push({ de: deudores[i].nombre, a: acreedores[j].nombre, monto });
    deudores[i].resta -= monto;
    acreedores[j].resta -= monto;
    if (deudores[i].resta <= tolerancia) i++;
    if (acreedores[j].resta <= tolerancia) j++;
  }
  return transferencias;
}
