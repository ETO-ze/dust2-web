"""Preserve original HDR object positions for the anodized-airbrushed Fade finish."""
import os
os.environ['OPENCV_IO_ENABLE_OPENEXR']='1'
import cv2
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
source=ROOT/'artifacts/weapon-expansion/source/weapons/models/glock18/materials/composite_inputs'
image=cv2.imread(str(next(source.glob('*.exr'))),cv2.IMREAD_UNCHANGED)
if image is None: raise RuntimeError('OpenCV could not decode source EXR positions')
# OpenCV uses BGRA; retain only the original RGB coordinates as float32.
image=cv2.resize(image,(2048,2048),interpolation=cv2.INTER_LINEAR)[:,:,[2,1,0]].copy()
image.astype('<f4').tofile(ROOT/'artifacts/weapon-expansion/glock-position.f32')
