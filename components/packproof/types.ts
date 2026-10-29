import type { TurnResponse } from "@/lib/client/agent-api";

export interface HistoryEntry {
  id: number;
  at: string;
  response: TurnResponse;
  hadAudio: boolean;
}

export type SourceLabel = TurnResponse["sources"]["sam"];

export interface Frame {
  blob: Blob;
  url: string;
  origin: "camera" | "uploaded";
}

export type InputMode = "camera" | "upload";
