import { type InjectionKey, type Ref, computed, inject, provide, shallowRef } from 'vue';

import { en } from './locales/en';
import { ru } from './locales/ru';
import { type EditorLabelKey, uz } from './locales/uz';

export type { EditorLabelKey };

/** Languages the editor interface is available in. */
export type EditorLocaleCode = 'uz' | 'en' | 'ru';

/**
 * A built-in interface language. Locales only select one of the translations shipped with the editor; the texts
 * themselves cannot be changed from outside.
 */
export interface EditorLocale {
  /** Language code. */
  readonly code: EditorLocaleCode;
  /** Name of the language in that language, for language pickers. */
  readonly name: string;
}

/** A locale object, or just its code. */
export type EditorLocaleInput = EditorLocale | EditorLocaleCode;

/** Texts of every built-in language. */
const MESSAGES: Readonly<Record<EditorLocaleCode, Readonly<Record<EditorLabelKey, string>>>> = { uz, en, ru };

/** Uzbek (Latin) interface. */
export const uzLocale: EditorLocale = Object.freeze({ code: 'uz', name: 'O‘zbekcha' });
/** English interface. */
export const enLocale: EditorLocale = Object.freeze({ code: 'en', name: 'English' });
/** Russian interface. */
export const ruLocale: EditorLocale = Object.freeze({ code: 'ru', name: 'Русский' });

/** Every built-in locale, in the order they are offered. */
export const editorLocales: ReadonlyArray<EditorLocale> = Object.freeze([uzLocale, enLocale, ruLocale]);

/** Language used when neither the editor nor the app chose one. */
const DEFAULT_LOCALE: EditorLocaleCode = 'uz';

/** Resolves a locale or code to a supported code; unknown values give `undefined`. */
const resolveCode = (input: EditorLocaleInput | undefined): EditorLocaleCode | undefined => {
  const code = typeof input === 'string' ? input : input?.code;
  return code && Object.hasOwn(MESSAGES, code) ? code : undefined;
};

/** App-wide language, used by editors without a `locale` prop. Reactive, so switching it re-renders every editor. */
const appLocale = shallowRef<EditorLocaleCode>(DEFAULT_LOCALE);

/** Sets the interface language of every editor that does not choose its own with the `locale` prop. */
export const setEditorLocale = (locale: EditorLocaleInput): void => {
  appLocale.value = resolveCode(locale) ?? DEFAULT_LOCALE;
};

/** Language of the surrounding editor, shared with its child components. */
const LOCALE_KEY: InjectionKey<Readonly<Ref<EditorLocaleCode>>> = Symbol('nuvra-locale');

/** Whether shortcuts should be shown with Apple modifier symbols. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
/** `{name}` placeholders inside messages. */
const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

/** Formats a shortcut written as `Mod+Shift+K` for the current platform (`Ctrl+Shift+K` or `⌘⇧K`). */
export const formatShortcut = (shortcut: string): string =>
  IS_MAC
    ? shortcut
        .replace(/Mod\+/g, '⌘')
        .replace(/Shift\+/g, '⇧')
        .replace(/Alt\+/g, '⌥')
    : shortcut.replace(/Mod/g, 'Ctrl');

/**
 * Label helpers in the editor's language. The root editor passes its `locale` prop and shares the result with its
 * children; child components call it without arguments. Must be called during component setup.
 *
 * @param locale Getter for the language chosen by this component; `undefined` inherits it.
 */
export const useEditorLabels = (locale?: () => EditorLocaleInput | undefined) => {
  const inherited = inject(LOCALE_KEY, undefined);
  const code = computed(() => resolveCode(locale?.()) ?? inherited?.value ?? appLocale.value);
  if (locale) provide(LOCALE_KEY, code);

  /**
   * Translates an editor label.
   *
   * @param named Values for `{name}` placeholders in the message.
   */
  const t = (key: EditorLabelKey, named?: Record<string, unknown>): string => {
    const message = MESSAGES[code.value][key];
    return named ? message.replace(PLACEHOLDER_PATTERN, (_, name: string) => String(named[name] ?? '')) : message;
  };

  /** Label followed by its keyboard shortcut in parentheses, for button tooltips. */
  const withShortcut = (key: EditorLabelKey, shortcut: string): string => `${t(key)} (${formatShortcut(shortcut)})`;

  return { t, withShortcut };
};
