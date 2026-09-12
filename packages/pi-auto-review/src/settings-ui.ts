import { type ExtensionContext, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import type { Settings } from "./settings.js";

export async function showMenu(
  ctx: ExtensionContext,
  getSettings: () => Settings,
  status: () => string,
  path: string,
  save: (patch: Partial<Settings>) => Promise<unknown>,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<void> {
  const action = await ctx.ui.select("권한 자동 검토", ["설정", "상태", "도움말"], { signal });
  if (signal.aborted || !isCurrent()) return;
  if (action === "상태") {
    ctx.ui.notify(status(), "info");
    return;
  }
  if (action === "도움말") {
    ctx.ui.notify(`불확실한 작업은 승인 창으로 전환합니다. 설정은 ${path}에 저장됩니다.`, "info");
    return;
  }
  if (action !== "설정" || ctx.mode !== "tui" || ctx.signal?.aborted) return;
  await ctx.ui.custom<void>((tui, theme, _keys, done) => {
    let disposed = false;
    const versions = new Map<string, number>();
    const abort = () => done();
    signal.addEventListener("abort", abort, { once: true });
    const settings = getSettings();
    const items: SettingItem[] = [
      {
        id: "enabled",
        label: "자동 검토",
        description: "새 도구 호출의 자동 검토 사용",
        currentValue: String(settings.enabled),
        values: ["true", "false"],
      },
      {
        id: "timeoutMs",
        label: "검토 제한 시간",
        description: "밀리초; 자동 재시도 없음",
        currentValue: String(settings.timeoutMs),
        values: ["10000", "30000", "60000"],
      },
      {
        id: "maxInputTokens",
        label: "입력 예산",
        description: "UTF-8 기반 추정치; 과금 상한 아님",
        currentValue: String(settings.maxInputTokens),
        values: ["6000", "8000", "16000", "32000"],
      },
      {
        id: "maxOutputTokens",
        label: "출력 상한",
        description: "잘린 응답은 수동 승인으로 전환",
        currentValue: String(settings.maxOutputTokens),
        values: ["512", "1000", "2000", "4000"],
      },
    ];
    const container = new Container();
    container.addChild(new Text(theme.fg("accent", "Auto review 설정"), 1, 1));
    container.addChild(new Text(theme.fg("muted", `모델/provider는 ${path}에서 편집 후 /reload 하세요.`), 1, 0));
    const list = new SettingsList(
      items,
      items.length + 2,
      getSettingsListTheme(),
      (id, value) => {
        const version = (versions.get(id) ?? 0) + 1;
        versions.set(id, version);
        const patch = id === "enabled" ? { enabled: value === "true" } : { [id]: Number(value) };
        void save(patch).catch(() => {
          if (disposed || !isCurrent() || versions.get(id) !== version) return;
          list.updateValue(id, String(getSettings()[id as keyof Settings]));
          ctx.ui.notify("설정 저장 실패: 기존 값이 유지됩니다.", "error");
          tui.requestRender();
        });
      },
      () => done(),
    );
    container.addChild(list);
    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        if (matchesKey(data, Key.ctrl("c"))) {
          done();
          return;
        }
        list.handleInput(data);
        tui.requestRender();
      },
      dispose: () => {
        disposed = true;
        signal.removeEventListener("abort", abort);
      },
    };
  });
}
