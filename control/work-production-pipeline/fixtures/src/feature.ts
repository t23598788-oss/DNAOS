export function fixtureHello(marker: string): string {
  return `export const FEATURE_MARKER = ${JSON.stringify(marker)};\n`;
}
