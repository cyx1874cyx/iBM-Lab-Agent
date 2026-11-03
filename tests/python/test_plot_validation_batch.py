import sys,tempfile,unittest
from pathlib import Path
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/runtime'))
from plot_job import stabilize_geometry
class ValidationBatchTest(unittest.IsolatedAsyncioTestCase):
 async def run_case(self,clipped):
  with tempfile.TemporaryDirectory() as directory:
   out=Path(directory);calls=[]
   async def call(tool_name,**fields):
    calls.append(fields['script'])
    self.assertIn('type:=svg',fields['script']);self.assertEqual(fields['script'].count('type:=png'),2)
    for name in ('quick.png','geometry-check.png'):Image.new('RGBA',(100,100),'white').save(out/name)
    (out/'figure.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="{98 if clipped else 5}" y="20" font-family="Arial" font-size="10">Title</text></svg>',encoding='utf8')
   if clipped:
    with self.assertRaisesRegex(RuntimeError,'越界'):await stabilize_geometry(call,'OwnedGraph',out,out/'quick.png',900,tight=True)
    self.assertEqual(len(calls),3)
   else:
    result=await stabilize_geometry(call,'OwnedGraph',out,out/'quick.png',900,tight=True)
    self.assertEqual(result['status'],'clear');self.assertEqual(len(calls),1)
 async def test_stable_pair_and_bounds_share_one_call(self):await self.run_case(False)
 async def test_stable_but_clipped_raster_is_rejected(self):await self.run_case(True)
if __name__=='__main__':unittest.main()
