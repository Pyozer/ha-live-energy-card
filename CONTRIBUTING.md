# Contributing

## Node version

The Node version is pinned in `.nvmrc`, which nvm, fnm, mise and the CI all read. `package.json`
states the minimum (`engines`) and `.npmrc` makes `npm install` fail on an older Node.

With [mise](https://mise.jdx.dev), reading `.nvmrc` has to be enabled once on your machine, otherwise
mise ignores it without a message:

```bash
mise settings add idiomatic_version_file_enable_tools node
mise install   # installs the version of .nvmrc
```

## Before committing

```bash
npm run check   # lint, formatting, tests with coverage and build
```

Every commit must leave the project building with all tests passing. The same check runs in CI on
every push and pull request. Changed code comes with its
tests and updated documentation (see [AGENTS.md](AGENTS.md)).

## Releasing

From a clean `main`, with the commits to release already in:

```bash
npm run release -- minor   # or patch, major, or an exact version such as 0.17.0
git push --follow-tags
```

`npm run release` runs `npm run check` first, then bumps `package.json` and `package-lock.json`,
commits `chore: release x.y.z` and creates the annotated tag `vx.y.z`. It refuses to run on a dirty
working tree. Nothing is pushed by the script: `git push --follow-tags` sends the commit and the tag
together. The tag triggers the `Release` workflow, which publishes the GitHub release that HACS
installs.

If the release commit already exists (version bumped by hand), only the tag is missing:
`git tag -a vx.y.z -m "chore: release x.y.z"`, then `git push --follow-tags`.

## Commit messages

Messages follow [Conventional Commits](https://www.conventionalcommits.org/) and are written
**in English**.

```
<type>(<optional scope>): <summary>

<optional body>
```

- **Summary**: imperative mood, lowercase, no trailing period, 72 characters max.
  It states clearly what the commit does.
- **Body**: only when the summary is not enough (the why, a side effect). A few lines at most.
- **No `Co-authored-by`** or any other attribution line.
- One commit = one coherent change. Keep refactors apart from fixes and features.

### Types

| Type | Use |
| --- | --- |
| `feat` | New user-facing feature. |
| `fix` | Bug fix. |
| `perf` | Performance improvement. |
| `refactor` | Restructuring without behavior change. |
| `style` | Formatting only (not the card's CSS, which is `feat` or `fix`). |
| `test` | Adding or changing tests. |
| `docs` | Documentation only. |
| `build` | Build, dependencies, Vite or TypeScript configuration. |
| `ci` | Continuous integration. |
| `chore` | Miscellaneous maintenance (version bump, tooling). |

A change that breaks existing configurations is marked with `!` after the type (`feat!: …`) and a
`BREAKING CHANGE: …` line in the body.

### Release notes

The notes of a release are built from these messages: the summary of each `feat`, `fix`, `perf`,
`refactor`, `docs`, `build` and `ci` commit since the previous tag, grouped by type (`chore`, `test`
and `style` are left out). Write the summary for someone who uses the card. A breaking change (`!`
or a `BREAKING CHANGE:` line) gets its own heading.

### Common scopes

`card`, `editor`, `layout`, `animation`, `model`, `demo`, `i18n`.

### Examples

```
feat(editor): import devices from the energy dashboard
fix(layout): round the bus corner on narrow screens
fix(editor): persist the glow toggle when enabled
test(layout): cover single-column stacked layout
chore: release 0.1.5
```

With a body:

```
fix(card): hide battery caption with its node

Hidden nodes have no layout position, so the caption was drawn at the
top-left corner of the card.
```
