
-- Purchase Orders table
CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  code text NOT NULL,
  vendor_id uuid REFERENCES public.vendors(id),
  status text NOT NULL DEFAULT 'draft',
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_date date,
  received_date date,
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  shipping numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  nfe_number text,
  nfe_key text,
  nfe_xml text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Purchase Order Items
CREATE TABLE public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES public.inventory_items(id),
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  cfop text,
  ncm text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "po_s" ON public.purchase_orders FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "po_i" ON public.purchase_orders FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "po_u" ON public.purchase_orders FOR UPDATE USING (tenant_id = get_user_tenant_id());
CREATE POLICY "po_d" ON public.purchase_orders FOR DELETE USING (tenant_id = get_user_tenant_id());

CREATE POLICY "poi_s" ON public.purchase_order_items FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "poi_i" ON public.purchase_order_items FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "poi_u" ON public.purchase_order_items FOR UPDATE USING (tenant_id = get_user_tenant_id());
CREATE POLICY "poi_d" ON public.purchase_order_items FOR DELETE USING (tenant_id = get_user_tenant_id());

-- updated_at trigger
CREATE TRIGGER set_updated_at_purchase_orders BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
