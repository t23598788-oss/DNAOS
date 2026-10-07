# Local execution

Local CONTROL_PLANE checkout for this node (verified in live proof context):

`/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE`

Execution that mutates CONTROL_PLANE source must:

1. Resolve ACTIVE CONTROL_PLANE via Repository Registry
2. Pass Write Gate path confinement + overlap rules
3. Use existing execution adapters (file-write / agent-gateway), not ad-hoc writes

Local path binding is node-specific. Do not treat another machine’s old
checkout path as authority here.
