/** Only test fixtures: log handle types after acknowledged shutdown, never credentials or handle contents. */
import { pathToFileURL } from "node:url";
process.on("message", message => {
 if (message?.type !== "shutdown") return;
 setTimeout(() => {
  console.error("P5 pending handle types:", JSON.stringify(process._getActiveHandles().map(handle => ({ type: handle.constructor.name,
   listeners: handle.eventNames().map(name => String(name)), listening: handle.listening ?? undefined }))));
 }, 8000).unref();
});
await import(pathToFileURL(process.env.IBM_P5_NEXT_FIXTURE));
