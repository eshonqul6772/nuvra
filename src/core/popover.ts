/** Whether the Popover API can show floating panels in the top layer; without it they are fixed elements. */
export const SUPPORTS_POPOVER = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

/** Close callback of the open popover or menu; the editor keeps at most one of them open at a time. */
let closeCurrent: (() => void) | undefined;

/** Records a popover that has just opened and closes the one that was open before it. */
export const setOpenPopover = (close: () => void): void => {
  if (closeCurrent && closeCurrent !== close) closeCurrent();
  closeCurrent = close;
};

/** Forgets a popover that has closed. */
export const clearOpenPopover = (close: () => void): void => {
  if (closeCurrent === close) closeCurrent = undefined;
};
