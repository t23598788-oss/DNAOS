import type { Metadata } from "next"
import Link from "next/link"
import fs from "node:fs"
import path from "node:path"
import {
  Search, Package, Truck, Store, LayoutGrid, Users, Globe2, LogIn, ArrowRight, Phone,
} from "lucide-react"
import { readPublicCatalog } from "@/services/public-catalog/reader"
import type { CatalogFacets, CatalogType, PublicCatalogView } from "@/core/public-catalog/policy"
import LineContactButton from "@/components/public/LineContactButton"
import PublicPriceTable from "@/components/public/PublicPriceTable"

/**
 * "/" — public business entry, LIGHT theme (owner 2026-10-24).
 *
 * Design language is the site's own existing light palette — the same values
 * app/login/page.tsx and app/register/page.tsx already use: background #F0EBE5,
 * surface #FDFBF8, field #F7F4EF, borders #E9E1D6 / #E3DACE, brand accent
 * #B49C7C, link blue #1e6fa8. No new theme, no dark full-page surface.
 *
 * HERO IMAGE: the owner's original hero photo is NOT present anywhere in this
 * repository or its git history (verified: zero .jpg/.jpeg/.webp/.avif files in
 * the repo outside node_modules; no image was ever tracked under public/).
 * Rather than importing a stock photo (forbidden) the hero checks, on the
 * server, whether the owner's asset has been dropped in at
 * public/brand/hero-source.{jpg,jpeg,png,webp} and uses it automatically when
 * present; otherwise it renders the brand mark on the light gradient. Dropping
 * the file in is the only step needed — no code change.
 *
 * Everything data-bound (search, price table, listings) goes through the ONE
 * public reader, so publication permission / expiry / field whitelist apply here
 * exactly as they do to GET /api/public/products.
 */
export const revalidate = 60

export const metadata: Metadata = {
  title: "DNA OS — ค้นหาราคาวัสดุก่อสร้าง เครื่องจักร และบริการขนส่ง",
  description:
    "ค้นหาวัสดุก่อสร้าง ราคา เครื่องจักร และบริการขนส่งจากผู้ประกอบการที่อนุญาตเผยแพร่ พร้อมระบบธุรกิจ เอกสาร บัญชี และงานขายของ DNA OS",
  alternates: { canonical: "/" },
}

const HERO_CANDIDATES = ["hero-source.jpg", "hero-source.jpeg", "hero-source.png", "hero-source.webp"]

function heroImageSrc(): string | null {
  for (const name of HERO_CANDIDATES) {
    if (fs.existsSync(path.join(process.cwd(), "public", "brand", name))) return `/brand/${name}`
  }
  return null
}

type Entry = {
  title: string
  detail: string
  href: string
  icon: React.ElementType
}

const ENTRIES: Entry[] = [
  { title: "สินค้าและราคาวัสดุ", detail: "ค้นราคาวัสดุจากผู้ประกอบการที่อนุญาตเผยแพร่", href: "/products/catalog?type=material", icon: Package },
  { title: "เครื่องจักรและขนส่ง", detail: "รถขนส่ง เครื่องจักร และพื้นที่ให้บริการ", href: "/products/catalog?type=transport", icon: Truck },
  { title: "ระบบธุรกิจ", detail: "ตารางงาน เอกสาร บัญชี และงานขาย", href: "/login?next=%2Fworkspace", icon: LayoutGrid },
  { title: "พาร์ตเนอร์และผู้ประกอบการ", detail: "ลงขายสินค้า ร่วมเป็นคู่ค้า หรือเจ้าของทรัพยากร", href: "/register", icon: Store },
  { title: "โครงการและการลงทุน", detail: "ภาพรวมโครงการและประกาศความร่วมมือ", href: "/solutions", icon: Globe2 },
  { title: "ติดต่อ LINE OA", detail: "สอบถามราคาและส่งคำขอจองผ่าน LINE", href: "#line-contact", icon: Phone },
  { title: "เข้าสู่ระบบ / สมัครสมาชิก", detail: "บัญชีเดียวใช้ได้ทั้งค้นหาและใช้งานระบบ", href: "/login", icon: LogIn },
  { title: "ภาพรวมบริการทั้งหมด", detail: "ดูทุก Portal และบริการที่เปิดใช้งาน", href: "/products", icon: Users },
]

function baht(amount: number): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
}

const TYPE_LABEL: Record<CatalogType, string> = {
  material: "วัสดุก่อสร้าง",
  transport: "บริการขนส่ง",
  equipment: "เครื่องจักร",
}

type Props = {
  searchParams: Promise<{ q?: string; type?: string; province?: string; district?: string }>
}

export default async function PublicHomePage({ searchParams }: Props) {
  const sp = await searchParams
  const q = (sp.q ?? "").trim()
  const province = (sp.province ?? "").trim()
  const district = (sp.district ?? "").trim()
  const type = ["material", "transport", "equipment"].includes(sp.type ?? "")
    ? (sp.type as CatalogType)
    : undefined

  let items: PublicCatalogView[] = []
  let facets: CatalogFacets | null = null
  let notice: string | null = null
  try {
    const result = await readPublicCatalog({ type, q, province, district, pageSize: 50 })
    items = result.items
    facets = result.facets
    if (result.empty_reason === "no_published_records") {
      notice = "ยังไม่มีรายการที่ได้รับอนุญาตเผยแพร่ในขณะนี้"
    } else if (result.empty_reason === "no_match") {
      notice = "ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา"
    }
  } catch {
    notice = "ระบบยังแสดงข้อมูลไม่ได้ในขณะนี้ (แหล่งข้อมูลหรือสิทธิ์เผยแพร่ยังไม่พร้อม)"
  }

  const hero = heroImageSrc()

  return (
    <div className="min-h-screen bg-[#F0EBE5] text-stone-800">
      {/* ── Navigation ─────────────────────────────────────────────── */}
      <header className="bg-[#FDFBF8]/95 backdrop-blur border-b border-[#E9E1D6] sticky top-0 z-20">
        <div className="mx-auto max-w-screen-lg px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/dna-os-mark-d.png" alt="DNA OS" width={132} height={44} className="h-9 w-auto" />
          </Link>

          <nav className="hidden lg:flex items-center gap-5 text-sm text-stone-600">
            <Link href="/" className="hover:text-stone-900 transition-colors">หน้าแรก</Link>
            <Link href="/products/catalog?type=material" className="hover:text-stone-900 transition-colors">สินค้าและราคาวัสดุ</Link>
            <Link href="/products/catalog?type=transport" className="hover:text-stone-900 transition-colors">เครื่องจักรและขนส่ง</Link>
            <Link href="/login?next=%2Fworkspace" className="hover:text-stone-900 transition-colors">ระบบธุรกิจ</Link>
            <Link href="/register" className="hover:text-stone-900 transition-colors">พาร์ตเนอร์</Link>
            <Link href="/solutions" className="hover:text-stone-900 transition-colors">โครงการและการลงทุน</Link>
            <Link href="#line-contact" className="hover:text-stone-900 transition-colors">ติดต่อ LINE</Link>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <Link href="/login" className="px-3 py-2 text-sm text-stone-700 hover:text-stone-900 transition-colors">
              เข้าสู่ระบบ
            </Link>
            <Link
              href="/register"
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#B49C7C] text-white hover:bg-[#a48d6e] transition-colors"
            >
              สมัครสมาชิก
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="relative border-b border-[#E9E1D6] overflow-hidden">
        {hero ? (
          <>
            {/* owner's original photo, full-bleed; light scrim keeps text readable */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={hero} alt="แหล่งวัสดุและโรงงาน" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#FDFBF8]/95 via-[#FDFBF8]/80 to-[#FDFBF8]/30" />
          </>
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_15%_0%,#FDFBF8_0%,#F0EBE5_45%,#E9E1D6_100%)]" />
        )}

        <div className="relative mx-auto max-w-screen-lg px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#B49C7C]">DNA OS · ระบบธุรกิจวัสดุก่อสร้างและโลจิสติกส์</p>
          <h1 className="mt-3 text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-stone-900 max-w-3xl">
            วัสดุก่อสร้าง เครื่องจักร และบริการขนส่ง
            <span className="block text-stone-600 mt-2 text-xl sm:text-2xl md:text-3xl font-semibold">
              ตรวจสอบราคาได้ก่อนตัดสินใจ
            </span>
          </h1>
          <p className="mt-4 max-w-2xl text-base text-stone-600">
            รวมข้อมูลจากผู้ประกอบการที่อนุญาตเผยแพร่ไว้ที่เดียว — ค้นหาได้โดยไม่ต้องเข้าสู่ระบบ
            และใช้บัญชีเดียวกับระบบธุรกิจเมื่อต้องการสั่งงานจริง
          </p>

          <form action="/" method="get" className="mt-7 flex flex-col sm:flex-row gap-3 max-w-2xl">
            <label className="sr-only" htmlFor="q">ค้นหา</label>
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" aria-hidden />
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={q}
                placeholder="ค้นหาวัสดุ เครื่องจักร รถขนส่ง ผู้ประกอบการ หรือพื้นที่"
                className="w-full rounded-xl bg-white border border-[#E3DACE] pl-11 pr-4 py-3.5 text-base text-stone-900 placeholder:text-stone-400 shadow-[inset_0_1px_2px_rgba(90,72,52,0.06)] focus:outline-none focus:border-[#B49C7C] focus:ring-2 focus:ring-[#B49C7C]/20"
              />
            </div>
            <label className="sr-only" htmlFor="type">ประเภท</label>
            <select
              id="type"
              name="type"
              defaultValue={type ?? ""}
              className="rounded-xl bg-white border border-[#E3DACE] px-4 py-3.5 text-sm text-stone-800 focus:outline-none focus:border-[#B49C7C]"
            >
              <option value="">ทุกประเภท</option>
              <option value="material">วัสดุก่อสร้าง</option>
              <option value="transport">บริการขนส่ง</option>
              <option value="equipment">เครื่องจักร</option>
            </select>
            <button
              type="submit"
              className="rounded-xl bg-[#B49C7C] px-6 py-3.5 text-sm font-semibold text-white hover:bg-[#a48d6e] transition-colors"
            >
              ค้นหา
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {[
              ["ทราย", "/?q=ทราย#prices"],
              ["หิน", "/?q=หิน#prices"],
              ["คอนกรีต", "/?q=คอนกรีต#prices"],
              ["รถขนส่ง", "/?type=transport#prices"],
              ["เครื่องจักร", "/?type=equipment#prices"],
            ].map(([label, href]) => (
              <Link
                key={label}
                href={href}
                className="rounded-full bg-white/80 border border-[#E3DACE] px-3 py-1.5 text-stone-600 hover:border-[#B49C7C] hover:text-stone-900 transition-colors"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Public price table (province / district / type filters) ── */}
      <PublicPriceTable
        items={items}
        filters={{ q, province, district, type }}
        facets={facets}
        notice={notice}
      />

      {/* ── Latest published items (compact) ───────────────────────── */}
      {items.length > 0 && (
        <section className="mx-auto max-w-screen-lg px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold text-stone-900">รายการที่เผยแพร่ล่าสุด</h2>
            <Link href="/products/catalog" className="text-sm text-[#1e6fa8] hover:underline">ดูทั้งหมด →</Link>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.slice(0, 6).map((item) => (
              <Link
                key={item.slug}
                href={`/products/${item.slug}`}
                className="group rounded-2xl border border-[#E9E1D6] bg-[#FDFBF8] p-5 hover:border-[#D5C8B6] transition-colors"
              >
                <div className="text-[11px] uppercase tracking-wide text-stone-500">{TYPE_LABEL[item.type]}</div>
                <div className="mt-1 text-base font-semibold text-stone-900 group-hover:text-[#1e6fa8] transition-colors">
                  {item.name}
                </div>
                <div className="mt-3 text-sm text-stone-700">
                  {item.price ? (
                    <>฿{baht(item.price.amount)} {item.price.currency}
                      {item.unit ? <span className="text-stone-500"> / {item.unit}</span> : null}
                    </>
                  ) : (
                    <span className="text-stone-500">ราคาต้องขอใบเสนอราคา</span>
                  )}
                </div>
                <div className="mt-2 text-xs text-stone-500">
                  {item.supplier ? item.supplier.name : "ผู้ประกอบการยังไม่ระบุ"}
                </div>
                <div className="mt-3 text-[11px] text-stone-400">อัปเดต {item.updated_at.slice(0, 10)}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Entries ────────────────────────────────────────────────── */}
      <section id="entries" className="bg-[#FDFBF8] border-y border-[#E9E1D6]">
        <div className="mx-auto max-w-screen-lg px-4 sm:px-6 lg:px-8 py-12">
          <h2 className="text-lg font-bold text-stone-900">ทางเข้าของ DNA OS</h2>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {ENTRIES.map((entry) => {
              const Icon = entry.icon
              return (
                <Link
                  key={entry.title}
                  href={entry.href}
                  className="group rounded-2xl border border-[#E9E1D6] bg-white p-5 hover:border-[#B49C7C] transition-colors"
                >
                  <Icon className="w-5 h-5 text-[#B49C7C]" aria-hidden />
                  <div className="mt-3 text-sm font-semibold text-stone-900">{entry.title}</div>
                  <p className="mt-2 text-xs leading-relaxed text-stone-500">{entry.detail}</p>
                  <div className="mt-3 text-xs text-stone-500 group-hover:text-[#1e6fa8] transition-colors inline-flex items-center gap-1">
                    เปิด <ArrowRight className="w-3 h-3" />
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── LINE contact ───────────────────────────────────────────── */}
      <section id="line-contact" className="mx-auto max-w-screen-lg px-4 sm:px-6 lg:px-8 py-12">
        <div className="rounded-2xl border border-[#E9E1D6] bg-[#FDFBF8] px-6 py-8 sm:px-8">
          <h2 className="text-lg font-bold text-stone-900">ติดต่อและขอใบเสนอราคา</h2>
          <p className="mt-2 text-sm text-stone-600 max-w-2xl">
            สอบถามราคา ส่งคำขอจอง หรือปรึกษาการใช้งานระบบธุรกิจ — ทีมงานตอบกลับผ่าน LINE Official Account
          </p>
          <div className="mt-5 max-w-xl">
            <LineContactButton />
          </div>
          <p className="mt-4 text-xs text-stone-400">
            ระบบยังไม่ประกาศเวลาตอบกลับอัตโนมัติ เนื่องจากเส้นทางตอบกลับอัตโนมัติยังไม่ได้ผ่านการทดสอบจริง
          </p>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="border-t border-[#E9E1D6] bg-[#FDFBF8]">
        <div className="mx-auto max-w-screen-lg px-4 sm:px-6 lg:px-8 py-10 grid grid-cols-2 sm:grid-cols-4 gap-6 text-sm">
          <div>
            <div className="text-stone-500 text-xs uppercase tracking-wide">สินค้า</div>
            <div className="mt-3 space-y-2">
              <Link href="/products/catalog?type=material" className="block text-stone-600 hover:text-stone-900">วัสดุก่อสร้าง</Link>
              <Link href="/products/catalog?type=transport" className="block text-stone-600 hover:text-stone-900">บริการขนส่ง</Link>
              <Link href="/products/catalog?type=equipment" className="block text-stone-600 hover:text-stone-900">เครื่องจักร</Link>
            </div>
          </div>
          <div>
            <div className="text-stone-500 text-xs uppercase tracking-wide">ผู้ประกอบการ</div>
            <div className="mt-3 space-y-2">
              <Link href="/register" className="block text-stone-600 hover:text-stone-900">สมัครเป็นผู้ประกอบการ</Link>
              <Link href="/login" className="block text-stone-600 hover:text-stone-900">เข้าสู่ระบบ</Link>
            </div>
          </div>
          <div>
            <div className="text-stone-500 text-xs uppercase tracking-wide">บริษัท</div>
            <div className="mt-3 space-y-2">
              <Link href="/solutions" className="block text-stone-600 hover:text-stone-900">โซลูชัน</Link>
              <Link href="/report" className="block text-stone-600 hover:text-stone-900">รายงานความคืบหน้า</Link>
            </div>
          </div>
          <div>
            <div className="text-stone-500 text-xs uppercase tracking-wide">ระบบ</div>
            <div className="mt-3 space-y-2">
              <Link href="/products" className="block text-stone-600 hover:text-stone-900">ภาพรวม Portal</Link>
              <Link href="/marketplace" className="block text-stone-600 hover:text-stone-900">การเชื่อมต่อ</Link>
            </div>
          </div>
        </div>
        <div className="border-t border-[#E9E1D6]">
          <div className="mx-auto max-w-screen-lg px-4 sm:px-6 lg:px-8 py-5 text-xs text-stone-500">
            DNA OS — ระบบธุรกิจวัสดุก่อสร้างและโลจิสติกส์ · ข้อมูลสินค้าเผยแพร่โดยความยินยอมของผู้ประกอบการเจ้าของรายการ
          </div>
        </div>
      </footer>
    </div>
  )
}
