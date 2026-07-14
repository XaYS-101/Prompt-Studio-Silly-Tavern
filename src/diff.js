// Dependency-free two-level diff: line-level LCS, then word-level LCS inside
// replaced line runs. Output is a flat op list the history view renders.

/** @returns {{type:'same'|'add'|'del', text:string}[]} per line */
function lcsDiff(a, b) {
    const n = a.length;
    const m = b.length;
    // DP table of LCS lengths; n*m is fine for prompt-sized inputs, but guard
    // pathological sizes by falling back to a trivial replace diff.
    if (n * m > 4_000_000) {
        return [
            ...a.map(text => ({ type: 'del', text })),
            ...b.map(text => ({ type: 'add', text })),
        ];
    }
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            out.push({ type: 'same', text: a[i] });
            i++; j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            out.push({ type: 'del', text: a[i] });
            i++;
        } else {
            out.push({ type: 'add', text: b[j] });
            j++;
        }
    }
    while (i < n) out.push({ type: 'del', text: a[i++] });
    while (j < m) out.push({ type: 'add', text: b[j++] });
    return out;
}

const splitWords = (text) => text.match(/\S+|\s+/g) ?? [];

/**
 * Word-level ops for one replaced line pair.
 * @returns {{type:'same'|'add'|'del', text:string}[]}
 */
export function diffWords(oldLine, newLine) {
    return lcsDiff(splitWords(oldLine), splitWords(newLine));
}

/**
 * Diff two texts.
 * @returns {Array<
 *   {type:'same'|'add'|'del', text:string} |
 *   {type:'change', words:{type:'same'|'add'|'del', text:string}[]}
 * >} one entry per output line; 'change' pairs a del+add line into word ops.
 */
export function diffLines(oldText, newText) {
    const ops = lcsDiff(String(oldText ?? '').split('\n'), String(newText ?? '').split('\n'));
    // Pair adjacent del/add runs of equal length into word-level changes.
    const out = [];
    let k = 0;
    while (k < ops.length) {
        if (ops[k].type !== 'del') {
            out.push(ops[k++]);
            continue;
        }
        const dels = [];
        while (k < ops.length && ops[k].type === 'del') dels.push(ops[k++]);
        const adds = [];
        while (k < ops.length && ops[k].type === 'add') adds.push(ops[k++]);
        const paired = Math.min(dels.length, adds.length);
        for (let p = 0; p < paired; p++) {
            out.push({ type: 'change', words: diffWords(dels[p].text, adds[p].text) });
        }
        for (let p = paired; p < dels.length; p++) out.push(dels[p]);
        for (let p = paired; p < adds.length; p++) out.push(adds[p]);
    }
    return out;
}
