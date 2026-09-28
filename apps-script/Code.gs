/**
 * Backend de la app "Campo" (Google Apps Script vinculado al Sheet).
 *
 * POST { clave, accion, datos }  →  { ok, error?, datos? }
 *   accion 'init' : crea pestañas/encabezados faltantes y carga el seed.
 *   accion 'push' : datos = { entidad: [registros] }. Upsert por id; gana el `modificado` más reciente.
 *   accion 'pull' : datos = { desde: syncTs }. Devuelve registros con syncTs > desde.
 *
 * Se copia a mano al editor de Apps Script (ver README.md en esta carpeta).
 */

// Al hacer pull se devuelve un syncTs un poco anterior al actual: así ninguna
// escritura concurrente queda afuera (el merge del cliente es idempotente).
var MARGEN_PULL_MS = 5000;

// Tipos: s = texto, n = número, b = booleano, d = fecha YYYY-MM-DD, t = timestamp ISO.
var COMUNES = { creado: 't', modificado: 't', cargadoPor: 's', borrado: 'b' };

var ENTIDADES = {
  hermanos: {
    hoja: 'Hermanos',
    campos: { id: 's', nombre: 's', activo: 'b' },
  },
  categorias: {
    hoja: 'Categorias',
    campos: { id: 's', nombre: 's', tipo: 's', orden: 'n', activa: 'b' },
  },
  subcategorias: {
    hoja: 'Subcategorias',
    campos: { id: 's', categoriaId: 's', nombre: 's', orden: 'n', activa: 'b' },
  },
  campanas: {
    hoja: 'Campanas',
    campos: {
      id: 's', nombre: 's', cultivo: 's', fechaInicio: 'd', fechaFin: 'd',
      hectareas: 'n', estado: 's', notas: 's',
    },
  },
  movimientos: {
    hoja: 'Movimientos',
    campos: {
      id: 's', fecha: 'd', categoriaId: 's', subcategoriaId: 's', campanaId: 's',
      descripcion: 's', proveedor: 's', moneda: 's', montoOriginal: 'n',
      tipoDolar: 's', tc: 'n', tcFecha: 'd', tcEstado: 's', montoARS: 'n', montoUSD: 'n',
      quintales: 'n', precioQq: 'n', pagoId: 's', comprobanteUrl: 's',
    },
    // Columnas de solo lectura para quien mire el Sheet: se completan al escribir y se ignoran al leer.
    legibles: { periodo: 's', categoriaNombre: 's', subcategoriaNombre: 's', campanaNombre: 's', pagoNombre: 's' },
    // Orden inicial de columnas (solo al crear la pestaña; después se mapea por nombre).
    primeras: [
      'id', 'fecha', 'periodo', 'categoriaNombre', 'subcategoriaNombre', 'descripcion',
      'moneda', 'montoOriginal', 'montoARS', 'montoUSD', 'campanaNombre', 'pagoNombre',
    ],
  },
};

// Orden de procesamiento: primero las referencias, al final los movimientos.
var ORDEN_ENTIDADES = ['hermanos', 'categorias', 'subcategorias', 'campanas', 'movimientos'];

// ---------------------------------------------------------------- Entrada

function doPost(e) {
  try {
    var pedido = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var claveOk = PropertiesService.getScriptProperties().getProperty('CLAVE');
    if (!claveOk) return responder({ ok: false, error: 'Falta configurar la Script Property CLAVE.' });
    if (pedido.clave !== claveOk) return responder({ ok: false, error: 'Clave incorrecta', codigo: 'CLAVE' });

    var acciones = { init: accionInit, push: accionPush, pull: accionPull };
    var accion = acciones[pedido.accion];
    if (!accion) return responder({ ok: false, error: 'Acción desconocida: ' + pedido.accion });

    return responder({ ok: true, datos: conLock(function () { return accion(pedido.datos || {}); }) });
  } catch (err) {
    return responder({ ok: false, error: String((err && err.message) || err) });
  }
}

// GET: solo para verificar que el despliegue responde (no devuelve datos).
function doGet() {
  return responder({ ok: true, datos: { app: 'campo' } });
}

// Para ejecutar a mano desde el editor la primera vez (pide los permisos y crea las pestañas).
function inicializar() {
  conLock(accionInit);
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function conLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- Acciones

function accionInit() {
  var creadas = asegurarHojas();
  return { creadas: creadas, syncTs: Date.now() };
}

function accionPush(datos) {
  asegurarHojas();
  var ahora = Date.now();
  var aceptados = {};
  var rechazados = {};
  var nombres = null;

  ORDEN_ENTIDADES.forEach(function (entidad) {
    var registros = datos[entidad];
    if (!registros || !registros.length) return;
    if (entidad === 'movimientos') nombres = leerNombres();
    var r = upsert(entidad, registros, ahora, nombres);
    aceptados[entidad] = r.aceptados;
    if (r.rechazados.length) rechazados[entidad] = r.rechazados;
  });

  return { aceptados: aceptados, rechazados: rechazados, syncTs: ahora };
}

function accionPull(datos) {
  asegurarHojas();
  var desde = Number(datos.desde) || 0;
  var ahora = Date.now();
  var entidades = {};
  ORDEN_ENTIDADES.forEach(function (entidad) {
    var t = abrirTabla(entidad);
    var lista = [];
    t.filas.forEach(function (fila) {
      if ((Number(fila[t.col.syncTs]) || 0) > desde) lista.push(filaAObjeto(entidad, t.col, fila));
    });
    entidades[entidad] = lista;
  });
  return { entidades: entidades, syncTs: ahora - MARGEN_PULL_MS };
}

// ---------------------------------------------------------------- Hojas

function definicionColumnas(entidad) {
  var def = ENTIDADES[entidad];
  var tipos = {};
  Object.keys(def.campos).forEach(function (k) { tipos[k] = def.campos[k]; });
  Object.keys(COMUNES).forEach(function (k) { tipos[k] = COMUNES[k]; });
  Object.keys(def.legibles || {}).forEach(function (k) { tipos[k] = def.legibles[k]; });
  tipos.syncTs = 'n';
  return tipos;
}

// Crea las pestañas que falten (con encabezados y seed) y agrega columnas faltantes.
function asegurarHojas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var creadas = [];
  ORDEN_ENTIDADES.forEach(function (entidad) {
    var def = ENTIDADES[entidad];
    var tipos = definicionColumnas(entidad);
    var sheet = ss.getSheetByName(def.hoja);

    if (!sheet) {
      sheet = ss.insertSheet(def.hoja);
      var primeras = def.primeras || [];
      var encabezados = primeras.concat(Object.keys(tipos).filter(function (k) { return primeras.indexOf(k) < 0; }));
      sheet.getRange(1, 1, 1, encabezados.length).setValues([encabezados]).setFontWeight('bold');
      sheet.setFrozenRows(1);
      creadas.push(def.hoja);
      if (SEED[entidad]) {
        upsert(entidad, SEED[entidad], Date.now(), null);
      }
      return;
    }

    // Pestaña existente: agrega al final las columnas que falten.
    var actuales = encabezadosDe(sheet);
    var faltantes = Object.keys(tipos).filter(function (k) { return actuales.indexOf(k) < 0; });
    if (faltantes.length) {
      if (sheet.getMaxColumns() < actuales.length + faltantes.length) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), actuales.length + faltantes.length - sheet.getMaxColumns());
      }
      sheet.getRange(1, actuales.length + 1, 1, faltantes.length).setValues([faltantes]).setFontWeight('bold');
    }
  });
  return creadas;
}

function encabezadosDe(sheet) {
  var n = sheet.getLastColumn();
  if (n < 1) return [];
  return sheet.getRange(1, 1, 1, n).getValues()[0].map(function (h) { return String(h).trim(); });
}

// Lee una pestaña completa: encabezados, mapa nombre→índice y filas de datos.
function abrirTabla(entidad) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTIDADES[entidad].hoja);
  var encabezados = encabezadosDe(sheet);
  var col = {};
  encabezados.forEach(function (h, i) { if (h && col[h] === undefined) col[h] = i; });
  var ultima = sheet.getLastRow();
  var filas = ultima < 2 ? [] : sheet.getRange(2, 1, ultima - 1, encabezados.length).getValues();
  return { sheet: sheet, encabezados: encabezados, col: col, filas: filas };
}

// ---------------------------------------------------------------- Upsert

function upsert(entidad, registros, ahora, nombres) {
  var t = abrirTabla(entidad);
  var tipos = definicionColumnas(entidad);
  var indice = {};
  t.filas.forEach(function (fila, i) { indice[String(fila[t.col.id])] = i; });

  var aceptados = [];
  var rechazados = [];
  var nuevas = [];
  var hayCambios = false;

  registros.forEach(function (reg) {
    if (!reg || !reg.id) return;
    var i = indice[reg.id];
    if (i !== undefined) {
      var modActual = aTexto(t.filas[i][t.col.modificado], 't');
      if (String(reg.modificado) < modActual) {
        // El Sheet tiene una versión más nueva: se devuelve para que el cliente la tome.
        rechazados.push(filaAObjeto(entidad, t.col, t.filas[i]));
        return;
      }
      if (String(reg.modificado) !== modActual) {
        t.filas[i] = objetoAFila(entidad, reg, t.filas[i], t, tipos, ahora, nombres);
        hayCambios = true;
      }
    } else {
      var vacia = t.encabezados.map(function () { return ''; });
      var fila = objetoAFila(entidad, reg, vacia, t, tipos, ahora, nombres);
      indice[reg.id] = t.filas.length + nuevas.length;
      nuevas.push(fila);
    }
    aceptados.push(reg.id);
  });

  var formatos = t.encabezados.map(function (h) { return formatoColumna(tipos[h]); });
  var ancho = t.encabezados.length;

  if (hayCambios) {
    var rango = t.sheet.getRange(2, 1, t.filas.length, ancho);
    rango.setNumberFormats(t.filas.map(function () { return formatos; }));
    rango.setValues(t.filas);
  }
  if (nuevas.length) {
    var desde = t.filas.length + 2;
    var necesarias = desde + nuevas.length - 1 - t.sheet.getMaxRows();
    if (necesarias > 0) t.sheet.insertRowsAfter(t.sheet.getMaxRows(), necesarias);
    var rangoNuevas = t.sheet.getRange(desde, 1, nuevas.length, ancho);
    rangoNuevas.setNumberFormats(nuevas.map(function () { return formatos; }));
    rangoNuevas.setValues(nuevas);
  }
  return { aceptados: aceptados, rechazados: rechazados };
}

// Texto plano para ids, fechas y timestamps (evita que Sheets los convierta).
function formatoColumna(tipo) {
  return tipo === 's' || tipo === 'd' || tipo === 't' ? '@' : 'General';
}

function objetoAFila(entidad, reg, filaBase, t, tipos, ahora, nombres) {
  var fila = filaBase.slice();
  var def = ENTIDADES[entidad];
  var modelo = Object.keys(def.campos).concat(Object.keys(COMUNES));
  modelo.forEach(function (k) {
    if (t.col[k] !== undefined) fila[t.col[k]] = aCelda(reg[k], tipos[k]);
  });
  if (t.col.syncTs !== undefined) fila[t.col.syncTs] = ahora;

  if (entidad === 'movimientos') {
    var legibles = calcularLegibles(reg, nombres || leerNombres());
    Object.keys(legibles).forEach(function (k) {
      if (t.col[k] !== undefined) fila[t.col[k]] = legibles[k];
    });
  }
  return fila;
}

// Registro para el cliente: solo campos del modelo (sin legibles ni syncTs).
function filaAObjeto(entidad, col, fila) {
  var def = ENTIDADES[entidad];
  var obj = {};
  var tiposModelo = {};
  Object.keys(def.campos).forEach(function (k) { tiposModelo[k] = def.campos[k]; });
  Object.keys(COMUNES).forEach(function (k) { tiposModelo[k] = COMUNES[k]; });
  Object.keys(tiposModelo).forEach(function (k) {
    obj[k] = col[k] === undefined ? desdeCelda('', tiposModelo[k]) : desdeCelda(fila[col[k]], tiposModelo[k]);
  });
  return obj;
}

function aCelda(valor, tipo) {
  if (tipo === 'b') return valor === true || valor === 'true';
  if (tipo === 'n') return valor === null || valor === undefined || valor === '' || isNaN(Number(valor)) ? '' : Number(valor);
  return valor === null || valor === undefined ? '' : String(valor);
}

function desdeCelda(valor, tipo) {
  if (tipo === 'b') return valor === true || String(valor).toUpperCase() === 'TRUE';
  if (tipo === 'n') return valor === '' || valor === null || isNaN(Number(valor)) ? null : Number(valor);
  return aTexto(valor, tipo);
}

// Normaliza texto; si alguien editó a mano y Sheets lo convirtió en fecha, lo vuelve a texto.
function aTexto(valor, tipo) {
  if (valor === null || valor === undefined) return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    if (tipo === 'd') return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return valor.toISOString();
  }
  return String(valor);
}

// ---------------------------------------------------------------- Columnas legibles

function leerNombres() {
  var mapa = function (entidad) {
    var t = abrirTabla(entidad);
    var m = {};
    t.filas.forEach(function (f) { m[String(f[t.col.id])] = String(f[t.col.nombre]); });
    return m;
  };
  return {
    hermanos: mapa('hermanos'),
    categorias: mapa('categorias'),
    subcategorias: mapa('subcategorias'),
    campanas: mapa('campanas'),
  };
}

function calcularLegibles(reg, nombres) {
  var fecha = String(reg.fecha || '');
  return {
    periodo: fecha.length >= 7 ? fecha.slice(0, 4) + fecha.slice(5, 7) : '',
    categoriaNombre: nombres.categorias[reg.categoriaId] || '',
    subcategoriaNombre: nombres.subcategorias[reg.subcategoriaId] || '',
    campanaNombre: reg.campanaId ? (nombres.campanas[reg.campanaId] || '') : 'Sin campaña',
    pagoNombre: reg.pagoId === 'CAJA' || !reg.pagoId ? 'Caja común' : (nombres.hermanos[reg.pagoId] || ''),
  };
}

// ---------------------------------------------------------------- Seed
// Mismos ids que js/seed.js de la app: si cambia uno, cambiar el otro.

var SEED = (function () {
  var sid = function (n) { return '00000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); };
  var base = function () {
    return { creado: '2026-01-01T00:00:00.000Z', modificado: '2026-01-01T00:00:00.000Z', cargadoPor: 'sistema', borrado: false };
  };
  var conBase = function (obj) {
    var b = base();
    Object.keys(obj).forEach(function (k) { b[k] = obj[k]; });
    return b;
  };

  var hermanos = [[1, 'Matias'], [2, 'Martin'], [3, 'Manuel']].map(function (h) {
    return conBase({ id: sid(h[0]), nombre: h[1], activo: true });
  });

  var arbol = [
    [101, 'Alquiler', 'gasto', []],
    [102, 'Insumos', 'gasto', [[201, 'Semilla'], [202, 'Herbicidas'], [203, 'Fertilizante'], [204, 'Otros']]],
    [103, 'Servicios', 'gasto', [[205, 'Siembra'], [206, 'Pulverización'], [207, 'Cosecha'], [208, 'Flete']]],
    [104, 'Seguro', 'gasto', []],
    [105, 'Honorarios ingeniero', 'gasto', []],
    [106, 'Impuestos', 'gasto', [[209, 'Monotributo'], [210, 'Contrato'], [211, 'Otros']]],
    [107, 'Obras / mant. campo', 'gasto', []],
    [108, 'Otros', 'gasto', []],
    [151, 'Venta de grano', 'ingreso', []],
    [152, 'Indemnización seguro', 'ingreso', []],
    [153, 'Otros', 'ingreso', []],
  ];
  var categorias = [];
  var subcategorias = [];
  var orden = { gasto: 0, ingreso: 0 };
  arbol.forEach(function (c) {
    orden[c[2]] += 1;
    categorias.push(conBase({ id: sid(c[0]), nombre: c[1], tipo: c[2], orden: orden[c[2]], activa: true }));
    c[3].forEach(function (s, i) {
      subcategorias.push(conBase({ id: sid(s[0]), categoriaId: sid(c[0]), nombre: s[1], orden: i + 1, activa: true }));
    });
  });

  return { hermanos: hermanos, categorias: categorias, subcategorias: subcategorias };
})();
