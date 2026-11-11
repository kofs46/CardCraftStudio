-- CardCraft Studio BD — seven additional premium NFC profile themes.
-- Additive and idempotent: only inserts theme rows that don't exist yet. No other table is touched.
insert into public.nfc_themes (theme_key, theme_name, theme_configuration) values
  ('executive', 'Executive Black', '{"tone":"dark","accent":"#e4e4e7","best_for":"CEOs, lawyers, consultants"}'),
  ('emerald', 'Emerald Prestige', '{"tone":"dark","accent":"#d9b45a","best_for":"Finance, real estate"}'),
  ('rosegold', 'Rose Gold Elegance', '{"tone":"light","accent":"#b76e79","best_for":"Beauty, fashion, boutiques"}'),
  ('medical', 'Clinical Trust', '{"tone":"light","accent":"#0f766e","best_for":"Doctors, clinics, pharma"}'),
  ('carbon', 'Carbon Tech', '{"tone":"dark","accent":"#a3e635","best_for":"Tech, developers, startups"}'),
  ('marble', 'Marble Luxe', '{"tone":"light","accent":"#8c6b3e","best_for":"Architects, interior designers, premium brands"}'),
  ('sunset', 'Creative Sunset', '{"tone":"dark","accent":"#c2185b","best_for":"Creators, photographers, influencers"}')
on conflict (theme_key) do nothing;
