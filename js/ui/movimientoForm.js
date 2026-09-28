// Alta / edición de movimiento. Prioridad: rapidez de carga.

import { db, listar, crear, actualizar, borrar } from '../db.js';
import * as ajustes from '../ajustes.js';
import { obtenerCotizacion, TIPOS_DOLAR } from '../dolar.js';
import { PAGO_CAJA, calcularMontos, campanaParaFecha, periodoDe, redondear } from '../dominio.js';
import { esc, $, toast, marcarErrorCampo, limpiarErroresCampos } from '../lib/dom.js';
import { formatoARS, formatoUSD, formatoFecha, hoyISO, parsearMonto, numeroEditable } from '../lib/formato.js';
import { navegar } from '../router.js';
import { TIPOS_ACEPTADOS, validarArchivo, prepararArchivo, encolar, pendienteDe, quitarDeCola } from '../storage.js';

const ETIQUETA_ESTADO_TC = { api: '', manual: 'manual', a_confirmar: 'a confirmar' };

// `plantilla`: valores a conservar al usar "Guardar y cargar otro".
export async function render(el, { id } = {}, plantilla = null) {
  const [categorias, subcategorias, campanas, hermanos, tipoDolarDefault] = await Promise.all([
    listar('categorias'), listar('subcategorias'), listar('campanas'), listar('hermanos'),
    ajustes.obtener('tipoDolar'),
  ]);

  const existente = id ? await db.movimientos.get(id) : null;
  if (id && (!existente || existente.borrado)) {
    el.innerHTML = '<div class="form-centrado"><div class="aviso">El movimiento no existe o fue borrado.</div></div>';
    return;
  }

  const m = existente || {
    fecha: hoyISO(), categoriaId: '', subcategoriaId: '', campanaId: '', descripcion: '', proveedor: '',
    moneda: 'ARS', montoOriginal: null, tipoDolar: tipoDolarDefault, tc: null, tcFecha: '', tcEstado: 'api',
    quintales: null, precioQq: null, pagoId: PAGO_CAJA, comprobanteUrl: '',
    ...(plantilla || {}),
  };
  if (!existente && !plantilla) m.campanaId = campanaParaFecha(campanas, m.fecha)?.id || '';

  // Estado de la cotización y de la precarga de campaña.
  const estado = {
    tc: m.tc, tcFecha: m.tcFecha, tcEstado: m.tcEstado,
    campanaTocada: Boolean(existente || plantilla?.campanaTocada), consulta: 0,
  };

  const porOrden = (a, b) => a.orden - b.orden;
  const opcionesCategoria = (tipo) => categorias
    .filter((c) => c.tipo === tipo && (c.activa || c.id === m.categoriaId))
    .sort(porOrden)
    .map((c) => `<option value="${esc(c.id)}" ${c.id === m.categoriaId ? 'selected' : ''}>${esc(c.nombre)}</option>`)
    .join('');
  const campanasOrdenadas = [...campanas].sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || ''));
  const pagadores = [
    { id: PAGO_CAJA, nombre: 'Caja común' },
    ...hermanos.filter((h) => h.activo || h.id === m.pagoId).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
  ];
  const masDatosAbierto = Boolean(m.proveedor || m.quintales || m.precioQq);

  el.innerHTML = `
    <div class="form-centrado">
      <h1>${existente ? 'Editar movimiento' : 'Nuevo movimiento'}</h1>
      <form id="form-mov" class="tarjeta" novalidate autocomplete="off">
        <div class="campo">
          <label for="m-fecha">Fecha</label>
          <input id="m-fecha" name="fecha" type="date" required value="${esc(m.fecha)}">
        </div>

        <div class="campo">
          <label for="m-desc">Descripción</label>
          <input id="m-desc" name="descripcion" placeholder="Ej.: Semilla soja, 2da pasada de herbicida…" value="${esc(m.descripcion)}">
        </div>

        <div class="campo">
          <label for="m-cat">Categoría <span id="m-tipo" class="badge"></span></label>
          <select id="m-cat" name="categoriaId" required>
            <option value="">Elegí una categoría…</option>
            <optgroup label="Gastos">${opcionesCategoria('gasto')}</optgroup>
            <optgroup label="Ingresos">${opcionesCategoria('ingreso')}</optgroup>
          </select>
        </div>

        <div class="campo" id="campo-sub" hidden>
          <label for="m-sub">Subcategoría</label>
          <select id="m-sub" name="subcategoriaId"></select>
        </div>

        <div class="campo">
          <label for="m-monto">Monto</label>
          <div class="monto-fila">
            <div class="segmentado segmentado-chico">
              ${['ARS', 'USD'].map((mon) => `
                <label><input type="radio" name="moneda" value="${mon}" ${mon === m.moneda ? 'checked' : ''}><span>${mon === 'ARS' ? '$' : 'US$'}</span></label>`).join('')}
            </div>
            <input id="m-monto" name="montoOriginal" class="input-grande" inputmode="decimal" placeholder="0" required
              value="${esc(numeroEditable(m.montoOriginal))}">
          </div>

          <div class="cotizacion">
            <div class="cotizacion-fila">
              <div class="segmentado segmentado-chico">
                ${TIPOS_DOLAR.map(([valor, texto]) => `
                  <label><input type="radio" name="tipoDolar" value="${valor}" ${valor === m.tipoDolar ? 'checked' : ''}><span>${texto}</span></label>`).join('')}
              </div>
              <label class="tc-label" for="m-tc">TC</label>
              <input id="m-tc" name="tc" class="input-tc" inputmode="decimal" value="${esc(numeroEditable(m.tc))}">
              <button type="button" class="btn-icono" id="m-refrescar-tc" title="Volver a buscar la cotización" aria-label="Volver a buscar la cotización">↻</button>
            </div>
            <div class="cotizacion-info" id="m-tc-info"></div>
            <div class="equivalente" id="m-equivalente"></div>
          </div>
        </div>

        <div class="campo">
          <label for="m-campana">Campaña</label>
          <select id="m-campana" name="campanaId">
            <option value="">Sin campaña (gasto general del campo)</option>
            ${campanasOrdenadas.map((c) => `<option value="${esc(c.id)}" ${c.id === m.campanaId ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
          </select>
        </div>

        <div class="campo">
          <label for="m-pago">Pagó</label>
          <select id="m-pago" name="pagoId">
            ${pagadores.map((p) => `<option value="${esc(p.id)}" ${p.id === m.pagoId ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}
          </select>
        </div>

        <div class="campo">
          <span class="label">Comprobante</span>
          <div class="comprobante" id="m-comprobante"></div>
          <input type="file" id="m-archivo" accept="${TIPOS_ACEPTADOS}" hidden>
        </div>

        <details class="mas-datos" ${masDatosAbierto ? 'open' : ''}>
          <summary>Más datos</summary>
          <div class="campo">
            <label for="m-prov">Proveedor</label>
            <input id="m-prov" name="proveedor" placeholder="Contratista, agronomía, acopio, comprador…" value="${esc(m.proveedor)}">
          </div>
          <div class="fila-2">
            <div class="campo">
              <label for="m-qq">Quintales</label>
              <input id="m-qq" name="quintales" inputmode="decimal" value="${esc(numeroEditable(m.quintales))}">
            </div>
            <div class="campo">
              <label for="m-precio">Precio por qq</label>
              <input id="m-precio" name="precioQq" inputmode="decimal" value="${esc(numeroEditable(m.precioQq))}">
            </div>
          </div>
          <button type="button" class="btn btn-bloque" id="m-calcular">Calcular monto = qq × precio</button>
        </details>

        <div class="acciones acciones-form">
          <button type="submit" class="btn btn-primario" value="guardar">Guardar</button>
          ${existente
            ? '<button type="button" class="btn btn-peligro" id="m-borrar">Borrar</button>'
            : '<button type="submit" class="btn" value="otro">Guardar y cargar otro</button>'}
        </div>
      </form>
    </div>`;

  const form = $('#form-mov', el);
  const campo = (nombre) => form.elements[nombre];
  const valorRadio = (nombre) => form.querySelector(`input[name="${nombre}"]:checked`)?.value;

  // ---- Categoría / subcategoría

  function actualizarCategoria() {
    const cat = categorias.find((c) => c.id === campo('categoriaId').value);
    const badge = $('#m-tipo', el);
    badge.textContent = cat ? (cat.tipo === 'gasto' ? 'Gasto' : 'Ingreso') : '';
    badge.className = `badge ${cat ? `badge-${cat.tipo}` : ''}`;

    const subs = subcategorias
      .filter((s) => cat && s.categoriaId === cat.id && (s.activa || s.id === m.subcategoriaId))
      .sort(porOrden);
    const select = campo('subcategoriaId');
    const previa = select.value || m.subcategoriaId;
    select.innerHTML = '<option value="">—</option>'
      + subs.map((s) => `<option value="${esc(s.id)}" ${s.id === previa ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('');
    $('#campo-sub', el).hidden = !subs.length;
  }

  // ---- Cotización

  function mostrarCotizacion(buscando = false) {
    const info = $('#m-tc-info', el);
    if (buscando) {
      info.textContent = 'Buscando cotización…';
    } else if (!estado.tc) {
      info.innerHTML = '<span class="texto-aviso">Sin cotización disponible: ingresala a mano.</span>';
    } else {
      const etiqueta = ETIQUETA_ESTADO_TC[estado.tcEstado];
      const tipo = valorRadio('tipoDolar') === 'MEP' ? 'MEP' : 'Oficial';
      info.innerHTML = `${tipo}${estado.tcFecha ? ` del ${formatoFecha(estado.tcFecha)}` : ''}`
        + (etiqueta ? ` <span class="badge badge-${estado.tcEstado.replace('_', '-')}">${etiqueta}</span>` : '');
    }
    actualizarEquivalente();
  }

  function actualizarEquivalente() {
    const monto = parsearMonto(campo('montoOriginal').value);
    const tc = parsearMonto(campo('tc').value);
    const eq = $('#m-equivalente', el);
    if (!(monto > 0) || !(tc > 0)) { eq.textContent = ''; return; }
    const { montoARS, montoUSD } = calcularMontos(valorRadio('moneda'), monto, tc);
    eq.textContent = valorRadio('moneda') === 'USD' ? `≈ ${formatoARS(montoARS)}` : `≈ ${formatoUSD(montoUSD)}`;
  }

  async function buscarCotizacion() {
    const consulta = ++estado.consulta; // descarta respuestas viejas si el usuario cambia rápido
    mostrarCotizacion(true);
    const c = await obtenerCotizacion(valorRadio('tipoDolar'), campo('fecha').value || hoyISO());
    if (consulta !== estado.consulta) return;
    if (c) {
      Object.assign(estado, { tc: c.tc, tcFecha: c.tcFecha, tcEstado: c.tcEstado });
      campo('tc').value = numeroEditable(c.tc);
    } else {
      Object.assign(estado, { tc: null, tcFecha: '', tcEstado: 'manual' });
      campo('tc').value = '';
    }
    mostrarCotizacion();
  }

  // ---- Comprobante

  const comprobante = {
    nuevo: null, // File elegido en esta edición
    quitar: false,
    pendiente: existente ? await pendienteDe(existente.id) : null, // en cola, sin subir
  };

  function mostrarComprobante() {
    const cont = $('#m-comprobante', el);
    const acciones = '<button type="button" class="btn-link" data-comp="cambiar">Cambiar</button>'
      + '<button type="button" class="btn-link texto-peligro" data-comp="quitar">Quitar</button>';
    if (comprobante.nuevo) {
      cont.innerHTML = `<span>📎 ${esc(comprobante.nuevo.name)} <span class="texto-suave">(se sube al guardar)</span></span>${acciones}`;
    } else if (comprobante.pendiente && !comprobante.quitar) {
      cont.innerHTML = `<span>📎 ${esc(comprobante.pendiente.nombre)} <span class="badge badge-a-confirmar">pendiente de subir</span></span>${acciones}`;
    } else if (m.comprobanteUrl && !comprobante.quitar) {
      cont.innerHTML = `<a href="${esc(m.comprobanteUrl)}" target="_blank" rel="noopener">📎 Ver comprobante</a>${acciones}`;
    } else {
      cont.innerHTML = '<button type="button" class="btn btn-bloque" data-comp="cambiar">📷 Adjuntar foto o PDF</button>';
    }
  }

  $('#m-comprobante', el).addEventListener('click', (e) => {
    const accion = e.target.closest('[data-comp]')?.dataset.comp;
    if (accion === 'cambiar') $('#m-archivo', el).click();
    if (accion === 'quitar') {
      Object.assign(comprobante, { nuevo: null, quitar: true });
      mostrarComprobante();
    }
  });

  $('#m-archivo', el).addEventListener('change', (e) => {
    const archivo = e.target.files[0];
    e.target.value = '';
    if (!archivo) return;
    const error = validarArchivo(archivo);
    if (error) { toast(error); return; }
    Object.assign(comprobante, { nuevo: archivo, quitar: false });
    mostrarComprobante();
  });

  // ---- Eventos

  campo('categoriaId').addEventListener('change', actualizarCategoria);

  campo('fecha').addEventListener('change', () => {
    if (!estado.campanaTocada) campo('campanaId').value = campanaParaFecha(campanas, campo('fecha').value)?.id || '';
    buscarCotizacion();
  });
  form.querySelectorAll('input[name="tipoDolar"]').forEach((r) => r.addEventListener('change', buscarCotizacion));
  $('#m-refrescar-tc', el).addEventListener('click', buscarCotizacion);

  campo('tc').addEventListener('input', () => {
    estado.consulta++; // una búsqueda en curso ya no pisa lo que escribió el usuario
    Object.assign(estado, { tc: parsearMonto(campo('tc').value), tcEstado: 'manual', tcFecha: campo('fecha').value });
    mostrarCotizacion();
  });
  campo('montoOriginal').addEventListener('input', actualizarEquivalente);
  form.querySelectorAll('input[name="moneda"]').forEach((r) => r.addEventListener('change', actualizarEquivalente));
  campo('campanaId').addEventListener('change', () => { estado.campanaTocada = true; });

  $('#m-calcular', el).addEventListener('click', () => {
    const qq = parsearMonto(campo('quintales').value);
    const precio = parsearMonto(campo('precioQq').value);
    if (!(qq > 0) || !(precio > 0)) { toast('Completá quintales y precio por qq'); return; }
    campo('montoOriginal').value = numeroEditable(redondear(qq * precio));
    actualizarEquivalente();
  });

  $('#m-borrar', el)?.addEventListener('click', async () => {
    if (!confirm('¿Borrar este movimiento?')) return;
    await borrar('movimientos', existente.id);
    toast('Movimiento borrado');
    navegar('/movimientos');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const accion = e.submitter?.value || 'guardar';

    const fecha = campo('fecha').value;
    const montoOriginal = parsearMonto(campo('montoOriginal').value);
    const tc = parsearMonto(campo('tc').value);
    const opcional = (nombre) => {
      const n = parsearMonto(campo(nombre).value);
      return Number.isFinite(n) ? n : null;
    };

    // Validación (E-VAL): cada mensaje junto a su campo, no como toast.
    limpiarErroresCampos(form);
    const errores = [];
    const invalido = (control, mensaje) => { marcarErrorCampo(control, mensaje); errores.push(control); };
    if (!fecha) invalido(campo('fecha'), 'Elegí la fecha.');
    if (!campo('categoriaId').value) invalido(campo('categoriaId'), 'Elegí una categoría.');
    if (!(montoOriginal > 0)) {
      invalido(campo('montoOriginal'), campo('montoOriginal').value.trim() ? 'El monto tiene que ser un número mayor a 0.' : 'Cargá el monto.');
    }
    if (!(tc > 0)) invalido(campo('tc'), 'Falta la cotización del dólar (TC).');
    for (const [nombre, texto] of [['quintales', 'Quintales'], ['precioQq', 'Precio por qq']]) {
      if (campo(nombre).value.trim() && !(opcional(nombre) >= 0)) {
        $('.mas-datos', el).open = true;
        invalido(campo(nombre), `${texto}: tiene que ser un número.`);
      }
    }
    if (errores.length) {
      errores[0].focus();
      return;
    }

    const moneda = valorRadio('moneda');
    const datos = {
      fecha,
      periodo: periodoDe(fecha),
      categoriaId: campo('categoriaId').value,
      subcategoriaId: $('#campo-sub', el).hidden ? '' : campo('subcategoriaId').value,
      campanaId: campo('campanaId').value,
      descripcion: campo('descripcion').value.trim(),
      proveedor: campo('proveedor').value.trim(),
      moneda,
      montoOriginal,
      tipoDolar: valorRadio('tipoDolar'),
      tc,
      tcFecha: estado.tcFecha || fecha,
      tcEstado: estado.tcEstado,
      ...calcularMontos(moneda, montoOriginal, tc),
      quintales: opcional('quintales'),
      precioQq: opcional('precioQq'),
      pagoId: campo('pagoId').value || PAGO_CAJA,
      comprobanteUrl: comprobante.quitar ? '' : m.comprobanteUrl || '',
    };

    // El comprobante se encola antes de guardar: la sincronización que dispara el guardado ya lo sube.
    const movId = existente?.id || crypto.randomUUID();
    if (comprobante.nuevo) await encolar(movId, await prepararArchivo(comprobante.nuevo));
    else if (comprobante.quitar) await quitarDeCola(movId);

    if (existente) await actualizar('movimientos', existente.id, datos);
    else await crear('movimientos', datos, movId);

    toast(estado.tcEstado === 'a_confirmar' ? 'Guardado (cotización a confirmar)' : 'Guardado');
    if (accion === 'otro') {
      const { fecha: f, campanaId, pagoId, moneda: mon, tipoDolar } = datos;
      await render(el, {}, { fecha: f, campanaId, pagoId, moneda: mon, tipoDolar, campanaTocada: estado.campanaTocada });
      window.scrollTo(0, 0);
    } else {
      navegar('/movimientos');
    }
  });

  actualizarCategoria();
  mostrarCotizacion();
  mostrarComprobante();
  if (!existente) buscarCotizacion();
  // En notebook se arranca escribiendo; en el celular no (abriría el teclado encima del formulario).
  if (!existente && matchMedia('(pointer: fine)').matches) campo('descripcion').focus();
}
