/* =========================================================
   API Client + Helpers globali
   ========================================================= */

const API_BASE = '/api';
const TOKEN_KEY = 'conservatory_token';
const USER_KEY = 'conservatory_user';

const Auth = {
  getToken() { return localStorage.getItem(TOKEN_KEY); },
  setToken(t) { localStorage.setItem(TOKEN_KEY, t); },
  getUser() {
    const u = localStorage.getItem(USER_KEY);
    return u ? JSON.parse(u) : null;
  },
  setUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
  isAuthenticated() { return !!this.getToken(); },
  isAdmin() { return this.getUser()?.role === 'admin'; },
  isDocente() { return this.getUser()?.role === 'docente'; },
  isStudente() { return this.getUser()?.role === 'studente'; },
  logout() {
    this.clear();
    window.location.href = '/login.html';
  }
};

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = Auth.getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined
  });

  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json();

  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.details = data?.details || data?.issues;
    err.data = data;
    if (res.status === 401 && Auth.isAuthenticated()) {
      Auth.logout();
    }
    throw err;
  }
  return data;
}

// =========================================================
// Helper UI
// =========================================================

function toast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(20px)';
    setTimeout(() => t.remove(), 300);
  }, 3800);
}

function showError(err) {
  console.error(err);
  let msg = err.message || 'Errore sconosciuto';
  if (err.details && Array.isArray(err.details)) {
    msg += ': ' + err.details.map(d => d.msg || d).join(', ');
  } else if (err.data?.issues && Array.isArray(err.data.issues)) {
    msg = err.data.issues.join(' • ');
  }
  toast(msg, 'error');
}

function fmt(date, opts = {}) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('it-IT', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    ...opts
  });
}
function fmtDate(date) {
  return new Date(date).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
}
function fmtTime(date) {
  return new Date(date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'onclick') e.addEventListener('click', v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[c]));
}

function modal({ title, body, footer, onClose }) {
  const overlay = el('div', { class: 'modal-overlay' });
  const m = el('div', { class: 'modal' });

  const close = () => { overlay.remove(); if (onClose) onClose(); };

  const header = el('div', { class: 'modal-header' },
    el('h2', {}, title),
    el('button', { class: 'modal-close', onclick: close, type: 'button' }, '×')
  );

  const bodyEl = el('div', { class: 'modal-body' });
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else bodyEl.appendChild(body);

  m.appendChild(header);
  m.appendChild(bodyEl);

  if (footer) {
    const f = el('div', { class: 'modal-footer' });
    if (typeof footer === 'string') f.innerHTML = footer;
    else if (Array.isArray(footer)) footer.forEach(b => f.appendChild(b));
    else f.appendChild(footer);
    m.appendChild(f);
  }

  overlay.appendChild(m);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);

  return { close, modal: m };
}

function confirmDialog(message, onConfirm) {
  modal({
    title: 'Conferma',
    body: el('p', {}, message),
    footer: [
      el('button', { class: 'btn btn-ghost', onclick: () => document.querySelector('.modal-overlay').remove() }, 'Annulla'),
      el('button', {
        class: 'btn btn-danger',
        onclick: () => { document.querySelector('.modal-overlay').remove(); onConfirm(); }
      }, 'Conferma')
    ]
  });
}

// =========================================================
// Icone SVG (stile Lucide) per la sidebar e i widget
// =========================================================
const ICONS = {
  brand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
  rooms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21V3H5v18"/><path d="M3 21h18"/><circle cx="14" cy="12" r="1"/></svg>',
  booking: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  'my-bookings': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  structure: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-6h6v6"/><line x1="8" y1="6" x2="8.01" y2="6"/><line x1="16" y1="6" x2="16.01" y2="6"/><line x1="8" y1="10" x2="8.01" y2="10"/><line x1="16" y1="10" x2="16.01" y2="10"/></svg>',
  courses: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  rules: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  // stat icons
  door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21V3H5v18"/><path d="M3 21h18"/><circle cx="14" cy="12" r="1"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  group: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-6h6v6"/><line x1="8" y1="6" x2="8.01" y2="6"/><line x1="16" y1="6" x2="16.01" y2="6"/><line x1="8" y1="10" x2="8.01" y2="10"/><line x1="16" y1="10" x2="16.01" y2="10"/></svg>'
};

function icon(name, attrs = '') {
  return `<span class="icon"${attrs ? ' ' + attrs : ''}>${ICONS[name] || ''}</span>`;
}

// =========================================================
// Info istituto (cache locale per pagina)
// =========================================================
const Institute = {
  _cache: null,
  async getPublic() {
    if (this._cache !== null) return this._cache;
    try {
      const res = await fetch(`${API_BASE}/structure/institutes/public`);
      if (!res.ok) return (this._cache = null);
      const data = await res.json();
      this._cache = data.institute || null;
      return this._cache;
    } catch { return (this._cache = null); }
  }
};

// =========================================================
// Init topbar/sidebar (per pagine autenticate)
// =========================================================
function renderShell(activeNav) {
  const user = Auth.getUser();
  if (!user) {
    window.location.href = '/login.html';
    return;
  }

  // Brand: tile fisso con icona dell'app (assets/icona.png)
  const brand = document.querySelector('.sidebar .brand');
  if (brand) {
    brand.innerHTML = `
      <div class="brand-tile">
        <img src="/assets/icona.png" alt="Aulae Cantorum">
      </div>
      <div class="brand-text">
        <h1>Aulae <em>Cantorum</em></h1>
        <div class="tagline">Prenotazione aule</div>
      </div>`;
  }

  // Inietta icone SVG su ogni voce di nav (in base a data-nav o all'href)
  document.querySelectorAll('.sidebar nav a').forEach(a => {
    const fromHref = a.getAttribute('href')
      ?.replace(/^\/(admin\/)?/, '')
      .replace(/\.html$/, '');
    const navKey = a.dataset.nav || fromHref || '';
    const span = a.querySelector('.icon');
    const svg = ICONS[navKey] || ICONS.dashboard;
    if (span) span.innerHTML = svg;
    else a.insertAdjacentHTML('afterbegin', `<span class="icon">${svg}</span>`);
  });

  const initials = (user.firstName?.[0] || '') + (user.lastName?.[0] || '');
  const userInfo = document.getElementById('user-info');
  if (userInfo) {
    userInfo.innerHTML = `
      <span class="role-badge">${escapeHtml(user.role)}</span>
      <span>${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}</span>
      <div class="avatar">${escapeHtml(initials.toUpperCase())}</div>
      <button class="btn btn-ghost btn-sm" id="logout-btn">${ICONS.logout}<span style="margin-left:6px;">Esci</span></button>
    `;
    document.getElementById('logout-btn')?.addEventListener('click', () => Auth.logout());
  }

  // Mostra/nascondi voci nav in base al ruolo
  const adminItems = document.querySelectorAll('[data-role="admin"]');
  adminItems.forEach(it => { it.style.display = user.role === 'admin' ? '' : 'none'; });

  if (activeNav) {
    document.querySelectorAll('.sidebar nav a').forEach(a => {
      if (a.dataset.nav === activeNav) a.classList.add('active');
    });
  }
}

// Verifica se profilo completo, altrimenti redirect (per pagine che richiedono profilo)
function requireProfileComplete() {
  const u = Auth.getUser();
  if (!u) { window.location.href = '/login.html'; return false; }
  if (u.role !== 'admin' && (!u.matricola || !u.courseId)) {
    window.location.href = '/complete-profile.html';
    return false;
  }
  return true;
}
