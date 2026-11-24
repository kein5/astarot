# Component inventory: comparison with shadcn/ui

[日本語版](#部品の棚卸し-shadcnui-との照合日本語版)

This document compares the app's components with the components of shadcn/ui and lists the differences. It is the groundwork for the policy in the "Components" section of DESIGN.md, which aligns components with shadcn/ui (#680). At the time of the inventory, no component code had been changed. Differences aligned since then say "Aligned" in the "Handling" column, with the PR number.

- Status: inventory (2026-11-19). The alignment is done in stages as PRs, starting with differences that need no decision and differences whose decision items below have been decided. Stage 1 (the kit) was #684. In stage 2, Select and the text fields were aligned in #691, buttons in #694, the search fields in #695, checkboxes and sliders in #697, tooltips in #721 and the Dialog parts in the kit in #775.
- shadcn/ui compared: `apps/v4/registry/new-york-v4/ui/` in [shadcn-ui/ui](https://github.com/shadcn-ui/ui) (commit `968d8cb9dc` on `main`, 2026-11-17). It is under the MIT license. Which style to align with is decided in D-01.
- App compared: develop (after #676 and #677 were merged)
- Related documents: [Settings screen component experiment](README.md) (#452, `src-ui/views/kit/`), [ADR-010](../../adr/adr-010-frontend-stack.md), [inventory of hand-built components](hand-built-inventory.md) (a list of the places where a screen builds its own element instead of using a shared component, 2026-11-23)

## How to read this document

- Lengths are compared with the conversion rule in DESIGN.md. Tailwind's 1rem is 16px and the app's 1rem is 10px, so shadcn/ui's `h-9` (36px) is `3.6rem` in the app.
- Colors are not compared by shadcn/ui's values. They are first replaced with ASTAROT tokens through the mapping table below.
- The "Handling" column takes 3 values.
  - Align: a difference that touches neither the other rules of DESIGN.md nor what the user does. It can be aligned without a decision.
  - Decide (D-xx): a difference where whether to align, and how, needs a decision. The number is the one in "Decision items" below.
  - Keep: a difference that is not aligned, because of an app constraint (vanilla-extract, CSP) or a DESIGN.md rule for behavior or readability. Changing it needs a decision.

## Differences that apply across components

### Color token mapping (proposal)

| shadcn/ui | ASTAROT (proposal) | Reason |
|---|---|---|
| `background` | `--vox_canvas` | The ground of the conversation and of settings |
| `foreground` | `--dark_basic_text_color` (DESIGN.md's `text`) | Body text |
| `card`, `popover` | `--vox_surface` | A raised surface. A select field's list opens on the same surface (DESIGN.md) |
| `primary`, `primary-foreground` | `--primary_600_color`, `--vox_on_primary` | The Lilac fill and the Dark Plum text on it |
| `secondary`, `secondary-foreground` | `--vox_surface`, `--dark_200_color` | The kit's `plain` button |
| `muted`, `muted-foreground` | `--dark_850_color`, `--vox_description_text` | Tracks, skeleton placeholders, description text |
| `accent`, `accent-foreground` | `--vox_secondary_hover`, `--dark_basic_text_color` | The fill when the pointer is over a list row or a button |
| `destructive` | `--vox_state_failed` | The failed color |
| `border` | `--vox_border` | Hairlines between regions |
| `input` | `--vox_field_border` for the border; `--vox_surface` for the `bg-input/30` fill | The border and fill of a text field |
| `ring` | `--vox_focus` | The focus ring |

shadcn/ui uses `input` both for a border and for a fill at reduced opacity. The app keeps the border and the fill of a text field as separate tokens, so the mapping splits `input` in two. The mapping table is settled in D-02.

### Sizes and shapes

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Control height | Buttons, text fields and select fields are 4rem (DESIGN.md's 40px). The kit's `compact` is 3.2rem | The default is `h-9` (3.6rem), `sm` is `h-8` (3.2rem) and `lg` is `h-10` (4rem) | Decide (D-03). `compact` is the same height as `sm` |
| Corner radius | Steps of 2, 4, 8 and 12px. `--vox_radius` is 8px. Dialogs and the composer are 12px | `--radius` is 10px. `rounded-md` is 8px, `rounded-lg` 10px, `rounded-xl` 14px, `rounded-sm` 6px and `rounded-xs` 2px. Checkboxes are 4px | `rounded-md` matches. `rounded-xl` is aligned to 12px. `rounded-lg` (10px) and `rounded-sm` (6px) fall exactly halfway between steps, so Decide (D-04) |
| Text size | Steps from 1.2 to 2.4rem | `text-xs` 1.2rem, `text-sm` 1.4rem, `text-base` 1.6rem, `text-lg` 1.8rem | All are on the steps. Align |
| Button text weight | 500 (the kit in #684, the screens' action buttons in #694). Before, form buttons and their copies were 600, and other action buttons were 400 | 500 (`font-medium`) | Aligned. The default UI font (Yu Gothic UI) has no weight-500 face, so whether to keep using 500 is D-38 |
| Shadow | `--vox_shadow_overlay`, only on things that float | `shadow-xs` on text fields and outline buttons, `shadow-sm` on cards, `shadow-md` on lists, `shadow-lg` on dialogs | Decide (D-05). DESIGN.md "Elevation & Depth" says routine forms use no decorative elevation |

### How states are drawn

| State | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Focus | A `.2rem` outline in `--vox_focus`. The kit offsets it `.2rem` outward. Depending on the component, some offset it by `.1rem` to `.3rem`, and some draw it inside (the rail) | The border becomes `ring`, and a 3px shadow of `ring` at 50% is added outside (no offset) | Decide (D-06). Decide after checking whether the 50% ring reaches 3:1 against the ground (the criterion in `brandPalette.test.ts`). The uneven offsets are made even after D-06 |
| Invalid value | The kit's `TextField` and `Select` set `aria-invalid` through `invalid`, and `[aria-invalid='true']` turns the border `--vox_state_failed` | `aria-invalid` turns the border `destructive`. While the field has focus, the ring turns reddish too | The border matches. The ring while focused is D-06 |
| Disabled | The kit, the forms (`VoiceSettings.css.ts`, one rule shared by text fields, select fields and buttons) and the screens' action buttons use opacity .5 (#684, #694; before, the kit used .55, the forms and most buttons .6, and the save and discard buttons on the settings top bar .45). `_Entry` changes only its text color. Checkboxes use a filter that turns them grey. The settings Slider is .5 when `disabled` (#697). Toggles, disclosure buttons and pending indicators stay at .55 to .6 | Opacity .5. Buttons get `pointer-events: none` | Opacity is aligned to .5 (done for the action buttons and the forms). Toggles are handled with D-27 and disclosure buttons with D-26. `_Entry` is D-37. `pointer-events: none` is Decide (D-07): it conflicts with the rule that a disabled switch or feature button gives its reason in a tooltip (DESIGN.md "Layout") |
| Hover and press | Each component picks steps of `dark_*` and `primary_*` | The `accent` fill, or the same color at reduced opacity, as in `primary/90` | Decide (D-08). Reducing opacity differs from the app's way of making colors, which changes only lightness (DESIGN.md "Colors") |
| Open and close motion | `--vox_motion` (220 ms) and `--vox_ease_settle`. A list drops from its field and settles, and its rows follow one another | `fade-in`, `zoom-in-95` and a slide-in from the side it comes from | Decide (D-09). The "Motion" of DESIGN.md decides how a list opens |

### Structure

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Files | Both the kit and the screens' components are `Name.tsx` and `Name.css.ts` (after the migration of TypeScript and styles, #957) | One component is written in one `.tsx` | Keep (vanilla-extract styles go in `.css.ts`). Make every component a `.tsx` and `.css.ts` pair |
| Parts | Dialogs and cards are not split into parts; the code that uses them writes the markup | Parts are exported by name, such as `DialogHeader` and `DialogTitle` | Align. Split into parts when building a new component or replacing one |
| `data-slot` | The kit's components (#684, #691), the `_Entry` text field (#691), the parts of the settings search's InputGroup and the language list's search field, Empty (#695), the tooltip's `tooltip-trigger` and `tooltip-content` (#721) and the kit's Dialog parts (#775). None elsewhere | On every part | Align |
| variant | The kit uses `recipe()` (`tone` and `size` of `button`, `kind` and `mono` of `field`, `layout` of `row`) | `cva()`, exported next to the component, as in `buttonVariants` | The recipes already exist. Export names and variant names are decided per component (D-10 for buttons) |
| ref | The kit takes `ref` as a prop (`forwardRef` is not used) | React 19's `ref` prop | Aligned. After the move to React 19 (#495), its decision 1 (2026-11-21) moved the kit, the settings text fields and the log divider |
| Radix | Only `@radix-ui/react-switch` and `@radix-ui/react-visually-hidden` | Many components are Radix (the combined `radix-ui` package) | The packages stay separate (DESIGN.md). Which components become Radix is decided per component below |
| Icons | The app's SVGs (`@images/*.svg?react`) | lucide-react | Decide (D-11) |
| Joining classes | `clsx` | `cn` (in place of clsx and tailwind-merge) | Keep (tailwind-merge is for Tailwind classes) |

## Differences by component

### Button component

The app: the kit's `Button` (experimental, not used on the screens yet). The screens' buttons are not a component; each screen's styles draw them (`VoiceSettings.css.ts`, the settings and main top bars, `PageLinkButton` in `PagePointer`, `_DownloadButton` and others). Icon-only buttons are also split among `ActionButton`, `reset_button` and `close_button`.

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| variant | `tone`: primary, plain (default), quiet, danger (the roles in DESIGN.md, #474) | `variant`: default, secondary, outline, ghost, destructive, link | Decide (D-10) |
| size | `size`: regular (4rem), compact (3.2rem), icon (a 4rem square, #694) | default (3.6rem), xs, sm (3.2rem), lg (4rem), icon, icon-xs, icon-sm, icon-lg | The height is D-03. The kit got the `icon` size (#694). Merging the screens' icon-only buttons (`ActionButton`, `reset_button`, `close_button`) waits until using the kit on the screens is decided (K-01). Whether to add `icon-sm` and the others is part of D-03 and D-10 |
| Rendering as another element | None (a link that looks like a button draws a separate `<a>`) | `asChild` (Radix's `Slot`) | Decide (D-12) |
| Padding | `.8rem 1.6rem`. With an icon, the sides are 1.2rem, and 1rem at compact (#694) | default is `px-4 py-2` (1.6rem, .8rem), and `px-3` with an icon. sm is `px-3`, and `px-2.5` with an icon | Match. The padding with an icon was aligned (#694) |
| Corner radius | 8px | `rounded-md` (8px) | Match |
| Text | 1.4rem, 500 (the kit in #684, the screens' action buttons in #694). Long Japanese text wraps | `text-sm` (1.4rem), 500, `whitespace-nowrap` | The weight was aligned (the face is D-38). Wrapping is kept (for long Japanese text) |
| primary | Dark Plum text on a Lilac fill. Hover is `primary_550`, press is `primary_700` | `bg-primary`, and `primary/90` on hover | D-08 |
| danger | Red text with no fill and a `--vox_field_border` border | destructive is a red fill (60% in the dark scheme) with white text | D-10 |

### Input and Textarea components

The app: the kit's `TextField` (the `field` recipe), `_Entry` in settings rows and `VoiceSettings.css.ts`, which draws the `input`, `select` and `textarea` inside forms together. The search fields (the settings search, the language filter) and the composer are drawn separately.

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Height | The kit, the forms and `_Entry` are 4rem or more | `h-9` (3.6rem). A textarea is at least 6.4rem (`min-h-16`) | D-03. `_Entry` was aligned to the kit's height (#691) |
| Padding | The kit uses `.8rem 1.2rem`. `_Entry` uses `.6rem` | `px-3 py-1` (1.2rem, .4rem) | The kit's sides match. Top and bottom follow from the height (D-03). `_Entry`'s sides are D-37 |
| Fill | The kit and `_Entry` use `--vox_surface` | Transparent (`input/30` in the dark scheme) | `--vox_surface` (the D-02 proposal). `_Entry` was aligned (#691) |
| Border | The kit and `_Entry` have a `.1rem` border in `--vox_field_border` | A 1px `input` border | `--vox_field_border`. `_Entry` was aligned (#691; its earlier `dark_750` reached only 1.85:1 against its own `dark_875` fill, below DESIGN.md's criterion of 3.5:1) |
| Corner radius | The kit and `_Entry` are 8px | 8px | Match (`_Entry` was aligned in #691) |
| Focus | The kit has the ring and a `primary_600` border. `_Entry` has only the ring around the whole, and a `primary_400` border while it is in use | The border becomes `ring`, with a 3px ring | D-06 |
| Disabled | The kit dims the whole to opacity .5 (#684). `_Entry` only turns its text `dark_500` and uses the same look while pending (`aria-busy`) | Opacity .5, `pointer-events: none` | Decide (D-37) |
| Text | 1.4rem | `text-base` (1.6rem), and `text-sm` (1.4rem) at 768px wide and up | Keep (1.4rem; `text-base` is there to avoid zooming on smartphones) |
| Textarea height | In the forms, at least 8rem, resizable vertically (`resize: vertical`) | Grows with its content through `field-sizing: content` | Decide (D-13). `field-sizing` is not Baseline Widely available |
| Structure | In the kit, `TextField` and `Select` share `Field.css.ts`. There is no textarea | `input.tsx`, `textarea.tsx` and `native-select.tsx` are separate | When a `Textarea` is added to the kit, make it a separate component (Align) |

### Select component

The app: the kit's `Select` (the native `<select>`), `_DropdownMenu`, a hand-built combobox used mainly in settings rows, the forms' native `select` (`appearance: base-select` in WebView2) and the VR panel's `Picker`.

shadcn/ui has two: the Radix Select and NativeSelect, which wraps the native `<select>`. The kit's `Select` corresponds to NativeSelect.

| Aspect | The kit's `Select` | NativeSelect | Handling |
|---|---|---|---|
| Base | A native `<select>` wrapped in a `span`, with an SVG chevron laid over it | A native `<select>` wrapped in a `div`, with a lucide chevron laid over it | Match. The icons are D-11 |
| `data-slot` | `native-select-wrapper`, `native-select`, `native-select-icon` (#684). `native-select-option` and `native-select-optgroup` are on the `SelectOption` and `SelectOptGroup` parts (#691) | `native-select-wrapper`, `native-select`, `native-select-icon`, `native-select-option`, `native-select-optgroup` | Aligned |
| size | None (4rem) | `size`: default (3.6rem), sm (3.2rem) | Part of D-03 and D-10 (the kit's button calls the 3.2rem size `compact`) |
| Right padding and chevron | The right padding is 3.6rem. The chevron is 1.6rem, 1.4rem from the right (#684), in `--vox_secondary_text`. The forms' select fields have the same shape, size and position (#691), and their color is written directly as `#9daec6` in the background image | The right padding is `pr-9` (3.6rem). The chevron is `size-4` (1.6rem), 1.4rem from the right, in `muted-foreground` at 50% | The padding and the chevron's size and position were aligned. The color is D-02 |
| Disabled | The kit dims the whole wrapper to opacity .5 (#684). In the forms' select fields, the chevron is the background image, so it dims with the field, at the forms' shared opacity of .5 (#694) | The whole wrapper at opacity .5 | Aligned |
| Width | The full column (`width: 100%`) | `w-fit` | Keep (the field width rule of DESIGN.md, #567) |
| Color of list rows | The `option` ground is `--vox_surface` | `bg-[Canvas] text-[CanvasText]` (system colors) | Keep (the list opens on the same surface as the field; DESIGN.md "Components") |

The differences between `_DropdownMenu` in settings rows and the Radix Select are as follows.

| Aspect | `_DropdownMenu` | Radix Select | Handling |
|---|---|---|---|
| Base | A hand-built ARIA combobox | Radix Select (Trigger, Content, Item, Group, Label, Separator, ScrollUpButton, ScrollDownButton) | Decide (D-14). Radix Select inserts a `<style>` at run time, so the CSP needs an update (checked in #452). Operating the open list would also change with the OS and with the VR panel's pointer |
| props | `_DropdownMenu` takes `dropdown_id`, `list` (from id to name), `selected_id`, `selectFunction`, `state` (loading), `is_disabled`, `label` and `secondary_label` | `value`, `onValueChange`, child `SelectItem`s, and the Trigger's `size` | Part of D-14 (aligning the props changes every caller) |
| How many can be open | Only one (`dropdown_id` is kept in an atom) | Radix manages it | Part of D-14 |
| Trigger | 4rem, padding `.9rem 1.2rem`, `--vox_surface`, `--vox_field_border`, 8px. On hover the border is `dark_500`, and on press `dark_900` | `h-9` (`h-8` for `sm`), `px-3 py-2`, transparent, an `input` border, 8px, `w-fit`. No hover in the light scheme | The height is D-03, the colors D-02 |
| List | `--vox_surface`, a `dark_600` border, 8px, `--vox_shadow_overlay`, padding .4rem, at most 20rem tall. Opens upward if it does not fit below | `popover`, `border`, 8px, `shadow-md`. The Viewport's padding is `p-1` (.4rem) | The padding matches. The shadow is D-05 |
| Rows | Padding `.8rem 1.2rem`, 4px. `dark_800` on hover and with the keyboard. The selected row has a `dark_900` fill and bold `primary_200` text | `px-2 py-1.5` (.8rem, .6rem), `rounded-sm` (6px), `focus:bg-accent`. The selected row has a check on the right | Decide (D-15). The radius is D-04 |

### Combobox, Command and InputGroup components

The app: the settings search (`SearchBar`; it shows a list of results with `role="combobox"` and highlights the matching words, and each result carries marks for its tab and its prerequisites) and the language list's filter (the `type=search` field in `LanguageSelector`; Enter picks the first candidate). Both are hand-built.

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Base | A hand-built ARIA combobox | Combobox is written with Base UI (`@base-ui/react`), and Command with cmdk. new-york-v4 has no Radix version of either | Decide (D-36). DESIGN.md says to read the Radix version, but these two have none |
| Frame of the search field | In the settings search, the outer element holds a 4rem frame (`--vox_surface`, a `--vox_field_border` border, 8px; aligned in #695 from `dark_875` and `dark_750`), and the text field inside has no border. It has a magnifier icon (1.5rem, left padding .8rem) and a clear button (✕). The text in the field is 1.3rem. On hover the border is `dark_550`, and with focus inside it is `primary_400`. The language list's search field is a single text field with the same fill and border as the text fields | InputGroup (`h-9`, an `input` border; a ring appears when the text field inside has focus; icons and buttons go left or right in `InputGroupAddon`; the icon is `size-4`, the left padding `pl-3`, the text `text-sm`) | The shape matches. The `data-slot` values (`input-group`, `input-group-control`, `input-group-addon`; `input` for the language list) and the fill and border tokens (the D-02 proposal) were aligned (#695). The height is D-03, the ring D-06. The icon size, the left padding and the text size are D-40 |
| Result list | `--vox_surface` (aligned in #695 from `dark_900`), a `dark_750` border, 8px, a shadow. Rows are `dark_800` while hovered and while selected. With no results, Empty (#695) | Command's list is `popover`. Rows are `px-2 py-1.5`, `rounded-sm` and `accent` while selected. Headings are `text-xs` in `muted-foreground`. With no results, CommandEmpty (`py-6 text-center text-sm`) | The ground was aligned (#695). The selected `dark_800` is the same value as `accent` (`--vox_secondary_hover`). The radius is D-04. For no results, see the Empty row below |

### Checkbox component

The app: `Checkbox` in `common_components/checkbox` (it hides the native input and draws a box beside it). Per DESIGN.md (#436), it is the component for turning settings on and off. Inside forms, native checkboxes (`accent-color`) are used.

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Base | The native input | Radix Checkbox (`button role="checkbox"`, `data-state`) | Decide (D-16). With Radix the input goes away, which changes how forms and tests are written |
| props | `label`, `variable` (`state`, `data`), `is_available`, `toggleFunction`, `show_label`, `size`, `borderWidth`, `padding` | `checked`, `onCheckedChange`, `disabled` | Part of D-16 |
| Size | A 2.8rem box, a `.2rem` border, 1.8rem of space around it | `size-4` (1.6rem), a 1px border, a 4px radius | Decide (D-17) |
| Fill when on | A `primary_600` fill with a `--vox_on_primary` (Dark Plum) check (#697; before, `--dark_basic_text_color`, at 3.1:1 against the fill) | A `primary` fill with a `primary-foreground` check | Aligned (#697). It also fits the DESIGN.md rule that text on a Lilac fill is Dark Plum |
| Border | `dark_700` when off, `primary_600` on hover | An `input` border. No hover | D-02, D-08 |
| Pending | Turns the border `primary_800` and shows a spinner and `aria-busy` | None | Keep (an action that waits on the engine shows its pending state as soon as it is pressed; DESIGN.md) |

### RadioGroup component

The app: `RadioButton` (native radio buttons). It also handles options grouped by kind (`groups`).

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Base | Native radio buttons. `role="radiogroup"` is nested, and the buttons share one `name` | Radix RadioGroup (the Root is `grid gap-3`, Item, Indicator) | Decide (D-16). Check whether Radix can keep the rule (DESIGN.md) that the arrow keys move across kinds and Tab stops once |
| Dot | 2rem, a `.3rem` ring in `dark_600`. When selected, a `.6rem` ring in `primary_400` | `size-4` (1.6rem), an `input` border. When selected, a `primary` dot (`size-2`) appears inside, and the border does not change | D-17 |
| Row | Padding `.6rem .8rem`, 4px. `dark_850` on hover | No fill on the row | Part of D-17 |
| Pending | Set to `aria-disabled`, keeping focus | None | Keep (DESIGN.md) |

### Switch component

The app: the kit's `Switch` (Radix), `ToggleSwitch` (a `div` that does not take focus), the main features' `SwitchContainer` (the whole row is `role="switch"`), the VR panel's `ToggleRow` and the tray companion's `switchRow`.

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Size | The kit is 4.4×2.4rem, with a 1.8rem thumb. `ToggleSwitch` is 4×1.6rem (3.6×1.4rem for the main features) | default is 3.2×1.84rem (`w-8 h-[1.15rem]`), with a 1.6rem thumb. `sm` is 2.4×1.4rem | D-17 |
| Edge of the track | When off, `dark_850` with a `--vox_field_border` edge | No edge. When off, `input` (80% in the dark scheme) | Decide (D-18). DESIGN.md gives the track a `field-border` edge to meet 3:1 |
| On state and thumb | On is `primary_600`. The thumb is `dark_300`, and Dark Plum when on | On is `primary`. In the dark scheme, the thumb is `foreground` when off and `primary-foreground` when on | The on color and the thumb when on match. The thumb when off is D-02 |
| size | Not in the kit | `size`: default, sm | Part of D-17 (added once the default size is decided) |
| Base | `ToggleSwitch` is hand-built, and the row (`SwitchContainer`) has `role="switch"` | Radix Switch | Decide (D-19) |

The VR panel is a separate screen drawn on steps in px (DESIGN.md "Typography"), so it is left out of the comparison.

### Slider component

The app: `Slider` in `slider` (a hand-built `role="slider"` with an API like MUI's), the threshold component and the forms' `input[type=range]`. The VR panel uses steppers. The threshold component is only a thumb .4rem wide and 4rem tall laid over the volume meter, and the meter takes the place of the track and the filled part. It is not aligned with the shared Slider. It is left out of the comparison as an app-only component integrated with the meter (D-41, decided 2026-11-19), and is not in the table below.

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Base | Hand-built | Radix Slider (Root, Track, Range, Thumb) | Decide (D-20) |
| props | `variable`, `setterFunction`, `setter_timing`, `debounce_ms`, `min`, `max`, `step`, `marks_step`, `show_label_values`, `orientation`, `valueLabelDisplay`, `valueLabelDisplayLocation`, `valueLabelFormat`, `valueLabelFunction`, `track`, `no_padding` | `value`, `onValueChange`, `min`, `max`, `step`, `orientation` | Part of D-20. shadcn/ui has no value bubble and no tick marks |
| Track | `.6rem`, `dark_825`. The filled part is `primary_600` (#697; before, the track was `.4rem`, and the filled part's color was commented out, so it did not show). The forms' `input[type=range]` has the same shape and paints the track with the value's ratio passed in `--range-fill` (#697) | `h-1.5` (.6rem), `muted`. The filled part (Range) is `primary` | The filled part and the .6rem track were aligned (#697). The track color is D-02 |
| Thumb | 1.8rem, `primary_600`. A faint `.8rem` ring on hover and while dragged | 1.6rem, a white fill (fixed with `bg-white`) with a `primary` border. A 4px `ring/50` on hover and focus | The size is D-17, the ring D-06. The white fill is D-02 |
| Disabled | Opacity .5 with `disabled`. The thumb leaves the tab order, gets `aria-disabled` and does not move with the pointer or the keys (#697; no caller passes it yet). The forms' `input[type=range]` uses the forms' shared .5 (#694) | Opacity .5 | Aligned (#697) |

### Tooltip component

The app: `common_components/tooltip` (it draws its bubble at the end of the page and places it inside the window from the component's position; it has `role="tooltip"` but is not passed to screen readers; the main screen's rail, top bar, title bar and composer and the resend button use it; #766). `Hint` (the bubble for settings descriptions), which came in with #676 and #677. Native `title` attributes in some settings components and in the conversation log. The VR panel's `VrTooltip` (drawn on the Python side).

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Base | `Tooltip` opens on mouse-over and on keyboard focus, and closes on a press and on Escape, Enter or Space (#766). It does not show the same words that are visible on the component. Screen readers get the component's accessible name or a description left in the page (`aria-describedby`). `Hint` opens with CSS hover and `:has(:focus-visible)`, and is read through `aria-describedby` | Radix Tooltip (Provider, Trigger, Content, Arrow; drawn in a portal) | Decide (D-21). ADR-010 names it as a candidate for replacement with Radix |
| Time to open | `Tooltip` waits 0.1 seconds and appears over 0.15 seconds. `Hint` appears in 120 ms | `delayDuration` is 0 | Part of D-21 |
| Look | `Tooltip` and `Hint` share one look (`tooltipContent` in `common_css/mixins.ts`; #721). Light text on a `dark_700` fill, 1.2rem/500, line height 1.6, padding `.6rem 1.2rem`, 8px, as wide as its words up to 36rem, keeping the line breaks in the text. Before, `Tooltip` had padding `.4rem .8rem`, 4px and one line (paragraphs inside it wrapped because of `root.css`, so they broke every few characters within the button's width), and `Hint` had `.8rem 1.2rem`. No arrow | `background` text on a `foreground` fill (the colors inverted), `text-xs` (1.2rem, line height 1.33), no weight set, `px-3 py-1.5` (1.2rem, .6rem), 8px, `text-balance`. Has an arrow | The padding and radius were aligned, and `Tooltip` and `Hint` got one look (#721). The inverted colors and the arrow are Decide (D-22). The text weight, the line height and `text-balance` stay as they are (D-42, decided 2026-11-19) |

### Dialog and AlertDialog components

The app: the native `<dialog>`, opened with `showModal()` (`useConsentDialog.ts`). Its look comes from the `dialog` rules in `VoiceSettings.css.ts` and `LegacyModelDownloadDialog.css.ts`, and `Topbar.tsx`, `Translation.tsx` and `useSettingsDraft.tsx` copy the same look. The quick settings modal (`ModalController.tsx`) is separate. A failed start is a non-modal `<dialog open role="alertdialog">` (`StartupFailedDialog.tsx`).

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Base | The native `<dialog>` | Radix Dialog and AlertDialog (Portal, Overlay, Content, Header, Footer, Title, Description, Close) | Decide (D-23). The native `<dialog>` is Baseline and has focus trapping and Esc. Radix Dialog is likely to insert a `<style>` to stop scrolling, so check its effect on the CSP before adding it |
| Parts | Each screen dialog is written on its own (only the first-run setup dialog (#759) has the parts' `data-slot` values). In the kit, `Dialog` (the counterpart of DialogContent), `DialogHeader`, `DialogFooter`, `DialogTitle` and `DialogDescription` were built on the native `<dialog>` (#775) | Header, Footer, Title, Description | Align. They were built in the kit (#775). The screen dialogs are replaced with these components the next time the dialogs are rebuilt (decision 3 of #764). The details are D-43 |
| Width, padding, spacing | `min(51.2rem, 100vw − 2.4rem)`, padding 2.4rem, 1.6rem between parts. In the consent and confirmation dialogs, the heading and the body paragraphs are one part, and the paragraphs inside it are .8rem apart | `max-w-[calc(100%-2rem)]`, `sm:max-w-lg` (51.2rem), padding `p-6` (2.4rem), gap `gap-4` (1.6rem) | Match (aligned; item 9 of the list) |
| Corner radius | 12px (DESIGN.md's `rounded.dialog`) | `rounded-lg` (10px) | D-04 |
| Ground, border, shadow | A `dark_875` ground, a `.1rem` `dark_600` border, no shadow | A `background` ground, `border`, `shadow-lg` | Decide (D-05, D-02). The dialog ground `dark_875` is among the grounds in DESIGN.md's 3:1 criterion |
| Backdrop | `#00000080` (50% black). The quick settings modal is separate (a pale color and a blur) | `bg-black/50` | Match (aligned; item 9 of the list) |
| Heading | `h3`, 1.8rem | Title is `text-lg` (1.8rem), 600 | Match |
| Button layout | A row of `.actions` | Footer stacks the buttons in reverse order when narrow and aligns them right when wide | Decide (D-24). It has to be weighed against the rules for placing buttons (DESIGN.md, #473) |
| Close button | None (the dialog closes through its action buttons) | An X at the top right (its `sr-only` "Close" is fixed in English) | Part of D-24. If one is added, its text goes in `locales/` |
| AlertDialog | A failed start is not modal | AlertDialog is modal | Keep (a failed start is not modal, so that the title bar stays usable; DESIGN.md) |

### Popover and DropdownMenu components

The app: the quick settings menu (`QuickSettingsMenu`, a panel with `role="group"`) and the color popover (`ColorEntryWithSaveButton`). The translator choice and the log settings open inside the rail.

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Base | Hand-built (closes on Esc, on a press outside and when focus leaves) | Radix Popover, Radix DropdownMenu | Decide (D-25). Quick settings is a group of `aria-pressed` toggles, not a menu (`role="menu"`) |
| Panel | `--vox_surface`, `--vox_border`, 8px, `--vox_shadow_overlay`, padding .4rem | Popover is `w-72` (28.8rem), padding `p-4` (1.6rem), `shadow-md`. DropdownMenu has padding `p-1` (.4rem) and a minimum width of 12.8rem | The padding matches DropdownMenu. The shadow is D-05 |
| Color popover | `dark_950`, 8px, a shadow | Popover (a `popover` ground) | Making the ground `--vox_surface` is Align |

### Collapsible and Accordion components

The app: `SetupSection` and `AdvancedSection` (the native `<details>`, with a state on the summary row) and `Description` (folds everything after the first sentence into "Details"). Other things open with an `aria-expanded` button (`UsagePresetSelector`, "Other features", the word list, the VR panel's `Disclosure`).

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Base | The native `<details>` | Radix Collapsible, Radix Accordion | Decide (D-26). `<details>` is tied to the mechanism that opens it when the settings search finds a row inside |
| Look | The summary row has padding `.8rem 0`, at 1.5rem/600. The state is 1.3rem | Accordion's Trigger is `py-4` (1.6rem), `text-sm` (1.4rem), 500, underlined on hover, with a chevron on the right that turns. A line between items | Part of D-26 |
| Collapsible | — | No look (behavior only) | Whether to move the things that open with an `aria-expanded` button to Radix Collapsible is part of D-26 |

### Tabs, ToggleGroup and Toggle components

The app: the settings menu (a `nav` of buttons with `aria-current="page"`), the preset switcher (`PresetTabSelector`), the translator boxes, mute, the VR panel's `SegmentRow` and `VolumeCheckButton`.

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Settings menu | Navigation that switches pages | Tabs switches panels within the same page | Keep (it moves between pages, so `nav` and `aria-current` fit). In shadcn/ui, the Sidebar's `SidebarMenuButton` (`data-active`) is closer (D-35) |
| Preset switcher | 3 `div role="button"` elements with `aria-pressed`, 2.8rem. The selected one is `dark_750` | ToggleGroup (`type="single"`) or Tabs. The List is `bg-muted` with 3px padding; the selected item has a `background` fill and a shadow | Decide (D-27). Making the `div role="button"` a `button` is Align |
| Buttons that stay pressed | Mute, the translator and the volume check each draw `aria-pressed` themselves | Toggle (an `accent` fill with `data-state="on"`). The variants are default and outline; the sizes are default, sm and lg | Part of D-27. Mute's pressed state is drawn in amber today |

### Card component

The app: `.card` in `VoiceSettings.css.ts` (one model or engine). Its parts are `.card_head` and `.facts` (a `dl`).

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Padding and spacing | Padding `1.2rem 1.6rem` | `py-6` (2.4rem) at the top and bottom, `px-6` (2.4rem) on the parts' sides, `gap-6` (2.4rem) between them | Decide (D-28). Settings pages line up many cards, so the density would change |
| Fill, radius, shadow | No fill, a `.1rem` `dark_800` border, 8px, no shadow | `bg-card`, `border`, `rounded-xl` (14px), `shadow-sm` | Decide (D-05, D-28). DESIGN.md avoids heavy cards and keeps frames for real units, such as one server or engine |
| Parts | `.card_head`, `.facts` | Header, Title, Description, Action, Content, Footer | Making the parts components is Align |

### Badge component

The app: `.badge` in `VoiceSettings` (`data-tone`; outline only, 4px, 1.2rem/500), the top bar's count (a Lilac disc) and mute mark (amber), the marks on settings search results and the default mark.

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Shape | 4px corners, outline only | `rounded-full` (round ends), padding `px-2 py-0.5` (.8rem, .2rem), `text-xs` (1.2rem)/500 | Decide (D-29). Outside the radius steps, DESIGN.md allows only the round ends of bars and tracks |
| variant | 13 kinds of `data-tone` (recommended, in use, connected, ready, downloaded, running, checking, not connected, changed, invalid URL, not found, added by the user (dashed), hardware warning) | default, secondary, destructive, outline, ghost, link | Part of D-29. The app's badges state a state in words, and there are more of them than there are color variants |
| Structure | Classes and `data-tone`. The badges are spread over 5 places | A `Badge` component and `badgeVariants` | Merging them into a `Badge` component is Align (the look stays as it is until D-29 is decided) |

### Alert component

The app: `EnvReadout` (the environment readout), `[role=alert]` in `VoiceSettings`, `.hardware_warning`, `.restriction` and `ChatboxLengthWarning`.

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Environment readout | `--vox_surface`, a 3px line in the state color on the left, 8px, 1.3rem/500, tabular numbers | `rounded-lg`, a border all round, `px-4 py-3` (1.6rem, 1.2rem), `text-sm`, an icon column | Keep (DESIGN.md "Roles in settings" decides the form of the environment readout) |
| variant | `tone`: neutral, active, warning, failed. `live` gives `role="status"` | default, destructive. Always `role="alert"` | Keep (a state is said in words, and the color only repeats them; how strongly screen readers announce it is also chosen per state) |
| Warning boxes | 3 forms: a box with an amber border, an amber rule on the left and a `--vox_warning_tint` fill | One Alert form | Decide (D-30) |

### Separator component

The app: there is no shared component. The hairline to the right of category headings (`--vox_border`), the line under rows in `Templates` (`dark_800`) and the lines between rows in the kit (`--vox_border`) are each in their own CSS. `dark_800` and `--vox_border` have the same value.

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Structure | Each CSS draws its own line | Radix Separator (`decorative` by default, `h-px`, `bg-border`) | Merging them into a `Separator` component is Align. Whether to add the Radix package is D-12 |

### Skeleton, Spinner and Progress components

| Component | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Skeleton | `[data-skeleton]`, drawn by the global style in `MainPage.css.ts`. `--vox_skeleton`, 4px, a slow 1.8-second pulse | A `Skeleton` component, `animate-pulse`, `bg-accent`, 8px | Decide (D-31). DESIGN.md decides that the pulse is slow and faint. Drawing through an attribute, as now, keeps the real component's size until the value arrives |
| Spinner | `loader` in `mixins.ts` (an arc in 2 colors, 0.6 seconds), the SVG `CircularProgress`, the mark in `EnvReadout` | `Spinner` (lucide's `Loader2Icon`, `role="status"`, `aria-label="Loading"` fixed in English) | Merging them into one component is Align. The name read out is not fixed in English; it comes from the text in `locales/` (Keep). The icons are D-11 |
| Progress | The native `<progress>` (.6rem, a `dark_825` track, `primary_500`, round ends), `CircularProgress` | Radix Progress (`h-2` (.8rem), `rounded-full`, a `primary/20` track) | Decide (D-32). A `primary/20` track departs from the way colors are made by changing only lightness |

### Toast component

The app: `SnackbarController` (react-toastify 11). `dark_950`, 8px, a minimum height of 6.4rem, 1.4rem. It has an icon per kind and a `.4rem` line that shows the time left.

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Base | react-toastify | sonner (`Toaster`; it uses `useTheme()` from `next-themes`) | Decide (D-33). It means swapping a dependency. Check whether sonner can keep the placement that stops notices from covering controls (DESIGN.md "Layout") |
| Look | `dark_950` | `popover`, `border`, `--radius` | D-02 |

### Field and Label components

The app: the kit's `SettingGroup` and `SettingRow`, `FormRow`, about 20 kinds of `*Container` in `_templates/Templates.tsx`, `LabelComponent`, `SectionLabelComponent`, `Description` and `Hint`. #676 and #677 increased the number of pages that put descriptions in a bubble (`Hint`).

| Aspect | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Structure | One row component holds the label, the description and the control, and passes `id` and `aria-describedby` to the control (`SettingRow` through a render prop, `FormRow` by cloning its child) | Field, FieldLabel, FieldDescription, FieldError, FieldGroup, FieldSet, FieldLegend, FieldContent, FieldTitle and FieldSeparator are combined. The code that uses them adds the `aria-*` attributes | Decide (D-34). Splitting into parts moves the work of linking the `id` values to the code that uses them |
| Layout | Two columns, the label at 1fr and the control at 1.6fr, 1.6rem apart. They stack when the content is under 42rem wide or the window under 700px (DESIGN.md, #567) | `orientation`: vertical (default), horizontal, responsive | The column widths and the stacking condition are kept (the field width rule of DESIGN.md and `test_settings_fields_follow_the_width_rule`). Whether to rename the kit's `layout` to `orientation` is part of D-34 |
| Label | 1.4rem/500 | Label is `text-sm` (1.4rem), 500 | Match |
| Description | 1.2rem, `--vox_description_text`. On pages that #614 has been applied to, it goes in a bubble | `text-sm` (1.4rem), `muted-foreground` | Keep (a general description in DESIGN.md "Roles in settings" is 1.2rem) |
| Errors | A warning per row (`add_warnings`) | FieldError (`role="alert"`, red text) | Part of D-34 |
| Separation between rows | `Templates` has a line under each row, and the kit a line between rows | No lines (`gap-7`, 2.8rem, between them) | The same question as open question K-03 of the settings screen component experiment |

### Empty and Sidebar components

| Component | ASTAROT | shadcn/ui | Handling |
|---|---|---|---|
| Empty | The empty conversation screen (`EmptyState.tsx`), the dashed frame of experimental features and the search's "no results". The "no results" of the settings search and of the language list are `Empty` and `EmptyDescription` in `common_components` (centered, padding 2.4rem, a 1.4rem sentence in the description color, #695) | Empty (centered, `p-6`, and `md:p-12` at 768px wide and up; Header, Media, Title, Description, Content) | The empty conversation screen is kept (DESIGN.md "Layout" decides where it stands and how it appears). Aligning the other "no results" with the Empty form is Align (the 2 search places were aligned in #695; `md:p-12` is D-39) |
| Sidebar | The main rail (24rem; a 7.2rem icon rail when narrow, and lying over the conversation when narrower still) and the settings rail (5.6rem; it expands on hover and focus) | Sidebar (25.6rem, and 4.8rem with icons only. `collapsible`: offcanvas, icon, none. Ctrl/Cmd+B opens and closes it, and its state is saved in a cookie) | The width and the behavior are kept (DESIGN.md "Layout" decides them; the compact rail preference is saved in the settings). The rail that lies over the conversation in a narrow window is close to Sheet (Radix Dialog), but it is kept too. The height of menu rows and how the selected row is shown are Decide (D-35) |

### Other components

- Kbd: not in the app. A hotkey field shows the keys as text inside the field, such as "Ctrl + Q". Align once there is a place that shows keys.
- ScrollArea: the app draws the scrollbars for the whole page in `root.css`. Radix ScrollArea is likely to insert a `<style>` to hide the native scrollbars, so it is not aligned for now.
- Table: only the table in `GpuCheck`. shadcn/ui's Table does not use Radix, so align it when the table is worked on.
- Item: "What was found" in the first-run setup (#557) is arranged in the Item form (ItemGroup, Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions), with `data-slot` values of the same names. It is not split into components yet (`FirstRunSetupController.css.ts` of the first-run setup). It differs from shadcn/ui in 3 ways. A row's action goes under its description, not at the row's right end, because the descriptions are one or two Japanese sentences: at the right end, the description column became narrow and wrapped to 4 lines. The row's mark (ItemMedia) shows the state with 4 kinds of marks. The rows that need the user come before the other rows, each as a card of its own with an amber rule and tint, and the other rows are gathered, smaller, in one frame. This lets the user tell whether something needs them from placement, shape, size and color before reading any text (DESIGN.md "Components", #614).
- App-only: `FileDropZone`, the companion handle, the VR panel (a separate screen drawn on steps in px), the caption overlay and the threshold component (integrated with the volume meter; D-41). These are left out of the comparison.

## Decision items

The items that have been decided are in [Decisions made](#decisions-made) below. This table is the record of the questions and is not rewritten after a decision.

| ID | Question | Components concerned |
|---|---|---|
| D-01 | Which style of shadcn/ui to align with. `new-york-v4` is now treated as legacy, and the new styles (vega, nova and others) build their classes from CSS that is separate from the Radix components. This document was compared against `new-york-v4` | All |
| D-02 | Whether to settle the color token mapping (the proposal above). In particular `secondary`, `accent`, the `input` fill, the white of the slider thumb and the grounds of toasts and dialogs | All |
| D-03 | Whether to keep the control height at 4rem (shadcn/ui's `lg`) or make it 3.6rem (the default). The front matter of DESIGN.md says 40px | Button, Input, Select |
| D-04 | Whether to move `rounded-lg` (10px) to 8px or 12px, and `rounded-sm` (6px) to 4px or 8px | Dialog, Select rows, Alert, Card |
| D-05 | Whether to add shadows (`shadow-xs` on text fields and outline buttons, `shadow-sm` on cards, `shadow-md` on lists, `shadow-lg` on dialogs). DESIGN.md uses no decorative shadows in routine forms | Button, Input, Select, Card, Dialog, Popover |
| D-06 | Whether to keep the focus ring as a `.2rem` line offset outward, or use shadcn/ui's 3px `ring/50`. The latter only after checking 3:1 | Every control |
| D-07 | Whether to give disabled buttons `pointer-events: none`. It conflicts with the rule that a tooltip gives the reason a control is disabled | Button |
| D-08 | Whether the hover and press colors are steps with a different lightness (now) or a reduced opacity (`/90`, `/80`) | Button, Checkbox |
| D-09 | Whether the open and close motion is the current "drop and settle" or shadcn/ui's `fade` and `zoom-in-95` | Select, Popover, Dialog, Tooltip |
| D-10 | The names of the button variants and how they map. The roles of #474 (primary, plain, quiet, danger) and those of shadcn/ui (default, secondary, outline, ghost, destructive, link). shadcn/ui's destructive is a red fill, and the app's danger has no fill | Button |
| D-11 | Whether to add lucide-react for icons or keep the app's SVGs | Select, Checkbox, Spinner, Dialog |
| D-12 | Whether to add Radix packages for the look (Slot, Separator, Label). If they are added, record them in the license register and `NOTICE.md` | Button, Separator, Field |
| D-13 | Whether to use `field-sizing: content` (not Baseline Widely available) on textareas, with feature detection and a fallback | Textarea |
| D-14 | Whether to make the select field of settings rows (`_DropdownMenu`, a hand-built combobox) match NativeSelect (the kit's `Select`) or make it the Radix Select. Radix Select needs a CSP update, and operating the open list changes with the OS and with the VR panel's pointer (K-05) | Select |
| D-15 | Whether a list's selected row is shown by color and weight (now) or by a check on the right (shadcn/ui) | Select |
| D-16 | Whether checkboxes and radio buttons are based on the native input (now) or on Radix | Checkbox, RadioGroup |
| D-17 | The size of small controls: checkbox from 2.8rem to 1.6rem, radio button from 2rem to 1.6rem, switch from 4.4×2.4rem to 3.2×1.84rem, slider thumb from 1.8rem to 1.6rem. Decide together with whether the whole row is the area that can be pressed | Checkbox, RadioGroup, Switch, Slider |
| D-18 | Whether to remove the edge of the switch track. If it is removed, meet the 3:1 of DESIGN.md another way | Switch |
| D-19 | Whether to rebuild the main features' switches (the whole row is `role="switch"`) with Radix Switch | Switch |
| D-20 | Whether to replace the slider with Radix Slider. shadcn/ui has no value bubble and no tick marks | Slider |
| D-21 | Whether to replace tooltips with Radix Tooltip. Whether to include the `title` attributes and `Hint`. What the delay before opening should be. The main screen's `title` attributes were replaced with `common_components/tooltip` in #766 (not Radix) | Tooltip |
| D-22 | Whether to invert the tooltip colors (dark text on a light ground) and add an arrow | Tooltip |
| D-23 | Whether to keep the native `<dialog>` as the base of dialogs or use Radix Dialog (CSP) | Dialog |
| D-24 | Whether to take in the dialog button layout (stacked when narrow, aligned right when wide) and the close button at the top right | Dialog |
| D-25 | Whether the quick settings menu becomes a Popover or a DropdownMenu | Popover, DropdownMenu |
| D-26 | Whether to keep `<details>` as the base of folds or use Radix Collapsible or Accordion. Which look to align with | Collapsible, Accordion |
| D-27 | Whether to make the preset switcher and the buttons that stay pressed ToggleGroup and Toggle (Radix) | ToggleGroup, Toggle |
| D-28 | Whether to make the padding and spacing of cards 2.4rem and to align their fill and radius | Card |
| D-29 | Whether badges get round ends. How to cut the variants | Badge |
| D-30 | Whether to merge the 3 warning looks into the one Alert form | Alert |
| D-31 | Whether to make the skeleton placeholders a `Skeleton` component | Skeleton |
| D-32 | Whether to make the track of progress bars `primary/20` | Progress |
| D-33 | Whether to replace react-toastify with sonner for toasts | Toast |
| D-34 | Whether to split settings rows into Field parts. Where `id` and `aria-describedby` are linked, the name `orientation` and how errors are shown | Field |
| D-35 | Whether to align the row height of the rail menus (`h-8`) and how the selected row is shown (`data-active`) | Sidebar, settings menu |
| D-36 | Whether to make the settings search and the language list Combobox (Base UI) or Command (cmdk), or keep them hand-built and align only the look. Neither has a Radix version | Combobox, Command |
| D-37 | What to do about the differences left between `_Entry` and the kit. The padding on each side is .6rem, while the kit and DESIGN.md's `input` use 1.2rem. At 1.2rem, the room for text in the 6rem-wide threshold field shrinks from 4.6rem to 3.4rem. The disabled state changes only the text color, while the kit dims the whole to .5. The pending state uses the same look, so decide this together with how pending is shown (DESIGN.md) | Input |
| D-38 | Whether to keep button text at 500. The default UI font, Yu Gothic UI, and the selectable Meiryo UI have no weight-500 face, and CSS font matching is expected to draw them at 400 (not checked on Windows). Form buttons went from 600 to 500, so in those fonts their bold text becomes the regular weight | Button |
| D-39 | Whether to take in Empty's padding for wide screens (`md:p-12`, 4.8rem). shadcn/ui widens it from 2.4rem to 4.8rem at window widths of 768px and up. The app's Empty opens inside a search result list or the language list, so it stayed at 2.4rem | Empty |
| D-40 | Whether to align the inside of the settings search field with InputGroup. The magnifier icon is 1.5rem, smaller than `size-4` (1.6rem); the left padding is .8rem, narrower than `pl-3` (1.2rem); and the text is 1.3rem, smaller than the text fields' 1.4rem. In a wide window the search field is 17.6rem, the width of the settings rail (20.8rem) minus the padding on both sides, and larger text would fit fewer characters | Combobox, InputGroup |
| D-41 | Whether to align the threshold component (a thin thumb laid over the volume meter) with Slider, or leave it out of the comparison as an app-only component integrated with the meter. If it is aligned, also decide how to handle the thumb's shape (.4rem wide, 4rem tall) and the meter's colors | Slider |
| D-42 | Whether to align the details of tooltip text. The app uses weight 500 and line height 1.6; shadcn/ui sets no weight (400), `text-xs` has line height 1.33 and `text-balance` evens out the length of the lines. `Hint` shows descriptions of several lines, so its line height was matched to DESIGN.md's 1.6 for descriptions | Tooltip |
| D-43 | Whether the details of the kit's Dialog parts follow shadcn/ui or the screen dialogs. The kit does the following. DialogHeader keeps its text aligned left even when narrow (shadcn/ui centers it under 640px wide). DialogTitle has line height 1.4 (shadcn/ui uses `leading-none`), and its heading is `h2` (the same as Radix; the screen dialogs use `h3`). DialogDescription is in the description text color (`--vox_description_text`, the counterpart of `muted-foreground`; the first-run setup dialog uses `--vox_secondary_text`). The width goes up to 3.2rem narrower than the window (shadcn/ui's `calc(100%-2rem)`; the screens' shared frame is 2.4rem) | Dialog |

The decision items of #680 (aligning with shadcn/ui itself, a note on section 7 of ADR-010, the scope of the license records) and open question K-01 of the settings screen component experiment (whether to adopt the kit) also bear on this inventory.

## Decisions made

These are the decision items above that have been decided.

| ID | Decision | Date decided | Applied to the documents and the implementation |
|---|---|---|---|
| D-41 | The threshold component (a thin thumb laid over the volume meter) is not aligned with the shared Slider. It is left out of the comparison as an app-only component integrated with the meter | 2026-11-19 | The implementation does not change. The Slider section and "Other components" say it is out of the comparison |
| D-42 | The details of tooltip text stay as they are: weight 500, line height 1.6 and no `text-balance`. `Hint` shows descriptions of several lines, so it keeps DESIGN.md's line height of 1.6 for descriptions | 2026-11-19 | The values in the implementation do not change (`tooltipContent` in `common_css/mixins.ts`, as of #721). The decision is written as a comment next to those values. It is also written in the "Look" row of the Tooltip section and in the note on item 10 of the list |

## Differences that can be aligned without a decision

These are the differences marked "Align" in the tables above.

The kit (components not used on the screens yet):

1. Add `data-slot` to the parts of `Button`, `TextField`, `Select` and `Switch`. The names follow the shadcn/ui components (button, input, native-select, switch) (#684; the `option` and `optgroup` parts of `Select` in #691).
2. Make `Select` match NativeSelect. The chevron is 1.6rem and sits 1.4rem from the right, and when disabled, the whole wrapper is dimmed (#684).
3. Set the text weight of `Button` to 500 and the opacity of its disabled state to .5 (#684).

Components used on the screens:

4. Make button text weight 500 and the opacity of the disabled state .5. The forms' `:disabled` (`VoiceSettings.css.ts`) is a rule shared with text fields and select fields, so they become .5 too (#694. This covers action buttons that have words and a fill or border. Toggles, disclosure buttons, navigation, list rows, pending indicators and the screens out of the comparison are not included).
5. Make the checkbox's check `--vox_on_primary` (#697).
6. Draw the slider's filled part, make the track .6rem and add a disabled state (#697; the shared `Slider` and the forms' `input[type=range]`. The threshold component is out of the comparison. D-41).
7. Make the fill, border, radius and height of `_Entry` match the kit's text field (#691; the padding on each side and the disabled state are D-37).
8. Make the ground of the color popover and of the settings search's result list `--vox_surface` (the settings search's result list in #695; the color popover is still to do).
9. Make the spacing in dialogs 1.6rem, their maximum width 51.2rem and the backdrop 50% black. Build components for the dialog parts (Header, Footer, Title, Description). The spacing and the maximum width were matched in every dialog except the quick settings modal and the failed start (the first-run setup (#557) in #759, the others under decision item 4 of #759). In the consent and confirmation dialogs, where the heading and the body paragraphs had sat side by side as flat siblings, they were gathered into one part (`.dialog_text` in `VoiceSettings.css.ts`; for the translation license confirmation, `.license_text` in `Translation.css.ts`), and the paragraphs inside it kept .8rem between them. Only the first-run setup dialog carries the parts' `data-slot` values. The backdrop was made 50% black in every dialog except the quick settings modal (under decision item 2 of #764). The part components replace the dialogs all at once, the next time the dialogs are rebuilt (under decision item 3 of #764).
10. Align the padding and radius of tooltips, and give `Tooltip` and `Hint` one look (#721; the text details stay as they are. D-42).
11. Make the preset switcher's `div role="button"` a `button`.
12. Merge `Separator`, `Badge` and `Spinner` each into one component (the look stays as it is).
13. Align the search's "no results" with the Empty form (the settings search and the language list in #695; the `Empty` component was built in `common_components`).
14. Give the chevron of the forms' select fields the same shape, size and position as the kit's `Select` (#691; the color is D-02).

Kit differences that the tables marked "Align" but this list had missed:

15. Add the `icon` size for icon-only buttons to `Button` (#694; the height is D-03).
16. Make the padding on each side of a `Button` with an icon 1.2rem (`px-3`) at regular and 1rem (sm's `px-2.5`) at compact (#694).

Screen differences that the tables marked "Align" but this list had missed:

17. Use the text field tokens (`--vox_surface`, `--vox_field_border`) for the fill and border of the settings search field, and add InputGroup's `data-slot`. Add Input's `data-slot` to the language list's search field (#695).

Kit differences (the Dialog section; of screen item 9, the part components are built in the kit first):

18. Build the Dialog parts (Dialog, DialogHeader, DialogFooter, DialogTitle, DialogDescription) in the kit with `data-slot`, and put them on the sample page (#775. The screen dialogs are replaced at the next rebuild, as decision 3 of #764 says. The details are D-43).

## Proposed stages

1. Stage 1: align the kit (1 to 3 above; 15 and 16, which the list had missed, were aligned in #694). The kit is not used on the screens yet, so the screens do not change. Since this is the first PR that aligns a component, it records shadcn/ui in the license register and `NOTICE.md` (#680).
2. Stage 2: the differences in look in components used on the screens that need no decision (4 to 14 and 17 above). One PR per component.
3. Stage 3: the decision items, as each is decided. Replacements with Radix (D-14, D-16, D-19 to D-21, D-23, D-25 to D-27) follow the order in ADR-010 (components whose accessibility is hard to keep when hand-built come first). For components that touch the CSP, check whether they insert a `<style>` before adding them.
4. Settings rows (D-34) are done together with the rebuild of the settings screen in the information architecture of #554.
5. Replacing the screens' hand-built elements with shared components goes component by component, after the move of styles to vanilla-extract (#957) (H-01 of the [inventory of hand-built components](hand-built-inventory.md)). Elements with no component to receive them (U-01 to U-12 in the same document: Command, Combobox, Toggle, ToggleGroup, Popover, Progress, Textarea, option cards, Item, Card, Badge, in-row confirmation, row lists, AlertDialog) are all added to the kit as shared components. The ones that have related decision items (D-13, D-16, D-23, D-25, D-27, D-28, D-29, D-32, D-36, D-40) are built after those items are decided (H-02 in the same document).

---

# 部品の棚卸し: shadcn/ui との照合（日本語版）

アプリの部品を shadcn/ui の部品と照らし合わせ、差分を一覧にした文書です。DESIGN.md の「Components」の節にある、部品を shadcn/ui に寄せる方針（#680）を進めるための下調べです。棚卸しの時点では、部品のコードを変えていませんでした。その後に寄せた差は、表の「扱い」の列に PR の番号を添えて「寄せた」と書いています。

- 状態: 棚卸し（2026-11-19）。寄せる作業は、判断の要らない差と、下の判断項目が決まった差から、段階的に PR にします。段 1（kit）は #684、段 2 のうち Select と入力欄は #691、ボタンは #694、検索欄は #695、チェックボックスとスライダーは #697、ツールチップは #721、Dialog のパーツは kit に #775 で寄せました。
- 照合した shadcn/ui: [shadcn-ui/ui](https://github.com/shadcn-ui/ui) の `apps/v4/registry/new-york-v4/ui/`（`main` のコミット `968d8cb9dc`、2026-11-17）。MIT ライセンスです。どのスタイルに寄せるかは D-01 で決めます。
- 照合したアプリ: develop（#676 と #677 のマージ後）
- 関係する文書: [設定画面の部品の実験](README.md)（#452、`src-ui/views/kit/`）、[ADR-010](../../adr/adr-010-frontend-stack.md)、[手作りの部品の棚卸し](hand-built-inventory.md)（共通の部品を使わずに画面ごとに作っている箇所の一覧、2026-11-23）

## 読み方

- 長さは DESIGN.md の読み替えの規則で比べます。Tailwind の 1rem は 16px、アプリの 1rem は 10px なので、shadcn/ui の `h-9`（36px）はアプリの `3.6rem` です。
- 色は shadcn/ui の値を使わず、下の対応表で ASTAROT のトークンに置き換えて比べます。
- 「扱い」の列は次の3つです。
  - 寄せる: DESIGN.md のほかの規則にも利用者の操作にも触れない差です。判断なしで寄せられます。
  - 判断（D-xx）: 寄せるかどうか、どう寄せるかに判断が要る差です。番号は下の「判断項目」の番号です。
  - 残す: アプリの制約（vanilla-extract、CSP）か、振る舞いや読みやすさのための DESIGN.md の規則で、寄せない差です。変えるなら判断が要ります。

## 全体にかかわる差

### 色のトークンの対応（案）

| shadcn/ui | ASTAROT（案） | 根拠 |
|---|---|---|
| `background` | `--vox_canvas` | 会話と設定の地 |
| `foreground` | `--dark_basic_text_color`（DESIGN.md の `text`） | 本文の文字 |
| `card`、`popover` | `--vox_surface` | 一段上がった面。選択欄の一覧も同じ面に開く（DESIGN.md） |
| `primary`、`primary-foreground` | `--primary_600_color`、`--vox_on_primary` | Lilac の塗りと、その上の Dark Plum の文字 |
| `secondary`、`secondary-foreground` | `--vox_surface`、`--dark_200_color` | kit の `plain` のボタン |
| `muted`、`muted-foreground` | `--dark_850_color`、`--vox_description_text` | 溝、骨組みの表示、説明の文字 |
| `accent`、`accent-foreground` | `--vox_secondary_hover`、`--dark_basic_text_color` | 一覧の行やボタンにポインタを載せたときの塗り |
| `destructive` | `--vox_state_failed` | 失敗の色 |
| `border` | `--vox_border` | 領域の間の細い線 |
| `input` | 枠は `--vox_field_border`、`bg-input/30` の塗りは `--vox_surface` | 入力欄の枠と塗り |
| `ring` | `--vox_focus` | フォーカスの輪 |

shadcn/ui は `input` を枠にも、薄めた塗りにも使います。アプリは入力欄の枠と塗りを別のトークンにしているので、2つに分けました。対応表は D-02 で確定します。

### 寸法と形

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 操作の高さ | ボタン、入力欄、選択欄は 4rem（DESIGN.md の 40px）。kit の `compact` は 3.2rem | 既定は `h-9`（3.6rem）、`sm` は `h-8`（3.2rem）、`lg` は `h-10`（4rem） | 判断（D-03）。`compact` は `sm` と同じ高さ |
| 角丸 | 2、4、8、12px の段。`--vox_radius` は 8px。ダイアログとメッセージの入力欄は 12px | `--radius` は 10px。`rounded-md` は 8px、`rounded-lg` は 10px、`rounded-xl` は 14px、`rounded-sm` は 6px、`rounded-xs` は 2px。チェックボックスは 4px | `rounded-md` は一致。`rounded-xl` は 12px に寄せる。`rounded-lg`（10px）と `rounded-sm`（6px）は段のちょうど中間なので判断（D-04） |
| 文字の大きさ | 1.2〜2.4rem の段 | `text-xs` 1.2rem、`text-sm` 1.4rem、`text-base` 1.6rem、`text-lg` 1.8rem | どれも段の上にある。寄せる |
| ボタンの文字の太さ | 500（kit は #684、画面の操作のボタンは #694）。前は、フォームのボタンとその写しが 600、ほかの操作のボタンが 400 だった | 500（`font-medium`） | 寄せた。既定の UI フォント（Yu Gothic UI）には 500 の字面がないので、500 をそのまま使うかは D-38 |
| 影 | 浮かぶものにだけ `--vox_shadow_overlay` | 入力欄と outline のボタンに `shadow-xs`、カードに `shadow-sm`、一覧に `shadow-md`、ダイアログに `shadow-lg` | 判断（D-05）。DESIGN.md「Elevation & Depth」は、普段のフォームに飾りの影を使わないとしている |

### 状態の表し方

| 状態 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| フォーカス | `--vox_focus` の `.2rem` の outline。kit は外に `.2rem` 離す。部品によって `.1rem`〜`.3rem` 離すもの、内側に引くもの（レール）がある | 枠が `ring` になり、外に 3px の `ring` の 50% の影が付く（離さない） | 判断（D-06）。50% の輪が地に対して 3:1 に届くか（`brandPalette.test.ts` の基準）を確かめてから決める。離す量の不ぞろいは D-06 のあとでそろえる |
| 値が正しくない | kit の `TextField` と `Select` は `invalid` で `aria-invalid` を付け、`[aria-invalid='true']` で枠を `--vox_state_failed` にする | `aria-invalid` で枠が `destructive` になる。フォーカス中は輪も赤みを帯びる | 枠は一致。フォーカス中の輪は D-06 |
| 使えない | kit、フォーム（`VoiceSettings.css.ts`。入力欄、選択欄、ボタンに共通の規則）、画面の操作のボタンは不透明度 .5（#684、#694。前は kit が .55、フォームと多くのボタンが .6、設定の上のバーの保存と取り消しが .45）。`_Entry` は文字の色だけを変える。チェックボックスは灰色にする filter。設定の Slider は `disabled` で .5（#697）。トグル、開閉のボタン、待ちの表示は .55〜.6 のまま | 不透明度 .5。ボタンは `pointer-events: none` | 不透明度は .5 に寄せる（操作のボタンとフォームは寄せた）。トグルは D-27、開閉のボタンは D-26 と一緒に扱う。`_Entry` は D-37。`pointer-events: none` は判断（D-07）。使えないスイッチや機能のボタンがツールチップで理由を示す規則（DESIGN.md「Layout」）とぶつかる |
| ホバーと押下 | 部品ごとに `dark_*` と `primary_*` の段を選ぶ | `accent` の塗り、または `primary/90` のように同じ色を薄める | 判断（D-08）。不透明度で薄める作り方は、明度だけを変えるアプリの色の作り方（DESIGN.md「Colors」）と違う |
| 開閉の動き | `--vox_motion`（220ms）と `--vox_ease_settle`。一覧は欄から落ちて落ち着き、行が続いて現れる | `fade-in`、`zoom-in-95`、出る向きからの slide-in | 判断（D-09）。DESIGN.md の「Motion」が一覧の開き方を決めている |

### 構造

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| ファイル | kit も画面の部品も `Name.tsx` と `Name.css.ts`（TypeScript とスタイルの移行（#957）のあと） | 1つの部品を1つの `.tsx` に書く | 残す（vanilla-extract のスタイルは `.css.ts` に置く）。`.tsx` と `.css.ts` の組にそろえる |
| パーツ | ダイアログやカードはパーツに分けず、使う側がマークアップを書く | `DialogHeader`、`DialogTitle` のように、パーツを名前付きで export する | 寄せる。新しく作るときと置き換えるときにパーツに分ける |
| `data-slot` | kit の部品（#684、#691）、`_Entry` の入力欄（#691）、設定の検索の InputGroup のパーツと言語の一覧の検索欄、Empty（#695）、ツールチップの `tooltip-trigger` と `tooltip-content`（#721）、kit の Dialog のパーツ（#775）。ほかはなし | すべてのパーツに付ける | 寄せる |
| variant | kit は `recipe()`（`button` の `tone` と `size`、`field` の `kind` と `mono`、`row` の `layout`） | `cva()`。`buttonVariants` のように部品の隣で export する | recipe は既にある。export の名前と variant の名前は、部品ごとの判断（ボタンは D-10）で決める |
| ref | kit は `ref` を props で受け取る（`forwardRef` は使わない） | React 19 の `ref` の props | 寄せた。React 19 に上げたあと（#495）、その判断 1（2026-11-21）で kit、設定の入力欄、ログの区切りを移した |
| Radix | `@radix-ui/react-switch` と `@radix-ui/react-visually-hidden` だけ | 多くの部品が Radix（統合パッケージの `radix-ui`） | パッケージは個別のまま（DESIGN.md）。どの部品を Radix にするかは、下の部品ごとの判断で決める |
| アイコン | アプリの SVG（`@images/*.svg?react`） | lucide-react | 判断（D-11） |
| クラスの結合 | `clsx` | `cn`（clsx と tailwind-merge の代わり） | 残す（tailwind-merge は Tailwind のクラスのためのもの） |

## 部品ごとの差

### Button

アプリ: kit の `Button`（実験で、画面ではまだ使っていない）。画面のボタンは部品になっておらず、画面ごとのスタイルが描いています（`VoiceSettings.css.ts`、設定とメインの上のバー、`PagePointer` の `PageLinkButton`、`_DownloadButton` など）。アイコンだけのボタンも `ActionButton`、`reset_button`、`close_button` に分かれています。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| variant | `tone`: primary、plain（既定）、quiet、danger（DESIGN.md #474 の役割） | `variant`: default、secondary、outline、ghost、destructive、link | 判断（D-10） |
| size | `size`: regular（4rem）、compact（3.2rem）、icon（4rem の正方形、#694） | default（3.6rem）、xs、sm（3.2rem）、lg（4rem）、icon、icon-xs、icon-sm、icon-lg | 高さは D-03。kit に `icon` の size を足した（#694）。画面のアイコンだけのボタン（`ActionButton`、`reset_button`、`close_button`）をまとめるのは、kit を画面で使うと決めてから（K-01）。`icon-sm` などを足すかは D-03 と D-10 に含める |
| 別の要素で描く | なし（リンクのボタンは `<a>` を別に描く） | `asChild`（Radix の `Slot`） | 判断（D-12） |
| 余白 | `.8rem 1.6rem`。アイコンがあると左右は 1.2rem、compact では 1rem（#694） | default は `px-4 py-2`（1.6rem、.8rem）。アイコンがあると `px-3`。sm は `px-3`、アイコンがあると `px-2.5` | 一致。アイコン付きの余白は寄せた（#694） |
| 角丸 | 8px | `rounded-md`（8px） | 一致 |
| 文字 | 1.4rem、500（kit は #684、画面の操作のボタンは #694）。長い日本語は折り返す | `text-sm`（1.4rem）、500、`whitespace-nowrap` | 太さは寄せた（字面は D-38）。折り返しは残す（長い日本語の表示） |
| primary | Lilac の塗りに Dark Plum の文字。ホバーは `primary_550`、押下は `primary_700` | `bg-primary`、ホバーは `primary/90` | D-08 |
| danger | 塗らずに赤い文字と `--vox_field_border` の枠 | destructive は赤の塗り（暗い配色では 60%）に白い文字 | D-10 |

### Input と Textarea

アプリ: kit の `TextField`（`field` の recipe）、設定の行の `_Entry`、フォームの中の `input`、`select`、`textarea` をまとめて描く `VoiceSettings.css.ts`。検索欄（設定の検索、言語の絞り込み）とメッセージの入力欄は別に描いています。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 高さ | kit、フォーム、`_Entry` は 4rem 以上 | `h-9`（3.6rem）。textarea は最小 6.4rem（`min-h-16`） | D-03。`_Entry` は kit の高さに寄せた（#691） |
| 余白 | kit は `.8rem 1.2rem`。`_Entry` は `.6rem` | `px-3 py-1`（1.2rem、.4rem） | kit の左右は一致。上下は高さで決まる（D-03）。`_Entry` の左右は D-37 |
| 塗り | kit と `_Entry` は `--vox_surface` | 透明（暗い配色では `input/30`） | `--vox_surface`（D-02 の案）。`_Entry` は寄せた（#691） |
| 枠 | kit と `_Entry` は `.1rem` の `--vox_field_border` | 1px の `input` | `--vox_field_border`。`_Entry` は寄せた（#691。前の `dark_750` は自分の塗りの `dark_875` に対して 1.85:1 で、DESIGN.md の基準の 3.5:1 に届いていなかった） |
| 角丸 | kit と `_Entry` は 8px | 8px | 一致（`_Entry` は #691 で寄せた） |
| フォーカス | kit は輪と `primary_600` の枠。`_Entry` は全体の輪だけで、使っている間は `primary_400` の枠 | 枠が `ring`、3px の輪 | D-06 |
| 使えない | kit は全体を不透明度 .5 にする（#684）。`_Entry` は文字を `dark_500` にするだけで、待ち（`aria-busy`）のときも同じ見た目を使う | 不透明度 .5、`pointer-events: none` | 判断（D-37） |
| 文字 | 1.4rem | `text-base`（1.6rem）、幅 768px 以上で `text-sm`（1.4rem） | 残す（1.4rem。`text-base` はスマートフォンでの拡大を避けるためのもの） |
| textarea の高さ | フォームは最小 8rem、縦に伸ばせる（`resize: vertical`） | `field-sizing: content` で中身に合わせて伸びる | 判断（D-13）。`field-sizing` は Baseline Widely available ではない |
| 構造 | kit は `TextField` と `Select` が `Field.css.ts` を分け合う。textarea はない | `input.tsx`、`textarea.tsx`、`native-select.tsx` が別 | kit に `Textarea` を足すときは別の部品にする（寄せる） |

### Select

アプリ: kit の `Select`（ネイティブの `<select>`）、設定の行で主に使う自作の combobox の `_DropdownMenu`、フォームのネイティブの `select`（WebView2 では `appearance: base-select`）、VR パネルの `Picker`。

shadcn/ui には、Radix の Select と、ネイティブの `<select>` を包む NativeSelect の2つがあります。kit の `Select` は NativeSelect に当たります。

| 観点 | kit の `Select` | NativeSelect | 扱い |
|---|---|---|---|
| 土台 | ネイティブの `<select>` を `span` で包み、SVG のシェブロンを重ねる | ネイティブの `<select>` を `div` で包み、lucide のシェブロンを重ねる | 一致。アイコンは D-11 |
| `data-slot` | `native-select-wrapper`、`native-select`、`native-select-icon`（#684）。`native-select-option` と `native-select-optgroup` は `SelectOption` と `SelectOptGroup` のパーツに付けた（#691） | `native-select-wrapper`、`native-select`、`native-select-icon`、`native-select-option`、`native-select-optgroup` | 寄せた |
| size | なし（4rem） | `size`: default（3.6rem）、sm（3.2rem） | D-03 と D-10 に含める（kit のボタンは 3.2rem の大きさを `compact` と呼んでいる） |
| 右の余白とシェブロン | 右の余白は 3.6rem。シェブロンは 1.6rem で右から 1.4rem（#684）、`--vox_secondary_text`。フォームの選択欄も同じ形、大きさ、位置（#691）で、色は背景の画像に `#9daec6` を直に書いている | 右の余白は `pr-9`（3.6rem）。シェブロンは `size-4`（1.6rem）で右から 1.4rem、`muted-foreground` の 50% | 余白、シェブロンの大きさと位置は寄せた。色は D-02 |
| 使えない | kit は包む要素ごと不透明度 .5（#684）。フォームの選択欄はシェブロンが背景の画像なので一緒に薄くなり、不透明度はフォームに共通の .5（#694） | 包む要素ごと不透明度 .5 | 寄せた |
| 幅 | 列いっぱい（`width: 100%`） | `w-fit` | 残す（DESIGN.md の欄の幅の規則、#567） |
| 一覧の行の色 | `option` の地を `--vox_surface` にする | `bg-[Canvas] text-[CanvasText]`（システムの色） | 残す（一覧は欄と同じ面に開く。DESIGN.md「Components」） |

設定の行の `_DropdownMenu` と Radix Select の差は次のとおりです。

| 観点 | `_DropdownMenu` | Radix Select | 扱い |
|---|---|---|---|
| 土台 | 自作の ARIA combobox | Radix Select（Trigger、Content、Item、Group、Label、Separator、ScrollUpButton、ScrollDownButton） | 判断（D-14）。Radix Select は実行時に `<style>` を差し込むので、CSP の更新が要る（#452 で確認）。開いた一覧の操作も、OS と VR パネルのポインタで変わる |
| props | `_DropdownMenu` は `dropdown_id`、`list`（id から名前）、`selected_id`、`selectFunction`、`state`（読み込み中）、`is_disabled`、`label`、`secondary_label` | `value`、`onValueChange`、子の `SelectItem`、Trigger の `size` | D-14 に含める（props を寄せると、呼ぶ側がすべて変わる） |
| 開いている数 | 1つだけ（`dropdown_id` を atom に持つ） | Radix が管理する | D-14 に含める |
| トリガー | 4rem、余白 `.9rem 1.2rem`、`--vox_surface`、`--vox_field_border`、8px。ホバーで枠が `dark_500`、押下で `dark_900` | `h-9`（`sm` は `h-8`）、`px-3 py-2`、透明、`input` の枠、8px、`w-fit`。明るい配色ではホバーなし | 高さは D-03、色は D-02 |
| 一覧 | `--vox_surface`、`dark_600` の枠、8px、`--vox_shadow_overlay`、余白 .4rem、高さは最大 20rem。下に入らなければ上に開く | `popover`、`border`、8px、`shadow-md`。Viewport の余白は `p-1`（.4rem） | 余白は一致。影は D-05 |
| 行 | 余白 `.8rem 1.2rem`、4px。ホバーとキーボードで `dark_800`。選んだ行は `dark_900` の塗りと太い `primary_200` の文字 | `px-2 py-1.5`（.8rem、.6rem）、`rounded-sm`（6px）、`focus:bg-accent`。選んだ行は右にチェック | 判断（D-15）。角丸は D-04 |

### Combobox、Command、InputGroup

アプリ: 設定の検索（`SearchBar`。`role="combobox"` で結果の一覧を出し、一致した語を強調する。結果にはタブと前提の印が付く）と、言語の一覧の絞り込み（`LanguageSelector` の `type=search` の欄。Enter で最初の候補を選ぶ）。どちらも自作です。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | 自作の ARIA combobox | Combobox は Base UI（`@base-ui/react`）、Command は cmdk で書かれている。new-york-v4 には、どちらも Radix で書いたものがない | 判断（D-36）。DESIGN.md は Radix で書いたものを読むとしているが、この2つにはそれがない |
| 検索欄の枠 | 設定の検索は、外側の要素が 4rem の枠（`--vox_surface`、`--vox_field_border` の枠、8px。#695 で `dark_875` と `dark_750` から寄せた）を持ち、中の入力欄は枠なし。虫眼鏡のアイコン（1.5rem、左の余白 .8rem）と消すボタン（✕）がある。入力欄の文字は 1.3rem。ホバーで枠が `dark_550`、中にフォーカスがあると `primary_400`。言語の一覧の検索欄は、塗りと枠が入力欄と同じ1つの入力欄 | InputGroup（`h-9`、`input` の枠。中の入力欄にフォーカスがあると輪が付く。アイコンやボタンは `InputGroupAddon` で左右に置く。アイコンは `size-4`、左の余白は `pl-3`、文字は `text-sm`） | 形は一致。`data-slot`（`input-group`、`input-group-control`、`input-group-addon`。言語の一覧は `input`）と、塗りと枠のトークン（D-02 の案）は寄せた（#695）。高さは D-03、輪は D-06。アイコンの大きさ、左の余白、文字の大きさは D-40 |
| 結果の一覧 | `--vox_surface`（#695 で `dark_900` から寄せた）、`dark_750` の枠、8px、影。行はホバー中と選択中に `dark_800`。結果がないときは Empty（#695） | Command の一覧は `popover`。行は `px-2 py-1.5`、`rounded-sm`、選択中は `accent`。見出しは `text-xs` の `muted-foreground`。結果がないときは CommandEmpty（`py-6 text-center text-sm`） | 地は寄せた（#695）。選択中の `dark_800` は `accent`（`--vox_secondary_hover`）と同じ値。角丸は D-04。結果がないときは下の Empty の行 |

### Checkbox

アプリ: `common_components/checkbox` の `Checkbox`（ネイティブの input を見えなくして隣に箱を描く）。DESIGN.md（#436）で、設定のオンとオフに使う部品です。フォームの中はネイティブのチェックボックス（`accent-color`）です。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | ネイティブの input | Radix Checkbox（`button role="checkbox"`、`data-state`） | 判断（D-16）。Radix にすると input がなくなり、フォームと試験の書き方が変わる |
| props | `label`、`variable`（`state`、`data`）、`is_available`、`toggleFunction`、`show_label`、`size`、`borderWidth`、`padding` | `checked`、`onCheckedChange`、`disabled` | D-16 に含める |
| 大きさ | 2.8rem の箱、`.2rem` の枠、まわりの余白 1.8rem | `size-4`（1.6rem）、1px の枠、4px の角丸 | 判断（D-17） |
| オンの塗り | `primary_600` の塗りに、`--vox_on_primary`（Dark Plum）のチェック（#697。前は `--dark_basic_text_color` で、塗りに対して 3.1:1） | `primary` の塗りに `primary-foreground` のチェック | 寄せた（#697）。Lilac の塗りの上は Dark Plum という DESIGN.md の規則とも合う |
| 枠 | オフは `dark_700`、ホバーで `primary_600` | `input` の枠。ホバーなし | D-02、D-08 |
| 待ち | 枠を `primary_800` にし、スピナーと `aria-busy` を出す | なし | 残す（エンジンを待つ操作は、押した直後に待ちの状態を示す。DESIGN.md） |

### RadioGroup

アプリ: `RadioButton`（ネイティブのラジオ）。種類ごとにまとめた選択肢（`groups`）も扱います。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | ネイティブの radio。`role="radiogroup"` を入れ子にし、`name` を共有する | Radix RadioGroup（Root は `grid gap-3`、Item、Indicator） | 判断（D-16）。種類をまたいで矢印キーで動き、Tab で1回だけ止まる規則（DESIGN.md）を Radix で保てるかを確かめる |
| 点 | 2rem、`dark_600` の `.3rem` の輪。選ぶと `primary_400` の `.6rem` の輪 | `size-4`（1.6rem）、`input` の枠。選ぶと中に `primary` の点（`size-2`）が付き、枠は変わらない | D-17 |
| 行 | 余白 `.6rem .8rem`、4px。ホバーで `dark_850` | 行の塗りなし | D-17 に含める |
| 待ち | `aria-disabled` にして、フォーカスは残す | なし | 残す（DESIGN.md） |

### Switch

アプリ: kit の `Switch`（Radix）、`ToggleSwitch`（フォーカスを受けない `div`）、メインの機能の `SwitchContainer`（行全体が `role="switch"`）、VR パネルの `ToggleRow`、トレイのコンパニオンの `switchRow`。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 大きさ | kit は 4.4×2.4rem、つまみ 1.8rem。`ToggleSwitch` は 4×1.6rem（メインの機能では 3.6×1.4rem） | default は 3.2×1.84rem（`w-8 h-[1.15rem]`）、つまみ 1.6rem。`sm` は 2.4×1.4rem | D-17 |
| 溝の縁 | オフは `dark_850` に `--vox_field_border` の縁 | 縁なし。オフは `input`（暗い配色では 80%） | 判断（D-18）。DESIGN.md は溝の縁を `field-border` にして 3:1 を満たしている |
| オンとつまみ | オンは `primary_600`。つまみは `dark_300`、オンで Dark Plum | オンは `primary`。つまみは暗い配色で、オフが `foreground`、オンが `primary-foreground` | オンの色とオンのつまみは一致。オフのつまみは D-02 |
| size | kit にはない | `size`: default、sm | D-17 に含める（既定の大きさが決まってから足す） |
| 土台 | `ToggleSwitch` は自作で、行（`SwitchContainer`）が `role="switch"` を持つ | Radix Switch | 判断（D-19） |

VR パネルは px の段で描く別の画面（DESIGN.md「Typography」）なので、照合の外にしました。

### Slider

アプリ: `slider` の `Slider`（自作の `role="slider"`、MUI に似た API）、しきい値の部品、フォームの `input[type=range]`。VR パネルはステッパーです。しきい値の部品は、音量のメーターに幅 .4rem、高さ 4rem のつまみだけを重ねたもので、溝と満ちた部分の代わりにメーターがあります。共通の Slider には寄せず、メーターと一体のアプリだけの部品として照合の外にしました（D-41、2026-11-19 に決定）。下の表には入れていません。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | 自作 | Radix Slider（Root、Track、Range、Thumb） | 判断（D-20） |
| props | `variable`、`setterFunction`、`setter_timing`、`debounce_ms`、`min`、`max`、`step`、`marks_step`、`show_label_values`、`orientation`、`valueLabelDisplay`、`valueLabelDisplayLocation`、`valueLabelFormat`、`valueLabelFunction`、`track`、`no_padding` | `value`、`onValueChange`、`min`、`max`、`step`、`orientation` | D-20 に含める。値の吹き出しと目盛りは shadcn/ui にない |
| 溝 | `.6rem`、`dark_825`。満ちた部分は `primary_600`（#697。前は `.4rem` で、満ちた部分の色はコメントアウトされていて見えなかった）。フォームの `input[type=range]` も同じ形で、値の割合を `--range-fill` で渡して溝に塗る（#697） | `h-1.5`（.6rem）、`muted`。満ちた部分（Range）は `primary` | 満ちた部分と溝の .6rem は寄せた（#697）。溝の色は D-02 |
| つまみ | 1.8rem、`primary_600`。ホバーとドラッグで `.8rem` の薄い輪 | 1.6rem、白の塗り（`bg-white` で固定）に `primary` の枠。ホバーとフォーカスで 4px の `ring/50` | 大きさは D-17、輪は D-06。白の塗りは D-02 |
| 使えない | `disabled` で不透明度 .5。つまみはタブの順から外れて `aria-disabled` になり、ポインタとキーで動かない（#697。まだ渡している箇所はない）。フォームの `input[type=range]` はフォーム共通の .5（#694） | 不透明度 .5 | 寄せた（#697） |

### Tooltip

アプリ: `common_components/tooltip`（吹き出しはページの末尾に描き、部品の位置からウィンドウの中に置く。`role="tooltip"` を持つが、読み上げには渡さない。メインの画面のレール、上のバー、タイトルバー、入力欄と、再送のボタンが使う。#766）。#676 と #677 で入った `Hint`（設定の説明の吹き出し）。設定の一部の部品と会話のログにあるネイティブの `title` 属性。VR パネルの `VrTooltip`（Python 側が描く）。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | `Tooltip` は、マウスを重ねたときとキーボードのフォーカスで開き、押したときと Escape、Enter、Space で閉じる（#766）。部品に見えている言葉と同じ文は出さない。読み上げは、部品の名前か、ページに残した説明（`aria-describedby`）が受け持つ。`Hint` は CSS の hover と `:has(:focus-visible)` で開き、`aria-describedby` で読まれる | Radix Tooltip（Provider、Trigger、Content、Arrow。ポータルに描く） | 判断（D-21）。ADR-010 が Radix に置き換える候補に挙げている部品 |
| 開くまで | `Tooltip` は .1 秒待って .15 秒で現れる。`Hint` は 120ms で現れる | `delayDuration` は 0 | D-21 に含める |
| 見た目 | `Tooltip` と `Hint` は1つの見た目（`common_css/mixins.ts` の `tooltipContent`。#721）。`dark_700` の塗りに明るい文字、1.2rem/500、行の高さ 1.6、余白 `.6rem 1.2rem`、8px、言葉の幅で最大 36rem、文の改行を保つ。前は `Tooltip` が余白 `.4rem .8rem` と 4px の1行（中の段落は `root.css` で折り返すので、ボタンの幅の中で数文字ずつに折れていた）、`Hint` が `.8rem 1.2rem`。矢印なし | `foreground` の塗りに `background` の文字（色が反転）、`text-xs`（1.2rem、行の高さ 1.33）、太さの指定なし、`px-3 py-1.5`（1.2rem、.6rem）、8px、`text-balance`。矢印あり | 余白と角丸は寄せ、`Tooltip` と `Hint` の見た目を1つにした（#721）。色の反転と矢印は判断（D-22）。文字の太さ、行の高さ、`text-balance` は今のまま（D-42、2026-11-19 に決定） |

### Dialog と AlertDialog

アプリ: ネイティブの `<dialog>` を `showModal()` で開きます（`useConsentDialog.ts`）。見た目は `VoiceSettings.css.ts` と `LegacyModelDownloadDialog.css.ts` の `dialog` の規則で決まり、`Topbar.tsx`、`Translation.tsx`、`useSettingsDraft.tsx` が同じ見た目を写しています。クイック設定のモーダル（`ModalController.tsx`）は別です。起動の失敗は、モーダルでない `<dialog open role="alertdialog">`（`StartupFailedDialog.tsx`）です。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | ネイティブの `<dialog>` | Radix Dialog と AlertDialog（Portal、Overlay、Content、Header、Footer、Title、Description、Close） | 判断（D-23）。ネイティブの `<dialog>` は Baseline で、フォーカスの閉じ込めと Esc を持つ。Radix Dialog はスクロールを止めるために `<style>` を差し込む見込みがあり、入れる前に CSP への影響を確かめる |
| パーツ | 画面のダイアログは、ダイアログごとに書く（初期設定のダイアログ（#759）だけが、パーツの `data-slot` を持つ）。kit に `Dialog`（DialogContent に当たる）、`DialogHeader`、`DialogFooter`、`DialogTitle`、`DialogDescription` を、ネイティブの `<dialog>` の上に作った（#775） | Header、Footer、Title、Description | 寄せる。kit には作った（#775）。画面のダイアログをこの部品に置き換えるのは、次にダイアログを作り直すとき（#764 の決定 3）。細部は D-43 |
| 幅、余白、間 | `min(51.2rem, 100vw − 2.4rem)`、余白 2.4rem、部品の間 1.6rem。同意と確認のダイアログでは、見出しと本文の段落が1つの部品で、その中の段落の間は .8rem | `max-w-[calc(100%-2rem)]`、`sm:max-w-lg`（51.2rem）、余白 `p-6`（2.4rem）、間 `gap-4`（1.6rem） | 一致（寄せた。一覧の 9） |
| 角丸 | 12px（DESIGN.md の `rounded.dialog`） | `rounded-lg`（10px） | D-04 |
| 地、枠、影 | `dark_875` の地、`dark_600` の `.1rem` の枠、影なし | `background` の地、`border`、`shadow-lg` | 判断（D-05、D-02）。ダイアログの地 `dark_875` は、DESIGN.md の 3:1 の基準に入っている |
| 背景 | `#00000080`（50% の黒）。クイック設定のモーダルは別（淡い色とぼかし） | `bg-black/50` | 一致（寄せた。一覧の 9） |
| 見出し | `h3`、1.8rem | Title は `text-lg`（1.8rem）、600 | 一致 |
| ボタンの並び | `.actions` の行 | Footer は狭いと縦に逆順、広いと右寄せ | 判断（D-24）。ボタンの置き方（DESIGN.md #473）とのかね合い |
| 閉じるボタン | なし（操作のボタンで閉じる） | 右上の X（`sr-only` の "Close" は英語で固定） | D-24 に含める。足すなら文言は `locales/` に置く |
| AlertDialog | 起動の失敗はモーダルにしない | AlertDialog はモーダル | 残す（起動の失敗は、タイトルバーを使えるようにモーダルにしない。DESIGN.md） |

### Popover と DropdownMenu

アプリ: クイック設定のメニュー（`QuickSettingsMenu`、`role="group"` のパネル）と、色を選ぶポップオーバー（`ColorEntryWithSaveButton`）。翻訳エンジンの選択とログの設定は、レールの中で開きます。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | 自作（Esc、外を押す、フォーカスが外に出ると閉じる） | Radix Popover、Radix DropdownMenu | 判断（D-25）。クイック設定は `aria-pressed` のトグルの集まりで、メニュー（`role="menu"`）ではない |
| パネル | `--vox_surface`、`--vox_border`、8px、`--vox_shadow_overlay`、余白 .4rem | Popover は `w-72`（28.8rem）、余白 `p-4`（1.6rem）、`shadow-md`。DropdownMenu は余白 `p-1`（.4rem）、最小幅 12.8rem | DropdownMenu とは余白が一致。影は D-05 |
| 色のポップオーバー | `dark_950`、8px、影 | Popover（`popover` の地） | 地を `--vox_surface` にするのは寄せる |

### Collapsible と Accordion

アプリ: `SetupSection` と `AdvancedSection`（ネイティブの `<details>`。要約の行に状態を出す）、`Description`（最初の文のあとを「詳細」に畳む）。ほかに `aria-expanded` のボタンで開くもの（`UsagePresetSelector`、「ほかの機能」、単語の一覧、VR パネルの `Disclosure`）があります。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | ネイティブの `<details>` | Radix Collapsible、Radix Accordion | 判断（D-26）。`<details>` は、設定の検索で行を見つけたときに開く仕組みとつながっている |
| 見た目 | 要約の行は余白 `.8rem 0`、1.5rem/600。状態は 1.3rem | Accordion の Trigger は `py-4`（1.6rem）、`text-sm`（1.4rem）、500、ホバーで下線、右に回るシェブロン。項目の間に線 | D-26 に含める |
| Collapsible | — | 見た目なし（振る舞いだけ） | `aria-expanded` のボタンで開くものを Radix Collapsible にそろえるかは D-26 に含める |

### Tabs、ToggleGroup、Toggle

アプリ: 設定のメニュー（`aria-current="page"` のボタンを並べた `nav`）、プリセットの切り替え（`PresetTabSelector`）、翻訳エンジンの箱、ミュート、VR パネルの `SegmentRow`、`VolumeCheckButton`。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 設定のメニュー | ページを切り替えるナビゲーション | Tabs は同じページの中のパネルを切り替える | 残す（ページの移動なので、`nav` と `aria-current` が合う）。shadcn/ui では Sidebar の `SidebarMenuButton`（`data-active`）が近い（D-35） |
| プリセットの切り替え | 3つの `div role="button"` に `aria-pressed`、2.8rem。選んだものは `dark_750` | ToggleGroup（`type="single"`）か Tabs。List は `bg-muted` で余白 3px、選んだものは `background` の塗りと影 | 判断（D-27）。`div role="button"` を `button` にするのは寄せる |
| 押したままのボタン | ミュート、翻訳エンジン、音量の確認が、それぞれ `aria-pressed` を自分で描く | Toggle（`data-state="on"` で `accent` の塗り）。variant は default、outline。size は default、sm、lg | D-27 に含める。ミュートの押した状態は、今は琥珀色で描いている |

### Card

アプリ: `VoiceSettings.css.ts` の `.card`（1つのモデルやエンジン）。パーツは `.card_head` と `.facts`（`dl`）です。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 余白と間 | 余白 `1.2rem 1.6rem` | 上下 `py-6`（2.4rem）、パーツの左右 `px-6`（2.4rem）、間 `gap-6`（2.4rem） | 判断（D-28）。設定のページに多く並ぶので、詰まり具合が変わる |
| 塗り、角丸、影 | 塗りなし、`dark_800` の `.1rem` の枠、8px、影なし | `bg-card`、`border`、`rounded-xl`（14px）、`shadow-sm` | 判断（D-05、D-28）。DESIGN.md は重いカードを使わず、枠は1つのサーバーやエンジンのような実際の単位にだけ使うとしている |
| パーツ | `.card_head`、`.facts` | Header、Title、Description、Action、Content、Footer | パーツの部品を作るのは寄せる |

### Badge

アプリ: `VoiceSettings` の `.badge`（`data-tone`。枠だけ、4px、1.2rem/500）、上のバーの数（Lilac の丸）とミュートの印（琥珀色）、設定の検索の結果の印、既定の印。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 形 | 4px の角、枠だけ | `rounded-full`（丸い端）、余白 `px-2 py-0.5`（.8rem、.2rem）、`text-xs`（1.2rem）/500 | 判断（D-29）。DESIGN.md は、角丸の段の外に棒と溝の丸い端だけを認めている |
| variant | `data-tone` が13種類（推奨、使用中、接続済み、準備完了、取得済み、動作中、確認中、未接続、変更あり、URL が正しくない、見つからない、自分で足したもの（点線）、ハードウェアの注意） | default、secondary、destructive、outline、ghost、link | D-29 に含める。アプリの印は状態を言葉で示すもので、色の variant より数が多い |
| 構造 | クラスと `data-tone`。印が5か所に分かれている | `Badge` 部品と `badgeVariants` | `Badge` 部品にまとめるのは寄せる（見た目は D-29 が決まるまで今のまま） |

### Alert

アプリ: `EnvReadout`（環境の読み出し）、`VoiceSettings` の `[role=alert]`、`.hardware_warning`、`.restriction`、`ChatboxLengthWarning`。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 環境の読み出し | `--vox_surface`、左に 3px の状態の色の線、8px、1.3rem/500、等幅の数字 | `rounded-lg`、全体の枠、`px-4 py-3`（1.6rem、1.2rem）、`text-sm`、アイコンの列 | 残す（DESIGN.md「Roles in settings」が環境の読み出しの形を決めている） |
| variant | `tone`: neutral、active、warning、failed。`live` で `role="status"` | default、destructive。常に `role="alert"` | 残す（状態は言葉で示し、色は言葉を繰り返すだけ。読み上げの強さも状態ごとに選んでいる） |
| 注意の箱 | 琥珀色の枠の箱、琥珀色の左の線、`--vox_warning_tint` の塗りの3通り | Alert の1つの形 | 判断（D-30） |

### Separator

アプリ: 共通の部品はありません。大見出しの右の細い線（`--vox_border`）、`Templates` の行の下の線（`dark_800`）、kit の行の間の線（`--vox_border`）がそれぞれの CSS にあります。`dark_800` と `--vox_border` は同じ値です。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 構造 | 線をそれぞれの CSS で描く | Radix Separator（既定で `decorative`、`h-px`、`bg-border`） | `Separator` 部品にまとめるのは寄せる。Radix のパッケージを足すかは D-12 |

### Skeleton、Spinner、Progress

| 部品 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| Skeleton | `[data-skeleton]` を `MainPage.css.ts` の全体のスタイルで描く。`--vox_skeleton`、4px、1.8 秒のゆっくりした明滅 | `Skeleton` 部品、`animate-pulse`、`bg-accent`、8px | 判断（D-31）。DESIGN.md は明滅をゆっくり薄くと決めている。属性で描く今の形は、値が届くまで実際の部品の大きさを保つためのもの |
| Spinner | `mixins.ts` の `loader`（2色の弧、0.6 秒）、SVG の `CircularProgress`、`EnvReadout` の印 | `Spinner`（lucide の `Loader2Icon`、`role="status"`、`aria-label="Loading"` は英語で固定） | 1つの部品にまとめるのは寄せる。読み上げる名前は英語で固定せず、`locales/` の文言にする（残す）。アイコンは D-11 |
| Progress | ネイティブの `<progress>`（.6rem、`dark_825` の溝、`primary_500`、丸い端）、`CircularProgress` | Radix Progress（`h-2`（.8rem）、`rounded-full`、溝は `primary/20`） | 判断（D-32）。溝の `primary/20` は、明度だけを変える色の作り方から外れる |

### Toast

アプリ: `SnackbarController`（react-toastify 11）。`dark_950`、8px、最小の高さ 6.4rem、1.4rem。種類ごとのアイコンと、`.4rem` の残り時間の線があります。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 土台 | react-toastify | sonner（`Toaster`。`next-themes` の `useTheme()` を使う） | 判断（D-33）。依存の入れ替えになる。通知が操作を覆わない置き方（DESIGN.md「Layout」）を sonner で保てるかを確かめる |
| 見た目 | `dark_950` | `popover`、`border`、`--radius` | D-02 |

### Field と Label

アプリ: kit の `SettingGroup` と `SettingRow`、`FormRow`、`_templates/Templates.tsx` の約20種類の `*Container`、`LabelComponent`、`SectionLabelComponent`、`Description`、`Hint`。#676 と #677 で、説明を吹き出し（`Hint`）に入れるページが増えました。

| 観点 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| 構造 | 名前、説明、操作する部品を1つの行の部品にまとめ、`id` と `aria-describedby` を操作する部品に渡す（`SettingRow` は render prop、`FormRow` は子を複製する） | Field、FieldLabel、FieldDescription、FieldError、FieldGroup、FieldSet、FieldLegend、FieldContent、FieldTitle、FieldSeparator を組み合わせる。`aria-*` は使う側が付ける | 判断（D-34）。パーツに分けると、`id` を結び付ける仕事が使う側に移る |
| 並び | 名前 1fr と操作 1.6fr の2列、間 1.6rem。内容の幅が 42rem 未満か、ウィンドウが 700px 未満で縦に積む（DESIGN.md #567） | `orientation`: vertical（既定）、horizontal、responsive | 列の幅と積む条件は残す（DESIGN.md の欄の幅の規則と `test_settings_fields_follow_the_width_rule`）。kit の `layout` を `orientation` の名前にするかは D-34 に含める |
| 名前 | 1.4rem/500 | Label は `text-sm`（1.4rem）、500 | 一致 |
| 説明 | 1.2rem、`--vox_description_text`。#614 を当てたページでは吹き出しに入れる | `text-sm`（1.4rem）、`muted-foreground` | 残す（DESIGN.md「Roles in settings」の一般的な説明は 1.2rem） |
| エラー | 行ごとの注意（`add_warnings`） | FieldError（`role="alert"`、赤い文字） | D-34 に含める |
| 行の区切り | `Templates` は行の下の線、kit は行の間の線 | 線なし（間 `gap-7`、2.8rem） | 設定画面の部品の実験の残課題 K-03 と同じ問い |

### Empty と Sidebar

| 部品 | ASTAROT | shadcn/ui | 扱い |
|---|---|---|---|
| Empty | 会話の空の画面（`EmptyState.tsx`）、試験的な機能の点線の枠、検索の「結果なし」。設定の検索と言語の一覧の「結果なし」は、`common_components` の `Empty` と `EmptyDescription`（中央寄せ、余白 2.4rem、1.4rem の説明の色の文、#695） | Empty（中央寄せ、`p-6`、幅 768px 以上で `md:p-12`、Header、Media、Title、Description、Content） | 会話の空の画面は残す（DESIGN.md「Layout」が位置と出し方を決めている）。ほかの「結果なし」を Empty の形にそろえるのは寄せる（検索の2か所は #695 で寄せた。`md:p-12` は D-39） |
| Sidebar | メインのレール（24rem。狭いと 7.2rem のアイコンのレール、さらに狭いと会話に重なる）と設定のレール（5.6rem。ホバーとフォーカスで広がる） | Sidebar（25.6rem、アイコンだけで 4.8rem。`collapsible`: offcanvas、icon、none。Ctrl/Cmd+B で開閉し、状態を Cookie に保存） | 幅と振る舞いは残す（DESIGN.md「Layout」が決めている。小さいレールの好みは設定に保存する）。狭いウィンドウで会話に重なるレールは Sheet（Radix Dialog）に近いが、これも残す。メニューの行の高さと選んだ行の表し方は判断（D-35） |

### そのほか

- Kbd: アプリにありません。ホットキーの欄は、入力欄の中に「Ctrl + Q」のように文字で出しています。キーを示す場所ができたら寄せます。
- ScrollArea: アプリは `root.css` でスクロールバーを全体に描いています。Radix ScrollArea はネイティブのスクロールバーを隠すために `<style>` を差し込む見込みがあるので、今は寄せません。
- Table: `GpuCheck` の表だけです。shadcn/ui の Table は Radix を使わないので、表に手を入れるときに寄せます。
- Item: 初期設定（#557）の「いまの状態」を、Item の形（ItemGroup、Item、ItemMedia、ItemContent、ItemTitle、ItemDescription、ItemActions）にそろえ、同じ名前の `data-slot` を付けました。部品にはまだ分けていません（初期設定の `FirstRunSetupController.css.ts`）。shadcn/ui との違いは3つです。行の操作は、行の右端ではなく説明の下に置きます。説明が1〜2文の日本語で、右端に置くと説明の列が狭くなり、4行に折り返したためです。行の印（ItemMedia）は、状態を4通りの印で示します。対応が要る行は、ほかの行の前に、琥珀色の線と地を持つ1枚ずつのカードとして置き、ほかの行は1つの枠の中に小さくまとめます。文を読む前に、配置と形と大きさと色で対応が要るかが分かるようにするためです（DESIGN.md「Components」、#614）。
- アプリだけのもの: `FileDropZone`、コンパニオンの取っ手、VR パネル（px の段で描く別の画面）、字幕のオーバーレイ、しきい値の部品（音量のメーターと一体。D-41）。照合の外にしました。

## 判断項目

決まった項目は、下の[決まった判断](#決まった判断)にあります。この表は問いの記録として、決まったあとも書き換えません。

| ID | 問い | 関係する部品 |
|---|---|---|
| D-01 | shadcn/ui のどのスタイルに寄せるか。`new-york-v4` はいまは legacy の扱いで、新しいスタイル（vega、nova など）は Radix の部品とは別の CSS からクラスを組み立てる。この文書は `new-york-v4` で照合した | すべて |
| D-02 | 色のトークンの対応表（上の案）を確定するか。特に `secondary`、`accent`、`input` の塗り、スライダーのつまみの白、トーストとダイアログの地 | すべて |
| D-03 | 操作の高さを 4rem（shadcn/ui の `lg`）のままにするか、3.6rem（既定）にするか。DESIGN.md の front matter は 40px | Button、Input、Select |
| D-04 | `rounded-lg`（10px）を 8px と 12px のどちらに、`rounded-sm`（6px）を 4px と 8px のどちらに寄せるか | Dialog、Select の行、Alert、Card |
| D-05 | 影を足すか（入力欄と outline のボタンに `shadow-xs`、カードに `shadow-sm`、一覧に `shadow-md`、ダイアログに `shadow-lg`）。DESIGN.md は普段のフォームに飾りの影を使わない | Button、Input、Select、Card、Dialog、Popover |
| D-06 | フォーカスの輪を、外に離した `.2rem` の線のままにするか、shadcn/ui の 3px の `ring/50` にするか。後者は 3:1 を確かめてから | すべての操作する部品 |
| D-07 | 使えないボタンに `pointer-events: none` を付けるか。使えない理由をツールチップで示す規則とぶつかる | Button |
| D-08 | ホバーと押下の色を、明度を変えた段（今）にするか、不透明度（`/90`、`/80`）にするか | Button、Checkbox |
| D-09 | 開閉の動きを、今の「落ちて落ち着く」にするか、shadcn/ui の `fade` と `zoom-in-95` にするか | Select、Popover、Dialog、Tooltip |
| D-10 | ボタンの variant の名前と対応。#474 の役割（primary、plain、quiet、danger）と shadcn/ui（default、secondary、outline、ghost、destructive、link）。shadcn/ui の destructive は赤の塗りで、アプリの danger は塗らない | Button |
| D-11 | アイコンに lucide-react を足すか、アプリの SVG のままにするか | Select、Checkbox、Spinner、Dialog |
| D-12 | 見た目のための Radix のパッケージ（Slot、Separator、Label）を足すか。足すならライセンス台帳と `NOTICE.md` に載せる | Button、Separator、Field |
| D-13 | textarea に `field-sizing: content`（Baseline Widely available ではない）を、機能の検出と代わりの表示を付けて使うか | Textarea |
| D-14 | 設定の行の選択欄（自作の combobox の `_DropdownMenu`）を、NativeSelect（kit の `Select`）にそろえるか、Radix Select にするか。Radix Select は CSP の更新が要り、開いた一覧の操作が OS と VR パネルのポインタで変わる（K-05） | Select |
| D-15 | 一覧の選んだ行を、色と太さ（今）で示すか、右のチェック（shadcn/ui）で示すか | Select |
| D-16 | チェックボックスとラジオの土台を、ネイティブの input（今）にするか、Radix にするか | Checkbox、RadioGroup |
| D-17 | 小さい操作部品の大きさ。チェックボックス 2.8rem から 1.6rem、ラジオ 2rem から 1.6rem、スイッチ 4.4×2.4rem から 3.2×1.84rem、スライダーのつまみ 1.8rem から 1.6rem。押せる範囲を行全体にするかとあわせて決める | Checkbox、RadioGroup、Switch、Slider |
| D-18 | スイッチの溝の縁をなくすか。なくすなら、DESIGN.md の 3:1 を別の形で満たす | Switch |
| D-19 | メインの機能のスイッチ（行全体が `role="switch"`）を Radix Switch で作り直すか | Switch |
| D-20 | スライダーを Radix Slider に置き換えるか。値の吹き出しと目盛りは shadcn/ui にない | Slider |
| D-21 | ツールチップを Radix Tooltip に置き換えるか。`title` 属性と `Hint` も含めるか。開くまでの待ち時間をどうするか。メインの画面の `title` 属性は、#766 で `common_components/tooltip` に替えた（Radix ではない） | Tooltip |
| D-22 | ツールチップの色を反転（明るい地に暗い文字）させ、矢印を付けるか | Tooltip |
| D-23 | ダイアログの土台を、ネイティブの `<dialog>` のままにするか、Radix Dialog にするか（CSP） | Dialog |
| D-24 | ダイアログのボタンの並び（狭いと縦、広いと右寄せ）と、右上の閉じるボタンを取り入れるか | Dialog |
| D-25 | クイック設定のメニューを、Popover にするか DropdownMenu にするか | Popover、DropdownMenu |
| D-26 | 畳みの土台を `<details>` のままにするか、Radix Collapsible や Accordion にするか。見た目をどちらに寄せるか | Collapsible、Accordion |
| D-27 | プリセットの切り替えと押したままのボタンを、ToggleGroup と Toggle（Radix）にするか | ToggleGroup、Toggle |
| D-28 | カードの余白と間を 2.4rem にし、塗りと角丸を寄せるか | Card |
| D-29 | 印（Badge）の形を丸い端にするか。variant をどう切るか | Badge |
| D-30 | 注意の見た目（3通り）を Alert の1つの形にそろえるか | Alert |
| D-31 | 骨組みの表示を `Skeleton` 部品にするか | Skeleton |
| D-32 | 進み具合の溝を `primary/20` にするか | Progress |
| D-33 | トーストを react-toastify から sonner に替えるか | Toast |
| D-34 | 設定の行を Field のパーツに分けるか。`id` と `aria-describedby` を結び付ける場所、`orientation` の名前、エラーの出し方 | Field |
| D-35 | レールのメニューの行の高さ（`h-8`）と、選んだ行の表し方（`data-active`）を寄せるか | Sidebar、設定のメニュー |
| D-36 | 設定の検索と言語の一覧を、Combobox（Base UI）や Command（cmdk）にするか、自作のまま見た目だけを寄せるか。どちらにも Radix で書いたものがない | Combobox、Command |
| D-37 | `_Entry` に残った kit との差をどうするか。左右の余白は .6rem で、kit と DESIGN.md の `input` は 1.2rem。1.2rem にすると、幅 6rem のしきい値の欄では文字の入る幅が 4.6rem から 3.4rem に減る。使えない状態は文字の色だけを変え、kit は全体を .5 に薄くする。待ちの状態も同じ見た目を使うので、待ちの表し方（DESIGN.md）とあわせて決める | Input |
| D-38 | ボタンの文字を 500 のままにするか。既定の UI フォントの Yu Gothic UI と、選べる Meiryo UI には 500 の字面がなく、CSS の字面の選び方では 400 で描かれる見込み（Windows では確かめていない）。フォームのボタンは 600 から 500 にしたので、それらのフォントでは太字が標準の太さに変わる | Button |
| D-39 | Empty の広い画面での余白（`md:p-12`、4.8rem）を取り入れるか。shadcn/ui はウィンドウの幅 768px 以上で 2.4rem から 4.8rem に広げる。アプリの Empty は検索の結果の一覧や言語の一覧の中に開くので、2.4rem のままにした | Empty |
| D-40 | 設定の検索欄の中身を InputGroup に寄せるか。虫眼鏡のアイコンは 1.5rem で `size-4`（1.6rem）より小さく、左の余白は .8rem で `pl-3`（1.2rem）より狭く、文字は 1.3rem で入力欄の 1.4rem より小さい。広いウィンドウの検索欄は設定のレールの幅（20.8rem）から左右の余白を引いた 17.6rem で、文字を大きくすると入る文字が減る | Combobox、InputGroup |
| D-41 | しきい値の部品（音量のメーターに重ねた細いつまみ）を Slider に寄せるか、メーターと一体のアプリだけの部品として照合の外にするか。寄せるなら、つまみの形（幅 .4rem、高さ 4rem）とメーターの色をどう扱うかも決める | Slider |
| D-42 | ツールチップの文字の細部を寄せるか。アプリは 500 の太さで行の高さ 1.6、shadcn/ui は太さの指定がなく（400）、`text-xs` の行の高さは 1.33 で、`text-balance` で行の長さを釣り合わせる。`Hint` は複数行の説明を出すので、行の高さは DESIGN.md の説明の 1.6 にそろえた | Tooltip |
| D-43 | kit の Dialog のパーツの細部を、shadcn/ui と画面のダイアログのどちらに合わせるか。kit では次のようにした。DialogHeader の文字は狭い幅でも左に寄せる（shadcn/ui は幅 640px 未満で中央）。DialogTitle の行の高さは 1.4（shadcn/ui は `leading-none`）で、見出しは `h2`（Radix と同じ。画面のダイアログは `h3`）。DialogDescription は説明の文字の色（`muted-foreground` に当たる `--vox_description_text`。初期設定のダイアログは `--vox_secondary_text`）。幅はウィンドウより 3.2rem 狭いところまで（shadcn/ui の `calc(100%-2rem)`。画面の共通の枠は 2.4rem） | Dialog |

ほかに、#680 の判断項目（寄せる先を本家の shadcn/ui にすること、ADR-010 の7章への注記、ライセンスの記録の範囲）と、設定画面の部品の実験の残課題 K-01（kit を本採用するか）が、この棚卸しに関係します。

## 決まった判断

上の判断項目のうち、決まったものです。

| ID | 決定 | 決めた日 | 文書と実装への反映 |
|---|---|---|---|
| D-41 | しきい値の部品（音量のメーターに重ねた細いつまみ）は、共通の Slider に寄せない。メーターと一体のアプリだけの部品として、照合の外にする | 2026-11-19 | 実装は変えない。Slider の節と「そのほか」に照合の外と書いた |
| D-42 | ツールチップの文字の細部は今のままにする。太さは 500、行の高さは 1.6 で、`text-balance` は付けない。`Hint` は複数行の説明を出すので、行の高さは DESIGN.md の説明の 1.6 を保つ | 2026-11-19 | 実装の値は変えない（`common_css/mixins.ts` の `tooltipContent`、#721 のまま）。その値の横に決定をコメントで書いた。Tooltip の節の「見た目」の行と、一覧の 10 の注記にも書いた |

## 判断なしで寄せられる差

上の表で「寄せる」とした差です。

kit（画面ではまだ使っていない部品）:

1. `Button`、`TextField`、`Select`、`Switch` のパーツに `data-slot` を付ける。名前は shadcn/ui の部品（button、input、native-select、switch）に合わせる（#684。`Select` の `option` と `optgroup` のパーツは #691）。
2. `Select` を NativeSelect にそろえる。シェブロンを 1.6rem にして右から 1.4rem に置き、使えないときは包む要素ごと薄くする（#684）。
3. `Button` の文字の太さを 500 にし、使えない状態の不透明度を .5 にする（#684）。

画面で使っている部品:

4. ボタンの文字の太さを 500 に、使えない状態の不透明度を .5 にそろえる。フォーム（`VoiceSettings.css.ts`）の `:disabled` は入力欄と選択欄にも共通の規則なので、一緒に .5 になる（#694。対象は、言葉があり塗りか枠のある操作のボタン。トグル、開閉のボタン、ナビゲーション、一覧の行、待ちの表示、照合の外の画面は含めていない）。
5. チェックボックスのチェックの線を `--vox_on_primary` にする（#697）。
6. スライダーの満ちた部分を描き、溝を .6rem にし、使えない状態を足す（#697。共通の `Slider` とフォームの `input[type=range]`。しきい値の部品は照合の外。D-41）。
7. `_Entry` の塗り、枠、角丸、高さを kit の入力欄にそろえる（#691。左右の余白と使えない状態は D-37）。
8. 色のポップオーバーと、設定の検索の結果の一覧の地を `--vox_surface` にする（設定の検索の結果の一覧は #695。色のポップオーバーは残っている）。
9. ダイアログの間を 1.6rem、最大幅を 51.2rem、背景を 50% の黒にする。ダイアログのパーツ（Header、Footer、Title、Description）の部品を作る。間と最大幅は、クイック設定のモーダルと起動の失敗を除くすべてのダイアログにそろえた（初期設定（#557）は #759、ほかは #759 の判断項目 4 による）。見出しと本文の段落が平らに並んでいた同意と確認のダイアログでは、それらを1つの部品（`VoiceSettings.css.ts` の `.dialog_text`。翻訳のライセンスの確認は `Translation.css.ts` の `.license_text`）にまとめ、その中の段落の間は .8rem のままにした。パーツの `data-slot` は初期設定のダイアログにだけ付けている。背景は、クイック設定のモーダルを除くダイアログで 50% の黒にした（#764 の判断項目 2 による）。パーツの部品は、次にダイアログを作り直すときにまとめて置き換える（#764 の判断項目 3 による）。
10. ツールチップの余白と角丸をそろえ、`Tooltip` と `Hint` の見た目を1つにする（#721。文字の細部は今のまま。D-42）。
11. プリセットの切り替えの `div role="button"` を `button` にする。
12. `Separator`、`Badge`、`Spinner` をそれぞれ1つの部品にまとめる（見た目は今のまま）。
13. 検索の「結果なし」を Empty の形にそろえる（設定の検索と言語の一覧は #695。`Empty` の部品を `common_components` に作った）。
14. フォームの選択欄のシェブロンを、kit の `Select` と同じ形、大きさ、位置にする（#691。色は D-02）。

kit の差で、表では「寄せる」にしていたのにこの一覧から漏れていたもの:

15. `Button` に、アイコンだけのボタンの `icon` の size を足す（#694。高さは D-03）。
16. アイコンの付いた `Button` の左右の余白を、regular で 1.2rem（`px-3`）、compact で 1rem（sm の `px-2.5`）にする（#694）。

画面の差で、表では「寄せる」にしていたのにこの一覧から漏れていたもの:

17. 設定の検索欄の塗りと枠を入力欄のトークン（`--vox_surface`、`--vox_field_border`）にし、InputGroup の `data-slot` を付ける。言語の一覧の検索欄に Input の `data-slot` を付ける（#695）。

kit の差（Dialog の節。画面の 9 のうちパーツの部品を、先に kit に作る）:

18. kit に Dialog のパーツ（Dialog、DialogHeader、DialogFooter、DialogTitle、DialogDescription）を作り、`data-slot` を付ける。見本のページに置く（#775。画面のダイアログの置き換えは #764 の決定 3 のとおり、次の作り直しのとき。細部は D-43）。

## 段階の案

1. 段 1: kit をそろえる（上の 1〜3。一覧から漏れていた 15 と 16 は #694 で寄せた）。kit は画面でまだ使っていないので、画面は変わりません。最初に寄せる部品の PR なので、ライセンス台帳と `NOTICE.md` に shadcn/ui を載せます（#680）。
2. 段 2: 画面で使っている部品のうち、判断の要らない見た目の差（上の 4〜14 と 17）。部品ごとに PR を分けます。
3. 段 3: 判断項目が決まったものから。Radix への置き換え（D-14、D-16、D-19〜D-21、D-23、D-25〜D-27）は、ADR-010 の順（自作ではアクセシビリティを保ちにくい部品から）で進めます。CSP に触れる部品は、入れる前に `<style>` を差し込むかを確かめます。
4. 設定の行（D-34）は、#554 の情報設計で設定画面を組み直すときに合わせます。
5. 画面の手作りの要素を共通の部品に置き換えるのは、スタイルの vanilla-extract への移行（#957）のあとに、部品ごとに進めます（[手作りの部品の棚卸し](hand-built-inventory.md)の H-01）。受け皿がない要素（同じ文書の U-01〜U-12。Command、Combobox、Toggle、ToggleGroup、Popover、Progress、Textarea、選択肢のカード、Item、Card、Badge、行の中の確認、行の一覧、AlertDialog）は、すべて共通の部品として kit に足します。関係する判断項目（D-13、D-16、D-23、D-25、D-27、D-28、D-29、D-32、D-36、D-40）があるものは、それが決まってから作ります（同じ文書の H-02）。
