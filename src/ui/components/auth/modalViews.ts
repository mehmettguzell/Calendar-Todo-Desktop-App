import { useState } from "react";
import type { AuthModalView } from "@/state/authState";

/**
 * The fields the account views share.
 *
 * Kept above them rather than inside each one so an address typed on the
 * sign-in view is still there after switching to "forgot my password" — which
 * is the only moment anybody switches.
 */
export function useAuthDraft() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  return { email, setEmail, password, setPassword, fullName, setFullName };
}

export type AuthDraft = ReturnType<typeof useAuthDraft>;

export interface AuthViewProps {
  draft: AuthDraft;
  onView: (view: AuthModalView) => void;
  /** Say what just worked, above the view. */
  onInfo: (text: string) => void;
}
