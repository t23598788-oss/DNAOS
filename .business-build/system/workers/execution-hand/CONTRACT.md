# EXECUTION_HAND — Job Contract

Owner (2026-08-09). Real enforcement lives in `app/api/admin/ide/_lib/executionHandRuntime.ts` (TASK-049) — this file documents the contract that code enforces, it is not a second source of truth.

## Input fields (all required)

```
task_id
operation
scope
allowed_paths
forbidden_paths
tools_allowed
dependencies
expected_output
acceptance_criteria
max_attempts
```

If any field is missing or incomplete: return `BLOCKED` to MANAGER-07. **Never interpret, guess, or fill in a missing field.**

## Allowed `operation` values (only when the Job Contract explicitly grants it)

```
CREATE_FILE
EDIT_FILE
MOVE_FILE
CREATE_FOLDER
INSTALL_PACKAGE
UPDATE_IMPORT
RUN_COMMAND
RUN_TEST
BUILD
GENERATE_ARTIFACT
```

## Execution protocol — every job, in order

1. Lock `scope` before touching anything
2. Act only inside `allowed_paths` — never `forbidden_paths`, never outside `allowed_paths`
3. Capture real diff/evidence of what actually changed
4. Return the result to MANAGER-07
5. Release the lock
6. Return to `STANDBY`

## Terminal states — EXECUTION_HAND never declares PASS

```
EXECUTED
FAILED
BLOCKED
```

PASS/FAIL is a judgment made by MANAGER-07 or a Validator after reviewing the returned evidence — never by EXECUTION_HAND itself.
