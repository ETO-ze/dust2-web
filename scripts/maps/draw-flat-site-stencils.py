"""Draw the original, high-contrast floor and wall A/B symbols on a shared sRGB atlas."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SIDE = 512
# Work in normalized sign coordinates. Thick stems and counters survive mip filtering.
def polygon_mask(which):
    mask = Image.new('L', (SIDE, SIDE))
    pen = ImageDraw.Draw(mask)
    def polygon(points, fill):
        pen.polygon([(round(x*SIDE/100),round(y*SIDE/100)) for x,y in points],fill)
    if which == 'A':
        polygon([(9,85),(39,14),(60,14),(91,85),(72,85),(66,70),(33,70),(27,85)],255)
        polygon([(39,56),(50,28),(60,56)],0)
    else:
        polygon([(17,14),(60,14),(74,18),(82,26),(84,36),(82,43),(76,49),(84,54),
                 (88,63),(87,71),(82,79),(71,84),(59,86),(17,86)],255)
        polygon([(35,28),(56,28),(63,29),(67,33),(67,38),(63,42),(55,43),(35,43)],0)
        polygon([(35,57),(58,57),(65,58),(70,62),(70,67),(65,71),(58,72),(35,72)],0)
    return mask

def mark(site,wall):
    # Dark RGB under transparent texels gives mip levels a dark outline rather than white fringe.
    dark=(24,31,34,255); ivory=(255,249,230,255)
    accent={'A':(229,113,58,255),'B':(63,180,181,255)}[site]
    image=Image.new('RGBA',(SIDE,SIDE),(*dark[:3],0)); pen=ImageDraw.Draw(image)
    if wall:
        # Transparent outer gutter separates mip levels on the atlas; the side stripe never
        # substitutes for the letter, including for people with colour-vision differences.
        pen.rounded_rectangle((12,12,499,499),radius=13,fill=ivory)
        pen.rounded_rectangle((21,21,490,490),radius=8,fill=dark)
        pen.rectangle((22,28,33,483),fill=accent)
    glyph=polygon_mask(site)
    if not wall:
        image.paste(dark,mask=glyph.filter(ImageFilter.MaxFilter(23)))
        pen.line([(51,462),(455,462)],fill=dark,width=14)
        pen.line([(51,462),(455,462)],fill=accent,width=8)
    image.paste(ivory,mask=glyph)
    return image

if __name__=='__main__':
    atlas=Image.new('RGBA',(SIDE*2,SIDE*2))
    for i,site in enumerate('AB'):
        for j,wall in enumerate((False,True)):
            atlas.paste(mark(site,wall),(i*SIDE,j*SIDE))
    atlas.save(ROOT/'client/flat-site-stencils.png',optimize=True)
