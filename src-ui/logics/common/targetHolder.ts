// An element as a view asks it whether it holds an event's target: a press, a focus or the
// pointer outside a menu or a list closes it. Those events come from nodes of the page, but the
// DOM types name their target only EventTarget, and Element.contains takes a Node. Declared
// with the wider type, an element is assigned to this as it is, and the view asks without
// narrowing the target first, as it did in JavaScript.
export interface TargetHolder {
    contains(target: EventTarget | null): boolean;
}
