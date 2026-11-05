export type LineEnding = "CRLF" | "LF" | "CR";

export interface OpenedDocument {
  path: string;
  name: string;
  text: string;
  encoding: string;
  line_ending: LineEnding;
  encoding_warning?: string | null;
}

export interface ByteNote {
  hex: string;
  text: string;
  fault: boolean;
}

export type DisplayBlock =
  | { type: "heading"; text: string }
  | { type: "kv"; label: string; value: string; fault: boolean }
  | { type: "status"; label: string; value: string; fault: boolean }
  | { type: "flags"; items: string[] }
  | { type: "hex"; label: string; value: string };

export interface ParseEvent {
  id: string;
  dir: string;
  fault: boolean;
  line: number;
  cmd?: number | null;
  title: string;
  bytes: ByteNote[];
  clauses?: ByteNote[];
  blocks?: DisplayBlock[];
}

export interface ParseResponse {
  events: ParseEvent[];
  rule_name: string;
  rule_id: string;
}

export interface ParseLineInput {
  line: number;
  text: string;
}

export interface RuleSummary {
  id: string;
  name: string;
  version: string;
  builtin: boolean;
  active: boolean;
}

/** Tab metadata only — document body lives in CodeMirror EditorState. */
export interface DocTab {
  id: string;
  name: string;
  path: string;
  encoding: string;
  lineEnding: LineEnding;
  dirty: boolean;
}

export interface ViewportRange {
  fromLine: number;
  toLine: number;
}
