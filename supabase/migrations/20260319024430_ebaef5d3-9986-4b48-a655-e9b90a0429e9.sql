
ALTER TABLE public.consignment_locations ADD COLUMN customer_id uuid REFERENCES public.customers(id);
