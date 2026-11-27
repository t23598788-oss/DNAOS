import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, BookOpen, Braces } from "lucide-react";
import { docsHome, docsNav } from "./docs-data";

export const docLink = "font-medium text-sky-800 underline underline-offset-4 hover:text-sky-950";

export function CodeSample({ children }: { children: string }) {
  return <pre className="my-4 overflow-x-auto rounded-lg border border-stone-200 bg-stone-50 p-4 font-mono text-[13px] leading-6"><code>{children}</code></pre>;
}

export type DocSection = { id: string; title: string; content: ReactNode };

export function DocsArticle({ current, title, description, sections, children }: {
  current: string;
  title: string;
  description: string;
  sections: DocSection[];
  children?: ReactNode;
}) {
  const toc = (
    <ul className="space-y-2 text-stone-600">
      {sections.map(({ id, title: heading }) => (
        <li key={id}><a className="hover:text-sky-800 hover:underline" href={`#${id}`}>{heading}</a></li>
      ))}
    </ul>
  );

  return (
    <div className="min-h-screen w-full bg-white text-stone-900 [font-family:'Noto_Sans_Thai',Thonburi,'Leelawadee_UI',system-ui,sans-serif]">
      <header className="border-b border-stone-200">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-8">
          <Link href={docsHome} className="inline-flex items-center gap-2 text-sm font-semibold">
            <BookOpen size={17} aria-hidden="true" /> DNA OS <span className="text-stone-500">เอกสารนักพัฒนา</span>
          </Link>
          <div className="flex gap-4 text-sm">
            <Link href={`${docsHome}/api/spec`} className="inline-flex items-center gap-1.5 hover:underline"><Braces size={15} aria-hidden="true" /> อ้างอิง API</Link>
            <Link href="/" className="inline-flex items-center gap-1.5 hover:underline">หน้าแรก DNA OS <ArrowUpRight size={14} aria-hidden="true" /></Link>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1440px] gap-7 px-5 py-7 md:grid-cols-[12rem_minmax(0,1fr)] md:px-8 min-[940px]:grid-cols-[12rem_minmax(0,1fr)_9rem] min-[940px]:gap-7 lg:grid-cols-[13rem_minmax(0,1fr)_10rem] lg:gap-9 xl:gap-12">
        <nav aria-label="เมนูเอกสาร" className="self-start text-sm md:sticky md:top-5 md:max-h-[calc(100dvh-2.5rem)] md:overflow-auto md:border-r md:border-stone-200 md:pr-4">
          <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-1 md:gap-5">
            {docsNav.map((group) => (
              <div key={group.label}>
                <p className="mb-1.5 px-2 text-xs font-semibold text-stone-500">{group.label}</p>
                {group.links.map(({ href, title: label }) => {
                  const active = current === href || (href === `${docsHome}/integrations` &&
                    current.startsWith(href + "/") && current !== `${href}/line`);
                  return <Link key={href} href={href} aria-current={active ? "page" : undefined}
                    className={`block rounded-md px-2 py-1.5 ${active ? "bg-sky-50 font-semibold text-sky-900" : "text-stone-700 hover:bg-stone-100"}`}>{label}</Link>;
                })}
              </div>
            ))}
          </div>
        </nav>

        <main className="min-w-0">
          <article className="mx-auto max-w-[44rem] text-base leading-[1.7]">
            <h1 className="text-[27px] font-semibold leading-tight tracking-tight">{title}</h1>
            <p className="mt-3 text-stone-600">{description}</p>
            <details className="mt-4 rounded-md border border-stone-200 px-3 py-2 text-sm min-[940px]:hidden">
              <summary className="cursor-pointer font-semibold">ในหน้านี้</summary>
              <div className="mt-2">{toc}</div>
            </details>
            {children}
            {sections.map(({ id, title: heading, content }) => (
              <section key={id} id={id} className="mt-8 scroll-mt-5">
                <h2 className="mb-2 text-xl font-semibold leading-snug">{heading}</h2>
                {content}
              </section>
            ))}
          </article>
        </main>

        <nav aria-label="ในหน้านี้" className="hidden self-start border-l border-stone-200 pl-4 text-sm min-[940px]:sticky min-[940px]:top-5 min-[940px]:block">
          <p className="mb-2 font-semibold">ในหน้านี้</p>
          {toc}
        </nav>
      </div>
    </div>
  );
}
