"use client";

import { AlertTriangle, CheckCircle2, Loader2, PenLine, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Logo } from "@/components/brand";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { syncAgreements } from "@/app/(app)/agreements/actions";
import { decodeEventStream } from "@/lib/agent/events";
import { toolDisplayName } from "@/lib/agent/tools";
import type { AgentToolCall, Message } from "@/lib/db/schema";
import type { DocusignConnectionStatus } from "@/lib/docusign/connection";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Which agreements expire in the next 90 days?",
  "Send our standard NDA to jordan@northwind.example.",
  "What's still sitting in review?",
];

/** The assistant's turn while it is still arriving. */
type Draft = { text: string; toolCalls: AgentToolCall[] };

export function ChatPanel({
  initialConversationId,
  initialMessages,
  docusignStatus,
}: {
  initialConversationId: string | null;
  initialMessages: Message[];
  docusignStatus: DocusignConnectionStatus;
}) {
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  /** Shown immediately on send, before the server confirms the saved row. */
  const [pendingUserText, setPendingUserText] = useState<string | null>(null);
  const [reply, setReply] = useState<Draft | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isStreaming = reply !== null || pendingUserText !== null;
  const connected = docusignStatus === "connected";

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, reply, pendingUserText]);

  // A turn in flight is tied to this screen. Leaving it should stop the work, not
  // leave the agent talking to a closed tab.
  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * Re-imports the agreements table after the agent changed something in Docusign.
   *
   * Announced through a toast rather than done silently: it is a second agent run
   * costing real seconds, and the user is on the chat screen, so the table it
   * updates is somewhere they cannot see.
   */
  async function refreshRegister() {
    const toastId = toast.loading("Updating the agreements table…");
    const result = await syncAgreements();

    if (!result.ok) {
      toast.error(result.error, { id: toastId });
      return;
    }

    toast.success(
      result.created > 0
        ? `Agreements updated — ${result.created} new`
        : "Agreements updated",
      { id: toastId },
    );
  }

  async function submit() {
    const text = draft.trim();
    if (!text || isStreaming || !connected) return;

    setDraft("");
    setPendingUserText(text);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, content: text }),
        signal: controller.signal,
      });

      // Anything that failed before the stream opened is a normal HTTP error with a
      // JSON body — the stream itself is always a 200 once it starts.
      if (!response.ok || !response.body) {
        const detail = await response
          .json()
          .then((body: { error?: string }) => body.error)
          .catch(() => null);

        toast.error(detail ?? "The assistant is unavailable right now.");
        setDraft(text); // give the message back rather than losing it
        return;
      }

      for await (const event of decodeEventStream(response.body)) {
        switch (event.type) {
          case "start":
            setConversationId(event.conversationId);
            setMessages((current) => [...current, event.userMessage]);
            setPendingUserText(null);
            setReply({ text: "", toolCalls: [] });
            break;

          case "text":
            setReply((current) =>
              current ? { ...current, text: current.text + event.delta } : current,
            );
            break;

          case "tool":
            setReply((current) =>
              current
                ? {
                    ...current,
                    toolCalls: [
                      ...current.toolCalls,
                      {
                        id: event.id,
                        name: event.name,
                        input: event.input,
                        status: "running",
                      },
                    ],
                  }
                : current,
            );
            break;

          case "tool-result":
            setReply((current) =>
              current
                ? {
                    ...current,
                    toolCalls: current.toolCalls.map((call) =>
                      call.id === event.id ? { ...call, status: event.status } : call,
                    ),
                  }
                : current,
            );
            break;

          case "done":
            // The saved row replaces the draft, so what stays on screen is exactly
            // what a refresh would show.
            setMessages((current) => [...current, event.message]);
            setReply(null);
            break;

          case "register-changed":
            // Not awaited: the import is another agent run, and the conversation
            // should not be held up by it. Whatever it finds lands in the table,
            // which is a different screen from this one.
            refreshRegister();
            break;

          case "error":
            toast.error(event.message);
            // A saved reply already arrived as `done`; anything still in the draft
            // was never persisted, so it goes rather than lingering as a ghost.
            setReply(null);
            break;
        }
      }
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        toast.error("The connection to the assistant dropped.");
      }
    } finally {
      abortRef.current = null;
      setPendingUserText(null);
      setReply(null);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function startNewConversation() {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setDraft("");
    setReply(null);
    setPendingUserText(null);
    textareaRef.current?.focus();
  }

  const empty = messages.length === 0 && !isStreaming;

  return (
    // Fills the shell's remaining height, so the composer stays pinned and only
    // the transcript scrolls.
    <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 sm:px-6">
      <div className="flex items-center justify-between gap-4 py-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Assistant</h1>
          <p className="text-muted-foreground text-sm">
            Ask about your agreements, or send one for signature.
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={startNewConversation}>
            New conversation
          </Button>
        )}
      </div>

      {!connected && (
        <div
          className="border-l-primary/40 bg-muted/50 text-muted-foreground mb-4 rounded-r-md border-l-2 px-3 py-2 text-xs/relaxed"
          role="note"
        >
          <span className="text-foreground font-medium">Docusign isn&apos;t connected.</span>{" "}
          The assistant works entirely through Docusign, so connect your account from
          the header before asking it anything.
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <Logo className="size-10" />
            <h2 className="mt-5 font-semibold tracking-tight">Nothing asked yet</h2>
            <p className="text-muted-foreground mx-auto mt-2 max-w-sm text-sm/relaxed">
              Ask about the contract register in plain English, or have an agreement
              sent for signature. Try one of these:
            </p>
            <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setDraft(suggestion);
                    textareaRef.current?.focus();
                  }}
                  className="bg-card hover:border-primary/40 hover:bg-accent/60 rounded-md border px-3 py-2 text-left text-sm transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 pb-4">
            {messages.map((entry) => (
              <MessageBubble key={entry.id} message={entry} />
            ))}

            {pendingUserText !== null && (
              <Bubble role="user">{pendingUserText}</Bubble>
            )}

            {reply && (
              <div className="space-y-2">
                <ToolCallList calls={reply.toolCalls} />
                {reply.text ? (
                  <Bubble role="assistant">{reply.text}</Bubble>
                ) : (
                  reply.toolCalls.length === 0 && <TypingDots />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-background border-t py-4">
        <div className="bg-card focus-within:border-ring focus-within:ring-ring/40 flex items-end gap-2 rounded-lg border p-2 transition-shadow focus-within:ring-3">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            disabled={!connected}
            placeholder={
              connected ? "Ask about your agreements…" : "Connect Docusign to start"
            }
            aria-label="Message"
            className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-1.5 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          {isStreaming ? (
            <Button size="icon" variant="outline" onClick={stop} aria-label="Stop">
              <Square className="size-3.5 fill-current" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={submit}
              disabled={!connected || draft.trim().length === 0}
              aria-label="Send message"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4"
                aria-hidden="true"
              >
                <path d="M4.5 12h13M12 5.5 18.5 12 12 18.5" />
              </svg>
            </Button>
          )}
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          Enter to send · Shift + Enter for a new line
        </p>
      </div>
    </main>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "user") return <Bubble role="user">{message.content}</Bubble>;

  return (
    <div className="space-y-2">
      <ToolCallList calls={message.toolCalls ?? []} />
      <Bubble role="assistant">{message.content}</Bubble>
    </div>
  );
}

/**
 * The assistant writes markdown, so its replies are rendered as markdown.
 *
 * User messages stay literal. Someone typing `*` means an asterisk, and rendering
 * their text would also let a pasted heading or link reshape the transcript.
 */
function Bubble({ role, children }: { role: "user" | "assistant"; children: string }) {
  const isUser = role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm/relaxed",
          isUser
            ? "bg-primary text-primary-foreground whitespace-pre-wrap"
            : "bg-card text-card-foreground border",
        )}
      >
        {isUser ? children : <Markdown>{children}</Markdown>}
      </div>
    </div>
  );
}

/**
 * Every Docusign action the agent took, shown as it happens.
 *
 * This is the part worth being loud about: the agent can send an agreement to a
 * real person. Seeing "Send envelope" appear the moment it runs — rather than
 * inferring it from the reply afterwards — is what makes that observable.
 */
function ToolCallList({ calls }: { calls: AgentToolCall[] }) {
  if (calls.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1.5">
      {calls.map((call) => (
        <ToolCallRow key={call.id} call={call} />
      ))}
    </ul>
  );
}

function ToolCallRow({ call }: { call: AgentToolCall }) {
  const args = formatArgs(call.input);

  return (
    <li className="bg-muted/40 max-w-[85%] rounded-md border px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <ToolStatusIcon status={call.status} />
        <span className="text-muted-foreground">Docusign</span>
        <span className="text-foreground font-medium">{toolDisplayName(call.name)}</span>
        {call.status === "error" && (
          <span className="text-destructive ml-auto font-medium">failed</span>
        )}
      </div>

      {args && (
        <details className="group mt-1.5">
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none text-xs underline-offset-2 hover:underline">
            <span className="group-open:hidden">Show details</span>
            <span className="hidden group-open:inline">Hide details</span>
          </summary>
          <pre className="text-muted-foreground mt-1.5 overflow-x-auto text-xs leading-relaxed">
            {args}
          </pre>
        </details>
      )}
    </li>
  );
}

function ToolStatusIcon({ status }: { status: AgentToolCall["status"] }) {
  if (status === "running") {
    return (
      <Loader2
        className="text-muted-foreground size-3.5 shrink-0 animate-spin"
        aria-label="Running"
      />
    );
  }
  if (status === "error") {
    return <AlertTriangle className="text-destructive size-3.5 shrink-0" aria-label="Failed" />;
  }
  return (
    <CheckCircle2
      className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-500"
      aria-label="Done"
    />
  );
}

/** Pretty-prints tool arguments, or returns null when there is nothing to show. */
function formatArgs(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  if (Object.keys(input as Record<string, unknown>).length === 0) return null;

  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return null;
  }
}

function TypingDots() {
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-sm">
      <PenLine className="size-3.5" aria-hidden="true" />
      <span className="bg-muted-foreground/60 size-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
      <span className="bg-muted-foreground/60 size-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
      <span className="bg-muted-foreground/60 size-1.5 animate-bounce rounded-full" />
    </div>
  );
}
