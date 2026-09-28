// Listado de movimientos (versión simple; filtros y totales en la Fase 5).

import { listar } from '../db.js';
import { esc } from '../lib/dom.js';
import { formatoARS, formatoUSD, formatoFecha } from '../lib/formato.js';

export async function render(el) {
  const [movimientos, categorias] = await Promise.all([listar('movimientos'), listar('categorias')]);
  const cat = Object.fromEntries(categorias.map((c) => [c.id, c]));
  movimientos.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado.localeCompare(a.creado));

  el.innerHTML = `
    <div class="form-centrado">
      <div class="encabezado">
        <h1>Movimientos</h1>
        <a class="btn btn-primario" href="#/movimientos/nuevo">+ Nuevo</a>
      </div>
      ${movimientos.length ? '' : '<div class="tarjeta vacio">Todavía no hay movimientos cargados.</div>'}
      <div class="tarjeta lista">
        ${movimientos.slice(0, 50).map((m) => {
          const c = cat[m.categoriaId];
          return `
            <a class="item item-boton" href="#/movimientos/${esc(m.id)}">
              <span>
                <span class="item-nombre">${esc(c?.nombre || '¿?')}</span>
                ${m.tcEstado === 'a_confirmar' ? '<span class="badge badge-a-confirmar">TC a confirmar</span>' : ''}
                <span class="detalle">${formatoFecha(m.fecha)}${m.descripcion ? ` · ${esc(m.descripcion)}` : ''}</span>
              </span>
              <span class="monto ${c?.tipo || ''}">${m.moneda === 'USD' ? formatoUSD(m.montoOriginal) : formatoARS(m.montoOriginal)}</span>
            </a>`;
        }).join('')}
      </div>
    </div>`;
}
