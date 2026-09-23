// ============================================================
// Ventas, cotizaciones, deudas y clientes
// (se carga después de dashboard.js y usa su `state`, openModal, esc, etc.)
// ============================================================

const PAYMENT_METHODS = ['Efectivo', 'Tarjeta', 'Transferencia bancaria', 'Nequi', 'Daviplata', 'Otros'];
const CONTACT_PHONE_KEY = 'kori_contact_phone';
const DEFAULT_CONTACT_PHONE = '+57 302 3680253';

function todayISO() { return new Date().toLocaleDateString('en-CA'); } // YYYY-MM-DD en hora local
function longDate(d) { return new Date(d).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }); }
function shortDate(d) { return new Date(d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }); }
function dateTimeShort(d) { return new Date(d).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
function money(n) { return Math.round(Number(n) || 0); }
// En computador, la rueda del mouse cambia el valor de un campo numérico
// enfocado (10 → 9 sin querer). Al girarla sobre él, se quita el foco.
document.addEventListener('wheel', e => {
  if (e.target === document.activeElement && e.target.type === 'number') e.target.blur();
}, { passive: true });

function getContactPhone() { try { return localStorage.getItem(CONTACT_PHONE_KEY) || DEFAULT_CONTACT_PHONE; } catch { return DEFAULT_CONTACT_PHONE; } }
function setContactPhone(v) { try { localStorage.setItem(CONTACT_PHONE_KEY, v); } catch {} }

// ------------------------------------------------------------
// Chips (botones tipo "píldora" para elegir una opción)
// ------------------------------------------------------------
function chipsHTML(group, options, selected) {
  return `<div class="chip-group" data-chip-group="${group}">${options.map(o => {
    const [value, label] = Array.isArray(o) ? o : [o, o];
    return `<button type="button" class="chip ${value === selected ? 'active' : ''}" data-value="${esc(value)}">${esc(label)}</button>`;
  }).join('')}</div>`;
}
function getChip(group) {
  const el = qs(`[data-chip-group="${group}"] .chip.active`);
  return el ? el.dataset.value : null;
}
document.addEventListener('click', e => {
  const chip = e.target.closest('[data-chip-group] .chip');
  if (!chip) return;
  const group = chip.closest('[data-chip-group]');
  qsa('.chip', group).forEach(c => c.classList.toggle('active', c === chip));
  group.dispatchEvent(new CustomEvent('chipchange', { bubbles: true, detail: chip.dataset.value }));
});

// ------------------------------------------------------------
// Selector de cliente (elige uno existente o crea uno nuevo ahí mismo)
// ------------------------------------------------------------
function clientPickerHTML(selectedId, { label = 'Cliente', emptyLabel = 'Sin cliente' } = {}) {
  const clients = (state.clients || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  return `
    <div class="field">
      <label>${label}</label>
      <select id="cp-select">
        <option value="">${emptyLabel}</option>
        <option value="__new">＋ Crear cliente nuevo</option>
        ${clients.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}</option>`).join('')}
      </select>
      <div id="cp-new" class="inline-new hidden">
        <input type="text" id="cp-new-name" placeholder="Nombre del cliente" autocomplete="off">
        <input type="tel" id="cp-new-phone" placeholder="Teléfono (opcional)" inputmode="tel">
      </div>
    </div>`;
}
function bindClientPicker() {
  const sel = qs('#cp-select');
  sel.addEventListener('change', () => {
    qs('#cp-new').classList.toggle('hidden', sel.value !== '__new');
    if (sel.value === '__new') qs('#cp-new-name').focus();
  });
}
// Devuelve { client_id, client_name } y crea el cliente si es nuevo.
async function readClientPicker({ required = false } = {}) {
  const val = qs('#cp-select').value;
  if (val === '__new') {
    const name = qs('#cp-new-name').value.trim();
    const phone = qs('#cp-new-phone').value.trim();
    if (!name) throw new Error('Escribe el nombre del cliente nuevo.');
    const { data, error } = await supabase.from('clients').insert({ name, phone: phone || null }).select().single();
    if (error) throw error;
    state.clients = [data, ...(state.clients || [])];
    genericRender('clients');
    return { client_id: data.id, client_name: data.name };
  }
  if (!val) {
    if (required) throw new Error('Elige o crea un cliente.');
    return { client_id: null, client_name: null };
  }
  const c = (state.clients || []).find(c => c.id === val);
  return { client_id: val, client_name: c ? c.name : null };
}

// ------------------------------------------------------------
// Editor de productos (buscar, tocar para agregar, editar cantidad y precio)
// ------------------------------------------------------------
function createLineEditor(root, initialLines, { onChange, showStock = false } = {}) {
  let lines = (initialLines || []).map(l => ({ ...l }));
  const catalog = (state.products || []).filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name));

  root.innerHTML = `
    <div class="picker">
      <input type="search" class="picker-search" placeholder="🔍 Buscar producto para agregar..." autocomplete="off">
      <div class="picker-results"></div>
    </div>
    <div class="lines"></div>
  `;
  const search = qs('.picker-search', root);
  const results = qs('.picker-results', root);
  const linesEl = qs('.lines', root);

  function renderResults() {
    const term = search.value.trim().toLowerCase();
    const list = (term ? catalog.filter(p => p.name.toLowerCase().includes(term)) : catalog).slice(0, 60);
    results.innerHTML = list.length ? list.map(p => `
      <button type="button" class="pick-item" data-pick="${p.id}">
        ${p.image_url ? `<img src="${p.image_url}" alt="" loading="lazy">` : '<span class="pick-ph">💄</span>'}
        <span class="pick-info"><span class="pick-name">${esc(p.name)}</span><span class="pick-meta">${formatPrice(p.price)} · ${p.stock > 0 ? `${p.stock} disp.` : 'agotado'}</span></span>
        <span class="pick-add">＋</span>
      </button>`).join('') : '<p class="empty-mini">Sin resultados</p>';
  }

  function lineTotal(l) { return money(l.qty * l.price); }

  function renderLines(silent) {
    if (!lines.length) {
      linesEl.innerHTML = '<p class="empty-mini">Toca un producto de la lista para agregarlo.</p>';
    } else {
      linesEl.innerHTML = lines.map((l, i) => {
        const p = catalog.find(x => x.id === l.product_id);
        const overStock = showStock && p && l.qty > p.stock;
        return `
        <div class="line-edit">
          <div class="line-edit-top">
            <strong>${esc(l.name)}</strong>
            <button type="button" class="icon-x" data-rm="${i}" aria-label="Quitar">✕</button>
          </div>
          <div class="line-edit-controls">
            <div class="stepper">
              <button type="button" data-dec="${i}" aria-label="Menos">−</button>
              <input type="number" inputmode="numeric" min="1" value="${l.qty}" data-qty="${i}" aria-label="Cantidad">
              <button type="button" data-inc="${i}" aria-label="Más">+</button>
            </div>
            <label class="price-edit"><span>$</span><input type="number" inputmode="numeric" min="0" step="100" value="${l.price}" data-price="${i}" aria-label="Precio unitario"></label>
            <strong class="line-total" data-total="${i}">${formatPrice(lineTotal(l))}</strong>
          </div>
          ${overStock ? `<p class="warn-mini" data-warn="${i}">Solo hay ${p.stock} en stock</p>` : `<p class="warn-mini hidden" data-warn="${i}"></p>`}
        </div>`;
      }).join('');
    }
    if (!silent && onChange) onChange();
  }

  function refreshLine(i) {
    const t = qs(`[data-total="${i}"]`, linesEl);
    if (t) t.textContent = formatPrice(lineTotal(lines[i]));
    const w = qs(`[data-warn="${i}"]`, linesEl);
    const p = catalog.find(x => x.id === lines[i].product_id);
    if (w && showStock && p) {
      const over = lines[i].qty > p.stock;
      w.classList.toggle('hidden', !over);
      w.textContent = over ? `Solo hay ${p.stock} en stock` : '';
    }
    onChange && onChange();
  }

  search.addEventListener('input', renderResults);
  results.addEventListener('click', e => {
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    const p = catalog.find(x => x.id === btn.dataset.pick);
    const existing = lines.find(l => l.product_id === p.id);
    if (existing) existing.qty += 1;
    else lines.push({ product_id: p.id, name: p.name, qty: 1, price: money(p.price) });
    btn.classList.add('picked');
    setTimeout(() => btn.classList.remove('picked'), 400);
    renderLines();
  });
  linesEl.addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    if (rm) { lines.splice(Number(rm.dataset.rm), 1); renderLines(); }
    else if (inc) { const i = Number(inc.dataset.inc); lines[i].qty += 1; qs(`[data-qty="${i}"]`, linesEl).value = lines[i].qty; refreshLine(i); }
    else if (dec) { const i = Number(dec.dataset.dec); lines[i].qty = Math.max(1, lines[i].qty - 1); qs(`[data-qty="${i}"]`, linesEl).value = lines[i].qty; refreshLine(i); }
  });
  linesEl.addEventListener('input', e => {
    if (e.target.dataset.qty !== undefined) {
      const i = Number(e.target.dataset.qty);
      lines[i].qty = Math.max(1, Math.floor(Number(e.target.value)) || 1);
      refreshLine(i);
    } else if (e.target.dataset.price !== undefined) {
      const i = Number(e.target.dataset.price);
      lines[i].price = Math.max(0, money(e.target.value));
      refreshLine(i);
    }
  });
  linesEl.addEventListener('change', e => {
    if (e.target.dataset.qty !== undefined) e.target.value = lines[Number(e.target.dataset.qty)].qty;
  });

  renderResults();
  renderLines(true); // sin onChange: quien llama aún no tiene la referencia al editor
  return {
    get lines() { return lines; },
    get subtotal() { return lines.reduce((s, l) => s + lineTotal(l), 0); },
  };
}

// ------------------------------------------------------------
// Descuento (sin descuento, porcentaje o valor fijo en pesos)
// ------------------------------------------------------------
function discountHTML(type = 'none', value = 0) {
  return `
    <div class="field">
      <label>Descuento</label>
      ${chipsHTML('disc-type', [['none', 'Sin descuento'], ['percent', '%'], ['amount', '$ Pesos']], type)}
      <div class="disc-value ${type === 'none' ? 'hidden' : ''}" id="disc-value-wrap">
        <input type="number" inputmode="numeric" min="0" id="disc-value" value="${type === 'none' ? '' : value}" placeholder="${type === 'percent' ? 'Ej: 10' : 'Ej: 5000'}">
        <span id="disc-suffix">${type === 'percent' ? '%' : 'COP'}</span>
      </div>
    </div>`;
}
function bindDiscount(onChange) {
  const group = qs('[data-chip-group="disc-type"]');
  group.addEventListener('chipchange', e => {
    const t = e.detail;
    qs('#disc-value-wrap').classList.toggle('hidden', t === 'none');
    qs('#disc-suffix').textContent = t === 'percent' ? '%' : 'COP';
    qs('#disc-value').placeholder = t === 'percent' ? 'Ej: 10' : 'Ej: 5000';
    if (t !== 'none') qs('#disc-value').focus();
    onChange();
  });
  qs('#disc-value').addEventListener('input', onChange);
}
function readDiscount(subtotal) {
  const type = getChip('disc-type') || 'none';
  const value = type === 'none' ? 0 : Math.max(0, Number(qs('#disc-value').value) || 0);
  let amount = type === 'percent' ? subtotal * Math.min(value, 100) / 100 : type === 'amount' ? value : 0;
  amount = Math.min(money(amount), subtotal);
  return { type, value, amount };
}

function totalsHTML() {
  return `
    <div class="totals-box">
      <div class="totals-row"><span>Subtotal</span><span id="t-sub">$ 0</span></div>
      <div class="totals-row totals-disc hidden" id="t-disc-row"><span>Descuento</span><span id="t-disc">−$ 0</span></div>
      <div class="totals-row totals-grand"><span>Total</span><span id="t-total">$ 0</span></div>
    </div>`;
}
function paintTotals(subtotal, discount) {
  qs('#t-sub').textContent = formatPrice(subtotal);
  qs('#t-disc-row').classList.toggle('hidden', !discount);
  qs('#t-disc').textContent = '−' + formatPrice(discount);
  qs('#t-total').textContent = formatPrice(subtotal - discount);
}

// ============================================================
// Datos
// ============================================================
async function loadClients() { await genericLoad('clients'); }

async function loadTransactions() {
  const { data } = await supabase.from('transactions').select('*').order('created_at', { ascending: false });
  state.transactions = data || [];
  renderTransactions();
}

async function loadQuotes() {
  const { data } = await supabase.from('quotes').select('*').order('created_at', { ascending: false });
  state.quotes = data || [];
  renderQuotes();
}

async function loadDebts() {
  const { data } = await supabase.from('debts').select('*, debt_payments(*)').order('created_at', { ascending: false });
  state.debts = (data || []).map(d => {
    const payments = (d.debt_payments || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
    return { ...d, payments, paid, remaining: Math.max(0, Number(d.total) - paid) };
  });
  renderDebts();
  genericRender('clients'); // la columna "Debe" depende de las deudas
}

function clientBalance(clientId) {
  return (state.debts || []).filter(d => d.client_id === clientId).reduce((s, d) => s + d.remaining, 0);
}

async function refreshVentas() {
  await Promise.all([loadTransactions(), loadDebts(), loadQuotes(), loadProducts()]);
  loadStats();
}

async function loadVentasModule() {
  await Promise.all([loadClients(), loadTransactions(), loadQuotes(), loadDebts()]);
}

// Agrupa las filas de una misma venta (comparten sale_id).
function groupedSales(type) {
  const groups = new Map();
  (state.transactions || []).forEach(r => {
    if (type && r.type !== type) return;
    const key = r.type === 'venta' ? (r.sale_id || r.id) : r.id;
    if (!groups.has(key)) groups.set(key, { key, type: r.type, created_at: r.created_at, rows: [], total: 0, discount: 0 });
    const g = groups.get(key);
    g.rows.push(r);
    g.total += Number(r.amount) || 0;
    g.discount += Number(r.discount) || 0;
    if (new Date(r.created_at) < new Date(g.created_at)) g.created_at = r.created_at;
  });
  return [...groups.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}
function saleClientName(g) {
  const id = g.rows.find(r => r.client_id)?.client_id;
  const c = id && (state.clients || []).find(c => c.id === id);
  return c ? c.name : null;
}
function saleDebt(g) {
  return g.type === 'venta' ? (state.debts || []).find(d => d.sale_id && d.sale_id === g.key) : null;
}
function lineName(r) {
  if (r.product_id) {
    const p = (state.products || []).find(p => p.id === r.product_id);
    if (p) return p.name;
  }
  return String(r.concept || '').replace(/\s×\s\d+$/, '') || 'Producto';
}

// ============================================================
// Resumen
// ============================================================
function loadStats() {
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
  const monthRows = (state.transactions || []).filter(t => new Date(t.created_at) >= start);
  const sales = monthRows.filter(t => t.type === 'venta');
  const revenue = sales.reduce((s, t) => s + Number(t.amount), 0);
  const cogs = sales.reduce((s, t) => {
    const p = (state.products || []).find(p => p.id === t.product_id);
    return s + (p ? Number(p.cost_price || 0) * (t.quantity || 0) : 0);
  }, 0);
  const gastos = monthRows.filter(t => t.type === 'gasto').reduce((s, t) => s + Number(t.amount), 0);
  const net = revenue - cogs - gastos;
  const saleCount = new Set(sales.map(s => s.sale_id || s.id)).size;
  const porCobrar = (state.debts || []).reduce((s, d) => s + d.remaining, 0);
  const pendingOrders = (state.orders || []).filter(o => o.status === 'pendiente').length;
  const monthName = new Date().toLocaleDateString('es-CO', { month: 'long' });

  qs('#summary-month').textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  qs('#kpi-hero').innerHTML = `
    <div class="kpi-big">
      <span class="kpi-label">Ventas del mes</span>
      <span class="kpi-num">${formatPrice(revenue)}</span>
      <span class="kpi-foot">${saleCount} venta${saleCount === 1 ? '' : 's'}</span>
    </div>
    <div class="kpi-big ${net >= 0 ? 'kpi-good' : 'kpi-bad'}">
      <span class="kpi-label">Ganancia neta</span>
      <span class="kpi-num">${formatPrice(net)}</span>
      <span class="kpi-foot">después de costos y gastos</span>
    </div>`;
  qs('#stat-grid').innerHTML = `
    <div class="kpi"><span class="kpi-label">Gastos</span><span class="kpi-num">${formatPrice(gastos)}</span></div>
    <div class="kpi"><span class="kpi-label">Costo de lo vendido</span><span class="kpi-num">${formatPrice(cogs)}</span></div>
    <button class="kpi kpi-link ${porCobrar > 0 ? 'kpi-warn' : ''}" data-goto="deudas"><span class="kpi-label">Por cobrar</span><span class="kpi-num">${formatPrice(porCobrar)}</span></button>
    <button class="kpi kpi-link" data-goto="pedidos"><span class="kpi-label">Pedidos pendientes</span><span class="kpi-num">${pendingOrders}</span></button>`;

  const recent = groupedSales('venta').slice(0, 5);
  qs('#recent-sales').innerHTML = recent.length ? recent.map(saleCardHTML).join('') : '<p class="empty-state">Todavía no hay ventas registradas.</p>';
}

// ============================================================
// Ventas y gastos: listado
// ============================================================
let txFilter = 'all';
function saleCardHTML(g) {
  if (g.type === 'gasto') {
    const r = g.rows[0];
    return `
      <div class="entry-card">
        <div class="entry-main">
          <span class="entry-title">${esc(r.concept || 'Gasto')}</span>
          <span class="entry-sub">${dateTimeShort(g.created_at)}${r.payment_method ? ' · ' + esc(r.payment_method) : ''}${r.category ? ' · ' + esc(r.category) : ''}</span>
        </div>
        <div class="entry-side">
          <span class="entry-amount amount-neg">−${formatPrice(g.total)}</span>
          <button class="btn-mini" data-tx-del="${g.key}">Eliminar</button>
        </div>
      </div>`;
  }
  const client = saleClientName(g);
  const debt = saleDebt(g);
  const method = g.rows[0].payment_method;
  const items = g.rows.map(r => `${esc(lineName(r))} ×${r.quantity || 1}`).join(', ');
  return `
    <div class="entry-card">
      <div class="entry-main">
        <span class="entry-title">${client ? esc(client) : 'Venta de mostrador'}</span>
        <span class="entry-sub">${dateTimeShort(g.created_at)} · ${esc(g.rows[0].receipt_number || '')}</span>
        <span class="entry-items">${items}</span>
        <span class="entry-tags">
          ${method ? `<span class="tag tag-neutral">${esc(method)}</span>` : ''}
          ${g.discount > 0 ? `<span class="tag tag-neutral">Desc. ${formatPrice(g.discount)}</span>` : ''}
          ${debt ? (debt.remaining > 0 ? `<span class="tag tag-orange">Debe ${formatPrice(debt.remaining)}</span>` : '<span class="tag tag-green">Pagada</span>') : ''}
        </span>
      </div>
      <div class="entry-side">
        <span class="entry-amount">${formatPrice(g.total)}</span>
        <div class="entry-actions">
          <button class="btn-mini" data-sale-doc="${g.key}">📄 Recibo</button>
          <button class="btn-mini" data-tx-del="${g.key}">Eliminar</button>
        </div>
      </div>
    </div>`;
}

function renderTransactions() {
  const wrap = qs('#tx-list');
  if (!wrap) return;
  const list = groupedSales(txFilter === 'all' ? null : txFilter);
  wrap.innerHTML = list.length ? list.map(saleCardHTML).join('') : '<p class="empty-state">No hay movimientos todavía.</p>';
}

qs('#tx-filter').addEventListener('click', e => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  txFilter = b.dataset.filter;
  qsa('#tx-filter button').forEach(x => x.classList.toggle('active', x === b));
  renderTransactions();
});

document.addEventListener('click', async e => {
  const del = e.target.closest('[data-tx-del]');
  if (del) {
    const g = groupedSales().find(g => g.key === del.dataset.txDel);
    if (!g) return;
    const debt = saleDebt(g);
    const msg = g.type === 'venta'
      ? `¿Eliminar esta venta de ${formatPrice(g.total)}? El stock de sus productos se devuelve al inventario.${debt ? '\n\nTambién se eliminará la deuda asociada.' : ''}`
      : `¿Eliminar este gasto de ${formatPrice(g.total)}?`;
    if (!confirm(msg)) return;
    const { error } = await supabase.from('transactions').delete().in('id', g.rows.map(r => r.id));
    if (error) return alert('Error: ' + error.message);
    if (debt) await supabase.from('debts').delete().eq('id', debt.id);
    refreshVentas();
    return;
  }
  const doc = e.target.closest('[data-sale-doc]');
  if (doc) {
    const g = groupedSales('venta').find(g => g.key === doc.dataset.saleDoc);
    if (!g) return;
    const debt = saleDebt(g);
    const subtotal = g.rows.reduce((s, r) => s + (r.unit_price != null ? Number(r.unit_price) * (r.quantity || 1) : Number(r.amount) + Number(r.discount || 0)), 0);
    openDocPreview({
      title: 'Comprobante de venta',
      date: g.created_at,
      contact_phone: getContactPhone(),
      client_name: saleClientName(g),
      payment_method: g.rows[0].payment_method,
      payment_status: debt && debt.remaining > 0 ? 'pendiente' : 'pagada',
      transaction_ref: g.rows[0].receipt_number,
      items: g.rows.map(r => ({
        name: lineName(r), qty: r.quantity || 1,
        price: r.unit_price != null ? Number(r.unit_price) : (Number(r.amount) + Number(r.discount || 0)) / (r.quantity || 1),
      })),
      subtotal, discount_amount: g.discount, total: g.total,
      filename: `Recibo-Kori-${g.rows[0].receipt_number || todayISO()}`,
    });
  }
});

// ============================================================
// Registrar venta o gasto
// ============================================================
function openSaleModal(initialType = 'venta') {
  openModal(`
    <div class="modal-head">
      <h3>Registrar</h3>
      <button class="modal-x" data-close-modal aria-label="Cerrar">✕</button>
    </div>
    ${chipsHTML('tx-type', [['venta', '💵 Venta'], ['gasto', '🧾 Gasto']], initialType)}

    <div id="sale-section">
      ${clientPickerHTML(null, { emptyLabel: 'Venta de mostrador (sin cliente)' })}
      <div class="field"><label>Productos</label><div id="sale-lines"></div></div>
      ${discountHTML()}
      <div class="field"><label>Método de pago</label>${chipsHTML('sale-method', PAYMENT_METHODS, 'Efectivo')}</div>
      <div class="field">
        <label>¿Ya pagó?</label>
        ${chipsHTML('sale-status', [['pagada', '✅ Pagada'], ['pendiente', '⏳ Queda debiendo']], 'pagada')}
        <div id="sale-debt-box" class="inline-new hidden">
          <p class="hint">Se creará una deuda a nombre del cliente por lo que falte.</p>
          <input type="number" inputmode="numeric" min="0" id="sale-advance" placeholder="Abono inicial (opcional)">
        </div>
      </div>
      <div class="field"><label>Notas (opcional)</label><input type="text" id="sale-notes"></div>
    </div>

    <div id="expense-section" class="hidden">
      <div class="field"><label>Concepto</label><input type="text" id="exp-concept" placeholder="Ej: Envío, empaques, publicidad"></div>
      <div class="field"><label>Monto</label><input type="number" inputmode="numeric" min="0" id="exp-amount" placeholder="0"></div>
      <div class="field"><label>Método de pago</label>${chipsHTML('exp-method', PAYMENT_METHODS, 'Efectivo')}</div>
      <div class="field"><label>Categoría (opcional)</label><input type="text" id="exp-category"></div>
      <div class="field"><label>Notas (opcional)</label><input type="text" id="exp-notes"></div>
    </div>

    <div class="modal-footer">
      <div id="sale-totals">${totalsHTML()}</div>
      <button type="button" class="btn btn-primary btn-block" id="btn-save-tx">Guardar</button>
    </div>
  `, { wide: true });

  bindClientPicker();
  const editor = createLineEditor(qs('#sale-lines'), [], { onChange: update, showStock: true });
  bindDiscount(update);

  function update() {
    const sub = editor.subtotal;
    paintTotals(sub, readDiscount(sub).amount);
  }
  update();

  function syncType() {
    const isSale = getChip('tx-type') === 'venta';
    qs('#sale-section').classList.toggle('hidden', !isSale);
    qs('#sale-totals').classList.toggle('hidden', !isSale);
    qs('#expense-section').classList.toggle('hidden', isSale);
  }
  qs('[data-chip-group="tx-type"]').addEventListener('chipchange', syncType);
  qs('[data-chip-group="sale-status"]').addEventListener('chipchange', e => {
    qs('#sale-debt-box').classList.toggle('hidden', e.detail !== 'pendiente');
  });
  syncType();

  qs('#btn-save-tx').addEventListener('click', async () => {
    const btn = qs('#btn-save-tx');
    btn.disabled = true;
    try {
      if (getChip('tx-type') === 'gasto') await saveExpense();
      else await saveSale(editor);
      closeModal();
      refreshVentas();
    } catch (err) {
      alert(err.message || err);
    } finally {
      btn.disabled = false;
    }
  });
}

async function saveExpense() {
  const concept = qs('#exp-concept').value.trim();
  const amount = money(qs('#exp-amount').value);
  if (!concept) throw new Error('Escribe el concepto del gasto.');
  if (!amount) throw new Error('Escribe el monto del gasto.');
  const { error } = await supabase.from('transactions').insert({
    type: 'gasto', concept, amount, payment_method: getChip('exp-method'),
    category: qs('#exp-category').value.trim() || null, notes: qs('#exp-notes').value.trim() || null,
  });
  if (error) throw error;
}

async function saveSale(editor) {
  const lines = editor.lines;
  if (!lines.length) throw new Error('Agrega al menos un producto a la venta.');
  const pending = getChip('sale-status') === 'pendiente';
  const client = await readClientPicker({ required: pending });
  const subtotal = editor.subtotal;
  const disc = readDiscount(subtotal);
  const total = subtotal - disc.amount;

  // El descuento se reparte entre los productos en proporción a su valor,
  // para que la suma de las filas sea exactamente lo que pagó el cliente.
  let assigned = 0;
  const sale_id = crypto.randomUUID();
  const notes = qs('#sale-notes').value.trim() || null;
  const rows = lines.map((l, i) => {
    const lineSub = money(l.qty * l.price);
    const share = i === lines.length - 1 ? disc.amount - assigned : (subtotal ? money(disc.amount * lineSub / subtotal) : 0);
    assigned += share;
    return {
      type: 'venta', concept: `${l.name} × ${l.qty}`, product_id: l.product_id, quantity: l.qty,
      unit_price: l.price, discount: share, amount: lineSub - share,
      payment_method: getChip('sale-method'), client_id: client.client_id, sale_id, notes,
    };
  });
  const { data: inserted, error } = await supabase.from('transactions').insert(rows).select('receipt_number');
  if (error) throw error;

  if (pending) {
    const advance = Math.min(money(qs('#sale-advance').value), total);
    const { data: debt, error: dErr } = await supabase.from('debts').insert({
      client_id: client.client_id, client_name: client.client_name,
      concept: `Venta ${inserted?.[0]?.receipt_number || ''}: ${lines.map(l => `${l.name} ×${l.qty}`).join(', ')}`.slice(0, 300),
      total, sale_id,
    }).select().single();
    if (dErr) throw new Error('La venta se guardó, pero no se pudo crear la deuda: ' + dErr.message);
    if (advance > 0) {
      await supabase.from('debt_payments').insert({ debt_id: debt.id, amount: advance, payment_method: getChip('sale-method'), notes: 'Abono inicial' });
    }
  }
}

qs('#btn-new-transaction').addEventListener('click', () => openSaleModal('venta'));

// ============================================================
// Cotizaciones
// ============================================================
function quoteItems(q) {
  return (q.items || []).map(i => ({
    product_id: i.product_id || null,
    name: i.name || i.description || 'Producto',
    qty: Number(i.qty) || 1,
    price: money(i.price),
  }));
}

function renderQuotes() {
  const wrap = qs('#quotes-list');
  if (!wrap) return;
  const list = state.quotes || [];
  if (!list.length) {
    wrap.innerHTML = `<div class="empty-card"><p>Todavía no tienes cotizaciones.</p><button class="btn btn-primary btn-sm" data-quick="cotizacion">Crear la primera</button></div>`;
    return;
  }
  wrap.innerHTML = list.map(q => {
    const items = quoteItems(q);
    const paid = (q.payment_status || q.status) === 'pagada';
    return `
      <div class="entry-card">
        <div class="entry-main">
          <span class="entry-title">${q.client_name ? esc(q.client_name) : 'Sin cliente'}</span>
          <span class="entry-sub">${shortDate(q.created_at)}${q.quote_number ? ' · ' + esc(q.quote_number) : ''} · ${items.length} producto${items.length === 1 ? '' : 's'}</span>
          <span class="entry-tags">
            <span class="tag ${paid ? 'tag-green' : 'tag-orange'}">${paid ? 'Pagada' : 'Pendiente'}</span>
            ${q.payment_method ? `<span class="tag tag-neutral">${esc(q.payment_method)}</span>` : ''}
          </span>
        </div>
        <div class="entry-side">
          <span class="entry-amount">${formatPrice(q.total)}</span>
          <div class="entry-actions">
            <button class="btn-mini btn-mini-primary" data-quote-share="${q.id}">📤 Enviar</button>
            <button class="btn-mini" data-quote-edit="${q.id}">Editar</button>
            <button class="btn-mini" data-quote-del="${q.id}">Eliminar</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function quoteToDoc(q) {
  const items = quoteItems(q);
  const subtotal = q.subtotal ? Number(q.subtotal) : items.reduce((s, i) => s + i.qty * i.price, 0);
  return {
    title: 'Cotización',
    date: q.created_at,
    contact_phone: q.contact_phone || getContactPhone(),
    client_name: q.client_name,
    payment_method: q.payment_method,
    payment_status: q.payment_status || (q.status === 'pagada' ? 'pagada' : 'pendiente'),
    transaction_ref: q.transaction_ref,
    items, subtotal,
    discount_amount: Number(q.discount_amount) || 0,
    total: Number(q.total) || 0,
    filename: `Cotizacion-Kori-${q.quote_number || todayISO()}`,
  };
}

function openQuoteModal(row) {
  const q = row || {};
  const dateVal = row ? new Date(row.created_at).toLocaleDateString('en-CA') : todayISO();
  openModal(`
    <div class="modal-head">
      <h3>${row ? 'Editar' : 'Nueva'} cotización</h3>
      <button class="modal-x" data-close-modal aria-label="Cerrar">✕</button>
    </div>

    <div class="form-grid form-grid-2">
      <div class="field"><label>Fecha</label><input type="date" id="q-date" value="${dateVal}"></div>
      <div class="field"><label>Contacto</label><input type="tel" id="q-phone" inputmode="tel" placeholder="Ej: 300 123 4567" value="${esc(q.contact_phone || getContactPhone())}"></div>
    </div>
    ${clientPickerHTML(q.client_id, { label: 'Cliente (opcional)', emptyLabel: q.client_name && !q.client_id ? q.client_name : 'Sin cliente' })}

    <div class="field"><label>Productos</label><div id="q-lines"></div></div>
    ${discountHTML(q.discount_type || 'none', q.discount_value || 0)}

    <div class="field"><label>Método de pago</label>${chipsHTML('q-method', PAYMENT_METHODS, q.payment_method || 'Efectivo')}</div>
    <div class="field"><label>Estado del pago</label>${chipsHTML('q-status', [['pendiente', '⏳ Pendiente'], ['pagada', '✅ Pagada']], q.payment_status || 'pendiente')}</div>
    <div class="field"><label>Número de transacción (opcional)</label><input type="text" id="q-ref" placeholder="Ej: referencia Nequi o comprobante" value="${esc(q.transaction_ref || '')}"></div>

    <div class="modal-footer">
      ${totalsHTML()}
      <div class="footer-actions">
        <button type="button" class="btn btn-outline" id="btn-q-save">Guardar</button>
        <button type="button" class="btn btn-primary" id="btn-q-share">Enviar 📤</button>
      </div>
    </div>
  `, { wide: true });

  bindClientPicker();
  const editor = createLineEditor(qs('#q-lines'), row ? quoteItems(row) : [], { onChange: update });
  bindDiscount(update);
  function update() { const sub = editor.subtotal; paintTotals(sub, readDiscount(sub).amount); }
  update();

  async function save(andShare) {
    const buttons = [qs('#btn-q-save'), qs('#btn-q-share')];
    buttons.forEach(b => b.disabled = true);
    try {
      if (!editor.lines.length) throw new Error('Agrega al menos un producto a la cotización.');
      const phone = qs('#q-phone').value.trim();
      if (!phone) throw new Error('Escribe el número de contacto que aparecerá en la cotización.');
      setContactPhone(phone);
      let client = await readClientPicker();
      // Si la cotización ya traía un nombre escrito a mano y no se cambió, se conserva.
      if (!client.client_id && !client.client_name && row && row.client_name && !row.client_id && qs('#cp-select').value === '') {
        client = { client_id: null, client_name: row.client_name };
      }
      const subtotal = editor.subtotal;
      const disc = readDiscount(subtotal);
      const payment_status = getChip('q-status');
      const payload = {
        client_id: client.client_id,
        client_name: client.client_name,
        items: editor.lines.map(l => ({ product_id: l.product_id, name: l.name, qty: l.qty, price: l.price })),
        subtotal,
        discount_type: disc.type, discount_value: disc.value, discount_amount: disc.amount,
        total: subtotal - disc.amount,
        payment_method: getChip('q-method'),
        payment_status, status: payment_status,
        transaction_ref: qs('#q-ref').value.trim() || null,
        contact_phone: phone,
        created_at: new Date(`${qs('#q-date').value || todayISO()}T12:00:00`).toISOString(),
      };
      const query = row
        ? supabase.from('quotes').update(payload).eq('id', row.id).select().single()
        : supabase.from('quotes').insert(payload).select().single();
      const { data, error } = await query;
      if (error) throw error;
      await loadQuotes();
      if (andShare) openDocPreview(quoteToDoc(data));
      else closeModal();
    } catch (err) {
      alert(err.message || err);
      buttons.forEach(b => b.disabled = false);
    }
  }
  qs('#btn-q-save').addEventListener('click', () => save(false));
  qs('#btn-q-share').addEventListener('click', () => save(true));
}

qs('#btn-new-quote').addEventListener('click', () => openQuoteModal(null));
document.addEventListener('click', async e => {
  const share = e.target.closest('[data-quote-share]');
  const edit = e.target.closest('[data-quote-edit]');
  const del = e.target.closest('[data-quote-del]');
  const find = id => (state.quotes || []).find(q => q.id === id);
  if (share) openDocPreview(quoteToDoc(find(share.dataset.quoteShare)));
  else if (edit) openQuoteModal(find(edit.dataset.quoteEdit));
  else if (del) {
    if (!confirm('¿Eliminar esta cotización?')) return;
    const { error } = await supabase.from('quotes').delete().eq('id', del.dataset.quoteDel);
    if (error) return alert('Error: ' + error.message);
    loadQuotes();
  }
});

// ------------------------------------------------------------
// Documento (cotización / recibo) → imagen PNG o PDF
// ------------------------------------------------------------
function quoteDocHTML(d) {
  const paid = d.payment_status === 'pagada';
  return `
    <div class="qdoc">
      <div class="qdoc-head">
        <div class="qdoc-brand">
          <img src="logo.png" alt="">
          <div><div class="qdoc-name">Kori Cosmetics</div><div class="qdoc-kind">${esc(d.title)}</div></div>
        </div>
        <div class="qdoc-headinfo">
          <div><span>Fecha</span><strong>${longDate(d.date)}</strong></div>
          <div><span>Contacto</span><strong>${esc(d.contact_phone || '—')}</strong></div>
        </div>
      </div>

      ${d.client_name ? `<div class="qdoc-client"><span>Cliente</span><strong>${esc(d.client_name)}</strong></div>` : ''}

      <div class="qdoc-meta">
        <div><span>Método de pago</span><strong>${esc(d.payment_method || '—')}</strong></div>
        <div><span>Estado de pago</span><strong class="qdoc-status ${paid ? 'is-paid' : 'is-pending'}">${paid ? 'Pagada' : 'Pendiente'}</strong></div>
        <div><span>N° de transacción</span><strong>${esc(d.transaction_ref || '—')}</strong></div>
      </div>

      <table class="qdoc-table">
        <thead><tr><th>Producto</th><th class="c">Cant.</th><th class="r">Precio unitario</th><th class="r">Total</th></tr></thead>
        <tbody>
          ${d.items.map(i => `<tr><td>${esc(i.name)}</td><td class="c">${i.qty}</td><td class="r">${formatPrice(i.price)}</td><td class="r">${formatPrice(i.qty * i.price)}</td></tr>`).join('')}
        </tbody>
      </table>

      <div class="qdoc-totals">
        ${d.discount_amount > 0 ? `
          <div><span>Subtotal</span><span>${formatPrice(d.subtotal)}</span></div>
          <div><span>Descuento</span><span>−${formatPrice(d.discount_amount)}</span></div>` : ''}
        <div class="qdoc-grand"><span>Total</span><span>${formatPrice(d.total)}</span></div>
      </div>

      <div class="qdoc-foot">Gracias por elegir Kori Cosmetics 💜</div>
    </div>`;
}

async function renderDocCanvas(d) {
  const host = qs('#quote-render-host');
  host.innerHTML = quoteDocHTML(d);
  const el = host.firstElementChild;
  await Promise.all([...el.querySelectorAll('img')].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
  host.innerHTML = '';
  return canvas;
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise(res => canvas.toBlob(res, type, quality));
}

function canvasToPdfBlob(canvas) {
  const { jsPDF } = window.jspdf;
  const w = 595; // ancho A4 en puntos; el alto se ajusta al contenido (una sola página)
  const h = Math.ceil(canvas.height * w / canvas.width);
  const pdf = new jsPDF({ unit: 'pt', format: [w, h], orientation: h >= w ? 'portrait' : 'landscape' });
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, h);
  return pdf.output('blob');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Kori Cosmetics' }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  downloadBlob(blob, filename);
}

// La imagen y el PDF se preparan apenas se abre la vista previa, para que al
// tocar "Enviar" el menú de compartir del celular (WhatsApp, etc.) abra al instante.
async function openDocPreview(d) {
  const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] }));
  openModal(`
    <div class="modal-head">
      <h3>${esc(d.title)}</h3>
      <button class="modal-x" data-close-modal aria-label="Cerrar">✕</button>
    </div>
    <div class="doc-preview" id="doc-preview"><p class="loader">Preparando documento...</p></div>
    <div class="modal-footer">
      <p class="footer-label">${canShareFiles ? 'Enviar como' : 'Descargar como'}</p>
      <div class="footer-actions">
        <button class="btn btn-primary" id="doc-img" disabled>📷 Imagen</button>
        <button class="btn btn-primary" id="doc-pdf" disabled>📄 PDF</button>
      </div>
      ${canShareFiles ? `<div class="footer-links"><button class="link-btn" id="doc-img-dl" disabled>Descargar imagen</button><button class="link-btn" id="doc-pdf-dl" disabled>Descargar PDF</button></div>` : ''}
    </div>
  `, { wide: true });

  let pngBlob, pdfBlob;
  try {
    const canvas = await renderDocCanvas(d);
    pngBlob = await canvasToBlob(canvas);
    pdfBlob = canvasToPdfBlob(canvas);
  } catch (err) {
    const box = qs('#doc-preview');
    if (box) box.innerHTML = `<p class="form-msg error">No se pudo generar el documento: ${esc(err.message || err)}</p>`;
    return;
  }
  const box = qs('#doc-preview');
  if (!box) return; // se cerró el modal mientras se generaba
  box.innerHTML = `<img src="${URL.createObjectURL(pngBlob)}" alt="${esc(d.title)}">`;

  const name = d.filename.replace(/[^\w.-]+/g, '-');
  const bind = (id, fn) => { const b = qs('#' + id); if (b) { b.disabled = false; b.addEventListener('click', fn); } };
  bind('doc-img', () => shareOrDownload(pngBlob, name + '.png'));
  bind('doc-pdf', () => shareOrDownload(pdfBlob, name + '.pdf'));
  bind('doc-img-dl', () => downloadBlob(pngBlob, name + '.png'));
  bind('doc-pdf-dl', () => downloadBlob(pdfBlob, name + '.pdf'));
}

// ============================================================
// Deudas
// ============================================================
let debtFilter = 'pendiente';

function renderDebts() {
  const debts = state.debts || [];
  const active = debts.filter(d => d.remaining > 0);
  const porCobrar = active.reduce((s, d) => s + d.remaining, 0);
  const totals = qs('#debt-totals');
  if (totals) totals.innerHTML = `
    <div class="kpi ${porCobrar > 0 ? 'kpi-warn' : ''}"><span class="kpi-label">Te deben</span><span class="kpi-num">${formatPrice(porCobrar)}</span></div>
    <div class="kpi"><span class="kpi-label">Deudas activas</span><span class="kpi-num">${active.length}</span></div>`;

  const wrap = qs('#debts-list');
  if (!wrap) return;
  const list = debtFilter === 'all' ? debts : debts.filter(d => debtFilter === 'pendiente' ? d.remaining > 0 : d.remaining <= 0);
  if (!list.length) {
    wrap.innerHTML = `<p class="empty-state">${debtFilter === 'pendiente' ? 'Nadie te debe nada 🎉' : 'No hay deudas en esta lista.'}</p>`;
    return;
  }
  wrap.innerHTML = list.map(d => {
    const pct = Number(d.total) > 0 ? Math.min(100, d.paid / Number(d.total) * 100) : 100;
    const client = d.client_id && (state.clients || []).find(c => c.id === d.client_id);
    const phone = client && client.phone;
    const reminder = phone && d.remaining > 0
      ? `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(`Hola ${d.client_name} 💜, te escribimos de Kori Cosmetics para recordarte tu saldo pendiente de ${formatPrice(d.remaining)}. ¡Gracias!`)}`
      : null;
    return `
      <div class="debt-card ${d.remaining <= 0 ? 'is-paid' : ''}">
        <div class="debt-top">
          <div class="entry-main">
            <span class="entry-title">${esc(d.client_name)}</span>
            <span class="entry-sub">${shortDate(d.created_at)}${d.concept ? ' · ' + esc(d.concept) : ''}</span>
          </div>
          <div class="debt-remaining">
            ${d.remaining > 0 ? `<span class="kpi-label">Debe</span><strong>${formatPrice(d.remaining)}</strong>` : '<span class="tag tag-green">Pagada ✓</span>'}
          </div>
        </div>
        <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="debt-progress-text">Pagó ${formatPrice(d.paid)} de ${formatPrice(d.total)}</div>
        <div class="entry-actions">
          ${d.remaining > 0 ? `<button class="btn-mini btn-mini-primary" data-debt-pay="${d.id}">＋ Abono</button>` : ''}
          <button class="btn-mini" data-debt-history="${d.id}">Historial (${d.payments.length})</button>
          ${reminder ? `<a class="btn-mini" href="${reminder}" target="_blank" rel="noopener">💬 Recordar</a>` : ''}
          <button class="btn-mini" data-debt-del="${d.id}">Eliminar</button>
        </div>
      </div>`;
  }).join('');
}

qs('#debt-filter').addEventListener('click', e => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  debtFilter = b.dataset.filter;
  qsa('#debt-filter button').forEach(x => x.classList.toggle('active', x === b));
  renderDebts();
});

function openDebtModal(presetClientId = null) {
  openModal(`
    <div class="modal-head"><h3>Nueva deuda</h3><button class="modal-x" data-close-modal aria-label="Cerrar">✕</button></div>
    ${clientPickerHTML(presetClientId, { label: '¿Quién te debe?', emptyLabel: 'Elige un cliente' })}
    <div class="field"><label>Concepto</label><input type="text" id="debt-concept" placeholder="Ej: Kit de labiales"></div>
    <div class="field"><label>Valor total</label><input type="number" inputmode="numeric" min="0" id="debt-total" placeholder="0"></div>
    <div class="field"><label>Abono inicial (opcional)</label><input type="number" inputmode="numeric" min="0" id="debt-advance" placeholder="0"></div>
    <div class="field"><label>Método del abono</label>${chipsHTML('debt-method', PAYMENT_METHODS, 'Efectivo')}</div>
    <div class="field"><label>Notas (opcional)</label><input type="text" id="debt-notes"></div>
    <div class="modal-footer"><button class="btn btn-primary btn-block" id="btn-save-debt">Guardar deuda</button></div>
  `);
  bindClientPicker();
  qs('#btn-save-debt').addEventListener('click', async () => {
    const btn = qs('#btn-save-debt');
    btn.disabled = true;
    try {
      const client = await readClientPicker({ required: true });
      const total = money(qs('#debt-total').value);
      if (!total) throw new Error('Escribe el valor total de la deuda.');
      const advance = Math.min(money(qs('#debt-advance').value), total);
      const { data: debt, error } = await supabase.from('debts').insert({
        client_id: client.client_id, client_name: client.client_name,
        concept: qs('#debt-concept').value.trim() || null, total,
        notes: qs('#debt-notes').value.trim() || null,
      }).select().single();
      if (error) throw error;
      if (advance > 0) {
        const { error: pErr } = await supabase.from('debt_payments').insert({ debt_id: debt.id, amount: advance, payment_method: getChip('debt-method'), notes: 'Abono inicial' });
        if (pErr) throw pErr;
      }
      closeModal();
      refreshVentas();
    } catch (err) {
      alert(err.message || err);
      btn.disabled = false;
    }
  });
}

function openPaymentModal(debt) {
  openModal(`
    <div class="modal-head"><h3>Abono de ${esc(debt.client_name)}</h3><button class="modal-x" data-close-modal aria-label="Cerrar">✕</button></div>
    <div class="kpi kpi-warn" style="margin-bottom:16px"><span class="kpi-label">Saldo pendiente</span><span class="kpi-num">${formatPrice(debt.remaining)}</span></div>
    <div class="field">
      <label>¿Cuánto abonó?</label>
      <div class="input-with-btn">
        <input type="number" inputmode="numeric" min="0" id="pay-amount" placeholder="0">
        <button type="button" class="btn btn-ghost btn-sm" id="pay-all">Pagó todo</button>
      </div>
    </div>
    <div class="field"><label>Método de pago</label>${chipsHTML('pay-method', PAYMENT_METHODS, 'Efectivo')}</div>
    <div class="field"><label>Nota (opcional)</label><input type="text" id="pay-notes"></div>
    <div class="modal-footer"><button class="btn btn-primary btn-block" id="btn-save-pay">Registrar abono</button></div>
  `);
  qs('#pay-all').addEventListener('click', () => { qs('#pay-amount').value = debt.remaining; });
  qs('#pay-amount').focus();
  qs('#btn-save-pay').addEventListener('click', async () => {
    const amount = money(qs('#pay-amount').value);
    if (!amount) return alert('Escribe cuánto abonó.');
    if (amount > debt.remaining && !confirm(`El abono (${formatPrice(amount)}) es mayor que el saldo (${formatPrice(debt.remaining)}). ¿Guardar de todas formas?`)) return;
    const btn = qs('#btn-save-pay');
    btn.disabled = true;
    const { error } = await supabase.from('debt_payments').insert({
      debt_id: debt.id, amount, payment_method: getChip('pay-method'), notes: qs('#pay-notes').value.trim() || null,
    });
    if (error) { btn.disabled = false; return alert('Error: ' + error.message); }
    closeModal();
    refreshVentas();
  });
}

function openHistoryModal(debt) {
  openModal(`
    <div class="modal-head"><h3>Historial · ${esc(debt.client_name)}</h3><button class="modal-x" data-close-modal aria-label="Cerrar">✕</button></div>
    <p class="hint">${debt.concept ? esc(debt.concept) + ' · ' : ''}Total ${formatPrice(debt.total)} · Debe ${formatPrice(debt.remaining)}</p>
    <div class="card-list">
      ${debt.payments.length ? debt.payments.map(p => `
        <div class="entry-card">
          <div class="entry-main">
            <span class="entry-title">${formatPrice(p.amount)}</span>
            <span class="entry-sub">${dateTimeShort(p.created_at)}${p.payment_method ? ' · ' + esc(p.payment_method) : ''}${p.notes ? ' · ' + esc(p.notes) : ''}</span>
          </div>
          <div class="entry-side"><button class="btn-mini" data-pay-del="${p.id}">Quitar</button></div>
        </div>`).join('') : '<p class="empty-state">Todavía no hay abonos.</p>'}
    </div>
    <div class="modal-actions"><button class="btn btn-primary" data-close-modal>Cerrar</button></div>
  `);
}

qs('#btn-new-debt').addEventListener('click', () => openDebtModal());
document.addEventListener('click', async e => {
  const find = id => (state.debts || []).find(d => d.id === id);
  const pay = e.target.closest('[data-debt-pay]');
  const hist = e.target.closest('[data-debt-history]');
  const del = e.target.closest('[data-debt-del]');
  const payDel = e.target.closest('[data-pay-del]');
  if (pay) openPaymentModal(find(pay.dataset.debtPay));
  else if (hist) openHistoryModal(find(hist.dataset.debtHistory));
  else if (del) {
    if (!confirm('¿Eliminar esta deuda y todos sus abonos?')) return;
    const { error } = await supabase.from('debts').delete().eq('id', del.dataset.debtDel);
    if (error) return alert('Error: ' + error.message);
    refreshVentas();
  } else if (payDel) {
    if (!confirm('¿Quitar este abono?')) return;
    const { error } = await supabase.from('debt_payments').delete().eq('id', payDel.dataset.payDel);
    if (error) return alert('Error: ' + error.message);
    closeModal();
    refreshVentas();
  }
});

// ============================================================
// Accesos rápidos y buscador de clientes
// ============================================================
document.addEventListener('click', e => {
  const q = e.target.closest('[data-quick]');
  if (!q) return;
  if (q.dataset.quick === 'venta') openSaleModal('venta');
  else if (q.dataset.quick === 'cotizacion') openQuoteModal(null);
  else if (q.dataset.quick === 'deuda') openDebtModal();
});
qs('#client-filter').addEventListener('input', () => genericRender('clients'));
