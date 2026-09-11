const $ = id => document.getElementById(id);
let windows = [], profiles = [], skills = [], steps = [], pageIndex = 0, selected = 0;
let previewMode = false, lastImage = '', active = false, recordingActive = false, loadedDraft = -1, beforeRecording = null;
let behaviors = [], teachingState = null, teachingRevision = '';
let localAnnotation = {}, localLastTransition = '', localBusy = false;
const PAGE_SIZE = 25;
const kinds = { click: 'Click', hold: 'Press / hold keys and buttons', move: 'Move mouse to point', 'relative-move': 'Relative mouse movement', 'key-down': 'Key down', 'key-up': 'Key up', 'button-down': 'Mouse button down', 'button-up': 'Mouse button up', drag: 'Drag', scroll: 'Scroll', wait: 'Wait', 'release-all': 'Release all held input' };
const keyNames = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(k => 'Key' + k).concat([...'0123456789'].map(k => 'Digit' + k), ['Space', 'Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Shift', 'Control', 'Alt', 'Home', 'End', 'PageUp', 'PageDown'], [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12].map(n => 'F' + n));
const clone = value => structuredClone(value);
async function api(route, value) {
    const response = await fetch('/api/desktop/' + route, value === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    const data = await response.json();
    if (!response.ok)
        throw new Error(data.error);
    return data;
}
function handle(id, fn) { $(id).addEventListener('click', () => { $('message').textContent = ''; void Promise.resolve().then(fn).catch(error => { $('message').textContent = error.message; }); }); }
function option(select, value, label) { const el = document.createElement('option'); el.value = value; el.textContent = label; select.append(el); }
function field(parent, name, label, value, choices) {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const input = document.createElement(choices ? 'select' : 'input');
    input.dataset.field = name;
    if (choices)
        for (const choice of choices)
            option(input, choice, choice);
    else {
        input.type = typeof value === 'number' ? 'number' : 'text';
        if (input.type === 'number')
            input.step = 'any';
    }
    input.value = value;
    wrapper.append(input);
    parent.append(wrapper);
    return input;
}
function summary() {
    const duration = steps.reduce((total, a) => total + (a.delayBeforeMs ?? 0) + (a.enabled === false ? 0 : a.durationMs ?? 0), 0);
    $('sequence-summary').textContent = `${steps.length} events · ${steps.filter(a => a.enabled !== false).length} enabled${$('timing').value === 'recorded' ? ' · ' + (duration / 1000).toFixed(2) + ' seconds of recorded timing' : ' · fixed interval'}`;
}
function readRow(row) {
    const get = name => row.querySelector(`[data-field="${name}"]`)?.value;
    const number = name => Number(get(name));
    const point = prefix => ({ x: number(prefix + 'x') / 100, y: number(prefix + 'y') / 100 });
    const kind = get('kind'), action = { kind, enabled: row.querySelector('[data-field="enabled"]').checked, delayBeforeMs: number('delayBeforeMs') };
    if (['click', 'move'].includes(kind))
        action.point = point('');
    if (kind === 'drag') {
        action.from = point('from');
        action.to = point('to');
    }
    if (['click', 'drag', 'button-down', 'button-up'].includes(kind))
        action.button = get('button');
    if (['click', 'drag', 'hold', 'wait'].includes(kind))
        action.durationMs = number('durationMs');
    if (['key-down', 'key-up'].includes(kind))
        action.key = get('key');
    if (kind === 'hold')
        for (const name of ['keys', 'buttons'])
            action[name] = get(name).split(',').map(s => s.trim()).filter(Boolean);
    if (kind === 'relative-move') {
        action.dx = number('dx');
        action.dy = number('dy');
    }
    if (kind === 'scroll') {
        action.ticks = number('ticks');
        action.axis = get('axis');
    }
    return action;
}
function pairedRelease(index) {
    const action = steps[index];
    if (!['key-down', 'button-down'].includes(action.kind))
        return -1;
    return steps.findIndex((next, i) => i > index && next.enabled !== false && (next.kind === 'release-all' || (next.kind === action.kind.replace('down', 'up') && (action.key ? next.key === action.key : next.button === action.button))));
}
function renderActions() {
    pageIndex = Math.min(pageIndex, Math.max(0, Math.ceil(steps.length / PAGE_SIZE) - 1));
    $('actions').replaceChildren();
    steps.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE).forEach((action, offset) => {
        const index = pageIndex * PAGE_SIZE + offset;
        const row = document.createElement('div');
        row.className = 'desktop-action';
        row.classList.toggle('disabled', action.enabled === false);
        row.classList.toggle('selected', index === selected);
        row.onclick = () => { selected = index; for (const r of $('actions').children)
            r.classList.toggle('selected', r === row); };
        const heading = document.createElement('strong');
        heading.textContent = `Event ${index + 1}`;
        row.append(heading);
        const tools = document.createElement('div');
        tools.className = 'action-tools';
        row.append(tools);
        const enabledLabel = document.createElement('label');
        const enabled = document.createElement('input');
        enabled.type = 'checkbox';
        enabled.dataset.field = 'enabled';
        enabled.checked = action.enabled !== false;
        enabledLabel.append(enabled, 'Enabled');
        tools.append(enabledLabel);
        const button = (label, fn, disabled = false) => { const b = document.createElement('button'); b.textContent = label; b.disabled = disabled; b.onclick = e => { e.stopPropagation(); fn(); renderActions(); }; tools.append(b); };
        button('↑ Up', () => { [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]; selected = index - 1; }, index === 0);
        button('↓ Down', () => { [steps[index + 1], steps[index]] = [steps[index], steps[index + 1]]; selected = index + 1; }, index === steps.length - 1);
        button('Duplicate', () => steps.splice(index + 1, 0, clone(steps[index])));
        button('Insert wait', () => steps.splice(index + 1, 0, { kind: 'wait', durationMs: 250, delayBeforeMs: 0, enabled: true }));
        button('Delete', () => steps.splice(index, 1));
        const selector = field(row, 'kind', 'Action', action.kind, Object.keys(kinds));
        for (const op of selector.options)
            op.textContent = kinds[op.value];
        const timing = field(row, 'delayBeforeMs', 'Delay before event (ms, recorded timing)', action.delayBeforeMs ?? 0);
        timing.min = '0';
        timing.max = '120000';
        const params = document.createElement('div');
        params.className = 'params';
        row.append(params);
        const draw = () => {
            params.replaceChildren();
            const kind = selector.value;
            const xy = (prefix, p) => { field(params, prefix + 'x', prefix + 'X %', (p?.x ?? .5) * 100); field(params, prefix + 'y', prefix + 'Y %', (p?.y ?? .5) * 100); };
            if (['click', 'move'].includes(kind))
                xy('', action.point);
            if (kind === 'drag') {
                xy('from', action.from);
                xy('to', action.to);
            }
            if (['click', 'drag', 'button-down', 'button-up'].includes(kind))
                field(params, 'button', 'Button', action.button ?? 'left', ['left', 'right', 'middle']);
            if (['click', 'drag', 'hold', 'wait'].includes(kind))
                field(params, 'durationMs', 'Duration ms', action.durationMs ?? 100);
            if (['key-down', 'key-up'].includes(kind))
                field(params, 'key', 'Key', action.key ?? 'Space', keyNames);
            if (kind === 'hold') {
                field(params, 'keys', 'Keys (Control,KeyA)', (action.keys ?? ['Space']).join(','));
                field(params, 'buttons', 'Buttons (optional)', (action.buttons ?? []).join(','));
            }
            if (kind === 'relative-move') {
                field(params, 'dx', 'Delta X', action.dx ?? 30);
                field(params, 'dy', 'Delta Y', action.dy ?? 0);
            }
            if (kind === 'scroll') {
                field(params, 'ticks', 'Wheel ticks', action.ticks ?? -1);
                field(params, 'axis', 'Axis', action.axis ?? 'vertical', ['vertical', 'horizontal']);
            }
        };
        selector.onchange = () => { action = { kind: selector.value }; draw(); steps[index] = readRow(row); summary(); };
        draw();
        row.addEventListener('change', () => { steps[index] = readRow(row); row.classList.toggle('disabled', !enabled.checked); summary(); });
        const release = pairedRelease(index);
        if (release >= 0 && $('timing').value === 'recorded') {
            const holdMs = steps.slice(index + 1, release + 1).reduce((n, a) => n + (a.delayBeforeMs ?? 0) + (a.enabled === false ? 0 : a.durationMs ?? 0), 0);
            const hold = field(row, 'paired-duration', 'Hold until matching release (ms)', holdMs);
            hold.addEventListener('change', () => {
                const newDelay = (steps[release].delayBeforeMs ?? 0) + Number(hold.value) - holdMs;
                if (!Number.isFinite(newDelay) || newDelay < 0 || newDelay > 120000) {
                    $('message').textContent = 'That release would cross intervening events. Edit their delays or order first.';
                    hold.value = holdMs;
                    return;
                }
                steps[release].delayBeforeMs = newDelay;
                renderActions();
            });
        }
        $('actions').append(row);
    });
    $('page-number').textContent = `Page ${pageIndex + 1} / ${Math.max(1, Math.ceil(steps.length / PAGE_SIZE))}`;
    $('previous-page').disabled = pageIndex === 0;
    $('next-page').disabled = (pageIndex + 1) * PAGE_SIZE >= steps.length;
    summary();
}
function profile() { return { version: 1, name: $('name').value, mode: 'automation', goal: $('goal').value, intervalMs: Number($('interval').value), startDelayMs: Number($('delay').value) * 1000, maxActions: Number($('count').value), maxDurationMs: Number($('duration').value) * 1000, maxUnchangedObservations: Number($('unchanged').value), maxHoldMs: Number($('hold-limit').value), actions: clone(steps), skills: clone(skills), playback: $('timing').value, loop: { mode: $('loop').value, count: Number($('loop-count').value), delayMs: Number($('loop-delay').value) * 1000 } }; }
function renderSkills() { $('skills').replaceChildren(); skills.forEach((s, i) => option($('skills'), String(i), s.id)); }
function loadProfile(p) {
    $('run-kind').value = p.mode === 'local' ? 'local' : p.mode === 'feedback' ? 'learned' : 'macro';
    $('name').value = p.name;
    $('goal').value = p.goal ?? '';
    $('interval').value = p.intervalMs;
    $('delay').value = p.startDelayMs / 1000;
    $('count').value = p.maxActions;
    $('duration').value = p.maxDurationMs / 1000;
    $('unchanged').value = p.maxUnchangedObservations ?? 0;
    $('hold-limit').value = p.maxHoldMs ?? 5500;
    $('timing').value = p.playback ?? 'interval';
    $('loop').value = p.loop?.mode ?? 'until-stopped';
    $('loop-count').value = p.loop?.count ?? 1;
    $('loop-delay').value = (p.loop?.delayMs ?? 0) / 1000;
    skills = clone(p.skills ?? []);
    steps = clone(p.actions);
    pageIndex = 0;
    selected = 0;
    renderSkills();
    renderActions();
}
async function refreshProfiles() { ({ profiles } = await api('profiles')); $('profiles').replaceChildren(); option($('profiles'), '', 'Choose a configuration'); profiles.forEach((p, i) => option($('profiles'), String(i), p.name)); }
function target() { const found = windows.find(w => w.handle === $('target').value); if (!found)
    throw new Error('Refresh windows and choose your target application'); return found; }
function setShortcuts(keys) { for (const name of ['record', 'bot', 'stopRecording'])
    $('hotkey-' + name).value = keys[name]; $('shortcut-help').textContent = `${keys.record}: start / pause / resume an armed recording. ${keys.stopRecording}: stop recording. ${keys.bot}: start an armed bot. F8: emergency stop.`; }
handle('windows', async () => { const old = $('target').value; ({ windows } = await api('windows')); $('target').replaceChildren(); for (const w of windows)
    option($('target'), w.handle, `${w.title} · ${w.processName} (${w.pid})`); if (windows.some(w => w.handle === old))
    $('target').value = old; });
handle('preview', async () => { const result = await api('preview', target()); previewMode = true; $('observation').src = result.image; $('observation').hidden = false; $('message').textContent = 'Preview captured. Select a Move/Click event in the editor, then click a point here.'; });
handle('add', async () => { steps.push({ kind: 'click', point: { x: .5, y: .5 }, button: 'left', durationMs: 50, delayBeforeMs: 0, enabled: true }); pageIndex = Math.floor((steps.length - 1) / PAGE_SIZE); $('editor').open = true; renderActions(); });
handle('add-wait', async () => { steps.push({ kind: 'wait', durationMs: 250, delayBeforeMs: 0, enabled: true }); pageIndex = Math.floor((steps.length - 1) / PAGE_SIZE); renderActions(); });
handle('previous-page', async () => { pageIndex--; renderActions(); });
handle('next-page', async () => { pageIndex++; renderActions(); });
handle('save', async () => { await api('profiles', profile()); await refreshProfiles(); $('message').textContent = 'Configuration saved locally.'; });
handle('duplicate-profile', async () => { const p = profile(), base = p.name.slice(0, 65); let suffix = 1; do {
    p.name = `${base} copy ${suffix++}`;
} while (profiles.some(saved => saved.name === p.name)); await api('profiles', p); loadProfile(p); await refreshProfiles(); $('message').textContent = 'Copy saved.'; });
handle('record-start', async () => { beforeRecording = profile(); await api('recording/start', { target: target(), startMethod: $('record-method').value, delayMs: Number($('record-delay').value) * 1000, maxDurationMs: 120000 }); previewMode = false; await poll(); });
for (const action of ['pause', 'resume', 'stop', 'discard'])
    handle('record-' + action, async () => { await api('recording/' + action, {}); if (action === 'discard' && beforeRecording) {
        loadProfile(beforeRecording);
        beforeRecording = null;
    } await poll(); });
handle('start', async () => { await api('start', { target: target(), profile: selectedRunProfile(), startMethod: $('bot-method').value }); previewMode = false; await poll(); });
for (const action of ['pause', 'resume', 'stop'])
    handle(action, async () => { await api(action, {}); await poll(); });
handle('emergency', async () => { const results = await Promise.allSettled([api('stop', {}), api('recording/stop', {})]); await poll(); const failed = results.find(r => r.status === 'rejected'); if (failed)
    throw failed.reason; });
handle('apply-hotkeys', async () => { const keys = Object.fromEntries(['record', 'bot', 'stopRecording'].map(k => [k, $('hotkey-' + k).value])); setShortcuts(await api('recording/settings', keys)); $('message').textContent = 'Shortcuts registered and saved. Starts remain disarmed until you arm them.'; });
handle('save-skill', async () => {
    const id = $('skill-name').value;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id))
        throw new Error('Use 1–64 letters, numbers, underscores or hyphens');
    const actions = [];
    for (const step of steps) {
        let gap = $('timing').value === 'recorded' ? (step.delayBeforeMs ?? 0) : 0;
        while (gap > 0) {
            const durationMs = Math.min(5000, gap);
            actions.push({ kind: 'wait', durationMs });
            gap -= durationMs;
        }
        const { enabled, delayBeforeMs, ...action } = step;
        if (enabled !== false)
            actions.push(action);
    }
    if (actions.length > 32)
        throw new Error('Behaviors support up to 32 actions including waits. Save larger recordings as configurations.');
    skills = skills.filter(s => s.id !== id);
    skills.push({ id, description: id, actions });
    renderSkills();
});
handle('use-skill', async () => { const skill = skills[Number($('skills').value)]; if (!skill)
    throw new Error('Choose a stored behavior'); steps = clone(skill.actions); pageIndex = 0; renderActions(); });
$('profiles').onchange = () => { if ($('profiles').value !== '')
    loadProfile(profiles[Number($('profiles').value)]); };
$('timing').onchange = renderActions;
$('observation').onclick = event => { if (!previewMode || active || recordingActive)
    return; const action = steps[selected]; if (!action || !['move', 'click'].includes(action.kind)) {
    $('message').textContent = 'Select a Move or Click event first.';
    return;
} const b = event.currentTarget.getBoundingClientRect(); action.point = { x: Math.max(0, Math.min(1, (event.clientX - b.left) / b.width)), y: Math.max(0, Math.min(1, (event.clientY - b.top) / b.height)) }; renderActions(); };
async function poll() {
    const [{ run }, capture] = await Promise.all([api('state'), api('recording/state')]);
    const r = capture.recording;
    active = !!run && !['stopped', 'completed', 'failed'].includes(run.status);
    recordingActive = !!r && ['armed', 'countdown', 'recording', 'paused'].includes(r.status);
    teachingState = capture.teaching;
    await renderTeachingState(capture);
    const localLocked = recordingActive || active || capture.botArmed || localBusy || teachingState?.phase === 'analyzing';
    for (const id of ['local-train', 'local-import', 'local-inspect', 'local-good', 'local-bad', 'local-wrong', 'local-forget-demo', 'local-clear-runtime', 'local-reset', 'local-full-reset']) $(id).disabled = localLocked || !selectedBehavior();
    $('local-takeover').disabled = localBusy || recordingActive || !run || run.profile.mode !== 'local';
    if (run?.profile.mode === 'local' && !run.endedAt && run.intelligence) {
        const t = run.intelligence; localLastTransition = t.latestTransition ?? localLastTransition;
        $('local-status').textContent = localSummary(t);
        if (t.candidates?.length) { const c = t.candidates[0]; $('local-status').textContent += ` · Nearest example frame ${c.frameId}: scene ${Math.round(c.scene * 100)}%${c.rejection ? ' · ' + c.rejection : ''}${c.target ? ' · target match ' + Math.round(c.target.confidence * 100) + '%' : ''}`; }
        if (t.assessment) $('local-status').textContent += ` · Last visual result: ${t.assessment.result} (expected-state similarity ${Math.round(t.assessment.initial * 100)}% → ${Math.round(t.assessment.expected * 100)}%); goal completion is separate`;
    }
    if (capture.draft && capture.draftId !== loadedDraft) {
        loadedDraft = capture.draftId;
        loadProfile(capture.draft);
        $('editor').open = true;
        $('message').textContent = 'Recording converted. Review events, name it and save. Start Bot is separate.';
    }
    $('service-error').textContent = capture.error ?? '';
    $('record-status').textContent = r ? `${r.status === 'countdown' ? 'Recording starts in ' + Math.ceil(r.countdownMs / 1000) + '…' : r.status === 'recording' ? 'RECORDING' : r.status} · ${(r.elapsedMs / 1000).toFixed(1)} sec · ${r.eventCount} events · ${r.target?.title ?? ''} · ${r.reason}` : 'Recording is off';
    const activity = recordingActive ? (r.status === 'recording' ? 'RECORDING · you control the target' : 'Recording ' + r.status) : capture.botArmed ? `Bot armed · ${capture.armedProfileName}` : active ? 'Bot ' + run.status : 'Idle';
    $('activity').textContent = teachingState?.phase === 'capturing' ? 'TEACHING · you control the target' : teachingState?.phase === 'analyzing' ? 'Analyzing demonstration' : activity;
    $('activity').className = 'activity ' + (recordingActive ? 'recording' : active ? 'playing' : '');
    $('record-start').disabled = recordingActive || active || capture.botArmed || teachingState?.phase === 'analyzing';
    $('record-start').textContent = $('record-method').value === 'hotkey' ? 'Arm Recording Hotkey' : 'Start Recording';
    $('record-pause').disabled = r?.status !== 'recording';
    $('record-resume').disabled = r?.status !== 'paused';
    $('record-stop').disabled = !recordingActive;
    $('record-discard').disabled = !r || r.status === 'idle';
    $('start').disabled = recordingActive || active || capture.botArmed || teachingState?.phase === 'analyzing';
    $('start').textContent = $('bot-method').value === 'hotkey' ? 'Arm Bot Hotkey' : 'Start Bot';
    $('preview').disabled = recordingActive || active || capture.botArmed;
    $('target').disabled = recordingActive || active || capture.botArmed;
    $('pause').disabled = !run || !['starting', 'running'].includes(run.status);
    $('resume').disabled = run?.status !== 'paused';
    $('stop').disabled = !active && !capture.botArmed;
    $('apply-hotkeys').disabled = recordingActive || active || capture.botArmed;
    $('loop-count').disabled = $('loop').value !== 'count';
    if (!run) {
        $('status').textContent = 'Bot is stopped';
        return;
    }
    const total = run.profile.loop?.mode === 'once' ? 1 : run.profile.loop?.mode === 'count' ? run.profile.loop.count : 'until stopped';
    const countdown = run.countdownEndsAt ? ' · starts in ' + Math.max(0, Math.ceil((Date.parse(run.countdownEndsAt) - Date.now()) / 1000)) + '…' : '';
    $('status').textContent = run.profile.mode === 'feedback'
        ? `Bot ${run.status}${countdown} · ${run.profile.name} · ${run.actionCount}/${run.profile.maxActions} inputs · ${run.intelligence?.calls ?? 0}/${run.intelligence?.maxCalls ?? '?'} model calls · ${run.reason}`
        : `Bot ${run.status}${countdown} · loop ${run.loopIndex ?? 1}/${total} · ${run.actionCount}/${run.profile.maxActions} actions · ${run.reason}`;
    $('latest-action').textContent = run.latestAction ? 'Latest action: ' + JSON.stringify(run.latestAction) : '';
    if (run.profile.mode === 'local') $('status').textContent = `Local Bot ${run.status}${countdown} · ${run.profile.name} · ${run.actionCount}/${run.profile.maxActions} inputs · API required: No · ${run.reason}`;
    $('logs').textContent = run.logs.map(e => `${e.at} ${e.message}`).join('\n');
    if (run.latestScreenshot && !previewMode && !recordingActive) {
        const image = `/artifact?path=${encodeURIComponent(run.latestScreenshot.relativePath)}&v=${encodeURIComponent(run.latestScreenshot.createdAt)}`;
        if (image !== lastImage) {
            lastImage = image;
            $('observation').src = image;
            $('observation').hidden = false;
        }
    }
    $('report').hidden = !run.report;
    if (run.report)
        $('report').href = '/artifact?path=' + encodeURIComponent(run.report.relativePath);
}
function selectedBehavior() { return behaviors.find(b => b.id === $('teach-behavior').value); }
async function refreshBehaviors(preferredId) {
    const old = preferredId ?? $('teach-behavior').value;
    ({ behaviors } = await api('teaching/behaviors'));
    $('teach-behavior').replaceChildren(); option($('teach-behavior'), '', 'Create a new behavior');
    for (const b of behaviors) option($('teach-behavior'), b.id, `${b.name} · ${b.examples.length} demonstrations · ${b.reviewed ? 'ready' : 'needs review'}`);
    if (behaviors.some(b => b.id === old)) $('teach-behavior').value = old;
    renderBehavior();
}
function renderBehavior() {
    const b = selectedBehavior();
    $('teach-demo').replaceChildren(); $('teach-procedure').replaceChildren(); $('teach-evidence').replaceChildren();
    if (!b) { $('behavior-info').textContent = 'New behavior: demonstrate first, then Learn locally or analyze with AI Vision.'; return; }
    $('teach-name').value = b.name; $('teach-goal').value = b.goal; $('teach-camera').value = b.cameraMode; $('teach-completion').value = b.completionOverride;
    $('behavior-info').textContent = `${b.processName} · ${b.examples.length} demonstrations · ${b.examples.filter(e => e.procedure).length} analyzed · ${b.reviewed ? 'Ready to run' : 'Needs analysis / goal and completion review'}`;
    for (const [i, e] of b.examples.entries()) {
        option($('teach-demo'), e.demonstrationId, `Example ${i + 1}: ${e.outcome} · ${e.procedure ? 'analyzed' : 'not analyzed'}`);
        if (e.procedure) {
            const p = e.procedure; const article = document.createElement('article');
            const heading = document.createElement('h3'); heading.textContent = `Example ${i + 1} · ${e.outcome}`; article.append(heading);
            const summary = document.createElement('p'); summary.textContent = `Target: ${p.targetDescription}. Preconditions: ${p.preconditions.join('; ')}`; article.append(summary);
            const list = document.createElement('ol');
            for (const step of p.steps) { const li = document.createElement('li'); li.textContent = `${step.name}: ${step.intent}. When: ${step.when}. Verify: ${step.success}. Failure: ${step.failure}. Recovery: ${step.recovery}. Evidence frames: ${step.evidenceFrames.join(', ')}.`; list.append(li); }
            article.append(list);
            const uncertainty = document.createElement('p'); uncertainty.textContent = `Completion: ${p.completion.join('; ')}. Uncertainties: ${p.uncertainties.join('; ') || 'None reported; review against your demonstration.'}`; article.append(uncertainty);
            $('teach-procedure').append(article);
        }
        const link = document.createElement('a'); link.textContent = `Inspect example ${i + 1} actions and frame metadata`; link.href = '/artifact?path=' + encodeURIComponent(`desktop-teach-${e.demonstrationId}/demonstration.json`); link.target = '_blank'; link.rel = 'noopener';
        const row = document.createElement('p'); row.append(link); $('teach-evidence').append(row);
        const view = document.createElement('button'); view.textContent = `View example ${i + 1} screenshots`;
        view.onclick = async () => { try {
            const response = await fetch(link.href); if (!response.ok) throw new Error('Evidence unavailable'); const demo = await response.json();
            const gallery = document.createElement('div'); gallery.className = 'teaching-gallery';
            for (const frame of demo.frames) {
                const figure = document.createElement('figure'); const img = document.createElement('img'); img.loading = 'lazy'; img.alt = `Frame ${frame.id} at ${frame.atMs} milliseconds`;
                img.src = '/artifact?path=' + encodeURIComponent(`desktop-teach-${e.demonstrationId}/${frame.file}`);
                img.onclick = event => {
                    if (!$('local-mark-target').checked) return;
                    const rect = img.getBoundingClientRect();
                    localAnnotation = { demonstrationId: e.demonstrationId, target: { frameId: frame.id, point: { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }, size: .12 } };
                    $('teach-demo').value = e.demonstrationId; $('local-annotation').textContent = `Target marked in frame ${frame.id}. Choose Learn locally to apply it.`;
                };
                const success = document.createElement('button'); success.textContent = `Use frame ${frame.id} as local success evidence`;
                success.onclick = () => { localAnnotation = { ...(localAnnotation.demonstrationId === e.demonstrationId ? localAnnotation : {}), demonstrationId: e.demonstrationId, successFrame: frame.id }; $('teach-demo').value = e.demonstrationId; $('teach-outcome').value = 'success'; $('local-annotation').textContent = `Success frame ${frame.id} selected. Choose Learn locally to apply it.`; };
                figure.append(success);
                const caption = document.createElement('figcaption'); caption.textContent = `Frame ${frame.id} · ${(frame.atMs / 1000).toFixed(2)}s · ${frame.eventCount} events · held: ${frame.heldKeys.concat(frame.heldButtons).join(', ') || 'none'}`;
                figure.append(img, caption); gallery.append(figure);
            }
            view.replaceWith(gallery);
        } catch (error) { $('message').textContent = error.message; } };
        $('teach-evidence').append(view);
    }
    $('teach-demo').value = b.examples.at(-1)?.demonstrationId ?? '';
    $('behavior-info').textContent += ' AI review is not required for Local Learned.';
    $('teach-outcome').value = b.examples.at(-1)?.outcome ?? 'uncertain';
}
function selectedRunProfile() {
    if ($('run-kind').value === 'macro') return profile();
    if ($('run-kind').value === 'local') {
        const b = selectedBehavior(); if (!b) throw new Error('Select a behavior and use Learn locally first');
        return { version: 1, name: b.name, mode: 'local', goal: b.goal, learnedBehaviorId: b.id,
            startDelayMs: Number($('delay').value) * 1000, maxActions: Number($('count').value), maxDurationMs: Number($('duration').value) * 1000,
            intervalMs: Number($('local-interval').value), actions: [{ kind: 'wait', durationMs: 100 }], skills: [],
            localOptions: { finishOnSuccess: $('local-finish').checked, minConfidence: Number($('local-confidence').value), maxActionMs: Number($('local-action').value),
                maxNoProgress: Number($('local-stuck').value), maxRecoveries: Number($('local-recoveries').value) } };
    }
    const b = selectedBehavior(); if (!b?.reviewed) throw new Error('Select an analyzed behavior and confirm its goal and completion first');
    return { version: 1, name: b.name, mode: 'feedback', goal: b.goal, learnedBehaviorId: b.id,
        policyTimeoutMs: teachingState?.provider?.timeoutMs ?? 45000, startDelayMs: Number($('delay').value) * 1000,
        maxActions: Number($('count').value), maxDurationMs: Number($('duration').value) * 1000,
        intervalMs: 350, actions: [{ kind: 'wait', durationMs: 100 }], skills: [],
        learnedOptions: { maxCalls: Number($('ai-calls').value), maxActionMs: Number($('ai-action-ms').value), maxObservationAgeMs: Number($('ai-age').value) * 1000,
            maxNoProgress: Number($('ai-stuck').value), maxRecoveries: Number($('ai-recoveries').value) } };
}
async function renderTeachingState(capture) {
    const t = capture.teaching; if (!t) return;
    const revision = `${t.behaviorId}:${t.demonstrationId}:${t.phase}`;
    if (revision !== teachingRevision) { teachingRevision = revision; if (t.behaviorId) await refreshBehaviors(t.behaviorId); }
    $('model-status').textContent = t.provider.configured ? `${t.provider.provider} · ${t.provider.model} · ${t.provider.message}` : t.provider.message;
    $('teach-status').textContent = `${t.phase} · ${t.frameCount} visual states${t.error ? ' · ' + t.error : ''}`;
    const locked = recordingActive || active || capture.botArmed || t.phase === 'analyzing';
    $('model-status').textContent = 'AI Vision only: ' + $('model-status').textContent + ' Local Learned needs no provider.';
    $('teach-start').disabled = locked;
    $('teach-stop').disabled = t.phase !== 'capturing';
    $('teach-analyze').disabled = locked || !$('teach-demo').value;
    $('teach-delete').disabled = locked || localBusy || !$('teach-demo').value;
    if (t.phase === 'capturing') $('teach-status').textContent += ' · ' + (capture.recording?.reason ?? 'Preparing capture');
    if (capture.recording?.warnings?.length) $('teach-status').textContent += ' · ' + capture.recording.warnings.join('; ');
    $('teach-cancel').disabled = t.phase !== 'analyzing';
    $('teach-save').disabled = locked || !selectedBehavior();
    $('teach-behavior').disabled = locked;
    $('teach-start').textContent = $('record-method').value === 'hotkey' ? 'Arm teaching hotkey' : selectedBehavior() ? 'Teach another example' : 'Start teaching';
}
$('teach-behavior').onchange = () => { if (!$('teach-behavior').value) { $('teach-name').value = ''; $('teach-goal').value = ''; $('teach-completion').value = ''; } renderBehavior(); };
$('teach-demo').onchange = () => { $('teach-outcome').value = selectedBehavior()?.examples.find(e => e.demonstrationId === $('teach-demo').value)?.outcome ?? 'uncertain'; };
handle('teach-start', async () => {
    const id = $('teach-behavior').value;
    await api('recording/start', { target: target(), startMethod: $('record-method').value, delayMs: Number($('record-delay').value) * 1000, maxDurationMs: 120000,
        teaching: { ...(id ? { behaviorId: id } : {}), name: $('teach-name').value, goal: $('teach-goal').value, cameraMode: $('teach-camera').value } });
    previewMode = false; await poll();
});
handle('teach-stop', async () => { await api('recording/stop', {}); await poll(); });
handle('teach-delete', async () => {
    const behaviorId = $('teach-behavior').value, demonstrationId = $('teach-demo').value;
    if (!demonstrationId) throw new Error('Select a demonstration');
    if (!confirm('Permanently delete this demonstration, its screenshots, AI analysis and local learning contributions? This cannot be undone. Other demonstrations are kept.')) return;
    localBusy = true;
    try {
        await api('teaching/delete', { behaviorId, demonstrationId, confirm: true });
        localAnnotation = {}; localLastTransition = ''; $('local-example').replaceChildren();
        $('local-annotation').textContent = 'No pending annotation.';
        $('local-status').textContent = 'Demonstration contributions removed. Inspect local learning to refresh statistics.';
        await refreshBehaviors(behaviorId); await poll();
        $('message').textContent = 'Demonstration and source evidence deleted.';
    } finally { localBusy = false; }
});
handle('teach-analyze', async () => {
    await api('teaching/analyze', { behaviorId: $('teach-behavior').value, demonstrationId: $('teach-demo').value, outcome: $('teach-outcome').value, outcomeNote: $('teach-note').value }); await poll();
});
handle('teach-cancel', async () => { await api('teaching/cancel', {}); await poll(); });
handle('teach-save', async () => {
    await api('teaching/review', { id: $('teach-behavior').value, goal: $('teach-goal').value, completionOverride: $('teach-completion').value, reviewed: true });
    await refreshBehaviors(); $('run-kind').value = 'learned'; $('message').textContent = 'Learned behavior saved. Start Bot will run it from the current screen.';
});
function localSummary(t) {
    return `Local · API required: No · ${t.states ?? 0} learned transitions · ${t.demonstrations ?? 0} demonstrations · ${t.runtimeStates ?? 0} runtime states · ${t.experiences ?? 0} experiences (${t.positive ?? 0} useful / ${t.negative ?? 0} bad / ${t.neutral ?? 0} neutral / ${t.uncertain ?? 0} uncertain) · ${t.targets ?? 0} targets · ${t.recoveryExamples ?? t.recoveries ?? 0} recovery examples · confidence ${Math.round((t.confidence ?? 0) * 100)}% · ${t.unknown ?? 0} help requests · ${t.stuck ?? 0} stuck · ${t.successes ?? 0} success appearances · vision ${Math.round(t.visionMs ?? 0)} ms / decision ${Math.round(t.decisionMs ?? 0)} ms · ${t.observations ?? 0} images processed · database ${((t.diskBytes ?? 0) / 1048576).toFixed(1)} MB · checkpoint ${t.checkpointAt ?? 'not yet saved'}${t.recoveredCheckpoint ? ' · recovered backup checkpoint' : ''}${t.checkpointError ? ' · SAVE ERROR: ' + t.checkpointError : ''}`;
}
async function localOperation(action, extra = {}) {
    const b = selectedBehavior(); if (!b) throw new Error('Select a behavior first');
    localBusy = true; $('local-status').textContent = 'Processing locally…';
    try { const result = await api('local', { behaviorId: b.id, action, ...extra }); $('local-status').textContent = localSummary(result);
        if (result.examples) { $('local-example').replaceChildren(); for (const e of result.examples) option($('local-example'), e.id, `Frame ${e.frameId} · ${e.actions.join(', ')} · ${e.recovery ? 'recovery' : e.prior}${e.disabled ? ' · disabled' : ''}`); if (result.examples.some(e => e.id === localLastTransition)) $('local-example').value = localLastTransition; }
        if (result.results) $('local-status').textContent += ` · imported ${result.results.reduce((n, r) => n + r.added, 0)} / skipped ${result.results.reduce((n, r) => n + r.skipped, 0)} transitions`;
        return result;
    } finally { localBusy = false; }
}
handle('local-train', async () => {
    const id = $('teach-demo').value; if (!id) throw new Error('Choose a demonstration');
    if (localAnnotation.demonstrationId && localAnnotation.demonstrationId !== id) throw new Error('Visual annotation belongs to a different demonstration; clear it first');
    await localOperation('train', { training: { behaviorId: selectedBehavior().id, demonstrationId: id, outcome: $('teach-outcome').value,
        recovery: $('local-recovery').checked, ...localAnnotation, ...($('local-region').value.trim() ? { region: JSON.parse($('local-region').value) } : {}) } });
    $('run-kind').value = 'local';
});
handle('local-import', async () => { await localOperation('train'); $('run-kind').value = 'local'; });
handle('local-inspect', async () => { await localOperation('inspect'); });
handle('local-clear-annotation', async () => { localAnnotation = {}; $('local-annotation').textContent = 'Automatic click targets; no pending annotation.'; });
handle('local-long-run', async () => { $('run-kind').value = 'local'; $('duration').value = '43200'; $('count').value = '250000'; $('message').textContent = '12-hour local budget set. Stuck detection and all controller guards still apply.'; });
handle('local-clear-runtime', async () => { await localOperation('clear-runtime'); });
handle('local-reset', async () => { if (confirm('Rebuild local knowledge from demonstrations and clear runtime learning? Original evidence is kept.')) await localOperation('reset-demonstrations'); });
handle('local-full-reset', async () => { if (confirm('Clear all local knowledge for this behavior? Original demonstrations and AI analysis are kept.')) await localOperation('full-reset'); });
handle('local-forget-demo', async () => { await localOperation('forget-demo', { id: $('teach-demo').value }); });
for (const [id, outcome] of [['local-good', 'success'], ['local-bad', 'failure'], ['local-wrong', 'wrong-state']]) handle(id, async () => {
    await localOperation('correct', { id: $('local-example').value || localLastTransition, outcome });
});
handle('local-takeover', async () => {
    await api('stop', {}); await refreshBehaviors(); $('local-recovery').checked = true;
    const b = selectedBehavior(); if (!b) throw new Error('Select the same behavior before teaching recovery');
    await api('recording/start', { target: target(), startMethod: 'delay', delayMs: Math.max(3000, Number($('record-delay').value) * 1000), maxDurationMs: 120000,
        teaching: { behaviorId: b.id, name: b.name, goal: b.goal, cameraMode: b.cameraMode } });
    previewMode = false; await poll(); $('message').textContent = 'You control the target. Demonstrate recovery, stop with F9, label progress/success and choose Learn locally. Start Bot resumes from the current screen.';
});
for (const name of ['record', 'bot', 'stopRecording'])
    for (const key of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F9', 'F10', 'F11'])
        option($('hotkey-' + name), key, key);
setShortcuts({ record: 'F6', bot: 'F7', stopRecording: 'F9' });
steps = [{ kind: 'click', point: { x: .5, y: .5 }, button: 'left', durationMs: 50 }];
renderActions();
void Promise.all([refreshProfiles(), refreshBehaviors(), api('recording/settings').then(setShortcuts)]).catch(error => { $('message').textContent = error.message; });
async function tick() { try {
    await poll();
}
catch (error) {
    $('activity').textContent = 'Connection unavailable';
    $('status').textContent = error.message;
}
finally {
    setTimeout(tick, 350);
} }
void tick();
