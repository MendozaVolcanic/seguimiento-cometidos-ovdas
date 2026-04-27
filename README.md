# 🌋 Seguimiento de Cometidos · OVDAS

> Visor cartográfico para que el equipo de **administración** del Observatorio Volcanológico de los Andes del Sur (OVDAS / RNVV / SERNAGEOMIN) pueda hacer seguimiento en tiempo real de los funcionarios cuando están en terreno reparando estaciones, sacando muestras geoquímicas o haciendo reconocimiento en volcanes.

🔗 **[Ver visor en vivo →](https://mendozavolcanic.github.io/seguimiento-cometidos-ovdas/)**

---

## ¿Por qué existe esto?

Los funcionarios del OVDAS pueden pasar **varios días en terreno** en zonas remotas y peligrosas de la cordillera —cráteres activos, pasos fronterizos, lagos de altura, sectores sin señal celular—. La planificación se hace mediante una **Ficha de Cometidos Funcionarios** en formato Excel/PDF que vive en carpetas administrativas y es difícil de consultar de un vistazo.

Este visor consolida esa información en un **mapa interactivo** que responde a preguntas concretas:

- *"¿Dónde está Claudio Vidal hoy?"* → pin animado sobre el flanco N de Copahue.
- *"¿Tiene señal celular ahí?"* → capa SUBTEL de cobertura 4G real, superpuesta.
- *"¿Cuántos días lleva sin reportar?"* → alertas automáticas en la campana superior.
- *"¿Cuánto hemos gastado en viáticos en el Maule este año?"* → vista de Actividad / heatmap.

---

## 🚀 Características principales

### Vista Mapa
- 🗺️ **3 capas base**: Topográfica (OpenTopoMap), Satelital (Esri World Imagery), Calles (OSM)
- 📍 **Pins por cometido** con iniciales del jefe + estado por color (verde activo, azul planificado, gris completado, **rojo si está atrasado**) y pulse animado para activos
- 🛤️ **Ruta planificada** diaria con waypoints coloreados por nivel de señal celular
- 🛰️ **Tracks SPOT** (GPS satelital) en tiempo real para cometidos activos: línea + breadcrumbs históricos + última posición pulsante
- 📡 **Cobertura 4G oficial SUBTEL** (Entel · Movistar · Claro · WOM) consumida del servidor ArcGIS público de SUBTEL
- 🌋 **12 volcanes monitoreados** con ícono coloreado según nivel de alerta técnica
- 🛂 **Pasos fronterizos** principales (Pino Hachado, Mamuil Malal, Cardenal Samoré, Pehuenche, Pichachén, Icalma, Hua Hum)
- 🏠 **Refugios CONAF** principales del SNASPE volcánico

### Vista Timeline (Gantt)
Barras horizontales por cometido sobre eje 12 meses, línea roja indicando "HOY", colores por estado. Útil para detectar solapamientos y planificar viáticos.

### Vista Actividad
- **Heatmap** volcán × mes 2026 con intensidad por número de cometidos
- **KPIs** del año: cometidos totales, en terreno hoy, días-funcionario acumulados, viáticos totales

### Vista Funcionarios
Card por persona con avatar, días en terreno acumulados, cometidos realizados, volcanes visitados. Click → filtra el mapa por esa persona.

### Otras
- 🔔 **Alertas automáticas**: cometido atrasado · sin reporte SPOT >8 h · batería baja (<30 %)
- 📝 **Formulario** para crear nuevos cometidos (genera y descarga el JSON listo para hacer commit)
- 📄 **Exportar ficha a PDF** (A4 con header SERNAGEOMIN)
- 🌙 **Modo claro / oscuro** con persistencia en `localStorage`
- 🔍 **Búsqueda libre** por nombre, RUT, patente, objetivo
- 📱 **Responsive** — funciona en notebook y móvil

---

## 📂 Estructura del repositorio

```
.
├── index.html            # Visor principal — 4 vistas + 2 modales
├── css/style.css         # Tema oscuro/claro corporativo
├── js/app.js             # Toda la lógica (Leaflet, filtros, alertas, PDF, formulario)
├── data/
│   ├── cometidos.json    # 12 fichas (1 real + 11 ficticias para desarrollo)
│   ├── volcanes.json     # 12 volcanes OVDAS + sede Temuco
│   └── contexto.json     # Pasos fronterizos + refugios CONAF
├── README.md             # Este archivo
└── .gitignore
```

Sin build, sin backend. Todo HTML estático; los datos viven en JSON. Cualquier hosting funciona — usamos GitHub Pages.

---

## 🗃️ Schema de datos

### `cometidos.json`

```jsonc
{
  "id": "COM-2026-001",                    // identificador único
  "estado": "en_terreno",                  // planificado | en_terreno | completado
  "tipo": "Mantenimiento correctivo",      // tipo de actividad
  "objetivo": "...",
  "volcan": "Laguna del Maule",
  "volcan_coords": [-36.058, -70.495],     // [lat, lon]
  "fecha_salida": "2026-02-10",            // ISO date
  "fecha_regreso": "2026-02-13",
  "dias_100": 3,                           // días viático 100%
  "dias_40": 1,                            // días viático 40%
  "viatico_total": 285736,                 // CLP
  "patente": "JZKC70",
  "vehiculo": "Camioneta OVDAS",
  "jefe_cometido": {
    "nombre": "...", "rut": "...", "celular": "+56 9 ..."
  },
  "acompanantes": [
    { "nombre": "...", "rol": "Conductor", "rut": "...", "celular": "..." }
  ],
  "ruta": [                                // waypoints diarios
    { "dia": 1, "fecha": "2026-02-10", "lugar": "...",
      "coords": [-36.04, -70.52], "actividad": "...",
      "pernocte": true, "señal": "nula" }     // ok | parcial | nula
  ],
  "riesgos": ["Altura geográfica", "..."],
  "epp": ["Casco", "..."],
  "contacto_emergencia": { "nombre": "...", "telefono": "..." },
  "observaciones": "...",
  "tracks": [                              // opcional: posiciones SPOT
    { "ts": "2026-04-26T08:20:00", "lat": -37.871, "lon": -71.150,
      "bateria": 55, "tipo": "ok" }        // ok | check_in | sos
  ]
}
```

La primera ficha (`COM-2026-001`) es **real** — digitalización de la Ficha de Cometidos del 10–13 feb 2026 en Laguna del Maule (jefe Claudio Vidal). Las demás son **ficticias** y sirven solo de base de desarrollo.

---

## 📡 Cobertura celular oficial SUBTEL

Se consume directamente del servidor ArcGIS REST público de SUBTEL:

```
https://licancabur.subtel.gob.cl/server/rest/services/Coberturas_dic_2023/MapServer
```

Los layer IDs usados (4G consolidado por operador):

| Operador | Layer ID |
|----------|----------|
| Claro    | 33       |
| Entel    | 36       |
| Movistar | 40       |
| WOM      | 43       |

Acceso vía [`esri-leaflet`](https://github.com/Esri/esri-leaflet) con `dynamicMapLayer`. CORS está habilitado por SUBTEL para el dominio `*.github.io`.

> **Nota técnica**: la primera versión apuntaba a las capas `<Operador>_4G_nov2025`, que en realidad son **ubicaciones de antenas (puntos)**, no áreas de cobertura. Las capas correctas son los polígonos consolidados de `Coberturas_dic_2023`. Mientras SUBTEL no publique una versión 2024+ consolidada, dic-2023 es la fuente oficial vigente.

Fuente: [SUBTEL · Mapas de Cobertura Digital](https://www.subtel.gob.cl/mapadigital/)

---

## 🔧 Desarrollo local

```bash
git clone https://github.com/MendozaVolcanic/seguimiento-cometidos-ovdas.git
cd seguimiento-cometidos-ovdas

# Servir con cualquier servidor estático (necesario por CORS de fetch):
python -m http.server 8000
# o
npx serve .
```

Abrir `http://localhost:8000` en el navegador.

> Abrir `index.html` directo (`file://`) **no funciona** porque `fetch('data/...')` falla por CORS. Hay que servirlo con un HTTP server.

### Agregar un cometido nuevo

**Opción A — Formulario en la UI (recomendado para administración)**:
1. Click en **+ Nuevo cometido** en la barra superior
2. Llenar el formulario y guardar
3. Se descarga `cometidos.json` actualizado
4. Reemplazar `data/cometidos.json` en el repo y hacer commit

**Opción B — Editar JSON a mano** (para casos complejos, ej. ruta con muchos waypoints):
Editar `data/cometidos.json` siguiendo el schema arriba.

---

## 🛣️ Roadmap

### Hecho ✅
- Visor con 4 vistas (Mapa · Timeline · Actividad · Funcionarios)
- Cobertura SUBTEL 4G por operador
- Tracks SPOT (mock) + alertas automáticas
- Formulario crear ficha + exportar PDF
- Modo claro/oscuro · responsive · búsqueda por RUT
- Capas: pasos fronterizos, refugios CONAF

### Pendiente 🚧
- **🔥 Riesgo volcánico contextual**: cruzar con el repo hermano [`VRP-chile`](https://github.com/MendozaVolcanic/VRP-chile) (anomalías térmicas MODIS/VIIRS) para alertar si el volcán visitado tuvo actividad anómala reciente.
- **🔐 Login OAuth**: limitar quién ve datos personales (RUT, celular).
- **💾 Backend persistente**: Cloudflare Workers + KV, o GitHub Issues como BD, para que admin no tenga que hacer commits manuales al agregar cometidos.

### Ideas a futuro 💡
- Integración real con APIs **SPOT / Garmin inReach / Zoleo** para posición GPS en vivo.
- Notificaciones push o por correo cuando se gatilla una alerta.
- Plantilla de **PDF oficial SERNAGEOMIN** para ficha de cometido (firmas, logo).
- Sincronización con sistema de viáticos institucional.

---

## 🌐 Ecosistema OVDAS / Volcanología

Este visor forma parte del ecosistema personal [`MendozaVolcanic`](https://github.com/MendozaVolcanic) de monitoreo volcánico:

| Repo | Propósito |
|------|-----------|
| [seguimiento-cometidos-ovdas](https://github.com/MendozaVolcanic/seguimiento-cometidos-ovdas) | **Este proyecto** — seguimiento administrativo de funcionarios en terreno |
| [VRP-chile](https://github.com/MendozaVolcanic/VRP-chile) | Térmico MODIS/VIIRS — detección de radiación volcánica |
| openVIS-Colaboracion-1 | Infrasonido y metodología VIS |
| Lightning-v1 | GLM rayos asociados a columnas eruptivas |
| LiCSAR-v1 | InSAR Sentinel-1 deformación |
| VolcPlume-v1 | TROPOMI SO₂ Sentinel-5P |
| ...y otros | (ver perfil) |

---

## 📜 Stack técnico

- **[Leaflet 1.9.4](https://leafletjs.com/)** — mapa
- **[esri-leaflet 3.0.12](https://github.com/Esri/esri-leaflet)** — capas SUBTEL ArcGIS
- **[DOMPurify 3.0.9](https://github.com/cure53/DOMPurify)** — sanitización de HTML inyectado
- **[jsPDF 2.5.1](https://github.com/parallax/jsPDF) + [html2canvas 1.4.1](https://html2canvas.hertzen.com/)** — exportar fichas a PDF
- **HTML + CSS vanilla** — sin frameworks, sin build
- **Fonts: [Inter](https://fonts.google.com/specimen/Inter)** vía Google Fonts

---

## 🙏 Créditos

- **Datos de cobertura**: [SUBTEL · Subsecretaría de Telecomunicaciones de Chile](https://www.subtel.gob.cl/)
- **Cartografía base**: [OpenStreetMap](https://www.openstreetmap.org/), [Esri World Imagery](https://www.esri.com/), [OpenTopoMap](https://opentopomap.org/)
- **Ficha real digitalizada**: cometido OVDAS Laguna del Maule, feb 2026 (Claudio Vidal et al.)
- **Idea y dirección**: Nicolás Mendoza Vivallo · geólogo SERNAGEOMIN

---

**SERNAGEOMIN · OVDAS · Temuco** · 2026 · MIT License
