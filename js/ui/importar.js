// Revisión de una importación: muestra errores por fila y permite corregirlos o ignorar la fila.

import { validar, importar, esDuplicado } from '../importacion.js';
import { PAGO_CAJA } from '../dominio.js';
import { esc, $, toast } from '../lib/dom.js';
import { formatoFecha, parsearMonto, formatoARS, formatoUSD } from '../lib/formato.js';
import { navegar } from '../router.js';

// Importación en curso (la carga Configuración al elegir el archivo).
let sesion = null;

export function iniciarRevision(filas, catalogos, nombreArchivo) {
  sesion = { filas, cat: catalogos, nombreArchivo };
}

export async function render(el) {
  if (!sesion) { navegar('/configuracion'); return; }
  const { filas, cat, nombreArchivo } = sesion;

  const nombre = (lista, id) => lista.find((x) => x.id === id)?.nombre || '';
  const estadoDe = (f) => {
    const errores = validar(f.valores, f.crudo, cat);
    return { errores, duplicado: esDuplicado(f.valores, cat) };
  };
  const estados = new Map(filas.map((f) => [f, estadoDe(f)]));
  const conErrores = filas.filter((f) => !f.ignorar && estados.get(f).errores.length);
  const listas = filas.filter((f) => !f.ignorar && !estados.get(f).errores.length);
  const ignoradas = filas.filter((f) => f.ignorar);
  const aRevisar = filas.filter((f) => f.ignorar || estados.get(f).errores.length || estados.get(f).duplicado);

  const resumenFila = (f) => {
    const v = f.valores;
    const monto = parsearMonto(v.monto);
    const montoTxt = monto > 0 ? (v.moneda === 'USD' ? formatoUSD(monto) : formatoARS(monto)) : esc(f.crudo.monto || '—');
    return `${v.fecha ? formatoFecha(v.fecha) : esc(f.crudo.fecha || 'sin fecha')} · ${esc(nombre(cat.categorias, v.categoriaId) || f.crudo.categoria || '¿categoría?')} · ${montoTxt}`;
  };

  const opciones = (lista, actual, vacio) => `${vacio !== undefined ? `<option value="">${esc(vacio)}</option>` : ''}`
    + lista.map((x) => `<option value="${esc(x.id)}" ${x.id === actual ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('');
  const orden = (a, b) => (a.orden ?? 0) - (b.orden ?? 0);

  const editor = (f, i) => {
    const v = f.valores;
    const errores = estados.get(f).errores;
    const mal = (campo) => (errores.some((e) => e.campo === campo) ? 'campo-error' : '');
    const subs = cat.subcategorias.filter((s) => s.categoriaId === v.categoriaId).sort(orden);
    return `
      <div class="editor-fila" data-fila="${i}">
        <label class="${mal('fecha')}">Fecha<input type="date" data-campo="fecha" value="${esc(v.fecha)}"></label>
        <label class="${mal('categoria')}">Categoría
          <select data-campo="categoriaId">
            <option value="">Elegí…</option>
            <optgroup label="Gastos">${opciones(cat.categorias.filter((c) => c.tipo === 'gasto').sort(orden), v.categoriaId)}</optgroup>
            <optgroup label="Ingresos">${opciones(cat.categorias.filter((c) => c.tipo === 'ingreso').sort(orden), v.categoriaId)}</optgroup>
          </select>
        </label>
        <label class="${mal('subcategoria')}">Subcategoría
          <select data-campo="subcategoriaId" ${subs.length ? '' : 'disabled'}>${opciones(subs, v.subcategoriaId, '—')}</select>
        </label>
        <label class="${mal('campana')}">Campaña
          <select data-campo="campanaId">${opciones(cat.campanas, v.campanaId, 'Sin campaña')}</select>
        </label>
        <label class="${mal('moneda')}">Moneda
          <select data-campo="moneda">
            ${['ARS', 'USD'].map((m) => `<option ${m === v.moneda ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </label>
        <label class="${mal('monto')}">Monto<input inputmode="decimal" data-campo="monto" value="${esc(v.monto)}"></label>
        <label class="${mal('tipoDolar')}">Tipo de dólar
          <select data-campo="tipoDolar">
            ${[['MEP', 'MEP'], ['OFICIAL', 'Oficial']].map(([k, t]) => `<option value="${k}" ${k === v.tipoDolar ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </label>
        <label class="${mal('cotizacion')}">Cotización<input inputmode="decimal" data-campo="cotizacion" placeholder="automática" value="${esc(v.cotizacion)}"></label>
        <label class="${mal('pago')}">Pagó
          <select data-campo="pagoId">
            <option value="${PAGO_CAJA}" ${v.pagoId === PAGO_CAJA ? 'selected' : ''}>Caja común</option>
            ${opciones(cat.hermanos.filter((h) => h.activo || h.id === v.pagoId), v.pagoId, v.pagoId ? undefined : 'Elegí…')}
          </select>
        </label>
        <label class="${mal('quintales')}">Quintales<input inputmode="decimal" data-campo="quintales" value="${esc(v.quintales)}"></label>
        <label class="${mal('precioQq')}">Precio por qq<input inputmode="decimal" data-campo="precioQq" value="${esc(v.precioQq)}"></label>
        <label class="editor-ancho">Descripción<input data-campo="descripcion" value="${esc(v.descripcion)}"></label>
      </div>`;
  };

  const tarjeta = (f) => {
    const i = filas.indexOf(f);
    const { errores, duplicado } = estados.get(f);
    const clase = f.ignorar ? 'fila-ignorada' : errores.length ? 'fila-con-error' : 'fila-aviso';
    return `
      <div class="tarjeta fila-import ${clase}">
        <div class="item-fila">
          <strong>Fila ${f.nro}</strong>
          <label class="check check-chico"><input type="checkbox" data-ignorar="${i}" ${f.ignorar ? 'checked' : ''}> Ignorar esta fila</label>
        </div>
        <div class="detalle">${resumenFila(f)}</div>
        ${duplicado ? '<div class="aviso-chico">Posible duplicado: ya hay un movimiento con la misma fecha, categoría y monto.</div>' : ''}
        ${!f.ignorar && errores.length ? `<ul class="lista-errores">${errores.map((e) => `<li>${esc(e.mensaje)}</li>`).join('')}</ul>${editor(f, i)}` : ''}
      </div>`;
  };

  el.innerHTML = `
    <div class="form-centrado ancho-import">
      <h1>Revisar importación</h1>
      <p class="detalle">${esc(nombreArchivo)} · ${filas.length} fila${filas.length === 1 ? '' : 's'} con datos</p>

      <div class="totales">
        <div class="total ingreso"><div class="total-titulo">Listas</div><div class="total-valor">${listas.length}</div></div>
        <div class="total gasto"><div class="total-titulo">Con errores</div><div class="total-valor">${conErrores.length}</div></div>
        <div class="total"><div class="total-titulo">Ignoradas</div><div class="total-valor">${ignoradas.length}</div></div>
      </div>

      ${conErrores.length ? `
        <div class="aviso">
          Hay ${conErrores.length} fila${conErrores.length === 1 ? '' : 's'} con errores. Corregilas acá abajo o ignoralas.
          <div><button type="button" class="btn-link" id="ignorar-errores">Ignorar todas las filas con errores</button></div>
        </div>` : ''}

      ${aRevisar.map(tarjeta).join('')}

      ${listas.length ? `
        <details class="tarjeta">
          <summary><strong>${listas.length} fila${listas.length === 1 ? '' : 's'} lista${listas.length === 1 ? '' : 's'} para importar</strong></summary>
          <ul class="lista-simple">${listas.map((f) => `<li>Fila ${f.nro}: ${resumenFila(f)}</li>`).join('')}</ul>
        </details>` : ''}

      <div class="acciones acciones-import">
        <button type="button" class="btn" id="cancelar-import">Cancelar</button>
        <button type="button" class="btn btn-primario" id="confirmar-import" ${!listas.length || conErrores.length ? 'disabled' : ''}>
          Importar ${listas.length} movimiento${listas.length === 1 ? '' : 's'}
        </button>
      </div>
      ${conErrores.length ? '<p class="ayuda">Para importar, corregí o ignorá las filas con errores.</p>' : ''}
      <p class="ayuda">Las filas sin cotización toman la del día (o la última conocida si no hay conexión).</p>
    </div>`;

  el.onchange = (e) => {
    const t = e.target;
    if (t.dataset.ignorar !== undefined) {
      filas[Number(t.dataset.ignorar)].ignorar = t.checked;
      render(el);
      return;
    }
    const contenedor = t.closest('[data-fila]');
    if (!contenedor || !t.dataset.campo) return;
    const f = filas[Number(contenedor.dataset.fila)];
    f.valores[t.dataset.campo] = t.value;
    // Lo corregido a mano deja de validarse contra lo que decía el archivo.
    const origen = { categoriaId: 'categoria', subcategoriaId: 'subcategoria', campanaId: 'campana', pagoId: 'pago' }[t.dataset.campo] || t.dataset.campo;
    delete f.crudo[origen];
    if (t.dataset.campo === 'categoriaId') { f.valores.subcategoriaId = ''; delete f.crudo.subcategoria; }
    render(el);
  };

  el.onclick = async (e) => {
    if (e.target.id === 'ignorar-errores') {
      filas.forEach((f) => { if (estados.get(f).errores.length) f.ignorar = true; });
      render(el);
    } else if (e.target.id === 'cancelar-import') {
      sesion = null;
      navegar('/configuracion');
    } else if (e.target.id === 'confirmar-import') {
      const btn = e.target;
      btn.disabled = true;
      const { importados, fallidos } = await importar(filas, (n, total) => { btn.textContent = `Importando ${n} de ${total}…`; });
      sesion = null;
      if (fallidos.length) {
        toast(`${importados} importados. ${fallidos.length} fallaron: ${fallidos.map((f) => `fila ${f.nro}`).join(', ')}`, 7000);
      } else {
        toast(`${importados} movimiento${importados === 1 ? '' : 's'} importado${importados === 1 ? '' : 's'}`);
      }
      navegar('/movimientos');
    }
  };
}
