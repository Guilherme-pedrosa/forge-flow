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
    PostgrestVersion: "14.5"
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
          notes: string | null
          payment_due_date: string | null
          requires_material_recipe: boolean
          shipping: number
          source_quote_id: string | null
          status: string
          tenant_id: string
          total: number
          updated_at: string
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
          notes?: string | null
          payment_due_date?: string | null
          requires_material_recipe?: boolean
          shipping?: number
          source_quote_id?: string | null
          status?: string
          tenant_id: string
          total?: number
          updated_at?: string
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
          notes?: string | null
          payment_due_date?: string | null
          requires_material_recipe?: boolean
          shipping?: number
          source_quote_id?: string | null
          status?: string
          tenant_id?: string
          total?: number
          updated_at?: string
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
          units_per_plate: number
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
          units_per_plate?: number
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
          units_per_plate?: number
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
      products: {
        Row: {
          actual_print_cost_per_unit: number | null
          actual_print_grams_per_unit: number | null
          actual_print_sample_units: number | null
          actual_print_seconds_per_unit: number | null
          actual_print_source: string | null
          actual_print_updated_at: string | null
          category: string
          cost_estimate: number | null
          created_at: string
          description: string | null
          est_grams: number | null
          est_time_minutes: number | null
          external_import: Json | null
          extras: Json
          id: string
          is_active: boolean
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
          category?: string
          cost_estimate?: number | null
          created_at?: string
          description?: string | null
          est_grams?: number | null
          est_time_minutes?: number | null
          external_import?: Json | null
          extras?: Json
          id?: string
          is_active?: boolean
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
          category?: string
          cost_estimate?: number | null
          created_at?: string
          description?: string | null
          est_grams?: number | null
          est_time_minutes?: number | null
          external_import?: Json | null
          extras?: Json
          id?: string
          is_active?: boolean
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
      bambu_production_preview: { Args: { p_task_id: string }; Returns: Json }
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
      configure_bambu_production: {
        Args: {
          p_allocations: Json
          p_auto: boolean
          p_extras_cost: number
          p_labor_cost: number
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
      convert_sales_quote: {
        Args: { p_quote_id: string; p_request_id: string }
        Returns: string
      }
      create_consignment_location: {
        Args: { p_customer: Json; p_location: Json; p_request_id: string }
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
      disconnect_bambu_connection: {
        Args: { p_connection_id: string }
        Returns: undefined
      }
      erp_can_write: { Args: { financial?: boolean }; Returns: boolean }
      erp_print_file_is_referenced: {
        Args: { p_path: string }
        Returns: boolean
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
      job_production_review: { Args: { p_job_id: string }; Returns: Json }
      plan_product_plates: {
        Args: { p_product_id: string; p_quantity: number; p_request_id: string }
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
      product_material_recipe_catalog: { Args: never; Returns: Json }
      product_material_recipe_preview: {
        Args: { p_product_id: string }
        Returns: Json
      }
      receive_purchase_order: {
        Args: { p_order_id: string; p_received_date: string }
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
      request_bambu_sync: { Args: never; Returns: Json }
      request_makerworld_import: { Args: { p_url: string }; Returns: number }
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
      save_product_with_photos: {
        Args: {
          p_photos: Json
          p_product: Json
          p_product_id: string
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
      transition_sales_order: {
        Args: { p_order_id: string; p_status: string }
        Returns: string
      }
      transition_sales_quote: {
        Args: { p_quote_id: string; p_reason?: string; p_status: string }
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
