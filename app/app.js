/* Agente Móvil Perú · App de créditos (cliente + administrador) */
{
const C = window.AMP_CONFIG || {};
const DEMO = !C.SUPABASE_URL || !C.SUPABASE_ANON_KEY;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => new Intl.NumberFormat('es-PE', {style:'currency', currency:'PEN'}).format(+n || 0);
const r2 = n => Math.round((+n + Number.EPSILON) * 100) / 100;
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + +n); return d.toISOString().slice(0,10); };
const fdate = iso => iso ? new Date(String(iso).length > 10 ? iso : iso + 'T12:00:00').toLocaleDateString('es-PE', {day:'2-digit', month:'short', year:'numeric'}) : '—';
const fwhen = iso => new Date(iso).toLocaleString('es-PE', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'});
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const wa = (phone, text) => `https://wa.me/${String(phone || '').replace(/\D/g,'').replace(/^(?!51)(\d{9})$/, '51$1')}?text=${encodeURIComponent(text)}`;

/* ---------- Cálculo del crédito: interés simple diario sobre el monto prestado ---------- */
function calc(amount, ratePct, days) {
  const perDay = r2(amount * ratePct / 100), interest = r2(amount * ratePct / 100 * days);
  return { perDay, interest, total: r2(+amount + interest) };
}
const paidOf = l => r2((l.payments || []).reduce((s, p) => s + +p.amount, 0));
const elapsedOf = (l, on = todayISO()) => Math.max(0, daysBetween(l.start_date, on));           // días desde el depósito
const perDayOf = l => r2(l.approved_amount * l.daily_rate / 100);
const accruedOf = (l, on) => l.status === 'pagado' ? +l.total_interest || 0 : r2(l.approved_amount * l.daily_rate / 100 * elapsedOf(l, on));
const debtOf = (l, on) => l.status !== 'depositado' ? 0 : r2(Math.max(0, +l.approved_amount + accruedOf(l, on) - paidOf(l)));  // deuda a una fecha
const interestPaidOf = l => l.status === 'pagado' ? +l.total_interest || 0 : l.status === 'depositado' ? Math.min(paidOf(l), accruedOf(l)) : 0;
const isOverdue = l => l.status === 'depositado' && l.due_date && l.due_date < todayISO();
const totalsOf = loans => {
  const ok = loans.filter(l => l.status === 'depositado' || l.status === 'pagado');
  return { n: ok.length, lent: r2(ok.reduce((s, l) => s + +l.approved_amount, 0)), interest: r2(ok.reduce((s, l) => s + interestPaidOf(l), 0)), debt: r2(ok.reduce((s, l) => s + debtOf(l), 0)) };
};
const personOf = l => l.client || { full_name: l.ext_name, dni: l.ext_dni, phone: l.ext_phone, email: '', external: true };
const depositText = l => !l.deposit_method ? '' : l.deposit_method === 'yape' ? `Yape ${l.deposit_number} · ${l.deposit_holder}` : `${l.deposit_bank} · cuenta ${l.deposit_number} · ${l.deposit_holder}`;

/* =================================================================
   BACKEND 1: SUPABASE (producción)
   ================================================================= */
function supabaseBackend() {
  let sb, me = null, authUser = null;
  const ready = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js';
    s.onload = () => { sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY); res(); };
    s.onerror = () => rej(new Error('No se pudo cargar Supabase. Revisa tu conexión.'));
    document.head.appendChild(s);
  });
  const chk = ({ data, error }) => { if (error) throw new Error(traducir(error.message)); return data; };
  const loadMe = async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return (me = authUser = null);
    authUser = session.user;
    me = chk(await sb.from('profiles').select('*').eq('id', session.user.id).single());
    return me;
  };
  return {
    async current() { await ready; return loadMe(); },
    async signUp({ email, password, full_name, dni, phone }) {
      await ready;
      const d = chk(await sb.auth.signUp({ email, password, options: { data: { full_name, dni, phone } } }));
      if (!d.session) return { needsConfirm: true };
      return loadMe();
    },
    async signIn(email, password) { await ready; chk(await sb.auth.signInWithPassword({ email, password })); return loadMe(); },
    async signOut() { await ready; await sb.auth.signOut(); me = null; },
    async resetPassword(email) { await ready; chk(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] })); },
    async updatePassword(password) { await ready; chk(await sb.auth.updateUser({ password })); },
    getPin() { return authUser?.user_metadata?.pin || null; },
    async setPin(pin) { const d = chk(await sb.auth.updateUser({ data: { pin } })); authUser = d.user; },
    async createLoan(v) { return chk(await sb.from('loans').insert(v).select('id').single()).id; },
    async deleteLoan(id) { chk(await sb.from('loans').delete().eq('id', id)); },
    async listLoans() {
      return chk(await sb.from('loans').select('*, payments(*), client:profiles(full_name,email,phone,dni)').order('created_at', { ascending: false }));
    },
    async updateLoan(id, patch) { chk(await sb.from('loans').update(patch).eq('id', id)); },
    async addPayment(loan_id, amount, note, paid_on) { chk(await sb.from('payments').insert({ loan_id, amount, note, paid_on })); },
    async listClients() { return chk(await sb.from('profiles').select('*').eq('role', 'cliente').order('created_at', { ascending: false })); },
    async listNotifications() { return chk(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)); },
    async markAllRead() { chk(await sb.from('notifications').update({ read: true }).eq('user_id', me.id).eq('read', false)); },
    onChange(cb) {
      if (!me) return () => {};
      const ch = sb.channel('amp-' + me.id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + me.id }, p => cb(p.new))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'loans' }, () => cb(null))
        .subscribe();
      return () => sb.removeChannel(ch);
    },
    onRecovery(cb) { ready.then(() => sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') cb(); })); }
  };
}
function traducir(m) {
  const t = {
    'Invalid login credentials': 'Correo o contraseña incorrectos.',
    'User already registered': 'Ese correo ya está registrado. Ingresa con tu contraseña.',
    'Database error saving new user': 'Ese número de celular ya está registrado. Ingresa con tu cuenta.',
    'Email not confirmed': 'Confirma tu correo: te enviamos un enlace.',
    'Password should be at least 6 characters': 'La contraseña debe tener al menos 6 caracteres.'
  };
  for (const k in t) if (m.includes(k)) return t[k];
  return m;
}

/* =================================================================
   BACKEND 2: DEMO (todo en este navegador, para probar)
   ================================================================= */
function demoBackend() {
  const KEY = 'amp_demo_v2', SKEY = 'amp_demo_session';
  let mem = null, memSession = null;
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return mem; } };
  const write = db => { mem = db; try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} listeners.forEach(f => f(null)); };
  const getS = () => { try { return localStorage.getItem(SKEY); } catch { return memSession; } };
  const setS = v => { memSession = v; try { v ? localStorage.setItem(SKEY, v) : localStorage.removeItem(SKEY); } catch {} };
  const listeners = new Set();
  const seed = () => {
    const now = Date.now(), iso = t => new Date(t).toISOString();
    const db = { seq: 100, users: [
      { id: 'u-admin', email: 'admin@agentemovil.pe', pass: 'admin123', full_name: 'Administrador', role: 'admin', phone: '999999999', created_at: iso(now - 9e8) },
      { id: 'u-maria', email: 'maria@ejemplo.pe', pass: 'cliente123', full_name: 'María Quispe Huamán', dni: '45678912', phone: '987654321', role: 'cliente', created_at: iso(now - 6e8) },
      { id: 'u-jose', email: 'jose@ejemplo.pe', pass: 'cliente123', full_name: 'José Mamani Rojas', dni: '41237788', phone: '912345678', role: 'cliente', created_at: iso(now - 5e8) }
    ], loans: [], payments: [], notifications: [] };
    const start = addDays(todayISO(), -5), c = calc(800, 0.3, 14);
    db.loans.push({ id: 1, client_id: 'u-jose', requested_amount: 800, requested_days: 14, purpose: 'Mercadería para mi bodega', status: 'depositado',
      deposit_method: 'yape', deposit_number: '912345678', deposit_holder: 'José Mamani Rojas',
      approved_amount: 800, daily_rate: 0.3, term_days: 14, total_interest: c.interest, total_to_pay: c.total, start_date: start, due_date: addDays(start, 14),
      created_at: iso(now - 6 * 864e5), decided_at: iso(now - 5 * 864e5) });
    db.payments.push({ id: 1, loan_id: 1, amount: 300, paid_on: addDays(start, 2), note: 'Yape', created_at: iso(now - 3 * 864e5) });
    db.loans.push({ id: 2, client_id: 'u-maria', requested_amount: 1500, requested_days: 10, purpose: 'Capital de trabajo', status: 'pendiente',
      deposit_method: 'cuenta', deposit_bank: 'BCP', deposit_number: '19112345678012', deposit_holder: 'María Quispe Huamán', created_at: iso(now - 36e5) });
    db.notifications.push({ id: 1, user_id: 'u-admin', title: 'Nueva solicitud de préstamo', body: 'María Quispe Huamán (DNI 45678912, cel. 987654321) solicitó un préstamo por S/ 1,500.00 a 10 días.', loan_id: 2, read: false, created_at: iso(now - 36e5) });
    return db;
  };
  let db = read(); if (!db) { db = seed(); write(db); }
  const load = () => (db = read() || db);
  const save = () => { db.seq++; write(db); };
  const pub = u => u && (({ pass, ...rest }) => rest)(u);
  const meU = () => { load(); return db.users.find(u => u.id === getS()); };
  const notify = (user_id, title, body, loan_id) => db.notifications.push({ id: ++db.seq, user_id, title, body, loan_id, read: false, created_at: new Date().toISOString() });
  const wait = () => new Promise(r => setTimeout(r, 200));
  try { addEventListener('storage', e => { if (e.key === KEY) { load(); listeners.forEach(f => f(null)); } }); } catch {}
  return {
    demo: true,
    async current() { return pub(meU()) || null; },
    async signUp({ email, password, full_name, dni, phone }) {
      await wait(); load(); email = email.trim().toLowerCase();
      if (db.users.some(u => u.email === email)) throw new Error('Ese correo ya está registrado. Ingresa con tu contraseña.');
      if (db.users.some(u => u.phone === phone)) throw new Error('Ese número de celular ya está registrado. Ingresa con tu cuenta.');
      const u = { id: 'u-' + (++db.seq), email, pass: password, full_name, dni, phone, role: 'cliente', created_at: new Date().toISOString() };
      db.users.push(u); save(); setS(u.id); return pub(u);
    },
    async signIn(email, password) {
      await wait(); load();
      const u = db.users.find(x => x.email === email.trim().toLowerCase() && x.pass === password);
      if (!u) throw new Error('Correo o contraseña incorrectos.');
      setS(u.id); return pub(u);
    },
    async signOut() { setS(null); },
    async resetPassword() { throw new Error('En modo demo no se envían correos.'); },
    async updatePassword() {},
    getPin() { return meU()?.pin || null; },
    async setPin(pin) { load(); db.users.find(u => u.id === getS()).pin = pin; save(); },
    async createLoan(v) {
      await wait(); const me = meU(); const id = ++db.seq, ext = v.client_id === null;
      db.loans.push({ id, client_id: me.id, ...v, status: 'pendiente', created_at: new Date().toISOString() });
      if (!ext) db.users.filter(u => u.role === 'admin').forEach(a => notify(a.id, 'Nueva solicitud de préstamo',
        `${me.full_name || me.email} (DNI ${me.dni || '—'}, cel. ${me.phone || '—'}) solicitó un préstamo por ${money(v.requested_amount)} a ${v.requested_days} días.`, id));
      save(); return id;
    },
    async deleteLoan(id) { await wait(); load(); db.loans = db.loans.filter(l => l.id !== id); db.notifications = db.notifications.filter(n => n.loan_id !== id); save(); },
    async listLoans() {
      const me = meU(); const all = me.role === 'admin' ? db.loans : db.loans.filter(l => l.client_id === me.id);
      return all.map(l => ({ ...l, payments: db.payments.filter(p => p.loan_id === l.id), client: pub(db.users.find(u => u.id === l.client_id)) }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async updateLoan(id, patch) {
      await wait(); load(); const l = db.loans.find(x => x.id === id); const old = l.status; Object.assign(l, patch);
      if (patch.status && patch.status !== old) {
        const m = { depositado: ['¡Tu crédito fue aprobado y depositado!', `Se depositaron ${money(l.approved_amount)}. Interés ${l.daily_rate}% diario. Si pagas el ${fdate(l.due_date)}, el total será ${money(l.total_to_pay)}.`],
          rechazado: ['Tu solicitud no fue aprobada', l.admin_note || 'Comunícate con nosotros para más información.'],
          pagado: ['Crédito cancelado. ¡Gracias!', 'Tu préstamo quedó totalmente pagado.'] }[l.status];
        if (m && l.client_id) notify(l.client_id, m[0], m[1], l.id);
      }
      save();
    },
    async addPayment(loan_id, amount, note, paid_on) { await wait(); load(); db.payments.push({ id: ++db.seq, loan_id, amount, note, paid_on, created_at: new Date().toISOString() }); save(); },
    async listClients() { load(); return db.users.filter(u => u.role === 'cliente').map(pub).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    async listNotifications() { const me = meU(); return db.notifications.filter(n => n.user_id === me.id).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    async markAllRead() { const me = meU(); db.notifications.forEach(n => { if (n.user_id === me.id) n.read = true; }); save(); },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    onRecovery() {},
    reset() { try { localStorage.removeItem(KEY); localStorage.removeItem(SKEY); } catch {} mem = null; db = seed(); write(db); setS(null); }
  };
}

const api = DEMO ? demoBackend() : supabaseBackend();

/* =================================================================
   ESTADO Y UTILIDADES DE INTERFAZ
   ================================================================= */
const S = { me: null, loans: [], notes: [], clients: [], tab: 'pendientes', authTab: 'login', unsub: null };
const app = $('#app');

function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.role = 'status'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3800);
}
function sheet(html, onMount) {
  closeSheet();
  const bg = document.createElement('div'); bg.className = 'sheet-bg'; bg.id = 'sheet';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) closeSheet(); });
  document.body.appendChild(bg); onMount && onMount(bg); const f = bg.querySelector('input,button.x'); f && f.focus();
}
function closeSheet() { $('#sheet')?.remove(); }
addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

function osNotify(n) {
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(n.title, { body: n.body || '', icon: 'icon-192.png' }); } catch {}
}
function askOsPermission() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
}

const logo = `<img src="logo.png" alt="Agente Móvil">`;
const bell = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>`;
const loopI = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.640-6.360"/><path d="M21 3v6h-6"/></svg>`;
const exitI = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>`;
const eyeOn = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const eyeOff = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4M6.5 6.6C3.7 8.500 2 12 2 12s3.6 7 10 7c1.700 0 3.200-.5 4.500-1.200M9.900 9.900a3 3 0 0 0 4.200 4.200"/></svg>`;
const pwField = (id, extra) => `<div class="pww"><input id="${id}" type="password" ${extra}><button type="button" class="eye" data-eye="${id}" aria-label="Mostrar contraseña" aria-pressed="false">${eyeOn}</button></div>`;
const demoBar = () => DEMO ? `<div class="demo">Modo demo: los datos viven solo en este navegador. <button class="btn ghost small" data-act="reset" style="min-height:32px;margin-left:6px">Reiniciar demo</button></div>` : '';
const statusChip = l => isOverdue(l) ? `<span class="status s-vencido">Vencido</span>` :
  `<span class="status s-${l.status}">${{ pendiente: 'En evaluación', depositado: 'Depositado', rechazado: 'Rechazado', pagado: 'Pagado' }[l.status]}</span>`;

async function refresh() {
  [S.loans, S.notes] = await Promise.all([api.listLoans(), api.listNotifications()]);
  S.loans.forEach(l => { l.client = personOf(l); });
  if (S.me.role === 'admin') S.clients = await api.listClients();
  render();
}
function subscribe() {
  S.unsub && S.unsub();
  S.unsub = api.onChange(n => {
    if (n) { toast(n.title); osNotify(n); }
    refresh().catch(() => {});
  });
}

/* =================================================================
   PANTALLA: INGRESO / REGISTRO
   ================================================================= */
function renderAuth() {
  const reg = S.authTab === 'reg';
  app.innerHTML = `${demoBar()}
  <div class="auth-hero">${logo}
    <h1>${esc(C.EMPRESA || 'Agente Móvil Perú')}</h1><p>Solicita tu crédito desde el celular y recibe la respuesta aquí mismo.</p></div>
  <div class="wrap"><div class="card auth-card">
    <div class="seg" role="tablist">
      <button role="tab" aria-selected="${!reg}" data-auth="login">Ingresar</button>
      <button role="tab" aria-selected="${reg}" data-auth="reg">Crear cuenta</button></div>
    <form id="authf" novalidate>
      ${reg ? `<label for="fn">Nombres y apellidos</label><input id="fn" required autocomplete="name">
      <div class="row2"><div><label for="dni">DNI</label><input id="dni" inputmode="numeric" maxlength="8" required></div>
      <div><label for="ph">Celular</label><input id="ph" inputmode="tel" maxlength="9" required autocomplete="tel"></div></div>` : ''}
      <label for="em">Correo electrónico</label><input id="em" type="email" required autocomplete="email">
      <label for="pw">Contraseña</label>${pwField('pw', `required minlength="6" autocomplete="${reg ? 'new-password' : 'current-password'}"`)}
      ${reg ? `<label style="display:flex;gap:10px;align-items:flex-start;font-weight:400"><input id="tc" type="checkbox" style="width:22px;min-height:22px;margin-top:2px"> Acepto el tratamiento de mis datos personales (Ley 29733) para evaluar mi solicitud.</label>` : ''}
      <p class="err" id="aerr"></p>
      <button class="btn block" id="asub">${reg ? 'Crear mi cuenta' : 'Ingresar'}</button>
      ${!reg && !DEMO ? `<p style="text-align:center;margin:14px 0 0"><a href="#" data-act="forgot">¿Olvidaste tu contraseña?</a></p>` : ''}
    </form></div>
    ${isStandalone() ? '' : `<div class="card"><h3>Lleva la app en tu celular</h3><p class="hint">Instálala gratis y entra con un toque desde tu pantalla de inicio.</p>
      <div class="actions"><button class="btn ghost" data-act="install">Instalar la app</button></div></div>`}
    ${DEMO ? `<div class="card"><h3>Probar la demo</h3><p class="hint">Entra con un toque como cada tipo de usuario:</p>
      <div class="actions"><button class="btn ghost" data-demo="admin@agentemovil.pe|admin123">Administrador</button>
      <button class="btn ghost" data-demo="maria@ejemplo.pe|cliente123">Cliente (María)</button>
      <button class="btn ghost" data-demo="jose@ejemplo.pe|cliente123">Cliente (José)</button></div></div>` : ''}
  </div>`;
  $('#authf').addEventListener('submit', async e => {
    e.preventDefault(); const err = $('#aerr'); err.textContent = '';
    const email = $('#em').value.trim(), password = $('#pw').value;
    try {
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Escribe un correo válido.');
      if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
      $('#asub').disabled = true;
      let me;
      if (reg) {
        const full_name = $('#fn').value.trim(), dni = $('#dni').value.trim(), phone = $('#ph').value.trim();
        if (full_name.length < 5) throw new Error('Escribe tus nombres y apellidos.');
        if (!/^\d{8}$/.test(dni)) throw new Error('El DNI debe tener 8 dígitos.');
        if (!/^9\d{8}$/.test(phone)) throw new Error('El celular debe tener 9 dígitos y empezar con 9.');
        if (!$('#tc').checked) throw new Error('Debes aceptar el tratamiento de datos.');
        me = await api.signUp({ email, password, full_name, dni, phone });
        if (me && me.needsConfirm) { S.authTab = 'login'; renderAuth(); toast('Te enviamos un correo para confirmar tu cuenta.'); return; }
      } else me = await api.signIn(email, password);
      await enter(me, true);
    } catch (x) { err.textContent = x.message; $('#asub').disabled = false; }
  });
}

async function enter(me, viaPassword = false) {
  S.me = me; S.tab = 'pendientes';
  const pin = api.getPin();
  if (!pin || (viaPassword && store.get('amp_pin_reset'))) { if (!(await pinScreen('create'))) return; }
  else if (!viaPassword && idleTooLong()) { if (!(await pinScreen('unlock'))) return; }
  touch();
  await refresh(); subscribe(); askOsPermission();
}

function header(sub) {
  const unread = S.notes.filter(n => !n.read).length;
  return `${demoBar()}<header class="top"><div class="row">
    <div class="brand">${logo}</div>
    <div style="display:flex;gap:8px"><button class="iconbtn" data-act="reload" aria-label="Actualizar">${loopI}</button><button class="iconbtn" data-act="notes" aria-label="Notificaciones">${bell}${unread ? `<span class="badge">${unread}</span>` : ''}</button>
    <button class="iconbtn" data-act="logout" aria-label="Cerrar sesión">${exitI}</button></div></div>
    <div class="hello"><h1>Hola, ${esc((S.me.full_name || S.me.email).split(' ')[0])}</h1><p>${sub}</p></div></header>`;
}

/* ---------- Piezas compartidas ---------- */
const RATE = +C.TASA_DIARIA || 0.3;
const MAXD = +C.PLAZO_MAX || 14;
const rateTxt = r => (+r).toFixed(2).replace(/0$/, '') + '% diario';

function accountsCard() {
  const cs = C.CUENTAS || [];
  if (!cs.length) return '';
  return `<div class="card"><h2>Cuentas para pagar</h2><p class="hint">Deposita a cualquiera de estas cuentas y envíanos tu constancia por WhatsApp.</p>
    <ul class="list" style="margin-top:6px">${cs.map(c => `<li class="item" style="cursor:default">
      <div><div class="who">${esc(c.banco)}</div><div class="sub">${esc(c.etiqueta)}: <b class="acc">${esc(c.numero)}</b></div><div class="sub">${esc(c.titular)}</div></div>
      <button class="btn ghost small" data-copy="${esc(c.numero)}">Copiar</button></li>`).join('')}</ul></div>`;
}
function totalsHTML(loans, withDebt) {
  const t = totalsOf(loans);
  return `<div class="grid2"><div class="kv"><div class="k">Total prestado</div><div class="v">${money(t.lent)}</div></div>
    <div class="kv"><div class="k">Intereses pagados</div><div class="v">${money(t.interest)}</div></div>
    <div class="kv"><div class="k">Créditos autorizados</div><div class="v">${t.n}</div></div>
    ${withDebt ? `<div class="kv"><div class="k">Debe hoy</div><div class="v">${money(t.debt)}</div></div>` : ''}</div>`;
}
/* Formulario "¿a dónde depositamos?" */
function depositHTML(d, optional) {
  const m = d.deposit_method === 'cuenta' ? 'cuenta' : 'yape';
  return `<label>¿A dónde depositamos el préstamo?${optional ? ' <span class="hint">(opcional)</span>' : ''}</label>
    <div class="seg" id="dm" data-m="${m}"><button type="button" data-m="yape" aria-selected="${m === 'yape'}">Yape</button>
      <button type="button" data-m="cuenta" aria-selected="${m === 'cuenta'}">Cuenta bancaria</button></div>
    <div id="dbankw" ${m === 'yape' ? 'hidden' : ''}><label for="dbank">Nombre del banco</label><input id="dbank" maxlength="40" placeholder="BCP, BBVA, Interbank…" value="${esc(d.deposit_bank || '')}"></div>
    <label for="dnum" id="dnuml">${m === 'yape' ? 'Número de celular con Yape' : 'Número de cuenta'}</label>
    <input id="dnum" inputmode="numeric" maxlength="24" value="${esc(d.deposit_number || '')}">
    <label for="dhold" id="dholdl">${m === 'yape' ? 'Nombre completo del titular del Yape' : 'Nombre del titular de la cuenta'}</label>
    <input id="dhold" maxlength="80" value="${esc(d.deposit_holder || '')}">`;
}
function depositBind(bg) {
  $('#dm', bg).onclick = e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const m = b.dataset.m; $('#dm', bg).dataset.m = m;
    bg.querySelectorAll('#dm button').forEach(x => x.setAttribute('aria-selected', x === b));
    $('#dbankw', bg).hidden = m === 'yape';
    $('#dnuml', bg).textContent = m === 'yape' ? 'Número de celular con Yape' : 'Número de cuenta';
    $('#dholdl', bg).textContent = m === 'yape' ? 'Nombre completo del titular del Yape' : 'Nombre del titular de la cuenta';
  };
}
function depositRead(bg, optional) {
  const m = $('#dm', bg).dataset.m, num = $('#dnum', bg).value.replace(/[\s-]/g, ''), hold = $('#dhold', bg).value.trim(), bank = $('#dbank', bg).value.trim();
  if (optional && !num && !hold && !bank) return {};
  if (m === 'yape') { if (!/^9\d{8}$/.test(num)) throw new Error('El número de Yape debe tener 9 dígitos y empezar con 9.'); }
  else {
    if (bank.length < 2) throw new Error('Escribe el nombre del banco.');
    if (!/^\d{8,20}$/.test(num)) throw new Error('El número de cuenta debe tener entre 8 y 20 dígitos.');
  }
  if (hold.length < 5) throw new Error('Escribe el nombre completo del titular.');
  return { deposit_method: m, deposit_number: num, deposit_bank: m === 'yape' ? null : bank, deposit_holder: hold };
}
const depositLine = l => l.deposit_method ? `<div class="line"><span>Depositar a</span><b style="white-space:normal;text-align:right">${esc(depositText(l))}</b></div>` : '';

/* =================================================================
   PANTALLA: CLIENTE
   ================================================================= */
function voucher(l) {
  const paid = paidOf(l), debt = debtOf(l), el = elapsedOf(l), left = daysBetween(todayISO(), l.due_date), over = isOverdue(l);
  return `<section class="voucher" aria-label="Crédito activo">
    <span class="stamp" ${over ? 'style="border-color:var(--bad);color:var(--bad)"' : ''}>${over ? 'VENCIDO' : 'DEPOSITADO'}</span>
    <div class="hint">Tu deuda al día de hoy</div><div class="big num">${money(debt)}</div>
    <div class="hint">${over ? `Venció el ${fdate(l.due_date)}, hace ${-left} día${left === -1 ? '' : 's'}. El interés sigue sumando cada día.`
      : `Día ${el} de ${l.term_days} · vence el ${fdate(l.due_date)}${left > 0 ? ` (faltan ${left} día${left === 1 ? '' : 's'})` : ' (hoy)'}`}</div>
    <div class="bar" aria-hidden="true"><i style="width:${Math.min(100, el / l.term_days * 100)}%;${over ? 'background:var(--bad)' : ''}"></i></div>
    <div class="grid2"><div class="kv"><div class="k">Monto depositado</div><div class="v">${money(l.approved_amount)}</div></div>
    <div class="kv"><div class="k">Interés acumulado</div><div class="v">${money(accruedOf(l))}</div></div>
    <div class="kv"><div class="k">Interés ${rateTxt(l.daily_rate)}</div><div class="v">+ ${money(perDayOf(l))} por día</div></div>
    <div class="kv"><div class="k">Ya pagaste</div><div class="v">${money(paid)}</div></div></div>
    ${over ? '' : `<p class="hint" style="margin-top:14px">Si pagas el ${fdate(l.due_date)}, el total será <b>${money(debtOf(l, l.due_date))}</b>.</p>`}
    <div class="actions"><button class="btn ghost" data-loan="${l.id}">Ver detalle</button>
    <a class="btn" href="${wa(C.WHATSAPP, `Hola, soy ${S.me.full_name}. Quiero coordinar el pago de mi crédito #${l.id}. Mi deuda hoy es ${money(debt)}.`)}" target="_blank" rel="noopener">Coordinar pago</a></div></section>`;
}
function pendingCard(l) {
  return `<section class="voucher"><span class="stamp" style="border-color:var(--bd);color:var(--bd)">EN REVISIÓN</span>
    <div class="hint">Solicitaste</div><div class="big num">${money(l.requested_amount)}</div>
    <div class="hint">a ${l.requested_days} día${l.requested_days === 1 ? '' : 's'} · enviado ${fwhen(l.created_at)}</div>
    ${l.deposit_method ? `<p class="hint" style="margin-top:8px">Depósito a: ${esc(depositText(l))}</p>` : ''}
    <p style="margin:12px 0 0">Estamos revisando tu solicitud. Te avisaremos aquí cuando sea aprobada y depositada.</p>
    <div class="actions"><button class="btn ghost" data-del="${l.id}">Eliminar solicitud</button></div></section>`;
}
function renderClient() {
  const actives = S.loans.filter(l => l.status === 'depositado'), pend = S.loans.filter(l => l.status === 'pendiente');
  const empty = !actives.length && !pend.length;
  app.innerHTML = header(actives.length ? (actives.length > 1 ? 'Estos son tus créditos activos.' : 'Este es tu crédito activo.') : pend.length ? 'Tu solicitud está en revisión.' : 'Bienvenido a tu cuenta.') +
  `<main class="wrap">${actives.map(voucher).join('<div style="height:20px"></div>')}${actives.length && pend.length ? '<div style="height:20px"></div>' : ''}${pend.map(pendingCard).join('<div style="height:20px"></div>')}
    ${empty ? `<section class="voucher"><div class="hint">¿Necesitas efectivo?</div><div class="big num" style="font-size:34px;white-space:normal">Pide tu crédito en 1 minuto</div>
      <p style="margin:10px 0 0">Desde ${money(C.MONTO_MIN)} hasta ${money(C.MONTO_MAX)}, de 1 a ${MAXD} días. Interés ${rateTxt(RATE)}.</p>
      <div class="actions"><button class="btn block" data-act="request">Solicitar crédito</button></div></section>`
    : `<div class="card"><button class="btn block" data-act="request">Solicitar ${actives.length || pend.length ? 'otro ' : ''}crédito</button></div>`}
    ${accountsCard()}
    <div class="card"><h2>Mi historial</h2>${totalsHTML(S.loans)}
      ${S.loans.length ? `<ul class="list" style="margin-top:14px">${S.loans.map(l => `<li class="item" data-loan="${l.id}" tabindex="0">
        <div><div class="who">Crédito #${l.id}</div><div class="sub">${fdate(l.start_date || l.created_at)} · ${l.term_days || l.requested_days} días</div></div>
        <div style="text-align:right"><div class="amt">${money(l.approved_amount || l.requested_amount)}</div>${statusChip(l)}</div></li>`).join('')}</ul>`
      : `<p class="empty">Aún no tienes créditos.</p>`}</div>
    <p style="text-align:center;margin:20px 0 0"><a href="#" data-act="pinchange">Cambiar mi clave de internet</a></p></main>`;
}

function openRequest() {
  let amount = Math.min(C.MONTO_MAX, Math.max(C.MONTO_MIN, 500)), days = Math.min(7, MAXD);
  const last = S.loans.find(l => l.deposit_method) || { deposit_method: 'yape', deposit_number: S.me.phone, deposit_holder: S.me.full_name };
  sheet(`<div class="head"><h2>Solicitar crédito</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
    <form id="reqf" novalidate>
    <label for="amt">¿Cuánto necesitas?</label>
    <div class="amtbig num" id="amtv">${money(amount)}</div>
    <input class="range" id="amtr" type="range" min="${C.MONTO_MIN}" max="${C.MONTO_MAX}" step="50" value="${amount}" aria-label="Monto">
    <input id="amt" type="number" inputmode="decimal" min="${C.MONTO_MIN}" max="${C.MONTO_MAX}" step="any" value="${amount}" style="margin-top:10px">
    <label for="dd">¿Por cuántos días lo necesitas? <span class="hint">(máximo ${MAXD})</span></label>
    <input class="range" id="ddr" type="range" min="1" max="${MAXD}" step="1" value="${days}" aria-label="Días">
    <input id="dd" type="number" inputmode="numeric" min="1" max="${MAXD}" step="1" value="${days}" style="margin-top:10px">
    ${depositHTML(last)}
    <label for="pur">¿Para qué lo usarás? <span class="hint">(opcional)</span></label>
    <input id="pur" maxlength="120" placeholder="Ej. mercadería, estudios, emergencia">
    <div class="calc" id="est"></div>
    <p class="err" id="rerr"></p>
    <button class="btn block" id="rsub">Enviar solicitud</button></form>`, bg => {
    depositBind(bg);
    const upd = () => {
      $('#amtv', bg).textContent = money(amount);
      const d = Math.min(MAXD, Math.max(1, Math.round(days) || 1)), c = calc(amount, RATE, d);
      $('#est', bg).innerHTML = `<div class="line"><span>Interés</span><b>${rateTxt(RATE)}</b></div>
        <div class="line"><span>Interés por cada día</span><b>${money(c.perDay)}</b></div>
        <div class="line total"><span>Si pagas a los ${d} día${d === 1 ? '' : 's'}</span><b>${money(c.total)}</b></div>
        <p class="hint">Pagas solo por los días que uses el dinero. El monto final te lo confirmamos al aprobar.</p>`;
    };
    $('#amtr', bg).oninput = e => { amount = +e.target.value; $('#amt', bg).value = amount; upd(); };
    $('#amt', bg).oninput = e => { amount = +e.target.value || 0; $('#amtr', bg).value = amount; upd(); };
    $('#ddr', bg).oninput = e => { days = +e.target.value; $('#dd', bg).value = days; upd(); };
    $('#dd', bg).oninput = e => { days = +e.target.value || 0; $('#ddr', bg).value = days; upd(); };
    upd();
    $('#reqf', bg).onsubmit = async e => {
      e.preventDefault(); const err = $('#rerr', bg); err.textContent = '';
      try {
        if (amount < C.MONTO_MIN || amount > C.MONTO_MAX) throw new Error(`El monto debe estar entre ${money(C.MONTO_MIN)} y ${money(C.MONTO_MAX)}.`);
        if (!Number.isInteger(days) || days < 1 || days > MAXD) throw new Error(`El plazo debe ser de 1 a ${MAXD} días.`);
        const dep = depositRead(bg);
        $('#rsub', bg).disabled = true;
        await api.createLoan({ requested_amount: r2(amount), requested_days: days, purpose: $('#pur', bg).value.trim() || null, ...dep });
        closeSheet(); await refresh(); toast('Solicitud enviada. Te avisaremos aquí.');
      } catch (x) { err.textContent = x.message; $('#rsub', bg).disabled = false; }
    };
  });
}

/* =================================================================
   PANTALLA: ADMINISTRADOR
   ================================================================= */
function people() {
  const reg = S.clients.map(c => ({ ...c, key: c.id, loans: S.loans.filter(l => l.client_id === c.id) }));
  const ext = {};
  S.loans.filter(l => !l.client_id).forEach(l => {
    const k = 'x:' + (l.ext_dni || l.ext_name);
    if (!ext[k]) ext[k] = { key: k, full_name: l.ext_name, dni: l.ext_dni, phone: l.ext_phone, email: '', external: true, loans: [] };
    ext[k].loans.push(l);
  });
  return [...reg, ...Object.values(ext)];
}
const extTag = p => p && p.external ? ' <span class="status s-pagado">Externo</span>' : '';

function renderAdmin() {
  const pend = S.loans.filter(l => l.status === 'pendiente');
  const act = S.loans.filter(l => l.status === 'depositado');
  const hist = S.loans.filter(l => l.status === 'pagado' || l.status === 'rechazado');
  const t = totalsOf(S.loans), capital = act.reduce((s, l) => s + +l.approved_amount, 0), venc = act.filter(isOverdue).length, ppl = people();
  const tabs = [['pendientes', `Solicitudes (${pend.length})`], ['activos', `Activos (${act.length})`], ['historial', 'Historial'], ['clientes', `Clientes (${ppl.length})`]];
  const row = l => `<li class="item" data-loan="${l.id}" tabindex="0">
    <div><div class="who">${esc(l.client.full_name || l.client.email)}${extTag(l.client)}</div>
    <div class="sub">#${l.id} · ${l.status === 'pendiente' ? `DNI ${esc(l.client.dni || '—')} · cel. ${esc(l.client.phone || '—')} · pidió ${l.requested_days} días` :
      l.status === 'depositado' ? `vence ${fdate(l.due_date)} · debe hoy ${money(debtOf(l))}` : fdate(l.paid_at || l.decided_at || l.created_at)}</div></div>
    <div style="text-align:right"><div class="amt">${money(l.approved_amount || l.requested_amount)}</div>${statusChip(l)}</div></li>`;
  let body;
  if (S.tab === 'clientes') body = ppl.length ? `<ul class="list">${ppl.map(p => { const pt = totalsOf(p.loans);
      return `<li class="item" data-person="${esc(p.key)}" tabindex="0"><div><div class="who">${esc(p.full_name || p.email)}${extTag(p)}</div>
      <div class="sub">DNI ${esc(p.dni || '—')} · cel. ${esc(p.phone || '—')}</div></div>
      <div style="text-align:right"><div class="amt">${money(pt.lent)}</div><div class="sub">${pt.n} crédito${pt.n === 1 ? '' : 's'} · intereses ${money(pt.interest)}</div></div></li>`; }).join('')}</ul>`
    : `<p class="empty">Todavía no hay clientes registrados.</p>`;
  else {
    const list = { pendientes: pend, activos: act.slice().sort((a, b) => a.due_date.localeCompare(b.due_date)), historial: hist }[S.tab];
    body = list.length ? `<ul class="list">${list.map(row).join('')}</ul>` :
      `<p class="empty">${{ pendientes: 'No hay solicitudes nuevas. Te avisaremos cuando llegue una.', activos: 'No hay créditos activos.', historial: 'Sin historial todavía.' }[S.tab]}</p>`;
  }
  app.innerHTML = header(pend.length ? `Tienes ${pend.length} solicitud${pend.length > 1 ? 'es' : ''} por revisar.` : 'Panel de administración.') +
  `<main class="wrap wide">
    <div class="stats" style="margin-top:14px">
      <div class="stat"><div class="k">Capital prestado (activos)</div><div class="v">${money(capital)}</div></div>
      <div class="stat"><div class="k">Por cobrar hoy</div><div class="v">${money(t.debt)}</div></div>
      <div class="stat"><div class="k">Intereses cobrados</div><div class="v">${money(t.interest)}</div></div>
      <div class="stat"><div class="k">Vencidos</div><div class="v" style="color:${venc ? 'var(--bad)' : 'inherit'}">${venc}</div></div></div>
    <div class="card"><button class="btn block" data-act="external">Registrar solicitud externa</button>
      <p class="hint" style="text-align:center">Para personas que te pidieron un préstamo por WhatsApp, llamada o en persona.</p></div>
    <div class="tabs" role="tablist">${tabs.map(([k, x]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${x}</button>`).join('')}</div>
    <div class="card" style="margin-top:8px">${body}</div>
    <p style="text-align:center;margin:20px 0 0"><a href="#" data-act="pinchange">Cambiar mi clave de internet</a></p></main>`;
}

function openExternal() {
  sheet(`<div class="head"><h2>Solicitud externa</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
    <p class="hint">Registra a una persona que te pidió el préstamo fuera de la app.</p>
    <form id="exf" novalidate>
    <label for="xn">Nombres y apellidos</label><input id="xn" maxlength="80">
    <div class="row2"><div><label for="xd">DNI</label><input id="xd" inputmode="numeric" maxlength="8"></div>
    <div><label for="xp">Celular</label><input id="xp" inputmode="tel" maxlength="9"></div></div>
    <div class="row2"><div><label for="xa">Monto (S/)</label><input id="xa" type="number" inputmode="decimal" step="any" min="1"></div>
    <div><label for="xdd">Días</label><input id="xdd" type="number" inputmode="numeric" min="1" max="365" value="${Math.min(7, MAXD)}"></div></div>
    ${depositHTML({}, true)}
    <p class="err" id="xerr"></p><button class="btn block" id="xsub">Guardar y evaluar</button></form>`, bg => {
    depositBind(bg);
    $('#exf', bg).onsubmit = async e => {
      e.preventDefault(); const err = $('#xerr', bg); err.textContent = '';
      try {
        const name = $('#xn', bg).value.trim(), dni = $('#xd', bg).value.trim(), phone = $('#xp', bg).value.trim(), amount = r2(+$('#xa', bg).value), days = +$('#xdd', bg).value;
        if (name.length < 5) throw new Error('Escribe los nombres y apellidos.');
        if (!/^\d{8}$/.test(dni)) throw new Error('El DNI debe tener 8 dígitos.');
        if (!/^9\d{8}$/.test(phone)) throw new Error('El celular debe tener 9 dígitos y empezar con 9.');
        if (!(amount > 0)) throw new Error('Escribe el monto.');
        if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Revisa el número de días.');
        const dep = depositRead(bg, true);
        $('#xsub', bg).disabled = true;
        const id = await api.createLoan({ client_id: null, ext_name: name, ext_dni: dni, ext_phone: phone, requested_amount: amount, requested_days: days, purpose: 'Solicitud externa', ...dep });
        closeSheet(); S.tab = 'pendientes'; await refresh();
        const l = S.loans.find(x => x.id === id) || S.loans.find(x => !x.client_id && x.status === 'pendiente' && x.ext_dni === dni);
        if (l) openEvaluate(l); else toast('Solicitud registrada.');
      } catch (x) { err.textContent = x.message; $('#xsub', bg).disabled = false; }
    };
  });
}

function openPerson(p) {
  const t = totalsOf(p.loans);
  sheet(`<div class="head"><h2>${esc(p.full_name || p.email)}</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
    <p class="hint">DNI ${esc(p.dni || '—')} · cel. ${esc(p.phone || '—')}${p.email ? ' · ' + esc(p.email) : ''}${p.external ? ' · registrado por ti (externo)' : ''}</p>
    ${p.phone ? `<a class="btn ghost small" target="_blank" rel="noopener" href="${wa(p.phone, 'Hola ' + (p.full_name || '') + ', te escribimos de ' + C.EMPRESA + '.')}">Escribir por WhatsApp</a>` : ''}
    <div class="card">${totalsHTML(p.loans, true)}</div>
    <h3 style="margin-top:18px">Historial de préstamos</h3>
    ${p.loans.length ? `<ul class="list">${p.loans.map(l => `<li class="item" data-loan="${l.id}" tabindex="0">
      <div><div class="who">Crédito #${l.id}</div><div class="sub">${fdate(l.start_date || l.created_at)} · ${l.term_days || l.requested_days} días${l.status === 'pagado' ? ` · interés ${money(l.total_interest)}` : l.status === 'depositado' ? ` · debe hoy ${money(debtOf(l))}` : ''}</div></div>
      <div style="text-align:right"><div class="amt">${money(l.approved_amount || l.requested_amount)}</div>${statusChip(l)}</div></li>`).join('')}</ul>`
    : '<p class="empty">Aún no tiene préstamos.</p>'}`);
}

function openEvaluate(l) {
  const p = l.client;
  let rate = RATE;
  sheet(`<div class="head"><h2>Evaluar solicitud #${l.id}</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
    <div class="card" style="margin-top:8px"><div class="who" style="font-weight:600">${esc(p.full_name)}${extTag(p)}</div>
      <div class="calc" style="margin-top:10px"><div class="line"><span>DNI</span><b>${esc(p.dni || '—')}</b></div>
        <div class="line"><span>Celular</span><b>${esc(p.phone || '—')}</b></div>
        ${p.email ? `<div class="line"><span>Correo</span><b style="white-space:normal;overflow-wrap:anywhere">${esc(p.email)}</b></div>` : ''}
        ${depositLine(l)}</div>
      <p style="margin:10px 0 0">Pidió <b>${money(l.requested_amount)}</b> por <b>${l.requested_days} día${l.requested_days === 1 ? '' : 's'}</b>${l.purpose ? ` · “${esc(l.purpose)}”` : ''}</p>
      <div class="actions" style="margin-top:10px">${l.deposit_number ? `<button type="button" class="btn ghost small" data-copy="${esc(l.deposit_number)}">Copiar ${l.deposit_method === 'yape' ? 'número de Yape' : 'número de cuenta'}</button>` : ''}
      ${p.phone ? `<a class="btn ghost small" target="_blank" rel="noopener" href="${wa(p.phone, `Hola ${p.full_name}, recibimos tu solicitud de ${money(l.requested_amount)} en ${C.EMPRESA}.`)}">WhatsApp</a>` : ''}</div></div>
    <form id="evf" novalidate>
    <div class="row2"><div><label for="am">Monto a prestar (S/)</label><input id="am" type="number" inputmode="decimal" step="any" min="1" value="${l.requested_amount}"></div>
    <div><label for="dd">Plazo (días)</label><input id="dd" type="number" inputmode="numeric" min="1" max="365" value="${l.requested_days}"></div></div>
    <label for="rc">Interés diario (%)</label><input id="rc" type="number" step="any" min="0" max="5" value="${rate}">
    <label for="sd">Fecha de depósito</label><input id="sd" type="date" value="${todayISO()}">
    <label for="nt">Nota para el cliente <span class="hint">(opcional)</span></label><input id="nt" maxlength="200" placeholder="Ej. Depositado a tu Yape">
    <div class="calc" id="cc"></div>
    <p class="err" id="everr"></p>
    <div class="actions"><button type="button" class="btn ghost" id="rej">Rechazar</button>
    <button class="btn ok" id="apr">Confirmar aprobación y depósito</button></div></form>`, bg => {
    const v = () => ({ amount: +$('#am', bg).value || 0, days: Math.round(+$('#dd', bg).value) || 0, start: $('#sd', bg).value || todayISO() });
    const upd = () => {
      rate = +$('#rc', bg).value || 0;
      const { amount, days, start } = v(), c = calc(amount, rate, days);
      $('#cc', bg).innerHTML = `<div class="line"><span>Capital</span><b>${money(amount)}</b></div>
        <div class="line"><span>Interés por día (${rate}%)</span><b>${money(c.perDay)}</b></div>
        <div class="line"><span>Interés en ${days} días</span><b>${money(c.interest)}</b></div>
        <div class="line"><span>Vence el</span><b>${fdate(addDays(start, days))}</b></div>
        <div class="line total"><span>Total si paga al vencimiento</span><b>${money(c.total)}</b></div>`;
    };
    ['am', 'dd', 'sd', 'rc'].forEach(id => $('#' + id, bg).oninput = upd); upd();
    $('#evf', bg).onsubmit = async e => {
      e.preventDefault(); const { amount, days, start } = v(), err = $('#everr', bg);
      if (amount <= 0 || days <= 0 || rate <= 0) { err.textContent = 'Revisa el monto, el plazo y el interés.'; return; }
      const c = calc(amount, rate, days); $('#apr', bg).disabled = true;
      try {
        await api.updateLoan(l.id, { status: 'depositado', approved_amount: r2(amount), daily_rate: rate, term_days: days, total_interest: c.interest,
          total_to_pay: c.total, start_date: start, due_date: addDays(start, days), admin_note: $('#nt', bg).value.trim() || null, decided_at: new Date().toISOString() });
        closeSheet(); await refresh(); toast(l.client_id ? 'Crédito aprobado. El cliente ya fue notificado.' : 'Crédito registrado como depositado.');
      } catch (x) { err.textContent = x.message; $('#apr', bg).disabled = false; }
    };
    $('#rej', bg).onclick = () => {
      const b = $('#rej', bg);
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '¿Seguro? Toca otra vez'; return; }
      api.updateLoan(l.id, { status: 'rechazado', admin_note: $('#nt', bg).value.trim() || null, decided_at: new Date().toISOString() })
        .then(() => { closeSheet(); return refresh(); }).then(() => toast('Solicitud rechazada.')).catch(x => $('#everr', bg).textContent = x.message);
    };
  });
}

function openLoan(l) {
  const admin = S.me.role === 'admin', p = l.client;
  if (admin && l.status === 'pendiente') return openEvaluate(l);
  const paid = paidOf(l), debt = debtOf(l), acc = accruedOf(l);
  const pays = (l.payments || []).slice().sort((a, b) => (a.paid_on || '').localeCompare(b.paid_on || ''));
  const paysHTML = `<h3 style="margin-top:18px">Pagos</h3>
    ${pays.length ? `<table><tbody>${pays.map(x => `<tr><td>${fdate(x.paid_on)}</td><td>${esc(x.note || '')}</td><td class="r">${money(x.amount)}</td></tr>`).join('')}</tbody></table>` : `<p class="hint">Aún no hay pagos registrados.</p>`}`;
  let body;
  if (l.status === 'pendiente') body = `<div class="calc"><div class="line"><span>Solicitado</span><b>${money(l.requested_amount)}</b></div>
      <div class="line"><span>Plazo pedido</span><b>${l.requested_days} días</b></div>${depositLine(l)}<p class="hint">Estamos revisando tu solicitud.</p></div>
      <div class="actions"><button class="btn ghost" data-del="${l.id}">Eliminar solicitud</button></div>`;
  else if (l.status === 'rechazado') body = `<div class="alert bad">${esc(l.admin_note || 'La solicitud no fue aprobada.')}</div>`;
  else if (l.status === 'pagado') body = `<div class="calc"><div class="line"><span>Depositado el</span><b>${fdate(l.start_date)}</b></div>
      <div class="line"><span>Monto prestado</span><b>${money(l.approved_amount)}</b></div>
      <div class="line"><span>Interés pagado (${rateTxt(l.daily_rate)})</span><b>${money(l.total_interest)}</b></div>
      <div class="line total"><span>Total pagado</span><b>${money(paid)}</b></div>
      <div class="line"><span>Cancelado el</span><b>${fdate(l.paid_at)}</b></div></div>${paysHTML}`;
  else body = `<div class="calc"><div class="line"><span>Depositado el</span><b>${fdate(l.start_date)}</b></div>
      <div class="line"><span>Monto prestado</span><b>${money(l.approved_amount)}</b></div>${admin ? depositLine(l) : ''}
      <div class="line"><span>Interés</span><b>${rateTxt(l.daily_rate)} (${money(perDayOf(l))} por día)</b></div>
      <div class="line"><span>Días transcurridos</span><b>${elapsedOf(l)} de ${l.term_days}</b></div>
      <div class="line"><span>Interés acumulado</span><b>${money(acc)}</b></div>
      <div class="line"><span>Pagado</span><b>${money(paid)}</b></div>
      <div class="line total"><span>Deuda al día de hoy</span><b style="color:var(--red-ink)">${money(debt)}</b></div>
      <div class="line"><span>Vence el</span><b>${fdate(l.due_date)}</b></div>
      ${isOverdue(l) ? '' : `<div class="line"><span>Si paga al vencimiento</span><b>${money(debtOf(l, l.due_date))}</b></div>`}</div>
      ${l.admin_note ? `<p class="hint">Nota: ${esc(l.admin_note)}</p>` : ''}${paysHTML}
      ${admin ? `<form id="payf" class="card" novalidate><h3>Registrar pago</h3>
        <div class="row2"><div><label for="pa">Monto (S/)</label><input id="pa" type="number" inputmode="decimal" step="any" min="0.01" value="${debt.toFixed(2)}"></div>
        <div><label for="pd">Fecha</label><input id="pd" type="date" value="${todayISO()}"></div></div>
        <label for="pn">Medio / nota</label><input id="pn" placeholder="Yape, Plin, efectivo…" maxlength="80">
        <p class="err" id="perr"></p><button class="btn block">Guardar pago</button></form>
        <div class="actions">${p.phone ? `<a class="btn ghost" target="_blank" rel="noopener" href="${wa(p.phone, `Hola ${p.full_name}, te recordamos que tu crédito #${l.id} vence el ${fdate(l.due_date)}. Tu deuda al día de hoy es ${money(debt)}.`)}">Recordar por WhatsApp</a>` : ''}
        <button class="btn ghost" id="mpaid">Marcar como pagado</button></div>` : ''}`;
  sheet(`<div class="head"><h2>Crédito #${l.id}</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
    ${statusChip(l)} ${admin ? `<span class="hint">· ${esc(p.full_name)} · DNI ${esc(p.dni || '—')} · cel. ${esc(p.phone || '—')}</span>` : ''}${body}`, bg => {
    const close = async (on, paidTotal) => {
      const interest = r2(Math.min(paidTotal, accruedOf(l, on)));
      await api.updateLoan(l.id, { status: 'pagado', total_interest: interest, total_to_pay: r2(+l.approved_amount + interest), paid_at: new Date(on + 'T12:00:00').toISOString() });
    };
    const f = $('#payf', bg);
    if (f) f.onsubmit = async e => {
      e.preventDefault(); const a = r2(+$('#pa', bg).value), on = $('#pd', bg).value || todayISO();
      if (!(a > 0)) { $('#perr', bg).textContent = 'Escribe un monto válido.'; return; }
      try {
        const full = a >= debtOf(l, on) - 0.004;
        await api.addPayment(l.id, a, $('#pn', bg).value.trim() || null, on);
        if (full) await close(on, paid + a);
        closeSheet(); await refresh(); toast(full ? 'Pago registrado. Crédito cancelado.' : 'Pago registrado.');
      } catch (x) { $('#perr', bg).textContent = x.message; }
    };
    const mp = $('#mpaid', bg);
    if (mp) mp.onclick = async () => {
      if (mp.dataset.sure !== '1') { mp.dataset.sure = '1'; mp.textContent = debt > 0 ? `Aún debe ${money(debt)}. ¿Confirmar?` : '¿Confirmar?'; return; }
      try { await close(todayISO(), paid); closeSheet(); await refresh(); toast('Crédito marcado como pagado.'); } catch (x) { toast(x.message); }
    };
  });
}

function openNotes() {
  sheet(`<div class="head"><h2>Notificaciones</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
    ${S.notes.length ? S.notes.map(n => `<div class="notif ${n.read ? '' : 'unread'}" ${n.loan_id ? `data-loan="${n.loan_id}" style="cursor:pointer"` : ''}>
      <div class="t">${esc(n.title)}</div><div>${esc(n.body || '')}</div><div class="d">${fwhen(n.created_at)}</div></div>`).join('') : '<p class="empty">No tienes notificaciones.</p>'}
    ${'Notification' in window && Notification.permission === 'default' ? `<button class="btn ghost block" style="margin-top:14px" data-act="perm">Activar avisos en este dispositivo</button>` : ''}`);
  if (S.notes.some(n => !n.read)) api.markAllRead().then(() => { S.notes.forEach(n => n.read = true); const b = $('.top .badge'); b && b.remove(); }).catch(() => {});
}

/* ---------- Clave de internet (6 dígitos) ---------- */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
};
async function hashPin(pin, salt) {
  const txt = salt + ':' + pin;
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { let h = 5381; for (const c of txt) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return 'x' + h.toString(16); }
}
let locked = false, hiddenAt = 0;
const LOCK_MS = 5 * 60 * 1000;   // pedir la clave tras 5 minutos sin usar la app
function touch() { store.set('amp_last_active', Date.now()); }
function idleTooLong() { return Date.now() - (+store.get('amp_last_active') || 0) > LOCK_MS; }
setInterval(() => { if (S.me && !locked && !document.hidden) touch(); }, 15000);
const MAX_FAILS = 5;
function pinScreen(mode, cancellable = false) {
  return new Promise(resolve => {
    locked = true; closeSheet(); $('#pinov')?.remove();
    let buf = '', first = null, busy = false;
    const ov = document.createElement('div'); ov.className = 'pin'; ov.id = 'pinov';
    ov.innerHTML = `<div class="pinbox" role="dialog" aria-modal="true" aria-labelledby="pint">${logo}<h2 id="pint"></h2><p id="pins"></p>
      <div class="dots" id="pind"></div><p class="err" id="pine" role="alert"></p>
      <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-k="${n}">${n}</button>`).join('')}<span></span>
        <button type="button" data-k="0">0</button><button type="button" data-k="del" aria-label="Borrar">⌫</button></div>
      <div class="pinlinks">${mode === 'unlock' ? '<button type="button" data-p="forgot">Olvidé mi clave</button>'
        : cancellable ? '<button type="button" data-p="cancel">Cancelar</button>' : '<button type="button" data-p="exit">Salir</button>'}</div></div>`;
    const err = m => $('#pine', ov).textContent = m;
    const paint = () => {
      $('#pint', ov).textContent = mode === 'unlock' ? 'Hola, ' + (S.me.full_name || S.me.email).split(' ')[0] : first === null ? 'Crea tu clave de internet' : 'Repite tu clave';
      $('#pins', ov).textContent = mode === 'unlock' ? 'Ingresa tu clave de internet de 6 dígitos.' : first === null ? 'Elige 6 dígitos. Te la pediremos al abrir la app si pasaron más de 5 minutos.' : 'Escríbela otra vez para confirmar.';
      $('#pind', ov).innerHTML = [0, 1, 2, 3, 4, 5].map(i => `<i class="${i < buf.length ? 'on' : ''}"></i>`).join('');
    };
    const done = v => { document.removeEventListener('keydown', onKey, true); ov.remove(); locked = false; if (v) touch(); resolve(v); };
    const out = async msg => { S.unsub && S.unsub(); try { await api.signOut(); } catch {} S.me = null; S.authTab = 'login'; done(false); render(); msg && toast(msg); };
    const submit = async () => {
      if (busy) return; busy = true;
      try {
        if (mode === 'unlock') {
          const pin = api.getPin();
          if (pin && await hashPin(buf, pin.s) === pin.h) { store.set('amp_pin_fails', null); return done(true); }
          const fails = (+store.get('amp_pin_fails') || 0) + 1; store.set('amp_pin_fails', fails); buf = '';
          if (fails >= MAX_FAILS) { store.set('amp_pin_fails', null); store.set('amp_pin_reset', '1'); return out('Demasiados intentos. Ingresa con tu correo y contraseña.'); }
          err(`Clave incorrecta. Te quedan ${MAX_FAILS - fails} intento${MAX_FAILS - fails === 1 ? '' : 's'}.`);
        } else if (first === null) {
          if (/^(\d)\1{5}$/.test(buf) || buf === '123456' || buf === '654321') err('Elige una clave menos fácil de adivinar.'); else first = buf;
          buf = '';
        } else if (buf !== first) { first = null; buf = ''; err('Las claves no coinciden. Empieza de nuevo.'); }
        else {
          const s = Math.random().toString(36).slice(2) + Date.now().toString(36);
          await api.setPin({ s, h: await hashPin(buf, s) });
          store.set('amp_pin_reset', null); store.set('amp_pin_fails', null); done(true); toast('Clave de internet guardada.'); return;
        }
      } catch (x) { first = null; buf = ''; err(x.message); }
      busy = false; paint();
    };
    const press = k => {
      if (busy) return;
      if (k === 'del') buf = buf.slice(0, -1); else if (buf.length < 6) { buf += k; if (buf.length === 1) err(''); }
      paint(); if (buf.length === 6) setTimeout(submit, 120);
    };
    const onKey = e => { if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); } else if (e.key === 'Backspace') { e.preventDefault(); press('del'); } };
    ov.addEventListener('click', e => {
      const k = e.target.closest('[data-k]'), p = e.target.closest('[data-p]');
      if (k) return press(k.dataset.k);
      if (!p) return;
      if (p.dataset.p === 'cancel') return done(null);
      if (p.dataset.p === 'forgot') { store.set('amp_pin_reset', '1'); return out('Ingresa con tu correo y contraseña para crear una nueva clave.'); }
      out();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov); paint();
  });
}
// Al volver a la app: pedir la clave si pasaron más de 5 minutos; si no, actualizar los datos
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (S.me && !locked) touch(); return; }
  if (!S.me || locked) return;
  if (api.getPin() && idleTooLong()) pinScreen('unlock'); else { touch(); refresh().catch(() => {}); }
});

/* ---------- Instalar la app en el celular ---------- */
let deferredInstall = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
addEventListener('appinstalled', () => { deferredInstall = null; closeSheet(); toast('¡App instalada! Búscala en tu pantalla de inicio.'); });
const isStandalone = () => { try { return /AgenteMovilApp/.test(navigator.userAgent) || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; } };
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
function openInstall() {
  sheet(`<div class="head"><h2>Instalar la app</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
    <div style="text-align:center;margin:8px 0 14px"><img src="icon-192.png" alt="" width="84" height="84" style="border-radius:20px"></div>
    ${isIOS ? `<div class="calc"><b>En iPhone (Safari):</b>
      <div class="line"><span>1. Toca el botón Compartir (el cuadrado con la flecha hacia arriba).</span></div>
      <div class="line"><span>2. Elige “Agregar a inicio”.</span></div>
      <div class="line"><span>3. Toca “Agregar”. El ícono aparecerá en tu pantalla.</span></div></div>
      <p class="hint">Debe abrirse en Safari; desde otros navegadores de iPhone no se puede instalar.</p>`
    : `<a class="btn block" href="../agente-movil.apk" download>Descargar la app (APK)</a>
      <div class="calc"><b>En Android:</b>
      <div class="line"><span>1. Toca el botón y espera la descarga.</span></div>
      <div class="line"><span>2. Abre el archivo agente-movil.apk.</span></div>
      <div class="line"><span>3. Si tu celular lo pide, permite “instalar apps de esta fuente” y toca Instalar.</span></div></div>
      <button class="btn ghost block" id="doinst" style="margin-top:12px">Instalar sin descargar</button>
      <p class="err" id="insterr"></p>`}`, bg => {
    const b = $('#doinst', bg);
    if (b) b.onclick = async () => {
      if (!deferredInstall) { $('#insterr', bg).textContent = 'Tu navegador no lo permite ahora. Usa el botón de descarga, o el menú ⋮ de Chrome → “Instalar app”.'; return; }
      deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch {} deferredInstall = null;
    };
  });
}

function openForgot() {
  sheet(`<div class="head"><h2>Recuperar contraseña</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
    <form id="fgf" novalidate><label for="fe">Tu correo</label><input id="fe" type="email" required><p class="err" id="fer"></p>
    <button class="btn block">Enviarme un enlace</button></form>`, bg => {
    $('#fgf', bg).onsubmit = async e => { e.preventDefault();
      try { await api.resetPassword($('#fe', bg).value.trim()); closeSheet(); toast('Revisa tu correo para crear una nueva contraseña.'); }
      catch (x) { $('#fer', bg).textContent = x.message; } };
  });
}
function openNewPassword() {
  sheet(`<div class="head"><h2>Nueva contraseña</h2></div><form id="npf" novalidate><label for="np">Escribe tu nueva contraseña</label>
    ${pwField('np', 'minlength="6" required autocomplete="new-password"')}<p class="err" id="nperr"></p><button class="btn block">Guardar</button></form>`, bg => {
    $('#npf', bg).onsubmit = async e => { e.preventDefault(); const p = $('#np', bg).value;
      if (p.length < 6) { $('#nperr', bg).textContent = 'Mínimo 6 caracteres.'; return; }
      try { await api.updatePassword(p); closeSheet(); toast('Contraseña actualizada.'); } catch (x) { $('#nperr', bg).textContent = x.message; } };
  });
}

/* =================================================================
   RENDER Y EVENTOS
   ================================================================= */
function render() {
  if (!S.me) return renderAuth();
  S.me.role === 'admin' ? renderAdmin() : renderClient();
}

document.addEventListener('click', async e => {
  const eye = e.target.closest('[data-eye]');
  if (eye) {
    const inp = document.getElementById(eye.dataset.eye), show = inp.type === 'password';
    inp.type = show ? 'text' : 'password'; eye.innerHTML = show ? eyeOff : eyeOn;
    eye.setAttribute('aria-pressed', show); eye.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    inp.focus(); return;
  }
  const cp = e.target.closest('[data-copy]');
  if (cp) {
    const txt = cp.dataset.copy;
    try { await navigator.clipboard.writeText(txt); }
    catch { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove(); }
    toast('Copiado: ' + txt); return;
  }
  const del = e.target.closest('[data-del]');
  if (del) {
    if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = '¿Eliminar? Toca otra vez'; return; }
    del.disabled = true;
    try { await api.deleteLoan(+del.dataset.del); closeSheet(); await refresh(); toast('Solicitud eliminada.'); } catch (x) { toast(x.message); del.disabled = false; }
    return;
  }
  const t = e.target.closest('[data-act],[data-auth],[data-tab],[data-loan],[data-demo],[data-person]');
  if (!t) return;
  if (t.dataset.person) { const p = people().find(x => x.key === t.dataset.person); if (p) openPerson(p); return; }
  if (t.dataset.auth) { S.authTab = t.dataset.auth; return renderAuth(); }
  if (t.dataset.tab) { S.tab = t.dataset.tab; return renderAdmin(); }
  if (t.dataset.demo) { const [u, p] = t.dataset.demo.split('|'); try { await enter(await api.signIn(u, p), true); } catch (x) { toast(x.message); } return; }
  if (t.dataset.loan) { const l = S.loans.find(x => String(x.id) === t.dataset.loan); if (l) { closeSheet(); openLoan(l); } return; }
  const a = t.dataset.act;
  if (a === 'request') openRequest();
  if (a === 'reload') { t.classList.add('spin'); touch(); location.reload(); return; }
  if (a === 'notes') openNotes();
  if (a === 'external') openExternal();
  if (a === 'install') openInstall();
  if (a === 'pinchange') { e.preventDefault(); pinScreen('create', true); }
  if (a === 'forgot') { e.preventDefault(); openForgot(); }
  if (a === 'perm') { askOsPermission(); closeSheet(); }
  if (a === 'logout') { document.querySelectorAll('.toast').forEach(x => x.remove()); S.unsub && S.unsub(); await api.signOut(); S.me = null; S.authTab = 'login'; render(); }
  if (a === 'reset' && api.reset) {
    if (t.dataset.sure !== '1') { t.dataset.sure = '1'; t.textContent = '¿Borrar todo? Toca otra vez'; return; }
    S.unsub && S.unsub(); api.reset(); S.me = null; render(); toast('Demo reiniciada.');
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.item[data-loan],.item[data-person]')) e.target.click(); });

(async () => {
  app.innerHTML = '<p class="empty" style="padding-top:30vh">Cargando…</p>';
  api.onRecovery(openNewPassword);
  try { const me = await api.current(); if (me) await enter(me); else render(); }
  catch (x) { render(); toast(x.message); }
  if (location.hash === '#instalar' && !isStandalone()) openInstall();
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js'); } catch {}
})();
}
