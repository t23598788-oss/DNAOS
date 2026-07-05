import { createClient } from "@supabase/supabase-js";
import { loadConfigs, getStr, clearConfigCache } from "@/lib/v3-engines/config-loader";

// ข้อมูลบริษัท/บัญชีรับเงิน — เก็บใน app_configs (key-value เดียวกับ business config อื่น)
// อ่านได้แบบ public เพราะข้อมูลนี้พิมพ์อยู่บนเอกสารทุกใบอยู่แล้ว ไม่ใช่ความลับ
// แต่เขียนได้เฉพาะ user ที่ login แล้วเท่านั้น — บังคับที่ระดับ RLS ของ Postgres ไม่ใช่แค่ที่ API route

const KEYS = {
  companyName: "company-name",
  companyTaxId: "company-tax-id",
  paymentBankName: "payment-bank-name",
  paymentAccountNumber: "payment-account-number",
  paymentAccountName: "payment-account-name",
} as const;

export interface CompanySettings {
  companyName: string;
  companyTaxId: string;
  paymentBankName: string;
  paymentAccountNumber: string;
  paymentAccountName: string;
}

export async function loadCompanySettings(): Promise<CompanySettings> {
  const configs = await loadConfigs();
  return {
    companyName: getStr(configs, KEYS.companyName),
    companyTaxId: getStr(configs, KEYS.companyTaxId),
    paymentBankName: getStr(configs, KEYS.paymentBankName),
    paymentAccountNumber: getStr(configs, KEYS.paymentAccountNumber),
    paymentAccountName: getStr(configs, KEYS.paymentAccountName),
  };
}

// เขียนผ่าน client ที่ผูก JWT ของ user ที่ login แล้ว (ไม่ใช้ anon client เปล่าๆ)
// เพื่อให้ RLS ของ app_configs ตรวจสอบ auth.role() ได้จริง ไม่ใช่แค่เช็คที่ route นี้
export async function saveCompanySettings(accessToken: string, settings: CompanySettings): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const userScopedClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const rows = [
    { title: KEYS.companyName, data: settings.companyName },
    { title: KEYS.companyTaxId, data: settings.companyTaxId },
    { title: KEYS.paymentBankName, data: settings.paymentBankName },
    { title: KEYS.paymentAccountNumber, data: settings.paymentAccountNumber },
    { title: KEYS.paymentAccountName, data: settings.paymentAccountName },
  ];

  const { error } = await userScopedClient.from("app_configs").upsert(rows, { onConflict: "title" });
  if (error) throw new Error(error.message);
  clearConfigCache();
}
