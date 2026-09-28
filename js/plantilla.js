// Contenido de la plantilla Excel de importación (pestañas "Instrucciones" y "Movimientos").
// Función pura: recibe los catálogos y devuelve la definición del libro para lib/xlsx.js.

import { letraColumna } from './lib/xlsx.js';
import { etiquetaCategoria } from './dominio.js';

export const HOJA_DATOS = 'Movimientos';
export const MARCA_EJEMPLO = 'EJEMPLO';
const FILAS_CON_LISTAS = 2000; // hasta qué fila llegan los desplegables

// [título, obligatoria, qué poner, valores posibles, ejemplo, ancho]
function columnas(cat) {
  const campanas = cat.campanas.map((c) => c.nombre);
  const hermanos = cat.hermanos.filter((h) => h.activo).map((h) => h.nombre);
  return [
    ['Fecha', 'Sí', 'Día del gasto o del ingreso.', 'Fecha dd/mm/aaaa. No puede ser futura.', '15/09/2025', 12],
    ['Descripción', 'No', 'Qué fue, en pocas palabras.', 'Texto libre. Si empieza con "EJEMPLO" la fila se ignora.', 'Semilla soja', 30],
    ['Categoría', 'Sí', 'Tipo de gasto o ingreso. Define si es gasto o ingreso.', 'Una de la lista desplegable (ver "Categorías y subcategorías" abajo). Si un nombre existe como gasto y como ingreso, se aclara entre paréntesis: "Otros (gasto)".', 'Insumos', 20],
    ['Subcategoría', 'No', 'Detalle dentro de la categoría.', 'Una de las subcategorías de ESA categoría (ver abajo). Vacía = sin subcategoría.', 'Semilla', 16],
    ['Campaña', 'No', 'A qué campaña corresponde.', `Vacía o "Sin campaña" = gasto general del campo. Campañas: ${campanas.join(', ') || '(ninguna cargada)'}.`, campanas[0] || 'Soja 25-26', 16],
    ['Proveedor', 'No', 'Contratista, agronomía, acopio, comprador…', 'Texto libre.', 'Agronomía El Trébol', 22],
    ['Moneda', 'No', 'Moneda en que está el monto.', 'ARS o USD. Vacía = ARS.', 'ARS', 9],
    ['Monto', 'Sí', 'Importe del movimiento, en la moneda de la columna anterior.', 'Número mayor a 0, sin signo. Ej.: 1657000 o 1.657.000,50.', '1589014,35', 15],
    ['Tipo de dólar', 'No', 'Cotización a usar para convertir.', 'MEP u Oficial. Vacía = la elegida en Configuración de la app.', 'MEP', 13],
    ['Cotización', 'No', 'Valor del dólar (venta) a usar.', 'Número. Vacía = la app busca la cotización de esa fecha. Si la completás, se usa esa.', '1326', 12],
    ['Quintales', 'No', 'Para ventas, alquiler o cosecha.', 'Número (1 qq = 100 kg).', '700', 11],
    ['Precio por qq', 'No', 'Precio pizarra por quintal.', 'Número.', '28,57', 13],
    ['Pagó', 'No', 'Quién puso la plata (o quién cobró, en ingresos).', `Caja común, ${hermanos.join(', ')}. Vacía = Caja común.`, 'Caja común', 13],
  ];
}

export function construirPlantilla(cat, hoy) {
  const cols = columnas(cat);
  const orden = (a, b) => a.orden - b.orden;
  const activas = (lista) => lista.filter((x) => x.activa !== false);
  const catsGasto = activas(cat.categorias).filter((c) => c.tipo === 'gasto').sort(orden);
  const catsIngreso = activas(cat.categorias).filter((c) => c.tipo === 'ingreso').sort(orden);
  const subsDe = (c) => activas(cat.subcategorias).filter((s) => s.categoriaId === c.id).sort(orden).map((s) => s.nombre);
  const hermanos = cat.hermanos.filter((h) => h.activo).map((h) => h.nombre);
  const campana = cat.campanas[0]?.nombre || '';

  // ---- Pestaña oculta con las listas de los desplegables
  const etiqueta = (c) => etiquetaCategoria(c, cat.categorias);
  const listas = {
    Categorías: [...catsGasto, ...catsIngreso].map(etiqueta),
    Subcategorías: [...new Set(activas(cat.subcategorias).map((s) => s.nombre))],
    Campañas: ['Sin campaña', ...cat.campanas.map((c) => c.nombre)],
    Pagó: ['Caja común', ...hermanos],
  };
  const titulosListas = Object.keys(listas);
  const largo = Math.max(...Object.values(listas).map((l) => l.length));
  const hojaListas = {
    nombre: 'Listas',
    oculta: true,
    filas: [titulosListas, ...Array.from({ length: largo }, (_, i) => titulosListas.map((t) => listas[t][i] ?? null))],
  };
  const rangoLista = (titulo) => {
    const col = letraColumna(titulosListas.indexOf(titulo));
    return `Listas!$${col}$2:$${col}$${Math.max(listas[titulo].length + 1, 2)}`;
  };

  // ---- Pestaña de datos (tabla de Excel)
  const encabezados = cols.map(([t]) => t);
  const col = (titulo) => letraColumna(encabezados.indexOf(titulo));
  const rango = (titulo) => `${col(titulo)}2:${col(titulo)}${FILAS_CON_LISTAS}`;
  const hermano = hermanos[0] || 'Caja común';
  const ejemplos = [
    [{ v: '2025-09-15', fecha: true }, `${MARCA_EJEMPLO} - Semilla soja`, 'Insumos', 'Semilla', campana, 'Agronomía', 'ARS', { v: 1589014.35, e: 'numero' }, 'MEP', null, null, null, 'Caja común'],
    [{ v: '2025-11-13', fecha: true }, `${MARCA_EJEMPLO} - Siembra 20 ha`, 'Servicios', 'Siembra', campana, 'Contratista', 'ARS', { v: 1657000, e: 'numero' }, 'Oficial', { v: 1430, e: 'numero' }, null, null, hermano],
    [{ v: '2026-04-15', fecha: true }, `${MARCA_EJEMPLO} - Venta de soja`, 'Venta de grano', null, campana, 'Acopio', 'USD', { v: 20000, e: 'numero' }, 'MEP', null, { v: 700, e: 'numero' }, { v: 28.57, e: 'numero' }, 'Caja común'],
  ];
  const hojaDatos = {
    nombre: HOJA_DATOS,
    congelarFila: true,
    anchos: cols.map((c) => c[5]),
    filas: [encabezados, ...ejemplos],
    tabla: { nombre: 'TablaMovimientos', filas: ejemplos.length + 1 },
    validaciones: [
      { rango: rango('Categoría'), lista: rangoLista('Categorías') },
      { rango: rango('Subcategoría'), lista: rangoLista('Subcategorías'), estricta: false },
      { rango: rango('Campaña'), lista: rangoLista('Campañas') },
      { rango: rango('Moneda'), lista: ['ARS', 'USD'] },
      { rango: rango('Tipo de dólar'), lista: ['MEP', 'Oficial'] },
      { rango: rango('Pagó'), lista: rangoLista('Pagó') },
    ],
  };
  // Formato de fecha y número en toda la columna (lo heredan las filas nuevas)
  hojaDatos.estilosColumna = Object.fromEntries([
    ['Fecha', 'fecha'], ['Monto', 'numero'], ['Cotización', 'numero'], ['Quintales', 'numero'], ['Precio por qq', 'numero'],
  ].map(([titulo, estilo]) => [encabezados.indexOf(titulo), estilo]));

  // ---- Pestaña de instrucciones
  const t = (v, e = 'texto') => ({ v, e });
  const filas = [];
  const combinadas = [];
  const titulo = (texto, estilo) => { filas.push([{ v: texto, e: estilo }]); };
  const anchosInstrucciones = [18, 14, 42, 52, 20];
  const anchoTotal = anchosInstrucciones.reduce((s, w) => s + w, 0);
  const parrafo = (texto) => {
    filas.push([{ v: texto, e: 'parrafo', ancho: anchoTotal }]);
    combinadas.push(`A${filas.length}:E${filas.length}`);
  };
  const vacia = () => filas.push([]);

  titulo('Importar movimientos a la app Campo', 'titulo');
  parrafo(`Plantilla generada el ${hoy.split('-').reverse().join('/')}.`);
  vacia();
  titulo('Cómo usar esta planilla', 'subtitulo');
  [
    `1. Andá a la pestaña "${HOJA_DATOS}" (abajo). Cargá un movimiento (gasto o ingreso) por fila, debajo de los encabezados: la tabla se agranda sola.`,
    '2. Las columnas Categoría, Campaña, Moneda, Tipo de dólar y Pagó tienen una lista desplegable: elegí el valor de la lista.',
    `3. Las 3 filas que dicen "${MARCA_EJEMPLO}" en Descripción son de muestra: borralas (si quedan, la app las ignora).`,
    '4. Guardá el archivo (puede quedar como .xlsx). No cambies los nombres de las columnas.',
    '5. En la app: Configuración → Importar movimientos → Elegir archivo.',
    '6. La app muestra las filas con errores: podés corregirlas ahí mismo o ignorarlas. Las filas iguales a un movimiento ya cargado (misma fecha, categoría y monto) se marcan como posibles duplicados y se ignoran.',
  ].forEach(parrafo);
  vacia();

  titulo('Columnas', 'subtitulo');
  filas.push(['Columna', '¿Obligatoria?', 'Qué poner', 'Valores posibles', 'Ejemplo'].map((x) => t(x, 'enc')));
  cols.forEach(([nombre, oblig, que, valores, ejemplo]) => filas.push([t(nombre, 'enc'), t(oblig), t(que), t(valores), t(ejemplo)]));
  vacia();

  titulo('Categorías y subcategorías', 'subtitulo');
  filas.push(['Tipo', 'Categoría', 'Subcategorías posibles'].map((x) => t(x, 'enc')));
  const filaCat = (tipo) => (c) => {
    filas.push([t(tipo), t(etiqueta(c)), t(subsDe(c).join(', ') || '(sin subcategorías)')]);
  };
  catsGasto.forEach(filaCat('Gasto'));
  catsIngreso.forEach(filaCat('Ingreso'));
  vacia();

  titulo('Campañas', 'subtitulo');
  filas.push(['Campaña', 'Desde', 'Hasta'].map((x) => t(x, 'enc')));
  if (cat.campanas.length) {
    cat.campanas.forEach((c) => filas.push([t(c.nombre), t(c.fechaInicio ? c.fechaInicio.split('-').reverse().join('/') : '—'),
      t(c.fechaFin ? c.fechaFin.split('-').reverse().join('/') : '—')]));
  } else {
    filas.push([t('(No hay campañas cargadas: creálas en la app antes de importar)')]);
  }
  vacia();

  titulo('Quién pagó', 'subtitulo');
  filas.push([t('Caja común', 'enc'), t('Lo pagado con la plata en común se reparte en partes iguales.')]);
  hermanos.forEach((h) => filas.push([t(h, 'enc'), t(`Lo pagó ${h} de su bolsillo (o lo cobró, si es un ingreso).`)]));

  const hojaInstrucciones = { nombre: 'Instrucciones', anchos: anchosInstrucciones, filas, combinadas };

  return { hojas: [hojaInstrucciones, hojaDatos, hojaListas] };
}
