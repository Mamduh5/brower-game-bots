import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpVisualModel, visualModelStatus } from "../src/vision/visual-model.js";
const config = { provider: "openai" as const, model: "configured-vision-model", apiKey: "test-secret-never-persist", baseUrl: "https://api.openai.com/v1", timeoutMs: 1000, maxOutputTokens: 1000 };
const envelope = (text: string) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 100, output_tokens: 20 } });
afterEach(() => vi.useRealTimers());
describe("multimodal HTTP provider", () => {
  it("uses Responses image inputs, JSON mode, store:false and secret-only authorization headers", async () => {
    const request = vi.fn().mockResolvedValue(Response.json(envelope('{"ok":true}')));
    const m = new HttpVisualModel(config, request);
    expect(await m.json("Return JSON", { goal: "collect" }, [{ label: "current", png: Buffer.from("pixels") }], new AbortController().signal)).toEqual({ ok: true });
    const [url, options] = request.mock.calls[0]!; const body = JSON.parse(options.body);
    expect(url).toBe("https://api.openai.com/v1/responses"); expect(body.store).toBe(false);
    expect(body.input[0].content.at(-1)).toMatchObject({ type: "input_image", image_url: "data:image/png;base64,cGl4ZWxz" });
    expect(body.text.format.type).toBe("json_object"); expect(options.body).not.toContain(config.apiKey);
    expect(options.headers.authorization).toBe(`Bearer ${config.apiKey}`);
    expect(m.usage).toMatchObject({ calls: 1, inputTokens: 100, outputTokens: 20 });
  });
  it("supports compatible image-capable chat endpoints through the same port", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] }));
    await new HttpVisualModel({ ...config, provider: "openai-compatible", baseUrl: "http://127.0.0.1:8000/v1", apiKey: "" }, request).json("JSON", {}, [{ label: "current", png: Buffer.from("pixels") }], new AbortController().signal);
    expect(request.mock.calls[0]![0]).toBe("http://127.0.0.1:8000/v1/chat/completions");
    expect(JSON.parse(request.mock.calls[0]![1].body).messages[1].content.at(-1).type).toBe("image_url");
  });
  it.each([
    { status: "incomplete", output: [] },
    { status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }] },
    envelope("not JSON"), envelope(`{"secret":"${config.apiKey}"}`)
  ])("fails closed on incomplete, refused, malformed or credential-echoing output", async response => {
    const m = new HttpVisualModel(config, vi.fn().mockResolvedValue(Response.json(response)));
    await expect(m.json("JSON", {}, [], new AbortController().signal)).rejects.toThrow(/Visual provider/);
  });
  it("does not include upstream HTTP body or fetch error details in user-facing failures", async () => {
    for (const request of [vi.fn().mockResolvedValue(new Response(config.apiKey, { status: 401 })), vi.fn().mockRejectedValue(new Error(`invalid token ${config.apiKey}`))]) {
      const m = new HttpVisualModel(config, request);
      const error = await m.json("JSON", {}, [], new AbortController().signal).catch(e => e);
      expect(error.message).not.toContain(config.apiKey); expect(error.message).toMatch(/Visual provider/);
    }
  });
  it("aborts pending HTTP work on timeout and caller cancellation", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })));
    const m = new HttpVisualModel(config, request);
    const timed = m.json("JSON", {}, [], new AbortController().signal).catch(e => e.message);
    await vi.advanceTimersByTimeAsync(1100); expect(await timed).toMatch(/timed out/);
    const controller = new AbortController(); const cancelled = m.json("JSON", {}, [], controller.signal).catch(e => e.message); controller.abort();
    expect(await cancelled).toMatch(/cancelled/);
  });
  it("reports missing configuration safely and validates endpoints without echoing values", () => {
    expect(visualModelStatus({}).configured).toBe(false);
    const status = visualModelStatus({ DESKTOP_AI_PROVIDER: "openai-compatible", DESKTOP_AI_MODEL: "vision", DESKTOP_AI_BASE_URL: "https://user:secret@example.com/v1" });
    expect(status.configured).toBe(false); expect(JSON.stringify(status)).not.toContain("secret");
    expect(visualModelStatus({ DESKTOP_AI_MODEL: "vision", OPENAI_API_KEY: config.apiKey }).configured).toBe(true);
  });
});
