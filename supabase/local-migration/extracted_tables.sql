-- companies: lines 849-865
CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "tax_id" "text",
    "address" "text",
    "phone" "text",
    "email" "text",
    "bank_name" "text",
    "bank_account_no" "text",
    "type" "public"."CompanyType" NOT NULL,
    "status" "public"."CompanyStatus" DEFAULT 'ACTIVE'::"public"."CompanyStatus" NOT NULL,
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(3) without time zone NOT NULL,
    "is_individual" boolean DEFAULT false NOT NULL,
    "line_user_id" "text"
);


-- invoices: lines 1135-1157
CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_no" "text" NOT NULL,
    "invoice_status" "public"."InvoiceStatus" DEFAULT 'DRAFT'::"public"."InvoiceStatus" NOT NULL,
    "customer_company_id" "uuid" NOT NULL,
    "customer_order_id" "uuid",
    "project_id" "uuid",
    "invoice_date" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "due_date" timestamp(3) without time zone,
    "reference_no" "text",
    "recipient_address" "text",
    "notes" "text",
    "vat_rate" numeric(6,4) DEFAULT 0.07 NOT NULL,
    "subtotal" numeric(14,2) NOT NULL,
    "vat_amount" numeric(14,2) NOT NULL,
    "total_amount" numeric(14,2) NOT NULL,
    "paid_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "receipt_no" "text",
    "receipt_issued_at" timestamp(3) without time zone,
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(3) without time zone NOT NULL
);


-- debt_snapshots: lines 1001-1028
CREATE TABLE IF NOT EXISTS "public"."debt_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_company_id" "uuid" NOT NULL,
    "collection_state" "public"."CollectionState" DEFAULT 'CURRENT'::"public"."CollectionState" NOT NULL,
    "total_outstanding" numeric(14,2) DEFAULT 0 NOT NULL,
    "overdue_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "days_overdue" integer DEFAULT 0 NOT NULL,
    "open_invoice_count" integer DEFAULT 0 NOT NULL,
    "last_refreshed_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(3) without time zone NOT NULL,
    "first_contact_at" timestamp(3) without time zone,
    "debt_start_at" timestamp(3) without time zone,
    "freeze_from" timestamp without time zone,
    "freeze_until" timestamp without time zone,
    "debt_type" "text",
    "legal_basis" "text",
    "reason" "text",
    "calculation_method" "text",
    "vat_status" "text",
    "document_type" "text",
    "remark" "text",
    "source_event_id" "uuid",
    CONSTRAINT "debt_snapshots_debt_type_check" CHECK (("debt_type" = ANY (ARRAY['trade_receivable'::"text", 'collection_reminder'::"text", 'loan'::"text", 'damages'::"text"]))),
    CONSTRAINT "debt_snapshots_document_type_check" CHECK (("document_type" = ANY (ARRAY['invoice'::"text", 'collection_reminder_notice'::"text", 'unsupported'::"text"]))),
    CONSTRAINT "debt_snapshots_vat_status_check" CHECK (("vat_status" = ANY (ARRAY['vat_included'::"text", 'vat_not_applicable'::"text"])))
);


-- customer_orders: lines 932-945
CREATE TABLE IF NOT EXISTS "public"."customer_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_no" "text" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "document_group_id" "uuid" NOT NULL,
    "customer_company_id" "uuid" NOT NULL,
    "customer_site_id" "uuid" NOT NULL,
    "status" "public"."CustomerOrderStatus" DEFAULT 'DRAFT'::"public"."CustomerOrderStatus" NOT NULL,
    "requested_delivery_at" timestamp(3) without time zone,
    "delivery_note" "text",
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(3) without time zone NOT NULL
);


-- document_groups: lines 1057-1070
CREATE TABLE IF NOT EXISTS "public"."document_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_no" "text" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "project_no" "text" NOT NULL,
    "root_order_id" "uuid",
    "root_order_no" "text",
    "customer_company_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "status" "public"."DocumentGroupStatus" DEFAULT 'OPEN'::"public"."DocumentGroupStatus" NOT NULL,
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(3) without time zone NOT NULL
);


-- projects: lines 1451-1461
CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_no" "text" NOT NULL,
    "customer_company_id" "uuid" NOT NULL,
    "customer_site_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "status" "public"."ProjectStatus" DEFAULT 'ACTIVE'::"public"."ProjectStatus" NOT NULL,
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(3) without time zone NOT NULL
);


-- customer_sites: lines 950-970
CREATE TABLE IF NOT EXISTS "public"."customer_sites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_company_id" "uuid" NOT NULL,
    "site_name" "text" NOT NULL,
    "address" "text" NOT NULL,
    "province" "text" NOT NULL,
    "district" "text" NOT NULL,
    "subdistrict" "text" NOT NULL,
    "postal_code" "text" NOT NULL,
    "gps_lat" numeric(10,7),
    "gps_lng" numeric(10,7),
    "contact_name" "text",
    "contact_phone" "text",
    "delivery_note" "text",
    "access_restriction" "text",
    "preferred_delivery_time" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(3) without time zone NOT NULL
);


-- standalone_documents: lines 1603-1622
CREATE TABLE IF NOT EXISTS "public"."standalone_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_no" "text" NOT NULL,
    "document_type" "public"."DocumentType" NOT NULL,
    "document_date" timestamp(3) without time zone NOT NULL,
    "customer_company_id" "uuid",
    "partner_company_id" "uuid",
    "project_id" "uuid",
    "customer_order_id" "uuid",
    "reference_no" "text",
    "recipient_address" "text",
    "notes" "text",
    "vat_rate" numeric(6,4) DEFAULT 0.07 NOT NULL,
    "subtotal" numeric(14,2) NOT NULL,
    "vat_amount" numeric(14,2) NOT NULL,
    "total_amount" numeric(14,2) NOT NULL,
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(3) without time zone NOT NULL
);


-- audit_logs: lines 761-775
CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_user_id" "uuid",
    "company_id" "uuid",
    "entity_type" "text" NOT NULL,
    "entity_id" "text",
    "action" "text" NOT NULL,
    "field" "text",
    "old_value" "text",
    "new_value" "text",
    "ip_address" "text",
    "user_agent" "text",
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


