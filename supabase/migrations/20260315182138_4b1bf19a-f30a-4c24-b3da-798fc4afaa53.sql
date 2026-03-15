
-- Add product_id to jobs table
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;

-- Add num_colors to products table (default 1 = single color)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS num_colors integer NOT NULL DEFAULT 1;

-- Add purge/tower waste fields to jobs for multi-color tracking
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS secondary_material_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS num_colors integer NOT NULL DEFAULT 1;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS purge_waste_grams numeric DEFAULT 0;
