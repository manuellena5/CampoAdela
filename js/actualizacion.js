// Registro del Service Worker y detección de nuevas versiones.

import { APP_VERSION } from './config.js';
import { registrarError } from './errores.js';

let versionRemota = null;

// Recuerda a qué versión se intentó actualizar. Si después de recargar la app sigue
// con otra versión (version.json y config.js no coinciden, o la CDN de GitHub Pages
// todavía sirve archivos viejos), no se vuelve a mostrar el banner por un rato:
// así no queda en un bucle de "Actualizar".
const CLAVE_INTENTO = 'actualizacion-intento';
const ESPERA_REINTENTO_MS = 15 * 60 * 1000;

function leerIntento() {
  try {
    return JSON.parse(sessionStorage.getItem(CLAVE_INTENTO)) || null;
  } catch {
    return null;
  }
}

export function registrarSW() {
  if (!('serviceWorker' in navigator)) return;
  // La versión va en la URL: un cambio de versión instala un SW nuevo con su propio cache.
  navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`)
    .then((reg) => vigilarInstalacion(reg))
    .catch((err) => registrarError(err, { accion: 'registrar el Service Worker' }, 'advertencia'));
}

// Registra en el log si una versión nueva del SW no se pudo instalar (p. ej. archivos que no bajaron).
function vigilarInstalacion(reg) {
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    sw?.addEventListener('statechange', () => {
      if (sw.state === 'redundant') {
        registrarError(new Error(`No se pudo instalar el Service Worker ${new URL(sw.scriptURL).search}`),
          { accion: 'instalar actualización' }, 'advertencia');
      }
    });
  });
}

// Consulta version.json sin caché.
// Devuelve { nueva, inconsistente }:
//   nueva: versión publicada si difiere de la actual (null si no hay que mostrar el banner);
//   inconsistente: versión publicada que no se pudo instalar (ya se intentó y la app no cambió).
export async function buscarActualizacion() {
  try {
    const resp = await fetch('version.json', { cache: 'no-store' });
    if (!resp.ok) return { nueva: null, inconsistente: null };
    const { version } = await resp.json();
    versionRemota = version;
    if (!version || version === APP_VERSION) {
      sessionStorage.removeItem(CLAVE_INTENTO);
      return { nueva: null, inconsistente: null };
    }
    const intento = leerIntento();
    if (intento?.version === version && Date.now() - intento.cuando < ESPERA_REINTENTO_MS) {
      console.warn(`version.json dice ${version} pero la app publicada es ${APP_VERSION}. Revisar APP_VERSION en js/config.js.`);
      return { nueva: null, inconsistente: version };
    }
    return { nueva: version, inconsistente: null };
  } catch {
    return { nueva: null, inconsistente: null }; // sin conexión
  }
}

export function mostrarBanner(visible) {
  document.getElementById('banner-actualizacion').hidden = !visible;
}

export async function verificarYMostrar() {
  const resultado = await buscarActualizacion();
  mostrarBanner(Boolean(resultado.nueva));
  return resultado;
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

// Salida de emergencia: borra el Service Worker y los archivos de la app en cache y recarga,
// así se descarga todo de nuevo. NO toca IndexedDB (los datos quedan).
// Después se instala directamente el SW de la versión publicada (que baja todo fresco con ?v=) y recién
// ahí se recarga: si se recargara antes, el navegador podría usar su propia caché HTTP con archivos viejos.
export async function forzarActualizacion() {
  sessionStorage.removeItem(CLAVE_INTENTO);
  try {
    const version = versionRemota || (await buscarActualizacion(), versionRemota);
    for (const reg of await navigator.serviceWorker?.getRegistrations?.() || []) await reg.unregister();
    for (const clave of await caches.keys()) if (clave.startsWith('campo-')) await caches.delete(clave);
    if (version && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.register(`sw.js?v=${version}`);
      await esperarActivo(reg);
    }
  } catch (err) {
    registrarError(err, { accion: 'forzar actualización' }, 'advertencia');
  }
  location.reload();
}

// Espera a que el SW recién registrado quede activo (o falle), con un límite de tiempo.
function esperarActivo(reg) {
  return new Promise((resolve) => {
    const sw = reg.installing || reg.waiting || reg.active;
    if (!sw || sw.state === 'activated') return resolve();
    const limite = setTimeout(resolve, 30000);
    sw.addEventListener('statechange', () => {
      if (sw.state === 'activated' || sw.state === 'redundant') { clearTimeout(limite); resolve(); }
    });
  });
}

// Activa la nueva versión: SW en espera → SKIP_WAITING → recarga.
// Nunca toca IndexedDB.
export async function aplicarActualizacion() {
  const btn = document.getElementById('btn-actualizar');
  btn.disabled = true;
  btn.textContent = 'Actualizando…';

  if (versionRemota) {
    sessionStorage.setItem(CLAVE_INTENTO, JSON.stringify({ version: versionRemota, cuando: Date.now() }));
  }
  const recargar = () => location.reload();
  try {
    if (!('serviceWorker' in navigator)) return recargar();
    let reg = await navigator.serviceWorker.getRegistration();
    let worker = reg?.waiting;
    // El SW activo ya es el de la versión nueva pero la app sigue vieja: su cache quedó con archivos
    // viejos (p. ej. la CDN todavía no se había actualizado). Registrar de nuevo no sirve: se limpia todo.
    const activo = reg?.active?.scriptURL || '';
    if (!worker && versionRemota && new URL(activo || location.href).searchParams.get('v') === versionRemota) {
      return forzarActualizacion();
    }
    if (!worker && versionRemota) {
      // Registrar el SW de la nueva versión: precachea los archivos nuevos.
      reg = await navigator.serviceWorker.register(`sw.js?v=${versionRemota}`);
      worker = reg.waiting || await esperarInstalado(reg);
    }
    if (!worker) return recargar();
    navigator.serviceWorker.addEventListener('controllerchange', recargar, { once: true });
    worker.postMessage('SKIP_WAITING');
  } catch (err) {
    registrarError(err, { accion: 'actualizar' }, 'advertencia');
    recargar();
  }
}
