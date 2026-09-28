// Router por hash: '#/movimientos', '#/movimientos/nuevo', '#/campanas', …

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

function rutaActual() {
  return location.hash.replace(/^#/, '') || RUTA_INICIAL;
}

export function navegar(ruta) {
  location.hash = '#' + ruta;
}

async function resolver() {
  const ruta = rutaActual();
  let match = null;
  const def = RUTAS.find((r) => (match = ruta.match(r.patron)));
  if (!def) return navegar(RUTA_INICIAL);

  // Sin usuario o clave, solo se permite Configuración (y Más).
  if (!def.libre && !(await configuracionCompleta())) {
    return navegar('/configuracion');
  }

  const params = {};
  (def.params || []).forEach((nombre, i) => { params[nombre] = decodeURIComponent(match[i + 1]); });

  // En celular, Categorías/Hermanos/Configuración cuelgan de "Más".
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
  if (rutaActual() === '/configuracion') return;
  resolver();
}

export function iniciarRouter() {
  window.addEventListener('hashchange', resolver);
  resolver();
}
