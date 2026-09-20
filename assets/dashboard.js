// ============================================================
// Guard: only the admin profile may see this page
// ============================================================
(async function guard() {
  qs('#guard-message').classList.remove('hidden');
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') {
    location.href = 'login.html';
    return;
  }
  qs('#guard-message').classList.add('hidden');
  qs('#dash-app').classList.remove('hidden');
  qs('#admin-email').textContent = profile.email;
  initDashboard();
})();

qs('#logout-btn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.href = 'login.html';
});

// ============================================================
// Tabs
// ============================================================
function initTabs() {
  qsa('.dash-sidebar button').forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('.dash-sidebar button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      qsa('.tab-panel').forEach(p => p.classList.add('hidden'));
      qs('#tab-' + btn.dataset.tab).classList.remove('hidden');
    });
  });
}

// ============================================================
// Modal helpers
// ============================================================
function openModal(html, { wide = false } = {}) {
  const content = qs('#modal-content');
  content.className = 'modal' + (wide ? ' modal-wide' : '');
  content.innerHTML = html;
  qs('#modal-overlay').classList.remove('hidden');
}
function closeModal() {
  qs('#modal-overlay').classList.add('hidden');
  qs('#modal-content').innerHTML = '';
  qs('#modal-content').className = 'modal';
}
qs('#modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') closeModal(); });

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ============================================================
// Generic CRUD engine (secciones, clientes, proveedores, empleados,
// ventas/gastos, cotizaciones)
// ============================================================
const ENTITIES = {
  categories: {
    label: 'sección', table: 'categories', tableId: 'table-categories', order: 'sort_order',
    columns: [['name','Nombre'],['slug','Slug'],['description','Descripción']],
    fields: [
      { key:'name', label:'Nombre', type:'text', required:true },
      { key:'description', label:'Descripción', type:'text' },
      { key:'sort_order', label:'Orden', type:'number', value:0 },
    ],
    prepare: d => ({ ...d, slug: slugify(d.name) }),
  },
  clients: {
    label: 'cliente', table: 'clients', tableId: 'table-clients', order: 'created_at',
    columns: [['name','Nombre'],['document_id','Documento'],['phone','Teléfono'],['email','Correo']],
    fields: [
      { key:'name', label:'Nombre', type:'text', required:true },
      { key:'document_id', label:'Documento', type:'text' },
      { key:'phone', label:'Teléfono', type:'text' },
      { key:'email', label:'Correo', type:'email' },
      { key:'address', label:'Dirección', type:'text', full:true },
    ],
  },
  providers: {
    label: 'proveedor', table: 'providers', tableId: 'table-providers', order: 'created_at',
    columns: [['name','Nombre'],['contact_name','Contacto'],['phone','Teléfono'],['email','Correo']],
    fields: [
      { key:'name', label:'Nombre', type:'text', required:true },
      { key:'contact_name', label:'Persona de contacto', type:'text' },
      { key:'phone', label:'Teléfono', type:'text' },
      { key:'email', label:'Correo', type:'email' },
      { key:'address', label:'Dirección', type:'text', full:true },
    ],
  },
  employees: {
    label: 'empleado', table: 'employees', tableId: 'table-employees', order: 'created_at',
    columns: [
      ['full_name','Nombre'], ['role_title','Cargo'], ['phone','Teléfono'],
      ['active','Activo', v => v ? '<span class="tag tag-green">Activo</span>' : '<span class="tag tag-red">Inactivo</span>'],
    ],
    fields: [
      { key:'full_name', label:'Nombre completo', type:'text', required:true },
      { key:'role_title', label:'Cargo', type:'text' },
      { key:'phone', label:'Teléfono', type:'text' },
      { key:'email', label:'Correo', type:'email' },
      { key:'salary', label:'Salario', type:'number' },
      { key:'hire_date', label:'Fecha de ingreso', type:'date' },
      { key:'active', label:'Activo', type:'checkbox', value:true },
    ],
  },
  transactions: {
    label: 'movimiento', table: 'transactions', tableId: 'table-transactions', order: 'created_at',
    columns: [
      ['receipt_number','Comprobante'],
      ['type','Tipo', v => v === 'venta' ? '<span class="tag tag-green">Venta</span>' : '<span class="tag tag-red">Gasto</span>'],
      [row => row.product_id ? `${(state.products.find(p => p.id === row.product_id) || {}).name || 'Producto eliminado'} × ${row.quantity}` : row.concept, 'Detalle'],
      ['amount','Monto', v => formatPrice(v)],
      ['created_at','Fecha', v => new Date(v).toLocaleDateString('es-CO')],
    ],
    noEdit: true, // los movimientos no se editan (afectarían el inventario dos veces); solo se registran y consultan
  },
  quotes: {
    label: 'cotización', table: 'quotes', tableId: 'table-quotes', order: 'created_at',
    columns: [
      ['client_name','Cliente'], ['total','Total', v => formatPrice(v)],
      ['status','Estado', v => `<span class="tag tag-neutral">${esc(v)}</span>`],
      ['created_at','Fecha', v => new Date(v).toLocaleDateString('es-CO')],
    ],
    fields: [
      { key:'client_name', label:'Cliente', type:'text', required:true },
      { key:'total', label:'Total', type:'number', required:true },
      { key:'status', label:'Estado', type:'select', options:[['pendiente','Pendiente'],['aceptada','Aceptada'],['rechazada','Rechazada']] },
      { key:'items', label:'Detalle (una línea por ítem)', type:'textarea', full:true },
    ],
    prepare: d => ({ ...d, items: (d.items || '').split('\n').filter(Boolean).map(description => ({ description })) }),
    format: row => ({ ...row, items: (row.items || []).map(i => i.description).join('\n') }),
  },
};

const state = {};

async function genericLoad(key) {
  const cfg = ENTITIES[key];
  const { data, error } = await supabase.from(cfg.table).select('*').order(cfg.order, { ascending: cfg.order === 'sort_order' });
  state[key] = data || [];
  genericRender(key);
}

function genericRender(key) {
  const cfg = ENTITIES[key];
  const table = qs('#' + cfg.tableId);
  const rows = state[key] || [];
  table.querySelector('thead').innerHTML = `<tr>${cfg.columns.map(c => `<th>${c[1]}</th>`).join('')}<th></th></tr>`;
  if (!rows.length) {
    table.querySelector('tbody').innerHTML = `<tr><td colspan="${cfg.columns.length + 1}" class="empty-state">Todavía no hay ${cfg.label}s registrados.</td></tr>`;
    return;
  }
  table.querySelector('tbody').innerHTML = rows.map(row => `
    <tr>
      ${cfg.columns.map(c => {
        const raw = typeof c[0] === 'function' ? c[0](row) : row[c[0]];
        return `<td>${c[2] ? c[2](raw) : esc(raw)}</td>`;
      }).join('')}
      <td class="table-actions">
        ${cfg.noEdit ? '' : `<button class="btn btn-ghost btn-sm" data-edit="${key}:${row.id}">Editar</button>`}
        <button class="btn btn-ghost btn-sm" data-del="${key}:${row.id}">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

function fieldHTML(f, value) {
  const v = value === undefined ? (f.value !== undefined ? f.value : '') : value;
  const wrap = f.full ? 'full' : '';
  if (f.type === 'select') {
    return `<div class="field ${wrap}"><label>${f.label}</label><select name="${f.key}">${f.options.map(([val, lbl]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${lbl}</option>`).join('')}</select></div>`;
  }
  if (f.type === 'textarea') {
    return `<div class="field ${wrap}"><label>${f.label}</label><textarea name="${f.key}" rows="4">${esc(v)}</textarea></div>`;
  }
  if (f.type === 'checkbox') {
    return `<div class="field ${wrap}"><label><input type="checkbox" name="${f.key}" ${v ? 'checked' : ''}> ${f.label}</label></div>`;
  }
  return `<div class="field ${wrap}"><label>${f.label}</label><input type="${f.type}" name="${f.key}" value="${esc(v)}" ${f.required ? 'required' : ''}></div>`;
}

function openGenericModal(key, row) {
  const cfg = ENTITIES[key];
  const data = row ? (cfg.format ? cfg.format(row) : row) : {};
  openModal(`
    <h3>${row ? 'Editar' : 'Nuevo'} ${cfg.label}</h3>
    <form id="generic-form">
      <div class="form-grid">${cfg.fields.map(f => fieldHTML(f, data[f.key])).join('')}</div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="modal-cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">Guardar</button>
      </div>
    </form>
  `);
  qs('#modal-cancel').addEventListener('click', closeModal);
  qs('#generic-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    let payload = {};
    cfg.fields.forEach(f => {
      if (f.type === 'checkbox') payload[f.key] = fd.has(f.key);
      else if (f.type === 'number') payload[f.key] = fd.get(f.key) === '' ? null : Number(fd.get(f.key));
      else payload[f.key] = fd.get(f.key) || null;
    });
    if (cfg.prepare) payload = cfg.prepare(payload);
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const query = row ? supabase.from(cfg.table).update(payload).eq('id', row.id) : supabase.from(cfg.table).insert(payload);
    const { error } = await query;
    submitBtn.disabled = false;
    if (error) { alert('Error: ' + error.message); return; }
    closeModal();
    genericLoad(key);
  });
}

document.addEventListener('click', async e => {
  const newBtn = e.target.closest('[data-generic-new]');
  if (newBtn) return openGenericModal(newBtn.dataset.genericNew, null);

  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) {
    const [key, id] = editBtn.dataset.edit.split(':');
    if (ENTITIES[key]) {
      const row = state[key].find(r => String(r.id) === id);
      return openGenericModal(key, row);
    }
  }

  const delBtn = e.target.closest('[data-del]');
  if (delBtn) {
    const [key, id] = delBtn.dataset.del.split(':');
    if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return;
    const table = key === 'products' ? 'products' : key === 'orders' ? 'orders' : ENTITIES[key].table;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return alert('Error: ' + error.message);
    if (key === 'products') loadProducts(); else if (key === 'orders') loadOrders(); else genericLoad(key);
  }
});

// ============================================================
// Ventas y gastos: registrar una venta eligiendo producto + cantidad
// (el monto y el descuento de inventario se calculan solos, para que
// todo — stock, comprobante y reporte — coincida siempre).
// ============================================================
function openTransactionModal() {
  const products = (state.products || []).filter(p => p.active);
  let saleLines = []; // { product_id, name, price, qty, image_url, stock }

  openModal(`
    <h3>Registrar movimiento</h3>
    <div class="field"><label>Tipo</label>
      <select id="tx-type">
        <option value="venta">Venta</option>
        <option value="gasto">Gasto</option>
      </select>
    </div>

    <div id="tx-venta-section">
      <div class="sale-builder-grid">
        <div>
          <div class="field"><label>Buscar producto</label><input type="text" id="tx-product-search" placeholder="Escribe el nombre..."></div>
          <div class="field">
            <label>Producto</label>
            <select id="tx-product" size="6"></select>
          </div>
          <div class="form-grid">
            <div class="field"><label>Cantidad</label><input type="number" id="tx-qty" min="1" value="1"></div>
            <div class="field" style="display:flex;align-items:flex-end">
              <button type="button" class="btn btn-outline btn-block" id="btn-add-line">+ Agregar a la venta</button>
            </div>
          </div>
        </div>
        <div class="sale-mini-preview">
          <div class="preview-label" style="text-align:left">Vista previa</div>
          <div class="tilt-stage" id="sale-tilt-stage">
            <div class="tilt-card" id="sale-tilt-card">
              <span id="sale-preview-placeholder" style="font-size:2.2rem">💄</span>
              <img id="sale-preview-img" class="hidden" alt="">
            </div>
          </div>
          <div class="preview-name" id="sale-preview-name">Elige un producto</div>
          <div class="preview-price" id="sale-preview-price"></div>
          <p class="form-msg" id="sale-preview-stock"></p>
        </div>
      </div>

      <div class="sale-lines" id="sale-lines"><p class="empty-state">Todavía no agregas productos a esta venta.</p></div>
      <div class="summary-total"><span>Total de la venta</span><span id="sale-total">${formatPrice(0)}</span></div>
    </div>

    <div id="tx-gasto-section" class="hidden">
      <div class="field full"><label>Concepto</label><input type="text" id="tx-concept-manual"></div>
      <div class="field"><label>Monto</label><input type="number" id="tx-amount-manual" step="0.01"></div>
    </div>

    <div class="form-grid" style="margin-top:8px">
      <div class="field"><label>Categoría (opcional)</label><input type="text" id="tx-category"></div>
      <div class="field"><label>Notas (opcional)</label><input type="text" id="tx-notes"></div>
    </div>

    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="modal-cancel">Cancelar</button>
      <button type="button" class="btn btn-primary" id="btn-save-transaction">Guardar</button>
    </div>
  `, { wide: true });

  const typeEl = qs('#tx-type');
  const searchEl = qs('#tx-product-search');
  const productEl = qs('#tx-product');
  const qtyEl = qs('#tx-qty');

  function renderProductOptions(filter = '') {
    const term = filter.trim().toLowerCase();
    const list = term ? products.filter(p => p.name.toLowerCase().includes(term)) : products;
    productEl.innerHTML = list.map(p => `<option value="${p.id}">${esc(p.name)} · ${formatPrice(p.price)} · stock ${p.stock}</option>`).join('')
      || `<option disabled>Sin resultados</option>`;
    updateMiniPreview();
  }

  function selectedProduct() {
    const id = productEl.value;
    return products.find(p => p.id === id) || null;
  }

  // Vista previa 3D del producto elegido, para no confundirlo con otro parecido.
  function updateMiniPreview() {
    const product = selectedProduct();
    const img = qs('#sale-preview-img');
    const placeholder = qs('#sale-preview-placeholder');
    if (product && product.image_url) {
      img.src = product.image_url;
      img.classList.remove('hidden');
      placeholder.classList.add('hidden');
    } else {
      img.classList.add('hidden');
      placeholder.classList.remove('hidden');
    }
    qs('#sale-preview-name').textContent = product ? product.name : 'Elige un producto';
    qs('#sale-preview-price').textContent = product ? formatPrice(product.price) : '';
    qs('#sale-preview-stock').textContent = product ? `Stock disponible: ${product.stock}` : '';
  }

  const tiltStage = qs('#sale-tilt-stage');
  const tiltCard = qs('#sale-tilt-card');
  tiltStage.addEventListener('mousemove', e => {
    const rect = tiltStage.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    tiltCard.style.transform = `rotateY(${x * 18}deg) rotateX(${-y * 18}deg) scale(1.04)`;
  });
  tiltStage.addEventListener('mouseleave', () => { tiltCard.style.transform = 'rotateY(0) rotateX(0) scale(1)'; });

  function renderSaleLines() {
    const wrap = qs('#sale-lines');
    if (!saleLines.length) {
      wrap.innerHTML = `<p class="empty-state">Todavía no agregas productos a esta venta.</p>`;
    } else {
      wrap.innerHTML = saleLines.map((line, i) => `
        <div class="sale-line-row">
          ${line.image_url ? `<img src="${line.image_url}">` : `<div class="placeholder-thumb">💄</div>`}
          <span>${esc(line.name)}</span>
          <input type="number" min="1" value="${line.qty}" data-line-qty="${i}">
          <span>${formatPrice(line.price * line.qty)}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-line-remove="${i}">✕</button>
        </div>
      `).join('');
      qsa('[data-line-qty]', wrap).forEach(input => input.addEventListener('input', () => {
        const i = Number(input.dataset.lineQty);
        saleLines[i].qty = Math.max(1, Number(input.value) || 1);
        renderSaleLines();
      }));
      qsa('[data-line-remove]', wrap).forEach(btn => btn.addEventListener('click', () => {
        saleLines.splice(Number(btn.dataset.lineRemove), 1);
        renderSaleLines();
      }));
    }
    qs('#sale-total').textContent = formatPrice(saleLines.reduce((s, l) => s + l.price * l.qty, 0));
  }

  qs('#btn-add-line').addEventListener('click', () => {
    const product = selectedProduct();
    if (!product) return;
    const qty = Math.max(1, Number(qtyEl.value) || 1);
    const existing = saleLines.find(l => l.product_id === product.id);
    const totalRequested = (existing ? existing.qty : 0) + qty;
    if (totalRequested > product.stock) {
      if (!confirm(`Solo hay ${product.stock} unidades de "${product.name}" en stock (ya llevas ${existing ? existing.qty : 0} en esta venta). ¿Agregar de todas formas?`)) return;
    }
    if (existing) existing.qty += qty;
    else saleLines.push({ product_id: product.id, name: product.name, price: product.price, qty, image_url: product.image_url, stock: product.stock });
    renderSaleLines();
  });

  searchEl.addEventListener('input', () => renderProductOptions(searchEl.value));
  productEl.addEventListener('change', updateMiniPreview);
  renderProductOptions();
  renderSaleLines();

  function syncType() {
    const isVenta = typeEl.value === 'venta';
    qs('#tx-venta-section').classList.toggle('hidden', !isVenta);
    qs('#tx-gasto-section').classList.toggle('hidden', isVenta);
  }
  typeEl.addEventListener('change', syncType);
  syncType();

  qs('#modal-cancel').addEventListener('click', closeModal);

  qs('#btn-save-transaction').addEventListener('click', async () => {
    const btn = qs('#btn-save-transaction');
    const category = qs('#tx-category').value || null;
    const notes = qs('#tx-notes').value || null;

    let rows;
    if (typeEl.value === 'venta') {
      if (!saleLines.length) return alert('Agrega al menos un producto a la venta.');
      const sale_id = crypto.randomUUID();
      rows = saleLines.map(l => ({
        type: 'venta',
        concept: `${l.name} × ${l.qty}`,
        product_id: l.product_id,
        quantity: l.qty,
        amount: l.price * l.qty,
        sale_id,
        category, notes,
      }));
    } else {
      const concept = qs('#tx-concept-manual').value;
      const amount = Number(qs('#tx-amount-manual').value) || 0;
      if (!concept.trim()) return alert('Escribe el concepto del gasto.');
      rows = [{ type: 'gasto', concept, amount, product_id: null, quantity: null, sale_id: null, category, notes }];
    }

    btn.disabled = true;
    const { error } = await supabase.from('transactions').insert(rows);
    btn.disabled = false;
    if (error) { alert('Error: ' + error.message); return; }
    closeModal();
    genericLoad('transactions');
    loadProducts(); // el stock puede haber cambiado
    loadStats();
  });
}

qs('#btn-new-transaction').addEventListener('click', openTransactionModal);

// ============================================================
// Productos (con variantes, imagen y cálculo de precio)
// ============================================================
async function loadProducts() {
  const { data } = await supabase.from('products').select('*, categories(name)').order('created_at', { ascending: false });
  state.products = data || [];
  renderInventoryTotals();
  renderProductsTable();
}

function renderInventoryTotals() {
  const el = qs('#inventory-totals');
  if (!el) return;
  const totalCost = state.products.reduce((s, p) => s + (Number(p.cost_price) || 0) * (Number(p.stock) || 0), 0);
  const totalProfit = state.products.reduce((s, p) => s + ((Number(p.price) || 0) - (Number(p.cost_price) || 0)) * (Number(p.stock) || 0), 0);
  el.innerHTML = `
    <div class="stat-card"><div class="num">${formatPrice(totalCost)}</div><div class="label">Costo total del inventario</div></div>
    <div class="stat-card"><div class="num">${formatPrice(totalProfit)}</div><div class="label">Ganancia potencial de todo el inventario</div></div>
  `;
}

function renderProductsTable() {
  const table = qs('#table-productos');
  const term = (qs('#product-filter-search')?.value || '').trim().toLowerCase();
  const sort = qs('#product-filter-sort')?.value || 'recent';

  let list = state.products.slice();
  if (term) list = list.filter(p => p.name.toLowerCase().includes(term));
  if (sort === 'price-asc') list.sort((a, b) => a.price - b.price);
  else if (sort === 'price-desc') list.sort((a, b) => b.price - a.price);
  else if (sort === 'name-asc') list.sort((a, b) => a.name.localeCompare(b.name));
  else list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  table.querySelector('thead').innerHTML = `<tr><th></th><th>Nombre</th><th>Sección</th><th>Precio</th><th>Stock</th><th>Estado</th><th></th></tr>`;
  if (!list.length) {
    table.querySelector('tbody').innerHTML = `<tr><td colspan="7" class="empty-state">${state.products.length ? 'Ningún producto coincide con el filtro.' : 'Aún no has creado productos.'}</td></tr>`;
    return;
  }
  table.querySelector('tbody').innerHTML = list.map(p => {
    const cost = Number(p.cost_price) || 0;
    const stock = Number(p.stock) || 0;
    const itemTotalCost = cost * stock;
    const itemTotalProfit = ((Number(p.price) || 0) - cost) * stock;
    return `
    <tr class="product-row" data-row-toggle="${p.id}">
      <td><span class="row-chevron">▸</span>${p.image_url ? `<img src="${p.image_url}" style="width:40px;height:40px;border-radius:8px;object-fit:cover;vertical-align:middle">` : '💄'}</td>
      <td>${esc(p.name)} ${p.is_combo ? '<span class="tag tag-combo">Combo</span>' : ''}</td>
      <td>${p.categories ? esc(p.categories.name) : '—'}</td>
      <td>${formatPrice(p.price)}</td>
      <td>${p.stock}</td>
      <td>${p.active ? '<span class="tag tag-green">Activo</span>' : '<span class="tag tag-red">Inactivo</span>'} ${p.featured ? '<span class="tag tag-neutral">Destacado</span>' : ''}</td>
      <td class="table-actions">
        <button class="btn btn-ghost btn-sm" data-edit-product="${p.id}">Editar</button>
        ${p.is_combo ? '' : `<button class="btn btn-ghost btn-sm" data-variants="${p.id}">Variantes</button>`}
        <button class="btn btn-ghost btn-sm" data-del="products:${p.id}">Eliminar</button>
      </td>
    </tr>
    <tr class="product-detail-row hidden" data-detail-for="${p.id}">
      <td colspan="7">
        <div class="inventory-breakdown">
          <div><strong>${formatPrice(cost)}</strong><span>Costo por unidad</span></div>
          <div><strong>${stock}</strong><span>Unidades en stock</span></div>
          <div><strong>${formatPrice(itemTotalCost)}</strong><span>Costo total en inventario</span></div>
          <div><strong>${formatPrice(itemTotalProfit)}</strong><span>Ganancia potencial si se vende todo</span></div>
        </div>
      </td>
    </tr>
  `;
  }).join('');
}
qs('#table-productos').addEventListener('click', e => {
  if (e.target.closest('.table-actions')) return;
  const row = e.target.closest('[data-row-toggle]');
  if (!row) return;
  row.classList.toggle('expanded');
  qs(`[data-detail-for="${row.dataset.rowToggle}"]`).classList.toggle('hidden');
});
qs('#product-filter-search').addEventListener('input', renderProductsTable);
qs('#product-filter-sort').addEventListener('change', renderProductsTable);

function computeTotal(base, tax) { return Math.round((base || 0) * (1 + (tax || 0) / 100)); }

// Manejador de fotos reutilizable (producto normal y combos): agregar,
// quitar y elegir portada, subiendo directo al bucket de Supabase.
function createImageManager({ containerId, fileInputId, initial, onChange }) {
  let images = [...initial];
  function render() {
    const wrap = qs('#' + containerId);
    wrap.innerHTML = images.map((url, i) => `
      <div class="image-thumb ${i === 0 ? 'is-cover' : ''}">
        <img src="${url}">
        <div class="thumb-actions">
          ${i !== 0 ? `<button type="button" data-mgr-cover="${i}" title="Hacer portada">★</button>` : ''}
          <button type="button" data-mgr-remove="${i}" title="Quitar">✕</button>
        </div>
      </div>
    `).join('') + `<button type="button" class="image-add-btn" data-mgr-add title="Agregar fotos">+</button>`;

    qsa('[data-mgr-remove]', wrap).forEach(b => b.addEventListener('click', () => { images.splice(Number(b.dataset.mgrRemove), 1); render(); }));
    qsa('[data-mgr-cover]', wrap).forEach(b => b.addEventListener('click', () => { const [img] = images.splice(Number(b.dataset.mgrCover), 1); images.unshift(img); render(); }));
    qs('[data-mgr-add]', wrap).addEventListener('click', () => qs('#' + fileInputId).click());
    onChange(images);
  }
  qs('#' + fileInputId).addEventListener('change', async e => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const file of files) {
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`;
      const { error } = await supabase.storage.from('product-images').upload(path, file);
      if (error) { alert('Error al subir imagen: ' + error.message); continue; }
      const { data } = supabase.storage.from('product-images').getPublicUrl(path);
      images.push(data.publicUrl);
    }
    render();
  });
  render();
  return { get: () => images };
}

function openProductModal(row) {
  const cats = state.categories || [];
  let modalImages = row ? (row.images && row.images.length ? [...row.images] : (row.image_url ? [row.image_url] : [])) : [];
  let previewActiveIdx = 0;

  openModal(`
    <h3>${row ? 'Editar' : 'Nuevo'} producto</h3>
    <div class="product-modal-grid">
      <form id="product-form">
        <div class="form-grid">
          <div class="field full"><label>Nombre</label><input name="name" required value="${row ? esc(row.name) : ''}"></div>
          <div class="field"><label>Sección</label><select name="category_id"><option value="">Sin sección</option>${cats.map(c => `<option value="${c.id}" ${row && row.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Unidad de medida</label>
            <select name="unit">
              ${['Unidad','Caja','Docena','Kit','Set'].map(u => `<option ${row && row.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Cantidad inicial / stock</label><input type="number" name="stock" value="${row ? row.stock : 0}"></div>
          <div class="field"><label>Costo por unidad</label><input type="number" step="0.01" name="cost_price" value="${row ? row.cost_price : 0}"></div>
          <div class="field"><label>Precio base</label><input type="number" step="0.01" name="base_price" value="${row ? row.base_price : 0}"></div>
          <div class="field"><label>Impuesto %</label><input type="number" step="0.01" name="tax_percent" value="${row ? row.tax_percent : 0}"></div>
          <div class="field"><label>Precio total al público</label><input type="text" id="price_preview" disabled value="${formatPrice(row ? row.price : 0)}"></div>
          <div class="field full"><label>Descripción</label><textarea name="description" rows="3">${row ? esc(row.description || '') : ''}</textarea></div>
          <div class="field full">
            <label>Fotos del producto</label>
            <div class="image-manager" id="image-manager"></div>
            <p class="image-hint">La primera foto (con borde morado) es la portada que se ve en el catálogo. Pasa el mouse sobre una foto para quitarla o hacerla portada.</p>
            <input type="file" id="image-file-input" accept="image/*" multiple class="hidden">
          </div>
          <div class="field"><label><input type="checkbox" name="featured" ${row && row.featured ? 'checked' : ''}> Destacado</label></div>
          <div class="field"><label><input type="checkbox" name="active" ${!row || row.active ? 'checked' : ''}> Activo (visible en la tienda)</label></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="modal-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>

      <div class="live-preview">
        <div class="preview-label">Vista previa — así se verá en la tienda</div>
        <div class="tilt-stage" id="tilt-stage">
          <div class="tilt-card" id="tilt-card">
            <span id="preview-placeholder" style="font-size:3rem">💄</span>
            <img id="preview-main-img" class="hidden" alt="">
          </div>
        </div>
        <div class="preview-thumbs" id="preview-thumbs"></div>
        <span class="product-cat" id="preview-cat">Kori Cosmetics</span>
        <div class="preview-name" id="preview-name">Nombre del producto</div>
        <div class="preview-price" id="preview-price">$0</div>
        <p class="preview-desc" id="preview-desc"></p>
        <button class="btn btn-primary btn-block" disabled>Agregar al carrito 🛍️</button>
      </div>
    </div>
  `, { wide: true });

  const form = qs('#product-form');

  function updatePreview() {
    const cat = cats.find(c => c.id === form.category_id.value);
    qs('#preview-name').textContent = form.name.value || 'Nombre del producto';
    qs('#preview-desc').textContent = form.description.value || '';
    qs('#preview-cat').textContent = cat ? cat.name : 'Kori Cosmetics';
    const total = computeTotal(Number(form.base_price.value) || 0, Number(form.tax_percent.value) || 0);
    qs('#preview-price').textContent = formatPrice(total);
    qs('#price_preview').value = formatPrice(total);

    if (previewActiveIdx >= modalImages.length) previewActiveIdx = 0;
    const mainImg = qs('#preview-main-img');
    const placeholder = qs('#preview-placeholder');
    if (modalImages.length) {
      mainImg.src = modalImages[previewActiveIdx];
      mainImg.classList.remove('hidden');
      placeholder.classList.add('hidden');
    } else {
      mainImg.classList.add('hidden');
      placeholder.classList.remove('hidden');
    }
    qs('#preview-thumbs').innerHTML = modalImages.map((url, i) => `<img src="${url}" class="${i === previewActiveIdx ? 'active' : ''}" data-preview-thumb="${i}">`).join('');
    qsa('[data-preview-thumb]').forEach(t => t.addEventListener('click', () => {
      previewActiveIdx = Number(t.dataset.previewThumb);
      updatePreview();
    }));
  }

  // Efecto 3D: la tarjeta de vista previa se inclina según la posición del mouse.
  const tiltStage = qs('#tilt-stage');
  const tiltCard = qs('#tilt-card');
  tiltStage.addEventListener('mousemove', e => {
    const rect = tiltStage.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    tiltCard.style.transform = `rotateY(${x * 18}deg) rotateX(${-y * 18}deg) scale(1.03)`;
  });
  tiltStage.addEventListener('mouseleave', () => { tiltCard.style.transform = 'rotateY(0) rotateX(0) scale(1)'; });

  form.addEventListener('input', updatePreview);
  qs('#modal-cancel').addEventListener('click', closeModal);

  createImageManager({
    containerId: 'image-manager', fileInputId: 'image-file-input', initial: modalImages,
    onChange: (imgs) => { modalImages = imgs; updatePreview(); },
  });

  updatePreview();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const base_price = Number(fd.get('base_price')) || 0;
    const tax_percent = Number(fd.get('tax_percent')) || 0;
    const payload = {
      name: fd.get('name'),
      category_id: fd.get('category_id') || null,
      unit: fd.get('unit'),
      stock: Number(fd.get('stock')) || 0,
      cost_price: Number(fd.get('cost_price')) || 0,
      base_price, tax_percent,
      price: computeTotal(base_price, tax_percent),
      description: fd.get('description') || null,
      images: modalImages,
      image_url: modalImages[0] || null,
      featured: fd.has('featured'),
      active: fd.has('active'),
    };
    if (!row) payload.slug = slugify(payload.name);

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const query = row ? supabase.from('products').update(payload).eq('id', row.id) : supabase.from('products').insert(payload);
    const { error } = await query;
    submitBtn.disabled = false;
    if (error) { alert('Error: ' + error.message); return; }
    closeModal();
    loadProducts();
  });
}

// ============================================================
// Combos: varios productos empaquetados en uno solo, con desglose
// de costo/ganancia por cada producto incluido.
// ============================================================
async function openComboModal(row) {
  const cats = state.categories || [];
  const catalog = (state.products || []).filter(p => !p.is_combo); // un combo no incluye otro combo
  let modalImages = row ? (row.images && row.images.length ? [...row.images] : (row.image_url ? [row.image_url] : [])) : [];
  let comboItems = []; // { item_product_id, name, qty, cost_price, price, image_url }

  if (row) {
    const { data } = await supabase.from('combo_items').select('*, products(name, image_url, cost_price, price)').eq('combo_id', row.id);
    comboItems = (data || []).map(ci => ({
      item_product_id: ci.item_product_id,
      name: ci.products ? ci.products.name : 'Producto eliminado',
      qty: ci.quantity,
      cost_price: ci.products ? Number(ci.products.cost_price) : 0,
      price: ci.products ? Number(ci.products.price) : 0,
      image_url: ci.image_url || (ci.products ? ci.products.image_url : null),
    }));
  }

  openModal(`
    <h3>${row ? 'Editar' : 'Nuevo'} combo</h3>
    <div class="product-modal-grid">
      <form id="combo-form">
        <div class="form-grid">
          <div class="field full"><label>Nombre del combo</label><input name="name" required value="${row ? esc(row.name) : ''}"></div>
          <div class="field"><label>Sección</label><select name="category_id"><option value="">Sin sección</option>${cats.map(c => `<option value="${c.id}" ${row && row.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Combos armados (stock)</label><input type="number" name="stock" value="${row ? row.stock : 0}"></div>
          <div class="field"><label>Costo total (automático)</label><input type="text" id="combo-cost-display" disabled></div>
          <div class="field"><label>Precio de venta del combo</label><input type="number" step="0.01" name="base_price" value="${row ? row.base_price : 0}"></div>
          <div class="field"><label>Impuesto %</label><input type="number" step="0.01" name="tax_percent" value="${row ? row.tax_percent : 0}"></div>
          <div class="field"><label>Precio total al público</label><input type="text" id="price_preview" disabled value="${formatPrice(row ? row.price : 0)}"></div>
          <div class="field full"><label>Descripción</label><textarea name="description" rows="2">${row ? esc(row.description || '') : ''}</textarea></div>
          <div class="field full">
            <label>Fotos de portada del combo</label>
            <div class="image-manager" id="image-manager"></div>
            <p class="image-hint">Esta es la foto que se ve en el catálogo. Las fotos de cada producto incluido se eligen abajo.</p>
            <input type="file" id="image-file-input" accept="image/*" multiple class="hidden">
          </div>
          <div class="field"><label><input type="checkbox" name="featured" ${row && row.featured ? 'checked' : ''}> Destacado</label></div>
          <div class="field"><label><input type="checkbox" name="active" ${!row || row.active ? 'checked' : ''}> Activo (visible en la tienda)</label></div>
        </div>

        <h4 style="margin:22px 0 4px">Productos incluidos</h4>
        <p style="color:var(--text-soft);font-size:.85rem;margin:0 0 14px">Elige la foto que quieras mostrar para cada producto dentro del combo: puedes usar la foto que ya tiene o subir una propia.</p>

        <div class="combo-picker-grid">
          <div>
            <div class="field"><label>Buscar producto</label><input type="text" id="combo-item-search" placeholder="Escribe el nombre..."></div>
            <div class="field"><label>Producto</label><select id="combo-item-select" size="5"></select></div>
            <div class="form-grid">
              <div class="field"><label>Cantidad</label><input type="number" id="combo-item-qty" min="1" value="1"></div>
              <div class="field" style="display:flex;align-items:flex-end">
                <button type="button" class="btn btn-outline btn-block" id="btn-add-combo-item">+ Agregar al combo</button>
              </div>
            </div>
          </div>
          <div class="sale-mini-preview">
            <div class="preview-label" style="text-align:left">Vista previa</div>
            <div class="tilt-stage" id="combo-item-tilt-stage">
              <div class="tilt-card" id="combo-item-tilt-card">
                <span id="combo-item-placeholder" style="font-size:2.2rem">💄</span>
                <img id="combo-item-preview-img" class="hidden" alt="">
              </div>
            </div>
            <div class="preview-name" id="combo-item-preview-name">Elige un producto</div>
            <div class="preview-price" id="combo-item-preview-price"></div>
          </div>
        </div>

        <div class="combo-items-list" id="combo-items-list"></div>

        <table class="combo-cost-table" id="combo-cost-table"></table>

        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="modal-cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar combo</button>
        </div>
      </form>

      <div class="live-preview">
        <div class="preview-label">Vista previa — así se verá en la tienda</div>
        <div class="tilt-stage" id="tilt-stage">
          <div class="tilt-card" id="tilt-card">
            <span id="preview-placeholder" style="font-size:3rem">🎁</span>
            <img id="preview-main-img" class="hidden" alt="">
          </div>
        </div>
        <div class="preview-thumbs" id="preview-thumbs"></div>
        <span class="badge-combo" style="position:static;display:inline-block;margin-bottom:6px">COMBO</span>
        <span class="product-cat" id="preview-cat">Kori Cosmetics</span>
        <div class="preview-name" id="preview-name">Nombre del combo</div>
        <div class="preview-price" id="preview-price">$0</div>
        <p class="preview-desc" id="preview-desc"></p>
        <button class="btn btn-primary btn-block" disabled>Agregar al carrito 🛍️</button>
      </div>
    </div>
  `, { wide: true });

  const form = qs('#combo-form');
  let previewActiveIdx = 0;

  function totalCost() { return comboItems.reduce((s, i) => s + i.cost_price * i.qty, 0); }

  function renderCostTable() {
    const cost = totalCost();
    qs('#combo-cost-display').value = formatPrice(cost);
    const sellPrice = computeTotal(Number(form.base_price.value) || 0, Number(form.tax_percent.value) || 0);
    const totalProfit = sellPrice - cost;
    const table = qs('#combo-cost-table');
    if (!comboItems.length) { table.innerHTML = ''; return; }
    table.innerHTML = `
      <thead><tr><th>Producto</th><th>Cant.</th><th>Costo total</th><th>Ganancia asignada</th></tr></thead>
      <tbody>
        ${comboItems.map(i => {
          const itemCost = i.cost_price * i.qty;
          const share = cost > 0 ? itemCost / cost : 1 / comboItems.length;
          const itemProfit = totalProfit * share;
          return `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${formatPrice(itemCost)}</td><td>${formatPrice(itemProfit)}</td></tr>`;
        }).join('')}
        <tr class="combo-totals-row"><td>Total</td><td></td><td>${formatPrice(cost)}</td><td>${formatPrice(totalProfit)}</td></tr>
      </tbody>
    `;
  }

  function renderComboItems() {
    const wrap = qs('#combo-items-list');
    wrap.innerHTML = comboItems.length
      ? comboItems.map((item, i) => `
        <div class="combo-item-row">
          ${item.image_url ? `<img src="${item.image_url}">` : `<div class="placeholder-thumb">💄</div>`}
          <span>${esc(item.name)}</span>
          <input type="number" min="1" value="${item.qty}" data-combo-qty="${i}">
          <button type="button" class="btn btn-ghost btn-sm" data-combo-change-img="${i}">Cambiar foto</button>
          <input type="file" accept="image/*" class="hidden" data-combo-file="${i}">
          <button type="button" class="btn btn-ghost btn-sm" data-combo-remove="${i}">✕</button>
        </div>
      `).join('')
      : `<p class="empty-state">Todavía no agregas productos a este combo.</p>`;

    qsa('[data-combo-qty]', wrap).forEach(input => input.addEventListener('input', () => {
      comboItems[Number(input.dataset.comboQty)].qty = Math.max(1, Number(input.value) || 1);
      renderCostTable();
      updatePreview();
    }));
    qsa('[data-combo-remove]', wrap).forEach(btn => btn.addEventListener('click', () => {
      comboItems.splice(Number(btn.dataset.comboRemove), 1);
      renderComboItems();
      renderCostTable();
      updatePreview();
    }));
    qsa('[data-combo-change-img]', wrap).forEach(btn => btn.addEventListener('click', () => {
      qs(`[data-combo-file="${btn.dataset.comboChangeImg}"]`, wrap).click();
    }));
    qsa('[data-combo-file]', wrap).forEach(input => input.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`;
      const { error } = await supabase.storage.from('product-images').upload(path, file);
      if (error) return alert('Error al subir imagen: ' + error.message);
      const { data } = supabase.storage.from('product-images').getPublicUrl(path);
      comboItems[Number(input.dataset.comboFile)].image_url = data.publicUrl;
      renderComboItems();
    }));
  }

  function renderItemOptions(filter = '') {
    const term = filter.trim().toLowerCase();
    const list = term ? catalog.filter(p => p.name.toLowerCase().includes(term)) : catalog;
    qs('#combo-item-select').innerHTML = list.map(p => `<option value="${p.id}">${esc(p.name)} · ${formatPrice(p.price)}</option>`).join('') || `<option disabled>Sin resultados</option>`;
    updateItemPreview();
  }

  function selectedCatalogItem() {
    return catalog.find(p => p.id === qs('#combo-item-select').value) || null;
  }

  function updateItemPreview() {
    const p = selectedCatalogItem();
    const img = qs('#combo-item-preview-img');
    const placeholder = qs('#combo-item-placeholder');
    if (p && p.image_url) { img.src = p.image_url; img.classList.remove('hidden'); placeholder.classList.add('hidden'); }
    else { img.classList.add('hidden'); placeholder.classList.remove('hidden'); }
    qs('#combo-item-preview-name').textContent = p ? p.name : 'Elige un producto';
    qs('#combo-item-preview-price').textContent = p ? formatPrice(p.price) : '';
  }

  const itemTiltStage = qs('#combo-item-tilt-stage');
  const itemTiltCard = qs('#combo-item-tilt-card');
  itemTiltStage.addEventListener('mousemove', e => {
    const rect = itemTiltStage.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    itemTiltCard.style.transform = `rotateY(${x * 18}deg) rotateX(${-y * 18}deg) scale(1.04)`;
  });
  itemTiltStage.addEventListener('mouseleave', () => { itemTiltCard.style.transform = 'rotateY(0) rotateX(0) scale(1)'; });

  qs('#combo-item-search').addEventListener('input', e => renderItemOptions(e.target.value));
  qs('#combo-item-select').addEventListener('change', updateItemPreview);
  qs('#btn-add-combo-item').addEventListener('click', () => {
    const p = selectedCatalogItem();
    if (!p) return;
    const qty = Math.max(1, Number(qs('#combo-item-qty').value) || 1);
    const existing = comboItems.find(i => i.item_product_id === p.id);
    if (existing) existing.qty += qty;
    else comboItems.push({ item_product_id: p.id, name: p.name, qty, cost_price: Number(p.cost_price) || 0, price: Number(p.price) || 0, image_url: p.image_url });
    renderComboItems();
    renderCostTable();
    updatePreview();
  });

  function updatePreview() {
    const cat = cats.find(c => c.id === form.category_id.value);
    qs('#preview-name').textContent = form.name.value || 'Nombre del combo';
    qs('#preview-desc').textContent = form.description.value || '';
    qs('#preview-cat').textContent = cat ? cat.name : 'Kori Cosmetics';
    const total = computeTotal(Number(form.base_price.value) || 0, Number(form.tax_percent.value) || 0);
    qs('#preview-price').textContent = formatPrice(total);
    qs('#price_preview').value = formatPrice(total);
    renderCostTable();

    if (previewActiveIdx >= modalImages.length) previewActiveIdx = 0;
    const mainImg = qs('#preview-main-img');
    const placeholder = qs('#preview-placeholder');
    if (modalImages.length) { mainImg.src = modalImages[previewActiveIdx]; mainImg.classList.remove('hidden'); placeholder.classList.add('hidden'); }
    else { mainImg.classList.add('hidden'); placeholder.classList.remove('hidden'); }
    qs('#preview-thumbs').innerHTML = modalImages.map((url, i) => `<img src="${url}" class="${i === previewActiveIdx ? 'active' : ''}" data-preview-thumb="${i}">`).join('');
    qsa('[data-preview-thumb]').forEach(t => t.addEventListener('click', () => { previewActiveIdx = Number(t.dataset.previewThumb); updatePreview(); }));
  }

  const tiltStage = qs('#tilt-stage');
  const tiltCard = qs('#tilt-card');
  tiltStage.addEventListener('mousemove', e => {
    const rect = tiltStage.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    tiltCard.style.transform = `rotateY(${x * 18}deg) rotateX(${-y * 18}deg) scale(1.03)`;
  });
  tiltStage.addEventListener('mouseleave', () => { tiltCard.style.transform = 'rotateY(0) rotateX(0) scale(1)'; });

  form.addEventListener('input', updatePreview);
  qs('#modal-cancel').addEventListener('click', closeModal);
  createImageManager({
    containerId: 'image-manager', fileInputId: 'image-file-input', initial: modalImages,
    onChange: (imgs) => { modalImages = imgs; updatePreview(); },
  });

  renderItemOptions();
  renderComboItems();
  updatePreview();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!comboItems.length) return alert('Agrega al menos un producto al combo.');
    const fd = new FormData(e.target);
    const base_price = Number(fd.get('base_price')) || 0;
    const tax_percent = Number(fd.get('tax_percent')) || 0;
    const payload = {
      name: fd.get('name'),
      category_id: fd.get('category_id') || null,
      unit: 'Kit',
      stock: Number(fd.get('stock')) || 0,
      cost_price: totalCost(),
      base_price, tax_percent,
      price: computeTotal(base_price, tax_percent),
      description: fd.get('description') || null,
      images: modalImages,
      image_url: modalImages[0] || null,
      featured: fd.has('featured'),
      active: fd.has('active'),
      is_combo: true,
    };
    if (!row) payload.slug = slugify(payload.name);

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const query = row ? supabase.from('products').update(payload).eq('id', row.id).select('id').single() : supabase.from('products').insert(payload).select('id').single();
    const { data: savedProduct, error } = await query;
    if (error) { submitBtn.disabled = false; alert('Error: ' + error.message); return; }

    const comboId = row ? row.id : savedProduct.id;
    if (row) await supabase.from('combo_items').delete().eq('combo_id', comboId);
    const { error: itemsError } = await supabase.from('combo_items').insert(
      comboItems.map(i => ({ combo_id: comboId, item_product_id: i.item_product_id, quantity: i.qty, image_url: i.image_url }))
    );
    submitBtn.disabled = false;
    if (itemsError) { alert('El combo se guardó, pero hubo un error con sus productos: ' + itemsError.message); return; }
    closeModal();
    loadProducts();
  });
}

async function openVariantsModal(productId) {
  const product = state.products.find(p => p.id === productId);
  const { data } = await supabase.from('product_variants').select('*').eq('product_id', productId).order('created_at');
  const variants = data || [];
  // Todas las opciones de un producto comparten un solo "nombre" (ej. "Tono"),
  // para que en la tienda se muestren juntas en una sola fila en vez de
  // aparecer como grupos sueltos.
  const existingNames = [...new Set(variants.map(v => v.name))];
  const sharedName = existingNames.length === 1 ? existingNames[0] : (existingNames[0] || 'Tono');

  openModal(`
    <h3>Variantes — ${esc(product.name)}</h3>
    <p style="color:var(--text-soft);font-size:.85rem;margin:-6px 0 16px">Ej: los tonos de un labial, o los tamaños de un kit. Deja el precio vacío si esa opción cuesta igual que el producto (${formatPrice(product.price)}); ponle 0 de stock si por ahora no hay disponibilidad.</p>
    <table style="margin-bottom:16px">
      <thead><tr><th>Nombre</th><th>Valor</th><th>Precio</th><th>Stock</th><th></th></tr></thead>
      <tbody>
        ${variants.map(v => `<tr>
          <td>${esc(v.name)}</td><td>${esc(v.value)}</td>
          <td>${v.price_override != null ? formatPrice(v.price_override) : `<span style="color:var(--text-soft)">Igual al producto</span>`}</td>
          <td>${v.stock > 0 ? v.stock : '<span class="tag tag-red">Agotado</span>'}</td>
          <td><button class="btn btn-ghost btn-sm" data-del-variant="${v.id}">Eliminar</button></td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty-state">Sin variantes todavía</td></tr>'}
      </tbody>
    </table>
    <form id="variant-form">
      <div class="form-grid">
        <div class="field full"><label>Nombre de la variante (igual para todas las opciones)</label><input name="name" value="${esc(sharedName)}" required></div>
        <div class="field"><label>Valor (ej. "Caramelo")</label><input name="value" required></div>
        <div class="field"><label>Precio de esta opción (opcional)</label><input type="number" step="0.01" name="price_override" placeholder="Igual que el producto"></div>
        <div class="field"><label>Stock</label><input type="number" name="stock" value="0"></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="modal-cancel">Cerrar</button>
        <button type="submit" class="btn btn-primary">Agregar variante</button>
      </div>
    </form>
  `);
  qs('#modal-cancel').addEventListener('click', closeModal);
  qs('#variant-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const priceRaw = fd.get('price_override');
    const { error } = await supabase.from('product_variants').insert({
      product_id: productId, name: fd.get('name'), value: fd.get('value'),
      price_override: priceRaw === '' ? null : Number(priceRaw),
      stock: Number(fd.get('stock')) || 0,
    });
    if (error) return alert('Error: ' + error.message);
    openVariantsModal(productId);
  });
  qsa('[data-del-variant]').forEach(btn => btn.addEventListener('click', async () => {
    await supabase.from('product_variants').delete().eq('id', btn.dataset.delVariant);
    openVariantsModal(productId);
  }));
}

// ============================================================
// Importar productos desde CSV
// ============================================================
// Columnas esperadas (encabezados exactos, en cualquier orden):
// name, category, unit, cost_price, base_price, tax_percent, stock, image_url, images, featured, active, description
// - "images" es opcional: varias URLs separadas por "|" (la primera queda de portada).
//   Si no se envía, se usa "image_url" como única foto.
// - "category" se busca por nombre y se crea automáticamente si no existe.
// - "slug" y "price" se calculan solos (price = base_price * (1 + tax_percent/100)).
// - Si el slug ya existe, el producto se actualiza en vez de duplicarse.
qs('#btn-import-csv').addEventListener('click', () => qs('#csv-file-input').click());

qs('#csv-file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: async results => {
      await importProductRows(results.data);
    },
    error: err => alert('No se pudo leer el CSV: ' + err.message),
  });
});

function toBool(v) {
  if (typeof v === 'boolean') return v;
  return ['true', '1', 'si', 'sí', 'yes'].includes(String(v || '').trim().toLowerCase());
}

async function importProductRows(rows) {
  const errors = [];
  const validRows = rows.filter(r => r.name && String(r.name).trim());
  if (!validRows.length) return alert('El CSV no tiene filas válidas (falta la columna "name").');

  // Mapa de categorías existentes, para no duplicar secciones.
  const { data: existingCats } = await supabase.from('categories').select('id, name');
  const catMap = new Map((existingCats || []).map(c => [c.name.trim().toLowerCase(), c.id]));

  const productsToUpsert = [];
  for (const row of validRows) {
    try {
      const name = String(row.name).trim();
      const catName = row.category ? String(row.category).trim() : null;
      let category_id = null;
      if (catName) {
        const key = catName.toLowerCase();
        if (catMap.has(key)) {
          category_id = catMap.get(key);
        } else {
          const { data: newCat, error: catErr } = await supabase
            .from('categories')
            .insert({ name: catName, slug: slugify(catName) })
            .select('id')
            .single();
          if (catErr) throw catErr;
          category_id = newCat.id;
          catMap.set(key, category_id);
        }
      }
      const base_price = Number(row.base_price) || 0;
      const tax_percent = Number(row.tax_percent) || 0;
      const images = row.images
        ? String(row.images).split('|').map(u => u.trim()).filter(Boolean)
        : (row.image_url ? [String(row.image_url).trim()] : []);
      productsToUpsert.push({
        name,
        slug: slugify(name),
        category_id,
        unit: row.unit || 'Unidad',
        cost_price: Number(row.cost_price) || 0,
        base_price,
        tax_percent,
        price: computeTotal(base_price, tax_percent),
        stock: Number(row.stock) || 0,
        images,
        image_url: images[0] || null,
        description: row.description || null,
        featured: toBool(row.featured),
        active: row.active === undefined || row.active === '' ? true : toBool(row.active),
      });
    } catch (err) {
      errors.push(`${row.name || '(sin nombre)'}: ${err.message}`);
    }
  }

  if (!productsToUpsert.length) {
    return alert('Ninguna fila se pudo procesar.\n' + errors.join('\n'));
  }

  const { data: upserted, error } = await supabase
    .from('products')
    .upsert(productsToUpsert, { onConflict: 'slug' })
    .select('id');

  if (error) {
    return alert('Error al importar: ' + error.message);
  }

  let msg = `Importación lista: ${upserted.length} producto(s) creado(s)/actualizado(s).`;
  if (errors.length) msg += `\n\n${errors.length} fila(s) con error:\n` + errors.join('\n');
  alert(msg);
  loadProducts();
}

qs('#btn-new-product').addEventListener('click', () => openProductModal(null));
qs('#btn-new-combo').addEventListener('click', () => openComboModal(null));
document.addEventListener('click', e => {
  const editP = e.target.closest('[data-edit-product]');
  if (editP) {
    const product = state.products.find(p => p.id === editP.dataset.editProduct);
    if (product.is_combo) openComboModal(product); else openProductModal(product);
  }
  const varBtn = e.target.closest('[data-variants]');
  if (varBtn) openVariantsModal(varBtn.dataset.variants);
});

// ============================================================
// Pedidos (orders)
// ============================================================
async function loadOrders() {
  const { data } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
  state.orders = data || [];
  const table = qs('#table-orders');
  table.querySelector('thead').innerHTML = `<tr><th>Cliente</th><th>Teléfono</th><th>Total</th><th>Estado</th><th>Fecha</th><th></th></tr>`;
  if (!state.orders.length) {
    table.querySelector('tbody').innerHTML = `<tr><td colspan="6" class="empty-state">Todavía no llegan pedidos.</td></tr>`;
    return;
  }
  const statuses = ['pendiente','confirmado','enviado','entregado','cancelado'];
  table.querySelector('tbody').innerHTML = state.orders.map(o => `
    <tr>
      <td>${esc(o.customer_name)}</td>
      <td>${esc(o.phone)}</td>
      <td>${formatPrice(o.total)}</td>
      <td><select data-status="${o.id}">${statuses.map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td>${new Date(o.created_at).toLocaleDateString('es-CO')}</td>
      <td class="table-actions">
        <button class="btn btn-ghost btn-sm" data-view-order="${o.id}">Ver</button>
        <button class="btn btn-ghost btn-sm" data-del="orders:${o.id}">Eliminar</button>
      </td>
    </tr>
  `).join('');
}
document.addEventListener('change', async e => {
  if (e.target.dataset.status) {
    await supabase.from('orders').update({ status: e.target.value }).eq('id', e.target.dataset.status);
  }
});
document.addEventListener('click', e => {
  const viewBtn = e.target.closest('[data-view-order]');
  if (!viewBtn) return;
  const order = state.orders.find(o => o.id === viewBtn.dataset.viewOrder);
  openModal(`
    <h3>Pedido de ${esc(order.customer_name)}</h3>
    <p style="color:var(--text-soft)">📱 ${esc(order.phone)} ${order.email ? '· ' + esc(order.email) : ''}</p>
    <p style="color:var(--text-soft)">${esc(order.address || '')}</p>
    <table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th></tr></thead><tbody>
      ${(order.items || []).map(i => `<tr><td>${esc(i.name)}${i.variant ? ' — ' + esc(i.variant) : ''}</td><td>${i.qty}</td><td>${formatPrice(i.price)}</td></tr>`).join('')}
    </tbody></table>
    <div class="summary-total"><span>Total</span><span>${formatPrice(order.total)}</span></div>
    <div class="modal-actions"><button class="btn btn-primary" id="modal-cancel">Cerrar</button></div>
  `);
  qs('#modal-cancel').addEventListener('click', closeModal);
});

// ============================================================
// Resumen / estadísticas
// ============================================================
async function loadStats() {
  const [{ count: productCount }, { count: pendingOrders }, { count: clientCount }] = await Promise.all([
    supabase.from('products').select('*', { count: 'exact', head: true }),
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'pendiente'),
    supabase.from('clients').select('*', { count: 'exact', head: true }),
  ]);
  const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);

  const [{ data: sales }, { data: expenses }] = await Promise.all([
    supabase.from('transactions').select('amount, product_id, quantity').eq('type', 'venta').gte('created_at', startOfMonth.toISOString()),
    supabase.from('transactions').select('amount').eq('type', 'gasto').gte('created_at', startOfMonth.toISOString()),
  ]);

  const revenue = (sales || []).reduce((s, t) => s + Number(t.amount), 0);
  // "Ahorro sugerido" = lo que costó reponer lo que se vendió (costo por unidad × cantidad).
  // Ganancia = lo que queda después de separar ese costo (y, en la neta, los gastos).
  const cogs = (sales || []).reduce((s, t) => {
    const product = (state.products || []).find(p => p.id === t.product_id);
    return s + (product ? Number(product.cost_price || 0) * (t.quantity || 0) : 0);
  }, 0);
  const gastos = (expenses || []).reduce((s, t) => s + Number(t.amount), 0);
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - gastos;

  qs('#stat-grid').innerHTML = `
    <div class="stat-card"><div class="num">${productCount ?? 0}</div><div class="label">Productos</div></div>
    <div class="stat-card"><div class="num">${pendingOrders ?? 0}</div><div class="label">Pedidos pendientes</div></div>
    <div class="stat-card"><div class="num">${clientCount ?? 0}</div><div class="label">Clientes</div></div>
    <div class="stat-card"><div class="num">${formatPrice(revenue)}</div><div class="label">Ventas este mes</div></div>
    <div class="stat-card"><div class="num">${formatPrice(cogs)}</div><div class="label">Ahorro sugerido (costo de lo vendido)</div></div>
    <div class="stat-card"><div class="num">${formatPrice(grossProfit)}</div><div class="label">Ganancia bruta este mes</div></div>
    <div class="stat-card"><div class="num">${formatPrice(gastos)}</div><div class="label">Gastos este mes</div></div>
    <div class="stat-card"><div class="num">${formatPrice(netProfit)}</div><div class="label">Ganancia neta este mes</div></div>
  `;

  await loadSalesSummary();

  const { data: topViewed } = await supabase.from('top_viewed_products').select('*').limit(8);
  if (topViewed && topViewed.length) {
    const max = Math.max(...topViewed.map(v => v.views));
    qs('#chart-views').innerHTML = topViewed.map(v => `
      <div class="bar-row"><span class="name">${esc(v.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${(v.views / max) * 100}%"></div></div><span class="val">${v.views}</span></div>
    `).join('');
  }

  const { data: topSearched } = await supabase.from('top_searched_terms').select('*').limit(8);
  if (topSearched && topSearched.length) {
    const max = Math.max(...topSearched.map(v => v.veces));
    qs('#chart-search').innerHTML = topSearched.map(v => `
      <div class="bar-row"><span class="name">${esc(v.term)}</span><div class="bar-track"><div class="bar-fill" style="width:${(v.veces / max) * 100}%"></div></div><span class="val">${v.veces}</span></div>
    `).join('');
  }
}

// Junta las filas de "transactions" que pertenecen a una misma venta
// (comparten sale_id) para mostrar una sola tarjeta por venta, aunque haya
// incluido varios productos.
async function loadSalesSummary() {
  const { data } = await supabase.from('transactions').select('*').eq('type', 'venta').order('created_at', { ascending: false }).limit(60);
  const rows = data || [];
  const groups = new Map();
  rows.forEach(r => {
    const key = r.sale_id || r.id;
    if (!groups.has(key)) groups.set(key, { created_at: r.created_at, items: [], total: 0 });
    const g = groups.get(key);
    g.items.push(r);
    g.total += Number(r.amount);
  });
  const sales = [...groups.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 15);

  const table = qs('#table-sales-summary');
  table.querySelector('thead').innerHTML = `<tr><th>Fecha</th><th>Productos</th><th>Total</th></tr>`;
  if (!sales.length) {
    table.querySelector('tbody').innerHTML = `<tr><td colspan="3" class="empty-state">Todavía no hay ventas registradas.</td></tr>`;
    return;
  }
  table.querySelector('tbody').innerHTML = sales.map(s => `
    <tr>
      <td>${new Date(s.created_at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</td>
      <td>${s.items.map(i => esc(i.concept)).join(', ')}</td>
      <td>${formatPrice(s.total)}</td>
    </tr>
  `).join('');
}

// ============================================================
// Reportes (CSV)
// ============================================================
function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]).filter(k => typeof rows[0][k] !== 'object');
  const escCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers.join(','), ...rows.map(r => headers.map(h => escCsv(r[h])).join(','))].join('\n');
}
function downloadCSV(filename, rows) {
  if (!rows.length) return alert('No hay datos para exportar.');
  const blob = new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
qsa('[data-report]').forEach(btn => btn.addEventListener('click', async () => {
  const key = btn.dataset.report;
  const table = key === 'products' ? 'products' : key === 'transactions' ? 'transactions' : key === 'orders' ? 'orders' : 'clients';
  const { data } = await supabase.from(table).select('*');
  downloadCSV(`kori-${key}.csv`, data || []);
}));

// ============================================================
// Init
// ============================================================
async function initDashboard() {
  initTabs();
  await genericLoad('categories');
  await Promise.all([
    loadProducts(),
    genericLoad('clients'),
    genericLoad('providers'),
    genericLoad('employees'),
    genericLoad('transactions'),
    genericLoad('quotes'),
    loadOrders(),
    loadStats(),
  ]);
}
