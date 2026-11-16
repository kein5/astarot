// While the main window is hidden in the tray, a dialog that opens in it (the start-up notices,
// a consent, a review) would wait unseen. The dialogs are <dialog> elements opened with
// showModal(); this calls `onOpen` each time the main window goes from no open dialog to one.

type Root = Pick<Document, "querySelector">;
type ObserverClass = new (callback: () => void) => {
    observe: (target: Node, options: MutationObserverInit) => void;
    disconnect: () => void;
};

export const watchOpenDialogs = (
    root: Root & { body: Node | null },
    onOpen: () => void,
    Observer: ObserverClass | undefined = globalThis.MutationObserver,
): (() => void) => {
    if (!Observer || !root.body) return () => {};
    let open = false;
    const check = () => {
        const now = root.querySelector("dialog[open]") !== null;
        if (now && !open) onOpen();
        open = now;
    };
    const observer = new Observer(check);
    observer.observe(root.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    check();
    return () => observer.disconnect();
};
