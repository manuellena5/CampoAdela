// Excel (.xlsx) mínimo: generar un libro con estilos, tabla y listas desplegables, y leer celdas.
//
// Generación — libro = { hojas: [hoja] }, hoja = {
//   nombre, oculta?, anchos?: [número por columna], estilosColumna?: { índice: estilo }, congelarFila?: true,
//   filas: [[celda]], celda = null | string | number | { v, e?: estilo, fecha?: true, ancho?: n (si está combinada) },
//   combinadas?: ['A1:E1'], tabla?: { nombre, filas } (encabezado en la fila 1),
//   validaciones?: [{ rango: 'B2:B1000', lista: ['A','B'] | 'Hoja!$A$2:$A$9', estricta?: false }] }
// Estilos: 'titulo', 'subtitulo', 'negrita', 'enc' (encabezado de tabla), 'texto' (ajustado con borde),
// 'parrafo' (ajustado sin borde), 'fecha', 'numero'.

import { crearZip, leerZip } from './zip.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const ESTILOS = { normal: 0, negrita: 1, fecha: 2, numero: 3, titulo: 4, texto: 5, subtitulo: 6, enc: 7, parrafo: 8 };
const AJUSTADOS = new Set(['texto', 'enc', 'parrafo']);

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function letraColumna(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// 'YYYY-MM-DD' → número de serie de Excel
function serialFecha(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

// Número de serie de Excel → 'YYYY-MM-DD'
export function fechaDeSerial(n) {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

// Los textos van a sharedStrings (como los guarda Excel): evita que Excel ofrezca "reparar" la tabla.
function celdaXML(celda, ref, compartida) {
  if (celda === null || celda === undefined || celda === '') return '';
  const obj = typeof celda === 'object' ? celda : { v: celda };
  let { v } = obj;
  const estilo = obj.fecha ? 'fecha' : obj.e;
  const s = estilo ? ` s="${ESTILOS[estilo]}"` : '';
  if (obj.fecha && typeof v === 'string') v = serialFecha(v);
  if (typeof v === 'number') return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}"${s} t="s"><v>${compartida(String(v))}</v></c>`;
}

// Alto estimado para filas con texto ajustado (Excel no lo recalcula al abrir).
function altoFila(fila, anchos) {
  let lineas = 1;
  fila.forEach((celda, i) => {
    if (!celda || typeof celda !== 'object' || !AJUSTADOS.has(celda.e)) return;
    // `celda.ancho`: ancho total si la celda está combinada con las siguientes.
    const ancho = (celda.ancho || anchos?.[i] || 10) * 1.1;
    const l = String(celda.v).split('\n').reduce((s, parte) => s + Math.max(1, Math.ceil(parte.length / ancho)), 0);
    lineas = Math.max(lineas, l);
  });
  return lineas > 1 ? ` ht="${lineas * 15}" customHeight="1"` : '';
}

function hojaXML(hoja, indice, conTabla, compartida) {
  const vista = `<sheetViews><sheetView workbookViewId="0"${indice === 0 ? ' tabSelected="1"' : ''}>${
    hoja.congelarFila ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews>`;
  // Ancho y estilo por columna (el estilo lo heredan las celdas nuevas que cargue el usuario).
  const cols = hoja.anchos?.length
    ? `<cols>${hoja.anchos.map((w, i) => {
      const estilo = hoja.estilosColumna?.[i];
      return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${estilo ? ` style="${ESTILOS[estilo]}"` : ''}/>`;
    }).join('')}</cols>` : '';
  const filas = hoja.filas.map((fila, r) => {
    const celdas = fila.map((c, i) => celdaXML(c, `${letraColumna(i)}${r + 1}`, compartida)).join('');
    return `<row r="${r + 1}"${altoFila(fila, hoja.anchos)}>${celdas}</row>`;
  }).join('');
  const combinadas = hoja.combinadas?.length
    ? `<mergeCells count="${hoja.combinadas.length}">${hoja.combinadas.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  const validaciones = hoja.validaciones?.length
    ? `<dataValidations count="${hoja.validaciones.length}">${hoja.validaciones.map((v) => {
      const formula = Array.isArray(v.lista) ? `"${v.lista.join(',')}"` : v.lista;
      const estricta = v.estricta !== false;
      return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="${estricta ? 1 : 0}"`
        + `${estricta ? ' errorTitle="Valor no válido" error="Elegí un valor de la lista."' : ''} sqref="${v.rango}">`
        + `<formula1>${xml(formula)}</formula1></dataValidation>`;
    }).join('')}</dataValidations>` : '';
  const tabla = conTabla ? '<tableParts count="1"><tablePart r:id="rId1"/></tableParts>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}" xmlns:r="${NS_R}">${vista}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${filas}</sheetData>${combinadas}${validaciones}${tabla}</worksheet>`;
}

function tablaXML(hoja, id) {
  const { nombre, filas } = hoja.tabla;
  const encabezados = hoja.filas[0];
  const ref = `A1:${letraColumna(encabezados.length - 1)}${Math.max(filas, 2)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="${NS}" id="${id}" name="${nombre}" displayName="${nombre}" ref="${ref}" totalsRowShown="0"><autoFilter ref="${ref}"/><tableColumns count="${encabezados.length}">${
  encabezados.map((h, i) => `<tableColumn id="${i + 1}" name="${xml(typeof h === 'object' ? h.v : h)}"/>`).join('')
}</tableColumns><tableStyleInfo name="TableStyleMedium7" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
}

const ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="16"/><color rgb="FF2F6B3A"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="12"/><color rgb="FF2F6B3A"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3EFE4"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFC8C8BE"/></left><right style="thin"><color rgb="FFC8C8BE"/></right><top style="thin"><color rgb="FFC8C8BE"/></top><bottom style="thin"><color rgb="FFC8C8BE"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Genera el .xlsx y lo devuelve como Blob. */
export function generarXlsx(libro) {
  const hojas = libro.hojas;
  const archivos = [];
  const tipos = [];
  let nTabla = 0;
  const textos = new Map();
  const compartida = (s) => {
    if (!textos.has(s)) textos.set(s, textos.size);
    return textos.get(s);
  };

  hojas.forEach((hoja, i) => {
    const conTabla = Boolean(hoja.tabla);
    archivos.push({ nombre: `xl/worksheets/sheet${i + 1}.xml`, contenido: hojaXML(hoja, i, conTabla, compartida) });
    tipos.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    if (conTabla) {
      nTabla++;
      archivos.push({ nombre: `xl/tables/table${nTabla}.xml`, contenido: tablaXML(hoja, nTabla) });
      archivos.push({
        nombre: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/table" Target="../tables/table${nTabla}.xml"/></Relationships>`,
      });
      tipos.push(`<Override PartName="/xl/tables/table${nTabla}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`);
    }
  });

  archivos.unshift(
    {
      nombre: '[Content_Types].xml',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${tipos.join('')}</Types>`,
    },
    {
      nombre: '_rels/.rels',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      nombre: 'xl/workbook.xml',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="${NS_R}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${
  hojas.map((h, i) => `<sheet name="${xml(h.nombre)}" sheetId="${i + 1}"${h.oculta ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')
}</sheets></workbook>`,
    },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
  hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
}<Relationship Id="rId${hojas.length + 1}" Type="${NS_R}/styles" Target="styles.xml"/><Relationship Id="rId${hojas.length + 2}" Type="${NS_R}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    },
    { nombre: 'xl/styles.xml', contenido: ESTILOS_XML },
    {
      nombre: 'xl/sharedStrings.xml',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="${NS}" count="${textos.size}" uniqueCount="${textos.size}">${
  [...textos.keys()].map((s) => `<si><t xml:space="preserve">${xml(s)}</t></si>`).join('')
}</sst>`,
    },
  );

  return crearZip(archivos, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// ---------------------------------------------------------------- Lectura

const porNombreLocal = (nodo, nombre) => [...nodo.getElementsByTagNameNS('*', nombre)];

function columnaDeRef(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Lee un .xlsx (ArrayBuffer). Devuelve [{ nombre, filas }] con las celdas como string o number.
 * Las fechas llegan como número de serie (usar fechaDeSerial).
 */
export async function leerXlsx(buffer) {
  const zip = await leerZip(buffer);
  const leer = async (ruta) => (zip.has(ruta) ? zip.get(ruta)() : null);
  const parsear = (texto) => new DOMParser().parseFromString(texto, 'application/xml');

  const libroXml = await leer('xl/workbook.xml');
  if (!libroXml) throw new Error('El archivo no es un Excel (.xlsx) válido.');
  const rels = parsear(await leer('xl/_rels/workbook.xml.rels'));
  const destinos = Object.fromEntries(porNombreLocal(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));

  const compartidasXml = await leer('xl/sharedStrings.xml');
  const compartidas = compartidasXml
    ? porNombreLocal(parsear(compartidasXml), 'si').map((si) => porNombreLocal(si, 't').map((t) => t.textContent).join(''))
    : [];

  const hojas = [];
  for (const hoja of porNombreLocal(parsear(libroXml), 'sheet')) {
    const rid = [...hoja.attributes].find((a) => a.localName === 'id' && a.namespaceURI?.includes('relationships'))?.value;
    let destino = destinos[rid] || '';
    destino = destino.startsWith('/') ? destino.slice(1) : `xl/${destino}`;
    const texto = await leer(destino);
    if (!texto) continue;

    const filas = [];
    for (const fila of porNombreLocal(parsear(texto), 'row')) {
      const r = Number(fila.getAttribute('r')) - 1;
      const valores = [];
      porNombreLocal(fila, 'c').forEach((c, i) => {
        const ref = c.getAttribute('r');
        const col = ref ? columnaDeRef(ref) : i;
        const tipo = c.getAttribute('t');
        const v = porNombreLocal(c, 'v')[0]?.textContent;
        let valor = '';
        if (tipo === 's') valor = compartidas[Number(v)] ?? '';
        else if (tipo === 'inlineStr') valor = porNombreLocal(c, 't').map((t) => t.textContent).join('');
        else if (tipo === 'str') valor = v ?? '';
        else if (tipo === 'b') valor = v === '1' ? 'VERDADERO' : 'FALSO';
        else if (tipo === 'e') valor = '';
        else if (v !== undefined && v !== '') valor = Number(v);
        valores[col] = valor;
      });
      filas[r] = Array.from(valores, (x) => x ?? '');
    }
    hojas.push({ nombre: hoja.getAttribute('name'), filas: Array.from(filas, (f) => f || []) });
  }
  return hojas;
}
