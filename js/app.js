// Bootstrap de la app.

import { iniciarRouter } from './router.js';
import { registrarSW, verificarYMostrar, aplicarActualizacion } from './actualizacion.js';

function actualizarEstadoConexion() {
  const el = document.getElementById('estado-sync');
  // Fase 1: solo conexión. En la Fase 3 muestra pendientes / error de sync.
  el.textContent = navigator.onLine ? '' : 'Sin conexión';
  el.classList.toggle('offline', !navigator.onLine);
}

registrarSW();

document.getElementById('btn-actualizar').addEventListener('click', aplicarActualizacion);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') verificarYMostrar();
});

window.addEventListener('online', actualizarEstadoConexion);
window.addEventListener('offline', actualizarEstadoConexion);

actualizarEstadoConexion();
verificarYMostrar();
iniciarRouter();
