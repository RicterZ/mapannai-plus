"""Generate the MapAnNai pixel art favicon and PWA icons. Requires Pillow."""
from PIL import Image, ImageDraw
S=16
im=Image.new('RGBA',(512,512),(0,0,0,0)); d=ImageDraw.Draw(im)
cream='#FFF5DF'; navy='#2D3547'; orange='#F4A048'; red='#C97157'; yellow='#F9CD72'; skin='#FFE6CB'; blue='#78C7DA'
d.rounded_rectangle((0,0,511,511),radius=132,fill=cream)
def rect(x1,y1,x2,y2,c): d.rectangle((x1*S,y1*S,x2*S-1,y2*S-1),fill=c)
# Pixel power halo, deliberately uneven like a retro game sprite.
for x1,y1,x2,y2 in [(13,3,19,4),(11,4,13,5),(19,4,21,5),(10,5,11,9),(21,5,22,9),(11,9,13,10),(19,9,21,10),(13,10,19,11)]: rect(x1,y1,x2,y2,orange)
rect(15,2,17,7,orange)
# Oversized yellow hoodie silhouette and navy outline.
for x1,y1,x2,y2 in [(10,14,22,16),(8,16,24,19),(7,19,25,27),(9,27,23,29)]: rect(x1,y1,x2,y2,navy)
for x1,y1,x2,y2 in [(10,15,22,17),(9,17,23,20),(8,20,24,27),(10,27,22,28)]: rect(x1,y1,x2,y2,yellow)
# Warm hair blocks, front bangs and small side locks.
for x1,y1,x2,y2 in [(12,12,20,14),(10,14,22,17),(11,17,21,20),(10,19,12,24),(20,19,22,24)]: rect(x1,y1,x2,y2,red)
for x1,y1,x2,y2 in [(13,13,19,15),(11,15,21,17),(12,17,20,18)]: rect(x1,y1,x2,y2,orange)
# Face with pixel fringe, tiny blue eyes.
rect(12,19,20,24,skin); rect(13,18,18,20,skin)
rect(13,21,15,22,navy); rect(18,21,20,22,navy)
rect(15,24,17,25,red)
# Hoodie drawstrings and handheld button accents.
rect(11,25,12,27,cream); rect(20,25,21,27,cream)
rect(16,26,18,27,blue)
for size, name in [(512, 'public/icon-512.png'), (192, 'public/icon-192.png'), (32, 'public/favicon.png')]:
    im.resize((size, size), Image.Resampling.NEAREST).save(name)
im.resize((32, 32), Image.Resampling.NEAREST).save('public/favicon.ico', format='ICO', sizes=[(16, 16), (32, 32)])
# Maskable PWA icon: the motif sits inside the safe zone on an opaque canvas.
maskable = Image.new('RGB', (512, 512), cream)
inner = im.resize((340, 340), Image.Resampling.NEAREST)
maskable.paste(inner, (86, 86), inner)
maskable.save('public/icon-maskable-512.png')
maskable.resize((192, 192), Image.Resampling.NEAREST).save('public/icon-maskable-192.png')
