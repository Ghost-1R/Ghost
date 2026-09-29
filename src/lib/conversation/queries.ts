import type { GhostClient } from "@/lib/auth/session";
import { fromError, type QueryResult } from "@/lib/result";

export type ConversationSource = {
  id: string;
  type: string;
  title: string;
};

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sources: ConversationSource[];
};

export type ConversationThread = {
  id: string;
  title: string | null;
  projectId: string | null;
  messages: ConversationMessage[];
};

function isRole(value: string): value is "user" | "assistant" {
  return value === "user" || value === "assistant";
}

function readSources(content: string): ConversationSource[] {
  const marker = "\n\nSources:\n";
  const index = content.lastIndexOf(marker);
  if (index === -1) {
    return [];
  }

  return content
    .slice(index + marker.length)
    .split("\n")
    .flatMap((line) => {
      const match = line.match(/^- ([^:]+): (.+) \(([^)]+)\)$/);
      if (!match?.[1] || !match[2] || !match[3]) {
        return [];
      }
      return [{ type: match[1], title: match[2], id: match[3] }];
    });
}

export function withSources(content: string, sources: ConversationSource[]): string {
  if (sources.length === 0) {
    return content;
  }

  const lines = sources.map((source) => `- ${source.type}: ${source.title} (${source.id})`).join("\n");
  return `${content}\n\nSources:\n${lines}`;
}

export function splitAnswer(content: string): { answer: string; sources: ConversationSource[] } {
  const marker = "\n\nSources:\n";
  const index = content.lastIndexOf(marker);
  if (index === -1) {
    return { answer: content, sources: [] };
  }
  return { answer: content.slice(0, index), sources: readSources(content) };
}

export async function loadLatestConversation(
  supabase: GhostClient,
  projectId: string | null,
): Promise<QueryResult<ConversationThread | null>> {
  let query = supabase
    .from("ghost_conversations")
    .select("id, title, project_id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);

  query = projectId ? query.eq("project_id", projectId) : query.is("project_id", null);

  const conversation = await query.maybeSingle();
  if (conversation.error) {
    return fromError(conversation.error);
  }

  if (!conversation.data) {
    return { status: "ok", data: null };
  }

  const messages = await supabase
    .from("ghost_messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", conversation.data.id)
    .order("created_at", { ascending: true });

  if (messages.error) {
    return fromError(messages.error);
  }

  return {
    status: "ok",
    data: {
      id: conversation.data.id,
      title: conversation.data.title,
      projectId: conversation.data.project_id,
      messages: messages.data.flatMap((message) =>
        isRole(message.role)
          ? [
              {
                id: message.id,
                role: message.role,
                content: message.content,
                createdAt: message.created_at,
                sources: readSources(message.content),
              },
            ]
          : [],
      ),
    },
  };
}
