import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { JulesClient } from "../../src/tool/jules/client"
import { JulesTool } from "../../src/tool/jules/jules"
import { Env } from "../../src/env"
import type { PermissionNext } from "../../src/permission/next"

const projectRoot = path.join(__dirname, "../..")

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

// Helper to create a mock fetch response
function mockFetchResponse(body: unknown, status = 200) {
  return mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  ) as any as typeof globalThis.fetch &
    ReturnType<typeof mock<() => Promise<Response>>>
}

function mockFetchError(status: number, text: string) {
  return mock(() =>
    Promise.resolve(
      new Response(text, {
        status,
        headers: { "Content-Type": "text/plain" },
      }),
    ),
  ) as any as typeof globalThis.fetch &
    ReturnType<typeof mock<() => Promise<Response>>>
}

function callArgs(fn: ReturnType<typeof mock>, index = 0): [string, RequestInit] {
  return fn.mock.calls[index] as unknown as [string, RequestInit]
}

describe("jules.client", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("uses correct base URL", () => {
    expect(JulesClient.BASE_URL).toBe("https://jules.googleapis.com/v1alpha")
  })

  describe("getApiKey", () => {
    test("reads from JULES_API_KEY env var", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key-123")
          const key = await JulesClient.getApiKey()
          expect(key).toBe("test-key-123")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("throws when no API key found", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.remove("JULES_API_KEY")
          await expect(JulesClient.getApiKey()).rejects.toThrow("Jules API key not found")
        },
      })
    })
  })

  describe("request", () => {
    test("sends correct headers and URL", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-api-key")
          const fetchMock = mockFetchResponse({ sources: [] })
          globalThis.fetch = fetchMock

          await JulesClient.listSources()

          expect(fetchMock).toHaveBeenCalledTimes(1)
          const [url, options] = callArgs(fetchMock)
          expect(url).toBe("https://jules.googleapis.com/v1alpha/sources")
          expect(options.headers).toEqual({
            "X-Goog-Api-Key": "test-api-key",
            "Content-Type": "application/json",
          })
          expect(options.method).toBe("GET")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("throws on non-OK response", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-api-key")
          globalThis.fetch = mockFetchError(403, "Forbidden")

          await expect(JulesClient.listSources()).rejects.toThrow("Jules API error (403): Forbidden")
          Env.remove("JULES_API_KEY")
        },
      })
    })
  })

  describe("listSources", () => {
    test("returns sources array", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          globalThis.fetch = mockFetchResponse({
            sources: [
              { name: "sources/123", id: "123", githubRepo: { owner: "acme", repo: "app" } },
              { name: "sources/456", id: "456", githubRepo: { owner: "acme", repo: "lib" } },
            ],
          })

          const sources = await JulesClient.listSources()
          expect(sources).toHaveLength(2)
          expect(sources[0].name).toBe("sources/123")
          expect(sources[0].githubRepo?.owner).toBe("acme")
          expect(sources[0].githubRepo?.repo).toBe("app")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("returns empty array when no sources", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          globalThis.fetch = mockFetchResponse({})

          const sources = await JulesClient.listSources()
          expect(sources).toHaveLength(0)
          Env.remove("JULES_API_KEY")
        },
      })
    })
  })

  describe("createSession", () => {
    test("sends correct request body with all fields", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const fetchMock = mockFetchResponse({
            name: "sessions/abc",
            id: "abc",
            title: "Fix bug",
            state: "PLANNING",
          })
          globalThis.fetch = fetchMock

          await JulesClient.createSession({
            prompt: "Fix the login bug",
            sourceContext: {
              source: "sources/123",
              githubRepoContext: { startingBranch: "main" },
            },
            title: "Fix bug",
            automationMode: "AUTO_CREATE_PR",
            requirePlanApproval: true,
          })

          const [url, options] = callArgs(fetchMock)
          expect(url).toBe("https://jules.googleapis.com/v1alpha/sessions")
          expect(options.method).toBe("POST")
          const body = JSON.parse(options.body as string)
          expect(body.prompt).toBe("Fix the login bug")
          expect(body.sourceContext.source).toBe("sources/123")
          expect(body.sourceContext.githubRepoContext.startingBranch).toBe("main")
          expect(body.automationMode).toBe("AUTO_CREATE_PR")
          expect(body.requirePlanApproval).toBe(true)
          expect(body.title).toBe("Fix bug")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("returns session with outputs", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          globalThis.fetch = mockFetchResponse({
            name: "sessions/abc",
            id: "abc",
            title: "Fix bug",
            state: "COMPLETED",
            outputs: [{ pullRequest: { url: "https://github.com/acme/app/pull/1", title: "Fix login" } }],
          })

          const session = await JulesClient.createSession({
            prompt: "Fix bug",
            sourceContext: { source: "sources/123" },
          })
          expect(session.name).toBe("sessions/abc")
          expect(session.id).toBe("abc")
          expect(session.state).toBe("COMPLETED")
          expect(session.outputs?.[0].pullRequest?.url).toBe("https://github.com/acme/app/pull/1")
          Env.remove("JULES_API_KEY")
        },
      })
    })
  })

  describe("listSessions", () => {
    test("sends pageSize query parameter", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const fetchMock = mockFetchResponse({ sessions: [] })
          globalThis.fetch = fetchMock

          await JulesClient.listSessions(5)

          const [url] = callArgs(fetchMock)
          expect(url).toBe("https://jules.googleapis.com/v1alpha/sessions?pageSize=5")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("omits pageSize when not provided", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const fetchMock = mockFetchResponse({ sessions: [] })
          globalThis.fetch = fetchMock

          await JulesClient.listSessions()

          const [url] = callArgs(fetchMock)
          expect(url).toBe("https://jules.googleapis.com/v1alpha/sessions")
          Env.remove("JULES_API_KEY")
        },
      })
    })
  })

  describe("getSessionActivities", () => {
    test("constructs correct URL with session ID and pageSize", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const fetchMock = mockFetchResponse({
            activities: [{ name: "activities/1", type: "plan", content: "Step 1" }],
          })
          globalThis.fetch = fetchMock

          const activities = await JulesClient.getSessionActivities("sessions/abc", 10)

          const [url] = callArgs(fetchMock)
          expect(url).toBe("https://jules.googleapis.com/v1alpha/sessions/abc/activities?pageSize=10")
          expect(activities).toHaveLength(1)
          expect(activities[0].type).toBe("plan")
          expect(activities[0].content).toBe("Step 1")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("returns empty array when no activities", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          globalThis.fetch = mockFetchResponse({})

          const activities = await JulesClient.getSessionActivities("sessions/abc")
          expect(activities).toHaveLength(0)
          Env.remove("JULES_API_KEY")
        },
      })
    })
  })

  describe("approvePlan", () => {
    test("sends POST to correct endpoint", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const fetchMock = mockFetchResponse({ name: "sessions/abc", state: "EXECUTING" })
          globalThis.fetch = fetchMock

          const session = await JulesClient.approvePlan("sessions/abc")

          const [url, options] = callArgs(fetchMock)
          expect(url).toBe("https://jules.googleapis.com/v1alpha/sessions/abc:approvePlan")
          expect(options.method).toBe("POST")
          expect(session.state).toBe("EXECUTING")
          Env.remove("JULES_API_KEY")
        },
      })
    })
  })

  describe("sendMessage", () => {
    test("sends prompt field in request body (not message)", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const fetchMock = mockFetchResponse({ name: "sessions/abc", state: "EXECUTING" })
          globalThis.fetch = fetchMock

          await JulesClient.sendMessage("sessions/abc", "Please also update the tests")

          const [url, options] = callArgs(fetchMock)
          expect(url).toBe("https://jules.googleapis.com/v1alpha/sessions/abc:sendMessage")
          expect(options.method).toBe("POST")
          const body = JSON.parse(options.body as string)
          expect(body.prompt).toBe("Please also update the tests")
          expect(body.message).toBeUndefined()
          Env.remove("JULES_API_KEY")
        },
      })
    })
  })
})

describe("tool.jules", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("tool has correct id", () => {
    expect(JulesTool.id).toBe("jules")
  })

  describe("permissions", () => {
    test("asks for jules permission with action pattern", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          globalThis.fetch = mockFetchResponse({ sources: [] })

          const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
          const testCtx = {
            ...ctx,
            ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
              requests.push(req)
            },
          }

          const tool = await JulesTool.init()
          await tool.execute({ action: "list_sources" as const }, testCtx)

          expect(requests.length).toBe(1)
          expect(requests[0].permission).toBe("jules")
          expect(requests[0].patterns).toContain("list_sources")
          Env.remove("JULES_API_KEY")
        },
      })
    })
  })

  describe("list_sources", () => {
    test("formats sources with repo info", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          globalThis.fetch = mockFetchResponse({
            sources: [
              { name: "sources/123", id: "123", githubRepo: { owner: "acme", repo: "app" } },
            ],
          })

          const tool = await JulesTool.init()
          const result = await tool.execute({ action: "list_sources" as const }, ctx)

          expect(result.title).toBe("Jules: 1 source(s)")
          expect(result.metadata.action).toBe("list_sources")
          expect(result.metadata.count).toBe(1)
          expect(result.output).toContain("sources/123")
          expect(result.output).toContain("acme/app")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("handles empty sources", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          globalThis.fetch = mockFetchResponse({})

          const tool = await JulesTool.init()
          const result = await tool.execute({ action: "list_sources" as const }, ctx)

          expect(result.title).toBe("Jules: No sources found")
          expect(result.output).toContain("No connected repositories")
          Env.remove("JULES_API_KEY")
        },
      })
    })
  })

  describe("create_session", () => {
    test("creates session with source and branch", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const fetchMock = mockFetchResponse({
            name: "sessions/xyz",
            id: "xyz",
            title: "Fix login",
            state: "PLANNING",
          })
          globalThis.fetch = fetchMock

          const tool = await JulesTool.init()
          const result = await tool.execute(
            {
              action: "create_session" as const,
              prompt: "Fix the login bug",
              source: "sources/123",
              branch: "main",
              title: "Fix login",
              auto_create_pr: true,
            },
            ctx,
          )

          expect(result.title).toBe("Jules: Session created")
          expect(result.metadata.action).toBe("create_session")
          expect(result.metadata.session).toBe("sessions/xyz")
          expect(result.output).toContain("sessions/xyz")
          expect(result.output).toContain("Fix login")

          const body = JSON.parse((callArgs(fetchMock))[1].body as string)
          expect(body.sourceContext.source).toBe("sources/123")
          expect(body.sourceContext.githubRepoContext.startingBranch).toBe("main")
          expect(body.automationMode).toBe("AUTO_CREATE_PR")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("includes PR URL in output when available", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          globalThis.fetch = mockFetchResponse({
            name: "sessions/xyz",
            outputs: [{ pullRequest: { url: "https://github.com/acme/app/pull/42" } }],
          })

          const tool = await JulesTool.init()
          const result = await tool.execute(
            {
              action: "create_session" as const,
              prompt: "Fix bug",
              source: "sources/123",
            },
            ctx,
          )

          expect(result.output).toContain("https://github.com/acme/app/pull/42")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("throws when prompt is missing", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const tool = await JulesTool.init()
          await expect(
            tool.execute({ action: "create_session" as const, source: "sources/123" }, ctx),
          ).rejects.toThrow("'prompt' is required")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("throws when source is missing", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const tool = await JulesTool.init()
          await expect(
            tool.execute({ action: "create_session" as const, prompt: "Fix bug" }, ctx),
          ).rejects.toThrow("'source' is required")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("omits githubRepoContext when no branch specified", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const fetchMock = mockFetchResponse({ name: "sessions/xyz" })
          globalThis.fetch = fetchMock

          const tool = await JulesTool.init()
          await tool.execute(
            { action: "create_session" as const, prompt: "Fix bug", source: "sources/123" },
            ctx,
          )

          const body = JSON.parse((callArgs(fetchMock))[1].body as string)
          expect(body.sourceContext.source).toBe("sources/123")
          expect(body.sourceContext.githubRepoContext).toBeUndefined()
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("omits automationMode when auto_create_pr is not set", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const fetchMock = mockFetchResponse({ name: "sessions/xyz" })
          globalThis.fetch = fetchMock

          const tool = await JulesTool.init()
          await tool.execute(
            { action: "create_session" as const, prompt: "Fix bug", source: "sources/123" },
            ctx,
          )

          const body = JSON.parse((callArgs(fetchMock))[1].body as string)
          expect(body.automationMode).toBeUndefined()
          Env.remove("JULES_API_KEY")
        },
      })
    })
  })

  describe("list_sessions", () => {
    test("formats session list", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          globalThis.fetch = mockFetchResponse({
            sessions: [
              { name: "sessions/abc", title: "Fix bug", state: "COMPLETED", createTime: "2025-01-01T00:00:00Z" },
              { name: "sessions/def", title: "Add feature", state: "PLANNING" },
            ],
          })

          const tool = await JulesTool.init()
          const result = await tool.execute({ action: "list_sessions" as const }, ctx)

          expect(result.title).toBe("Jules: 2 session(s)")
          expect(result.metadata.count).toBe(2)
          expect(result.output).toContain("sessions/abc")
          expect(result.output).toContain("Fix bug")
          expect(result.output).toContain("COMPLETED")
          expect(result.output).toContain("sessions/def")
          expect(result.output).toContain("PLANNING")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("handles empty sessions", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          globalThis.fetch = mockFetchResponse({})

          const tool = await JulesTool.init()
          const result = await tool.execute({ action: "list_sessions" as const }, ctx)

          expect(result.title).toBe("Jules: No sessions")
          expect(result.output).toContain("No Jules sessions found")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("passes page_size parameter", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const fetchMock = mockFetchResponse({ sessions: [] })
          globalThis.fetch = fetchMock

          const tool = await JulesTool.init()
          await tool.execute({ action: "list_sessions" as const, page_size: 3 }, ctx)

          const [url] = callArgs(fetchMock)
          expect(url).toContain("pageSize=3")
          Env.remove("JULES_API_KEY")
        },
      })
    })
  })

  describe("get_activities", () => {
    test("formats activities with type and content", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          globalThis.fetch = mockFetchResponse({
            activities: [
              { name: "activities/1", type: "plan", content: "Analyzing codebase", createTime: "2025-01-01T00:00:00Z" },
              { name: "activities/2", type: "code", content: "Modified src/main.ts" },
            ],
          })

          const tool = await JulesTool.init()
          const result = await tool.execute(
            { action: "get_activities" as const, session_id: "sessions/abc" },
            ctx,
          )

          expect(result.title).toBe("Jules: 2 activities")
          expect(result.metadata.count).toBe(2)
          expect(result.metadata.session_id).toBe("sessions/abc")
          expect(result.output).toContain("[plan]")
          expect(result.output).toContain("Analyzing codebase")
          expect(result.output).toContain("[code]")
          expect(result.output).toContain("Modified src/main.ts")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("throws when session_id is missing", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const tool = await JulesTool.init()
          await expect(
            tool.execute({ action: "get_activities" as const }, ctx),
          ).rejects.toThrow("'session_id' is required")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("handles empty activities", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          globalThis.fetch = mockFetchResponse({})

          const tool = await JulesTool.init()
          const result = await tool.execute(
            { action: "get_activities" as const, session_id: "sessions/abc" },
            ctx,
          )

          expect(result.title).toBe("Jules: No activities")
          expect(result.output).toContain("may still be initializing")
          Env.remove("JULES_API_KEY")
        },
      })
    })
  })

  describe("approve_plan", () => {
    test("approves plan and returns state", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          globalThis.fetch = mockFetchResponse({ name: "sessions/abc", state: "EXECUTING" })

          const tool = await JulesTool.init()
          const result = await tool.execute(
            { action: "approve_plan" as const, session_id: "sessions/abc" },
            ctx,
          )

          expect(result.title).toBe("Jules: Plan approved")
          expect(result.metadata.action).toBe("approve_plan")
          expect(result.metadata.session_id).toBe("sessions/abc")
          expect(result.output).toContain("Plan approved")
          expect(result.output).toContain("EXECUTING")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("throws when session_id is missing", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const tool = await JulesTool.init()
          await expect(
            tool.execute({ action: "approve_plan" as const }, ctx),
          ).rejects.toThrow("'session_id' is required")
          Env.remove("JULES_API_KEY")
        },
      })
    })
  })

  describe("send_message", () => {
    test("sends message via prompt field and returns state", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const fetchMock = mockFetchResponse({ name: "sessions/abc", state: "EXECUTING" })
          globalThis.fetch = fetchMock

          const tool = await JulesTool.init()
          const result = await tool.execute(
            {
              action: "send_message" as const,
              session_id: "sessions/abc",
              message: "Also fix the tests",
            },
            ctx,
          )

          expect(result.title).toBe("Jules: Message sent")
          expect(result.output).toContain("Message sent")

          // Verify the API receives "prompt" not "message"
          const body = JSON.parse((callArgs(fetchMock))[1].body as string)
          expect(body.prompt).toBe("Also fix the tests")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("throws when session_id is missing", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const tool = await JulesTool.init()
          await expect(
            tool.execute({ action: "send_message" as const, message: "hello" }, ctx),
          ).rejects.toThrow("'session_id' is required")
          Env.remove("JULES_API_KEY")
        },
      })
    })

    test("throws when message is missing", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Env.set("JULES_API_KEY", "test-key")
          const tool = await JulesTool.init()
          await expect(
            tool.execute({ action: "send_message" as const, session_id: "sessions/abc" }, ctx),
          ).rejects.toThrow("'message' is required")
          Env.remove("JULES_API_KEY")
        },
      })
    })
  })
})
