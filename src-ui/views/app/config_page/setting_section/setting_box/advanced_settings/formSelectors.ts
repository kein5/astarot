// The kit's parts (views/kit) draw themselves, so the settings forms' rules for their own native
// controls (VoiceSettings.css.ts) leave them alone: a button, a switch, a toggle or a toggle group's
// item (all <button>s), a field, a textarea or a select named by the kit's data-slot, the options and
// groups of the kit's select, and the focus ring and the dimming the kit's parts draw for themselves.
// A form can then hold the kit's Button, Switch, Toggle, ToggleGroup, TextField, Textarea and Select
// beside its own controls (docs/design/components/hand-built-inventory.md). Kept out of the .css.ts
// file, which can only export styles, so that it can be tested.
const KIT_SLOTS = '[data-slot="button"], [data-slot="switch"], [data-slot="toggle"], [data-slot="toggle-group-item"], [data-slot="input"], [data-slot="textarea"], [data-slot="native-select"], [data-slot="native-select-option"], [data-slot="native-select-optgroup"]';
const KIT_SLOT: Record<string, readonly string[]> = {
    button: ["button", "switch", "toggle", "toggle-group-item"], input: ["input"], textarea: ["textarea"], select: ["native-select"],
    option: ["native-select-option"],
};

// A selector of a form's rule, as it applies under the form's container: one that starts with a
// native control leaves out the kit's part of that kind; one for paragraphs leaves out the kit's
// paragraphs (a dialog's description) without weighing more, so a screen's own rule for its
// paragraphs still wins as before; the focus ring and the dimming leave out every kit part.
export const leavesKit = (selector: string): string => selector
    .replace(/^(button|input|textarea|select|option)(?![\w-])/, tag => tag + KIT_SLOT[tag].map(slot => `:not([data-slot="${slot}"])`).join(""))
    .replace(/^p(?![\w-])/, "p:not(:where([data-slot]))")
    .replace(/^:(focus-visible|disabled)$/, (_, state: string) => `:${state}:not(${KIT_SLOTS})`);
