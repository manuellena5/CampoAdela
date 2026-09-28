// Importación de movimientos desde la plantilla Excel (.xlsx) o un CSV.
// Se ignoran las filas de ejemplo (Descripción que empieza con "EJEMPLO") y las que empiezan con '#'.

import { listar, crear } from './db.js';
import * as ajustes from './ajustes.js';
import { obtenerCotizacion } from './dolar.js';
import { PAGO_CAJA, calcularMontos, periodoDe, etiquetaCategoria } from './dominio.js';
import { parsearCSV } from './lib/csv.js';
import { generarXlsx, leerXlsx, fechaDeSerial } from './lib/xlsx.js';
import { construirPlantilla, HOJA_DATOS, MARCA_EJEMPLO } from './plantilla.js';
import { descargar } from './lib/dom.js';
import { parsearMonto, hoyISO } from './lib/formato.js';

// Títulos de columna para los mensajes de error.
const TITULOS = { fecha: 'Fecha', categoria: 'Categoría', monto: 'Monto' };

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
  const cat = await cargarCatalogos();
  cat.campanas.sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || ''));
  descargar('plantilla-movimientos.xlsx', generarXlsx(construirPlantilla(cat, hoyISO())));
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

const esEncabezado = (fila) => fila.some((c) => ALIAS[norm(c)] === 'fecha') && fila.some((c) => ALIAS[norm(c)] === 'monto');

// Celda (texto o número de Excel) → texto. Las fechas de Excel son números de serie.
function aTexto(valor, clave) {
  if (typeof valor === 'number') {
    if (clave === 'fecha') return fechaDeSerial(valor);
    return String(Math.round(valor * 1e6) / 1e6).replace('.', ','); // coma decimal, como lo espera parsearMonto
  }
  return String(valor ?? '').trim();
}

// Matriz de celdas desde el archivo: .xlsx (pestaña "Movimientos" o la primera con encabezados) o CSV.
async function matrizDeArchivo(archivo) {
  const buffer = await archivo.arrayBuffer();
  const firma = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  const esZip = firma[0] === 0x50 && firma[1] === 0x4b; // "PK"
  if (!esZip) {
    if (/\.xls$/i.test(archivo.name)) throw new Error('El formato .xls (Excel viejo) no se puede leer. Guardalo como .xlsx.');
    return parsearCSV(new TextDecoder().decode(buffer));
  }
  const hojas = await leerXlsx(buffer);
  const conEncabezados = hojas.filter((h) => h.filas.slice(0, 10).some(esEncabezado));
  const hoja = conEncabezados.find((h) => norm(h.nombre) === norm(HOJA_DATOS)) || conEncabezados[0];
  if (!hoja) throw new Error(`No encontré la pestaña "${HOJA_DATOS}" con los encabezados (Fecha, Monto…). Usá la plantilla.`);
  return hoja.filas;
}

/**
 * Lee el archivo (File) y devuelve { filas, error }.
 * Cada fila: { nro, crudo, valores, ignorar, ejemplo? } con `valores` ya resueltos a ids donde se pudo.
 */
export async function leerArchivo(archivo, cat) {
  let matriz;
  try {
    matriz = await matrizDeArchivo(archivo);
  } catch (err) {
    return { error: err.message };
  }
  const iEnc = matriz.slice(0, 10).findIndex((f) => f && esEncabezado(f));
  if (iEnc < 0) return { error: 'No encontré la fila de encabezados (Fecha, Categoría, Monto…). Usá la plantilla descargada.' };

  const encabezados = matriz[iEnc].map((h) => ALIAS[norm(h)] || null);
  for (const requerida of ['fecha', 'categoria', 'monto']) {
    if (!encabezados.includes(requerida)) return { error: `Falta la columna "${TITULOS[requerida]}". Usá la plantilla descargada.` };
  }

  const filas = [];
  matriz.forEach((celdas, i) => {
    if (i <= iEnc || !celdas) return;
    const crudo = {};
    encabezados.forEach((clave, j) => { if (clave) crudo[clave] = aTexto(celdas[j], clave); });
    if (!Object.values(crudo).some(Boolean)) return; // fila vacía
    if (aTexto(celdas[0]).startsWith('#')) return; // fila de ayuda
    const ejemplo = norm(crudo.descripcion).startsWith(norm(MARCA_EJEMPLO));
    filas.push({ nro: i + 1, crudo, valores: resolver(crudo, cat), ignorar: ejemplo, ejemplo });
  });
  if (!filas.some((f) => !f.ejemplo)) return { error: 'El archivo no tiene movimientos cargados (solo encabezados o filas de ejemplo).' };

  // Posibles duplicados (misma fecha, categoría, moneda y monto que un movimiento ya cargado): ignorados por defecto.
  filas.forEach((f) => { if (esDuplicado(f.valores, cat)) f.ignorar = true; });
  return { filas };
}

// Categoría por nombre. Acepta "Otros (gasto)" / "Otros (ingreso)"; un nombre repetido sin aclarar no se resuelve.
function buscarCategoria(texto, categorias) {
  const t = norm(texto);
  if (!t) return null;
  const porEtiqueta = categorias.find((c) => norm(etiquetaCategoria(c, categorias)) === t);
  if (porEtiqueta) return porEtiqueta;
  const porNombre = categorias.filter((c) => norm(c.nombre) === t);
  return porNombre.length === 1 ? porNombre[0] : null;
}

function resolver(crudo, cat) {
  const porNombre = (lista, nombre) => lista.find((x) => norm(x.nombre) === norm(nombre));
  const categoria = buscarCategoria(crudo.categoria, cat.categorias);
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
  if (!v.categoriaId) {
    const repetida = crudo?.categoria && cat.categorias.filter((c) => norm(c.nombre) === norm(crudo.categoria)).length > 1;
    err('categoria', !crudo?.categoria ? 'Falta la categoría.'
      : repetida ? `"${crudo.categoria}" existe como gasto y como ingreso: elegí cuál.`
        : `No existe la categoría "${crudo.categoria}".`);
  }
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
