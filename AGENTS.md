<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# DNA OS development and release rule

For every code change requested for a DNA OS repository, carry the same change through verification and GitHub publication. Do not stop with a local edit or a successful deployment.

## Release formula

`identify repo + branch + live version → inspect current state → make scoped change → run relevant checks → inspect exact diff and scan for secrets/private business data → commit verified files → publish that commit to GitHub → confirm remote commit and CI → deploy that exact GitHub commit when authorized → verify the live route and record its version`.

## Required behavior

- Before editing, verify the repository, intended branch, remote HEAD, and any live deployment or database version that the change touches. Do not infer that local `main`, GitHub `main`, and Production match.
- Keep unrelated dirty files out of the change. Never discard or stage them as a shortcut.
- Run the checks that cover the changed capability. If a required check fails, stop the release and report the exact failure; do not describe it as complete.
- Review the complete staged diff. Exclude secrets, credentials, personal data, customer records, commercial cost/margin data, and machine-specific paths.
- After checks pass, commit only the verified task files and publish the commit to the intended GitHub repository/branch. If the user did not name a branch, use a task branch and open a pull request; do not force-push or rewrite history.
- Confirm the exact GitHub commit SHA and CI result. A local commit, a deployment from an uncommitted worktree, or an HTTP 200 alone does not prove GitHub/Production alignment.
- Deploy only the exact published commit when the user authorized deployment. Verify the live page/API and compare its deployed commit/version to GitHub before reporting completion.
- Never request passwords, OTPs, or API keys in chat. Use the authenticated GitHub connection or the product's owner-controlled OAuth flow; ask the owner to complete login in the browser when required.
