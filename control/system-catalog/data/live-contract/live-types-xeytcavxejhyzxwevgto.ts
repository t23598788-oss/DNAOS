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
      ai_connection_status: {
        Row: {
          api_token_id: string | null
          auth_ok: boolean | null
          last_failure_code: string | null
          last_failure_reason_th: string | null
          last_health_check_at: string | null
          last_success_at: string | null
          mcp_reachability: string | null
          read_command_ok: boolean | null
          singleton_key: boolean
          status: string
          updated_at: string
          write_blocked_ok: boolean | null
        }
        Insert: {
          api_token_id?: string | null
          auth_ok?: boolean | null
          last_failure_code?: string | null
          last_failure_reason_th?: string | null
          last_health_check_at?: string | null
          last_success_at?: string | null
          mcp_reachability?: string | null
          read_command_ok?: boolean | null
          singleton_key?: boolean
          status?: string
          updated_at?: string
          write_blocked_ok?: boolean | null
        }
        Update: {
          api_token_id?: string | null
          auth_ok?: boolean | null
          last_failure_code?: string | null
          last_failure_reason_th?: string | null
          last_health_check_at?: string | null
          last_success_at?: string | null
          mcp_reachability?: string | null
          read_command_ok?: boolean | null
          singleton_key?: boolean
          status?: string
          updated_at?: string
          write_blocked_ok?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_connection_status_api_token_id_fkey"
            columns: ["api_token_id"]
            isOneToOne: false
            referencedRelation: "api_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_tasks: {
        Row: {
          business_event_id: string | null
          created_at: string
          error: string | null
          id: string
          input_text: string | null
          kind: string
          line_event_id: string | null
          line_user_id: string
          media_path: string | null
          processed_at: string | null
          result: Json | null
          status: string
          trace: Json
        }
        Insert: {
          business_event_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          input_text?: string | null
          kind: string
          line_event_id?: string | null
          line_user_id: string
          media_path?: string | null
          processed_at?: string | null
          result?: Json | null
          status?: string
          trace?: Json
        }
        Update: {
          business_event_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          input_text?: string | null
          kind?: string
          line_event_id?: string | null
          line_user_id?: string
          media_path?: string | null
          processed_at?: string | null
          result?: Json | null
          status?: string
          trace?: Json
        }
        Relationships: []
      }
      api_tokens: {
        Row: {
          connection_kind: string
          created_at: string
          id: string
          label: string
          last_used_at: string | null
          revoked_at: string | null
          scopes: string[]
          token: string | null
          token_hash: string | null
          user_email: string
          vault_secret_id: string | null
        }
        Insert: {
          connection_kind?: string
          created_at?: string
          id?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes?: string[]
          token?: string | null
          token_hash?: string | null
          user_email: string
          vault_secret_id?: string | null
        }
        Update: {
          connection_kind?: string
          created_at?: string
          id?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes?: string[]
          token?: string | null
          token_hash?: string | null
          user_email?: string
          vault_secret_id?: string | null
        }
        Relationships: []
      }
      app_configs: {
        Row: {
          data: string
          title: string
          updated_at: string
        }
        Insert: {
          data: string
          title: string
          updated_at?: string
        }
        Update: {
          data?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      architecture_drift_events: {
        Row: {
          checked_at: string
          clean: boolean
          finding_count: number
          findings: Json
          id: string
          machine_id: string
          notified: boolean
        }
        Insert: {
          checked_at?: string
          clean: boolean
          finding_count?: number
          findings?: Json
          id?: string
          machine_id: string
          notified?: boolean
        }
        Update: {
          checked_at?: string
          clean?: boolean
          finding_count?: number
          findings?: Json
          id?: string
          machine_id?: string
          notified?: boolean
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          company_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          field: string | null
          id: string
          ip_address: string | null
          new_value: string | null
          old_value: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          company_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          field?: string | null
          id?: string
          ip_address?: string | null
          new_value?: string | null
          old_value?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          company_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          field?: string | null
          id?: string
          ip_address?: string | null
          new_value?: string | null
          old_value?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_notifications: {
        Row: {
          amount: number | null
          created_at: string
          gmail_message_id: string
          id: string
          matched_receipt_document_id: string | null
          raw_body: string | null
          raw_subject: string | null
          receiving_account_masked: string | null
          receiving_account_name: string | null
          reference_number: string | null
          sender_account_masked: string | null
          transaction_datetime: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          gmail_message_id: string
          id?: string
          matched_receipt_document_id?: string | null
          raw_body?: string | null
          raw_subject?: string | null
          receiving_account_masked?: string | null
          receiving_account_name?: string | null
          reference_number?: string | null
          sender_account_masked?: string | null
          transaction_datetime?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          gmail_message_id?: string
          id?: string
          matched_receipt_document_id?: string | null
          raw_body?: string | null
          raw_subject?: string | null
          receiving_account_masked?: string | null
          receiving_account_name?: string | null
          reference_number?: string | null
          sender_account_masked?: string | null
          transaction_datetime?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_notifications_matched_receipt_document_id_fkey"
            columns: ["matched_receipt_document_id"]
            isOneToOne: false
            referencedRelation: "receipt_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_transactions: {
        Row: {
          account_number: string | null
          amount: number
          balance_after: number | null
          channel: string | null
          created_at: string
          description: string | null
          id: string
          kind: string | null
          matched_receipt_document_id: string | null
          transaction_date: string
          transaction_time: string | null
        }
        Insert: {
          account_number?: string | null
          amount: number
          balance_after?: number | null
          channel?: string | null
          created_at?: string
          description?: string | null
          id?: string
          kind?: string | null
          matched_receipt_document_id?: string | null
          transaction_date: string
          transaction_time?: string | null
        }
        Update: {
          account_number?: string | null
          amount?: number
          balance_after?: number | null
          channel?: string | null
          created_at?: string
          description?: string | null
          id?: string
          kind?: string | null
          matched_receipt_document_id?: string | null
          transaction_date?: string
          transaction_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_transactions_matched_receipt_document_id_fkey"
            columns: ["matched_receipt_document_id"]
            isOneToOne: false
            referencedRelation: "receipt_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      business_events: {
        Row: {
          confidence: number | null
          contact_name: string | null
          contact_phone: string | null
          context: Json | null
          created_at: string
          description: string | null
          destination: string | null
          event_code: string
          event_date: string | null
          event_type: string | null
          id: string
          material_id: string | null
          material_text: string | null
          metadata: Json
          partner_id: string | null
          quantity: number | null
          quantity_unit: string | null
          quoted_amount: number | null
          schedule_text: string | null
          source_line_user_id: string | null
          source_message_ids: string[] | null
          status: string
          title: string | null
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          contact_name?: string | null
          contact_phone?: string | null
          context?: Json | null
          created_at?: string
          description?: string | null
          destination?: string | null
          event_code: string
          event_date?: string | null
          event_type?: string | null
          id?: string
          material_id?: string | null
          material_text?: string | null
          metadata?: Json
          partner_id?: string | null
          quantity?: number | null
          quantity_unit?: string | null
          quoted_amount?: number | null
          schedule_text?: string | null
          source_line_user_id?: string | null
          source_message_ids?: string[] | null
          status?: string
          title?: string | null
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          contact_name?: string | null
          contact_phone?: string | null
          context?: Json | null
          created_at?: string
          description?: string | null
          destination?: string | null
          event_code?: string
          event_date?: string | null
          event_type?: string | null
          id?: string
          material_id?: string | null
          material_text?: string | null
          metadata?: Json
          partner_id?: string | null
          quantity?: number | null
          quantity_unit?: string | null
          quoted_amount?: number | null
          schedule_text?: string | null
          source_line_user_id?: string | null
          source_message_ids?: string[] | null
          status?: string
          title?: string | null
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_events_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_events_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          bank_account_no: string | null
          bank_name: string | null
          created_at: string
          email: string | null
          id: string
          is_individual: boolean
          line_user_id: string | null
          name: string
          phone: string | null
          status: Database["public"]["Enums"]["CompanyStatus"]
          tax_id: string | null
          type: Database["public"]["Enums"]["CompanyType"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          bank_account_no?: string | null
          bank_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_individual?: boolean
          line_user_id?: string | null
          name: string
          phone?: string | null
          status?: Database["public"]["Enums"]["CompanyStatus"]
          tax_id?: string | null
          type: Database["public"]["Enums"]["CompanyType"]
          updated_at: string
        }
        Update: {
          address?: string | null
          bank_account_no?: string | null
          bank_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_individual?: boolean
          line_user_id?: string | null
          name?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["CompanyStatus"]
          tax_id?: string | null
          type?: Database["public"]["Enums"]["CompanyType"]
          updated_at?: string
        }
        Relationships: []
      }
      company_expenses: {
        Row: {
          amount: number | null
          amount_pre_vat: number | null
          branch_address: string | null
          branch_code: string | null
          branch_name: string | null
          buyer_name: string | null
          created_at: string
          document_source: string | null
          document_type: string
          employee_name: string | null
          expense_date: string | null
          id: string
          issued_at: string | null
          notes: string | null
          printed_at: string | null
          quantity: number | null
          receipt_document_id: string | null
          source: string
          submitted_by_line_user_id: string | null
          submitted_by_name: string | null
          submitted_by_role: string | null
          subscription_service_id: string | null
          tax_invoice_no: string | null
          unit: string | null
          unit_price: number | null
          vat_amount: number | null
          vendor_name: string | null
          vendor_tax_id: string | null
        }
        Insert: {
          amount?: number | null
          amount_pre_vat?: number | null
          branch_address?: string | null
          branch_code?: string | null
          branch_name?: string | null
          buyer_name?: string | null
          created_at?: string
          document_source?: string | null
          document_type: string
          employee_name?: string | null
          expense_date?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
          printed_at?: string | null
          quantity?: number | null
          receipt_document_id?: string | null
          source?: string
          submitted_by_line_user_id?: string | null
          submitted_by_name?: string | null
          submitted_by_role?: string | null
          subscription_service_id?: string | null
          tax_invoice_no?: string | null
          unit?: string | null
          unit_price?: number | null
          vat_amount?: number | null
          vendor_name?: string | null
          vendor_tax_id?: string | null
        }
        Update: {
          amount?: number | null
          amount_pre_vat?: number | null
          branch_address?: string | null
          branch_code?: string | null
          branch_name?: string | null
          buyer_name?: string | null
          created_at?: string
          document_source?: string | null
          document_type?: string
          employee_name?: string | null
          expense_date?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
          printed_at?: string | null
          quantity?: number | null
          receipt_document_id?: string | null
          source?: string
          submitted_by_line_user_id?: string | null
          submitted_by_name?: string | null
          submitted_by_role?: string | null
          subscription_service_id?: string | null
          tax_invoice_no?: string | null
          unit?: string | null
          unit_price?: number | null
          vat_amount?: number | null
          vendor_name?: string | null
          vendor_tax_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_expenses_receipt_document_id_fkey"
            columns: ["receipt_document_id"]
            isOneToOne: false
            referencedRelation: "receipt_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_expenses_subscription_service_id_fkey"
            columns: ["subscription_service_id"]
            isOneToOne: false
            referencedRelation: "subscription_services"
            referencedColumns: ["id"]
          },
        ]
      }
      company_line_links: {
        Row: {
          company_id: string
          created_at: string
          line_user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          line_user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          line_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_line_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_webhook_events: {
        Row: {
          connector_id: string
          created_at: string
          headers: Json
          id: string
          payload: Json
          verified: boolean
        }
        Insert: {
          connector_id: string
          created_at?: string
          headers?: Json
          id?: string
          payload?: Json
          verified?: boolean
        }
        Update: {
          connector_id?: string
          created_at?: string
          headers?: Json
          id?: string
          payload?: Json
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "connector_webhook_events_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "connectors"
            referencedColumns: ["id"]
          },
        ]
      }
      connectors: {
        Row: {
          auth_type: string
          config: Json
          created_at: string
          created_by_admin_id: string | null
          enabled: boolean
          id: string
          last_checked_at: string | null
          last_error: string | null
          name: string
          secret: Json
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          auth_type: string
          config?: Json
          created_at?: string
          created_by_admin_id?: string | null
          enabled?: boolean
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          name: string
          secret?: Json
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          auth_type?: string
          config?: Json
          created_at?: string
          created_by_admin_id?: string | null
          enabled?: boolean
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          name?: string
          secret?: Json
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_orders: {
        Row: {
          created_at: string
          customer_company_id: string
          customer_site_id: string
          delivery_note: string | null
          document_group_id: string
          id: string
          order_no: string
          project_id: string
          requested_delivery_at: string | null
          status: Database["public"]["Enums"]["CustomerOrderStatus"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_company_id: string
          customer_site_id: string
          delivery_note?: string | null
          document_group_id: string
          id?: string
          order_no: string
          project_id: string
          requested_delivery_at?: string | null
          status?: Database["public"]["Enums"]["CustomerOrderStatus"]
          updated_at: string
        }
        Update: {
          created_at?: string
          customer_company_id?: string
          customer_site_id?: string
          delivery_note?: string | null
          document_group_id?: string
          id?: string
          order_no?: string
          project_id?: string
          requested_delivery_at?: string | null
          status?: Database["public"]["Enums"]["CustomerOrderStatus"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_orders_customer_company_id_fkey"
            columns: ["customer_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_orders_customer_site_id_fkey"
            columns: ["customer_site_id"]
            isOneToOne: false
            referencedRelation: "customer_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_orders_document_group_id_fkey"
            columns: ["document_group_id"]
            isOneToOne: false
            referencedRelation: "document_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_sites: {
        Row: {
          access_restriction: string | null
          address: string
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          customer_company_id: string
          delivery_note: string | null
          district: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          is_active: boolean
          postal_code: string
          preferred_delivery_time: string | null
          province: string
          site_name: string
          subdistrict: string
          updated_at: string
        }
        Insert: {
          access_restriction?: string | null
          address: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          customer_company_id: string
          delivery_note?: string | null
          district: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          is_active?: boolean
          postal_code: string
          preferred_delivery_time?: string | null
          province: string
          site_name: string
          subdistrict: string
          updated_at: string
        }
        Update: {
          access_restriction?: string | null
          address?: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          customer_company_id?: string
          delivery_note?: string | null
          district?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          is_active?: boolean
          postal_code?: string
          preferred_delivery_time?: string | null
          province?: string
          site_name?: string
          subdistrict?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_sites_customer_company_id_fkey"
            columns: ["customer_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      debt_events: {
        Row: {
          amount: number | null
          created_at: string
          created_by: string | null
          customer_company_id: string
          event_type: string
          id: string
          linked_document_id: string | null
          note: string | null
          occurred_at: string
          promised_date: string | null
          source: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          created_by?: string | null
          customer_company_id: string
          event_type: string
          id?: string
          linked_document_id?: string | null
          note?: string | null
          occurred_at: string
          promised_date?: string | null
          source?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          created_by?: string | null
          customer_company_id?: string
          event_type?: string
          id?: string
          linked_document_id?: string | null
          note?: string | null
          occurred_at?: string
          promised_date?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "debt_events_customer_company_id_fkey"
            columns: ["customer_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debt_events_linked_document_id_fkey"
            columns: ["linked_document_id"]
            isOneToOne: false
            referencedRelation: "standalone_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      debt_snapshots: {
        Row: {
          calculation_method: string | null
          collection_state: Database["public"]["Enums"]["CollectionState"]
          created_at: string
          customer_company_id: string
          days_overdue: number
          debt_start_at: string | null
          debt_type: string | null
          document_type: string | null
          first_contact_at: string | null
          freeze_from: string | null
          freeze_until: string | null
          id: string
          last_refreshed_at: string
          legal_basis: string | null
          open_invoice_count: number
          overdue_amount: number
          reason: string | null
          remark: string | null
          source_event_id: string | null
          total_outstanding: number
          updated_at: string
          vat_status: string | null
        }
        Insert: {
          calculation_method?: string | null
          collection_state?: Database["public"]["Enums"]["CollectionState"]
          created_at?: string
          customer_company_id: string
          days_overdue?: number
          debt_start_at?: string | null
          debt_type?: string | null
          document_type?: string | null
          first_contact_at?: string | null
          freeze_from?: string | null
          freeze_until?: string | null
          id?: string
          last_refreshed_at?: string
          legal_basis?: string | null
          open_invoice_count?: number
          overdue_amount?: number
          reason?: string | null
          remark?: string | null
          source_event_id?: string | null
          total_outstanding?: number
          updated_at: string
          vat_status?: string | null
        }
        Update: {
          calculation_method?: string | null
          collection_state?: Database["public"]["Enums"]["CollectionState"]
          created_at?: string
          customer_company_id?: string
          days_overdue?: number
          debt_start_at?: string | null
          debt_type?: string | null
          document_type?: string | null
          first_contact_at?: string | null
          freeze_from?: string | null
          freeze_until?: string | null
          id?: string
          last_refreshed_at?: string
          legal_basis?: string | null
          open_invoice_count?: number
          overdue_amount?: number
          reason?: string | null
          remark?: string | null
          source_event_id?: string | null
          total_outstanding?: number
          updated_at?: string
          vat_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "debt_snapshots_customer_company_id_fkey"
            columns: ["customer_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      destructive_action_log: {
        Row: {
          action: string
          actor: string
          block_reason: string | null
          blocked: boolean
          confirmation_token: string | null
          executed: boolean
          executed_at: string | null
          id: string
          operation_id: string
          preview: Json
          requested_at: string
          session_id: string | null
          snapshot_hash: string | null
          target_path: string
          trash_path: string | null
        }
        Insert: {
          action: string
          actor: string
          block_reason?: string | null
          blocked?: boolean
          confirmation_token?: string | null
          executed?: boolean
          executed_at?: string | null
          id?: string
          operation_id: string
          preview: Json
          requested_at?: string
          session_id?: string | null
          snapshot_hash?: string | null
          target_path: string
          trash_path?: string | null
        }
        Update: {
          action?: string
          actor?: string
          block_reason?: string | null
          blocked?: boolean
          confirmation_token?: string | null
          executed?: boolean
          executed_at?: string | null
          id?: string
          operation_id?: string
          preview?: Json
          requested_at?: string
          session_id?: string | null
          snapshot_hash?: string | null
          target_path?: string
          trash_path?: string | null
        }
        Relationships: []
      }
      dev_loop_check_results: {
        Row: {
          checked_at: string
          dependents: Json
          evidence_event_id: string
          id: string
          path: string
          reason: string
          result: string
          session_id: string
        }
        Insert: {
          checked_at?: string
          dependents?: Json
          evidence_event_id: string
          id?: string
          path: string
          reason: string
          result: string
          session_id: string
        }
        Update: {
          checked_at?: string
          dependents?: Json
          evidence_event_id?: string
          id?: string
          path?: string
          reason?: string
          result?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dev_loop_check_results_evidence_event_id_fkey"
            columns: ["evidence_event_id"]
            isOneToOne: false
            referencedRelation: "dev_loop_evidence_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dev_loop_check_results_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "dev_loop_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      dev_loop_evidence_events: {
        Row: {
          content_hash: string | null
          diff_summary: string | null
          event_type: string
          id: string
          occurred_at: string
          path: string
          session_id: string
        }
        Insert: {
          content_hash?: string | null
          diff_summary?: string | null
          event_type: string
          id?: string
          occurred_at?: string
          path: string
          session_id: string
        }
        Update: {
          content_hash?: string | null
          diff_summary?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          path?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dev_loop_evidence_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "dev_loop_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      dev_loop_registry_proposals: {
        Row: {
          check_result_id: string
          decided_at: string | null
          decided_by: string | null
          id: string
          patch: Json
          path: string
          proposed_at: string
          session_id: string
          status: string
          target_registry: string
        }
        Insert: {
          check_result_id: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          patch: Json
          path: string
          proposed_at?: string
          session_id: string
          status?: string
          target_registry?: string
        }
        Update: {
          check_result_id?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          patch?: Json
          path?: string
          proposed_at?: string
          session_id?: string
          status?: string
          target_registry?: string
        }
        Relationships: [
          {
            foreignKeyName: "dev_loop_registry_proposals_check_result_id_fkey"
            columns: ["check_result_id"]
            isOneToOne: false
            referencedRelation: "dev_loop_check_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dev_loop_registry_proposals_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "dev_loop_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      dev_loop_sessions: {
        Row: {
          closed_at: string | null
          file_scope: Json
          goal: string | null
          id: string
          owner: string | null
          started_at: string
          status: string
        }
        Insert: {
          closed_at?: string | null
          file_scope?: Json
          goal?: string | null
          id: string
          owner?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          closed_at?: string | null
          file_scope?: Json
          goal?: string | null
          id?: string
          owner?: string | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      document_groups: {
        Row: {
          created_at: string
          customer_company_id: string
          group_no: string
          id: string
          project_id: string
          project_no: string
          root_order_id: string | null
          root_order_no: string | null
          status: Database["public"]["Enums"]["DocumentGroupStatus"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_company_id: string
          group_no: string
          id?: string
          project_id: string
          project_no: string
          root_order_id?: string | null
          root_order_no?: string | null
          status?: Database["public"]["Enums"]["DocumentGroupStatus"]
          title: string
          updated_at: string
        }
        Update: {
          created_at?: string
          customer_company_id?: string
          group_no?: string
          id?: string
          project_id?: string
          project_no?: string
          root_order_id?: string | null
          root_order_no?: string | null
          status?: Database["public"]["Enums"]["DocumentGroupStatus"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_groups_customer_company_id_fkey"
            columns: ["customer_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_groups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_equipment_permissions: {
        Row: {
          created_at: string
          equipment_id: string
          id: string
          is_active: boolean
          line_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          equipment_id: string
          id?: string
          is_active?: boolean
          line_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          equipment_id?: string
          id?: string
          is_active?: boolean
          line_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_equipment_permissions_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_equipment_permissions_line_user_id_fkey"
            columns: ["line_user_id"]
            isOneToOne: false
            referencedRelation: "line_profiles"
            referencedColumns: ["line_user_id"]
          },
        ]
      }
      driver_profiles: {
        Row: {
          created_at: string
          deleted_at: string | null
          driver_name: string
          id: string
          id_card: string
          line_user_id: string | null
          phone: string
          updated_at: string
          user_id: string
          vehicle_plate_code: string
          vehicle_plate_province: string
          vehicle_plate_text: string
          vehicle_type_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          driver_name: string
          id?: string
          id_card: string
          line_user_id?: string | null
          phone: string
          updated_at?: string
          user_id: string
          vehicle_plate_code: string
          vehicle_plate_province: string
          vehicle_plate_text: string
          vehicle_type_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          driver_name?: string
          id?: string
          id_card?: string
          line_user_id?: string | null
          phone?: string
          updated_at?: string
          user_id?: string
          vehicle_plate_code?: string
          vehicle_plate_province?: string
          vehicle_plate_text?: string
          vehicle_type_id?: string
        }
        Relationships: []
      }
      equipment_assets: {
        Row: {
          asset_code: string
          box_password: string | null
          created_at: string
          current_status: string
          id: string
          imei: string | null
          last_ticket_trigger_hours: number
          name: string
          sim_number: string | null
          total_engine_hours: number
          updated_at: string
        }
        Insert: {
          asset_code: string
          box_password?: string | null
          created_at?: string
          current_status?: string
          id?: string
          imei?: string | null
          last_ticket_trigger_hours?: number
          name: string
          sim_number?: string | null
          total_engine_hours?: number
          updated_at?: string
        }
        Update: {
          asset_code?: string
          box_password?: string | null
          created_at?: string
          current_status?: string
          id?: string
          imei?: string | null
          last_ticket_trigger_hours?: number
          name?: string
          sim_number?: string | null
          total_engine_hours?: number
          updated_at?: string
        }
        Relationships: []
      }
      equipment_telemetry_pings: {
        Row: {
          created_at: string
          engine_running: boolean
          equipment_id: string
          id: string
          raw_payload: Json | null
          recorded_at: string
          vcc_voltage: number | null
        }
        Insert: {
          created_at?: string
          engine_running: boolean
          equipment_id: string
          id?: string
          raw_payload?: Json | null
          recorded_at: string
          vcc_voltage?: number | null
        }
        Update: {
          created_at?: string
          engine_running?: boolean
          equipment_id?: string
          id?: string
          raw_payload?: Json | null
          recorded_at?: string
          vcc_voltage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_telemetry_pings_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_requests: {
        Row: {
          acquired_evidence_ref: Json | null
          attempt: number
          correlation_id: string
          created_at: string
          evidence_type: string
          id: string
          last_attempt_at: string | null
          reason: string | null
          requested_period_end: string
          requested_period_start: string
          source_event_id: string
          status: string
          updated_at: string
        }
        Insert: {
          acquired_evidence_ref?: Json | null
          attempt?: number
          correlation_id: string
          created_at?: string
          evidence_type: string
          id?: string
          last_attempt_at?: string | null
          reason?: string | null
          requested_period_end: string
          requested_period_start: string
          source_event_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          acquired_evidence_ref?: Json | null
          attempt?: number
          correlation_id?: string
          created_at?: string
          evidence_type?: string
          id?: string
          last_attempt_at?: string | null
          reason?: string | null
          requested_period_end?: string
          requested_period_start?: string
          source_event_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      file_existence_registry: {
        Row: {
          active_or_duplicate: string
          canonical_path: string | null
          content_hash: string | null
          created_at: string
          dependencies: Json
          exports: Json
          file_type: string
          generation_recipe: string | null
          git_state: string
          id: string
          imports: Json
          last_known_snapshot_hash: string | null
          last_seen_at: string
          owning_module: string | null
          owning_session: string | null
          path: string
          purpose: string | null
          recoverability: string
          registration_state: string
          route: string | null
          size_bytes: number | null
          source_of_truth: string | null
          updated_at: string
        }
        Insert: {
          active_or_duplicate?: string
          canonical_path?: string | null
          content_hash?: string | null
          created_at?: string
          dependencies?: Json
          exports?: Json
          file_type?: string
          generation_recipe?: string | null
          git_state?: string
          id?: string
          imports?: Json
          last_known_snapshot_hash?: string | null
          last_seen_at?: string
          owning_module?: string | null
          owning_session?: string | null
          path: string
          purpose?: string | null
          recoverability?: string
          registration_state?: string
          route?: string | null
          size_bytes?: number | null
          source_of_truth?: string | null
          updated_at?: string
        }
        Update: {
          active_or_duplicate?: string
          canonical_path?: string | null
          content_hash?: string | null
          created_at?: string
          dependencies?: Json
          exports?: Json
          file_type?: string
          generation_recipe?: string | null
          git_state?: string
          id?: string
          imports?: Json
          last_known_snapshot_hash?: string | null
          last_seen_at?: string
          owning_module?: string | null
          owning_session?: string | null
          path?: string
          purpose?: string | null
          recoverability?: string
          registration_state?: string
          route?: string | null
          size_bytes?: number | null
          source_of_truth?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      file_snapshots: {
        Row: {
          command: string | null
          content_hash: string
          created_at: string
          is_secret: boolean
          original_path: string
          reason: string | null
          registry_references: Json
          related_module: string | null
          session_id: string | null
          size_bytes: number
          storage_path: string
        }
        Insert: {
          command?: string | null
          content_hash: string
          created_at?: string
          is_secret?: boolean
          original_path: string
          reason?: string | null
          registry_references?: Json
          related_module?: string | null
          session_id?: string | null
          size_bytes: number
          storage_path: string
        }
        Update: {
          command?: string | null
          content_hash?: string
          created_at?: string
          is_secret?: boolean
          original_path?: string
          reason?: string | null
          registry_references?: Json
          related_module?: string | null
          session_id?: string | null
          size_bytes?: number
          storage_path?: string
        }
        Relationships: []
      }
      fuel_price_log: {
        Row: {
          effective_date: string | null
          fetched_at: string
          id: string
          oil_name: string
          price: number
          source: string
        }
        Insert: {
          effective_date?: string | null
          fetched_at?: string
          id?: string
          oil_name: string
          price: number
          source?: string
        }
        Update: {
          effective_date?: string | null
          fetched_at?: string
          id?: string
          oil_name?: string
          price?: number
          source?: string
        }
        Relationships: []
      }
      github_sync_log: {
        Row: {
          commit_sha: string | null
          direction: string
          error: string | null
          files_changed: Json
          finished_at: string | null
          id: string
          started_at: string
          status: string
          sync_path_id: string
          triggered_by_admin_id: string | null
        }
        Insert: {
          commit_sha?: string | null
          direction: string
          error?: string | null
          files_changed?: Json
          finished_at?: string | null
          id?: string
          started_at?: string
          status: string
          sync_path_id: string
          triggered_by_admin_id?: string | null
        }
        Update: {
          commit_sha?: string | null
          direction?: string
          error?: string | null
          files_changed?: Json
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          sync_path_id?: string
          triggered_by_admin_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "github_sync_log_sync_path_id_fkey"
            columns: ["sync_path_id"]
            isOneToOne: false
            referencedRelation: "github_sync_paths"
            referencedColumns: ["id"]
          },
        ]
      }
      github_sync_paths: {
        Row: {
          branch: string
          connector_id: string
          created_at: string
          created_by_admin_id: string | null
          direction: string
          enabled: boolean
          id: string
          last_error: string | null
          last_synced_at: string | null
          last_synced_commit_sha: string | null
          source_path: string
          sync_status: string
          target_path: string
          updated_at: string
        }
        Insert: {
          branch?: string
          connector_id: string
          created_at?: string
          created_by_admin_id?: string | null
          direction?: string
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          last_synced_commit_sha?: string | null
          source_path: string
          sync_status?: string
          target_path: string
          updated_at?: string
        }
        Update: {
          branch?: string
          connector_id?: string
          created_at?: string
          created_by_admin_id?: string | null
          direction?: string
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          last_synced_commit_sha?: string | null
          source_path?: string
          sync_status?: string
          target_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_sync_paths_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "connectors"
            referencedColumns: ["id"]
          },
        ]
      }
      identities: {
        Row: {
          auth_user_id: string | null
          created_at: string
          display_name: string | null
          email: string
          identity_id: string
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          identity_id?: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          identity_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      identity_account_workspaces: {
        Row: {
          account_id: string
          created_at: string
          display_name: string
          slug: string
          world: string
        }
        Insert: {
          account_id?: string
          created_at?: string
          display_name: string
          slug: string
          world: string
        }
        Update: {
          account_id?: string
          created_at?: string
          display_name?: string
          slug?: string
          world?: string
        }
        Relationships: []
      }
      identity_memberships: {
        Row: {
          account_id: string
          granted_at: string
          identity_id: string
          membership_id: string
          revoked_at: string | null
          role: string
          world: string
        }
        Insert: {
          account_id: string
          granted_at?: string
          identity_id: string
          membership_id?: string
          revoked_at?: string | null
          role: string
          world: string
        }
        Update: {
          account_id?: string
          granted_at?: string
          identity_id?: string
          membership_id?: string
          revoked_at?: string | null
          role?: string
          world?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_memberships_world_matches_account"
            columns: ["account_id", "world"]
            isOneToOne: false
            referencedRelation: "identity_account_workspaces"
            referencedColumns: ["account_id", "world"]
          },
        ]
      }
      integration_gateway_events: {
        Row: {
          action: string
          capability: string
          change_id: string | null
          channel: string
          event_id: string
          evidence: Json
          id: string
          occurred_at: string
          provider: string
          received_at: string
          requested_effect: string
          requires_owner_approval: boolean
          session_id: string | null
        }
        Insert: {
          action: string
          capability: string
          change_id?: string | null
          channel: string
          event_id: string
          evidence?: Json
          id?: string
          occurred_at: string
          provider: string
          received_at?: string
          requested_effect?: string
          requires_owner_approval?: boolean
          session_id?: string | null
        }
        Update: {
          action?: string
          capability?: string
          change_id?: string | null
          channel?: string
          event_id?: string
          evidence?: Json
          id?: string
          occurred_at?: string
          provider?: string
          received_at?: string
          requested_effect?: string
          requires_owner_approval?: boolean
          session_id?: string | null
        }
        Relationships: []
      }
      integration_gateway_proposals: {
        Row: {
          capability: string
          decided_at: string | null
          decided_by: string | null
          event_id: string
          evidence: Json
          id: string
          proposed_at: string
          provider: string
          requested_effect: string
          run_result: Json | null
          status: string
        }
        Insert: {
          capability: string
          decided_at?: string | null
          decided_by?: string | null
          event_id: string
          evidence?: Json
          id?: string
          proposed_at?: string
          provider: string
          requested_effect: string
          run_result?: Json | null
          status?: string
        }
        Update: {
          capability?: string
          decided_at?: string | null
          decided_by?: string | null
          event_id?: string
          evidence?: Json
          id?: string
          proposed_at?: string
          provider?: string
          requested_effect?: string
          run_result?: Json | null
          status?: string
        }
        Relationships: []
      }
      invoice_items: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_total: number
          qty: number
          sort_order: number
          unit: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          line_total?: number
          qty?: number
          sort_order?: number
          unit?: string
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_total?: number
          qty?: number
          sort_order?: number
          unit?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          customer_company_id: string
          customer_order_id: string | null
          due_date: string | null
          id: string
          invoice_date: string
          invoice_no: string
          invoice_status: Database["public"]["Enums"]["InvoiceStatus"]
          notes: string | null
          paid_amount: number
          project_id: string | null
          receipt_issued_at: string | null
          receipt_no: string | null
          recipient_address: string | null
          reference_no: string | null
          subtotal: number
          total_amount: number
          updated_at: string
          vat_amount: number
          vat_rate: number
        }
        Insert: {
          created_at?: string
          customer_company_id: string
          customer_order_id?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_no: string
          invoice_status?: Database["public"]["Enums"]["InvoiceStatus"]
          notes?: string | null
          paid_amount?: number
          project_id?: string | null
          receipt_issued_at?: string | null
          receipt_no?: string | null
          recipient_address?: string | null
          reference_no?: string | null
          subtotal: number
          total_amount: number
          updated_at: string
          vat_amount: number
          vat_rate?: number
        }
        Update: {
          created_at?: string
          customer_company_id?: string
          customer_order_id?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_no?: string
          invoice_status?: Database["public"]["Enums"]["InvoiceStatus"]
          notes?: string | null
          paid_amount?: number
          project_id?: string | null
          receipt_issued_at?: string | null
          receipt_no?: string | null
          recipient_address?: string | null
          reference_no?: string | null
          subtotal?: number
          total_amount?: number
          updated_at?: string
          vat_amount?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_company_id_fkey"
            columns: ["customer_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_order_id_fkey"
            columns: ["customer_order_id"]
            isOneToOne: false
            referencedRelation: "customer_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          actual_quantity: number
          assigned_person_id: string | null
          contact_line: string | null
          contact_name: string | null
          contact_phone: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          delivered_quantity: number
          distance_km: number
          end_date: string | null
          external_material_price_per_cubic: number | null
          external_pit_name: string | null
          formatted_address: string | null
          id: string
          is_urgent: boolean
          job_status: string
          material_type_id: string
          note: string | null
          partner_id: string | null
          pit_profile_id: string
          pit_source_type: string
          place_name: string | null
          project_name: string
          required_quantity: number
          site_address: string | null
          site_details: string | null
          site_geom: unknown
          site_latitude: number | null
          site_longitude: number | null
          site_receiver_name: string | null
          site_receiver_phone: string | null
          start_date: string
          updated_at: string
        }
        Insert: {
          actual_quantity: number
          assigned_person_id?: string | null
          contact_line?: string | null
          contact_name?: string | null
          contact_phone: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          delivered_quantity?: number
          distance_km: number
          end_date?: string | null
          external_material_price_per_cubic?: number | null
          external_pit_name?: string | null
          formatted_address?: string | null
          id?: string
          is_urgent?: boolean
          job_status: string
          material_type_id: string
          note?: string | null
          partner_id?: string | null
          pit_profile_id: string
          pit_source_type: string
          place_name?: string | null
          project_name: string
          required_quantity: number
          site_address?: string | null
          site_details?: string | null
          site_geom?: unknown
          site_latitude?: number | null
          site_longitude?: number | null
          site_receiver_name?: string | null
          site_receiver_phone?: string | null
          start_date: string
          updated_at?: string
        }
        Update: {
          actual_quantity?: number
          assigned_person_id?: string | null
          contact_line?: string | null
          contact_name?: string | null
          contact_phone?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          delivered_quantity?: number
          distance_km?: number
          end_date?: string | null
          external_material_price_per_cubic?: number | null
          external_pit_name?: string | null
          formatted_address?: string | null
          id?: string
          is_urgent?: boolean
          job_status?: string
          material_type_id?: string
          note?: string | null
          partner_id?: string | null
          pit_profile_id?: string
          pit_source_type?: string
          place_name?: string | null
          project_name?: string
          required_quantity?: number
          site_address?: string | null
          site_details?: string | null
          site_geom?: unknown
          site_latitude?: number | null
          site_longitude?: number | null
          site_receiver_name?: string | null
          site_receiver_phone?: string | null
          start_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      line_channels: {
        Row: {
          channel_access_token: string
          channel_id: string
          channel_secret: string
          created_at: string
          label: string
        }
        Insert: {
          channel_access_token: string
          channel_id: string
          channel_secret: string
          created_at?: string
          label: string
        }
        Update: {
          channel_access_token?: string
          channel_id?: string
          channel_secret?: string
          created_at?: string
          label?: string
        }
        Relationships: []
      }
      line_conversation_controls: {
        Row: {
          assigned_to: string | null
          created_at: string
          detected_line_event_id: string | null
          line_user_id: string
          mode: string
          reason: string | null
          resolved_at: string | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          detected_line_event_id?: string | null
          line_user_id: string
          mode?: string
          reason?: string | null
          resolved_at?: string | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          detected_line_event_id?: string | null
          line_user_id?: string
          mode?: string
          reason?: string | null
          resolved_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_conversation_controls_detected_line_event_id_fkey"
            columns: ["detected_line_event_id"]
            isOneToOne: false
            referencedRelation: "line_events"
            referencedColumns: ["id"]
          },
        ]
      }
      line_customer_memory: {
        Row: {
          avg_response_gap_minutes: number | null
          last_message_at: string | null
          line_user_id: string
          message_count: number
          notes: string
          updated_at: string
        }
        Insert: {
          avg_response_gap_minutes?: number | null
          last_message_at?: string | null
          line_user_id: string
          message_count?: number
          notes?: string
          updated_at?: string
        }
        Update: {
          avg_response_gap_minutes?: number | null
          last_message_at?: string | null
          line_user_id?: string
          message_count?: number
          notes?: string
          updated_at?: string
        }
        Relationships: []
      }
      line_events: {
        Row: {
          admin_note: string | null
          ai_model: string | null
          ai_summary: string | null
          confidence: number | null
          created_at: string
          direction: string
          event_timestamp: string | null
          event_type: string | null
          extracted: Json | null
          group_id: string | null
          id: string
          line_message_id: string | null
          line_name: string | null
          line_picture: string | null
          line_user_id: string | null
          line_webhook_event_id: string | null
          media_path: string | null
          raw_file_url: string | null
          raw_json: Json | null
          raw_text: string | null
          raw_type: string
          reply_token: string | null
          reviewed_at: string | null
          status: string
          tokens_used: number | null
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          ai_model?: string | null
          ai_summary?: string | null
          confidence?: number | null
          created_at?: string
          direction?: string
          event_timestamp?: string | null
          event_type?: string | null
          extracted?: Json | null
          group_id?: string | null
          id?: string
          line_message_id?: string | null
          line_name?: string | null
          line_picture?: string | null
          line_user_id?: string | null
          line_webhook_event_id?: string | null
          media_path?: string | null
          raw_file_url?: string | null
          raw_json?: Json | null
          raw_text?: string | null
          raw_type: string
          reply_token?: string | null
          reviewed_at?: string | null
          status?: string
          tokens_used?: number | null
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          ai_model?: string | null
          ai_summary?: string | null
          confidence?: number | null
          created_at?: string
          direction?: string
          event_timestamp?: string | null
          event_type?: string | null
          extracted?: Json | null
          group_id?: string | null
          id?: string
          line_message_id?: string | null
          line_name?: string | null
          line_picture?: string | null
          line_user_id?: string | null
          line_webhook_event_id?: string | null
          media_path?: string | null
          raw_file_url?: string | null
          raw_json?: Json | null
          raw_text?: string | null
          raw_type?: string
          reply_token?: string | null
          reviewed_at?: string | null
          status?: string
          tokens_used?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      line_outbound_drafts: {
        Row: {
          company_id: string | null
          context: Json | null
          created_at: string
          final_text: string | null
          id: string
          line_user_id: string
          proposed_text: string
          reason: string
          reviewed_at: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          company_id?: string | null
          context?: Json | null
          created_at?: string
          final_text?: string | null
          id?: string
          line_user_id: string
          proposed_text: string
          reason: string
          reviewed_at?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          company_id?: string | null
          context?: Json | null
          created_at?: string
          final_text?: string | null
          id?: string
          line_user_id?: string
          proposed_text?: string
          reason?: string
          reviewed_at?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_outbound_drafts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      line_profiles: {
        Row: {
          company_id: string | null
          created_at: string
          department: string | null
          display_name: string | null
          line_user_id: string
          notes: string | null
          permissions: Json
          role: string
          trust_level: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          department?: string | null
          display_name?: string | null
          line_user_id: string
          notes?: string | null
          permissions?: Json
          role?: string
          trust_level?: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          department?: string | null
          display_name?: string | null
          line_user_id?: string
          notes?: string | null
          permissions?: Json
          role?: string
          trust_level?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      live_commands: {
        Row: {
          command_text: string
          created_at: string
          id: string
          line_user_id: string
          navigate_url: string | null
          reply_text: string | null
          workspace: Json | null
        }
        Insert: {
          command_text: string
          created_at?: string
          id?: string
          line_user_id: string
          navigate_url?: string | null
          reply_text?: string | null
          workspace?: Json | null
        }
        Update: {
          command_text?: string
          created_at?: string
          id?: string
          line_user_id?: string
          navigate_url?: string | null
          reply_text?: string | null
          workspace?: Json | null
        }
        Relationships: []
      }
      maintenance_tickets: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          equipment_id: string
          id: string
          opened_at: string
          overdue_locked: boolean
          overdue_locked_at: string | null
          status: string
          trigger_hours: number
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          equipment_id: string
          id?: string
          opened_at?: string
          overdue_locked?: boolean
          overdue_locked_at?: string | null
          status?: string
          trigger_hours: number
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          equipment_id?: string
          id?: string
          opened_at?: string
          overdue_locked?: boolean
          overdue_locked_at?: string | null
          status?: string
          trigger_hours?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_tickets_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      material_types: {
        Row: {
          created_at: string
          deleted_at: string | null
          density_ton_per_cbm: number | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          density_ton_per_cbm?: number | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          density_ton_per_cbm?: number | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      owner_auth_audit_log: {
        Row: {
          audit_id: string
          auth_method: string
          detail: Json | null
          device_id: string | null
          event: string
          occurred_at: string
          owner_identity_id: string | null
        }
        Insert: {
          audit_id?: string
          auth_method: string
          detail?: Json | null
          device_id?: string | null
          event: string
          occurred_at?: string
          owner_identity_id?: string | null
        }
        Update: {
          audit_id?: string
          auth_method?: string
          detail?: Json | null
          device_id?: string | null
          event?: string
          occurred_at?: string
          owner_identity_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_auth_audit_log_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "owner_devices"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "owner_auth_audit_log_owner_identity_id_fkey"
            columns: ["owner_identity_id"]
            isOneToOne: false
            referencedRelation: "identities"
            referencedColumns: ["identity_id"]
          },
        ]
      }
      owner_devices: {
        Row: {
          created_at: string
          device_id: string
          device_label: string
          last_seen_at: string | null
          owner_identity_id: string
          platform: string | null
          revoked_at: string | null
          trust_state: Database["public"]["Enums"]["owner_device_trust_state"]
          trust_state_changed_at: string
        }
        Insert: {
          created_at?: string
          device_id?: string
          device_label: string
          last_seen_at?: string | null
          owner_identity_id: string
          platform?: string | null
          revoked_at?: string | null
          trust_state?: Database["public"]["Enums"]["owner_device_trust_state"]
          trust_state_changed_at?: string
        }
        Update: {
          created_at?: string
          device_id?: string
          device_label?: string
          last_seen_at?: string | null
          owner_identity_id?: string
          platform?: string | null
          revoked_at?: string | null
          trust_state?: Database["public"]["Enums"]["owner_device_trust_state"]
          trust_state_changed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_devices_owner_identity_id_fkey"
            columns: ["owner_identity_id"]
            isOneToOne: false
            referencedRelation: "identities"
            referencedColumns: ["identity_id"]
          },
        ]
      }
      owner_passkey_credentials: {
        Row: {
          auth_user_id: string
          counter: number
          created_at: string
          credential_id: string
          device_id: string | null
          device_label: string
          id: string
          last_used_at: string | null
          owner_identity_id: string | null
          public_key: string
          revoked_at: string | null
          transports: string[]
        }
        Insert: {
          auth_user_id: string
          counter?: number
          created_at?: string
          credential_id: string
          device_id?: string | null
          device_label: string
          id?: string
          last_used_at?: string | null
          owner_identity_id?: string | null
          public_key: string
          revoked_at?: string | null
          transports?: string[]
        }
        Update: {
          auth_user_id?: string
          counter?: number
          created_at?: string
          credential_id?: string
          device_id?: string | null
          device_label?: string
          id?: string
          last_used_at?: string | null
          owner_identity_id?: string | null
          public_key?: string
          revoked_at?: string | null
          transports?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "owner_passkey_credentials_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "owner_devices"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "owner_passkey_credentials_owner_identity_id_fkey"
            columns: ["owner_identity_id"]
            isOneToOne: false
            referencedRelation: "identities"
            referencedColumns: ["identity_id"]
          },
        ]
      }
      owner_qr_login_sessions: {
        Row: {
          approved_at: string | null
          approved_by_auth_user_id: string | null
          consumed_at: string | null
          created_at: string
          expires_at: string
          status: string
          token: string
        }
        Insert: {
          approved_at?: string | null
          approved_by_auth_user_id?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          status?: string
          token: string
        }
        Update: {
          approved_at?: string | null
          approved_by_auth_user_id?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          status?: string
          token?: string
        }
        Relationships: []
      }
      partner_payable_requests: {
        Row: {
          amount: number
          bank_email_verified: boolean
          business_event_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          id: string
          owner_acknowledged_at: string | null
          owner_notified_at: string | null
          paid_line_event_id: string | null
          partner_company_id: string | null
          partner_line_user_id: string | null
          partner_name: string
          status: string
        }
        Insert: {
          amount: number
          bank_email_verified?: boolean
          business_event_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          owner_acknowledged_at?: string | null
          owner_notified_at?: string | null
          paid_line_event_id?: string | null
          partner_company_id?: string | null
          partner_line_user_id?: string | null
          partner_name: string
          status?: string
        }
        Update: {
          amount?: number
          bank_email_verified?: boolean
          business_event_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          owner_acknowledged_at?: string | null
          owner_notified_at?: string | null
          paid_line_event_id?: string | null
          partner_company_id?: string | null
          partner_line_user_id?: string | null
          partner_name?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_payable_requests_business_event_id_fkey"
            columns: ["business_event_id"]
            isOneToOne: false
            referencedRelation: "business_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_payable_requests_paid_line_event_id_fkey"
            columns: ["paid_line_event_id"]
            isOneToOne: false
            referencedRelation: "line_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_payable_requests_partner_company_id_fkey"
            columns: ["partner_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_authorizations: {
        Row: {
          business_event_id: string | null
          claimant_description: string | null
          claimant_line_user_id: string
          company_id: string
          created_at: string
          id: string
          request_description: string
          resolved_at: string | null
          responsible_line_user_id: string
          status: string
        }
        Insert: {
          business_event_id?: string | null
          claimant_description?: string | null
          claimant_line_user_id: string
          company_id: string
          created_at?: string
          id?: string
          request_description: string
          resolved_at?: string | null
          responsible_line_user_id: string
          status?: string
        }
        Update: {
          business_event_id?: string | null
          claimant_description?: string | null
          claimant_line_user_id?: string
          company_id?: string
          created_at?: string
          id?: string
          request_description?: string
          resolved_at?: string | null
          responsible_line_user_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_authorizations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      pit_materials: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          id: string
          material_type_id: string
          pit_profile_id: string
          price: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          id: string
          material_type_id: string
          pit_profile_id: string
          price: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          material_type_id?: string
          pit_profile_id?: string
          price?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pit_materials_material_type_id_fkey"
            columns: ["material_type_id"]
            isOneToOne: false
            referencedRelation: "material_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pit_materials_pit_profile_id_fkey"
            columns: ["pit_profile_id"]
            isOneToOne: false
            referencedRelation: "pit_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pit_price_requests: {
        Row: {
          created_at: string
          id: string
          line_user_id: string
          material_type_id: string
          pit_profile_id: string
          replied_at: string | null
          reply_price: number | null
          reply_text: string | null
          requested_by: string
          requested_quantity: number | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          line_user_id: string
          material_type_id: string
          pit_profile_id: string
          replied_at?: string | null
          reply_price?: number | null
          reply_text?: string | null
          requested_by: string
          requested_quantity?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          line_user_id?: string
          material_type_id?: string
          pit_profile_id?: string
          replied_at?: string | null
          reply_price?: number | null
          reply_text?: string | null
          requested_by?: string
          requested_quantity?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pit_price_requests_material_type_id_fkey"
            columns: ["material_type_id"]
            isOneToOne: false
            referencedRelation: "material_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pit_price_requests_pit_profile_id_fkey"
            columns: ["pit_profile_id"]
            isOneToOne: false
            referencedRelation: "pit_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pit_profiles: {
        Row: {
          address: string | null
          bank_account_number: string | null
          bank_name: string | null
          contact_name: string | null
          created_at: string | null
          deleted_at: string | null
          district_id: string | null
          entity_type: string | null
          formatted_address: string | null
          geom: unknown
          id: string
          is_open: boolean
          large_vehicle_accessible: boolean
          latitude: number | null
          line_user_id: string | null
          longitude: number | null
          owner_type: string | null
          phone: string | null
          pit_name: string
          place_name: string | null
          province_id: string | null
          registered_name: string | null
          sub_district_id: string | null
          taxpayer_id: string | null
          updated_at: string | null
          user_id: string | null
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          contact_name?: string | null
          created_at?: string | null
          deleted_at?: string | null
          district_id?: string | null
          entity_type?: string | null
          formatted_address?: string | null
          geom?: unknown
          id: string
          is_open?: boolean
          large_vehicle_accessible?: boolean
          latitude?: number | null
          line_user_id?: string | null
          longitude?: number | null
          owner_type?: string | null
          phone?: string | null
          pit_name: string
          place_name?: string | null
          province_id?: string | null
          registered_name?: string | null
          sub_district_id?: string | null
          taxpayer_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          contact_name?: string | null
          created_at?: string | null
          deleted_at?: string | null
          district_id?: string | null
          entity_type?: string | null
          formatted_address?: string | null
          geom?: unknown
          id?: string
          is_open?: boolean
          large_vehicle_accessible?: boolean
          latitude?: number | null
          line_user_id?: string | null
          longitude?: number | null
          owner_type?: string | null
          phone?: string | null
          pit_name?: string
          place_name?: string | null
          province_id?: string | null
          registered_name?: string | null
          sub_district_id?: string | null
          taxpayer_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      print_jobs: {
        Row: {
          amount_expected: number | null
          amount_paid: number | null
          copies: number
          created_at: string
          document_kind: string | null
          id: string
          line_user_id: string
          media_path: string
          notified_at: string | null
          paid_at: string | null
          payment_method: string | null
          payment_verified: boolean
          print_error: string | null
          printed_at: string | null
          status: string
        }
        Insert: {
          amount_expected?: number | null
          amount_paid?: number | null
          copies?: number
          created_at?: string
          document_kind?: string | null
          id?: string
          line_user_id: string
          media_path: string
          notified_at?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_verified?: boolean
          print_error?: string | null
          printed_at?: string | null
          status?: string
        }
        Update: {
          amount_expected?: number | null
          amount_paid?: number | null
          copies?: number
          created_at?: string
          document_kind?: string | null
          id?: string
          line_user_id?: string
          media_path?: string
          notified_at?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_verified?: boolean
          print_error?: string | null
          printed_at?: string | null
          status?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          customer_company_id: string
          customer_site_id: string
          id: string
          project_no: string
          status: Database["public"]["Enums"]["ProjectStatus"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_company_id: string
          customer_site_id: string
          id?: string
          project_no: string
          status?: Database["public"]["Enums"]["ProjectStatus"]
          title: string
          updated_at: string
        }
        Update: {
          created_at?: string
          customer_company_id?: string
          customer_site_id?: string
          id?: string
          project_no?: string
          status?: Database["public"]["Enums"]["ProjectStatus"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_customer_company_id_fkey"
            columns: ["customer_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_customer_site_id_fkey"
            columns: ["customer_site_id"]
            isOneToOne: false
            referencedRelation: "customer_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_documents: {
        Row: {
          amount: number | null
          confidence: number | null
          confirmed_by: string | null
          created_at: string
          customer_company_id: string | null
          description: string | null
          document_date: string | null
          document_type: string
          error_th: string | null
          id: string
          line_event_id: string | null
          matched_debt_event_id: string | null
          media_path: string | null
          payment_method: string | null
          payment_verified: boolean
          raw_ocr_text: string | null
          receiving_account_name: string | null
          receiving_account_number: string | null
          receiving_bank: string | null
          reference_number: string | null
          sender_account_number: string | null
          sender_bank: string | null
          sender_name: string | null
          status: string
          transaction_datetime: string | null
          updated_at: string
          vendor_name: string | null
          verification_level: number
        }
        Insert: {
          amount?: number | null
          confidence?: number | null
          confirmed_by?: string | null
          created_at?: string
          customer_company_id?: string | null
          description?: string | null
          document_date?: string | null
          document_type?: string
          error_th?: string | null
          id?: string
          line_event_id?: string | null
          matched_debt_event_id?: string | null
          media_path?: string | null
          payment_method?: string | null
          payment_verified?: boolean
          raw_ocr_text?: string | null
          receiving_account_name?: string | null
          receiving_account_number?: string | null
          receiving_bank?: string | null
          reference_number?: string | null
          sender_account_number?: string | null
          sender_bank?: string | null
          sender_name?: string | null
          status?: string
          transaction_datetime?: string | null
          updated_at?: string
          vendor_name?: string | null
          verification_level?: number
        }
        Update: {
          amount?: number | null
          confidence?: number | null
          confirmed_by?: string | null
          created_at?: string
          customer_company_id?: string | null
          description?: string | null
          document_date?: string | null
          document_type?: string
          error_th?: string | null
          id?: string
          line_event_id?: string | null
          matched_debt_event_id?: string | null
          media_path?: string | null
          payment_method?: string | null
          payment_verified?: boolean
          raw_ocr_text?: string | null
          receiving_account_name?: string | null
          receiving_account_number?: string | null
          receiving_bank?: string | null
          reference_number?: string | null
          sender_account_number?: string | null
          sender_bank?: string | null
          sender_name?: string | null
          status?: string
          transaction_datetime?: string | null
          updated_at?: string
          vendor_name?: string | null
          verification_level?: number
        }
        Relationships: [
          {
            foreignKeyName: "receipt_documents_customer_company_id_fkey"
            columns: ["customer_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_documents_line_event_id_fkey"
            columns: ["line_event_id"]
            isOneToOne: false
            referencedRelation: "line_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_documents_matched_debt_event_id_fkey"
            columns: ["matched_debt_event_id"]
            isOneToOne: false
            referencedRelation: "debt_events"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_migration_blocks: {
        Row: {
          blocking_dependent: string
          created_at: string
          dependency_kind: string
          id: string
          plan_id: string | null
          reason: string
          resource_path: string
        }
        Insert: {
          blocking_dependent: string
          created_at?: string
          dependency_kind: string
          id?: string
          plan_id?: string | null
          reason: string
          resource_path: string
        }
        Update: {
          blocking_dependent?: string
          created_at?: string
          dependency_kind?: string
          id?: string
          plan_id?: string | null
          reason?: string
          resource_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_migration_blocks_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "resource_migration_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_migration_plans: {
        Row: {
          approved: boolean
          approved_at: string | null
          approved_by: string | null
          correlation_id: string
          created_at: string
          dependency_count: number
          dependents: Json
          id: string
          requested_by: string
          resource_path: string
          resource_type: string
          safe: boolean
          status: string
        }
        Insert: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          correlation_id: string
          created_at?: string
          dependency_count?: number
          dependents?: Json
          id?: string
          requested_by: string
          resource_path: string
          resource_type: string
          safe: boolean
          status?: string
        }
        Update: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          correlation_id?: string
          created_at?: string
          dependency_count?: number
          dependents?: Json
          id?: string
          requested_by?: string
          resource_path?: string
          resource_type?: string
          safe?: boolean
          status?: string
        }
        Relationships: []
      }
      schema_change_log: {
        Row: {
          client_addr: unknown
          command_tag: string
          executed_by: string
          id: number
          object_identity: string | null
          object_type: string | null
          occurred_at: string
          phase: string
        }
        Insert: {
          client_addr?: unknown
          command_tag: string
          executed_by?: string
          id?: never
          object_identity?: string | null
          object_type?: string | null
          occurred_at?: string
          phase: string
        }
        Update: {
          client_addr?: unknown
          command_tag?: string
          executed_by?: string
          id?: never
          object_identity?: string | null
          object_type?: string | null
          occurred_at?: string
          phase?: string
        }
        Relationships: []
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      standalone_document_items: {
        Row: {
          created_at: string
          description: string
          document_id: string
          id: string
          qty: number
          sort_order: number
          unit: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          document_id: string
          id?: string
          qty?: number
          sort_order?: number
          unit?: string
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string
          document_id?: string
          id?: string
          qty?: number
          sort_order?: number
          unit?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "standalone_document_items_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "standalone_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      standalone_documents: {
        Row: {
          created_at: string
          customer_company_id: string | null
          customer_order_id: string | null
          document_date: string
          document_no: string
          document_type: Database["public"]["Enums"]["DocumentType"]
          id: string
          notes: string | null
          partner_company_id: string | null
          project_id: string | null
          recipient_address: string | null
          reference_no: string | null
          source_debt_event_id: string | null
          status: string
          subtotal: number
          superseded_by_document_id: string | null
          total_amount: number
          updated_at: string
          vat_amount: number
          vat_rate: number
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          created_at?: string
          customer_company_id?: string | null
          customer_order_id?: string | null
          document_date: string
          document_no: string
          document_type: Database["public"]["Enums"]["DocumentType"]
          id?: string
          notes?: string | null
          partner_company_id?: string | null
          project_id?: string | null
          recipient_address?: string | null
          reference_no?: string | null
          source_debt_event_id?: string | null
          status?: string
          subtotal: number
          superseded_by_document_id?: string | null
          total_amount: number
          updated_at: string
          vat_amount: number
          vat_rate?: number
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          created_at?: string
          customer_company_id?: string | null
          customer_order_id?: string | null
          document_date?: string
          document_no?: string
          document_type?: Database["public"]["Enums"]["DocumentType"]
          id?: string
          notes?: string | null
          partner_company_id?: string | null
          project_id?: string | null
          recipient_address?: string | null
          reference_no?: string | null
          source_debt_event_id?: string | null
          status?: string
          subtotal?: number
          superseded_by_document_id?: string | null
          total_amount?: number
          updated_at?: string
          vat_amount?: number
          vat_rate?: number
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "standalone_documents_customer_company_id_fkey"
            columns: ["customer_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standalone_documents_customer_order_id_fkey"
            columns: ["customer_order_id"]
            isOneToOne: false
            referencedRelation: "customer_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standalone_documents_partner_company_id_fkey"
            columns: ["partner_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standalone_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standalone_documents_source_debt_event_id_fkey"
            columns: ["source_debt_event_id"]
            isOneToOne: false
            referencedRelation: "debt_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standalone_documents_superseded_by_document_id_fkey"
            columns: ["superseded_by_document_id"]
            isOneToOne: false
            referencedRelation: "standalone_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_actions: {
        Row: {
          action: string
          actor: string
          correlation_id: string
          created_at: string
          from_path: string
          id: string
          operation_id: string
          plan_id: string | null
          reason: string | null
          resource_id: string
          trash_path: string | null
        }
        Insert: {
          action: string
          actor: string
          correlation_id: string
          created_at?: string
          from_path: string
          id?: string
          operation_id: string
          plan_id?: string | null
          reason?: string | null
          resource_id: string
          trash_path?: string | null
        }
        Update: {
          action?: string
          actor?: string
          correlation_id?: string
          created_at?: string
          from_path?: string
          id?: string
          operation_id?: string
          plan_id?: string | null
          reason?: string | null
          resource_id?: string
          trash_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "storage_actions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "storage_reclaim_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_actions_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "storage_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_classifications: {
        Row: {
          blocked_reason: string | null
          classification: string
          classified_at: string
          confidence: number
          id: string
          recommended_action: string
          resource_id: string
        }
        Insert: {
          blocked_reason?: string | null
          classification: string
          classified_at?: string
          confidence: number
          id?: string
          recommended_action: string
          resource_id: string
        }
        Update: {
          blocked_reason?: string | null
          classification?: string
          classified_at?: string
          confidence?: number
          id?: string
          recommended_action?: string
          resource_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "storage_classifications_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "storage_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_evidence: {
        Row: {
          collected_at: string
          detail: string
          id: string
          kind: string
          resource_id: string
          value: string | null
        }
        Insert: {
          collected_at?: string
          detail: string
          id?: string
          kind: string
          resource_id: string
          value?: string | null
        }
        Update: {
          collected_at?: string
          detail?: string
          id?: string
          kind?: string
          resource_id?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "storage_evidence_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "storage_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_reclaim_plans: {
        Row: {
          correlation_id: string
          created_at: string
          created_by: string
          id: string
          resource_ids: string[]
          scan_run_id: string
          total_bytes: number
        }
        Insert: {
          correlation_id: string
          created_at?: string
          created_by: string
          id?: string
          resource_ids?: string[]
          scan_run_id: string
          total_bytes: number
        }
        Update: {
          correlation_id?: string
          created_at?: string
          created_by?: string
          id?: string
          resource_ids?: string[]
          scan_run_id?: string
          total_bytes?: number
        }
        Relationships: [
          {
            foreignKeyName: "storage_reclaim_plans_scan_run_id_fkey"
            columns: ["scan_run_id"]
            isOneToOne: false
            referencedRelation: "storage_scan_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_resources: {
        Row: {
          created_at: string
          id: string
          modified_at: string | null
          path: string
          scan_run_id: string
          sha256: string | null
          size_bytes: number
          state: string
        }
        Insert: {
          created_at?: string
          id?: string
          modified_at?: string | null
          path: string
          scan_run_id: string
          sha256?: string | null
          size_bytes: number
          state?: string
        }
        Update: {
          created_at?: string
          id?: string
          modified_at?: string | null
          path?: string
          scan_run_id?: string
          sha256?: string | null
          size_bytes?: number
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "storage_resources_scan_run_id_fkey"
            columns: ["scan_run_id"]
            isOneToOne: false
            referencedRelation: "storage_scan_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_scan_runs: {
        Row: {
          actor: string
          completed_at: string | null
          correlation_id: string
          id: string
          machine_id: string
          resource_count: number | null
          roots_scanned: string[]
          started_at: string
          status: string
          total_bytes: number | null
        }
        Insert: {
          actor: string
          completed_at?: string | null
          correlation_id: string
          id?: string
          machine_id: string
          resource_count?: number | null
          roots_scanned?: string[]
          started_at?: string
          status?: string
          total_bytes?: number | null
        }
        Update: {
          actor?: string
          completed_at?: string | null
          correlation_id?: string
          id?: string
          machine_id?: string
          resource_count?: number | null
          roots_scanned?: string[]
          started_at?: string
          status?: string
          total_bytes?: number | null
        }
        Relationships: []
      }
      storage_threshold_events: {
        Row: {
          breached: boolean
          created_at: string
          free_bytes: number
          id: string
          machine_id: string
          notified: boolean
          reclaimable_bytes: number | null
          threshold_bytes: number
        }
        Insert: {
          breached: boolean
          created_at?: string
          free_bytes: number
          id?: string
          machine_id: string
          notified?: boolean
          reclaimable_bytes?: number | null
          threshold_bytes: number
        }
        Update: {
          breached?: boolean
          created_at?: string
          free_bytes?: number
          id?: string
          machine_id?: string
          notified?: boolean
          reclaimable_bytes?: number | null
          threshold_bytes?: number
        }
        Relationships: []
      }
      subscription_services: {
        Row: {
          amount: number | null
          auto_renew: boolean | null
          billing_cycle: string | null
          category: string | null
          confidence: string
          created_at: string
          currency: string | null
          email_source: string | null
          id: string
          last_invoice: string | null
          next_billing_date: string | null
          payment_method: string | null
          provider: string
          raw_subject: string | null
          service_name: string
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          auto_renew?: boolean | null
          billing_cycle?: string | null
          category?: string | null
          confidence?: string
          created_at?: string
          currency?: string | null
          email_source?: string | null
          id?: string
          last_invoice?: string | null
          next_billing_date?: string | null
          payment_method?: string | null
          provider: string
          raw_subject?: string | null
          service_name: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          auto_renew?: boolean | null
          billing_cycle?: string | null
          category?: string | null
          confidence?: string
          created_at?: string
          currency?: string | null
          email_source?: string | null
          id?: string
          last_invoice?: string | null
          next_billing_date?: string | null
          payment_method?: string | null
          provider?: string
          raw_subject?: string | null
          service_name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      supabase_billing_events: {
        Row: {
          amount_thb: number | null
          amount_usd: number
          created_at: string
          email_received_at: string | null
          email_subject: string | null
          exchange_rate: number | null
          gmail_message_id: string
          id: string
          invoice_number: string | null
          partner_payable_request_id: string | null
          status: string
        }
        Insert: {
          amount_thb?: number | null
          amount_usd: number
          created_at?: string
          email_received_at?: string | null
          email_subject?: string | null
          exchange_rate?: number | null
          gmail_message_id: string
          id?: string
          invoice_number?: string | null
          partner_payable_request_id?: string | null
          status?: string
        }
        Update: {
          amount_thb?: number | null
          amount_usd?: number
          created_at?: string
          email_received_at?: string | null
          email_subject?: string | null
          exchange_rate?: number | null
          gmail_message_id?: string
          id?: string
          invoice_number?: string | null
          partner_payable_request_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "supabase_billing_events_partner_payable_request_id_fkey"
            columns: ["partner_payable_request_id"]
            isOneToOne: false
            referencedRelation: "partner_payable_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      system_health_status: {
        Row: {
          check_kind: string | null
          consecutive_failures: number
          detail: Json | null
          id: number
          last_alert_at: string | null
          last_check_at: string | null
          last_error: string | null
          service_key: string
          status: string
        }
        Insert: {
          check_kind?: string | null
          consecutive_failures?: number
          detail?: Json | null
          id?: number
          last_alert_at?: string | null
          last_check_at?: string | null
          last_error?: string | null
          service_key?: string
          status?: string
        }
        Update: {
          check_kind?: string | null
          consecutive_failures?: number
          detail?: Json | null
          id?: number
          last_alert_at?: string | null
          last_check_at?: string | null
          last_error?: string | null
          service_key?: string
          status?: string
        }
        Relationships: []
      }
      vehicle_types: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          fuel_consumption_rate: number | null
          id: string
          load_capacity: number | null
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          fuel_consumption_rate?: number | null
          id: string
          load_capacity?: number | null
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          fuel_consumption_rate?: number | null
          id?: string
          load_capacity?: number | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      voice_wake_events: {
        Row: {
          created_at: string
          id: string
          transcript: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          transcript?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          transcript?: string | null
        }
        Relationships: []
      }
      worker_usage_events: {
        Row: {
          adapter_id: string
          completed_at: string
          correlation_id: string | null
          cpu_util_pct: number | null
          created_at: string
          disk_bytes_read: number | null
          disk_bytes_written: number | null
          error: string | null
          eval_duration_ms: number | null
          event_id: string | null
          execution_id: string | null
          gpu_model: string | null
          gpu_util_pct: number | null
          id: string
          id_scheme: string | null
          input_tokens: number | null
          latency_ms: number
          load_duration_ms: number | null
          model: string | null
          network_bytes_received: number | null
          network_bytes_sent: number | null
          output_tokens: number | null
          pod_id: string | null
          prompt_eval_duration_ms: number | null
          provider: string
          provider_request_id: string | null
          ram_used_pct: number | null
          request_id: string
          run_context: string | null
          service: string
          started_at: string
          status: string
          task_id: string | null
          telemetry_sampled_at: string | null
          token_source: string
          token_unknown_reason: string | null
          total_tokens: number | null
          vram_used_pct: number | null
        }
        Insert: {
          adapter_id: string
          completed_at: string
          correlation_id?: string | null
          cpu_util_pct?: number | null
          created_at?: string
          disk_bytes_read?: number | null
          disk_bytes_written?: number | null
          error?: string | null
          eval_duration_ms?: number | null
          event_id?: string | null
          execution_id?: string | null
          gpu_model?: string | null
          gpu_util_pct?: number | null
          id?: string
          id_scheme?: string | null
          input_tokens?: number | null
          latency_ms: number
          load_duration_ms?: number | null
          model?: string | null
          network_bytes_received?: number | null
          network_bytes_sent?: number | null
          output_tokens?: number | null
          pod_id?: string | null
          prompt_eval_duration_ms?: number | null
          provider: string
          provider_request_id?: string | null
          ram_used_pct?: number | null
          request_id: string
          run_context?: string | null
          service: string
          started_at: string
          status: string
          task_id?: string | null
          telemetry_sampled_at?: string | null
          token_source?: string
          token_unknown_reason?: string | null
          total_tokens?: number | null
          vram_used_pct?: number | null
        }
        Update: {
          adapter_id?: string
          completed_at?: string
          correlation_id?: string | null
          cpu_util_pct?: number | null
          created_at?: string
          disk_bytes_read?: number | null
          disk_bytes_written?: number | null
          error?: string | null
          eval_duration_ms?: number | null
          event_id?: string | null
          execution_id?: string | null
          gpu_model?: string | null
          gpu_util_pct?: number | null
          id?: string
          id_scheme?: string | null
          input_tokens?: number | null
          latency_ms?: number
          load_duration_ms?: number | null
          model?: string | null
          network_bytes_received?: number | null
          network_bytes_sent?: number | null
          output_tokens?: number | null
          pod_id?: string | null
          prompt_eval_duration_ms?: number | null
          provider?: string
          provider_request_id?: string | null
          ram_used_pct?: number | null
          request_id?: string
          run_context?: string | null
          service?: string
          started_at?: string
          status?: string
          task_id?: string | null
          telemetry_sampled_at?: string | null
          token_source?: string
          token_unknown_reason?: string | null
          total_tokens?: number | null
          vram_used_pct?: number | null
        }
        Relationships: []
      }
      workspace_lock_conflicts: {
        Row: {
          attempted_at: string
          held_by_actor: string
          held_by_session_id: string
          id: string
          requested_by_actor: string
          requested_by_session_id: string
          resolution: string
          resource_path: string
        }
        Insert: {
          attempted_at?: string
          held_by_actor: string
          held_by_session_id: string
          id?: string
          requested_by_actor: string
          requested_by_session_id: string
          resolution?: string
          resource_path: string
        }
        Update: {
          attempted_at?: string
          held_by_actor?: string
          held_by_session_id?: string
          id?: string
          requested_by_actor?: string
          requested_by_session_id?: string
          resolution?: string
          resource_path?: string
        }
        Relationships: []
      }
      workspace_locks: {
        Row: {
          acquired_at: string
          expires_at: string
          holder_actor: string
          holder_session_id: string
          id: string
          operation_id: string
          released_at: string | null
          resource_path: string
          resource_type: string
        }
        Insert: {
          acquired_at?: string
          expires_at: string
          holder_actor: string
          holder_session_id: string
          id?: string
          operation_id: string
          released_at?: string | null
          resource_path: string
          resource_type: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string
          holder_actor?: string
          holder_session_id?: string
          id?: string
          operation_id?: string
          released_at?: string | null
          resource_path?: string
          resource_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      ai_connection_vault_delete: { Args: { p_id: string }; Returns: undefined }
      ai_connection_vault_read: { Args: { p_id: string }; Returns: string }
      ai_connection_vault_write: {
        Args: { p_description?: string; p_name: string; p_secret: string }
        Returns: string
      }
      confirm_invoice: {
        Args: {
          p_customer_company_id: string
          p_invoice_date: string
          p_invoice_no: string
          p_items: Json
          p_notes: string
          p_subtotal: number
          p_total_amount: number
          p_vat_amount: number
          p_vat_rate: number
        }
        Returns: string
      }
      disablelongtransactions: { Args: never; Returns: string }
      dna_os_sensor_events: {
        Args: { p_limit?: number; p_task_ref?: string }
        Returns: unknown[]
        SetofOptions: {
          from: "*"
          to: "sensor_event"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      dna_os_sensor_ingest: { Args: { events: Json }; Returns: Json }
      dna_os_sensor_pattern: { Args: { p_name: string }; Returns: Json }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_cron_job_status: {
        Args: never
        Returns: {
          active: boolean
          jobname: string
          last_run_at: string
          last_status: string
          ok: boolean
          schedule: string
        }[]
      }
      gettransactionid: { Args: never; Returns: unknown }
      is_admin_workspace_user: { Args: never; Returns: boolean }
      longtransactionsenabled: { Args: never; Returns: boolean }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      reconcile_receipt_payment: {
        Args: { p_actor?: string; p_receipt_id: string }
        Returns: {
          already_reconciled: boolean
          amount: number
          company_id: string
          debt_event_id: string
          new_outstanding: number
          previous_outstanding: number
          receipt_id: string
        }[]
      }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
    }
    Enums: {
      AlertSeverity: "INFO" | "WARNING" | "CRITICAL"
      AlertType:
        | "OVERDUE"
        | "WARNING"
        | "REMINDER"
        | "NEW_ORDER"
        | "SUPPLIER_NOT_CONFIRMED"
        | "TRUCK_NOT_ASSIGNED"
        | "TRUCK_DELAYED"
        | "DOCUMENT_PENDING_APPROVAL"
        | "INVOICE_OVERDUE"
        | "PAYMENT_UNRECONCILED"
        | "LOW_MARGIN"
        | "CREDIT_LIMIT_EXCEEDED"
        | "DELIVERY_PROOF_MISSING"
        | "LINE_SEND_FAILED"
        | "PDF_GENERATION_FAILED"
      app_role:
        | "super_admin"
        | "admin"
        | "employee"
        | "partner"
        | "customer"
        | "ai_service"
      BoqStatus: "DRAFT" | "FINALIZED" | "CANCELLED"
      CollectionState:
        | "CURRENT"
        | "OVERDUE"
        | "WARNING"
        | "COLLECTION"
        | "PROMISED"
        | "PARTIAL"
        | "LEGAL"
        | "CLOSED"
      CompanyStatus: "ACTIVE" | "INACTIVE" | "SUSPENDED"
      CompanyType: "CORE" | "CUSTOMER" | "SUPPLIER" | "FLEET"
      CreditStatus: "NORMAL" | "WATCH" | "HOLD" | "BLOCKED"
      CustomerOrderStatus:
        | "DRAFT"
        | "SUBMITTED"
        | "PRICING"
        | "QUOTED"
        | "CONFIRMED"
        | "CANCELLED"
        | "PROCUREMENT"
        | "DISPATCHING"
        | "PARTIALLY_DELIVERED"
        | "DELIVERED"
        | "INVOICED"
        | "PAID"
      DeliveryProofType:
        | "PHOTO_BEFORE_LOADING"
        | "PHOTO_AFTER_LOADING"
        | "PHOTO_AT_SITE"
        | "SCALE_TICKET"
        | "DELIVERY_NOTE"
        | "CUSTOMER_SIGNATURE"
        | "GPS_LOCATION"
        | "OTHER"
      DisputeStatus:
        | "OPEN"
        | "INVESTIGATING"
        | "WAITING_PARTNER"
        | "WAITING_CUSTOMER"
        | "RESOLVED"
        | "REJECTED"
        | "CLOSED"
      DisputeType:
        | "SHORT_DELIVERY"
        | "WRONG_MATERIAL"
        | "LATE_DELIVERY"
        | "DAMAGED_MATERIAL"
        | "PRICE_DISPUTE"
        | "PAYMENT_DISPUTE"
        | "CUSTOMER_REJECTED"
        | "TRANSPORT_FAILED"
        | "OTHER"
      DocumentGroupStatus: "OPEN" | "CLOSED" | "ARCHIVED"
      DocumentReferenceRelationType:
        | "SOURCE"
        | "PARENT"
        | "CHILD"
        | "GENERATED_FROM"
        | "PAID_BY"
        | "SETTLED_BY"
      DocumentType:
        | "delivery_order"
        | "boq"
        | "quotation"
        | "purchase_order"
        | "INV"
        | "receipt"
        | "payment_voucher"
        | "PMT"
        | "debt_notice"
        | "billing"
        | "workorder"
      IdentityProvider: "LINE"
      InventoryMovementType:
        | "INITIAL"
        | "ADJUST"
        | "RESERVE"
        | "RELEASE"
        | "FULFILL"
        | "CANCEL"
      InvoiceStatus: "DRAFT" | "SENT" | "PARTIALLY_PAID" | "PAID" | "VOID"
      NotificationStatus: "QUEUED" | "SENT" | "FAILED"
      NotificationType:
        | "ORDER_CREATED"
        | "SUPPLIER_PO_CREATED"
        | "SUPPLIER_PO_CONFIRMED"
        | "TRANSPORT_JOB_ASSIGNED"
        | "TRANSPORT_JOB_DELIVERED"
        | "INVOICE_CREATED"
        | "PAYMENT_CONFIRMED"
        | "DEBT_OVERDUE"
      OrderRequestStatus: "PENDING" | "PROCESSING" | "CONFIRMED" | "CANCELLED"
      owner_device_trust_state:
        | "OWNER_TRUSTED"
        | "TRUSTED"
        | "TEMPORARY"
        | "REVOKED"
      PartnerProductSubmissionStatus: "PENDING" | "APPROVED" | "REJECTED"
      PaymentMethod:
        | "BANK_TRANSFER"
        | "CASH"
        | "CHEQUE"
        | "CREDIT_CARD"
        | "OTHER"
      PaymentStatus: "PENDING" | "CONFIRMED" | "REJECTED"
      PricingSnapshotStatus: "CALCULATED" | "NEEDS_REVIEW"
      ProjectStatus: "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED"
      QuotationStatus:
        | "DRAFT"
        | "PENDING_APPROVAL"
        | "APPROVED"
        | "SENT"
        | "CONFIRMED"
        | "REJECTED"
        | "CANCELLED"
        | "EXPIRED"
      Role:
        | "OWNER"
        | "ADMIN"
        | "ACCOUNTANT"
        | "PROCUREMENT"
        | "OPERATION"
        | "CUSTOMER"
        | "SUPPLIER"
        | "FLEET_OWNER"
        | "DRIVER"
        | "VIEWER"
      SessionType: "LINE" | "SUPERADMIN"
      SettlementItemRefType: "PURCHASE_ORDER" | "TRANSPORT_JOB"
      SettlementPartnerType: "SUPPLIER" | "FLEET"
      SettlementStatus:
        | "DRAFT"
        | "PENDING_APPROVAL"
        | "APPROVED"
        | "PAYMENT_ORDERED"
        | "PAID"
        | "CANCELLED"
      SupplierContractStatus: "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED"
      SupplierPoStatus:
        | "DRAFT"
        | "SENT"
        | "ACKNOWLEDGED"
        | "CONFIRMED"
        | "PARTIALLY_FULFILLED"
        | "FULFILLED"
        | "BILLED"
        | "PAID"
        | "CANCELLED"
        | "REJECTED"
      TransportJobStatus:
        | "CREATED"
        | "ASSIGNED"
        | "ACCEPTED"
        | "GOING_TO_PICKUP"
        | "ARRIVED_PICKUP"
        | "LOADED"
        | "IN_TRANSIT"
        | "ARRIVED_SITE"
        | "DELIVERED"
        | "COMPLETED"
        | "CANCELLED"
        | "FAILED"
      UserStatus:
        | "ACTIVE"
        | "INACTIVE"
        | "INVITED"
        | "LINE_LINKED"
        | "SUSPENDED"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
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
      AlertSeverity: ["INFO", "WARNING", "CRITICAL"],
      AlertType: [
        "OVERDUE",
        "WARNING",
        "REMINDER",
        "NEW_ORDER",
        "SUPPLIER_NOT_CONFIRMED",
        "TRUCK_NOT_ASSIGNED",
        "TRUCK_DELAYED",
        "DOCUMENT_PENDING_APPROVAL",
        "INVOICE_OVERDUE",
        "PAYMENT_UNRECONCILED",
        "LOW_MARGIN",
        "CREDIT_LIMIT_EXCEEDED",
        "DELIVERY_PROOF_MISSING",
        "LINE_SEND_FAILED",
        "PDF_GENERATION_FAILED",
      ],
      app_role: [
        "super_admin",
        "admin",
        "employee",
        "partner",
        "customer",
        "ai_service",
      ],
      BoqStatus: ["DRAFT", "FINALIZED", "CANCELLED"],
      CollectionState: [
        "CURRENT",
        "OVERDUE",
        "WARNING",
        "COLLECTION",
        "PROMISED",
        "PARTIAL",
        "LEGAL",
        "CLOSED",
      ],
      CompanyStatus: ["ACTIVE", "INACTIVE", "SUSPENDED"],
      CompanyType: ["CORE", "CUSTOMER", "SUPPLIER", "FLEET"],
      CreditStatus: ["NORMAL", "WATCH", "HOLD", "BLOCKED"],
      CustomerOrderStatus: [
        "DRAFT",
        "SUBMITTED",
        "PRICING",
        "QUOTED",
        "CONFIRMED",
        "CANCELLED",
        "PROCUREMENT",
        "DISPATCHING",
        "PARTIALLY_DELIVERED",
        "DELIVERED",
        "INVOICED",
        "PAID",
      ],
      DeliveryProofType: [
        "PHOTO_BEFORE_LOADING",
        "PHOTO_AFTER_LOADING",
        "PHOTO_AT_SITE",
        "SCALE_TICKET",
        "DELIVERY_NOTE",
        "CUSTOMER_SIGNATURE",
        "GPS_LOCATION",
        "OTHER",
      ],
      DisputeStatus: [
        "OPEN",
        "INVESTIGATING",
        "WAITING_PARTNER",
        "WAITING_CUSTOMER",
        "RESOLVED",
        "REJECTED",
        "CLOSED",
      ],
      DisputeType: [
        "SHORT_DELIVERY",
        "WRONG_MATERIAL",
        "LATE_DELIVERY",
        "DAMAGED_MATERIAL",
        "PRICE_DISPUTE",
        "PAYMENT_DISPUTE",
        "CUSTOMER_REJECTED",
        "TRANSPORT_FAILED",
        "OTHER",
      ],
      DocumentGroupStatus: ["OPEN", "CLOSED", "ARCHIVED"],
      DocumentReferenceRelationType: [
        "SOURCE",
        "PARENT",
        "CHILD",
        "GENERATED_FROM",
        "PAID_BY",
        "SETTLED_BY",
      ],
      DocumentType: [
        "delivery_order",
        "boq",
        "quotation",
        "purchase_order",
        "INV",
        "receipt",
        "payment_voucher",
        "PMT",
        "debt_notice",
        "billing",
        "workorder",
      ],
      IdentityProvider: ["LINE"],
      InventoryMovementType: [
        "INITIAL",
        "ADJUST",
        "RESERVE",
        "RELEASE",
        "FULFILL",
        "CANCEL",
      ],
      InvoiceStatus: ["DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "VOID"],
      NotificationStatus: ["QUEUED", "SENT", "FAILED"],
      NotificationType: [
        "ORDER_CREATED",
        "SUPPLIER_PO_CREATED",
        "SUPPLIER_PO_CONFIRMED",
        "TRANSPORT_JOB_ASSIGNED",
        "TRANSPORT_JOB_DELIVERED",
        "INVOICE_CREATED",
        "PAYMENT_CONFIRMED",
        "DEBT_OVERDUE",
      ],
      OrderRequestStatus: ["PENDING", "PROCESSING", "CONFIRMED", "CANCELLED"],
      owner_device_trust_state: [
        "OWNER_TRUSTED",
        "TRUSTED",
        "TEMPORARY",
        "REVOKED",
      ],
      PartnerProductSubmissionStatus: ["PENDING", "APPROVED", "REJECTED"],
      PaymentMethod: [
        "BANK_TRANSFER",
        "CASH",
        "CHEQUE",
        "CREDIT_CARD",
        "OTHER",
      ],
      PaymentStatus: ["PENDING", "CONFIRMED", "REJECTED"],
      PricingSnapshotStatus: ["CALCULATED", "NEEDS_REVIEW"],
      ProjectStatus: ["ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"],
      QuotationStatus: [
        "DRAFT",
        "PENDING_APPROVAL",
        "APPROVED",
        "SENT",
        "CONFIRMED",
        "REJECTED",
        "CANCELLED",
        "EXPIRED",
      ],
      Role: [
        "OWNER",
        "ADMIN",
        "ACCOUNTANT",
        "PROCUREMENT",
        "OPERATION",
        "CUSTOMER",
        "SUPPLIER",
        "FLEET_OWNER",
        "DRIVER",
        "VIEWER",
      ],
      SessionType: ["LINE", "SUPERADMIN"],
      SettlementItemRefType: ["PURCHASE_ORDER", "TRANSPORT_JOB"],
      SettlementPartnerType: ["SUPPLIER", "FLEET"],
      SettlementStatus: [
        "DRAFT",
        "PENDING_APPROVAL",
        "APPROVED",
        "PAYMENT_ORDERED",
        "PAID",
        "CANCELLED",
      ],
      SupplierContractStatus: ["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"],
      SupplierPoStatus: [
        "DRAFT",
        "SENT",
        "ACKNOWLEDGED",
        "CONFIRMED",
        "PARTIALLY_FULFILLED",
        "FULFILLED",
        "BILLED",
        "PAID",
        "CANCELLED",
        "REJECTED",
      ],
      TransportJobStatus: [
        "CREATED",
        "ASSIGNED",
        "ACCEPTED",
        "GOING_TO_PICKUP",
        "ARRIVED_PICKUP",
        "LOADED",
        "IN_TRANSIT",
        "ARRIVED_SITE",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
        "FAILED",
      ],
      UserStatus: ["ACTIVE", "INACTIVE", "INVITED", "LINE_LINKED", "SUSPENDED"],
    },
  },
} as const
