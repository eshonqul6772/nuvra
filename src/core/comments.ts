/**
 * Comments on parts of a document. The document HTML only keeps the anchors, `<span data-comment="id">`; the comments
 * themselves are plain data the host stores next to the document with `v-model:comments`.
 */

/** A reply in the thread of a comment. */
export interface DocumentCommentReply {
  /** Unique id of the reply. */
  id: string;
  /** Text of the reply. */
  text: string;
  /** Name of the person who wrote it, when the host knows it. */
  author?: string;
  /** When it was written, as an ISO 8601 string. */
  createdAt: string;
}

/** A comment anchored to a span of the document text. */
export interface DocumentComment extends DocumentCommentReply {
  /** Whether the discussion is closed; resolved comments keep their anchor but are not highlighted. */
  resolved?: boolean;
  /** Replies in the order they were written. */
  replies?: DocumentCommentReply[];
}

/** A new random id for a comment or a reply, usable as an HTML attribute value. */
export const createCommentId = (): string => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Comments in the order their anchors appear in the document; comments whose text was deleted come last. */
export const sortComments = (
  comments: readonly DocumentComment[],
  anchoredIds: readonly string[]
): DocumentComment[] => {
  const order = new Map(anchoredIds.map((id, index) => [id, index]));
  return [...comments].sort(
    (a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );
};
