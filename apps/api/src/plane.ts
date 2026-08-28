import {
  dispatch,
  requiresApproval,
  type ActivityEvent,
  type Actor,
  type Approval,
  type Computer,
  type ComputerId,
  type ControlPlane,
  type Machine,
  type MachineOp,
  type SpawnSpec,
  type WorkspaceState,
  type WsEvent,
} from "@webmcp-computer/contract";
import { HttpError } from "./http-error.ts";
import type { ComputerHost } from "./host.ts";
import { appendEvent, putShot } from "./tape-store.ts";

const ACTIVITY_CAP = 100;
const APPROVAL_MS = 120_000;

const READ_OPS = new Set<MachineOp["op"]>([
  "snapshot",
  "listFiles",
  "readFile",
  "appearance",
  "browser",
  "listWindows",
  "screenshot",
  "searchFiles",
  "visibleText",
  "findText",
  "listProcesses",
  "listPorts",
  "devServers",
]);

const TAPE_OPS = new Set<MachineOp["op"]>([
  "writeFile",
  "run",
  "setWallpaper",
  "setTheme",
  "openUrl",
  "focusWindow",
  "launchApp",
  "mouseClick",
  "mouseDrag",
  "scroll",
  "typeText",
  "key",
  "selectAll",
  "createDirectory",
  "moveFile",
  "deleteFile",
  "createTab",
  "selectTab",
  "closeTab",
  "reloadTab",
  "clickSelector",
  "killProcess",
  "installPackage",
]);

const BROWSER_SHOT_OPS = new Set<MachineOp["op"]>([
  "openUrl",
  "createTab",
  "selectTab",
  "closeTab",
  "reloadTab",
  "clickSelector",
  "browserScreenshot",
]);

async function grabShot(machine: Machine, browser: boolean) {
  try {
    const shot = browser
      ? await machine.browserScreenshot(true)
      : await machine.screenshot();
    if (!shot.data) return null;
    return Buffer.from(shot.data, "base64");
  } catch {
    return null;
  }
}

function capJson(value: unknown, max = 8000): unknown {
  try {
    const s = JSON.stringify(value);
    if (!s || s === "{}") return undefined;
    if (s.length <= max) return value;
    return { truncated: true, preview: s.slice(0, max) };
  } catch {
    return undefined;
  }
}

type Listener = (event: WsEvent) => void;

type Waiter = {
  approval: Approval;
  settle: (decision: "approved" | "rejected" | "timeout") => void;
  timer: ReturnType<typeof setTimeout>;
};

export class Plane implements ControlPlane {
  private selected: ComputerId | null = null;
  private activity: ActivityEvent[] = [];
  private waiter: Waiter | null = null;
  private lastChoice: string | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly host: ComputerHost) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  vncUrl(id: string): string | undefined {
    return this.host.vncUrl(id);
  }

  async boot(): Promise<void> {
    this.selected = this.host.list()[0]?.id ?? null;
  }

  async listComputers(): Promise<Computer[]> {
    return this.host.list().map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      os: r.os,
      role: r.role,
    }));
  }

  async workspace(): Promise<WorkspaceState> {
    const computers = await this.listComputers();
    return {
      selectedComputer: this.selected,
      pendingApproval: this.waiter?.approval ?? null,
      computersRunning: computers.filter((c) => c.status === "running").length,
      mode: "live",
      activityHead: this.activity.slice(0, 40),
    };
  }

  async select(id: ComputerId, actor: Actor): Promise<WorkspaceState> {
    if (!this.host.record(id)) {
      throw new HttpError(404, { error: "unknown computer" });
    }
    this.selected = id;
    this.pushActivity(actor, id, "selected", id);
    this.emit({ type: "selection", computerId: id });
    return this.workspace();
  }

  async spawn(spec: SpawnSpec, actor: Actor): Promise<Computer> {
    const { record } = await this.host.spawn(spec);
    this.pushActivity(actor, record.id, "spawned", record.id);
    if (!this.selected) {
      this.selected = record.id;
      this.emit({ type: "selection", computerId: record.id });
    }
    this.emit({ type: "computer", computer: record });
    return record;
  }

  async destroy(id: ComputerId, actor: Actor): Promise<unknown> {
    if (!this.host.record(id)) {
      throw new HttpError(404, { error: "unknown computer" });
    }
    if (this.waiter) {
      throw new HttpError(409, { error: "approval already pending" });
    }
    const approval: Approval = {
      id: crypto.randomUUID(),
      computerId: id,
      tool: "destroy_computer",
      summary: "destroy computer",
      title: "Delete this computer?",
      body: `${id} and everything on it will be removed. This cannot be undone.`,
      command: `destroy ${id}`,
      status: "pending",
    };
    const decision = await this.waitForApproval(approval);
    if (decision === "rejected") {
      this.pushActivity(actor, id, "rejected", id);
      return { success: false, reason: "User rejected the operation." };
    }
    if (decision === "timeout") {
      this.pushActivity("system", id, "timed out", id);
      return { success: false, reason: "Approval timed out." };
    }
    await this.host.destroy(id);
    this.pushActivity(actor, id, "destroyed", id);
    if (this.selected === id) {
      this.selected = this.host.list()[0]?.id ?? null;
    }
    this.emit({ type: "selection", computerId: this.selected });
    return { success: true, id };
  }

  async act(op: MachineOp, actor: Actor): Promise<unknown> {
    if (!this.selected) {
      throw new HttpError(409, { error: "no computer selected" });
    }
    const machine = this.host.machine(this.selected);
    if (!machine) {
      throw new HttpError(404, { error: "unknown computer" });
    }
    const computerId = this.selected;

    if (op.op === "deleteFile") {
      if (this.waiter) {
        throw new HttpError(409, { error: "approval already pending" });
      }
      const approval: Approval = {
        id: crypto.randomUUID(),
        computerId,
        tool: "computer_delete_file",
        summary: "delete file",
        title: "Delete a file?",
        body: `Permanently remove ${op.path} on ${computerId}.`,
        command: op.path,
        status: "pending",
      };
      const decision = await this.waitForApproval(approval);
      if (decision === "rejected") {
        this.pushActivity(actor, computerId, "rejected", op.path);
        return { success: false, reason: "User rejected the operation." };
      }
      if (decision === "timeout") {
        this.pushActivity("system", computerId, "timed out", op.path);
        return { success: false, reason: "Approval timed out." };
      }
    }

    if (op.op === "killProcess") {
      if (this.waiter) {
        throw new HttpError(409, { error: "approval already pending" });
      }
      const approval: Approval = {
        id: crypto.randomUUID(),
        computerId,
        tool: "computer_kill_process",
        summary: "kill process",
        title: "Stop a process?",
        body: `Kill pid ${op.pid} on ${computerId}.`,
        command: `kill ${op.pid}`,
        status: "pending",
      };
      const decision = await this.waitForApproval(approval);
      if (decision !== "approved") {
        this.pushActivity(
          decision === "timeout" ? "system" : actor,
          computerId,
          decision === "timeout" ? "timed out" : "rejected",
          String(op.pid),
        );
        return { success: false, reason: "User rejected the operation." };
      }
    }

    if (op.op === "installPackage") {
      if (this.waiter) {
        throw new HttpError(409, { error: "approval already pending" });
      }
      const approval: Approval = {
        id: crypto.randomUUID(),
        computerId,
        tool: "computer_install_package",
        summary: "install package",
        title: "Install software?",
        body: `apt-get install ${op.name} on ${computerId}. Needs network inside the guest.`,
        command: `apt-get install -y ${op.name}`,
        status: "pending",
      };
      const decision = await this.waitForApproval(approval);
      if (decision !== "approved") {
        this.pushActivity(
          decision === "timeout" ? "system" : actor,
          computerId,
          decision === "timeout" ? "timed out" : "rejected",
          op.name,
        );
        return { success: false, reason: "User rejected the operation." };
      }
    }

    if (op.op === "run" && requiresApproval(op.command)) {
      if (this.waiter) {
        throw new HttpError(409, { error: "approval already pending" });
      }
      const approval: Approval = {
        id: crypto.randomUUID(),
        computerId,
        tool: "computer_run_command",
        summary: "run command",
        title: "Run a privileged command?",
        body: `The agent wants to run a command on ${computerId}. Review it before it executes.`,
        command: op.command,
        status: "pending",
      };
      const decision = await this.waitForApproval(approval);
      if (decision === "rejected") {
        this.pushActivity(actor, computerId, "rejected", op.command);
        return {
          exitCode: 1,
          stdout: "",
          stderr: "",
          reason: "User rejected the operation.",
        };
      }
      if (decision === "timeout") {
        this.pushActivity("system", computerId, "timed out", op.command);
        return {
          exitCode: 1,
          stdout: "",
          stderr: "",
          reason: "Approval timed out.",
        };
      }
    }

    const tape = TAPE_OPS.has(op.op);
    const eventId = crypto.randomUUID();
    const useBrowser = BROWSER_SHOT_OPS.has(op.op);
    let before = false;
    let after = false;
    if (tape) {
      const buf = await grabShot(machine, useBrowser);
      if (buf) {
        await putShot(computerId, eventId, "before", buf);
        before = true;
      }
    }

    let result: unknown;
    try {
      result = await dispatch(machine, op);
    } catch (err) {
      if (tape) {
        const ev = {
          id: eventId,
          at: new Date().toISOString(),
          actor,
          computerId,
          op: op.op,
          detail: mutation(op)?.detail ?? op.op,
          input: op,
          error: err instanceof Error ? err.message : "error",
          before,
          after: false,
        };
        await appendEvent(ev);
        this.emit({ type: "tape", event: ev });
      }
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, { error: "bridge unreachable" });
    }

    if (tape) {
      const buf = await grabShot(machine, useBrowser);
      if (buf) {
        await putShot(computerId, eventId, "after", buf);
        after = true;
      }
      const mut = mutation(op);
      const ev = {
        id: eventId,
        at: new Date().toISOString(),
        actor,
        computerId,
        op: op.op,
        detail: mut?.detail ?? op.op,
        input: op,
        output: capJson(result),
        before,
        after,
      };
      await appendEvent(ev);
      this.emit({ type: "tape", event: ev });
    }

    const mut = mutation(op);
    if (mut) this.pushActivity(actor, computerId, mut.verb, mut.detail);
    return result;
  }

  async resolveApproval(
    id: string,
    decision: "approved" | "rejected",
  ): Promise<Approval> {
    if (!this.waiter || this.waiter.approval.id !== id) {
      throw new HttpError(404, { error: "unknown approval" });
    }
    const approval: Approval = { ...this.waiter.approval, status: decision };
    this.waiter.approval = approval;
    this.emit({ type: "approval", approval });
    clearTimeout(this.waiter.timer);
    this.waiter.settle(decision);
    return approval;
  }

  async resolveChoice(id: string, choice: string): Promise<Approval> {
    if (!this.waiter || this.waiter.approval.id !== id) {
      throw new HttpError(404, { error: "unknown approval" });
    }
    const opts = this.waiter.approval.options ?? [];
    if (!opts.includes(choice)) {
      throw new HttpError(400, { error: "unknown option" });
    }
    this.lastChoice = choice;
    const approval: Approval = {
      ...this.waiter.approval,
      status: "approved",
      choice,
    };
    this.waiter.approval = approval;
    this.emit({ type: "approval", approval });
    clearTimeout(this.waiter.timer);
    this.waiter.settle("approved");
    return approval;
  }

  async rename(
    id: ComputerId,
    name: string,
    actor: Actor,
  ): Promise<Computer> {
    const rec = this.host.record(id);
    if (!rec) throw new HttpError(404, { error: "unknown computer" });
    const n = name.trim();
    if (!n) throw new HttpError(400, { error: "invalid name" });
    rec.name = n;
    this.pushActivity(actor, id, "renamed", n);
    this.emit({ type: "computer", computer: rec });
    return {
      id: rec.id,
      name: rec.name,
      status: rec.status,
      os: rec.os,
      role: rec.role,
    };
  }

  async requestChoice(
    question: string,
    options: string[],
    actor: Actor,
  ): Promise<{ choice: string } | { rejected: true }> {
    if (this.waiter) {
      throw new HttpError(409, { error: "approval already pending" });
    }
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || opts.length < 2) {
      throw new HttpError(400, { error: "question and 2+ options required" });
    }
    const computerId = this.selected ?? this.host.list()[0]?.id;
    if (!computerId) throw new HttpError(409, { error: "no computer selected" });
    const approval: Approval = {
      id: crypto.randomUUID(),
      computerId,
      tool: "request_human_choice",
      summary: question.trim(),
      title: question.trim(),
      body: "Pick one option for the agent to continue.",
      options: opts,
      status: "pending",
    };
    this.lastChoice = null;
    const decision = await this.waitForApproval(approval);
    const choice = this.lastChoice;
    this.lastChoice = null;
    if (decision !== "approved" || !choice) {
      this.pushActivity(actor, computerId, "rejected", question.trim());
      return { rejected: true };
    }
    this.pushActivity(actor, computerId, "chose", choice);
    return { choice };
  }

  private waitForApproval(
    approval: Approval,
  ): Promise<"approved" | "rejected" | "timeout"> {
    this.emit({ type: "approval", approval });
    void this.host
      .machine(approval.computerId)
      ?.notify(approval.title, approval.body)
      .catch(() => undefined);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiter?.approval.id === approval.id) {
          const timed: Approval = { ...approval, status: "rejected" };
          this.waiter.approval = timed;
          this.emit({ type: "approval", approval: timed });
          this.waiter.settle("timeout");
        }
      }, APPROVAL_MS);
      this.waiter = {
        approval,
        timer,
        settle: (decision) => {
          clearTimeout(timer);
          this.waiter = null;
          resolve(decision);
        },
      };
    });
  }

  private pushActivity(
    actor: Actor,
    computerId: ComputerId | null,
    verb: string,
    detail: string,
  ): void {
    const event: ActivityEvent = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor,
      computerId,
      verb,
      detail,
    };
    this.activity = [event, ...this.activity].slice(0, ACTIVITY_CAP);
    this.emit({ type: "activity", event });
  }

  private emit(event: WsEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function mutation(op: MachineOp): { verb: string; detail: string } | null {
  if (READ_OPS.has(op.op)) return null;
  switch (op.op) {
    case "writeFile":
      return { verb: "wrote", detail: op.path };
    case "run":
      return { verb: "ran", detail: op.command };
    case "setWallpaper":
      return { verb: "set wallpaper", detail: op.wallpaper };
    case "setTheme":
      return { verb: "set theme", detail: op.theme };
    case "openUrl":
      return { verb: "opened", detail: op.url };
    case "focusWindow":
      return { verb: "focused", detail: op.windowId };
    case "launchApp":
      return { verb: "launched", detail: op.app };
    case "mouseClick":
      return { verb: "clicked", detail: `${op.x},${op.y}` };
    case "mouseDrag":
      return { verb: "dragged", detail: `${op.fromX},${op.fromY}` };
    case "scroll":
      return { verb: "scrolled", detail: `${op.dx ?? 0},${op.dy ?? 0}` };
    case "typeText":
      return { verb: "typed", detail: op.text.slice(0, 40) };
    case "key":
      return { verb: "keyed", detail: op.keys };
    case "selectAll":
      return { verb: "selected all", detail: "" };
    case "createDirectory":
      return { verb: "mkdir", detail: op.path };
    case "moveFile":
      return { verb: "moved", detail: op.to };
    case "deleteFile":
      return { verb: "deleted", detail: op.path };
    case "createTab":
      return { verb: "opened tab", detail: op.url };
    case "selectTab":
      return { verb: "switched tab", detail: op.tabId };
    case "closeTab":
      return { verb: "closed tab", detail: op.tabId };
    case "reloadTab":
      return { verb: "reloaded", detail: "" };
    case "clickSelector":
      return { verb: "clicked", detail: op.selector };
    case "killProcess":
      return { verb: "killed", detail: String(op.pid) };
    case "installPackage":
      return { verb: "installed", detail: op.name };
    default:
      return null;
  }
}
