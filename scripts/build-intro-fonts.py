"""Download pinned Google Fonts sources, instance variable fonts, subset to the intro glyphs as woff2."""
import sys
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

SHA = "6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec"
TEXT = "MacroCunte "
src_dir = Path(sys.argv[1])
out_dir = Path(sys.argv[2])
src_dir.mkdir(parents=True, exist_ok=True)
out_dir.mkdir(parents=True, exist_ok=True)

# id, folder, file, variable-axis pins
FONTS = [
    ("inter-800", "inter", "Inter[opsz,wght].ttf", {"wght": 800, "opsz": 32}),
    ("playfair-700i", "playfairdisplay", "PlayfairDisplay-Italic[wght].ttf", {"wght": 700}),
    ("bungee", "bungee", "Bungee-Regular.ttf", None),
    ("kaushan", "kaushanscript", "KaushanScript-Regular.ttf", None),
    ("spacemono-700", "spacemono", "SpaceMono-Bold.ttf", None),
    ("abril", "abrilfatface", "AbrilFatface-Regular.ttf", None),
    ("pacifico", "pacifico", "Pacifico-Regular.ttf", None),
    ("monoton", "monoton", "Monoton-Regular.ttf", None),
    ("unifraktur", "unifrakturmaguntia", "UnifrakturMaguntia-Book.ttf", None),
    ("bebas", "bebasneue", "BebasNeue-Regular.ttf", None),
    ("cinzel-700", "cinzel", "Cinzel[wght].ttf", {"wght": 700}),
    ("rubikmono", "rubikmonoone", "RubikMonoOne-Regular.ttf", None),
    ("lobster", "lobster", "Lobster-Regular.ttf", None),
]


def fetch(folder, name):
    dest = src_dir / folder / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        url = f"https://raw.githubusercontent.com/google/fonts/{SHA}/ofl/{folder}/{urllib.request.quote(name)}"
        urllib.request.urlretrieve(url, dest)
    return dest


copyrights = []
total = 0
for fid, folder, name, pins in FONTS:
    font = TTFont(fetch(folder, name))
    if pins:
        font = instancer.instantiateVariableFont(font, pins)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(text=TEXT)
    sub.subset(font)
    # Subsets are modified versions: rename them so no Reserved Font Name is used (OFL 1.1, condition 3).
    family = f"MC Intro {fid}"
    ntab = font["name"]
    for nid in (1, 2, 3, 4, 6, 16, 17, 21, 22):
        ntab.removeNames(nameID=nid)
    ntab.setName(family, 1, 3, 1, 0x409)
    ntab.setName("Regular", 2, 3, 1, 0x409)
    ntab.setName(f"{family} subset", 3, 3, 1, 0x409)
    ntab.setName(family, 4, 3, 1, 0x409)
    ntab.setName(family.replace(" ", ""), 6, 3, 1, 0x409)
    out = out_dir / f"{fid}.woff2"
    font.flavor = "woff2"
    font.save(out)
    size = out.stat().st_size
    total += size
    print(f"{fid}: {size} bytes")
    lic = fetch(folder, "OFL.txt").read_text(encoding="utf-8").splitlines()
    head = []
    for line in lic:
        if not line.strip():
            break
        head.append(line.strip())
    copyrights.append(f"{fid}.woff2 (from ofl/{folder}/{name}):\n" + "\n".join(head))

print(f"TOTAL {total} bytes")
(src_dir / "copyrights.txt").write_text("\n".join(copyrights) + "\n", encoding="utf-8")
