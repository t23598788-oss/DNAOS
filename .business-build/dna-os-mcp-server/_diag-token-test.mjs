const token = process.env.DNA_OS_API_TOKEN
if (!token) {
  console.error("DNA_OS_API_TOKEN not set — aborting.")
  process.exit(1)
}

const res = await fetch("https://dnaos.dev/api/v1/query", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-DNA-Token": token },
  body: JSON.stringify({ command: "debt.list", args: {} }),
})
const json = await res.json()
console.log("HTTP status:", res.status)
console.log("response:", JSON.stringify(json, null, 2))
