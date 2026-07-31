// Parses a spoken/typed print command ("พิมพ์ห้าแผ่น", "print 5 copies") into
// a copy count and triggers print-screen.sh — real Brother DCP-T430W over
// WiFi, no fake/simulated print. Run: node voice-print.mjs "<command text>"
import { execSync } from "child_process";

const THAI_NUMBERS = {
  "หนึ่ง": 1, "สอง": 2, "สาม": 3, "สี่": 4, "ห้า": 5,
  "หก": 6, "เจ็ด": 7, "แปด": 8, "เก้า": 9, "สิบ": 10,
};

function extractCopies(text) {
  const digitMatch = text.match(/\d+/);
  if (digitMatch) return parseInt(digitMatch[0], 10);
  for (const [word, n] of Object.entries(THAI_NUMBERS)) {
    if (text.includes(word)) return n;
  }
  return 1;
}

const command = process.argv.slice(2).join(" ");
if (!command) {
  console.error("ใช้: node voice-print.mjs \"พิมพ์ห้าแผ่น\"");
  process.exit(1);
}

const copies = extractCopies(command);
console.log(`[voice-print] คำสั่ง: "${command}" -> สั่งพิมพ์ ${copies} แผ่น`);
execSync(`/Users/tam/dna-os-ollama/print-screen.sh ${copies}`, { stdio: "inherit" });
