// Formato es-AR para moneda y fechas.

const fmtARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
const fmtUSD = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const fmtNum = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

// $ 1.234.567,89
export function formatoARS(n) {
  return fmtARS.format(n || 0);
}

// US$ 1.234,56
export function formatoUSD(n) {
  return fmtUSD.format(n || 0);
}

export function formatoNumero(n) {
  return fmtNum.format(n || 0);
}

// 'YYYY-MM-DD' → 'dd/mm/aaaa' (sin pasar por Date para evitar corrimientos de zona horaria)
export function formatoFecha(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

// Fecha local de hoy como 'YYYY-MM-DD'.
export function hoyISO() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Convierte texto ingresado ("1.234,56" o "1234.56") a número.
export function parsearMonto(texto) {
  if (typeof texto === 'number') return texto;
  let t = String(texto ?? '').trim().replace(/\s|\$|US/g, '');
  if (!t) return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return Number(t);
}
