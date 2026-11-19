// Granos: stock en cada acopio, liquidaciones (ventas) a cobrar y cobros que generan el ingreso.

import { listar, crear, actualizar, borrar } from '../db.js';
import * as ajustes from '../ajustes.js';
import { KG_POR_QQ } from '../calculos.js';
import { PAGO_CAJA, calcularMontos, periodoDe } from '../dominio.js';
import { obtenerCotizacion } from '../dolar.js';
import {
  TIPOS_GRANO, stockGranos, liquidaciones, importesLiquidacion, quintalesDeCobro, errorStock, redondeoKg,
} from '../granos.js';
import { abrirDialogo } from '../lib/dialogo.js';
import { esc, toast } from '../lib/dom.js';
import { formatoARS, formatoNumero, formatoFecha, parsearMonto, numeroEditable, hoyISO } from '../lib/formato.js';
import { navegar } from '../router.js';

let filtroCampana = ''; // '' = todas (se conserva en la sesión)

const kgTxt = (kg) => `${formatoNumero(kg)} kg`;
const qqTxt = (kg) => `${formatoNumero(kg / KG_POR_QQ)} qq`;
const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export async function render(el) {
  const [granos, movimientos, campanas, categorias] = await Promise.all([
    listar('granos'), listar('movimientos'), listar('campanas'), listar('categorias'),
  ]);
  campanas.sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || ''));
  const camp = Object.fromEntries(campanas.map((c) => [c.id, c]));
  if (filtroCampana && !camp[filtroCampana]) filtroCampana = '';
  const enFiltro = (r) => !filtroCampana || r.campanaId === filtroCampana;
  const nombreCamp = (id) => camp[id]?.nombre || 'Sin campaña';

  const stock = stockGranos(granos, filtroCampana);
  const liqs = liquidaciones(granos, movimientos).filter(enFiltro);
  const aCobrar = liqs.filter((l) => !l.cobrada);
  const cobradas = liqs.filter((l) => l.cobrada);
  const precios = {};
  for (const g of new Set(stock.map((s) => s.grano))) precios[g] = (await ajustes.obtener(`precioRef-${normalizar(g)}`)) || 0;

  const totalACobrar = aCobrar.reduce((s, l) => s + l.pendiente, 0);
  const valorStock = stock.reduce((s, g) => s + (g.kg / KG_POR_QQ) * (precios[g.grano] || 0), 0);
  const historial = granos.filter(enFiltro).sort((a, b) => b.fecha.localeCompare(a.fecha) || String(b.creado).localeCompare(String(a.creado)));

  el.innerHTML = `
    <div class="encabezado">
      <h1>Granos</h1>
    </div>
    <div class="acciones-granos">
      <button type="button" class="btn btn-primario" data-accion="nuevo" data-tipo="ENTREGA">+ Entrega</button>
      <button type="button" class="btn btn-primario" data-accion="nuevo" data-tipo="LIQUIDACION">+ Liquidación</button>
      <button type="button" class="btn" data-accion="nuevo" data-tipo="AJUSTE">+ Ajuste de kilos</button>
    </div>

    <div class="tarjeta filtros">
      <label>Campaña
        <select id="g-campana">
          <option value="">Todas</option>
          ${campanas.map((c) => `<option value="${esc(c.id)}" ${c.id === filtroCampana ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
        </select>
      </label>
    </div>

    <div class="totales">
      <div class="total"><div class="total-titulo">En stock</div>
        <div class="total-valor">${qqTxt(stock.reduce((s, g) => s + g.kg, 0))}</div>
        ${valorStock ? `<div class="detalle">≈ ${formatoARS(valorStock)}</div>` : ''}</div>
      <div class="total ingreso"><div class="total-titulo">A cobrar</div>
        <div class="total-valor">${formatoARS(totalACobrar)}</div>
        <div class="detalle">${aCobrar.length} liquidaci${aCobrar.length === 1 ? 'ón' : 'ones'}</div></div>
    </div>

    <h2>📦 Stock en acopios</h2>
    ${stock.length ? stock.map((g) => {
      const precio = precios[g.grano] || 0;
      return `
      <div class="tarjeta stock-grano">
        <div class="item-fila">
          <strong>${esc(g.grano || 'Grano')} · ${esc(nombreCamp(g.campanaId))}</strong>
          <span class="stock-total">${qqTxt(g.kg)}</span>
        </div>
        <ul class="lista-acopios">
          ${g.acopios.map((a) => `<li><span>${esc(a.acopio || 'Sin acopio')}</span><span class="num">${kgTxt(a.kg)} · ${qqTxt(a.kg)}</span></li>`).join('')}
        </ul>
        <div class="precio-ref">
          <label>Precio de referencia $/qq
            <input inputmode="decimal" data-precio="${esc(g.grano)}" value="${precio ? esc(numeroEditable(precio)) : ''}" placeholder="ej. 47.000">
          </label>
          <span class="detalle">${precio ? `Valor estimado: <strong>${formatoARS((g.kg / KG_POR_QQ) * precio)}</strong>` : 'Cargá un precio para estimar el valor.'}</span>
        </div>
      </div>`;
    }).join('') : '<div class="tarjeta vacio">No hay granos en stock. Cargá una entrega cuando lleves la cosecha al acopio.</div>'}

    <h2>📋 Liquidaciones a cobrar</h2>
    ${aCobrar.length ? aCobrar.map((l) => tarjetaLiquidacion(l, nombreCamp)).join('') : '<div class="tarjeta vacio">No hay nada pendiente de cobro.</div>'}

    ${cobradas.length ? `
      <details class="seccion-plegable">
        <summary>✓ Liquidaciones cobradas <span class="detalle">(${cobradas.length})</span></summary>
        ${cobradas.map((l) => tarjetaLiquidacion(l, nombreCamp)).join('')}
      </details>` : ''}

    <details class="seccion-plegable">
      <summary>🕘 Historial <span class="detalle">(${historial.length})</span></summary>
      ${historial.length ? `<div class="tarjeta lista-historial">${historial.map((r) => filaHistorial(r, nombreCamp, liqs, movimientos)).join('')}</div>`
        : '<div class="tarjeta vacio">Sin registros.</div>'}
    </details>`;

  const contexto = { granos, movimientos, campanas, categorias, liqs };
  el.onchange = async (e) => {
    if (e.target.id === 'g-campana') { filtroCampana = e.target.value; render(el); }
    if (e.target.dataset.precio !== undefined) {
      const n = parsearMonto(e.target.value);
      await ajustes.guardar(`precioRef-${normalizar(e.target.dataset.precio)}`, Number.isFinite(n) && n > 0 ? n : 0);
      render(el);
    }
  };
  el.onclick = async (e) => {
    const btn = e.target.closest('[data-accion]');
    if (!btn) return;
    const { accion, id, tipo } = btn.dataset;
    let cambio = false;
    if (accion === 'nuevo') cambio = await editarRegistro(tipo, null, contexto);
    if (accion === 'editar') { const r = granos.find((x) => x.id === id); cambio = r && await editarRegistro(r.tipo, r, contexto); }
    if (accion === 'cobro') cambio = await nuevoCobro(liqs.find((l) => l.id === id), contexto);
    if (accion === 'borrar-cobro') cambio = await borrarCobro(granos.find((x) => x.id === id));
    if (accion === 'ver-mov') { navegar(`/movimientos/${id}`); return; }
    if (cambio) render(el);
  };
}

function tarjetaLiquidacion(l, nombreCamp) {
  const pct = l.neto > 0 ? Math.max(0, Math.min(100, (l.cobrado / l.neto) * 100)) : 0;
  return `
    <div class="tarjeta liquidacion ${l.cobrada ? 'liq-cobrada' : ''}">
      <div class="item-fila">
        <strong>${esc(l.acopio || 'Sin acopio')} · ${esc(l.grano)}</strong>
        <span class="item-acciones">
          <span class="badge ${l.cobrada ? 'badge-verde' : 'badge-a-confirmar'}">${l.cobrada ? 'Cobrada' : `Faltan ${formatoARS(l.pendiente)}`}</span>
          <button type="button" class="btn-icono" data-accion="editar" data-id="${esc(l.id)}" title="Editar liquidación" aria-label="Editar liquidación">✏️</button>
        </span>
      </div>
      <div class="detalle">${formatoFecha(l.fecha)} · ${esc(nombreCamp(l.campanaId))} · ${kgTxt(l.kg)} (${qqTxt(l.kg)}) a ${formatoARS(l.precioQq)}/qq
        ${l.fechaCobro && !l.cobrada ? ` · cobro estimado ${formatoFecha(l.fechaCobro)}` : ''}</div>
      <div class="liq-importes">
        <span>Bruto <strong>${formatoARS(l.bruto)}</strong></span>
        ${l.gastos ? `<span>Gastos <strong>− ${formatoARS(l.gastos)}</strong></span>` : ''}
        <span>Neto <strong>${formatoARS(l.neto)}</strong></span>
        <span>Cobrado <strong>${formatoARS(l.cobrado)}</strong></span>
      </div>
      <div class="barra" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct.toFixed(1)}%"></div></div>
      ${l.cobros.length ? `<ul class="lista-cobros">${l.cobros.map((c) => `
        <li>
          <span>💰 ${formatoFecha(c.fecha)} · ${formatoARS(c.montoReal)}${c.nota ? ` · ${esc(c.nota)}` : ''}</span>
          <span class="item-acciones">
            ${c.movimientoId ? `<button type="button" class="btn-link" data-accion="ver-mov" data-id="${esc(c.movimientoId)}">Ver movimiento</button>` : ''}
            <button type="button" class="btn-icono" data-accion="borrar-cobro" data-id="${esc(c.id)}" title="Borrar cobro" aria-label="Borrar cobro">✕</button>
          </span>
        </li>`).join('')}</ul>` : ''}
      ${l.nota ? `<div class="detalle">${esc(l.nota)}</div>` : ''}
      ${l.cobrada ? '' : `<div class="acciones"><button type="button" class="btn btn-primario" data-accion="cobro" data-id="${esc(l.id)}">+ Cargar cobro</button></div>`}
    </div>`;
}

function filaHistorial(r, nombreCamp, liqs, movimientos) {
  const t = TIPOS_GRANO[r.tipo] || { icono: '•', nombre: r.tipo };
  let titulo;
  if (r.tipo === 'COBRO') {
    const l = liqs.find((x) => x.id === r.liquidacionId);
    const mov = movimientos.find((m) => m.id === r.movimientoId);
    titulo = `${formatoARS(mov ? mov.montoARS : r.monto)}${l ? ` · liquidación ${esc(l.acopio)} ${formatoFecha(l.fecha)}` : ''}`;
  } else if (r.tipo === 'LIQUIDACION') {
    titulo = `${kgTxt(r.kg)} a ${formatoARS(r.precioQq)}/qq · ${esc(r.acopio)}`;
  } else {
    titulo = `${r.kg > 0 && r.tipo === 'AJUSTE' ? '+' : ''}${kgTxt(r.kg)} · ${esc(r.acopio)}`;
  }
  const editable = r.tipo !== 'COBRO';
  return `
    <div class="item-fila fila-historial">
      <div>
        <div>${t.icono} ${titulo}</div>
        <div class="detalle">${formatoFecha(r.fecha)} · ${esc(t.nombre)} · ${esc(r.grano)} · ${esc(nombreCamp(r.campanaId))}${r.nota ? ` · ${esc(r.nota)}` : ''}</div>
      </div>
      ${editable
        ? `<button type="button" class="btn-icono" data-accion="editar" data-id="${esc(r.id)}" aria-label="Editar" title="Editar">✏️</button>`
        : `<button type="button" class="btn-icono" data-accion="borrar-cobro" data-id="${esc(r.id)}" aria-label="Borrar cobro" title="Borrar cobro">✕</button>`}
    </div>`;
}

// ---------------------------------------------------------------- Entrega, liquidación, ajuste

const TITULOS = { ENTREGA: 'entrega al acopio', LIQUIDACION: 'liquidación', AJUSTE: 'ajuste de kilos' };

async function editarRegistro(tipo, r, { granos, campanas, liqs }) {
  const acopios = [...new Set(granos.map((g) => g.acopio).filter(Boolean))].sort();
  const campDefault = r?.campanaId || filtroCampana || campanas.find((c) => c.estado === 'en curso')?.id || campanas[0]?.id || '';
  const cultivoDe = (id) => campanas.find((c) => c.id === id)?.cultivo || '';
  const liq = tipo === 'LIQUIDACION' && r ? liqs.find((l) => l.id === r.id) : null;
  const signo = r && tipo === 'AJUSTE' && r.kg < 0 ? 'restar' : 'sumar';
  const kgAbs = r ? Math.abs(r.kg) : '';

  const promesa = abrirDialogo({
    titulo: `${r ? 'Editar' : 'Nueva'} ${TITULOS[tipo]}`,
    cuerpo: `
      ${tipo === 'ENTREGA' ? '<p class="ayuda">Kilos que entraron al acopio (cosecha). Suman stock.</p>' : ''}
      ${tipo === 'LIQUIDACION' ? '<p class="ayuda">Venta de kilos a un precio. Resta stock y queda a cobrar el neto.</p>' : ''}
      ${tipo === 'AJUSTE' ? '<p class="ayuda">Merma, diferencia de balanza, kilos para semilla… No genera plata.</p>' : ''}
      <div class="fila-2">
        <div class="campo"><label for="g-fecha">Fecha</label>
          <input id="g-fecha" name="fecha" type="date" required value="${esc(r?.fecha || hoyISO())}"></div>
        <div class="campo"><label for="g-camp">Campaña</label>
          <select id="g-camp" name="campanaId" required>
            ${campanas.map((c) => `<option value="${esc(c.id)}" ${c.id === campDefault ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
          </select></div>
      </div>
      <div class="fila-2">
        <div class="campo"><label for="g-grano">Grano</label>
          <input id="g-grano" name="grano" required value="${esc(r?.grano || cultivoDe(campDefault))}" placeholder="Soja"></div>
        <div class="campo"><label for="g-acopio">Acopio</label>
          <input id="g-acopio" name="acopio" required list="g-acopios" value="${esc(r?.acopio)}" placeholder="ACA María Susana">
          <datalist id="g-acopios">${acopios.map((a) => `<option value="${esc(a)}">`).join('')}</datalist></div>
      </div>
      ${tipo === 'AJUSTE' ? `
        <div class="campo"><span class="label">Kilos</span>
          <div class="segmentado segmentado-chico">
            <label><input type="radio" name="signo" value="sumar" ${signo === 'sumar' ? 'checked' : ''}><span>Sumar</span></label>
            <label><input type="radio" name="signo" value="restar" ${signo === 'restar' ? 'checked' : ''}><span>Restar</span></label>
          </div></div>` : ''}
      <div class="campo"><label for="g-kg">Kilos${tipo === 'AJUSTE' ? '' : ' (netos)'}</label>
        <input id="g-kg" name="kg" inputmode="decimal" required value="${esc(numeroEditable(kgAbs))}" placeholder="30.500"></div>
      ${tipo === 'LIQUIDACION' ? `
        <div class="fila-2">
          <div class="campo"><label for="g-precio">Precio $/qq</label>
            <input id="g-precio" name="precioQq" inputmode="decimal" required value="${esc(numeroEditable(r?.precioQq))}" placeholder="48.200"></div>
          <div class="campo"><label for="g-gastos">Gastos a descontar $</label>
            <input id="g-gastos" name="gastos" inputmode="decimal" value="${esc(numeroEditable(r?.gastos))}" placeholder="comisión, flete…"></div>
        </div>
        <div class="campo"><label for="g-fcobro">Fecha de cobro estimada</label>
          <input id="g-fcobro" name="fechaCobro" type="date" value="${esc(r?.fechaCobro)}"></div>
        <div class="tarjeta calculo-liq" id="g-calculo"></div>` : ''}
      <div class="campo"><label for="g-nota">Nota</label>
        <input id="g-nota" name="nota" value="${esc(r?.nota)}" placeholder="${tipo === 'LIQUIDACION' ? 'Orden 10242, C.O.E.…' : 'Carta de porte, camión…'}"></div>`,
    botones: [
      { accion: 'guardar', texto: 'Guardar', clase: 'btn-primario' },
      ...(r ? [{ accion: 'borrar', texto: 'Borrar', clase: 'btn-peligro' }] : []),
    ],
    validar: (accion, d) => {
      if (accion === 'borrar') {
        if (liq?.cobros.length) return `Tiene ${liq.cobros.length} cobro(s): borralos primero.`;
        const err = errorStock(granos, r, { ...r, kg: 0, tipo: r.tipo });
        return err ? `No se puede borrar: ${err}` : null;
      }
      const kg = parsearMonto(d.kg);
      if (!(kg > 0)) return { campo: 'kg', mensaje: 'Los kilos tienen que ser un número mayor a 0.' };
      if (tipo === 'LIQUIDACION') {
        if (!(parsearMonto(d.precioQq) > 0)) return { campo: 'precioQq', mensaje: 'Cargá el precio por quintal.' };
        if (d.gastos.trim() && !(parsearMonto(d.gastos) >= 0)) return { campo: 'gastos', mensaje: 'Tiene que ser un número.' };
      }
      const err = errorStock(granos, r, armar(tipo, d));
      return err ? { campo: 'kg', mensaje: err } : null;
    },
  });

  // Cálculo en vivo del bruto y el neto (el diálogo ya está en el DOM).
  const dlg = document.querySelector('dialog.dialogo:last-of-type');
  const calc = dlg?.querySelector('#g-calculo');
  if (calc) {
    const f = dlg.querySelector('form');
    const pintar = () => {
      const { bruto, gastos, neto } = importesLiquidacion({ kg: parsearMonto(f.kg.value), precioQq: parsearMonto(f.precioQq.value), gastos: parsearMonto(f.gastos.value) || 0 });
      calc.innerHTML = bruto > 0
        ? `Bruto ${formatoARS(bruto)}${gastos ? ` − gastos ${formatoARS(gastos)}` : ''} = <strong>neto a cobrar ${formatoARS(neto)}</strong>`
        : 'Con los kilos y el precio se calcula el importe.';
    };
    f.addEventListener('input', pintar);
    pintar();
  }
  // Al cambiar la campaña se propone su cultivo como grano (si no se escribió otro).
  const selCamp = dlg?.querySelector('#g-camp');
  selCamp?.addEventListener('change', () => {
    const inp = dlg.querySelector('#g-grano');
    const anterior = cultivoDe(inp.dataset.camp || campDefault);
    if (!inp.value || inp.value === anterior) inp.value = cultivoDe(selCamp.value);
    inp.dataset.camp = selCamp.value;
  });

  const res = await promesa;
  if (!res) return false;
  if (res.accion === 'borrar') {
    if (!confirm(`¿Borrar esta ${TITULOS[tipo]}?`)) return false;
    await borrar('granos', r.id);
    toast('Borrado');
    return true;
  }
  const datos = armar(tipo, res.datos);
  if (r) await actualizar('granos', r.id, datos);
  else await crear('granos', datos);
  toast('Guardado');
  return true;
}

function armar(tipo, d) {
  const kg = redondeoKg(parsearMonto(d.kg));
  return {
    tipo,
    fecha: d.fecha,
    campanaId: d.campanaId,
    grano: d.grano.trim(),
    acopio: d.acopio.trim(),
    kg: tipo === 'AJUSTE' && d.signo === 'restar' ? -kg : kg,
    precioQq: tipo === 'LIQUIDACION' ? parsearMonto(d.precioQq) : null,
    gastos: tipo === 'LIQUIDACION' ? (parsearMonto(d.gastos) || 0) : null,
    fechaCobro: tipo === 'LIQUIDACION' ? (d.fechaCobro || '') : '',
    liquidacionId: '',
    monto: null,
    movimientoId: '',
    movGenerado: false,
    nota: d.nota.trim(),
  };
}

// ---------------------------------------------------------------- Cobros

async function nuevoCobro(l, { granos, movimientos, categorias }) {
  if (!l) return false;
  const tipoIngreso = new Set(categorias.filter((c) => c.tipo === 'ingreso').map((c) => c.id));
  const vinculados = new Set(granos.filter((g) => g.tipo === 'COBRO' && g.movimientoId).map((g) => g.movimientoId));
  const candidatos = movimientos
    .filter((m) => tipoIngreso.has(m.categoriaId) && !vinculados.has(m.id))
    .sort((a, b) => (a.campanaId === l.campanaId ? 0 : 1) - (b.campanaId === l.campanaId ? 0 : 1) || b.fecha.localeCompare(a.fecha));
  const categoria = categorias.find((c) => c.tipo === 'ingreso' && normalizar(c.nombre) === 'venta de grano')
    || categorias.find((c) => c.tipo === 'ingreso');

  const promesa = abrirDialogo({
    titulo: `Cobro · ${l.acopio} ${formatoFecha(l.fecha)}`,
    cuerpo: `
      <p class="ayuda">Neto ${formatoARS(l.neto)} · cobrado ${formatoARS(l.cobrado)} · <strong>faltan ${formatoARS(l.pendiente)}</strong></p>
      <div class="campo"><span class="label">Movimiento de ingreso</span>
        <div class="segmentado segmentado-chico">
          <label><input type="radio" name="modo" value="generar" checked><span>Generarlo</span></label>
          ${candidatos.length ? '<label><input type="radio" name="modo" value="vincular"><span>Ya está cargado</span></label>' : ''}
        </div></div>
      <div data-modo="generar">
        <div class="fila-2">
          <div class="campo"><label for="c-fecha">Fecha</label>
            <input id="c-fecha" name="fecha" type="date" value="${esc(hoyISO())}"></div>
          <div class="campo"><label for="c-monto">Monto cobrado $</label>
            <input id="c-monto" name="monto" inputmode="decimal" value="${esc(numeroEditable(Math.max(l.pendiente, 0)))}"></div>
        </div>
        <p class="ayuda">Se crea un ingreso "${esc(categoria?.nombre || 'Venta de grano')}" en la campaña, con los quintales que cubre este cobro.</p>
      </div>
      <div data-modo="vincular" hidden>
        <div class="campo"><label for="c-mov">Movimiento</label>
          <select id="c-mov" name="movimientoId">
            ${candidatos.map((m) => `<option value="${esc(m.id)}">${formatoFecha(m.fecha)} · ${formatoARS(m.montoARS)} · ${esc((m.descripcion || '').slice(0, 50))}</option>`).join('')}
          </select></div>
        <p class="ayuda">No se crea nada nuevo: el cobro queda atado a ese ingreso.</p>
      </div>
      <div class="campo"><label for="c-nota">Nota</label><input id="c-nota" name="nota" placeholder="Transferencia, e-cheq…"></div>`,
    botones: [{ accion: 'guardar', texto: 'Guardar cobro', clase: 'btn-primario' }],
    validar: (accion, d) => {
      if (d.modo === 'vincular') return d.movimientoId ? null : 'Elegí el movimiento.';
      if (!d.fecha) return { campo: 'fecha', mensaje: 'Elegí la fecha.' };
      if (!(parsearMonto(d.monto) > 0)) return { campo: 'monto', mensaje: 'El monto tiene que ser mayor a 0.' };
      if (!categoria) return 'No hay ninguna categoría de ingreso: creá "Venta de grano" en Categorías.';
      return null;
    },
  });
  const dlg = document.querySelector('dialog.dialogo:last-of-type');
  dlg?.querySelectorAll('input[name="modo"]').forEach((radio) => radio.addEventListener('change', () => {
    dlg.querySelectorAll('[data-modo]').forEach((b) => { b.hidden = b.dataset.modo !== radio.value; });
  }));

  const res = await promesa;
  if (!res) return false;
  const d = res.datos;
  const base = {
    tipo: 'COBRO', campanaId: l.campanaId, grano: l.grano, acopio: l.acopio, kg: null, precioQq: null,
    gastos: null, fechaCobro: '', liquidacionId: l.id, nota: d.nota.trim(),
  };

  if (d.modo === 'vincular') {
    const mov = movimientos.find((m) => m.id === d.movimientoId);
    await crear('granos', { ...base, fecha: mov.fecha, monto: mov.montoARS, movimientoId: mov.id, movGenerado: false });
    toast('Cobro vinculado');
    return true;
  }

  const monto = parsearMonto(d.monto);
  const tipoDolar = (await ajustes.obtener('tipoDolar')) || 'MEP';
  const c = await obtenerCotizacion(tipoDolar, d.fecha);
  if (!c) { toast('No hay cotización del dólar disponible (sin conexión). Probá de nuevo con conexión.', { tipo: 'error' }); return false; }
  const quintales = quintalesDeCobro(l, monto);
  const mov = await crear('movimientos', {
    fecha: d.fecha,
    periodo: periodoDe(d.fecha),
    categoriaId: categoria.id,
    subcategoriaId: '',
    campanaId: l.campanaId,
    descripcion: `Cobro ${l.grano} ${l.acopio} - liquidación ${formatoFecha(l.fecha)} (${formatoNumero(l.kg / KG_POR_QQ)} qq a ${formatoARS(l.precioQq)}/qq)`,
    proveedor: l.acopio,
    moneda: 'ARS',
    montoOriginal: monto,
    tipoDolar,
    tc: c.tc,
    tcFecha: c.tcFecha,
    tcEstado: c.tcEstado,
    ...calcularMontos('ARS', monto, c.tc),
    quintales,
    precioQq: l.precioQq,
    pagoId: PAGO_CAJA,
    comprobanteUrl: '',
  });
  await crear('granos', { ...base, fecha: d.fecha, monto, movimientoId: mov.id, movGenerado: true });
  toast('Cobro guardado y movimiento de ingreso creado');
  return true;
}

async function borrarCobro(c) {
  if (!c) return false;
  const msg = c.movGenerado
    ? '¿Borrar el cobro? También se borra el movimiento de ingreso que generó.'
    : '¿Borrar el cobro? El movimiento vinculado queda como está.';
  if (!confirm(msg)) return false;
  await borrar('granos', c.id);
  if (c.movGenerado && c.movimientoId) await borrar('movimientos', c.movimientoId);
  toast('Cobro borrado');
  return true;
}
