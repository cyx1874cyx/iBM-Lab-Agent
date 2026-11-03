"""Regression: Windows worker must decode UTF-8 Chinese JSON request paths."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

class SessionEncodingTest(unittest.TestCase):
 def test_unicode_request_path_is_preserved(self):
  script=Path(__file__).resolve().parents[2]/'scripts/runtime/plot_session.py'
  missing=str(script.parent/'科研绘图'/'数据副本'/'不存在.csv')
  request=json.dumps({'args':{'path':missing}},ensure_ascii=False)+'\n'+json.dumps({'close':True})+'\n'
  result=subprocess.run([sys.executable,'-I',str(script)],input=request.encode('utf8'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
  self.assertEqual(result.returncode,0,result.stderr.decode('utf8',errors='replace'))
  response=json.loads(result.stdout.decode('utf8').splitlines()[0])
  self.assertFalse(response['ok'])
  self.assertIn('科研绘图',response['error'])
  self.assertIn('数据副本',response['error'])
  self.assertNotIn('绉戠爺',response['error'])

if __name__=='__main__':unittest.main()
