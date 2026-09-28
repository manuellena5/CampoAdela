// Registro del Service Worker y detección de nuevas versiones.

import { APP_VERSION } from './config.js';

let versionRemota = null;

export function registrarSW() {
  if (!('serviceWorker' in navigator)) return;
  // La versión va en la URL: un cambio de versión instala un SW nuevo con su propio cache.
  navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`).catch((err) => {
    console.warn('No se pudo registrar el Service Worker', err);
  });
}

// Consulta version.json sin caché. Devuelve la versión remota si difiere de la actual, o null.
export async function buscarActualizacion() {
  try {
    const resp = await fetch('version.json', { cache: 'no-store' });
    if (!resp.ok) return null;
    const { version } = await resp.json();
    versionRemota = version;
    return version && version !== APP_VERSION ? version : null;
  } catch {
    return null; // sin conexión
  }
}

export function mostrarBanner(visible) {
  document.getElementById('banner-actualizacion').hidden = !visible;
}

export async function verificarYMostrar() {
  const nueva = await buscarActualizacion();
  mostrarBanner(Boolean(nueva));
  return nueva;
}

// Espera a que un SW en instalación quede "installed" (en espera).
function esperarInstalado(reg) {
  return new Promise((resolve) => {
    const sw = reg.installing;
    if (!sw) return resolve(reg.waiting);
    sw.addEventListener('statechange', () => {
      if (sw.state === 'installed') resolve(reg.waiting || sw);
      else if (sw.state === 'redundant') resolve(null);
    });
  });
}

// Activa la nueva versión: SW en espera → SKIP_WAITING → recarga.
// Nunca toca IndexedDB.
export async function aplicarActualizacion() {
  const btn = document.getElementById('btn-actualizar');
  btn.disabled = true;
  btn.textContent = 'Actualizando…';

  const recargar = () => location.reload();
  try {
    if (!('serviceWorker' in navigator)) return recargar();
    let reg = await navigator.serviceWorker.getRegistration();
    let worker = reg?.waiting;
    if (!worker && versionRemota) {
      // Registrar el SW de la nueva versión: precachea los archivos nuevos.
      reg = await navigator.serviceWorker.register(`sw.js?v=${versionRemota}`);
      worker = reg.waiting || await esperarInstalado(reg);
    }
    if (!worker) return recargar();
    navigator.serviceWorker.addEventListener('controllerchange', recargar, { once: true });
    worker.postMessage('SKIP_WAITING');
  } catch (err) {
    console.warn('Error al actualizar', err);
    recargar();
  }
}
