// ABM de hermanos: nombre y activo.

import { listar, crear, actualizar } from '../db.js';
import * as ajustes from '../ajustes.js';
import { abrirDialogo } from '../lib/dialogo.js';
import { esc, toast } from '../lib/dom.js';

export async function render(el) {
  const [hermanos, usuario] = await Promise.all([listar('hermanos'), ajustes.obtener('usuario')]);
  hermanos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  el.innerHTML = `
    <div class="form-centrado">
      <div class="encabezado">
        <h1>Hermanos</h1>
        <button type="button" class="btn btn-primario" data-accion="nuevo">+ Hermano</button>
      </div>
      <div class="tarjeta lista">
        ${hermanos.map((h) => `
          <button type="button" class="item item-boton ${h.activo ? '' : 'inactivo'}" data-accion="editar" data-id="${esc(h.id)}">
            <span class="item-nombre">${esc(h.nombre)}</span>
            <span>
              ${h.id === usuario ? '<span class="badge badge-verde">vos</span>' : ''}
              ${h.activo ? '' : '<span class="badge">inactivo</span>'}
            </span>
          </button>`).join('')}
      </div>
      <p class="ayuda">Un hermano inactivo no aparece para elegir, pero sus movimientos se conservan.</p>
    </div>`;

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-accion]');
    if (!btn) return;
    const hermano = hermanos.find((h) => h.id === btn.dataset.id);
    if (await editar(hermano, hermanos)) render(el);
  };
}

async function editar(hermano, todos) {
  const res = await abrirDialogo({
    titulo: hermano ? 'Editar hermano' : 'Nuevo hermano',
    cuerpo: `
      <div class="campo">
        <label for="h-nombre">Nombre</label>
        <input id="h-nombre" name="nombre" required value="${esc(hermano?.nombre)}">
      </div>
      <label class="check"><input type="checkbox" name="activo" ${hermano?.activo === false ? '' : 'checked'}> Activo</label>`,
    botones: [{ accion: 'guardar', texto: 'Guardar', clase: 'btn-primario' }],
    validar: (_, d) => (todos.some((h) => h.id !== hermano?.id && h.nombre.toLowerCase() === d.nombre.trim().toLowerCase())
      ? 'Ya existe un hermano con ese nombre.' : null),
  });
  if (!res) return false;
  const datos = { nombre: res.datos.nombre.trim(), activo: res.datos.activo === 'on' };
  if (hermano) await actualizar('hermanos', hermano.id, datos);
  else await crear('hermanos', datos);
  toast('Guardado');
  return true;
}
