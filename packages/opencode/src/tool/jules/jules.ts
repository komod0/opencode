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
  owner: z
    .string()
    .optional()
    .describe("GitHub repository owner (required for create_session)"),
  repo: z
    .string()
    .optional()
    .describe("GitHub repository name (required for create_session)"),
  branch: z.string().optional().describe("GitHub branch name (optional for create_session)"),
  title: z.string().optional().describe("Session title (optional for create_session)"),
  page_size: z.number().optional().describe("Number of results to return (optional for list operations)"),
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
            const gh = s.sourceContext?.github
            const repoInfo = gh ? `${gh.owner}/${gh.repo}${gh.branch ? ` (${gh.branch})` : ""}` : "unknown"
            return `- ${s.displayName ?? s.name}: ${repoInfo}`
          })
          .join("\n")
        return {
          title: `Jules: ${sources.length} source(s)`,
          metadata: { action: "list_sources", count: sources.length },
          output: `Connected repositories:\n${formatted}`,
        }
      }

      case "create_session": {
        if (!params.prompt) throw new Error("'prompt' is required for create_session")
        if (!params.owner || !params.repo) throw new Error("'owner' and 'repo' are required for create_session")

        const session = await JulesClient.createSession({
          prompt: params.prompt,
          sourceContext: {
            github: {
              owner: params.owner,
              repo: params.repo,
              branch: params.branch,
            },
          },
          title: params.title,
        })

        return {
          title: `Jules: Session created`,
          metadata: { action: "create_session", session: session.name },
          output: [
            `Jules session created successfully.`,
            `Session ID: ${session.name}`,
            session.title ? `Title: ${session.title}` : "",
            session.state ? `State: ${session.state}` : "",
            ``,
            `Jules will now analyze the repository and generate a plan.`,
            `Use action "get_activities" with this session_id to check progress.`,
            `Use action "approve_plan" when Jules has a plan ready for approval.`,
          ]
            .filter(Boolean)
            .join("\n"),
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
