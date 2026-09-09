## Handoff: team-exec -> team-verify

- **Decided**: All 31 plan steps (S1-S31) plus 17 execution-added tasks are complete; sign-off gate `npm run verify:all` is 8/8 green (vitest 505, pytest 119, Playwright 39 default + 8 offline, 0 skipped both, dashboard to the cent). Every deviation is a dated row in plan section 10 "Execution deviations" / "Execution amendments".
- **Rejected**: LLM in the e2e bootstrap (hermetic no-client by design); byte identity vs the stopgap-written seed (seeded-DB equality instead); hard port-scan block with no override (E2E_SKIP_PORT_SCAN=1 documented).
- **Risks**: no ANTHROPIC key on this machine so every score/narrative is the tested fallback state; rehearsal (#38) not yet run by the user; ~100 paths uncommitted since checkpoint 38aabde; damaged ./data/pglite awaiting user decision; frozen-hazard replay never exercised (12 pytest skips).
- **Files**: .omc/plans/ocbc-climate-collateral-mvp.md (section 10), .omc/specs/deep-interview-ocbc-climate-collateral.md, tests/offline/checklist.md, docs/sources.md, docs/demo-script.md, README.md, scripts/verify-all.ts.
- **Remaining**: independent verifier pass against AC-1..AC-17; user rehearsal; checkpoint commit + clean-clone re-run.
