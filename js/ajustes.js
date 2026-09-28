// Ajustes locales (usuario, clave, tipo de dólar por defecto, …).
// Fase 1: localStorage. En la Fase 2 pasan a la tabla `ajustes` de Dexie;
// la interfaz ya es async para que el cambio no afecte a quien la usa.

import { TIPO_DOLAR_DEFAULT } from './config.js';

const PREFIJO = 'campo.';

const DEFAULTS = {
  usuario: '',
  clave: '',
  tipoDolar: TIPO_DOLAR_DEFAULT,
};

function leer(clave) {
  try {
    const raw = localStorage.getItem(PREFIJO + clave);
    return raw === null ? DEFAULTS[clave] : JSON.parse(raw);
  } catch {
    return DEFAULTS[clave];
  }
}

export async function obtener(clave) {
  return leer(clave);
}

export async function guardar(clave, valor) {
  localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
}

// true si ya se eligió usuario y se cargó la clave.
export async function configuracionCompleta() {
  return Boolean(leer('usuario') && leer('clave'));
}
