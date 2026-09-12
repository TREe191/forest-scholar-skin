# Recovery eligibility evidence contract

This is an offline, pure assessment module. It is not wired into the launcher,
does not collect process data, and cannot terminate or restart anything.
An eligible result is a snapshot assessment, never a durable termination permit.

Input evidence must come from a trusted main/launcher-side collector, not renderer
input, editable history JSON, executable names or arbitrary caller assertions:

- launch: immutable launch ID, activation PID, launcher PID, requestedAt,
  registered expected executable/package and chosen high loopback port.
- preLaunch: a complete Codex inventory captured before activation.
- recordedProcesses: identities captured during this launch (PID, full path,
  exact canonical UTC start time including available precision, parent PID).
- snapshot: complete current descendant AND all-Codex inventory, observedAt,
  process identities and packageIdentity read from each process handle.
  Package evidence binds fullName to the same PID/start time. AppX registration
  alone is not process-package proof. Missing API support means uncertain.
- assessedAt: explicit clock input. Snapshots older than two seconds are uncertain.
- userUseEvidence: explicit user confirmation of not using this exact failed
  instance, tied to launch ID, activation PID and exact root start time, at/after
  the snapshot and no later than assessment. No current producer is implemented.
  Missing listener, idle input, window focus, or missing renderer is insufficient.

Root must be new, directly parented by the recorded launcher and retain the chosen
127.0.0.1 high port. Every candidate must be new in the launch window and have an
unbroken, time-consistent ancestry to the root, matching recorded PID/start/path,
and a matching handle-derived package identity. Unknown/non-Codex descendants
prevent whole-tree eligibility. Unrelated non-Codex processes confer no authority.
Existing Codex, old processes, identity mismatches or known use are ineligible.
Missing records, uncertain use/package/ancestry or incomplete inventories are
uncertain. Both outcomes refuse recovery. Any ineligible reason wins.

Existing lifecycle history cannot satisfy this contract: its package field is
registration-derived and it lacks the user-use attestation. Do not pass those
records as if they were strongly verified. Future termination would still require
fresh handle-based revalidation, race-safe targeting and its own explicit design.
This task adds neither that collector nor a recovery execution path.
