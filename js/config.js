// Configuración fija de la app. Se versiona con el código para que
// sobreviva a un borrado de caché/datos del navegador.

export const APP_VERSION = '0.1.0';

// URL del Web App de Google Apps Script (se completa en la Fase 3).
export const APPS_SCRIPT_URL = '';

export const TIPO_DOLAR_DEFAULT = 'MEP';
export const HECTAREAS_DEFAULT = 20;

// Lista fija provisoria de hermanos (Fase 1). En la Fase 2 pasa a Dexie
// como seed, con estos mismos ids.
export const HERMANOS_SEED = [
  { id: '00000000-0000-4000-8000-000000000001', nombre: 'Matias' },
  { id: '00000000-0000-4000-8000-000000000002', nombre: 'Martin' },
  { id: '00000000-0000-4000-8000-000000000003', nombre: 'Manuel' },
];
