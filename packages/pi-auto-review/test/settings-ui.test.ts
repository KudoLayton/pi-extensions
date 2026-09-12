import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { showMenu } from "../src/settings-ui.js";

const state = vi.hoisted(() => ({
  change: undefined as undefined | ((id: string, value: string) => void),
  updates: [] as string[],
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({ getSettingsListTheme: () => ({}) }));
vi.mock("@earendil-works/pi-tui", () => ({
  Container: class {
    addChild() {}
    render(width: number) {
      return ["x".repeat(width)];
    }
    invalidate() {}
  },
  Text: class {},
  Key: { ctrl: () => "\u0003" },
  matchesKey: (data: string, key: string) => data === key,
  SettingsList: class {
    constructor(_items: unknown, _height: unknown, _theme: unknown, change: typeof state.change) {
      state.change = change;
    }
    updateValue(id: string) {
      state.updates.push(id);
    }
    handleInput() {}
  },
}));

test("settings screen cancels on lifecycle and Ctrl+C; stale failed saves do not revert newer changes", async () => {
  state.updates = [];
  const controller = new AbortController();
  let finished = 0;
  const failures: ((error: Error) => void)[] = [];
  type Component = { render(width: number): string[]; handleInput(data: string): void; dispose(): void };
  const screen: { component?: Component } = {};
  const ctx = {
    mode: "tui",
    ui: {
      select: async () => "설정",
      notify: vi.fn(),
      custom: async (
        factory: (
          tui: { requestRender(): void },
          theme: { fg(color: string, text: string): string },
          keys: object,
          done: () => void,
        ) => Component,
      ) => {
        screen.component = factory(
          { requestRender() {} },
          { fg: (_color: string, text: string) => text },
          {},
          () => finished++,
        );
      },
    },
  } as unknown as ExtensionContext;
  await showMenu(
    ctx,
    () => DEFAULT_SETTINGS,
    () => "status",
    "settings.json",
    () => new Promise((_resolve, reject) => failures.push(reject)),
    controller.signal,
    () => true,
  );
  assert.ok(screen.component);
  assert.ok(state.change);
  assert.equal(screen.component.render(20)[0].length, 20);
  state.change("timeoutMs", "10000");
  state.change("timeoutMs", "60000");
  failures[0](new Error("first save failed"));
  await Promise.resolve();
  assert.deepEqual(state.updates, []);
  screen.component.handleInput("\u0003");
  assert.equal(finished, 1);
  controller.abort();
  assert.equal(finished, 2);
  screen.component.dispose();
  failures[1](new Error("screen closed"));
  await Promise.resolve();
  assert.deepEqual(state.updates, []);
});

test("cancelled selection cannot open a settings screen", async () => {
  const controller = new AbortController();
  const custom = vi.fn();
  const ctx = {
    ui: {
      select: async () => {
        controller.abort();
        return "설정";
      },
      custom,
    },
  } as unknown as ExtensionContext;
  await showMenu(
    ctx,
    () => DEFAULT_SETTINGS,
    () => "",
    "settings.json",
    async () => {},
    controller.signal,
    () => true,
  );
  assert.equal(custom.mock.calls.length, 0);
});
