// Importación de movimientos desde una planilla CSV (plantilla descargable).
// Las filas que empiezan con '#' son de ayuda y se ignoran.

import { listar, crear } from './db.js';
import * as ajustes from './ajustes.js';
import { obtenerCotizacion } from './dolar.js';
import { PAGO_CAJA, calcularMontos, periodoDe } from './dominio.js';
import { parsearCSV, generarCSV, descargarCSV } from './lib/csv.js';
import { parsearMonto, hoyISO } from './lib/formato.js';

// Columnas de la plantilla (en orden) y la clave interna de cada una.
export const COLUMNAS = [
  ['Fecha', 'fecha'],
  ['Categoría', 'categoria'],
  ['Subcategoría', 'subcategoria'],
  ['Campaña', 'campana'],
  ['Descripción', 'descripcion'],
  ['Proveedor', 'proveedor'],
  ['Moneda', 'moneda'],
  ['Monto', 'monto'],
  ['Tipo de dólar', 'tipoDolar'],
  ['Cotización', 'cotizacion'],
  ['Quintales', 'quintales'],
  ['Precio por qq', 'precioQq'],
  ['Pagó', 'pago'],
];

// Encabezados aceptados (normalizados) → clave.
const ALIAS = {
  fecha: 'fecha', categoria: 'categoria', subcategoria: 'subcategoria', campana: 'campana',
  descripcion: 'descripcion', detalle: 'descripcion', proveedor: 'proveedor', moneda: 'moneda',
  monto: 'monto', importe: 'monto', 'monto original': 'monto', 'tipo de dolar': 'tipoDolar', 'tipo dolar': 'tipoDolar', dolar: 'tipoDolar',
  cotizacion: 'cotizacion', tc: 'cotizacion', quintales: 'quintales', qq: 'quintales',
  'precio por qq': 'precioQq', 'precio qq': 'precioQq', pago: 'pago', 'pagado por': 'pago',
};

export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

// Catálogos con los que se resuelven nombres → ids.
export async function cargarCatalogos() {
  const [categorias, subcategorias, campanas, hermanos, movimientos, tipoDolar] = await Promise.all([
    listar('categorias'), listar('subcategorias'), listar('campanas'), listar('hermanos'), listar('movimientos'),
    ajustes.obtener('tipoDolar'),
  ]);
  return { categorias, subcategorias, campanas, hermanos, movimientos, tipoDolarDefault: tipoDolar };
}

// ---- Plantilla

export async function descargarPlantilla() {
  const { categorias, subcategorias, campanas, hermanos } = await cargarCatalogos();
  const orden = (a, b) => a.orden - b.orden;
  const ayuda = [
    '# Filas que empiezan con # se ignoran. Borrá estas filas de ayuda o dejalas: no se importan.',
    '# Fecha: dd/mm/aaaa. Monto: número mayor a 0 (ej. 1657000 o 1.657.000,50).',
    '# Moneda: ARS o USD. Tipo de dólar: MEP u Oficial (vacío = el de Configuración).',
    '# Cotización: vacía = se busca la del día; si la completás se usa esa (queda como manual).',
    '# Campaña: vacía = Sin campaña. Pagó: vacío = Caja común.',
    ...['gasto', 'ingreso'].flatMap((tipo) => categorias.filter((c) => c.tipo === tipo && c.activa).sort(orden).map((c) => {
      const subs = subcategorias.filter((s) => s.categoriaId === c.id && s.activa).sort(orden).map((s) => s.nombre);
      return `# ${tipo === 'gasto' ? 'Gasto' : 'Ingreso'}: ${c.nombre}${subs.length ? ` → subcategorías: ${subs.join(', ')}` : ''}`;
    })),
    `# Campañas: ${campanas.map((c) => c.nombre).join(', ') || '(ninguna)'}`,
    `# Pagó: Caja común, ${hermanos.filter((h) => h.activo).map((h) => h.nombre).join(', ')}`,
  ];
  const csv = generarCSV(COLUMNAS.map(([t]) => t), ayuda.map((linea) => [linea]));
  descargarCSV('plantilla-movimientos.csv', csv);
}

// ---- Lectura

function fechaDesdeTexto(texto) {
  const t = String(texto ?? '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let a; let mes; let d;
  if (m) [, a, mes, d] = m;
  else if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) [, d, mes, a] = m;
  else return '';
  if (a.length === 2) a = `20${a}`;
  const iso = `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const fecha = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== iso ? '' : iso;
}

function moneda(texto) {
  const t = norm(texto).replace(/\s/g, '');
  if (!t || ['ars', '$', 'pesos', 'peso'].includes(t)) return 'ARS';
  if (['usd', 'us$', 'u$s', 'dolares', 'dolar', 'u$d'].includes(t)) return 'USD';
  return null;
}

function tipoDolar(texto, porDefecto) {
  const t = norm(texto);
  if (!t) return porDefecto;
  if (['mep', 'bolsa'].includes(t)) return 'MEP';
  if (t === 'oficial') return 'OFICIAL';
  return null;
}

/**
 * Lee el texto del archivo y devuelve { filas, error }.
 * Cada fila: { nro, crudo, valores, ignorar } con `valores` ya resueltos a ids donde se pudo.
 */
export function leerArchivo(texto, cat) {
  const matriz = parsearCSV(texto);
  if (!matriz.length) return { error: 'El archivo está vacío.' };

  const encabezados = matriz[0].map((h) => ALIAS[norm(h)] || null);
  for (const requerida of ['fecha', 'categoria', 'monto']) {
    if (!encabezados.includes(requerida)) {
      const titulo = COLUMNAS.find(([, k]) => k === requerida)[0];
      return { error: `Falta la columna "${titulo}". Usá la plantilla descargada (fila 1 = encabezados).` };
    }
  }

  const filas = [];
  matriz.slice(1).forEach((celdas, i) => {
    if ((celdas[0] || '').trim().startsWith('#')) return;
    const crudo = {};
    encabezados.forEach((clave, j) => { if (clave) crudo[clave] = (celdas[j] ?? '').trim(); });
    filas.push({ nro: i + 2, crudo, valores: resolver(crudo, cat), ignorar: false });
  });
  if (!filas.length) return { error: 'El archivo no tiene filas con datos.' };

  // Posibles duplicados (misma fecha, categoría, moneda y monto que un movimiento ya cargado): ignorados por defecto.
  filas.forEach((f) => { if (esDuplicado(f.valores, cat)) f.ignorar = true; });
  return { filas };
}

function resolver(crudo, cat) {
  const porNombre = (lista, nombre) => lista.find((x) => norm(x.nombre) === norm(nombre));
  const categoria = porNombre(cat.categorias, crudo.categoria);
  const subcategoria = categoria && crudo.subcategoria
    ? porNombre(cat.subcategorias.filter((s) => s.categoriaId === categoria.id), crudo.subcategoria) : null;
  const sinCampana = !crudo.campana || norm(crudo.campana) === 'sin campana';
  const campana = sinCampana ? null : porNombre(cat.campanas, crudo.campana);
  const esCaja = !crudo.pago || ['caja comun', 'caja', 'comun'].includes(norm(crudo.pago));
  const hermano = esCaja ? null : porNombre(cat.hermanos, crudo.pago);

  return {
    fecha: fechaDesdeTexto(crudo.fecha),
    categoriaId: categoria?.id || '',
    subcategoriaId: subcategoria?.id || '',
    campanaId: campana?.id || '',
    descripcion: crudo.descripcion || '',
    proveedor: crudo.proveedor || '',
    moneda: moneda(crudo.moneda) || '',
    monto: crudo.monto || '',
    tipoDolar: tipoDolar(crudo.tipoDolar, cat.tipoDolarDefault) || '',
    cotizacion: crudo.cotizacion || '',
    quintales: crudo.quintales || '',
    precioQq: crudo.precioQq || '',
    pagoId: esCaja ? PAGO_CAJA : hermano?.id || '',
  };
}

// ---- Validación

const numeroOpcional = (texto) => (String(texto ?? '').trim() === '' ? null : parsearMonto(texto));

/** Errores de una fila: [{ campo, mensaje }]. `crudo` sirve para explicar qué decía el archivo. */
export function validar(v, crudo, cat) {
  const errores = [];
  const err = (campo, mensaje) => errores.push({ campo, mensaje });

  if (!v.fecha) err('fecha', crudo?.fecha ? `Fecha inválida: "${crudo.fecha}" (usar dd/mm/aaaa).` : 'Falta la fecha.');
  else if (v.fecha > hoyISO()) err('fecha', 'La fecha es futura.');
  if (!v.categoriaId) err('categoria', crudo?.categoria ? `No existe la categoría "${crudo.categoria}".` : 'Falta la categoría.');
  // `crudo` es lo que decía el archivo; al corregir un campo en la revisión se borra y deja de validarse.
  if (crudo?.subcategoria && v.categoriaId && !v.subcategoriaId) {
    err('subcategoria', `La categoría no tiene la subcategoría "${crudo.subcategoria}".`);
  }
  if (!v.campanaId && crudo?.campana && norm(crudo.campana) !== 'sin campana') {
    err('campana', `No existe la campaña "${crudo.campana}". Creala en Campañas o elegí otra.`);
  }
  if (!v.moneda) err('moneda', `Moneda inválida: "${crudo?.moneda}" (ARS o USD).`);
  if (!(parsearMonto(v.monto) > 0)) err('monto', v.monto ? `Monto inválido: "${v.monto}".` : 'Falta el monto.');
  if (!v.tipoDolar) err('tipoDolar', `Tipo de dólar inválido: "${crudo?.tipoDolar}" (MEP u Oficial).`);
  const tc = numeroOpcional(v.cotizacion);
  if (tc !== null && !(tc > 0)) err('cotizacion', `Cotización inválida: "${v.cotizacion}".`);
  for (const campo of ['quintales', 'precioQq']) {
    const n = numeroOpcional(v[campo]);
    if (n !== null && !(n >= 0)) err(campo, `Número inválido: "${v[campo]}".`);
  }
  if (!v.pagoId) err('pago', `No existe el hermano "${crudo?.pago}".`);
  return errores;
}

export function esDuplicado(v, cat) {
  const monto = parsearMonto(v.monto);
  return cat.movimientos.some((m) => m.fecha === v.fecha && m.categoriaId === v.categoriaId
    && m.moneda === v.moneda && Math.abs(m.montoOriginal - monto) < 0.005);
}

// ---- Importación

/**
 * Crea los movimientos de las filas válidas y no ignoradas.
 * Si la cotización está vacía se busca (API / cache / última conocida).
 * Devuelve { importados, fallidos: [{ nro, mensaje }] }.
 */
export async function importar(filas, onProgreso) {
  let importados = 0;
  const fallidos = [];
  const aImportar = filas.filter((f) => !f.ignorar);
  for (const [i, f] of aImportar.entries()) {
    const v = f.valores;
    let tc = numeroOpcional(v.cotizacion);
    let tcFecha = v.fecha;
    let tcEstado = 'manual';
    if (tc === null) {
      const c = await obtenerCotizacion(v.tipoDolar, v.fecha);
      if (!c) { fallidos.push({ nro: f.nro, mensaje: 'No se pudo obtener la cotización (sin conexión). Completala en el archivo.' }); continue; }
      ({ tc, tcFecha, tcEstado } = c);
    }
    const montoOriginal = parsearMonto(v.monto);
    await crear('movimientos', {
      fecha: v.fecha,
      periodo: periodoDe(v.fecha),
      categoriaId: v.categoriaId,
      subcategoriaId: v.subcategoriaId,
      campanaId: v.campanaId,
      descripcion: v.descripcion.trim(),
      proveedor: v.proveedor.trim(),
      moneda: v.moneda,
      montoOriginal,
      tipoDolar: v.tipoDolar,
      tc,
      tcFecha,
      tcEstado,
      ...calcularMontos(v.moneda, montoOriginal, tc),
      quintales: numeroOpcional(v.quintales),
      precioQq: numeroOpcional(v.precioQq),
      pagoId: v.pagoId,
      comprobanteUrl: '',
    });
    importados++;
    onProgreso?.(i + 1, aImportar.length);
  }
  return { importados, fallidos };
}
