import { styleText } from "node:util";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
const PAD = "  ";
const RULE_CHAR = "─";
const MAX_QUOTE_WIDTH = 50;
export function log(text) {
    console.log(PAD + text);
}
export function blank() {
    console.log();
}
export function rule(width) {
    const termWidth = process.stdout.columns || 80;
    const w = width ?? termWidth - PAD.length;
    log(styleText("dim", RULE_CHAR.repeat(w)));
}
export function labeledRule(label, width) {
    const termWidth = process.stdout.columns || 80;
    const contentWidth = width ?? termWidth - PAD.length;
    const labelText = ` ${label} `;
    const labelWidth = stringWidth(labelText);
    const remaining = contentWidth - labelWidth;
    if (remaining <= 0) {
        log(styleText("dim", RULE_CHAR.repeat(contentWidth)));
        return;
    }
    const leftCount = 2;
    const rightCount = remaining - leftCount;
    const left = RULE_CHAR.repeat(Math.max(0, leftCount));
    const right = RULE_CHAR.repeat(Math.max(0, rightCount));
    log(styleText("dim", left) +
        styleText("cyan", labelText) +
        styleText("dim", right));
}
export function heading(text) {
    blank();
    log(styleText("bold", text));
    rule();
}
export function keyValue(key, value) {
    const keyPart = styleText("dim", key.padEnd(10));
    return `${keyPart} ${value}`;
}
export function status(color, label, detail) {
    const symbol = color === "red"
        ? "✗"
        : color === "green"
            ? "✓"
            : color === "yellow"
                ? "◆"
                : "→";
    const colored = styleText([color, "bold"], `${symbol} ${label}`);
    if (detail) {
        log(`${colored} ${styleText("dim", detail)}`);
    }
    else {
        log(colored);
    }
}
export function quoteBlock(text, maxWidth = MAX_QUOTE_WIDTH) {
    const wrapped = wrapAnsi(text, maxWidth, { wordWrap: true, hard: false });
    const lines = wrapped.split("\n");
    return lines.map((line) => styleText(["dim", "italic"], line));
}
export function dimBox(lines) {
    if (lines.length === 0) {
        return [];
    }
    const widths = lines.map((l) => stringWidth(l));
    const maxWidth = Math.max(...widths);
    const paddedLines = lines.map((l) => {
        const w = stringWidth(l);
        const padding = " ".repeat(maxWidth - w);
        return `${l}${padding}`;
    });
    const top = `╭${RULE_CHAR.repeat(maxWidth)}╮`;
    const middle = paddedLines.map((l) => `│${l}│`);
    const bottom = `╰${RULE_CHAR.repeat(maxWidth)}╯`;
    return [top, ...middle, bottom].map((l) => styleText("dim", l));
}
export function sideBySide(left, right, gap = 4) {
    const maxLines = Math.max(left.length, right.length);
    const maxLeftWidth = Math.max(0, ...left.map((l) => stringWidth(l)));
    const result = [];
    for (let i = 0; i < maxLines; i++) {
        const leftLine = left[i] ?? "";
        const rightLine = right[i] ?? "";
        const leftWidth = stringWidth(leftLine);
        const padding = " ".repeat(maxLeftWidth - leftWidth + gap);
        result.push(leftLine + padding + rightLine);
    }
    return result;
}
export function detail(text) {
    log(styleText("dim", text));
}
