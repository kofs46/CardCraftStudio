begin;

alter table public.nfc_social_links
  add column if not exists identifier text not null default '',
  add column if not exists qr_image_path text check (qr_image_path ~ '^media/[a-f0-9-]{36}\.(png|jpg|webp)$');

alter table public.nfc_social_links
  drop constraint if exists nfc_social_links_platform_check,
  drop constraint if exists nfc_social_links_url_check,
  drop constraint if exists nfc_social_links_target_check;

alter table public.nfc_social_links
  add constraint nfc_social_links_platform_check check (
    platform in ('facebook', 'instagram', 'linkedin', 'youtube', 'tiktok', 'x', 'telegram',
      'viber', 'wechat', 'bdjobs', 'whatsapp_business')
  ),
  add constraint nfc_social_links_target_check check (
    (url = '' or (url ~ '^https?://' and length(url) <= 500))
    and (identifier = '' or (
      url = '' and (
        (platform = 'viber' and identifier ~ '^\+[1-9][0-9]{7,14}$')
        or (platform = 'wechat' and identifier ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$')
      )
    ))
    and (platform <> 'wechat' or url = '')
    and (platform = 'wechat' or qr_image_path is null)
    and (url <> '' or identifier <> '' or qr_image_path is not null)
  );

create or replace function public.nfc__collections_json(v_profile uuid, visible_only boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'social_links', coalesce((select jsonb_agg(
      jsonb_build_object('id', s.id, 'platform', s.platform, 'label', s.label, 'url', s.url, 'is_visible', s.is_visible)
      || jsonb_strip_nulls(jsonb_build_object('identifier', nullif(s.identifier, ''), 'qr_image_path', s.qr_image_path))
      order by s.display_order, s.id)
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
    insert into nfc_social_links (profile_id, platform, label, url, identifier, qr_image_path, display_order, is_visible)
    select v_profile, x->>'platform', coalesce(x->>'label', ''), coalesce(x->>'url', ''),
      coalesce(x->>'identifier', ''), nullif(x->>'qr_image_path', ''), (o - 1)::int, coalesce((x->>'is_visible')::boolean, true)
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

create or replace function public.nfc__queue_social_qr_cleanup() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  insert into nfc_file_cleanup (path) values (old.qr_image_path) on conflict do nothing;
  return old;
end $$;

revoke all on function public.nfc__queue_social_qr_cleanup() from public, anon, authenticated;

drop trigger if exists nfc_social_qr_cleanup on public.nfc_social_links;
create trigger nfc_social_qr_cleanup after delete on public.nfc_social_links
  for each row when (old.qr_image_path is not null) execute function public.nfc__queue_social_qr_cleanup();

create or replace function public.nfc_cleanup_claim(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from nfc_file_cleanup f
  where exists (select 1 from nfc_profiles pr where f.path in (pr.profile_photo_path, pr.cover_image_path, pr.company_logo_path))
     or exists (select 1 from nfc_services s where s.image_path = f.path)
     or exists (select 1 from nfc_social_links s where s.qr_image_path = f.path);
  return coalesce((select jsonb_agg(path) from (select path from nfc_file_cleanup order by created_at
    limit least(greatest(coalesce((p->>'limit')::int, 50), 1), 100)) x), '[]'::jsonb);
end $$;

commit;
