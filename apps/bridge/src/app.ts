import {
  dispatch,
  type Machine,
  type MachineOp,
} from "@webmcp-computer/contract";
import { Hono } from "hono";
import { HttpError } from "./http-error.ts";

export function createApp(machine: Machine, machineId: string): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, id: machineId }));

  app.post("/act", async (c) => {
    try {
      const op = (await c.req.json()) as MachineOp;
      if (!op || typeof op !== "object" || typeof op.op !== "string") {
        throw new HttpError(400, { error: "invalid op" });
      }
      const result = await dispatch(machine, op);
      return c.json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        return c.json(err.body, err.status as 400);
      }
      return c.json({ error: "internal" }, 500);
    }
  });

  return app;
}
