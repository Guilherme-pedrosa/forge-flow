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
          contact_name: string | null
          created_at: string
          customer_id: string | null
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
          contact_name?: string | null
          created_at?: string
          customer_id?: string | null
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
          contact_name?: string | null
          created_at?: string
          customer_id?: string | null
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
          created_at: string
          current_stock: number
          diameter: number | null
          freight_cost: number | null
          id: string
          is_active: boolean
          last_cost: number | null
          loss_coefficient: number
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
          created_at?: string
          current_stock?: number
          diameter?: number | null
          freight_cost?: number | null
          id?: string
          is_active?: boolean
          last_cost?: number | null
          loss_coefficient?: number
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
          created_at?: string
          current_stock?: number
          diameter?: number | null
          freight_cost?: number | null
          id?: string
          is_active?: boolean
          last_cost?: number | null
          loss_coefficient?: number
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
          actual_grams: number | null
          actual_labor_cost: number | null
          actual_machine_cost: number | null
          actual_material_cost: number | null
          actual_overhead: number | null
          actual_time_minutes: number | null
          actual_total_cost: number | null
          bambu_subtask_id: string | null
          bambu_task_id: string | null
          code: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          est_energy_cost: number | null
          est_grams: number | null
          est_labor_cost: number | null
          est_machine_cost: number | null
          est_material_cost: number | null
          est_overhead: number | null
          est_time_minutes: number | null
          est_total_cost: number | null
          failure_reason: string | null
          id: string
          margin_percent: number | null
          material_id: string | null
          name: string
          num_colors: number
          order_id: string | null
          post_minutes: number | null
          prep_minutes: number | null
          printer_id: string | null
          priority: number
          product_id: string | null
          purge_waste_grams: number | null
          qc_minutes: number | null
          reprint_of: string | null
          sale_price: number | null
          secondary_material_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          tenant_id: string
          updated_at: string
          waste_grams: number | null
        }
        Insert: {
          actual_energy_cost?: number | null
          actual_grams?: number | null
          actual_labor_cost?: number | null
          actual_machine_cost?: number | null
          actual_material_cost?: number | null
          actual_overhead?: number | null
          actual_time_minutes?: number | null
          actual_total_cost?: number | null
          bambu_subtask_id?: string | null
          bambu_task_id?: string | null
          code: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          est_energy_cost?: number | null
          est_grams?: number | null
          est_labor_cost?: number | null
          est_machine_cost?: number | null
          est_material_cost?: number | null
          est_overhead?: number | null
          est_time_minutes?: number | null
          est_total_cost?: number | null
          failure_reason?: string | null
          id?: string
          margin_percent?: number | null
          material_id?: string | null
          name: string
          num_colors?: number
          order_id?: string | null
          post_minutes?: number | null
          prep_minutes?: number | null
          printer_id?: string | null
          priority?: number
          product_id?: string | null
          purge_waste_grams?: number | null
          qc_minutes?: number | null
          reprint_of?: string | null
          sale_price?: number | null
          secondary_material_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id: string
          updated_at?: string
          waste_grams?: number | null
        }
        Update: {
          actual_energy_cost?: number | null
          actual_grams?: number | null
          actual_labor_cost?: number | null
          actual_machine_cost?: number | null
          actual_material_cost?: number | null
          actual_overhead?: number | null
          actual_time_minutes?: number | null
          actual_total_cost?: number | null
          bambu_subtask_id?: string | null
          bambu_task_id?: string | null
          code?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          est_energy_cost?: number | null
          est_grams?: number | null
          est_labor_cost?: number | null
          est_machine_cost?: number | null
          est_material_cost?: number | null
          est_overhead?: number | null
          est_time_minutes?: number | null
          est_total_cost?: number | null
          failure_reason?: string | null
          id?: string
          margin_percent?: number | null
          material_id?: string | null
          name?: string
          num_colors?: number
          order_id?: string | null
          post_minutes?: number | null
          prep_minutes?: number | null
          printer_id?: string | null
          priority?: number
          product_id?: string | null
          purge_waste_grams?: number | null
          qc_minutes?: number | null
          reprint_of?: string | null
          sale_price?: number | null
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
      order_items: {
        Row: {
          created_at: string
          description: string
          id: string
          notes: string | null
          order_id: string
          product_id: string | null
          quantity: number
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
          quantity?: number
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
          quantity?: number
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
      products: {
        Row: {
          category: string
          cost_estimate: number | null
          created_at: string
          description: string | null
          est_grams: number | null
          est_time_minutes: number | null
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
          category?: string
          cost_estimate?: number | null
          created_at?: string
          description?: string | null
          est_grams?: number | null
          est_time_minutes?: number | null
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
          category?: string
          cost_estimate?: number | null
          created_at?: string
          description?: string | null
          est_grams?: number | null
          est_time_minutes?: number | null
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
      [_ in never]: never
    }
    Functions: {
      bootstrap_tenant: {
        Args: {
          _display_name: string
          _tenant_name: string
          _tenant_slug: string
        }
        Returns: string
      }
      get_user_tenant_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
