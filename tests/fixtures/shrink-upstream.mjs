#!/usr/bin/env node
// @ts-check
import { createInterface } from "node:readline";

const tools = [
  {
    name: "fetch_url",
    title: "Fetch URL",
    description:
      "Please make sure to carefully fetch the requested URL in order to return the response body as a string.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The exact URL to fetch without changing it.",
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "DELETE"],
        },
      },
      required: ["url"],
    },
    outputSchema: {
      type: "object",
      properties: {
        body: { type: "string" },
      },
      required: ["body"],
    },
    annotations: {
      readOnlyHint: true,
    },
  },
];

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method !== "tools/list") return;
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools,
        nextCursor: "page-2",
      },
    }) + "\n"
  );
});
