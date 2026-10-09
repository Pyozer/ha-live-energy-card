export interface Commit {
  hash: string;
  subject: string;
  body?: string;
}
export interface ParsedCommit {
  hash: string;
  type: string;
  scope?: string;
  summary: string;
  breaking?: string;
}
export const SECTIONS: { title: string; types: string[] }[];
export function parseCommit(commit: Commit): ParsedCommit | null;
export function buildNotes(
  commits: Commit[],
  options: { repoUrl: string; from?: string; to: string },
): string;
