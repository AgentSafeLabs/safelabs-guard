// Copy and helpers for the "Compare without the guard" disclosure. The guarded
// mode is the default; the unguarded one is reached through the disclosure.

import type { AgentMode } from "../agent/types";

export const DEFAULT_MODE: AgentMode = "guarded";
export const COMPARE_LABEL = "Compare without the guard";
export const COMPARE_HELP =
  "Runs the same agent with the guard switched off, so you can compare. Changing mode starts a new run.";
export const UNGUARDED_BANNER = "Unguarded: the agent executes whatever it proposes";
