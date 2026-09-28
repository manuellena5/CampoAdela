// Diálogo modal con formulario (<dialog>). Devuelve una promesa con
// { accion, datos } o null si se canceló.
//
// abrirDialogo({
//   titulo, cuerpo: '<html de campos>',
//   botones: [{ accion: 'guardar', texto: 'Guardar', clase: 'btn-primario' }, …],
//   validar: (accion, datos) => null | 'mensaje general' | { campo, mensaje } | [{ campo, mensaje }, …],
// })
// Los errores con `campo` (el name del input) se muestran junto a ese campo (E-VAL); los generales, abajo.

import { esc, marcarErrorCampo, limpiarErroresCampos } from './dom.js';

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
      limpiarErroresCampos(form);
      error.hidden = true;

      // Obligatorios (solo al guardar, no al borrar) y validación propia.
      const problemas = [];
      if (accion === 'guardar') {
        form.querySelectorAll('[required]').forEach((c) => {
          if (!c.checkValidity()) problemas.push({ campo: c.name, mensaje: 'Este dato es obligatorio.' });
        });
      }
      if (!problemas.length) {
        const r = validar?.(accion, datos);
        if (r) problemas.push(...(Array.isArray(r) ? r : [typeof r === 'string' ? { mensaje: r } : r]));
      }
      if (problemas.length) {
        let primero = null;
        for (const p of problemas) {
          const control = p.campo && form.elements[p.campo];
          const elemento = control instanceof RadioNodeList ? control[0] : control;
          if (elemento) {
            marcarErrorCampo(elemento, p.mensaje);
            primero ??= elemento;
          } else {
            error.textContent = p.mensaje;
            error.hidden = false;
          }
        }
        primero?.focus();
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
