import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scrubbedParentEnv, SENSITIVE_ENV_PATTERN } from "@deepseek-ai/dsh-subprocess";

export const GUARDIAN = fileURLToPath(new URL("../../scripts/runtime/owned_process.py", import.meta.url));

/** Private execution seam. Public APIs select fixed scripts/application specs. */
export class ProcessSupervisor {
 constructor(python) { this.python = python; this.children = new Set(); this.active = true; }
 spawn = (command, args, options = {}) => {
  if (!this.active) throw new Error("scientific process supervisor is stopped");
  if (!this.python) throw new Error("managed Python is required for owned scientific execution");
  const python = Array.isArray(this.python) ? this.python : [this.python];
  const safeEnv = Object.fromEntries(Object.entries(options.env ?? {}).filter(([name]) => !SENSITIVE_ENV_PATTERN.test(name) && !/^DSH_/i.test(name)));
  const child = spawn(python[0], [...python.slice(1), "-I", GUARDIAN, command, ...args], {
   ...options, detached: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
   env: { ...scrubbedParentEnv(), ...safeEnv }
  });
  this.children.add(child);
  child.stdin.on("error", () => {});
  const exited = new Promise(resolve => {
   child.once("close", () => { this.children.delete(child); resolve(); });
   child.once("error", () => { this.children.delete(child); resolve(); });
  });
  const originalKill = child.kill.bind(child);
  child.stopOwned = async () => {
   child.stdin.end();
   const timer = setTimeout(() => originalKill("SIGKILL"), 3000);
   try { await exited; } finally { clearTimeout(timer); }
  };
  child.kill = () => { void child.stopOwned(); return true; };
  return child;
 };
 async dispose() { this.active = false; await Promise.allSettled([...this.children].map(child => child.stopOwned())); }
}
