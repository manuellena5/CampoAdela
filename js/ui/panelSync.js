// Panel de sincronización (se abre tocando el indicador del header).
// Bottom sheet en celular, desplegable en notebook. Se actualiza en vivo con el progreso del sync.

import { alCambiarEstado, alProgresoSync, sincronizar, pendientesPorEntidad, historialSync } from '../sync.js';
import { APPS_SCRIPT_URL } from '../config.js';
import { navegar } from '../router.js';
import { esc } from '../lib/dom.js';
import { formatoFechaHora, formatoNumero } from '../lib/formato.js';

const ETAPAS = {
  preparando: 'Preparando', enviando: 'Enviando', recibiendo: 'Recibiendo', aplicando: 'Aplicando cambios', listo: 'Listo', error: 'Error',
};
const ENTIDADES = {
  movimientos: 'Movimientos', campanas: 'Campañas', categorias: 'Categorías', subcategorias: 'Subcategorías',
  hermanos: 'Hermanos', comprobantes: 'Comprobantes', errores: 'Registros de error',
};
const ESTADOS = {
  ok: ['✓', 'Al día'], pendientes: ['↑', 'Hay cambios sin subir'], 'sin-conexion': ['⚡', 'Sin conexión'],
  sincronizando: ['↻', 'Sincronizando'], error: ['⚠', 'La última sincronización falló'],
  'sin-config': ['⚙', 'Falta configurar: cargá tu usuario y la clave en Configuración'],
};

const duracion = (ms) => (ms < 1000 ? `${ms} ms` : `${formatoNumero(ms / 1000)} s`);
const totalRecibidos = (r) => Object.values(r || {}).reduce((s, x) => s + x.nuevos + x.modificados + x.borrados, 0);

export function abrirPanelSync() {
  if (document.querySelector('dialog.panel-sync')) return;
  const dlg = document.createElement('dialog');
  dlg.className = 'panel-sync';
  dlg.setAttribute('aria-labelledby', 'panel-sync-titulo');
  dlg.innerHTML = `
    <div class="panel-cabecera">
      <h2 id="panel-sync-titulo">Sincronización</h2>
      <button type="button" class="panel-cerrar" data-panel="cerrar" aria-label="Cerrar">✕</button>
    </div>
    <div class="panel-cuerpo"></div>`;
  document.body.append(dlg);

  const cuerpo = dlg.querySelector('.panel-cuerpo');
  let estado = null;
  let progreso = null;
  let datos = null; // { pendientes, historial }
  let estabaSincronizando = false;

  const recargar = async () => {
    datos = { pendientes: await pendientesPorEntidad(), historial: await historialSync() };
    dibujar();
  };

  function dibujar() {
    if (!estado) return;
    const [icono, texto] = ESTADOS[estado.estado] || ['', ''];
    const corriendo = estado.estado === 'sincronizando';
    const p = corriendo ? progreso || estado.progreso : null;
    const ultimo = datos?.historial?.[0];
    const pendientes = datos ? Object.entries(datos.pendientes).filter(([, n]) => n) : [];

    cuerpo.innerHTML = `
      <section class="panel-estado estado-${esc(estado.estado)}">
        <div class="panel-estado-linea"><span class="estado-icono" aria-hidden="true">${icono}</span> <strong>${esc(texto)}</strong></div>
        ${p ? `
          <div class="panel-etapa">${esc(ETAPAS[p.etapa] || p.etapa)}${p.total ? ` ${formatoNumero(p.hecho)} de ${formatoNumero(p.total)}` : ''}${p.detalle ? ` · ${esc(p.detalle)}` : ''}</div>
          <div class="barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.porcentaje}"><div style="width:${p.porcentaje}%"></div></div>
          <div class="detalle">${p.porcentaje}%</div>` : ''}
      </section>

      ${estado.error && !corriendo ? `
        <section class="panel-error">
          <strong>${esc(estado.error.codigo)}</strong> · ${esc(estado.error.mensaje)}
          ${estado.error.id ? `<div><button type="button" class="btn-link" data-panel="log" data-id="${estado.error.id}">Ver en el registro de errores</button></div>` : ''}
        </section>` : ''}

      <button type="button" class="btn btn-primario btn-bloque" data-panel="sync" ${corriendo || !APPS_SCRIPT_URL ? 'disabled' : ''}>
        ${corriendo ? 'Sincronizando…' : 'Sincronizar ahora'}
      </button>

      <section>
        <h3>Pendientes de subir</h3>
        ${!datos ? '<p class="detalle">…</p>' : pendientes.length
          ? `<ul class="panel-lista">${pendientes.map(([k, n]) => `<li><span>${esc(ENTIDADES[k] || k)}</span><strong>${formatoNumero(n)}</strong></li>`).join('')}</ul>`
          : '<p class="detalle">Nada pendiente.</p>'}
      </section>

      <section>
        <h3>Última sincronización</h3>
        ${!ultimo ? '<p class="detalle">Todavía no hubo ninguna en este dispositivo.</p>' : `
          <p class="detalle">${esc(formatoFechaHora(ultimo.fecha))} · ${duracion(ultimo.duracionMs)} ·
            ${ultimo.resultado === 'ok' ? '✓ correcta' : `✕ ${esc(ultimo.codigo || 'error')}`}</p>
          <p>Enviados: <strong>${formatoNumero(ultimo.enviados || 0)}</strong> · Recibidos: <strong>${formatoNumero(totalRecibidos(ultimo.recibidos))}</strong></p>
          ${totalRecibidos(ultimo.recibidos) ? `
            <table class="tabla tabla-panel">
              <thead><tr><th>Recibidos</th><th class="num">Nuevos</th><th class="num">Modif.</th><th class="num">Borrados</th></tr></thead>
              <tbody>${Object.entries(ultimo.recibidos).filter(([, r]) => r.nuevos + r.modificados + r.borrados)
                .map(([k, r]) => `<tr><td>${esc(ENTIDADES[k] || k)}</td><td class="num">${r.nuevos}</td><td class="num">${r.modificados}</td><td class="num">${r.borrados}</td></tr>`).join('')}</tbody>
            </table>` : ''}`}
      </section>

      ${datos?.historial?.length ? `
        <section>
          <h3>Historial</h3>
          <table class="tabla tabla-panel">
            <thead><tr><th>Fecha</th><th class="num">Duración</th><th class="num">Env.</th><th class="num">Rec.</th><th></th></tr></thead>
            <tbody>${datos.historial.map((h) => `
              <tr>
                <td class="nowrap">${esc(formatoFechaHora(h.fecha))}</td>
                <td class="num">${duracion(h.duracionMs)}</td>
                <td class="num">${formatoNumero(h.enviados || 0)}</td>
                <td class="num">${formatoNumero(totalRecibidos(h.recibidos))}</td>
                <td title="${esc(h.resultado === 'ok' ? 'Correcta' : `${h.codigo}: ${h.mensaje}`)}">${h.resultado === 'ok' ? '✓' : `<span class="texto-peligro">✕ ${esc(h.codigo || '')}</span>`}</td>
              </tr>`).join('')}</tbody>
          </table>
        </section>` : ''}`;
  }

  let pendientesVistos = null;
  const desuscribirEstado = alCambiarEstado((e) => {
    const anterior = estado;
    estado = e;
    const corriendo = e.estado === 'sincronizando';
    // Terminó un sync (nuevo resultado e historial) o cambiaron los pendientes: se vuelven a leer.
    if ((estabaSincronizando && !corriendo) || (anterior && !corriendo && e.pendientes !== pendientesVistos)) recargar();
    pendientesVistos = e.pendientes;
    estabaSincronizando = corriendo;
    dibujar();
  });
  const desuscribirProgreso = alProgresoSync((p) => { progreso = p; dibujar(); });

  let cerrado = false;
  const limpiar = () => {
    if (cerrado) return;
    cerrado = true;
    desuscribirEstado();
    desuscribirProgreso();
    if (dlg.open) dlg.close();
    dlg.remove();
  };
  // Esc / "atrás" disparan 'cancel'; se limpia en el momento sin esperar a 'close'.
  dlg.addEventListener('cancel', limpiar);
  dlg.addEventListener('close', limpiar);
  // Clic fuera del contenido (en el fondo) cierra.
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) { limpiar(); return; }
    const accion = e.target.closest('[data-panel]');
    if (!accion) return;
    if (accion.dataset.panel === 'cerrar') limpiar();
    if (accion.dataset.panel === 'sync') sincronizar();
    if (accion.dataset.panel === 'log') { limpiar(); navegar(`/config/errores/${accion.dataset.id}`); }
  });

  dlg.showModal();
  recargar();
}
