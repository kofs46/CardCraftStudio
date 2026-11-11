-- CardCraft Studio BD — NFC digital business card platform.
-- Purely additive: creates nfc_* tables/functions and the nfc-profile-media bucket.
-- Does not alter or read any existing shop_* object. Safe to run more than once.
-- Browser clients (anon/authenticated) get NO access; only the server's service_role can call the RPCs.

-- ---------------------------------------------------------------- themes
create table if not exists public.nfc_themes (
  id smallint generated always as identity primary key,
  theme_key text not null unique check (theme_key ~ '^[a-z][a-z0-9-]{1,30}$'),
  theme_name text not null check (length(theme_name) between 1 and 80),
  theme_configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(theme_configuration) = 'object'),
  is_active boolean not null default true
);
insert into public.nfc_themes (theme_key, theme_name, theme_configuration) values
  ('luxury', 'Luxury Black & Gold', '{"tone":"dark","accent":"#d4af37"}'),
  ('minimal', 'Minimal White', '{"tone":"light","accent":"#111827"}'),
  ('corporate', 'Corporate Blue', '{"tone":"light","accent":"#1d4ed8"}'),
  ('holographic', 'Holographic Premium', '{"tone":"dark","accent":"#a855f7"}'),
  ('purple', 'Modern Purple Gradient', '{"tone":"light","accent":"#7c3aed"}')
on conflict (theme_key) do nothing;

-- ---------------------------------------------------------------- customers (credentials)
create table if not exists public.nfc_customers (
  id uuid primary key default gen_random_uuid(),
  user_id text not null check (user_id ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  password_hash text not null check (length(password_hash) between 20 and 300),
  password_change_required boolean not null default true,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  password_changed_at timestamptz
);
create unique index if not exists nfc_customers_user_id_ci on public.nfc_customers (lower(user_id));

-- ---------------------------------------------------------------- profiles (public card content)
create table if not exists public.nfc_profiles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.nfc_customers(id) on delete cascade,
  immutable_public_id text not null unique check (immutable_public_id ~ '^[a-z0-9]{12}$'),
  public_slug text not null unique check (public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)+$' and length(public_slug) <= 64),
  full_name text not null check (length(full_name) between 1 and 120),
  designation text not null default '' check (length(designation) <= 120),
  company_name text not null default '' check (length(company_name) <= 150),
  business_category text not null default '' check (length(business_category) <= 100),
  biography text not null default '' check (length(biography) <= 2000),
  tagline text not null default '' check (length(tagline) <= 160),
  profile_photo_path text check (profile_photo_path ~ '^media/[a-f0-9-]{36}\.(png|jpg|webp)$'),
  cover_image_path text check (cover_image_path ~ '^media/[a-f0-9-]{36}\.(png|jpg|webp)$'),
  company_logo_path text check (company_logo_path ~ '^media/[a-f0-9-]{36}\.(png|jpg|webp)$'),
  phone text not null default '' check (length(phone) <= 30),
  whatsapp text not null default '' check (length(whatsapp) <= 30),
  email text not null default '' check (length(email) <= 254),
  website text not null default '' check (website = '' or (website ~ '^https?://' and length(website) <= 500)),
  address text not null default '' check (length(address) <= 300),
  google_maps_url text not null default '' check (google_maps_url = '' or (google_maps_url ~ '^https?://' and length(google_maps_url) <= 500)),
  theme_id text not null default 'minimal' references public.nfc_themes(theme_key) on update cascade,
  theme_settings jsonb not null default '{}'::jsonb check (jsonb_typeof(theme_settings) = 'object'),
  visibility_settings jsonb not null default '{}'::jsonb check (jsonb_typeof(visibility_settings) = 'object'),
  profile_status text not null default 'active' check (profile_status in ('active', 'suspended')),
  editing_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nfc_profiles_updated_idx on public.nfc_profiles (updated_at desc);
create index if not exists nfc_profiles_created_idx on public.nfc_profiles (created_at desc);

-- Every slug / immutable id ever issued. Primary key = global uniqueness; rows survive profile
-- deletion (profile_id set null) so an identifier printed on a card is never given to someone else.
create table if not exists public.nfc_reserved_public_ids (
  public_id text primary key,
  kind text not null check (kind in ('slug', 'immutable')),
  profile_id uuid references public.nfc_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists nfc_reserved_profile_idx on public.nfc_reserved_public_ids (profile_id);

create or replace function public.nfc__reserve_public_ids() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into nfc_reserved_public_ids (public_id, kind, profile_id) values (new.immutable_public_id, 'immutable', new.id);
    insert into nfc_reserved_public_ids (public_id, kind, profile_id) values (new.public_slug, 'slug', new.id);
  else
    if new.immutable_public_id is distinct from old.immutable_public_id then
      raise exception 'immutable_public_id cannot change' using errcode = 'check_violation';
    end if;
    if new.public_slug is distinct from old.public_slug then
      insert into nfc_reserved_public_ids (public_id, kind, profile_id) values (new.public_slug, 'slug', new.id)
      on conflict (public_id) do nothing;
      if not exists (select 1 from nfc_reserved_public_ids where public_id = new.public_slug and profile_id = new.id) then
        raise exception 'public id already issued' using errcode = 'unique_violation', constraint = 'nfc_reserved_public_ids_pkey';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists nfc_profiles_reserve_ids on public.nfc_profiles;
create trigger nfc_profiles_reserve_ids after insert or update of public_slug, immutable_public_id on public.nfc_profiles
  for each row execute function public.nfc__reserve_public_ids();

-- ---------------------------------------------------------------- profile collections
create table if not exists public.nfc_social_links (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.nfc_profiles(id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram', 'linkedin', 'youtube', 'tiktok', 'x', 'telegram')),
  label text not null default '' check (length(label) <= 60),
  url text not null check (url ~ '^https?://' and length(url) <= 500),
  display_order integer not null default 0 check (display_order between 0 and 100),
  is_visible boolean not null default true
);
create index if not exists nfc_social_links_profile_idx on public.nfc_social_links (profile_id, display_order);

create table if not exists public.nfc_services (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.nfc_profiles(id) on delete cascade,
  title text not null check (length(title) between 1 and 100),
  description text not null default '' check (length(description) <= 500),
  image_path text check (image_path ~ '^media/[a-f0-9-]{36}\.(png|jpg|webp)$'),
  external_url text not null default '' check (external_url = '' or (external_url ~ '^https?://' and length(external_url) <= 500)),
  display_order integer not null default 0 check (display_order between 0 and 100),
  is_visible boolean not null default true
);
create index if not exists nfc_services_profile_idx on public.nfc_services (profile_id, display_order);

create table if not exists public.nfc_custom_links (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.nfc_profiles(id) on delete cascade,
  title text not null check (length(title) between 1 and 80),
  url text not null check (url ~ '^https?://' and length(url) <= 500),
  icon text not null default 'link' check (icon in ('link', 'portfolio', 'document', 'video', 'shop', 'calendar')),
  display_order integer not null default 0 check (display_order between 0 and 100),
  is_visible boolean not null default true
);
create index if not exists nfc_custom_links_profile_idx on public.nfc_custom_links (profile_id, display_order);

-- ---------------------------------------------------------------- physical cards
create table if not exists public.nfc_cards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.nfc_profiles(id) on delete cascade,
  internal_card_reference text check (length(internal_card_reference) <= 60),
  card_status text not null default 'profile_created'
    check (card_status in ('profile_created', 'ready_for_programming', 'programmed', 'tested', 'dispatched', 'delivered')),
  programmed_at timestamptz,
  tested_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nfc_cards_profile_idx on public.nfc_cards (profile_id, created_at desc);
create unique index if not exists nfc_cards_reference_unique on public.nfc_cards (lower(internal_card_reference))
  where internal_card_reference is not null and internal_card_reference <> '';

create table if not exists public.nfc_card_status_history (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.nfc_cards(id) on delete cascade,
  previous_status text,
  new_status text not null,
  changed_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists nfc_card_history_card_idx on public.nfc_card_status_history (card_id, created_at desc);

-- ---------------------------------------------------------------- sessions (only SHA-256 hashes stored)
create table if not exists public.nfc_sessions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.nfc_customers(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz not null default now()
);
create index if not exists nfc_sessions_customer_idx on public.nfc_sessions (customer_id);

-- ---------------------------------------------------------------- analytics (no IP / user agent stored)
create table if not exists public.nfc_profile_views (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.nfc_profiles(id) on delete cascade,
  event_type text not null check (event_type in ('view', 'click_call', 'click_whatsapp', 'click_email', 'click_website',
    'click_map', 'click_social', 'click_link', 'click_service', 'save_contact', 'share', 'qr_download')),
  event_detail text check (event_detail is null or event_detail ~ '^[a-z0-9_-]{1,30}$'),
  created_at timestamptz not null default now()
);
create index if not exists nfc_views_profile_idx on public.nfc_profile_views (profile_id, created_at desc);
create index if not exists nfc_views_created_idx on public.nfc_profile_views (created_at desc);

-- ---------------------------------------------------------------- audit + storage cleanup queue
create table if not exists public.nfc_audit_logs (
  id bigint generated always as identity primary key,
  actor_type text not null check (actor_type in ('admin', 'customer', 'system')),
  actor_id text not null default '',
  action text not null check (length(action) <= 60),
  target_profile_id uuid references public.nfc_profiles(id) on delete set null,
  safe_change_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists nfc_audit_target_idx on public.nfc_audit_logs (target_profile_id, created_at desc);
create index if not exists nfc_audit_created_idx on public.nfc_audit_logs (created_at desc);

create table if not exists public.nfc_file_cleanup (
  path text primary key check (path ~ '^media/[a-f0-9-]{36}\.(png|jpg|webp)$'),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- lock tables down
do $$
declare t text;
begin
  foreach t in array array['nfc_themes', 'nfc_customers', 'nfc_profiles', 'nfc_reserved_public_ids', 'nfc_social_links',
    'nfc_services', 'nfc_custom_links', 'nfc_cards', 'nfc_card_status_history', 'nfc_sessions', 'nfc_profile_views',
    'nfc_audit_logs', 'nfc_file_cleanup'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

-- ================================================================ RPCs
-- Convention: every callable function is fn(p jsonb) returns jsonb, executed in one transaction.

create or replace function public.nfc__collections_json(v_profile uuid, visible_only boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'social_links', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'platform', s.platform, 'label', s.label,
        'url', s.url, 'is_visible', s.is_visible) order by s.display_order, s.id)
      from nfc_social_links s where s.profile_id = v_profile and (not visible_only or s.is_visible)), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'description', s.description,
        'image_path', s.image_path, 'external_url', s.external_url, 'is_visible', s.is_visible) order by s.display_order, s.id)
      from nfc_services s where s.profile_id = v_profile and (not visible_only or s.is_visible)), '[]'::jsonb),
    'custom_links', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'url', l.url,
        'icon', l.icon, 'is_visible', l.is_visible) order by l.display_order, l.id)
      from nfc_custom_links l where l.profile_id = v_profile and (not visible_only or l.is_visible)), '[]'::jsonb));
$$;

create or replace function public.nfc__replace_collections(v_profile uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p ? 'social_links' then
    delete from nfc_social_links where profile_id = v_profile;
    insert into nfc_social_links (profile_id, platform, label, url, display_order, is_visible)
    select v_profile, x->>'platform', coalesce(x->>'label', ''), x->>'url', (o - 1)::int, coalesce((x->>'is_visible')::boolean, true)
    from jsonb_array_elements(p->'social_links') with ordinality as t(x, o);
  end if;
  if p ? 'services' then
    delete from nfc_services where profile_id = v_profile;
    insert into nfc_services (profile_id, title, description, image_path, external_url, display_order, is_visible)
    select v_profile, x->>'title', coalesce(x->>'description', ''), nullif(x->>'image_path', ''), coalesce(x->>'external_url', ''),
      (o - 1)::int, coalesce((x->>'is_visible')::boolean, true)
    from jsonb_array_elements(p->'services') with ordinality as t(x, o);
  end if;
  if p ? 'custom_links' then
    delete from nfc_custom_links where profile_id = v_profile;
    insert into nfc_custom_links (profile_id, title, url, icon, display_order, is_visible)
    select v_profile, x->>'title', x->>'url', coalesce(x->>'icon', 'link'), (o - 1)::int, coalesce((x->>'is_visible')::boolean, true)
    from jsonb_array_elements(p->'custom_links') with ordinality as t(x, o);
  end if;
end $$;

-- Admin: create customer + profile + collections + card + audit atomically.
create or replace function public.nfc_admin_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c jsonb := p->'customer';
  f jsonb := p->'profile';
  v_customer uuid; v_profile uuid; v_card uuid; v_constraint text;
begin
  begin
    insert into nfc_customers (user_id, password_hash, password_change_required)
    values (c->>'user_id', c->>'password_hash', true) returning id into v_customer;

    insert into nfc_profiles (customer_id, immutable_public_id, public_slug, full_name, designation, company_name,
      business_category, biography, tagline, profile_photo_path, cover_image_path, company_logo_path, phone, whatsapp,
      email, website, address, google_maps_url, theme_id, theme_settings, visibility_settings, editing_enabled)
    values (v_customer, f->>'immutable_public_id', f->>'public_slug', f->>'full_name', coalesce(f->>'designation', ''),
      coalesce(f->>'company_name', ''), coalesce(f->>'business_category', ''), coalesce(f->>'biography', ''),
      coalesce(f->>'tagline', ''), nullif(f->>'profile_photo_path', ''), nullif(f->>'cover_image_path', ''),
      nullif(f->>'company_logo_path', ''), coalesce(f->>'phone', ''), coalesce(f->>'whatsapp', ''), coalesce(f->>'email', ''),
      coalesce(f->>'website', ''), coalesce(f->>'address', ''), coalesce(f->>'google_maps_url', ''),
      coalesce(f->>'theme_id', 'minimal'), coalesce(f->'theme_settings', '{}'::jsonb), coalesce(f->'visibility_settings', '{}'::jsonb),
      coalesce((f->>'editing_enabled')::boolean, true))
    returning id into v_profile;

    perform nfc__replace_collections(v_profile, p);

    insert into nfc_cards (profile_id, internal_card_reference) values (v_profile, nullif(p->>'card_reference', ''))
    returning id into v_card;
    insert into nfc_card_status_history (card_id, previous_status, new_status, changed_by)
    values (v_card, null, 'profile_created', 'admin:' || coalesce(p->>'actor_id', ''));

    insert into nfc_audit_logs (actor_type, actor_id, action, target_profile_id, safe_change_summary)
    values ('admin', coalesce(p->>'actor_id', ''), 'customer.create', v_profile,
      jsonb_build_object('user_id', c->>'user_id', 'public_slug', f->>'public_slug', 'theme_id', coalesce(f->>'theme_id', 'minimal')));
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    return jsonb_build_object('error', case
      when v_constraint like '%user_id_ci%' then 'user_id_taken'
      when v_constraint like '%reference%' then 'card_reference_taken'
      else 'public_id_taken' end);
  end;
  return jsonb_build_object('customer_id', v_customer, 'profile_id', v_profile,
    'public_slug', f->>'public_slug', 'immutable_public_id', f->>'immutable_public_id');
end $$;

create or replace function public.nfc_check_user_id(p jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('available', not exists (select 1 from nfc_customers where lower(user_id) = lower(p->>'user_id')));
$$;

-- Admin: searchable, filterable, sortable, paginated list. Sort keys are whitelisted.
create or replace function public.nfc_admin_list(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  q text := lower(coalesce(p->>'q', ''));
  ps text := coalesce(p->>'profile_status', '');
  cs text := coalesce(p->>'card_status', '');
  srt text := coalesce(p->>'sort', 'created_at');
  asc_dir boolean := coalesce(p->>'dir', 'desc') = 'asc';
  lim integer := least(greatest(coalesce((p->>'limit')::int, 20), 1), 100);
  off integer := greatest(coalesce((p->>'offset')::int, 0), 0);
  result jsonb;
begin
  with base as (
    select cu.id as customer_id, cu.user_id, cu.status as customer_status, pr.id as profile_id, pr.full_name,
      pr.company_name, pr.theme_id, pr.public_slug, pr.profile_status, pr.editing_enabled, pr.created_at, pr.updated_at,
      pr.profile_photo_path, coalesce(cd.card_status, 'profile_created') as card_status,
      (select count(*) from nfc_profile_views v where v.profile_id = pr.id and v.event_type = 'view') as views
    from nfc_profiles pr
    join nfc_customers cu on cu.id = pr.customer_id
    left join lateral (select c.card_status from nfc_cards c where c.profile_id = pr.id order by c.created_at desc limit 1) cd on true
    where (q = '' or position(q in lower(pr.full_name || ' ' || cu.user_id || ' ' || pr.company_name || ' ' ||
             pr.public_slug || ' ' || pr.phone || ' ' || pr.email)) > 0)
      and (ps = '' or pr.profile_status = ps)
  ), filtered as (
    select * from base
    where cs = '' or card_status = cs or (cs = 'awaiting' and card_status in ('profile_created', 'ready_for_programming'))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((select jsonb_agg(to_jsonb(r)) from (
      select * from filtered order by
        case when asc_dir then case srt when 'full_name' then lower(full_name) when 'user_id' then user_id
          when 'company_name' then lower(company_name) when 'theme_id' then theme_id when 'card_status' then card_status
          when 'profile_status' then profile_status end end asc,
        case when not asc_dir then case srt when 'full_name' then lower(full_name) when 'user_id' then user_id
          when 'company_name' then lower(company_name) when 'theme_id' then theme_id when 'card_status' then card_status
          when 'profile_status' then profile_status end end desc,
        case when asc_dir then case srt when 'created_at' then created_at when 'updated_at' then updated_at end end asc,
        case when not asc_dir then case srt when 'created_at' then created_at when 'updated_at' then updated_at end end desc,
        case when asc_dir and srt = 'views' then views end asc,
        case when not asc_dir and srt = 'views' then views end desc,
        created_at desc
      limit lim offset off) r), '[]'::jsonb))
  into result;
  return result;
end $$;

create or replace function public.nfc_admin_stats(p jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with lc as (select distinct on (profile_id) * from nfc_cards order by profile_id, created_at desc)
  select jsonb_build_object(
    'total_customers', (select count(*) from nfc_customers),
    'active_profiles', (select count(*) from nfc_profiles where profile_status = 'active'),
    'suspended_profiles', (select count(*) from nfc_profiles where profile_status = 'suspended'),
    'awaiting_programming', (select count(*) from lc where card_status in ('profile_created', 'ready_for_programming')),
    'cards_programmed', (select count(*) from lc where programmed_at is not null),
    'cards_tested', (select count(*) from lc where tested_at is not null),
    'cards_dispatched', (select count(*) from lc where card_status = 'dispatched'),
    'cards_delivered', (select count(*) from lc where card_status = 'delivered'),
    'total_views', (select count(*) from nfc_profile_views where event_type = 'view'),
    'views_30d', (select count(*) from nfc_profile_views where event_type = 'view' and created_at > now() - interval '30 days'),
    'contact_actions_30d', (select count(*) from nfc_profile_views where event_type <> 'view' and created_at > now() - interval '30 days'),
    'updates_7d', (select count(*) from nfc_profiles where updated_at > now() - interval '7 days'),
    'recent_updates', coalesce((select jsonb_agg(to_jsonb(r)) from (
      select cu.id as customer_id, pr.full_name, pr.public_slug, pr.updated_at,
        (select a.actor_type from nfc_audit_logs a where a.target_profile_id = pr.id order by a.created_at desc limit 1) as last_actor
      from nfc_profiles pr join nfc_customers cu on cu.id = pr.customer_id order by pr.updated_at desc limit 8) r), '[]'::jsonb),
    'most_viewed', coalesce((select jsonb_agg(to_jsonb(r)) from (
      select cu.id as customer_id, pr.full_name, pr.public_slug, count(v.id) as views
      from nfc_profiles pr join nfc_customers cu on cu.id = pr.customer_id
      join nfc_profile_views v on v.profile_id = pr.id and v.event_type = 'view'
      group by cu.id, pr.id order by count(v.id) desc, pr.full_name limit 5) r), '[]'::jsonb),
    'recent_activity', coalesce((select jsonb_agg(to_jsonb(r)) from (
      select a.action, a.actor_type, a.created_at, a.safe_change_summary, pr.full_name
      from nfc_audit_logs a left join nfc_profiles pr on pr.id = a.target_profile_id
      order by a.created_at desc, a.id desc limit 12) r), '[]'::jsonb));
$$;

-- Full private record for the admin and for the owning customer (server strips admin-only parts for customers).
create or replace function public.nfc_get_profile(p jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'customer', jsonb_build_object('id', cu.id, 'user_id', cu.user_id, 'status', cu.status,
      'password_change_required', cu.password_change_required, 'created_at', cu.created_at, 'updated_at', cu.updated_at,
      'last_login_at', cu.last_login_at, 'password_changed_at', cu.password_changed_at),
    'profile', to_jsonb(pr) - 'customer_id',
    'card', (select to_jsonb(cd) from nfc_cards cd where cd.profile_id = pr.id order by cd.created_at desc limit 1),
    'card_history', coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc, h.id desc)
      from nfc_card_status_history h join nfc_cards cd on cd.id = h.card_id where cd.profile_id = pr.id), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc, a.id desc) from (
      select id, actor_type, action, safe_change_summary, created_at from nfc_audit_logs
      where target_profile_id = pr.id order by created_at desc, id desc limit 20) a), '[]'::jsonb),
    'views_total', (select count(*) from nfc_profile_views v where v.profile_id = pr.id and v.event_type = 'view')
  ) || nfc__collections_json(pr.id, false)
  from nfc_customers cu join nfc_profiles pr on pr.customer_id = cu.id
  where cu.id = (p->>'customer_id')::uuid;
$$;

-- Save profile fields and/or collections. Customers cannot touch admin-controlled columns and are
-- blocked when suspended or when editing is disabled. Replaced media is queued for deletion.
create or replace function public.nfc_save_profile(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pr nfc_profiles; cu nfc_customers;
  f jsonb := coalesce(p->'fields', '{}'::jsonb);
  actor text := coalesce(p->>'actor_type', '');
  changed jsonb;
begin
  if actor not in ('admin', 'customer') then return jsonb_build_object('error', 'invalid_actor'); end if;
  select * into pr from nfc_profiles where customer_id = (p->>'customer_id')::uuid for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  select * into cu from nfc_customers where id = pr.customer_id;
  if actor = 'customer' then
    if cu.status <> 'active' or pr.profile_status <> 'active' then return jsonb_build_object('error', 'suspended'); end if;
    if not pr.editing_enabled then return jsonb_build_object('error', 'editing_disabled'); end if;
    f := f - 'editing_enabled' - 'public_slug' - 'profile_status' - 'immutable_public_id';
  end if;

  begin
    insert into nfc_file_cleanup (path)
    select v.old_path from (values (pr.profile_photo_path, 'profile_photo_path'), (pr.cover_image_path, 'cover_image_path'),
      (pr.company_logo_path, 'company_logo_path')) v(old_path, col)
    where v.old_path is not null and f ? v.col and (f->>v.col) is distinct from v.old_path
    on conflict do nothing;
    if p ? 'services' then
      insert into nfc_file_cleanup (path)
      select s.image_path from nfc_services s
      where s.profile_id = pr.id and s.image_path is not null
        and not exists (select 1 from jsonb_array_elements(p->'services') x where x->>'image_path' = s.image_path)
      on conflict do nothing;
    end if;

    update nfc_profiles set
      full_name = case when f ? 'full_name' then f->>'full_name' else full_name end,
      designation = case when f ? 'designation' then coalesce(f->>'designation', '') else designation end,
      company_name = case when f ? 'company_name' then coalesce(f->>'company_name', '') else company_name end,
      business_category = case when f ? 'business_category' then coalesce(f->>'business_category', '') else business_category end,
      biography = case when f ? 'biography' then coalesce(f->>'biography', '') else biography end,
      tagline = case when f ? 'tagline' then coalesce(f->>'tagline', '') else tagline end,
      profile_photo_path = case when f ? 'profile_photo_path' then nullif(f->>'profile_photo_path', '') else profile_photo_path end,
      cover_image_path = case when f ? 'cover_image_path' then nullif(f->>'cover_image_path', '') else cover_image_path end,
      company_logo_path = case when f ? 'company_logo_path' then nullif(f->>'company_logo_path', '') else company_logo_path end,
      phone = case when f ? 'phone' then coalesce(f->>'phone', '') else phone end,
      whatsapp = case when f ? 'whatsapp' then coalesce(f->>'whatsapp', '') else whatsapp end,
      email = case when f ? 'email' then coalesce(f->>'email', '') else email end,
      website = case when f ? 'website' then coalesce(f->>'website', '') else website end,
      address = case when f ? 'address' then coalesce(f->>'address', '') else address end,
      google_maps_url = case when f ? 'google_maps_url' then coalesce(f->>'google_maps_url', '') else google_maps_url end,
      theme_id = case when f ? 'theme_id' then f->>'theme_id' else theme_id end,
      theme_settings = case when f ? 'theme_settings' then f->'theme_settings' else theme_settings end,
      visibility_settings = case when f ? 'visibility_settings' then f->'visibility_settings' else visibility_settings end,
      editing_enabled = case when f ? 'editing_enabled' then (f->>'editing_enabled')::boolean else editing_enabled end,
      public_slug = case when f ? 'public_slug' then f->>'public_slug' else public_slug end,
      updated_at = now()
    where id = pr.id;

    perform nfc__replace_collections(pr.id, p);
  exception when unique_violation then
    return jsonb_build_object('error', 'public_id_taken');
  end;

  select jsonb_build_object(
    'fields', coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(f) k), '[]'::jsonb),
    'collections', coalesce((select jsonb_agg(k) from unnest(array['social_links', 'services', 'custom_links']) k where p ? k), '[]'::jsonb))
  into changed;
  insert into nfc_audit_logs (actor_type, actor_id, action, target_profile_id, safe_change_summary)
  values (actor, coalesce(p->>'actor_id', ''), 'profile.update', pr.id, changed);

  return jsonb_build_object('ok', true, 'updated_at', now(),
    'public_slug', (select public_slug from nfc_profiles where id = pr.id));
end $$;

create or replace function public.nfc_set_status(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s text := p->>'status'; v_profile uuid;
begin
  if s not in ('active', 'suspended') then return jsonb_build_object('error', 'invalid_status'); end if;
  update nfc_customers set status = s, updated_at = now() where id = (p->>'customer_id')::uuid;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  update nfc_profiles set profile_status = s, updated_at = now() where customer_id = (p->>'customer_id')::uuid
  returning id into v_profile;
  if s = 'suspended' then
    update nfc_sessions set revoked_at = now() where customer_id = (p->>'customer_id')::uuid and revoked_at is null;
  end if;
  insert into nfc_audit_logs (actor_type, actor_id, action, target_profile_id, safe_change_summary)
  values ('admin', coalesce(p->>'actor_id', ''), case when s = 'suspended' then 'profile.suspend' else 'profile.reactivate' end,
    v_profile, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'status', s);
end $$;

-- Replace password hash; revoke every other session (or all sessions when keep_session_id is null).
create or replace function public.nfc_set_password(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor text := coalesce(p->>'actor_type', ''); keep uuid := nullif(p->>'keep_session_id', '')::uuid; v_profile uuid;
begin
  if actor not in ('admin', 'customer') then return jsonb_build_object('error', 'invalid_actor'); end if;
  update nfc_customers set password_hash = p->>'password_hash',
    password_change_required = coalesce((p->>'change_required')::boolean, true),
    password_changed_at = now(), updated_at = now()
  where id = (p->>'customer_id')::uuid;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  update nfc_sessions set revoked_at = now()
  where customer_id = (p->>'customer_id')::uuid and revoked_at is null and (keep is null or id <> keep);
  select id into v_profile from nfc_profiles where customer_id = (p->>'customer_id')::uuid;
  insert into nfc_audit_logs (actor_type, actor_id, action, target_profile_id, safe_change_summary)
  values (actor, coalesce(p->>'actor_id', ''), case when actor = 'admin' then 'password.reset' else 'password.change' end,
    v_profile, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- Card status is only ever changed by an explicit admin action; timestamps record when each stage was reached.
create or replace function public.nfc_set_card_status(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s text := p->>'status'; card nfc_cards;
begin
  if s not in ('profile_created', 'ready_for_programming', 'programmed', 'tested', 'dispatched', 'delivered') then
    return jsonb_build_object('error', 'invalid_status');
  end if;
  select cd.* into card from nfc_cards cd join nfc_profiles pr on pr.id = cd.profile_id
  where pr.customer_id = (p->>'customer_id')::uuid order by cd.created_at desc limit 1 for update of cd;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  begin
    update nfc_cards set card_status = s,
      programmed_at = case when s = 'programmed' and s <> card.card_status then now() else programmed_at end,
      tested_at = case when s = 'tested' and s <> card.card_status then now() else tested_at end,
      dispatched_at = case when s = 'dispatched' and s <> card.card_status then now() else dispatched_at end,
      delivered_at = case when s = 'delivered' and s <> card.card_status then now() else delivered_at end,
      internal_card_reference = case when p ? 'reference' then nullif(p->>'reference', '') else internal_card_reference end,
      updated_at = now()
    where id = card.id;
  exception when unique_violation then
    return jsonb_build_object('error', 'card_reference_taken');
  end;
  if s <> card.card_status then
    insert into nfc_card_status_history (card_id, previous_status, new_status, changed_by)
    values (card.id, card.card_status, s, 'admin:' || coalesce(p->>'actor_id', ''));
    insert into nfc_audit_logs (actor_type, actor_id, action, target_profile_id, safe_change_summary)
    values ('admin', coalesce(p->>'actor_id', ''), 'card.status', card.profile_id,
      jsonb_build_object('from', card.card_status, 'to', s));
  end if;
  return jsonb_build_object('ok', true, 'card', (select to_jsonb(c) from nfc_cards c where c.id = card.id));
end $$;

-- Delete customer + profile. Public identifiers stay reserved (never reissued); media queued for deletion.
create or replace function public.nfc_delete_customer(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare pr nfc_profiles; v_user text;
begin
  select * into pr from nfc_profiles where customer_id = (p->>'customer_id')::uuid for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  select user_id into v_user from nfc_customers where id = pr.customer_id;
  insert into nfc_file_cleanup (path)
  select x from unnest(array[pr.profile_photo_path, pr.cover_image_path, pr.company_logo_path]) x where x is not null
  union select image_path from nfc_services where profile_id = pr.id and image_path is not null
  on conflict do nothing;
  insert into nfc_audit_logs (actor_type, actor_id, action, target_profile_id, safe_change_summary)
  values ('admin', coalesce(p->>'actor_id', ''), 'customer.delete', null,
    jsonb_build_object('user_id', v_user, 'public_slug', pr.public_slug, 'deleted_profile_id', pr.id));
  delete from nfc_customers where id = pr.customer_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- authentication
create or replace function public.nfc_login_lookup(p jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('customer_id', id, 'password_hash', password_hash, 'status', status,
    'password_change_required', password_change_required)
  from nfc_customers where lower(user_id) = lower(p->>'user_id');
$$;

create or replace function public.nfc_session_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid; v_customer uuid := (p->>'customer_id')::uuid; v_profile uuid;
begin
  delete from nfc_sessions where customer_id = v_customer
    and (expires_at < now() or (revoked_at is not null and revoked_at < now() - interval '30 days'));
  insert into nfc_sessions (customer_id, token_hash, expires_at)
  values (v_customer, p->>'token_hash', now() + make_interval(secs => (p->>'ttl_seconds')::int))
  returning id into sid;
  update nfc_customers set last_login_at = now() where id = v_customer;
  select id into v_profile from nfc_profiles where customer_id = v_customer;
  insert into nfc_audit_logs (actor_type, actor_id, action, target_profile_id) values ('customer', v_customer::text, 'auth.login', v_profile);
  return jsonb_build_object('session_id', sid);
end $$;

create or replace function public.nfc_session_get(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  select s.id as session_id, s.last_used_at, s.expires_at, cu.id as customer_id, cu.user_id, cu.status,
    cu.password_change_required, pr.id as profile_id, pr.public_slug, pr.full_name, pr.editing_enabled, pr.profile_status
  into r
  from nfc_sessions s
  join nfc_customers cu on cu.id = s.customer_id
  join nfc_profiles pr on pr.customer_id = cu.id
  where s.token_hash = p->>'token_hash' and s.revoked_at is null and s.expires_at > now()
    and s.last_used_at > now() - make_interval(secs => coalesce((p->>'idle_seconds')::int, 259200));
  if not found then return null; end if;
  if r.last_used_at < now() - interval '5 minutes' then
    update nfc_sessions set last_used_at = now() where id = r.session_id;
  end if;
  return jsonb_build_object('session_id', r.session_id, 'customer_id', r.customer_id, 'user_id', r.user_id,
    'status', r.status, 'password_change_required', r.password_change_required, 'profile_id', r.profile_id,
    'public_slug', r.public_slug, 'full_name', r.full_name, 'editing_enabled', r.editing_enabled,
    'profile_status', r.profile_status, 'expires_at', r.expires_at);
end $$;

create or replace function public.nfc_session_revoke(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if p ? 'token_hash' then
    update nfc_sessions set revoked_at = now() where token_hash = p->>'token_hash' and revoked_at is null;
  elsif p ? 'customer_id' then
    update nfc_sessions set revoked_at = now()
    where customer_id = (p->>'customer_id')::uuid and revoked_at is null
      and (nullif(p->>'except_session_id', '') is null or id <> (p->>'except_session_id')::uuid);
  else
    return jsonb_build_object('error', 'invalid');
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('revoked', n);
end $$;

-- ---------------------------------------------------------------- public profile + analytics
-- Returns only display columns. No customer id, profile id, credentials or admin data.
create or replace function public.nfc_public_get(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare pid text := lower(coalesce(p->>'public_id', '')); pr nfc_profiles; res nfc_reserved_public_ids; cu_status text;
begin
  select * into pr from nfc_profiles where public_slug = pid;
  if not found then
    select * into res from nfc_reserved_public_ids where public_id = pid;
    if not found then return null; end if;
    if res.profile_id is null then return jsonb_build_object('gone', true); end if;
    return jsonb_build_object('redirect', (select public_slug from nfc_profiles where id = res.profile_id));
  end if;
  select status into cu_status from nfc_customers where id = pr.customer_id;
  if pr.profile_status <> 'active' or cu_status <> 'active' then return jsonb_build_object('unavailable', true); end if;
  return jsonb_build_object('profile', jsonb_build_object(
      'public_slug', pr.public_slug, 'full_name', pr.full_name, 'designation', pr.designation,
      'company_name', pr.company_name, 'business_category', pr.business_category, 'biography', pr.biography,
      'tagline', pr.tagline, 'profile_photo_path', pr.profile_photo_path, 'cover_image_path', pr.cover_image_path,
      'company_logo_path', pr.company_logo_path, 'phone', pr.phone, 'whatsapp', pr.whatsapp, 'email', pr.email,
      'website', pr.website, 'address', pr.address, 'google_maps_url', pr.google_maps_url, 'theme_id', pr.theme_id,
      'theme_settings', pr.theme_settings, 'visibility_settings', pr.visibility_settings, 'updated_at', pr.updated_at))
    || nfc__collections_json(pr.id, true);
end $$;

create or replace function public.nfc_record_event(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into nfc_profile_views (profile_id, event_type, event_detail)
  select pr.id, p->>'event_type', nullif(p->>'event_detail', '')
  from nfc_profiles pr join nfc_customers cu on cu.id = pr.customer_id
  where pr.public_slug = lower(p->>'public_slug') and pr.profile_status = 'active' and cu.status = 'active';
  return jsonb_build_object('recorded', found);
end $$;

create or replace function public.nfc_profile_stats(p jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with pr as (select id from nfc_profiles where customer_id = (p->>'customer_id')::uuid),
  ev as (select * from nfc_profile_views where profile_id = (select id from pr)),
  today as (select (now() at time zone 'Asia/Dhaka')::date as d)
  select jsonb_build_object(
    'total_views', (select count(*) from ev where event_type = 'view'),
    'views_7d', (select count(*) from ev where event_type = 'view' and created_at > now() - interval '7 days'),
    'views_30d', (select count(*) from ev where event_type = 'view' and created_at > now() - interval '30 days'),
    'daily', (select jsonb_agg(jsonb_build_object('day', g.day, 'views', coalesce(c.n, 0)) order by g.day)
      from (select (select d from today) - i as day from generate_series(0, 29) i) g
      left join (select (created_at at time zone 'Asia/Dhaka')::date as day, count(*) as n from ev
        where event_type = 'view' and created_at > now() - interval '31 days' group by 1) c using (day)),
    'events', coalesce((select jsonb_object_agg(event_type, n) from
      (select event_type, count(*) as n from ev group by event_type) x), '{}'::jsonb),
    'social', coalesce((select jsonb_object_agg(event_detail, n) from
      (select event_detail, count(*) as n from ev where event_type = 'click_social' and event_detail is not null group by event_detail) y), '{}'::jsonb),
    'recent', coalesce((select jsonb_agg(to_jsonb(r)) from
      (select event_type, event_detail, created_at from ev order by created_at desc, id desc limit 15) r), '[]'::jsonb))
  where exists (select 1 from pr);
$$;

-- ---------------------------------------------------------------- storage cleanup queue
-- Drops queue entries that are referenced again, then returns paths that are safe to delete.
create or replace function public.nfc_cleanup_claim(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from nfc_file_cleanup f
  where exists (select 1 from nfc_profiles pr where f.path in (pr.profile_photo_path, pr.cover_image_path, pr.company_logo_path))
     or exists (select 1 from nfc_services s where s.image_path = f.path);
  return coalesce((select jsonb_agg(path) from (select path from nfc_file_cleanup order by created_at
    limit least(greatest(coalesce((p->>'limit')::int, 50), 1), 100)) x), '[]'::jsonb);
end $$;

create or replace function public.nfc_cleanup_done(p jsonb) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  with d as (delete from nfc_file_cleanup where path in (select jsonb_array_elements_text(p->'paths')) returning 1)
  select jsonb_build_object('removed', (select count(*) from d));
$$;

-- ---------------------------------------------------------------- function privileges
do $$
declare f record;
begin
  for f in select pr.oid::regprocedure as sig from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
           where n.nspname = 'public' and pr.proname like 'nfc\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------- storage bucket (public images only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nfc-profile-media', 'nfc-profile-media', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
