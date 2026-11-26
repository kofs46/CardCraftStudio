begin;

set local lock_timeout = '5s';

alter table public.nfc_profiles
  add column if not exists permanent_address text not null default '' check (length(permanent_address) <= 300),
  add column if not exists visiting_card_front_path text check (visiting_card_front_path ~ '^media/[a-f0-9-]{36}\.(png|jpg|webp)$'),
  add column if not exists visiting_card_back_path text check (visiting_card_back_path ~ '^media/[a-f0-9-]{36}\.(png|jpg|webp)$');

alter table public.nfc_social_links
  drop constraint if exists nfc_social_links_platform_check,
  drop constraint if exists nfc_social_links_target_check;

alter table public.nfc_social_links
  add constraint nfc_social_links_platform_check check (
    platform in ('facebook', 'instagram', 'linkedin', 'youtube', 'tiktok', 'x', 'telegram',
      'viber', 'wechat', 'bdjobs', 'whatsapp_business', 'imo')
  ),
  add constraint nfc_social_links_target_check check (
    (url = '' or (url ~ '^https?://' and length(url) <= 500))
    and (identifier = '' or (
      url = '' and (
        (platform in ('viber', 'imo') and identifier ~ '^\+[1-9][0-9]{7,14}$')
        or (platform = 'wechat' and identifier ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$')
      )
    ))
    and (platform not in ('wechat', 'imo') or url = '')
    and (platform = 'wechat' or qr_image_path is null)
    and (url <> '' or identifier <> '' or qr_image_path is not null)
  );

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
      email, website, address, permanent_address, google_maps_url, theme_id, theme_settings, visibility_settings, editing_enabled,
      visiting_card_front_path, visiting_card_back_path)
    values (v_customer, f->>'immutable_public_id', f->>'public_slug', f->>'full_name', coalesce(f->>'designation', ''),
      coalesce(f->>'company_name', ''), coalesce(f->>'business_category', ''), coalesce(f->>'biography', ''),
      coalesce(f->>'tagline', ''), nullif(f->>'profile_photo_path', ''), nullif(f->>'cover_image_path', ''),
      nullif(f->>'company_logo_path', ''), coalesce(f->>'phone', ''), coalesce(f->>'whatsapp', ''), coalesce(f->>'email', ''),
      coalesce(f->>'website', ''), coalesce(f->>'address', ''), coalesce(f->>'permanent_address', ''), coalesce(f->>'google_maps_url', ''),
      coalesce(f->>'theme_id', 'minimal'), coalesce(f->'theme_settings', '{}'::jsonb), coalesce(f->'visibility_settings', '{}'::jsonb),
      coalesce((f->>'editing_enabled')::boolean, true),
      nullif(f->>'visiting_card_front_path', ''), nullif(f->>'visiting_card_back_path', ''))
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
      (pr.company_logo_path, 'company_logo_path'), (pr.visiting_card_front_path, 'visiting_card_front_path'),
      (pr.visiting_card_back_path, 'visiting_card_back_path')) v(old_path, col)
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
      visiting_card_front_path = case when f ? 'visiting_card_front_path' then nullif(f->>'visiting_card_front_path', '') else visiting_card_front_path end,
      visiting_card_back_path = case when f ? 'visiting_card_back_path' then nullif(f->>'visiting_card_back_path', '') else visiting_card_back_path end,
      phone = case when f ? 'phone' then coalesce(f->>'phone', '') else phone end,
      whatsapp = case when f ? 'whatsapp' then coalesce(f->>'whatsapp', '') else whatsapp end,
      email = case when f ? 'email' then coalesce(f->>'email', '') else email end,
      website = case when f ? 'website' then coalesce(f->>'website', '') else website end,
      address = case when f ? 'address' then coalesce(f->>'address', '') else address end,
      permanent_address = case when f ? 'permanent_address' then coalesce(f->>'permanent_address', '') else permanent_address end,
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
      'permanent_address', case when pr.visibility_settings->'permanent_address' = 'true'::jsonb then pr.permanent_address else '' end,
      'visiting_card_front_path', case when pr.visibility_settings->'visiting_card' is distinct from 'false'::jsonb then pr.visiting_card_front_path end,
      'visiting_card_back_path', case when pr.visibility_settings->'visiting_card' is distinct from 'false'::jsonb then pr.visiting_card_back_path end,
      'theme_settings', pr.theme_settings, 'visibility_settings', pr.visibility_settings, 'updated_at', pr.updated_at))
    || nfc__collections_json(pr.id, true);
end $$;

create or replace function public.nfc_delete_customer(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare pr nfc_profiles; v_user text;
begin
  select * into pr from nfc_profiles where customer_id = (p->>'customer_id')::uuid for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  select user_id into v_user from nfc_customers where id = pr.customer_id;
  insert into nfc_file_cleanup (path)
  select x from unnest(array[pr.profile_photo_path, pr.cover_image_path, pr.company_logo_path,
    pr.visiting_card_front_path, pr.visiting_card_back_path]) x where x is not null
  union select image_path from nfc_services where profile_id = pr.id and image_path is not null
  on conflict do nothing;
  insert into nfc_audit_logs (actor_type, actor_id, action, target_profile_id, safe_change_summary)
  values ('admin', coalesce(p->>'actor_id', ''), 'customer.delete', null,
    jsonb_build_object('user_id', v_user, 'public_slug', pr.public_slug, 'deleted_profile_id', pr.id));
  delete from nfc_customers where id = pr.customer_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.nfc_cleanup_claim(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from nfc_file_cleanup f
  where exists (select 1 from nfc_profiles pr where f.path in (pr.profile_photo_path, pr.cover_image_path, pr.company_logo_path,
    pr.visiting_card_front_path, pr.visiting_card_back_path))
     or exists (select 1 from nfc_services s where s.image_path = f.path)
     or exists (select 1 from nfc_social_links s where s.qr_image_path = f.path);
  return coalesce((select jsonb_agg(path) from (select path from nfc_file_cleanup order by created_at
    limit least(greatest(coalesce((p->>'limit')::int, 50), 1), 100)) x), '[]'::jsonb);
end $$;

commit;
