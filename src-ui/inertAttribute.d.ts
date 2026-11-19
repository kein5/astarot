// The inert attribute, which React 18's types do not have yet (React 19 adds it). React 18
// passes it to the DOM as it is: the pages set it to "" to make a hidden page inert and leave
// it out otherwise. true would not set it, so only "" is declared.
import "react";

declare module "react" {
    interface HTMLAttributes<T> {
        inert?: "" | undefined;
    }
}
