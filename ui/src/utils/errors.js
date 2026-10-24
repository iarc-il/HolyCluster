export class NonErrorThrown extends Error {
    constructor(value) {
        const original_kind = value === null ? "null" : typeof value;
        let description;
        try {
            description = String(value);
        } catch {
            description = "Unprintable value";
        }
        super(description);
        this.name = "NonErrorThrown";
        this.original_kind = original_kind;
        this.original_value = value;
        this.stack_origin = "synthetic_capture";
    }
}

export function isError(value) {
    const tag = Object.prototype.toString.call(value);
    return ["[object Error]", "[object DOMException]"].includes(tag);
}

export function toError(value) {
    return isError(value) ? value : new NonErrorThrown(value);
}
