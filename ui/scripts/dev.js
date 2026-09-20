import { spawn } from "node:child_process";

const catserver_flag = "--catserver";
const vite_args = process.argv.slice(2).filter(argument => argument !== catserver_flag);
const use_catserver =
    process.argv.includes(catserver_flag) ||
    process.env.npm_config_catserver === "true" ||
    process.env.CATSERVER_PROXY === "true";
const vite_command = process.platform === "win32" ? "vite.cmd" : "vite";

const vite = spawn(vite_command, vite_args, {
    env: {
        ...process.env,
        CATSERVER_PROXY: use_catserver ? "true" : "false",
    },
    stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => vite.kill(signal));
}

vite.on("error", error => {
    console.error(error);
    process.exitCode = 1;
});

vite.on("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
});
