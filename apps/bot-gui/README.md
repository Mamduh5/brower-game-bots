# Cat-and-Dog Bot GUI

This app is a local live runner plus completed-run replay and artifact viewer for Cat-and-Dog player runs.

Start it from the repository root:

```powershell
pnpm run gui
```

Open the printed local URL, usually `http://127.0.0.1:5178`.

Use the Live Runner panel to choose game, browser mode, and the game-specific bounded settings, then click Start Run. Browser mode defaults to Headless. Select Visible to open a real Playwright-controlled browser window on the desktop while the bot plays.

The server starts the existing CLI command as a child process, equivalent to:

```powershell
pnpm run dev -- run-player-cat-and-dog --difficulty=impossible --max-attempts=5 --strategy-mode=explore --stop-on-win=false
```

Visible mode adds the `--visible` alias:

```powershell
pnpm run dev -- run-player-cat-and-dog --difficulty=impossible --max-attempts=5 --strategy-mode=explore --stop-on-win=false --visible
```

You can also use `--headless=false` directly from the CLI.

Chess.com computer mode can be started with:

```powershell
pnpm run dev -- run-player-chess-com --opponent=computer --max-moves=80 --visible
```

Chess.com runs are computer-only. The runner navigates to `https://www.chess.com/play/computer`, aborts if it detects online/live human matchmaking, reads Chess.com board piece classes into FEN, and uses `chess.js` to choose from real legal moves with a simple beginner preference list. It does not use Stockfish.

The live panel polls the local API for the current process status, run id, run phase, browser mode, latest action, screenshot artifact, and game telemetry. Cat-and-Dog shows HP, wind, wall state, shot plan, and shot history. Chess.com shows board FEN, side to move, bot color, last move, planned move, legal move count, and outcome. Stop Run terminates the CLI process tree on Windows via `taskkill /T /F`, which also closes the visible browser launched by that process tree.

The replay dashboard still automatically scans `artifacts/**/reports/02-player-attempt-summary.json` and `artifacts/**/reports/02-chess-com-player-summary.json`. You can also paste a specific summary path into the Summary path field, for example:

```text
artifacts/<runId>/reports/02-player-attempt-summary.json
```

Completed replay mode displays run metadata, attempt outcomes, final HP, damage, wind, wall state, planned shots, shot feedback, action history, artifact paths, and screenshot artifacts from the existing JSON reports.

## Local API

- `GET /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/summary`
- `GET /api/runs/:runId/latest-screenshot`
- `POST /api/bot-runs/start`
- `POST /api/bot-runs/:runId/stop`
- `GET /api/bot-runs/:runId/live`

## Future Human-vs-Bot Seam

The TypeScript contract in `src/human-vs-bot-contract.ts` defines the minimal future interface for 2-player Cat-and-Dog work:

- match config with human side and bot side
- turn snapshots that identify whose turn it is
- helpers for deciding whether the bot or human should act
- shot choice and shot outcome telemetry events

This does not start a live match or change the Cat-and-Dog planner. It is only the seam needed for a later controller to keep human input untouched on the human turn, let the bot act only on its turn, and record both human and bot shot choices.
