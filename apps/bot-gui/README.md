# Cat-and-Dog Bot GUI

This app is a local completed-run replay and artifact viewer for Cat-and-Dog player runs.

Start it from the repository root:

```powershell
pnpm run gui
```

Open the printed local URL, usually `http://127.0.0.1:5178`.

The dashboard automatically scans `artifacts/**/reports/02-player-attempt-summary.json`. You can also paste a specific summary path into the Summary path field, for example:

```text
artifacts/<runId>/reports/02-player-attempt-summary.json
```

The first version is intentionally read-only. It displays run metadata, attempt outcomes, final HP, damage, wind, wall state, planned shots, shot feedback, action history, artifact paths, and screenshot artifacts from the existing JSON reports.

## Future Human-vs-Bot Seam

The TypeScript contract in `src/human-vs-bot-contract.ts` defines the minimal future interface for 2-player Cat-and-Dog work:

- match config with human side and bot side
- turn snapshots that identify whose turn it is
- helpers for deciding whether the bot or human should act
- shot choice and shot outcome telemetry events

This does not start a live match or change the Cat-and-Dog planner. It is only the seam needed for a later controller to keep human input untouched on the human turn, let the bot act only on its turn, and record both human and bot shot choices.
