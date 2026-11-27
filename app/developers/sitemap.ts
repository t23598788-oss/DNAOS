import type { MetadataRoute } from "next";
import { generateStaticParams } from "./[...topic]/page";
import { docsHome } from "./docs-data";
import { guideUrl } from "./guide-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [docsHome, ...generateStaticParams().map(({ topic }) => `${docsHome}/${topic.join("/")}`)];
  return paths.map((path) => ({ url: guideUrl(path) }));
}
