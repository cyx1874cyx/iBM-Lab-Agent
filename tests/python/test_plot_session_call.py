"""Regression for tool fields named name in persistent Origin sessions."""
import asyncio
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

class ToolFieldsTest(unittest.TestCase):
 def test_label_name_does_not_collide_with_tool_name(self):
  source=Path(__file__).resolve().parents[2]/'scripts/runtime/plot_session.py'
  spec=importlib.util.spec_from_file_location('tested_plot_session',source)
  worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
  received=[]
  async def call_tool(tool_name,fields):
   received.append((tool_name,fields));return ([],{'ok':True,'data':{'created':True}})
  fake=SimpleNamespace(mcp=SimpleNamespace(call_tool=call_tool))
  with patch.dict(sys.modules,{'origin_mcp.tools._shared':fake}):
   for name in ('ibmTitle','Legend','ibmNote0','ibmPanel'):
    result=asyncio.run(worker.call('origin_add_graph_label',name=name,text='Example'))
    self.assertTrue(result['created'])
    self.assertEqual(received[-1],('origin_add_graph_label',{'name':name,'text':'Example'}))

if __name__=='__main__':unittest.main()
