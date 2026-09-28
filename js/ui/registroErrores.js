// Configuración → Registro de errores (#/config/errores[/id]).
// Lista del log (lo más nuevo primero), filtro por nivel, detalle técnico al tocar una entrada,
// copiar / exportar .txt / borrar. Tabla en notebook y tarjetas en celular.

import { db } from '../db.js';
import * as ajustes from '../ajustes.js';
import { esc, toast, descargar } from '../lib/dom.js';
import { formatoFechaHora, hoyISO } from '../lib/formato.js';

const NIVELES = [['', 'Todos'], ['error', 'Errores'], ['advertencia', 'Advertencias'], ['info', 'Info']];
const NOMBRE_NIVEL = { error: 'Error', advertencia: 'Advertencia', info: 'Info' };
let filtroNivel = '';

// Errores (nivel "error") registrados después de la última vez que se abrió esta pantalla.
export async function contarErroresNuevos() {
  try {
    const visto = (await ajustes.obtener('logVistoHasta')) || '';
    return await db.logErrores.where('fecha').above(visto).filter((e) => e.nivel === 'error').count();
  } catch {
    return 0;
  }
}

function textoEntrada(e) {
  const ctx = e.contexto || {};
  return [
    `[${e.fecha}] ${e.codigo} (${NOMBRE_NIVEL[e.nivel] || e.nivel})${e.repeticiones > 1 ? ` ×${e.repeticiones} (última: ${e.ultimaVez})` : ''}`,
    `Mensaje: ${e.mensajeUsuario}`,
    `Técnico: ${e.mensajeTecnico}`,
    `Pantalla: ${ctx.pantalla || ''} · Acción: ${ctx.accion || ''}${ctx.datos ? ` · Datos: ${JSON.stringify(ctx.datos)}` : ''}`,
    `Versión ${e.version} · ${e.online ? 'con conexión' : 'sin conexión'} · ${e.userAgent}`,
    e.stack ? `Stack:\n${e.stack}` : '',
  ].filter(Boolean).join('\n');
}

export async function render(el, { id } = {}) {
  const abierta = id ? Number(id) : null;
  const todas = await db.logErrores.orderBy('id').reverse().toArray();
  const lista = filtroNivel ? todas.filter((e) => e.nivel === filtroNivel) : todas;
  const visto = (await ajustes.obtener('logVistoHasta')) || '';
  // Al abrir la pantalla, lo registrado hasta ahora deja de ser "nuevo".
  await ajustes.guardar('logVistoHasta', new Date().toISOString());
  window.dispatchEvent(new CustomEvent('log-visto'));

  const detalle = (e) => {
    const ctx = e.contexto || {};
    return `
      <dl class="log-detalle">
        <dt>Mensaje técnico</dt><dd><code>${esc(e.mensajeTecnico)}</code></dd>
        <dt>Pantalla / acción</dt><dd>${esc(ctx.pantalla || '—')} · ${esc(ctx.accion || '—')}</dd>
        ${ctx.datos ? `<dt>Datos</dt><dd><code>${esc(JSON.stringify(ctx.datos))}</code></dd>` : ''}
        <dt>Versión / conexión</dt><dd>${esc(e.version)} · ${e.online ? 'con conexión' : 'sin conexión'} · ${e.enviado ? 'subido al Sheet' : 'sin subir'}</dd>
        ${e.repeticiones > 1 ? `<dt>Última vez</dt><dd>${esc(formatoFechaHora(e.ultimaVez))}</dd>` : ''}
        <dt>Navegador</dt><dd class="texto-suave">${esc(e.userAgent)}</dd>
        ${e.stack ? `<dt>Stack</dt><dd><pre>${esc(e.stack)}</pre></dd>` : ''}
      </dl>`;
  };
  const badgeNivel = (e) => `<span class="badge nivel-${e.nivel}">${esc(NOMBRE_NIVEL[e.nivel] || e.nivel)}</span>`;
  const nuevo = (e) => (e.fecha > visto && e.nivel === 'error' ? ' <span class="badge badge-nuevo">nuevo</span>' : '');
  const reps = (e) => (e.repeticiones > 1 ? `<span class="repeticiones">×${e.repeticiones}</span>` : '');

  el.innerHTML = `
    <div class="encabezado">
      <h1>Registro de errores</h1>
    </div>
    <div class="tarjeta filtros">
      <div class="filtros-pie filtros-log">
        <div class="segmentado segmentado-chico" role="radiogroup" aria-label="Nivel">
          ${NIVELES.map(([v, t]) => `<label><input type="radio" name="nivel" value="${v}" ${v === filtroNivel ? 'checked' : ''}><span>${t}</span></label>`).join('')}
        </div>
        <span class="filtros-acciones">
          <button type="button" class="btn-link" data-log="copiar" ${lista.length ? '' : 'disabled'}>Copiar</button>
          <button type="button" class="btn-link" data-log="exportar" ${lista.length ? '' : 'disabled'}>Exportar .txt</button>
          <button type="button" class="btn-link texto-peligro" data-log="borrar" ${todas.length ? '' : 'disabled'}>Borrar log</button>
        </span>
      </div>
      <p class="detalle">${todas.length} entrada${todas.length === 1 ? '' : 's'} (se guardan las últimas 500). Tocá una para ver el detalle técnico.</p>
    </div>

    ${lista.length ? `
      <div class="tabla-contenedor vista-tabla">
        <table class="tabla tabla-log">
          <thead><tr><th>Fecha</th><th>Código</th><th>Nivel</th><th>Mensaje</th><th class="num">Veces</th></tr></thead>
          <tbody>
            ${lista.map((e) => `
              <tr data-entrada="${e.id}" tabindex="0" class="${e.id === abierta ? 'abierta' : ''}">
                <td class="nowrap">${esc(formatoFechaHora(e.fecha))}</td>
                <td class="nowrap"><strong>${esc(e.codigo)}</strong></td>
                <td>${badgeNivel(e)}</td>
                <td>${esc(e.mensajeUsuario)}${nuevo(e)}</td>
                <td class="num">${e.repeticiones > 1 ? `×${e.repeticiones}` : ''}</td>
              </tr>
              <tr class="fila-detalle" data-detalle="${e.id}" ${e.id === abierta ? '' : 'hidden'}><td colspan="5">${detalle(e)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="vista-tarjetas">
        ${lista.map((e) => `
          <div class="tarjeta tarjeta-log ${e.id === abierta ? 'abierta' : ''}" data-entrada="${e.id}" role="button" tabindex="0">
            <div class="item-fila">
              <span><strong>${esc(e.codigo)}</strong> ${badgeNivel(e)}${nuevo(e)}</span>
              ${reps(e)}
            </div>
            <div class="detalle">${esc(formatoFechaHora(e.fecha))}</div>
            <div>${esc(e.mensajeUsuario)}</div>
            <div data-detalle="${e.id}" ${e.id === abierta ? '' : 'hidden'}>${detalle(e)}</div>
          </div>`).join('')}
      </div>` : `<div class="tarjeta vacio">${todas.length ? 'No hay entradas con este filtro.' : 'No hay errores registrados. 👍'}</div>`}`;

  if (abierta) el.querySelector(`[data-entrada="${abierta}"]:not([hidden])`)?.scrollIntoView({ block: 'center' });

  const alternar = (idEntrada) => {
    el.querySelectorAll(`[data-detalle="${idEntrada}"]`).forEach((d) => { d.hidden = !d.hidden; });
    el.querySelectorAll(`[data-entrada="${idEntrada}"]`).forEach((f) => f.classList.toggle('abierta'));
  };

  el.onchange = (e) => {
    if (e.target.name === 'nivel') { filtroNivel = e.target.value; render(el); }
  };
  el.onkeydown = (e) => {
    const fila = e.key === 'Enter' && e.target.closest('[data-entrada]');
    if (fila && e.target === fila) alternar(fila.dataset.entrada);
  };
  el.onclick = async (e) => {
    const accion = e.target.closest('[data-log]')?.dataset.log;
    if (accion === 'copiar') {
      try {
        await navigator.clipboard.writeText(lista.map(textoEntrada).join('\n\n'));
        toast('Registro copiado', { tipo: 'exito' });
      } catch {
        toast('No se pudo copiar. Probá con "Exportar .txt".', { tipo: 'advertencia' });
      }
      return;
    }
    if (accion === 'exportar') {
      const texto = `Registro de errores — Campo — exportado el ${new Date().toISOString()}\n\n${lista.map(textoEntrada).join('\n\n')}\n`;
      descargar(`errores-campo-${hoyISO()}.txt`, new Blob([texto], { type: 'text/plain;charset=utf-8' }));
      return;
    }
    if (accion === 'borrar') {
      if (!confirm(`¿Borrar las ${todas.length} entradas del registro de errores de este dispositivo?\n(Las que ya se subieron siguen en la pestaña "Errores" del Sheet.)`)) return;
      await db.logErrores.clear();
      try { localStorage.removeItem('campoLogErrores'); } catch { /* nada */ }
      toast('Registro borrado', { tipo: 'exito' });
      window.dispatchEvent(new CustomEvent('log-visto'));
      render(el);
      return;
    }
    const entrada = e.target.closest('[data-entrada]');
    if (entrada && !e.target.closest('[data-detalle]')) alternar(entrada.dataset.entrada);
  };
}
