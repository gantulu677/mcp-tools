create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  product text not null unique,
  brand text,
  description text,
  features text[] not null default '{}',
  specifications jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_product_not_blank check (length(trim(product)) > 0),
  constraint products_specifications_object check (jsonb_typeof(specifications) = 'object')
);

create index if not exists products_is_active_idx
  on public.products (is_active, product);

create table if not exists public.make_post (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  product text not null,
  headline text not null,
  subheadline text,
  features text[] not null default '{}',
  composition text,
  layout text,
  background text,
  quality text,
  prompt text not null,
  image_url text not null,
  storage_bucket text not null default 'image',
  storage_path text not null unique,
  mime_type text not null default 'image/png',
  image_width integer not null default 1080,
  image_height integer not null default 1350,
  status text not null default 'completed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint make_post_product_not_blank check (length(trim(product)) > 0),
  constraint make_post_headline_not_blank check (length(trim(headline)) > 0),
  constraint make_post_prompt_not_blank check (length(trim(prompt)) > 0),
  constraint make_post_image_url_not_blank check (length(trim(image_url)) > 0),
  constraint make_post_storage_path_not_blank check (length(trim(storage_path)) > 0),
  constraint make_post_image_dimensions check (image_width > 0 and image_height > 0),
  constraint make_post_status_check check (status in ('draft', 'processing', 'completed', 'failed')),
  constraint make_post_mime_type_check check (mime_type in ('image/png', 'image/jpeg', 'image/webp'))
);

create index if not exists make_post_product_id_idx
  on public.make_post (product_id);
create index if not exists make_post_created_at_idx
  on public.make_post (created_at desc);
create index if not exists make_post_status_idx
  on public.make_post (status);

alter table public.products enable row level security;
alter table public.make_post enable row level security;

revoke all on table public.products from anon, authenticated;
revoke all on table public.make_post from anon, authenticated;
grant all on table public.products to service_role;
grant all on table public.make_post to service_role;
