# Seguimiento de Cometidos · OVDAS

Visor cartográfico para el seguimiento de cometidos funcionarios del **Observatorio Volcanológico de los Andes del Sur (OVDAS / RNVV / SERNAGEOMIN)**.

Pensado como apoyo para el equipo de **administración** que sigue a los funcionarios mientras están en terreno —reparando estaciones, sacando muestras o haciendo reconocimiento en volcanes—, con foco en saber **dónde están**, **con qué patente**, **cuántos días** y **si hay señal celular** en cada tramo.

## Características

- Mapa interactivo (Leaflet) con base topográfica, satelital y calles.
- Pins por cometido con iniciales del jefe de comisión + estado (en terreno / planificado / completado).
- Pulse animado sobre cometidos activos.
- Ruta diaria con waypoints coloreados por nivel de señal celular (verde/ámbar/rojo).
- Capa oficial de **cobertura 4G de SUBTEL** (nov-2025) por operador (Entel · Movistar · Claro · WOM), consumida directo del servidor ArcGIS público de SUBTEL.
- Volcanes monitoreados marcados según nivel de alerta técnica.
- Filtros por estado, volcán y búsqueda libre (nombre, patente, objetivo).
- Ficha completa por cometido (modal): identificación, equipo, ruta diaria, riesgos, EPP, contacto de emergencia.

## Estructura

```
.
├── index.html            # Visor principal
├── css/style.css         # Estilos (tema oscuro corporativo)
├── js/app.js             # Lógica del mapa, filtros, modal
├── data/
│   ├── cometidos.json    # 12 fichas (1 real + 11 ficticias)
│   └── volcanes.json     # Volcanes monitoreados por OVDAS
└── README.md
```

## Datos

- **`data/cometidos.json`** contiene 12 fichas. La primera (`COM-2026-001`) es la digitalización de la ficha real recibida (Laguna del Maule, feb 2026, jefe Claudio Vidal). Las 11 restantes son **ficticias**, generadas siguiendo la misma estructura para distintos volcanes, fechas, patentes y funcionarios; sirven sólo como base de desarrollo.
- Cada ficha contiene la ruta diaria con coordenadas, actividad, indicación de pernocte y nivel de señal celular esperado.

## Cobertura celular

Se consume el servicio público de SUBTEL:

```
https://licancabur.subtel.gob.cl/server/rest/services/<operador>_4G_nov2025/MapServer
```

a través de [esri-leaflet](https://github.com/Esri/esri-leaflet). La capa por operador se activa/desactiva desde el control superior derecho del mapa.

> Fuente: [SUBTEL · Mapas de Cobertura Digital](https://www.subtel.gob.cl/mapadigital/)

## Despliegue

Repositorio estático — funciona en cualquier hosting de archivos. Recomendado: **GitHub Pages** (rama `main`, carpeta raíz).

```bash
git clone https://github.com/MendozaVolcanic/seguimiento-cometidos-ovdas.git
cd seguimiento-cometidos-ovdas
# abrir index.html en navegador o servir con cualquier server estático:
python -m http.server 8000
```

## Próximos pasos

- Carga de fichas vía formulario web (sin editar JSON a mano).
- Integración con API SPOT / inReach para mostrar posición real en tiempo real.
- Exportación a PDF de la ficha completa.
- Login para administración (control de quién ve qué).

## Contexto

Parte del ecosistema [Volcanología OVDAS](https://github.com/MendozaVolcanic) — junto con VRP-chile (térmico MODIS/VIIRS) y openVIS-Colaboracion-1 (infrasonido).

---
**SERNAGEOMIN · OVDAS · Temuco** · 2026
