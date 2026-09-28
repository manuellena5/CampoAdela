// Ajustes locales (usuario, clave, tipo de dólar por defecto, lastSync, …)
// en la tabla `ajustes` de Dexie. Nunca se sincronizan.

import { TIPO_DOLAR_DEFAULT } from './config.js';
import { db } from './db.js';

const DEFAULTS = {
  usuario: '',
  clave: '',
  tipoDolar: TIPO_DOLAR_DEFAULT,
};

export async function obtener(clave) {
  const fila = await db.ajustes.get(clave);
  return fila ? fila.valor : DEFAULTS[clave];
}

export async function guardar(clave, valor) {
  await db.ajustes.put({ clave, valor });
}

// true si ya se eligió usuario y se cargó la clave.
export async function configuracionCompleta() {
  const [usuario, clave] = await Promise.all([obtener('usuario'), obtener('clave')]);
  return Boolean(usuario && clave);
}
