// Resumen de campaña: gastos (total y por ha, por categoría/subcategoría), ingresos (qq, kg, $), margen y rinde.

import { listar } from '../db.js';
import * as ajustes from '../ajustes.js';
import { resumenCampana } from '../calculos.js';
import { esc } from '../lib/dom.js';
import { formatoARS, formatoUSD, formatoNumero, formatoFecha } from '../lib/formato.js';
import { navegar } from '../router.js';

const FMT = { ARS: formatoARS, USD: formatoUSD };

export async function render(el, { id } = {}) {
  const [campanas, movimientos, categorias, subcategorias, usuario] = await Promise.all([
    listar('campanas'), listar('movimientos'), listar('categorias'), listar('subcategorias'), ajustes.obtener('usuario'),
  ]);
  const claveVista = `vista-${usuario}`;
  const vistaGuardada = (await ajustes.obtener(claveVista)) || 'ARS';

  if (!campanas.length) {
    el.innerHTML = `<div class="form-centrado"><h1>Resumen de campaña</h1>
      <div class="tarjeta vacio">Todavía no hay campañas. <a href="#/campanas">Crear una</a>.</div></div>`;
    return;
  }

  campanas.sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || ''));
  // Por defecto: la campaña en curso más reciente, o la más reciente.
  const campana = campanas.find((c) => c.id === id) || campanas.find((c) => c.estado === 'en curso') || campanas[0];
  const r = resumenCampana(campana, movimientos, categorias, subcategorias);
  const monedas = vistaGuardada === 'AMBOS' ? ['ARS', 'USD'] : [vistaGuardada];

  const montos = (x, clase = '') => monedas.map((m) => `<div class="monto ${clase}">${FMT[m](x[m])}</div>`).join('');
  const pct = (parte) => (r.gastos.total.ARS ? `${formatoNumero((parte / r.gastos.total.ARS) * 100)}%` : '');

  el.innerHTML = `
    <div class="encabezado">
      <h1>Resumen de campaña</h1>
    </div>

    <div class="tarjeta filtros">
      <div class="filtros-grid filtros-grid-2">
        <label>Campaña
          <select id="r-campana">
            ${campanas.map((c) => `<option value="${esc(c.id)}" ${c.id === campana.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
          </select>
        </label>
        <div class="segmentado segmentado-chico filtros-vista">
          ${[['ARS', '$ ARS'], ['USD', 'US$'], ['AMBOS', 'Ambos']].map(([v, t]) => `
            <label><input type="radio" name="vista" value="${v}" ${v === vistaGuardada ? 'checked' : ''}><span>${t}</span></label>`).join('')}
        </div>
      </div>
      <div class="detalle">
        ${[campana.cultivo, `${formatoNumero(r.hectareas)} ha`, campana.estado].filter(Boolean).map(esc).join(' · ')}
        · ${campana.fechaInicio ? formatoFecha(campana.fechaInicio) : '…'} → ${campana.fechaFin ? formatoFecha(campana.fechaFin) : '…'}
        · ${r.cantidad} movimiento${r.cantidad === 1 ? '' : 's'}
      </div>
    </div>

    <div class="totales">
      <div class="total gasto"><div class="total-titulo">Gastos</div>${montos(r.gastos.total)}</div>
      <div class="total ingreso"><div class="total-titulo">Ingresos</div>${montos(r.ingresos.total)}</div>
      <div class="total ${r.margen.total.ARS < 0 ? 'gasto' : 'ingreso'}"><div class="total-titulo">Margen bruto</div>${montos(r.margen.total)}</div>
      <div class="total"><div class="total-titulo">Rinde</div><div class="total-valor">${formatoNumero(r.rindeQqHa)} qq/ha</div></div>
    </div>
    <div class="totales totales-ha">
      <div class="total gasto"><div class="total-titulo">Gasto por ha</div>${montos(r.gastos.porHa)}</div>
      <div class="total ingreso"><div class="total-titulo">Ingreso por ha</div>${montos(r.ingresos.porHa)}</div>
      <div class="total ${r.margen.porHa.ARS < 0 ? 'gasto' : 'ingreso'}"><div class="total-titulo">Margen por ha</div>${montos(r.margen.porHa)}</div>
      <div class="total"><div class="total-titulo">Por hermano (⅓ del margen)</div>${montos({ ARS: r.margen.total.ARS / 3, USD: r.margen.total.USD / 3 })}</div>
    </div>
    <p class="ayuda">Los gastos sin campaña no entran en el margen (sí en las cuentas entre hermanos).</p>

    <h2>Gastos por categoría</h2>
    ${r.gastos.porCategoria.length ? `
      <div class="tabla-contenedor">
        <table class="tabla tabla-resumen">
          <thead><tr>
            <th>Categoría</th>
            ${monedas.map((m) => `<th class="num">Total ${m === 'ARS' ? '$' : 'US$'}</th><th class="num">Por ha</th>`).join('')}
            <th class="num">%</th>
          </tr></thead>
          <tbody>
            ${r.gastos.porCategoria.map((c) => `
              <tr class="fila-categoria">
                <td>${esc(c.nombre)}</td>
                ${monedas.map((m) => `<td class="num">${FMT[m](c.total[m])}</td><td class="num">${FMT[m](c.porHa[m])}</td>`).join('')}
                <td class="num">${pct(c.total.ARS)}</td>
              </tr>
              ${c.subcategorias.map((s) => `
                <tr class="fila-sub">
                  <td>› ${esc(s.nombre)}</td>
                  ${monedas.map((m) => `<td class="num">${FMT[m](s.total[m])}</td><td class="num">${FMT[m](s.porHa[m])}</td>`).join('')}
                  <td class="num">${pct(s.total.ARS)}</td>
                </tr>`).join('')}`).join('')}
            <tr class="fila-total">
              <td>Total gastos</td>
              ${monedas.map((m) => `<td class="num">${FMT[m](r.gastos.total[m])}</td><td class="num">${FMT[m](r.gastos.porHa[m])}</td>`).join('')}
              <td class="num">100%</td>
            </tr>
          </tbody>
        </table>
      </div>` : '<div class="tarjeta vacio">Sin gastos en esta campaña.</div>'}

    <h2>Ingresos</h2>
    ${r.ingresos.porCategoria.length ? `
      <div class="tabla-contenedor">
        <table class="tabla tabla-resumen">
          <thead><tr>
            <th>Categoría</th><th class="num">kg</th><th class="num">qq</th>
            ${monedas.map((m) => `<th class="num">Total ${m === 'ARS' ? '$' : 'US$'}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${r.ingresos.porCategoria.map((c) => `
              <tr class="fila-categoria">
                <td>${esc(c.nombre)}</td>
                <td class="num">${c.kg ? formatoNumero(c.kg) : '—'}</td>
                <td class="num">${c.qq ? formatoNumero(c.qq) : '—'}</td>
                ${monedas.map((m) => `<td class="num">${FMT[m](c.total[m])}</td>`).join('')}
              </tr>`).join('')}
            <tr class="fila-total">
              <td>Total ingresos</td>
              <td class="num">${formatoNumero(r.ingresos.kg)}</td>
              <td class="num">${formatoNumero(r.ingresos.qq)}</td>
              ${monedas.map((m) => `<td class="num">${FMT[m](r.ingresos.total[m])}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>
      ${r.ingresos.qq ? `<p class="ayuda">Precio promedio: ${monedas.map((m) => `${FMT[m](r.ingresos.precioQq[m])}/qq`).join(' · ')}.
        Rinde calculado con los quintales cargados en los ingresos (${formatoNumero(r.ingresos.qq)} qq / ${formatoNumero(r.hectareas)} ha).</p>` : ''}
    ` : '<div class="tarjeta vacio">Sin ingresos en esta campaña.</div>'}`;

  el.onchange = async (e) => {
    if (e.target.id === 'r-campana') navegar(`/resumen/${e.target.value}`);
    if (e.target.name === 'vista') {
      await ajustes.guardar(claveVista, e.target.value);
      render(el, { id: campana.id });
    }
  };
}
