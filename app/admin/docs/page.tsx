/**
 * /admin/docs — DNA OS Developer Portal
 *
 * Production-grade spec portal for engineers and external AI agents.
 * Content comes from registry/developer-portal-spec.ts (single source of truth);
 * the same data is exported as JSON at /api/v1/developer-portal.
 */
import Link from "next/link";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import {
  CATEGORIES,
  DOCS,
  ENDPOINT_INDEX,
  PORTAL_SPEC_VERSION,
  docsForCategory,
  findDoc,
  type DocSpec,
  type EndpointSpec,
  type SectionSpec,
} from "@/registry/developer-portal-spec";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "DNA OS — Developer Portal | System Spec & Integration",
  description:
    "Production specification portal for DNA OS: architecture layers, business engines, API request schemas, integrations and security settings.",
};

const METHOD_STYLES: Record<string, string> = {
  GET: "bg-emerald-50 text-emerald-700 border-emerald-200",
  POST: "bg-blue-50 text-blue-700 border-blue-200",
  OPTIONS: "bg-stone-100 text-stone-600 border-stone-200",
};

function RequiredBadge({ required }: { required: boolean }) {
  return required ? (
    <span className="inline-flex items-center rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
      required
    </span>
  ) : (
    <span className="inline-flex items-center rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
      optional
    </span>
  );
}

function CodeBlock({ language, content }: { language: string; content: string }) {
  return (
    <div className="my-4 overflow-hidden rounded-lg border border-stone-800 bg-stone-900">
      <div className="flex items-center justify-between border-b border-stone-800 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-stone-500">{language}</span>
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-[12px] leading-relaxed text-stone-100">
        <code>{content}</code>
      </pre>
    </div>
  );
}

function SpecTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="my-4 overflow-x-auto rounded-lg border border-stone-200">
      <table className="w-full border-collapse text-left text-[12.5px]">
        <thead className="bg-stone-50">
          <tr>
            {columns.map((column) => (
              <th key={column} className="whitespace-nowrap border-b border-stone-200 px-3 py-2 font-semibold text-stone-600">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="align-top odd:bg-white even:bg-stone-50/60">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`border-b border-stone-100 px-3 py-2 text-stone-700 ${cellIndex === 0 ? "font-mono text-[11.5px] text-stone-900" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EndpointCard({ endpoint, anchor }: { endpoint: EndpointSpec; anchor: string }) {
  return (
    <article id={anchor} className="my-5 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <header className="border-b border-stone-200 bg-stone-50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded border px-2 py-0.5 font-mono text-[11px] font-bold ${METHOD_STYLES[endpoint.method] ?? METHOD_STYLES.OPTIONS}`}
          >
            {endpoint.method}
          </span>
          <code className="break-all font-mono text-[12.5px] font-semibold text-stone-900">{endpoint.path}</code>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-stone-600">{endpoint.summary}</p>
        <p className="mt-1 text-[11.5px] text-stone-500">
          <span className="font-semibold text-stone-700">Auth:</span> {endpoint.auth}
        </p>
      </header>

      <div className="px-4 py-3">
        <h4 className="text-[12px] font-bold uppercase tracking-wide text-stone-500">Request attributes</h4>
        {endpoint.params.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-stone-500">Endpoint นี้ไม่รับพารามิเตอร์ใด ๆ</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-stone-200">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead className="bg-stone-50">
                <tr>
                  {["Name", "In", "Type", "Required", "Description", "Example"].map((column) => (
                    <th key={column} className="whitespace-nowrap border-b border-stone-200 px-2.5 py-2 font-semibold text-stone-600">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {endpoint.params.map((param) => (
                  <tr key={`${param.location}-${param.name}`} className="align-top">
                    <td className="border-b border-stone-100 px-2.5 py-2 font-mono text-[11.5px] text-stone-900">{param.name}</td>
                    <td className="border-b border-stone-100 px-2.5 py-2 text-stone-600">{param.location}</td>
                    <td className="border-b border-stone-100 px-2.5 py-2 font-mono text-[11px] text-stone-600">{param.type}</td>
                    <td className="border-b border-stone-100 px-2.5 py-2">
                      <RequiredBadge required={param.required} />
                    </td>
                    <td className="border-b border-stone-100 px-2.5 py-2 text-stone-700">{param.description}</td>
                    <td className="border-b border-stone-100 px-2.5 py-2 font-mono text-[11px] text-stone-500">
                      {param.example ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {endpoint.requestSample ? (
          <>
            <h4 className="mt-5 text-[12px] font-bold uppercase tracking-wide text-stone-500">Sample request</h4>
            <CodeBlock language="shell / json" content={endpoint.requestSample} />
          </>
        ) : null}

        <h4 className="mt-5 text-[12px] font-bold uppercase tracking-wide text-stone-500">Sample response</h4>
        <CodeBlock language="json" content={endpoint.responseSample} />

        <h4 className="mt-5 text-[12px] font-bold uppercase tracking-wide text-stone-500">Verification steps</h4>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[12.5px] text-stone-700">
          {endpoint.verification.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">Registry</span>
          {endpoint.registryRefs.map((ref) => (
            <code key={ref} className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 font-mono text-[11px] text-stone-600">
              {ref}
            </code>
          ))}
        </div>
      </div>
    </article>
  );
}

function SectionBlock({ section, docSlug }: { section: SectionSpec; docSlug: string }) {
  return (
    <section id={section.id} className="scroll-mt-24 border-t border-stone-200 pt-8 first:border-t-0 first:pt-0">
      <h3 className="text-[15px] font-bold text-stone-900">{section.heading}</h3>
      {section.lead ? <p className="mt-1.5 text-[13px] leading-relaxed text-stone-600">{section.lead}</p> : null}

      {section.paragraphs?.map((paragraph) => (
        <p key={paragraph} className="mt-3 text-[13px] leading-relaxed text-stone-700">
          {paragraph}
        </p>
      ))}

      {section.bullets ? (
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-stone-700">
          {section.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      ) : null}

      {section.table ? <SpecTable columns={section.table.columns} rows={section.table.rows} /> : null}

      {section.code ? <CodeBlock language={section.code.language} content={section.code.content} /> : null}

      {section.endpoints?.map((endpoint) => (
        <EndpointCard key={endpoint.id} endpoint={endpoint} anchor={`${docSlug}-${endpoint.id}`} />
      ))}
    </section>
  );
}

function Sidebar({ activeSlug }: { activeSlug: string }) {
  return (
    <nav className="space-y-6">
      {CATEGORIES.map((category) => {
        const docs = docsForCategory(category.id);
        return (
          <div key={category.id}>
            <p className="px-2 text-[10.5px] font-bold uppercase tracking-wider text-stone-400">
              {category.icon} {category.titleEn}
            </p>
            <p className="mt-0.5 px-2 text-[11px] leading-snug text-stone-500">{category.title}</p>
            <ul className="mt-2 space-y-0.5">
              {docs.map((doc) => {
                const active = doc.slug === activeSlug;
                return (
                  <li key={doc.slug}>
                    <Link
                      href={`/admin/docs?doc=${doc.slug}`}
                      aria-current={active ? "page" : undefined}
                      className={`block rounded-md px-2 py-1.5 text-[12.5px] leading-snug transition ${
                        active
                          ? "bg-stone-900 text-white"
                          : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                      }`}
                    >
                      {doc.title}
                      <span className={`mt-0.5 block text-[10px] ${active ? "text-stone-300" : "text-stone-400"}`}>
                        {doc.titleEn}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export default async function DeveloperPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireAuthPage("/admin/docs", ADMIN_TIER);

  const resolved = await searchParams;
  const requested = Array.isArray(resolved.doc) ? resolved.doc[0] : resolved.doc;
  const doc: DocSpec = findDoc(requested) ?? DOCS[0];
  const category = CATEGORIES.find((entry) => entry.id === doc.category) ?? CATEGORIES[0];
  const categoryDocs = docsForCategory(doc.category);
  const position = categoryDocs.findIndex((entry) => entry.slug === doc.slug);
  const previous = position > 0 ? categoryDocs[position - 1] : undefined;
  const next = position >= 0 && position < categoryDocs.length - 1 ? categoryDocs[position + 1] : undefined;

  return (
    <div className="min-h-screen bg-white text-stone-800">
      <header className="border-b border-stone-200 bg-white px-5 py-5 lg:px-8">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">DNA OS · Developer Portal</p>
            <h1 className="mt-1 text-xl font-bold text-stone-900">คู่มือสเปกและพอร์ทัลการเชื่อมต่อระดับโปรดักชัน</h1>
            <p className="mt-1 text-[12.5px] text-stone-500">
              {CATEGORIES.length} หมวด · {DOCS.length} หัวข้อ · {ENDPOINT_INDEX.length} endpoint · spec version {PORTAL_SPEC_VERSION}
            </p>
          </div>
          <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[11.5px] text-stone-600">
            <p className="font-semibold text-stone-800">Machine-readable spec</p>
            <p className="mt-0.5">
              <Link href="/api/v1/developer-portal" className="font-mono text-blue-700 underline" target="_blank" rel="noreferrer">
                GET /api/v1/developer-portal
              </Link>
            </p>
            <p className="mt-0.5">
              <Link href="/api/v1/spec" className="font-mono text-blue-700 underline" target="_blank" rel="noreferrer">
                GET /api/v1/spec
              </Link>
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-0 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="border-b border-stone-200 px-4 py-5 lg:sticky lg:top-0 lg:max-h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <Sidebar activeSlug={doc.slug} />
        </aside>

        <main className="min-w-0 px-5 py-6 lg:px-8">
          <div className="mb-6">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">
              {category.icon} {category.titleEn} · {category.title}
            </p>
            <h2 className="mt-1 text-lg font-bold text-stone-900">{doc.title}</h2>
            <p className="mt-1 text-[12px] font-mono text-stone-400">{doc.titleEn}</p>
            <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-stone-600">{doc.summary}</p>
          </div>

          <div className="space-y-8">
            {doc.sections.map((section) => (
              <SectionBlock key={section.id} section={section} docSlug={doc.slug} />
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-stretch justify-between gap-3 border-t border-stone-200 pt-5">
            {previous ? (
              <Link
                href={`/admin/docs?doc=${previous.slug}`}
                className="min-w-[12rem] rounded-lg border border-stone-200 px-3 py-2 text-[12px] text-stone-600 transition hover:border-stone-300 hover:bg-stone-50"
              >
                <span className="block text-[10px] uppercase tracking-wide text-stone-400">ก่อนหน้า</span>
                {previous.title}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                href={`/admin/docs?doc=${next.slug}`}
                className="min-w-[12rem] rounded-lg border border-stone-200 px-3 py-2 text-right text-[12px] text-stone-600 transition hover:border-stone-300 hover:bg-stone-50"
              >
                <span className="block text-[10px] uppercase tracking-wide text-stone-400">ถัดไป</span>
                {next.title}
              </Link>
            ) : (
              <span />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
