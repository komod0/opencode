import { Env } from "../../env"
import { Config } from "../../config/config"
import { Log } from "../../util/log"

export namespace JulesClient {
  const log = Log.create({ service: "jules" })

  export const BASE_URL = "https://jules.googleapis.com/v1alpha"

  export interface Source {
    name: string
    id: string
    githubRepo?: {
      owner: string
      repo: string
    }
  }

  export interface SessionOutput {
    pullRequest?: {
      url: string
      title?: string
    }
  }

  export interface Session {
    name: string
    id?: string
    title?: string
    state?: string
    prompt?: string
    sourceContext?: {
      source: string
      githubRepoContext?: {
        startingBranch?: string
      }
    }
    outputs?: SessionOutput[]
    createTime?: string
    updateTime?: string
  }

  export interface Activity {
    name: string
    type?: string
    content?: string
    createTime?: string
  }

  export interface CreateSessionInput {
    prompt: string
    sourceContext: {
      source: string
      githubRepoContext?: {
        startingBranch?: string
      }
    }
    title?: string
    automationMode?: "AUTO_CREATE_PR"
    requirePlanApproval?: boolean
  }

  export async function getApiKey(): Promise<string> {
    const envKey = Env.get("JULES_API_KEY")
    if (envKey) return envKey

    const cfg = await Config.get()
    const key = cfg.experimental?.jules?.api_key
    if (key) return key

    throw new Error(
      "Jules API key not found. Set the JULES_API_KEY environment variable or add experimental.jules.api_key to your opencode config.",
    )
  }

  export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const apiKey = await getApiKey()
    const url = `${BASE_URL}${path}`

    log.info("request", { method, path })

    const headers: Record<string, string> = {
      "X-Goog-Api-Key": apiKey,
      "Content-Type": "application/json",
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown error")
      throw new Error(`Jules API error (${response.status}): ${text}`)
    }

    return response.json() as Promise<T>
  }

  export async function listSources(): Promise<Source[]> {
    const result = await request<{ sources?: Source[]; nextPageToken?: string }>("GET", "/sources")
    return result.sources ?? []
  }

  export async function createSession(input: CreateSessionInput): Promise<Session> {
    return request<Session>("POST", "/sessions", input)
  }

  export async function listSessions(pageSize?: number): Promise<Session[]> {
    const params = pageSize ? `?pageSize=${pageSize}` : ""
    const result = await request<{ sessions?: Session[]; nextPageToken?: string }>(
      "GET",
      `/sessions${params}`,
    )
    return result.sessions ?? []
  }

  function normalizeSessionId(sessionId: string): string {
    return sessionId.startsWith("sessions/") ? sessionId : `sessions/${sessionId}`
  }

  export async function getSessionActivities(
    sessionId: string,
    pageSize?: number,
  ): Promise<Activity[]> {
    const normalized = normalizeSessionId(sessionId)
    const params = pageSize ? `?pageSize=${pageSize}` : ""
    const result = await request<{ activities?: Activity[]; nextPageToken?: string }>(
      "GET",
      `/${normalized}/activities${params}`,
    )
    return result.activities ?? []
  }

  export async function approvePlan(sessionId: string): Promise<Session> {
    const normalized = normalizeSessionId(sessionId)
    return request<Session>("POST", `/${normalized}:approvePlan`, {})
  }

  export async function sendMessage(sessionId: string, message: string): Promise<Session> {
    const normalized = normalizeSessionId(sessionId)
    return request<Session>("POST", `/${normalized}:sendMessage`, {
      prompt: message,
    })
  }
}
