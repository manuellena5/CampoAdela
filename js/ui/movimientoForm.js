// Alta / edición de movimiento (se implementa en la Fase 4).

import { vistaVacia } from '../lib/dom.js';

export async function render(el, { id } = {}) {
  el.innerHTML = `<div class="form-centrado">${vistaVacia(
    id ? 'Editar movimiento' : 'Nuevo movimiento',
    'Acá va el formulario de carga rápida.',
    4
  )}</div>`;
}
