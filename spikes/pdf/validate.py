"""Spike C: read out/c.pdf with independent tools and check each production feature. Run from spikes/pdf: python validate.py"""
import sys, json, subprocess, hashlib
sys.path.insert(0, 'py')
import pikepdf, pymupdf

import os
PDFCPU = os.path.abspath(os.path.join('bin', 'pdfcpu.exe'))
exp = json.load(open('out/expected.json'))
R = {'tools': {'qpdf': pikepdf.__libqpdf_version__, 'mupdf': pymupdf.VersionBind}}
close = lambda a, b, tol=0.01: all(abs(x - y) <= tol for x, y in zip(a, b))
checks = []
def check(name, ok, detail=''):
    checks.append({'check': name, 'ok': bool(ok), 'detail': detail})

# ---------------- qpdf / pikepdf: structure ----------------
pdf = pikepdf.open('out/c.pdf')
problems = pdf.check_pdf_syntax()
check('qpdf: no syntax problems', not problems, [str(p) for p in problems])
page = pdf.pages[0]
box = lambda k: [float(x) for x in page.obj[k]]
media = [float(x) for x in page.MediaBox]
trim, bleed, art, crop = box('/TrimBox'), box('/BleedBox'), box('/ArtBox'), box('/CropBox')
check('TrimBox as written', close(trim, exp['trim']), trim)
check('BleedBox as written', close(bleed, exp['bleed']), bleed)
check('ArtBox as written', close(art, exp['art']), art)
inside = lambda inner, outer: inner[0] >= outer[0] - 1e-6 and inner[1] >= outer[1] - 1e-6 and inner[2] <= outer[2] + 1e-6 and inner[3] <= outer[3] + 1e-6
check('boxes nest: Art in Trim in Bleed in Crop in Media', inside(art, trim) and inside(trim, bleed) and inside(bleed, crop) and inside(crop, media))
mm = lambda v: v / exp['MM']
check('trim is 63.5 x 88.9 mm, bleed is 3 mm outside it', abs(mm(trim[2] - trim[0]) - 63.5) < 0.01 and abs(mm(trim[3] - trim[1]) - 88.9) < 0.01 and abs(mm(trim[0] - bleed[0]) - 3) < 0.01,
      [round(mm(trim[2] - trim[0]), 3), round(mm(trim[3] - trim[1]), 3), round(mm(trim[0] - bleed[0]), 3)])

oi = pdf.Root.OutputIntents[0]
check('output intent with a 4-component profile', int(oi.DestOutputProfile.N) == 4 and str(oi.S) == '/GTS_PDFX', str(oi.OutputConditionIdentifier))

res = page.Resources
spots = {}
for k, v in res.ColorSpace.items():
    if isinstance(v, pikepdf.Array) and str(v[0]) == '/Separation':
        fn = v[3]
        spots[str(v[1])] = {'alternate': str(v[2]), 'function_type': int(fn.FunctionType), 'C0': [float(x) for x in fn.C0], 'C1': [float(x) for x in fn.C1]}
check('spot colour "Spadewick Gold" is a Separation with a CMYK alternate and a tint transform', '/Spadewick Gold' in spots and spots['/Spadewick Gold']['alternate'] == '/DeviceCMYK' and spots['/Spadewick Gold']['function_type'] == 2, spots.get('/Spadewick Gold'))
check('die line has its own spot colour "DieCut"', '/DieCut' in spots, spots.get('/DieCut'))
check('registration colour is the Separation /All', '/All' in spots, spots.get('/All'))
gs = res.ExtGState.GsOver
check('overprint is on for fill and stroke (OP, op, OPM 1)', bool(gs.OP) and bool(gs.op) and int(gs.OPM) == 1)
img = res.XObject.Img
check('image is ICCBased CMYK, 8 bits', str(img.ColorSpace[0]) == '/ICCBased' and int(img.ColorSpace[1].N) == 4 and int(img.BitsPerComponent) == 8)
check('the image and the output intent share one profile object', img.ColorSpace[1].objgen == oi.DestOutputProfile.objgen)

ocp = pdf.Root.OCProperties
names = [str(o.Name) for o in ocp.OCGs]
check('four layers (optional content groups) with names', names == ['Artwork', 'Die line', 'Print marks', 'Guides (screen only)'], names)
usage = {str(o.Name): (str(o.Usage.View.ViewState), str(o.Usage.Print.PrintState)) for o in ocp.OCGs}
check('the guides layer is shown on screen and not printed', usage['Guides (screen only)'] == ('/ON', '/OFF'), usage)
content = page.Contents.read_bytes().decode('latin1')
check('content is wrapped in /OC ... BDC marked content for every layer', all(f'/OC /{n} BDC' in content for n in ['LArt', 'LDie', 'LMarks', 'LGuides']) and content.count('EMC') == 4)
check('layers are referenced through the page /Properties', set(str(k) for k in res.Properties.keys()) == {'/LArt', '/LDie', '/LMarks', '/LGuides'})
pdf.close()

# ---------------- MuPDF: opens, boxes, renders, layers ----------------
doc = pymupdf.open('out/c.pdf')
pg = doc[0]
mb = lambda r: [r.x0, r.y0, r.x1, r.y1]
H = pg.mediabox.height
flip = lambda b: [b[0], H - b[3], b[2], H - b[1]]   # PDF y goes up, MuPDF y goes down
check('MuPDF reads the trim and bleed boxes', close(mb(pg.trimbox), flip(exp['trim']), 0.05) and close(mb(pg.bleedbox), flip(exp['bleed']), 0.05), [mb(pg.trimbox), mb(pg.bleedbox)])
check('MuPDF lists the four layers', sorted(l['text'] for l in doc.layer_ui_configs()) == sorted(names), [l['text'] for l in doc.layer_ui_configs()])

DPI = 288
S = DPI / 72
def render(layers_off=()):
    d = pymupdf.open('out/c.pdf')
    cfg = d.layer_ui_configs()
    for l in cfg:
        if l['text'] in layers_off:
            d.set_layer_ui_config(l['number'], action=1)
    return d[0].get_pixmap(dpi=DPI)
def at(pix, x, y):
    return pix.pixel(int(x * S), int((H - y) * S))
full = render()
gold = at(full, (exp['goldRect'][0] + exp['goldRect'][2]) / 2, (exp['goldRect'][1] + exp['goldRect'][3]) / 2)
half = at(full, (exp['tintRect'][0] + exp['tintRect'][2]) / 2, (exp['tintRect'][1] + exp['tintRect'][3]) / 2)
paper = at(full, exp['bleed'][0] + 2, exp['bleed'][3] - 12)       # bleed area (paper tint) beside the black corner mark
outside = at(full, 3, 3)                                        # outside the bleed: nothing is painted
check('the page is white outside the bleed, tinted inside it', outside == (255, 255, 255) and paper != (255, 255, 255), [outside, paper])
check('the spot colour at 100 % is darker than at 50 %, and both are not paper', sum(gold) < sum(half) < sum(paper), [gold, half])
# the die line is a 0.5 pt magenta stroke on the trim: find magenta-ish pixels along the left edge of the trim box
def magenta_pixels(pix):
    x = int(exp['trim'][0] * S); n = 0
    for xx in range(x - 3, x + 4):
        for yy in range(int((H - exp['trim'][3]) * S) + 20, int((H - exp['trim'][1]) * S) - 20, 7):
            r, g, b = pix.pixel(xx, yy)
            if r > 200 and g < 80 and b > 100: n += 1
    return n
on = magenta_pixels(full)
off = magenta_pixels(render(('Die line',)))
check('the die line is drawn, and disappears when its layer is switched off', on > 10 and off == 0, {'layer on': on, 'layer off': off})
marks_on = at(full, exp['trim'][0] - exp['BLEED'] - 6 * 2.8346 * 1.5, exp['trim'][1])   # on a crop mark
def dark_in_marks(pix):
    n = 0
    y = int((H - exp['trim'][1]) * S)
    for x in range(int((exp['trim'][0] - exp['BLEED'] - 3 * 2.8346 - 6 * 2.8346) * S), int((exp['trim'][0] - exp['BLEED'] - 3 * 2.8346) * S)):
        for yy in range(y - 3, y + 4):
            if sum(pix.pixel(x, yy)) < 200: n += 1
    return n
m_on, m_off = dark_in_marks(full), dark_in_marks(render(('Print marks',)))
check('the crop marks (registration colour) are drawn, and go with their layer', m_on > 10 and m_off == 0, {'layer on': m_on, 'layer off': m_off})
r0 = render(('Artwork',))
check('switching Artwork off removes the gold and the tint', at(r0, (exp['goldRect'][0] + exp['goldRect'][2]) / 2, (exp['goldRect'][1] + exp['goldRect'][3]) / 2) == (255, 255, 255))
R['mupdf_pixels'] = {'gold100': gold, 'gold50': half, 'bleed_paper': paper, 'outside': outside}
pymupdf.open('out/c.pdf')[0].get_pixmap(dpi=100).save('out/c.png')

# ---------------- pdfcpu: an independent validator written in Go ----------------
p = subprocess.run([PDFCPU, 'validate', '-m', 'strict', 'out/c.pdf'], capture_output=True, text=True)
check('pdfcpu validates the file in strict mode', p.returncode == 0, (p.stdout + p.stderr).strip()[:300])
R['tools']['pdfcpu'] = subprocess.run([PDFCPU, 'version'], capture_output=True, text=True).stdout.split('\n')[0]

R['checks'] = checks
R['passed'] = sum(c['ok'] for c in checks); R['total'] = len(checks)
json.dump(R, open('out/validate.json', 'w'), indent=1)
for c in checks: print(('PASS ' if c['ok'] else 'FAIL ') + c['check'] + ('' if c['ok'] else '  -> ' + str(c['detail'])))
print(R['passed'], 'of', R['total'], R['tools'])
