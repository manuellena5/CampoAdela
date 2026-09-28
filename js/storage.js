// Almacenamiento de comprobantes. Interfaz mínima para poder cambiar de backend
// (hoy: Google Drive vía Apps Script; a futuro, p. ej., Supabase):
//   subir(archivo, { movimientoId }) → url
// Offline: los archivos quedan en la tabla `archivos` (IndexedDB) y se suben al sincronizar.

import { db, actualizar } from './db.js';
import { llamar, mensajeError } from './api.js';

const MAX_BYTES = 15 * 1024 * 1024;
const LADO_MAX_IMAGEN = 1600; // px: las fotos del celular se achican antes de subir
const TIMEOUT_SUBIDA_MS = 120000;
export const TIPOS_ACEPTADOS = 'image/*,application/pdf';

// Reduce fotos grandes a JPEG (menos datos en el campo con señal débil). PDFs y otros quedan igual.
export async function prepararArchivo(archivo) {
  const esImagen = /^image\/(jpeg|png|webp)$/.test(archivo.type);
  if (!esImagen) return archivo;
  try {
    const bitmap = await createImageBitmap(archivo);
    const escala = Math.min(1, LADO_MAX_IMAGEN / Math.max(bitmap.width, bitmap.height));
    if (escala === 1 && archivo.size < 1024 * 1024) return archivo;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob || blob.size >= archivo.size) return archivo;
    const nombre = archivo.name.replace(/\.\w+$/, '') + '.jpg';
    return new File([blob], nombre, { type: 'image/jpeg' });
  } catch {
    return archivo; // formato que el navegador no puede decodificar (p. ej. HEIC): se sube tal cual
  }
}

export function validarArchivo(archivo) {
  if (!/^image\//.test(archivo.type) && archivo.type !== 'application/pdf') return 'Solo fotos o PDF.';
  if (archivo.size > MAX_BYTES) return 'El archivo supera los 15 MB.';
  return null;
}

function aBase64(blob) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(',')[1]);
    lector.onerror = () => reject(lector.error);
    lector.readAsDataURL(blob);
  });
}

// Sube un archivo y devuelve la URL pública (según los permisos de la carpeta de Drive).
export async function subir(archivo, { movimientoId = '' } = {}) {
  const datos = { nombre: archivo.name, mimeType: archivo.type, base64: await aBase64(archivo), movimientoId };
  const { url } = await llamar('subirComprobante', datos, { timeout: TIMEOUT_SUBIDA_MS });
  return url;
}

// ---- Cola offline

// Deja el comprobante de un movimiento en cola (reemplaza uno anterior sin subir).
export async function encolar(movimientoId, archivo) {
  await db.transaction('rw', db.archivos, async () => {
    await db.archivos.where('movimientoId').equals(movimientoId).delete();
    await db.archivos.add({
      id: crypto.randomUUID(), movimientoId, nombre: archivo.name, tipo: archivo.type,
      blob: archivo, creado: new Date().toISOString(),
    });
  });
}

export async function pendienteDe(movimientoId) {
  return db.archivos.where('movimientoId').equals(movimientoId).first();
}

export async function quitarDeCola(movimientoId) {
  await db.archivos.where('movimientoId').equals(movimientoId).delete();
}

// Sube lo que haya en cola. Devuelve { subidos, error } (el primer error corta la cola; se reintenta luego).
export async function procesarCola() {
  let subidos = 0;
  for (const item of await db.archivos.toArray()) {
    const mov = await db.movimientos.get(item.movimientoId);
    if (!mov || mov.borrado) { await db.archivos.delete(item.id); continue; }
    try {
      const archivo = new File([item.blob], item.nombre, { type: item.tipo });
      const url = await subir(archivo, { movimientoId: item.movimientoId });
      await actualizar('movimientos', item.movimientoId, { comprobanteUrl: url });
      await db.archivos.delete(item.id);
      subidos++;
    } catch (err) {
      console.warn('No se pudo subir el comprobante', err);
      return { subidos, error: mensajeError(err) };
    }
  }
  return { subidos, error: null };
}
