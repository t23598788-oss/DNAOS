/**
 * Rules engine — recipient resolution.
 *
 * "ยิงไปหา Role ไหน" is answered here: for a set of role codes, read
 * public.role_assignments (active rows that actually have a LINE userId) and
 * return one Recipient per assignment, de-duplicated per LINE user so a person
 * holding two of the targeted roles still gets ONE message.
 *
 * Assignment rows without line_user_id are kept out of the push list on
 * purpose: a role can be mapped for reporting before the person has linked a
 * LINE account, and that must not become a failed send.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Recipient } from "./types";

export interface RecipientResolution {
  byRole: Record<string, Recipient[]>;
  /** De-duplicated push list, one entry per LINE userId. */
  unique: Recipient[];
  /** Assignments that exist for the role but have no LINE userId yet. */
  unmapped: number;
}

interface AssignmentRow {
  id: string;
  role_code: string;
  subject_kind: "partner" | "line_user" | "profile";
  subject_id: string;
  display_name: string | null;
  line_user_id: string | null;
}

export async function resolveRecipients(
  db: SupabaseClient,
  roleCodes: string[],
): Promise<RecipientResolution> {
  const codes = [...new Set(roleCodes.filter(Boolean))];
  const byRole: Record<string, Recipient[]> = {};
  for (const code of codes) byRole[code] = [];

  if (codes.length === 0) return { byRole, unique: [], unmapped: 0 };

  const { data, error } = await db
    .from("role_assignments")
    .select("id, role_code, subject_kind, subject_id, display_name, line_user_id")
    .in("role_code", codes)
    .eq("active", true);

  if (error) {
    throw new Error(`rules: failed to read role_assignments: ${error.message}`);
  }

  const seen = new Set<string>();
  const unique: Recipient[] = [];
  let unmapped = 0;

  for (const row of (data ?? []) as AssignmentRow[]) {
    const recipient: Recipient = {
      roleCode: row.role_code,
      lineUserId: row.line_user_id,
      displayName: row.display_name,
      assignmentId: row.id,
      subjectKind: row.subject_kind,
      subjectId: row.subject_id,
    };

    (byRole[row.role_code] ??= []).push(recipient);

    if (!row.line_user_id) {
      unmapped += 1;
      continue;
    }
    if (seen.has(row.line_user_id)) continue;
    seen.add(row.line_user_id);
    unique.push(recipient);
  }

  return { byRole, unique, unmapped };
}
