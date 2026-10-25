CREATE TYPE "public"."AlertSeverity" AS ENUM (
    'INFO',
    'WARNING',
    'CRITICAL'
);


ALTER TYPE "public"."AlertSeverity" OWNER TO "postgres";


CREATE TYPE "public"."AlertType" AS ENUM (
    'OVERDUE',
    'WARNING',
    'REMINDER',
    'NEW_ORDER',
    'SUPPLIER_NOT_CONFIRMED',
    'TRUCK_NOT_ASSIGNED',
    'TRUCK_DELAYED',
    'DOCUMENT_PENDING_APPROVAL',
    'INVOICE_OVERDUE',
    'PAYMENT_UNRECONCILED',
    'LOW_MARGIN',
    'CREDIT_LIMIT_EXCEEDED',
    'DELIVERY_PROOF_MISSING',
    'LINE_SEND_FAILED',
    'PDF_GENERATION_FAILED'
);


ALTER TYPE "public"."AlertType" OWNER TO "postgres";


CREATE TYPE "public"."BoqStatus" AS ENUM (
    'DRAFT',
    'FINALIZED',
    'CANCELLED'
);


ALTER TYPE "public"."BoqStatus" OWNER TO "postgres";


CREATE TYPE "public"."CollectionState" AS ENUM (
    'CURRENT',
    'OVERDUE',
    'WARNING',
    'COLLECTION',
    'PROMISED',
    'PARTIAL',
    'LEGAL',
    'CLOSED'
);


ALTER TYPE "public"."CollectionState" OWNER TO "postgres";


CREATE TYPE "public"."CompanyStatus" AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'SUSPENDED'
);


ALTER TYPE "public"."CompanyStatus" OWNER TO "postgres";


CREATE TYPE "public"."CompanyType" AS ENUM (
    'CORE',
    'CUSTOMER',
    'SUPPLIER',
    'FLEET'
);


ALTER TYPE "public"."CompanyType" OWNER TO "postgres";


CREATE TYPE "public"."CreditStatus" AS ENUM (
    'NORMAL',
    'WATCH',
    'HOLD',
    'BLOCKED'
);


ALTER TYPE "public"."CreditStatus" OWNER TO "postgres";


CREATE TYPE "public"."CustomerOrderStatus" AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'PRICING',
    'QUOTED',
    'CONFIRMED',
    'CANCELLED',
    'PROCUREMENT',
    'DISPATCHING',
    'PARTIALLY_DELIVERED',
    'DELIVERED',
    'INVOICED',
    'PAID'
);


ALTER TYPE "public"."CustomerOrderStatus" OWNER TO "postgres";


CREATE TYPE "public"."DeliveryProofType" AS ENUM (
    'PHOTO_BEFORE_LOADING',
    'PHOTO_AFTER_LOADING',
    'PHOTO_AT_SITE',
    'SCALE_TICKET',
    'DELIVERY_NOTE',
    'CUSTOMER_SIGNATURE',
    'GPS_LOCATION',
    'OTHER'
);


ALTER TYPE "public"."DeliveryProofType" OWNER TO "postgres";


CREATE TYPE "public"."DisputeStatus" AS ENUM (
    'OPEN',
    'INVESTIGATING',
    'WAITING_PARTNER',
    'WAITING_CUSTOMER',
    'RESOLVED',
    'REJECTED',
    'CLOSED'
);


ALTER TYPE "public"."DisputeStatus" OWNER TO "postgres";


CREATE TYPE "public"."DisputeType" AS ENUM (
    'SHORT_DELIVERY',
    'WRONG_MATERIAL',
    'LATE_DELIVERY',
    'DAMAGED_MATERIAL',
    'PRICE_DISPUTE',
    'PAYMENT_DISPUTE',
    'CUSTOMER_REJECTED',
    'TRANSPORT_FAILED',
    'OTHER'
);


ALTER TYPE "public"."DisputeType" OWNER TO "postgres";


CREATE TYPE "public"."DocumentGroupStatus" AS ENUM (
    'OPEN',
    'CLOSED',
    'ARCHIVED'
);


ALTER TYPE "public"."DocumentGroupStatus" OWNER TO "postgres";


CREATE TYPE "public"."DocumentReferenceRelationType" AS ENUM (
    'SOURCE',
    'PARENT',
    'CHILD',
    'GENERATED_FROM',
    'PAID_BY',
    'SETTLED_BY'
);


ALTER TYPE "public"."DocumentReferenceRelationType" OWNER TO "postgres";


CREATE TYPE "public"."DocumentType" AS ENUM (
    'ORD',
    'BOQ',
    'QT',
    'PO',
    'INV',
    'RCP',
    'PV',
    'PMT'
);


ALTER TYPE "public"."DocumentType" OWNER TO "postgres";


CREATE TYPE "public"."IdentityProvider" AS ENUM (
    'LINE'
);


ALTER TYPE "public"."IdentityProvider" OWNER TO "postgres";


CREATE TYPE "public"."InventoryMovementType" AS ENUM (
    'INITIAL',
    'ADJUST',
    'RESERVE',
    'RELEASE',
    'FULFILL',
    'CANCEL'
);


ALTER TYPE "public"."InventoryMovementType" OWNER TO "postgres";


CREATE TYPE "public"."InvoiceStatus" AS ENUM (
    'DRAFT',
    'SENT',
    'PARTIALLY_PAID',
    'PAID',
    'VOID'
);


ALTER TYPE "public"."InvoiceStatus" OWNER TO "postgres";


CREATE TYPE "public"."NotificationStatus" AS ENUM (
    'QUEUED',
    'SENT',
    'FAILED'
);


ALTER TYPE "public"."NotificationStatus" OWNER TO "postgres";


CREATE TYPE "public"."NotificationType" AS ENUM (
    'ORDER_CREATED',
    'SUPPLIER_PO_CREATED',
    'SUPPLIER_PO_CONFIRMED',
    'TRANSPORT_JOB_ASSIGNED',
    'TRANSPORT_JOB_DELIVERED',
    'INVOICE_CREATED',
    'PAYMENT_CONFIRMED',
    'DEBT_OVERDUE'
);


ALTER TYPE "public"."NotificationType" OWNER TO "postgres";


CREATE TYPE "public"."OrderRequestStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'CONFIRMED',
    'CANCELLED'
);


ALTER TYPE "public"."OrderRequestStatus" OWNER TO "postgres";


CREATE TYPE "public"."PartnerProductSubmissionStatus" AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED'
);


ALTER TYPE "public"."PartnerProductSubmissionStatus" OWNER TO "postgres";


CREATE TYPE "public"."PaymentMethod" AS ENUM (
    'BANK_TRANSFER',
    'CASH',
    'CHEQUE',
    'CREDIT_CARD',
    'OTHER'
);


ALTER TYPE "public"."PaymentMethod" OWNER TO "postgres";


CREATE TYPE "public"."PaymentStatus" AS ENUM (
    'PENDING',
    'CONFIRMED',
    'REJECTED'
);


ALTER TYPE "public"."PaymentStatus" OWNER TO "postgres";


CREATE TYPE "public"."PricingSnapshotStatus" AS ENUM (
    'CALCULATED',
    'NEEDS_REVIEW'
);


ALTER TYPE "public"."PricingSnapshotStatus" OWNER TO "postgres";


CREATE TYPE "public"."ProjectStatus" AS ENUM (
    'ACTIVE',
    'ON_HOLD',
    'COMPLETED',
    'CANCELLED'
);


ALTER TYPE "public"."ProjectStatus" OWNER TO "postgres";


CREATE TYPE "public"."QuotationStatus" AS ENUM (
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'SENT',
    'CONFIRMED',
    'REJECTED',
    'CANCELLED',
    'EXPIRED'
);


ALTER TYPE "public"."QuotationStatus" OWNER TO "postgres";


CREATE TYPE "public"."Role" AS ENUM (
    'OWNER',
    'ADMIN',
    'ACCOUNTANT',
    'PROCUREMENT',
    'OPERATION',
    'CUSTOMER',
    'SUPPLIER',
    'FLEET_OWNER',
    'DRIVER',
    'VIEWER'
);


ALTER TYPE "public"."Role" OWNER TO "postgres";


CREATE TYPE "public"."SessionType" AS ENUM (
    'LINE',
    'SUPERADMIN'
);


ALTER TYPE "public"."SessionType" OWNER TO "postgres";


CREATE TYPE "public"."SettlementItemRefType" AS ENUM (
    'PURCHASE_ORDER',
    'TRANSPORT_JOB'
);


ALTER TYPE "public"."SettlementItemRefType" OWNER TO "postgres";


CREATE TYPE "public"."SettlementPartnerType" AS ENUM (
    'SUPPLIER',
    'FLEET'
);


ALTER TYPE "public"."SettlementPartnerType" OWNER TO "postgres";


CREATE TYPE "public"."SettlementStatus" AS ENUM (
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'PAYMENT_ORDERED',
    'PAID',
    'CANCELLED'
);


ALTER TYPE "public"."SettlementStatus" OWNER TO "postgres";


CREATE TYPE "public"."SupplierContractStatus" AS ENUM (
    'DRAFT',
    'ACTIVE',
    'EXPIRED',
    'TERMINATED'
);


ALTER TYPE "public"."SupplierContractStatus" OWNER TO "postgres";


CREATE TYPE "public"."SupplierPoStatus" AS ENUM (
    'DRAFT',
    'SENT',
    'ACKNOWLEDGED',
    'CONFIRMED',
    'PARTIALLY_FULFILLED',
    'FULFILLED',
    'BILLED',
    'PAID',
    'CANCELLED',
    'REJECTED'
);


ALTER TYPE "public"."SupplierPoStatus" OWNER TO "postgres";


CREATE TYPE "public"."TransportJobStatus" AS ENUM (
    'CREATED',
    'ASSIGNED',
    'ACCEPTED',
    'GOING_TO_PICKUP',
    'ARRIVED_PICKUP',
    'LOADED',
    'IN_TRANSIT',
    'ARRIVED_SITE',
    'DELIVERED',
    'COMPLETED',
    'CANCELLED',
    'FAILED'
);


ALTER TYPE "public"."TransportJobStatus" OWNER TO "postgres";


CREATE TYPE "public"."UserStatus" AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'INVITED',
    'LINE_LINKED',
    'SUSPENDED'
);


ALTER TYPE "public"."UserStatus" OWNER TO "postgres";


