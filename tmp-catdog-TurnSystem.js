import { CONFIG } from "../config.js";
import { ATTACK_ORDER, cycleList } from "../utils/helpers.js";
import { clamp, distance, lerp, randRange } from "../utils/math.js";

export class TurnSystem {
  startMatch(game, mode) {
    game.state.mode = mode;
    game.state.scene = "battle";
    game.state.phase = "ready";
    game.state.currentPlayerIndex = 0;
    game.state.pendingGameOver = false;
    game.state.clearProjectileFlow();
    game.state.cpuPlan = null;
    game.state.clearDragAim();
    game.clearTransientEffects();
    game.state.resetWall();
    game.players[0].name = "P1 Cat";
    game.players[1].name = mode === "cpu" ? "CPU Dog" : "P2 Dog";
    game.players.forEach((player) => player.reset());
    game.sound.play("start");
    game.startTurn(0);
  }

  update(game, dt) {
    if (game.state.phase === "ready") {
      game.state.turnTimer -= dt;
      if (game.state.turnTimer <= 0) this.enterAiming(game);
      return;
    }

    if (game.state.phase === "aiming") {
      if (game.isCpuTurn()) {
        game.state.cpuTimer -= dt;
        if (game.state.cpuTimer <= 0) {
          if (game.state.cpuPlan?.action === "heal") this.useHeal(game, true);
          else this.tryShoot(game, true);
        }
      } else {
        this.updateAim(game, dt);
      }
      return;
    }

    if (game.state.phase === "windup") {
      game.state.turnTimer -= dt;
      if (game.state.turnTimer <= 0) game.physicsSystem.launchPreparedShot(game);
      return;
    }

    if (game.state.phase === "projectile") {
      game.physicsSystem.updateProjectiles(game, dt);
      return;
    }

    if (game.state.phase === "turn-end") {
      game.state.turnTimer -= dt;
      if (game.state.turnTimer <= 0) {
        if (game.state.pendingGameOver) game.finishGame();
        else game.startTurn(1 - game.state.currentPlayerIndex);
      }
    }
  }

  enterAiming(game) {
    const player = game.getCurrentPlayer();
    player.ensureSelectableShot();
    game.state.phase = "aiming";
    game.state.hideBanner();
    game.state.clearDragAim();
    game.state.cpuPlan = null;

    if (game.isCpuTurn()) {
      const plan = game.aiSystem.chooseShot(game, { followUp: game.state.isBossFollowUpTurn });
      game.state.cpuPlan = plan;
      if (plan.action === "heal") {
        game.state.cpuTimer = plan.delay;
        game.state.hint = plan.fullHeal ? `${player.name} sizes up a shameless full heal.` : `${player.name} is deciding whether to patch up.`;
      } else {
        player.weapon.shotType = plan.shotKey;
        player.aim.angle = plan.angle;
        player.aim.power = plan.power;
        game.state.cpuTimer = plan.delay;
        if (plan.bossEcho && plan.bossDouble) game.state.hint = `${player.name} lines up something blatantly unfair.`;
        else if (plan.bossEcho) game.state.hint = `${player.name} is hiding a cheat shot.`;
        else if (plan.bossDouble) game.state.hint = `${player.name} plans to fire twice.`;
        else game.state.hint = `${player.name} is reading the wind...`;
      }
    } else if (game.preset.touch) {
      game.state.hint = "Drag back from the throwing hand, then release to fire.";
    } else {
      game.state.hint = "Adjust angle, power, and projectile, then throw.";
    }
  }

  updateAim(game, dt) {
    if (game.state.dragAim) {
      return;
    }

    const left = game.input.isDown("ArrowLeft") || game.input.isDown("KeyA");
    const right = game.input.isDown("ArrowRight") || game.input.isDown("KeyD");
    const up = game.input.isDown("ArrowUp") || game.input.isDown("KeyW");
    const down = game.input.isDown("ArrowDown") || game.input.isDown("KeyS");

    if (left) this.adjustAim(game, "angle", -CONFIG.aim.angleSpeed * dt);
    if (right) this.adjustAim(game, "angle", CONFIG.aim.angleSpeed * dt);
    if (up) this.adjustAim(game, "power", CONFIG.aim.powerSpeed * dt);
    if (down) this.adjustAim(game, "power", -CONFIG.aim.powerSpeed * dt);
  }

  handleAction(game, code) {
    if (code === "Space" || code === "Enter") {
      this.tryShoot(game, false);
      return;
    }
    if (game.state.phase !== "aiming" || game.isCpuTurn()) {
      return;
    }

    if (code === "ArrowLeft" || code === "KeyA") this.adjustAim(game, "angle", -CONFIG.aim.angleTap);
    if (code === "ArrowRight" || code === "KeyD") this.adjustAim(game, "angle", CONFIG.aim.angleTap);
    if (code === "ArrowUp" || code === "KeyW") this.adjustAim(game, "power", CONFIG.aim.powerTap);
    if (code === "ArrowDown" || code === "KeyS") this.adjustAim(game, "power", -CONFIG.aim.powerTap);
    if (code === "KeyQ") this.setShotType(game, this.cycleAvailableShot(game.getCurrentPlayer(), -1));
    if (code === "KeyE") this.setShotType(game, this.cycleAvailableShot(game.getCurrentPlayer(), 1));
    if (code === "Digit1") this.setShotType(game, "normal");
    if (code === "Digit2") this.setShotType(game, "light");
    if (code === "Digit3") this.setShotType(game, "heavy");
    if (code === "Digit4") this.setShotType(game, "super");
    if (code === "Digit5") this.useHeal(game, false);
  }

  handleWeaponSelection(game, key) {
    if (key === "heal") {
      this.useHeal(game, false);
      return;
    }
    this.setShotType(game, key);
  }

  handlePointer(game, event) {
    if (event.type === "cancel-all") {
      this.cancelDragAim(game);
      return;
    }

    if (!game.preset.touch) {
      return;
    }

    if (game.state.dragAim && (game.state.phase !== "aiming" || game.isCpuTurn())) {
      this.cancelDragAim(game);
    }

    if (event.type === "down") {
      this.startDragAim(game, event);
      return;
    }

    const drag = game.state.dragAim;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (event.type === "move") {
      this.updateDragAim(game, event.x, event.y);
      return;
    }

    if (event.type === "up") {
      this.releaseDragAim(game);
      return;
    }

    if (event.type === "cancel") {
      this.cancelDragAim(game, "Touch canceled. Drag again to aim.");
    }
  }

  cycleAvailableShot(player, direction) {
    const available = ATTACK_ORDER.filter((key) => player.hasAmmo(key));
    if (available.length === 0) {
      return "normal";
    }
    if (!available.includes(player.weapon.shotType)) {
      return available[0];
    }
    return cycleList(available, player.weapon.shotType, direction);
  }

  adjustAim(game, type, amount) {
    const player = game.getCurrentPlayer();
    if (type === "angle") player.aim.angle = clamp(player.aim.angle + amount, CONFIG.aim.angleMin, CONFIG.aim.angleMax);
    else player.aim.power = clamp(player.aim.power + amount, CONFIG.aim.powerMin, CONFIG.aim.powerMax);
  }

  setShotType(game, shotKey) {
    const player = game.getCurrentPlayer();
    if (game.state.phase !== "aiming" || game.isCpuTurn()) {
      return;
    }
    if (!ATTACK_ORDER.includes(shotKey)) {
      return;
    }
    if (!player.hasAmmo(shotKey)) {
      game.state.hint = `${CONFIG.projectileTypes[shotKey].label} is out of ammo.`;
      return;
    }
    player.weapon.shotType = shotKey;
    game.state.hint = game.preset.touch
      ? `${player.name} switched to ${CONFIG.projectileTypes[shotKey].label.toLowerCase()}. Drag and release to fire.`
      : `${player.name} switched to ${CONFIG.projectileTypes[shotKey].label.toLowerCase()}.`;
  }

  useHeal(game, force) {
    if (game.state.phase !== "aiming" || (!force && game.isCpuTurn())) {
      return;
    }

    const player = game.getCurrentPlayer();
    if (!player.hasAmmo("heal")) {
      game.state.hint = "Heal has already been used.";
      return;
    }
    if (player.health.current >= player.health.max) {
      game.state.hint = `${player.name} is already at full HP.`;
      return;
    }

    game.state.clearDragAim();
    const plan = game.state.cpuPlan;
    game.state.cpuPlan = null;
    const healed = game.damageSystem.useHeal(game, player, { full: Boolean(force && plan?.fullHeal) });
    if (healed <= 0) {
      game.state.hint = `${player.name} could not recover any more HP.`;
      return;
    }

    player.ensureSelectableShot();
    game.state.isBossFollowUpTurn = false;
    game.state.bossShotsRemaining = 0;
    game.state.phase = "turn-end";
    game.state.pendingGameOver = false;
    game.state.turnTimer = CONFIG.turn.healPause;
  }

  tryShoot(game, force) {
    if (game.state.phase !== "aiming" || (!force && game.isCpuTurn())) return;

    const player = game.getCurrentPlayer();
    player.ensureSelectableShot();
    if (!player.hasAmmo(player.weapon.shotType)) {
      game.state.hint = `${CONFIG.projectileTypes[player.weapon.shotType].label} is out of ammo.`;
      return;
    }

    const shot = CONFIG.projectileTypes[player.weapon.shotType];
    const bossPlan = force ? game.state.cpuPlan : null;
    game.state.preparedThrow = {
      playerIndex: game.state.currentPlayerIndex,
      angle: player.aim.angle,
      power: player.aim.power,
      shotKey: player.weapon.shotType,
      bossEcho: Boolean(bossPlan?.bossEcho)
    };
    game.state.bossShotsRemaining = bossPlan?.bossDouble && !game.state.isBossFollowUpTurn ? 1 : 0;
    game.state.cpuPlan = null;
    game.state.clearDragAim();
    player.setAnticipation(shot.windup);
    game.state.phase = "windup";
    game.state.turnTimer = shot.windup;
    game.state.hint = `${player.name} winds up a ${shot.label.toLowerCase()} shot...`;
  }

  finishProjectileSequence(game) {
    game.state.pendingGameOver = game.players.some((player) => player.health.current <= 0);

    const impossibleFollowUp = !game.state.pendingGameOver
      && game.state.mode === "cpu"
      && game.state.cpuDifficulty === "impossible"
      && game.state.currentPlayerIndex === 1
      && game.state.bossShotsRemaining > 0;

    if (impossibleFollowUp) {
      game.state.bossShotsRemaining -= 1;
      game.state.isBossFollowUpTurn = true;
      game.state.phase = "ready";
      game.state.turnTimer = CONFIG.turn.bossFollowUpPause;
      game.state.showBanner("Cheater Turn", "Boss Fires Again");
      game.state.hint = "Impossible bot steals a second shot.";
      return;
    }

    game.state.isBossFollowUpTurn = false;
    game.state.phase = "turn-end";
    game.state.turnTimer = game.state.pendingGameOver ? CONFIG.turn.endPause : CONFIG.turn.impactPause;
  }

  startTurn(game, index) {
    const player = game.players[index];
    game.state.currentPlayerIndex = index;
    game.state.phase = "ready";
    game.state.turnTimer = CONFIG.turn.readyPause;
    game.state.pendingGameOver = false;
    game.state.clearProjectileFlow();
    game.state.cpuPlan = null;
    game.state.clearDragAim();
    game.projectiles = [];
    game.state.wind = clamp(
      randRange(-CONFIG.world.maxWind, CONFIG.world.maxWind) + randRange(-CONFIG.world.windJitter, CONFIG.world.windJitter),
      -CONFIG.world.maxWind,
      CONFIG.world.maxWind
    );
    player.ensureSelectableShot();
    player.aim.angle = clamp(player.aim.angle, CONFIG.aim.angleMin, CONFIG.aim.angleMax);
    player.aim.power = clamp(player.aim.power, CONFIG.aim.powerMin, CONFIG.aim.powerMax);
    game.state.showBanner("Get Ready", `${player.name} Up`);
    game.state.hint = `${player.name} is stepping in.`;
  }

  startDragAim(game, event) {
    if (game.state.phase !== "aiming" || game.isCpuTurn()) {
      return;
    }

    const player = game.getCurrentPlayer();
    player.ensureSelectableShot();
    const launch = player.getLaunchPoint();
    const anchor = player.getDamageAnchor();
    const withinLaunch = distance(event.x, event.y, launch.x, launch.y) <= CONFIG.touch.pickupRadius;
    const withinBody = distance(event.x, event.y, anchor.x, anchor.y) <= CONFIG.touch.pickupRadius;

    if (!withinLaunch && !withinBody) {
      return;
    }

    game.state.startDragAim({
      pointerId: event.pointerId,
      anchorX: launch.x,
      anchorY: launch.y,
      currentX: event.x,
      currentY: event.y,
      dragDistance: 0,
      normalized: 0,
      angle: player.aim.angle,
      power: player.aim.power,
      canFire: false
    });

    this.updateDragAim(game, event.x, event.y);
    game.state.hint = "Pull back to set the arc and power. Release to fire.";
  }

  updateDragAim(game, x, y) {
    const drag = game.state.dragAim;
    if (!drag) {
      return;
    }

    const player = game.getCurrentPlayer();
    const pullX = Math.max(0, (drag.anchorX - x) * player.facing);
    const pullY = Math.max(0, y - drag.anchorY);
    const rawDistance = Math.hypot(pullX, pullY);
    const dragDistance = clamp(rawDistance, 0, CONFIG.touch.dragMax);
    const normalized = clamp((dragDistance - CONFIG.touch.dragMin) / (CONFIG.touch.dragMax - CONFIG.touch.dragMin), 0, 1);
    const angle = clamp(
      Math.atan2(pullY, Math.max(CONFIG.touch.angleBase, pullX)) * 180 / Math.PI,
      CONFIG.aim.angleMin,
      CONFIG.aim.angleMax
    );
    const power = lerp(CONFIG.aim.powerMin, CONFIG.aim.powerMax, normalized);

    player.aim.angle = angle;
    player.aim.power = power;
    game.state.updateDragAim({
      currentX: x,
      currentY: y,
      pullX,
      pullY,
      rawDistance,
      dragDistance,
      normalized,
      angle,
      power,
      canFire: dragDistance >= CONFIG.touch.fireThreshold
    });
  }

  releaseDragAim(game) {
    const drag = game.state.dragAim;
    if (!drag) {
      return;
    }

    const canFire = drag.canFire;
    game.state.clearDragAim();

    if (!canFire) {
      game.state.hint = "Pull back a little farther, then release to shoot.";
      return;
    }

    this.tryShoot(game, false);
  }

  cancelDragAim(game, hint = "") {
    if (!game.state.dragAim) {
      return;
    }

    game.state.clearDragAim();
    if (hint && game.state.phase === "aiming" && !game.isCpuTurn()) {
      game.state.hint = hint;
    }
  }
}






