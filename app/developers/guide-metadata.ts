import { publicDeveloperOrigin } from "@/config/system-links";

const icon = {
  url: "/developers/brand/dna-os-mark-mono.png",
  type: "image/png",
  sizes: "384x384",
};

export function guideUrl(path: string) {
  return new URL(path, publicDeveloperOrigin).href;
}

export function guideMetadata(path: string, title: string, description: string) {
  return {
    title: title === "DNA OS" ? "DNA OS · คู่มือเชื่อมต่อ" : `${title} · DNA OS`,
    description,
    alternates: { canonical: guideUrl(path) },
    icons: { icon },
  };
}

export function guideJsonLd(path: string, title: string, description: string) {
  const home = guideUrl("/");
  const organization = { "@id": `${home}#organization` };
  const website = { "@id": `${home}#website` };
  const url = guideUrl(path);

  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        ...organization,
        "@type": "Organization",
        name: "DNA OS",
        url: home,
        logo: { "@type": "ImageObject", url: guideUrl(icon.url) },
      },
      {
        ...website,
        "@type": "WebSite",
        name: "DNA OS",
        url: home,
        publisher: organization,
      },
      {
        "@id": `${url}#webpage`,
        "@type": "WebPage",
        url,
        name: title,
        description,
        inLanguage: "th",
        isPartOf: website,
        publisher: organization,
      },
    ],
  }).replaceAll("<", "\\u003c");
}
