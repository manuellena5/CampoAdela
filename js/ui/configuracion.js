// Pantalla Configuración: usuario, clave compartida, tipo de dólar, sincronización, versión.

import { APP_VERSION, APPS_SCRIPT_URL } from '../config.js';
import * as ajustes from '../ajustes.js';
import { listar } from '../db.js';
import { verificarYMostrar } from '../actualizacion.js';
import { sincronizar, alCambiarEstado } from '../sync.js';
import { esc, $, toast } from '../lib/dom.js';
import { formatoFechaHora } from '../lib/formato.js';
import { navegar } from '../router.js';

const DESCRIPCION_ESTADO = {
  'sin-config': 'Falta la URL del Apps Script en js/config.js',
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

      <form id="form-config" class="tarjeta" autocomplete="off">
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
        <div class="dialogo-error" id="sync-error" hidden></div>
        <button type="button" class="btn btn-bloque" id="sync-ahora" ${APPS_SCRIPT_URL ? '' : 'disabled'}>Sincronizar ahora</button>
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
    $('#sync-estado', el).textContent = DESCRIPCION_ESTADO[e.estado];
    $('#sync-pendientes', el).textContent = e.pendientes;
    $('#sync-error', el).textContent = e.error;
    $('#sync-error', el).hidden = !e.error;
    $('#sync-ultima', el).textContent = fechaHora(await ajustes.obtener('ultimaSyncLocal'));
  });

  $('#sync-ahora', el).addEventListener('click', async (e) => {
    const btn = e.currentTarget; // después del await, currentTarget es null
    btn.disabled = true;
    const r = await sincronizar();
    btn.disabled = false;
    if (r.ok) toast(r.cambios ? `Sincronizado (${r.cambios} cambios)` : 'Sincronizado');
    else if (!navigator.onLine) toast('Sin conexión');
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
    if (!nuevoUsuario || !nuevaClave) {
      toast('Completá usuario y clave');
      return;
    }
    await ajustes.guardar('usuario', nuevoUsuario);
    await ajustes.guardar('clave', nuevaClave);
    await ajustes.guardar('tipoDolar', datos.get('tipoDolar') || 'MEP');
    toast('Configuración guardada');
    if (nuevaClave !== clave) sincronizar();
    if (!completa) navegar('/movimientos');
    else render(el);
  });

  $('#buscar-act', el).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Buscando…';
    const { nueva, inconsistente } = navigator.onLine ? await verificarYMostrar() : {};
    btn.disabled = false;
    btn.textContent = 'Buscar actualizaciones';
    if (!navigator.onLine) toast('Sin conexión');
    else if (inconsistente) toast(`Publicada: ${inconsistente}, pero la app dice ${APP_VERSION}. Revisar APP_VERSION en js/config.js.`, 6000);
    else toast(nueva ? `Hay una versión nueva: ${nueva}` : 'Ya tenés la última versión');
  });
}
