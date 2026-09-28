// Base local (IndexedDB vía Dexie): esquema, migraciones, seed y helpers de escritura.
// Dexie se carga como script clásico desde /vendor (window.Dexie).

import { SEED } from './seed.js';
import { comoErrorBaseLocal, recuperarBuffer } from './errores.js';

const { Dexie } = globalThis;

export const db = new Dexie('campo');

// Los booleanos (pendiente, borrado, activa) no son indexables en IndexedDB:
// se filtran en memoria (los volúmenes son chicos).
db.version(1).stores({
  hermanos: 'id',
  categorias: 'id, tipo',
  subcategorias: 'id, categoriaId',
  campanas: 'id, fechaInicio',
  movimientos: 'id, fecha, periodo, categoriaId, subcategoriaId, campanaId, pagoId',
  ajustes: 'clave',
  cotizaciones: '[tipo+fecha], tipo',
});

// v2 (Fase 7): cola local de comprobantes pendientes de subir a Drive.
db.version(2).stores({
  archivos: 'id, movimientoId',
});

// v3: log de errores y resultados de sincronizaciones.
db.version(3).stores({
  logErrores: '++id, fecha',
  historialSync: '++id, fecha',
});

db.on('populate', async (tx) => {
  await tx.table('hermanos').bulkAdd(SEED.hermanos);
  await tx.table('categorias').bulkAdd(SEED.categorias);
  await tx.table('subcategorias').bulkAdd(SEED.subcategorias);
});

// Entidades que se sincronizan con el Sheet (Fase 3).
export const TABLAS_SYNC = ['hermanos', 'categorias', 'subcategorias', 'campanas', 'movimientos'];

// Abre la base, migra los ajustes de la Fase 1 (localStorage) y pide almacenamiento persistente.
export async function abrirDB() {
  try {
    await db.open();
    await migrarLocalStorage();
  } catch (err) {
    throw comoErrorBaseLocal(err, 'abrir');
  }
  await recuperarBuffer(); // errores que no se pudieron guardar antes (quedaron en localStorage)
  navigator.storage?.persist?.().catch(() => {});
}

// Ejecuta una escritura: cualquier falla de IndexedDB sale como ErrorBaseLocal (E-DB).
async function escribir(accion, fn) {
  try {
    return await fn();
  } catch (err) {
    throw comoErrorBaseLocal(err, accion);
  }
}

async function migrarLocalStorage() {
  const PREFIJO = 'campo.';
  const claves = Object.keys(localStorage).filter((k) => k.startsWith(PREFIJO));
  if (!claves.length) return;
  await db.transaction('rw', db.ajustes, async () => {
    for (const k of claves) {
      const clave = k.slice(PREFIJO.length);
      if (!(await db.ajustes.get(clave))) {
        try { await db.ajustes.put({ clave, valor: JSON.parse(localStorage.getItem(k)) }); } catch { /* valor inválido: se ignora */ }
      }
    }
  });
  claves.forEach((k) => localStorage.removeItem(k));
}

// Suscriptores a cambios locales (lo usa sync.js para contar pendientes y sincronizar).
const oyentes = new Set();
export function alCambiarDatos(fn) {
  oyentes.add(fn);
}
function notificarCambio() {
  oyentes.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });
}

async function usuarioActual() {
  return (await db.ajustes.get('usuario'))?.valor || '';
}

// Alta: agrega los campos comunes y marca pendiente de sincronizar.
// `id` opcional (p. ej. para encolar un comprobante antes de crear el movimiento).
export async function crear(tabla, datos, id = crypto.randomUUID()) {
  const registro = await escribir(`guardar en ${tabla}`, async () => {
    const ahora = new Date().toISOString();
    const nuevo = {
      ...datos,
      id,
      creado: ahora,
      modificado: ahora,
      cargadoPor: await usuarioActual(),
      borrado: false,
      pendiente: true,
    };
    await db.table(tabla).add(nuevo);
    return nuevo;
  });
  notificarCambio();
  return registro;
}

// Modificación: actualiza `modificado` y marca pendiente.
export async function actualizar(tabla, id, cambios) {
  await escribir(`actualizar ${tabla}`, () =>
    db.table(tabla).update(id, { ...cambios, modificado: new Date().toISOString(), pendiente: true }));
  notificarCambio();
}

// Borrado lógico: nunca se elimina el registro.
export function borrar(tabla, id) {
  return actualizar(tabla, id, { borrado: true });
}

// Registros no borrados de una tabla.
export async function listar(tabla) {
  return (await db.table(tabla).toArray()).filter((r) => !r.borrado);
}

// Cantidad de movimientos (no borrados) que referencian un id en el campo dado.
export async function contarMovimientos(campo, id) {
  return db.movimientos.where(campo).equals(id).filter((m) => !m.borrado).count();
}

// Reordena `id` dentro de `lista` (los hermanos de nivel, ya filtrados) moviéndolo `delta` lugares.
export async function mover(tabla, lista, id, delta) {
  const ordenada = [...lista].sort((a, b) => a.orden - b.orden);
  const i = ordenada.findIndex((r) => r.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ordenada.length) return;
  [ordenada[i], ordenada[j]] = [ordenada[j], ordenada[i]];
  await escribir(`reordenar ${tabla}`, () => db.transaction('rw', db.table(tabla), async () => {
    for (const [pos, r] of ordenada.entries()) {
      if (r.orden !== pos + 1) await actualizar(tabla, r.id, { orden: pos + 1 });
    }
  }));
}
