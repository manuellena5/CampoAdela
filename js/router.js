// Router por hash: '#/movimientos', '#/movimientos/nuevo', '#/campanas', …
//
// Historial: la app nunca acumula entradas. Siempre hay dos: una "base" y la "actual" (que se reemplaza
// al navegar). Así el botón "atrás" del celular dispara `popstate` y la app decide qué hacer:
//   - pantalla secundaria → vuelve a la pantalla principal desde la que se llegó;
//   - pantalla principal  → avisa "Tocá atrás otra vez para salir"; un segundo "atrás" sale de la app;
//   - diálogo abierto     → lo cierra.

import * as movimientos from './ui/movimientos.js';
import * as movimientoForm from './ui/movimientoForm.js';
import * as campanas from './ui/campanas.js';
import * as categorias from './ui/categorias.js';
import * as hermanos from './ui/hermanos.js';
import * as mas from './ui/mas.js';
import * as configuracion from './ui/configuracion.js';
import * as resumen from './ui/resumen.js';
import * as cuentas from './ui/cuentas.js';
import * as importar from './ui/importar.js';
import { configuracionCompleta } from './ajustes.js';
import { toast } from './lib/dom.js';

// `nav` = qué ítem de la barra de navegación se marca como activo.
// `libre` = accesible aunque falte usuario/clave.
const RUTAS = [
  { patron: /^\/movimientos$/, vista: movimientos, nav: 'movimientos' },
  { patron: /^\/movimientos\/nuevo$/, vista: movimientoForm, nav: 'nuevo' },
  { patron: /^\/movimientos\/([\w-]+)$/, vista: movimientoForm, nav: 'movimientos', params: ['id'] },
  { patron: /^\/campanas$/, vista: campanas, nav: 'campanas' },
  { patron: /^\/resumen$/, vista: resumen, nav: 'resumen' },
  { patron: /^\/resumen\/([\w-]+)$/, vista: resumen, nav: 'resumen', params: ['id'] },
  { patron: /^\/cuentas$/, vista: cuentas, nav: 'cuentas' },
  { patron: /^\/importar$/, vista: importar, nav: 'configuracion' },
  { patron: /^\/categorias$/, vista: categorias, nav: 'categorias' },
  { patron: /^\/hermanos$/, vista: hermanos, nav: 'hermanos' },
  { patron: /^\/mas$/, vista: mas, nav: 'mas', libre: true },
  { patron: /^\/configuracion$/, vista: configuracion, nav: 'configuracion', libre: true },
];

const RUTA_INICIAL = '/movimientos';
// Pantallas principales (barra de navegación). "Atrás" desde cualquier otra vuelve a la última de estas.
const PRINCIPALES = ['/movimientos', '/movimientos/nuevo', '/campanas', '/mas'];
const ESPERA_SALIR_MS = 2500;

let rutaMostrada = null; // ruta en pantalla (el hash de la entrada "base" puede estar desactualizado)
let origen = RUTA_INICIAL; // última pantalla principal visitada
let timerSalir = null;

const esPrincipal = (ruta) => PRINCIPALES.includes(ruta);
const ACTUAL = { campo: 'actual' };
const BASE = { campo: 'base' };

function rutaDelHash() {
  return location.hash.replace(/^#/, '') || RUTA_INICIAL;
}

// Navega sin agregar entradas al historial.
export function navegar(ruta) {
  clearTimeout(timerSalir);
  if (history.state?.campo === 'actual') history.replaceState(ACTUAL, '', `#${ruta}`);
  else history.pushState(ACTUAL, '', `#${ruta}`); // estábamos en la base (esperando el 2º "atrás")
  resolver(ruta);
}

async function resolver(ruta = rutaDelHash()) {
  let match = null;
  const def = RUTAS.find((r) => (match = ruta.match(r.patron)));
  if (!def) return navegar(RUTA_INICIAL);

  // Sin usuario o clave, solo se permite Configuración (y Más).
  if (!def.libre && !(await configuracionCompleta())) {
    return navegar('/configuracion');
  }

  rutaMostrada = ruta;
  if (esPrincipal(ruta)) origen = ruta;

  const params = {};
  (def.params || []).forEach((nombre, i) => { params[nombre] = decodeURIComponent(match[i + 1]); });

  // En celular, Resumen/Cuentas/Categorías/Hermanos/Configuración cuelgan de "Más".
  const bajoMas = ['resumen', 'cuentas', 'categorias', 'hermanos', 'configuracion'].includes(def.nav);
  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('activo', a.dataset.ruta === def.nav || (bajoMas && a.dataset.ruta === 'mas'));
  });

  const contenedor = document.getElementById('vista');
  contenedor.innerHTML = '';
  window.scrollTo(0, 0);
  await def.vista.render(contenedor, params);
}

// Vuelve a dibujar la vista actual (p. ej. cuando llegan datos de la sincronización).
// No interrumpe un diálogo abierto ni la pantalla de Configuración (puede haber algo a medio escribir).
export function refrescar() {
  if (document.querySelector('dialog[open]')) return;
  if (!rutaMostrada || rutaMostrada === '/configuracion') return;
  resolver(rutaMostrada);
}

// Se tocó "atrás": quedamos en la entrada base.
function alVolver() {
  const dialogo = document.querySelector('dialog[open]');
  if (dialogo) {
    dialogo.close();
    history.pushState(ACTUAL, '', `#${rutaMostrada}`);
    return;
  }
  if (!esPrincipal(rutaMostrada)) {
    const destino = origen;
    history.pushState(ACTUAL, '', `#${destino}`);
    resolver(destino);
    return;
  }
  // Pantalla principal: si no vuelve a tocar "atrás" en unos segundos, se rearma la protección.
  history.replaceState(BASE, '', `#${rutaMostrada}`); // que la URL coincida con lo que se ve
  toast('Tocá atrás otra vez para salir', ESPERA_SALIR_MS);
  clearTimeout(timerSalir);
  timerSalir = setTimeout(() => {
    if (history.state?.campo === 'base') history.pushState(ACTUAL, '', `#${rutaMostrada}`);
  }, ESPERA_SALIR_MS);
}

export function iniciarRouter() {
  const ruta = rutaDelHash();
  // Al recargar, el historial de la pestaña ya puede tener las dos entradas.
  if (history.state?.campo === 'base') {
    history.pushState(ACTUAL, '', `#${ruta}`);
  } else if (history.state?.campo !== 'actual') {
    history.replaceState(BASE, '', `#${ruta}`);
    history.pushState(ACTUAL, '', `#${ruta}`);
  }

  window.addEventListener('popstate', (e) => {
    if (e.state?.campo === 'base') alVolver();
    else if (e.state?.campo === 'actual') resolver(); // "adelante" del navegador
  });

  // Hash escrito a mano en la barra de direcciones (notebook): se toma como navegación normal.
  window.addEventListener('hashchange', () => {
    if (history.state?.campo) return; // ya lo manejó navegar() o popstate
    history.replaceState(ACTUAL, '', location.hash);
    resolver();
  });

  // Los enlaces internos (<a href="#/...">) no agregan entradas al historial.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || a.target) return;
    e.preventDefault();
    navegar(a.getAttribute('href').slice(1));
  });

  resolver(ruta);
}
