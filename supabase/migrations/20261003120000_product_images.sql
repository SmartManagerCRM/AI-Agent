-- Product images.
--
--   products.image_path         object path in the `catalog-images` bucket
--                               ("<tenant_id>/<product_id>-<hash>.webp")
--   products.image_source_url   where it came from (the menu page / file), so an
--                               image is never fetched twice; null for uploads
--
-- Images are downloaded server-side (SSRF-guarded, size-capped), checked by
-- their bytes, re-encoded (metadata stripped) and stored in our own bucket:
-- customers' browsers never load images from third-party sites. The bucket
-- is public-read (catalog photos are public on the Agent anyway); there is
-- deliberately no INSERT/UPDATE/DELETE policy on storage.objects for it —
-- only the server, after checking the caller may edit the product
-- (catalog.write via RLS), writes there, always under the product's own
-- tenant folder.

alter table public.products add column image_path text;
alter table public.products add column image_source_url text;
alter table public.products add constraint products_image_path_in_tenant_folder
  check (image_path is null or image_path like tenant_id::text || '/%');

do $bucket$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('catalog-images', 'catalog-images', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
    on conflict (id) do nothing;
  end if;
end
$bucket$;
