export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      accounts_payable: {
        Row: {
          account_id: string | null
          amount: number
          amount_paid: number
          bank_account_id: string | null
          competence_date: string | null
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          description: string
          due_date: string
          id: string
          installment_number: number | null
          installment_total: number | null
          notes: string | null
          origin_id: string | null
          origin_type: string | null
          parent_id: string | null
          payment_date: string | null
          payment_method_id: string | null
          status: Database["public"]["Enums"]["payable_status"]
          tenant_id: string
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          amount_paid?: number
          bank_account_id?: string | null
          competence_date?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          due_date: string
          id?: string
          installment_number?: number | null
          installment_total?: number | null
          notes?: string | null
          origin_id?: string | null
          origin_type?: string | null
          parent_id?: string | null
          payment_date?: string | null
          payment_method_id?: string | null
          status?: Database["public"]["Enums"]["payable_status"]
          tenant_id: string
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          amount_paid?: number
          bank_account_id?: string | null
          competence_date?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string
          id?: string
          installment_number?: number | null
          installment_total?: number | null
          notes?: string | null
          origin_id?: string | null
          origin_type?: string | null
          parent_id?: string | null
          payment_date?: string | null
          payment_method_id?: string | null
          status?: Database["public"]["Enums"]["payable_status"]
          tenant_id?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_payable_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "accounts_payable"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts_receivable: {
        Row: {
          account_id: string | null
          amount: number
          amount_received: number
          bank_account_id: string | null
          competence_date: string | null
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          description: string
          due_date: string
          id: string
          installment_number: number | null
          installment_total: number | null
          marketplace_cancelled_gross: number
          notes: string | null
          origin_id: string | null
          origin_type: string | null
          parent_id: string | null
          payment_method_id: string | null
          receipt_date: string | null
          status: Database["public"]["Enums"]["receivable_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          amount_received?: number
          bank_account_id?: string | null
          competence_date?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          description: string
          due_date: string
          id?: string
          installment_number?: number | null
          installment_total?: number | null
          marketplace_cancelled_gross?: number
          notes?: string | null
          origin_id?: string | null
          origin_type?: string | null
          parent_id?: string | null
          payment_method_id?: string | null
          receipt_date?: string | null
          status?: Database["public"]["Enums"]["receivable_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          amount_received?: number
          bank_account_id?: string | null
          competence_date?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          description?: string
          due_date?: string
          id?: string
          installment_number?: number | null
          installment_total?: number | null
          marketplace_cancelled_gross?: number
          notes?: string | null
          origin_id?: string | null
          origin_type?: string | null
          parent_id?: string | null
          payment_method_id?: string | null
          receipt_date?: string | null
          status?: Database["public"]["Enums"]["receivable_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_receivable_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_receivable_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_receivable_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_receivable_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_receivable_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "accounts_receivable"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_receivable_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["receivable_id"]
          },
          {
            foreignKeyName: "accounts_receivable_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_receivable_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      assembly_component_allocations: {
        Row: {
          assembly_id: string
          id: string
          lot_id: string
          quantity: number
          tenant_id: string
          unit_cost: number
        }
        Insert: {
          assembly_id: string
          id?: string
          lot_id: string
          quantity: number
          tenant_id: string
          unit_cost: number
        }
        Update: {
          assembly_id?: string
          id?: string
          lot_id?: string
          quantity?: number
          tenant_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "assembly_component_allocations_assembly_id_fkey"
            columns: ["assembly_id"]
            isOneToOne: false
            referencedRelation: "product_assemblies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assembly_component_allocations_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "component_stock_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assembly_component_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      assembly_subitem_allocations: {
        Row: {
          assembly_id: string
          component_product_id: string
          id: string
          movement_id: string
          quantity: number
          tenant_id: string
          unit_cost: number
        }
        Insert: {
          assembly_id: string
          component_product_id: string
          id?: string
          movement_id: string
          quantity: number
          tenant_id: string
          unit_cost: number
        }
        Update: {
          assembly_id?: string
          component_product_id?: string
          id?: string
          movement_id?: string
          quantity?: number
          tenant_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "assembly_subitem_allocations_assembly_id_fkey"
            columns: ["assembly_id"]
            isOneToOne: false
            referencedRelation: "product_assemblies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assembly_subitem_allocations_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assembly_subitem_allocations_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "inventory_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assembly_subitem_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          tenant_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          tenant_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          tenant_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          metadata: Json | null
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          metadata?: Json | null
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bambu_connections: {
        Row: {
          access_token_encrypted: string | null
          bambu_email: string | null
          bambu_uid: string | null
          created_at: string
          id: string
          is_active: boolean
          last_sync_at: string | null
          region: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          access_token_encrypted?: string | null
          bambu_email?: string | null
          bambu_uid?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          region?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          access_token_encrypted?: string | null
          bambu_email?: string | null
          bambu_uid?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          region?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bambu_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bambu_devices: {
        Row: {
          ams_data: Json | null
          bed_temp: number | null
          chamber_temp: number | null
          connection_id: string
          created_at: string
          current_task: string | null
          dev_id: string
          id: string
          last_seen_at: string | null
          last_status: Json | null
          model: string | null
          name: string | null
          nozzle_temp: number | null
          online: boolean | null
          print_status: string | null
          printer_id: string | null
          progress: number | null
          remaining_time: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ams_data?: Json | null
          bed_temp?: number | null
          chamber_temp?: number | null
          connection_id: string
          created_at?: string
          current_task?: string | null
          dev_id: string
          id?: string
          last_seen_at?: string | null
          last_status?: Json | null
          model?: string | null
          name?: string | null
          nozzle_temp?: number | null
          online?: boolean | null
          print_status?: string | null
          printer_id?: string | null
          progress?: number | null
          remaining_time?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ams_data?: Json | null
          bed_temp?: number | null
          chamber_temp?: number | null
          connection_id?: string
          created_at?: string
          current_task?: string | null
          dev_id?: string
          id?: string
          last_seen_at?: string | null
          last_status?: Json | null
          model?: string | null
          name?: string | null
          nozzle_temp?: number | null
          online?: boolean | null
          print_status?: string | null
          printer_id?: string | null
          progress?: number | null
          remaining_time?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bambu_devices_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "bambu_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_devices_printer_id_fkey"
            columns: ["printer_id"]
            isOneToOne: false
            referencedRelation: "printers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_devices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bambu_production_allocations: {
        Row: {
          job_id: string
          quantity: number
          task_id: string
          tenant_id: string
        }
        Insert: {
          job_id: string
          quantity: number
          task_id: string
          tenant_id: string
        }
        Update: {
          job_id?: string
          quantity?: number
          task_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bambu_production_allocations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_production_allocations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "bambu_production_records"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "bambu_production_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bambu_production_profiles: {
        Row: {
          auto_enabled: boolean
          auto_from: string
          bambu_device_id: string
          created_by: string | null
          extras_cost: number
          id: string
          labor_cost: number
          material_overrides: Json
          material_snapshot: Json | null
          materials: Json
          overhead: number
          plate_id: string | null
          product_id: string
          project_key: string
          tenant_id: string
          units: number
          updated_at: string
          use_slicer: boolean
        }
        Insert: {
          auto_enabled?: boolean
          auto_from?: string
          bambu_device_id: string
          created_by?: string | null
          extras_cost?: number
          id?: string
          labor_cost?: number
          material_overrides?: Json
          material_snapshot?: Json | null
          materials: Json
          overhead?: number
          plate_id?: string | null
          product_id: string
          project_key: string
          tenant_id: string
          units: number
          updated_at?: string
          use_slicer?: boolean
        }
        Update: {
          auto_enabled?: boolean
          auto_from?: string
          bambu_device_id?: string
          created_by?: string | null
          extras_cost?: number
          id?: string
          labor_cost?: number
          material_overrides?: Json
          material_snapshot?: Json | null
          materials?: Json
          overhead?: number
          plate_id?: string | null
          product_id?: string
          project_key?: string
          tenant_id?: string
          units?: number
          updated_at?: string
          use_slicer?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "bambu_production_profiles_bambu_device_id_fkey"
            columns: ["bambu_device_id"]
            isOneToOne: false
            referencedRelation: "bambu_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_production_profiles_plate_id_fkey"
            columns: ["plate_id"]
            isOneToOne: false
            referencedRelation: "product_print_plates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_production_profiles_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_production_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bambu_production_records: {
        Row: {
          allocations: Json
          auto_enabled: boolean
          consumption_source: string | null
          created_at: string
          elapsed_seconds: number | null
          energy_cost: number | null
          extras_cost: number | null
          job_ids: string[] | null
          labor_cost: number | null
          machine_cost: number | null
          material_cost: number | null
          material_overrides: Json
          material_snapshot: Json | null
          materials: Json | null
          outcome: string
          overhead: number | null
          plate_id: string | null
          posted_at: string | null
          problem: string | null
          product_id: string | null
          profile_id: string | null
          quality_loss_cost: number
          quality_loss_grams: number
          quality_rejected_units: number
          quality_state: string
          source_snapshot: Json | null
          state: string
          task_id: string
          tenant_id: string
          total_cost: number | null
          total_grams: number | null
          units: number | null
          updated_at: string
          use_slicer: boolean
        }
        Insert: {
          allocations?: Json
          auto_enabled?: boolean
          consumption_source?: string | null
          created_at?: string
          elapsed_seconds?: number | null
          energy_cost?: number | null
          extras_cost?: number | null
          job_ids?: string[] | null
          labor_cost?: number | null
          machine_cost?: number | null
          material_cost?: number | null
          material_overrides?: Json
          material_snapshot?: Json | null
          materials?: Json | null
          outcome?: string
          overhead?: number | null
          plate_id?: string | null
          posted_at?: string | null
          problem?: string | null
          product_id?: string | null
          profile_id?: string | null
          quality_loss_cost?: number
          quality_loss_grams?: number
          quality_rejected_units?: number
          quality_state?: string
          source_snapshot?: Json | null
          state?: string
          task_id: string
          tenant_id: string
          total_cost?: number | null
          total_grams?: number | null
          units?: number | null
          updated_at?: string
          use_slicer?: boolean
        }
        Update: {
          allocations?: Json
          auto_enabled?: boolean
          consumption_source?: string | null
          created_at?: string
          elapsed_seconds?: number | null
          energy_cost?: number | null
          extras_cost?: number | null
          job_ids?: string[] | null
          labor_cost?: number | null
          machine_cost?: number | null
          material_cost?: number | null
          material_overrides?: Json
          material_snapshot?: Json | null
          materials?: Json | null
          outcome?: string
          overhead?: number | null
          plate_id?: string | null
          posted_at?: string | null
          problem?: string | null
          product_id?: string | null
          profile_id?: string | null
          quality_loss_cost?: number
          quality_loss_grams?: number
          quality_rejected_units?: number
          quality_state?: string
          source_snapshot?: Json | null
          state?: string
          task_id?: string
          tenant_id?: string
          total_cost?: number | null
          total_grams?: number | null
          units?: number | null
          updated_at?: string
          use_slicer?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "bambu_production_records_plate_id_fkey"
            columns: ["plate_id"]
            isOneToOne: false
            referencedRelation: "product_print_plates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_production_records_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_production_records_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "bambu_production_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_production_records_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "bambu_production_review"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "bambu_production_records_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "bambu_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_production_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bambu_quality_rejections: {
        Row: {
          created_at: string
          created_by: string | null
          elapsed_seconds: number
          grams: number
          job_id: string
          material_cost: number
          quantity: number
          reason: string
          task_id: string
          tenant_id: string
          total_cost: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          elapsed_seconds: number
          grams: number
          job_id: string
          material_cost: number
          quantity: number
          reason: string
          task_id: string
          tenant_id: string
          total_cost: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          elapsed_seconds?: number
          grams?: number
          job_id?: string
          material_cost?: number
          quantity?: number
          reason?: string
          task_id?: string
          tenant_id?: string
          total_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "bambu_quality_rejections_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_quality_rejections_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "bambu_production_records"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "bambu_quality_rejections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bambu_sync_state: {
        Row: {
          bambu_device_id: string
          connection_id: string
          history_may_be_truncated: boolean
          http_status: number | null
          last_attempt_at: string | null
          last_error: string | null
          last_error_code: string | null
          last_requested_at: string | null
          last_success_at: string | null
          next_attempt_at: string | null
          status: string
          tasks_received: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          bambu_device_id: string
          connection_id: string
          history_may_be_truncated?: boolean
          http_status?: number | null
          last_attempt_at?: string | null
          last_error?: string | null
          last_error_code?: string | null
          last_requested_at?: string | null
          last_success_at?: string | null
          next_attempt_at?: string | null
          status?: string
          tasks_received?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          bambu_device_id?: string
          connection_id?: string
          history_may_be_truncated?: boolean
          http_status?: number | null
          last_attempt_at?: string | null
          last_error?: string | null
          last_error_code?: string | null
          last_requested_at?: string | null
          last_success_at?: string | null
          next_attempt_at?: string | null
          status?: string
          tasks_received?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bambu_sync_state_bambu_device_id_fkey"
            columns: ["bambu_device_id"]
            isOneToOne: true
            referencedRelation: "bambu_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_sync_state_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "bambu_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_sync_state_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bambu_tasks: {
        Row: {
          bambu_device_id: string | null
          bambu_task_id: string
          cost_time_seconds: number | null
          cover_url: string | null
          created_at: string
          design_title: string | null
          end_time: string | null
          id: string
          job_id: string | null
          length_mm: number | null
          raw_data: Json | null
          start_time: string | null
          status: string | null
          synced_at: string
          tenant_id: string
          thumbnail_url: string | null
          weight_grams: number | null
        }
        Insert: {
          bambu_device_id?: string | null
          bambu_task_id: string
          cost_time_seconds?: number | null
          cover_url?: string | null
          created_at?: string
          design_title?: string | null
          end_time?: string | null
          id?: string
          job_id?: string | null
          length_mm?: number | null
          raw_data?: Json | null
          start_time?: string | null
          status?: string | null
          synced_at?: string
          tenant_id: string
          thumbnail_url?: string | null
          weight_grams?: number | null
        }
        Update: {
          bambu_device_id?: string | null
          bambu_task_id?: string
          cost_time_seconds?: number | null
          cover_url?: string | null
          created_at?: string
          design_title?: string | null
          end_time?: string | null
          id?: string
          job_id?: string | null
          length_mm?: number | null
          raw_data?: Json | null
          start_time?: string | null
          status?: string | null
          synced_at?: string
          tenant_id?: string
          thumbnail_url?: string | null
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bambu_tasks_bambu_device_id_fkey"
            columns: ["bambu_device_id"]
            isOneToOne: false
            referencedRelation: "bambu_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_number: string | null
          agency: string | null
          bank_name: string | null
          created_at: string
          current_balance: number
          id: string
          initial_balance: number
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          agency?: string | null
          bank_name?: string | null
          created_at?: string
          current_balance?: number
          id?: string
          initial_balance?: number
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          agency?: string | null
          bank_name?: string | null
          created_at?: string
          current_balance?: number
          id?: string
          initial_balance?: number
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          amount: number
          bank_account_id: string
          created_at: string
          description: string | null
          id: string
          is_reconciled: boolean
          memo: string | null
          ofx_id: string | null
          reference_id: string | null
          reference_type: string | null
          tenant_id: string
          transaction_date: string
          type: string
        }
        Insert: {
          amount: number
          bank_account_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_reconciled?: boolean
          memo?: string | null
          ofx_id?: string | null
          reference_id?: string | null
          reference_type?: string | null
          tenant_id: string
          transaction_date: string
          type: string
        }
        Update: {
          amount?: number
          bank_account_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_reconciled?: boolean
          memo?: string | null
          ofx_id?: string | null
          reference_id?: string | null
          reference_type?: string | null
          tenant_id?: string
          transaction_date?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_of_accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          parent_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_type: Database["public"]["Enums"]["account_type"]
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          parent_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          parent_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      component_stock_losses: {
        Row: {
          allocations: Json
          created_at: string
          created_by: string | null
          id: string
          plate_id: string
          quantity: number
          reason: string
          tenant_id: string
          total_cost: number
        }
        Insert: {
          allocations: Json
          created_at?: string
          created_by?: string | null
          id?: string
          plate_id: string
          quantity: number
          reason: string
          tenant_id: string
          total_cost: number
        }
        Update: {
          allocations?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          plate_id?: string
          quantity?: number
          reason?: string
          tenant_id?: string
          total_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "component_stock_losses_plate_id_fkey"
            columns: ["plate_id"]
            isOneToOne: false
            referencedRelation: "product_print_plates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_stock_losses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      component_stock_lots: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          material_key: string
          material_snapshot: Json
          notes: string | null
          plate_id: string
          product_id: string
          quantity: number
          remaining: number
          source_job_id: string | null
          tenant_id: string
          unit_cost: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          material_key: string
          material_snapshot?: Json
          notes?: string | null
          plate_id: string
          product_id: string
          quantity: number
          remaining: number
          source_job_id?: string | null
          tenant_id: string
          unit_cost: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          material_key?: string
          material_snapshot?: Json
          notes?: string | null
          plate_id?: string
          product_id?: string
          quantity?: number
          remaining?: number
          source_job_id?: string | null
          tenant_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "component_stock_lots_plate_id_fkey"
            columns: ["plate_id"]
            isOneToOne: false
            referencedRelation: "product_print_plates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_stock_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_stock_lots_source_job_id_fkey"
            columns: ["source_job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_stock_lots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      consignment_items: {
        Row: {
          created_at: string
          current_qty: number
          id: string
          location_id: string
          product_id: string
          sale_price: number | null
          tenant_id: string
          total_placed: number
          total_returned: number
          total_sold: number
          updated_at: string
          warehouse_tracked_qty: number
        }
        Insert: {
          created_at?: string
          current_qty?: number
          id?: string
          location_id: string
          product_id: string
          sale_price?: number | null
          tenant_id: string
          total_placed?: number
          total_returned?: number
          total_sold?: number
          updated_at?: string
          warehouse_tracked_qty?: number
        }
        Update: {
          created_at?: string
          current_qty?: number
          id?: string
          location_id?: string
          product_id?: string
          sale_price?: number | null
          tenant_id?: string
          total_placed?: number
          total_returned?: number
          total_sold?: number
          updated_at?: string
          warehouse_tracked_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "consignment_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "consignment_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignment_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignment_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      consignment_locations: {
        Row: {
          address: string | null
          commission_percent: number
          contact_name: string | null
          created_at: string
          customer_id: string | null
          discount_percent: number
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          commission_percent?: number
          contact_name?: string | null
          created_at?: string
          customer_id?: string | null
          discount_percent?: number
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          commission_percent?: number
          contact_name?: string | null
          created_at?: string
          customer_id?: string | null
          discount_percent?: number
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consignment_locations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignment_locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      consignment_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          movement_type: Database["public"]["Enums"]["consignment_movement_type"]
          notes: string | null
          product_id: string
          quantity: number
          tenant_id: string
          total: number | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          movement_type: Database["public"]["Enums"]["consignment_movement_type"]
          notes?: string | null
          product_id: string
          quantity: number
          tenant_id: string
          total?: number | null
          unit_price?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          movement_type?: Database["public"]["Enums"]["consignment_movement_type"]
          notes?: string | null
          product_id?: string
          quantity?: number
          tenant_id?: string
          total?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "consignment_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "consignment_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignment_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consignment_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_centers: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          parent_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          parent_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          parent_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_centers_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_centers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: Json | null
          birthday: string | null
          created_at: string
          document: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          registration_details: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: Json | null
          birthday?: string | null
          created_at?: string
          document?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          registration_details?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: Json | null
          birthday?: string | null
          created_at?: string
          document?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          registration_details?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      filament_replenishment_policies: {
        Row: {
          buffer_grams: number
          item_id: string
          lead_days: number
          multiple_kg: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vendor_id: string | null
        }
        Insert: {
          buffer_grams?: number
          item_id: string
          lead_days?: number
          multiple_kg?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
        }
        Update: {
          buffer_grams?: number
          item_id?: string
          lead_days?: number
          multiple_kg?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "filament_replenishment_policies_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filament_replenishment_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filament_replenishment_policies_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      filament_reservations: {
        Row: {
          created_at: string
          created_by: string | null
          grams: number
          id: string
          item_id: string
          job_id: string
          reason: string
          released_at: string | null
          spool_id: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          grams: number
          id?: string
          item_id: string
          job_id: string
          reason: string
          released_at?: string | null
          spool_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          grams?: number
          id?: string
          item_id?: string
          job_id?: string
          reason?: string
          released_at?: string | null
          spool_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "filament_reservations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filament_reservations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filament_reservations_spool_id_fkey"
            columns: ["spool_id"]
            isOneToOne: false
            referencedRelation: "filament_spools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filament_reservations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      filament_spool_events: {
        Row: {
          after_data: Json
          before_data: Json | null
          created_at: string
          created_by: string | null
          event_type: string
          id: string
          reason: string
          request_id: string | null
          spool_id: string
          tenant_id: string
        }
        Insert: {
          after_data: Json
          before_data?: Json | null
          created_at?: string
          created_by?: string | null
          event_type: string
          id?: string
          reason: string
          request_id?: string | null
          spool_id: string
          tenant_id: string
        }
        Update: {
          after_data?: Json
          before_data?: Json | null
          created_at?: string
          created_by?: string | null
          event_type?: string
          id?: string
          reason?: string
          request_id?: string | null
          spool_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "filament_spool_events_spool_id_fkey"
            columns: ["spool_id"]
            isOneToOne: false
            referencedRelation: "filament_spools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filament_spool_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      filament_spools: {
        Row: {
          ams_slot: number | null
          ams_unit: number | null
          created_at: string
          created_by: string | null
          estimated_remaining_grams: number
          id: string
          initial_net_grams: number
          is_active: boolean
          item_id: string
          label: string
          location_kind: string
          location_label: string
          measured_at: string | null
          measured_gross_grams: number | null
          needs_weighing: boolean
          printer_id: string | null
          tare_grams: number
          tenant_id: string
          updated_at: string
          weight_source: string
        }
        Insert: {
          ams_slot?: number | null
          ams_unit?: number | null
          created_at?: string
          created_by?: string | null
          estimated_remaining_grams: number
          id?: string
          initial_net_grams: number
          is_active?: boolean
          item_id: string
          label: string
          location_kind?: string
          location_label?: string
          measured_at?: string | null
          measured_gross_grams?: number | null
          needs_weighing?: boolean
          printer_id?: string | null
          tare_grams: number
          tenant_id: string
          updated_at?: string
          weight_source: string
        }
        Update: {
          ams_slot?: number | null
          ams_unit?: number | null
          created_at?: string
          created_by?: string | null
          estimated_remaining_grams?: number
          id?: string
          initial_net_grams?: number
          is_active?: boolean
          item_id?: string
          label?: string
          location_kind?: string
          location_label?: string
          measured_at?: string | null
          measured_gross_grams?: number | null
          needs_weighing?: boolean
          printer_id?: string | null
          tare_grams?: number
          tenant_id?: string
          updated_at?: string
          weight_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "filament_spools_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filament_spools_printer_id_fkey"
            columns: ["printer_id"]
            isOneToOne: false
            referencedRelation: "printers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filament_spools_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          avg_cost: number
          brand: string | null
          category: string
          color: string | null
          color_code: string | null
          color_hex: string | null
          created_at: string
          current_stock: number
          diameter: number | null
          freight_cost: number | null
          id: string
          is_active: boolean
          last_cost: number | null
          loss_coefficient: number
          material_code: string | null
          material_description: string | null
          material_identified_at: string | null
          material_identified_by: string | null
          material_type: string | null
          max_stock: number
          min_stock: number | null
          name: string
          notes: string | null
          parent_id: string | null
          sku: string | null
          tenant_id: string
          unit: string
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          avg_cost?: number
          brand?: string | null
          category?: string
          color?: string | null
          color_code?: string | null
          color_hex?: string | null
          created_at?: string
          current_stock?: number
          diameter?: number | null
          freight_cost?: number | null
          id?: string
          is_active?: boolean
          last_cost?: number | null
          loss_coefficient?: number
          material_code?: string | null
          material_description?: string | null
          material_identified_at?: string | null
          material_identified_by?: string | null
          material_type?: string | null
          max_stock?: number
          min_stock?: number | null
          name: string
          notes?: string | null
          parent_id?: string | null
          sku?: string | null
          tenant_id: string
          unit?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          avg_cost?: number
          brand?: string | null
          category?: string
          color?: string | null
          color_code?: string | null
          color_hex?: string | null
          created_at?: string
          current_stock?: number
          diameter?: number | null
          freight_cost?: number | null
          id?: string
          is_active?: boolean
          last_cost?: number | null
          loss_coefficient?: number
          material_code?: string | null
          material_description?: string | null
          material_identified_at?: string | null
          material_identified_by?: string | null
          material_type?: string | null
          max_stock?: number
          min_stock?: number | null
          name?: string
          notes?: string | null
          parent_id?: string | null
          sku?: string | null
          tenant_id?: string
          unit?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_material_code_fkey"
            columns: ["material_code"]
            isOneToOne: false
            referencedRelation: "material_code_catalog"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "inventory_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          item_id: string
          lot_number: string | null
          movement_type: Database["public"]["Enums"]["movement_type"]
          notes: string | null
          quantity: number
          reference_id: string | null
          reference_type: string | null
          stock_after: number | null
          tenant_id: string
          total_cost: number | null
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id: string
          lot_number?: string | null
          movement_type: Database["public"]["Enums"]["movement_type"]
          notes?: string | null
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          stock_after?: number | null
          tenant_id: string
          total_cost?: number | null
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string
          lot_number?: string | null
          movement_type?: Database["public"]["Enums"]["movement_type"]
          notes?: string | null
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          stock_after?: number | null
          tenant_id?: string
          total_cost?: number | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_photos: {
        Row: {
          created_at: string
          id: string
          job_id: string
          tenant_id: string
          type: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          tenant_id: string
          type?: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          tenant_id?: string
          type?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_photos_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_subitem_outputs: {
        Row: {
          component_product_id: string
          good_quantity: number
          id: string
          job_id: string
          movement_id: string | null
          planned_quantity: number
          tenant_id: string
          unit_cost: number
        }
        Insert: {
          component_product_id: string
          good_quantity: number
          id?: string
          job_id: string
          movement_id?: string | null
          planned_quantity: number
          tenant_id: string
          unit_cost: number
        }
        Update: {
          component_product_id?: string
          good_quantity?: number
          id?: string
          job_id?: string
          movement_id?: string | null
          planned_quantity?: number
          tenant_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_subitem_outputs_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_subitem_outputs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_subitem_outputs_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "inventory_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_subitem_outputs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          actual_energy_cost: number | null
          actual_extras_cost: number | null
          actual_grams: number | null
          actual_labor_cost: number | null
          actual_machine_cost: number | null
          actual_material_cost: number | null
          actual_material_usage: Json | null
          actual_overhead: number | null
          actual_time_minutes: number | null
          actual_time_seconds: number | null
          actual_total_cost: number | null
          bambu_subtask_id: string | null
          bambu_task_id: string | null
          code: string
          completed_at: string | null
          component_stock_key: string | null
          created_at: string
          created_by: string | null
          creation_request_id: string | null
          description: string | null
          due_date: string | null
          est_energy_cost: number | null
          est_extras_cost: number | null
          est_grams: number | null
          est_labor_cost: number | null
          est_machine_cost: number | null
          est_material_cost: number | null
          est_overhead: number | null
          est_time_minutes: number | null
          est_total_cost: number | null
          failure_reason: string | null
          id: string
          inventory_posted_at: string | null
          margin_percent: number | null
          material_id: string | null
          material_selection_snapshot: Json | null
          name: string
          num_colors: number
          order_id: string | null
          order_item_id: string | null
          order_unit_index: number | null
          planned_quantity: number
          post_minutes: number | null
          prep_minutes: number | null
          print_file_snapshot: Json | null
          print_plate_id: string | null
          printer_id: string | null
          priority: number
          produced_quantity: number | null
          product_id: string | null
          production_order_id: string | null
          production_order_item_id: string | null
          production_snapshot: Json | null
          production_snapshot_at: string | null
          production_snapshot_origin: string | null
          purge_waste_grams: number | null
          qc_minutes: number | null
          reprint_of: string | null
          sale_price: number | null
          secondary_actual_grams: number | null
          secondary_material_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          tenant_id: string
          updated_at: string
          waste_grams: number | null
        }
        Insert: {
          actual_energy_cost?: number | null
          actual_extras_cost?: number | null
          actual_grams?: number | null
          actual_labor_cost?: number | null
          actual_machine_cost?: number | null
          actual_material_cost?: number | null
          actual_material_usage?: Json | null
          actual_overhead?: number | null
          actual_time_minutes?: number | null
          actual_time_seconds?: number | null
          actual_total_cost?: number | null
          bambu_subtask_id?: string | null
          bambu_task_id?: string | null
          code: string
          completed_at?: string | null
          component_stock_key?: string | null
          created_at?: string
          created_by?: string | null
          creation_request_id?: string | null
          description?: string | null
          due_date?: string | null
          est_energy_cost?: number | null
          est_extras_cost?: number | null
          est_grams?: number | null
          est_labor_cost?: number | null
          est_machine_cost?: number | null
          est_material_cost?: number | null
          est_overhead?: number | null
          est_time_minutes?: number | null
          est_total_cost?: number | null
          failure_reason?: string | null
          id?: string
          inventory_posted_at?: string | null
          margin_percent?: number | null
          material_id?: string | null
          material_selection_snapshot?: Json | null
          name: string
          num_colors?: number
          order_id?: string | null
          order_item_id?: string | null
          order_unit_index?: number | null
          planned_quantity?: number
          post_minutes?: number | null
          prep_minutes?: number | null
          print_file_snapshot?: Json | null
          print_plate_id?: string | null
          printer_id?: string | null
          priority?: number
          produced_quantity?: number | null
          product_id?: string | null
          production_order_id?: string | null
          production_order_item_id?: string | null
          production_snapshot?: Json | null
          production_snapshot_at?: string | null
          production_snapshot_origin?: string | null
          purge_waste_grams?: number | null
          qc_minutes?: number | null
          reprint_of?: string | null
          sale_price?: number | null
          secondary_actual_grams?: number | null
          secondary_material_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id: string
          updated_at?: string
          waste_grams?: number | null
        }
        Update: {
          actual_energy_cost?: number | null
          actual_extras_cost?: number | null
          actual_grams?: number | null
          actual_labor_cost?: number | null
          actual_machine_cost?: number | null
          actual_material_cost?: number | null
          actual_material_usage?: Json | null
          actual_overhead?: number | null
          actual_time_minutes?: number | null
          actual_time_seconds?: number | null
          actual_total_cost?: number | null
          bambu_subtask_id?: string | null
          bambu_task_id?: string | null
          code?: string
          completed_at?: string | null
          component_stock_key?: string | null
          created_at?: string
          created_by?: string | null
          creation_request_id?: string | null
          description?: string | null
          due_date?: string | null
          est_energy_cost?: number | null
          est_extras_cost?: number | null
          est_grams?: number | null
          est_labor_cost?: number | null
          est_machine_cost?: number | null
          est_material_cost?: number | null
          est_overhead?: number | null
          est_time_minutes?: number | null
          est_total_cost?: number | null
          failure_reason?: string | null
          id?: string
          inventory_posted_at?: string | null
          margin_percent?: number | null
          material_id?: string | null
          material_selection_snapshot?: Json | null
          name?: string
          num_colors?: number
          order_id?: string | null
          order_item_id?: string | null
          order_unit_index?: number | null
          planned_quantity?: number
          post_minutes?: number | null
          prep_minutes?: number | null
          print_file_snapshot?: Json | null
          print_plate_id?: string | null
          printer_id?: string | null
          priority?: number
          produced_quantity?: number | null
          product_id?: string | null
          production_order_id?: string | null
          production_order_item_id?: string | null
          production_snapshot?: Json | null
          production_snapshot_at?: string | null
          production_snapshot_origin?: string | null
          purge_waste_grams?: number | null
          qc_minutes?: number | null
          reprint_of?: string | null
          sale_price?: number | null
          secondary_actual_grams?: number | null
          secondary_material_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id?: string
          updated_at?: string
          waste_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "jobs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_print_plate_id_fkey"
            columns: ["print_plate_id"]
            isOneToOne: false
            referencedRelation: "product_print_plates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_printer_id_fkey"
            columns: ["printer_id"]
            isOneToOne: false
            referencedRelation: "printers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_production_order_item_id_fkey"
            columns: ["production_order_item_id"]
            isOneToOne: false
            referencedRelation: "production_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_reprint_of_fkey"
            columns: ["reprint_of"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_secondary_material_id_fkey"
            columns: ["secondary_material_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      makerworld_import_requests: {
        Row: {
          completed_at: string | null
          design_id: string
          expires_at: string
          message: string | null
          payload: Json | null
          request_id: number
          requested_at: string
          requested_by: string
          source_url: string
          status: string
          tenant_id: string
        }
        Insert: {
          completed_at?: string | null
          design_id: string
          expires_at?: string
          message?: string | null
          payload?: Json | null
          request_id: number
          requested_at?: string
          requested_by: string
          source_url: string
          status?: string
          tenant_id: string
        }
        Update: {
          completed_at?: string | null
          design_id?: string
          expires_at?: string
          message?: string | null
          payload?: Json | null
          request_id?: number
          requested_at?: string
          requested_by?: string
          source_url?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "makerworld_import_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_accounts: {
        Row: {
          channel: string
          connection_state: string
          created_at: string
          external_seller_id: string | null
          id: string
          last_sync_at: string | null
          name: string
          sync_lock_id: string | null
          sync_locked_until: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          channel: string
          connection_state?: string
          created_at?: string
          external_seller_id?: string | null
          id?: string
          last_sync_at?: string | null
          name: string
          sync_lock_id?: string | null
          sync_locked_until?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          channel?: string
          connection_state?: string
          created_at?: string
          external_seller_id?: string | null
          id?: string
          last_sync_at?: string | null
          name?: string
          sync_lock_id?: string | null
          sync_locked_until?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_credentials: {
        Row: {
          access_token: string
          account_id: string
          expires_at: string
          refresh_token: string
          updated_at: string
        }
        Insert: {
          access_token: string
          account_id: string
          expires_at: string
          refresh_token: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          account_id?: string
          expires_at?: string
          refresh_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_credentials_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_credentials_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["account_id"]
          },
        ]
      }
      marketplace_events: {
        Row: {
          account_id: string
          attempts: number
          event_key: string
          id: string
          last_error: string | null
          payload: Json
          processed_at: string | null
          received_at: string
          status: string
          tenant_id: string
        }
        Insert: {
          account_id: string
          attempts?: number
          event_key: string
          id?: string
          last_error?: string | null
          payload: Json
          processed_at?: string | null
          received_at?: string
          status?: string
          tenant_id: string
        }
        Update: {
          account_id?: string
          attempts?: number
          event_key?: string
          id?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          received_at?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "marketplace_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_oauth_states: {
        Row: {
          account_id: string
          expires_at: string
          state: string
          user_id: string
        }
        Insert: {
          account_id: string
          expires_at?: string
          state?: string
          user_id: string
        }
        Update: {
          account_id?: string
          expires_at?: string
          state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_oauth_states_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_oauth_states_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["account_id"]
          },
        ]
      }
      marketplace_order_items: {
        Row: {
          description: string
          external_item_id: string
          external_line_id: string
          external_sku: string
          external_variant_id: string
          id: string
          marketplace_order_id: string
          product_id: string | null
          quantity: number
          tenant_id: string
          unit_price: number
        }
        Insert: {
          description: string
          external_item_id?: string
          external_line_id: string
          external_sku?: string
          external_variant_id?: string
          id?: string
          marketplace_order_id: string
          product_id?: string | null
          quantity: number
          tenant_id: string
          unit_price: number
        }
        Update: {
          description?: string
          external_item_id?: string
          external_line_id?: string
          external_sku?: string
          external_variant_id?: string
          id?: string
          marketplace_order_id?: string
          product_id?: string | null
          quantity?: number
          tenant_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_order_items_marketplace_order_id_fkey"
            columns: ["marketplace_order_id"]
            isOneToOne: false
            referencedRelation: "marketplace_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_order_items_marketplace_order_id_fkey"
            columns: ["marketplace_order_id"]
            isOneToOne: false
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["marketplace_order_id"]
          },
          {
            foreignKeyName: "marketplace_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_orders: {
        Row: {
          account_id: string
          canonical_payload: Json
          currency: string
          deadline_source: string
          discount_amount: number
          external_order_id: string
          external_pack_id: string
          external_shipment_id: string
          external_status: string
          external_updated_at: string
          id: string
          imported_at: string
          internal_order_id: string | null
          needs_review: boolean
          normalized_state: string
          reported_total: number | null
          review_reason: string | null
          seller_fees: number | null
          shipping_amount: number
          shipping_deadline_at: string | null
          tenant_id: string
          total: number
        }
        Insert: {
          account_id: string
          canonical_payload: Json
          currency?: string
          deadline_source?: string
          discount_amount?: number
          external_order_id: string
          external_pack_id?: string
          external_shipment_id?: string
          external_status: string
          external_updated_at: string
          id?: string
          imported_at?: string
          internal_order_id?: string | null
          needs_review?: boolean
          normalized_state: string
          reported_total?: number | null
          review_reason?: string | null
          seller_fees?: number | null
          shipping_amount?: number
          shipping_deadline_at?: string | null
          tenant_id: string
          total: number
        }
        Update: {
          account_id?: string
          canonical_payload?: Json
          currency?: string
          deadline_source?: string
          discount_amount?: number
          external_order_id?: string
          external_pack_id?: string
          external_shipment_id?: string
          external_status?: string
          external_updated_at?: string
          id?: string
          imported_at?: string
          internal_order_id?: string | null
          needs_review?: boolean
          normalized_state?: string
          reported_total?: number | null
          review_reason?: string | null
          seller_fees?: number | null
          shipping_amount?: number
          shipping_deadline_at?: string | null
          tenant_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "marketplace_orders_internal_order_id_fkey"
            columns: ["internal_order_id"]
            isOneToOne: true
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "marketplace_orders_internal_order_id_fkey"
            columns: ["internal_order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_settlement_components: {
        Row: {
          amount_signed: number
          competence_date: string
          expense_source_settlement_id: string | null
          id: string
          kind: string
          payable_id: string | null
          settlement_id: string
          tenant_id: string
        }
        Insert: {
          amount_signed: number
          competence_date: string
          expense_source_settlement_id?: string | null
          id?: string
          kind: string
          payable_id?: string | null
          settlement_id: string
          tenant_id: string
        }
        Update: {
          amount_signed?: number
          competence_date?: string
          expense_source_settlement_id?: string | null
          id?: string
          kind?: string
          payable_id?: string | null
          settlement_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_settlement_compon_expense_source_settlement_id_fkey"
            columns: ["expense_source_settlement_id"]
            isOneToOne: false
            referencedRelation: "marketplace_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_settlement_components_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: true
            referencedRelation: "accounts_payable"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_settlement_components_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "marketplace_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_settlement_components_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_settlements: {
        Row: {
          account_id: string
          bank_account_id: string | null
          bank_transaction_id: string | null
          competence_date: string
          created_at: string
          created_by: string
          external_reference: string
          fee_credit: number
          fees: number
          freight: number
          freight_credit: number
          gross_amount: number
          id: string
          kind: string
          liquidated_gross: number
          marketplace_order_id: string
          net_amount: number
          notes: string
          order_id: string
          other_credit: number
          other_debit: number
          receivable_id: string
          related_settlement_id: string | null
          request_payload: Json
          retained_amount: number
          tenant_id: string
          transaction_date: string
        }
        Insert: {
          account_id: string
          bank_account_id?: string | null
          bank_transaction_id?: string | null
          competence_date: string
          created_at?: string
          created_by: string
          external_reference: string
          fee_credit?: number
          fees?: number
          freight?: number
          freight_credit?: number
          gross_amount: number
          id?: string
          kind: string
          liquidated_gross: number
          marketplace_order_id: string
          net_amount: number
          notes?: string
          order_id: string
          other_credit?: number
          other_debit?: number
          receivable_id: string
          related_settlement_id?: string | null
          request_payload: Json
          retained_amount?: number
          tenant_id: string
          transaction_date: string
        }
        Update: {
          account_id?: string
          bank_account_id?: string | null
          bank_transaction_id?: string | null
          competence_date?: string
          created_at?: string
          created_by?: string
          external_reference?: string
          fee_credit?: number
          fees?: number
          freight?: number
          freight_credit?: number
          gross_amount?: number
          id?: string
          kind?: string
          liquidated_gross?: number
          marketplace_order_id?: string
          net_amount?: number
          notes?: string
          order_id?: string
          other_credit?: number
          other_debit?: number
          receivable_id?: string
          related_settlement_id?: string | null
          request_payload?: Json
          retained_amount?: number
          tenant_id?: string
          transaction_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_settlements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_settlements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "marketplace_settlements_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_settlements_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: true
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_settlements_marketplace_order_id_fkey"
            columns: ["marketplace_order_id"]
            isOneToOne: false
            referencedRelation: "marketplace_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_settlements_marketplace_order_id_fkey"
            columns: ["marketplace_order_id"]
            isOneToOne: false
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["marketplace_order_id"]
          },
          {
            foreignKeyName: "marketplace_settlements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "marketplace_settlements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_settlements_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "accounts_receivable"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_settlements_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["receivable_id"]
          },
          {
            foreignKeyName: "marketplace_settlements_related_settlement_id_fkey"
            columns: ["related_settlement_id"]
            isOneToOne: false
            referencedRelation: "marketplace_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_settlements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_sku_bindings: {
        Row: {
          account_id: string
          created_at: string
          external_item_id: string
          external_sku: string
          external_variant_id: string
          id: string
          product_id: string
          requires_manual_review: boolean
          tenant_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          external_item_id?: string
          external_sku?: string
          external_variant_id?: string
          id?: string
          product_id: string
          requires_manual_review?: boolean
          tenant_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          external_item_id?: string
          external_sku?: string
          external_variant_id?: string
          id?: string
          product_id?: string
          requires_manual_review?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_sku_bindings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_sku_bindings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "marketplace_sku_bindings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_sku_bindings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_workflow_policies: {
        Row: {
          account_id: string
          auto_organize: boolean
          default_customer_id: string | null
          receivable_due_days: number
          safety_buffer_hours: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          auto_organize?: boolean
          default_customer_id?: string | null
          receivable_due_days?: number
          safety_buffer_hours?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          auto_organize?: boolean
          default_customer_id?: string | null
          receivable_due_days?: number
          safety_buffer_hours?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_workflow_policies_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_workflow_policies_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "marketplace_workflow_policies_default_customer_id_fkey"
            columns: ["default_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_workflow_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      material_code_catalog: {
        Row: {
          code: string
          label: string
        }
        Insert: {
          code: string
          label: string
        }
        Update: {
          code?: string
          label?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          description: string
          id: string
          material_overrides: Json
          notes: string | null
          order_id: string
          product_id: string | null
          product_snapshot: Json | null
          quantity: number
          quoted_estimated_cost: number | null
          source_quote_item_id: string | null
          tenant_id: string
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          material_overrides?: Json
          notes?: string | null
          order_id: string
          product_id?: string | null
          product_snapshot?: Json | null
          quantity?: number
          quoted_estimated_cost?: number | null
          source_quote_item_id?: string | null
          tenant_id: string
          total?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          material_overrides?: Json
          notes?: string | null
          order_id?: string
          product_id?: string | null
          product_snapshot?: Json | null
          quantity?: number
          quoted_estimated_cost?: number | null
          source_quote_item_id?: string | null
          tenant_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_source_quote_item_id_fkey"
            columns: ["source_quote_item_id"]
            isOneToOne: true
            referencedRelation: "sales_quote_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_stock_allocations: {
        Row: {
          id: string
          item_id: string
          order_id: string
          order_item_id: string | null
          posted_at: string
          product_id: string
          quantity: number
          reversed_at: string | null
          sales_amount: number | null
          tenant_id: string
          total_cost: number
          unit_cost: number
        }
        Insert: {
          id?: string
          item_id: string
          order_id: string
          order_item_id?: string | null
          posted_at?: string
          product_id: string
          quantity: number
          reversed_at?: string | null
          sales_amount?: number | null
          tenant_id: string
          total_cost: number
          unit_cost: number
        }
        Update: {
          id?: string
          item_id?: string
          order_id?: string
          order_item_id?: string | null
          posted_at?: string
          product_id?: string
          quantity?: number
          reversed_at?: string | null
          sales_amount?: number | null
          tenant_id?: string
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_stock_allocations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_stock_allocations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_stock_allocations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_stock_allocations_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_stock_allocations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_stock_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          approved_at: string | null
          code: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          discount: number | null
          due_date: string | null
          id: string
          internal_due_at: string | null
          marketplace_order_id: string | null
          notes: string | null
          payment_due_date: string | null
          payment_schedule: Json
          requires_material_recipe: boolean
          ship_by_at: string | null
          shipping: number
          source_quote_id: string | null
          status: string
          tenant_id: string
          total: number
          updated_at: string
          workflow_checked_at: string | null
          workflow_issues: Json
        }
        Insert: {
          approved_at?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount?: number | null
          due_date?: string | null
          id?: string
          internal_due_at?: string | null
          marketplace_order_id?: string | null
          notes?: string | null
          payment_due_date?: string | null
          payment_schedule?: Json
          requires_material_recipe?: boolean
          ship_by_at?: string | null
          shipping?: number
          source_quote_id?: string | null
          status?: string
          tenant_id: string
          total?: number
          updated_at?: string
          workflow_checked_at?: string | null
          workflow_issues?: Json
        }
        Update: {
          approved_at?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount?: number | null
          due_date?: string | null
          id?: string
          internal_due_at?: string | null
          marketplace_order_id?: string | null
          notes?: string | null
          payment_due_date?: string | null
          payment_schedule?: Json
          requires_material_recipe?: boolean
          ship_by_at?: string | null
          shipping?: number
          source_quote_id?: string | null
          status?: string
          tenant_id?: string
          total?: number
          updated_at?: string
          workflow_checked_at?: string | null
          workflow_issues?: Json
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_marketplace_order_id_fkey"
            columns: ["marketplace_order_id"]
            isOneToOne: true
            referencedRelation: "marketplace_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_marketplace_order_id_fkey"
            columns: ["marketplace_order_id"]
            isOneToOne: true
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["marketplace_order_id"]
          },
          {
            foreignKeyName: "orders_source_quote_id_fkey"
            columns: ["source_quote_id"]
            isOneToOne: true
            referencedRelation: "sales_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          type?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      printers: {
        Row: {
          acquisition_cost: number | null
          bambu_access_code: string | null
          bambu_device_id: string | null
          brand: string
          created_at: string
          depreciation_per_hour: number | null
          firmware_version: string | null
          id: string
          ip_address: string | null
          is_active: boolean
          maintenance_cost_per_hour: number | null
          model: string
          name: string
          notes: string | null
          power_watts: number | null
          serial_number: string | null
          status: Database["public"]["Enums"]["printer_status"]
          tenant_id: string
          total_failures: number | null
          total_print_hours: number | null
          total_prints: number | null
          updated_at: string
          useful_life_hours: number | null
        }
        Insert: {
          acquisition_cost?: number | null
          bambu_access_code?: string | null
          bambu_device_id?: string | null
          brand?: string
          created_at?: string
          depreciation_per_hour?: number | null
          firmware_version?: string | null
          id?: string
          ip_address?: string | null
          is_active?: boolean
          maintenance_cost_per_hour?: number | null
          model: string
          name: string
          notes?: string | null
          power_watts?: number | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["printer_status"]
          tenant_id: string
          total_failures?: number | null
          total_print_hours?: number | null
          total_prints?: number | null
          updated_at?: string
          useful_life_hours?: number | null
        }
        Update: {
          acquisition_cost?: number | null
          bambu_access_code?: string | null
          bambu_device_id?: string | null
          brand?: string
          created_at?: string
          depreciation_per_hour?: number | null
          firmware_version?: string | null
          id?: string
          ip_address?: string | null
          is_active?: boolean
          maintenance_cost_per_hour?: number | null
          model?: string
          name?: string
          notes?: string | null
          power_watts?: number | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["printer_status"]
          tenant_id?: string
          total_failures?: number | null
          total_print_hours?: number | null
          total_prints?: number | null
          updated_at?: string
          useful_life_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "printers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_assemblies: {
        Row: {
          component_cost: number
          created_at: string
          created_by: string | null
          finishing_cost: number
          id: string
          item_id: string | null
          notes: string | null
          product_id: string
          quantity: number
          tenant_id: string
        }
        Insert: {
          component_cost?: number
          created_at?: string
          created_by?: string | null
          finishing_cost?: number
          id?: string
          item_id?: string | null
          notes?: string | null
          product_id: string
          quantity: number
          tenant_id: string
        }
        Update: {
          component_cost?: number
          created_at?: string
          created_by?: string | null
          finishing_cost?: number
          id?: string
          item_id?: string | null
          notes?: string | null
          product_id?: string
          quantity?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_assemblies_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "production_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_assemblies_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_assemblies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_material_recipe_lines: {
        Row: {
          grams: number
          id: string
          item_id: string
          item_snapshot: Json
          recipe_version_id: string
          tenant_id: string
        }
        Insert: {
          grams: number
          id?: string
          item_id: string
          item_snapshot: Json
          recipe_version_id: string
          tenant_id: string
        }
        Update: {
          grams?: number
          id?: string
          item_id?: string
          item_snapshot?: Json
          recipe_version_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_material_recipe_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_material_recipe_lines_recipe_version_id_fkey"
            columns: ["recipe_version_id"]
            isOneToOne: false
            referencedRelation: "product_material_recipe_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_material_recipe_lines_recipe_version_id_fkey"
            columns: ["recipe_version_id"]
            isOneToOne: false
            referencedRelation: "product_material_requirements"
            referencedColumns: ["recipe_version_id"]
          },
          {
            foreignKeyName: "product_material_recipe_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_material_recipe_versions: {
        Row: {
          basis: string
          created_at: string
          created_by: string
          id: string
          is_current: boolean
          non_material_cost_per_unit: number | null
          notes: string | null
          plate_id: string | null
          product_id: string
          tenant_id: string
          units_per_print: number
          version: number
        }
        Insert: {
          basis: string
          created_at?: string
          created_by: string
          id?: string
          is_current?: boolean
          non_material_cost_per_unit?: number | null
          notes?: string | null
          plate_id?: string | null
          product_id: string
          tenant_id: string
          units_per_print: number
          version: number
        }
        Update: {
          basis?: string
          created_at?: string
          created_by?: string
          id?: string
          is_current?: boolean
          non_material_cost_per_unit?: number | null
          notes?: string | null
          plate_id?: string | null
          product_id?: string
          tenant_id?: string
          units_per_print?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_material_recipe_versions_plate_id_fkey"
            columns: ["plate_id"]
            isOneToOne: false
            referencedRelation: "product_print_plates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_material_recipe_versions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_material_recipe_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_photos: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          product_id: string
          sort_order: number | null
          tenant_id: string
          url: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          product_id: string
          sort_order?: number | null
          tenant_id: string
          url: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          product_id?: string
          sort_order?: number | null
          tenant_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_photos_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_piece_specs: {
        Row: {
          product_id: string
          spec: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          product_id: string
          spec: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          product_id?: string
          spec?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_piece_specs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_piece_specs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_print_plate_parts: {
        Row: {
          created_at: string
          id: string
          name: string
          name_source: string
          photo_url: string | null
          plate_id: string
          product_id: string
          quantity_per_plate: number | null
          quantity_per_product: number | null
          source_key: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          name_source: string
          photo_url?: string | null
          plate_id: string
          product_id: string
          quantity_per_plate?: number | null
          quantity_per_product?: number | null
          source_key: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          name_source?: string
          photo_url?: string | null
          plate_id?: string
          product_id?: string
          quantity_per_plate?: number | null
          quantity_per_product?: number | null
          source_key?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_print_plate_parts_plate_id_fkey"
            columns: ["plate_id"]
            isOneToOne: false
            referencedRelation: "product_print_plates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_print_plate_parts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_print_plate_parts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_print_plates: {
        Row: {
          actual_cost_per_unit: number | null
          actual_grams_per_unit: number | null
          actual_sample_units: number | null
          actual_seconds_per_unit: number | null
          actual_source: string | null
          actual_updated_at: string | null
          created_at: string
          est_cost_per_unit: number | null
          est_grams: number | null
          est_time_seconds: number | null
          id: string
          imported_filaments: Json
          imported_plate_metadata: Json | null
          is_active: boolean
          label: string
          material_id: string | null
          model_id: string | null
          plate_index: number
          printer_id: string | null
          product_id: string
          profile_id: string | null
          source_id: string | null
          tenant_id: string
          units_per_plate: number | null
          updated_at: string
        }
        Insert: {
          actual_cost_per_unit?: number | null
          actual_grams_per_unit?: number | null
          actual_sample_units?: number | null
          actual_seconds_per_unit?: number | null
          actual_source?: string | null
          actual_updated_at?: string | null
          created_at?: string
          est_cost_per_unit?: number | null
          est_grams?: number | null
          est_time_seconds?: number | null
          id?: string
          imported_filaments?: Json
          imported_plate_metadata?: Json | null
          is_active?: boolean
          label: string
          material_id?: string | null
          model_id?: string | null
          plate_index: number
          printer_id?: string | null
          product_id: string
          profile_id?: string | null
          source_id?: string | null
          tenant_id: string
          units_per_plate?: number | null
          updated_at?: string
        }
        Update: {
          actual_cost_per_unit?: number | null
          actual_grams_per_unit?: number | null
          actual_sample_units?: number | null
          actual_seconds_per_unit?: number | null
          actual_source?: string | null
          actual_updated_at?: string | null
          created_at?: string
          est_cost_per_unit?: number | null
          est_grams?: number | null
          est_time_seconds?: number | null
          id?: string
          imported_filaments?: Json
          imported_plate_metadata?: Json | null
          is_active?: boolean
          label?: string
          material_id?: string | null
          model_id?: string | null
          plate_index?: number
          printer_id?: string | null
          product_id?: string
          profile_id?: string | null
          source_id?: string | null
          tenant_id?: string
          units_per_plate?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_print_plates_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_print_plates_printer_id_fkey"
            columns: ["printer_id"]
            isOneToOne: false
            referencedRelation: "printers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_print_plates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_print_plates_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "product_print_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_print_plates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_print_source_imports: {
        Row: {
          reference: Json
          source_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          reference: Json
          source_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          reference?: Json
          source_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_print_source_imports_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: true
            referencedRelation: "product_print_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_print_source_imports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_print_sources: {
        Row: {
          created_at: string
          design_id: string | null
          file_name: string | null
          file_path: string | null
          file_sha256: string | null
          id: string
          instance_id: string | null
          is_active: boolean
          label: string
          model_id: string | null
          plate_index: number | null
          product_id: string
          profile_id: string | null
          source_url: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          design_id?: string | null
          file_name?: string | null
          file_path?: string | null
          file_sha256?: string | null
          id?: string
          instance_id?: string | null
          is_active?: boolean
          label?: string
          model_id?: string | null
          plate_index?: number | null
          product_id: string
          profile_id?: string | null
          source_url?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          design_id?: string | null
          file_name?: string | null
          file_path?: string | null
          file_sha256?: string | null
          id?: string
          instance_id?: string | null
          is_active?: boolean
          label?: string
          model_id?: string | null
          plate_index?: number | null
          product_id?: string
          profile_id?: string | null
          source_url?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_print_sources_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_print_sources_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_subitems: {
        Row: {
          component_product_id: string
          created_at: string
          id: string
          plate_id: string | null
          product_id: string
          quantity_per_plate: number | null
          quantity_per_product: number | null
          sort_order: number
          source_part_id: string | null
          tenant_id: string
        }
        Insert: {
          component_product_id: string
          created_at?: string
          id?: string
          plate_id?: string | null
          product_id: string
          quantity_per_plate?: number | null
          quantity_per_product?: number | null
          sort_order?: never
          source_part_id?: string | null
          tenant_id: string
        }
        Update: {
          component_product_id?: string
          created_at?: string
          id?: string
          plate_id?: string | null
          product_id?: string
          quantity_per_plate?: number | null
          quantity_per_product?: number | null
          sort_order?: never
          source_part_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_subitems_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_subitems_plate_id_fkey"
            columns: ["plate_id"]
            isOneToOne: false
            referencedRelation: "product_print_plates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_subitems_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_subitems_source_part_id_fkey"
            columns: ["source_part_id"]
            isOneToOne: true
            referencedRelation: "product_print_plate_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_subitems_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      production_component_demands: {
        Row: {
          assembled: number
          created_at: string
          id: string
          item_id: string
          material_key: string
          plate_id: string
          quantity: number
          reservation_sequence: number
          tenant_id: string
        }
        Insert: {
          assembled?: number
          created_at?: string
          id?: string
          item_id: string
          material_key: string
          plate_id: string
          quantity: number
          reservation_sequence?: never
          tenant_id: string
        }
        Update: {
          assembled?: number
          created_at?: string
          id?: string
          item_id?: string
          material_key?: string
          plate_id?: string
          quantity?: number
          reservation_sequence?: never
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_component_demands_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "production_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_component_demands_plate_id_fkey"
            columns: ["plate_id"]
            isOneToOne: false
            referencedRelation: "product_print_plates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_component_demands_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      production_order_items: {
        Row: {
          assembled_quantity: number
          assembly_required: boolean
          commercial_snapshot: Json | null
          description: string
          id: string
          line_index: number
          material_overrides: Json
          product_id: string
          production_order_id: string
          production_snapshot: Json | null
          quantity: number
          received_quantity: number
          source_order_item_id: string | null
          source_quote_item_id: string | null
          tenant_id: string
        }
        Insert: {
          assembled_quantity?: number
          assembly_required?: boolean
          commercial_snapshot?: Json | null
          description: string
          id?: string
          line_index: number
          material_overrides?: Json
          product_id: string
          production_order_id: string
          production_snapshot?: Json | null
          quantity: number
          received_quantity?: number
          source_order_item_id?: string | null
          source_quote_item_id?: string | null
          tenant_id: string
        }
        Update: {
          assembled_quantity?: number
          assembly_required?: boolean
          commercial_snapshot?: Json | null
          description?: string
          id?: string
          line_index?: number
          material_overrides?: Json
          product_id?: string
          production_order_id?: string
          production_snapshot?: Json | null
          quantity?: number
          received_quantity?: number
          source_order_item_id?: string | null
          source_quote_item_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_order_items_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_order_items_source_order_item_id_fkey"
            columns: ["source_order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_order_items_source_quote_item_id_fkey"
            columns: ["source_quote_item_id"]
            isOneToOne: false
            referencedRelation: "sales_quote_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      production_orders: {
        Row: {
          code: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          due_date: string | null
          id: string
          notes: string | null
          released_at: string | null
          source_order_id: string | null
          source_quote_id: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          code: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          released_at?: string | null
          source_order_id?: string | null
          source_quote_id?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          code?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          released_at?: string | null
          source_order_id?: string | null
          source_quote_id?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: true
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "production_orders_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_source_quote_id_fkey"
            columns: ["source_quote_id"]
            isOneToOne: true
            referencedRelation: "sales_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      production_subitem_demands: {
        Row: {
          component_product_id: string
          consumed: number
          id: string
          item_id: string
          quantity: number
          reservation_sequence: number
          tenant_id: string
        }
        Insert: {
          component_product_id: string
          consumed?: number
          id?: string
          item_id: string
          quantity: number
          reservation_sequence?: never
          tenant_id: string
        }
        Update: {
          component_product_id?: string
          consumed?: number
          id?: string
          item_id?: string
          quantity?: number
          reservation_sequence?: never
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_subitem_demands_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_subitem_demands_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "production_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_subitem_demands_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          actual_print_cost_per_unit: number | null
          actual_print_grams_per_unit: number | null
          actual_print_sample_units: number | null
          actual_print_seconds_per_unit: number | null
          actual_print_source: string | null
          actual_print_updated_at: string | null
          assembly_enabled: boolean
          catalog_details: Json
          category: string
          component_inventory_mode: boolean
          cost_estimate: number | null
          created_at: string
          description: string | null
          est_grams: number | null
          est_time_minutes: number | null
          external_import: Json | null
          extras: Json
          id: string
          is_active: boolean
          is_component: boolean
          manual_cost_override: number | null
          margin_percent: number | null
          material_id: string | null
          name: string
          notes: string | null
          num_colors: number
          photo_url: string | null
          post_process_minutes: number | null
          prints_per_plate: number
          sale_price: number | null
          sku: string | null
          stock_item_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          actual_print_cost_per_unit?: number | null
          actual_print_grams_per_unit?: number | null
          actual_print_sample_units?: number | null
          actual_print_seconds_per_unit?: number | null
          actual_print_source?: string | null
          actual_print_updated_at?: string | null
          assembly_enabled?: boolean
          catalog_details?: Json
          category?: string
          component_inventory_mode?: boolean
          cost_estimate?: number | null
          created_at?: string
          description?: string | null
          est_grams?: number | null
          est_time_minutes?: number | null
          external_import?: Json | null
          extras?: Json
          id?: string
          is_active?: boolean
          is_component?: boolean
          manual_cost_override?: number | null
          margin_percent?: number | null
          material_id?: string | null
          name: string
          notes?: string | null
          num_colors?: number
          photo_url?: string | null
          post_process_minutes?: number | null
          prints_per_plate?: number
          sale_price?: number | null
          sku?: string | null
          stock_item_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          actual_print_cost_per_unit?: number | null
          actual_print_grams_per_unit?: number | null
          actual_print_sample_units?: number | null
          actual_print_seconds_per_unit?: number | null
          actual_print_source?: string | null
          actual_print_updated_at?: string | null
          assembly_enabled?: boolean
          catalog_details?: Json
          category?: string
          component_inventory_mode?: boolean
          cost_estimate?: number | null
          created_at?: string
          description?: string | null
          est_grams?: number | null
          est_time_minutes?: number | null
          external_import?: Json | null
          extras?: Json
          id?: string
          is_active?: boolean
          is_component?: boolean
          manual_cost_override?: number | null
          margin_percent?: number | null
          material_id?: string | null
          name?: string
          notes?: string | null
          num_colors?: number
          photo_url?: string | null
          post_process_minutes?: number | null
          prints_per_plate?: number
          sale_price?: number | null
          sku?: string | null
          stock_item_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: true
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          email: string | null
          id: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          email?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          cfop: string | null
          created_at: string
          description: string
          id: string
          inventory_item_id: string | null
          ncm: string | null
          notes: string | null
          purchase_order_id: string
          quantity: number
          stock_quantity: number | null
          tenant_id: string
          total: number
          unit_price: number
        }
        Insert: {
          cfop?: string | null
          created_at?: string
          description: string
          id?: string
          inventory_item_id?: string | null
          ncm?: string | null
          notes?: string | null
          purchase_order_id: string
          quantity?: number
          stock_quantity?: number | null
          tenant_id: string
          total?: number
          unit_price?: number
        }
        Update: {
          cfop?: string | null
          created_at?: string
          description?: string
          id?: string
          inventory_item_id?: string | null
          ncm?: string | null
          notes?: string | null
          purchase_order_id?: string
          quantity?: number
          stock_quantity?: number | null
          tenant_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          additional_costs: number
          code: string
          created_at: string
          created_by: string | null
          discount: number
          expected_date: string | null
          id: string
          nfe_key: string | null
          nfe_number: string | null
          nfe_xml: string | null
          notes: string | null
          order_date: string
          received_date: string | null
          shipping: number
          status: string
          subtotal: number
          tenant_id: string
          total: number
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          additional_costs?: number
          code: string
          created_at?: string
          created_by?: string | null
          discount?: number
          expected_date?: string | null
          id?: string
          nfe_key?: string | null
          nfe_number?: string | null
          nfe_xml?: string | null
          notes?: string | null
          order_date?: string
          received_date?: string | null
          shipping?: number
          status?: string
          subtotal?: number
          tenant_id: string
          total?: number
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          additional_costs?: number
          code?: string
          created_at?: string
          created_by?: string | null
          discount?: number
          expected_date?: string | null
          id?: string
          nfe_key?: string | null
          nfe_number?: string | null
          nfe_xml?: string | null
          notes?: string | null
          order_date?: string
          received_date?: string | null
          shipping?: number
          status?: string
          subtotal?: number
          tenant_id?: string
          total?: number
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_quote_items: {
        Row: {
          description: string
          estimated_total_cost: number | null
          estimated_unit_cost: number | null
          id: string
          line_index: number
          material_overrides: Json
          notes: string | null
          product_id: string
          product_snapshot: Json
          quantity: number
          quote_id: string
          tenant_id: string
          total: number | null
          unit_price: number | null
        }
        Insert: {
          description: string
          estimated_total_cost?: number | null
          estimated_unit_cost?: number | null
          id?: string
          line_index: number
          material_overrides?: Json
          notes?: string | null
          product_id: string
          product_snapshot: Json
          quantity: number
          quote_id: string
          tenant_id: string
          total?: number | null
          unit_price?: number | null
        }
        Update: {
          description?: string
          estimated_total_cost?: number | null
          estimated_unit_cost?: number | null
          id?: string
          line_index?: number
          material_overrides?: Json
          notes?: string | null
          product_id?: string
          product_snapshot?: Json
          quantity?: number
          quote_id?: string
          tenant_id?: string
          total?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_quote_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "sales_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quote_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_quotes: {
        Row: {
          approved_at: string | null
          code: string
          converted_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_snapshot: Json | null
          discount: number
          due_date: string | null
          id: string
          issued_at: string | null
          notes: string | null
          order_id: string | null
          payment_due_date: string | null
          payment_schedule: Json
          rejected_at: string | null
          rejection_reason: string | null
          revision: number
          shipping: number
          status: string
          subtotal: number | null
          tenant_id: string
          total: number | null
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          approved_at?: string | null
          code: string
          converted_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_snapshot?: Json | null
          discount?: number
          due_date?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
          order_id?: string | null
          payment_due_date?: string | null
          payment_schedule?: Json
          rejected_at?: string | null
          rejection_reason?: string | null
          revision?: number
          shipping?: number
          status?: string
          subtotal?: number | null
          tenant_id: string
          total?: number | null
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          approved_at?: string | null
          code?: string
          converted_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_snapshot?: Json | null
          discount?: number
          due_date?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
          order_id?: string | null
          payment_due_date?: string | null
          payment_schedule?: Json
          rejected_at?: string | null
          rejection_reason?: string | null
          revision?: number
          shipping?: number
          status?: string
          subtotal?: number | null
          tenant_id?: string
          total?: number | null
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "sales_quotes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quotes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      storefront_channels: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          shipping_fee: number | null
          shipping_states: string[]
          slug: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          shipping_fee?: number | null
          shipping_states?: string[]
          slug: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          shipping_fee?: number | null
          shipping_states?: string[]
          slug?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "storefront_channels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      storefront_customers: {
        Row: {
          channel_id: string
          contact_key: string
          customer_id: string
          tenant_id: string
        }
        Insert: {
          channel_id: string
          contact_key: string
          customer_id: string
          tenant_id: string
        }
        Update: {
          channel_id?: string
          contact_key?: string
          customer_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "storefront_customers_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "storefront_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storefront_customers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storefront_customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      storefront_listings: {
        Row: {
          category: string
          channel_id: string
          id: string
          lead_days: number
          made_to_order: boolean
          price_override: number | null
          product_id: string
          published: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          category?: string
          channel_id: string
          id?: string
          lead_days?: number
          made_to_order?: boolean
          price_override?: number | null
          product_id: string
          published?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          channel_id?: string
          id?: string
          lead_days?: number
          made_to_order?: boolean
          price_override?: number | null
          product_id?: string
          published?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "storefront_listings_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "storefront_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storefront_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storefront_listings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      storefront_payment_credentials: {
        Row: {
          access_token: string
          channel_id: string
          collector_id: string | null
          mode: string
          updated_at: string
          verified_at: string | null
          webhook_secret: string
        }
        Insert: {
          access_token: string
          channel_id: string
          collector_id?: string | null
          mode: string
          updated_at?: string
          verified_at?: string | null
          webhook_secret: string
        }
        Update: {
          access_token?: string
          channel_id?: string
          collector_id?: string | null
          mode?: string
          updated_at?: string
          verified_at?: string | null
          webhook_secret?: string
        }
        Relationships: [
          {
            foreignKeyName: "storefront_payment_credentials_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: true
            referencedRelation: "storefront_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      storefront_payments: {
        Row: {
          amount: number
          money_release_at: string | null
          net_received: number | null
          payment_id: string
          provider_updated_at: string
          refunded_amount: number
          request_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          money_release_at?: string | null
          net_received?: number | null
          payment_id: string
          provider_updated_at: string
          refunded_amount?: number
          request_id: string
          status: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          money_release_at?: string | null
          net_received?: number | null
          payment_id?: string
          provider_updated_at?: string
          refunded_amount?: number
          request_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "storefront_payments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "storefront_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storefront_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      storefront_requests: {
        Row: {
          channel_id: string
          checkout_expires_at: string | null
          checkout_lock: string | null
          checkout_locked_until: string | null
          checkout_url: string | null
          contact_key: string
          created_at: string
          id: string
          order_id: string
          payload: Json
          payment_checked_at: string | null
          payment_review: string | null
          payment_reviewed_fingerprint: string | null
          payment_status: string
          preference_attempted_at: string | null
          preference_id: string | null
          request_id: string
          tenant_id: string
        }
        Insert: {
          channel_id: string
          checkout_expires_at?: string | null
          checkout_lock?: string | null
          checkout_locked_until?: string | null
          checkout_url?: string | null
          contact_key: string
          created_at?: string
          id?: string
          order_id: string
          payload: Json
          payment_checked_at?: string | null
          payment_review?: string | null
          payment_reviewed_fingerprint?: string | null
          payment_status?: string
          preference_attempted_at?: string | null
          preference_id?: string | null
          request_id: string
          tenant_id: string
        }
        Update: {
          channel_id?: string
          checkout_expires_at?: string | null
          checkout_lock?: string | null
          checkout_locked_until?: string | null
          checkout_url?: string | null
          contact_key?: string
          created_at?: string
          id?: string
          order_id?: string
          payload?: Json
          payment_checked_at?: string | null
          payment_review?: string | null
          payment_reviewed_fingerprint?: string | null
          payment_status?: string
          preference_attempted_at?: string | null
          preference_id?: string | null
          request_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "storefront_requests_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "storefront_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storefront_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "marketplace_receivable_positions"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "storefront_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storefront_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          currency: string
          id: string
          logo_url: string | null
          name: string
          settings: Json
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          logo_url?: string | null
          name: string
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          logo_url?: string | null
          name?: string
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: Json | null
          created_at: string
          document: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          registration_details: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: Json | null
          created_at?: string
          document?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          registration_details?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: Json | null
          created_at?: string
          document?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          registration_details?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      bambu_production_review: {
        Row: {
          auto_enabled: boolean | null
          bambu_task_id: string | null
          completed_units: number | null
          consumption_source: string | null
          design_title: string | null
          device_name: string | null
          elapsed_seconds: number | null
          ended_at: string | null
          outcome: string | null
          planned_grams: number | null
          plate_id: string | null
          plate_index: number | null
          plate_label: string | null
          posted_at: string | null
          problem: string | null
          product_id: string | null
          product_name: string | null
          quality_loss_cost: number | null
          quality_loss_grams: number | null
          quality_rejected_units: number | null
          quality_state: string | null
          raw_status: string | null
          started_at: string | null
          state: string | null
          task_id: string | null
          tenant_id: string | null
          total_cost: number | null
          units: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bambu_production_records_plate_id_fkey"
            columns: ["plate_id"]
            isOneToOne: false
            referencedRelation: "product_print_plates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_production_records_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bambu_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      filament_active_reservations: {
        Row: {
          created_at: string | null
          created_by: string | null
          grams: number | null
          id: string | null
          item_id: string | null
          job_id: string | null
          reason: string | null
          released_at: string | null
          spool_id: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "filament_reservations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filament_reservations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filament_reservations_spool_id_fkey"
            columns: ["spool_id"]
            isOneToOne: false
            referencedRelation: "filament_spools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filament_reservations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_receivable_positions: {
        Row: {
          account_id: string | null
          account_name: string | null
          available_gross: number | null
          cancelled_gross: number | null
          channel: string | null
          description: string | null
          due_date: string | null
          external_order_id: string | null
          fee_credit: number | null
          fees: number | null
          freight: number | null
          freight_credit: number | null
          gross_sale_amount: number | null
          gross_title_amount: number | null
          liquidated_gross: number | null
          marketplace_order_id: string | null
          net_bank: number | null
          order_code: string | null
          order_id: string | null
          other_credit: number | null
          other_debit: number | null
          outstanding_gross: number | null
          receivable_id: string | null
          refunded_gross: number | null
          retained_open: number | null
          status: Database["public"]["Enums"]["receivable_status"] | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_receivable_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_material_requirements: {
        Row: {
          basis: string | null
          color: string | null
          color_code: string | null
          color_hex: string | null
          cost_known: boolean | null
          cost_per_print: number | null
          cost_per_unit: number | null
          current_stock: number | null
          grams: number | null
          grams_per_print: number | null
          grams_per_unit: number | null
          item_id: string | null
          line_id: string | null
          material_code: string | null
          material_description: string | null
          material_ready: boolean | null
          material_type: string | null
          name: string | null
          non_material_cost_per_unit: number | null
          plate_id: string | null
          product_id: string | null
          recipe_version: number | null
          recipe_version_id: string | null
          tenant_id: string | null
          unit: string | null
          unit_cost: number | null
          units_per_print: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_material_code_fkey"
            columns: ["material_code"]
            isOneToOne: false
            referencedRelation: "material_code_catalog"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "product_material_recipe_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_material_recipe_versions_plate_id_fkey"
            columns: ["plate_id"]
            isOneToOne: false
            referencedRelation: "product_print_plates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_material_recipe_versions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_material_recipe_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      account_bambu_production: {
        Args: {
          p_extras_cost: number
          p_labor_cost: number
          p_materials: Json
          p_overhead: number
          p_reason: string
          p_request_id: string
          p_seconds: number
          p_task_id: string
          p_units: number
        }
        Returns: Json
      }
      add_product_component: {
        Args: {
          p_label: string
          p_product_id: string
          p_request_id: string
          p_units: number
        }
        Returns: string
      }
      adjust_consignment_stock: {
        Args: {
          p_expected_quantity: number
          p_item_id: string
          p_new_quantity: number
          p_reason: string
          p_request_id: string
        }
        Returns: string
      }
      archive_product_print_plate: {
        Args: { p_plate_id: string }
        Returns: undefined
      }
      archive_product_print_source: {
        Args: { p_source_id: string }
        Returns: undefined
      }
      assemble_product: {
        Args: {
          p_finishing_cost: number
          p_item_id: string
          p_notes: string
          p_product_id: string
          p_quantity: number
          p_request_id: string
        }
        Returns: string
      }
      assembly_product_status: {
        Args: { p_item_id?: string; p_product_id: string; p_quantity?: number }
        Returns: Json
      }
      bambu_material_selection_preview: {
        Args: {
          p_allocations: Json
          p_material_overrides?: Json
          p_plate_id: string
          p_product_id: string
          p_task_id: string
        }
        Returns: Json
      }
      bambu_production_preview: { Args: { p_task_id: string }; Returns: Json }
      begin_storefront_checkout: {
        Args: { p_payload: Json; p_request_id: string; p_slug: string }
        Returns: Json
      }
      bind_product_print_plate: {
        Args: { p_plate_id: string; p_task_id: string }
        Returns: string
      }
      bind_product_print_source: {
        Args: { p_source_id: string; p_task_id: string }
        Returns: string
      }
      bootstrap_tenant: {
        Args: {
          _display_name: string
          _tenant_name: string
          _tenant_slug: string
        }
        Returns: string
      }
      cancel_purchase_order: { Args: { p_order_id: string }; Returns: string }
      claim_marketplace_sync: {
        Args: { p_account_id: string }
        Returns: string
      }
      configure_bambu_production: {
        Args: {
          p_allocations: Json
          p_auto: boolean
          p_extras_cost: number
          p_labor_cost: number
          p_material_overrides?: Json
          p_materials: Json
          p_overhead: number
          p_plate_id?: string
          p_product_id: string
          p_task_id: string
          p_units: number
          p_use_slicer: boolean
        }
        Returns: string
      }
      configure_product_assembly: {
        Args: { p_enabled: boolean; p_product_id: string }
        Returns: string
      }
      configure_storefront: {
        Args: { p_enabled: boolean; p_slug: string }
        Returns: string
      }
      confirm_component_output: {
        Args: {
          p_good_quantity: number
          p_job_id: string
          p_reason: string
          p_request_id: string
        }
        Returns: string
      }
      confirm_finished_output: {
        Args: {
          p_good_quantity: number
          p_job_id: string
          p_reason: string
          p_request_id: string
        }
        Returns: string
      }
      confirm_sales_workflow: {
        Args: {
          p_items: Json
          p_order: Json
          p_order_id: string
          p_request_id: string
        }
        Returns: Json
      }
      confirm_subitem_output: {
        Args: {
          p_job_id: string
          p_outputs: Json
          p_reason: string
          p_request_id: string
        }
        Returns: string
      }
      convert_sales_quote: {
        Args: { p_quote_id: string; p_request_id: string }
        Returns: string
      }
      create_consignment_location: {
        Args: { p_customer: Json; p_location: Json; p_request_id: string }
        Returns: string
      }
      create_financial_installments: {
        Args: {
          p_kind: string
          p_parts: Json
          p_request_id: string
          p_title: Json
        }
        Returns: string
      }
      create_jobs: {
        Args: { p_jobs: Json; p_request_id: string }
        Returns: string[]
      }
      create_purchase_order: {
        Args: {
          p_installments: Json
          p_items: Json
          p_order: Json
          p_request_id: string
        }
        Returns: string
      }
      create_sales_order_from_marketplace: {
        Args: {
          p_customer_id: string
          p_marketplace_order_id: string
          p_payment_due_date: string
          p_request_id: string
        }
        Returns: string
      }
      delete_financial_catalog: {
        Args: { p_id: string; p_kind: string }
        Returns: undefined
      }
      delete_partner: {
        Args: { p_id: string; p_kind: string }
        Returns: undefined
      }
      delete_unused_record: {
        Args: { p_id: string; p_kind: string }
        Returns: undefined
      }
      disconnect_bambu_connection: {
        Args: { p_connection_id: string }
        Returns: undefined
      }
      erp_can_write: { Args: { financial?: boolean }; Returns: boolean }
      erp_print_file_is_referenced: {
        Args: { p_path: string }
        Returns: boolean
      }
      finish_storefront_checkout: {
        Args: {
          p_lock: string
          p_preference_id: string
          p_request_id: string
          p_url: string
        }
        Returns: undefined
      }
      fulfill_order_from_stock: {
        Args: { p_order_id: string }
        Returns: string
      }
      get_makerworld_import: { Args: { p_request_id: number }; Returns: Json }
      get_user_tenant_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_marketplace_orders: {
        Args: { p_account_id: string; p_orders: Json }
        Returns: Json
      }
      job_production_review: { Args: { p_job_id: string }; Returns: Json }
      mark_shopee_reauthorization_required: {
        Args: { p_account_id: string; p_lease: string }
        Returns: boolean
      }
      move_filament_spool: {
        Args: {
          p_location: Json
          p_reason: string
          p_request_id: string
          p_spool_id: string
        }
        Returns: string
      }
      move_subitem_stock: {
        Args: {
          p_component_product_id: string
          p_kind: string
          p_notes: string
          p_quantity: number
          p_request_id: string
          p_unit_cost: number
        }
        Returns: string
      }
      organize_eligible_marketplace_orders: {
        Args: {
          p_account_id: string
          p_order_ids: string[]
          p_request_id: string
        }
        Returns: Json
      }
      persist_marketplace_credentials: {
        Args: {
          p_access_token: string
          p_account_id: string
          p_expires_at: string
          p_lease: string
          p_refresh_token: string
          p_seller_id: string
        }
        Returns: undefined
      }
      persist_shopee_credentials: {
        Args: {
          p_access_token: string
          p_account_id: string
          p_expires_at: string
          p_lease: string
          p_refresh_token: string
          p_shop_id: string
        }
        Returns: undefined
      }
      persist_source_plate_import: {
        Args: { p_reference: Json; p_source_id: string; p_task_id?: string }
        Returns: Json
      }
      plan_component_batch: {
        Args: {
          p_item_id?: string
          p_plate_id: string
          p_quantity: number
          p_request_id: string
        }
        Returns: string[]
      }
      plan_product_plates: {
        Args: { p_product_id: string; p_quantity: number; p_request_id: string }
        Returns: string[]
      }
      plan_subitem_batch: {
        Args: {
          p_item_id?: string
          p_quantity: number
          p_request_id: string
          p_subitem_id: string
        }
        Returns: string[]
      }
      post_consignment_movement: {
        Args: {
          p_items: Json
          p_location_id: string
          p_notes: string
          p_request_id: string
          p_type: string
        }
        Returns: string
      }
      post_inventory_batch: {
        Args: { p_movements: Json; p_request_id: string }
        Returns: string
      }
      post_inventory_movement: {
        Args: { p_movement: Json; p_request_id: string }
        Returns: string
      }
      prepare_job_print_file: {
        Args: {
          p_job_id: string
          p_printer_id: string
          p_reason: string
          p_request_id: string
          p_source_id: string
        }
        Returns: string
      }
      prepare_product_plate_recipe: {
        Args: {
          p_basis: string
          p_lines: Json
          p_non_material_cost_per_unit?: number
          p_notes: string
          p_plate_id: string
          p_product_id: string
          p_request_id: string
          p_units_per_plate: number
        }
        Returns: string
      }
      product_material_recipe_catalog: { Args: never; Returns: Json }
      product_material_recipe_preview: {
        Args: { p_product_id: string }
        Returns: Json
      }
      product_material_variant_preview: {
        Args: {
          p_material_overrides?: Json
          p_product_id: string
          p_quantity?: number
        }
        Returns: Json
      }
      product_piece_spec: { Args: { p_product_id: string }; Returns: Json }
      product_print_plate_preparation: {
        Args: { p_plate_id: string }
        Returns: Json
      }
      production_financial_result: {
        Args: { p_end: string; p_start: string }
        Returns: Json
      }
      production_order_preflight: { Args: { p_id: string }; Returns: Json }
      purchase_expected_date_review_available: { Args: never; Returns: boolean }
      receive_existing_components: {
        Args: {
          p_notes: string
          p_plate_id: string
          p_quantity: number
          p_request_id: string
          p_unit_cost: number
        }
        Returns: string
      }
      receive_purchase_order: {
        Args: { p_order_id: string; p_received_date: string }
        Returns: string
      }
      reconcile_consignment: {
        Args: {
          p_expected_commission: number
          p_items: Json
          p_location_id: string
          p_notes: string
          p_request_id: string
        }
        Returns: string
      }
      record_marketplace_event: {
        Args: { p_account_id: string; p_event_key: string; p_payload: Json }
        Returns: string
      }
      record_marketplace_settlement: {
        Args: {
          p_kind: string
          p_receivable_id: string
          p_request_id: string
          p_values: Json
        }
        Returns: string
      }
      record_storefront_payment: {
        Args: { p_channel_id: string; p_payment: Json }
        Returns: undefined
      }
      refresh_production_preparation: {
        Args: { p_id: string }
        Returns: string
      }
      register_bank_transaction: {
        Args: {
          p_amount: number
          p_bank_account_id: string
          p_date: string
          p_description: string
          p_request_id: string
          p_type: string
        }
        Returns: string
      }
      release_job_filament: {
        Args: {
          p_reason: string
          p_request_id: string
          p_reservation_id: string
        }
        Returns: string
      }
      release_marketplace_sync: {
        Args: { p_account_id: string; p_lease: string }
        Returns: undefined
      }
      release_production_order: { Args: { p_id: string }; Returns: string }
      remove_product_subitem: {
        Args: { p_subitem_id: string }
        Returns: string
      }
      request_bambu_sync: { Args: never; Returns: Json }
      request_makerworld_import: { Args: { p_url: string }; Returns: number }
      request_production_order: {
        Args: { p_order_id: string; p_quote_id: string; p_request_id: string }
        Returns: string
      }
      request_stock_production: {
        Args: {
          p_due_date: string
          p_items: Json
          p_notes: string
          p_request_id: string
        }
        Returns: string
      }
      reserve_job_filament: {
        Args: {
          p_grams: number
          p_item_id: string
          p_job_id: string
          p_reason: string
          p_request_id: string
          p_spool_id: string
        }
        Returns: string
      }
      review_marketplace_order: {
        Args: { p_marketplace_order_id: string; p_reason: string }
        Returns: string
      }
      review_storefront_payment: {
        Args: { p_reason: string; p_request_id: string }
        Returns: undefined
      }
      save_filament_replenishment_policy: {
        Args: {
          p_buffer_grams: number
          p_item_id: string
          p_lead_days: number
          p_multiple_kg: number
          p_request_id: string
          p_vendor_id: string
        }
        Returns: string
      }
      save_filament_spool: {
        Args: {
          p_data: Json
          p_reason: string
          p_request_id: string
          p_spool_id: string
        }
        Returns: string
      }
      save_financial_catalog: {
        Args: {
          p_id: string
          p_kind: string
          p_request_id: string
          p_values: Json
        }
        Returns: string
      }
      save_inventory_catalog: {
        Args: { p_item: Json; p_item_id: string; p_request_id: string }
        Returns: string
      }
      save_marketplace_account: {
        Args: {
          p_channel: string
          p_external_seller_id?: string
          p_name: string
        }
        Returns: string
      }
      save_marketplace_sku_binding: {
        Args: {
          p_account_id: string
          p_external_item_id: string
          p_external_sku: string
          p_external_variant_id: string
          p_product_id: string
          p_requires_manual_review?: boolean
        }
        Returns: string
      }
      save_marketplace_workflow_policy: {
        Args: { p_account_id: string; p_request_id: string; p_values: Json }
        Returns: string
      }
      save_partner: {
        Args: {
          p_data: Json
          p_id: string
          p_kind: string
          p_request_id: string
        }
        Returns: string
      }
      save_product_material_recipe: {
        Args: {
          p_basis: string
          p_lines: Json
          p_non_material_cost_per_unit?: number
          p_notes: string
          p_plate_id: string
          p_product_id: string
          p_request_id: string
        }
        Returns: string
      }
      save_product_piece_spec: {
        Args: { p_data: Json; p_product_id: string; p_request_id: string }
        Returns: string
      }
      save_product_print_plate: {
        Args: {
          p_plate: Json
          p_plate_id: string
          p_product_id: string
          p_source_id: string
        }
        Returns: string
      }
      save_product_print_source: {
        Args: { p_product_id: string; p_source: Json; p_source_id: string }
        Returns: string
      }
      save_product_subitem: {
        Args: {
          p_data: Json
          p_product_id: string
          p_request_id: string
          p_subitem_id: string
        }
        Returns: string
      }
      save_product_with_photos: {
        Args: {
          p_photos: Json
          p_product: Json
          p_product_id: string
          p_request_id: string
        }
        Returns: string
      }
      save_quick_purchase: {
        Args: {
          p_installments: Json
          p_items: Json
          p_order: Json
          p_receive?: boolean
          p_request_id: string
        }
        Returns: string
      }
      save_sales_order: {
        Args: {
          p_items: Json
          p_order: Json
          p_order_id: string
          p_request_id: string
        }
        Returns: string
      }
      save_sales_quote: {
        Args: {
          p_items: Json
          p_quote: Json
          p_quote_id: string
          p_request_id: string
        }
        Returns: string
      }
      save_source_with_plate_import: {
        Args: {
          p_product_id: string
          p_reference: Json
          p_request_id: string
          p_source: Json
          p_source_id: string
          p_task_id?: string
        }
        Returns: Json
      }
      save_storefront_listing: {
        Args: { p_channel_id: string; p_product_id: string; p_settings: Json }
        Returns: string
      }
      save_storefront_payment_settings: {
        Args: {
          p_channel_id: string
          p_mode: string
          p_secret: string
          p_shipping_fee: number
          p_states: string[]
          p_token: string
        }
        Returns: undefined
      }
      set_purchase_expected_date: {
        Args: {
          p_expected_date: string
          p_order_id: string
          p_request_id: string
        }
        Returns: string
      }
      settle_financial_title: {
        Args: {
          p_amount: number
          p_bank_account_id: string
          p_date: string
          p_kind: string
          p_request_id: string
          p_title_id: string
        }
        Returns: string
      }
      storefront_catalog: { Args: { p_slug: string }; Returns: Json }
      storefront_checkout_config: { Args: { p_slug: string }; Returns: Json }
      storefront_request_status: {
        Args: { p_request_id: string; p_slug: string }
        Returns: Json
      }
      submit_storefront_request: {
        Args: { p_payload: Json; p_request_id: string; p_slug: string }
        Returns: Json
      }
      transition_job: {
        Args: {
          p_actual_extras_cost?: number
          p_actual_grams?: number
          p_actual_labor_cost?: number
          p_actual_overhead?: number
          p_actual_time_minutes?: number
          p_failure_reason?: string
          p_job_id: string
          p_printer_id?: string
          p_secondary_actual_grams?: number
          p_status: string
          p_waste_grams?: number
        }
        Returns: string
      }
      transition_production_order: {
        Args: { p_id: string; p_status: string }
        Returns: string
      }
      transition_sales_order: {
        Args: { p_order_id: string; p_status: string }
        Returns: string
      }
      transition_sales_quote: {
        Args: { p_quote_id: string; p_reason?: string; p_status: string }
        Returns: string
      }
      update_sales_order_deadlines: {
        Args: {
          p_dates: Json
          p_order_id: string
          p_reason: string
          p_request_id: string
        }
        Returns: string
      }
      write_off_components: {
        Args: {
          p_item_id?: string
          p_notes: string
          p_plate_id: string
          p_quantity: number
          p_request_id: string
        }
        Returns: string
      }
    }
    Enums: {
      account_type: "asset" | "liability" | "equity" | "revenue" | "expense"
      app_role: "owner" | "admin" | "manager" | "operator" | "viewer"
      consignment_movement_type:
        | "placement"
        | "sale"
        | "replenishment"
        | "return"
      job_status:
        | "draft"
        | "queued"
        | "printing"
        | "paused"
        | "failed"
        | "reprint"
        | "post_processing"
        | "quality_check"
        | "ready"
        | "shipped"
        | "completed"
      movement_type:
        | "purchase_in"
        | "job_consumption"
        | "loss"
        | "maintenance"
        | "adjustment"
        | "return"
      payable_status: "open" | "partial" | "paid" | "overdue" | "cancelled"
      printer_status:
        | "idle"
        | "printing"
        | "paused"
        | "error"
        | "offline"
        | "maintenance"
      receivable_status:
        | "open"
        | "partial"
        | "received"
        | "overdue"
        | "reversed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_type: ["asset", "liability", "equity", "revenue", "expense"],
      app_role: ["owner", "admin", "manager", "operator", "viewer"],
      consignment_movement_type: [
        "placement",
        "sale",
        "replenishment",
        "return",
      ],
      job_status: [
        "draft",
        "queued",
        "printing",
        "paused",
        "failed",
        "reprint",
        "post_processing",
        "quality_check",
        "ready",
        "shipped",
        "completed",
      ],
      movement_type: [
        "purchase_in",
        "job_consumption",
        "loss",
        "maintenance",
        "adjustment",
        "return",
      ],
      payable_status: ["open", "partial", "paid", "overdue", "cancelled"],
      printer_status: [
        "idle",
        "printing",
        "paused",
        "error",
        "offline",
        "maintenance",
      ],
      receivable_status: ["open", "partial", "received", "overdue", "reversed"],
    },
  },
} as const
