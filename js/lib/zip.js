// ZIP mínimo para archivos .xlsx.
//  - crearZip: sin compresión (método "store"), suficiente para generar la plantilla.
//  - leerZip: lee "store" y "deflate" (lo que guarda Excel) con DecompressionStream del navegador.

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** archivos: [{ nombre, contenido: string | Uint8Array }] → Blob (application/zip) */
export function crearZip(archivos, tipo = 'application/zip') {
  const enc = new TextEncoder();
  const partes = [];
  const central = [];
  let offset = 0;

  for (const { nombre, contenido } of archivos) {
    const nombreBytes = enc.encode(nombre);
    const datos = typeof contenido === 'string' ? enc.encode(contenido) : contenido;
    const crc = crc32(datos);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // versión
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true); // store
    local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true);
    local.setUint32(22, datos.length, true);
    local.setUint16(26, nombreBytes.length, true);
    partes.push(local, nombreBytes, datos);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, datos.length, true);
    cd.setUint32(24, datos.length, true);
    cd.setUint16(28, nombreBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd, nombreBytes);

    offset += 30 + nombreBytes.length + datos.length;
  }

  const tamCentral = central.reduce((s, p) => s + p.byteLength, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, offset, true);

  return new Blob([...partes, ...central, fin], { type: tipo });
}

async function inflar(bytes) {
  const flujo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/** Lee un ZIP. Devuelve Map nombre → función async que devuelve el contenido como texto. */
export async function leerZip(buffer) {
  const v = new DataView(buffer);
  let fin = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('El archivo no es un Excel (.xlsx) válido.');

  const cantidad = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const dec = new TextDecoder();
  const entradas = new Map();

  for (let i = 0; i < cantidad; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Excel dañado (directorio central).');
    const metodo = v.getUint16(p + 10, true);
    const tamComprimido = v.getUint32(p + 20, true);
    const largoNombre = v.getUint16(p + 28, true);
    const largoExtra = v.getUint16(p + 30, true);
    const largoComent = v.getUint16(p + 32, true);
    const offLocal = v.getUint32(p + 42, true);
    const nombre = dec.decode(new Uint8Array(buffer, p + 46, largoNombre));
    p += 46 + largoNombre + largoExtra + largoComent;

    entradas.set(nombre, async () => {
      const inicio = offLocal + 30 + v.getUint16(offLocal + 26, true) + v.getUint16(offLocal + 28, true);
      const datos = new Uint8Array(buffer, inicio, tamComprimido);
      if (metodo === 0) return dec.decode(datos);
      if (metodo === 8) return dec.decode(await inflar(datos));
      throw new Error(`Compresión no soportada (${metodo}).`);
    });
  }
  return entradas;
}
