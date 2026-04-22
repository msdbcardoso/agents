# AI Search Agent

A search agent that manages AI Search instances, uploads documents, decomposes complex queries into focused sub-searches, and answers questions with source citations — powered by [Cloudflare AI Search](https://developers.cloudflare.com/ai-search/).

## What this demonstrates

- **AI Search binding** (`ai_search_namespaces`) — the namespace binding for AI Search, replacing the deprecated `env.AI.autorag()`
- **Instance management** — create, list, select, and delete AI Search instances at runtime with configurable index methods (vector, keyword, or both)
- **Built-in storage** — upload files via the Items API, indexed immediately (no 6-hour sync wait)
- **Configurable retrieval** — switch between hybrid (vector + keyword), vector-only, or keyword-only from the sidebar
- **Reranking** — reorders results by semantic relevance at search time
- **Query decomposition** — the agent breaks complex questions into multiple focused searches
- **Source citations** — every answer references source documents with scoring transparency (vector, keyword, and reranking scores)

## How to run

```bash
npm install
npm start
```

The app starts at `http://localhost:5173`. Open it in your browser, create an AI Search instance from the sidebar, upload documents, and start asking questions.

## Setup

This example uses the `ai_search_namespaces` binding, which requires a Cloudflare account with AI Search enabled.

1. Create an AI Search instance from the sidebar (choose vector, keyword, or both)
2. Upload files — they're stored in AI Search's built-in storage and indexed immediately
3. No R2 bucket or external data source setup is needed

For local development, the binding proxies requests to your Cloudflare account (via `remote: true` in `wrangler.jsonc`).

## Key patterns

### Instance management via @callable

The agent exposes instance lifecycle methods over WebSocket:

```typescript
@callable()
async createInstance(name: string, vector: boolean, keyword: boolean) {
  await this.env.AI_SEARCH.create({
    id: name,
    index_method: { vector, keyword }
  });
  this.activeInstance = name;
}

@callable()
async listInstances() {
  const { result } = await this.env.AI_SEARCH.list();
  return result.map((instance) => ({ id: instance.id, ... }));
}
```

### Search tool with agent-driven decomposition

The agent has a `search` tool that queries the active instance, with a system prompt that guides multi-step reasoning:

```typescript
search: tool({
  inputSchema: z.object({
    query: z.string().describe("A focused search query"),
    reranking: z.boolean().optional().default(true)
  }),
  execute: async ({ query, reranking }) => {
    const instance = this.env.AI_SEARCH.get(this.activeInstance);
    return instance.search({
      query,
      ai_search_options: {
        retrieval: { retrieval_type: this.retrievalType, max_num_results: 10 },
        reranking: { enabled: reranking },
        query_rewrite: { enabled: false }
      }
    });
  }
});
```

With `stopWhen: stepCountIs(15)`, the agent can call search multiple times to gather comprehensive context before answering.

### File upload via @callable

```typescript
@callable()
async upload(name: string, content: string) {
  const instance = this.env.AI_SEARCH.get(this.activeInstance);
  return instance.items.uploadAndPoll(name, content);
}
```

The client calls this via `agent.call("upload", [name, content])` over the WebSocket connection.

## Related

- [AI Search documentation](https://developers.cloudflare.com/ai-search/)
- [Workers binding reference](https://developers.cloudflare.com/ai-search/usage/workers-binding/)
- [Items API reference](https://developers.cloudflare.com/ai-search/api/items/workers-binding/)
- [`ai-chat` example](../ai-chat/) — the base pattern this example builds on
