// Helpers de DOM mínimos.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Escapa texto para interpolar en HTML.
export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function $(selector, raiz = document) {
  return raiz.querySelector(selector);
}

export function $$(selector, raiz = document) {
  return [...raiz.querySelectorAll(selector)];
}

// Dispara la descarga de un Blob con el nombre dado.
export function descargar(nombre, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- Toasts
//
// toast(mensaje)                       → info, 2,5 s (como siempre)
// toast(mensaje, 4000)                 → info con duración
// toast(mensaje, { tipo, duracion, codigo, detalleId, acciones: [{ texto, fn }] })
//   tipo: 'info' | 'exito' | 'advertencia' | 'error'. Los de error quedan hasta cerrarlos.
// Máximo 3 a la vez; un toast idéntico a uno visible se agrupa ("×3").

const MAX_TOASTS = 3;
const DURACION = { info: 2500, exito: 2500, advertencia: 5000, error: 0 };
const ICONO = { info: 'ℹ', exito: '✓', advertencia: '⚠', error: '✕' };
const visibles = []; // { el, clave, cuenta, timer }
let manejadores = { verDetalle: null };

/** La app registra acá qué hacer con "Ver detalle" (abrir la entrada del log). */
export function configurarToasts(opciones) {
  manejadores = { ...manejadores, ...opciones };
}

function contenedorToasts() {
  let c = document.getElementById('toasts');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toasts';
    c.className = 'toasts';
    c.setAttribute('aria-live', 'polite');
    document.body.append(c);
  }
  return c;
}

function cerrarToast(t) {
  clearTimeout(t.timer);
  t.el.remove();
  const i = visibles.indexOf(t);
  if (i >= 0) visibles.splice(i, 1);
}

function programarCierre(t, duracion) {
  clearTimeout(t.timer);
  if (duracion > 0) t.timer = setTimeout(() => cerrarToast(t), duracion);
}

export function toast(mensaje, opciones = {}) {
  const o = typeof opciones === 'number' ? { duracion: opciones } : opciones;
  const tipo = o.tipo || 'info';
  const duracion = o.duracion ?? DURACION[tipo];
  const clave = `${tipo}|${o.codigo || ''}|${mensaje}`;

  const existente = visibles.find((t) => t.clave === clave);
  if (existente) {
    existente.cuenta++;
    existente.el.querySelector('.toast-cuenta').textContent = `×${existente.cuenta}`;
    if (o.detalleId) existente.detalleId = o.detalleId;
    programarCierre(existente, duracion);
    return;
  }
  while (visibles.length >= MAX_TOASTS) cerrarToast(visibles[0]);

  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  const acciones = [...(o.acciones || [])];
  el.innerHTML = `
    <span class="toast-icono" aria-hidden="true">${ICONO[tipo]}</span>
    <div class="toast-cuerpo">
      <div class="toast-texto">${o.codigo ? `<span class="toast-codigo">${esc(o.codigo)}</span> ` : ''}${esc(mensaje)} <span class="toast-cuenta"></span></div>
      <div class="toast-acciones"></div>
    </div>
    ${tipo === 'error' || duracion === 0 ? '<button type="button" class="toast-cerrar" aria-label="Cerrar">✕</button>' : ''}`;
  const t = { el, clave, cuenta: 1, timer: null, detalleId: o.detalleId };
  const cajaAcciones = el.querySelector('.toast-acciones');
  acciones.forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-accion';
    b.textContent = a.texto;
    b.addEventListener('click', () => { cerrarToast(t); a.fn(); });
    cajaAcciones.append(b);
  });
  if (o.detalleId !== undefined && o.detalleId !== null && manejadores.verDetalle) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-accion';
    b.textContent = 'Ver detalle';
    b.addEventListener('click', () => { cerrarToast(t); manejadores.verDetalle(t.detalleId); });
    cajaAcciones.append(b);
  }
  if (!cajaAcciones.children.length) cajaAcciones.remove();
  el.querySelector('.toast-cerrar')?.addEventListener('click', () => cerrarToast(t));

  contenedorToasts().append(el);
  visibles.push(t);
  programarCierre(t, duracion);
}

// ---------------------------------------------------------------- Errores junto al campo (E-VAL)

// Marca un campo como inválido y muestra el mensaje justo debajo del control
// (o de su fila: monto, cotización, grupo de opciones). `elemento`: el input/select (o un radio del grupo).
export function marcarErrorCampo(elemento, mensaje) {
  if (!elemento) return;
  const ancla = elemento.closest('.monto-fila, .cotizacion-fila, .con-boton, .segmentado') || elemento;
  (elemento.closest('.campo') || ancla.parentElement).classList.add('con-error');
  elemento.setAttribute('aria-invalid', 'true');
  const clave = elemento.name || elemento.id || 'campo';
  let msj = [...ancla.parentElement.querySelectorAll(':scope > .error-campo')].find((m) => m.dataset.para === clave);
  if (!msj) {
    msj = document.createElement('div');
    msj.className = 'error-campo';
    msj.dataset.para = clave;
    msj.setAttribute('role', 'alert');
    ancla.after(msj);
  }
  msj.textContent = mensaje;
}

// Quita todas las marcas de error dentro de `raiz`.
export function limpiarErroresCampos(raiz) {
  raiz.querySelectorAll('.con-error').forEach((e) => e.classList.remove('con-error'));
  raiz.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  raiz.querySelectorAll('.error-campo').forEach((e) => e.remove());
}

// Vista vacía estándar para pantallas todavía no implementadas.
export function vistaVacia(titulo, texto, fase) {
  return `
    <h1>${esc(titulo)}</h1>
    <div class="tarjeta vacio">
      <div>${esc(texto)}</div>
      ${fase ? `<span class="etiqueta-fase">Disponible en la Fase ${fase}</span>` : ''}
    </div>`;
}
