export async function register() {
  // These packages use Node APIs and must not be loaded in the Edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { env } = await import("./env.js");
  const config = [
    env.LANGFUSE_PUBLIC_KEY,
    env.LANGFUSE_SECRET_KEY,
    env.LANGFUSE_BASE_URL,
  ];

  if (config.every((value) => !value)) {
    console.info("[Langfuse] 未配置，聊天正常运行，暂不上传运行记录。");
    return;
  }
  if (config.some((value) => !value)) {
    throw new Error(
      "Langfuse 配置不完整：请同时填写 LANGFUSE_PUBLIC_KEY、LANGFUSE_SECRET_KEY、LANGFUSE_BASE_URL。",
    );
  }

  const [
    { registerOTel },
    { LangfuseSpanProcessor },
    { LangfuseVercelAiSdkIntegration },
    { registerTelemetry },
  ] = await Promise.all([
    import("@vercel/otel"),
    import("@langfuse/otel"),
    import("@langfuse/vercel-ai-sdk"),
    import("ai"),
  ]);

  registerOTel({
    serviceName: "deepsearchagent",
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey: env.LANGFUSE_PUBLIC_KEY,
        secretKey: env.LANGFUSE_SECRET_KEY,
        baseUrl: env.LANGFUSE_BASE_URL,
        // Resumable generations run in the background; export ended spans
        // immediately, including failures, without waiting on a response hook.
        exportMode: "immediate",
      }),
    ],
  });
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
  console.info("[Langfuse] 已开启模型与工具调用记录。");
}
