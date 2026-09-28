// Reglas del dominio compartidas entre pantallas.

// Valor de `pagoId` para lo pagado con la caja común.
export const PAGO_CAJA = 'CAJA';

// 'YYYY-MM-DD' → 'AAAAMM'
export function periodoDe(fecha) {
  return fecha ? fecha.slice(0, 4) + fecha.slice(5, 7) : '';
}

// Redondeo a 2 decimales para montos guardados.
export function redondear(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Calcula montoARS y montoUSD con el TC del movimiento.
export function calcularMontos(moneda, montoOriginal, tc) {
  const monto = Number(montoOriginal) || 0;
  const cambio = Number(tc) || 0;
  if (moneda === 'USD') {
    return { montoUSD: redondear(monto), montoARS: redondear(monto * cambio) };
  }
  return { montoARS: redondear(monto), montoUSD: cambio ? redondear(monto / cambio) : 0 };
}

// Campaña cuya fecha de inicio/fin contiene `fecha`. Si hay varias superpuestas,
// la más reciente (mayor fecha de inicio). Sin fecha de fin = abierta.
export function campanaParaFecha(campanas, fecha) {
  if (!fecha) return null;
  const candidatas = campanas.filter((c) => c.fechaInicio && c.fechaInicio <= fecha
    && (!c.fechaFin || fecha <= c.fechaFin));
  candidatas.sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio));
  return candidatas[0] || null;
}

// Completa campos derivados que no viajan al Sheet (se calculan localmente).
export function normalizarMovimiento(m) {
  return { ...m, periodo: periodoDe(m.fecha) };
}
