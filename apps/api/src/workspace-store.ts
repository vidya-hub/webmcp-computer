// Per-user workspace state: selection, the pending approval DTO, last choice,
// recent activity, and the live recording (metadata + steps). This is the state
// that used to be process-global singletons on Plane; keying it by userId is
// what makes the control plane multi-tenant.
//
// Two backends behind one interface: MemoryWorkspace (tests + dev, no Redis) and
// RedisWorkspace (production, replica-safe). The approval *Promise* (the parked
// /api/act request) is NOT here — it stays a process-local Map on Plane; only
// the serializable Approval DTO lives in the store so any replica can render it
// and so it survives on Redis.

import type {
  ActivityEvent,
  Approval,
  ComputerId,
  RecipeStep,
} from "@webmcp-computer/contract";

export const ACTIVITY_CAP = 100;
export const RECORD_MAX_STEPS = 2000;
export const RECORD_TTL_MS = 10 * 60_000;

export interface RecordingMeta {
  computerId: ComputerId;
  t0: number;
}

export interface WorkspaceStore {
  getSelected(userId: string): Promise<ComputerId | null>;
  setSelected(userId: string, id: ComputerId | null): Promise<void>;

  getApproval(userId: string): Promise<Approval | null>;
  setApproval(userId: string, approval: Approval | null): Promise<void>;

  getLastChoice(userId: string): Promise<string | null>;
  setLastChoice(userId: string, choice: string | null): Promise<void>;

  getActivity(userId: string): Promise<ActivityEvent[]>;
  pushActivity(userId: string, event: ActivityEvent): Promise<void>;

  getRecording(userId: string): Promise<RecordingMeta | null>;
  startRecording(userId: string, computerId: ComputerId, t0: number): Promise<void>;
  /** Append one step; returns the new step count (caller stops at the cap). */
  appendStep(userId: string, step: RecipeStep): Promise<number>;
  getSteps(userId: string): Promise<RecipeStep[]>;
  /** Clear recording metadata + steps. */
  clearRecording(userId: string): Promise<void>;
}

// --- In-memory backend (tests, dev) ---------------------------------------

interface MemSession {
  selected: ComputerId | null;
  approval: Approval | null;
  lastChoice: string | null;
  activity: ActivityEvent[];
  recording: RecordingMeta | null;
  steps: RecipeStep[];
}

export class MemoryWorkspace implements WorkspaceStore {
  private sessions = new Map<string, MemSession>();

  private s(userId: string): MemSession {
    let s = this.sessions.get(userId);
    if (!s) {
      s = {
        selected: null,
        approval: null,
        lastChoice: null,
        activity: [],
        recording: null,
        steps: [],
      };
      this.sessions.set(userId, s);
    }
    return s;
  }

  async getSelected(u: string) {
    return this.s(u).selected;
  }
  async setSelected(u: string, id: ComputerId | null) {
    this.s(u).selected = id;
  }
  async getApproval(u: string) {
    return this.s(u).approval;
  }
  async setApproval(u: string, a: Approval | null) {
    this.s(u).approval = a;
  }
  async getLastChoice(u: string) {
    return this.s(u).lastChoice;
  }
  async setLastChoice(u: string, c: string | null) {
    this.s(u).lastChoice = c;
  }
  async getActivity(u: string) {
    return this.s(u).activity;
  }
  async pushActivity(u: string, e: ActivityEvent) {
    const s = this.s(u);
    s.activity = [e, ...s.activity].slice(0, ACTIVITY_CAP);
  }
  async getRecording(u: string) {
    return this.s(u).recording;
  }
  async startRecording(u: string, computerId: ComputerId, t0: number) {
    const s = this.s(u);
    s.recording = { computerId, t0 };
    s.steps = [];
  }
  async appendStep(u: string, step: RecipeStep) {
    const s = this.s(u);
    s.steps.push(step);
    return s.steps.length;
  }
  async getSteps(u: string) {
    return this.s(u).steps;
  }
  async clearRecording(u: string) {
    const s = this.s(u);
    s.recording = null;
    s.steps = [];
  }
}

// --- Redis backend (production) -------------------------------------------

// The scalar fields live in ONE Redis hash per user, written with atomic
// per-field HSET/HDEL (never read-modify-write of a whole JSON doc — that would
// race two concurrent writers). The append-heavy activity feed and recording
// steps are Redis lists. Only the steps list carries a TTL, so a later
// selected/approval write can't clobber the recording's expiry.

interface RedisLike {
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<number>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  del(...keys: string[]): Promise<unknown>;
  lpush(key: string, value: string): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  rpush(key: string, value: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
}

export class RedisWorkspace implements WorkspaceStore {
  constructor(private readonly redis: RedisLike) {}

  private wsKey(u: string) {
    return `ws:${u}`;
  }
  private actKey(u: string) {
    return `act:${u}`;
  }
  private recKey(u: string) {
    return `rec:${u}:steps`;
  }

  private async setField(u: string, field: string, value: string | null) {
    if (value === null) await this.redis.hdel(this.wsKey(u), field);
    else await this.redis.hset(this.wsKey(u), field, value);
  }
  private async getJson<T>(u: string, field: string): Promise<T | null> {
    const raw = await this.redis.hget(this.wsKey(u), field);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async getSelected(u: string) {
    return (await this.redis.hget(this.wsKey(u), "selected")) as
      | ComputerId
      | null;
  }
  async setSelected(u: string, id: ComputerId | null) {
    await this.setField(u, "selected", id);
  }
  async getApproval(u: string) {
    return this.getJson<Approval>(u, "approval");
  }
  async setApproval(u: string, a: Approval | null) {
    await this.setField(u, "approval", a === null ? null : JSON.stringify(a));
  }
  async getLastChoice(u: string) {
    return this.redis.hget(this.wsKey(u), "lastChoice");
  }
  async setLastChoice(u: string, c: string | null) {
    await this.setField(u, "lastChoice", c);
  }

  async getActivity(u: string) {
    const raw = await this.redis.lrange(this.actKey(u), 0, ACTIVITY_CAP - 1);
    return raw.map((r) => JSON.parse(r) as ActivityEvent);
  }
  async pushActivity(u: string, e: ActivityEvent) {
    await this.redis.lpush(this.actKey(u), JSON.stringify(e));
    await this.redis.ltrim(this.actKey(u), 0, ACTIVITY_CAP - 1);
  }

  async getRecording(u: string) {
    const rec = await this.getJson<RecordingMeta>(u, "recording");
    // The hash field carries no TTL (only rec:{u}:steps does), so a crashed or
    // abandoned session could leave stale metadata. Past the record cap it is
    // no longer a live recording — clear it and report idle.
    if (rec && Date.now() - rec.t0 > RECORD_TTL_MS) {
      await this.setField(u, "recording", null);
      return null;
    }
    return rec;
  }
  async startRecording(u: string, computerId: ComputerId, t0: number) {
    await this.redis.del(this.recKey(u));
    await this.setField(u, "recording", JSON.stringify({ computerId, t0 }));
  }
  async appendStep(u: string, step: RecipeStep) {
    const n = await this.redis.rpush(this.recKey(u), JSON.stringify(step));
    // TTL on the steps list only — never on the shared ws hash.
    await this.redis.pexpire(this.recKey(u), RECORD_TTL_MS);
    return n;
  }
  async getSteps(u: string) {
    const raw = await this.redis.lrange(this.recKey(u), 0, RECORD_MAX_STEPS - 1);
    return raw.map((r) => JSON.parse(r) as RecipeStep);
  }
  async clearRecording(u: string) {
    await this.redis.del(this.recKey(u));
    await this.setField(u, "recording", null);
  }
}
