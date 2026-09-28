// ABM de categorías y subcategorías: agrupadas por tipo, con alta, edición,
// desactivar, reordenar y borrar (solo si no tienen movimientos).

import { listar, crear, actualizar, borrar, contarMovimientos, mover, db } from '../db.js';
import { abrirDialogo } from '../lib/dialogo.js';
import { esc, toast } from '../lib/dom.js';

const TIPOS = [['gasto', 'Gastos'], ['ingreso', 'Ingresos']];

export async function render(el) {
  const [categorias, subcategorias] = await Promise.all([listar('categorias'), listar('subcategorias')]);
  const porOrden = (a, b) => a.orden - b.orden;
  const subsDe = (catId) => subcategorias.filter((s) => s.categoriaId === catId).sort(porOrden);

  const botonesOrden = (tabla, id, i, total) => `
    <button type="button" class="btn-icono" data-accion="subir" data-tabla="${tabla}" data-id="${esc(id)}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
    <button type="button" class="btn-icono" data-accion="bajar" data-tabla="${tabla}" data-id="${esc(id)}" ${i === total - 1 ? 'disabled' : ''} aria-label="Bajar">↓</button>`;

  el.innerHTML = `
    <div class="form-centrado">
      <div class="encabezado">
        <h1>Categorías</h1>
        <button type="button" class="btn btn-primario" data-accion="nueva-cat">+ Categoría</button>
      </div>
      ${TIPOS.map(([tipo, titulo]) => {
        const cats = categorias.filter((c) => c.tipo === tipo).sort(porOrden);
        return `
          <h2 class="titulo-grupo ${tipo}">${titulo}</h2>
          <div class="tarjeta lista">
            ${cats.length ? '' : '<div class="item vacio-chico">Sin categorías</div>'}
            ${cats.map((c, i) => {
              const subs = subsDe(c.id);
              return `
                <div class="item-grupo ${c.activa ? '' : 'inactivo'}">
                  <div class="item">
                    <button type="button" class="item-nombre enlace" data-accion="editar-cat" data-id="${esc(c.id)}">
                      ${esc(c.nombre)} ${c.activa ? '' : '<span class="badge">inactiva</span>'}
                    </button>
                    <span class="item-acciones">${botonesOrden('categorias', c.id, i, cats.length)}</span>
                  </div>
                  <div class="subitems">
                    ${subs.map((s, j) => `
                      <div class="item subitem ${s.activa ? '' : 'inactivo'}">
                        <button type="button" class="item-nombre enlace" data-accion="editar-sub" data-id="${esc(s.id)}">
                          ${esc(s.nombre)} ${s.activa ? '' : '<span class="badge">inactiva</span>'}
                        </button>
                        <span class="item-acciones">${botonesOrden('subcategorias', s.id, j, subs.length)}</span>
                      </div>`).join('')}
                    <button type="button" class="btn-link" data-accion="nueva-sub" data-id="${esc(c.id)}">+ Subcategoría</button>
                  </div>
                </div>`;
            }).join('')}
          </div>`;
      }).join('')}
    </div>`;

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-accion]');
    if (!btn) return;
    const { accion, id, tabla } = btn.dataset;
    let cambio = false;

    if (accion === 'subir' || accion === 'bajar') {
      const delta = accion === 'subir' ? -1 : 1;
      if (tabla === 'categorias') {
        const cat = categorias.find((c) => c.id === id);
        await mover('categorias', categorias.filter((c) => c.tipo === cat.tipo), id, delta);
      } else {
        const sub = subcategorias.find((s) => s.id === id);
        await mover('subcategorias', subsDe(sub.categoriaId), id, delta);
      }
      cambio = true;
    } else if (accion === 'nueva-cat') {
      cambio = await editarCategoria(null, categorias, subcategorias);
    } else if (accion === 'editar-cat') {
      cambio = await editarCategoria(categorias.find((c) => c.id === id), categorias, subcategorias);
    } else if (accion === 'nueva-sub') {
      cambio = await editarSubcategoria(null, id, subcategorias);
    } else if (accion === 'editar-sub') {
      const sub = subcategorias.find((s) => s.id === id);
      cambio = await editarSubcategoria(sub, sub.categoriaId, subcategorias);
    }
    if (cambio) render(el);
  };
}

const mismoNombre = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function editarCategoria(cat, categorias, subcategorias) {
  const usos = cat ? await contarMovimientos('categoriaId', cat.id) : 0;
  const tipoActual = cat?.tipo || 'gasto';

  const res = await abrirDialogo({
    titulo: cat ? 'Editar categoría' : 'Nueva categoría',
    cuerpo: `
      <div class="campo">
        <label for="c-nombre">Nombre</label>
        <input id="c-nombre" name="nombre" required value="${esc(cat?.nombre)}">
      </div>
      <div class="campo">
        <span class="label">Tipo</span>
        <div class="segmentado">
          ${TIPOS.map(([t, texto]) => `
            <label><input type="radio" name="tipo" value="${t}" ${t === tipoActual ? 'checked' : ''} ${usos ? 'disabled' : ''}><span>${texto.slice(0, -1)}</span></label>`).join('')}
        </div>
        ${usos ? `<div class="ayuda">Tiene ${usos} movimiento(s): no se puede cambiar el tipo.</div>` : ''}
      </div>
      <label class="check"><input type="checkbox" name="activa" ${cat?.activa === false ? '' : 'checked'}> Activa</label>`,
    botones: [
      { accion: 'guardar', texto: 'Guardar', clase: 'btn-primario' },
      ...(cat ? [{ accion: 'borrar', texto: 'Borrar', clase: 'btn-peligro' }] : []),
    ],
    validar: (accion, d) => {
      if (accion === 'borrar') {
        return usos ? `Tiene ${usos} movimiento(s) asociados: no se puede borrar, solo desactivar.` : null;
      }
      const tipo = d.tipo || tipoActual;
      return categorias.some((c) => c.id !== cat?.id && c.tipo === tipo && mismoNombre(c.nombre, d.nombre))
        ? { campo: 'nombre', mensaje: 'Ya existe una categoría con ese nombre.' } : null;
    },
  });
  if (!res) return false;

  if (res.accion === 'borrar') {
    if (!confirm(`¿Borrar la categoría "${cat.nombre}" y sus subcategorías?`)) return false;
    await db.transaction('rw', db.categorias, db.subcategorias, async () => {
      for (const s of subcategorias.filter((s) => s.categoriaId === cat.id)) await borrar('subcategorias', s.id);
      await borrar('categorias', cat.id);
    });
    toast('Categoría borrada');
    return true;
  }

  const datos = { nombre: res.datos.nombre.trim(), tipo: res.datos.tipo || tipoActual, activa: res.datos.activa === 'on' };
  if (cat) {
    // Si cambia de tipo, pasa al final de la lista de su nuevo tipo.
    if (datos.tipo !== cat.tipo) datos.orden = siguienteOrden(categorias.filter((c) => c.tipo === datos.tipo));
    await actualizar('categorias', cat.id, datos);
  } else {
    await crear('categorias', { ...datos, orden: siguienteOrden(categorias.filter((c) => c.tipo === datos.tipo)) });
  }
  toast('Guardado');
  return true;
}

async function editarSubcategoria(sub, categoriaId, subcategorias) {
  const usos = sub ? await contarMovimientos('subcategoriaId', sub.id) : 0;
  const hermanas = subcategorias.filter((s) => s.categoriaId === categoriaId);

  const res = await abrirDialogo({
    titulo: sub ? 'Editar subcategoría' : 'Nueva subcategoría',
    cuerpo: `
      <div class="campo">
        <label for="s-nombre">Nombre</label>
        <input id="s-nombre" name="nombre" required value="${esc(sub?.nombre)}">
      </div>
      <label class="check"><input type="checkbox" name="activa" ${sub?.activa === false ? '' : 'checked'}> Activa</label>`,
    botones: [
      { accion: 'guardar', texto: 'Guardar', clase: 'btn-primario' },
      ...(sub ? [{ accion: 'borrar', texto: 'Borrar', clase: 'btn-peligro' }] : []),
    ],
    validar: (accion, d) => {
      if (accion === 'borrar') {
        return usos ? `Tiene ${usos} movimiento(s) asociados: no se puede borrar, solo desactivar.` : null;
      }
      return hermanas.some((s) => s.id !== sub?.id && mismoNombre(s.nombre, d.nombre))
        ? { campo: 'nombre', mensaje: 'Ya existe una subcategoría con ese nombre.' } : null;
    },
  });
  if (!res) return false;

  if (res.accion === 'borrar') {
    if (!confirm(`¿Borrar la subcategoría "${sub.nombre}"?`)) return false;
    await borrar('subcategorias', sub.id);
    toast('Subcategoría borrada');
    return true;
  }

  const datos = { nombre: res.datos.nombre.trim(), activa: res.datos.activa === 'on' };
  if (sub) await actualizar('subcategorias', sub.id, datos);
  else await crear('subcategorias', { ...datos, categoriaId, orden: siguienteOrden(hermanas) });
  toast('Guardado');
  return true;
}

function siguienteOrden(lista) {
  return lista.reduce((max, r) => Math.max(max, r.orden || 0), 0) + 1;
}
