/**
 * XMP is RDF/XML. Editors record what they did in it (CreatorTool, dates, the xmpMM:History
 * event list). A full XML parser is not available in workers or Node without dependencies,
 * and forensic use needs only a handful of properties, so this reads them with tolerant
 * patterns that accept both RDF forms (attributes and child elements) and never throw.
 *
 * @typedef {{ action: string, softwareAgent: string, when: string }} XmpEvent
 * @typedef {{
 *   creatorTool: string | null, createDate: string | null, modifyDate: string | null,
 *   metadataDate: string | null, documentId: string | null, originalDocumentId: string | null,
 *   instanceId: string | null, derivedFrom: boolean, history: XmpEvent[], namespaces: string[],
 *   length: number
 * }} XmpSummary
 */

const MAX_TEXT = 2_000_000;
const MAX_EVENTS = 200;

/**
 * @param {string} xml
 * @returns {XmpSummary}
 */
export function summarizeXmp(xml) {
  const text = xml.length > MAX_TEXT ? xml.slice(0, MAX_TEXT) : xml;
  return {
    creatorTool: property(text, 'xmp:CreatorTool'),
    createDate: property(text, 'xmp:CreateDate'),
    modifyDate: property(text, 'xmp:ModifyDate'),
    metadataDate: property(text, 'xmp:MetadataDate'),
    documentId: property(text, 'xmpMM:DocumentID'),
    originalDocumentId: property(text, 'xmpMM:OriginalDocumentID'),
    instanceId: property(text, 'xmpMM:InstanceID'),
    derivedFrom: text.includes('<xmpMM:DerivedFrom'),
    history: history(text),
    namespaces: [...new Set([...text.matchAll(/xmlns:[\w.-]+="([^"]*)"/g)].map((m) => m[1] ?? ''))],
    length: xml.length,
  };
}

/**
 * Value of a simple property, as an attribute (`ns:Name="v"`) or element (`<ns:Name>v<`).
 * @param {string} text
 * @param {string} qname
 */
function property(text, qname) {
  const attribute = new RegExp(`\\s${qname}="([^"]*)"`).exec(text);
  if (attribute) return decodeEntities(attribute[1] ?? '');
  const element = new RegExp(`<${qname}>([^<]*)</${qname}>`).exec(text);
  return element ? decodeEntities((element[1] ?? '').trim()) : null;
}

/** @param {string} text */
function history(text) {
  const start = text.indexOf('<xmpMM:History');
  if (start < 0) return [];
  const endTag = text.indexOf('</xmpMM:History>', start);
  const block = text.slice(start, endTag < 0 ? undefined : endTag);
  /** @type {XmpEvent[]} */
  const events = [];
  // Split instead of one lazy regex, so hostile input with many unclosed items stays linear.
  for (const piece of block.split('<rdf:li').slice(1)) {
    const close = piece.indexOf('</rdf:li>');
    const item = ` ${close < 0 ? piece : piece.slice(0, close)}`;
    const action = property(item, 'stEvt:action');
    if (action === null) continue;
    events.push({
      action,
      softwareAgent: property(item, 'stEvt:softwareAgent') ?? '',
      when: property(item, 'stEvt:when') ?? '',
    });
    if (events.length >= MAX_EVENTS) break;
  }
  return events;
}

/** @param {string} s */
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    const lower = String(e).toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const code = lower.startsWith('#x')
      ? parseInt(lower.slice(2), 16)
      : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}
