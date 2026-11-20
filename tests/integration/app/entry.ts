// The app's main window for the integration tests (ADR-017). Tauri's IPC is replaced with its own
// mocks before the app loads: the core's commands go to the host whose address is in `?core=`,
// the others get the stand-in answers. Nothing of the app itself is changed.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { coreConnection } from "./coreConnection";
import { standIn } from "./tauriStandIns";

window.__integration = { unknown: [], opened: [] };
const core = coreConnection(new URLSearchParams(location.search).get("core") ?? "");
mockWindows("main");
mockIPC((command, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    return core.handles(command) ? core.invoke(command, args) : standIn(command, args);
}, { shouldMockEvents: true });

void import("../../../src-ui/views/app/index.tsx");
