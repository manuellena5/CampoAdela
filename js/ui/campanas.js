// ABM de campañas. Se permiten superposiciones de fechas, con aviso.

import { listar, crear, actualizar, borrar, contarMovimientos } from '../db.js';
import { HECTAREAS_DEFAULT } from '../config.js';
import { abrirDialogo } from '../lib/dialogo.js';
import { esc, toast } from '../lib/dom.js';
import { formatoFecha, formatoNumero, parsearMonto } from '../lib/formato.js';
import { navegar } from '../router.js';

const ESTADOS = ['planificada', 'en curso', 'cerrada'];

// Campañas (distintas de `campana`) cuyas fechas se superponen con ella.
// Sin fecha de fin se considera abierta hacia adelante; sin inicio, no se compara.
export function superpuestas(campana, todas) {
  if (!campana.fechaInicio) return [];
  const fin = (c) => c.fechaFin || '9999-12-31';
  return todas.filter((c) => c.id !== campana.id && c.fechaInicio
    && c.fechaInicio <= fin(campana) && campana.fechaInicio <= fin(c));
}

export async function render(el) {
  const campanas = await listar('campanas');
  campanas.sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || ''));

  el.innerHTML = `
    <div class="form-centrado">
      <div class="encabezado">
        <h1>Campañas</h1>
        <button type="button" class="btn btn-primario" data-accion="nueva">+ Campaña</button>
      </div>
      ${campanas.length ? '' : '<div class="tarjeta vacio">Todavía no hay campañas. Creá la primera, por ejemplo "Soja 25-26".</div>'}
      ${campanas.map((c) => {
        const sup = superpuestas(c, campanas);
        return `
          <div class="tarjeta tarjeta-boton" role="button" tabindex="0" data-accion="resumen" data-id="${esc(c.id)}"
            title="Ver el resumen de la campaña">
            <div class="item-fila">
              <strong>${esc(c.nombre)}</strong>
              <span class="item-acciones">
                <span class="badge estado-${c.estado.replace(' ', '-')}">${esc(c.estado)}</span>
                <button type="button" class="btn-icono" data-accion="editar" data-id="${esc(c.id)}"
                  aria-label="Editar ${esc(c.nombre)}" title="Editar campaña">✏️</button>
              </span>
            </div>
            <div class="detalle">
              ${[c.cultivo, c.hectareas ? `${formatoNumero(c.hectareas)} ha` : ''].filter(Boolean).map(esc).join(' · ')}
            </div>
            <div class="detalle">${rangoFechas(c)}</div>
            ${sup.length ? `<div class="aviso-chico">Se superpone con ${sup.map((s) => esc(s.nombre)).join(', ')}</div>` : ''}
          </div>`;
      }).join('')}
    </div>`;

  // closest() toma el elemento más cercano: el ✏️ (editar) gana sobre la tarjeta (resumen).
  const accionar = async (btn) => {
    const campana = campanas.find((c) => c.id === btn.dataset.id);
    if (btn.dataset.accion === 'resumen') { navegar(`/resumen/${campana.id}`); return; }
    if (await editar(campana, campanas)) render(el);
  };
  el.onclick = (e) => {
    const btn = e.target.closest('[data-accion]');
    if (btn) accionar(btn);
  };
  el.onkeydown = (e) => {
    if (e.key === 'Enter' && e.target.matches('.tarjeta-boton[data-accion]')) accionar(e.target);
  };
}

function rangoFechas(c) {
  if (!c.fechaInicio && !c.fechaFin) return 'Sin fechas';
  return `${c.fechaInicio ? formatoFecha(c.fechaInicio) : '…'} → ${c.fechaFin ? formatoFecha(c.fechaFin) : '…'}`;
}

async function editar(campana, todas) {
  const usos = campana ? await contarMovimientos('campanaId', campana.id) : 0;
  const estado = campana?.estado || 'planificada';

  const res = await abrirDialogo({
    titulo: campana ? 'Editar campaña' : 'Nueva campaña',
    cuerpo: `
      <div class="campo">
        <label for="k-nombre">Nombre</label>
        <input id="k-nombre" name="nombre" required placeholder="Soja 25-26" value="${esc(campana?.nombre)}">
      </div>
      <div class="campo">
        <label for="k-cultivo">Cultivo</label>
        <input id="k-cultivo" name="cultivo" placeholder="Soja" value="${esc(campana?.cultivo)}">
      </div>
      <div class="fila-2">
        <div class="campo">
          <label for="k-inicio">Fecha inicio</label>
          <input id="k-inicio" name="fechaInicio" type="date" value="${esc(campana?.fechaInicio)}">
        </div>
        <div class="campo">
          <label for="k-fin">Fecha fin</label>
          <input id="k-fin" name="fechaFin" type="date" value="${esc(campana?.fechaFin)}">
        </div>
      </div>
      <div class="campo">
        <label for="k-ha">Hectáreas</label>
        <input id="k-ha" name="hectareas" inputmode="decimal" required value="${esc(formatoNumero(campana?.hectareas ?? HECTAREAS_DEFAULT))}">
      </div>
      <div class="campo">
        <span class="label">Estado</span>
        <div class="segmentado">
          ${ESTADOS.map((e) => `<label><input type="radio" name="estado" value="${e}" ${e === estado ? 'checked' : ''}><span>${e[0].toUpperCase() + e.slice(1)}</span></label>`).join('')}
        </div>
      </div>
      <div class="campo">
        <label for="k-notas">Notas</label>
        <textarea id="k-notas" name="notas" rows="3">${esc(campana?.notas)}</textarea>
      </div>`,
    botones: [
      { accion: 'guardar', texto: 'Guardar', clase: 'btn-primario' },
      ...(campana ? [{ accion: 'borrar', texto: 'Borrar', clase: 'btn-peligro' }] : []),
    ],
    validar: (accion, d) => {
      if (accion === 'borrar') {
        return usos ? `Tiene ${usos} movimiento(s) asociados: no se puede borrar. Podés marcarla como cerrada.` : null;
      }
      if (d.fechaInicio && d.fechaFin && d.fechaFin < d.fechaInicio) return 'La fecha de fin es anterior a la de inicio.';
      const ha = parsearMonto(d.hectareas);
      if (!(ha > 0)) return 'Las hectáreas tienen que ser un número mayor a 0.';
      if (todas.some((c) => c.id !== campana?.id && c.nombre.trim().toLowerCase() === d.nombre.trim().toLowerCase())) {
        return 'Ya existe una campaña con ese nombre.';
      }
      return null;
    },
  });
  if (!res) return false;

  if (res.accion === 'borrar') {
    if (!confirm(`¿Borrar la campaña "${campana.nombre}"?`)) return false;
    await borrar('campanas', campana.id);
    toast('Campaña borrada');
    return true;
  }

  const d = res.datos;
  const datos = {
    nombre: d.nombre.trim(),
    cultivo: d.cultivo.trim(),
    fechaInicio: d.fechaInicio || '',
    fechaFin: d.fechaFin || '',
    hectareas: parsearMonto(d.hectareas),
    estado: d.estado || 'planificada',
    notas: d.notas.trim(),
  };
  const guardada = campana ? { ...campana, ...datos } : null;
  if (campana) await actualizar('campanas', campana.id, datos);
  else await crear('campanas', datos);

  const sup = superpuestas(guardada || { id: null, ...datos }, todas);
  toast(sup.length ? `Guardada. Aviso: se superpone con ${sup.map((s) => s.nombre).join(', ')}` : 'Guardada', sup.length ? 4500 : 2500);
  return true;
}
