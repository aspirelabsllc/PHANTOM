"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// The Phantom's replies come back as markdown (bold, bullet lists, code,
// links). Render them as real formatted text instead of raw ** and - noise.
// Shared by the manifest build chat and the invocation refinement chat.
export function ReplyMd({ children }: { children: string }) {
  return (
    <div className="plain md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
