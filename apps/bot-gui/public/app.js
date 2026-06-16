const state = {
  runs: [],
  selectedPath: null,
  summary: null,
  selectedAttemptIndex: 0,
  liveRunId: null,
  livePollTimer: null,
  live: null
};

const els = {
  refreshRuns: document.querySelector("#refresh-runs"),
  manualLoadForm: document.querySelector("#manual-load-form"),
  summaryPath: document.querySelector("#summary-path"),
  runCount: document.querySelector("#run-count"),
  runList: document.querySelector("#run-list"),
  status: document.querySelector("#status"),
  runDetail: document.querySelector("#run-detail"),
  runnerForm: document.querySelector("#runner-form"),
  startRun: document.querySelector("#start-run"),
  stopRun: document.querySelector("#stop-run"),
  gameId: document.querySelector("#run-game-id"),
  difficulty: document.querySelector("#run-difficulty"),
  maxAttempts: document.querySelector("#run-max-attempts"),
  maxMoves: document.querySelector("#run-max-moves"),
  strategyMode: document.querySelector("#run-strategy-mode"),
  browserMode: document.querySelector("#run-browser-mode"),
  stopOnWin: document.querySelector("#run-stop-on-win"),
  livePanel: document.querySelector("#live-panel")
};

els.refreshRuns.addEventListener("click", () => {
  void loadRuns({ preserveSelection: true });
});

els.manualLoadForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const summaryPath = els.summaryPath.value.trim();
  if (summaryPath) {
    void loadSummary(summaryPath);
  }
});

els.startRun.addEventListener("click", () => {
  void startRun();
});

els.stopRun.addEventListener("click", () => {
  void stopRun();
});

void loadRuns();

async function loadRuns(options = {}) {
  if (!options.preserveSelection) {
    setStatus("Loading run artifacts...");
  }
  const response = await fetch("/api/runs");
  const payload = await readPayload(response);
  state.runs = payload.runs ?? [];
  renderRunList();

  if (!options.preserveSelection && state.runs.length > 0) {
    await loadSummary(state.runs[0].relativeSourcePath);
  } else if (!options.preserveSelection) {
    setStatus("No Cat-and-Dog player summaries found under artifacts/.");
  }
}

async function loadSummary(summaryPath) {
  setStatus(`Loading ${summaryPath}...`);
  const response = await fetch(`/api/summary?path=${encodeURIComponent(summaryPath)}`);
  const summary = await readPayload(response);
  state.selectedPath = summary.relativeSourcePath ?? summaryPath;
  state.summary = summary;
  state.selectedAttemptIndex = 0;
  els.summaryPath.value = state.selectedPath;
  renderRunList();
  renderSummary();
  clearStatus();
}

async function startRun() {
  const payload = {
    gameId: els.gameId.value,
    difficulty: els.difficulty.value,
    maxAttempts: Number(els.maxAttempts.value),
    maxMoves: Number(els.maxMoves.value),
    strategyMode: els.strategyMode.value,
    stopOnWin: els.stopOnWin.checked,
    headless: els.browserMode.value !== "visible"
  };
  els.startRun.disabled = true;
  renderLiveStatus("Starting bot process...");
  try {
    const response = await fetch("/api/bot-runs/start", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const live = await readPayload(response);
    state.liveRunId = live.botRunId;
    state.live = live;
    renderLive(live);
    startLivePolling();
  } catch (error) {
    els.startRun.disabled = false;
    renderLiveStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

async function stopRun() {
  if (!state.liveRunId) {
    return;
  }
  els.stopRun.disabled = true;
  renderLiveStatus("Stopping bot process...");
  const response = await fetch(`/api/bot-runs/${encodeURIComponent(state.liveRunId)}/stop`, {
    method: "POST"
  });
  const live = await readPayload(response);
  state.live = live;
  renderLive(live);
}

function startLivePolling() {
  if (state.livePollTimer) {
    window.clearInterval(state.livePollTimer);
  }
  state.livePollTimer = window.setInterval(() => {
    void pollLive();
  }, 1500);
  void pollLive();
}

async function pollLive() {
  if (!state.liveRunId) {
    return;
  }
  const response = await fetch(`/api/bot-runs/${encodeURIComponent(state.liveRunId)}/live`);
  const live = await readPayload(response);
  state.live = live;
  renderLive(live);

  if (live.summaryPath && live.summary) {
    state.selectedPath = live.summaryPath;
    state.summary = live.summary;
    state.selectedAttemptIndex = Math.max(0, (live.summary.attempts?.length ?? 1) - 1);
    els.summaryPath.value = live.summaryPath;
    renderSummary();
    clearStatus();
    await loadRuns({ preserveSelection: true });
  }

  if (["completed", "failed", "stopped"].includes(live.status)) {
    if (state.livePollTimer) {
      window.clearInterval(state.livePollTimer);
      state.livePollTimer = null;
    }
  }
}

async function readPayload(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }
  return payload;
}

function renderRunList() {
  els.runCount.textContent = String(state.runs.length);
  els.runList.replaceChildren(
    ...state.runs.map((run) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `run-card${run.relativeSourcePath === state.selectedPath ? " active" : ""}`;
      button.addEventListener("click", () => {
        void loadSummary(run.relativeSourcePath);
      });
      button.innerHTML = `
        <div class="run-card-title">
          <span>${escapeHtml(run.runId ?? "unknown run")}</span>
          <span class="${run.hadWin ? "outcome-win" : "outcome-loss"}">${run.hadWin ? "WIN" : "NO WIN"}</span>
        </div>
        <div class="run-card-meta">
          ${escapeHtml(run.requestedDifficulty ?? "unknown difficulty")} / ${escapeHtml(run.attemptCount)} attempt(s)<br />
          ${escapeHtml(run.relativeSourcePath)}
        </div>
      `;
      return button;
    })
  );
}

function renderLive(live) {
  const canStop = live.status === "starting" || live.status === "running";
  els.startRun.disabled = canStop;
  els.stopRun.disabled = !canStop;
  const observation = live.latestObservation ?? {};
  const shotPlan = live.latestShotPlan ?? {};
  const chess = live.latestChess ?? {};
  const latestAction = live.latestAction ?? {};
  const latestScreenshot = live.latestScreenshotUrl
    ? `${live.latestScreenshotUrl}${live.latestScreenshotUrl.includes("?") ? "&" : "?"}t=${Date.now()}`
    : null;

  els.livePanel.innerHTML = `
    <div class="grid">
      ${metric("Active status", live.status, live.status === "failed" ? "outcome-loss" : live.status === "completed" ? "outcome-win" : "")}
      ${metric("Phase", live.phase)}
      ${metric("Latest run id", live.cliRunId ?? live.botRunId)}
      ${metric("Attempt", live.currentAttemptNumber)}
      ${metric("Game", live.settings?.gameId)}
      ${metric("Difficulty", live.settings?.difficulty)}
      ${metric("Max attempts", live.settings?.maxAttempts)}
      ${metric("Max moves", live.settings?.maxMoves)}
      ${metric("Strategy mode", live.settings?.strategyMode)}
      ${metric("Browser mode", live.settings?.headless === false ? "Visible" : "Headless")}
      ${metric("Stop on win", live.settings?.stopOnWin)}
      ${
        live.settings?.gameId === "chess-com-web"
          ? `
            ${metric("Board FEN", chess.currentFen ?? chess.fen)}
            ${metric("Loop state", firstText([chess.finalLoopState, chess.loopState]))}
            ${metric("Turn status", chess.botTurnStatus)}
            ${metric("Turn confidence", chess.botTurnConfidence)}
            ${metric("Waiting reason", chess.turnReason)}
            ${metric("Board hash", chess.boardHash)}
            ${metric("Board changed", chess.boardChangedSinceLastObservation)}
            ${metric("Stable board count", chess.stableBoardCount)}
            ${metric("Elapsed wait", chess.elapsedWaitMs === null || chess.elapsedWaitMs === undefined ? null : `${chess.elapsedWaitMs} ms`)}
            ${metric("Side to move", chess.sideToMove)}
            ${metric("Bot color", chess.botColor)}
            ${metric("Last move", chess.lastMove)}
            ${metric("Move list length", chess.moveListLength)}
            ${metric("Planned move", chess.plannedMove)}
            ${metric("Move SAN", chess.selectedMoveSan)}
            ${metric("Promotion", promotionText(chess))}
            ${metric("Move score", chess.selectedMoveScore)}
            ${metric("Move reason", firstText([chess.selectedMoveReason, chess.moveReason]))}
            ${metric("Search", searchText(chess))}
            ${metric("Legal move count", chess.legalMoveCount)}
            ${metric("Material balance", materialText(chess))}
            ${metric("Repetition", repetitionText(chess))}
            ${metric("Check / mate", checkText(chess))}
            ${metric("Check evasion", checkEvasionText(chess))}
            ${metric("Move applied", chess.moveApplied)}
            ${metric("Chess outcome", chess.outcome)}
            ${metric("Draw reason", chess.drawReason)}
            ${metric("Stop reason", chess.stopReason)}
          `
          : ""
      }
      ${metric("Latest action", actionText(latestAction))}
      ${metric("Selected weapon", observation.selectedWeapon)}
      ${metric("Planned weapon", shotPlan.weaponKey)}
      ${metric("Target angle", shotPlan.targetAngle)}
      ${metric("Target power", shotPlan.targetPower)}
      ${metric("Prepared/current angle", firstText([observation.preparedAngle, observation.currentAngle]))}
      ${metric("Prepared/current power", firstText([observation.preparedPower, observation.currentPower]))}
      ${metric("Player HP", observation.playerHp)}
      ${metric("CPU/Dog HP", observation.cpuHp)}
      ${metric("Wind", windText({ value: observation.windValue, direction: observation.windDirection, normalized: observation.windNormalized }))}
      ${metric("Wall", wallText({ hp: observation.wallHp, destroyed: observation.wallDestroyed }))}
      ${metric("Outcome", observation.outcome ?? live.latestAttempt?.outcome)}
      ${metric("Final report", live.summaryPath)}
    </div>

    <div class="live-visual">
      ${
        latestScreenshot
          ? `<img src="${latestScreenshot}" alt="Latest Cat-and-Dog run screenshot" />`
          : `<div class="status">Waiting for the first screenshot artifact...</div>`
      }
    </div>

    <section>
      <h3>Live Shot History</h3>
      ${renderShotTable(live.shotHistory ?? [])}
    </section>

    ${
      live.settings?.gameId === "chess-com-web"
        ? `
          <section>
            <h3>Live Chess Candidates</h3>
            ${renderCandidateTable(chess.topCandidateMoves ?? [])}
          </section>
        `
        : ""
    }

    ${live.error ? `<div class="status error">${escapeHtml(live.error)}</div>` : ""}

    <div class="log-grid">
      <div class="log-box">
        <h4>stdout</h4>
        <pre>${escapeHtml((live.stdoutTail ?? []).slice(-12).join("\n"))}</pre>
      </div>
      <div class="log-box">
        <h4>stderr</h4>
        <pre>${escapeHtml((live.stderrTail ?? []).slice(-12).join("\n"))}</pre>
      </div>
    </div>
  `;
}

function renderLiveStatus(message, kind = "") {
  els.livePanel.innerHTML = `<div class="status ${escapeHtml(kind)}">${escapeHtml(message)}</div>`;
}

function renderSummary() {
  const summary = state.summary;
  if (!summary) {
    return;
  }

  const attempts = summary.attempts ?? [];
  const selectedAttempt = attempts[state.selectedAttemptIndex] ?? attempts[0] ?? null;
  const chess = summary.chess ?? null;
  els.runDetail.classList.remove("hidden");
  els.runDetail.innerHTML = `
    <section class="detail-header">
      <h2>${escapeHtml(summary.runId ?? "Unknown run")}</h2>
      <div class="grid">
        ${metric("Game id", summary.gameId)}
        ${metric("Profile id", summary.profileId)}
        ${metric("Requested difficulty", summary.requestedDifficulty)}
        ${metric("Runtime difficulty", summary.runtimeDifficulty)}
        ${metric("Max attempts", summary.maxAttempts)}
        ${metric("Stop on win", summary.stopOnWin)}
        ${metric("Strategy mode", summary.strategyMode)}
        ${metric("Attempt count", summary.attemptCount)}
        ${chess ? metric("Moves played", chess.movesPlayed) : ""}
        ${chess ? metric("Outcome", chess.outcome) : ""}
        ${metric("Source", summary.relativeSourcePath)}
      </div>
    </section>

    ${
      chess
        ? renderChessSummary(chess)
        : `
          <nav class="attempt-tabs">
            ${attempts
              .map(
                (attempt, index) => `
                  <button class="attempt-tab${index === state.selectedAttemptIndex ? " active" : ""}" data-attempt-index="${index}" type="button">
                    Attempt ${escapeHtml(attempt.attemptNumber ?? index + 1)}: ${escapeHtml(attempt.outcome ?? "UNKNOWN")}
                  </button>
                `
              )
              .join("")}
          </nav>

          <div id="attempt-detail">${selectedAttempt ? renderAttempt(selectedAttempt) : "<div class=\"status\">No attempts in this summary.</div>"}</div>
        `
    }
  `;

  els.runDetail.querySelectorAll("[data-attempt-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedAttemptIndex = Number(button.dataset.attemptIndex);
      renderSummary();
    });
  });
}

function renderChessSummary(chess) {
  return `
    <section class="panel">
      <h3>Chess.com Summary</h3>
      <div class="grid">
        ${metric("Opponent", chess.opponent)}
        ${metric("Max moves", chess.maxMoves)}
        ${metric("Moves played", chess.movesPlayed)}
        ${metric("Loop state", chess.finalLoopState)}
        ${metric("Turn status", chess.botTurnStatus)}
        ${metric("Turn confidence", chess.botTurnConfidence)}
        ${metric("Turn reason", chess.turnReason)}
        ${metric("Board hash", chess.boardHash)}
        ${metric("Board changed", chess.boardChangedSinceLastObservation)}
        ${metric("Stable board count", chess.stableBoardCount)}
        ${metric("Elapsed wait", chess.elapsedWaitMs === null || chess.elapsedWaitMs === undefined ? null : `${chess.elapsedWaitMs} ms`)}
        ${metric("Current FEN", chess.currentFen)}
        ${metric("Side to move", chess.sideToMove)}
        ${metric("Bot color", chess.botColor)}
        ${metric("Last move", chess.lastMove)}
        ${metric("Planned move", chess.plannedMove)}
        ${metric("Move SAN", chess.selectedMoveSan)}
        ${metric("Promotion", promotionText(chess))}
        ${metric("Move score", chess.selectedMoveScore)}
        ${metric("Move reason", chess.selectedMoveReason)}
        ${metric("Search", searchText(chess))}
        ${metric("Legal move count", chess.legalMoveCount)}
        ${metric("Material balance", materialText(chess))}
        ${metric("Repetition", repetitionText(chess))}
        ${metric("Check / mate", checkText(chess))}
        ${metric("Check evasion", checkEvasionText(chess))}
        ${metric("Move applied", chess.moveApplied)}
        ${metric("Outcome", chess.outcome)}
        ${metric("Draw reason", chess.drawReason)}
        ${metric("Stop reason", chess.stopReason)}
      </div>
    </section>

    <section class="panel">
      <h3>Move Timeline</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Move</th>
              <th>Before FEN</th>
              <th>After FEN</th>
              <th>Score</th>
              <th>Reason</th>
              <th>Search</th>
              <th>Material</th>
              <th>Repetition</th>
              <th>Promotion</th>
              <th>Check evasion</th>
              <th>Top Candidates</th>
              <th>Applied</th>
              <th>Screenshots</th>
            </tr>
          </thead>
          <tbody>
            ${(chess.moves ?? [])
              .map((move) => {
                const selected = move.selectedMove ?? {};
                return `
                  <tr>
                    <td>${escapeHtml(move.moveNumber)}</td>
                    <td>${escapeHtml(selected.lan)}</td>
                    <td>${escapeHtml(move.beforeFen)}</td>
                    <td>${escapeHtml(move.afterFen)}</td>
                    <td>${escapeHtml(move.selectedMoveScore ?? selected.score)}</td>
                    <td>${escapeHtml(firstText([move.selectedMoveReason, selected.reason]))}</td>
                    <td>${escapeHtml(searchText(move.selectedMove ? selected : move))}</td>
                    <td>${escapeHtml(materialText(move.selectedMove ? { ...selected, materialBalance: move.materialBalanceBefore } : move))}</td>
                    <td>${escapeHtml(repetitionText(move.selectedMove ? selected : move))}</td>
                    <td>${escapeHtml(promotionText(move))}</td>
                    <td>${escapeHtml(checkEvasionText(move))}</td>
                    <td>${renderCandidateList(move.topCandidateMoves ?? selected.topCandidates ?? [])}</td>
                    <td>${escapeHtml(move.moveApplied)}</td>
                    <td>${escapeHtml([move.beforeScreenshotPath, move.afterScreenshotPath].filter(Boolean).join("\\n"))}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h3>Turn Observations</h3>
      ${renderTurnObservationTable(chess.observations ?? [])}
    </section>
  `;
}

function renderTurnObservationTable(observations) {
  if (!Array.isArray(observations) || observations.length === 0) {
    return "<div class=\"status\">No turn observation telemetry recorded.</div>";
  }
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>State</th>
            <th>Move</th>
            <th>Turn</th>
            <th>Confidence</th>
            <th>Reason</th>
            <th>Changed</th>
            <th>Stable</th>
            <th>Board hash</th>
            <th>Promotion UI</th>
            <th>Wait</th>
          </tr>
        </thead>
        <tbody>
          ${observations
            .slice(-40)
            .map(
              (observation) => `
                <tr>
                  <td>${escapeHtml(observation.timestamp)}</td>
                  <td>${escapeHtml(observation.loopState)}</td>
                  <td>${escapeHtml(observation.moveNumber)}</td>
                  <td>${escapeHtml(observation.botTurnStatus)}</td>
                  <td>${escapeHtml(observation.botTurnConfidence)}</td>
                  <td>${escapeHtml(observation.reason)}</td>
                  <td>${escapeHtml(observation.boardChangedSinceLastObservation)}</td>
                  <td>${escapeHtml(observation.stableBoardCount)}</td>
                  <td>${escapeHtml(observation.boardHash)}</td>
                  <td>${escapeHtml(observation.promotionUiDetected)}</td>
                  <td>${escapeHtml(observation.elapsedWaitMs)} ms</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderCandidateTable(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return "<div class=\"status\">No chess candidate scores recorded yet.</div>";
  }
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Move</th>
            <th>SAN</th>
            <th>Score</th>
            <th>Reason</th>
            <th>Search</th>
            <th>Repetition</th>
          </tr>
        </thead>
        <tbody>
          ${candidates
            .map(
              (candidate) => `
                <tr>
                  <td>${escapeHtml(candidate.uci ?? candidate.lan)}</td>
                  <td>${escapeHtml(candidate.san)}</td>
                  <td>${escapeHtml(candidate.score)}</td>
                  <td>${escapeHtml(candidate.reason)}</td>
                  <td>${escapeHtml(searchText(candidate))}</td>
                  <td>${escapeHtml(repetitionText(candidate))}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderCandidateList(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return "n/a";
  }
  return candidates
    .slice(0, 5)
    .map((candidate) => `${escapeHtml(candidate.uci ?? candidate.lan)} (${escapeHtml(candidate.score)}): ${escapeHtml(candidate.reason)}`)
    .join("<br />");
}

function renderAttempt(attempt) {
  return `
    <section class="panel">
      <h3>Attempt Summary</h3>
      <div class="grid">
        ${metric("Outcome", attempt.outcome, outcomeClass(attempt.outcome))}
        ${metric("Assessment", attempt.assessment)}
        ${metric("Requested difficulty", attempt.requestedDifficulty)}
        ${metric("Runtime difficulty", attempt.runtimeDifficulty)}
        ${metric("Player HP", hpText(attempt.playerHpStart, attempt.playerHp))}
        ${metric("CPU/Dog HP", hpText(attempt.cpuHpStart, attempt.cpuHp))}
        ${metric("Damage dealt", attempt.damageDealt)}
        ${metric("Damage taken", attempt.damageTaken)}
        ${metric("Wind", windText(attempt.wind))}
        ${metric("Wall", wallText(attempt.wall))}
        ${metric("Selected weapon", attempt.selectedWeapon)}
        ${metric("Planned weapon", attempt.plannedWeapon)}
        ${metric("Planned angle", attempt.plannedTargetAngle)}
        ${metric("Planned power", attempt.plannedTargetPower)}
        ${metric("Prepared angle", attempt.preparedAngle)}
        ${metric("Prepared power", attempt.preparedPower)}
        ${metric("Prepared weapon", attempt.preparedWeapon)}
        ${metric("Shot count", attempt.shotCount)}
        ${metric("Action count", attempt.actionCount)}
        ${metric("End title", attempt.endTitle)}
        ${metric("Final note", attempt.finalNote)}
        ${metric("Planner reason", attempt.plannerReason)}
        ${metric("Adaptation reason", attempt.adaptationReason)}
      </div>
    </section>

    <section class="panel">
      <h3>Shot Timeline</h3>
      ${renderShotTable(attempt.shotHistory ?? [])}
    </section>

    <section class="panel">
      <h3>Screenshots</h3>
      ${renderScreenshots(attempt.screenshotPaths ?? [])}
    </section>

    <section class="panel">
      <h3>Artifact Paths</h3>
      ${renderPathList(attempt.artifactPaths ?? [])}
    </section>

    <section class="panel">
      <h3>Action History</h3>
      ${renderActionHistory(attempt.actionHistory ?? [])}
    </section>

    <section class="panel">
      <h3>Raw Attempt Data</h3>
      <details>
        <summary>Diagnostics, strategy details, and final state</summary>
        <pre>${escapeHtml(
          JSON.stringify(
            {
              diagnostics: attempt.diagnostics,
              strategySelectionDetails: attempt.strategySelectionDetails,
              finalState: attempt.finalState
            },
            null,
            2
          )
        )}</pre>
      </details>
    </section>
  `;
}

function renderShotTable(shots) {
  if (shots.length === 0) {
    return "<div class=\"status\">No shot history recorded yet.</div>";
  }
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Shot</th>
            <th>Weapon</th>
            <th>Plan</th>
            <th>Damage</th>
            <th>Hit / resolution</th>
            <th>Family</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          ${shots
            .map(
              (shot) => `
                <tr>
                  <td>${escapeHtml(shot.shotNumber ?? "")}</td>
                  <td>${escapeHtml(shot.plannedWeapon ?? shot.selectedWeapon ?? "unknown")}</td>
                  <td>
                    angle ${escapeHtml(shot.plannedTargetAngle ?? "n/a")} / power ${escapeHtml(shot.plannedTargetPower ?? "n/a")}<br />
                    ${escapeHtml(shot.angleDirection ?? "angle")} ${escapeHtml(shot.angleTapCount ?? "-")} taps,
                    ${escapeHtml(shot.powerDirection ?? "power")} ${escapeHtml(shot.powerTapCount ?? "-")} taps
                  </td>
                  <td>dealt ${escapeHtml(shot.damageDealt ?? 0)} / taken ${escapeHtml(shot.damageTaken ?? 0)}</td>
                  <td>
                    ${escapeHtml(shot.hitCategory ?? "unknown")}<br />
                    ${escapeHtml(shot.shotResolution ?? "unknown")} / ${escapeHtml(shot.hintCategory ?? "no hint")}
                  </td>
                  <td>${escapeHtml(shot.family ?? "unknown")}<br />${escapeHtml(shot.category ?? "")}</td>
                  <td>${escapeHtml(firstText([shot.adaptationReason, shot.familySwitchReason, shot.plannerReason, shot.hintText]) ?? "n/a")}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderScreenshots(paths) {
  if (paths.length === 0) {
    return "<div class=\"status\">No screenshot artifacts recorded for this attempt.</div>";
  }
  return `<div class="screenshots">${paths
    .map((path) => {
      const href = artifactHref(path);
      return `
        <figure class="screenshot">
          <a href="${href}" target="_blank" rel="noreferrer">${escapeHtml(path)}</a>
          <img src="${href}" alt="${escapeHtml(path)}" loading="lazy" />
        </figure>
      `;
    })
    .join("")}</div>`;
}

function renderPathList(paths) {
  if (paths.length === 0) {
    return "<div class=\"status\">No artifact paths recorded for this attempt.</div>";
  }
  return `<div class="path-list">${paths
    .map((path) => {
      const href = artifactHref(path);
      return `<div class="path-item"><a href="${href}" target="_blank" rel="noreferrer">${escapeHtml(path)}</a></div>`;
    })
    .join("")}</div>`;
}

function renderActionHistory(actions) {
  if (actions.length === 0) {
    return "<div class=\"status\">No action history recorded for this attempt.</div>";
  }
  return `<div class="action-list">${actions
    .map(
      (action) => `
        <div class="action-item">
          <strong>${escapeHtml(action.step ?? "")}: ${escapeHtml(action.actionId ?? "unknown action")}</strong>
          ${action.params ? `<pre>${escapeHtml(JSON.stringify(action.params, null, 2))}</pre>` : ""}
          ${action.shotPlan ? `<pre>${escapeHtml(JSON.stringify(action.shotPlan, null, 2))}</pre>` : ""}
        </div>
      `
    )
    .join("")}</div>`;
}

function metric(label, value, className = "") {
  const text = value === null || value === undefined || value === "" ? "n/a" : String(value);
  return `
    <div class="metric">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value ${className}">${escapeHtml(text)}</div>
    </div>
  `;
}

function setStatus(message) {
  els.status.textContent = message;
  els.status.classList.remove("hidden", "error");
  els.runDetail.classList.add("hidden");
}

function clearStatus() {
  els.status.classList.add("hidden");
  els.status.classList.remove("error");
}

function showError(error) {
  els.status.textContent = error instanceof Error ? error.message : String(error);
  els.status.classList.remove("hidden");
  els.status.classList.add("error");
  renderLiveStatus(error instanceof Error ? error.message : String(error));
  els.startRun.disabled = false;
  els.stopRun.disabled = true;
}

function artifactHref(path) {
  return `/artifact?path=${encodeURIComponent(path)}`;
}

function hpText(start, end) {
  if (start === null || start === undefined) {
    return end;
  }
  return `${start} -> ${end ?? "n/a"}`;
}

function windText(wind) {
  if (!wind) {
    return null;
  }
  return `${wind.direction ?? "unknown"} ${wind.value ?? "n/a"} (${wind.normalized ?? "n/a"})`;
}

function wallText(wall) {
  if (!wall) {
    return null;
  }
  return `HP ${wall.hp ?? "n/a"} / ${wall.destroyed === null || wall.destroyed === undefined ? "unknown" : wall.destroyed ? "destroyed" : "standing"}`;
}

function checkText(chess) {
  if (!chess) {
    return null;
  }
  return `check ${chess.inCheck ?? "n/a"} / gives ${chess.givesCheck ?? "n/a"} / mate ${chess.isCheckmate ?? "n/a"} / gives mate ${chess.givesCheckmate ?? "n/a"} / stale ${chess.isStalemate ?? "n/a"} / avoids stale ${chess.avoidsStalemate ?? "n/a"}`;
}

function checkEvasionText(chess) {
  if (!chess) {
    return null;
  }
  return `${chess.checkEvasionRequired ?? "n/a"} / ${chess.checkEvasionMoveType ?? "n/a"}`;
}

function promotionText(chess) {
  if (!chess) {
    return null;
  }
  const piece = firstText([chess.promotionPiece, chess.selectedMovePromotion]);
  if (!piece && chess.promotionUiDetected === null && chess.promotionUiDetected === undefined) {
    return null;
  }
  return `${piece ?? "none"} / UI ${chess.promotionUiDetected ?? "n/a"} / choice ${chess.promotionChoiceApplied ?? "n/a"}`;
}

function searchText(chess) {
  if (!chess) {
    return null;
  }
  const depth = chess.searchDepth ?? "n/a";
  const nodes = chess.evaluatedNodeCount ?? "n/a";
  return `depth ${depth} / nodes ${nodes}`;
}

function materialText(chess) {
  if (!chess) {
    return null;
  }
  const before = chess.materialBalance ?? chess.materialBalanceBefore;
  const after = chess.materialBalanceAfter;
  if (after === null || after === undefined) {
    return before ?? null;
  }
  return `${before ?? "n/a"} -> ${after}`;
}

function repetitionText(chess) {
  if (!chess) {
    return null;
  }
  const count = chess.repetitionCount;
  if (count === null || count === undefined) {
    return null;
  }
  return count >= 3 ? `${count} / warning` : String(count);
}

function actionText(action) {
  return firstText([action.semanticActionId, action.actionKind, action.status]);
}

function outcomeClass(outcome) {
  if (outcome === "WIN") {
    return "outcome-win";
  }
  if (outcome === "LOSS") {
    return "outcome-loss";
  }
  return "";
}

function firstText(values) {
  return values.find((value) => value !== null && value !== undefined && value !== "") ?? null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.addEventListener("unhandledrejection", (event) => {
  showError(event.reason);
});
