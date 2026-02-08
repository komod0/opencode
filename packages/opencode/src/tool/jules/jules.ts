import z from "zod"
import { Tool } from "../tool"
import { JulesClient } from "./client"
import DESCRIPTION from "./jules.txt"

const parameters = z.object({
  action: z
    .enum(["list_sources", "create_session", "list_sessions", "get_activities", "approve_plan", "send_message"])
    .describe("The Jules action to perform"),
  prompt: z
    .string()
    .optional()
    .describe("The task prompt for creating a new session (required for create_session)"),
  session_id: z
    .string()
    .optional()
    .describe("The Jules session ID (required for get_activities, approve_plan, send_message)"),
  message: z
    .string()
    .optional()
    .describe("Message to send to a Jules session (required for send_message)"),
  source: z
    .string()
    .optional()
    .describe(
      "The Jules source name for the target repository (required for create_session). Use list_sources to find available source names.",
    ),
  branch: z.string().optional().describe("GitHub starting branch name (optional for create_session)"),
  title: z.string().optional().describe("Session title (optional for create_session)"),
  auto_create_pr: z
    .boolean()
    .optional()
    .describe("Automatically create a pull request when the session completes (optional for create_session)"),
  page_size: z.number().int().positive().optional().describe("Number of results to return (optional for list operations)"),
})

interface JulesMetadata {
  action: string
  session?: string
  session_id?: string
  count?: number
}

export const JulesTool = Tool.define<typeof parameters, JulesMetadata>("jules", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "jules",
      patterns: [params.action],
      always: ["*"],
      metadata: {
        action: params.action,
        session_id: params.session_id,
      },
    })

    switch (params.action) {
      case "list_sources": {
        const sources = await JulesClient.listSources()
        if (sources.length === 0) {
          return {
            title: "Jules: No sources found",
            metadata: { action: "list_sources" },
            output: "No connected repositories found. Connect a GitHub repository at https://jules.google",
          }
        }
        const formatted = sources
          .map((s) => {
            const gh = s.githubRepo
            const repoInfo = gh ? `${gh.owner}/${gh.repo}` : "unknown"
            return `- ${s.name} (${repoInfo})`
          })
          .join("\n")
        return {
          title: `Jules: ${sources.length} source(s)`,
          metadata: { action: "list_sources", count: sources.length },
          output: `Connected repositories:\n${formatted}\n\nUse the "name" field as the "source" parameter when creating a session.`,
        }
      }

      case "create_session": {
        if (!params.prompt) throw new Error("'prompt' is required for create_session")
        if (!params.source) throw new Error("'source' is required for create_session. Use list_sources to find available sources.")

        const session = await JulesClient.createSession({
          prompt: params.prompt,
          sourceContext: {
            source: params.source,
            ...(params.branch
              ? { githubRepoContext: { startingBranch: params.branch } }
              : {}),
          },
          title: params.title,
          automationMode: params.auto_create_pr ? "AUTO_CREATE_PR" : undefined,
        })

        const outputLines = [
          `Jules session created successfully.`,
          `Session: ${session.name}`,
          session.id ? `ID: ${session.id}` : "",
          session.title ? `Title: ${session.title}` : "",
          session.state ? `State: ${session.state}` : "",
          ``,
          `Jules will now analyze the repository and generate a plan.`,
          `Use action "get_activities" with session_id="${session.name}" to check progress.`,
          `Use action "approve_plan" when Jules has a plan ready for approval.`,
        ]

        if (session.outputs?.length) {
          for (const output of session.outputs) {
            if (output.pullRequest?.url) {
              outputLines.push(`Pull Request: ${output.pullRequest.url}`)
            }
          }
        }

        return {
          title: `Jules: Session created`,
          metadata: { action: "create_session", session: session.name },
          output: outputLines.filter(Boolean).join("\n"),
        }
      }

      case "list_sessions": {
        const sessions = await JulesClient.listSessions(params.page_size)
        if (sessions.length === 0) {
          return {
            title: "Jules: No sessions",
            metadata: { action: "list_sessions" },
            output: "No Jules sessions found. Use create_session to start a new task.",
          }
        }
        const formatted = sessions
          .map((s) => {
            const parts = [
              `- ${s.name}`,
              s.title ? `  Title: ${s.title}` : "",
              s.state ? `  State: ${s.state}` : "",
              s.createTime ? `  Created: ${s.createTime}` : "",
            ]
            return parts.filter(Boolean).join("\n")
          })
          .join("\n")
        return {
          title: `Jules: ${sessions.length} session(s)`,
          metadata: { action: "list_sessions", count: sessions.length },
          output: `Jules sessions:\n${formatted}`,
        }
      }

      case "get_activities": {
        if (!params.session_id) throw new Error("'session_id' is required for get_activities")

        const activities = await JulesClient.getSessionActivities(params.session_id, params.page_size)
        if (activities.length === 0) {
          return {
            title: "Jules: No activities",
            metadata: { action: "get_activities", session_id: params.session_id },
            output: `No activities found for session ${params.session_id}. The session may still be initializing.`,
          }
        }
        const formatted = activities
          .map((a) => {
            const parts = [
              `- [${a.type ?? "activity"}] ${a.content ?? "(no content)"}`,
              a.createTime ? `  Time: ${a.createTime}` : "",
            ]
            return parts.filter(Boolean).join("\n")
          })
          .join("\n")
        return {
          title: `Jules: ${activities.length} activities`,
          metadata: { action: "get_activities", session_id: params.session_id, count: activities.length },
          output: `Activities for session ${params.session_id}:\n${formatted}`,
        }
      }

      case "approve_plan": {
        if (!params.session_id) throw new Error("'session_id' is required for approve_plan")

        const session = await JulesClient.approvePlan(params.session_id)
        return {
          title: "Jules: Plan approved",
          metadata: { action: "approve_plan", session_id: params.session_id },
          output: [
            `Plan approved for session ${params.session_id}.`,
            session.state ? `Session state: ${session.state}` : "",
            `Jules will now begin implementing the changes.`,
          ]
            .filter(Boolean)
            .join("\n"),
        }
      }

      case "send_message": {
        if (!params.session_id) throw new Error("'session_id' is required for send_message")
        if (!params.message) throw new Error("'message' is required for send_message")

        const session = await JulesClient.sendMessage(params.session_id, params.message)
        return {
          title: "Jules: Message sent",
          metadata: { action: "send_message", session_id: params.session_id },
          output: [
            `Message sent to Jules session ${params.session_id}.`,
            session.state ? `Session state: ${session.state}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        }
      }

      default:
        throw new Error(`Unknown Jules action: ${params.action}`)
    }
  },
})
