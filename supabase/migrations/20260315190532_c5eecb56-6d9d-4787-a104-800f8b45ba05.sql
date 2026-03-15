
ALTER TABLE public.inventory_items ADD COLUMN parent_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL;
CREATE INDEX idx_inventory_items_parent ON public.inventory_items(parent_id);
