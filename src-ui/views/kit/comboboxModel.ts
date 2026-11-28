// What the kit's Combobox (Combobox.tsx) does with its options, apart from drawing them: which
// options a search keeps, which option the keys move to, and which one is active when the list
// opens. Plain functions of the options, so they are tested without a page.

// One choice: the value it stands for, the words it shows (what the search reads), and other words
// it is found by, such as a former name.
export interface ComboboxOption {
    value: string;
    label: string;
    disabled?: boolean;
    keywords?: readonly string[];
}

// Options under a heading of their own. A list without headings is one group with no label.
export interface ComboboxGroup {
    id: string;
    label?: string;
    options: readonly ComboboxOption[];
}

// The words as a search compares them: full-width letters and half-width katakana as their usual
// forms (NFKC), hiragana as katakana, no case and no spaces. So 「でぃーぷ」 and 「ＤｅｅｐＬ」 find what
// 「ディープ」 and "DeepL" find.
export const searchForm = (text: string): string =>
    text.normalize("NFKC")
        .replace(/[ぁ-ゖ]/g, kana => String.fromCharCode(kana.charCodeAt(0) + 0x60))
        .toLocaleLowerCase()
        .replace(/\s+/g, "");

// Whether an option answers a search: every word of it is part of the option's words or of one of
// its keywords, in any order. An empty search keeps every option.
export const matchesSearch = (option: ComboboxOption, query: string): boolean => {
    const words = query.split(/\s+/).map(searchForm).filter(Boolean);
    if (words.length === 0) return true;
    const haystack = [option.label, ...option.keywords ?? []].map(searchForm);
    return words.every(word => haystack.some(text => text.includes(word)));
};

// The groups a search keeps, in their order, each with the options it keeps; a group left with
// no option goes, heading and all.
export const searchGroups = (groups: readonly ComboboxGroup[], query: string): ComboboxGroup[] =>
    groups.map(group => ({ ...group, options: group.options.filter(option => matchesSearch(option, query)) }))
        .filter(group => group.options.length > 0);

// The options of the groups in the order they are drawn.
export const optionsOf = (groups: readonly ComboboxGroup[]): ComboboxOption[] => groups.flatMap(group => group.options);

const usable = (options: readonly ComboboxOption[]) => options.filter(option => option.disabled !== true);

// The option the keys start from when the list opens or the search changes: the value, when it
// is in the list and can be chosen, as a system's select opens on its value; else the first one
// that can be chosen; none when nothing can.
export const startingOption = (options: readonly ComboboxOption[], value: string | undefined): string | undefined => {
    const choosable = usable(options);
    return choosable.find(option => option.value === value)?.value ?? choosable[0]?.value;
};

// The active option as drawn: the one asked for while the list holds it and it can be chosen,
// else the first that can.
export const activeOption = (options: readonly ComboboxOption[], active: string | undefined): string | undefined => {
    const choosable = usable(options);
    return choosable.some(option => option.value === active) ? active : choosable[0]?.value;
};

// The option an arrow key moves to: the next (1) or the previous (-1) one that can be chosen, from
// the last to the first and back. From no active option, Down goes to the first and Up to the last.
export const stepOption = (options: readonly ComboboxOption[], active: string | undefined, step: 1 | -1): string | undefined => {
    const choosable = usable(options);
    if (choosable.length === 0) return undefined;
    const at = choosable.findIndex(option => option.value === active);
    if (at < 0) return (step === 1 ? choosable[0] : choosable[choosable.length - 1])?.value;
    return choosable[(at + step + choosable.length) % choosable.length]?.value;
};
