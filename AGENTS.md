# PORTFOLIO3 REPO OPERATING MEMORY

This file adds repo-specific execution rules for `portfolio3`. Use it alongside the global operating memory, not instead of it.

## REPO SHAPE
- This is a multi-site repo, not a single-site app.
- Treat `home/`, `about/`, `contact/`, and `apps/` as separate site roots unless the task clearly spans more than one site.
- Do not assume a change in one site should be mirrored into the others unless the shared structure or the user request makes that necessary.
- Before editing, identify which site root actually owns the behavior.
- Under no circumstances should broad repo-wide or "global cleanup" edits be made by default in this repo.
- This system has fragile areas and cross-site coupling that can break silently.
- Default to extreme surgical precision: smallest possible diff, narrowest possible file set, narrowest possible runtime surface.

## DEPLOYMENT TARGETING
- Do not assume `portfolio2` deployment targets apply to this repo.
- Before any deploy or site-level config change, identify or create the correct repo env file for `portfolio3`.
- Verify the exact target site for the affected area before deploying.
- Until repo-specific env vars are confirmed, treat deployment targeting as unverified and pause before any external deploy action.

## PORTFOLIO2 PRODUCTION REFERENCE
- The current `portfolio2`-related production Netlify project names confirmed from screenshots are:
  - `dev-in-portfolio-home`
  - `dev-in-portfolio-about`
  - `dev-in-portfolio-contact`
  - `dev-in-portfolio-apps`
  - `dev-in-portfolio-utilities`
  - `dev-in-portfolio-capabilities`
- Treat those names as production/reference targets for `portfolio2`, not as valid default targets for `portfolio3`.
- `portfolio3` is a sandbox and must not be wired to those production projects by assumption, convenience, or name similarity.
- If a future deploy target for `portfolio3` is created, it must be verified as separate from the `portfolio2` production projects before any publish action.

## GIT AND RELEASE MODEL
- `portfolio2` is the live auto-deploy repo.
- `portfolio3` is the sandbox development repo.
- Day-to-day work, experimentation, and iterative fixes should happen in `portfolio3`.
- Push `portfolio3` changes normally so sandbox work is tracked in git.
- Do not treat a `portfolio3` push as equivalent to a `portfolio2` push.
- Treat any `portfolio2` push as a release action because it can trigger Netlify auto-deploys.
- Do not push experimental or partially validated work directly to `portfolio2`.

## CHANGE SCOPING
- Prefer the smallest site-scoped change that solves the request.
- Keep shared changes in shared locations when the same behavior is genuinely common across sites.
- Keep site-specific changes local when only one site is affected.
- If a requested change appears duplicated across multiple site roots, check whether that duplication is intentional before normalizing it.
- Do not perform repo-wide search-and-replace, cross-site cleanup, naming normalization, or shared refactors unless the user explicitly asks for that exact broader scope.
- If a fix appears to invite a "global" solution, pause and prefer the local fix unless the broader change is clearly required for correctness.
- Treat root-level edits, shared asset edits, shared config edits, and shared script edits as high-risk changes that need stronger justification and tighter validation than site-local edits.

## FILE OWNERSHIP DEFAULTS
- `home/`, `about/`, `contact/`, and `apps/` own their own `index.html`, static assets, Netlify config, and tests.
- `shared/` directories inside site roots are the first place to look for within-site shared code/assets.
- Root-level files should not be treated as global runtime for all sites unless the repo structure proves that.

## VALIDATION RULES
- Validate at the site root you changed.
- If a change touches shared behavior used by more than one site, test the affected sibling sites too.
- For deploy-related work, verify both local file changes and target-site mapping before concluding.
- Be explicit about which site(s) were checked and which site(s) remain unverified.
- When a change touches anything outside one site root, explicitly call out the blast radius before proceeding.

## COPY-BACK RULES
- `portfolio3` exists to prove changes safely before they are considered for `portfolio2`.
- Do not assume a successful sandbox change should be copied back wholesale.
- When copying a proven fix back into `portfolio2`, carry over only the minimal validated diff required for the real problem.
- After a fix is proven in `portfolio3`, prefer copying the exact intended changes into `portfolio2` rather than trying to synchronize the repos broadly.
- Before copy-back, explicitly identify:
  - which site root owns the fix
  - which exact files changed in `portfolio3`
  - what was validated in the sandbox
  - what must be revalidated in `portfolio2`
- Treat copy-back as a fresh precision pass, not a bulk sync.
- Do not overwrite `portfolio2` repo-specific deployment wiring, environment assumptions, or production-safe configuration with sandbox-specific edits.
- If a sandbox fix depended on temporary data, local-only paths, fake endpoints, or experimental guardrails, strip or adapt those before copy-back.
- If a sandbox change touched shared or root-level files, re-evaluate blast radius before bringing it into `portfolio2` even if the sandbox result looked correct.

## REPO-SPECIFIC REPORTING
- In summaries, name the affected site root explicitly.
- If a finding applies only to one site, say so.
- If a finding may affect multiple site roots, call out the spread instead of presenting it as single-page behavior.
