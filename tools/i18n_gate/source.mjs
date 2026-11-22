// Scans the UI source for two things:
//  - translation keys it names (t("a.b"), i18n.t(...), i18nKey="a.b", and any string that
//    looks like a key of a known namespace) that the reference locale does not define;
//  - text shown to the user that is written straight into the code instead of coming from
//    the locales (JSX text, user-facing attributes, string literals placed in JSX).
// The parser is the one inside @babel/standalone, already a dependency of the app.
import Babel from "@babel/standalone";

const { parser } = Babel.packages;
const traverse = Babel.packages.traverse.default;

// Attributes whose value is shown or read out to the user. aria-* is added by prefix.
export const USER_ATTRIBUTES = new Set([
    "title",
    "placeholder",
    "alt",
    "label",
    "tooltip",
    "description",
    "caption",
    "heading",
    "ariaLabel",
    "aria-label",
]);
const ARIA_TEXT = /^aria-(label|description|placeholder|roledescription|valuetext)$/;
const isUserAttribute = (name) => USER_ATTRIBUTES.has(name) || ARIA_TEXT.test(name);
// Object properties that usually reach the screen (option lists, notices).
export const USER_PROPERTIES = new Set([
    "label",
    "title",
    "placeholder",
    "description",
    "desc",
    "tooltip",
    "ariaLabel",
    "aria-label",
    "alt",
    "heading",
    "caption",
]);
const propertyName = (node) =>
    node.computed
        ? null
        : node.key.type === "Identifier"
          ? node.key.name
          : node.key.type === "StringLiteral"
            ? node.key.value
            : null;

// An attribute value that only names something (an id, a key, a path, a URL) is not text.
const IDENTIFIER_LIKE = /^[a-z0-9_.\-:/#?=&%]+$/;

const KEY_LIKE = /^[a-z][a-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
// "voice.pth" is a file name, not the key pth in the voice namespace.
const FILE_NAME =
    /\.(pth|index|gguf|onnx|bin|pt|ckpt|safetensors|json|ya?ml|txt|wav|mp3|ogg|flac|png|jpe?g|svg|ico|exe|dll|so|zip|tar|gz|log|md|html|css|js|ts)$/i;

export const EXEMPT_MARK = "i18n-exempt";
const EXEMPT_COMMENT = /i18n-exempt(?::\s*(.*\S))?/;
const EXEMPT_START = /i18n-exempt-start(?::\s*(.*\S))?/;
const EXEMPT_END = /i18n-exempt-end\b/;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Builds the test for "does this text still need a translation once the allowed terms
// (product names, protocol names, units) are taken out?"
export const makeNeedsTranslation = (terms = []) => {
    const patterns = [...terms]
        .sort((a, b) => b.length - a.length)
        .map((term) => new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`, "gu"));
    return (text) => {
        let rest = String(text);
        for (const pattern of patterns) rest = rest.replace(pattern, " ");
        return /\p{L}/u.test(rest);
    };
};

const collapse = (text) => text.replace(/\s+/g, " ").trim();

const parserPlugins = (file) => {
    if (/\.tsx$/.test(file)) return ["typescript", "jsx"];
    if (/\.ts$/.test(file)) return ["typescript"];
    return ["jsx"];
};

// Literals inside an expression that end up on screen as they are.
const displayedLiterals = (node) => {
    if (!node) return [];
    switch (node.type) {
        case "StringLiteral":
            return [{ node, text: node.value }];
        case "TemplateLiteral":
            return [{ node, text: node.quasis.map((q) => q.value.cooked ?? q.value.raw).join(" ") }];
        case "ConditionalExpression":
            return [...displayedLiterals(node.consequent), ...displayedLiterals(node.alternate)];
        case "LogicalExpression":
            return [...displayedLiterals(node.left), ...displayedLiterals(node.right)];
        case "ParenthesizedExpression":
        case "TSAsExpression":
        case "TSNonNullExpression":
            return displayedLiterals(node.expression);
        default:
            return [];
    }
};

const isTranslateCall = (callee) =>
    (callee.type === "Identifier" && callee.name === "t") ||
    (callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.property.type === "Identifier" &&
        callee.property.name === "t");

const returnsObjects = (options) =>
    options?.type === "ObjectExpression" &&
    options.properties.some(
        (p) =>
            p.type === "ObjectProperty" &&
            !p.computed &&
            ((p.key.type === "Identifier" && p.key.name === "returnObjects") ||
                (p.key.type === "StringLiteral" && p.key.value === "returnObjects")) &&
            p.value.type === "BooleanLiteral" &&
            p.value.value,
    );

// Checks a key against the reference locale. Returns a message, or null when it resolves.
export const resolveKey = (key, index, { allowBranch = false } = {}) => {
    if (index.leaves.has(key) || index.plurals.has(key)) return null;
    if (index.branches.has(key)) return allowBranch ? null : `"${key}" names a group of keys, not one text`;
    return `"${key}" is not defined in the reference locale`;
};

// For t(`a.b.${x}`): the fixed part before the first ${} must name a group that exists.
const resolveTemplatePrefix = (template, index) => {
    const head = template.quasis[0].value.cooked ?? "";
    const cut = head.lastIndexOf(".");
    if (cut <= 0) return null;
    const branch = head.slice(0, cut);
    if (index.branches.has(branch)) return null;
    return `"${head}\${...}" starts with "${branch}", which is not a group in the reference locale`;
};

const keyProblemsOfArgument = (node, index, options, report) => {
    if (!node) return;
    if (node.type === "StringLiteral") {
        const message = resolveKey(node.value, index, { allowBranch: returnsObjects(options) });
        if (message) report(node, message);
    } else if (node.type === "TemplateLiteral") {
        if (node.expressions.length === 0) {
            const message = resolveKey(node.quasis[0].value.cooked, index, { allowBranch: returnsObjects(options) });
            if (message) report(node, message);
        } else {
            const message = resolveTemplatePrefix(node, index);
            if (message) report(node, message);
        }
    } else if (node.type === "ConditionalExpression") {
        keyProblemsOfArgument(node.consequent, index, options, report);
        keyProblemsOfArgument(node.alternate, index, options, report);
    }
};

// Scans one file. Returns { keys: [...], hardcoded: [...], errors: [...] }, each item with
// line and column; hardcoded items carry a kind and the text for the baseline.
export const scanSource = (file, code, { index, needsTranslation }) => {
    const keys = [];
    const hardcoded = [];
    const errors = [];
    let ast;
    try {
        ast = parser.parse(code, { sourceType: "module", plugins: parserPlugins(file), errorRecovery: false });
    } catch (error) {
        errors.push({
            file,
            line: error.loc?.line ?? 1,
            column: (error.loc?.column ?? 0) + 1,
            message: `cannot parse: ${error.message}`,
        });
        return { keys, hardcoded, errors };
    }

    // Lines an i18n-exempt comment covers: its own last line (and the next one, see below); or,
    // for i18n-exempt-start ... i18n-exempt-end, every line from one to the other.
    const sourceLines = code.split("\n");
    const exemptLines = new Set();
    let blockStart = null;
    for (const comment of ast.comments ?? []) {
        const where = { file, line: comment.loc.start.line, column: comment.loc.start.column + 1 };
        if (EXEMPT_END.test(comment.value)) {
            if (blockStart === null)
                errors.push({ ...where, message: `${EXEMPT_MARK}-end without ${EXEMPT_MARK}-start` });
            else for (let line = blockStart; line <= comment.loc.end.line; line++) exemptLines.add(line);
            blockStart = null;
            continue;
        }
        const block = comment.value.match(EXEMPT_START);
        const match = block ?? comment.value.match(EXEMPT_COMMENT);
        if (!match) continue;
        if (!match[1]) {
            errors.push({
                ...where,
                message: `${EXEMPT_MARK} needs a reason: // ${block ? `${EXEMPT_MARK}-start` : EXEMPT_MARK}: <why this text is not translated>`,
            });
            continue;
        }
        if (block) {
            if (blockStart !== null) errors.push({ ...where, message: `${EXEMPT_MARK}-start inside another one` });
            blockStart = comment.loc.start.line;
            continue;
        }
        exemptLines.add(comment.loc.end.line);
        // A comment on a line of its own covers the next line; one after code covers its line only.
        const before = sourceLines[comment.loc.start.line - 1].slice(0, comment.loc.start.column);
        if (/^\s*\{?\s*$/.test(before)) exemptLines.add(comment.loc.end.line + 1);
    }
    if (blockStart !== null)
        errors.push({ file, line: blockStart, column: 1, message: `${EXEMPT_MARK}-start without ${EXEMPT_MARK}-end` });
    const exempt = (line) => exemptLines.has(line);

    const checkedKeyNodes = new WeakSet();
    const reportKey = (node, message) => {
        checkedKeyNodes.add(node);
        if (exempt(node.loc.start.line)) return;
        keys.push({ file, line: node.loc.start.line, column: node.loc.start.column + 1, message });
    };

    const addHardcoded = (node, kind, rawText, { attribute = false } = {}) => {
        const text = collapse(rawText);
        if (!text || !needsTranslation(text)) return;
        if (attribute && IDENTIFIER_LIKE.test(text)) return;
        // JSX text starts with the whitespace before it; point at the first visible character.
        let { line, column } = node.loc.start;
        if (node.type === "JSXText") {
            const leading = rawText.match(/^\s*/)[0];
            const newlines = leading.split("\n").length - 1;
            line += newlines;
            column = newlines ? leading.length - leading.lastIndexOf("\n") - 1 : column + leading.length;
        }
        if (exempt(line)) return;
        hardcoded.push({ file, line, column: column + 1, kind, text });
    };

    traverse(ast, {
        CallExpression(path) {
            const { callee, arguments: args } = path.node;
            if (!isTranslateCall(callee)) return;
            const [first, options] = args;
            if (first) {
                // Mark every literal of the argument as handled, so the key-like string pass skips it.
                for (const { node } of displayedLiterals(first)) checkedKeyNodes.add(node);
                keyProblemsOfArgument(first, index, options, reportKey);
            }
        },
        JSXAttribute(path) {
            const { name, value } = path.node;
            const attribute =
                name.type === "JSXNamespacedName" ? `${name.namespace.name}:${name.name.name}` : name.name;
            if (attribute === "i18nKey" && value?.type === "StringLiteral") {
                const message = resolveKey(value.value, index);
                if (message) reportKey(value, message);
                else checkedKeyNodes.add(value);
                return;
            }
            if (!isUserAttribute(attribute) || !value) return;
            if (value.type === "StringLiteral") {
                addHardcoded(value, `attribute:${attribute}`, value.value, { attribute: true });
            } else if (value.type === "JSXExpressionContainer") {
                for (const literal of displayedLiterals(value.expression)) {
                    addHardcoded(literal.node, `attribute:${attribute}`, literal.text, { attribute: true });
                }
            }
        },
        ObjectProperty(path) {
            const name = propertyName(path.node);
            if (!name || !USER_PROPERTIES.has(name)) return;
            for (const literal of displayedLiterals(path.node.value)) {
                addHardcoded(literal.node, `property:${name}`, literal.text, { attribute: true });
            }
        },
        JSXText(path) {
            addHardcoded(path.node, "jsx-text", path.node.value);
        },
        JSXExpressionContainer(path) {
            const parent = path.parent.type;
            if (parent !== "JSXElement" && parent !== "JSXFragment") return;
            for (const literal of displayedLiterals(path.node.expression)) {
                addHardcoded(literal.node, "jsx-expression", literal.text);
            }
        },
        StringLiteral: {
            exit(path) {
                const { node } = path;
                if (checkedKeyNodes.has(node)) return;
                if (
                    path.parent.type === "ImportDeclaration" ||
                    path.parent.type === "ExportAllDeclaration" ||
                    path.parent.type === "ExportNamedDeclaration"
                )
                    return;
                if (!KEY_LIKE.test(node.value) || FILE_NAME.test(node.value)) return;
                const namespace = node.value.slice(0, node.value.indexOf("."));
                if (!index.namespaces.has(namespace)) return;
                // A string that only looks like a key may also name a group (prefix tables).
                const message = resolveKey(node.value, index, { allowBranch: true });
                if (message) reportKey(node, message);
            },
        },
    });
    return { keys, hardcoded, errors };
};
