// ABM de hermanos (se implementa en la Fase 2).

import { vistaVacia } from '../lib/dom.js';

export async function render(el) {
  el.innerHTML = vistaVacia('Hermanos', 'Matias, Martin y Manuel.', 2);
}
