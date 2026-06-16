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
  difficulty: document.querySelector("#run-difficulty"),
  maxAttempts: document.querySelector("#run-max-attempts"),
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
    difficulty: els.difficulty.value,
    maxAttempts: Number(els.maxAttempts.value),
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
      ${metric("Difficulty", live.settings?.difficulty)}
      ${metric("Max attempts", live.settings?.maxAttempts)}
      ${metric("Strategy mode", live.settings?.strategyMode)}
      ${metric("Browser mode", live.settings?.headless === false ? "Visible" : "Headless")}
      ${metric("Stop on win", live.settings?.stopOnWin)}
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
        ${metric("Source", summary.relativeSourcePath)}
      </div>
    </section>

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
  `;

  els.runDetail.querySelectorAll("[data-attempt-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedAttemptIndex = Number(button.dataset.attemptIndex);
      renderSummary();
    });
  });
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
