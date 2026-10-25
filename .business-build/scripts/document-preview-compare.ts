/**
 * T4 visual compare — stored ORIGINAL png vs fresh PREVIEW png (same document).
 * Uses the existing sharp dependency.
 *
 * Metric (fixed 2026-10-10 after a real control failure): raw changed-pixel
 * ratio cannot discriminate on A4 documents (ink ≈ 1-2% of the page, so two
 * DIFFERENT documents also differ by only ~2%). The meaningful signal is the
 * ink union: how much of the ink either image has differs between them.
 *   MATCH      = <15% of union-ink changed  (same doc, e.g. one notes line)
 *   MISMATCH   = >30%                       (different doc — control pair)
 *   UNCERTAIN  = in between (exit 1)
 *
 * Run: npx tsx scripts/document-preview-compare.ts <a.png> <b.png>
 */
import sharp from "sharp"

async function main() {
  const [aPath, bPath] = process.argv.slice(2)
  if (!aPath || !bPath) {
    console.error("usage: document-preview-compare.ts <a.png> <b.png>")
    process.exit(2)
  }
  const a = await sharp(aPath).greyscale().raw().toBuffer({ resolveWithObject: true })
  const b = await sharp(bPath).greyscale().raw().toBuffer({ resolveWithObject: true })
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    console.log(`RESULT: DIMENSION_MISMATCH ${a.info.width}x${a.info.height} vs ${b.info.width}x${b.info.height}`)
    process.exit(1)
  }
  let unionInk = 0
  let changedInk = 0
  let rawChanged = 0
  const total = a.data.length
  for (let i = 0; i < total; i++) {
    const pa = a.data[i]
    const pb = b.data[i]
    const d = Math.abs(pa - pb)
    if (d > 8) rawChanged++
    const ink = pa < 245 || pb < 245
    if (ink) {
      unionInk++
      if (d > 8) changedInk++
    }
  }
  const rawRatio = rawChanged / total
  const inkRatio = unionInk ? changedInk / unionInk : 0
  const identical = rawChanged === 0
  console.log(`raw_changed=${(rawRatio * 100).toFixed(3)}% ink_changed=${(inkRatio * 100).toFixed(3)}% identical=${identical}`)
  if (identical) {
    console.log("RESULT: BYTE_IDENTICAL_RENDER")
    process.exit(0)
  }
  if (inkRatio < 0.15) {
    console.log("RESULT: VISUALLY_MATCHING")
    process.exit(0)
  }
  if (inkRatio > 0.3) {
    console.log("RESULT: MISMATCH")
    process.exit(1)
  }
  console.log("RESULT: UNCERTAIN")
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

