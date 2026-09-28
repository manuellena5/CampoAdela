// ABM de categorías y subcategorías (se implementa en la Fase 2).

import { vistaVacia } from '../lib/dom.js';

export async function render(el) {
  el.innerHTML = vistaVacia('Categorías', 'Categorías y subcategorías de gastos e ingresos.', 2);
}
