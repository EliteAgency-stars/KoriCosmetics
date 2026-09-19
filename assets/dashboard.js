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
function openModal(html) {
  qs('#modal-content').innerHTML = html;
  qs('#modal-overlay').classList.remove('hidden');
}
function closeModal() {
  qs('#modal-overlay').classList.add('hidden');
  qs('#modal-content').innerHTML = '';
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
      ['concept','Concepto'], ['amount','Monto', v => formatPrice(v)],
      ['created_at','Fecha', v => new Date(v).toLocaleDateString('es-CO')],
    ],
    fields: [
      { key:'type', label:'Tipo', type:'select', options:[['venta','Venta'],['gasto','Gasto']], required:true },
      { key:'concept', label:'Concepto', type:'text', required:true, full:true },
      { key:'amount', label:'Monto', type:'number', required:true },
      { key:'category', label:'Categoría', type:'text' },
      { key:'notes', label:'Notas', type:'text', full:true },
    ],
    noEdit: true, // los movimientos no se editan, solo se registran y consultan
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
      ${cfg.columns.map(c => `<td>${c[2] ? c[2](row[c[0]]) : esc(row[c[0]])}</td>`).join('')}
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
// Productos (con variantes, imagen y cálculo de precio)
// ============================================================
async function loadProducts() {
  const { data } = await supabase.from('products').select('*, categories(name)').order('created_at', { ascending: false });
  state.products = data || [];
  const table = qs('#table-productos');
  table.querySelector('thead').innerHTML = `<tr><th></th><th>Nombre</th><th>Sección</th><th>Precio</th><th>Stock</th><th>Estado</th><th></th></tr>`;
  if (!state.products.length) {
    table.querySelector('tbody').innerHTML = `<tr><td colspan="7" class="empty-state">Aún no has creado productos.</td></tr>`;
    return;
  }
  table.querySelector('tbody').innerHTML = state.products.map(p => `
    <tr>
      <td>${p.image_url ? `<img src="${p.image_url}" style="width:40px;height:40px;border-radius:8px;object-fit:cover">` : '💄'}</td>
      <td>${esc(p.name)}</td>
      <td>${p.categories ? esc(p.categories.name) : '—'}</td>
      <td>${formatPrice(p.price)}</td>
      <td>${p.stock}</td>
      <td>${p.active ? '<span class="tag tag-green">Activo</span>' : '<span class="tag tag-red">Inactivo</span>'} ${p.featured ? '<span class="tag tag-neutral">Destacado</span>' : ''}</td>
      <td class="table-actions">
        <button class="btn btn-ghost btn-sm" data-edit-product="${p.id}">Editar</button>
        <button class="btn btn-ghost btn-sm" data-variants="${p.id}">Variantes</button>
        <button class="btn btn-ghost btn-sm" data-del="products:${p.id}">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

function computeTotal(base, tax) { return Math.round((base || 0) * (1 + (tax || 0) / 100)); }

function openProductModal(row) {
  const cats = state.categories || [];
  openModal(`
    <h3>${row ? 'Editar' : 'Nuevo'} producto</h3>
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
        <div class="field"><label>Precio base</label><input type="number" step="0.01" name="base_price" id="base_price" value="${row ? row.base_price : 0}"></div>
        <div class="field"><label>Impuesto %</label><input type="number" step="0.01" name="tax_percent" id="tax_percent" value="${row ? row.tax_percent : 0}"></div>
        <div class="field"><label>Precio total al público</label><input type="text" id="price_preview" disabled value="${formatPrice(row ? row.price : 0)}"></div>
        <div class="field full"><label>Descripción</label><textarea name="description" rows="3">${row ? esc(row.description || '') : ''}</textarea></div>
        <div class="field full"><label>Imagen (URL o sube un archivo)</label>
          <input type="text" name="image_url" id="image_url" placeholder="https://..." value="${row ? esc(row.image_url || '') : ''}">
          <input type="file" id="image_file" accept="image/*" style="margin-top:8px">
        </div>
        <div class="field"><label><input type="checkbox" name="featured" ${row && row.featured ? 'checked' : ''}> Destacado</label></div>
        <div class="field"><label><input type="checkbox" name="active" ${!row || row.active ? 'checked' : ''}> Activo (visible en la tienda)</label></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="modal-cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">Guardar</button>
      </div>
    </form>
  `);

  const updatePreview = () => {
    const base = Number(qs('#base_price').value) || 0;
    const tax = Number(qs('#tax_percent').value) || 0;
    qs('#price_preview').value = formatPrice(computeTotal(base, tax));
  };
  qs('#base_price').addEventListener('input', updatePreview);
  qs('#tax_percent').addEventListener('input', updatePreview);
  qs('#modal-cancel').addEventListener('click', closeModal);

  qs('#image_file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const path = `${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from('product-images').upload(path, file);
    if (error) return alert('Error al subir imagen: ' + error.message);
    const { data } = supabase.storage.from('product-images').getPublicUrl(path);
    qs('#image_url').value = data.publicUrl;
  });

  qs('#product-form').addEventListener('submit', async e => {
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
      image_url: fd.get('image_url') || null,
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

async function openVariantsModal(productId) {
  const product = state.products.find(p => p.id === productId);
  const { data } = await supabase.from('product_variants').select('*').eq('product_id', productId).order('created_at');
  const variants = data || [];
  openModal(`
    <h3>Variantes — ${esc(product.name)}</h3>
    <table style="margin-bottom:16px">
      <thead><tr><th>Nombre</th><th>Valor</th><th>Ajuste $</th><th>Stock</th><th></th></tr></thead>
      <tbody id="variant-rows">
        ${variants.map(v => `<tr>
          <td>${esc(v.name)}</td><td>${esc(v.value)}</td><td>${formatPrice(v.price_adjustment)}</td><td>${v.stock}</td>
          <td><button class="btn btn-ghost btn-sm" data-del-variant="${v.id}">Eliminar</button></td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty-state">Sin variantes</td></tr>'}
      </tbody>
    </table>
    <form id="variant-form">
      <div class="form-grid">
        <div class="field"><label>Nombre (ej. Color)</label><input name="name" required></div>
        <div class="field"><label>Valor (ej. Rojo Pasión)</label><input name="value" required></div>
        <div class="field"><label>Ajuste de precio</label><input type="number" name="price_adjustment" value="0"></div>
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
    const { error } = await supabase.from('product_variants').insert({
      product_id: productId, name: fd.get('name'), value: fd.get('value'),
      price_adjustment: Number(fd.get('price_adjustment')) || 0, stock: Number(fd.get('stock')) || 0,
    });
    if (error) return alert('Error: ' + error.message);
    openVariantsModal(productId);
  });
  qsa('[data-del-variant]').forEach(btn => btn.addEventListener('click', async () => {
    await supabase.from('product_variants').delete().eq('id', btn.dataset.delVariant);
    openVariantsModal(productId);
  }));
}

qs('#btn-new-product').addEventListener('click', () => openProductModal(null));
document.addEventListener('click', e => {
  const editP = e.target.closest('[data-edit-product]');
  if (editP) openProductModal(state.products.find(p => p.id === editP.dataset.editProduct));
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
  const { data: sales } = await supabase.from('transactions').select('amount').eq('type', 'venta').gte('created_at', startOfMonth.toISOString());
  const revenue = (sales || []).reduce((s, t) => s + Number(t.amount), 0);

  qs('#stat-grid').innerHTML = `
    <div class="stat-card"><div class="num">${productCount ?? 0}</div><div class="label">Productos</div></div>
    <div class="stat-card"><div class="num">${pendingOrders ?? 0}</div><div class="label">Pedidos pendientes</div></div>
    <div class="stat-card"><div class="num">${clientCount ?? 0}</div><div class="label">Clientes</div></div>
    <div class="stat-card"><div class="num">${formatPrice(revenue)}</div><div class="label">Ventas este mes</div></div>
  `;

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
