import csv,sys,tempfile,unittest
from pathlib import Path
from openpyxl import Workbook
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/runtime'))
from plot_job import inspect_table,make_native_input

class P1ImportTest(unittest.TestCase):
 def test_empty_first_sheet_keeps_names_and_later_sheet_can_be_selected(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);book=Workbook();book.active.title='Empty';notes=book.create_sheet('Notes');notes.append(['Read me']);notes.append(['Choose Measurements']);data=book.create_sheet('Measurements');data.append(['Instrument metadata']);data.append(['Time','Response']);data.append([0,11]);data.append([1,22]);source=root/'sheets.xlsx';book.save(source)
   first=inspect_table({'path':str(source),'output':str(root/'first')})
   self.assertEqual(first['sheets'],['Empty','Notes','Measurements']);self.assertEqual(first['rows'],0)
   notes['A1']='说明文字'*80;book.save(source)
   note_profile=inspect_table({'path':str(source),'output':str(root/'notes'),'sheet':'Notes'})
   self.assertEqual(note_profile['sheets'],first['sheets']);self.assertEqual(note_profile['rows'],0)
   selected=inspect_table({'path':str(source),'output':str(root/'selected'),'sheet':'Measurements','headerRow':1})
   self.assertEqual(selected['rows'],2);self.assertEqual(selected['sample'],[[0.,11.],[1.,22.]])
 def test_derived_columns_preserve_requested_order_without_touching_raw_data(self):
  source=Path(__file__).resolve().parents[1]/'fixtures/plot-p1/nonadjacent.csv';raw=source.read_bytes()
  with tempfile.TemporaryDirectory() as directory:
   target=Path(directory)/'packed.csv';names=make_native_input(source,target,columns=[0,4,2])
   with target.open(encoding='utf-8-sig',newline='') as stream:rows=list(csv.reader(stream))
   self.assertEqual(names,['Category','Unused','Signal_A','Noise','Signal_B'])
   self.assertEqual(rows[1],['A','81','11']);self.assertEqual(rows[-1],['D','24','44'])
   self.assertEqual(source.read_bytes(),raw)
if __name__=='__main__':unittest.main()
