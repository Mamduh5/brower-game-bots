export class InputManager {
  constructor() {
    this.keys = new Set();
    this.actions = [];
    this.pointerEvents = [];
    this.canvasAimEnabled = false;
    this.aimSurface = null;
    this.prevented = new Set([
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Space",
      "Enter",
      "KeyA",
      "KeyD",
      "KeyW",
      "KeyS",
      "KeyQ",
      "KeyE",
      "Digit1",
      "Digit2",
      "Digit3",
      "Digit4",
      "Digit5",
      "KeyR",
      "KeyM"
    ]);
    this.pointerHolds = new Map();
  }

  attach() {
    window.addEventListener("keydown", (event) => {
      if (this.prevented.has(event.code)) {
        event.preventDefault();
      }
      if (!event.repeat) {
        this.queueAction(event.code);
      }
      this.keys.add(event.code);
    });

    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.code);
    });

    window.addEventListener("blur", () => {
      this.keys.clear();
      this.pointerHolds.clear();
      this.pointerEvents.push({ type: "cancel-all" });
    });
  }

  bindTouchControls(elements) {
    elements.forEach((element) => {
      const code = element.dataset.inputCode;
      const mode = element.dataset.inputMode || "tap";
      if (!code) {
        return;
      }

      const release = (pointerId) => {
        if (this.pointerHolds.get(pointerId) === code) {
          this.pointerHolds.delete(pointerId);
          this.keys.delete(code);
        }
      };

      element.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        if (mode === "hold") {
          this.pointerHolds.set(event.pointerId, code);
          this.keys.add(code);
        }
        this.queueAction(code);
      });

      element.addEventListener("pointerup", (event) => {
        event.preventDefault();
        release(event.pointerId);
      });

      element.addEventListener("pointercancel", (event) => {
        release(event.pointerId);
      });

      element.addEventListener("pointerleave", (event) => {
        if (mode === "hold") {
          release(event.pointerId);
        }
      });
    });
  }

  bindAimSurface(surface, enabled) {
    this.aimSurface = surface;
    this.canvasAimEnabled = Boolean(enabled);

    if (!surface || surface.dataset.pointerBound === "true") {
      return;
    }

    const toCanvasPoint = (event) => {
      const rect = surface.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * surface.width,
        y: ((event.clientY - rect.top) / rect.height) * surface.height
      };
    };

    const pushPointer = (type, event) => {
      if (!this.canvasAimEnabled) {
        return;
      }

      const point = toCanvasPoint(event);
      this.pointerEvents.push({
        type,
        pointerId: event.pointerId,
        x: point.x,
        y: point.y,
        pointerType: event.pointerType
      });
    };

    surface.addEventListener("pointerdown", (event) => {
      if (!this.canvasAimEnabled) {
        return;
      }
      event.preventDefault();
      surface.setPointerCapture?.(event.pointerId);
      pushPointer("down", event);
    });

    surface.addEventListener("pointermove", (event) => {
      if (!this.canvasAimEnabled) {
        return;
      }
      pushPointer("move", event);
    });

    surface.addEventListener("pointerup", (event) => {
      if (!this.canvasAimEnabled) {
        return;
      }
      event.preventDefault();
      surface.releasePointerCapture?.(event.pointerId);
      pushPointer("up", event);
    });

    surface.addEventListener("pointercancel", (event) => {
      surface.releasePointerCapture?.(event.pointerId);
      pushPointer("cancel", event);
    });

    surface.dataset.pointerBound = "true";
  }

  queueAction(code) {
    this.actions.push(code);
  }

  isDown(code) {
    return this.keys.has(code);
  }

  consumeActions() {
    const current = [...this.actions];
    this.actions.length = 0;
    return current;
  }

  consumePointerEvents() {
    const current = [...this.pointerEvents];
    this.pointerEvents.length = 0;
    return current;
  }
}

