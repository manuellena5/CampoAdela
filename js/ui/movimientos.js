// Listado de movimientos: filtros, vista ARS / USD / Ambos, totales; tabla en notebook y tarjetas en celular.

import { listar, borrar } from '../db.js';
import * as ajustes from '../ajustes.js';
import { PAGO_CAJA } from '../dominio.js';
import { esc, $, toast } from '../lib/dom.js';
import { formatoARS, formatoUSD, formatoFecha, formatoNumero, hoyISO } from '../lib/formato.js';
import { generarCSV, descargarCSV, numeroCSV } from '../lib/csv.js';
import { navegar } from '../router.js';

// Filtros y orden de la sesión (se conservan al ir y volver de la edición).
const filtros = { campana: '', categoria: '', periodo: '', pago: '' };
const orden = { campo: 'fecha', desc: true };
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
        <span class="filtros-acciones">
          <button type="button" class="btn-link" id="limpiar-filtros">Limpiar filtros</button>
          <button type="button" class="btn-link" id="exportar-csv">Exportar CSV</button>
        </span>
      </div>
    </div>

    <div id="resultado"></div>`;

  // Orden: por fecha (desempata la carga) o por monto (en la moneda de la vista).
  const comparar = (a, b) => {
    const campoMonto = vista === 'USD' ? 'montoUSD' : 'montoARS';
    const r = orden.campo === 'monto'
      ? (a[campoMonto] || 0) - (b[campoMonto] || 0)
      : a.fecha.localeCompare(b.fecha) || a.creado.localeCompare(b.creado);
    return orden.desc ? -r : r;
  };

  const filtrados = () => movimientos.filter((m) =>
    (!filtros.campana || (filtros.campana === SIN_CAMPANA ? !m.campanaId : m.campanaId === filtros.campana))
    && (!filtros.categoria || m.categoriaId === filtros.categoria)
    && (!filtros.periodo || m.periodo === filtros.periodo)
    && (!filtros.pago || (m.pagoId || PAGO_CAJA) === filtros.pago)).sort(comparar);

  const dibujar = () => {
    const lista = filtrados();
    $('#exportar-csv', el).disabled = !lista.length;
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
    if (e.target.closest('#exportar-csv')) {
      const lista = filtrados();
      descargarCSV(`movimientos-${hoyISO()}.csv`, csvMovimientos(lista, { cat, sub, camp, herm, nombrePago }));
      toast(`${lista.length} movimiento${lista.length === 1 ? '' : 's'} exportado${lista.length === 1 ? '' : 's'}`);
      return;
    }
    const btnOrden = e.target.closest('[data-orden]');
    if (btnOrden) {
      const campo = btnOrden.dataset.orden;
      // Mismo campo: invierte. Campo nuevo: empieza por lo más reciente / lo más grande.
      Object.assign(orden, orden.campo === campo ? { desc: !orden.desc } : { campo, desc: true });
      dibujar();
      return;
    }
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
    if (e.target.closest('a.clip')) return; // abre el comprobante, no la edición
    const fila = e.target.closest('[data-id]');
    if (fila) navegar(`/movimientos/${fila.dataset.id}`);
  };
  el.onkeydown = (e) => {
    const fila = e.key === 'Enter' && e.target.closest('[data-id]');
    if (fila && e.target === fila) navegar(`/movimientos/${fila.dataset.id}`);
    const btnOrden = e.key === 'Enter' && e.target.closest('th[data-orden]');
    if (btnOrden) btnOrden.click();
  };

  dibujar();
}

// ---- Exportación

const ESTADO_TC = { api: 'API', manual: 'Manual', a_confirmar: 'A confirmar' };

function csvMovimientos(lista, { cat, sub, camp, herm, nombrePago }) {
  const encabezados = [
    'Fecha', 'Período', 'Tipo', 'Categoría', 'Subcategoría', 'Campaña', 'Descripción', 'Proveedor',
    'Moneda', 'Monto original', 'Tipo de dólar', 'TC', 'Fecha TC', 'Estado TC', 'Monto ARS', 'Monto USD',
    'Quintales', 'Precio por qq', 'Pagó', 'Comprobante', 'Cargado por', 'Id',
  ];
  const filas = lista.map((m) => {
    const c = cat[m.categoriaId];
    return [
      formatoFecha(m.fecha), m.periodo, c?.tipo === 'ingreso' ? 'Ingreso' : 'Gasto', c?.nombre || '',
      sub[m.subcategoriaId]?.nombre || '', m.campanaId ? camp[m.campanaId]?.nombre || '' : 'Sin campaña',
      m.descripcion, m.proveedor, m.moneda, numeroCSV(m.montoOriginal), m.tipoDolar === 'OFICIAL' ? 'Oficial' : 'MEP',
      numeroCSV(m.tc, 4), formatoFecha(m.tcFecha), ESTADO_TC[m.tcEstado] || m.tcEstado,
      numeroCSV(m.montoARS), numeroCSV(m.montoUSD), numeroCSV(m.quintales), numeroCSV(m.precioQq),
      nombrePago(m.pagoId), m.comprobanteUrl, herm[m.cargadoPor]?.nombre || m.cargadoPor, m.id,
    ];
  });
  return generarCSV(encabezados, filas);
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
    <div class="contador">
      <span class="ayuda">${lista.length} movimiento${lista.length === 1 ? '' : 's'}</span>
      ${lista.length > 1 ? `<span class="orden-celular solo-celular">Ordenar:
        ${botonOrden('fecha', 'Fecha')} ${botonOrden('monto', 'Monto')}</span>` : ''}
    </div>`;
}

// ---- Orden

const flecha = (campo) => (orden.campo === campo ? (orden.desc ? ' ↓' : ' ↑') : '');
const ariaOrden = (campo) => (orden.campo === campo ? (orden.desc ? 'descending' : 'ascending') : 'none');

// Botón de orden para el celular (no hay encabezados de tabla).
function botonOrden(campo, texto) {
  return `<button type="button" class="btn-link ${orden.campo === campo ? 'orden-activo' : ''}" data-orden="${campo}">${texto}${flecha(campo)}</button>`;
}

// Encabezado de tabla ordenable.
function thOrden(campo, texto, clase = '') {
  return `<th class="ordenable ${clase}" data-orden="${campo}" tabindex="0" aria-sort="${ariaOrden(campo)}" title="Ordenar por ${texto.toLowerCase()}">${texto}<span class="flecha">${flecha(campo) || ' ↕'}</span></th>`;
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
  const clip = (m) => (m.comprobanteUrl
    ? ` <a class="clip" href="${esc(m.comprobanteUrl)}" target="_blank" rel="noopener" title="Ver comprobante" aria-label="Ver comprobante">📎</a>` : '');
  const detalle = (m) => [m.descripcion, m.proveedor].filter(Boolean).map(esc).join(' · ') + clip(m);
  const btnBorrar = (m) => `<button type="button" class="btn-icono btn-borrar" data-borrar="${esc(m.id)}" aria-label="Borrar" title="Borrar">🗑</button>`;

  const encabezadoMonto = vista === 'AMBOS' ? 'Monto' : vista === 'ARS' ? 'Monto $' : 'Monto US$';

  const tabla = `
    <div class="tabla-contenedor vista-tabla">
      <table class="tabla">
        <thead>
          <tr>
            ${thOrden('fecha', 'Fecha')}<th>Categoría</th><th>Detalle</th><th>Campaña</th><th>Pagó</th>
            ${thOrden('monto', encabezadoMonto, 'num')}<th class="num">TC</th><th></th>
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
