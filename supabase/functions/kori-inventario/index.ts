// MCP remoto de inventario para Kori Cosmetics.
// Claude lee las fotos (listas de precios, capturas de inventario) y usa estas
// herramientas para crear o editar productos. Protocolo MCP "Streamable HTTP"
// sin estado: cada POST es un mensaje JSON-RPC y se responde con JSON.
//
// Acceso: la URL termina en una llave secreta
//   https://<proyecto>.supabase.co/functions/v1/kori-inventario/<LLAVE>
// Aquí solo vive el SHA-256 de la llave. Para cambiarla: genera otra, pega su
// hash en KEY_SHA256 y vuelve a desplegar.
import { createClient } from 'npm:@supabase/supabase-js@2';

const KEY_SHA256 = '3404e7664f38053c2a327a78ea8977e503659f715b2225e9e10dfe085b8bdc41';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const INSTRUCTIONS = `Inventario de Kori Cosmetics (tienda de maquillaje en Colombia, precios en pesos COP).

Flujo para fotos de listas de precios o capturas de inventario:
1. Llama ver_inventario para conocer las secciones y los productos que ya existen.
2. Lee la imagen renglón por renglón: tipo de producto, marca, tono o referencia, presentación, cantidades y precios. Si algo se ve borroso o es ambiguo, pregunta antes de guardar.
3. Relaciona cada renglón con un producto existente (pasa su id para editarlo) o trátalo como nuevo. No dupliques productos que ya existen con otro nombre.
4. Llama guardar_productos con confirmar=false, muestra el resumen y solo con el visto bueno de la persona vuelve a llamar con confirmar=true.

Reglas:
- Nombre: mismo estilo de los productos existentes (hoy en MAYÚSCULAS: TIPO + MARCA + tono o referencia), ej. "BASE HD ENGOL COLLECTIONS - TONO 02".
- Sección: usa una de las existentes; crea una nueva solo si de verdad no encaja en ninguna.
- En una lista de proveedor, su precio es el costo (cost_price). Si no hay precio de venta, pregunta el margen o el precio al público (price).
- Precios en pesos enteros: "12.500" o "12,5 mil" = 12500.
- Escribe una descripción corta y atractiva (1 o 2 frases) para cada producto nuevo.
- Los productos nuevos quedan ocultos hasta tener foto. Las fotos se suben desde el panel (Productos > Sin foto) y al subirla el producto se publica.
- Conteo o captura de inventario: usa stock (valor absoluto). Mercancía que llegó: stock_add.`;

const VARIANT_SCHEMA = {
  type: 'object',
  properties: {
    value: { type: 'string', description: 'Ej. "Rojo 05".' },
    stock: { type: 'integer' },
    price: { type: 'number', description: 'Solo si esta variante cuesta distinto al producto.' },
  },
  required: ['value'],
};

const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'id de un producto existente (de ver_inventario) para editarlo. Sin id se busca por nombre y, si no existe, se crea.' },
    name: { type: 'string', description: 'Nombre completo, ej. "LABIAL LIQUIDO MATE RUBY ROSE - ROJO 05". Obligatorio para productos nuevos.' },
    category: { type: 'string', description: 'Nombre de la sección.' },
    unit: { type: 'string', enum: ['Unidad', 'Caja', 'Docena', 'Kit', 'Set'] },
    cost_price: { type: 'number', description: 'Costo por unidad (lo que paga la tienda).' },
    price: { type: 'number', description: 'Precio final al público, impuesto incluido.' },
    tax_percent: { type: 'number', description: 'Impuesto %. Casi todo el catálogo usa 0.' },
    stock: { type: 'integer', description: 'Unidades en inventario. Reemplaza el valor actual.' },
    stock_add: { type: 'integer', description: 'Unidades a sumar al stock actual (negativo para restar).' },
    description: { type: 'string', description: '1 o 2 frases en español para la tienda.' },
    active: { type: 'boolean', description: 'Visible en la tienda. Los nuevos quedan ocultos hasta tener foto, salvo que envíes true.' },
    featured: { type: 'boolean', description: 'Destacado en la tienda.' },
    variant_name: { type: 'string', description: 'Nombre del grupo de variantes. Por defecto "Tono".' },
    variants: { type: 'array', items: VARIANT_SCHEMA, description: 'Tonos u opciones. Las que ya existen (mismo valor) se actualizan; las demás se crean.' },
  },
};

const TOOLS = [
  {
    name: 'ver_inventario',
    description: 'Lista las secciones y los productos de Kori Cosmetics con id, sección, costo, precio, stock, si tiene foto, si está visible y sus variantes. Úsala antes de guardar para no duplicar productos.',
    inputSchema: {
      type: 'object',
      properties: {
        buscar: { type: 'string', description: 'Filtra por palabras en el nombre o la sección (sin importar tildes).' },
        solo_sin_foto: { type: 'boolean', description: 'Solo productos que todavía no tienen foto.' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'guardar_productos',
    description: 'Crea o edita varios productos a la vez. Con confirmar=false solo muestra qué cambiaría; con confirmar=true lo guarda. Solo se modifican los campos que envíes.',
    inputSchema: {
      type: 'object',
      properties: {
        productos: { type: 'array', items: PRODUCT_SCHEMA, maxItems: 300 },
        confirmar: { type: 'boolean', description: 'false = vista previa (por defecto), true = guardar.' },
      },
      required: ['productos'],
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
];

// ---------- Helpers ----------
const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const money = (n: number) => COP.format(Number(n) || 0);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Igual que slugify() de assets/app.js, para que las URLs de la tienda coincidan.
const slugify = (s: string) => s.trim().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
const num = (v: unknown) => (v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Number(v));
const int = (v: unknown) => (num(v) === null ? null : Math.round(Number(v)));

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// ---------- ver_inventario ----------
async function verInventario(args: Row) {
  const [{ data: products, error }, { data: cats, error: catErr }] = await Promise.all([
    db.from('products').select('id,name,unit,cost_price,price,tax_percent,stock,image_url,active,is_combo,categories(name),product_variants(name,value,stock)').order('name'),
    db.from('categories').select('name').order('sort_order'),
  ]);
  if (error || catErr) throw error || catErr;

  const words = norm(String(args.buscar || '')).split(/\s+/).filter(Boolean);
  const list = (products as Row[]).filter(p => {
    if (args.solo_sin_foto && p.image_url) return false;
    const hay = norm(`${p.name} ${p.categories?.name || ''}`);
    return words.every(w => hay.includes(w));
  });

  const lines = list.map(p => [
    p.id, p.name, p.categories?.name || 'sin sección',
    `costo ${money(p.cost_price)}`, `precio ${money(p.price)}`, Number(p.tax_percent) ? `iva ${Number(p.tax_percent)}%` : null,
    `stock ${p.stock} ${p.unit}`, p.image_url ? 'con foto' : 'SIN FOTO', p.active ? 'visible' : 'oculto', p.is_combo ? 'combo' : null,
    p.product_variants?.length ? 'variantes: ' + p.product_variants.map((v: Row) => `${v.value}(${v.stock})`).join(', ') : null,
  ].filter(Boolean).join(' | '));

  return `Secciones: ${(cats as Row[]).map(c => c.name).join(', ')}\n` +
    `Productos (${list.length} de ${products!.length}):\n${lines.join('\n') || '(ninguno coincide)'}`;
}

// ---------- guardar_productos ----------
const PRODUCT_COLS = ['id', 'name', 'slug', 'category_id', 'unit', 'cost_price', 'base_price', 'tax_percent', 'price', 'stock', 'description', 'active', 'featured'];
const DIFF_LABELS: Record<string, string> = {
  name: 'nombre', category_id: 'sección', unit: 'unidad', cost_price: 'costo', price: 'precio',
  tax_percent: 'iva %', stock: 'stock', description: 'descripción', active: 'visible', featured: 'destacado',
};

async function guardarProductos(args: Row) {
  const items: Row[] = Array.isArray(args.productos) ? args.productos : [];
  if (!items.length) throw new Error('"productos" debe ser una lista con al menos un producto.');
  if (items.length > 300) throw new Error('Máximo 300 productos por llamada; divide la lista.');
  const confirmar = args.confirmar === true;

  const [{ data: products, error: pErr }, { data: cats, error: cErr }] = await Promise.all([
    db.from('products').select(PRODUCT_COLS.join(',')),
    db.from('categories').select('id,name'),
  ]);
  if (pErr || cErr) throw pErr || cErr;

  // Se identifica por nombre, no por slug: muchos productos se renombraron y
  // conservan el slug viejo (otro producto distinto podría generar ese slug).
  const nameKey = (s: string) => norm(s).replace(/\s+/g, ' ').trim();
  const byId = new Map((products as Row[]).map(p => [p.id, p]));
  const byName = new Map((products as Row[]).map(p => [nameKey(p.name), p]));
  const takenSlugs = new Set((products as Row[]).map(p => String(p.slug).toLowerCase()));
  const freeSlug = (base: string) => {
    let s = base, n = 2;
    while (takenSlugs.has(s.toLowerCase())) s = `${base}-${n++}`;
    takenSlugs.add(s.toLowerCase());
    return s;
  };
  const catByKey = new Map((cats as Row[]).map(c => [slugify(c.name).toLowerCase(), c]));
  const catName = new Map((cats as Row[]).map(c => [c.id, c.name]));
  const newCats: Row[] = [];

  // Variantes actuales de los productos existentes que traen variantes.
  const variantIds = items.filter(i => Array.isArray(i.variants) && i.variants.length).map(i => i.id || byName.get(nameKey(String(i.name || '')))?.id).filter(Boolean);
  const { data: oldVariants, error: vErr } = variantIds.length
    ? await db.from('product_variants').select('id,product_id,name,value,stock,price_override').in('product_id', variantIds)
    : { data: [], error: null };
  if (vErr) throw vErr;

  const productRows: Row[] = [];
  const variantRows: Row[] = [];
  const out: string[] = [];
  const seen = new Set<string>();

  items.forEach((it, i) => {
    const name = typeof it.name === 'string' ? it.name.trim() : '';
    const existing = it.id ? byId.get(it.id) : byName.get(nameKey(name));
    if (it.id && !existing) return out.push(`ERROR #${i + 1}: no existe un producto con id ${it.id}`);
    if (!existing && !slugify(name)) return out.push(`ERROR #${i + 1}: falta un "name" válido`);
    const key = existing ? existing.id : nameKey(name);
    if (seen.has(key)) return out.push(`ERROR #${i + 1}: "${name || existing.name}" está repetido en esta lista`);
    seen.add(key);

    const prev: Row = existing ?? {
      id: crypto.randomUUID(), name, slug: freeSlug(slugify(name)), category_id: null, unit: 'Unidad', cost_price: 0, base_price: 0,
      tax_percent: 0, price: 0, stock: 0, description: null, active: false, featured: false,
    };
    const next: Row = { ...prev };
    // Solo se renombra si se pidió por id; el slug (la URL) nunca cambia.
    if (name && (!existing || it.id)) next.name = name;
    if (typeof it.category === 'string' && it.category.trim()) {
      const k = slugify(it.category).toLowerCase();
      let cat = catByKey.get(k);
      if (!cat) {
        cat = { id: crypto.randomUUID(), name: it.category.trim(), slug: slugify(it.category) };
        catByKey.set(k, cat); catName.set(cat.id, cat.name); newCats.push(cat);
      }
      next.category_id = cat.id;
    }
    if (typeof it.unit === 'string' && it.unit) next.unit = it.unit;
    if (num(it.cost_price) !== null) next.cost_price = num(it.cost_price);
    if (num(it.tax_percent) !== null) next.tax_percent = num(it.tax_percent);
    const tax = 1 + (Number(next.tax_percent) || 0) / 100;
    if (num(it.price) !== null) {
      next.price = Math.round(num(it.price)!);
      next.base_price = Math.round((next.price / tax) * 100) / 100;
    } else if (Number(next.tax_percent) !== Number(prev.tax_percent)) {
      next.price = Math.round(Number(next.base_price) * tax);
    }
    if (int(it.stock) !== null) next.stock = int(it.stock);
    if (int(it.stock_add) !== null) next.stock = (Number(next.stock) || 0) + int(it.stock_add)!;
    if (typeof it.description === 'string') next.description = it.description.trim() || null;
    if (typeof it.active === 'boolean') next.active = it.active;
    if (typeof it.featured === 'boolean') next.featured = it.featured;

    // Variantes: se actualizan por valor (sin importar mayúsculas) o se crean.
    const vNotes: string[] = [];
    if (Array.isArray(it.variants)) {
      const mine = (oldVariants as Row[]).filter(v => v.product_id === next.id);
      const groupName = (typeof it.variant_name === 'string' && it.variant_name.trim()) || mine[0]?.name || 'Tono';
      for (const v of it.variants) {
        const value = typeof v?.value === 'string' ? v.value.trim() : '';
        if (!value) continue;
        const old = mine.find(o => norm(o.value) === norm(value));
        const row = old ? { ...old } : { id: crypto.randomUUID(), product_id: next.id, name: groupName, value, stock: 0, price_override: null };
        if (int(v.stock) !== null) row.stock = int(v.stock);
        if (num(v.price) !== null) row.price_override = num(v.price);
        if (old && row.stock === old.stock && Number(row.price_override) === Number(old.price_override)) continue;
        variantRows.push(row);
        vNotes.push(old ? `${old.value} stock ${old.stock} → ${row.stock}` : `${value} (${row.stock})`);
      }
    }

    const changes = Object.keys(DIFF_LABELS).filter(k => String(next[k] ?? '') !== String(prev[k] ?? ''));
    const show = (k: string, r: Row) => k === 'category_id' ? (catName.get(r[k]) || 'sin sección')
      : k === 'cost_price' || k === 'price' ? money(r[k])
      : typeof r[k] === 'boolean' ? (r[k] ? 'sí' : 'no')
      : k === 'description' ? `"${String(r[k] ?? '').slice(0, 60)}"` : String(r[k] ?? '');
    const variantText = vNotes.length ? ` | variantes: ${vNotes.join(', ')}` : '';

    if (!existing) {
      out.push(`+ NUEVO ${next.name} | ${show('category_id', next)} | costo ${money(next.cost_price)} | precio ${money(next.price)} | stock ${next.stock} ${next.unit}${next.active ? '' : ' | oculto hasta tener foto'}${variantText}`);
    } else if (changes.length || vNotes.length) {
      out.push(`~ EDITAR ${prev.name}: ${changes.map(k => `${DIFF_LABELS[k]} ${show(k, prev)} → ${show(k, next)}`).join('; ') || 'sin cambios en el producto'}${variantText}`);
    } else {
      out.push(`= SIN CAMBIOS ${prev.name}`);
    }
    if (!existing || changes.length) productRows.push({ ...Object.fromEntries(PRODUCT_COLS.map(c => [c, next[c]])), updated_at: new Date().toISOString() });
  });

  const header = newCats.length ? `Secciones nuevas: ${newCats.map(c => c.name).join(', ')}\n` : '';
  if (!confirmar) {
    return `VISTA PREVIA (no se guardó nada)\n${header}${out.join('\n')}\n\nSi todo está bien, vuelve a llamar con confirmar=true.`;
  }

  if (newCats.length) {
    const { error } = await db.from('categories').insert(newCats);
    if (error) throw new Error('No se pudieron crear las secciones: ' + error.message);
  }
  if (productRows.length) {
    const { error } = await db.from('products').upsert(productRows, { onConflict: 'id' });
    if (error) throw new Error('No se guardaron los productos: ' + error.message);
  }
  if (variantRows.length) {
    const { error } = await db.from('product_variants').upsert(variantRows, { onConflict: 'id' });
    if (error) throw new Error('Los productos se guardaron, pero las variantes no: ' + error.message);
  }
  return `GUARDADO: ${productRows.length} producto(s), ${variantRows.length} variante(s)\n${header}${out.join('\n')}`;
}

const HANDLERS: Record<string, (args: Row) => Promise<string>> = {
  ver_inventario: verInventario,
  guardar_productos: guardarProductos,
};

// ---------- JSON-RPC ----------
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const result = (id: unknown, res: unknown) => json({ jsonrpc: '2.0', id, result: res });
const rpcError = (id: unknown, code: number, message: string) => json({ jsonrpc: '2.0', id, error: { code, message } });

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Método no permitido', { status: 405, headers: { Allow: 'POST' } });

  // Llave en la URL (conector de Claude) o en "Authorization: Bearer" (otros clientes).
  const pathKey = new URL(req.url).pathname.split('/').filter(Boolean).pop() || '';
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if ((await sha256(pathKey)) !== KEY_SHA256 && (await sha256(bearer)) !== KEY_SHA256) {
    return new Response('No encontrado', { status: 404 });
  }

  let msg: Row;
  try { msg = await req.json(); } catch { return rpcError(null, -32700, 'JSON inválido'); }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return rpcError(null, -32600, 'Petición inválida');
  if (msg.id === undefined) return new Response(null, { status: 202 }); // notificación

  switch (msg.method) {
    case 'initialize':
      return result(msg.id, {
        protocolVersion: msg.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'kori-inventario', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    case 'ping':
      return result(msg.id, {});
    case 'tools/list':
      return result(msg.id, { tools: TOOLS });
    case 'tools/call': {
      const handler = HANDLERS[msg.params?.name];
      if (!handler) return rpcError(msg.id, -32602, `Herramienta desconocida: ${msg.params?.name}`);
      try {
        return result(msg.id, { content: [{ type: 'text', text: await handler(msg.params.arguments || {}) }] });
      } catch (e) {
        return result(msg.id, { content: [{ type: 'text', text: 'Error: ' + (e instanceof Error ? e.message : JSON.stringify(e)) }], isError: true });
      }
    }
    default:
      return rpcError(msg.id, -32601, `Método no soportado: ${msg.method}`);
  }
});
