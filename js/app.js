// Bootstrap de la app.

import { iniciarRouter, refrescar } from './router.js';
import { registrarSW, verificarYMostrar, aplicarActualizacion } from './actualizacion.js';
import { abrirDB } from './db.js';
import { iniciarSync, alCambiarEstado, sincronizar } from './sync.js';
import { movimientosAConfirmar, recalcularAConfirmar } from './dolar.js';
import { esc, toast } from './lib/dom.js';

const TEXTOS_SYNC = {
  'sin-config': () => 'Sync sin configurar',
  'sin-conexion': (e) => (e.pendientes ? `Sin conexión · ${e.pendientes}` : 'Sin conexión'),
  sincronizando: () => 'Sincronizando…',
  ok: () => '✓ Sincronizado',
  pendientes: (e) => `${e.pendientes} pendiente${e.pendientes === 1 ? '' : 's'}`,
  error: () => '⚠ Error de sync',
};

function mostrarEstadoSync(e) {
  const el = document.getElementById('estado-sync');
  el.textContent = TEXTOS_SYNC[e.estado](e);
  el.className = `estado-sync estado-${e.estado}`;
  el.title = e.error || 'Tocar para sincronizar';
}

registrarSW();

document.getElementById('btn-actualizar').addEventListener('click', aplicarActualizacion);

document.getElementById('estado-sync').addEventListener('click', async () => {
  const r = await sincronizar();
  if (r.error) toast(r.error, 4000);
  else if (r.ok) toast(r.cambios ? `Sincronizado (${r.cambios} cambios)` : 'Sincronizado');
  else if (!navigator.onLine) toast('Sin conexión');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') verificarYMostrar();
});

window.addEventListener('datos-sincronizados', refrescar);

// ---- Movimientos con cotización "a confirmar": al haber conexión se ofrece recalcularlos.
let avisoDescartado = false;

async function revisarAConfirmar() {
  const aviso = document.getElementById('aviso-cotizaciones');
  const pendientes = navigator.onLine && !avisoDescartado ? (await movimientosAConfirmar()).length : 0;
  aviso.hidden = !pendientes;
  if (pendientes) {
    document.getElementById('aviso-cotizaciones-texto').textContent = pendientes === 1
      ? '1 movimiento con cotización a confirmar'
      : `${pendientes} movimientos con cotización a confirmar`;
  }
}

document.getElementById('btn-recalcular').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Recalculando…';
  const n = await recalcularAConfirmar();
  btn.disabled = false;
  btn.textContent = 'Recalcular';
  toast(n ? `Cotización actualizada en ${n} movimiento${n === 1 ? '' : 's'}` : 'No se pudo obtener la cotización');
  await revisarAConfirmar();
  refrescar();
});
document.getElementById('btn-recalcular-no').addEventListener('click', () => {
  avisoDescartado = true;
  revisarAConfirmar();
});
window.addEventListener('online', () => { avisoDescartado = false; revisarAConfirmar(); });
window.addEventListener('offline', revisarAConfirmar);
window.addEventListener('datos-sincronizados', revisarAConfirmar);
window.addEventListener('hashchange', revisarAConfirmar);

verificarYMostrar();

try {
  await abrirDB();
  alCambiarEstado(mostrarEstadoSync);
  iniciarRouter();
  iniciarSync();
  revisarAConfirmar();
} catch (err) {
  console.error(err);
  document.getElementById('vista').innerHTML = `
    <div class="form-centrado"><div class="aviso">
      No se pudo abrir la base de datos local (${esc(err.message)}).
      Si estás en una ventana privada, abrí la app en una ventana normal.
    </div></div>`;
}
