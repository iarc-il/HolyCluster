import { install_module_load_recovery } from "../src/module_load_recovery.js";

export function moduleRecoveryPlugin() {
    return {
        name: "module-recovery",
        apply: "build",
        transformIndexHtml: {
            order: "post",
            handler(_html, context) {
                const entry = Object.values(context.bundle).find(
                    item =>
                        item.type === "chunk" &&
                        item.isEntry &&
                        item.facadeModuleId?.endsWith("/index.html"),
                );
                if (!entry) throw new Error("UI entry chunk not found");
                const url = `/${entry.fileName}`;
                return [
                    {
                        tag: "meta",
                        attrs: { name: "ui-entry", content: url },
                        injectTo: "head-prepend",
                    },
                    {
                        tag: "script",
                        children: `(${install_module_load_recovery.toString()})({entry:${JSON.stringify(url)}});`,
                        injectTo: "head-prepend",
                    },
                ];
            },
        },
    };
}
