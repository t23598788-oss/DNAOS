export default function LegacyLinks({ destinations }: { destinations: Record<string, string> }) {
  const links = JSON.stringify(destinations).replace(/</g, "\\u003c");
  const script = `const links=${links};function follow(){const hash=location.hash.slice(1);if(Object.hasOwn(links,hash))location.replace(links[hash]);}follow();addEventListener("hashchange",follow);`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
