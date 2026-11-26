# Writes src/overlay/font-data.ts: the handwriting font (Caveat, fonts/caveat-variable.woff2, SIL Open Font License 1.1)
# cut down to the characters the overlay writes by hand. It keeps every glyph's outline, the 400-700 weight axis and the
# contextual alternates that vary the letters, so it renders exactly as the full font does. Run it when the font or the
# character set changes:
#
#   uv run --no-project --with fonttools --with brotli scripts/subset-font.py
import base64
from io import BytesIO
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
# Latin-1 (English and Western European text, with the middle dot the labels use), general punctuation (dashes, curly
# quotes, the ellipsis), the euro and trademark signs. Anything else falls back to the next font for that character.
unicodes = [*range(0x20, 0x7F), *range(0xA0, 0x100), *range(0x2010, 0x2028), *range(0x2030, 0x203B), 0x20AC, 0x2122]

font = TTFont(root / "fonts/caveat-variable.woff2")
options = subset.Options()
options.flavor = "woff2"
options.layout_features = ["*"]
options.name_IDs = ["*"]
options.notdef_outline = True
subsetter = subset.Subsetter(options)
subsetter.populate(unicodes=unicodes)
subsetter.subset(font)
data = BytesIO()
font.flavor = "woff2"
font.save(data)
encoded = base64.b64encode(data.getvalue()).decode()
(root / "src/overlay/font-data.ts").write_text(
    "// Caveat, SIL Open Font License 1.1; see OFL.txt. Subset by scripts/subset-font.py from fonts/caveat-variable.woff2.\n"
    f'export const handwritingFont: string = "data:font/woff2;base64,{encoded}";\n'
)
print(f"src/overlay/font-data.ts: {len(data.getvalue())} bytes of WOFF2, {len(font.getBestCmap())} characters")
