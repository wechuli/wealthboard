import http from "node:http";

const server = http.createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200).end("ok");
    return;
  }
  response.setHeader("Content-Type", "application/json");
  if (
    request.url !== "/v1/chat/completions" ||
    request.headers.authorization !== "Bearer fixture-import-key"
  ) {
    response
      .writeHead(401)
      .end(JSON.stringify({ error: { message: "Invalid fixture request" } }));
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const prompt = input.messages.at(-1).content;
    if (prompt.includes("PRIVATE_REFERENCE"))
      throw new Error("Unredacted fixture");
    const units = JSON.parse(prompt.split("Approved source sections: ").at(-1));
    const activity = units.find((unit) =>
      unit.text.includes("fixture-deposit-1"),
    );
    if (!activity) throw new Error("Missing fixture activity");
    const output = {
      schemaVersion: 1,
      sourceCurrency: "KES",
      records: [
        {
          collection: prompt.includes("Target tracking mode: positions")
            ? "cash_transactions"
            : "transactions",
          sourceIds: [activity.id],
          fields: [
            { name: "external_id", value: "fixture-deposit-1" },
            { name: "type", value: "deposit" },
            { name: "amount", value: "24.00" },
            { name: "date", value: "2025-01-02" },
            { name: "description", value: "Imported deposit" },
          ],
        },
      ],
      exclusions: units
        .filter((unit) => unit.id !== activity.id)
        .map((unit) => ({ sourceId: unit.id, reason: "Column headings" })),
      issues: [],
    };
    response.end(
      JSON.stringify({
        id: "fixture-import",
        object: "chat.completion",
        model: input.model,
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: JSON.stringify(output) },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 100 },
      }),
    );
  } catch {
    response
      .writeHead(400)
      .end(JSON.stringify({ error: { message: "Invalid fixture source" } }));
  }
});

server.listen(4200, "127.0.0.1");
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
