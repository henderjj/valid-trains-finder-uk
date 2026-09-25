# Notes for Claude

- Before creating a pull request, update `docs/functionality.md` so it describes the app's
  full functionality as changed by the PR (what the user sees, and the rules for journeys
  and ticket validity). If nothing user-facing changed, say so in the PR description.
- Use up-to-date frameworks, libraries and GitHub Actions versions.
- The RSPS feed specifications are confidential: never commit them (`specs/` and `*.pdf`
  are git-ignored). Never commit credentials; the NRDP login lives only in repository
  secrets.
