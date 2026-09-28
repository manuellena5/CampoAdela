// Diálogo modal con formulario (<dialog>). Devuelve una promesa con
// { accion, datos } o null si se canceló.
//
// abrirDialogo({
//   titulo, cuerpo: '<html de campos>',
//   botones: [{ accion: 'guardar', texto: 'Guardar', clase: 'btn-primario' }, …],
//   validar: (accion, datos) => 'mensaje de error' | null,
// })

import { esc } from './dom.js';

export function abrirDialogo({ titulo, cuerpo, botones = [], validar }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialogo';
    dlg.innerHTML = `
      <form method="dialog" novalidate>
        <h2>${esc(titulo)}</h2>
        <div class="dialogo-cuerpo">${cuerpo}</div>
        <div class="dialogo-error" hidden></div>
        <div class="dialogo-acciones">
          ${botones.map((b) => `<button class="btn ${b.clase || ''}" value="${esc(b.accion)}">${esc(b.texto)}</button>`).join('')}
          <button class="btn" value="cancelar">Cancelar</button>
        </div>
      </form>`;
    document.body.append(dlg);

    const form = dlg.querySelector('form');
    const error = dlg.querySelector('.dialogo-error');

    // Resuelve una sola vez (no depende del evento 'close', que Chrome demora en pestañas ocultas).
    let terminado = false;
    const terminar = (resultado) => {
      if (terminado) return;
      terminado = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(resultado);
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      // Enter en un input envía con el primer botón (el principal).
      const accion = e.submitter?.value || botones[0]?.accion || 'cancelar';
      if (accion === 'cancelar') return terminar(null);
      const datos = Object.fromEntries(new FormData(form));
      // Validación nativa solo al guardar (no al borrar).
      let mensaje = accion === 'guardar' && !form.checkValidity() ? 'Completá los campos obligatorios.' : null;
      mensaje = mensaje || validar?.(accion, datos) || null;
      if (mensaje) {
        error.textContent = mensaje;
        error.hidden = false;
        return;
      }
      terminar({ accion, datos });
    });

    // Esc
    dlg.addEventListener('cancel', () => terminar(null));
    dlg.addEventListener('close', () => terminar(null));

    dlg.showModal();
    dlg.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea')?.focus();
  });
}
