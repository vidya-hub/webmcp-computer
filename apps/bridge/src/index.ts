import { serve } from "@hono/node-server";
import { type ComputerId } from "@webmcp-computer/contract";
import { createApp } from "./app.ts";
import { LinuxMachine } from "./linux-machine.ts";

// Log, but never exit: crashing the bridge would take the whole desktop down.
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});

const PORT = Number(process.env.PORT ?? 8080);
const MACHINE_ID = (process.env.MACHINE_ID ?? "machine") as ComputerId;
const MACHINE_NAME = process.env.MACHINE_NAME ?? MACHINE_ID;

const machine = new LinuxMachine(MACHINE_ID, MACHINE_NAME);
const app = createApp(machine, MACHINE_ID);

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, () => {
  console.log(`bridge ${MACHINE_ID} http://0.0.0.0:${PORT}`);
});
