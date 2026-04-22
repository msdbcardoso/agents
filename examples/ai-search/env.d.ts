/* eslint-disable */
// Hand-written until `wrangler types` supports ai_search_namespaces bindings.
// Regenerate with `wrangler types env.d.ts --include-runtime false` when available.
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("./src/server");
    durableNamespaces: "SearchAgent";
  }
  interface Env {
    AI: Ai;
    AI_SEARCH: AiSearchNamespace;
    SearchAgent: DurableObjectNamespace<import("./src/server").SearchAgent>;
  }
}
interface Env extends Cloudflare.Env {}
