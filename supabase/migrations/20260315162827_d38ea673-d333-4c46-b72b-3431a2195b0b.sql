
-- 1) bootstrap_tenant: creates tenant + profile + owner role in one transaction
CREATE OR REPLACE FUNCTION public.bootstrap_tenant(
  _tenant_name text,
  _tenant_slug text,
  _display_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid;
  _user_id uuid := auth.uid();
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if user already has a profile (prevent double bootstrap)
  IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = _user_id) THEN
    RAISE EXCEPTION 'User already has a profile/tenant';
  END IF;

  -- Create tenant
  INSERT INTO public.tenants (name, slug)
  VALUES (_tenant_name, _tenant_slug)
  RETURNING id INTO _tenant_id;

  -- Create profile
  INSERT INTO public.profiles (user_id, tenant_id, display_name, email)
  VALUES (
    _user_id,
    _tenant_id,
    _display_name,
    (SELECT email FROM auth.users WHERE id = _user_id)
  );

  -- Create owner role
  INSERT INTO public.user_roles (user_id, tenant_id, role)
  VALUES (_user_id, _tenant_id, 'owner');

  -- Seed default cost centers
  INSERT INTO public.cost_centers (tenant_id, code, name) VALUES
    (_tenant_id, 'PROD', 'Produção'),
    (_tenant_id, 'ADM', 'Administrativo'),
    (_tenant_id, 'COM', 'Comercial');

  -- Seed default payment methods
  INSERT INTO public.payment_methods (tenant_id, name, type) VALUES
    (_tenant_id, 'PIX', 'pix'),
    (_tenant_id, 'Boleto', 'boleto'),
    (_tenant_id, 'Cartão Crédito', 'credit_card'),
    (_tenant_id, 'Transferência', 'transfer');

  RETURN _tenant_id;
END;
$$;

-- 2) Inventory movement trigger: updates stock + avg_cost on insert
CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _item RECORD;
  _new_stock numeric;
  _new_avg_cost numeric;
BEGIN
  -- Get current item state
  SELECT current_stock, avg_cost INTO _item
  FROM public.inventory_items
  WHERE id = NEW.item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item % not found', NEW.item_id;
  END IF;

  -- Calculate total_cost if not provided
  IF NEW.total_cost IS NULL AND NEW.unit_cost IS NOT NULL THEN
    NEW.total_cost := NEW.unit_cost * NEW.quantity;
  END IF;

  -- Apply movement based on type
  CASE NEW.movement_type
    WHEN 'purchase_in', 'return', 'adjustment' THEN
      _new_stock := _item.current_stock + NEW.quantity;
      -- Weighted average cost for purchases
      IF NEW.movement_type = 'purchase_in' AND NEW.unit_cost IS NOT NULL AND NEW.unit_cost > 0 THEN
        IF _item.current_stock + NEW.quantity > 0 THEN
          _new_avg_cost := ((_item.avg_cost * _item.current_stock) + (NEW.unit_cost * NEW.quantity)) / (_item.current_stock + NEW.quantity);
        ELSE
          _new_avg_cost := NEW.unit_cost;
        END IF;
      ELSE
        _new_avg_cost := _item.avg_cost;
      END IF;

    WHEN 'job_consumption', 'loss', 'maintenance' THEN
      _new_stock := _item.current_stock - NEW.quantity;
      _new_avg_cost := _item.avg_cost;
      -- Set unit_cost to current avg if not provided
      IF NEW.unit_cost IS NULL THEN
        NEW.unit_cost := _item.avg_cost;
        NEW.total_cost := _item.avg_cost * NEW.quantity;
      END IF;

    ELSE
      RAISE EXCEPTION 'Unknown movement type: %', NEW.movement_type;
  END CASE;

  -- Set stock_after
  NEW.stock_after := _new_stock;

  -- Update item
  UPDATE public.inventory_items
  SET current_stock = _new_stock,
      avg_cost = _new_avg_cost,
      last_cost = CASE WHEN NEW.movement_type = 'purchase_in' AND NEW.unit_cost IS NOT NULL THEN NEW.unit_cost ELSE last_cost END,
      updated_at = now()
  WHERE id = NEW.item_id;

  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS trg_apply_inventory_movement ON public.inventory_movements;
CREATE TRIGGER trg_apply_inventory_movement
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_inventory_movement();
