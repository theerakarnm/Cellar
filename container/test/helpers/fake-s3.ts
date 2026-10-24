import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  bodyBytes: number;
  body: Buffer;
}

export interface FakeS3 {
  endpoint: string;
  requests: RecordedRequest[];
  /** Return an HTTP status (error XML body) or "ok-with-error" (200 with an error XML body) to override a request. */
  failWith: (match: (request: RecordedRequest) => number | "ok-with-error" | null) => void;
  close: () => Promise<void>;
}

/** In-memory S3 multipart endpoint. Keeps part bodies so tests can reassemble the object. */
export async function startFakeS3(): Promise<FakeS3> {
  const requests: RecordedRequest[] = [];
  const parts = new Map<string, Buffer>();
  let override: (request: RecordedRequest) => number | "ok-with-error" | null = () => null;
  let uploads = 0;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const body = Buffer.concat(chunks);
      const request: RecordedRequest = { method: req.method ?? "", path: url.pathname, query: url.searchParams, headers: req.headers, bodyBytes: body.length, body };
      requests.push(request);
      const status = override(request);
      if (status !== null) {
        res.writeHead(status === "ok-with-error" ? 200 : status, { "content-type": "application/xml" });
        res.end(`<Error><Code>Injected${status === "ok-with-error" ? "Error" : status}</Code><Message>injected failure</Message></Error>`);
        return;
      }
      if (req.method === "POST" && url.searchParams.has("uploads")) {
        res.end(`<InitiateMultipartUploadResult><UploadId>upload-${++uploads}</UploadId></InitiateMultipartUploadResult>`);
      } else if (req.method === "PUT" && url.searchParams.has("partNumber")) {
        parts.set(`${url.searchParams.get("uploadId")}#${url.searchParams.get("partNumber")}`, body);
        res.writeHead(200, { etag: `"etag-${url.searchParams.get("partNumber")}"` });
        res.end();
      } else if (req.method === "POST" && url.searchParams.has("uploadId")) {
        res.end("<CompleteMultipartUploadResult><ETag>\"final\"</ETag></CompleteMultipartUploadResult>");
      } else if (req.method === "DELETE") {
        res.writeHead(204);
        res.end();
      } else if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(Buffer.from("object-bytes"));
      } else {
        res.writeHead(400);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    requests,
    failWith: (match) => {
      override = match;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
