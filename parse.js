// parse.js — a fast CommonMark 0.31.2 + GFM renderer that returns exactly the
// HTML marked 18.1.3 (default options, GFM on) returns for the same input.
// Dependency-free ES module. Written from the CommonMark/GFM specs and from
// marked's observable behaviour on the practice cases; no reference source
// was consulted. Deterministic: no clock, no randomness, no environment reads,
// no state kept between parse() calls.


// ---------------------------------------------------------------------------
// Character classes
// ---------------------------------------------------------------------------

// ASCII punctuation, per the CommonMark definition (Unicode general
// categories P and S). For ASCII that is exactly: 0x21-0x2F, 0x3A-0x40,
// 0x5B-0x60, 0x7B-0x7E.
function isAsciiPunct(code) {
  return (
    (code >= 0x21 && code <= 0x2f) ||
    (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
}

const UNICODE_PUNCT = /[\p{P}\p{S}]/u;
const UNICODE_SPACE = /\s/u;

// Is the single character string ch Unicode whitespace?
function isSpace(ch) {
  if (ch === undefined) return true; // start/end of line counts as whitespace
  const code = ch.charCodeAt(0);
  if (code < 128) {
    return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0b || code === 0x0c;
  }
  return UNICODE_SPACE.test(ch);
}

// Is the single character string ch Unicode punctuation (P or S)?
function isPunct(ch) {
  if (ch === undefined) return false;
  const code = ch.charCodeAt(0);
  if (code < 128) return isAsciiPunct(code);
  return UNICODE_PUNCT.test(ch);
}

// ASCII punctuation that a backslash can escape.
function isEscapable(code) {
  return isAsciiPunct(code);
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

// Escape text the way marked does for ordinary text, link hrefs and titles:
// & < > " ' are escaped, except that an & that starts something that looks
// like an entity (&word; / &#123; / &#x1a;) is left alone.
const ESCAPE_NO_ENCODE_RE = /&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)|[<>"']/g;
const ESCAPE_FULL_RE = /[&<>"']/g;

function escapeText(s) {
  if (s.indexOf('&') === -1 && s.indexOf('<') === -1 && s.indexOf('>') === -1 && s.indexOf('"') === -1 && s.indexOf("'") === -1) return s;
  return s.replace(ESCAPE_NO_ENCODE_RE, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });
}

// Escape code content: every & < > " ' is escaped.
function escapeCode(s) {
  if (s.indexOf('&') === -1 && s.indexOf('<') === -1 && s.indexOf('>') === -1 && s.indexOf('"') === -1 && s.indexOf("'") === -1) return s;
  return s.replace(ESCAPE_FULL_RE, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });
}

// Decode one numeric entity (&#123; or &#x1a;). Returns the replacement
// string, or null when the text at pos is not a valid entity. Named
// entities are NOT decoded: marked leaves them as literal text (cm-025),
// and the text escaper leaves &word; alone. pos points at '&'.
// end is set on the returned array as [text, nextPos].
function decodeEntityAt(s, pos) {
  const n = s.length;
  if (pos + 1 >= n) return null;
  const c1 = s.charCodeAt(pos + 1);
  if (c1 !== 35) return null;
  // &#...; or &#x...;
  let i = pos + 2;
  let hex = false;
  if (i < n && (s.charCodeAt(i) === 120 || s.charCodeAt(i) === 88)) {
    hex = true;
    i++;
  }
  const start = i;
  if (hex) {
    while (i < n) {
      const c = s.charCodeAt(i);
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)) i++;
      else break;
    }
  } else {
    while (i < n && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) i++;
  }
  if (i === start || i >= n || s.charCodeAt(i) !== 59) return null; // need ';'
  const digits = s.slice(start, i);
  if ((!hex && digits.length > 7) || (hex && digits.length > 6)) return null;
  let cp = parseInt(digits, hex ? 16 : 10);
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) cp = 0xfffd;
  return [String.fromCodePoint(cp), i + 1];
}

// Does the text at pos start with something that looks like an entity
// (used only to decide whether a bare & in text is left alone)? Mirrors
// decodeEntityAt but without the table lookup.
function looksLikeEntity(s, pos) {
  const n = s.length;
  if (pos + 1 >= n) return false;
  const c1 = s.charCodeAt(pos + 1);
  if (c1 === 35) {
    let i = pos + 2;
    let hex = false;
    if (i < n && (s.charCodeAt(i) === 120 || s.charCodeAt(i) === 88)) {
      hex = true;
      i++;
    }
    const start = i;
    if (hex) {
      while (i < n) {
        const c = s.charCodeAt(i);
        if ((c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)) i++;
        else break;
      }
    } else {
      while (i < n && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) i++;
    }
    if (i === start || i >= n || s.charCodeAt(i) !== 59) return false;
    const len = i - start;
    return hex ? len <= 6 : len <= 7;
  }
  let i = pos + 1;
  while (i < n) {
    const c = s.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) i++;
    else break;
  }
  return i < n && s.charCodeAt(i) === 59 && i > pos + 1;
}

// ---------------------------------------------------------------------------
// Links: destinations, titles, labels
// ---------------------------------------------------------------------------

function cleanUrl(href) {
  if (href === '') return '';
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch (e) {
    return null;
  }
}

// Normalize a link label: collapse whitespace runs to one space, trim,
// case-fold.
// Case-fold a link label (Unicode case folding, approximated): lowercase,
// collapse whitespace, and fold the characters whose full folding differs
// from the simple lowercase mapping (sharp s, final sigma).
function normalizeLabel(s) {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ς/g, 'σ');
}

// Parse a link destination starting at pos in s. Returns [dest, nextPos]
// (nextPos is just past the destination) or null. The caller has already
// skipped whitespace after '('.
function parseLinkDestination(s, pos) {
  const n = s.length;
  if (pos >= n) return null;
  if (s.charCodeAt(pos) === 60) {
    // <...>: no line endings, no unescaped < or >. Backslashes stay literal.
    let i = pos + 1;
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === 10) return null;
      if (c === 62 || c === 60) {
        // is it escaped? count preceding backslashes
        let bs = 0;
        let j = i - 1;
        while (j > pos && s.charCodeAt(j) === 92) {
          bs++;
          j--;
        }
        if (bs % 2 === 0) {
          if (c === 62) return [s.slice(pos + 1, i), i + 1];
          return null; // unescaped < inside
        }
      }
      i++;
    }
    return null;
  }
  // Bare destination: no spaces or control chars, balanced parens,
  // backslash escapes for ASCII punctuation.
  let i = pos;
  let depth = 0;
  let dest = '';
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c <= 32) break; // space or control char (incl. newline)
    if (c === 92 && i + 1 < n && isAsciiPunct(s.charCodeAt(i + 1))) {
      dest += s[i + 1];
      i += 2;
      continue;
    }
    if (c === 40) {
      depth++;
      dest += '(';
      i++;
      continue;
    }
    if (c === 41) {
      if (depth === 0) break;
      depth--;
      dest += ')';
      i++;
      continue;
    }
    dest += s[i];
    i++;
  }
  if (dest === '' || depth !== 0) return null;
  return [dest, i];
}

// Parse a link title starting at pos in s. Returns [title, nextPos] or null.
// The title is "..." or '...' or (...); backslash escapes are processed,
// entities are not decoded.
function parseLinkTitle(s, pos) {
  const n = s.length;
  if (pos >= n) return null;
  const open = s.charCodeAt(pos);
  let close;
  if (open === 34) close = 34;
  else if (open === 39) close = 39;
  else if (open === 40) close = 41;
  else return null;
  let i = pos + 1;
  let title = '';
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 92 && i + 1 < n && isAsciiPunct(s.charCodeAt(i + 1))) {
      title += s[i + 1];
      i += 2;
      continue;
    }
    if (c === close) return [title, i + 1];
    if (close === 41 && c === 40) return null; // no unescaped ( in a (...) title
    title += s[i];
    i++;
  }
  return null;
}

// Parse a link label [ ... ] starting at pos (pos points at '[').
// Returns [label, nextPos] (nextPos just past ']') or null.
// A link label: [ ... ] with no unescaped [ inside. Returns
// [label, nextPos] or null.
function parseLinkLabel(s, pos) {
  const n = s.length;
  let i = pos + 1;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 92 && i + 1 < n && isAsciiPunct(s.charCodeAt(i + 1))) {
      i += 2;
      continue;
    }
    if (c === 91) return null; // unescaped [ is not allowed in a label
    if (c === 93) return [s.slice(pos + 1, i), i + 1];
    i++;
  }
  return null;
}

// Skip spaces and tabs (not newlines) from pos. Returns the new position.
function skipSpacesTabs(s, pos) {
  const n = s.length;
  while (pos < n) {
    const c = s.charCodeAt(pos);
    if (c === 32 || c === 9) pos++;
    else break;
  }
  return pos;
}

// Skip spaces, tabs and newlines from pos.
function skipWhitespace(s, pos) {
  const n = s.length;
  while (pos < n) {
    const c = s.charCodeAt(pos);
    if (c === 32 || c === 9 || c === 10) pos++;
    else break;
  }
  return pos;
}

// ---------------------------------------------------------------------------
// Raw HTML (inline)
// ---------------------------------------------------------------------------

function isTagNameStart(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
function isTagNameChar(code) {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 45
  );
}
function isAttrNameStart(code) {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 58
  );
}
function isAttrNameChar(code) {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 95 ||
    code === 58 ||
    code === 46 ||
    code === 45
  );
}

// Try to match a raw HTML token at pos (s[pos] === '<').
// Returns [html, nextPos] or null.
function scanRawHtml(s, pos) {
  const n = s.length;
  // comment
  if (s.startsWith('<!--', pos)) {
    if (s.startsWith('<!-->', pos)) return [s.slice(pos, pos + 5), pos + 5];
    if (s.startsWith('<!--->', pos)) return [s.slice(pos, pos + 6), pos + 6];
    const end = s.indexOf('-->', pos + 4);
    if (end === -1) return null;
    return [s.slice(pos, end + 3), end + 3];
  }
  // processing instruction
  if (s.startsWith('<?', pos)) {
    const end = s.indexOf('?>', pos + 2);
    if (end === -1) return null;
    return [s.slice(pos, end + 2), end + 2];
  }
  // declaration
  if (s.startsWith('<!', pos) && pos + 2 < n) {
    const c = s.charCodeAt(pos + 2);
    if (c >= 65 && c <= 90) {
      let i = pos + 3;
      while (i < n && s.charCodeAt(i) !== 62) i++;
      if (i >= n) return null;
      return [s.slice(pos, i + 1), i + 1];
    }
  }
  // CDATA
  if (s.startsWith('<![CDATA[', pos)) {
    const end = s.indexOf(']]>', pos + 9);
    if (end === -1) return null;
    return [s.slice(pos, end + 3), end + 3];
  }
  let i = pos + 1;
  let closing = false;
  if (i < n && s.charCodeAt(i) === 47) {
    closing = true;
    i++;
  }
  if (i >= n || !isTagNameStart(s.charCodeAt(i))) return null;
  while (i < n && isTagNameChar(s.charCodeAt(i))) i++;
  if (closing) {
    // closing tag: only whitespace, then >
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10) i++;
      else break;
    }
    if (i < n && s.charCodeAt(i) === 62) return [s.slice(pos, i + 1), i + 1];
    return null;
  }
  // open tag: attributes
  while (true) {
    // skip whitespace (incl. newlines)
    let j = i;
    while (j < n) {
      const c = s.charCodeAt(j);
      if (c === 32 || c === 9 || c === 10) j++;
      else break;
    }
    if (j >= n) return null;
    const c = s.charCodeAt(j);
    if (c === 62) return [s.slice(pos, j + 1), j + 1];
    if (c === 47 && j + 1 < n && s.charCodeAt(j + 1) === 62) return [s.slice(pos, j + 2), j + 2];
    if (j === i) return null; // no whitespace before the attribute
    i = j;
    // attribute name
    if (!isAttrNameStart(s.charCodeAt(i))) return null;
    i++;
    while (i < n && isAttrNameChar(s.charCodeAt(i))) i++;
    const nameEnd = i;
    // optional = value
    let k = i;
    while (k < n) {
      const cc = s.charCodeAt(k);
      if (cc === 32 || cc === 9 || cc === 10) k++;
      else break;
    }
    if (k < n && s.charCodeAt(k) === 61) {
      k++;
      while (k < n) {
        const cc = s.charCodeAt(k);
        if (cc === 32 || cc === 9 || cc === 10) k++;
        else break;
      }
      if (k >= n) return null;
      const q = s.charCodeAt(k);
      if (q === 34 || q === 39) {
        // quoted value: ends at the matching quote (a backslash does
        // not escape the quote in HTML)
        k++;
        let ok = false;
        while (k < n) {
          if (s.charCodeAt(k) === q) {
            ok = true;
            k++;
            break;
          }
          k++;
        }
        if (!ok) return null;
        i = k;
      } else {
        // unquoted value: no space, ", ', =, <, >, `
        if (q === 32 || q === 9 || q === 10 || q === 34 || q === 39 || q === 61 || q === 60 || q === 62 || q === 96) return null;
        while (k < n) {
          const cc = s.charCodeAt(k);
          if (cc === 32 || cc === 9 || cc === 10 || cc === 34 || cc === 39 || cc === 61 || cc === 60 || cc === 62 || cc === 96) break;
          k++;
        }
        i = k;
      }
    } else {
      i = nameEnd;
    }
  }
}

// ---------------------------------------------------------------------------
// Autolinks
// ---------------------------------------------------------------------------

function isSchemeChar(code) {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 43 ||
    code === 46 ||
    code === 45
  );
}

function isLocalPartChar(code) {
  // [a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]  (backtick and ! excluded from the
  // walk-back set: they can start tokens of their own)
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 46 ||
    code === 95 ||
    code === 45 ||
    code === 43 ||
    code === 37 ||
    code === 36 ||
    code === 35 ||
    code === 38 ||
    code === 39 ||
    code === 47 ||
    code === 61 ||
    code === 63 ||
    code === 94 ||
    code === 123 ||
    code === 124 ||
    code === 125 ||
    code === 126
  );
}

function isDomainLabelChar(code) {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 45
  );
}
function isAlnum(code) {
  return (
    (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57)
  );
}

// Match an email domain starting at pos. Returns the end position, or -1.
// Labels are 1-63 chars, alphanumeric at both ends, hyphens inside.
function matchDomain(s, pos) {
  const n = s.length;
  let i = pos;
  let labels = 0;
  while (true) {
    if (i >= n || !isAlnum(s.charCodeAt(i))) return -1;
    const start = i;
    i++;
    while (i < n && isDomainLabelChar(s.charCodeAt(i))) i++;
    const len = i - start;
    if (len > 63) return -1;
    if (!isAlnum(s.charCodeAt(i - 1))) return -1;
    labels++;
    if (i < n && s.charCodeAt(i) === 46 && i + 1 < n && isAlnum(s.charCodeAt(i + 1))) {
      i++;
      continue;
    }
    break;
  }
  return labels > 0 ? i : -1;
}

// Strip trailing punctuation, unbalanced closing parens and entity-like
// tails from an extended autolink, per the GFM rules.
function backpedalUrl(url) {
  let end = url.length;
  while (end > 0) {
    // entity-like tail: &word;
    if (url.charCodeAt(end - 1) === 59) {
      let j = end - 2;
      while (j >= 0) {
        const c = url.charCodeAt(j);
        if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) j--;
        else break;
      }
      if (j >= 0 && url.charCodeAt(j) === 38 && j < end - 2) {
        end = j;
        continue;
      }
    }
    const c = url.charCodeAt(end - 1);
    if (c === 63 || c === 33 || c === 46 || c === 44 || c === 58 || c === 59 || c === 42 || c === 95 || c === 126) {
      end--;
      continue;
    }
    if (c === 41) {
      // Strip a trailing close paren only when it is unmatched (no
      // open paren before it is still waiting for a close).
      let depth = 0;
      for (let k = 0; k < end - 1; k++) {
        const cc = url.charCodeAt(k);
        if (cc === 40) depth++;
        else if (cc === 41 && depth > 0) depth--;
      }
      if (depth === 0) {
        end--;
        continue;
      }
    }
    break;
  }
  // An open paren with no matching close paren ends the URL: truncate
  // before the first `(` that never closes.
  {
    const stack = [];
    for (let k = 0; k < end; k++) {
      const cc = url.charCodeAt(k);
      if (cc === 40) stack.push(k);
      else if (cc === 41 && stack.length > 0) stack.pop();
    }
    if (stack.length > 0) end = stack[0];
  }
  return url.slice(0, end);
}

// Try to match a <...> autolink at pos (s[pos] === '<').
// Returns [href, text, nextPos] or null.
function matchBracketAutolink(s, pos) {
  const n = s.length;
  let i = pos + 1;
  if (i >= n) return null;
  const c0 = s.charCodeAt(i);
  // email form: local@domain
  if (
    (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || (c0 >= 48 && c0 <= 57) ||
    c0 === 46 || c0 === 95 || c0 === 45 || c0 === 43 || c0 === 37 || c0 === 36 ||
    c0 === 35 || c0 === 38 || c0 === 39 || c0 === 47 || c0 === 61 || c0 === 63 ||
    c0 === 94 || c0 === 96 || c0 === 123 || c0 === 124 || c0 === 125 || c0 === 126
  ) {
    let j = i;
    while (j < n) {
      const c = s.charCodeAt(j);
      if (c === 64) {
        const domEnd = matchDomain(s, j + 1);
        if (domEnd !== -1 && domEnd < n && s.charCodeAt(domEnd) === 62) {
          const email = s.slice(i, domEnd);
          return ['mailto:' + email, email, domEnd + 1];
        }
        return null;
      }
      if (
        (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) ||
        c === 46 || c === 95 || c === 45 || c === 43 || c === 37 || c === 36 ||
        c === 35 || c === 38 || c === 39 || c === 47 || c === 61 || c === 63 ||
        c === 94 || c === 96 || c === 123 || c === 124 || c === 125 || c === 126
      ) {
        j++;
        continue;
      }
      break;
    }
    // fall through to the scheme attempt if the local part scan stopped
    // before an @ (e.g. a scheme like "localhost:5001")
  }
  // scheme form: scheme (2-32 chars, letter first) : content >
  if ((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122)) {
    let j = i + 1;
    while (j < n && isSchemeChar(s.charCodeAt(j))) j++;
    const schemeLen = j - i;
    if (schemeLen >= 2 && schemeLen <= 32 && j < n && s.charCodeAt(j) === 58) {
      let k = j + 1;
      while (k < n) {
        const c = s.charCodeAt(k);
        if (c === 62) {
          const content = s.slice(i, k);
          return [content, content, k + 1];
        }
        if (c <= 32 || c === 60) return null;
        k++;
      }
    }
  }
  return null;
}

// Match a www. autolink starting at pos (s starts with "www." there).
// Returns [href, text, nextPos] or null.
function matchWww(s, pos, inBracket) {
  const n = s.length;
  let i = pos + 4;
  // domain: labels, at least one dot, last label 2+ letters
  const domEnd = matchDomain(s, i);
  if (domEnd === -1) return null;
  // must contain a dot and end with a 2+ letter label
  let lastDot = -1;
  for (let k = i; k < domEnd; k++) if (s.charCodeAt(k) === 46) lastDot = k;
  if (lastDot === -1) return null;
  const tldLen = domEnd - lastDot - 1;
  if (tldLen < 2) return null;
  for (let k = lastDot + 1; k < domEnd; k++) {
    const c = s.charCodeAt(k);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return null;
  }
  i = domEnd;
  // optional :port
  if (i < n && s.charCodeAt(i) === 58) {
    let j = i + 1;
    while (j < n && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) j++;
    if (j > i + 1) i = j;
  }
  // optional path: any chars except whitespace and <
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c <= 32 || c === 60) break;
    if (inBracket && c === 93) break;
    i++;
  }
  const raw = s.slice(pos, i);
  const url = backpedalUrl(raw);
  if (url === '') return null;
  return ['http://' + url, url, pos + url.length];
}

// Match a scheme autolink starting at pos (the scheme start). The char at
// pos is a letter; the scheme is followed by :// or by an email.
// Returns [href, text, nextPos] or null.
function matchScheme(s, pos, inBracket, allowTrailingUnderscore) {
  const n = s.length;
  let i = pos;
  while (i < n && isSchemeChar(s.charCodeAt(i))) i++;
  const schemeLen = i - pos;
  if (schemeLen < 2 || schemeLen > 32) return null;
  if (i >= n || s.charCodeAt(i) !== 58) return null;
  // scheme://...
  if (i + 2 < n && s.charCodeAt(i + 1) === 47 && s.charCodeAt(i + 2) === 47) {
    let j = i + 3;
    while (j < n) {
      const c = s.charCodeAt(j);
      if (c <= 32 || c === 60) break;
      if (inBracket && c === 93) break;
      j++;
    }
    if (j === i + 3) return null;
    const raw = s.slice(pos, j);
    const url = backpedalUrl(raw);
    if (url === '') return null;
    return [url, url, pos + url.length];
  }
  // scheme:email[/segment]
  let j = i + 1;
  const localStart = j;
  while (j < n && isLocalPartChar(s.charCodeAt(j))) j++;
  if (j === localStart || j >= n || s.charCodeAt(j) !== 64) return null;
  const domEnd = matchDomain(s, j + 1);
  if (domEnd === -1) return null;
  let end = domEnd;
  // optional single path segment
  if (end < n && s.charCodeAt(end) === 47) {
    let k = end + 1;
    while (k < n) {
      const c = s.charCodeAt(k);
      if (c <= 32 || c === 60 || c === 47) break;
      k++;
    }
    if (k > end + 1) end = k;
  }
  const raw = s.slice(pos, end);
  const url = backpedalUrl(raw);
  if (url === '') return null;
  // A local-part character (other than '.', '/' or '?') right after the
  // address means the domain is incomplete, so this is not an autolink.
  // An underscore that begins a '__' run is an emphasis delimiter; so
  // is a single trailing underscore that closes an open '_' emphasis.
  const finalEnd = pos + url.length;
  if (finalEnd < n) {
    const c = s.charCodeAt(finalEnd);
    if (c !== 46 && c !== 47 && c !== 63 && isLocalPartChar(c)) {
      if (!(c === 95 && finalEnd + 1 < n && s.charCodeAt(finalEnd + 1) === 95) && !(c === 95 && allowTrailingUnderscore)) {
        return null;
      }
    }
  }
  return [url, url, pos + url.length];
}

// Match an email autolink starting at pos (the local part start).
// Returns [href, text, nextPos] or null.
function matchEmail(s, pos, allowTrailingUnderscore, allowTrailingTilde) {
  const n = s.length;
  let j = pos;
  while (j < n && isLocalPartChar(s.charCodeAt(j))) j++;
  if (j === pos || j >= n || s.charCodeAt(j) !== 64) return null;
  const domEnd = matchDomain(s, j + 1);
  if (domEnd === -1) return null;
  const raw = s.slice(pos, domEnd);
  const url = backpedalUrl(raw);
  if (url === '') return null;
  // A local-part character (other than '.', '/' or '?') right after the
  // address means the domain is incomplete (the address is part of a
  // larger word), so this is not an autolink. An underscore that begins
  // a '__' run is an emphasis delimiter, not part of the address; so is
  // a single trailing underscore that closes an open '_' emphasis. The
  // same holds for '~': a '~~' run is a strikethrough delimiter, and a
  // single trailing '~' closes an open '~' emphasis.
  const end = pos + url.length;
  if (end < n) {
    const c = s.charCodeAt(end);
    if (c !== 46 && c !== 47 && c !== 63 && isLocalPartChar(c)) {
      if (c === 95 && end + 1 < n && s.charCodeAt(end + 1) === 95) {
        // '__' follows: emphasis delimiter, not part of the address
      } else if (c === 95 && allowTrailingUnderscore) {
        // '_' closes an open emphasis: not part of the address
      } else if (c === 126 && end + 1 < n && s.charCodeAt(end + 1) === 126) {
        // '~~' follows: strikethrough delimiter, not part of the address
      } else if (c === 126 && allowTrailingTilde) {
        // '~' closes an open emphasis: not part of the address
      } else {
        return null;
      }
    }
  }
  return ['mailto:' + url, url, end];
}

// ---------------------------------------------------------------------------
// Emphasis / strikethrough (delimiter stack)
// ---------------------------------------------------------------------------

function processEmphasis(delims) {
  // Source ranges [openPos, closePos, openerCanClose, closerCanOpen, use]
  // of emphasis formed so far. An opener inside one of these ranges
  // cannot match a closer outside it; and an opener to the left of a
  // range whose opener cannot close, whose closer can also open, and
  // whose delimiter run is longer than the closer's cannot match a
  // closer to the right of that range.
  const ranges = [];
  let i = 0;
  while (i < delims.length) {
    const closer = delims[i];
    if (closer.canClose && closer.len > 0) {
      let j = i - 1;
      while (j >= 0) {
        const opener = delims[j];
        if (opener.ch === closer.ch && opener.canOpen && opener.len > 0) {
          let blocked = false;
          for (let r = 0; r < ranges.length; r++) {
            const a = ranges[r][0];
            const b = ranges[r][1];
            if (opener.pos > a && opener.pos < b && (closer.pos < a || closer.pos > b)) {
              blocked = true;
              break;
            }
            if (!ranges[r][2] && ranges[r][3] && ranges[r][4] > (opener.len >= 2 && closer.len >= 2 ? 2 : 1) && ranges[r][5] === closer.ch && opener.pos < a && closer.pos > b) {
              blocked = true;
              break;
            }
          }
          if (!blocked) {
            const oddMatch =
              (opener.canClose || closer.canOpen) &&
              (opener.len + closer.len) % 3 === 0 &&
              (opener.len % 3 !== 0 || closer.len % 3 !== 0);
            if (!oddMatch) {
              // A single closer must not consume one delimiter of a
              // length-2 opener when a later length-2 closer of the same
              // character could form a strong with that opener; the
              // single closer stays literal instead. (A longer opener
              // still has enough left for a strong, so it may match.)
              if (opener.len === 2 && closer.len === 1) {
                let laterStrong = false;
                for (let k = i + 1; k < delims.length; k++) {
                  const d2 = delims[k];
                  if (d2.ch === closer.ch && d2.canClose && d2.len >= 2) {
                    laterStrong = true;
                    break;
                  }
                }
                if (laterStrong) {
                  j--;
                  continue;
                }
              }
              const use = opener.len >= 2 && closer.len >= 2 ? 2 : 1;
              const tag = closer.ch === '~' ? 'del' : use === 2 ? 'strong' : 'em';
              // A strong closer left with a remainder whose span
              // already holds a formed inner emphasis keeps the
              // remainder inside its close tag (``**a *b*c***``
              // leaves the `*` inside the strong); without an inner
              // emphasis the remainder stays outside, as in
              // ``**foo***``, and so does an em closer's remainder.
              if (use === 2 && closer.len - use > 0) {
                for (let r = 0; r < ranges.length; r++) {
                  if (ranges[r][4] === 1 && ranges[r][0] > opener.pos && ranges[r][1] < closer.pos) {
                    closer.remainderFirst = true;
                    break;
                  }
                }
              }
              opener.len -= use;
              closer.len -= use;
              opener.before.unshift('<' + tag + '>');
              closer.after.push('</' + tag + '>');
              ranges.push([opener.pos, closer.pos, opener.canClose, closer.canOpen, use, opener.ch]);
              if (opener.len === 0) {
                delims.splice(j, 1);
                i--;
                j--;
              }
              if (closer.len === 0) break;
              continue;
            }
          }
        }
        j--;
      }
    }
    i++;
  }
}

function resolveOut(out) {
  const parts = new Array(out.length);
  for (let k = 0; k < out.length; k++) {
    const el = out[k];
    if (typeof el === 'string') {
      parts[k] = el;
    } else if (el.isBracket) {
      parts[k] = el.image ? '![' : '[';
    } else if (el.after.length === 0 && el.before.length === 0) {
      parts[k] = el.ch.repeat(el.len);
    } else if (el.remainderFirst) {
      parts[k] = el.ch.repeat(el.len) + el.after.join('') + el.before.join('');
    } else {
      parts[k] = el.after.join('') + el.ch.repeat(el.len) + el.before.join('');
    }
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

const INLINE_SPECIAL = /[`\\<\[\]*_~!&\n@:]/g;
// The code-span pattern, applied globally: a run of backticks, content
// that holds no backtick at either edge, and the same run to close.
// Marked masks these spans before looking for emphasis, so a span
// that only forms by pairing an opener with a far-away closer still
// hides any emphasis delimiters inside it. The opener must start a
// run (not sit inside one): without the lookbehind the pattern
// backtracks into a `` `` `` run and invents a span starting at its
// second backtick.
const CODESPAN_RE = /(?<!`)(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;

// Try to match an email whose local part starts at or after textStart and
// ends at the _ or ~ at pos. Used before a delimiter is pushed, so a
// delimiter inside an email's local part never breaks the address.
function tryEmailAtWordStart(src, pos, textStart, allowTrailingUnderscore, allowTrailingTilde) {
  let s = pos;
  while (s > textStart) {
    if (!isLocalPartChar(src.charCodeAt(s - 1))) break;
    s--;
  }
  if (s === pos) return null;
  const res = matchEmail(src, s, allowTrailingUnderscore, allowTrailingTilde);
  if (!res) return null;
  res.push(s);
  return res;
}

// Once an <a> opening tag is seen in inline content, extended autolinks
// (bare email, www., scheme://) are suppressed for the rest of the
// document, until a </a> closing tag is seen inline. Angle-bracket
// autolinks and inline links are unaffected. An <a> that forms an HTML
// block never reaches inline parsing, so it does not set the flag.
// Reset for each parse() call.
let suppressExtAutolink = false;
function isAnchorOpenTag(t) {
  if (t.length < 2 || t.charCodeAt(0) !== 60) return false;
  const c1 = t.charCodeAt(1);
  if (c1 !== 97 && c1 !== 65) return false;
  if (t.length < 3) return false;
  const c2 = t.charCodeAt(2);
  // A bare <a> (or <a/>) with nothing after the tag name does not
  // count as an open anchor; the tag must have whitespace (an
  // attribute or a space) after the name.
  if (c2 !== 32 && c2 !== 9 && c2 !== 10) return false;
  const n = t.length;
  // Self-closing <a .../> does not leave the parser inside an anchor,
  // unless there is a space before the /> (then it is treated as open).
  if (n >= 2 && t.charCodeAt(n - 2) === 47 && t.charCodeAt(n - 1) === 62) {
    return t.charCodeAt(n - 3) === 32;
  }
  return true;
}
// A closing </a> tag (case-insensitive, optional whitespace before >).
function isAnchorCloseTag(t) {
  if (t.length < 4 || t.charCodeAt(0) !== 60 || t.charCodeAt(1) !== 47) return false;
  const c = t.charCodeAt(2);
  if (c !== 97 && c !== 65) return false;
  let k = 3;
  while (k < t.length) {
    const cc = t.charCodeAt(k);
    if (cc !== 32 && cc !== 9 && cc !== 10) break;
    k++;
  }
  return k < t.length && t.charCodeAt(k) === 62;
}

function parseInline(src, refs, noLink) {
  const n = src.length;
  const out = [];
  const delims = [];
  const brackets = [];
  // Positions of a shorter backtick run met while a longer (run>=2)
  // opener searched in vain for a matching closer. A span starting
  // at such a position must not cross its bracket's closing bracket.
  const tainted = new Set();
  let i = 0;
  let textStart = 0;

  // Code-span ranges [start, end) under the global code-span pattern.
  // Emphasis delimiters inside one of these ranges are inert: marked
  // masks code spans before it looks for emphasis, so a span that
  // only forms by pairing a stray opener with a far-away closer still
  // hides the delimiters between them.
  const masked = [];
  {
    let m;
    CODESPAN_RE.lastIndex = 0;
    while ((m = CODESPAN_RE.exec(src)) !== null) {
      // An opener preceded by an odd run of backslashes is an
      // escaped backtick, not a code-span delimiter: skip the match
      // and resume just past it so a later span can still form.
      let bs = 0;
      let k = m.index - 1;
      while (k >= 0 && src.charCodeAt(k) === 92) {
        bs++;
        k--;
      }
      if (bs % 2 === 1) {
        CODESPAN_RE.lastIndex = m.index + 1;
        continue;
      }
      masked.push([m.index, m.index + m[0].length]);
    }
  }
  let maskIdx = 0;
  const inMasked = (pos) => {
    while (maskIdx < masked.length && masked[maskIdx][1] <= pos) maskIdx++;
    return maskIdx < masked.length && masked[maskIdx][0] <= pos && pos < masked[maskIdx][1];
  };

  const flush = (end) => {
    if (end > textStart) out.push(escapeText(src.slice(textStart, end)));
    textStart = end;
  };
  // True when the innermost open bracket could still form a link: a
  // bare-URL scan must then stop at `]`, which closes that bracket.
  // When the bracket already contains a link it cannot form one, so
  // the `]` is ordinary URL text (backpedalUrl sorts it out).
  const stopAtBracket = () => {
    for (let k = brackets.length - 1; k >= 0; k--) {
      if (brackets[k].active) return !brackets[k].hasLink;
    }
    return false;
  };
  // True when an '_' delimiter that can open an emphasis is still
  // pending: a '_' right after an email domain is then its closer,
  // not part of the address.
  const hasOpenUnderscore = () => {
    for (let k = 0; k < delims.length; k++) {
      const d = delims[k];
      if (d.ch === '_' && d.canOpen && d.len > 0) return true;
    }
    return false;
  };
  const hasOpenTilde = () => {
    for (let k = 0; k < delims.length; k++) {
      const d = delims[k];
      if (d.ch === '~' && d.canOpen && d.len > 0) return true;
    }
    return false;
  };
  while (i < n) {
    INLINE_SPECIAL.lastIndex = i;
    const m = INLINE_SPECIAL.exec(src);
    const next = m ? m.index : n;
    const w = noLink || suppressExtAutolink ? -1 : src.indexOf('www.', i);
    if (w !== -1 && w < next) {
      const prev = w > 0 ? src.charCodeAt(w - 1) : 0;
      if (!isAlnum(prev)) {
        const res = matchWww(src, w, stopAtBracket());
        if (res) {
          flush(w);
          const href = cleanUrl(res[0]);
          out.push('<a href="' + escapeText(href === null ? res[0] : href) + '">' + escapeText(res[1]) + '</a>');
          i = res[2];
          textStart = i;
          continue;
        }
      }
      i = w + 1;
      continue;
    }
    if (m === null) break;
    i = next;
    const ch = src.charCodeAt(i);

    if (ch === 96) {
      // code span
      let run = 1;
      while (i + run < n && src.charCodeAt(i + run) === 96) run++;
      let j = i + run;
      let found = -1;
      let foundEnd = -1;
      let firstShorter = -1;
      while (j < n) {
        // Inside link text, a code span must close on the same line:
        // it may not reach past the bracket's closing `]` onto a later
        // line (that would swallow the link). Outside link text a
        // code span may span lines.
        if (brackets.length > 0 && src.charCodeAt(j) === 10) break;
        if (src.charCodeAt(j) === 96) {
          let r2 = 1;
          while (j + r2 < n && src.charCodeAt(j + r2) === 96) r2++;
          if (r2 === run) {
            found = j;
            foundEnd = j + r2;
            break;
          }
          if (run >= 2 && r2 < run && firstShorter === -1) firstShorter = j;
          j += r2;
        } else {
          j++;
        }
      }
      if (found === -1) {
        // A longer opener with no closer taints the first shorter
        // run it passed: a span starting there must not cross the
        // bracket that encloses it.
        if (run >= 2 && firstShorter !== -1) tainted.add(firstShorter);
        i += run; // literal backticks
        continue;
      }
      if (tainted.has(i) && brackets.length > 0) {
        // The bracket this span sits in closes at the first
        // unescaped `]` at depth 0 past its `[`; a closer past
        // that bracket belongs to later text, not to this span.
        const b = brackets[brackets.length - 1];
        let depth = 0;
        let close = -1;
        for (let k = b.srcPos + 1; k < n; k++) {
          const c = src.charCodeAt(k);
          if (c === 92) {
            k++;
            continue;
          }
          if (c === 91) depth++;
          else if (c === 93) {
            if (depth === 0) {
              close = k;
              break;
            }
            depth--;
          }
        }
        if (close !== -1 && found > close) {
          i += run; // literal backticks
          continue;
        }
      }
      let content = src.slice(i + run, found).replace(/\n/g, ' ');
      if (content.length > 0 && content.charCodeAt(0) === 32 && content.charCodeAt(content.length - 1) === 32) {
        let allSpace = true;
        for (let k = 0; k < content.length; k++) {
          if (content.charCodeAt(k) !== 32) {
            allSpace = false;
            break;
          }
        }
        if (!allSpace) content = content.slice(1, -1);
      }
      flush(i);
      out.push('<code>' + escapeCode(content) + '</code>');
      i = foundEnd;
      textStart = i;
      continue;
    }

    if (ch === 92) {
      // backslash escape or hard break
      if (i + 1 < n) {
        const nx = src.charCodeAt(i + 1);
        if (nx === 10) {
          flush(i);
          out.push('<br>');
          i += 2;
          // leading spaces of the next line are dropped after a hard break
          while (i < n && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9)) i++;
          textStart = i;
          continue;
        }
        if (isAsciiPunct(nx)) {
          flush(i);
          out.push(escapeText(src[i + 1]));
          i += 2;
          textStart = i;
          continue;
        }
      }
      i++;
      continue;
    }

    if (ch === 60) {
      // < : autolink or raw HTML. Angle-bracket autolinks do form
      // inside link text; only bare (extended) autolinks do not.
      const auto = matchBracketAutolink(src, i);
      if (auto) {
        const href = cleanUrl(auto[0]);
        if (href !== null) {
          flush(i);
          out.push('<a href="' + escapeText(href) + '">' + escapeText(auto[1]) + '</a>');
          i = auto[2];
          textStart = i;
          continue;
        }
      }
      const tag = scanRawHtml(src, i);
      if (tag) {
        if (isAnchorOpenTag(tag[0])) suppressExtAutolink = true;
        else if (isAnchorCloseTag(tag[0])) suppressExtAutolink = false;
        flush(i);
        out.push(tag[0]);
        i = tag[1];
        textStart = i;
        continue;
      }
      i++;
      continue;
    }

    if (ch === 91) {
      // [ : link bracket (no link inside link text)
      if (noLink) {
        i++;
        continue;
      }
      flush(i);
      const b = {
        isBracket: true,
        image: false,
        active: true,
        hasLink: false,
        srcPos: i,
        outIndex: out.length,
        delimLen: delims.length,
        bracketLen: brackets.length,
      };
      out.push(b);
      brackets.push(b);
      i++;
      textStart = i;
      continue;
    }

    if (ch === 93) {
      // ] : try to form a link
      if (brackets.length > 0) {
        const b = brackets[brackets.length - 1];
        if (b.active) {
          const formed = tryFormLink(src, i, b, refs, out, delims, brackets);
          if (formed !== -1) {
            i = formed;
            textStart = i;
            continue;
          }
        }
        brackets.pop();
        out[b.outIndex] = b.image ? '![' : '[';
      }
      i++;
      continue;
    }

    if (ch === 42 || ch === 95 || ch === 126) {
      // * _ ~ delimiter run
      let run = 1;
      while (i + run < n && src.charCodeAt(i + run) === ch) run++;
      if (ch === 126 && run > 2) {
        i += run; // literal tildes
        continue;
      }
      if (ch === 95 || ch === 126) {
        // an email address may start in this word
        const em = noLink || suppressExtAutolink ? null : tryEmailAtWordStart(src, i, textStart, hasOpenUnderscore(), hasOpenTilde());
        if (em) {
          flush(em[3]);
          out.push('<a href="' + escapeText(em[0]) + '">' + escapeText(em[1]) + '</a>');
          i = em[2];
          textStart = i;
          continue;
        }
      }
      const prevCh = i > 0 ? src[i - 1] : undefined;
      const nextCh = i + run < n ? src[i + run] : undefined;
      const leftFlanking =
        !isSpace(nextCh) && (!isPunct(nextCh) || isSpace(prevCh) || isPunct(prevCh));
      const rightFlanking =
        !isSpace(prevCh) && (!isPunct(prevCh) || isSpace(nextCh) || isPunct(nextCh));
      let canOpen;
      let canClose;
      if (ch === 95) {
        canOpen = leftFlanking && (!rightFlanking || isPunct(prevCh));
        canClose = rightFlanking && (!leftFlanking || isPunct(nextCh));
      } else {
        canOpen = leftFlanking;
        canClose = rightFlanking;
      }
      // Inside a masked code span the delimiters are inert: they
      // render literally and never open or close an emphasis.
      if (inMasked(i)) {
        canOpen = false;
        canClose = false;
      }
      flush(i);
      const d = {
        ch: ch === 42 ? '*' : ch === 95 ? '_' : '~',
        len: run,
        pos: i,
        canOpen,
        canClose,
        before: [],
        after: [],
      };
      out.push(d);
      delims.push(d);
      i += run;
      textStart = i;
      continue;
    }

    if (ch === 33) {
      // ! : image bracket if followed by [
      if (i + 1 < n && src.charCodeAt(i + 1) === 91) {
        flush(i);
        const b = {
          isBracket: true,
          image: true,
          active: true,
          srcPos: i,
          outIndex: out.length,
          delimLen: delims.length,
          bracketLen: brackets.length,
        };
        out.push(b);
        brackets.push(b);
        i += 2;
        textStart = i;
        continue;
      }
      i++;
      continue;
    }

    if (ch === 38) {
      // & : entity
      const ent = decodeEntityAt(src, i);
      if (ent) {
        flush(i);
        out.push(escapeText(ent[0]));
        i = ent[1];
        textStart = i;
        continue;
      }
      i++;
      continue;
    }

    if (ch === 10) {
      // newline: hard break if 2+ spaces precede it
      let j = i - 1;
      let spaces = 0;
      while (j >= textStart && src.charCodeAt(j) === 32) {
        spaces++;
        j--;
      }
      if (spaces >= 2) {
        flush(i - spaces);
        out.push('<br>');
        i++;
        // leading spaces of the next line are dropped after a hard break
        while (i < n && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9)) i++;
        textStart = i;
        continue;
      }
      i++;
      continue;
    }

    if (ch === 64) {
      // @ : extended email autolink
      if (noLink || suppressExtAutolink) {
        i++;
        continue;
      }
      let s = i;
      while (s > textStart && isLocalPartChar(src.charCodeAt(s - 1))) s--;
      if (s < textStart || s === i) {
        i++;
        continue;
      }
      const res = matchEmail(src, s, hasOpenUnderscore(), hasOpenTilde());
      if (res) {
        flush(s);
        const href = cleanUrl(res[0]);
        out.push('<a href="' + escapeText(href === null ? res[0] : href) + '">' + escapeText(res[1]) + '</a>');
        i = res[2];
        textStart = i;
        continue;
      }
      i++;
      continue;
    }

    if (ch === 58) {
      // : : scheme autolink (scheme:// or scheme:email)
      if (noLink || suppressExtAutolink) {
        i++;
        continue;
      }
      let s = i;
      while (s > textStart && isSchemeChar(src.charCodeAt(s - 1))) s--;
      if (s === i) {
        i++;
        continue;
      }
      const res = matchScheme(src, s, stopAtBracket(), hasOpenUnderscore());
      if (res) {
        flush(s);
        const href = cleanUrl(res[0]);
        out.push('<a href="' + escapeText(href === null ? res[0] : href) + '">' + escapeText(res[1]) + '</a>');
        i = res[2];
        textStart = i;
        continue;
      }
      i++;
      continue;
    }

    i++;
  }

  flush(n);
  processEmphasis(delims);
  return resolveOut(out);
}

// A link whose text holds a `` ``... `... `` `` code span (a run of two
// or more backticks whose content itself holds a backtick) does not
// form when text follows that span before the closing bracket. When
// the span is the last thing in the text the link forms. Returns the
// span's [start, end) in the text, or null.
function rLinkSpan(text) {
  let m;
  CODESPAN_RE.lastIndex = 0;
  while ((m = CODESPAN_RE.exec(text)) !== null) {
    let bs = 0;
    let k = m.index - 1;
    while (k >= 0 && text.charCodeAt(k) === 92) {
      bs++;
      k--;
    }
    if (bs % 2 === 1) {
      CODESPAN_RE.lastIndex = m.index + 1;
      continue;
    }
    if (m[1].length >= 2 && m[2].indexOf('`') !== -1) {
      const end = m.index + m[0].length;
      if (end < text.length) return [m.index, end];
    }
  }
  return null;
}

// Try to form a link/image from the bracket b closed by ']' at closePos.
// Returns the position to continue scanning from, or -1.
function tryFormLink(src, closePos, b, refs, out, delims, brackets) {
  // A link whose text already contains a link cannot form. (An image
  // may still form: its alt text is the link text with tags stripped.)
  if (b.hasLink && !b.image) return -1;
  const n = src.length;
  const textStart = b.srcPos + (b.image ? 2 : 1);
  const rawText = src.slice(textStart, closePos);
  // A `` ``... `... `` `` span with text after it blocks the link:
  // the bracket stays literal, and so does any emphasis pair
  // wrapping the span (other delimiters in the text are untouched).
  const span = rLinkSpan(rawText);
  if (span) {
    const csStart = textStart + span[0];
    const csEnd = textStart + span[1];
    for (const ch of ['*', '_', '~']) {
      let open = null;
      let close = null;
      for (let k = 0; k < delims.length; k++) {
        const d = delims[k];
        if (d.pos < textStart || d.pos >= closePos || d.ch !== ch) continue;
        if (d.pos < csStart && d.canOpen) open = d;
        if (d.pos >= csEnd && d.canClose && close === null) close = d;
      }
      if (open && close) {
        open.canOpen = false;
        open.canClose = false;
        close.canOpen = false;
        close.canClose = false;
      }
    }
    return -1;
  }
  let href = null;
  let title = null;
  let nextPos = closePos + 1;
  const after = closePos + 1;

  if (after < n && src.charCodeAt(after) === 40) {
    // inline: (destination "title")
    let p = skipWhitespace(src, after + 1);
    if (p < n && src.charCodeAt(p) === 41) {
      href = '';
      nextPos = p + 1;
    } else {
      const dest = parseLinkDestination(src, p);
      if (dest) {
        const destEnd = dest[1];
        p = skipWhitespace(src, destEnd);
        if (p < n && src.charCodeAt(p) === 41) {
          href = dest[0];
          nextPos = p + 1;
        } else if (p > destEnd) {
          const t = parseLinkTitle(src, p);
          if (t) {
            p = skipWhitespace(src, t[1]);
            if (p < n && src.charCodeAt(p) === 41) {
              href = dest[0];
              title = t[0];
              nextPos = p + 1;
            }
          }
        }
      }
    }
    // If the inline link did not parse, fall back to a shortcut
    // reference link; the (...) is left as literal text.
    if (href === null) {
      const norm = normalizeLabel(rawText);
      if (norm !== '') {
        const def = refs.get(norm);
        if (def) {
          href = def.href;
          title = def.title;
          nextPos = after;
        }
      }
    }
  } else if (after < n && src.charCodeAt(after) === 91) {
    // reference: [label] or []
    const lab = parseLinkLabel(src, after);
    if (lab) {
      const label = lab[0] === '' ? rawText : lab[0];
      const norm = normalizeLabel(label);
      if (norm !== '') {
        const def = refs.get(norm);
        if (def) {
          href = def.href;
          title = def.title;
          nextPos = lab[1];
        }
      }
    }
  } else {
    // shortcut reference
    const norm = normalizeLabel(rawText);
    if (norm !== '') {
      const def = refs.get(norm);
      if (def) {
        href = def.href;
        title = def.title;
        nextPos = after;
      }
    }
  }

  if (href === null) return -1;
  const clean = cleanUrl(href);
  if (clean === null) return -1;

  // Re-parse the link text on its own: delimiters inside it do not
  // interact with delimiters outside it.
  out.length = b.outIndex;
  delims.length = b.delimLen;
  brackets.length = b.bracketLen;
  // When a link (not an image) forms, every plain bracket opened before
  // it can no longer form a link. Image brackets are not deactivated.
  if (!b.image) {
    for (let k = 0; k < brackets.length; k++) {
      const ob = brackets[k];
      if (ob.active && !ob.image) {
        ob.active = false;
        out[ob.outIndex] = '[';
      }
    }
  }

  if (b.image) {
    // The alt text is the link text with formatting removed; a nested
    // image contributes its own alt text, not an <img> tag.
    const alt = parseInline(rawText, refs)
      .replace(/<img[^>]*\salt="([^"]*)"[^>]*>/g, '$1')
      .replace(/<[^>]*>/g, '');
    out.push('<img src="' + escapeText(clean) + '" alt="' + alt + '"' + (title !== null ? ' title="' + escapeText(title) + '"' : '') + '>');
  } else {
    out.push('<a href="' + escapeText(clean) + '"' + (title !== null ? ' title="' + escapeText(title) + '"' : '') + '>');
    out.push(parseInline(rawText, refs, true));
    out.push('</a>');
    // A link inside this text bars every still-open outer bracket
    // from forming a link of its own.
    for (let k = 0; k < brackets.length; k++) brackets[k].hasLink = true;
  }
  return nextPos;
}

// Split a table row into cells, honouring backslash escapes and
// code spans (pipes inside a code span do not split the row).
function splitTableCells(row) {
  const cells = [];
  let cur = '';
  let i = 0;
  while (i < row.length) {
    const c = row.charCodeAt(i);
    if (c === 92 && i + 1 < row.length && isAsciiPunct(row.charCodeAt(i + 1))) {
      // Keep the backslash in the cell text: the inline parser must see
      // the escape (so `\_` stays a literal underscore, not an emphasis
      // delimiter). The pipe is still not a boundary because both
      // characters are consumed here.
      cur += row[i] + row[i + 1];
      i += 2;
      continue;
    }
    if (c === 96) {
      // code span: pipes inside do not split, but the span must close
      // before the next unescaped pipe (a cell boundary). An opener
      // with no closer before that pipe is literal text.
      let run = 1;
      while (i + run < row.length && row.charCodeAt(i + run) === 96) run++;
      let j = i + run;
      let found = -1;
      while (j < row.length) {
        if (row.charCodeAt(j) === 124 && (j === 0 || row.charCodeAt(j - 1) !== 92)) break;
        if (row.charCodeAt(j) === 96) {
          let r2 = 1;
          while (j + r2 < row.length && row.charCodeAt(j + r2) === 96) r2++;
          if (r2 === run) {
            found = j + r2;
            break;
          }
          j += r2;
        } else j++;
      }
      if (found === -1) {
        cur += row.slice(i, i + run);
        i += run;
        continue;
      }
      // an escaped pipe inside the code span is a table-level escape:
      // the backslash is consumed and the pipe is literal
      cur += row.slice(i, found).replace(/\\\|/g, '|');
      i = found;
      continue;
    }
    if (c === 124) {
      cells.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += row[i];
    i++;
  }
  cells.push(cur);
  return cells;
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------
// Node types: 0 document, 1 paragraph, 2 heading, 3 code, 4 html,
// 5 quote, 6 list, 7 item, 8 hr, 9 table.

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body',
  'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
  'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem',
  'meta', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param',
  'section', 'source', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'title', 'tr', 'track', 'ul',
]);

function parseBlocks(src, refs) {
  const lines = src.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const doc = { t: 0, children: [], parent: null, open: true, lastLineBlank: false };

  // Current line state.
  let line = '';
  let offset = 0;
  let column = 0;
  let partial = 0; // spaces remaining of a partially consumed tab
  // Columns of indentation a failed list-item match consumed on this
  // line before giving up: a tilde fence created on the same line
  // measures its indent from after those columns, not from before
  // them.
  let failedIndent = 0;

  function lastChild(node) {
    const c = node.children;
    return c.length > 0 ? c[c.length - 1] : null;
  }
  function addChild(parent, child) {
    child.parent = parent;
    parent.children.push(child);
  }
  function isContainer(node) {
    return node.t === 5 || node.t === 6 || node.t === 7;
  }

  // The character at the current position (' ' for a partially consumed tab).
  function peek() {
    if (partial > 0) return ' ';
    return offset < line.length ? line[offset] : '';
  }
  // The rest of the line from the current position.
  function rest() {
    if (partial > 0) return ' '.repeat(partial) + line.slice(offset + 1);
    return line.slice(offset);
  }
  // Is the rest of the line blank? A partially consumed tab is whitespace,
  // so scan from the tab itself.
  function restIsBlank() {
    for (let k = offset; k < line.length; k++) {
      const c = line.charCodeAt(k);
      if (c !== 32 && c !== 9) return false;
    }
    return true;
  }
  // Advance past whitespace, up to maxCols columns. Returns columns consumed.
  function skipWhitespaceColumns(maxCols) {
    let consumed = 0;
    while (consumed < maxCols) {
      if (partial > 0) {
        const take = Math.min(partial, maxCols - consumed);
        partial -= take;
        column += take;
        consumed += take;
        if (partial === 0) offset++;
        continue;
      }
      if (offset >= line.length) break;
      const c = line.charCodeAt(offset);
      if (c === 32) {
        offset++;
        column++;
        consumed++;
      } else if (c === 9) {
        const w = 4 - (column % 4);
        if (consumed + w > maxCols) {
          partial = consumed + w - maxCols;
          column += maxCols - consumed;
          consumed = maxCols;
        } else {
          offset++;
          column += w;
          consumed += w;
        }
      } else break;
    }
    return consumed;
  }
  // Advance the position by n columns of whitespace.
  function advanceColumns(n) {
    while (n > 0) {
      if (partial > 0) {
        const take = Math.min(partial, n);
        partial -= take;
        column += take;
        n -= take;
        if (partial === 0) offset++;
        continue;
      }
      if (offset >= line.length) break;
      const c = line.charCodeAt(offset);
      if (c === 32) {
        offset++;
        column++;
        n--;
      } else if (c === 9) {
        const w = 4 - (column % 4);
        if (w > n) {
          partial = w - n;
          column += n;
          n = 0;
        } else {
          offset++;
          column += w;
          n -= w;
        }
      } else break;
    }
  }
  // Advance the position by n columns, consuming any characters.
  function advanceChars(n) {
    while (n > 0) {
      if (partial > 0) {
        const take = Math.min(partial, n);
        partial -= take;
        column += take;
        n -= take;
        if (partial === 0) offset++;
        continue;
      }
      if (offset >= line.length) break;
      const c = line.charCodeAt(offset);
      if (c === 9) {
        const w = 4 - (column % 4);
        if (w > n) {
          partial = w - n;
          column += n;
          n = 0;
        } else {
          offset++;
          column += w;
          n -= w;
        }
      } else {
        offset++;
        column++;
        n--;
      }
    }
  }
  // Advance to the target column, consuming whitespace. Returns false if a
  // non-space character is met first.
  function advanceToColumn(target) {
    while (column < target) {
      if (partial > 0) {
        const take = Math.min(partial, target - column);
        partial -= take;
        column += take;
        if (partial === 0) offset++;
        continue;
      }
      if (offset >= line.length) return true;
      const c = line.charCodeAt(offset);
      if (c === 32) {
        offset++;
        column++;
      } else if (c === 9) {
        const w = 4 - (column % 4);
        if (column + w > target) {
          partial = column + w - target;
          column = target;
        } else {
          offset++;
          column += w;
        }
      } else return false;
    }
    return true;
  }
  // Indentation (in columns) of the rest of the line, without moving.
  function restIndent() {
    let col = column;
    let off = offset;
    let part = partial;
    while (true) {
      if (part > 0) {
        col += part;
        part = 0;
        off++;
        continue;
      }
      if (off >= line.length) return col - column;
      const c = line.charCodeAt(off);
      if (c === 32) {
        off++;
        col++;
      } else if (c === 9) {
        col += 4 - (col % 4);
        off++;
      } else return col - column;
    }
  }
  // Remove up to n columns of indentation from the current position and
  // return the remaining content.
  function stripIndent(n, expandTab) {
    // Columns already consumed by a container (list item, quote) before
    // this call: a tab right after them expands to spaces. Columns
    // consumed here by the fence indent itself do not expand a following
    // tab — it stays literal.
    const entryOffset = offset;
    let remaining = n;
    while (remaining > 0) {
      if (partial > 0) {
        const take = Math.min(partial, remaining);
        partial -= take;
        column += take;
        remaining -= take;
        if (partial === 0) offset++;
        continue;
      }
      if (offset >= line.length) break;
      const c = line.charCodeAt(offset);
      if (c === 32) {
        offset++;
        column++;
        remaining--;
      } else if (c === 9) {
        const w = 4 - (column % 4);
        if (w > remaining) {
          if (expandTab) {
            // Fenced code: a tab the fence indent only partly covers
            // is consumed outright — no spaces survive it.
            offset++;
            column += w;
            partial = 0;
            remaining = 0;
          } else {
            partial = w - remaining;
            column += remaining;
            remaining = 0;
          }
        } else {
          offset++;
          column += w;
          remaining -= w;
        }
      } else break;
    }
    // In fenced code, a tab at the start of the content expands to
    // spaces when a container had already consumed indentation before
    // it; a tab that only follows the fence indent itself is kept
    // literally. Indented code keeps tabs literally.
    if (expandTab && partial === 0 && entryOffset > 0) {
      let out = '';
      let col = column;
      let off = offset;
      while (off < line.length) {
        const c = line.charCodeAt(off);
        if (c === 32) {
          out += ' ';
          col++;
          off++;
        } else if (c === 9) {
          const w = 4 - (col % 4);
          out += ' '.repeat(w);
          col += w;
          off++;
        } else break;
      }
      if (out !== '') return out + line.slice(off);
    }
    return rest();
  }

  function markNonBlank(node) {
    let cur = node;
    while (cur) {
      cur.lastLineBlank = false;
      cur = cur.parent;
    }
  }
  function markBlank(container, rawBlank) {
    // A blank line is inside container and ends container's last child
    // block. A genuinely blank line propagates to all ancestors (it
    // separates blocks at the outer level); a line that is blank only
    // after its container markers were consumed stops at a list item
    // (it is nested inside that item's child, not between its blocks).
    // The flag is also set down the last-child chain: the last line of
    // every block containing the blank line was blank.
    let cur = container;
    while (cur) {
      if (!rawBlank && cur.t === 7 && cur !== container) break;
      cur.lastLineBlank = true;
      cur = cur.parent;
    }
    let down = container;
    while (down) {
      down.lastLineBlank = true;
      down = lastChild(down);
    }
  }

  // Parse link reference definitions from the start of a paragraph's text.
  // Returns the remaining text ('' when the paragraph was only definitions).
  // When dry is true, definitions are parsed but not recorded.
  function parseDefinitions(text, dry) {
    let pos = 0;
    let end = 0; // end of the last definition that parsed fully
    const n = text.length;
    while (pos < n) {
      const start = pos;
      // up to 3 spaces
      let sp = 0;
      while (pos < n && text.charCodeAt(pos) === 32 && sp < 3) {
        pos++;
        sp++;
      }
      if (pos >= n || text.charCodeAt(pos) !== 91) break;
      const lab = parseLinkLabel(text, pos);
      if (!lab) break;
      const label = lab[0];
      if (label === '') break;
      pos = lab[1];
      // spaces/tabs, then :
      pos = skipSpacesTabs(text, pos);
      if (pos >= n || text.charCodeAt(pos) !== 58) break;
      pos++;
      // spaces/tabs/newlines, then destination
      pos = skipWhitespace(text, pos);
      const dest = parseLinkDestination(text, pos);
      if (!dest) break;
      pos = dest[1];
      // Optional title: on the same line (after spaces/tabs) or on a
      // following line (after whitespace). It must be separated from the
      // destination by whitespace, and only spaces/tabs may follow it on
      // its line. If the title does not parse cleanly, the definition
      // stands without a title.
      let title = null;
      let after = pos;
      const sameLine = skipSpacesTabs(text, pos);
      if (
        sameLine > pos &&
        sameLine < n &&
        (text.charCodeAt(sameLine) === 34 || text.charCodeAt(sameLine) === 39 || text.charCodeAt(sameLine) === 40)
      ) {
        const t = parseLinkTitle(text, sameLine);
        if (t) {
          const a2 = skipSpacesTabs(text, t[1]);
          if (a2 >= n || text.charCodeAt(a2) === 10) {
            title = t[0];
            after = t[1];
          }
        }
      }
      if (title === null) {
        const nextLine = skipWhitespace(text, pos);
        if (
          nextLine > pos &&
          nextLine < n &&
          (text.charCodeAt(nextLine) === 34 || text.charCodeAt(nextLine) === 39 || text.charCodeAt(nextLine) === 40)
        ) {
          const t = parseLinkTitle(text, nextLine);
          if (t) {
            const a2 = skipSpacesTabs(text, t[1]);
            if (a2 >= n || text.charCodeAt(a2) === 10) {
              title = t[0];
              after = t[1];
            }
          }
        }
      }
      // only spaces/tabs may follow on the line
      after = skipSpacesTabs(text, after);
      if (after < n && text.charCodeAt(after) !== 10) break;
      if (after < n) after++; // consume the newline
      const norm = normalizeLabel(label);
      // an empty (after folding) label is not a definition
      if (norm === '') break;
      if (!dry && !refs.has(norm)) {
        refs.set(norm, { href: dest[0], title });
      }
      end = after;
      pos = after;
      // if we consumed nothing, avoid looping forever
      if (pos === start) break;
    }
    return text.slice(end);
  }

  function finalizeParagraph(p) {
    p.open = false;
    const text = p.lines.join('\n');
    const remaining = parseDefinitions(text);
    if (remaining === '') {
      // only definitions: drop the paragraph and restore the ancestors'
      // blank-line flags to what they were before it was created
      const parent = p.parent;
      const idx = parent.children.indexOf(p);
      if (idx !== -1) parent.children.splice(idx, 1);
      if (p.savedBlanks) {
        let anc = parent;
        for (let k = 0; k < p.savedBlanks.length && anc; k++) {
          anc.lastLineBlank = p.savedBlanks[k];
          anc = anc.parent;
        }
      }
      p.lines = [];
      p.gone = true;
      return;
    }
    p.text = remaining;
  }

  function finalizeList(list) {
    list.open = false;
    let tight = true;
    for (let k = 0; k < list.children.length; k++) {
      const item = list.children[k];
      if (item.lastLineBlank && k < list.children.length - 1) {
        tight = false;
        break;
      }
      for (let j = 0; j < item.children.length; j++) {
        const sub = item.children[j];
        if (sub.lastLineBlank && j < item.children.length - 1) {
          tight = false;
          break;
        }
      }
      if (!tight) break;
    }
    list.tight = tight;
  }

  function finalize(node) {
    if (!node.open) return;
    node.open = false;
    if (node.t === 1) {
      finalizeParagraph(node);
    } else if (node.t === 6) {
      finalizeList(node);
    } else if (node.t === 3 && !node.fenced) {
      // indented code: strip trailing blank lines
      const ls = node.lines;
      while (ls.length > 0 && ls[ls.length - 1] === '') ls.pop();
    }
  }

  // Close every open node from the tip down to (but not including) stop.
  function closeUpTo(stop) {
    // The deepest open leaf (if any) is the tip's last child.
    const leaf = lastChild(tip);
    if (leaf && leaf.open && !isContainer(leaf)) {
      finalize(leaf);
    }
    let cur = tip;
    while (cur && cur !== stop) {
      const parent = cur.parent;
      finalize(cur);
      cur = parent;
    }
    tip = stop;
  }

  let tip = doc;

  // --- leaf-start checks (all use the current line state) -----------------

  // Thematic break? (content from the current position; at most three
  // columns of leading indentation)
  function matchThematicBreak() {
    const s = rest();
    let i = 0;
    let indent = 0;
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c === 32) {
        indent++;
        i++;
        continue;
      }
      if (c === 9) {
        indent += 4 - (indent % 4);
        i++;
        continue;
      }
      break;
    }
    if (indent > 3) return false;
    let marker = -1;
    let count = 0;
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c === 32 || c === 9) {
        i++;
        continue;
      }
      if (c === 42 || c === 45 || c === 95) {
        if (marker === -1) marker = c;
        if (c !== marker) return false;
        count++;
        i++;
        continue;
      }
      return false;
    }
    return count >= 3;
  }

  // ATX heading? Returns [level, contentStart] or null.
  function matchAtx() {
    const s = rest();
    let i = 0;
    while (i < s.length && s.charCodeAt(i) === 32) i++;
    if (i > 3) return null;
    let j = i;
    while (j < s.length && s.charCodeAt(j) === 35) j++;
    const count = j - i;
    if (count === 0 || count > 6) return null;
    if (j < s.length) {
      const c = s.charCodeAt(j);
      if (c !== 32 && c !== 9) return null;
    }
    return [count, j];
  }

  // Fenced code start? Returns [char, length, info, indent] or null.
  function matchFence() {
    const s = rest();
    let i = 0;
    while (i < s.length && s.charCodeAt(i) === 32) i++;
    if (i > 3) return null;
    const c = s.charCodeAt(i);
    if (c !== 96 && c !== 126) return null;
    let j = i;
    while (j < s.length && s.charCodeAt(j) === c) j++;
    const len = j - i;
    if (len < 3) return null;
    const info = s.slice(j).trim();
    if (c === 96 && info.indexOf('`') !== -1) return null;
    // A failed list-item match on this line already consumed some of
    // the fence line's indentation. That consumption belongs to the
    // fence's indent only for a tilde fence: a backtick fence at the
    // enclosing level measures its indent from the line as written.
    const indent = c === 126 ? Math.max(0, i - failedIndent) : i;
    return [c === 96 ? '`' : '~', len, info, indent];
  }

  // HTML block start. Returns the type (1-7) or 0.
  function matchHtmlBlock() {
    const s = rest();
    let i = 0;
    while (i < s.length && s.charCodeAt(i) === 32) i++;
    if (i > 3) return 0;
    if (s.charCodeAt(i) !== 60) return 0;
    const lower = s.slice(i).toLowerCase();
    if (
      lower.startsWith('<script') ||
      lower.startsWith('<pre') ||
      lower.startsWith('<style') ||
      lower.startsWith('<textarea')
    ) {
      const nameLen = lower.startsWith('<script')
        ? 6
        : lower.startsWith('<textarea')
          ? 8
          : lower.startsWith('<style')
            ? 5
            : 3;
      const after = lower.charAt(1 + nameLen);
      if (after === '' || !isTagNameChar(after.charCodeAt(0))) return 1;
      return 0;
    }
    if (lower.startsWith('<!--')) return 2;
    if (lower.startsWith('<?')) return 3;
    if (lower.startsWith('<!') && lower.length > 2) {
      const c = s.charCodeAt(i + 2);
      if (c >= 65 && c <= 90) return 4;
    }
    if (lower.startsWith('<![cdata[')) return 5;
    // type 6: block tag
    let j = i + 1;
    let closing = false;
    if (s.charCodeAt(j) === 47) {
      closing = true;
      j++;
    }
    if (j >= s.length || !isTagNameStart(s.charCodeAt(j))) return 0;
    const start = j;
    while (j < s.length && isTagNameChar(s.charCodeAt(j))) j++;
    const name = s.slice(start, j).toLowerCase();
    if (BLOCK_TAGS.has(name)) {
      if (j >= s.length) return 6;
      const c = s.charCodeAt(j);
      if (!isTagNameChar(c)) return 6;
      return 0;
    }
    // type 7: a complete open or closing tag, alone on the line
    const tag = scanRawHtml(s, i);
    if (tag) {
      let k = tag[1];
      while (k < s.length && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9)) k++;
      if (k >= s.length) return 7;
    }
    return 0;
  }

  // List item marker at the current position. Returns null or
  // {ordered, bullet, delim, start, markerLen, contentIndent, content}.
  function matchListMarker() {
    const s = rest();
    let i = 0;
    while (i < s.length && s.charCodeAt(i) === 32) i++;
    if (i > 3) return null;
    const c = s.charCodeAt(i);
    let ordered = false;
    let bullet = '';
    let delim = '';
    let start = 0;
    let markerLen;
    if (c === 45 || c === 43 || c === 42) {
      bullet = s[i];
      markerLen = i + 1;
    } else if (c >= 48 && c <= 57) {
      let j = i;
      while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) j++;
      const digits = j - i;
      if (digits > 9) return null;
      if (j >= s.length) return null;
      const d = s.charCodeAt(j);
      if (d !== 46 && d !== 41) return null;
      ordered = true;
      delim = s[j];
      start = parseInt(s.slice(i, j), 10);
      markerLen = j + 1;
    } else {
      return null;
    }
    // whitespace after the marker
    let k = markerLen;
    let spaces = 0;
    while (k < s.length) {
      const cc = s.charCodeAt(k);
      if (cc === 32) {
        spaces++;
        k++;
      } else if (cc === 9) {
        // the tab width in columns from its position in the line
        let col = column + markerLen + spaces;
        spaces += 4 - (col % 4);
        k++;
      } else break;
    }
    if (k >= s.length) {
      // empty item
      return {
        ordered,
        bullet,
        delim,
        start,
        markerLen,
        markerCol: column + i,
        contentIndent: column + markerLen + 1,
        empty: true,
      };
    }
    if (spaces === 0) return null;
    let contentIndent;
    if (spaces >= 5) {
      contentIndent = column + markerLen + 1;
    } else {
      contentIndent = column + markerLen + spaces;
    }
    return { ordered, bullet, delim, start, markerLen, markerCol: column + i, contentIndent, empty: false };
  }

  // Table delimiter row? Returns the alignments or null.
  function matchTableDelimiter(headerCells) {
    const s = rest();
    let i = 0;
    while (i < s.length && s.charCodeAt(i) === 32) i++;
    if (i > 3) return null;
    const row = s.slice(i);
    const rawCells = splitTableCells(row);
    // drop empty edge cells from leading/trailing pipes
    let cells = rawCells;
    if (cells.length > 0 && cells[0].trim() === '') cells = cells.slice(1);
    if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells = cells.slice(0, -1);
    if (cells.length !== headerCells.length) return null;
    const aligns = [];
    for (let k = 0; k < cells.length; k++) {
      const cell = cells[k].trim();
      let m = cell.match(/^(:?)-+(:?)$/);
      if (!m) return null;
      if (m[1] === ':' && m[2] === ':') aligns.push('center');
      else if (m[2] === ':') aligns.push('right');
      else if (m[1] === ':') aligns.push('left');
      else aligns.push(null);
    }
    return aligns;
  }

  // Header cells of a table, or null when the line is not a table header.
  function tableHeaderCells(text) {
    let i = 0;
    while (i < text.length && text.charCodeAt(i) === 32) i++;
    if (i > 3) return null;
    const row = text.slice(i);
    if (row.indexOf('|') === -1) return null;
    let cells = splitTableCells(row);
    if (cells.length > 0 && cells[0].trim() === '') cells = cells.slice(1);
    if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells = cells.slice(0, -1);
    if (cells.length === 0) return null;
    return cells;
  }

  // Setext underline? Returns 1 for '=', 2 for '-', else 0.
  function matchSetext() {
    const s = rest();
    let i = 0;
    while (i < s.length && s.charCodeAt(i) === 32) i++;
    if (i > 3) return 0;
    const c = s.charCodeAt(i);
    if (c !== 61 && c !== 45) return 0;
    let j = i;
    while (j < s.length && s.charCodeAt(j) === c) j++;
    while (j < s.length && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) j++;
    if (j !== s.length) return 0;
    return c === 61 ? 1 : 2;
  }

  // --- the main line loop -------------------------------------------------

  for (let ln = 0; ln < lines.length; ln++) {
    line = lines[ln];
    offset = 0;
    column = 0;
    partial = 0;
    failedIndent = 0;
    const blank = restIsBlank();

    // Phase 1: match open containers.
    let container = doc;
    let matched = doc;
    let failed = null;
    // Blockquote markers contribute 2 columns total to the tab-stop
    // column, however deeply nested: a tab after `> `, `> > ` or
    // `> > > ` all expand to 2 spaces.
    let quoteSeen = false;
    while (true) {
      const child = lastChild(container);
      if (!child || !child.open || !isContainer(child)) break;
      if (child.t === 6) {
        container = child;
        matched = child;
        continue;
      }
      if (child.t === 5) {
        const saveOffset = offset;
        const saveColumn = column;
        const savePartial = partial;
        skipWhitespaceColumns(3);
        if (peek() === '>') {
          offset++;
          if (!quoteSeen) column++;
          if (peek() === ' ') {
            offset++;
            if (!quoteSeen) column++;
            // A tab right after `> ` is content, not marker
            // whitespace: it expands to spaces from the quote's
            // tab-stop column (2), so it renders as 2 spaces. Leave
            // the tab in place with `partial` set to its full width
            // so rest() expands it.
            if (offset < line.length && line.charCodeAt(offset) === 9) {
              partial = 2;
            }
          } else if (offset < line.length && line.charCodeAt(offset) === 9) {
            // The tab width is measured from the quote's tab-stop
            // column (its own indent plus the marker width), not
            // the absolute column: indentation from an outer
            // container does not count.
            const tabCol = quoteSeen ? column : column - saveColumn;
            const w = 4 - (tabCol % 4);
            if (w > 1) {
              partial = w - 1;
              if (!quoteSeen) column++;
            } else {
              offset++;
              if (!quoteSeen) column++;
            }
          }
          // The tab-stop column inside a quote is the quote's own
          // indent plus the marker width; indentation contributed by
          // an outer container (a list item) does not count.
          if (!quoteSeen) column -= saveColumn;
          quoteSeen = true;
          container = child;
          matched = child;
          continue;
        }
        offset = saveOffset;
        column = saveColumn;
        partial = savePartial;
        failed = child;
        break;
      }
      // list item: the content indent is measured from the column where
      // the marker was matched, so that block quote markers at different
      // positions on different lines do not shift it. An empty item that
      // was followed by a blank line contains nothing further.
      if (blank) {
        container = child;
        matched = child;
        continue;
      }
      if (child.children.length === 0 && child.lastLineBlank) {
        failed = child;
        break;
      }
      // A fenced code block's content lines do not need to satisfy the
      // list item's indent: the block continues until its closing fence
      // regardless of the line's indentation. Try the indent first; only
      // when the line is not indented enough do we match without moving.
      const saveOffset = offset;
      const saveColumn = column;
      const savePartial = partial;
      if (advanceToColumn(column + child.relIndent)) {
        container = child;
        matched = child;
        continue;
      } else {
        // The advance stopped short of the item's indent. Record how
        // many columns it consumed; a tilde fence opened on this
        // line at the enclosing level measures its indent from
        // after those columns.
        failedIndent = column - saveColumn;
      }
      {
        let node = child;
        while (true) {
          const lc = lastChild(node);
          if (!lc || !lc.open) break;
          node = lc;
        }
        // Only once the fence already holds a content line: the first
        // content line must satisfy the item's indent (a 0-indent first
        // line closes the item and leaves the fence empty), but later
        // lines stay in the fence regardless of indentation.
        if (node.t === 3 && node.open && node.fenced && node.lines.length > 0) {
          offset = saveOffset;
          column = saveColumn;
          partial = savePartial;
          container = child;
          matched = child;
          continue;
        }
      }
      offset = saveOffset;
      column = saveColumn;
      partial = savePartial;
      failed = child;
      break;
    }

    const allMatched = failed === null;

    // Lazy continuation: the failed container is a block quote or a list
    // item whose deepest open leaf is a paragraph, the line is not blank,
    // the line does not start a list item, and the line does not begin a
    // block that would interrupt the paragraph. The line's content has
    // leading whitespace consumed up to the failed container's width
    // (four columns for a quote, the item's content indent for an item).
    if (
      !allMatched &&
      !blank &&
      !restIsBlank() &&
      failed &&
      (failed.t === 5 || failed.t === 7) &&
      matchListMarker() === null &&
      !canInterruptParagraph(container)
    ) {
      // The paragraph to continue is the deepest open leaf under the
      // failed container (it may be nested inside other containers).
      let node = failed;
      while (true) {
        const lc = lastChild(node);
        if (!lc || !lc.open) break;
        node = lc;
      }
      if (node.t === 1 && node.open && !node.lastLineBlank) {
        // A lazy line's leading whitespace is stripped (up to the
        // failed container's width) when it has at least that width or
        // at least four columns of indentation; a shorter indent is
        // content and is kept.
        const w = failed.t === 5 ? 4 : failed.relIndent;
        if (restIndent() >= Math.min(4, w)) skipWhitespaceColumns(w);
        // A lazy continuation line that looks like a setext underline is
        // kept as paragraph text, indented four spaces (marked's quirk).
        const content = rest();
        node.lines.push(matchSetext() !== 0 ? '    ' + content : content);
        markNonBlank(node);
        continue;
      }
    }

    if (!allMatched) closeUpTo(matched);
    container = matched;

    // A list can only contain items: if the line does not start a list
    // item belonging to the matched list, close the list and work in its
    // parent instead. A thematic break is not a list item.
    if (container.t === 6) {
      const marker = matchThematicBreak() ? null : matchListMarker();
      const matches =
        marker !== null &&
        marker.ordered === container.ordered &&
        (marker.ordered ? marker.delim === container.delim : marker.bullet === container.bullet);
      if (!matches) {
        finalize(container);
        container = container.parent;
      }
    }

    // Phase 2.
    if (restIsBlank()) {
      const leaf = lastChild(container);
      // A line that is not blank itself (it had container markers) but
      // whose remaining content is only whitespace continues an open
      // paragraph with that whitespace.
      if (!blank && rest() !== '' && leaf && leaf.t === 1 && leaf.open) {
        leaf.lines.push(rest());
        markNonBlank(leaf);
        tip = container;
        continue;
      }
      if (leaf && leaf.open) {
        if (leaf.t === 3) {
          // a blank line is part of a code block: a fenced block keeps
          // the line as-is (less the fence's indent), an indented block
          // loses four columns. It is not a structural blank line.
          leaf.lines.push(leaf.fenced ? stripIndent(leaf.fenceIndent, true) : stripIndent(4));
          tip = container;
          continue;
        }
        if (leaf.t === 4) {
          if (leaf.htmlType <= 5) {
            // a blank line is part of the HTML block
            leaf.lines.push(rest());
            tip = container;
            continue;
          }
          // HTML blocks of types 6-7 end at a blank line
          leaf.endedByBlank = true;
          finalize(leaf);
        } else if (leaf.t === 9) {
          // a whitespace-only line containing a tab is a table row of
          // empty cells, not a blank line ending the table; a line of
          // only spaces (or truly empty) ends it
          if (rest().indexOf('\t') !== -1) {
            leaf.rows.push(rest());
            markNonBlank(leaf);
            tip = container;
            continue;
          }
          finalize(leaf);
        } else if (leaf.t === 1) {
          finalize(leaf);
        }
      } else if (leaf && leaf.t === 4) {
        // a closed HTML block followed by a genuinely empty line (a
        // whitespace-only line does not count) loses its trailing
        // newline
        if (rest() === '') leaf.endedByBlank = true;
      }
      // A blank line (whether genuinely blank or blank only after its
      // container markers were consumed) marks the container and its
      // last child. It does not propagate to ancestors.
      markBlank(container, blank);
      tip = container;
      continue;
    }

    // Continue an open leaf, or start new blocks. Loop because starting a
    // container (list item, quote) re-runs the leaf checks inside it.
    let guard = 0;
    while (guard++ < 8) {
      const leaf = lastChild(container);

      // Fenced code continuation.
      if (leaf && leaf.t === 3 && leaf.open && leaf.fenced) {
        const s = rest();
        let i = 0;
        while (i < s.length && s.charCodeAt(i) === 32) i++;
        let closing = false;
        if (i <= 3) {
          const c = s.charCodeAt(i);
          if (c === leaf.fenceChar.charCodeAt(0)) {
            let j = i;
            while (j < s.length && s.charCodeAt(j) === c) j++;
            if (j - i >= leaf.fenceLen) {
              let k = j;
              while (k < s.length && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9)) k++;
              if (k >= s.length) closing = true;
            }
          }
        }
        if (closing) {
          leaf.open = false;
          tip = container;
          break;
        }
        leaf.lines.push(stripIndent(leaf.fenceIndent, true));
        markNonBlank(leaf);
        tip = container;
        break;
      }

      // Indented code continuation.
      if (leaf && leaf.t === 3 && leaf.open && !leaf.fenced) {
        if (restIndent() >= 4) {
          leaf.lines.push(stripIndent(4));
          markNonBlank(leaf);
          tip = container;
          break;
        }
        finalize(leaf);
        // fall through: re-process the line as a new block
      }

      // HTML block continuation.
      if (leaf && leaf.t === 4 && leaf.open) {
        const s = rest();
        leaf.lines.push(s);
        markNonBlank(leaf);
        let done = false;
        if (leaf.htmlType === 1) done = s.toLowerCase().indexOf(leaf.htmlEnd) !== -1;
        else if (leaf.htmlType === 2) done = s.indexOf('-->') !== -1;
        else if (leaf.htmlType === 3) done = s.indexOf('?>') !== -1;
        else if (leaf.htmlType === 4) done = s.indexOf('>') !== -1;
        else if (leaf.htmlType === 5) done = s.indexOf(']]>') !== -1;
        if (done) leaf.open = false;
        tip = container;
        break;
      }

      // Table continuation.
      if (leaf && leaf.t === 9 && leaf.open) {
        const s = rest();
        let isBlockStart = false;
        let k = 0;
        while (k < s.length && s.charCodeAt(k) === 32) k++;
        if (k <= 3) {
          const c = s.charCodeAt(k);
          if (c === 62 || c === 35) isBlockStart = true;
          else if (c === 96 || c === 126) {
            let j = k;
            while (j < s.length && s.charCodeAt(j) === c) j++;
            if (j - k >= 3) isBlockStart = true;
          } else if (c === 60) {
            if (matchHtmlBlock() !== 0) isBlockStart = true;
          } else if (c === 45 || c === 43 || c === 42 || (c >= 48 && c <= 57)) {
            if (matchListMarker() !== null || matchThematicBreak()) isBlockStart = true;
          }
        }
        if (!isBlockStart) {
          leaf.rows.push(s);
          markNonBlank(leaf);
          tip = container;
          break;
        }
        leaf.open = false;
        // fall through: re-process the line
      }

      // Paragraph: setext, table, interruption, continuation.
      if (leaf && leaf.t === 1 && leaf.open) {
        const headerCells = leaf.lines.length === 1 ? tableHeaderCells(leaf.lines[0]) : null;
        if (headerCells) {
          const aligns = matchTableDelimiter(headerCells);
          if (aligns) {
            const table = {
              t: 9,
              children: [],
              parent: container,
              open: true,
              lastLineBlank: false,
              header: headerCells,
              aligns,
              rows: [],
            };
            const idx = container.children.indexOf(leaf);
            container.children[idx] = table;
            leaf.open = false;
            markNonBlank(table);
            tip = container;
            break;
          }
        }
        const level = matchSetext();
        // A setext underline does not apply when the paragraph so far is
        // only link reference definitions.
        if (level !== 0 && parseDefinitions(leaf.lines.join('\n'), true) !== '') {
          const heading = {
            t: 2,
            children: [],
            parent: container,
            open: false,
            lastLineBlank: leaf.lastLineBlank,
            level,
            lines: leaf.lines,
          };
          const idx = container.children.indexOf(leaf);
          container.children[idx] = heading;
          leaf.open = false;
          finalizeParagraph(heading);
          if (!heading.gone) {
            heading.text = heading.text.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
          }
          tip = container;
          break;
        }
        if (canInterruptParagraph(container)) {
          finalize(leaf);
          // fall through to the leaf-start checks
        } else {
          leaf.lines.push(rest());
          markNonBlank(leaf);
          tip = container;
          break;
        }
      }

      // New leaf starts.
      const nc = startNewBlock(container);
      if (nc === null) {
        tip = container;
        break;
      }
      container = nc;
    }
  }

  function canInterruptParagraph(container) {
    const fence = matchFence();
    if (fence) return true;
    const htmlType = matchHtmlBlock();
    if (htmlType >= 1 && htmlType <= 6) return true;
    if (matchAtx() !== null) return true;
    if (matchThematicBreak()) return true;
    const s = rest();
    let i = 0;
    while (i < s.length && s.charCodeAt(i) === 32) i++;
    if (i <= 3 && s.charCodeAt(i) === 62) return true;
    const marker = matchListMarker();
    if (marker) {
      if (marker.empty) return false;
      // An ordered list must start with 1 to interrupt a paragraph,
      // except when the paragraph is directly inside a list item: a
      // nested list there may start with any number.
      if (marker.ordered && marker.start !== 1 && container.t !== 7) return false;
      return true;
    }
    return false;
  }

  // Try to start a new block in container for the current line.
  // Returns the new container node when a container was created and the
  // line still needs processing inside it, null when the line was consumed.
  function startNewBlock(container) {
    // Indented code.
    if (restIndent() >= 4) {
      const code = {
        t: 3,
        children: [],
        parent: container,
        open: true,
        lastLineBlank: false,
        fenced: false,
        info: '',
        lines: [stripIndent(4)],
      };
      addChild(container, code);
      markNonBlank(code);
      return null;
    }
    const fence = matchFence();
    if (fence) {
      const code = {
        t: 3,
        children: [],
        parent: container,
        open: true,
        lastLineBlank: false,
        fenced: true,
        fenceChar: fence[0],
        fenceLen: fence[1],
        fenceIndent: fence[3],
        info: fence[2],
        lines: [],
      };
      addChild(container, code);
      markNonBlank(code);
      return null;
    }
    const htmlType = matchHtmlBlock();
    if (htmlType !== 0) {
      const s = rest();
      let end = '';
      if (htmlType === 1) {
        const lower = s.toLowerCase();
        if (lower.indexOf('<script') !== -1) end = '</script>';
        else if (lower.indexOf('<textarea') !== -1) end = '</textarea>';
        else if (lower.indexOf('<style') !== -1) end = '</style>';
        else end = '</pre>';
      }
      const html = {
        t: 4,
        children: [],
        parent: container,
        open: true,
        lastLineBlank: false,
        htmlType,
        htmlEnd: end,
        lines: [s],
      };
      addChild(container, html);
      markNonBlank(html);
      if (htmlType === 1 && s.toLowerCase().indexOf(end) !== -1) html.open = false;
      else if (htmlType === 2 && s.indexOf('-->') !== -1) html.open = false;
      else if (htmlType === 3 && s.indexOf('?>') !== -1) html.open = false;
      else if (htmlType === 4 && s.indexOf('>') !== -1) html.open = false;
      else if (htmlType === 5 && s.indexOf(']]>') !== -1) html.open = false;
      return null;
    }
    const atx = matchAtx();
    if (atx !== null) {
      const s = rest();
      // remove the closing sequence (spaces, then #s, then spaces to end)
      // before trimming, so a heading whose content is only a closing
      // sequence comes out empty
      let content = s.slice(atx[1]).replace(/[ \t]+#+[ \t]*$/, '');
      content = content.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
      const heading = {
        t: 2,
        children: [],
        parent: container,
        open: false,
        lastLineBlank: false,
        level: atx[0],
        lines: [content],
        text: content,
      };
      addChild(container, heading);
      markNonBlank(heading);
      return null;
    }
    if (matchThematicBreak()) {
      const hr = { t: 8, children: [], parent: container, open: false, lastLineBlank: false };
      addChild(container, hr);
      markNonBlank(hr);
      return null;
    }
    // Blockquote.
    {
      const s = rest();
      let i = 0;
      while (i < s.length && s.charCodeAt(i) === 32) i++;
      if (i <= 3 && s.charCodeAt(i) === 62) {
        const quote = { t: 5, children: [], parent: container, open: true, lastLineBlank: false };
        addChild(container, quote);
        // consume the marker: skip spaces, '>', one optional space
        skipWhitespaceColumns(3);
        offset++;
        column++;
        if (peek() === ' ') {
          offset++;
          column++;
          // A tab right after `> ` is content: it expands to 2
          // spaces from the quote's tab-stop column.
          if (offset < line.length && line.charCodeAt(offset) === 9) {
            partial = 2;
          }
        } else if (offset < line.length && line.charCodeAt(offset) === 9) {
          const w = 4 - (column % 4);
          if (w > 1) {
            partial = w - 1;
            column++;
          } else {
            offset++;
            column++;
          }
        }
        markNonBlank(quote);
        return quote;
      }
    }
    // List item.
    const marker = matchListMarker();
    if (marker) {
      // A new item joins a list when the bullet/delimiter matches.
      // A nested list inside the current item only matches when the
      // marker sits at the nested list's indent or up to 3 columns
      // further in; a marker further out belongs to the parent list
      // instead. A sibling list (the current list, or the parent of
      // the current item) also matches when the marker dedents below
      // its indent, as long as it is not more than 3 columns further
      // in.
      const markerDelta = (lst) =>
        lst.children.length === 0
          ? 0
          : marker.markerCol - lst.children[0].markerOffset;
      const nestedMatches = (lst) => {
        const d = markerDelta(lst);
        return d >= 0 && d <= 3;
      };
      const siblingMatches = (lst) => markerDelta(lst) <= 3;
      let c = container;
      while (
        c.t === 6 &&
        c.open &&
        (c.ordered !== marker.ordered ||
          (marker.ordered ? c.delim !== marker.delim : c.bullet !== marker.bullet) ||
          markerDelta(c) > 3)
      ) {
        c = c.parent;
      }
      let list = null;
      if (
        c.t === 6 &&
        c.open &&
        c.ordered === marker.ordered &&
        (marker.ordered ? c.delim === marker.delim : c.bullet === marker.bullet) &&
        siblingMatches(c)
      ) {
        list = c;
      } else {
        const last = lastChild(c);
        if (
          last &&
          last.t === 6 &&
          last.open &&
          last.ordered === marker.ordered &&
          (marker.ordered ? last.delim === marker.delim : last.bullet === marker.bullet) &&
          nestedMatches(last)
        ) {
          list = last;
        } else if (
          c.t === 7 &&
          c.parent &&
          c.parent.t === 6 &&
          c.parent.open &&
          c.parent.ordered === marker.ordered &&
          (marker.ordered ? c.parent.delim === marker.delim : c.parent.bullet === marker.bullet) &&
          siblingMatches(c.parent) &&
          // The new marker sits before this item's content starts,
          // so it cannot be a nested list inside the item; it is a
          // sibling in the parent list.
          marker.markerCol < c.contentIndent
        ) {
          // A sibling of this item, not a child of the nested list
          // inside it: the new marker is at the parent list's
          // indent, not the nested list's.
          list = c.parent;
        } else {
          list = {
            t: 6,
            children: [],
            parent: c,
            open: true,
            lastLineBlank: false,
            ordered: marker.ordered,
            bullet: marker.bullet,
            delim: marker.delim,
            start: marker.start,
            tight: true,
          };
          addChild(c, list);
        }
      }
      const item = {
        t: 7,
        children: [],
        parent: list,
        open: true,
        lastLineBlank: false,
        contentIndent: marker.contentIndent,
        // the content indent measured from the column where the marker
        // was matched (after the containers above it were consumed)
        relIndent: marker.contentIndent - column,
        markerOffset: marker.markerCol,
      };
      addChild(list, item);
      if (marker.empty) {
        markNonBlank(item);
        return null;
      }
      // Move the line position to the item's content.
      advanceChars(marker.markerLen);
      advanceToColumn(marker.contentIndent);
      markNonBlank(item);
      return item;
    }
    // Paragraph. A line whose content is blank does not start one.
    if (restIsBlank()) return null;
    // Save the ancestors' blank-line flags: if this paragraph turns out
    // to be only link reference definitions, it is dropped and the flags
    // are restored, so the definitions do not make a list loose or tight.
    const savedBlanks = [];
    let anc = container;
    while (anc) {
      savedBlanks.push(anc.lastLineBlank);
      anc = anc.parent;
    }
    const p = {
      t: 1,
      children: [],
      parent: container,
      open: true,
      lastLineBlank: false,
      lines: [rest()],
      savedBlanks,
    };
    addChild(container, p);
    markNonBlank(p);
    return null;
  }

  // Close everything left open.
  closeUpTo(doc);
  return doc;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Process backslash escapes in a string (used for fenced code info strings).
function unescapeBackslashes(s) {
  if (s.indexOf('\\') === -1) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 92 && i + 1 < s.length && isAsciiPunct(s.charCodeAt(i + 1))) {
      out += s[i + 1];
      i++;
    } else out += s[i];
  }
  return out;
}

// Task list marker at the start of a paragraph's text. Returns
// [checked, remainingText] or null.
function taskMarker(text) {
  if (text.length < 4) return null;
  if (text.charCodeAt(0) !== 91) return null;
  const c = text.charCodeAt(1);
  if (c !== 32 && c !== 120 && c !== 88) return null;
  if (text.charCodeAt(2) !== 93 || text.charCodeAt(3) !== 32) return null;
  // keep the space after the bracket: the checkbox is followed by it
  return [c !== 32, text.slice(3)];
}

// Drop the empty edge cells produced by leading/trailing pipes.
function edgeCells(cells) {
  let out = cells;
  if (out.length > 0 && out[0].trim() === '') out = out.slice(1);
  if (out.length > 0 && out[out.length - 1].trim() === '') out = out.slice(0, -1);
  return out;
}

function renderBlock(node, refs, out) {
  switch (node.t) {
    case 0: {
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) renderBlock(kids[i], refs, out);
      break;
    }
    case 1: {
      if (node.gone) break;
      let text = node.text;
      let checkbox = '';
      if (node.parent && node.parent.t === 7 && node.parent.children[0] === node) {
        const task = taskMarker(text);
        if (task) {
          checkbox = task[0]
            ? '<input checked="" disabled="" type="checkbox">'
            : '<input disabled="" type="checkbox">';
          text = task[1];
        }
      }
      out.push('<p>', checkbox, parseInline(text, refs), '</p>\n');
      break;
    }
    case 2: {
      out.push('<h', node.level, '>', parseInline(node.text, refs), '</h', node.level, '>\n');
      break;
    }
    case 3: {
      let content = node.lines.length > 0 ? node.lines.join('\n') : '';
      // the content ends with a newline: add one only when it does not
      // already end with one (a trailing blank line supplies it)
      if (content !== '' && !content.endsWith('\n')) content += '\n';
      if (node.fenced) {
        let cls = '';
        if (node.info !== '') {
          const first = unescapeBackslashes(node.info.split(/\s+/)[0]);
          cls = ' class="language-' + escapeText(first) + '"';
        }
        out.push('<pre><code', cls, '>', escapeCode(content), '</code></pre>\n');
      } else {
        out.push('<pre><code>', escapeCode(content), '</code></pre>\n');
      }
      break;
    }
    case 4: {
      const ls = node.lines;
      const isLast =
        node.parent &&
        node.parent.t !== 0 &&
        node.parent.children[node.parent.children.length - 1] === node;
      const isLastInDoc =
        node.parent &&
        node.parent.t === 0 &&
        node.parent.children[node.parent.children.length - 1] === node;
      out.push(ls.join('\n'));
      // No trailing newline when the block ends at a blank line, when it
      // is the last block inside a container (a list item or quote), or
      // when it is the last block of the document and the input itself
      // has no trailing newline.
      if (!node.endedByBlank && !isLast && !(isLastInDoc && node.parent.noTrailingNewline)) out.push('\n');
      break;
    }
    case 5: {
      out.push('<blockquote>\n');
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) renderBlock(kids[i], refs, out);
      out.push('</blockquote>\n');
      break;
    }
    case 6: {
      if (node.ordered) {
        out.push(node.start !== 1 ? '<ol start="' + node.start + '">\n' : '<ol>\n');
      } else {
        out.push('<ul>\n');
      }
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) renderBlock(kids[i], refs, out);
      out.push(node.ordered ? '</ol>\n' : '</ul>\n');
      break;
    }
    case 7: {
      const list = node.parent;
      const tight = list.tight;
      const kids = node.children;
      out.push('<li>');
      if (tight) {
        for (let i = 0; i < kids.length; i++) {
          const k = kids[i];
          if (k.t === 1 && !k.gone) {
            let text = k.text;
            let checkbox = '';
            if (i === 0) {
              const task = taskMarker(text);
              if (task) {
                checkbox = task[0]
                  ? '<input checked="" disabled="" type="checkbox">'
                  : '<input disabled="" type="checkbox">';
                text = task[1];
              }
            }
            out.push(checkbox, parseInline(text, refs));
          } else {
            renderBlock(k, refs, out);
          }
        }
      } else {
        for (let i = 0; i < kids.length; i++) renderBlock(kids[i], refs, out);
      }
      out.push('</li>\n');
      break;
    }
    case 8: {
      out.push('<hr>\n');
      break;
    }
    case 9: {
      out.push('<table>\n<thead>\n<tr>\n');
      const header = node.header;
      for (let i = 0; i < header.length; i++) {
        const align = node.aligns[i];
        out.push('<th', align ? ' align="' + align + '"' : '', '>', parseInline(header[i].trim(), refs), '</th>\n');
      }
      out.push('</tr>\n</thead>\n');
      if (node.rows.length > 0) {
        out.push('<tbody>');
        for (let r = 0; r < node.rows.length; r++) {
          out.push('<tr>\n');
          const cells = edgeCells(splitTableCells(node.rows[r]));
          for (let i = 0; i < header.length; i++) {
            const align = node.aligns[i];
            const cell = i < cells.length ? cells[i].trim() : '';
            out.push('<td', align ? ' align="' + align + '"' : '', '>', parseInline(cell, refs), '</td>\n');
          }
          out.push('</tr>\n');
        }
        out.push('</tbody>');
      }
      out.push('</table>\n');
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parse(markdown) {
  suppressExtAutolink = false;
  const src = String(markdown).replace(/\r\n?/g, '\n').replace(/\u0000/g, '\uFFFD');
  const refs = new Map();
  const doc = parseBlocks(src, refs);
  doc.noTrailingNewline = src.length > 0 && src.charCodeAt(src.length - 1) !== 10;
  const out = [];
  renderBlock(doc, refs, out);
  return out.join('');
}
