// Ejecuta apps-script/Code.gs en Node con un Google Sheet simulado en memoria.
// Sirve para probar la sincronización sin desplegar el Apps Script.
//
// Uso: node tools/apps-script-local.mjs [puerto] [clave]   (por defecto 8090, "prueba")
//   POST /           → doPost (mismo protocolo que el Web App)
//   GET  /           → doGet
//   GET  /__hojas    → volcado de todas las pestañas (para inspeccionar)
//
// Para usarlo desde la app: APPS_SCRIPT_URL = 'http://localhost:8090/' en js/config.js (solo local).

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const PUERTO = Number(process.argv[2]) || 8090;
const CLAVE = process.argv[3] || 'prueba';

// ---------------------------------------------------------------- Sheet simulado

class Rango {
  constructor(hoja, fila, col, filas, cols) {
    Object.assign(this, { hoja, fila, col, filas, cols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.filas; r++) {
      const fila = this.hoja.datos[this.fila - 1 + r] || [];
      out.push(Array.from({ length: this.cols }, (_, c) => fila[this.col - 1 + c] ?? ''));
    }
    return out;
  }
  setValues(valores) {
    if (valores.length !== this.filas || valores.some((f) => f.length !== this.cols)) {
      throw new Error(`Dimensiones incorrectas: ${valores.length}x${valores[0]?.length} vs ${this.filas}x${this.cols}`);
    }
    if (this.fila - 1 + this.filas > this.hoja.maxFilas) throw new Error('Rango fuera de la hoja');
    valores.forEach((f, r) => {
      const idx = this.fila - 1 + r;
      this.hoja.datos[idx] = this.hoja.datos[idx] || [];
      f.forEach((v, c) => { this.hoja.datos[idx][this.col - 1 + c] = v; });
    });
    return this;
  }
  setNumberFormats() { return this; }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}

class Hoja {
  constructor(nombre) {
    this.nombre = nombre;
    this.datos = [];
    this.maxFilas = 1000;
    this.maxCols = 26;
  }
  getName() { return this.nombre; }
  getLastRow() {
    for (let i = this.datos.length - 1; i >= 0; i--) {
      if ((this.datos[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
    }
    return 0;
  }
  getLastColumn() {
    return this.datos.reduce((max, f) => {
      let u = 0;
      (f || []).forEach((v, i) => { if (v !== '' && v !== undefined) u = i + 1; });
      return Math.max(max, u);
    }, 0);
  }
  getMaxRows() { return this.maxFilas; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_, n) { this.maxFilas += n; }
  insertColumnsAfter(_, n) { this.maxCols += n; }
  getRange(fila, col, filas = 1, cols = 1) { return new Rango(this, fila, col, filas, cols); }
  setFrozenRows() {}
}

const hojas = new Map();
const libro = {
  getSheetByName: (n) => hojas.get(n) || null,
  insertSheet: (n) => { const h = new Hoja(n); hojas.set(n, h); return h; },
};

// Drive simulado: los archivos quedan en memoria (GET /__archivos los lista).
const archivos = [];
const carpeta = {
  getName: () => 'Comprobantes (simulado)',
  getUrl: () => 'http://localhost:8090/__carpeta',
  createFile: (blob) => {
    const id = `archivo-${archivos.length + 1}`;
    archivos.push({ id, nombre: blob.nombre, tipo: blob.tipo, bytes: blob.bytes.length });
    return { getId: () => id, getUrl: () => `http://localhost:8090/__archivo/${id}` };
  },
};

const PROPIEDADES = { CLAVE, CARPETA_COMPROBANTES: 'carpeta-simulada' };

const contexto = vm.createContext({
  SpreadsheetApp: { getActiveSpreadsheet: () => libro },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => PROPIEDADES[k] ?? null }) },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (texto) => ({ setMimeType() { return this; }, getContent: () => texto }),
  },
  DriveApp: { getFolderById: (id) => { if (id !== PROPIEDADES.CARPETA_COMPROBANTES) throw new Error('Carpeta inexistente'); return carpeta; } },
  Utilities: {
    formatDate: (d) => d.toISOString().slice(0, 10),
    base64Decode: (b64) => [...Buffer.from(b64, 'base64')],
    newBlob: (bytes, tipo, nombre) => ({ bytes, tipo, nombre }),
  },
  Logger: { log: console.log },
  Session: { getScriptTimeZone: () => 'America/Argentina/Buenos_Aires' },
  console,
});

const codigo = readFileSync(fileURLToPath(new URL('../apps-script/Code.gs', import.meta.url)), 'utf8');
vm.runInContext(codigo, contexto, { filename: 'Code.gs' });

// ---------------------------------------------------------------- HTTP

const CORS = { 'Access-Control-Allow-Origin': '*' };

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/__archivos') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' }).end(JSON.stringify(archivos));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/__hojas') {
    const volcado = Object.fromEntries([...hojas].map(([n, h]) => [n, h.datos]));
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' }).end(JSON.stringify(volcado, null, 1));
    return;
  }
  if (req.method === 'GET') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' }).end(contexto.doGet().getContent());
    return;
  }
  if (req.method !== 'POST') { res.writeHead(405, CORS).end(); return; }
  let cuerpo = '';
  req.on('data', (c) => { cuerpo += c; });
  req.on('end', () => {
    const salida = contexto.doPost({ postData: { contents: cuerpo } }).getContent();
    const pedido = (() => { try { return JSON.parse(cuerpo); } catch { return {}; } })();
    console.log(new Date().toISOString(), pedido.accion, salida.length, 'bytes');
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' }).end(salida);
  });
}).listen(PUERTO, () => console.log(`Apps Script local en http://localhost:${PUERTO}/ (clave: ${CLAVE})`));
