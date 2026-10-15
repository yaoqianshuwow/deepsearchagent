import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    setupFiles: ["dotenv/config"],
  },
  plugins: [tsconfigPaths()],
});
