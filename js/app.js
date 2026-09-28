// Bootstrap de la app.

import { iniciarRouter, refrescar, navegar } from './router.js';
import { registrarSW, verificarYMostrar, aplicarActualizacion } from './actualizacion.js';
import { abrirDB } from './db.js';
import { iniciarSync, alCambiarEstado, sincronizar } from './sync.js';
import { movimientosAConfirmar, recalcularAConfirmar } from './dolar.js';
import { notificarError, configurarAcciones, alCambiarLog, mensajeAmigable, registrarError } from './errores.js';
import { contarErroresNuevos } from './ui/registroErrores.js';
import { abrirPanelSync } from './ui/panelSync.js';
import { esc, toast, configurarToasts } from './lib/dom.js';

// ---- Errores: captura global (nada debería terminar en una pantalla en blanco o en un error mudo)

configurarToasts({ verDetalle: (id) => navegar(`/config/errores/${id}`) });
configurarAcciones({
  configuracion: () => navegar('/configuracion'),
  // "Reintentar": errores de servidor → sincronizar; de la base local → volver a abrir la pantalla.
  reintentar: (codigo) => (codigo === 'E-SRV' ? () => sincronizar() : () => refrescar(true)),
});

let reportando = false; // evita bucles si el propio reporte falla
async function reportarGlobal(error, accion) {
  if (reportando) return;
  reportando = true;
  try {
    await notificarError(error instanceof Error ? error : new Error(String(error ?? 'Error desconocido')), { accion });
  } catch (err) {
    console.error('No se pudo reportar el error', err);
  } finally {
    reportando = false;
  }
}

window.addEventListener('error', (e) => {
  // Errores de carga de recursos (img, script) llegan sin `error`: se ignoran salvo que sean de la app.
  if (!e.error && !e.message) return;
  reportarGlobal(e.error || new Error(e.message), 'error global');
});
window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  reportarGlobal(e.reason, 'promesa sin manejar');
});

// ---- Indicador de sincronización del header (compacto: ícono + texto corto)

const INDICADOR = {
  'sin-config': () => ['⚙', 'Sin configurar'],
  'sin-conexion': (e) => ['⚡', e.pendientes ? `Sin conexión · ${e.pendientes}` : 'Sin conexión'],
  sincronizando: (e) => ['↻', `Sincronizando ${e.progreso?.porcentaje ?? 0}%`],
  ok: () => ['✓', 'Al día'],
  pendientes: (e) => ['↑', `${e.pendientes} pendiente${e.pendientes === 1 ? '' : 's'}`],
  error: () => ['⚠', 'Error'],
};

function mostrarEstadoSync(e) {
  const el = document.getElementById('estado-sync');
  const [icono, texto] = INDICADOR[e.estado](e);
  el.innerHTML = `<span class="estado-icono" aria-hidden="true">${icono}</span><span>${esc(texto)}</span>`;
  el.className = `estado-sync estado-${e.estado}`;
  el.title = e.error ? `${e.error.codigo}: ${e.error.mensaje}` : 'Ver el estado de la sincronización';
}

registrarSW();

document.getElementById('btn-actualizar').addEventListener('click', aplicarActualizacion);
document.getElementById('estado-sync').addEventListener('click', () => abrirPanelSync());

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') verificarYMostrar();
});

window.addEventListener('datos-sincronizados', () => refrescar());

// ---- Badge de errores nuevos (Configuración / Más)

async function actualizarBadgeErrores() {
  const n = await contarErroresNuevos();
  document.querySelectorAll('[data-badge-errores]').forEach((b) => {
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
  });
}
alCambiarLog(actualizarBadgeErrores);
window.addEventListener('log-visto', actualizarBadgeErrores);

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
  toast(n ? `Cotización actualizada en ${n} movimiento${n === 1 ? '' : 's'}` : 'No se pudo obtener la cotización',
    { tipo: n ? 'exito' : 'advertencia' });
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
window.addEventListener('ruta-cambiada', revisarAConfirmar);

verificarYMostrar();

try {
  await abrirDB();
  alCambiarEstado(mostrarEstadoSync);
  iniciarRouter();
  iniciarSync();
  revisarAConfirmar();
  actualizarBadgeErrores();
} catch (err) {
  const amigable = mensajeAmigable(err);
  registrarError(err, { accion: 'abrir la app' }).catch(() => {});
  document.getElementById('vista').innerHTML = `
    <div class="form-centrado"><div class="aviso">
      <strong>${esc(amigable.codigo)}</strong> · No se pudo abrir la base de datos del teléfono.
      Si estás en una ventana privada, abrí la app en una ventana normal.
      <div class="acciones"><button type="button" class="btn" onclick="location.reload()">Reintentar</button></div>
    </div></div>`;
}
