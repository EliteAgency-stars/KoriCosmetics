// ---------- Supabase ----------
const SUPABASE_URL = 'https://opagblruzwsrxsggkjsa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_O30dPx3jfAA3m2CUnw7nCQ_jsuZiwRj';
// El script del CDN expone el namespace de la librería como `window.supabase`;
// lo reemplazamos por la instancia del cliente (reasignar, no redeclarar,
// para no chocar con esa variable global ya existente).
window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ADMIN_EMAIL = 'koricosmetics@admin.com';

// ---------- Theme ----------
function initTheme() {
  const saved = localStorage.getItem('kori_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  document.querySelectorAll('.theme-toggle .knob').forEach(k => k.textContent = saved === 'dark' ? '🌙' : '☀️');
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', current);
  localStorage.setItem('kori_theme', current);
  document.querySelectorAll('.theme-toggle .knob').forEach(k => k.textContent = current === 'dark' ? '🌙' : '☀️');
}
initTheme();

// ---------- Helpers ----------
function formatPrice(n) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
}
function slugify(name) {
  return name
    .trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }

// ---------- Cart (localStorage) ----------
const CART_KEY = 'kori_cart';
function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; }
}
function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}
function addToCart(item) {
  const cart = getCart();
  const existing = cart.find(i => i.id === item.id && i.variant === item.variant);
  if (existing) existing.qty += item.qty || 1;
  else cart.push({ ...item, qty: item.qty || 1 });
  saveCart(cart);
}
function removeFromCart(id, variant) {
  saveCart(getCart().filter(i => !(i.id === id && i.variant === variant)));
}
function updateCartQty(id, variant, qty) {
  const cart = getCart();
  const item = cart.find(i => i.id === id && i.variant === variant);
  if (item) item.qty = Math.max(1, qty);
  saveCart(cart);
}
function cartTotal(cart = getCart()) {
  return cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
}
function cartCount(cart = getCart()) {
  return cart.reduce((sum, i) => sum + i.qty, 0);
}
function updateCartBadge() {
  qsa('.cart-count').forEach(el => {
    const count = cartCount();
    el.textContent = count;
    el.style.display = count > 0 ? 'flex' : 'none';
  });
}

// ---------- Analytics logging (best-effort, never blocks UI) ----------
async function logProductView(productId) {
  try { await supabase.from('product_views').insert({ product_id: productId }); } catch (e) {}
}
async function logSearch(term) {
  if (!term || !term.trim()) return;
  try { await supabase.from('search_logs').insert({ term: term.trim() }); } catch (e) {}
}

// ---------- Auth state (used by nav + dashboard guard) ----------
async function getCurrentProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data } = await supabase
    .from('profiles')
    .select('id, email, role')
    .eq('id', session.user.id)
    .single();
  return data || { id: session.user.id, email: session.user.email, role: 'customer' };
}

async function renderAuthNav() {
  const slot = qs('#nav-auth-slot');
  if (!slot) return;
  const profile = await getCurrentProfile();
  if (profile && profile.role === 'admin') {
    slot.innerHTML = `<a href="dashboard.html" class="btn btn-outline btn-sm">Panel admin</a>`;
  } else if (profile) {
    slot.innerHTML = `<button class="btn btn-ghost btn-sm" id="logout-btn">Salir</button>`;
    qs('#logout-btn').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });
  } else {
    slot.innerHTML = `<a href="login.html" class="btn btn-outline btn-sm">Ingresar</a>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();
  qsa('.theme-toggle').forEach(btn => btn.addEventListener('click', toggleTheme));
  renderAuthNav();
});
