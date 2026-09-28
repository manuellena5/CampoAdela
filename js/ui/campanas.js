// ABM de campañas (se implementa en la Fase 2).

import { vistaVacia } from '../lib/dom.js';

export async function render(el) {
  el.innerHTML = vistaVacia('Campañas', 'Todavía no hay campañas.', 2);
}
