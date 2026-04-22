import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest, callable } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  streamText,
  convertToModelMessages,
  pruneMessages,
  tool,
  stepCountIs
} from "ai";
import { z } from "zod";

export type RetrievalType = "hybrid" | "vector" | "keyword";

/** Controls how many search iterations the agent performs */
export type SearchDepth = 1 | 2 | 3;

const DEPTH_CONFIG: Record<
  SearchDepth,
  { label: string; maxSteps: number; instruction: string }
> = {
  1: {
    label: "Quick",
    maxSteps: 4,
    instruction:
      "Use QUICK mode: do a single focused search and answer concisely. 1-2 searches max."
  },
  2: {
    label: "Balanced",
    maxSteps: 10,
    instruction:
      "Use BALANCED mode: decompose into 2-3 sub-queries, search iteratively, and synthesize. 3-5 searches is normal."
  },
  3: {
    label: "Deep",
    maxSteps: 20,
    instruction:
      "Use DEEP RESEARCH mode: be thorough. Decompose into 3-5 sub-queries, search extensively, cross-reference results, identify gaps, refine queries, and synthesize a comprehensive answer. 5-10+ searches expected. Prioritize completeness over speed."
  }
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface InstanceConfig {
  id: string;
  vector: boolean;
  keyword: boolean;
}

/**
 * AI Search Agent — a search agent that decomposes complex questions
 * into focused sub-queries, searches iteratively, and synthesizes
 * answers with source citations.
 *
 * Key idea: an agent searching multiple times with targeted queries
 * produces far better results than a single-pass search.
 */
export class SearchAgent extends AIChatAgent {
  maxPersistedMessages = 200;

  // Note: these reset on DO hibernation. The client re-syncs on reconnect
  // via getRetrievalType/getActiveInstance. For persistence across hibernation,
  // use this.sql or this.ctx.storage instead.
  private retrievalType: RetrievalType = "hybrid";
  private activeInstance: string | null = null;
  private searchDepth: SearchDepth = 2;

  // -- Settings --

  @callable()
  setRetrievalType(type: RetrievalType): { retrievalType: RetrievalType } {
    this.retrievalType = type;
    return { retrievalType: this.retrievalType };
  }

  @callable()
  getRetrievalType(): { retrievalType: RetrievalType } {
    return { retrievalType: this.retrievalType };
  }

  @callable()
  setSearchDepth(depth: SearchDepth): { searchDepth: SearchDepth } {
    this.searchDepth = depth;
    return { searchDepth: this.searchDepth };
  }

  @callable()
  getSearchDepth(): { searchDepth: SearchDepth } {
    return { searchDepth: this.searchDepth };
  }

  // -- Instance management --

  /** List all AI Search instances in the namespace */
  @callable()
  async listInstances(): Promise<InstanceConfig[]> {
    try {
      const { result } = await this.env.AI_SEARCH.list();
      return result.map((instance) => ({
        id: instance.id,
        vector: instance.index_method?.vector ?? false,
        keyword: instance.index_method?.keyword ?? false
      }));
    } catch (err) {
      console.error("listInstances failed:", err);
      return [];
    }
  }

  /** Create a new AI Search instance */
  @callable()
  async createInstance(
    name: string,
    vector: boolean,
    keyword: boolean
  ): Promise<{ id: string; success: boolean; error?: string }> {
    if (!vector && !keyword) {
      return {
        id: name,
        success: false,
        error: "At least one index method (vector or keyword) must be enabled"
      };
    }
    try {
      await this.env.AI_SEARCH.create({
        id: name,
        index_method: { vector, keyword }
      });
      // Auto-select the newly created instance
      this.activeInstance = name;
      return { id: name, success: true };
    } catch (err) {
      return {
        id: name,
        success: false,
        error: errorMessage(err)
      };
    }
  }

  /** Delete an AI Search instance */
  @callable()
  async deleteInstance(
    name: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.env.AI_SEARCH.delete(name);
      if (this.activeInstance === name) {
        this.activeInstance = null;
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: errorMessage(err)
      };
    }
  }

  /** Set the active instance for search and uploads */
  @callable()
  setActiveInstance(name: string | null): { activeInstance: string | null } {
    this.activeInstance = name;
    return { activeInstance: this.activeInstance };
  }

  /** Get the active instance */
  @callable()
  getActiveInstance(): { activeInstance: string | null } {
    return { activeInstance: this.activeInstance };
  }

  // -- File management --

  /** Upload a file to the active instance's built-in storage */
  @callable()
  async upload(
    name: string,
    content: string
  ): Promise<{ id: string; key: string; status: string }> {
    if (!this.activeInstance) {
      throw new Error("No active instance. Create or select one first.");
    }
    const instance = this.env.AI_SEARCH.get(this.activeInstance);
    const item = await instance.items.uploadAndPoll(name, content, {
      pollIntervalMs: 500,
      timeoutMs: 30_000
    });
    return { id: item.id, key: item.key, status: item.status };
  }

  /** List files in the active instance */
  @callable()
  async listFiles(): Promise<
    { key: string; status: string; chunks_count: number }[]
  > {
    if (!this.activeInstance) return [];
    try {
      const instance = this.env.AI_SEARCH.get(this.activeInstance);
      const { result } = await instance.items.list({ per_page: 50 });
      return result.map((item) => ({
        key: item.key,
        status: item.status,
        chunks_count: item.chunks_count ?? 0
      }));
    } catch (err) {
      console.error("listFiles failed:", err);
      return [];
    }
  }

  // -- Chat --

  // _onFinish is unused — we return the stream directly via toUIMessageStreamResponse()
  async onChatMessage(_onFinish?: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const depth = DEPTH_CONFIG[this.searchDepth];

    const result = streamText({
      abortSignal: options?.abortSignal,
      model: workersai("@cf/moonshotai/kimi-k2.5", {
        sessionAffinity: this.sessionAffinity
      }),
      system: `${SYSTEM_PROMPT}\n\n## Current mode\n\n${depth.instruction}`,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
        reasoning: "before-last-message"
      }),
      tools: {
        search: tool({
          description:
            "Search the knowledge base. Returns scored chunks with source references. " +
            "Call multiple times with different queries to build comprehensive context.",
          inputSchema: z.object({
            query: z.string().describe("A focused search query")
          }),
          execute: async ({ query }) => {
            if (!this.activeInstance) {
              return {
                error: "No active instance selected.",
                hint: "Create or select an AI Search instance from the sidebar."
              };
            }
            const instance = this.env.AI_SEARCH.get(this.activeInstance);
            try {
              const response = await instance.search({
                query,
                ai_search_options: {
                  retrieval: {
                    retrieval_type: this.retrievalType,
                    max_num_results: 10
                  },
                  reranking: { enabled: false },
                  query_rewrite: { enabled: false }
                }
              });
              return {
                search_query: response.search_query,
                total_results: response.chunks.length,
                chunks: response.chunks.map((chunk) => ({
                  id: chunk.id,
                  score: chunk.score,
                  text: chunk.text,
                  source: chunk.item.key,
                  scoring_details: chunk.scoring_details
                }))
              };
            } catch (err) {
              return {
                error: `Search failed: ${errorMessage(err)}`,
                hint: "Upload documents first."
              };
            }
          }
        }),

        knowledge_base_info: tool({
          description:
            "Get knowledge base stats and document inventory. Returns indexing status counts " +
            "(queued, completed, errored), storage engine stats (vector count, dimensions), " +
            "and the list of documents with their filenames, status, and chunk counts. " +
            "Use to check what's available before searching or to answer questions about the knowledge base.",
          inputSchema: z.object({}),
          execute: async () => {
            if (!this.activeInstance) {
              return {
                error: "No active instance selected.",
                hint: "Create or select an AI Search instance from the sidebar."
              };
            }
            try {
              const instance = this.env.AI_SEARCH.get(this.activeInstance);
              const [stats, { result: items }] = await Promise.all([
                instance.stats(),
                instance.items.list({ per_page: 50 })
              ]);
              return {
                stats: {
                  completed: stats.completed ?? 0,
                  queued: stats.queued ?? 0,
                  running: stats.running ?? 0,
                  error: stats.error ?? 0,
                  last_activity: stats.last_activity ?? null,
                  engine: stats.engine ?? null
                },
                documents: items.map((item) => ({
                  filename: item.key,
                  status: item.status,
                  chunks: item.chunks_count ?? 0
                }))
              };
            } catch (err) {
              return {
                error: `Failed: ${errorMessage(err)}`
              };
            }
          }
        }),

        save_document: tool({
          description:
            "Save information to the knowledge base for later retrieval. " +
            "Use when the user asks to remember or store something.",
          inputSchema: z.object({
            filename: z
              .string()
              .describe("Descriptive filename, e.g. 'meeting-notes.md'"),
            content: z.string().describe("The text content to save")
          }),
          execute: async ({ filename, content }) => {
            if (!this.activeInstance) {
              return {
                saved: false,
                error:
                  "No active instance. Create or select one from the sidebar."
              };
            }
            try {
              const instance = this.env.AI_SEARCH.get(this.activeInstance);
              const item = await instance.items.uploadAndPoll(
                filename,
                content,
                { pollIntervalMs: 500, timeoutMs: 30_000 }
              );
              return {
                saved: true,
                filename: item.key,
                status: item.status
              };
            } catch (err) {
              return {
                saved: false,
                error: `Failed: ${errorMessage(err)}`
              };
            }
          }
        })
      },
      // Step limit scales with search depth
      stopWhen: stepCountIs(depth.maxSteps)
    });

    return result.toUIMessageStreamResponse();
  }
}

const SYSTEM_PROMPT = `You are a search agent powered by Cloudflare AI Search. Your job is to find information in a knowledge base and answer questions thoroughly.

## Core behavior

You have a \`search\` tool. Unlike a simple search box, you can search **strategically**:

1. **Decompose** — Break complex questions into 2-4 focused sub-queries. "Compare X and Y" becomes separate searches for X and Y. "What are the pros and cons of Z" becomes searches for advantages, disadvantages, and alternatives.

2. **Search iteratively** — Don't stop at one search. Run your sub-queries, read the results, identify gaps, and search again with refined queries. 3-5 searches for a complex question is normal.

3. **Evaluate** — After each search, assess: Are the scores high enough? Did I find what I need? Are there angles I haven't covered? If scores are low (<0.3), the query probably needs rephrasing.

4. **Synthesize** — Once you have enough context, combine findings into a clear answer. Cite sources by filename. Note when information is incomplete.

## When NOT to search

Don't search for greetings, general knowledge, or questions about your own capabilities. Only search when the user's question requires information from the knowledge base.

## Answering

- Cite sources: mention filenames when referencing specific information
- Be honest about gaps: if search results don't fully answer the question, say so
- Show your reasoning: briefly note what you searched for, especially when doing multiple searches
- Synthesize, don't list: combine chunks into a coherent narrative

## Inventory

You can \`knowledge_base_info\` to inspect the knowledge base — document count, indexing stats (queued, completed, errored), vector store dimensions, and the full file list with chunk counts. Use this when asked about available documents, to verify uploads, or to check indexing progress.

## Saving

You can also \`save_document\` when users ask you to remember or store information.`;

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
