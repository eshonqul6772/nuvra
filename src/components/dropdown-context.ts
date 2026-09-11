import type { InjectionKey } from 'vue';

/** Value an `EditorDropdownItem` reports when it is chosen. */
export type DropdownCommand = string | number;

/** Provided by `EditorDropdown`: chooses a command and closes the menu. */
export const DROPDOWN_SELECT: InjectionKey<(command: DropdownCommand) => void> = Symbol('EditorDropdownSelect');
