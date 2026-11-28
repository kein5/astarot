// The desktop caption window over a stand-in scene, for the user guide's screenshots
// (docsScreenshots.spec.ts). The real window is see-through over whatever is on the screen; here
// a drawn backdrop takes the place of the game, and the captions come from the lines below
// instead of the main window. With ?flow=1 the flow strip is drawn too, worded in ?lang= as the
// main window words it, from the sample of tests/voice/fixtures/io_flow_sample.json.
import { createRoot } from "react-dom/client";
import i18n from "../../../locales/config";
import { flowNote, stripItems } from "../../../src-ui/logics/flow/flowText";
import "../../../src-ui/views/caption_overlay/page.css";
import { CaptionOverlay } from "../../../src-ui/views/caption_overlay/CaptionOverlay";
import sample from "../../voice/fixtures/io_flow_sample.json";
import "./scene.css";

const params = new URLSearchParams(location.search);
void i18n.changeLanguage(params.get("lang") || "ja");
const t = i18n.t.bind(i18n);

// Two voices of the game audio told apart (A, B), then the user's own words.
const lines = [
    { id: "1", kind: "received", speakers: ["A"], text: "Welcome! Let me show you around.", translations: ["ようこそ！案内しますね。"] },
    { id: "2", kind: "received", speakers: ["B"], text: "The event starts at nine.", translations: ["イベントは9時に始まります。"] },
    { id: "3", kind: "sent", text: "ありがとうございます。楽しみです！", translations: ["Thank you. I'm looking forward to it!"] },
].map(line => ({ ...line, pending: false, until: Number.MAX_SAFE_INTEGER }));
const flow = params.get("flow") === "1"
    ? { flow: stripItems(sample.traces as any, 2, t), flow_note: flowNote(sample.flow as any, t) } : {};
// The app's defaults (ui_configs.overlay_desktop_default_settings).
const bridge = {
    snapshot: async () => ({ lines, position: "bottom", font_size: 28, opacity: 0.6, font_family: "Noto Sans JP", ...flow }),
    onChanged: async () => () => {},
};

const root = document.getElementById("root");
if (root) createRoot(root).render(<CaptionOverlay bridge={bridge as any} now={() => 0} />);
