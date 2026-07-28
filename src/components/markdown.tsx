"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders the assistant's replies, which arrive as markdown.
 *
 * Hand-mapped rather than using the typography plugin: `prose` is tuned for
 * articles, and its margins and font sizes have to be fought back down at every
 * turn inside a chat bubble. The elements a model actually emits are a short list,
 * so styling them directly is both smaller and more predictable.
 *
 * Raw HTML is not enabled. `rehype-raw` is deliberately absent — this text is model
 * output that can quote arbitrary agreement content, and react-markdown escapes HTML
 * by default. Leave it that way.
 */

/**
 * Chat bubbles are tight. Every block gets bottom spacing, and the last one gives it
 * back, so a reply never sits on a lopsided gap.
 */
const BLOCK = "mb-3 last:mb-0";

const components: Components = {
  p: ({ children }) => <p className={BLOCK}>{children}</p>,

  // Sized barely above body text. A model writing "## Summary" over three lines
  // shouldn't produce a headline that dwarfs the reply around it.
  h1: ({ children }) => (
    <h2 className={`${BLOCK} text-base font-semibold tracking-tight`}>{children}</h2>
  ),
  h2: ({ children }) => (
    <h3 className={`${BLOCK} text-sm font-semibold tracking-tight`}>{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className={`${BLOCK} text-sm font-semibold tracking-tight`}>{children}</h4>
  ),
  h4: ({ children }) => (
    <h5 className={`${BLOCK} text-sm font-semibold tracking-tight`}>{children}</h5>
  ),
  h5: ({ children }) => (
    <h6 className={`${BLOCK} text-sm font-semibold tracking-tight`}>{children}</h6>
  ),
  h6: ({ children }) => (
    <h6 className={`${BLOCK} text-sm font-semibold tracking-tight`}>{children}</h6>
  ),

  ul: ({ children }) => (
    <ul className={`${BLOCK} list-disc space-y-1 ps-5 marker:text-muted-foreground`}>
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className={`${BLOCK} list-decimal space-y-1 ps-5 marker:text-muted-foreground`}>
      {children}
    </ol>
  ),
  // Nested lists sit inside an <li>, so their own margin has to go or each level
  // adds a blank line.
  li: ({ children }) => <li className="[&>ul]:mt-1 [&>ul]:mb-0 [&>ol]:mt-1 [&>ol]:mb-0">{children}</li>,

  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="opacity-70">{children}</del>,

  a: ({ href, children }) => (
    <a
      href={href}
      // Model output can cite anywhere, so links leave the app rather than replacing
      // the conversation. `noreferrer` keeps the destination from seeing where it
      // came from — an agreement thread is nobody else's business.
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary font-medium underline underline-offset-2"
    >
      {children}
    </a>
  ),

  blockquote: ({ children }) => (
    <blockquote
      className={`${BLOCK} border-l-primary/40 text-muted-foreground border-l-2 ps-3 italic`}
    >
      {children}
    </blockquote>
  ),

  hr: () => <hr className={`${BLOCK} border-border`} />,

  // Inline styling by default; the `pre` below strips it back off for fenced blocks,
  // which sidesteps having to tell inline and block code apart at render time.
  code: ({ children }) => (
    <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre
      className={`${BLOCK} bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-xs`}
    >
      {children}
    </pre>
  ),

  // Tables are the reason remark-gfm is here: "which agreements expire this quarter"
  // is naturally tabular. Wrapped so a wide one scrolls itself instead of stretching
  // the bubble past the width of the transcript.
  table: ({ children }) => (
    <div className={`${BLOCK} overflow-x-auto`}>
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b">{children}</thead>,
  th: ({ children }) => (
    <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{children}</th>
  ),
  td: ({ children }) => <td className="border-t px-2 py-1.5 align-top">{children}</td>,
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
