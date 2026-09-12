# Capability Registry

**Location:** `software/capability-registrar/` (and related software registry paths).

Write Gate uses the **existing** capability index / overlap search
(`searchOverlap`) to decide CREATE reuse vs MODIFY targets **after**
CONTROL_PLANE path confinement.

This documentation does not invent a new capability registry. Capability
registration remains the existing registrar pipeline in this monorepo.
