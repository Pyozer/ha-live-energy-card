# Contributing

## Before committing

```bash
npm run check   # lint, formatting, tests with coverage and build
```

Every commit must leave the project building with all tests passing. The same check runs in CI on
every push and pull request. Changed code comes with its
tests and updated documentation (see [AGENTS.md](AGENTS.md)).

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
