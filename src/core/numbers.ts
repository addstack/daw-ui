// Number helpers shared by formats and grids; not part of the public API.

/** Prints whole numbers with at least `width` digits: "03". */
export function createPadder(locale: Intl.LocalesArgument | undefined) {
  const cache = new Map<number, Intl.NumberFormat>();
  return (value: number, width = 1): string => {
    let formatter = cache.get(width);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, { minimumIntegerDigits: width, useGrouping: false });
      cache.set(width, formatter);
    }
    return formatter.format(value);
  };
}

/** A symbol of the locale, such as its decimal separator or minus sign. */
export function symbol(locale: Intl.LocalesArgument | undefined, type: Intl.NumberFormatPartTypes, fallback: string): string {
  const parts = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 }).formatToParts(-1.5);
  return parts.find((part) => part.type === type)?.value ?? fallback;
}
