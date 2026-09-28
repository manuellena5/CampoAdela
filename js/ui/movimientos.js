// Listado de movimientos: filtros, vista ARS / USD / Ambos, totales; tabla en notebook y tarjetas en celular.

import { listar, borrar } from '../db.js';
import * as ajustes from '../ajustes.js';
import { PAGO_CAJA } from '../dominio.js';
import { esc, $, toast } from '../lib/dom.js';
import { formatoARS, formatoUSD, formatoFecha, formatoNumero } from '../lib/formato.js';

// Filtros de la sesión (se conservan al ir y volver de la edición).
const filtros = { campana: '', categoria: '', periodo: '', pago: '' };
const TODAS = '';
const SIN_CAMPANA = '__sin__';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const nombrePeriodo = (p) => `${MESES[Number(p.slice(4, 6)) - 1]} ${p.slice(0, 4)}`;

export async function render(el) {
  const [movimientos, categorias, subcategorias, campanas, hermanos, usuario] = await Promise.all([
    listar('movimientos'), listar('categorias'), listar('subcategorias'), listar('campanas'), listar('hermanos'),
    ajustes.obtener('usuario'),
  ]);
  const claveVista = `vista-${usuario}`;
  let vista = (await ajustes.obtener(claveVista)) || 'ARS';

  const porId = (lista) => Object.fromEntries(lista.map((x) => [x.id, x]));
  const cat = porId(categorias);
  const sub = porId(subcategorias);
  const camp = porId(campanas);
  const herm = porId(hermanos);
  const nombrePago = (id) => (id === PAGO_CAJA || !id ? 'Caja común' : herm[id]?.nombre || '¿?');

  movimientos.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado.localeCompare(a.creado));

  // Opciones de filtros
  const periodos = [...new Set(movimientos.map((m) => m.periodo).filter(Boolean))].sort().reverse();
  const campanasOrd = [...campanas].sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || ''));
  const catsOrd = (tipo) => categorias.filter((c) => c.tipo === tipo).sort((a, b) => a.orden - b.orden);
  const opcion = (valor, texto, actual) => `<option value="${esc(valor)}" ${valor === actual ? 'selected' : ''}>${esc(texto)}</option>`;
  // Si un filtro guardado ya no existe (p. ej. se borró la campaña), se limpia.
  if (filtros.periodo && !periodos.includes(filtros.periodo)) filtros.periodo = TODAS;
  if (filtros.campana && filtros.campana !== SIN_CAMPANA && !camp[filtros.campana]) filtros.campana = TODAS;
  if (filtros.categoria && !cat[filtros.categoria]) filtros.categoria = TODAS;

  el.innerHTML = `
    <div class="encabezado">
      <h1>Movimientos</h1>
      <a class="btn btn-primario solo-notebook" href="#/movimientos/nuevo">+ Nuevo</a>
    </div>

    <div class="tarjeta filtros">
      <div class="filtros-grid">
        <label>Campaña
          <select data-filtro="campana">
            ${opcion(TODAS, 'Todas', filtros.campana)}
            ${opcion(SIN_CAMPANA, 'Sin campaña', filtros.campana)}
            ${campanasOrd.map((c) => opcion(c.id, c.nombre, filtros.campana)).join('')}
          </select>
        </label>
        <label>Categoría
          <select data-filtro="categoria">
            ${opcion(TODAS, 'Todas', filtros.categoria)}
            <optgroup label="Gastos">${catsOrd('gasto').map((c) => opcion(c.id, c.nombre, filtros.categoria)).join('')}</optgroup>
            <optgroup label="Ingresos">${catsOrd('ingreso').map((c) => opcion(c.id, c.nombre, filtros.categoria)).join('')}</optgroup>
          </select>
        </label>
        <label>Mes
          <select data-filtro="periodo">
            ${opcion(TODAS, 'Todos', filtros.periodo)}
            ${periodos.map((p) => opcion(p, nombrePeriodo(p), filtros.periodo)).join('')}
          </select>
        </label>
        <label>Pagó
          <select data-filtro="pago">
            ${opcion(TODAS, 'Todos', filtros.pago)}
            ${opcion(PAGO_CAJA, 'Caja común', filtros.pago)}
            ${[...hermanos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((h) => opcion(h.id, h.nombre, filtros.pago)).join('')}
          </select>
        </label>
      </div>
      <div class="filtros-pie">
        <div class="segmentado segmentado-chico" role="radiogroup" aria-label="Moneda de la vista">
          ${[['ARS', '$ ARS'], ['USD', 'US$'], ['AMBOS', 'Ambos']].map(([v, t]) => `
            <label><input type="radio" name="vista" value="${v}" ${v === vista ? 'checked' : ''}><span>${t}</span></label>`).join('')}
        </div>
        <button type="button" class="btn-link" id="limpiar-filtros">Limpiar filtros</button>
      </div>
    </div>

    <div id="resultado"></div>`;

  const dibujar = () => {
    const lista = movimientos.filter((m) =>
      (!filtros.campana || (filtros.campana === SIN_CAMPANA ? !m.campanaId : m.campanaId === filtros.campana))
      && (!filtros.categoria || m.categoriaId === filtros.categoria)
      && (!filtros.periodo || m.periodo === filtros.periodo)
      && (!filtros.pago || (m.pagoId || PAGO_CAJA) === filtros.pago));
    $('#resultado', el).innerHTML = totalesHTML(lista, cat, vista) + listaHTML(lista, { cat, sub, camp, nombrePago, vista });
    $('#limpiar-filtros', el).hidden = !Object.values(filtros).some(Boolean);
  };

  el.onchange = async (e) => {
    const f = e.target.dataset.filtro;
    if (f) { filtros[f] = e.target.value; dibujar(); }
    if (e.target.name === 'vista') {
      vista = e.target.value;
      await ajustes.guardar(claveVista, vista);
      dibujar();
    }
  };

  el.onclick = async (e) => {
    if (e.target.closest('#limpiar-filtros')) {
      Object.keys(filtros).forEach((k) => { filtros[k] = TODAS; });
      render(el);
      return;
    }
    const btnBorrar = e.target.closest('[data-borrar]');
    if (btnBorrar) {
      e.preventDefault();
      const m = movimientos.find((x) => x.id === btnBorrar.dataset.borrar);
      const monto = m.moneda === 'USD' ? formatoUSD(m.montoOriginal) : formatoARS(m.montoOriginal);
      if (!confirm(`¿Borrar el movimiento del ${formatoFecha(m.fecha)} (${cat[m.categoriaId]?.nombre || ''}, ${monto})?`)) return;
      await borrar('movimientos', m.id);
      toast('Movimiento borrado');
      render(el);
      return;
    }
    const fila = e.target.closest('[data-id]');
    if (fila) location.hash = `#/movimientos/${fila.dataset.id}`;
  };
  el.onkeydown = (e) => {
    const fila = e.key === 'Enter' && e.target.closest('[data-id]');
    if (fila && e.target === fila) location.hash = `#/movimientos/${fila.dataset.id}`;
  };

  dibujar();
}

// ---- Totales

function sumar(lista, cat, tipo, campo) {
  return lista.filter((m) => cat[m.categoriaId]?.tipo === tipo).reduce((s, m) => s + (Number(m[campo]) || 0), 0);
}

function totalesHTML(lista, cat, vista) {
  const monedas = vista === 'AMBOS' ? ['ARS', 'USD'] : [vista];
  const fmt = { ARS: formatoARS, USD: formatoUSD };
  const filas = monedas.map((mon) => {
    const campo = mon === 'ARS' ? 'montoARS' : 'montoUSD';
    const gastos = sumar(lista, cat, 'gasto', campo);
    const ingresos = sumar(lista, cat, 'ingreso', campo);
    const neto = ingresos - gastos;
    return { mon, gastos, ingresos, neto, f: fmt[mon] };
  });

  const celda = (titulo, valores, clase = '') => `
    <div class="total ${clase}">
      <div class="total-titulo">${titulo}</div>
      ${valores.map((v) => `<div class="total-valor">${v}</div>`).join('')}
    </div>`;

  return `
    <div class="totales">
      ${celda('Gastos', filas.map((t) => t.f(t.gastos)), 'gasto')}
      ${celda('Ingresos', filas.map((t) => t.f(t.ingresos)), 'ingreso')}
      ${celda('Neto', filas.map((t) => t.f(t.neto)), filas[0].neto < 0 ? 'gasto' : 'ingreso')}
      ${celda('Por hermano (⅓)', filas.map((t) => t.f(t.neto / 3)), filas[0].neto < 0 ? 'gasto' : 'ingreso')}
    </div>
    <div class="ayuda contador">${lista.length} movimiento${lista.length === 1 ? '' : 's'}</div>`;
}

// ---- Lista (tabla + tarjetas)

function montosHTML(m, tipo, vista) {
  const ars = `<span class="monto ${tipo} ${m.moneda === 'ARS' ? 'original' : ''}">${formatoARS(m.montoARS)}</span>`;
  const usd = `<span class="monto ${tipo} ${m.moneda === 'USD' ? 'original' : ''}">${formatoUSD(m.montoUSD)}</span>`;
  if (vista === 'ARS') return ars;
  if (vista === 'USD') return usd;
  return `${ars}<br>${usd}`;
}

function listaHTML(lista, { cat, sub, camp, nombrePago, vista }) {
  if (!lista.length) return '<div class="tarjeta vacio">No hay movimientos con estos filtros.</div>';

  const nombreCat = (m) => {
    const c = cat[m.categoriaId]?.nombre || '¿?';
    const s = sub[m.subcategoriaId]?.nombre;
    return s ? `${esc(c)} <span class="sub">› ${esc(s)}</span>` : esc(c);
  };
  const badgeTc = (m) => (m.tcEstado === 'a_confirmar' ? ' <span class="badge badge-a-confirmar">TC a confirmar</span>' : '');
  const nombreCampana = (m) => (m.campanaId ? esc(camp[m.campanaId]?.nombre || '¿?') : '<span class="texto-suave">Sin campaña</span>');
  const detalle = (m) => [m.descripcion, m.proveedor].filter(Boolean).map(esc).join(' · ');
  const btnBorrar = (m) => `<button type="button" class="btn-icono btn-borrar" data-borrar="${esc(m.id)}" aria-label="Borrar" title="Borrar">🗑</button>`;

  const encabezadoMonto = vista === 'AMBOS' ? 'Monto' : vista === 'ARS' ? 'Monto $' : 'Monto US$';

  const tabla = `
    <div class="tabla-contenedor vista-tabla">
      <table class="tabla">
        <thead>
          <tr>
            <th>Fecha</th><th>Categoría</th><th>Detalle</th><th>Campaña</th><th>Pagó</th>
            <th class="num">${encabezadoMonto}</th><th class="num">TC</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${lista.map((m) => {
            const tipo = cat[m.categoriaId]?.tipo || '';
            return `
              <tr data-id="${esc(m.id)}" tabindex="0">
                <td class="nowrap">${formatoFecha(m.fecha)}</td>
                <td>${nombreCat(m)}${badgeTc(m)}</td>
                <td class="detalle-celda">${detalle(m)}</td>
                <td>${nombreCampana(m)}</td>
                <td>${esc(nombrePago(m.pagoId))}</td>
                <td class="num">${montosHTML(m, tipo, vista)}</td>
                <td class="num texto-suave" title="${esc(m.tipoDolar)} del ${formatoFecha(m.tcFecha)}">${formatoNumero(m.tc)}</td>
                <td>${btnBorrar(m)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  const tarjetas = `
    <div class="vista-tarjetas">
      ${lista.map((m) => {
        const tipo = cat[m.categoriaId]?.tipo || '';
        return `
          <div class="tarjeta tarjeta-mov" data-id="${esc(m.id)}" role="button" tabindex="0">
            <div class="item-fila">
              <span class="item-nombre">${nombreCat(m)}</span>
              <span class="num">${montosHTML(m, tipo, vista)}</span>
            </div>
            <div class="detalle">${formatoFecha(m.fecha)} · ${nombreCampana(m)} · ${esc(nombrePago(m.pagoId))}${badgeTc(m)}</div>
            <div class="item-fila">
              <span class="detalle">${detalle(m)}</span>
              ${btnBorrar(m)}
            </div>
          </div>`;
      }).join('')}
    </div>`;

  return tabla + tarjetas;
}
