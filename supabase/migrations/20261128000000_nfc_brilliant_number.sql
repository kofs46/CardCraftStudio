begin;

-- Add Brilliant Number as a phone-based social/contact option. Existing records are untouched.
alter table public.nfc_social_links
  drop constraint if exists nfc_social_links_platform_check,
  drop constraint if exists nfc_social_links_target_check;

alter table public.nfc_social_links
  add constraint nfc_social_links_platform_check check (
    platform in ('facebook', 'instagram', 'linkedin', 'youtube', 'tiktok', 'x', 'telegram',
      'viber', 'wechat', 'bdjobs', 'whatsapp_business', 'imo', 'brilliant')
  ),
  add constraint nfc_social_links_target_check check (
    (url = '' or (url ~ '^https?://' and length(url) <= 500))
    and (identifier = '' or (
      url = '' and (
        (platform in ('viber', 'imo', 'brilliant') and identifier ~ '^\\+[1-9][0-9]{7,14}$')
        or (platform = 'wechat' and identifier ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$')
      )
    ))
    and (platform not in ('wechat', 'imo', 'brilliant') or url = '')
    and (platform = 'wechat' or qr_image_path is null)
    and (url <> '' or identifier <> '' or qr_image_path is not null)
  );

commit;
