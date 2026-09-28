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

let timerToast;
export function toast(mensaje, ms = 2500) {
  const el = document.getElementById('toast');
  el.textContent = mensaje;
  el.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { el.hidden = true; }, ms);
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
