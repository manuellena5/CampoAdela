// Listado de movimientos (se implementa en la Fase 5).

import { vistaVacia } from '../lib/dom.js';

export async function render(el) {
  el.innerHTML = vistaVacia('Movimientos', 'Todavía no hay movimientos cargados.', 5);
}
