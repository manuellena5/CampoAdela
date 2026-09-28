# Genera migracion/movimientos-excel.csv (formato de la plantilla de importación) a partir de la
# hoja "Movimientos" de CAMPO ADELA.xlsx. La carpeta migracion/ no se sube al repo.
#
# La planilla solo tiene el mes (PERIODO) y la cotización usada: la fecha se deduce buscando, en ese mes,
# el día hábil cuyo dólar (MEP u Oficial, venta) coincide con la cotización. Si no hay coincidencia exacta
# se toma el más cercano y se informa.
#
# Uso: python tools/generar-migracion.py   (requiere migracion/hist-bolsa.json, hist-oficial.json, feriados-*.json)
import csv
import json
import datetime as dt
from pathlib import Path

import openpyxl

RAIZ = Path(__file__).resolve().parent.parent
MIG = RAIZ / 'migracion'

# ACTIVIDAD (en mayúsculas, prefijo) → (categoría, subcategoría, con campaña)
MAPEO = [
    ('FUMIGACION M.O', 'Servicios', 'Pulverización', True),
    ('FUMIGACION INSUMOS', 'Insumos', 'Herbicidas', True),
    ('PAGO CONTRATO', 'Impuestos', 'Contrato', False),
    ('SEMILLAS', 'Insumos', 'Semilla', True),
    ('TUBOS', 'Obras / mant. campo', '', False),
    ('SIEMBRA', 'Servicios', 'Siembra', True),
    ('MONOTRIBUTO', 'Impuestos', 'Monotributo', False),
    ('SERVICIO COSECHA', 'Servicios', 'Cosecha', True),
]
CAMPANA = 'Soja 25-26'


def cargar_hist(nombre):
    return {x['fecha']: x['venta'] for x in json.loads((MIG / nombre).read_text(encoding='utf-8'))}


HIST = {'MEP': cargar_hist('hist-bolsa.json'), 'Oficial': cargar_hist('hist-oficial.json')}
FERIADOS = {f['fecha'] for anio in (2025, 2026) for f in json.loads((MIG / f'feriados-{anio}.json').read_text(encoding='utf-8'))}


def dias_habiles(periodo):
    anio, mes = int(periodo[:4]), int(periodo[4:])
    d = dt.date(anio, mes, 1)
    while d.month == mes:
        iso = d.isoformat()
        if d.weekday() < 5 and iso not in FERIADOS:
            yield iso
        d += dt.timedelta(days=1)


def deducir_fecha(periodo, cotizacion):
    """(fecha, tipo, valor_api, exacta) del día hábil del mes con la cotización más parecida."""
    mejor = None
    for tipo, hist in HIST.items():
        for dia in dias_habiles(periodo):
            if dia in hist:
                dif = abs(hist[dia] - cotizacion)
                if mejor is None or dif < mejor[0]:
                    mejor = (dif, dia, tipo, hist[dia])
    dif, dia, tipo, valor = mejor
    return dia, tipo, valor, dif < 0.005


def numero(n):
    return f'{round(n, 2):.2f}'.rstrip('0').rstrip('.').replace('.', ',')


def main():
    wb = openpyxl.load_workbook(RAIZ / 'CAMPO ADELA.xlsx', data_only=True)
    ws = wb['Movimientos']
    filas = []
    for fila in ws.iter_rows(min_row=2, values_only=True):
        periodo, _mes, actividad, _usd, _ind_usd, total, _ind, cotizacion = fila[:8]
        if not periodo or not actividad:
            continue
        clave = str(actividad).upper().strip()
        cat = next((m for m in MAPEO if clave.startswith(m[0])), None)
        if not cat:
            raise SystemExit(f'Actividad sin mapeo: {actividad}')
        fecha, tipo, valor_api, exacta = deducir_fecha(str(periodo), float(cotizacion))
        filas.append({
            'Fecha': dt.date.fromisoformat(fecha).strftime('%d/%m/%Y'),
            'Categoría': cat[1],
            'Subcategoría': cat[2],
            'Campaña': CAMPANA if cat[3] else '',
            'Descripción': str(actividad).strip(),
            'Proveedor': '',
            'Moneda': 'ARS',
            'Monto': numero(-float(total)),
            'Tipo de dólar': tipo,
            'Cotización': numero(float(cotizacion)),
            'Quintales': '',
            'Precio por qq': '',
            'Pagó': 'Caja común',
        })
        marca = 'exacta' if exacta else f'aprox. (API {valor_api})'
        print(f'{periodo} {str(actividad)[:28]:28} TC {cotizacion:>8} → {fecha} {tipo:7} {marca}')

    salida = MIG / 'movimientos-excel.csv'
    with salida.open('w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(filas[0].keys()), delimiter=';')
        w.writeheader()
        w.writerows(filas)
    total = sum(float(r['Monto'].replace(',', '.')) for r in filas)
    print(f'\n{len(filas)} filas → {salida.relative_to(RAIZ)} (total $ {total:,.2f})')


if __name__ == '__main__':
    main()
