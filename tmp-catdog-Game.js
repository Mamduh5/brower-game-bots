import { CONFIG } from "../config.js";
import { DOM_IDS } from "./AssetRefs.js";
import { GameState } from "./GameState.js";
import { Renderer } from "./Renderer.js";
import { InputManager } from "./InputManager.js";
import { SoundSystem } from "./SoundSystem.js";
import { Player } from "../entities/Player.js";
import { MenuScene } from "../scenes/MenuScene.js";
import { BattleScene } from "../scenes/BattleScene.js";
import { EndScene } from "../scenes/EndScene.js";
import { UISystem } from "../systems/UISystem.js";
import { AISystem } from "../systems/AISystem.js";
import { PhysicsSystem } from "../systems/PhysicsSystem.js";
import { CollisionSystem } from "../systems/CollisionSystem.js";
import { DamageSystem } from "../systems/DamageSystem.js";
import { TurnSystem } from "../systems/TurnSystem.js";

export class Game {
  constructor(preset = { touch: false, label: "Desktop", shellClass: "device-desktop" }) {
    const canvas = document.getElementById(DOM_IDS.canvas);
    this.preset = preset;
    this.state = new GameState();
    this.input = new InputManager();
    this.input.attach();
    this.sound = new SoundSystem();
    this.renderer = new Renderer(canvas);
    this.ui = new UISystem();
    this.aiSystem = new AISystem();
    this.physicsSystem = new PhysicsSystem();
    this.collisionSystem = new CollisionSystem();
    this.damageSystem = new DamageSystem();
    this.turnSystem = new TurnSystem();
    this.menuScene = new MenuScene();
    this.battleScene = new BattleScene();
    this.endScene = new EndScene();

    this.players = [
      new Player({
        id: 1,
        name: "P1 Cat",
        species: "cat",
        x: 150,
        facing: 1,
        colors: { body: "#f2965a", belly: "#ffdcb5", legs: "#7b4c36", ear: "#ffdcb5", accent: "#f4cd52", outline: "#5b3425" }
      }),
      new Player({
        id: 2,
        name: "P2 Dog",
        species: "dog",
        x: CONFIG.canvas.width - 150,
        facing: -1,
        colors: { body: "#63a1db", belly: "#d9efff", legs: "#355977", ear: "#446d93", accent: "#ffd36d", outline: "#274763" }
      })
    ];

    this.projectiles = [];
    this.particles = [];
    this.shockwaves = [];
    this.floatingTexts = [];
    this.lastFrame = performance.now();

    this.ui.bindMenuControls({
      onPlayCpu: () => this.startGame("cpu"),
      onPlayLocal: () => this.startGame("local"),
      onRestart: () => this.startGame(this.state.mode || "cpu"),
      onMenu: () => this.showMenu(),
      onDifficulty: (level) => this.setDifficulty(level)
    });
    this.ui.bindShellControls({
      onFullscreen: () => this.toggleFullscreen()
    });
    this.ui.bindBattleControls({
      onWeaponSelect: (key) => this.turnSystem.handleWeaponSelection(this, key)
    });
    this.ui.bindTouchControls(this.input);
    this.ui.setFullscreenAvailability(Boolean(document.fullscreenEnabled && this.preset.touch));
    this.ui.updateFullscreenState(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", () => {
      this.ui.updateFullscreenState(Boolean(document.fullscreenElement));
    });
    this.input.bindAimSurface(canvas, this.preset.touch);

    this.setDifficulty("normal");
    this.showMenu();
    requestAnimationFrame((timestamp) => this.loop(timestamp));
  }

  async toggleFullscreen() {
    const gameplaySurface = document.getElementById(DOM_IDS.gameplaySurface);
    if (!document.fullscreenEnabled || !gameplaySurface) {
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await gameplaySurface.requestFullscreen();
      }
    } catch {
      this.ui.setFullscreenAvailability(false);
    }
  }

  clearTransientEffects() {
    this.projectiles = [];
    this.particles = [];
    this.shockwaves = [];
    this.floatingTexts = [];
    this.state.clearProjectileFlow();
  }

  setDifficulty(level) {
    this.state.cpuDifficulty = CONFIG.cpuProfiles[level] ? level : "normal";
    this.ui.setDifficulty(this.state.cpuDifficulty, CONFIG.cpuProfiles[this.state.cpuDifficulty].description);
  }

  startGame(mode) {
    this.battleScene.enter(this);
    this.turnSystem.startMatch(this, mode);
  }

  showMenu() {
    this.menuScene.enter(this);
  }

  startTurn(index) {
    this.turnSystem.startTurn(this, index);
  }

  finishGame() {
    const alivePlayers = this.players.filter((player) => player.health.current > 0);
    const title = alivePlayers.length === 1 ? `${alivePlayers[0].name} Wins` : "Draw";
    const subtitle = alivePlayers.length === 1 ? "A sharper read of wind, range, and resources settled the round." : "Both fighters dropped at once. Run it back.";
    const playerWon = alivePlayers.length === 1 && (this.state.mode === "local" || alivePlayers[0] === this.players[0]);
    this.sound.play(playerWon ? "win" : "lose");
    this.state.hint = "Press Play Again for another round.";
    this.endScene.enter(this, title, subtitle);
  }

  getCurrentPlayer() {
    return this.players[this.state.currentPlayerIndex];
  }

  isCpuTurn() {
    return this.state.mode === "cpu" && this.state.currentPlayerIndex === 1 && this.state.phase === "aiming";
  }

  handleGlobalAction(code) {
    if ((code === "Space" || code === "Enter") && this.state.phase === "gameover" && this.state.mode) {
      this.startGame(this.state.mode);
      return true;
    }
    if (code === "KeyR" && this.state.mode) {
      this.startGame(this.state.mode);
      return true;
    }
    if (code === "KeyM") {
      this.showMenu();
      return true;
    }
    return false;
  }

  processInputs() {
    for (const event of this.input.consumePointerEvents()) {
      this.turnSystem.handlePointer(this, event);
    }

    for (const code of this.input.consumeActions()) {
      if (!this.handleGlobalAction(code)) {
        this.turnSystem.handleAction(this, code);
      }
    }
  }

  loop(timestamp) {
    const dt = Math.min(0.033, (timestamp - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = timestamp;
    this.state.elapsedTime += dt;
    this.processInputs();
    this.physicsSystem.updateEffects(this, dt);
    if (this.state.scene === "battle" || this.state.scene === "end") {
      this.turnSystem.update(this, dt);
    }
    this.ui.update(this);
    this.renderer.render(this);
    requestAnimationFrame((next) => this.loop(next));
  }
}


