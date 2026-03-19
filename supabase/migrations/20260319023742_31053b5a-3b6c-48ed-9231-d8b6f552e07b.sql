
-- Enum for consignment movement types
CREATE TYPE public.consignment_movement_type AS ENUM ('placement', 'sale', 'replenishment', 'return');

-- Consignment locations (stores, points of sale, etc.)
CREATE TABLE public.consignment_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  contact_name text,
  phone text,
  address text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.consignment_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cl_s" ON public.consignment_locations FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "cl_i" ON public.consignment_locations FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "cl_u" ON public.consignment_locations FOR UPDATE USING (tenant_id = get_user_tenant_id());
CREATE POLICY "cl_d" ON public.consignment_locations FOR DELETE USING (tenant_id = get_user_tenant_id());

-- Consignment items: tracks current qty of each product at each location
CREATE TABLE public.consignment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  location_id uuid NOT NULL REFERENCES public.consignment_locations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  current_qty integer NOT NULL DEFAULT 0,
  total_placed integer NOT NULL DEFAULT 0,
  total_sold integer NOT NULL DEFAULT 0,
  total_returned integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, product_id)
);

ALTER TABLE public.consignment_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ci_s" ON public.consignment_items FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ci_i" ON public.consignment_items FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "ci_u" ON public.consignment_items FOR UPDATE USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ci_d" ON public.consignment_items FOR DELETE USING (tenant_id = get_user_tenant_id());

-- Consignment movements: log of all placements, sales, replenishments, returns
CREATE TABLE public.consignment_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  location_id uuid NOT NULL REFERENCES public.consignment_locations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  movement_type public.consignment_movement_type NOT NULL,
  quantity integer NOT NULL,
  unit_price numeric,
  total numeric,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.consignment_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cm_s" ON public.consignment_movements FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "cm_i" ON public.consignment_movements FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

-- Add updated_at triggers
CREATE TRIGGER update_consignment_locations_updated_at BEFORE UPDATE ON public.consignment_locations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_consignment_items_updated_at BEFORE UPDATE ON public.consignment_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Realtime for movements
ALTER PUBLICATION supabase_realtime ADD TABLE public.consignment_movements;
