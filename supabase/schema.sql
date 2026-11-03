-- Run once in Supabase SQL Editor. No browser has access to these tables/RPCs.
create table if not exists public.shop_state(id boolean primary key default true check(id), revision bigint not null default 0, catalog jsonb not null);
create table if not exists public.shop_orders(id text primary key, request_id uuid unique not null, payload jsonb not null, created_at timestamptz not null default now());
create table if not exists public.shop_rate_limits(key text primary key, hits integer not null, expires_at timestamptz not null);
create table if not exists public.shop_file_cleanup(path text primary key, created_at timestamptz not null default now());
alter table public.shop_state enable row level security;
alter table public.shop_orders enable row level security;
alter table public.shop_rate_limits enable row level security;
alter table public.shop_file_cleanup enable row level security;
revoke all on public.shop_state,public.shop_orders,public.shop_rate_limits,public.shop_file_cleanup from anon,authenticated;
grant all on public.shop_state,public.shop_orders,public.shop_rate_limits,public.shop_file_cleanup to service_role;
create or replace function public.shop_snapshot() returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('revision',revision,'state',catalog||jsonb_build_object('orders',coalesce((select jsonb_agg(payload order by created_at) from shop_orders),'[]'::jsonb))) from shop_state where id=true;
$$;
create or replace function public.shop_commit(expected bigint, next_state jsonb) returns boolean language plpgsql security definer set search_path=public as $$
declare current_revision bigint; item jsonb;
begin
 select revision into current_revision from shop_state where id=true for update;
 if current_revision is null or current_revision<>expected then return false; end if;
 -- Keep a durable deletion queue in the same transaction as removing artwork references.
 insert into shop_file_cleanup(path)
 select distinct file_ref->>'path'
 from shop_orders old_order
 cross join lateral jsonb_array_elements(old_order.payload->'items') old_item
 cross join lateral (values(old_item->'file'),(old_item->'backPhoto')) refs(file_ref)
 where file_ref->>'path' is not null and not exists (
   select 1 from jsonb_array_elements(next_state->'orders') new_order
   cross join lateral jsonb_array_elements(new_order->'items') new_item
   where new_item->'file'->>'path'=file_ref->>'path' or new_item->'backPhoto'->>'path'=file_ref->>'path'
 ) on conflict(path) do nothing;
 update shop_state set catalog=next_state-'orders',revision=revision+1 where id=true;
 for item in select value from jsonb_array_elements(next_state->'orders') loop
  insert into shop_orders(id,request_id,payload) values(item->>'id',(item->>'requestId')::uuid,item)
  on conflict(id) do update set payload=excluded.payload where shop_orders.payload is distinct from excluded.payload;
 end loop;
 return true;
end $$;
create or replace function public.shop_limit(rate_key text,max_hits integer,window_seconds integer) returns boolean language plpgsql security definer set search_path=public as $$
declare count_hits integer;
begin
 delete from shop_rate_limits where expires_at<now();
 insert into shop_rate_limits(key,hits,expires_at) values(rate_key,1,now()+make_interval(secs=>window_seconds))
 on conflict(key) do update set hits=shop_rate_limits.hits+1 returning hits into count_hits;
 return count_hits<=max_hits;
end $$;
revoke all on function public.shop_snapshot(),public.shop_commit(bigint,jsonb),public.shop_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.shop_snapshot(),public.shop_commit(bigint,jsonb),public.shop_limit(text,integer,integer) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('product-images','product-images',true,2097152,array['image/png','image/jpeg','image/webp']),
 ('order-artwork','order-artwork',false,2097152,array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict(id) do nothing;
