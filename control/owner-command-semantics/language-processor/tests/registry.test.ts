import { activeLanguageProcessor, getLanguageProcessor, listLanguageProcessors } from "../contract";

function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`FAIL ${label}`);
  console.log(`PASS ${label}`);
}

const processors = listLanguageProcessors();
const current = activeLanguageProcessor();

check("one current processor is registered", processors.length === 1 && current.processor_id === "local-qwen-semantic-processor");
check("processor is translation-only", current.has_execution_authority === false && current.has_tool_authority === false);
check("processor has no credential reference", current.credential_requirement === null);
check("unknown external ChatGPT processor is not silently available", getLanguageProcessor("chatgpt") === null);
