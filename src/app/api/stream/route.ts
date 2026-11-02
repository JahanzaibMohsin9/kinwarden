import { runtime } from "@/server/runtime";
import { sessionId } from "@/server/session";

export async function GET(request: Request) {
  const { store } = runtime(sessionId(request));
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          cleanup();
        }
      };
      const onChange = (seq: number) => send(`event: change\ndata: ${seq}\n\n`);
      const heartbeat = setInterval(() => send(`: ping\n\n`), 15000);
      store.on("change", onChange);
      cleanup = () => {
        clearInterval(heartbeat);
        store.off("change", onChange);
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
      send(`event: change\ndata: ${store.ledger.at(-1)?.seq ?? 0}\n\n`);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
