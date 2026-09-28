// Bootstrap de la app.

import { iniciarRouter } from './router.js';
import { registrarSW, verificarYMostrar, aplicarActualizacion } from './actualizacion.js';
import { abrirDB } from './db.js';
import { esc } from './lib/dom.js';

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

try {
  await abrirDB();
  iniciarRouter();
} catch (err) {
  console.error(err);
  document.getElementById('vista').innerHTML = `
    <div class="form-centrado"><div class="aviso">
      No se pudo abrir la base de datos local (${esc(err.message)}).
      Si estás en una ventana privada, abrí la app en una ventana normal.
    </div></div>`;
}
