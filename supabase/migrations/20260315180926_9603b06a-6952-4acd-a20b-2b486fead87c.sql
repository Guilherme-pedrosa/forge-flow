-- Create product_photos table for multiple photos per product
CREATE TABLE public.product_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  url text NOT NULL,
  caption text,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.product_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage product photos in their tenant"
  ON public.product_photos
  FOR ALL
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

-- Create a public storage bucket for product photos
INSERT INTO storage.buckets (id, name, public) VALUES ('product-photos', 'product-photos', true);

-- Allow authenticated users to upload to product-photos bucket
CREATE POLICY "Authenticated users can upload product photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-photos');

CREATE POLICY "Anyone can view product photos"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'product-photos');

CREATE POLICY "Authenticated users can delete product photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-photos');
