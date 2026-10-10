/**
 * In-memory fake Supabase-shaped client for Build 09.13 durable integration unit tests.
 * Not a production adapter. Simulates missing-schema and RLS-ish owner filters.
 */

type Row = Record<string, unknown>;

type TableState = {
  rows: Row[];
};

export type FakeDbOptions = {
  /** When true, table operations fail as missing schema. */
  missingTables?: Set<string>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createDurableFakeSupabase(options?: FakeDbOptions) {
  const tables = new Map<string, TableState>();
  const missing = options?.missingTables ?? new Set<string>();

  function table(name: string): TableState {
    if (!tables.has(name)) tables.set(name, { rows: [] });
    return tables.get(name)!;
  }

  function failMissing(name: string) {
    return {
      data: null,
      error: { message: `relation "${name}" does not exist`, code: "42P01" },
    };
  }

  type Filter = { column: string; op: "eq" | "is"; value: unknown };

  class Query {
    private filters: Filter[] = [];
    private orderBy: { column: string; ascending: boolean } | null = null;
    private limitN: number | null = null;
    private mode: "select" | "insert" | "update" = "select";
    private payload: Row | Row[] | null = null;
    private wantSingle = false;
    private wantMaybe = false;
    private selectCols = "*";

    constructor(private readonly name: string) {}

    select(cols = "*") {
      this.selectCols = cols;
      return this;
    }

    insert(row: Row | Row[]) {
      this.mode = "insert";
      this.payload = row;
      return this;
    }

    update(row: Row) {
      this.mode = "update";
      this.payload = row;
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push({ column, op: "eq", value });
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.push({ column, op: "is", value });
      return this;
    }

    order(column: string, opts?: { ascending?: boolean }) {
      this.orderBy = { column, ascending: opts?.ascending !== false };
      return this;
    }

    limit(n: number) {
      this.limitN = n;
      return this;
    }

    single() {
      this.wantSingle = true;
      return this.execute();
    }

    maybeSingle() {
      this.wantMaybe = true;
      return this.execute();
    }

    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return this.execute().then(resolve, reject);
    }

    private matches(row: Row): boolean {
      return this.filters.every((f) => {
        const current = row[f.column];
        if (f.op === "is") {
          if (f.value === null) return current == null;
          return current === f.value;
        }
        return current === f.value;
      });
    }

    private async execute() {
      if (missing.has(this.name)) return failMissing(this.name);
      const state = table(this.name);

      if (this.mode === "insert") {
        const incoming = Array.isArray(this.payload) ? this.payload : [this.payload!];
        const created = incoming.map((row) => {
          const baseDefaults: Row =
            this.name === "founder_action_authorizations"
              ? {
                  decision_id: null,
                  decided_at: null,
                  decided_by: null,
                  revoked_at: null,
                  revoked_by: null,
                  revoke_reason: "",
                  consumed_at: null,
                  use_count: 0,
                  max_uses: null,
                  status: "PENDING",
                }
              : this.name === "agent_tasks"
                ? {
                    lease_holder_id: null,
                    lease_token: null,
                    lease_expires_at: null,
                    checkpoint_sequence: 0,
                    last_checkpoint_id: null,
                    last_step_idempotency_key: "",
                    block_reason: "",
                    authorization_consumed: false,
                    claimed_at: null,
                    completed_at: null,
                  }
                : this.name === "remote_development_tasks"
                  ? {
                      agent_task_id: null,
                      external_job_id: null,
                      evidence: null,
                      last_error: null,
                      queued_at: null,
                      started_at: null,
                      completed_at: null,
                      deployment_authorized: false,
                    }
                  : {};
          const next: Row = {
            ...baseDefaults,
            ...clone(row),
            id: (row.id as string) ?? crypto.randomUUID(),
            created_at: (row.created_at as string) ?? new Date().toISOString(),
            updated_at: (row.updated_at as string) ?? new Date().toISOString(),
            requested_at: (row.requested_at as string) ?? new Date().toISOString(),
          };
          // Unique constraints we care about
          if (this.name === "founder_action_authorizations") {
            const dup = state.rows.find(
              (r) =>
                r.owner_id === next.owner_id && r.idempotency_key === next.idempotency_key,
            );
            if (dup) {
              return { duplicate: true as const, row: dup };
            }
          }
          if (this.name === "remote_development_tasks") {
            const dup = state.rows.find(
              (r) =>
                r.owner_id === next.owner_id && r.idempotency_key === next.idempotency_key,
            );
            if (dup) {
              return { duplicate: true as const, row: dup };
            }
            // Link guard
            if (next.agent_task_id) {
              const agent = table("agent_tasks").rows.find((r) => r.id === next.agent_task_id);
              if (!agent) {
                return {
                  error: {
                    message: "remote development agent_task_id does not reference an existing agent task",
                    code: "23503",
                  },
                };
              }
              if (
                agent.owner_id !== next.owner_id ||
                agent.project_id !== next.project_id ||
                agent.authorization_id !== next.authorization_id ||
                agent.authorization_kind !== "DEVELOPMENT"
              ) {
                return {
                  error: {
                    message: "remote development agent_task_id must match owner, project, and authorization",
                    code: "42501",
                  },
                };
              }
            }
          }
          if (this.name === "agent_tasks") {
            const dup = state.rows.find(
              (r) =>
                r.owner_id === next.owner_id && r.idempotency_key === next.idempotency_key,
            );
            if (dup) {
              return { duplicate: true as const, row: dup };
            }
          }
          state.rows.push(next);
          return { duplicate: false as const, row: next };
        });

        const errored = created.find((c) => "error" in c && c.error);
        if (errored && "error" in errored) {
          return { data: null, error: errored.error };
        }
        const dup = created.find((c) => "duplicate" in c && c.duplicate);
        if (dup && "duplicate" in dup && dup.duplicate) {
          return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        }
        const rows = created.map((c) => ("row" in c ? c.row : null)).filter(Boolean) as Row[];
        if (this.wantSingle || this.wantMaybe) {
          return { data: enrich(this.name, rows[0]!), error: null };
        }
        return { data: rows.map((r) => enrich(this.name, r)), error: null };
      }

      if (this.mode === "update") {
        const targets = state.rows.filter((r) => this.matches(r));
        if (targets.length === 0) {
          return this.wantMaybe || this.wantSingle
            ? { data: null, error: null }
            : { data: [], error: null };
        }
        for (const target of targets) {
          const patch = clone(this.payload as Row);
          // Simulate CAS consume predicates already in filters.
          if (this.name === "remote_development_tasks" && patch.agent_task_id) {
            const agent = table("agent_tasks").rows.find((r) => r.id === patch.agent_task_id);
            if (!agent) {
              return {
                data: null,
                error: {
                  message: "remote development agent_task_id does not reference an existing agent task",
                  code: "23503",
                },
              };
            }
            if (
              agent.owner_id !== target.owner_id ||
              agent.project_id !== target.project_id ||
              agent.authorization_id !== target.authorization_id
            ) {
              return {
                data: null,
                error: {
                  message: "remote development agent_task_id must match owner, project, and authorization",
                  code: "42501",
                },
              };
            }
            if (target.agent_task_id && target.agent_task_id !== patch.agent_task_id) {
              return {
                data: null,
                error: {
                  message: "remote development agent_task_id cannot be reassigned",
                  code: "42501",
                },
              };
            }
          }
          Object.assign(target, patch, { updated_at: new Date().toISOString() });
        }
        const out = targets.map((r) => enrich(this.name, r));
        if (this.wantSingle) return { data: out[0] ?? null, error: out[0] ? null : { message: "not found" } };
        if (this.wantMaybe) return { data: out[0] ?? null, error: null };
        return { data: out, error: null };
      }

      // select
      let rows = state.rows.filter((r) => this.matches(r)).map((r) => enrich(this.name, r));
      if (this.orderBy) {
        const { column, ascending } = this.orderBy;
        rows = [...rows].sort((a, b) => {
          const av = String(a[column] ?? "");
          const bv = String(b[column] ?? "");
          return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (this.limitN != null) rows = rows.slice(0, this.limitN);
      void this.selectCols;
      if (this.wantSingle) {
        return rows[0]
          ? { data: rows[0], error: null }
          : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
      }
      if (this.wantMaybe) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }
  }

  function enrich(name: string, row: Row): Row {
    if (name === "remote_development_tasks" || name === "agent_tasks") {
      const project = table("projects").rows.find((p) => p.id === row.project_id);
      return {
        ...clone(row),
        projects: project ? { name: project.name } : { name: "Project" },
      };
    }
    return clone(row);
  }

  const client = {
    from(name: string) {
      return new Query(name);
    },
    __seed(name: string, rows: Row[]) {
      table(name).rows.push(...rows.map((r) => clone(r)));
    },
    __dump(name: string) {
      return clone(table(name).rows);
    },
  };

  return client;
}

export type DurableFakeSupabase = ReturnType<typeof createDurableFakeSupabase>;
