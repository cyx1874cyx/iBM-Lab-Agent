import sys
import csv
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'/'runtime'))
from plot_collision import text_boxes
from plot_job import make_native_input


class PlotCollisionTest(unittest.TestCase):
    def svg(self,location,font='Arial'):
        return f'''<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg" xmlns:olab="http://www.originlab.com/namespaces/olab">
        <text x="10" y="60" font-family="{font}" font-size="20" olab:scope="Layer0.Axis0.SubAxis0.TickLabel-Major"><tspan x="10">1234</tspan></text>
        <text x="{location}" y="60" font-family="{font}" font-size="20" olab:scope="Layer0.Axis0.SubAxis0.Title"><tspan x="{location}">Time</tspan></text></svg>'''

    def run_case(self,location,font='Arial'):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'figure.svg';path.write_text(self.svg(location,font),encoding='utf-8')
            return text_boxes(path,['Time',''])

    def test_title_overlap_is_detected(self):
        self.assertEqual(self.run_case(20)['status'],'detected')
        self.assertEqual(self.run_case(200)['status'],'clear')

    def test_unsupported_font_is_unverified(self):
        self.assertEqual(self.run_case(20,'NotAFont')['status'],'unverified')

    def test_native_table_renames_only_headers_and_preserves_original(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'source.csv';derived=Path(directory)/'derived.csv'
            source.write_text('Time,A,B\n0,"NA","a,b"\n1,1.00e-03,中文\n',encoding='utf-8')
            original=source.read_bytes();headers=make_native_input(source,derived)
            self.assertEqual(headers,['Time','A','B']);self.assertEqual(source.read_bytes(),original)
            with derived.open(encoding='utf-8-sig',newline='') as stream:rows=list(csv.reader(stream))
            self.assertEqual(rows,[['iBMColumn_1','iBMColumn_2','iBMColumn_3'],['0','NA','a,b'],['1','1.00e-03','中文']])


if __name__=='__main__':unittest.main()
