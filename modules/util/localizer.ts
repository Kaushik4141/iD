import { utilArrayUniq } from './array';

function collectLocale({ script, region, language }: Intl.Locale) {
    const codes = new Set<string>();

    if (script && region) codes.add(`${language}-${script}-${region}`);
    if (region) codes.add(`${language}-${region}`);
    if (script) codes.add(`${language}-${script}`);
    codes.add(language);

    return codes;
}


/**
 * expands a locale code like `ja` to `ja-Jpan-JP`,
 * using {@link https://www.unicode.org/cldr/charts/45/supplemental/likely_subtags.html Likely Subtags}
 * via {@link Intl.Locale}'s `maximize()`.
 * Then determines every possible combination.
 *
 * @returns an array sorted by priority (best first)
 */
export function utilExpandLocaleCode(localeCode: string): string[] {
    try {
        const original = new Intl.Locale(localeCode);
        const maximised = original.maximize();

        const collection = [localeCode];

        if (original.baseName !== localeCode) {
            // this means Intl.Locale transformed the input
            collection.push(localeCode.split('-')[0]);
        }

        collection.push(...collectLocale(maximised));
        collection.push(...collectLocale(original));

        return utilArrayUniq(collection);
    } catch {
        // presumably Intl.Locale#maximize is unsupported.
        // If so, we can still handle the most basic case.
        const [language] = localeCode.split('-');
        return utilArrayUniq([localeCode, language]);
    }
}
