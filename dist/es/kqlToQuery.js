function normalizeKqlLikeQuery(input) {
    return input
        .replace(/\bAND\b/gi, "and")
        .replace(/\bOR\b/gi, "or")
        .replace(/\bNOT\b/gi, "not")
        .trim();
}
/**
 * Accept a Kibana-like query string and translate it into an ES `query_string` query.
 * This covers the common cases users expect from the search bar:
 * `field:value`, quoted phrases, `and/or/not`, parentheses, and wildcards.
 */
export function kqlToEsQuery(kql, _indexPattern) {
    const query = normalizeKqlLikeQuery(kql);
    if (!query) {
        return { match_all: {} };
    }
    return {
        query_string: {
            query,
            analyze_wildcard: true,
            default_operator: "AND",
            lenient: true
        }
    };
}
