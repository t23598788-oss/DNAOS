import commandRegistry from "@/registry/command-registry.json"

export interface ApiCommandDefinition {
  owner: string
  layer: string
  input?: Record<string, string>
  output?: string
  description?: string
  description_th?: string
  requires_confirmation?: boolean
  status?: string
}

export interface ApiToolDefinition {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
    _dna_command: string
  }
}

export function commandInputSchema(input: Record<string, string> = {}): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [rawKey, typeStr] of Object.entries(input)) {
    const optional = rawKey.endsWith("?")
    const key = optional ? rawKey.slice(0, -1) : rawKey
    const type = typeStr.includes("number") ? "number" : typeStr.includes("boolean") ? "boolean" : "string"
    properties[key] = { type, description: `${key}: ${typeStr}` }
    if (!optional) required.push(key)
  }

  return { type: "object", properties, required }
}

/**
 * Build the external AI tool contract from the canonical command registry.
 * This deliberately excludes confirmation-required commands: listing them
 * as callable tools would contradict /api/v1/query's read-only enforcement.
 */
export function buildReadOnlyToolSpec(): ApiToolDefinition[] {
  return Object.entries(commandRegistry.commands)
    .filter(([key, value]) => {
      if (key.startsWith("_")) return false
      const definition = value as ApiCommandDefinition
      return (definition.status ?? "active") === "active" && !definition.requires_confirmation
    })
    .map(([name, value]) => {
      const definition = value as ApiCommandDefinition
      return {
        type: "function",
        function: {
          name: name.replace(/\./g, "__"),
          description: [
            definition.description_th ?? definition.description ?? "",
            `layer: ${definition.layer}`,
            `output: ${definition.output ?? "unknown"}`,
          ].filter(Boolean).join(" | "),
          parameters: commandInputSchema(definition.input ?? {}),
          _dna_command: name,
        },
      }
    })
}
