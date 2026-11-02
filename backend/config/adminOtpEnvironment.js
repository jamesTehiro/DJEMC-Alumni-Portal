const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

const ADMIN_KEYS = ["EMAIL_PROVIDER", "BREVO_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME", "REGISTRATION_OTP_SECRET", "ADMIN_BOOTSTRAP_SECRET"];
const PINNED_KEYS = [...ADMIN_KEYS, "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASS"];
const MISSING_MARKER = "ADMIN_OTP_MISSING_AT_BOOT";
const FILE_MARKER = "ADMIN_OTP_SELECTED_ENV_FILE";
function selectedFile(argv, env) {
    let file;
    for (let index = 0; index < argv.length; index++) {
        if (/^--env-file(?:-if-exists)?=/.test(argv[index])) file = argv[index].slice(argv[index].indexOf("=") + 1);
        else if (["--env-file", "--env-file-if-exists"].includes(argv[index])) file = argv[++index];
    }
    return file || env[FILE_MARKER] || env.DOTENV_CONFIG_PATH || null;
}
// Capture BEFORE any shared .env loader. Only Admin OTP reads this view;
// existing Alumni/Employer process.env loading stays unchanged.
function createEnvironment({ env = process.env, argv = process.execArgv, cwd = process.cwd(), readFile = file => fs.readFileSync(file, "utf8") } = {}) {
    const file = selectedFile(argv, env);
    const runtimeOnly = env.NODE_ENV === "production" || env.RENDER === "true";
    const kind = file ? "explicit-file" : runtimeOnly ? "runtime" : "default-dotenv";
    const initial = { ...env };
    const blocked = new Set(String(env[MISSING_MARKER] || "").split(",").filter(key => PINNED_KEYS.includes(key)));
    let sourceError = null;
    if (file) {
        const absolute = path.resolve(cwd, file);
        env[FILE_MARKER] = absolute; // Nonsecret provenance, inherited by embedded worker.
        try {
            const parsed = dotenv.parse(readFile(absolute));
            for (const key of PINNED_KEYS) if (!Object.hasOwn(parsed, key)) blocked.add(key);
        } catch { sourceError = "selected_environment_file_unreadable"; }
    }
    if (kind !== "default-dotenv") {
        for (const key of PINNED_KEYS) if (!initial[key]) blocked.add(key);
        env[MISSING_MARKER] = [...blocked].join(",");
    }
    return {
        kind,
        get() {
            const result = { ...(kind === "default-dotenv" ? env : initial) };
            for (const key of blocked) delete result[key];
            return result;
        },
        sourceError,
        missingAtBoot: [...blocked]
    };
}
const environment = createEnvironment();
module.exports = { environment, createEnvironment, ADMIN_KEYS, PINNED_KEYS };
