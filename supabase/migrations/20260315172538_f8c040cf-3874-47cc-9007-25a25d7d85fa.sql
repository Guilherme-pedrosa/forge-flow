
-- Products table
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  description text,
  sku text,
  category text NOT NULL DEFAULT 'printed_part',
  photo_url text,
  material_id uuid REFERENCES public.inventory_items(id),
  est_grams numeric DEFAULT 0,
  est_time_minutes integer DEFAULT 0,
  post_process_minutes integer DEFAULT 0,
  cost_estimate numeric DEFAULT 0,
  sale_price numeric DEFAULT 0,
  margin_percent numeric,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prod_s" ON public.products FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "prod_i" ON public.products FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "prod_u" ON public.products FOR UPDATE USING (tenant_id = get_user_tenant_id());
CREATE POLICY "prod_d" ON public.products FOR DELETE USING (tenant_id = get_user_tenant_id());

-- Orders table
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  customer_id uuid REFERENCES public.customers(id),
  code text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  total numeric NOT NULL DEFAULT 0,
  discount numeric DEFAULT 0,
  notes text,
  due_date date,
  approved_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ord_s" ON public.orders FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ord_i" ON public.orders FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "ord_u" ON public.orders FOR UPDATE USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ord_d" ON public.orders FOR DELETE USING (tenant_id = get_user_tenant_id());

-- Order items table
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id),
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "oi_s" ON public.order_items FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "oi_i" ON public.order_items FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "oi_u" ON public.order_items FOR UPDATE USING (tenant_id = get_user_tenant_id());
CREATE POLICY "oi_d" ON public.order_items FOR DELETE USING (tenant_id = get_user_tenant_id());

-- Add order_id FK to jobs if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'jobs_order_id_fkey' AND table_name = 'jobs'
  ) THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);
  END IF;
END$$;
