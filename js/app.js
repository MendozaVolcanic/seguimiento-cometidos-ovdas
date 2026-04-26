/* Seguimiento de Cometidos OVDAS — visor principal */

const SUBTEL_BASE = 'https://licancabur.subtel.gob.cl/server/rest/services';
const COBERTURA_LAYERS = {
  entel:    { url: `${SUBTEL_BASE}/Entel_4G_nov2025/MapServer`,    color: '#1e40af', label: 'Entel 4G' },
  movistar: { url: `${SUBTEL_BASE}/Movistar_4G_nov2025/MapServer`, color: '#0891b2', label: 'Movistar 4G' },
  claro:    { url: `${SUBTEL_BASE}/Claro_4G_nov2025/MapServer`,    color: '#dc2626', label: 'Claro 4G' },
  wom:      { url: `${SUBTEL_BASE}/Wom_4G_nov2025/MapServer`,      color: '#9333ea', label: 'WOM 4G' }
};

let cometidos = [];
let volcanes = [];
let ovdasInfo = null;
let map;
let layers = {
  volcanes: L.layerGroup(),
  cometidos: L.layerGroup(),
  rutas: L.layerGroup(),
  cobertura: {}
};
let cometidoSeleccionado = null;
let filtros = { estado: 'todos', volcan: 'todos', busqueda: '' };

/* sanitizador */
const sanitize = (html) => DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
const setHTML  = (el, html) => { el.innerHTML = sanitize(html); };

/* ========== INIT ========== */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [resCom, resVol] = await Promise.all([
      fetch('data/cometidos.json').then(r => r.json()),
      fetch('data/volcanes.json').then(r => r.json())
    ]);
    cometidos = resCom.cometidos;
    volcanes = resVol.volcanes;
    ovdasInfo = resVol.ovdas;

    initMap();
    poblarVolcanesEnMapa();
    poblarFiltroVolcan();
    poblarCometidosEnMapa();
    renderLista();
    renderKPIs();
    bindUI();
  } catch (err) {
    console.error('Error cargando datos:', err);
    document.getElementById('lista-cometidos').textContent =
      'Error cargando datos. Revisa la consola.';
  }
});

/* ========== MAP ========== */
function initMap() {
  map = L.map('map', {
    center: [-39.0, -71.8],
    zoom: 6,
    zoomControl: true,
    attributionControl: true
  });

  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19
  });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri',
    maxZoom: 19
  });
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenTopoMap (CC-BY-SA)',
    maxZoom: 17
  });

  topo.addTo(map);
  L.control.layers(
    { 'Topográfico': topo, 'Satelital (Esri)': sat, 'Calles (OSM)': osm },
    null,
    { position: 'bottomright' }
  ).addTo(map);

  layers.volcanes.addTo(map);
  layers.cometidos.addTo(map);
  layers.rutas.addTo(map);

  // OVDAS HQ
  const ovdasIcon = L.divIcon({
    className: 'volcan-marker',
    html: `<div class="volcan-icon">
      <svg width="28" height="28" viewBox="0 0 32 32">
        <rect x="6" y="10" width="20" height="18" fill="#1e293b" stroke="#3b82f6" stroke-width="2" rx="2"/>
        <rect x="10" y="14" width="3" height="3" fill="#3b82f6"/>
        <rect x="15" y="14" width="3" height="3" fill="#3b82f6"/>
        <rect x="20" y="14" width="3" height="3" fill="#3b82f6"/>
        <rect x="14" y="20" width="4" height="8" fill="#3b82f6"/>
      </svg>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
  L.marker([ovdasInfo.lat, ovdasInfo.lon], { icon: ovdasIcon })
    .bindPopup(`<strong>${escapeHtml(ovdasInfo.nombre)}</strong><br><span style="font-size:0.78rem;color:#94a3b8">Sede OVDAS — punto de partida y retorno</span>`)
    .addTo(map);
}

/* ========== VOLCANES ========== */
function poblarVolcanesEnMapa() {
  volcanes.forEach(v => {
    const color = v.alerta === 'Roja' ? '#dc2626'
                : v.alerta === 'Naranja' ? '#ea580c'
                : v.alerta === 'Amarilla' ? '#f59e0b'
                : '#10b981';
    const icon = L.divIcon({
      className: 'volcan-marker',
      html: `<div class="volcan-icon">
        <svg width="26" height="26" viewBox="0 0 32 32">
          <path d="M16 4 L29 27 H3 Z" fill="${color}" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round" opacity="0.9"/>
          <path d="M16 4 L19 13 L16 17 L13 13 Z" fill="#fef3c7" opacity="0.7"/>
        </svg>
      </div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 22]
    });
    const marker = L.marker([v.lat, v.lon], { icon }).bindPopup(sanitize(`
      <strong>${escapeHtml(v.nombre)}</strong><br>
      <span style="font-size:0.75rem;color:#94a3b8">${escapeHtml(v.region)}</span><br>
      <span style="font-size:0.75rem">Alerta: <strong style="color:${color}">${escapeHtml(v.alerta)}</strong></span>
    `));
    layers.volcanes.addLayer(marker);
  });
}

function poblarFiltroVolcan() {
  const sel = document.getElementById('filtro-volcan');
  [...new Set(cometidos.map(c => c.volcan))].sort().forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
}

/* ========== COMETIDOS / PINS ========== */
function poblarCometidosEnMapa() {
  layers.cometidos.clearLayers();
  layers.rutas.clearLayers();

  const filtrados = filtrarCometidos();

  const porVolcan = {};
  filtrados.forEach(c => {
    porVolcan[c.volcan] = porVolcan[c.volcan] || [];
    porVolcan[c.volcan].push(c);
  });

  Object.values(porVolcan).forEach(grupo => {
    grupo.forEach((c, idx) => {
      const offset = grupo.length > 1 ? offsetCoords(c.volcan_coords, idx, grupo.length) : c.volcan_coords;
      const inicial = c.jefe_cometido.nombre.split(' ').map(n => n[0]).slice(0,2).join('');

      const icon = L.divIcon({
        className: 'cometido-marker',
        html: `<div class="cometido-pin ${escapeHtml(c.estado)}"><span>${escapeHtml(inicial)}</span></div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 38],
        popupAnchor: [0, -36]
      });

      const marker = L.marker(offset, { icon }).bindPopup(sanitize(buildPopup(c)));
      marker.on('click', () => {
        cometidoSeleccionado = c.id;
        renderLista();
      });
      layers.cometidos.addLayer(marker);

      if (offset !== c.volcan_coords) {
        L.polyline([offset, c.volcan_coords], {
          color: '#64748b', weight: 1, dashArray: '2,3', opacity: 0.6
        }).addTo(layers.cometidos);
      }
    });
  });

  filtrados.filter(c => c.estado === 'en_terreno').forEach(c => dibujarRuta(c));
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

  L.polyline(puntos, {
    color: '#10b981',
    weight: 3,
    opacity: 0.7,
    dashArray: '6,6'
  }).addTo(layers.rutas);

  c.ruta.forEach((wp) => {
    const señalKey = (wp['señal'] || 'nula');
    const icon = L.divIcon({
      className: 'waypoint-icon',
      html: `<div class="waypoint-dot señal-${escapeHtml(señalKey)}">${escapeHtml(String(wp.dia))}</div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
    L.marker(wp.coords, { icon })
      .bindPopup(sanitize(`
        <strong>Día ${escapeHtml(String(wp.dia))} — ${escapeHtml(wp.fecha)}</strong><br>
        <span style="color:#fbbf24">${escapeHtml(wp.lugar)}</span><br>
        <span style="font-size:0.78rem">${escapeHtml(wp.actividad)}</span><br>
        <span style="font-size:0.7rem;color:#94a3b8">Señal celular: <strong>${escapeHtml(señalKey)}</strong>${wp.pernocte ? ' · 🏕 pernocte' : ''}</span>
      `))
      .addTo(layers.rutas);
  });
}

function buildPopup(c) {
  return `
    <div class="popup-cometido">
      <h3>${escapeHtml(c.jefe_cometido.nombre)}</h3>
      <div class="popup-volcan">${escapeHtml(c.volcan)} · ${escapeHtml(c.tipo)}</div>
      <div class="popup-row"><strong>Estado</strong> <span class="estado-badge ${escapeHtml(c.estado)}">${escapeHtml(labelEstado(c.estado))}</span></div>
      <div class="popup-row"><strong>Patente</strong> ${escapeHtml(c.patente)}</div>
      <div class="popup-row"><strong>Fechas</strong> ${escapeHtml(formatFecha(c.fecha_salida))} → ${escapeHtml(formatFecha(c.fecha_regreso))}</div>
      <div class="popup-row"><strong>Equipo</strong> ${1 + c.acompanantes.length} persona${c.acompanantes.length === 0 ? '' : 's'}</div>
      <div class="popup-actions">
        <button data-detalle-id="${escapeHtml(c.id)}">Ver ficha completa</button>
      </div>
    </div>
  `;
}

/* ========== LISTA ========== */
function filtrarCometidos() {
  const q = filtros.busqueda.toLowerCase().trim();
  return cometidos.filter(c => {
    if (filtros.estado !== 'todos' && c.estado !== filtros.estado) return false;
    if (filtros.volcan !== 'todos' && c.volcan !== filtros.volcan) return false;
    if (q) {
      const hay = [
        c.objetivo, c.jefe_cometido.nombre, c.patente, c.volcan, c.tipo,
        ...(c.acompanantes || []).map(a => a.nombre)
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
    cont.textContent = 'Sin cometidos para los filtros aplicados.';
    cont.style.padding = '1rem';
    cont.style.color = '#94a3b8';
    cont.style.fontSize = '0.85rem';
  } else {
    cont.style = '';
    setHTML(cont, filtrados.map(c => `
      <div class="cometido-card estado-${escapeHtml(c.estado)} ${c.id === cometidoSeleccionado ? 'active' : ''}" data-id="${escapeHtml(c.id)}">
        <div class="card-head">
          <div>
            <div class="card-volcan">${escapeHtml(c.volcan)}</div>
            <div class="card-id">${escapeHtml(c.id)}</div>
          </div>
          <span class="estado-badge ${escapeHtml(c.estado)}">${escapeHtml(labelEstado(c.estado))}</span>
        </div>
        <div class="card-objetivo">${escapeHtml(c.objetivo)}</div>
        <div class="card-meta">
          <span class="card-meta-item">👤 ${escapeHtml(c.jefe_cometido.nombre)}</span>
          <span class="card-meta-item">🚙 ${escapeHtml(c.patente)}</span>
          <span class="card-meta-item">📅 ${escapeHtml(formatFechaCorta(c.fecha_salida))}–${escapeHtml(formatFechaCorta(c.fecha_regreso))}</span>
        </div>
      </div>
    `).join(''));
  }

  document.getElementById('contador-cometidos').textContent =
    `${filtrados.length} cometido${filtrados.length === 1 ? '' : 's'}`;

  cont.querySelectorAll('.cometido-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const c = cometidos.find(x => x.id === id);
      cometidoSeleccionado = id;
      renderLista();
      poblarCometidosEnMapa();
      dibujarRuta(c);
      const bounds = L.latLngBounds([c.volcan_coords, ...c.ruta.map(r => r.coords)]);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 11 });
    });
    card.addEventListener('dblclick', () => abrirDetalle(card.dataset.id));
  });
}

/* ========== KPIs ========== */
function renderKPIs() {
  const cnt = { en_terreno: 0, planificado: 0, completado: 0 };
  cometidos.forEach(c => cnt[c.estado]++);
  setHTML(document.getElementById('kpis'), `
    <div class="kpi en_terreno"><span class="kpi-label">En terreno</span><span class="kpi-value">${cnt.en_terreno}</span></div>
    <div class="kpi planificado"><span class="kpi-label">Planificados</span><span class="kpi-value">${cnt.planificado}</span></div>
    <div class="kpi completado"><span class="kpi-label">Completados</span><span class="kpi-value">${cnt.completado}</span></div>
  `);
}

/* ========== UI BINDINGS ========== */
function bindUI() {
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

  document.getElementById('toggle-volcanes').addEventListener('change', e => {
    e.target.checked ? layers.volcanes.addTo(map) : map.removeLayer(layers.volcanes);
  });
  document.getElementById('toggle-rutas').addEventListener('change', e => {
    e.target.checked ? layers.rutas.addTo(map) : map.removeLayer(layers.rutas);
  });

  document.querySelectorAll('[data-operador]').forEach(cb => {
    cb.addEventListener('change', e => {
      const op = e.target.dataset.operador;
      if (e.target.checked) {
        if (!layers.cobertura[op]) {
          layers.cobertura[op] = L.esri.dynamicMapLayer({
            url: COBERTURA_LAYERS[op].url,
            opacity: 0.45,
            attribution: 'SUBTEL · Cobertura nov-2025'
          });
        }
        layers.cobertura[op].addTo(map);
      } else if (layers.cobertura[op]) {
        map.removeLayer(layers.cobertura[op]);
      }
    });
  });

  // Delegación: botón "Ver ficha completa" dentro de popups
  document.body.addEventListener('click', e => {
    const btn = e.target.closest('[data-detalle-id]');
    if (btn) abrirDetalle(btn.dataset.detalleId);
  });

  document.getElementById('modal-close').addEventListener('click', cerrarDetalle);
  document.getElementById('detalle-modal').addEventListener('click', e => {
    if (e.target.id === 'detalle-modal') cerrarDetalle();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') cerrarDetalle();
  });
}

/* ========== DETALLE MODAL ========== */
function abrirDetalle(id) {
  const c = cometidos.find(x => x.id === id);
  if (!c) return;
  const cuerpo = document.getElementById('detalle-cuerpo');
  setHTML(cuerpo, `
    <div class="detalle">
      <h2>${escapeHtml(c.objetivo)}</h2>
      <div class="detalle-volcan">${escapeHtml(c.volcan)} · ${escapeHtml(c.tipo)} · <span class="estado-badge ${escapeHtml(c.estado)}">${escapeHtml(labelEstado(c.estado))}</span></div>

      <h3>Identificación</h3>
      <div class="detalle-grid">
        <div class="detalle-field"><div class="label">ID Cometido</div><div class="value" style="font-family:ui-monospace,monospace">${escapeHtml(c.id)}</div></div>
        <div class="detalle-field"><div class="label">Salida</div><div class="value">${escapeHtml(formatFecha(c.fecha_salida))}</div></div>
        <div class="detalle-field"><div class="label">Regreso</div><div class="value">${escapeHtml(formatFecha(c.fecha_regreso))}</div></div>
        <div class="detalle-field"><div class="label">Días 100% / 40%</div><div class="value">${escapeHtml(String(c.dias_100))} / ${escapeHtml(String(c.dias_40))}</div></div>
        <div class="detalle-field"><div class="label">Viático total</div><div class="value">$${escapeHtml(c.viatico_total.toLocaleString('es-CL'))}</div></div>
        <div class="detalle-field"><div class="label">Vehículo · Patente</div><div class="value">${escapeHtml(c.vehiculo)} · ${escapeHtml(c.patente)}</div></div>
      </div>

      <h3>Equipo</h3>
      <div class="equipo-list">
        <div class="equipo-item"><strong>${escapeHtml(c.jefe_cometido.nombre)}</strong> <span class="rol">Jefe cometido</span><br><span style="font-size:0.7rem;color:#94a3b8">${escapeHtml(c.jefe_cometido.celular)}</span></div>
        ${c.acompanantes.map(a => `
          <div class="equipo-item"><strong>${escapeHtml(a.nombre)}</strong> <span class="rol">${escapeHtml(a.rol)}</span><br><span style="font-size:0.7rem;color:#94a3b8">${escapeHtml(a.celular)}</span></div>
        `).join('')}
      </div>

      <h3>Ruta diaria</h3>
      <div class="detalle-ruta">
        ${c.ruta.map(r => `
          <div class="ruta-item">
            <div class="ruta-dia">${escapeHtml(String(r.dia))}</div>
            <div class="ruta-info">
              <div class="lugar">${escapeHtml(r.lugar)} <span style="font-size:0.7rem;color:#94a3b8">· ${escapeHtml(formatFecha(r.fecha))}</span></div>
              <div class="actividad">${escapeHtml(r.actividad)}</div>
            </div>
            <div class="ruta-señal ${escapeHtml(r['señal'])}">${escapeHtml(r['señal'])}${r.pernocte ? ' · 🏕' : ''}</div>
          </div>
        `).join('')}
      </div>

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

      ${c.observaciones ? `<h3>Observaciones</h3><p style="font-size:0.85rem;color:#cbd5e1;line-height:1.5">${escapeHtml(c.observaciones)}</p>` : ''}
    </div>
  `);
  document.getElementById('detalle-modal').classList.remove('hidden');
}

function cerrarDetalle() {
  document.getElementById('detalle-modal').classList.add('hidden');
}

/* ========== HELPERS ========== */
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
