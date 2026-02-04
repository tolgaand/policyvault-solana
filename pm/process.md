# PM Process (PolicyVault Solana)

## Cadence (2-week sprints)
- Sprint length: 2 weeks (Wed–Tue)
- Planning: Day 1 (Wed)
- Mid-sprint check-in: Day 6 (Mon)
- Demo/Review: Day 10 (Tue)
- Retro: Day 10 (Tue)
- Release window: end of sprint after review

## Roles & responsibilities
- PM (you): backlog ordering, scope decisions, acceptance criteria, demo narrative
- Engineering: delivery, estimates, technical approach, tests, PRs
- Design/UX (as available): flows, copy, visuals, demo polish
- QA (as available): validation plan, regression checks

## Tooling and agent usage
- Codex (this repo): planning artifacts, backlog grooming, sprint definitions, task breakdowns
- Claude Code: implementation, code changes, test updates, PR-ready outputs
- Single source of truth: pm/ folder (process, backlog, sprint docs)

## Workflow
1) PM defines sprint goals and initial scope.
2) Codex drafts sprint plan, board, and acceptance criteria.
3) Claude Code executes tasks and updates status in sprint board.
4) PM reviews completion vs. acceptance criteria.
5) Demo + retro; archive learnings in sprint file.

## Definition of Ready (DoR)
- User story is clear and testable
- Acceptance criteria written
- Dependencies known or explicitly marked
- Estimate assigned (t-shirt or points)

## Definition of Done (DoD)
- Acceptance criteria met
- Tests updated/added as needed
- Docs/notes updated if user-facing
- Demo flow verified (if in scope)
- No critical bugs introduced

## Status tracking
- Source of truth: pm/sprints/sprint-XXX-board.md
- Status values: Todo, In Progress, Blocked, Done
- Updates at least 2x per week or when a task changes state
