import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts' / 'runtime'))
from plot_image import image_job


class ImageEntryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'original.png'
        image = Image.new('RGBA', (8, 6))
        image.putdata([(x*25, y*35, (x+y)*15, 255 if x % 2 else 80) for y in range(6) for x in range(8)])
        image.save(self.source)

    def tearDown(self):
        self.temp.cleanup()

    def test_crop_flip_rotate_preserves_original_and_exact_pixels(self):
        original = self.source.read_bytes()
        for rotation in (0, 90, 180, 270):
            for horizontal, vertical in ((False, False), (True, False), (False, True), (True, True)):
                result = image_job({'path': str(self.source), 'output': str(self.root / f'{rotation}-{horizontal}-{vertical}'), 'spec': {'crop': {'x': .25, 'y': 1/6, 'w': .5, 'h': .5}, 'rotation': rotation, 'flipH': horizontal, 'flipV': vertical}})
                with Image.open(self.source) as image:
                    expected = image.crop((2, 1, 6, 4))
                    if horizontal:
                        expected = expected.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                    if vertical:
                        expected = expected.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
                    expected = expected.rotate(-rotation, expand=True)
                    with Image.open(result['saved']['image']['path']) as actual:
                        self.assertEqual(actual.size, expected.size)
                        self.assertEqual(actual.tobytes(), expected.tobytes())
        self.assertEqual(self.source.read_bytes(), original)

    def test_formats_and_multiframe_notice(self):
        for fmt, extension in [('PNG', 'png'), ('JPEG', 'jpg'), ('WEBP', 'webp'), ('TIFF', 'tif'), ('BMP', 'bmp'), ('GIF', 'gif')]:
            path = self.root / ('input.' + extension)
            Image.new('RGB', (12, 8), 'red').save(path, format=fmt)
            result = image_job({'path': str(path), 'output': str(self.root / extension)})
            self.assertEqual((result['saved']['width'], result['saved']['height']), (12, 8))
        path = self.root / 'multi.gif'
        Image.new('RGB', (12, 8), 'red').save(path, save_all=True, append_images=[Image.new('RGB', (12, 8), 'blue')])
        self.assertIn('第一帧', image_job({'path': str(path), 'output': str(self.root / 'multi')})['warning'])

    def test_exif_orientation_is_normalized(self):
        path = self.root / 'oriented.jpg'
        image = Image.new('RGB', (12, 8), 'red')
        exif = image.getexif()
        exif[274] = 6
        image.save(path, exif=exif)
        result = image_job({'path': str(path), 'output': str(self.root / 'oriented')})
        self.assertEqual((result['width'], result['height']), (8, 12))

    def test_preview_limit_does_not_reduce_export_resolution(self):
        path = self.root / 'wide.png'
        Image.new('RGBA', (3000, 30), (20, 40, 60, 80)).save(path)
        result = image_job({'path': str(path), 'output': str(self.root / 'wide')})
        with Image.open(result['saved']['image']['path']) as exported:
            self.assertEqual(exported.size, (3000, 30))
            self.assertEqual(exported.getpixel((2000, 1)), (20, 40, 60, 80))
        with Image.open(result['saved']['preview']['path']) as preview:
            self.assertEqual(preview.width, 2000)

    def test_invalid_inputs_and_subpixel_crop_fail(self):
        for crop in [{'x': .9, 'y': 0, 'w': .5, 'h': 1}, {'x': 0, 'y': 0, 'w': .001, 'h': .001}]:
            with self.assertRaises(ValueError):
                image_job({'path': str(self.source), 'output': str(self.root / 'invalid'), 'spec': {'crop': crop}})
        fake = self.root / 'fake.png'
        fake.write_bytes(b'not an image')
        with self.assertRaises(Exception):
            image_job({'path': str(fake), 'output': str(self.root / 'fake')})


if __name__ == '__main__':
    unittest.main()
