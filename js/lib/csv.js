// CSV compatible con Excel en español: separador ';', coma decimal, UTF-8 con BOM.

const SEPARADOR = ';';

function celda(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

// Número → texto con coma decimal y sin separador de miles ("1234,56").
export function numeroCSV(n, decimales = 2) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '';
  return String(Math.round(Number(n) * 10 ** decimales) / 10 ** decimales).replace('.', ',');
}

export function generarCSV(encabezados, filas) {
  return [encabezados, ...filas].map((f) => f.map(celda).join(SEPARADOR)).join('\r\n');
}

// Dispara la descarga de un CSV.
export function descargarCSV(nombre, contenido) {
  const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Parsea texto CSV. Detecta el separador (';', ',' o tab) mirando la primera línea.
// Devuelve una matriz de strings (sin filas totalmente vacías).
export function parsearCSV(texto) {
  const t = texto.replace(/^﻿/, '');
  const primera = t.split(/\r?\n/, 1)[0] || '';
  const candidatos = [';', ',', '\t'];
  const sep = candidatos.reduce((mejor, c) => (primera.split(c).length > primera.split(mejor).length ? c : mejor), ';');

  const filas = [];
  let fila = [];
  let actual = '';
  let enComillas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (enComillas) {
      if (ch === '"' && t[i + 1] === '"') { actual += '"'; i++; }
      else if (ch === '"') enComillas = false;
      else actual += ch;
    } else if (ch === '"') {
      enComillas = true;
    } else if (ch === sep) {
      fila.push(actual); actual = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      fila.push(actual); actual = '';
      filas.push(fila); fila = [];
    } else {
      actual += ch;
    }
  }
  if (actual !== '' || fila.length) { fila.push(actual); filas.push(fila); }
  return filas.filter((f) => f.some((c) => c.trim() !== ''));
}
