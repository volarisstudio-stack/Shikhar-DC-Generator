// ══════════════════════════════════════════
// Shikhar Commodities — DC Generator
// Backed by Supabase (Postgres + Auth + RLS) instead of a hardcoded
// JSONBin master key. See README.md for setup.
// ══════════════════════════════════════════

const sb = window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY);

let state = {
  parties: [],
  pos: [],
  saudas: [],
  challans: [],
  company: null,
};

let editing = { party: null, po: null, sauda: null };
let items = [];        // current New-DC line items
let dcManualNumber = false;
let previewChallan = null; // challan object currently shown in the preview modal (for print)

// ── Toast ──
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 3000);
}

function setSync(status, msg) {
  const el = document.getElementById('sync-status');
  const colors = { ok: '#2d6a4f', saving: '#b5460f', error: '#c00', loading: '#555' };
  const icons = { ok: '☁ ', saving: '↑ ', error: '✕ ', loading: '… ' };
  el.textContent = (icons[status] || '') + msg;
  el.style.color = colors[status] || '#555';
}

function money(n) { return '₹ ' + (Number(n) || 0).toFixed(2); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) { showApp(); } else { showLogin(); }

  sb.auth.onAuthStateChange((_event, session) => {
    if (session) showApp(); else showLogin();
  });

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    const btn = document.getElementById('login-btn');
    btn.disabled = true; btn.textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = 'Sign In';
    if (error) errEl.textContent = error.message;
  });

  document.getElementById('signout-btn').addEventListener('click', async () => {
    await sb.auth.signOut();
  });
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

async function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  await loadAll();
}

// ══════════════════════════════════════════
// DATA LOADING
// ══════════════════════════════════════════
async function loadAll() {
  setSync('loading', 'Loading data…');
  try {
    const [parties, pos, saudas, challans, company] = await Promise.all([
      sb.from('parties').select('*').order('name'),
      sb.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      sb.from('saudas').select('*').order('created_at', { ascending: false }),
      sb.from('challans').select('*').order('created_at', { ascending: false }),
      sb.from('company').select('*').single(),
    ]);
    for (const r of [parties, pos, saudas, challans, company]) {
      if (r.error) throw r.error;
    }
    state.parties = parties.data || [];
    state.pos = pos.data || [];
    state.saudas = saudas.data || [];
    state.challans = challans.data || [];
    state.company = company.data;

    renderCompanyHeader();
    renderPartyDropdowns();
    renderPoDropdowns();
    renderSaudaDropdown();
    renderPartiesTable();
    renderPosTable();
    renderSaudaTable();
    renderHistoryTable();
    renderReports();
    renderCompanyForm();
    await refreshDcPreview();

    setSync('ok', 'Synced');
  } catch (err) {
    console.error(err);
    setSync('error', 'Sync failed');
    toast('Could not load data: ' + err.message, 'err');
  }
}

// ══════════════════════════════════════════
// TABS + MOBILE NAV
// ══════════════════════════════════════════
const tabsNav = document.getElementById('tabs-nav');
const navToggle = document.getElementById('nav-toggle');
const navOverlay = document.getElementById('nav-overlay');

function closeMobileNav() {
  tabsNav.classList.remove('open');
  navOverlay.classList.remove('open');
  navToggle.classList.remove('open');
  navToggle.setAttribute('aria-expanded', 'false');
}
function openMobileNav() {
  tabsNav.classList.add('open');
  navOverlay.classList.add('open');
  navToggle.classList.add('open');
  navToggle.setAttribute('aria-expanded', 'true');
}
navToggle.addEventListener('click', () => {
  if (tabsNav.classList.contains('open')) closeMobileNav(); else openMobileNav();
});
navOverlay.addEventListener('click', closeMobileNav);

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    closeMobileNav();
  });
});

// ══════════════════════════════════════════
// COMPANY HEADER / FORM
// ══════════════════════════════════════════
function renderCompanyHeader() {
  const c = state.company || {};
  document.getElementById('company-name').textContent = c.name || 'Shikhar Commodities';
  document.getElementById('company-address').textContent = [c.addr1, c.addr2].filter(Boolean).join(', ');
}

function renderCompanyForm() {
  const c = state.company || {};
  document.getElementById('company-form-name').value = c.name || '';
  document.getElementById('company-form-gst').value = c.gst || '';
  document.getElementById('company-form-addr1').value = c.addr1 || '';
  document.getElementById('company-form-addr2').value = c.addr2 || '';
  document.getElementById('company-form-email').value = c.email || '';
  document.getElementById('company-form-phone').value = c.phone || '';
}

document.getElementById('company-save-btn').addEventListener('click', async () => {
  const payload = {
    id: true,
    name: document.getElementById('company-form-name').value.trim(),
    gst: document.getElementById('company-form-gst').value.trim(),
    addr1: document.getElementById('company-form-addr1').value.trim(),
    addr2: document.getElementById('company-form-addr2').value.trim(),
    email: document.getElementById('company-form-email').value.trim(),
    phone: document.getElementById('company-form-phone').value.trim(),
    updated_at: new Date().toISOString(),
  };
  if (!payload.name) return toast('Company name is required', 'err');
  setSync('saving', 'Saving…');
  const { error } = await sb.from('company').upsert(payload);
  if (error) { setSync('error', 'Save failed'); return toast(error.message, 'err'); }
  state.company = payload;
  renderCompanyHeader();
  setSync('ok', 'Synced');
  toast('Company details saved');
});

// ══════════════════════════════════════════
// PARTIES
// ══════════════════════════════════════════
function renderPartyDropdowns() {
  const opts = state.parties.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  document.getElementById('dc-party-select').innerHTML = '<option value="">— Select a saved party or fill manually —</option>' + opts;
  document.getElementById('po-party-select').innerHTML = '<option value="">— Select saved party —</option>' + opts;
  const reportSel = document.getElementById('report-party-filter');
  const cur = reportSel.value;
  reportSel.innerHTML = '<option value="">All Parties</option>' + opts;
  reportSel.value = cur;
}

function renderPartiesTable() {
  const tbody = document.getElementById('parties-tbody');
  if (!state.parties.length) { tbody.innerHTML = '<tr><td colspan="7">No parties saved yet.</td></tr>'; return; }
  tbody.innerHTML = state.parties.map(p => `
    <tr>
      <td>${esc(p.name)}</td><td>${esc(p.gst)}</td><td>${esc(p.addr)}</td><td>${esc(p.state)}</td>
      <td>${esc(p.phone)}</td><td>${esc(p.email)}</td>
      <td><button class="btn-link" data-edit-party="${p.id}">Edit</button> <button class="btn-danger" data-del-party="${p.id}">Delete</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-edit-party]').forEach(b => b.addEventListener('click', () => editParty(b.dataset.editParty)));
  tbody.querySelectorAll('[data-del-party]').forEach(b => b.addEventListener('click', () => deleteParty(b.dataset.delParty)));
}

function partyFormValues() {
  return {
    name: document.getElementById('party-name').value.trim(),
    gst: document.getElementById('party-gst').value.trim(),
    addr: document.getElementById('party-addr').value.trim(),
    state: document.getElementById('party-state').value.trim(),
    phone: document.getElementById('party-phone').value.trim(),
    email: document.getElementById('party-email').value.trim(),
  };
}
function clearPartyForm() {
  ['party-name', 'party-gst', 'party-addr', 'party-state', 'party-phone', 'party-email'].forEach(id => document.getElementById(id).value = '');
  editing.party = null;
  document.getElementById('party-form-legend').textContent = 'Add New Party';
  document.getElementById('party-save-btn').textContent = 'Save Party';
  document.getElementById('party-cancel-btn').classList.add('hidden');
}
function editParty(id) {
  const p = state.parties.find(x => x.id === id);
  if (!p) return;
  document.getElementById('party-name').value = p.name || '';
  document.getElementById('party-gst').value = p.gst || '';
  document.getElementById('party-addr').value = p.addr || '';
  document.getElementById('party-state').value = p.state || '';
  document.getElementById('party-phone').value = p.phone || '';
  document.getElementById('party-email').value = p.email || '';
  editing.party = id;
  document.getElementById('party-form-legend').textContent = 'Edit Party';
  document.getElementById('party-save-btn').textContent = 'Update Party';
  document.getElementById('party-cancel-btn').classList.remove('hidden');
  document.querySelector('[data-tab="manage-parties"]').click();
}
async function deleteParty(id) {
  if (!confirm('Delete this party?')) return;
  const { error } = await sb.from('parties').delete().eq('id', id);
  if (error) return toast(error.message, 'err');
  state.parties = state.parties.filter(p => p.id !== id);
  renderPartyDropdowns(); renderPartiesTable();
  toast('Party deleted');
}
document.getElementById('party-save-btn').addEventListener('click', async () => {
  const v = partyFormValues();
  if (!v.name) return toast('Party name is required', 'err');
  setSync('saving', 'Saving…');
  if (editing.party) {
    const { error } = await sb.from('parties').update(v).eq('id', editing.party);
    if (error) { setSync('error', 'Save failed'); return toast(error.message, 'err'); }
    Object.assign(state.parties.find(p => p.id === editing.party), v);
    toast('Party updated');
  } else {
    const { data, error } = await sb.from('parties').insert(v).select().single();
    if (error) { setSync('error', 'Save failed'); return toast(error.message, 'err'); }
    state.parties.push(data);
    toast('Party saved');
  }
  state.parties.sort((a, b) => a.name.localeCompare(b.name));
  renderPartyDropdowns(); renderPartiesTable(); clearPartyForm();
  setSync('ok', 'Synced');
});
document.getElementById('party-cancel-btn').addEventListener('click', clearPartyForm);

// Quick "+ Save as New Party" from the New DC form
document.getElementById('dc-save-party-btn').addEventListener('click', async () => {
  const v = {
    name: document.getElementById('dc-party-name').value.trim(),
    gst: document.getElementById('dc-party-gst').value.trim(),
    addr: document.getElementById('dc-party-addr').value.trim(),
    state: document.getElementById('dc-party-state').value.trim(),
    phone: '', email: '',
  };
  if (!v.name) return toast('Enter a party name first', 'err');
  setSync('saving', 'Saving…');
  const { data, error } = await sb.from('parties').insert(v).select().single();
  if (error) { setSync('error', 'Save failed'); return toast(error.message, 'err'); }
  state.parties.push(data);
  state.parties.sort((a, b) => a.name.localeCompare(b.name));
  renderPartyDropdowns();
  renderPartiesTable();
  document.getElementById('dc-party-select').value = data.id;
  setSync('ok', 'Synced');
  toast('Party saved');
});

// ══════════════════════════════════════════
// PURCHASE ORDERS
// ══════════════════════════════════════════
function renderPoDropdowns() {
  const opts = state.pos.map(p => `<option value="${esc(p.po_number)}">${esc(p.po_number)} — ${esc(p.party_name)}</option>`).join('');
  document.getElementById('dc-po-select').innerHTML = '<option value="">— Select a saved PO —</option>' + opts;
  const reportSel = document.getElementById('report-po-filter');
  const cur = reportSel.value;
  reportSel.innerHTML = '<option value="">All POs</option>' + opts;
  reportSel.value = cur;
}
function renderPosTable() {
  const tbody = document.getElementById('pos-tbody');
  if (!state.pos.length) { tbody.innerHTML = '<tr><td colspan="7">No POs saved yet.</td></tr>'; return; }
  tbody.innerHTML = state.pos.map(p => `
    <tr>
      <td>${esc(p.po_number)}</td><td>${esc(p.party_name)}</td><td>${esc(p.product)}</td>
      <td>${p.rate}</td><td>${p.qty}</td><td>${esc(p.remarks)}</td>
      <td><button class="btn-link" data-edit-po="${p.id}">Edit</button> <button class="btn-danger" data-del-po="${p.id}">Delete</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-edit-po]').forEach(b => b.addEventListener('click', () => editPo(b.dataset.editPo)));
  tbody.querySelectorAll('[data-del-po]').forEach(b => b.addEventListener('click', () => deletePo(b.dataset.delPo)));
}
function clearPoForm() {
  ['po-number', 'po-product', 'po-rate', 'po-qty', 'po-remarks', 'po-party-name'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('po-party-select').value = '';
  editing.po = null;
  document.getElementById('po-form-legend').textContent = 'Add New PO';
  document.getElementById('po-save-btn').textContent = 'Save PO';
  document.getElementById('po-cancel-btn').classList.add('hidden');
}
function editPo(id) {
  const p = state.pos.find(x => x.id === id);
  if (!p) return;
  document.getElementById('po-number').value = p.po_number || '';
  document.getElementById('po-party-select').value = p.party_id || '';
  document.getElementById('po-party-name').value = p.party_id ? '' : (p.party_name || '');
  document.getElementById('po-product').value = p.product || '';
  document.getElementById('po-rate').value = p.rate || 0;
  document.getElementById('po-qty').value = p.qty || 0;
  document.getElementById('po-remarks').value = p.remarks || '';
  editing.po = id;
  document.getElementById('po-form-legend').textContent = 'Edit PO';
  document.getElementById('po-save-btn').textContent = 'Update PO';
  document.getElementById('po-cancel-btn').classList.remove('hidden');
  document.querySelector('[data-tab="manage-pos"]').click();
}
async function deletePo(id) {
  if (!confirm('Delete this PO?')) return;
  const { error } = await sb.from('purchase_orders').delete().eq('id', id);
  if (error) return toast(error.message, 'err');
  state.pos = state.pos.filter(p => p.id !== id);
  renderPoDropdowns(); renderPosTable(); renderReports();
  toast('PO deleted');
}
document.getElementById('po-save-btn').addEventListener('click', async () => {
  const poNumber = document.getElementById('po-number').value.trim();
  const product = document.getElementById('po-product').value.trim();
  if (!poNumber || !product) return toast('PO Number and Product are required', 'err');
  const partyId = document.getElementById('po-party-select').value || null;
  const typedName = document.getElementById('po-party-name').value.trim();
  const linkedParty = partyId ? state.parties.find(p => p.id === partyId) : null;
  const v = {
    po_number: poNumber,
    party_id: partyId,
    party_name: linkedParty ? linkedParty.name : typedName,
    party_gst: linkedParty ? linkedParty.gst : '',
    party_addr: linkedParty ? linkedParty.addr : '',
    party_state: linkedParty ? linkedParty.state : '',
    product,
    rate: Number(document.getElementById('po-rate').value) || 0,
    qty: Number(document.getElementById('po-qty').value) || 0,
    remarks: document.getElementById('po-remarks').value.trim(),
  };
  setSync('saving', 'Saving…');
  if (editing.po) {
    const { error } = await sb.from('purchase_orders').update(v).eq('id', editing.po);
    if (error) { setSync('error', 'Save failed'); return toast(error.message, 'err'); }
    Object.assign(state.pos.find(p => p.id === editing.po), v);
    toast('PO updated');
  } else {
    const { data, error } = await sb.from('purchase_orders').insert(v).select().single();
    if (error) { setSync('error', 'Save failed'); return toast(error.message, 'err'); }
    state.pos.unshift(data);
    toast('PO saved');
  }
  renderPoDropdowns(); renderPosTable(); renderReports(); clearPoForm();
  setSync('ok', 'Synced');
});
document.getElementById('po-cancel-btn').addEventListener('click', clearPoForm);

// ══════════════════════════════════════════
// SAUDA (BROKER)
// ══════════════════════════════════════════
function saudaBalance(s) { return (Number(s.qty) || 0) - (Number(s.deducted_qty) || 0); }
function renderSaudaDropdown() {
  const opts = state.saudas.map(s => `<option value="${s.id}">${esc(s.broker_name)} — ${esc(s.product)} (bal ${saudaBalance(s).toFixed(3)} MT)</option>`).join('');
  document.getElementById('dc-sauda-select').innerHTML = '<option value="">— No broker / not applicable —</option>' + opts;
}
function renderSaudaTable() {
  const tbody = document.getElementById('sauda-tbody');
  if (!state.saudas.length) { tbody.innerHTML = '<tr><td colspan="8">No saudas added yet.</td></tr>'; return; }
  tbody.innerHTML = state.saudas.map(s => `
    <tr>
      <td>${esc(s.broker_name)}</td><td>${esc(s.product)}</td><td>${s.qty}</td><td>${s.deducted_qty}</td>
      <td>${s.rate}</td><td>${esc(s.sauda_date || '')}</td><td>${esc(s.remarks)}</td>
      <td><button class="btn-link" data-edit-sauda="${s.id}">Edit</button> <button class="btn-danger" data-del-sauda="${s.id}">Delete</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-edit-sauda]').forEach(b => b.addEventListener('click', () => editSauda(b.dataset.editSauda)));
  tbody.querySelectorAll('[data-del-sauda]').forEach(b => b.addEventListener('click', () => deleteSauda(b.dataset.delSauda)));
}
function clearSaudaForm() {
  ['sauda-broker', 'sauda-product', 'sauda-qty', 'sauda-rate', 'sauda-date', 'sauda-remarks'].forEach(id => document.getElementById(id).value = '');
  editing.sauda = null;
  document.getElementById('sauda-form-legend').textContent = 'Add New Sauda';
  document.getElementById('sauda-save-btn').textContent = 'Save Sauda';
  document.getElementById('sauda-cancel-btn').classList.add('hidden');
}
function editSauda(id) {
  const s = state.saudas.find(x => x.id === id);
  if (!s) return;
  document.getElementById('sauda-broker').value = s.broker_name || '';
  document.getElementById('sauda-product').value = s.product || '';
  document.getElementById('sauda-qty').value = s.qty || 0;
  document.getElementById('sauda-rate').value = s.rate || 0;
  document.getElementById('sauda-date').value = s.sauda_date || '';
  document.getElementById('sauda-remarks').value = s.remarks || '';
  editing.sauda = id;
  document.getElementById('sauda-form-legend').textContent = 'Edit Sauda';
  document.getElementById('sauda-save-btn').textContent = 'Update Sauda';
  document.getElementById('sauda-cancel-btn').classList.remove('hidden');
  document.querySelector('[data-tab="sauda"]').click();
}
async function deleteSauda(id) {
  if (!confirm('Delete this sauda?')) return;
  const { error } = await sb.from('saudas').delete().eq('id', id);
  if (error) return toast(error.message, 'err');
  state.saudas = state.saudas.filter(s => s.id !== id);
  renderSaudaDropdown(); renderSaudaTable(); renderReports();
  toast('Sauda deleted');
}
document.getElementById('sauda-save-btn').addEventListener('click', async () => {
  const v = {
    broker_name: document.getElementById('sauda-broker').value.trim(),
    product: document.getElementById('sauda-product').value.trim(),
    qty: Number(document.getElementById('sauda-qty').value) || 0,
    rate: Number(document.getElementById('sauda-rate').value) || 0,
    sauda_date: document.getElementById('sauda-date').value || null,
    remarks: document.getElementById('sauda-remarks').value.trim(),
  };
  if (!v.broker_name || !v.product || !v.qty) return toast('Broker, Product and Qty are required', 'err');
  setSync('saving', 'Saving…');
  if (editing.sauda) {
    const { error } = await sb.from('saudas').update(v).eq('id', editing.sauda);
    if (error) { setSync('error', 'Save failed'); return toast(error.message, 'err'); }
    Object.assign(state.saudas.find(s => s.id === editing.sauda), v);
    toast('Sauda updated');
  } else {
    const { data, error } = await sb.from('saudas').insert(v).select().single();
    if (error) { setSync('error', 'Save failed'); return toast(error.message, 'err'); }
    state.saudas.unshift(data);
    toast('Sauda saved');
  }
  renderSaudaDropdown(); renderSaudaTable(); renderReports(); clearSaudaForm();
  setSync('ok', 'Synced');
});
document.getElementById('sauda-cancel-btn').addEventListener('click', clearSaudaForm);

// ══════════════════════════════════════════
// NEW DC — ITEM ROWS
// ══════════════════════════════════════════
function addItemRow(row = { desc: '', truck: '', net: '', rate: '', amt: 0 }) {
  items.push(row);
  renderItems();
}
function renderItems() {
  const tbody = document.getElementById('items-tbody');
  tbody.innerHTML = items.map((row, i) => `
    <tr>
      <td><input type="text" data-i="${i}" data-f="desc" value="${esc(row.desc)}"></td>
      <td><input type="text" data-i="${i}" data-f="truck" value="${esc(row.truck)}"></td>
      <td><input type="number" step="0.001" data-i="${i}" data-f="net" value="${row.net}"></td>
      <td><input type="number" step="0.01" data-i="${i}" data-f="rate" value="${row.rate}"></td>
      <td>${money(row.amt)}</td>
      <td><button class="btn-danger" data-remove-row="${i}">✕</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = Number(inp.dataset.i), f = inp.dataset.f;
      items[i][f] = f === 'net' || f === 'rate' ? Number(inp.value) : inp.value;
      items[i].amt = (Number(items[i].net) || 0) * (Number(items[i].rate) || 0);
      // Only patch the computed amount cell in place — do NOT re-render the whole
      // table here. Rebuilding the tbody's innerHTML on every keystroke used to
      // destroy and recreate the input the person was actively typing in, which
      // threw focus out of the field after every single character.
      const amtCell = inp.closest('tr')?.children[4];
      if (amtCell) amtCell.textContent = money(items[i].amt);
      recalcTotals();
    });
  });
  tbody.querySelectorAll('[data-remove-row]').forEach(b => {
    b.addEventListener('click', () => {
      items.splice(Number(b.dataset.removeRow), 1);
      renderItems();
      recalcTotals();
    });
  });
}
document.getElementById('add-row-btn').addEventListener('click', () => addItemRow());

function recalcTotals() {
  const totalKanta = items.reduce((s, r) => s + (Number(r.net) || 0), 0);
  const subtotal = items.reduce((s, r) => s + (Number(r.amt) || 0), 0);
  const taxPct = Number(document.getElementById('dc-tax-pct').value) || 0;
  const taxAmt = subtotal * taxPct / 100;
  const grand = subtotal + taxAmt;
  document.getElementById('total-kanta').textContent = totalKanta.toFixed(3) + ' MTs';
  document.getElementById('subtotal').textContent = money(subtotal);
  document.getElementById('grand-total').textContent = money(grand);

  // Keep the sauda-deduction field in sync by default (unless user typed a custom value)
  const deductInput = document.getElementById('dc-sauda-deduct');
  if (!deductInput.dataset.userEdited) deductInput.value = totalKanta ? totalKanta.toFixed(3) : '';

  return { totalKanta, subtotal, taxPct, taxAmt, grand };
}
document.getElementById('dc-tax-pct').addEventListener('input', recalcTotals);
document.getElementById('dc-sauda-deduct').addEventListener('input', (e) => { e.target.dataset.userEdited = '1'; });

// ══════════════════════════════════════════
// NEW DC — PO / PARTY AUTOFILL
// ══════════════════════════════════════════
document.getElementById('dc-po-select').addEventListener('change', async (e) => {
  const po = state.pos.find(p => p.po_number === e.target.value);
  if (!po) return;
  document.getElementById('dc-party-name').value = po.party_name || '';
  document.getElementById('dc-party-gst').value = po.party_gst || '';
  document.getElementById('dc-party-addr').value = po.party_addr || '';
  document.getElementById('dc-party-state').value = po.party_state || '';
  document.getElementById('dc-party-select').value = po.party_id || '';
  if (!items.length) addItemRow({ desc: po.product || '', truck: '', net: '', rate: po.rate || 0, amt: 0 });
  await refreshDcPreview();
});
document.getElementById('dc-party-select').addEventListener('change', (e) => {
  const p = state.parties.find(x => x.id === e.target.value);
  if (!p) return;
  document.getElementById('dc-party-name').value = p.name || '';
  document.getElementById('dc-party-gst').value = p.gst || '';
  document.getElementById('dc-party-addr').value = p.addr || '';
  document.getElementById('dc-party-state').value = p.state || '';
});

// ══════════════════════════════════════════
// NEW DC — DC NUMBER PREVIEW / EDIT
// ══════════════════════════════════════════
async function peekNextDcNumber(poNumber) {
  const last3raw = (poNumber || '').replace(/[^0-9]/g, '').slice(-3);
  const last3 = last3raw ? last3raw.padStart(3, '0') : '000';
  const { data, error } = await sb.from('dc_counters').select('next_serial').eq('po_last3', last3).maybeSingle();
  const nextSerial = (data?.next_serial || 0) + 1;
  return String(nextSerial).padStart(2, '0') + '-' + last3;
}
async function refreshDcPreview() {
  if (dcManualNumber) return;
  const poNumber = document.getElementById('dc-po-select').value;
  const preview = await peekNextDcNumber(poNumber);
  document.getElementById('dc-number').value = preview;
  document.getElementById('next-dc-preview').textContent = preview;
}
document.getElementById('dc-edit-btn').addEventListener('click', () => {
  dcManualNumber = !dcManualNumber;
  const input = document.getElementById('dc-number');
  input.readOnly = !dcManualNumber;
  document.getElementById('dc-edit-btn').textContent = dcManualNumber ? '🔒 Lock' : '✎ Edit';
  if (dcManualNumber) input.focus();
  else refreshDcPreview();
});

// ══════════════════════════════════════════
// NEW DC — CLEAR / PREVIEW / GENERATE
// ══════════════════════════════════════════
function clearDcForm() {
  document.getElementById('dc-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('dc-po-select').value = '';
  document.getElementById('dc-party-select').value = '';
  ['dc-party-name', 'dc-party-gst', 'dc-party-addr', 'dc-party-state', 'dc-vehicle', 'dc-driver', 'dc-destination', 'dc-remarks'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('dc-tax-pct').value = 0;
  document.getElementById('dc-sauda-select').value = '';
  const deductInput = document.getElementById('dc-sauda-deduct');
  deductInput.value = ''; delete deductInput.dataset.userEdited;
  items = [];
  renderItems();
  recalcTotals();
  dcManualNumber = false;
  document.getElementById('dc-number').readOnly = true;
  document.getElementById('dc-edit-btn').textContent = '✎ Edit';
  refreshDcPreview();
}
document.getElementById('clear-form-btn').addEventListener('click', clearDcForm);

function currentChallanDraft() {
  const totals = recalcTotals();
  return {
    date: document.getElementById('dc-date').value || new Date().toISOString().slice(0, 10),
    po_number: document.getElementById('dc-po-select').value,
    party_name: document.getElementById('dc-party-name').value.trim(),
    party_gst: document.getElementById('dc-party-gst').value.trim(),
    party_addr: document.getElementById('dc-party-addr').value.trim(),
    party_state: document.getElementById('dc-party-state').value.trim(),
    vehicle: document.getElementById('dc-vehicle').value.trim(),
    driver: document.getElementById('dc-driver').value.trim(),
    destination: document.getElementById('dc-destination').value.trim(),
    items: items.map(r => ({ desc: r.desc, truck: r.truck, net: Number(r.net) || 0, rate: Number(r.rate) || 0, amt: Number(r.amt) || 0 })),
    total_kanta_wt: totals.totalKanta,
    tax_pct: totals.taxPct,
    tax_amt: totals.taxAmt,
    subtotal: totals.subtotal,
    grand_total: totals.grand,
    remarks: document.getElementById('dc-remarks').value.trim(),
    broker_sauda_id: document.getElementById('dc-sauda-select').value || null,
    broker_deduct: document.getElementById('dc-sauda-select').value ? (Number(document.getElementById('dc-sauda-deduct').value) || 0) : null,
    dc_number: document.getElementById('dc-number').value.trim(),
  };
}

function dcPreviewHtml(c, company) {
  const rows = c.items.map(r => `<tr><td>${esc(r.desc)}</td><td>${esc(r.truck)}</td><td>${Number(r.net).toFixed(3)}</td></tr>`).join('');
  // The reference challan's goods table is a fixed-size printed form: a
  // minimum of 10 rows every time, with any unused rows left blank. Pad out
  // to that minimum so a 1-item DC still produces the same tall table the
  // office is used to, instead of a table that visually stops after 1 row.
  const MIN_ROWS = 10;
  const fillerCount = Math.max(0, MIN_ROWS - c.items.length);
  const fillerRows = '<tr class="dc-filler-row"><td></td><td></td><td></td></tr>'.repeat(fillerCount);
  const companyName = esc(company?.name || '');
  return `
    <div class="dc-doc-header">
      <div class="dc-doc-label">DELIVERY CHALLAN</div>
      <div class="dc-company-name">${companyName}</div>
      ${company?.addr1 ? `<div class="dc-company-addr">${esc(company.addr1)}</div>` : ''}
      ${company?.addr2 ? `<div class="dc-company-addr">${esc(company.addr2)}</div>` : ''}
      ${company?.gst ? `<div class="dc-company-gst">GSTIN: ${esc(company.gst)}</div>` : ''}
    </div>
    <hr class="dc-rule">
    <div class="dc-meta-row">
      <div class="dc-meta-left">
        <div><span>Ch No.</span><strong>${esc(c.dc_number)}</strong></div>
        <div><span>PO No.</span><strong>${esc(c.po_number)}</strong></div>
        <div><span>Vehicle</span><strong>${esc(c.vehicle)}</strong></div>
      </div>
      <div class="dc-meta-right"><span>Date</span><strong>${esc(c.date)}</strong></div>
    </div>
    <div class="dc-to-block">
      <div>To, M/s <strong>${esc(c.party_name)}</strong>${c.party_gst ? ' (GSTIN: ' + esc(c.party_gst) + ')' : ''}</div>
      <div>${esc(c.party_addr)}${c.party_state ? ', ' + esc(c.party_state) : ''}</div>
    </div>
    ${(c.driver || c.destination) ? `<div class="dc-transport-line">${c.driver ? 'Driver: ' + esc(c.driver) : ''}${c.driver && c.destination ? ' &nbsp;|&nbsp; ' : ''}${c.destination ? 'Destination: ' + esc(c.destination) : ''}</div>` : ''}
    <div class="dc-goods-wrap">
      <table class="dc-goods-table">
        <colgroup><col style="width:50%"><col style="width:27%"><col style="width:23%"></colgroup>
        <thead><tr><th>Particulars of Goods</th><th>Truck No.</th><th>Kanta Wt (MTs)</th></tr></thead>
        <tbody>${rows}${fillerRows}</tbody>
      </table>
    </div>
    <div class="dc-total-row">
      <div>Total Kanta Weight:&nbsp; <strong>${Number(c.total_kanta_wt).toFixed(3)} MTs</strong></div>
      <div class="dc-exempt-note">Goods are GST Exempt&nbsp;|&nbsp;No Tax Applicable</div>
    </div>
    ${c.remarks ? `<div class="dc-remarks">Remarks: ${esc(c.remarks)}</div>` : ''}

    <div class="dc-declaration">
      <strong>DECLARATION</strong>
      <p>We hereby declare that the goods described above (Broken Rice / Maize) are exempt from GST as per Notification No. 2/2017-Central Tax (Rate) dated 28.06.2017 and corresponding State GST notification. The said goods fall under HSN Code 1006 / 1005 and are not liable to tax under the CGST Act, 2017 and MGST Act, 2017. This delivery challan is issued under Rule 55 of the CGST Rules, 2017 for the purpose of transportation of goods without a tax invoice, as the supply is exempt from GST. The goods are being dispatched as per the purchase order mentioned above and the consignee is responsible for receipt and acknowledgment of the same.</p>
    </div>
    <div class="dc-declaration">
      <strong>CONSIGNEE DECLARATION</strong>
      <p>This is to certify that the goods specified herein have been dispatched in good condition. The consignee shall verify the quantity and quality upon receipt and acknowledge the same by signing this challan. No claims regarding shortage, damage, or discrepancy shall be entertained after the delivery challan has been duly signed and accepted.</p>
    </div>

    <div class="dc-sign-row">
      <div class="dc-sign-block">
        <div class="dc-sign-line"></div>
        Receiver's Signature
      </div>
      <div class="dc-sign-block dc-sign-right">
        <div class="dc-sign-line"></div>
        For ${companyName}
      </div>
    </div>`;
}

function openPreview(c) {
  previewChallan = c;
  document.getElementById('preview-content').innerHTML = dcPreviewHtml(c, state.company);
  document.getElementById('preview-modal').classList.remove('hidden');
}
document.getElementById('preview-close-btn').addEventListener('click', () => document.getElementById('preview-modal').classList.add('hidden'));
document.getElementById('preview-print-btn').addEventListener('click', () => window.print());

document.getElementById('preview-btn').addEventListener('click', () => {
  const draft = currentChallanDraft();
  if (!draft.party_name) return toast('Party name is required', 'err');
  if (!draft.items.length) return toast('Add at least one item row', 'err');
  openPreview(draft);
});

document.getElementById('generate-btn').addEventListener('click', async () => {
  const draft = currentChallanDraft();
  if (!draft.party_name) return toast('Party name is required', 'err');
  if (!draft.items.length) return toast('Add at least one item row', 'err');

  const btn = document.getElementById('generate-btn');
  btn.disabled = true;
  setSync('saving', 'Saving…');
  try {
    // Assign the real DC number atomically, unless the user manually overrode it.
    if (!dcManualNumber) {
      const { data, error } = await sb.rpc('next_dc_number', { p_po_number: draft.po_number });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      draft.dc_number = row.result_dc_number;
      draft.po_last3 = row.result_po_last3;
      draft.serial = row.result_serial;
    }

    const { data: { user } } = await sb.auth.getUser();
    const insertPayload = { ...draft, created_by: user?.email || null };
    const { data: saved, error: insErr } = await sb.from('challans').insert(insertPayload).select().single();
    if (insErr) throw insErr;

    // Deduct from sauda if selected
    if (draft.broker_sauda_id && draft.broker_deduct) {
      const s = state.saudas.find(x => x.id === draft.broker_sauda_id);
      if (s) {
        const newDeducted = (Number(s.deducted_qty) || 0) + Number(draft.broker_deduct);
        const { error: saudaErr } = await sb.from('saudas').update({ deducted_qty: newDeducted }).eq('id', s.id);
        if (saudaErr) throw saudaErr;
        s.deducted_qty = newDeducted;
      }
    }

    state.challans.unshift(saved);
    renderHistoryTable();
    renderReports();
    renderSaudaDropdown();
    renderSaudaTable();
    setSync('ok', 'Synced');
    toast('DC ' + saved.dc_number + ' saved');
    openPreview(saved);
    clearDcForm();
  } catch (err) {
    console.error(err);
    setSync('error', 'Save failed');
    toast('Could not save: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

// ══════════════════════════════════════════
// DC HISTORY
// ══════════════════════════════════════════
function renderHistoryTable() {
  const tbody = document.getElementById('history-tbody');
  if (!state.challans.length) { tbody.innerHTML = '<tr><td colspan="7">No challans generated yet.</td></tr>'; return; }
  tbody.innerHTML = state.challans.map(c => `
    <tr data-view="${c.id}">
      <td>${esc(c.dc_number)}</td><td>${esc(c.date)}</td><td>${esc(c.party_name)}</td>
      <td>${esc(c.po_number)}</td><td>${esc(c.vehicle)}</td><td>${money(c.grand_total)}</td>
      <td><button class="btn-danger" data-del-challan="${c.id}">Delete</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-view]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-del-challan]')) return;
      const c = state.challans.find(x => x.id === tr.dataset.view);
      if (c) openPreview(c);
    });
  });
  tbody.querySelectorAll('[data-del-challan]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this DC? This cannot be undone.')) return;
    const { error } = await sb.from('challans').delete().eq('id', b.dataset.delChallan);
    if (error) return toast(error.message, 'err');
    state.challans = state.challans.filter(c => c.id !== b.dataset.delChallan);
    renderHistoryTable(); renderReports();
    toast('DC deleted');
  }));
}

// ══════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════
function renderReports() {
  const partyFilter = document.getElementById('report-party-filter').value;
  const poFilter = document.getElementById('report-po-filter').value;
  const party = state.parties.find(p => p.id === partyFilter);

  let filtered = state.challans;
  if (party) filtered = filtered.filter(c => c.party_name === party.name);
  if (poFilter) filtered = filtered.filter(c => c.po_number === poFilter);

  const tbody = document.getElementById('report-tbody');
  tbody.innerHTML = filtered.length ? filtered.map(c => `
    <tr>
      <td>${esc(c.dc_number)}</td><td>${esc(c.date)}</td><td>${esc(c.party_name)}</td>
      <td>${esc(c.po_number)}</td><td>${esc(c.vehicle)}</td><td>${Number(c.total_kanta_wt).toFixed(3)}</td><td>${money(c.grand_total)}</td>
    </tr>`).join('') : '<tr><td colspan="7">No challans match this filter.</td></tr>';

  // PO summary: dispatched = sum of kanta wt of challans against that PO
  const poSummaryBody = document.getElementById('po-summary-tbody');
  if (!state.pos.length) {
    poSummaryBody.innerHTML = '<tr><td colspan="6">No POs found.</td></tr>';
  } else {
    poSummaryBody.innerHTML = state.pos.map(po => {
      const dispatched = state.challans.filter(c => c.po_number === po.po_number).reduce((s, c) => s + (Number(c.total_kanta_wt) || 0), 0);
      const balance = (Number(po.qty) || 0) - dispatched;
      return `<tr><td>${esc(po.po_number)}</td><td>${esc(po.party_name)}</td><td>${esc(po.product)}</td><td>${po.qty}</td><td>${dispatched.toFixed(3)}</td><td>${balance.toFixed(3)}</td></tr>`;
    }).join('');
  }

  const saudaSummaryBody = document.getElementById('sauda-summary-tbody');
  saudaSummaryBody.innerHTML = state.saudas.length ? state.saudas.map(s => `
    <tr><td>${esc(s.broker_name)}</td><td>${esc(s.product)}</td><td>${s.qty}</td><td>${s.deducted_qty}</td><td>${saudaBalance(s).toFixed(3)}</td></tr>
  `).join('') : '<tr><td colspan="5">No saudas found. Add saudas from Sauda (Broker) section.</td></tr>';
}
document.getElementById('report-party-filter').addEventListener('change', renderReports);
document.getElementById('report-po-filter').addEventListener('change', renderReports);

function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
document.getElementById('export-dc-btn').addEventListener('click', () => {
  const rows = [['DC No.', 'Date', 'Party', 'PO No.', 'Vehicle', 'Kanta Wt (MTs)', 'Grand Total']];
  state.challans.forEach(c => rows.push([c.dc_number, c.date, c.party_name, c.po_number, c.vehicle, c.total_kanta_wt, c.grand_total]));
  downloadCsv('dc-history.csv', rows);
});
document.getElementById('export-sauda-btn').addEventListener('click', () => {
  const rows = [['Broker', 'Product', 'Sauda Qty', 'Deducted', 'Balance']];
  state.saudas.forEach(s => rows.push([s.broker_name, s.product, s.qty, s.deducted_qty, saudaBalance(s)]));
  downloadCsv('sauda-summary.csv', rows);
});

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
document.getElementById('dc-date').value = new Date().toISOString().slice(0, 10);
renderItems();
initAuth();
