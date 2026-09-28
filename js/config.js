// Configuración fija de la app. Se versiona con el código para que
// sobreviva a un borrado de caché/datos del navegador.

export const APP_VERSION = '0.8.0';

// URL del Web App de Google Apps Script.
const URL_PRODUCCION = 'https://script.google.com/macros/s/AKfycbyiNVgNd6wco_6vC2X9WTMLxvPJcNd1u-fv9vaIa7MXDG_LbGE6NTYMhiLFAMF5xmot/exec';

// En desarrollo (localhost) se usa el Apps Script simulado de tools/apps-script-local.mjs,
// para que los datos de prueba nunca lleguen al Sheet real.
export const APPS_SCRIPT_URL = location.hostname === 'localhost' ? 'http://localhost:8090/' : URL_PRODUCCION;

// Zona horaria de la app (igual que el Apps Script). Las fechas de calendario
// (fecha del movimiento, "hoy") se calculan acá; los timestamps se guardan en UTC ISO.
export const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';

export const TIPO_DOLAR_DEFAULT = 'MEP';
export const HECTAREAS_DEFAULT = 20;
