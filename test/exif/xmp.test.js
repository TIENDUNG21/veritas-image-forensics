import { describe, expect, it } from 'vitest';
import { summarizeXmp } from '../../src/exif/xmp.js';

const attributeForm = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
    xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmp:CreatorTool="Pixel Editor 3.1 &amp; Friends"
    xmp:CreateDate="2026-11-01T09:00:00+07:00"
    xmp:ModifyDate="2026-11-16T22:15:00+07:00"
    xmpMM:DocumentID="xmp.did:abc"
    xmpMM:OriginalDocumentID="xmp.did:orig"
    xmpMM:InstanceID="xmp.iid:def">
   <xmpMM:History>
    <rdf:Seq>
     <rdf:li stEvt:action="created" stEvt:when="2026-11-01T09:00:00+07:00" stEvt:softwareAgent="Pixel Editor 3.1"/>
     <rdf:li stEvt:action="saved" stEvt:when="2026-11-16T22:15:00+07:00" stEvt:softwareAgent="Pixel Editor 3.1" stEvt:changed="/"/>
    </rdf:Seq>
   </xmpMM:History>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

const elementForm = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#">
<xmp:CreatorTool>Raster Studio</xmp:CreatorTool>
<xmp:ModifyDate>2026-11-17T08:00:00Z</xmp:ModifyDate>
<xmpMM:History><rdf:Seq>
<rdf:li rdf:parseType="Resource"><stEvt:action>converted</stEvt:action><stEvt:softwareAgent>Raster Studio</stEvt:softwareAgent><stEvt:when>2026-11-17T08:00:00Z</stEvt:when></rdf:li>
</rdf:Seq></xmpMM:History>
</rdf:Description></rdf:RDF></x:xmpmeta>`;

describe('summarizeXmp', () => {
  it('reads properties written as attributes and decodes entities', () => {
    const xmp = summarizeXmp(attributeForm);
    expect(xmp.creatorTool).toBe('Pixel Editor 3.1 & Friends');
    expect(xmp.createDate).toBe('2026-11-01T09:00:00+07:00');
    expect(xmp.modifyDate).toBe('2026-11-16T22:15:00+07:00');
    expect(xmp.documentId).toBe('xmp.did:abc');
    expect(xmp.originalDocumentId).toBe('xmp.did:orig');
    expect(xmp.history).toEqual([
      { action: 'created', softwareAgent: 'Pixel Editor 3.1', when: '2026-11-01T09:00:00+07:00' },
      { action: 'saved', softwareAgent: 'Pixel Editor 3.1', when: '2026-11-16T22:15:00+07:00' },
    ]);
    expect(xmp.namespaces).toContain('http://ns.adobe.com/camera-raw-settings/1.0/');
  });

  it('reads properties written as elements', () => {
    const xmp = summarizeXmp(elementForm);
    expect(xmp.creatorTool).toBe('Raster Studio');
    expect(xmp.modifyDate).toBe('2026-11-17T08:00:00Z');
    expect(xmp.createDate).toBeNull();
    expect(xmp.history).toEqual([
      { action: 'converted', softwareAgent: 'Raster Studio', when: '2026-11-17T08:00:00Z' },
    ]);
  });

  it('returns what it can from truncated or broken XML without throwing', () => {
    const cut = attributeForm.slice(0, attributeForm.indexOf('<rdf:li stEvt:action="saved"'));
    const xmp = summarizeXmp(cut);
    expect(xmp.creatorTool).toBe('Pixel Editor 3.1 & Friends');
    expect(xmp.history.length).toBeLessThanOrEqual(1);
    expect(summarizeXmp('<<<>>> not xml').creatorTool).toBeNull();
    expect(summarizeXmp('').history).toEqual([]);
  });
});
