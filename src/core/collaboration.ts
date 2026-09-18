/**
 * Hooks for editing a document together. The editor reports where the caret is and draws the carets and selections
 * of other people; sending the document and the selections between them (WebSocket, WebRTC, a CRDT such as Yjs) is
 * left to the application.
 */

/** A selection as character positions through the document; equal positions are a caret. */
export interface SelectionOffsets {
  /** Where selecting started. */
  anchor: number;
  /** Where the caret is. */
  focus: number;
}

/** Someone else edits the same document. */
export interface Collaborator {
  /** Stable id of the person or connection. */
  id: string;
  /** Name shown next to the caret. */
  name: string;
  /** CSS color of the caret and the selection; one is picked from the id when it is left out. */
  color?: string;
  /** Where the person's caret or selection is, or `null` while they are not in the document. */
  selection: SelectionOffsets | null;
}

/** Colors given to collaborators without one, readable on white paper. */
const COLLABORATOR_COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d'];

/** The color of a collaborator: their own, or a stable one derived from the id. */
export const collaboratorColor = (collaborator: Pick<Collaborator, 'id' | 'color'>): string => {
  if (collaborator.color) return collaborator.color;
  let hash = 0;
  for (const character of collaborator.id) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return COLLABORATOR_COLORS[hash % COLLABORATOR_COLORS.length] ?? '#2563eb';
};
