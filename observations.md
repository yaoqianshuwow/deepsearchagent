The best way I've currently found a store messages in the database is to store them as a JSON blob. I find this pretty dangerous, Because the shape of your database then has a dependency on what the AI SDK expects.

---

There is a big context window trade-off between feeding the output of the crawler directly into the LLM or doing some kind of summary beforehand.

Ideally we would search the text of the page for the most relevant information and feed that into the LLM. That's the motivation behind the RAG approach.

---

Implementing your own crawler can be faster. Firecrawl does a lot of things for you, but you may not need all of them.

However, it's a major trade off. Owning the crawling logic means you're owning a lot more code.

---

Using an agentic feedback loop is great for generalising your app and making it better at more things. But it's a massive latency trade-off.

If you want to specialise in one thing, you should probably use workflows. This means you can end up doing a lot more work in parallel.

---

Possible flow:

1. Simple agent with tool calls (streamText)

- One `searchWeb` tool call which searches, crawls and summarizes, then creates a summary from there.
- Relatively low amount of code, but painful latency

1. Add RAG to the summaries to take the latency lower.

1. Raise complexity of agent using <thinking> tags, make it better at more complex and general questions.

1. Rewrite Query -> Crawl Sites -> Summarize -> streamText. Good, but simple and not great at complex questions.

1. Raise complexity of workflow by adding a planning step to the query rewriter.

1. Add a queue for the workflow to continue processing more complex questions.

---

Message annotations are cool because they let you stream in metadata about the message.

To persist them, you just save the most up-to-date ones in memory when you save the final message. Then, they'll be hydrated when you load the message back into the AI SDK.

---
