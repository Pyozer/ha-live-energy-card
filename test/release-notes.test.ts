import { describe, expect, it } from 'vitest';
import { buildNotes, parseCommit, type Commit } from '../scripts/release-notes.mjs';

const repoUrl = 'https://github.com/owner/repo';
const commit = (subject: string, body = '', hash = 'a'.repeat(40)): Commit => ({ hash, subject, body });
const notes = (commits: Commit[], from: string | undefined = 'v1.0.0') =>
  buildNotes(commits, { repoUrl, from, to: 'v1.1.0' });

describe('release notes', () => {
  it('groups the commits by type, with the scope and a link to each', () => {
    const text = notes([
      commit('feat(editor): drag and drop devices', '', '1234567890'.repeat(4)),
      commit('fix: signed grid value'),
      commit('docs: explain the cost entities'),
      commit('perf(animation): write fewer attributes'),
    ]);
    expect(text).toContain('## Features\n\n- **editor:** Drag and drop devices ([`1234567`](');
    expect(text).toContain(`${repoUrl}/commit/${'1234567890'.repeat(4)}`);
    expect(text.indexOf('## Features')).toBeLessThan(text.indexOf('## Fixes'));
    expect(text).toContain('## Fixes\n\n- Signed grid value');
    expect(text).toContain('## Performance');
    expect(text).toContain('## Documentation');
  });

  it('includes commits pushed straight to main, not only merged pull requests', () => {
    const text = notes([
      commit('Merge pull request #3 from owner/dependabot/setup-node-6'),
      commit('build(deps): bump actions/setup-node from 4 to 6'),
      commit('feat: show the battery time to full'),
    ]);
    expect(text).toContain('Show the battery time to full');
    expect(text).toContain('## Build and CI');
    expect(text).not.toContain('Merge pull request');
  });

  it('leaves out what says nothing to a user: releases, tests, formatting, merges', () => {
    const text = notes([
      commit('chore: release 0.7.0'),
      commit('test(layout): cover narrow screens'),
      commit('style: format'),
      commit('Merge branch main'),
      commit('Revert "feat: x"'),
    ]);
    expect(text).toContain('No user-facing changes.');
    expect(text).not.toContain('## ');
  });

  it('keeps a message that is not a conventional commit', () => {
    const text = notes([commit('Fix the thing')]);
    expect(text).toContain('## Other changes\n\n- Fix the thing');
  });

  it('lists a breaking change once, under its own heading', () => {
    const text = notes([
      commit('refactor!: rename the card', 'BREAKING CHANGE: the type is now custom:live-energy-card'),
      commit('feat(cost)!: price sources'),
    ]);
    expect(text).toContain(
      '## Breaking changes\n\n- Rename the card: the type is now custom:live-energy-card',
    );
    expect(text).toContain('- **cost:** Price sources');
    expect(text).not.toContain('## Refactoring');
    expect(text).not.toContain('## Features');
    expect(parseCommit(commit('fix: a'))?.breaking).toBeUndefined();
  });

  it('keeps the whole footer of a breaking change, even wrapped, and stops at the next paragraph', () => {
    const body = 'A body.\n\nBREAKING CHANGE: the option `a`\nmoved to `b`,\nsee the README.\n\nRefs: #1';
    expect(parseCommit(commit('feat!: move an option', body))?.breaking).toBe(
      'the option `a` moved to `b`, see the README.',
    );
    expect(notes([commit('feat!: move an option', body)])).toContain(
      '- Move an option: the option `a` moved to `b`, see the README. (',
    );
  });

  it('ends with a link to the full comparison, or to the history for a first release', () => {
    expect(notes([commit('feat: a')])).toContain(`**Full changelog**: ${repoUrl}/compare/v1.0.0...v1.1.0`);
    expect(buildNotes([commit('feat: a')], { repoUrl, to: 'v1.1.0' })).toContain(`${repoUrl}/commits/v1.1.0`);
  });
});
