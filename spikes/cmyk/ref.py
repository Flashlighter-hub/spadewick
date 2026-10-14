"""Reference conversion for spike B: the same patches through Pillow's ImageCms (a separate build of Little CMS,
reached through a different binding than the one the application would use). Usage: python ref.py in.json out.json"""
import json, sys
from PIL import Image, ImageCms

spec = json.load(open(sys.argv[1]))
srgb = ImageCms.createProfile('sRGB')
out = {}
for pid, path in spec['profiles'].items():
    prof = ImageCms.getOpenProfile(path)
    for combo in spec['combos']:
        flags = ImageCms.Flags.BLACKPOINTCOMPENSATION if combo['bpc'] else 0
        t = ImageCms.buildTransform(srgb, prof, 'RGB', 'CMYK', renderingIntent=combo['intent'], flags=flags)
        im = Image.new('RGB', (len(spec['rgb']) // 3, 1))
        im.putdata([tuple(spec['rgb'][i:i + 3]) for i in range(0, len(spec['rgb']), 3)])
        res = ImageCms.applyTransform(im, t)
        out[f"{pid}|{combo['id']}"] = list(res.tobytes())
out['_versions'] = {'pillow': Image.__version__ if hasattr(Image, '__version__') else '', 'littlecms': ImageCms.core.littlecms_version}
json.dump(out, open(sys.argv[2], 'w'))
