// Pantalla Configuración: usuario, clave compartida, tipo de dólar, sincronización, versión.

import { APP_VERSION, APPS_SCRIPT_URL } from '../config.js';
import * as ajustes from '../ajustes.js';
import { listar } from '../db.js';
import { verificarYMostrar, forzarActualizacion } from '../actualizacion.js';
import { sincronizar, alCambiarEstado } from '../sync.js';
import { esc, $, toast, marcarErrorCampo, limpiarErroresCampos } from '../lib/dom.js';
import { abrirPanelSync } from './panelSync.js';
import { formatoFechaHora } from '../lib/formato.js';
import { navegar } from '../router.js';
import { descargarPlantilla, leerArchivo, cargarCatalogos } from '../importacion.js';
import { iniciarRevision } from './importar.js';

const DESCRIPCION_ESTADO = {
  'sin-config': APPS_SCRIPT_URL ? 'Falta cargar usuario y clave' : 'Falta la URL del Apps Script en js/config.js',
  'sin-conexion': 'Sin conexión',
  sincronizando: 'Sincronizando…',
  ok: 'Sincronizado',
  pendientes: 'Hay cambios sin sincronizar',
  error: 'Error',
};

function fechaHora(iso) {
  return iso ? formatoFechaHora(iso) : 'Nunca';
}

export async function render(el) {
  const [usuario, clave, tipoDolar, completa, todos] = await Promise.all([
    ajustes.obtener('usuario'),
    ajustes.obtener('clave'),
    ajustes.obtener('tipoDolar'),
    ajustes.configuracionCompleta(),
    listar('hermanos'),
  ]);
  // Activos, más el usuario actual aunque esté inactivo.
  const hermanos = todos
    .filter((h) => h.activo || h.id === usuario)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  el.innerHTML = `
    <div class="form-centrado">
      <h1>Configuración</h1>
      ${completa ? '' : `<div class="aviso">Elegí tu usuario y cargá la clave compartida para empezar a usar la app.</div>`}

      <form id="form-config" class="tarjeta" autocomplete="off" novalidate>
        <div class="campo">
          <span class="label">¿Quién sos?</span>
          <div class="segmentado">
            ${hermanos.map((h) => `
              <label>
                <input type="radio" name="usuario" value="${esc(h.id)}" ${h.id === usuario ? 'checked' : ''} required>
                <span>${esc(h.nombre)}</span>
              </label>`).join('')}
          </div>
        </div>

        <div class="campo">
          <label for="clave">Clave compartida</label>
          <div class="con-boton">
            <input id="clave" name="clave" type="password" value="${esc(clave)}" required autocomplete="off">
            <button type="button" class="btn" id="ver-clave" aria-label="Mostrar clave">Ver</button>
          </div>
          <div class="ayuda">La misma para los tres. Se valida al sincronizar.</div>
        </div>

        <div class="campo">
          <span class="label">Tipo de dólar por defecto</span>
          <div class="segmentado">
            ${[['MEP', 'MEP'], ['OFICIAL', 'Oficial']].map(([valor, texto]) => `
              <label>
                <input type="radio" name="tipoDolar" value="${valor}" ${valor === tipoDolar ? 'checked' : ''}>
                <span>${texto}</span>
              </label>`).join('')}
          </div>
        </div>

        <button type="submit" class="btn btn-primario btn-bloque">Guardar</button>
      </form>

      <h2>Sincronización</h2>
      <div class="tarjeta" id="tarjeta-sync">
        <div class="fila-dato"><span>Estado</span><strong id="sync-estado">…</strong></div>
        <div class="fila-dato"><span>Pendientes</span><span id="sync-pendientes">…</span></div>
        <div class="fila-dato"><span>Última sincronización</span><span id="sync-ultima">…</span></div>
        <div class="panel-error" id="sync-error" hidden></div>
        <div class="acciones">
          <button type="button" class="btn" id="sync-panel">Ver detalle</button>
          <button type="button" class="btn btn-primario" id="sync-ahora" ${APPS_SCRIPT_URL ? '' : 'disabled'}>Sincronizar ahora</button>
        </div>
      </div>

      <h2>Registro de errores</h2>
      <a class="tarjeta tarjeta-boton enlace-tarjeta" href="#/config/errores">
        <span>Ver los errores registrados en este dispositivo <span class="badge-nav badge-inline" data-badge-errores hidden></span></span>
        <span aria-hidden="true">›</span>
      </a>

      <h2>Importar movimientos</h2>
      <div class="tarjeta">
        <p class="detalle" style="margin-top:0">
          1. Descargá la plantilla Excel: trae una pestaña con las instrucciones y otra para cargar los movimientos.<br>
          2. Completala y elegila acá (.xlsx o .csv). Antes de guardar vas a poder revisar y corregir los errores.
        </p>
        <div class="acciones">
          <button type="button" class="btn" id="descargar-plantilla">Descargar plantilla</button>
          <label class="btn btn-primario" for="archivo-import">Elegir archivo…</label>
        </div>
        <input type="file" id="archivo-import" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden>
      </div>

      <h2>Aplicación</h2>
      <div class="tarjeta">
        <div class="fila-dato"><span>Versión</span><strong>${esc(APP_VERSION)}</strong></div>
        <button type="button" class="btn btn-bloque" id="buscar-act">Buscar actualizaciones</button>
      </div>
    </div>`;

  const form = $('#form-config', el);

  // Estado de sync en vivo (se desuscribe cuando la vista deja de estar en pantalla).
  const tarjeta = $('#tarjeta-sync', el);
  const desuscribir = alCambiarEstado(async (e) => {
    if (!tarjeta.isConnected) { desuscribir?.(); return; }
    const corriendo = e.estado === 'sincronizando';
    $('#sync-estado', el).textContent = corriendo ? `Sincronizando ${e.progreso?.porcentaje ?? 0}%` : DESCRIPCION_ESTADO[e.estado];
    $('#sync-pendientes', el).textContent = e.pendientes;
    const caja = $('#sync-error', el);
    caja.hidden = !e.error || corriendo;
    if (e.error) {
      caja.innerHTML = `<strong>${esc(e.error.codigo)}</strong> · ${esc(e.error.mensaje)}${
        e.error.codigo === 'E-CLAVE' ? ' <button type="button" class="btn-link" data-ir="clave">Revisar la clave</button>' : ''}${
        e.error.id ? ` <a class="btn-link" href="#/config/errores/${e.error.id}">Ver en el registro</a>` : ''}`;
    }
    // No se puede iniciar otro sync mientras hay uno en curso.
    const btn = $('#sync-ahora', el);
    btn.disabled = corriendo || !APPS_SCRIPT_URL;
    btn.textContent = corriendo ? 'Sincronizando…' : 'Sincronizar ahora';
    $('#sync-ultima', el).textContent = fechaHora(await ajustes.obtener('ultimaSyncLocal'));
  });
  // El badge de errores nuevos de esta tarjeta lo actualiza app.js (data-badge-errores).
  window.dispatchEvent(new CustomEvent('log-visto'));

  $('#sync-error', el).addEventListener('click', (e) => {
    if (e.target.closest('[data-ir="clave"]')) { $('#clave', el).focus(); $('#clave', el).select(); }
  });
  $('#sync-panel', el).addEventListener('click', () => abrirPanelSync());
  $('#sync-ahora', el).addEventListener('click', async () => {
    const r = await sincronizar();
    // Los errores ya se muestran como toast (y en la tarjeta); acá solo el éxito.
    if (r.ok) toast(r.cambios ? `Sincronizado (${r.cambios} cambios)` : 'Sincronizado', { tipo: 'exito' });
  });

  $('#ver-clave', el).addEventListener('click', (e) => {
    const input = $('#clave', el);
    const oculto = input.type === 'password';
    input.type = oculto ? 'text' : 'password';
    e.currentTarget.textContent = oculto ? 'Ocultar' : 'Ver';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = new FormData(form);
    const nuevoUsuario = datos.get('usuario');
    const nuevaClave = String(datos.get('clave') || '').trim();
    limpiarErroresCampos(form);
    if (!nuevoUsuario) marcarErrorCampo(form.querySelector('input[name="usuario"]'), 'Elegí quién sos.');
    if (!nuevaClave) marcarErrorCampo($('#clave', el), 'Cargá la clave compartida.');
    if (!nuevoUsuario || !nuevaClave) return;
    await ajustes.guardar('usuario', nuevoUsuario);
    await ajustes.guardar('clave', nuevaClave);
    await ajustes.guardar('tipoDolar', datos.get('tipoDolar') || 'MEP');
    toast('Configuración guardada');
    if (nuevaClave !== clave) sincronizar();
    if (!completa) navegar('/movimientos');
    else render(el);
  });

  $('#descargar-plantilla', el).addEventListener('click', () => descargarPlantilla());

  $('#archivo-import', el).addEventListener('change', async (e) => {
    const archivo = e.target.files[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (!archivo) return;
    const catalogos = await cargarCatalogos();
    const { filas, error } = await leerArchivo(archivo, catalogos);
    if (error) { toast(error, { tipo: 'advertencia', duracion: 7000 }); return; }
    iniciarRevision(filas, catalogos, archivo.name);
    navegar('/importar');
  });

  $('#buscar-act', el).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Buscando…';
    const { nueva, inconsistente } = navigator.onLine ? await verificarYMostrar() : {};
    btn.disabled = false;
    btn.textContent = 'Buscar actualizaciones';
    if (!navigator.onLine) toast('Sin conexión');
    else if (inconsistente) {
      if (confirm(`Hay una versión publicada (${inconsistente}) que no se terminó de instalar (la app sigue en ${APP_VERSION}).\n\n`
        + '¿Forzar la actualización? Se vuelve a descargar la app; tus datos no se borran.')) forzarActualizacion();
    }
    else toast(nueva ? `Hay una versión nueva: ${nueva}` : 'Ya tenés la última versión');
  });
}
