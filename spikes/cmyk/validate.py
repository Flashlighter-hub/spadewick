"""Spike B, part 3: read the PDFs with two independent readers (qpdf through pikepdf, and MuPDF through PyMuPDF) and check that the
output intent, the profile, and the CMYK samples came through. Run: python validate.py (from spikes/cmyk)"""
import sys, hashlib, json
sys.path.insert(0, 'py')
import pikepdf, pymupdf

PROFILES = {'isocoated': 'profiles/ISOcoated_v2_eci.icc', 'crpc1': 'profiles/CGATS21_CRPC1.icc'}
report = {}
for pid, icc in PROFILES.items():
    pdf_path = f'out/b-{pid}.pdf'
    want_profile = hashlib.sha256(open(icc, 'rb').read()).hexdigest()
    want_image = open(f'out/b-{pid}.cmyk.bin', 'rb').read()
    r = {}
    # ---- reader 1: qpdf (through pikepdf) ----
    with pikepdf.open(pdf_path) as pdf:
        problems = pdf.check_pdf_syntax()
        r['qpdf_check_problems'] = [str(p) for p in problems]; r['qpdf_version'] = pikepdf.__libqpdf_version__; r['mupdf_version'] = pymupdf.VersionBind
        intents = pdf.Root.get('/OutputIntents')
        r['qpdf_output_intents'] = len(intents) if intents is not None else 0
        oi = intents[0]
        r['qpdf_intent'] = {'S': str(oi.S), 'id': str(oi.OutputConditionIdentifier), 'registry': str(oi.RegistryName)}
        prof = oi.DestOutputProfile
        r['qpdf_profile_components'] = int(prof.N)
        r['qpdf_profile_identical'] = hashlib.sha256(prof.read_bytes()).hexdigest() == want_profile
        imgs = []
        for page in pdf.pages:
            for name, xo in page.Resources.XObject.items():
                cs = xo.ColorSpace
                data = xo.read_bytes()
                imgs.append({'colorspace': str(cs) if not isinstance(cs, pikepdf.Array) else f'[{cs[0]} -> N={int(cs[1].N)}]', 'samples_identical': data == want_image, 'bytes': len(data)})
        r['qpdf_images'] = imgs
    # ---- reader 2: MuPDF (through PyMuPDF) ----
    doc = pymupdf.open(pdf_path)
    r['mupdf_pages'] = doc.page_count
    cat = doc.pdf_catalog()
    r['mupdf_has_output_intents'] = doc.xref_get_key(cat, 'OutputIntents')[0] != 'null'
    seen = []
    for pno in range(doc.page_count):
        for img in doc.get_page_images(pno, full=True):
            xref = img[0]
            ex = doc.extract_image(xref)
            seen.append({'page': pno + 1, 'colorspace_components': ex.get('colorspace'), 'cs_name': ex.get('cs-name'), 'width': ex['width'], 'height': ex['height']})
        pix = doc[pno].get_pixmap(dpi=72)
        # the paper area right of the last patch row must be white, the first tile (white patch) white, the black patch dark
        cols, rows = 8, 5
        tile = 30
        def px(col, row):
            x = 20 + col * tile + tile // 2; y = 20 + row * tile + tile // 2
            return pix.pixel(int(x), int(y))
        seen[-1]['white_tile'] = px(0, 0)
        seen[-1]['black_tile'] = px(7, 0)
        seen[-1]['red_tile'] = px(0, 1)
    r['mupdf_images'] = seen
    r['mupdf_render_ok'] = True
    report[pid] = r
json.dump(report, open('out/validate.json', 'w'), indent=1)
print(json.dumps(report, indent=1))
