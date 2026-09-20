/**
 * HTML character-reference decoding for JSX text and string attribute values.
 *
 * Real JSX parsers (Babel, TypeScript) decode HTML entities inside JSX text
 * and inside string attribute values. This module implements that for numeric
 * references (`&#65;`, `&#x1F600;`) and the named HTML4 entity set plus
 * `&apos;`. An unknown or malformed reference is left in the output verbatim,
 * matching the real parsers' leniency.
 *
 * Dependency-free; usable from the React-free `./core` entry.
 */

/**
 * Cap on how many characters the tokenizer buffers after a `&` while waiting
 * for `;`. The longest supported reference is far shorter (`&thetasym;`,
 * `&#x10FFFF;`), so anything longer is already known to be literal text.
 */
export const MAX_ENTITY_LENGTH = 32;

const NAMED = new Map<string, string>();

/** Register consecutive code points starting at `first`, one per name. */
function run(first: number, names: string): void {
  names.split(" ").forEach((name, i) => {
    NAMED.set(name, String.fromCharCode(first + i));
  });
}

// Latin-1 (ISO 8859-1) entities: exactly U+00A0..U+00FF, in order.
run(
  0xa0,
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr " +
    "deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest " +
    "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml " +
    "ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig " +
    "agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml " +
    "eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml",
);

// Greek letters (note the gap at U+03A2 and the final-sigma at U+03C2).
run(913, "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho");
run(931, "Sigma Tau Upsilon Phi Chi Psi Omega");
run(945, "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho");
run(962, "sigmaf sigma tau upsilon phi chi psi omega");

// Everything else: name → code point.
const MISC: Record<string, number> = {
  quot: 34,
  amp: 38,
  apos: 39,
  lt: 60,
  gt: 62,
  OElig: 338,
  oelig: 339,
  Scaron: 352,
  scaron: 353,
  Yuml: 376,
  fnof: 402,
  circ: 710,
  tilde: 732,
  thetasym: 977,
  upsih: 978,
  piv: 982,
  ensp: 8194,
  emsp: 8195,
  thinsp: 8201,
  zwnj: 8204,
  zwj: 8205,
  lrm: 8206,
  rlm: 8207,
  ndash: 8211,
  mdash: 8212,
  lsquo: 8216,
  rsquo: 8217,
  sbquo: 8218,
  ldquo: 8220,
  rdquo: 8221,
  bdquo: 8222,
  dagger: 8224,
  Dagger: 8225,
  bull: 8226,
  hellip: 8230,
  permil: 8240,
  prime: 8242,
  Prime: 8243,
  lsaquo: 8249,
  rsaquo: 8250,
  oline: 8254,
  frasl: 8260,
  euro: 8364,
  image: 8465,
  weierp: 8472,
  real: 8476,
  trade: 8482,
  alefsym: 8501,
  larr: 8592,
  uarr: 8593,
  rarr: 8594,
  darr: 8595,
  harr: 8596,
  crarr: 8629,
  lArr: 8656,
  uArr: 8657,
  rArr: 8658,
  dArr: 8659,
  hArr: 8660,
  forall: 8704,
  part: 8706,
  exist: 8707,
  empty: 8709,
  nabla: 8711,
  isin: 8712,
  notin: 8713,
  ni: 8715,
  prod: 8719,
  sum: 8721,
  minus: 8722,
  lowast: 8727,
  radic: 8730,
  prop: 8733,
  infin: 8734,
  ang: 8736,
  and: 8743,
  or: 8744,
  cap: 8745,
  cup: 8746,
  int: 8747,
  there4: 8756,
  sim: 8764,
  cong: 8773,
  asymp: 8776,
  ne: 8800,
  equiv: 8801,
  le: 8804,
  ge: 8805,
  sub: 8834,
  sup: 8835,
  nsub: 8836,
  sube: 8838,
  supe: 8839,
  oplus: 8853,
  otimes: 8855,
  perp: 8869,
  sdot: 8901,
  lceil: 8968,
  rceil: 8969,
  lfloor: 8970,
  rfloor: 8971,
  loz: 9674,
  spades: 9824,
  clubs: 9827,
  hearts: 9829,
  diams: 9830,
  lang: 10216,
  rang: 10217,
};
for (const [name, cp] of Object.entries(MISC)) {
  NAMED.set(name, String.fromCodePoint(cp));
}

const DECIMAL = /^[0-9]+$/;
const HEX = /^[0-9a-fA-F]+$/;

/**
 * Decode one character-reference *body* — the part between `&` and `;` — into
 * the referenced string, or `null` when it is not a valid reference (unknown
 * name, malformed digits, or a rejected code point). `null` means the caller
 * should keep the source text verbatim.
 *
 * Hex references use a lowercase `x` only (`&#X61;` stays verbatim), matching
 * Babel. One deliberate deviation from Babel: NUL and lone-surrogate code
 * points (which Babel decodes as-is) are rejected here, because injecting
 * them into a rendered tree from untrusted streamed input breaks downstream
 * serialization.
 */
export function decodeEntity(body: string): string | null {
  if (body.startsWith("#")) {
    const hex = body[1] === "x";
    const digits = body.slice(hex ? 2 : 1);
    if (digits.length === 0 || !(hex ? HEX : DECIMAL).test(digits)) return null;
    const cp = parseInt(digits, hex ? 16 : 10);
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    return String.fromCodePoint(cp);
  }
  return NAMED.get(body) ?? null;
}

const ENTITY = /&(#[^&;]*|[a-zA-Z][a-zA-Z0-9]*);/g;

/**
 * Decode every valid character reference in `text` (used for complete strings,
 * e.g. attribute values); invalid ones are kept verbatim.
 */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY, (match, body: string) => decodeEntity(body) ?? match);
}
