// ProseMirror / TipTap JSON ({type: "doc", content: [...]}) → HTML for parseChapterHtml (SOURCES_DESIGN.md §5.4).
// RanobeLib sends chapter text and book summaries in this form. Text is escaped, so "Ранг <S>" stays text.
// Unknown node types keep their children (or are dropped when they have none): a new node type must not leak JSON.

export interface PmNode {
  type: string;
  content?: PmNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string }[];
}

/** Resolves an image node to a URL (and size when known); null drops it. */
export type PmImage = (node: PmNode) => { src: string; w?: number; h?: number }[] | null;

const BLOCK_TAG: Record<string, string> = {
  paragraph: "p", blockquote: "blockquote", heading: "h3", listItem: "li", bulletList: "ul", orderedList: "ol",
  codeBlock: "pre",
};
const MARK_TAG: Record<string, string> = { bold: "b", italic: "i", underline: "u", strike: "s", code: "code" };

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function isPmDoc(v: unknown): v is PmNode {
  return !!v && typeof v === "object" && (v as PmNode).type === "doc" && Array.isArray((v as PmNode).content);
}

export function prosemirrorToHtml(doc: PmNode, image?: PmImage): string {
  const out: string[] = [];
  const walk = (nodes: PmNode[] | undefined) => {
    for (const n of nodes || []) {
      if (!n || typeof n !== "object") continue;
      switch (n.type) {
        case "text": {
          let t = escapeHtml(typeof n.text === "string" ? n.text : "");
          for (const m of n.marks || []) { const tag = MARK_TAG[m.type]; if (tag) t = `<${tag}>${t}</${tag}>`; }
          out.push(t);
          break;
        }
        case "hardBreak": out.push("<br>"); break;
        case "horizontalRule": out.push("<hr>"); break;
        case "image": {
          for (const im of (image ? image(n) : null) || []) {
            out.push(`<img src="${escapeHtml(im.src)}"${im.w ? ` width="${im.w}"` : ""}${im.h ? ` height="${im.h}"` : ""}>`);
          }
          break;
        }
        default: {
          const tag = BLOCK_TAG[n.type] || (n.content ? "div" : "");
          if (!tag) break;
          out.push(`<${tag}>`);
          walk(n.content);
          out.push(`</${tag}>`);
        }
      }
    }
  };
  walk(doc.content);
  return out.join("");
}
