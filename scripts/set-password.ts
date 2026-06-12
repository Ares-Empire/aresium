// Set (or change) the dashboard login password. Writes a scrypt hash to .env as
// AUTH_PASSWORD_HASH and, if missing, generates AUTH_SESSION_SECRET. The plaintext
// password is never stored or echoed.
//
//   npm run set-password                    # prompts (hidden input)
//   echo 's3cret' | npm run set-password    # or pipe it in
//
// After setting it, restart the web server (systemctl restart aresium) to apply.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../src/web/auth.js";

const ENV = ".env";

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (c) => (data += c));
      stdin.on("end", () => resolve(data.replace(/\r?\n$/, "")));
      return;
    }
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    const onData = (ch: string) => {
      const code = ch.charCodeAt(0);
      if (ch === "\n" || ch === "\r" || code === 4) {            // Enter / Ctrl-D (EOF)
        stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData);
        stdout.write("\n"); resolve(buf);
      } else if (code === 3) {                                    // Ctrl-C
        stdout.write("\n"); process.exit(1);
      } else if (code === 127 || code === 8) {                    // backspace
        buf = buf.slice(0, -1);
      } else {
        buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

function upsertEnv(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) return text.replace(re, line);
  return (text === "" || text.endsWith("\n") ? text : text + "\n") + line + "\n";
}

const password = await readHidden("New Aresium password: ");
if (password.length < 6) {
  console.error("Password too short (minimum 6 characters).");
  process.exit(1);
}

let env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
env = upsertEnv(env, "AUTH_PASSWORD_HASH", hashPassword(password));
if (!/^AUTH_SESSION_SECRET=.+$/m.test(env)) {
  env = upsertEnv(env, "AUTH_SESSION_SECRET", randomBytes(32).toString("hex"));
  console.log("Generated a new AUTH_SESSION_SECRET.");
}
writeFileSync(ENV, env);
console.log("Password saved to .env. Restart the server to apply:  systemctl restart aresium");
