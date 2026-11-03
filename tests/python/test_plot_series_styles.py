import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/runtime'))
from plot_editor import series_commands,native_spec,exchanged_property,physical_graph_info
from plot_session import structural

class SeriesStylesTest(unittest.TestCase):
 def test_horizontal_bar_screen_axes_and_text_positions_are_translated_without_changing_archived_spec(self):
  spec={'kind':'bar','xAxis':{'min':-8,'max':0},'yAxis':{'scale':'linear'},'xLabel':'Value','yLabel':'Category','xTitleStyle':{'size':18,'x':.5,'y':1.1},'yTitleStyle':{'size':20,'x':-.15,'y':.5},'legendX':.65,'legendY':.1,'titleStyle':{},'annotations':[]}
  native=native_spec(spec);self.assertEqual(native['yAxis'],{'min':-8,'max':0});self.assertEqual(native['xLabel'],'Category');self.assertEqual(native['yLabel'],'Value');self.assertEqual(native['yTitleStyle']['size'],18);self.assertAlmostEqual(native['yTitleStyle']['x'],-.1);self.assertAlmostEqual(native['legendX'],.9);self.assertAlmostEqual(native['legendY'],.35);self.assertEqual(spec['xLabel'],'Value')
  self.assertEqual(exchanged_property('layer.x.from'),'layer.y.from');self.assertEqual(exchanged_property('xb.x'),'yl.y')
  physical=physical_graph_info({'layers':[{'axes':{'x':{'limits':[.5,3.5]},'y':{'limits':[-8,0]}}}]},spec);self.assertEqual(physical['layers'][0]['axes']['x']['limits'],[-8,0])
 def spec(self,kind):
  return {'kind':kind,'yCols':[2,4],'palette':'classic','lineWidth':3,'symbolSize':5,'lineStyle':'distinct','series':[{'column':4,'color':'#C23D51','fillColor':'#168C60','borderColor':'#314159','lineWidth':2.5,'opacity':.7,'symbolFill':'open','symbolEdgeWidth':25,'barGap':40,'boxWidth':32,'binWidth':10}]}
 def test_each_chart_maps_source_identity_to_its_visible_ink(self):
  for kind in ('line','line_symbol','scatter','column','bar','box','histogram'):
   with self.subTest(kind=kind):
    # A panel contains only column 4: it is plot 1 but keeps source color/style.
    commands=series_commands(self.spec(kind),[4])
    self.assertIn('range ibmSeries0=!1;',commands)
    self.assertIn('-gm 1;',commands)
    self.assertIn('-c color(194,61,81);',commands)
    self.assertIn('-w 1250;',commands)
    if kind in ('column','bar','box','histogram'):
     self.assertIn('-pfb color(22,140,96);',commands)
     self.assertIn('-pbc color(49,65,89);',commands)
     self.assertIn('-pbw 2.5;',commands)
     self.assertIn('-paal '+('0' if kind=='box' else '1')+';',commands)
    if kind in ('scatter','line_symbol'):
     self.assertIn('-csf color(22,140,96);',commands)
     self.assertIn('-cse color(49,65,89);',commands)
     self.assertIn('-kf 3;',commands)
     self.assertIn('-kh 25;',commands)
     self.assertIn('-paas 1;',commands)
 def test_hiding_does_not_replace_opacity_and_defaults_replay(self):
  spec=self.spec('column');spec['series'][0]['visible']=False
  commands=series_commands(spec,[4]);self.assertIn('-s 0;',commands)
  self.assertIn('transparency=30.',commands)
  self.assertIn('-vg 40;',commands)
  spec['series']=[];commands=series_commands(spec,[4])
  self.assertIn('-s 1;',commands);self.assertIn('transparency=0;',commands)
  self.assertIn('-pfb color(0,0,255);',commands);self.assertIn('-vg 20;',commands)
 def test_only_histogram_binning_requires_rebuilding_derived_counts(self):
  spec=self.spec('histogram');old=structural(spec)
  spec['series'][0]['color']='#000000';self.assertEqual(structural(spec),old)
  spec['series'][0]['binWidth']=20;self.assertNotEqual(structural(spec),old)
  spec['series'][0].pop('binWidth');self.assertNotEqual(structural(spec),old)
  spec=self.spec('box');old=structural(spec)
  spec['series'][0]['boxWidth']=50;self.assertEqual(structural(spec),old)
if __name__=='__main__':unittest.main()
