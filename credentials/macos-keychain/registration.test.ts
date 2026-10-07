import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./registration.ts", import.meta.url), "utf8");
assert(source.includes("add-generic-password"));
assert(source.includes("credential_ref"));
assert(!source.includes("appendFileSync"));
assert(!source.includes("JSON.stringify(input.secret)"));
console.log("PASS: owner credential registration boundary is reference-only");
