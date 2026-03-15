
-- ============================================================
-- FORGE OS — MVP Fase 1 Schema
-- Multi-tenant ERP para Impressão 3D
-- ============================================================

-- ====================
-- ENUMS
-- ====================
CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'manager', 'operator', 'viewer');
CREATE TYPE public.account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE public.movement_type AS ENUM ('purchase_in', 'job_consumption', 'loss', 'maintenance', 'adjustment', 'return');
CREATE TYPE public.job_status AS ENUM ('draft', 'queued', 'printing', 'paused', 'failed', 'reprint', 'post_processing', 'quality_check', 'ready', 'shipped', 'completed');
CREATE TYPE public.payable_status AS ENUM ('open', 'partial', 'paid', 'overdue', 'cancelled');
CREATE TYPE public.receivable_status AS ENUM ('open', 'partial', 'received', 'overdue', 'reversed');
CREATE TYPE public.printer_status AS ENUM ('idle', 'printing', 'paused', 'error', 'offline', 'maintenance');

-- ====================
-- UTILITY: updated_at trigger function
-- ====================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ====================
-- TENANTS (empresas)
-- ====================
CREATE TABLE public.tenants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  currency TEXT NOT NULL DEFAULT 'BRL',
  logo_url TEXT,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====================
-- PROFILES (linked to auth.users)
-- ====================
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====================
-- USER ROLES (separate table per security guidelines)
-- ====================
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, tenant_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ====================
-- SECURITY DEFINER: get tenant_id for current user
-- ====================
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
$$;

-- ====================
-- SECURITY DEFINER: check role
-- ====================
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ====================
-- AUDIT LOG
-- ====================
CREATE TABLE public.audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  old_data JSONB,
  new_data JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ====================
-- CHART OF ACCOUNTS (Plano de Contas)
-- ====================
CREATE TABLE public.chart_of_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type public.account_type NOT NULL,
  parent_id UUID REFERENCES public.chart_of_accounts(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, code)
);
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_coa_updated_at BEFORE UPDATE ON public.chart_of_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====================
-- COST CENTERS (Centros de Custo)
-- ====================
CREATE TABLE public.cost_centers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.cost_centers(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, code)
);
ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_cc_updated_at BEFORE UPDATE ON public.cost_centers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====================
-- PAYMENT METHODS
-- ====================
CREATE TABLE public.payment_methods (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

-- ====================
-- BANK ACCOUNTS
-- ====================
CREATE TABLE public.bank_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bank_name TEXT,
  agency TEXT,
  account_number TEXT,
  initial_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_ba_updated_at BEFORE UPDATE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====================
-- VENDORS (Fornecedores)
-- ====================
CREATE TABLE public.vendors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  document TEXT,
  email TEXT,
  phone TEXT,
  address JSONB,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_vendors_updated_at BEFORE UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====================
-- CUSTOMERS (Clientes)
-- ====================
CREATE TABLE public.customers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  document TEXT,
  email TEXT,
  phone TEXT,
  address JSONB,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====================
-- ACCOUNTS PAYABLE (Contas a Pagar)
-- ====================
CREATE TABLE public.accounts_payable (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES public.vendors(id),
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  competence_date DATE,
  payment_date DATE,
  status public.payable_status NOT NULL DEFAULT 'open',
  account_id UUID REFERENCES public.chart_of_accounts(id),
  cost_center_id UUID REFERENCES public.cost_centers(id),
  bank_account_id UUID REFERENCES public.bank_accounts(id),
  payment_method_id UUID REFERENCES public.payment_methods(id),
  installment_number INT DEFAULT 1,
  installment_total INT DEFAULT 1,
  parent_id UUID REFERENCES public.accounts_payable(id),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.accounts_payable ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_ap_updated_at BEFORE UPDATE ON public.accounts_payable FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====================
-- ACCOUNTS RECEIVABLE (Contas a Receber)
-- ====================
CREATE TABLE public.accounts_receivable (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id),
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  amount_received NUMERIC(14,2) NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  competence_date DATE,
  receipt_date DATE,
  status public.receivable_status NOT NULL DEFAULT 'open',
  account_id UUID REFERENCES public.chart_of_accounts(id),
  cost_center_id UUID REFERENCES public.cost_centers(id),
  bank_account_id UUID REFERENCES public.bank_accounts(id),
  payment_method_id UUID REFERENCES public.payment_methods(id),
  installment_number INT DEFAULT 1,
  installment_total INT DEFAULT 1,
  parent_id UUID REFERENCES public.accounts_receivable(id),
  notes TEXT,
  origin_type TEXT,
  origin_id UUID,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.accounts_receivable ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_ar_updated_at BEFORE UPDATE ON public.accounts_receivable FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====================
-- BANK TRANSACTIONS
-- ====================
CREATE TABLE public.bank_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id),
  type TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  description TEXT,
  transaction_date DATE NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  is_reconciled BOOLEAN NOT NULL DEFAULT false,
  ofx_id TEXT,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

-- ====================
-- INVENTORY ITEMS (Materiais)
-- ====================
CREATE TABLE public.inventory_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  category TEXT NOT NULL DEFAULT 'filament',
  material_type TEXT,
  brand TEXT,
  color TEXT,
  diameter NUMERIC(4,2),
  unit TEXT NOT NULL DEFAULT 'g',
  current_stock NUMERIC(14,2) NOT NULL DEFAULT 0,
  min_stock NUMERIC(14,2) DEFAULT 0,
  avg_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  last_cost NUMERIC(14,4),
  loss_coefficient NUMERIC(5,4) NOT NULL DEFAULT 0.05,
  vendor_id UUID REFERENCES public.vendors(id),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_inv_updated_at BEFORE UPDATE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====================
-- INVENTORY MOVEMENTS
-- ====================
CREATE TABLE public.inventory_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id),
  movement_type public.movement_type NOT NULL,
  quantity NUMERIC(14,2) NOT NULL,
  unit_cost NUMERIC(14,4),
  total_cost NUMERIC(14,2),
  stock_after NUMERIC(14,2),
  reference_type TEXT,
  reference_id UUID,
  lot_number TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

-- ====================
-- PRINTERS (Impressoras)
-- ====================
CREATE TABLE public.printers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT 'Bambu Lab',
  model TEXT NOT NULL,
  serial_number TEXT,
  status public.printer_status NOT NULL DEFAULT 'offline',
  power_watts NUMERIC(8,2) DEFAULT 150,
  acquisition_cost NUMERIC(14,2) DEFAULT 0,
  useful_life_hours INT DEFAULT 10000,
  maintenance_cost_per_hour NUMERIC(8,4) DEFAULT 0,
  depreciation_per_hour NUMERIC(8,4) DEFAULT 0,
  total_print_hours NUMERIC(10,2) DEFAULT 0,
  total_prints INT DEFAULT 0,
  total_failures INT DEFAULT 0,
  bambu_device_id TEXT,
  bambu_access_code TEXT,
  ip_address TEXT,
  firmware_version TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_printers_updated_at BEFORE UPDATE ON public.printers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====================
-- JOBS (Ordens de Impressão)
-- ====================
CREATE TABLE public.jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status public.job_status NOT NULL DEFAULT 'draft',
  printer_id UUID REFERENCES public.printers(id),
  material_id UUID REFERENCES public.inventory_items(id),
  est_grams NUMERIC(10,2) DEFAULT 0,
  est_time_minutes INT DEFAULT 0,
  est_material_cost NUMERIC(14,2) DEFAULT 0,
  est_energy_cost NUMERIC(14,2) DEFAULT 0,
  est_machine_cost NUMERIC(14,2) DEFAULT 0,
  est_labor_cost NUMERIC(14,2) DEFAULT 0,
  est_overhead NUMERIC(14,2) DEFAULT 0,
  est_total_cost NUMERIC(14,2) DEFAULT 0,
  actual_grams NUMERIC(10,2),
  actual_time_minutes INT,
  actual_material_cost NUMERIC(14,2),
  actual_energy_cost NUMERIC(14,2),
  actual_machine_cost NUMERIC(14,2),
  actual_labor_cost NUMERIC(14,2),
  actual_overhead NUMERIC(14,2),
  actual_total_cost NUMERIC(14,2),
  prep_minutes INT DEFAULT 0,
  post_minutes INT DEFAULT 0,
  qc_minutes INT DEFAULT 0,
  sale_price NUMERIC(14,2),
  margin_percent NUMERIC(6,2),
  failure_reason TEXT,
  waste_grams NUMERIC(10,2) DEFAULT 0,
  reprint_of UUID REFERENCES public.jobs(id),
  bambu_task_id TEXT,
  bambu_subtask_id TEXT,
  order_id UUID,
  priority INT NOT NULL DEFAULT 5,
  due_date DATE,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE SEQUENCE IF NOT EXISTS public.job_code_seq START 1;

-- ====================
-- JOB PHOTOS
-- ====================
CREATE TABLE public.job_photos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'result',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.job_photos ENABLE ROW LEVEL SECURITY;

-- ====================
-- BAMBU CONNECTIONS (per tenant)
-- ====================
CREATE TABLE public.bambu_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bambu_email TEXT,
  bambu_uid TEXT,
  access_token_encrypted TEXT,
  region TEXT NOT NULL DEFAULT 'global',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.bambu_connections ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_bambu_conn_updated_at BEFORE UPDATE ON public.bambu_connections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====================
-- BAMBU DEVICES (synced from Bambu Cloud)
-- ====================
CREATE TABLE public.bambu_devices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.bambu_connections(id) ON DELETE CASCADE,
  printer_id UUID REFERENCES public.printers(id),
  dev_id TEXT NOT NULL,
  name TEXT,
  model TEXT,
  online BOOLEAN DEFAULT false,
  print_status TEXT,
  nozzle_temp NUMERIC(6,2),
  bed_temp NUMERIC(6,2),
  chamber_temp NUMERIC(6,2),
  progress INT,
  remaining_time INT,
  current_task TEXT,
  ams_data JSONB,
  last_status JSONB,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, dev_id)
);
ALTER TABLE public.bambu_devices ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_bambu_dev_updated_at BEFORE UPDATE ON public.bambu_devices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====================
-- BAMBU TASKS (synced print history)
-- ====================
CREATE TABLE public.bambu_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bambu_device_id UUID REFERENCES public.bambu_devices(id),
  job_id UUID REFERENCES public.jobs(id),
  bambu_task_id TEXT NOT NULL,
  design_title TEXT,
  status TEXT,
  weight_grams NUMERIC(10,2),
  length_mm NUMERIC(12,2),
  cost_time_seconds INT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  cover_url TEXT,
  thumbnail_url TEXT,
  raw_data JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, bambu_task_id)
);
ALTER TABLE public.bambu_tasks ENABLE ROW LEVEL SECURITY;

-- ====================
-- ATTACHMENTS (for AP/AR/jobs)
-- ====================
CREATE TABLE public.attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  file_size INT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

-- ====================
-- RLS POLICIES
-- ====================

-- PROFILES
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- USER ROLES
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

-- TENANTS
CREATE POLICY "Users can view own tenant" ON public.tenants FOR SELECT USING (id = public.get_user_tenant_id());
CREATE POLICY "Owners can update tenant" ON public.tenants FOR UPDATE USING (id = public.get_user_tenant_id() AND public.has_role(auth.uid(), 'owner'));

-- AUDIT LOG
CREATE POLICY "View own tenant audit" ON public.audit_log FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "Insert own tenant audit" ON public.audit_log FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

-- All other tables: standard tenant isolation
CREATE POLICY "coa_s" ON public.chart_of_accounts FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "coa_i" ON public.chart_of_accounts FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "coa_u" ON public.chart_of_accounts FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "coa_d" ON public.chart_of_accounts FOR DELETE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "cc_s" ON public.cost_centers FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "cc_i" ON public.cost_centers FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "cc_u" ON public.cost_centers FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "cc_d" ON public.cost_centers FOR DELETE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "pm_s" ON public.payment_methods FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "pm_i" ON public.payment_methods FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "pm_u" ON public.payment_methods FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "ba_s" ON public.bank_accounts FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "ba_i" ON public.bank_accounts FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "ba_u" ON public.bank_accounts FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "v_s" ON public.vendors FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "v_i" ON public.vendors FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "v_u" ON public.vendors FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "v_d" ON public.vendors FOR DELETE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "c_s" ON public.customers FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "c_i" ON public.customers FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "c_u" ON public.customers FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "c_d" ON public.customers FOR DELETE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "ap_s" ON public.accounts_payable FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "ap_i" ON public.accounts_payable FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "ap_u" ON public.accounts_payable FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "ap_d" ON public.accounts_payable FOR DELETE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "ar_s" ON public.accounts_receivable FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "ar_i" ON public.accounts_receivable FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "ar_u" ON public.accounts_receivable FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "ar_d" ON public.accounts_receivable FOR DELETE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "bt_s" ON public.bank_transactions FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "bt_i" ON public.bank_transactions FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "bt_u" ON public.bank_transactions FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "ii_s" ON public.inventory_items FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "ii_i" ON public.inventory_items FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "ii_u" ON public.inventory_items FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "ii_d" ON public.inventory_items FOR DELETE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "im_s" ON public.inventory_movements FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "im_i" ON public.inventory_movements FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "pr_s" ON public.printers FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "pr_i" ON public.printers FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "pr_u" ON public.printers FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "pr_d" ON public.printers FOR DELETE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "j_s" ON public.jobs FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "j_i" ON public.jobs FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "j_u" ON public.jobs FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "j_d" ON public.jobs FOR DELETE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "jp_s" ON public.job_photos FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "jp_i" ON public.job_photos FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "jp_d" ON public.job_photos FOR DELETE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "bc_s" ON public.bambu_connections FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "bc_i" ON public.bambu_connections FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "bc_u" ON public.bambu_connections FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "bc_d" ON public.bambu_connections FOR DELETE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "bd_s" ON public.bambu_devices FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "bd_i" ON public.bambu_devices FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "bd_u" ON public.bambu_devices FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "bts_s" ON public.bambu_tasks FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "bts_i" ON public.bambu_tasks FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "att_s" ON public.attachments FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "att_i" ON public.attachments FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "att_d" ON public.attachments FOR DELETE USING (tenant_id = public.get_user_tenant_id());

-- ====================
-- INDEXES
-- ====================
CREATE INDEX idx_profiles_tenant ON public.profiles(tenant_id);
CREATE INDEX idx_profiles_user ON public.profiles(user_id);
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_tenant ON public.user_roles(tenant_id);
CREATE INDEX idx_coa_tenant ON public.chart_of_accounts(tenant_id);
CREATE INDEX idx_cc_tenant ON public.cost_centers(tenant_id);
CREATE INDEX idx_ap_tenant_status ON public.accounts_payable(tenant_id, status);
CREATE INDEX idx_ap_due ON public.accounts_payable(tenant_id, due_date);
CREATE INDEX idx_ar_tenant_status ON public.accounts_receivable(tenant_id, status);
CREATE INDEX idx_bt_account ON public.bank_transactions(bank_account_id);
CREATE INDEX idx_ii_tenant ON public.inventory_items(tenant_id);
CREATE INDEX idx_im_item ON public.inventory_movements(item_id);
CREATE INDEX idx_im_ref ON public.inventory_movements(reference_type, reference_id);
CREATE INDEX idx_printers_tenant ON public.printers(tenant_id);
CREATE INDEX idx_jobs_tenant_status ON public.jobs(tenant_id, status);
CREATE INDEX idx_jobs_printer ON public.jobs(printer_id);
CREATE INDEX idx_jobs_bambu ON public.jobs(bambu_task_id);
CREATE INDEX idx_bd_tenant ON public.bambu_devices(tenant_id);
CREATE INDEX idx_bts_tenant ON public.bambu_tasks(tenant_id);
CREATE INDEX idx_bts_device ON public.bambu_tasks(bambu_device_id);
CREATE INDEX idx_att_entity ON public.attachments(entity_type, entity_id);
CREATE INDEX idx_audit_tenant ON public.audit_log(tenant_id);

-- ====================
-- STORAGE BUCKET
-- ====================
INSERT INTO storage.buckets (id, name, public) VALUES ('attachments', 'attachments', false);

CREATE POLICY "Auth users can view attachments" ON storage.objects FOR SELECT USING (bucket_id = 'attachments' AND auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can upload attachments" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'attachments' AND auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete attachments" ON storage.objects FOR DELETE USING (bucket_id = 'attachments' AND auth.uid() IS NOT NULL);
