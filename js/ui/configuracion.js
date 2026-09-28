// Pantalla Configuración: usuario, clave compartida, tipo de dólar, versión.

import { APP_VERSION, HERMANOS_SEED } from '../config.js';
import * as ajustes from '../ajustes.js';
import { verificarYMostrar } from '../actualizacion.js';
import { esc, $, toast } from '../lib/dom.js';
import { navegar } from '../router.js';

export async function render(el) {
  const [usuario, clave, tipoDolar, completa] = await Promise.all([
    ajustes.obtener('usuario'),
    ajustes.obtener('clave'),
    ajustes.obtener('tipoDolar'),
    ajustes.configuracionCompleta(),
  ]);

  el.innerHTML = `
    <div class="form-centrado">
      <h1>Configuración</h1>
      ${completa ? '' : `<div class="aviso">Elegí tu usuario y cargá la clave compartida para empezar a usar la app.</div>`}

      <form id="form-config" class="tarjeta" autocomplete="off">
        <div class="campo">
          <span class="label">¿Quién sos?</span>
          <div class="segmentado">
            ${HERMANOS_SEED.map((h) => `
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
      <div class="tarjeta">
        <div class="fila-dato"><span>Estado</span><span>No configurada</span></div>
        <button type="button" class="btn btn-bloque" disabled>Sincronizar ahora</button>
        <div class="ayuda">Disponible en la Fase 3.</div>
      </div>

      <h2>Aplicación</h2>
      <div class="tarjeta">
        <div class="fila-dato"><span>Versión</span><strong>${esc(APP_VERSION)}</strong></div>
        <button type="button" class="btn btn-bloque" id="buscar-act">Buscar actualizaciones</button>
      </div>
    </div>`;

  const form = $('#form-config', el);

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
    if (!completa) navegar('/movimientos');
    else render(el);
  });

  $('#buscar-act', el).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Buscando…';
    const nueva = navigator.onLine ? await verificarYMostrar() : null;
    btn.disabled = false;
    btn.textContent = 'Buscar actualizaciones';
    if (!navigator.onLine) toast('Sin conexión');
    else toast(nueva ? `Hay una versión nueva: ${nueva}` : 'Ya tenés la última versión');
  });
}
