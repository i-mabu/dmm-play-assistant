# Contributing

This project follows the unified development workflow shared across the
maintainer's repositories (adopted from aegis-app/aegis-bot).

## Development workflow

1. **Open an issue first.** Every change starts with an issue (use the
   issue templates). Describe the purpose, the planned work, and the
   definition of done.
2. **Create a branch from `main`** named `<type>/<issue-number>-<slug>`,
   e.g. `feat/12-template-matching`, `fix/9-danger-words`, `docs/3-readme`.
3. **Implement and test.** Run `npm run check`, `npm test`, and
   `npm run build` locally; all must pass.
4. **Open a pull request.** Fill in the PR template and link the issue
   with `Closes #<number>`.
5. **Merge with "Rebase and merge"** to keep the history of `main`
   linear, then delete the branch.

## Commit messages

Commit messages use **Conventional Commits with English subjects**:

```
feat: add template matching threshold setting
fix: stop the watcher after the reload limit is reached
docs: update documentation for v1.0.0
```

Types in use: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`.

## Code comments

Comments are written in Japanese and follow the fleet convention:
banner headers with an emoji title at the top of each file, and
subject-matched emoji markers on substantive comments
(🎯 target, ⚠️ caution, 🕐 time, 🔢 count, 💾 storage, 🖼️ image,
🛑 stop, 🔁 loop, 📅 schedule, 👀 watch).

## Extension structure

The content scripts are plain scripts that share one scope and run in
the order listed in `manifest.json` (`content/01-…` to `content/05-…`).
Keep that in mind: top-level names must not collide across the five
files, and later files may use what earlier files defined.

## Releases

Releases are cut from `main`: bump the version (both `package.json`
and `manifest.json`), tag `vX.Y.Z`, and publish a GitHub Release with
notes only (no binaries are attached).

## Notes

- Never commit secrets. This extension stores user settings only in
  `chrome.storage.local` under the key `mpaSettings`; the storage key
  names are part of the compatibility surface and must not be renamed.
