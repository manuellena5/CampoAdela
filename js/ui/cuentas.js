// Cuentas entre hermanos: lo que pagó cada uno contra lo que le corresponde (⅓), saldos y sugerencia de pagos.

import { listar } from '../db.js';
import * as ajustes from '../ajustes.js';
import { cuentasEntreHermanos } from '../calculos.js';
import { esc } from '../lib/dom.js';
import { formatoARS, formatoUSD } from '../lib/formato.js';

const FMT = { ARS: formatoARS, USD: formatoUSD };

export async function render(el) {
  const [movimientos, categorias, hermanos, usuario] = await Promise.all([
    listar('movimientos'), listar('categorias'), listar('hermanos'), ajustes.obtener('usuario'),
  ]);
  const claveVista = `vista-${usuario}`;
  const vistaGuardada = (await ajustes.obtener(claveVista)) || 'ARS';
  // Con "Ambos" se muestran las dos monedas por separado (el saldo en cada una es independiente).
  const monedas = vistaGuardada === 'AMBOS' ? ['ARS', 'USD'] : [vistaGuardada];

  const participantes = hermanos.filter((h) => h.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const cuentas = cuentasEntreHermanos(movimientos, categorias, participantes);
  const fraccion = participantes.length === 3 ? '⅓' : `1/${participantes.length}`;

  const bloque = (mon) => {
    const c = cuentas[mon];
    const f = FMT[mon];
    const hayIngresos = c.ingresosTotal !== 0;
    return `
      <h2>${mon === 'ARS' ? 'En pesos' : 'En dólares'}</h2>
      <div class="totales">
        <div class="total gasto"><div class="total-titulo">Gastos totales</div><div class="total-valor">${f(c.gastosTotal)}</div></div>
        <div class="total"><div class="total-titulo">Pagado por Caja común</div><div class="total-valor">${f(c.gastosCaja)}</div></div>
        <div class="total gasto"><div class="total-titulo">Le corresponde a c/u (${fraccion})</div><div class="total-valor">${f(c.gastosTotal / (participantes.length || 1))}</div></div>
        <div class="total ingreso"><div class="total-titulo">Ingresos totales</div><div class="total-valor">${f(c.ingresosTotal)}</div></div>
      </div>

      <div class="tabla-contenedor tabla-cuentas">
        <table class="tabla">
          <thead><tr>
            <th>Hermano</th>
            <th class="num">Pagó de su bolsillo</th>
            <th class="num">Pagó (con ${fraccion} de la caja)</th>
            <th class="num">Le corresponde</th>
            ${hayIngresos ? '<th class="num">Cobró (con su parte de la caja)</th><th class="num">Le corresponde cobrar</th>' : ''}
            <th class="num">Saldo</th>
          </tr></thead>
          <tbody>
            ${c.filas.map((h) => `
              <tr>
                <td><strong>${esc(h.nombre)}</strong></td>
                <td class="num" data-label="Pagó de su bolsillo">${f(h.pagoPropio)}</td>
                <td class="num" data-label="Pagó (con ${fraccion} de la caja)">${f(h.pago)}</td>
                <td class="num" data-label="Le corresponde">${f(h.correspondeGasto)}</td>
                ${hayIngresos ? `
                  <td class="num" data-label="Cobró">${f(h.cobro)}</td>
                  <td class="num" data-label="Le corresponde cobrar">${f(h.correspondeIngreso)}</td>` : ''}
                <td class="num saldo ${h.saldo > 0.005 ? 'ingreso' : h.saldo < -0.005 ? 'gasto' : ''}" data-label="Saldo">
                  ${f(h.saldo)}
                  <div class="saldo-texto">${h.saldo > 0.005 ? 'le deben' : h.saldo < -0.005 ? 'debe' : 'al día'}</div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="tarjeta">
        <strong>Sugerencia para quedar a mano</strong>
        ${c.transferencias.length
          ? `<ul class="transferencias">${c.transferencias.map((t) => `<li><strong>${esc(t.de)}</strong> le paga <strong>${f(t.monto)}</strong> a <strong>${esc(t.a)}</strong></li>`).join('')}</ul>`
          : '<p class="detalle">Están a mano: no hace falta ninguna transferencia.</p>'}
      </div>`;
  };

  el.innerHTML = `
    <div class="encabezado">
      <h1>Cuentas entre hermanos</h1>
      <div class="segmentado segmentado-chico">
        ${[['ARS', '$ ARS'], ['USD', 'US$'], ['AMBOS', 'Ambos']].map(([v, t]) => `
          <label><input type="radio" name="vista" value="${v}" ${v === vistaGuardada ? 'checked' : ''}><span>${t}</span></label>`).join('')}
      </div>
    </div>
    <p class="ayuda">Todos los movimientos, incluidos los gastos sin campaña. Lo pagado por la Caja común se reparte en partes iguales y no genera saldo.
      Saldo positivo: los demás le deben; negativo: debe.</p>
    ${cuentas.sinReparto ? `<div class="aviso">${cuentas.sinReparto} movimiento(s) están a nombre de un hermano inactivo y no entran en el reparto.</div>` : ''}
    ${monedas.map(bloque).join('')}`;

  el.onchange = async (e) => {
    if (e.target.name === 'vista') {
      await ajustes.guardar(claveVista, e.target.value);
      render(el);
    }
  };
}
