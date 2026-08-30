import {
  dispatch,
  requiresApproval,
  type ActivityEvent,
  type Actor,
  type Approval,
  type Computer,
  type ComputerId,
  type ControlPlane,
  type HomeArchive,
  type Machine,
  type MachineOp,
  type MouseButton,
  type RecipeStep,
  type RecordedAction,
  type SpawnSpec,
  type WorkspaceState,
  type WsEvent,
} from "@webmcp-computer/contract";
import { HttpError } from "./http-error.ts";
import type { ComputerHost, ComputerRecord } from "./host.ts";
import { appendEvent, listTape, putShot } from "./tape-store.ts";
import { enqueueTape } from "./tape-queue.ts";
import {
  deleteAction,
  getAction,
  listActions,
  saveAction,
} from "./action-store.ts";
import {
  ARCHIVE_CAP_BYTES,
  ARCHIVE_EXCLUDES,
  deleteArchive,
  getArchiveBytes,
  listArchives,
  putArchive,
} from "./archive-store.ts";

const ACTIVITY_CAP = 100;
const APPROVAL_MS = 120_000;
const SHOT_TIMEOUT_MS = 4_000;

// High-frequency, low-forensic-value ops: skip the before/after screenshots
// (the event row is still written) so a keystroke doesn't cost two full PNGs.
const SHOT_SKIP_OPS = new Set<MachineOp["op"]>([
  "typeText",
  "key",
  "selectAll",
  "scroll",
  "focusWindow",
]);

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
  "replayAction",
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

// A hung scrot/CDP capture must not stall the mutation it's documenting.
async function grabShotBounded(
  machine: Machine,
  browser: boolean,
): Promise<Buffer | null> {
  return Promise.race([
    grabShot(machine, browser),
    new Promise<null>((resolve) => {
      const t = setTimeout(() => resolve(null), SHOT_TIMEOUT_MS);
      t.unref?.();
    }),
  ]);
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

const RECORD_BUTTONS = new Set<MouseButton>(["left", "right", "middle"]);

// Viewer POSTs a normalized input step. Drop unknown fields and any client
// `t`/`computerId` so the API clock is the only one that orders the tape.
function sanitizeRecordStep(raw: unknown): RecipeStep | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  switch (s.kind) {
    case "click": {
      if (typeof s.x !== "number" || typeof s.y !== "number") return null;
      const button =
        typeof s.button === "string" && RECORD_BUTTONS.has(s.button as MouseButton)
          ? (s.button as MouseButton)
          : undefined;
      const clicks = typeof s.clicks === "number" ? s.clicks : undefined;
      return {
        kind: "click",
        x: s.x,
        y: s.y,
        ...(button ? { button } : {}),
        ...(clicks !== undefined ? { clicks } : {}),
      };
    }
    case "drag": {
      if (
        typeof s.fromX !== "number" ||
        typeof s.fromY !== "number" ||
        typeof s.toX !== "number" ||
        typeof s.toY !== "number"
      ) {
        return null;
      }
      return {
        kind: "drag",
        fromX: s.fromX,
        fromY: s.fromY,
        toX: s.toX,
        toY: s.toY,
      };
    }
    case "scroll": {
      if (
        typeof s.x !== "number" ||
        typeof s.y !== "number" ||
        typeof s.dy !== "number"
      ) {
        return null;
      }
      return { kind: "scroll", x: s.x, y: s.y, dy: s.dy };
    }
    case "type": {
      if (typeof s.text !== "string" || !s.text) return null;
      return { kind: "type", text: s.text };
    }
    case "key": {
      if (typeof s.keys !== "string" || !s.keys) return null;
      return { kind: "key", keys: s.keys };
    }
    case "wait": {
      if (typeof s.ms !== "number" || s.ms < 0) return null;
      return { kind: "wait", ms: s.ms };
    }
    default:
      return null;
  }
}

function publicComputer(r: ComputerRecord): Computer {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    os: r.os,
    role: r.role,
    wallpaper: r.wallpaper,
  };
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
  private recording: {
    computerId: ComputerId;
    t0: number;
    steps: RecipeStep[];
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly host: ComputerHost) {
    this.host.subscribeRecords?.((record) => {
      this.emit({ type: "computer", computer: publicComputer(record) });
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  vncUrl(id: string): string | undefined {
    return this.host.vncUrl(id);
  }

  streamUrl(id: string): string | undefined {
    return this.host.streamUrl?.(id);
  }

  streamAuth(id: string): string | undefined {
    return this.host.streamAuth?.(id);
  }

  async boot(): Promise<void> {
    this.selected = this.host.list()[0]?.id ?? null;
  }

  async listComputers(): Promise<Computer[]> {
    return this.host.list().map(publicComputer);
  }

  async workspace(): Promise<WorkspaceState> {
    const computers = await this.listComputers();
    return {
      selectedComputer: this.selected,
      pendingApproval: this.waiter?.approval ?? null,
      computersRunning: computers.filter((c) => c.status === "running").length,
      mode: "live",
      activityHead: this.activity.slice(0, 40),
      recordingComputerId: this.recording?.computerId ?? null,
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
    // Seed a saved home archive if requested (user work only; excludes the
    // browser profile so it can't clobber a running Chromium). A restore that
    // was asked for but fails must NOT silently yield a blank computer — tear
    // the fresh container down and report, so the caller knows.
    if (spec.restoreArchiveId) {
      try {
        if (!this.host.restoreHome) {
          throw new HttpError(400, { error: "restore not supported here" });
        }
        const bytes = await getArchiveBytes(spec.restoreArchiveId);
        if (!bytes) {
          throw new HttpError(404, { error: "archive not found" });
        }
        await this.host.restoreHome(record.id, bytes);
      } catch (err) {
        await this.host.destroy(record.id).catch(() => undefined);
        if (err instanceof HttpError) throw err;
        throw new HttpError(502, {
          error: `restore failed: ${
            err instanceof Error ? err.message : "unknown"
          }`,
        });
      }
    }
    this.pushActivity(actor, record.id, "spawned", record.id);
    if (!this.selected) {
      this.selected = record.id;
      this.emit({ type: "selection", computerId: record.id });
    }
    this.emit({ type: "computer", computer: publicComputer(record) });
    return publicComputer(record);
  }

  async listArchives(): Promise<HomeArchive[]> {
    return listArchives();
  }

  async deleteArchive(id: string): Promise<{ id: string }> {
    await deleteArchive(id);
    return { id };
  }

  private readonly DESTROY_PLAIN = "Destroy";
  private readonly DESTROY_SAVE = "Destroy and save files";

  async destroy(id: ComputerId, actor: Actor): Promise<unknown> {
    const rec = this.host.record(id);
    if (!rec) {
      throw new HttpError(404, { error: "unknown computer" });
    }
    if (this.waiter) {
      throw new HttpError(409, { error: "approval already pending" });
    }
    const canArchive = Boolean(this.host.archiveHome);
    const approval: Approval = {
      id: crypto.randomUUID(),
      computerId: id,
      tool: "destroy_computer",
      summary: "destroy computer",
      title: "Delete this computer?",
      body: canArchive
        ? `${id} will be removed. You can save its files first to restore them into a future computer.`
        : `${id} and everything on it will be removed. This cannot be undone.`,
      command: `destroy ${id}`,
      options: canArchive
        ? [this.DESTROY_PLAIN, this.DESTROY_SAVE]
        : undefined,
      status: "pending",
    };
    this.lastChoice = null;
    const decision = await this.waitForApproval(approval);
    if (decision === "rejected") {
      this.pushActivity(actor, id, "rejected", id);
      return { success: false, reason: "User rejected the operation." };
    }
    if (decision === "timeout") {
      this.pushActivity("system", id, "timed out", id);
      return { success: false, reason: "Approval timed out." };
    }

    const save = this.lastChoice === this.DESTROY_SAVE;
    this.lastChoice = null;
    let archived: HomeArchive | null = null;
    if (save && this.host.archiveHome) {
      try {
        archived = await this.createArchive(id, rec.name);
      } catch (err) {
        // Don't silently lose files: abort the destroy and report.
        this.pushActivity("system", id, "archive failed", id);
        return {
          success: false,
          reason: `Could not save files: ${
            err instanceof Error ? err.message : "archive failed"
          }. Computer was NOT destroyed.`,
        };
      }
    }

    await this.host.destroy(id);
    this.pushActivity(actor, id, "destroyed", id);
    // A live recording on the destroyed computer is no longer replayable.
    if (this.recording?.computerId === id) this.discardRecording();
    if (this.selected === id) {
      this.selected = this.host.list()[0]?.id ?? null;
    }
    this.emit({ type: "selection", computerId: this.selected });
    return { success: true, id, archived: archived?.id ?? null };
  }

  private async createArchive(
    id: ComputerId,
    name: string,
  ): Promise<HomeArchive> {
    if (!this.host.archiveHome) {
      throw new HttpError(400, { error: "archives not supported" });
    }
    const bytes = await this.host.archiveHome(
      id,
      ARCHIVE_EXCLUDES,
      ARCHIVE_CAP_BYTES,
    );
    return putArchive(crypto.randomUUID(), name, id, bytes);
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

    // replayAction can arrive here directly via POST /api/act (not only through
    // replayRecordedAction), so the recipe gate MUST live here — a nested
    // `run: rm -rf ~` would otherwise reach the bridge unscanned. Policy: a
    // human clicking Replay runs immediately (honor system, like the rest of
    // the page — intentional even for recorded gated ops); an agent replay
    // takes one approval listing the gated ops + typed text. The bridge runs
    // the steps without re-prompting once approved.
    if (op.op === "replayAction" && actor !== "human") {
      const gated = this.gatedSteps(op.steps);
      if (gated.length > 0) {
        if (this.waiter) {
          throw new HttpError(409, { error: "approval already pending" });
        }
        const approval: Approval = {
          id: crypto.randomUUID(),
          computerId,
          tool: "replay_recorded_action",
          summary: "replay recipe",
          title: `Replay ${op.steps.length} recorded actions?`,
          body:
            `This replay includes actions that need approval:\n` +
            gated.map((g) => `• ${g}`).join("\n"),
          status: "pending",
        };
        const decision = await this.waitForApproval(approval);
        if (decision !== "approved") {
          this.pushActivity(
            decision === "timeout" ? "system" : actor,
            computerId,
            decision === "timeout" ? "timed out" : "rejected",
            "replay",
          );
          return { success: false, reason: "User rejected the operation." };
        }
      }
    }

    const tape = TAPE_OPS.has(op.op);
    const wantShots = tape && !SHOT_SKIP_OPS.has(op.op);
    const eventId = crypto.randomUUID();
    const useBrowser = BROWSER_SHOT_OPS.has(op.op);

    // Capture the before-shot *before* dispatch (semantics require it) but never
    // block on the upload: hold the buffer and enqueue the put off the request
    // path so storage latency/outage can't slow or fail the operation.
    let before = false;
    if (wantShots) {
      const buf = await grabShotBounded(machine, useBrowser);
      if (buf) {
        before = true;
        enqueueTape(async () => {
          await putShot(computerId, eventId, "before", buf);
        });
      }
    }

    let result: unknown;
    const t0 = Date.now();
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
          durationMs: Date.now() - t0,
        };
        // Emit optimistically; persist off the request path.
        this.emit({ type: "tape", event: ev });
        enqueueTape(async () => {
          await appendEvent(ev);
        });
      }
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, { error: "bridge unreachable" });
    }

    if (tape) {
      let after = false;
      if (wantShots) {
        const buf = await grabShotBounded(machine, useBrowser);
        if (buf) {
          after = true;
          enqueueTape(async () => {
            await putShot(computerId, eventId, "after", buf);
          });
        }
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
        durationMs: Date.now() - t0,
      };
      // The desktop already mutated: emit + persist without ever throwing back
      // to the caller (which would make the agent retry a non-idempotent op).
      this.emit({ type: "tape", event: ev });
      enqueueTape(async () => {
        await appendEvent(ev);
      });
    }

    const mut = mutation(op);
    if (mut) this.pushActivity(actor, computerId, mut.verb, mut.detail);

    // If a recording is live on this computer, capture the agent op into it
    // (skip replay itself; reads/snapshot never reach here as mutations).
    if (
      mut &&
      op.op !== "replayAction" &&
      this.recording &&
      this.recording.computerId === computerId
    ) {
      this.appendRecordingStep({
        kind: "op",
        op,
        label: mut.detail,
        t: Date.now() - this.recording.t0,
      });
    }
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
    this.emit({ type: "computer", computer: publicComputer(rec) });
    return publicComputer(rec);
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

  // --- Recipes (Teach & Replay) ---

  async listActions(): Promise<RecordedAction[]> {
    return listActions();
  }

  async getRecordedAction(id: string): Promise<RecordedAction | null> {
    return getAction(id);
  }

  async deleteRecordedAction(id: string): Promise<{ id: string }> {
    await deleteAction(id);
    return { id };
  }

  // Human-readable list of steps that would require approval to run.
  private gatedSteps(steps: RecipeStep[]): string[] {
    const gated: string[] = [];
    for (const s of steps) {
      if (s.kind === "op") {
        const op = s.op;
        if (op.op === "run" && requiresApproval(op.command)) {
          gated.push(`run: ${op.command}`);
        } else if (op.op === "deleteFile") {
          gated.push(`delete: ${op.path}`);
        } else if (op.op === "killProcess") {
          gated.push(`kill pid ${op.pid}`);
        } else if (op.op === "installPackage") {
          gated.push(`install: ${op.name}`);
        }
      } else if (s.kind === "type") {
        // Recorded keystrokes can't be scanned for danger — surface the text
        // so the human sees e.g. "rm -rf ~" before approving an agent replay.
        const text = s.text.length > 60 ? `${s.text.slice(0, 60)}…` : s.text;
        gated.push(`type: ${text}`);
      } else if (s.kind === "key") {
        gated.push(`key: ${s.keys}`);
      } else if (s.kind === "click" || s.kind === "drag" || s.kind === "scroll") {
        gated.push(`input: ${s.kind}`);
      }
    }
    return gated;
  }

  private async approveRecipe(
    computerId: ComputerId,
    title: string,
    gated: string[],
  ): Promise<"approved" | "rejected" | "timeout"> {
    if (gated.length === 0) return "approved";
    if (this.waiter) {
      throw new HttpError(409, { error: "approval already pending" });
    }
    const approval: Approval = {
      id: crypto.randomUUID(),
      computerId,
      tool: "replay_recorded_action",
      summary: title,
      title,
      body:
        `This recipe includes actions that need approval:\n` +
        gated.map((g) => `• ${g}`).join("\n"),
      status: "pending",
    };
    return this.waitForApproval(approval);
  }

  // Promote the last N mutating tape events for the selected computer into a
  // saved recipe. The human is present (they clicked "Save as action").
  async promoteRecent(
    n: number,
    name: string,
    description: string,
  ): Promise<RecordedAction> {
    if (!this.selected) {
      throw new HttpError(409, { error: "no computer selected" });
    }
    const computerId = this.selected;
    const all = await listTape();
    const recent = all
      .filter(
        (e) => e.computerId === computerId && mutation(e.input as MachineOp),
      )
      .slice(0, Math.max(1, Math.min(n, 100)))
      .reverse(); // chronological
    const steps: RecipeStep[] = recent.map((e) => ({
      kind: "op",
      op: e.input as MachineOp,
      label: e.detail,
    }));
    if (steps.length === 0) {
      throw new HttpError(400, { error: "no recent actions to save" });
    }
    // Promote is a human act (the "Save as action" button) — runs free, like a
    // human replay. Agent-authored saves are gated in saveRecordedAction.
    const action: RecordedAction = {
      id: crypto.randomUUID(),
      name: name.trim() || "recipe",
      description: description.trim(),
      steps,
      source: "tape",
      computerId,
      createdAt: new Date().toISOString(),
    };
    await saveAction(action);
    return action;
  }

  // Save an authored recipe. If it contains gated ops, require the same
  // approval as replay — a stored `run: rm` is a stored exploit.
  async saveRecordedAction(
    input: { name: string; description?: string; steps: RecipeStep[] },
    actor: Actor,
  ): Promise<RecordedAction | { rejected: true; reason: string }> {
    const steps = Array.isArray(input.steps) ? input.steps : [];
    if (steps.length === 0) {
      throw new HttpError(400, { error: "steps required" });
    }
    const computerId = this.selected ?? this.host.list()[0]?.id;
    // Agent-authored recipes with a gated step are a stored exploit → one
    // approval. A human authoring runs free (same split as replay).
    const gated = actor === "human" ? [] : this.gatedSteps(steps);
    if (gated.length > 0 && computerId) {
      const decision = await this.approveRecipe(
        computerId,
        `Save recipe "${input.name}"?`,
        gated,
      );
      if (decision !== "approved") {
        return { rejected: true, reason: "Approval required to save this recipe." };
      }
    }
    const action: RecordedAction = {
      id: crypto.randomUUID(),
      name: input.name.trim() || "recipe",
      description: (input.description ?? "").trim(),
      steps,
      source: "authored",
      computerId: computerId ?? undefined,
      createdAt: new Date().toISOString(),
    };
    await saveAction(action);
    return action;
  }

  // Replay a saved recipe on the selected computer: one approval for all gated
  // steps, then one replayAction op (one tape event, executed in-guest).
  async replayRecordedAction(
    idOrName: { actionId?: string; name?: string },
    speed: number,
    actor: Actor,
  ): Promise<unknown> {
    if (!this.selected) {
      throw new HttpError(409, { error: "no computer selected" });
    }
    let action: RecordedAction | null = null;
    if (idOrName.actionId) {
      action = await getAction(idOrName.actionId);
    } else if (idOrName.name) {
      const all = await listActions();
      action = all.find((a) => a.name === idOrName.name) ?? null;
    }
    if (!action) throw new HttpError(404, { error: "recipe not found" });

    // Gating happens inside act() (so the raw /api/act path is covered too):
    // one approval for the whole recipe, one tape event, executed in-guest.
    return this.act(
      { op: "replayAction", steps: action.steps, speed },
      actor,
    );
  }

  // --- Live recording (viewer human input + agent ops, one server clock) ---

  private static readonly RECORD_MAX_MS = 10 * 60_000;
  private static readonly RECORD_MAX_STEPS = 2000;

  recordStart(
    actor: Actor = "human",
  ): { computerId: ComputerId; startedAt: number } {
    if (actor !== "human") {
      throw new HttpError(403, { error: "recording is human-only" });
    }
    if (this.recording) {
      throw new HttpError(409, { error: "already recording" });
    }
    if (!this.selected) {
      throw new HttpError(409, { error: "no computer selected" });
    }
    const rec = this.host.record(this.selected);
    if (!rec || rec.status !== "running") {
      throw new HttpError(409, { error: "selected computer is not running" });
    }
    const t0 = Date.now();
    const timer = setTimeout(
      () => this.discardRecording(),
      Plane.RECORD_MAX_MS,
    );
    timer.unref?.();
    this.recording = { computerId: this.selected, t0, steps: [], timer };
    this.emit({ type: "recording", computerId: this.selected });
    return { computerId: this.selected, startedAt: t0 };
  }

  // Append a viewer-normalized input step. The API stamps `t` on accept so a
  // single clock orders human and agent steps; any client `t`/computerId is
  // ignored. There is exactly one active session.
  recordEvent(raw: unknown, actor: Actor = "human"): { stepCount: number } {
    if (actor !== "human") {
      throw new HttpError(403, { error: "recording is human-only" });
    }
    if (!this.recording) {
      throw new HttpError(409, { error: "not recording" });
    }
    const step = sanitizeRecordStep(raw);
    if (!step) {
      throw new HttpError(400, { error: "invalid record step" });
    }
    this.appendRecordingStep({
      ...step,
      t: Date.now() - this.recording.t0,
    });
    return { stepCount: this.recording?.steps.length ?? 0 };
  }

  private appendRecordingStep(step: RecipeStep): void {
    if (!this.recording) return;
    this.recording.steps.push(step);
    if (this.recording.steps.length >= Plane.RECORD_MAX_STEPS) {
      this.discardRecording();
    }
  }

  recordStatus(): {
    recording: boolean;
    computerId: ComputerId | null;
    startedAt: number | null;
    stepCount: number;
  } {
    return {
      recording: !!this.recording,
      computerId: this.recording?.computerId ?? null,
      startedAt: this.recording?.t0 ?? null,
      stepCount: this.recording?.steps.length ?? 0,
    };
  }

  async recordStop(
    name: string,
    description: string,
    actor: Actor = "human",
  ): Promise<RecordedAction> {
    if (actor !== "human") {
      throw new HttpError(403, { error: "recording is human-only" });
    }
    if (!this.recording) {
      throw new HttpError(409, { error: "not recording" });
    }
    const { computerId, steps, timer } = this.recording;
    clearTimeout(timer);
    this.recording = null;
    this.emit({ type: "recording", computerId: null });
    if (steps.length === 0) {
      throw new HttpError(400, { error: "nothing was recorded" });
    }
    const action: RecordedAction = {
      id: crypto.randomUUID(),
      name: name.trim() || "recording",
      description: description.trim(),
      steps,
      source: "recorded",
      computerId,
      createdAt: new Date().toISOString(),
    };
    await saveAction(action);
    return action;
  }

  // Drop an in-progress recording (cap hit, computer destroyed, shutdown).
  discardRecording(): void {
    if (!this.recording) return;
    clearTimeout(this.recording.timer);
    this.recording = null;
    this.emit({ type: "recording", computerId: null });
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
    case "replayAction":
      return { verb: "replayed", detail: `${op.steps.length} steps` };
    default:
      return null;
  }
}
