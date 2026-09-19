-- ============================================================
-- KORI COSMETICS — Esquema Supabase
-- Proyecto: opagblruzwsrxsggkjsa
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. PERFILES (vincula auth.users con rol admin/cliente)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'customer' check (role in ('admin','customer')),
  created_at timestamptz not null default now()
);

-- Crea el perfil automáticamente cuando alguien se registra.
-- El correo koricosmetics@admin.com queda marcado como admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case when lower(new.email) = 'koricosmetics@admin.com' then 'admin' else 'customer' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Como el usuario admin ya existía en Authentication antes de crear
-- este trigger, lo insertamos/actualizamos manualmente aquí:
insert into public.profiles (id, email, role)
select id, email, 'admin'
from auth.users
where lower(email) = 'koricosmetics@admin.com'
on conflict (id) do update set role = 'admin';

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ------------------------------------------------------------
-- 2. CATEGORÍAS / SECCIONES
-- ------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3. PRODUCTOS
-- ------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  category_id uuid references public.categories(id) on delete set null,
  unit text not null default 'Unidad',
  cost_price numeric(12,2) not null default 0,
  base_price numeric(12,2) not null default 0,
  tax_percent numeric(5,2) not null default 0,
  price numeric(12,2) not null default 0, -- precio final al público (base + impuesto)
  stock int not null default 0,
  image_url text,
  featured boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_slug_idx on public.products (slug);
create index if not exists products_category_idx on public.products (category_id);

-- Variantes de producto (ej: Color = Rojo, Tono = Claro)
create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,        -- ej: "Color"
  value text not null,       -- ej: "Rojo Pasión"
  sku text,
  price_adjustment numeric(12,2) not null default 0,
  stock int not null default 0,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 4. CLIENTES Y PROVEEDORES
-- ------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  document_id text,
  email text,
  phone text,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  email text,
  phone text,
  address text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5. EMPLEADOS (ilimitados)
-- ------------------------------------------------------------
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  role_title text,
  salary numeric(12,2),
  hire_date date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 6. VENTAS Y GASTOS (con número de comprobante)
-- ------------------------------------------------------------
create sequence if not exists public.receipt_seq start 1;

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('venta','gasto')),
  receipt_number text not null default ('KC-' || lpad(nextval('public.receipt_seq')::text, 6, '0')),
  concept text not null,
  client_id uuid references public.clients(id) on delete set null,
  provider_id uuid references public.providers(id) on delete set null,
  amount numeric(12,2) not null,
  category text,
  notes text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 7. COTIZACIONES (ilimitadas)
-- ------------------------------------------------------------
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  client_name text,
  items jsonb not null default '[]'::jsonb,
  total numeric(12,2) not null default 0,
  status text not null default 'pendiente' check (status in ('pendiente','aceptada','rechazada')),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 8. PEDIDOS / CARRITO (checkout público, sin necesidad de cuenta)
-- ------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone text not null,
  email text,
  address text,
  items jsonb not null default '[]'::jsonb,
  total numeric(12,2) not null default 0,
  status text not null default 'pendiente' check (status in ('pendiente','confirmado','enviado','entregado','cancelado')),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 9. ESTADÍSTICAS: vistas y búsquedas de producto
-- ------------------------------------------------------------
create table if not exists public.product_views (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.search_logs (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.clients enable row level security;
alter table public.providers enable row level security;
alter table public.employees enable row level security;
alter table public.transactions enable row level security;
alter table public.quotes enable row level security;
alter table public.orders enable row level security;
alter table public.product_views enable row level security;
alter table public.search_logs enable row level security;

-- profiles: cada quien ve su propio perfil, el admin ve todos
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

-- categories: lectura pública, escritura solo admin
drop policy if exists "categories_public_read" on public.categories;
create policy "categories_public_read" on public.categories
  for select using (true);
drop policy if exists "categories_admin_write" on public.categories;
create policy "categories_admin_write" on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

-- products: lectura pública de productos activos, admin ve/edita todo
drop policy if exists "products_public_read" on public.products;
create policy "products_public_read" on public.products
  for select using (active = true or public.is_admin());
drop policy if exists "products_admin_write" on public.products;
create policy "products_admin_write" on public.products
  for all using (public.is_admin()) with check (public.is_admin());

-- variantes: lectura pública, escritura admin
drop policy if exists "variants_public_read" on public.product_variants;
create policy "variants_public_read" on public.product_variants
  for select using (true);
drop policy if exists "variants_admin_write" on public.product_variants;
create policy "variants_admin_write" on public.product_variants
  for all using (public.is_admin()) with check (public.is_admin());

-- clientes / proveedores / empleados / transacciones / cotizaciones: solo admin
drop policy if exists "clients_admin_all" on public.clients;
create policy "clients_admin_all" on public.clients
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "providers_admin_all" on public.providers;
create policy "providers_admin_all" on public.providers
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "employees_admin_all" on public.employees;
create policy "employees_admin_all" on public.employees
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "transactions_admin_all" on public.transactions;
create policy "transactions_admin_all" on public.transactions
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "quotes_admin_all" on public.quotes;
create policy "quotes_admin_all" on public.quotes
  for all using (public.is_admin()) with check (public.is_admin());

-- orders: cualquiera (incluso anónimo) puede crear un pedido; solo admin lee/edita/borra
drop policy if exists "orders_public_insert" on public.orders;
create policy "orders_public_insert" on public.orders
  for insert with check (true);
drop policy if exists "orders_admin_read" on public.orders;
create policy "orders_admin_read" on public.orders
  for select using (public.is_admin());
drop policy if exists "orders_admin_update" on public.orders;
create policy "orders_admin_update" on public.orders
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "orders_admin_delete" on public.orders;
create policy "orders_admin_delete" on public.orders
  for delete using (public.is_admin());

-- product_views / search_logs: cualquiera inserta (analítica pública), solo admin lee
drop policy if exists "views_public_insert" on public.product_views;
create policy "views_public_insert" on public.product_views
  for insert with check (true);
drop policy if exists "views_admin_read" on public.product_views;
create policy "views_admin_read" on public.product_views
  for select using (public.is_admin());

drop policy if exists "search_public_insert" on public.search_logs;
create policy "search_public_insert" on public.search_logs
  for insert with check (true);
drop policy if exists "search_admin_read" on public.search_logs;
create policy "search_admin_read" on public.search_logs
  for select using (public.is_admin());

-- ============================================================
-- STORAGE: bucket público para fotos de producto
-- ============================================================
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_public_read" on storage.objects
  for select using (bucket_id = 'product-images');

drop policy if exists "product_images_admin_write" on storage.objects;
create policy "product_images_admin_write" on storage.objects
  for all using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

-- ============================================================
-- Vistas de apoyo para el panel de estadísticas
-- ============================================================
create or replace view public.top_viewed_products as
select p.id, p.name, p.slug, count(v.id) as views
from public.products p
join public.product_views v on v.product_id = p.id
group by p.id, p.name, p.slug
order by views desc;

create or replace view public.top_searched_terms as
select term, count(*) as veces
from public.search_logs
group by term
order by veces desc;
