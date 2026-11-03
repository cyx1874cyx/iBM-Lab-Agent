import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image
import pymupdf as pdf
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts' / 'runtime'))
from plot_layout import compose_layout


class LayoutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root/'source.png'
        image = Image.new('RGB', (100, 100))
        image.putdata([(255, 0, 0) if x < 50 and y < 50 else (0, 255, 0) if y < 50 else (0, 0, 255) if x < 50 else (255, 255, 0) for y in range(100) for x in range(100)])
        image.save(self.source)
        vector = pdf.open()
        page = vector.new_page(width=100, height=100)
        for rect, color in [((0, 0, 50, 50), (1, 0, 0)), ((50, 0, 100, 50), (0, 1, 0)), ((0, 50, 50, 100), (0, 0, 1)), ((50, 50, 100, 100), (1, 1, 0))]:
            page.draw_rect(rect, color=None, fill=color)
        self.vector = self.root/'vector.pdf'
        vector.save(self.vector)
        vector.close()

    def tearDown(self):
        self.temp.cleanup()

    def run_case(self, name, vector=False, **patch):
        panel = {'type': 'panel', 'id': 'p', 'assetId': 'a', 'x': 0, 'y': 0, 'w': 25.4, 'h': 25.4, 'rotation': 0, 'crop': {'x': 0, 'y': 0, 'w': 1, 'h': 1}, **patch}
        asset = {'id': 'a', 'image': {'path': str(self.source)}, **({'vector': {'path': str(self.vector)}} if vector else {})}
        return compose_layout({'output': str(self.root/name), 'dpi': 150, 'assets': [asset], 'doc': {'page': {'w': 25.4, 'h': 25.4}, 'labels': {'enabled': False}, 'objects': [panel]}})

    def test_raster_and_vector_rotations_match_and_pdf_keeps_vectors(self):
        expected = {0: (255, 0, 0), 90: (0, 0, 255), 180: (255, 255, 0), 270: (0, 255, 0)}
        for rotation in expected:
            for vector in (False, True):
                result = self.run_case(f'{rotation}-{vector}', vector=vector, rotation=rotation)
                with Image.open(result['saved']['png']['path']) as image:
                    self.assertEqual(image.size, (150, 150))
                    self.assertEqual(image.convert('RGB').getpixel((30, 30)), expected[rotation])
                with pdf.open(result['saved']['pdf']['path']) as document:
                    self.assertAlmostEqual(document[0].rect.width, 72)
                    if vector:
                        self.assertGreater(len(document[0].get_drawings()), 0)

    def test_crop_flip_and_tiff_match_png(self):
        result = self.run_case('crop', crop={'x': 0, 'y': 0, 'w': .5, 'h': 1}, flipV=True)
        with Image.open(result['saved']['png']['path']) as png, Image.open(result['saved']['tiff']['path']) as tiff:
            self.assertEqual(png.convert('RGB').getpixel((30, 30)), (0, 0, 255))
            self.assertEqual(png.tobytes(), tiff.tobytes())

    def test_bad_bounds_are_rejected(self):
        with self.assertRaises(ValueError):
            self.run_case('outside', x=20)

    def test_transparency_labels_and_annotations_are_exported(self):
        panel = {'type': 'panel', 'id': 'p', 'assetId': 'a', 'x': 2, 'y': 2, 'w': 10, 'h': 10, 'opacity': .5}
        objects = [panel, {'type': 'text', 'x': 2, 'y': 15, 'w': 20, 'h': 4, 'text': 'Caption', 'fontSize': 8},
                   {'type': 'arrow', 'x': 13, 'y': 2, 'w': 7, 'h': 7}, {'type': 'rect', 'x': 13, 'y': 10, 'w': 7, 'h': 3},
                   {'type': 'scale', 'x': 2, 'y': 20, 'w': 10, 'h': 4, 'text': '10 um', 'fontSize': 5}]
        result = compose_layout({'output': str(self.root/'annotations'), 'dpi': 150, 'assets': [{'id': 'a', 'image': {'path': str(self.source)}}],
                                 'doc': {'page': {'w': 25.4, 'h': 25.4, 'transparent': True}, 'labels': {'enabled': True, 'size': 5, 'dx': .5, 'dy': .5}, 'objects': objects}})
        with Image.open(result['saved']['png']['path']) as image:
            self.assertEqual(image.mode, 'RGBA')
            self.assertEqual(image.getpixel((0, 0))[3], 0)
            pixel = image.getpixel((35, 35))
            self.assertGreater(pixel[0], 250)
            self.assertTrue(120 <= pixel[3] <= 135)
        with pdf.open(result['saved']['pdf']['path']) as document:
            self.assertIn('Caption', document[0].get_text())
            self.assertIn('(a)', document[0].get_text())
            self.assertIn('10 um', document[0].get_text().replace('\u00a0', ' '))
            self.assertGreater(len(document[0].get_drawings()), 2)


if __name__ == '__main__':
    unittest.main()
