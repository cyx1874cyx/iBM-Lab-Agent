import sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/runtime'))
from plot_collision import page_text_bounds
class TightBoundsTest(unittest.TestCase):
 def check_svg(self,content):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'figure.svg';path.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'+content+'</svg>',encoding='utf8');return page_text_bounds(path)
 def test_root_title_and_legend_are_checked(self):
  for text in ('Title','Legend entry','Annotation'):
   result=self.check_svg(f'<text x="98" y="20" font-family="Arial" font-size="12">{text}</text>')
   self.assertEqual(result['status'],'detected');self.assertTrue(result['clipped'])
 def test_axis_title_outside_layer_but_inside_page_is_allowed(self):
  result=self.check_svg('<text x="0" y="0" font-family="Arial" font-size="10" transform="matrix(0 -1 1 0 12 80)">Signal</text>')
  self.assertEqual(result['status'],'clear',result)
 def test_unmeasurable_text_is_not_reported_clear(self):
  result=self.check_svg('<text x="5" y="20" font-family="UnknownFont" font-size="10">Title</text>')
  self.assertEqual(result['status'],'unverified')
if __name__=='__main__':unittest.main()
