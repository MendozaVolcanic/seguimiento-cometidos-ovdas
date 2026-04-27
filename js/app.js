/* Seguimiento de Cometidos OVDAS — visor principal */

// Servicio oficial SUBTEL — coberturas reales (polígonos), no antenas (puntos).
// Layer IDs consolidados 4G por operador en el grupo "Coberturas_dic_2023".
const SUBTEL_COBERTURA_URL = 'https://licancabur.subtel.gob.cl/server/rest/services/Coberturas_dic_2023/MapServer';
const COBERTURA_LAYERS = {
  entel:    { id: 36, color: '#2563eb', rgb: [37, 99, 235],  label: 'Entel' },
  movistar: { id: 40, color: '#0d9488', rgb: [13, 148, 136], label: 'Movistar' },
  claro:    { id: 33, color: '#dc2626', rgb: [220, 38, 38],  label: 'Claro' },
  wom:      { id: 43, color: '#c026d3', rgb: [192, 38, 211], label: 'WOM' }
};

/* Custom Leaflet Layer — consume el endpoint /export de ArcGIS REST directamente
   con dynamicLayers para sobrescribir el renderer del server y forzar nuestro color
   de marca (consistente con la leyenda en el panel de control). */
const ArcGISExportLayer = L.Layer.extend({
  initialize: function (url, layerId, options) {
    this._url = url;
    this._layerId = layerId;
    L.setOptions(this, Object.assign({ opacity: 0.6, color: [0, 112, 255], className: '' }, options || {}));
  },
  onAdd: function (map) {
    this._map = map;
    map.on('moveend zoomend resize', this._update, this);
    this._update();
  },
  onRemove: function (map) {
    if (this._image) map.removeLayer(this._image);
    this._image = null;
    map.off('moveend zoomend resize', this._update, this);
  },
  setOpacity: function (op) {
    this.options.opacity = op;
    if (this._image) this._image.setOpacity(op);
  },
  _update: function () {
    const map = this._map;
    if (!map) return;
    const bounds = map.getBounds();
    const size = map.getSize();
    const [r, g, b] = this.options.color;

    // dynamicLayers: redefine la simbología en el server para imponer nuestro color
    const dynamicLayers = [{
      id: 1000 + this._layerId,
      source: { type: 'mapLayer', mapLayerId: this._layerId },
      drawingInfo: {
        renderer: {
          type: 'simple',
          symbol: {
            type: 'esriSFS', style: 'esriSFSSolid',
            color: [r, g, b, 200],
            outline: { type: 'esriSLS', style: 'esriSLSSolid', color: [r, g, b, 255], width: 0.4 }
          }
        }
      }
    }];

    const params = new URLSearchParams({
      bbox: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
      bboxSR: '4326',
      imageSR: '3857',
      size: `${size.x},${size.y}`,
      format: 'png32',
      transparent: 'true',
      dynamicLayers: JSON.stringify(dynamicLayers),
      f: 'image'
    });
    const url = `${this._url}/export?${params.toString()}`;
    const nuevo = L.imageOverlay(url, bounds, {
      opacity: this.options.opacity,
      interactive: false,
      pane: 'overlayPane',
      className: this.options.className
    }).addTo(map);
    const anterior = this._image;
    this._image = nuevo;
    nuevo.on('load', () => { if (anterior) map.removeLayer(anterior); });
    nuevo.on('error', () => { if (this._image === nuevo) map.removeLayer(nuevo); });
  }
});

// Hoy fijado al contexto del proyecto. Cambiar cuando avance la simulación.
const HOY = new Date('2026-04-26T12:00:00');
const UMBRAL_SIN_REPORTE_HORAS = 8;

let cometidos = [];
let volcanes = [];
let ovdasInfo = null;
let contexto = { pasos_fronterizos: [], refugios_conaf: [] };
let map;
let layers = {
  volcanes: L.layerGroup(),
  cometidos: L.layerGroup(),
  rutas: L.layerGroup(),
  tracks: L.layerGroup(),
  pasos: L.layerGroup(),
  refugios: L.layerGroup(),
  cobertura: {}
};
let cometidoSeleccionado = null;
let filtros = { estado: 'todos', volcan: 'todos', busqueda: '', funcionario: null };

/* ========== HELPERS ========== */
const sanitize = (html) => DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
const setHTML  = (el, html) => { el.innerHTML = sanitize(html); };

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function labelEstado(e) {
  return { en_terreno: 'En terreno', planificado: 'Planificado', completado: 'Completado' }[e] || e;
}
function formatFecha(s) {
  const [y, m, d] = s.split('-');
  return `${d}-${m}-${y}`;
}
function formatFechaCorta(s) {
  const [, m, d] = s.split('-');
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${d}${meses[parseInt(m)-1]}`;
}
function fechaToDate(s) {
  return new Date(s + 'T00:00:00');
}
function diasEntre(fechaA, fechaB) {
  return Math.round((fechaToDate(fechaB) - fechaToDate(fechaA)) / 86400000) + 1;
}
function inicialesDe(nombre) {
  return nombre.split(' ').filter(Boolean).map(n => n[0]).slice(0,2).join('').toUpperCase();
}

/* ========== ALERTAS ========== */
function calcularAlertas() {
  const alertas = [];
  cometidos.forEach(c => {
    if (c.estado !== 'en_terreno') return;
    // Atraso: fecha de regreso pasada y aún en terreno
    if (fechaToDate(c.fecha_regreso) < HOY && HOY.toISOString().slice(0,10) > c.fecha_regreso) {
      alertas.push({
        id: c.id,
        nivel: 'danger',
        titulo: `${c.jefe_cometido.nombre} — ATRASADO`,
        detalle: `Regreso programado el ${formatFecha(c.fecha_regreso)}. Sigue marcado en terreno.`
      });
    }
    // Sin reporte SPOT reciente
    if (c.tracks && c.tracks.length > 0) {
      const ultimo = c.tracks[c.tracks.length - 1];
      const horas = (HOY - new Date(ultimo.ts)) / 3600000;
      if (horas > UMBRAL_SIN_REPORTE_HORAS) {
        alertas.push({
          id: c.id,
          nivel: 'warn',
          titulo: `${c.jefe_cometido.nombre} — sin reporte SPOT`,
          detalle: `Último reporte hace ${Math.round(horas)} h (${ultimo.ts.replace('T',' ').slice(0,16)}).`
        });
      }
      if (ultimo.bateria !== undefined && ultimo.bateria < 30) {
        alertas.push({
          id: c.id,
          nivel: 'warn',
          titulo: `${c.jefe_cometido.nombre} — batería baja`,
          detalle: `Batería SPOT al ${ultimo.bateria}%.`
        });
      }
    }
  });
  return alertas;
}

function esAtrasado(c) {
  return c.estado === 'en_terreno' && fechaToDate(c.fecha_regreso) < HOY
      && HOY.toISOString().slice(0,10) > c.fecha_regreso;
}

/* ========== INIT ========== */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [resCom, resVol, resCtx] = await Promise.all([
      fetch('data/cometidos.json').then(r => r.json()),
      fetch('data/volcanes.json').then(r => r.json()),
      fetch('data/contexto.json').then(r => r.json())
    ]);
    cometidos = resCom.cometidos;
    volcanes = resVol.volcanes;
    ovdasInfo = resVol.ovdas;
    contexto = resCtx;

    initTema();
    initMap();
    poblarVolcanesEnMapa();
    poblarFiltroVolcan();
    poblarFormularioVolcanes();
    poblarPasosYRefugios();
    poblarCometidosEnMapa();
    renderLista();
    renderAlertas();
    bindUI();
  } catch (err) {
    console.error('Error cargando datos:', err);
    document.getElementById('lista-cometidos').textContent = 'Error cargando datos. Revisa la consola.';
  }
});

/* ========== TEMA ========== */
function initTema() {
  const guardado = localStorage.getItem('ovdas-tema') || 'dark';
  document.documentElement.setAttribute('data-theme', guardado);
  document.getElementById('btn-tema').textContent = guardado === 'dark' ? '🌙' : '☀';
}
function toggleTema() {
  const actual = document.documentElement.getAttribute('data-theme');
  const nuevo  = actual === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nuevo);
  localStorage.setItem('ovdas-tema', nuevo);
  document.getElementById('btn-tema').textContent = nuevo === 'dark' ? '🌙' : '☀';
}

/* ========== MAP ========== */
function initMap() {
  map = L.map('map', { center: [-39.0, -71.8], zoom: 6 });
  const osm  = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM', maxZoom: 19 });
  const sat  = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri', maxZoom: 19 });
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '© OpenTopoMap', maxZoom: 17 });
  topo.addTo(map);
  L.control.layers({ 'Topográfico': topo, 'Satelital (Esri)': sat, 'Calles (OSM)': osm }, null, { position: 'bottomright' }).addTo(map);

  layers.volcanes.addTo(map);
  layers.cometidos.addTo(map);
  layers.rutas.addTo(map);
  layers.tracks.addTo(map);

  const ovdasIcon = L.divIcon({
    className: 'volcan-marker',
    html: `<div class="volcan-icon"><svg width="28" height="28" viewBox="0 0 32 32"><rect x="6" y="10" width="20" height="18" fill="#1e293b" stroke="#3b82f6" stroke-width="2" rx="2"/><rect x="10" y="14" width="3" height="3" fill="#3b82f6"/><rect x="15" y="14" width="3" height="3" fill="#3b82f6"/><rect x="20" y="14" width="3" height="3" fill="#3b82f6"/><rect x="14" y="20" width="4" height="8" fill="#3b82f6"/></svg></div>`,
    iconSize: [28, 28], iconAnchor: [14, 14]
  });
  L.marker([ovdasInfo.lat, ovdasInfo.lon], { icon: ovdasIcon })
    .bindPopup(sanitize(`<strong>${escapeHtml(ovdasInfo.nombre)}</strong><br><span style="font-size:0.78rem;color:#94a3b8">Sede OVDAS</span>`))
    .addTo(map);
}

/* ========== VOLCANES ========== */
function poblarVolcanesEnMapa() {
  volcanes.forEach(v => {
    const color = v.alerta === 'Roja' ? '#dc2626'
                : v.alerta === 'Naranja' ? '#ea580c'
                : v.alerta === 'Amarilla' ? '#f59e0b' : '#10b981';
    const icon = L.divIcon({
      className: 'volcan-marker',
      html: `<div class="volcan-icon"><svg width="26" height="26" viewBox="0 0 32 32"><path d="M16 4 L29 27 H3 Z" fill="${color}" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round" opacity="0.9"/><path d="M16 4 L19 13 L16 17 L13 13 Z" fill="#fef3c7" opacity="0.7"/></svg></div>`,
      iconSize: [26, 26], iconAnchor: [13, 22]
    });
    L.marker([v.lat, v.lon], { icon })
      .bindPopup(sanitize(`<strong>${escapeHtml(v.nombre)}</strong><br><span style="font-size:0.75rem;color:#94a3b8">${escapeHtml(v.region)}</span><br><span style="font-size:0.75rem">Alerta: <strong style="color:${color}">${escapeHtml(v.alerta)}</strong></span>`))
      .addTo(layers.volcanes);
  });
}

function poblarFiltroVolcan() {
  const sel = document.getElementById('filtro-volcan');
  [...new Set(cometidos.map(c => c.volcan))].sort().forEach(v => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    sel.appendChild(opt);
  });
}
function poblarFormularioVolcanes() {
  const sel = document.querySelector('#form-cometido [name="volcan"]');
  if (!sel) return;
  volcanes.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.nombre; opt.textContent = v.nombre;
    sel.appendChild(opt);
  });
}

function poblarPasosYRefugios() {
  contexto.pasos_fronterizos.forEach(p => {
    const icon = L.divIcon({
      className: 'paso-marker',
      html: `<div class="paso-icon">🛂</div>`,
      iconSize: [22, 22], iconAnchor: [11, 11]
    });
    L.marker([p.lat, p.lon], { icon })
      .bindPopup(sanitize(`<strong>${escapeHtml(p.nombre)}</strong><br><span style="font-size:0.75rem">Horario: ${escapeHtml(p.horario)}</span><br><span style="font-size:0.75rem;color:#94a3b8">Altura: ${p.altura} m</span>`))
      .addTo(layers.pasos);
  });
  contexto.refugios_conaf.forEach(r => {
    const icon = L.divIcon({
      className: 'refugio-marker',
      html: `<div class="refugio-icon">🏠</div>`,
      iconSize: [22, 22], iconAnchor: [11, 11]
    });
    L.marker([r.lat, r.lon], { icon })
      .bindPopup(sanitize(`<strong>${escapeHtml(r.nombre)}</strong><br><span style="font-size:0.75rem;color:#94a3b8">Refugio CONAF</span>`))
      .addTo(layers.refugios);
  });
}

/* ========== COMETIDOS / PINS ========== */
function poblarCometidosEnMapa() {
  layers.cometidos.clearLayers();
  layers.rutas.clearLayers();
  layers.tracks.clearLayers();

  const filtrados = filtrarCometidos();
  const porVolcan = {};
  filtrados.forEach(c => { (porVolcan[c.volcan] = porVolcan[c.volcan] || []).push(c); });

  Object.values(porVolcan).forEach(grupo => {
    grupo.forEach((c, idx) => {
      const offset = grupo.length > 1 ? offsetCoords(c.volcan_coords, idx, grupo.length) : c.volcan_coords;
      const inicial = inicialesDe(c.jefe_cometido.nombre);
      const claseEstado = esAtrasado(c) ? 'atrasado' : c.estado;

      const icon = L.divIcon({
        className: 'cometido-marker',
        html: `<div class="cometido-pin ${escapeHtml(claseEstado)}"><span>${escapeHtml(inicial)}</span></div>`,
        iconSize: [38, 38], iconAnchor: [19, 38], popupAnchor: [0, -36]
      });

      const marker = L.marker(offset, { icon }).bindPopup(sanitize(buildPopup(c)));
      marker.on('click', () => { cometidoSeleccionado = c.id; renderLista(); });
      layers.cometidos.addLayer(marker);

      if (offset !== c.volcan_coords) {
        L.polyline([offset, c.volcan_coords], { color: '#64748b', weight: 1, dashArray: '2,3', opacity: 0.6 }).addTo(layers.cometidos);
      }
    });
  });

  filtrados.filter(c => c.estado === 'en_terreno').forEach(c => {
    dibujarRuta(c);
    if (c.tracks) dibujarTracks(c);
  });
}

function offsetCoords([lat, lon], idx, total) {
  if (total === 1) return [lat, lon];
  const angle = (2 * Math.PI * idx) / total;
  const r = 0.06;
  return [lat + r * Math.cos(angle), lon + r * Math.sin(angle) / Math.cos(lat * Math.PI / 180)];
}

function dibujarRuta(c) {
  const puntos = c.ruta.map(p => p.coords);
  if (puntos.length < 2) return;
  L.polyline(puntos, { color: '#10b981', weight: 3, opacity: 0.7, dashArray: '6,6' }).addTo(layers.rutas);
  c.ruta.forEach(wp => {
    const señal = wp['señal'] || 'nula';
    const icon = L.divIcon({
      className: 'waypoint-icon',
      html: `<div class="waypoint-dot señal-${escapeHtml(señal)}">${escapeHtml(String(wp.dia))}</div>`,
      iconSize: [18, 18], iconAnchor: [9, 9]
    });
    L.marker(wp.coords, { icon })
      .bindPopup(sanitize(`<strong>Día ${escapeHtml(String(wp.dia))} — ${escapeHtml(wp.fecha)}</strong><br><span style="color:#fbbf24">${escapeHtml(wp.lugar)}</span><br><span style="font-size:0.78rem">${escapeHtml(wp.actividad)}</span><br><span style="font-size:0.7rem;color:#94a3b8">Señal: <strong>${escapeHtml(señal)}</strong>${wp.pernocte ? ' · 🏕' : ''}</span>`))
      .addTo(layers.rutas);
  });
}

function dibujarTracks(c) {
  if (!c.tracks || c.tracks.length === 0) return;
  const puntos = c.tracks.map(t => [t.lat, t.lon]);
  L.polyline(puntos, { color: '#3b82f6', weight: 2.5, opacity: 0.85 }).addTo(layers.tracks);
  c.tracks.forEach((t, idx) => {
    const esUltimo = idx === c.tracks.length - 1;
    const icon = L.divIcon({
      className: 'spot-marker',
      html: `<div class="spot-dot ${esUltimo ? 'last' : ''} ${t.tipo === 'sos' ? 'sos' : ''}"></div>`,
      iconSize: esUltimo ? [22, 22] : [14, 14],
      iconAnchor: esUltimo ? [11, 11] : [7, 7]
    });
    L.marker([t.lat, t.lon], { icon })
      .bindPopup(sanitize(`<strong>${escapeHtml(c.jefe_cometido.nombre)}</strong>${esUltimo ? ' <span style="color:#10b981">— última posición</span>' : ''}<br><span style="font-family:ui-monospace,monospace;font-size:0.75rem">${escapeHtml(t.ts.replace('T',' ').slice(0,16))}</span><br><span style="font-size:0.7rem;color:#94a3b8">Batería: ${t.bateria ?? '—'}% · ${escapeHtml(t.tipo)}</span>`))
      .addTo(layers.tracks);
  });
}

function buildPopup(c) {
  const flag = esAtrasado(c) ? `<span class="alerta-flag" style="position:static;margin-left:0.4rem">ATRASADO</span>` : '';
  return `
    <div class="popup-cometido">
      <h3>${escapeHtml(c.jefe_cometido.nombre)} ${flag}</h3>
      <div class="popup-volcan">${escapeHtml(c.volcan)} · ${escapeHtml(c.tipo)}</div>
      <div class="popup-row"><strong>Estado</strong> <span class="estado-badge ${escapeHtml(c.estado)}">${escapeHtml(labelEstado(c.estado))}</span></div>
      <div class="popup-row"><strong>Patente</strong> ${escapeHtml(c.patente)}</div>
      <div class="popup-row"><strong>Fechas</strong> ${escapeHtml(formatFecha(c.fecha_salida))} → ${escapeHtml(formatFecha(c.fecha_regreso))}</div>
      <div class="popup-row"><strong>Equipo</strong> ${1 + c.acompanantes.length} persona${c.acompanantes.length === 0 ? '' : 's'}</div>
      <div class="popup-actions">
        <button data-detalle-id="${escapeHtml(c.id)}">Ver ficha completa</button>
      </div>
    </div>`;
}

/* ========== LISTA ========== */
function filtrarCometidos() {
  const q = filtros.busqueda.toLowerCase().trim();
  return cometidos.filter(c => {
    if (filtros.estado !== 'todos' && c.estado !== filtros.estado) return false;
    if (filtros.volcan !== 'todos' && c.volcan !== filtros.volcan) return false;
    if (filtros.funcionario) {
      const nombres = [c.jefe_cometido.nombre, ...c.acompanantes.map(a => a.nombre)];
      if (!nombres.includes(filtros.funcionario)) return false;
    }
    if (q) {
      const hay = [
        c.objetivo, c.jefe_cometido.nombre, c.jefe_cometido.rut, c.patente, c.volcan, c.tipo,
        ...(c.acompanantes || []).map(a => `${a.nombre} ${a.rut}`)
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderLista() {
  const filtrados = filtrarCometidos();
  const peso = { en_terreno: 0, planificado: 1, completado: 2 };
  filtrados.sort((a, b) => {
    if (peso[a.estado] !== peso[b.estado]) return peso[a.estado] - peso[b.estado];
    return a.fecha_salida.localeCompare(b.fecha_salida) * (a.estado === 'completado' ? -1 : 1);
  });

  const cont = document.getElementById('lista-cometidos');
  if (filtrados.length === 0) {
    setHTML(cont, '<div style="padding:1rem;color:#94a3b8;font-size:0.85rem">Sin cometidos para los filtros aplicados.</div>');
  } else {
    setHTML(cont, filtrados.map(c => {
      const atrasado = esAtrasado(c);
      const flag = atrasado ? `<span class="alerta-flag">Atrasado</span>` : '';
      return `
        <div class="cometido-card estado-${escapeHtml(c.estado)} ${atrasado ? 'atrasado' : ''} ${c.id === cometidoSeleccionado ? 'active' : ''}" data-id="${escapeHtml(c.id)}">
          ${flag}
          <div class="card-head">
            <div>
              <div class="card-volcan">${escapeHtml(c.volcan)}</div>
              <div class="card-id">${escapeHtml(c.id)}</div>
            </div>
            <span class="estado-badge ${escapeHtml(c.estado)}">${escapeHtml(labelEstado(c.estado))}</span>
          </div>
          <div class="card-objetivo">${escapeHtml(c.objetivo)}</div>
          <div class="card-meta">
            <span class="card-meta-item clickable" data-funcionario="${escapeHtml(c.jefe_cometido.nombre)}">👤 ${escapeHtml(c.jefe_cometido.nombre)}</span>
            <span class="card-meta-item">🚙 ${escapeHtml(c.patente)}</span>
            <span class="card-meta-item">📅 ${escapeHtml(formatFechaCorta(c.fecha_salida))}–${escapeHtml(formatFechaCorta(c.fecha_regreso))}</span>
          </div>
        </div>`;
    }).join(''));
  }

  document.getElementById('contador-cometidos').textContent = `${filtrados.length} cometido${filtrados.length === 1 ? '' : 's'}`;

  cont.querySelectorAll('.cometido-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('[data-funcionario]')) return; // delegado abajo
      const id = card.dataset.id;
      const c = cometidos.find(x => x.id === id);
      cometidoSeleccionado = id;
      renderLista();
      poblarCometidosEnMapa();
      dibujarRuta(c);
      if (c.tracks) dibujarTracks(c);
      const todosPuntos = [c.volcan_coords, ...c.ruta.map(r => r.coords), ...((c.tracks || []).map(t => [t.lat, t.lon]))];
      map.fitBounds(L.latLngBounds(todosPuntos), { padding: [60, 60], maxZoom: 11 });
    });
    card.addEventListener('dblclick', () => abrirDetalle(card.dataset.id));
  });

  cont.querySelectorAll('[data-funcionario]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      filtros.funcionario = el.dataset.funcionario;
      mostrarChipFuncionario();
      renderLista();
      poblarCometidosEnMapa();
    });
  });
}

function mostrarChipFuncionario() {
  const wrap = document.getElementById('filtro-funcionario-pill');
  const tag = document.getElementById('filtro-funcionario-tag');
  if (filtros.funcionario) {
    wrap.style.display = '';
    tag.textContent = `👤 ${filtros.funcionario}`;
  } else {
    wrap.style.display = 'none';
  }
}

/* ========== ALERTAS ========== */
function renderAlertas() {
  const alertas = calcularAlertas();
  const count = document.getElementById('alertas-count');
  count.textContent = alertas.length;
  count.classList.toggle('zero', alertas.length === 0);

  const lista = document.getElementById('alertas-lista');
  if (alertas.length === 0) {
    setHTML(lista, '<div style="padding:1rem;color:#94a3b8;font-size:0.85rem">Sin alertas activas. ✓</div>');
  } else {
    setHTML(lista, alertas.map(a => `
      <div class="alerta-item ${a.nivel === 'warn' ? 'warn' : ''}" data-cometido-id="${escapeHtml(a.id)}">
        <div class="alerta-item-titulo">${escapeHtml(a.titulo)}</div>
        <div class="alerta-item-detalle">${escapeHtml(a.detalle)}</div>
      </div>
    `).join(''));

    lista.querySelectorAll('[data-cometido-id]').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('alertas-panel').classList.add('hidden');
        abrirDetalle(el.dataset.cometidoId);
      });
    });
  }
}

/* ========== TIMELINE ========== */
function renderTimeline() {
  const cont = document.getElementById('timeline');
  const año = 2026;
  const mesesLabels = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  // ms en el año
  const inicioAño = new Date(año, 0, 1).getTime();
  const finAño    = new Date(año, 11, 31, 23, 59, 59).getTime();
  const totalMs   = finAño - inicioAño;

  const ordenados = [...cometidos].sort((a, b) => a.fecha_salida.localeCompare(b.fecha_salida));

  const filas = ordenados.map(c => {
    const inicio = fechaToDate(c.fecha_salida).getTime();
    const fin    = fechaToDate(c.fecha_regreso).getTime();
    const left   = ((inicio - inicioAño) / totalMs) * 100;
    const width  = Math.max(1.2, ((fin - inicio) / totalMs) * 100);
    const cls    = esAtrasado(c) ? 'atrasado' : c.estado;
    return `
      <div class="timeline-row">
        <div class="timeline-label">
          <span class="estado-badge ${escapeHtml(c.estado)}">${escapeHtml(c.id.slice(-3))}</span>
          ${escapeHtml(c.volcan)}
        </div>
        <div class="timeline-bar-wrap">
          <div class="timeline-bar ${escapeHtml(cls)}" data-detalle-id="${escapeHtml(c.id)}" style="left:${left}%;width:${width}%" title="${escapeHtml(c.objetivo)}">
            ${escapeHtml(c.jefe_cometido.nombre.split(' ')[0])} · ${escapeHtml(c.patente)}
          </div>
        </div>
      </div>`;
  }).join('');

  const hoyLeft = Math.max(0, Math.min(100, ((HOY.getTime() - inicioAño) / totalMs) * 100));

  setHTML(cont, `
    <div class="timeline-axis">
      <div></div>
      <div class="timeline-axis-months" style="position:relative">
        ${mesesLabels.map(m => `<div>${m}</div>`).join('')}
      </div>
    </div>
    <div class="timeline-rows" style="position:relative">
      ${filas}
      <div class="timeline-today-overlay" style="position:absolute;top:0;bottom:0;left:calc(200px + 0.5rem);right:0;pointer-events:none">
        <div style="position:absolute;top:0;bottom:0;left:${hoyLeft}%;width:2px;background:var(--accent)">
          <span style="position:absolute;top:-16px;left:-14px;font-size:0.6rem;background:var(--accent);color:white;padding:0 4px;border-radius:3px;font-weight:700">HOY</span>
        </div>
      </div>
    </div>
  `);
}

/* ========== HEATMAP ========== */
function renderHeatmap() {
  const cont = document.getElementById('heatmap');
  const año = 2026;
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const volcanesUnicos = [...new Set(cometidos.map(c => c.volcan))].sort();

  const matriz = {};
  volcanesUnicos.forEach(v => { matriz[v] = Array(12).fill(0); });
  cometidos.forEach(c => {
    const m = parseInt(c.fecha_salida.split('-')[1], 10) - 1;
    if (matriz[c.volcan]) matriz[c.volcan][m]++;
  });

  const max = Math.max(1, ...Object.values(matriz).flat());

  const cells = ['<div></div>', ...meses.map(m => `<div class="heatmap-month-label">${m}</div>`)];

  volcanesUnicos.forEach(v => {
    cells.push(`<div class="heatmap-label">${escapeHtml(v)}</div>`);
    matriz[v].forEach((n, mi) => {
      if (n === 0) {
        cells.push(`<div class="heatmap-cell zero">·</div>`);
      } else {
        const intensidad = n / max;
        const r = 220, g = Math.round(80 - intensidad * 50), b = Math.round(80 - intensidad * 60);
        const bg = `rgba(${r},${g},${b},${0.35 + intensidad * 0.65})`;
        cells.push(`<div class="heatmap-cell" style="background:${bg}" title="${escapeHtml(v)} · ${meses[mi]}: ${n} cometido${n>1?'s':''}">${n}</div>`);
      }
    });
  });
  setHTML(cont, cells.join(''));

  // Stats
  const totalCom    = cometidos.length;
  const enTerreno   = cometidos.filter(c => c.estado === 'en_terreno').length;
  const totalDias   = cometidos.reduce((acc, c) => acc + diasEntre(c.fecha_salida, c.fecha_regreso), 0);
  const totalViatico= cometidos.reduce((acc, c) => acc + (c.viatico_total || 0), 0);

  setHTML(document.getElementById('heatmap-stats'), `
    <div class="stat-card"><div class="label">Cometidos ${año}</div><div class="value">${totalCom}</div><div class="sub">Total registrado</div></div>
    <div class="stat-card"><div class="label">En terreno hoy</div><div class="value" style="color:var(--ok)">${enTerreno}</div><div class="sub">Funcionarios activos</div></div>
    <div class="stat-card"><div class="label">Días-funcionario</div><div class="value">${totalDias}</div><div class="sub">Sumados todos los cometidos</div></div>
    <div class="stat-card"><div class="label">Viáticos totales</div><div class="value">$${totalViatico.toLocaleString('es-CL')}</div><div class="sub">CLP</div></div>
  `);
}

/* ========== FUNCIONARIOS ========== */
function renderFuncionarios() {
  const personas = {};

  cometidos.forEach(c => {
    const todos = [
      { nombre: c.jefe_cometido.nombre, rut: c.jefe_cometido.rut, celular: c.jefe_cometido.celular, rol: 'Jefe' },
      ...c.acompanantes.map(a => ({ nombre: a.nombre, rut: a.rut, celular: a.celular, rol: a.rol }))
    ];
    todos.forEach(p => {
      if (!personas[p.nombre]) {
        personas[p.nombre] = {
          nombre: p.nombre, rut: p.rut, celular: p.celular, rol: p.rol,
          cometidos: [], dias: 0, viatico: 0, volcanes: new Set()
        };
      }
      const reg = personas[p.nombre];
      reg.cometidos.push(c);
      reg.dias += diasEntre(c.fecha_salida, c.fecha_regreso);
      // Viático: sólo el jefe acumula (los acompañantes no tienen viático separado en este modelo)
      if (p.rol === 'Jefe') reg.viatico += (c.viatico_total || 0);
      reg.volcanes.add(c.volcan);
    });
  });

  const lista = Object.values(personas).sort((a, b) => b.dias - a.dias);

  setHTML(document.getElementById('funcionarios-grid'), lista.map(p => `
    <div class="funcionario-card" data-funcionario="${escapeHtml(p.nombre)}">
      <div class="funcionario-head">
        <div class="funcionario-avatar">${escapeHtml(inicialesDe(p.nombre))}</div>
        <div>
          <div class="funcionario-nombre">${escapeHtml(p.nombre)}</div>
          <div class="funcionario-rut">${escapeHtml(p.rut || '—')} · ${escapeHtml(p.rol || '')}</div>
        </div>
      </div>
      <div class="funcionario-stats">
        <div class="funcionario-stat"><div class="v">${p.cometidos.length}</div><div class="l">Cometidos</div></div>
        <div class="funcionario-stat"><div class="v">${p.dias}</div><div class="l">Días terreno</div></div>
        <div class="funcionario-stat"><div class="v">${p.volcanes.size}</div><div class="l">Volcanes</div></div>
      </div>
      <div class="funcionario-volcanes">
        ${[...p.volcanes].slice(0, 6).map(v => `<span class="volcan-chip">${escapeHtml(v)}</span>`).join('')}
        ${p.volcanes.size > 6 ? `<span class="volcan-chip">+${p.volcanes.size - 6}</span>` : ''}
      </div>
    </div>
  `).join(''));

  document.querySelectorAll('.funcionario-card').forEach(card => {
    card.addEventListener('click', () => {
      filtros.funcionario = card.dataset.funcionario;
      mostrarChipFuncionario();
      cambiarVista('mapa');
      renderLista();
      poblarCometidosEnMapa();
    });
  });
}

/* ========== VISTAS / TABS ========== */
function cambiarVista(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
  if (name === 'timeline') renderTimeline();
  else if (name === 'heatmap') renderHeatmap();
  else if (name === 'funcionarios') renderFuncionarios();
  else if (name === 'mapa') setTimeout(() => map.invalidateSize(), 100);
}

/* ========== UI BINDINGS ========== */
function bindUI() {
  // Tabs
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => cambiarVista(t.dataset.view));
  });

  // Tema
  document.getElementById('btn-tema').addEventListener('click', toggleTema);

  // Filtros
  document.querySelectorAll('#filtro-estado .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#filtro-estado .chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filtros.estado = btn.dataset.estado;
      poblarCometidosEnMapa();
      renderLista();
    });
  });
  document.getElementById('filtro-volcan').addEventListener('change', e => {
    filtros.volcan = e.target.value;
    poblarCometidosEnMapa();
    renderLista();
  });
  document.getElementById('filtro-busqueda').addEventListener('input', e => {
    filtros.busqueda = e.target.value;
    renderLista();
  });
  document.getElementById('filtro-funcionario-clear').addEventListener('click', () => {
    filtros.funcionario = null;
    mostrarChipFuncionario();
    renderLista();
    poblarCometidosEnMapa();
  });

  // Toggles capas
  document.getElementById('toggle-volcanes').addEventListener('change', e => toggleLayer(layers.volcanes, e.target.checked));
  document.getElementById('toggle-rutas').addEventListener('change', e => toggleLayer(layers.rutas, e.target.checked));
  document.getElementById('toggle-tracks').addEventListener('change', e => toggleLayer(layers.tracks, e.target.checked));
  document.getElementById('toggle-pasos').addEventListener('change', e => toggleLayer(layers.pasos, e.target.checked));
  document.getElementById('toggle-refugios').addEventListener('change', e => toggleLayer(layers.refugios, e.target.checked));

  document.querySelectorAll('[data-operador]').forEach(cb => {
    cb.addEventListener('change', e => {
      const op = e.target.dataset.operador;
      if (e.target.checked) {
        if (!layers.cobertura[op]) {
          layers.cobertura[op] = new ArcGISExportLayer(
            SUBTEL_COBERTURA_URL,
            COBERTURA_LAYERS[op].id,
            { opacity: 0.6, color: COBERTURA_LAYERS[op].rgb, className: 'cobertura-overlay' }
          );
        }
        layers.cobertura[op].addTo(map);
      } else if (layers.cobertura[op]) {
        map.removeLayer(layers.cobertura[op]);
      }
      actualizarLeyendaCoberturas();
    });
  });

  // Delegación: botón "Ver ficha" en popups + click en alerta items
  document.body.addEventListener('click', e => {
    const btn = e.target.closest('[data-detalle-id]');
    if (btn) abrirDetalle(btn.dataset.detalleId);
  });

  // Modal detalle
  document.getElementById('modal-close').addEventListener('click', cerrarDetalle);
  document.getElementById('detalle-modal').addEventListener('click', e => {
    if (e.target.id === 'detalle-modal') cerrarDetalle();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      cerrarDetalle();
      document.getElementById('form-modal').classList.add('hidden');
      document.getElementById('alertas-panel').classList.add('hidden');
    }
  });

  // PDF
  document.getElementById('btn-pdf').addEventListener('click', exportarPDF);

  // Alertas
  document.getElementById('alertas-bell').addEventListener('click', () => {
    document.getElementById('alertas-panel').classList.toggle('hidden');
  });
  document.getElementById('alertas-close').addEventListener('click', () => {
    document.getElementById('alertas-panel').classList.add('hidden');
  });

  // Form
  document.getElementById('btn-nuevo').addEventListener('click', abrirFormulario);
  document.getElementById('form-close').addEventListener('click', cerrarFormulario);
  document.getElementById('form-cancel').addEventListener('click', cerrarFormulario);
  document.getElementById('form-modal').addEventListener('click', e => {
    if (e.target.id === 'form-modal') cerrarFormulario();
  });
  document.getElementById('form-cometido').addEventListener('submit', enviarFormulario);
}

function actualizarLeyendaCoberturas() {
  const activos = Object.keys(layers.cobertura).filter(op => map.hasLayer(layers.cobertura[op]));
  const info = document.getElementById('leyenda-coberturas-info');
  if (!info) return;
  if (activos.length === 0) {
    setHTML(info, '');
  } else if (activos.length === 1) {
    const meta = COBERTURA_LAYERS[activos[0]];
    setHTML(info, `<strong>${escapeHtml(meta.label)}</strong>Zonas con cobertura 4G según reporte oficial SUBTEL.`);
  } else {
    const tema = document.documentElement.getAttribute('data-theme');
    const explicacion = tema === 'dark'
      ? 'Donde se solapan operadores el color se aclara (mezcla aditiva).'
      : 'Donde se solapan operadores el color se oscurece (mezcla por multiplicación).';
    setHTML(info, `<strong>${activos.length} operadores activos</strong>${escapeHtml(explicacion)}`);
  }
}

function toggleLayer(layer, visible) {
  if (visible) layer.addTo(map);
  else map.removeLayer(layer);
}

/* ========== DETALLE ========== */
function abrirDetalle(id) {
  const c = cometidos.find(x => x.id === id);
  if (!c) return;
  const cuerpo = document.getElementById('detalle-cuerpo');
  const flag = esAtrasado(c) ? `<span class="alerta-flag" style="position:static;margin-left:0.5rem">ATRASADO</span>` : '';

  let tracksHtml = '';
  if (c.tracks && c.tracks.length > 0) {
    tracksHtml = `
      <h3>Tracks SPOT</h3>
      <div class="tracks-list">
        ${c.tracks.slice().reverse().map(t => {
          const batClass = t.bateria < 30 ? 'crit' : t.bateria < 50 ? 'low' : '';
          return `
            <div class="track-row">
              <span class="track-time">${escapeHtml(t.ts.replace('T',' ').slice(0,16))}</span>
              <span>${escapeHtml(t.lat.toFixed(4))}, ${escapeHtml(t.lon.toFixed(4))}</span>
              <span class="track-bat ${batClass}">🔋 ${t.bateria ?? '—'}%</span>
              <span style="font-size:0.7rem;color:var(--text-dim)">${escapeHtml(t.tipo)}</span>
            </div>`;
        }).join('')}
      </div>`;
  }

  setHTML(cuerpo, `
    <div class="detalle">
      <h2>${escapeHtml(c.objetivo)} ${flag}</h2>
      <div class="detalle-volcan">${escapeHtml(c.volcan)} · ${escapeHtml(c.tipo)} · <span class="estado-badge ${escapeHtml(c.estado)}">${escapeHtml(labelEstado(c.estado))}</span></div>

      <h3>Identificación</h3>
      <div class="detalle-grid">
        <div class="detalle-field"><div class="label">ID</div><div class="value" style="font-family:ui-monospace,monospace">${escapeHtml(c.id)}</div></div>
        <div class="detalle-field"><div class="label">Salida</div><div class="value">${escapeHtml(formatFecha(c.fecha_salida))}</div></div>
        <div class="detalle-field"><div class="label">Regreso</div><div class="value">${escapeHtml(formatFecha(c.fecha_regreso))}</div></div>
        <div class="detalle-field"><div class="label">Días 100% / 40%</div><div class="value">${escapeHtml(String(c.dias_100))} / ${escapeHtml(String(c.dias_40))}</div></div>
        <div class="detalle-field"><div class="label">Viático total</div><div class="value">$${escapeHtml(c.viatico_total.toLocaleString('es-CL'))}</div></div>
        <div class="detalle-field"><div class="label">Vehículo · Patente</div><div class="value">${escapeHtml(c.vehiculo)} · ${escapeHtml(c.patente)}</div></div>
      </div>

      <h3>Equipo</h3>
      <div class="equipo-list">
        <div class="equipo-item"><strong>${escapeHtml(c.jefe_cometido.nombre)}</strong> <span class="rol">Jefe</span><br><span style="font-size:0.7rem;color:var(--text-dim)">${escapeHtml(c.jefe_cometido.celular)}</span></div>
        ${c.acompanantes.map(a => `
          <div class="equipo-item"><strong>${escapeHtml(a.nombre)}</strong> <span class="rol">${escapeHtml(a.rol)}</span><br><span style="font-size:0.7rem;color:var(--text-dim)">${escapeHtml(a.celular)}</span></div>
        `).join('')}
      </div>

      <h3>Ruta diaria</h3>
      <div class="detalle-ruta">
        ${c.ruta.map(r => `
          <div class="ruta-item">
            <div class="ruta-dia">${escapeHtml(String(r.dia))}</div>
            <div class="ruta-info">
              <div class="lugar">${escapeHtml(r.lugar)} <span style="font-size:0.7rem;color:var(--text-dim)">· ${escapeHtml(formatFecha(r.fecha))}</span></div>
              <div class="actividad">${escapeHtml(r.actividad)}</div>
            </div>
            <div class="ruta-señal ${escapeHtml(r['señal'])}">${escapeHtml(r['señal'])}${r.pernocte ? ' · 🏕' : ''}</div>
          </div>
        `).join('')}
      </div>

      ${tracksHtml}

      <h3>Riesgos identificados</h3>
      <div class="riesgos-list">
        ${c.riesgos.map(r => `<span class="riesgo-tag">${escapeHtml(r)}</span>`).join('')}
      </div>

      <h3>EPP asignado</h3>
      <div class="riesgos-list">
        ${c.epp.map(e => `<span class="equipo-item" style="font-size:0.72rem">${escapeHtml(e)}</span>`).join('')}
      </div>

      <h3>Contacto de emergencia</h3>
      <div class="detalle-field">
        <div class="label">${escapeHtml(c.contacto_emergencia.nombre)}</div>
        <div class="value">${escapeHtml(c.contacto_emergencia.telefono)}</div>
      </div>

      ${c.observaciones ? `<h3>Observaciones</h3><p style="font-size:0.85rem;color:var(--text-soft);line-height:1.5">${escapeHtml(c.observaciones)}</p>` : ''}
    </div>`);
  cuerpo.dataset.cometidoId = id;
  document.getElementById('detalle-modal').classList.remove('hidden');
}

function cerrarDetalle() {
  document.getElementById('detalle-modal').classList.add('hidden');
}

/* ========== PDF ========== */
async function exportarPDF() {
  const cuerpo = document.getElementById('detalle-cuerpo');
  const id = cuerpo.dataset.cometidoId;
  const c = cometidos.find(x => x.id === id);
  if (!c) return;

  try {
    const canvas = await html2canvas(cuerpo, { backgroundColor: getComputedStyle(document.body).backgroundColor, scale: 2 });
    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });

    const pageWidth  = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 32;
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // Header
    pdf.setFontSize(14);
    pdf.text('SERNAGEOMIN — OVDAS', margin, 32);
    pdf.setFontSize(9);
    pdf.text(`Ficha de cometido ${c.id} — Generado ${HOY.toISOString().slice(0,10)}`, margin, 46);

    // Imagen, paginada
    let heightLeft = imgHeight;
    let position = 60;
    pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
    heightLeft -= (pageHeight - position - margin);
    while (heightLeft > 0) {
      pdf.addPage();
      position = margin - (imgHeight - heightLeft);
      pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
      heightLeft -= (pageHeight - margin);
    }

    pdf.save(`Ficha_${c.id}_${c.volcan.replace(/\s+/g,'_')}.pdf`);
  } catch (err) {
    console.error('Error generando PDF:', err);
    alert('No se pudo generar el PDF. Revisa la consola.');
  }
}

/* ========== FORMULARIO ========== */
function abrirFormulario() {
  document.getElementById('form-modal').classList.remove('hidden');
  document.getElementById('form-cometido').reset();
}
function cerrarFormulario() {
  document.getElementById('form-modal').classList.add('hidden');
}

function enviarFormulario(e) {
  e.preventDefault();
  const f = e.target;
  const data = Object.fromEntries(new FormData(f));

  const volcan = volcanes.find(v => v.nombre === data.volcan);
  if (!volcan) { alert('Volcán no encontrado'); return; }

  const acompanantes = (data.acompanantes || '').split('\n').filter(l => l.trim()).map(l => {
    const [nombre, rol, rut, celular] = l.split('|').map(s => (s || '').trim());
    return { nombre, rol, rut, celular };
  });

  const idNuevo = `COM-2026-${String(cometidos.length + 1).padStart(3, '0')}`;
  const ficha = {
    id: idNuevo,
    estado: data.estado,
    tipo: data.tipo,
    objetivo: data.objetivo,
    volcan: data.volcan,
    volcan_coords: [volcan.lat, volcan.lon],
    fecha_salida: data.fecha_salida,
    fecha_regreso: data.fecha_regreso,
    dias_100: parseInt(data.dias_100, 10),
    dias_40:  parseInt(data.dias_40, 10),
    viatico_total: parseInt(data.viatico_total, 10),
    patente: data.patente.toUpperCase(),
    vehiculo: 'Camioneta OVDAS',
    jefe_cometido: { nombre: data.jefe_nombre, rut: data.jefe_rut, celular: data.jefe_celular },
    acompanantes,
    ruta: [
      { dia: 1, fecha: data.fecha_salida, lugar: `Traslado a ${data.volcan}`, coords: [volcan.lat, volcan.lon], actividad: 'Traslado y aproximación.', pernocte: true, 'señal': 'parcial' },
      { dia: 2, fecha: data.fecha_regreso, lugar: 'Retorno a Temuco', coords: [ovdasInfo.lat, ovdasInfo.lon], actividad: 'Retorno.', pernocte: false, 'señal': 'ok' }
    ],
    riesgos: (data.riesgos || '').split(',').map(s => s.trim()).filter(Boolean),
    epp: (data.epp || '').split(',').map(s => s.trim()).filter(Boolean),
    contacto_emergencia: { nombre: data.emerg_nombre || '', telefono: data.emerg_telefono || '' },
    observaciones: data.observaciones || ''
  };

  cometidos.push(ficha);
  poblarCometidosEnMapa();
  renderLista();
  cerrarFormulario();

  // Descargar JSON actualizado
  const out = {
    _meta: { fuente: 'Datos OVDAS', centro_costo: '2801', depto: 'RNVV / OVDAS', actualizado: HOY.toISOString().slice(0,10) },
    cometidos
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'cometidos.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);

  alert(`Ficha ${idNuevo} agregada y descargada como cometidos.json. Reemplaza el archivo en data/ y haz commit al repo para persistir.`);
}
