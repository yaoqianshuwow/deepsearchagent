import { type Config } from "tailwindcss";
import { fontFamily } from "tailwindcss/defaultTheme";
import typography from "@tailwindcss/typography";

export default {
  content: ["./src/**/*.tsx"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", ...fontFamily.sans],
      },
      typography: {
        invert: {
          css: {
            "--tw-prose-body": "var(--tw-prose-invert-body)",
            "--tw-prose-headings": "var(--tw-prose-invert-headings)",
            "--tw-prose-links": "var(--tw-prose-invert-links)",
            "--tw-prose-links-hover": "var(--tw-prose-invert-links-hover)",
            "--tw-prose-underline": "var(--tw-prose-invert-underline)",
            "--tw-prose-underline-hover":
              "var(--tw-prose-invert-underline-hover)",
            "--tw-prose-bold": "var(--tw-prose-invert-bold)",
            "--tw-prose-counters": "var(--tw-prose-invert-counters)",
            "--tw-prose-bullets": "var(--tw-prose-invert-bullets)",
            "--tw-prose-hr": "var(--tw-prose-invert-hr)",
            "--tw-prose-quote-borders": "var(--tw-prose-invert-quote-borders)",
            "--tw-prose-captions": "var(--tw-prose-invert-captions)",
            "--tw-prose-code": "var(--tw-prose-invert-code)",
            "--tw-prose-code-bg": "var(--tw-prose-invert-code-bg)",
            "--tw-prose-pre-code": "var(--tw-prose-invert-pre-code)",
            "--tw-prose-pre-bg": "var(--tw-prose-invert-pre-bg)",
            "--tw-prose-pre-border": "var(--tw-prose-invert-pre-border)",
            "--tw-prose-th-borders": "var(--tw-prose-invert-th-borders)",
            "--tw-prose-td-borders": "var(--tw-prose-invert-td-borders)",
          },
        },
      },
    },
  },
  plugins: [require("tailwind-scrollbar"), typography],
} satisfies Config;
