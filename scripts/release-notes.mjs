// Release notes from the Conventional Commits between the previous tag and the released one:
//   node scripts/release-notes.mjs v0.8.0 > notes.md
// GitHub's generated notes only list merged pull requests, which leaves out the commits pushed
// straight to main. Used by the Release workflow; the formatting is a pure function, tested.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Sections in display order, with the commit types they gather. Other types are left out. */
export const SECTIONS = [
  { title: 'Breaking changes', types: [] },
  { title: 'Features', types: ['feat'] },
  { title: 'Fixes', types: ['fix'] },
  { title: 'Performance', types: ['perf'] },
  { title: 'Refactoring', types: ['refactor'] },
  { title: 'Documentation', types: ['docs'] },
  { title: 'Build and CI', types: ['build', 'ci'] },
  { title: 'Other changes', types: ['other'] },
];

const SUBJECT = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;
/** Types that say nothing to a user of the card. */
const SKIPPED = new Set(['chore', 'test', 'style']);

/** A commit `{ hash, subject, body }` as a note entry, or `null` when it is left out. */
export function parseCommit({ hash, subject, body = '' }) {
  if (/^Merge /.test(subject) || /^Revert "/.test(subject)) return null;
  const match = SUBJECT.exec(subject);
  // A message that is not a conventional commit is kept, rather than silently lost.
  const type = match ? match[1].toLowerCase() : 'other';
  if (SKIPPED.has(type)) return null;
  const breaking = /^BREAKING[ -]CHANGE:\s*(.+)$/m.exec(body);
  return {
    hash,
    type,
    scope: match?.[2],
    summary: match ? match[4] : subject,
    breaking: match?.[3] === '!' || !!breaking ? (breaking?.[1] ?? '') : undefined,
  };
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Markdown notes. `commits` are `{ hash, subject, body }`, oldest first; `repoUrl` is the
 * repository page (`https://github.com/owner/repo`); `from` is the previous tag, if any.
 */
export function buildNotes(commits, { repoUrl, from, to }) {
  const entries = commits.map(parseCommit).filter(Boolean);
  const line = (e, text = e.summary) =>
    `- ${e.scope ? `**${e.scope}:** ` : ''}${capitalize(text)} ([\`${e.hash.slice(0, 7)}\`](${repoUrl}/commit/${e.hash}))`;

  const out = [];
  for (const { title, types } of SECTIONS) {
    const lines =
      title === 'Breaking changes'
        ? entries.filter((e) => e.breaking !== undefined).map((e) => line(e, e.breaking || e.summary))
        : entries
            // A breaking change is listed once, under its own heading.
            .filter((e) => e.breaking === undefined)
            .filter((e) => types.includes(e.type) || (types.includes('other') && !isKnown(e.type)))
            .map((e) => line(e));
    if (lines.length) out.push(`## ${title}`, '', ...lines, '');
  }
  if (!out.length) out.push('No user-facing changes.', '');
  out.push(
    from
      ? `**Full changelog**: ${repoUrl}/compare/${from}...${to}`
      : `**Full changelog**: ${repoUrl}/commits/${to}`,
  );
  return `${out.join('\n')}\n`;
}

const isKnown = (type) => SECTIONS.some((s) => s.types.includes(type));

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

/** Commits in `range`, oldest first. */
function commitsIn(range) {
  const raw = git('log', '--reverse', '--pretty=format:%H%x1f%s%x1f%b%x1e', ...range);
  return raw
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash, subject, body] = r.split('\x1f');
      return { hash, subject, body };
    });
}

function repositoryUrl() {
  if (process.env.GITHUB_REPOSITORY) {
    return `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}`;
  }
  const remote = git('remote', 'get-url', 'origin').trim();
  return remote.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
}

function previousTag(tag) {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*', `${tag}^`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined; // First release: the whole history.
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2];
  if (!tag) {
    console.error('Usage: node scripts/release-notes.mjs <tag>');
    process.exit(1);
  }
  const from = previousTag(tag);
  const commits = commitsIn([from ? `${from}..${tag}` : tag]);
  process.stdout.write(buildNotes(commits, { repoUrl: repositoryUrl(), from, to: tag }));
}
