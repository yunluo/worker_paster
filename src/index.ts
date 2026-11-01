export interface Env {
  PASTES: KVNamespace;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
