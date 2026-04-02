import type { FastifyReply } from 'fastify';
import type { StreamingProviderResponse } from '../providers/base.js';

/**
 * Pipe a streaming provider response to the Fastify reply as SSE.
 */
export async function pipeStream(
  streamResponse: StreamingProviderResponse,
  reply: FastifyReply,
): Promise<{ fullContent: string; chunks: number }> {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const reader = streamResponse.stream.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let chunks = 0;
  let connectionOpen = true;

  // Detect client disconnect
  reply.raw.on('close', () => { connectionOpen = false; });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      if (!connectionOpen) break;

      try {
        reply.raw.write(text);
      } catch {
        // Connection closed by client mid-stream
        connectionOpen = false;
        break;
      }
      chunks++;

      // Extract content from SSE data for logging
      const lines = text.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) fullContent += delta;
        } catch {
          // Skip malformed chunks
        }
      }
    }
  } catch (err) {
    // Stream error — try to write error event if connection is still open
    if (connectionOpen) {
      try {
        const errorEvent = JSON.stringify({
          error: { message: err instanceof Error ? err.message : 'Stream error', type: 'stream_error' },
        });
        reply.raw.write(`data: ${errorEvent}\n\n`);
      } catch {
        // Connection already closed
      }
    }
  } finally {
    // Always release the reader
    try { reader.cancel(); } catch { /* already released */ }
    if (connectionOpen) {
      try { reply.raw.end(); } catch { /* already ended */ }
    }
  }

  return { fullContent, chunks };
}
