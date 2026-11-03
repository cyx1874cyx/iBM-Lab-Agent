"""Conservative SVG text-box overlap check for Origin axis titles and ticks.

Uses installed fonts and SVG text placement. It is not a pixel-perfect Origin
text rasterizer: missing or unsupported positioning is reported as unverified.
"""
import math
import os
import re
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path

SCOPE='{http://www.originlab.com/namespaces/olab}scope'
IDENTITY=(1,0,0,1,0,0)


def multiply(a,b):
    return (a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5])


def matrix(value):
    result=IDENTITY
    matches=list(re.finditer(r'([a-zA-Z]+)\s*\(([^)]*)\)',value or ''))
    if value and not matches:raise ValueError('unsupported SVG transform')
    if value and re.sub(r'([a-zA-Z]+)\s*\(([^)]*)\)','',value).strip(' ,\t\r\n'):raise ValueError('unsupported SVG transform')
    for match in matches:
        name,arguments=match.groups()
        nums=[float(n) for n in re.findall(r'[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?',arguments)]
        if name=='matrix' and len(nums)==6: part=tuple(nums)
        elif name=='translate' and len(nums) in (1,2): part=(1,0,0,1,nums[0],nums[1] if len(nums)>1 else 0)
        elif name=='scale' and len(nums) in (1,2): part=(nums[0],0,0,nums[-1],0,0)
        elif name=='rotate' and len(nums) in (1,3):
            angle=math.radians(nums[0]);c,s=math.cos(angle),math.sin(angle);part=(c,s,-s,c,0,0)
            if len(nums)==3:part=multiply(multiply((1,0,0,1,nums[1],nums[2]),part),(1,0,0,1,-nums[1],-nums[2]))
        else: raise ValueError('unsupported SVG transform')
        result=multiply(result,part)
    return result


def font_path(family,weight,italic):
    name=family.split(',')[0].strip().strip("'\"").lower()
    files={'arial':('arial.ttf','arialbd.ttf','ariali.ttf','arialbi.ttf'),
           'calibri':('calibri.ttf','calibrib.ttf','calibrii.ttf','calibriz.ttf'),
           'times new roman':('times.ttf','timesbd.ttf','timesi.ttf','timesbi.ttf')}
    if name not in files:raise ValueError('unsupported SVG font')
    index=(1 if weight in ('bold','600','700','800','900') else 0)+(2 if italic else 0)
    path=Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts'/files[name][index]
    if not path.is_file():raise ValueError('SVG font unavailable')
    return str(path)


@lru_cache(maxsize=64)
def load_font(path,size):
    from PIL import ImageFont
    return ImageFont.truetype(path,size)


def text_boxes(path,expected_titles=None,all_text=False):
    root=ET.parse(path).getroot();boxes=[];unknown=[]
    def visit(element,parent=IDENTITY):
        try: transform=multiply(parent,matrix(element.get('transform','')))
        except (ValueError,OverflowError):unknown.append('unsupported transform');return
        scope=element.get(SCOPE,'')
        match=re.fullmatch(r'Layer(\d+)\.Axis(\d+)\.SubAxis\d+\.(Title|TickLabel-(?:Major|Minor))',scope)
        if element.tag.endswith('text') and (match or all_text):
            try:
                if any(element.get(key) for key in ('dx','dy','rotate','textLength')):raise ValueError('unsupported text positioning')
                size=float(element.get('font-size','0'))
                if not math.isfinite(size) or size<=0:raise ValueError('unsupported font size')
                font=load_font(font_path(element.get('font-family',''),element.get('font-weight','400'),element.get('font-style')=='italic'),max(1,round(size)))
                pieces=list(element) or [element]
                for part in pieces:
                    if any(part.get(key) for key in ('dx','dy','rotate','textLength')) or (part is not element and part.get('transform')):raise ValueError('unsupported text positioning')
                    if part is not element and (list(part) or any(part.get(key) for key in ('font-family','font-size','font-weight','font-style'))):raise ValueError('unsupported nested font')
                    if re.search(r'(?i)(?:^|;)\s*(?:font(?:-family|-size|-weight|-style)?|baseline-shift)\s*:',part.get('style','')):raise ValueError('unsupported styled text')
                    text=''.join(part.itertext());x=float(part.get('x',element.get('x','0')));y=float(part.get('y',element.get('y','0')))
                    if not text.strip():continue
                    left,top,right,bottom=font.getbbox(text,anchor='ls');anchor=part.get('text-anchor',element.get('text-anchor','start'))
                    if anchor=='middle':x-=(right-left)/2
                    elif anchor=='end':x-=right-left
                    elif anchor!='start':raise ValueError('unsupported text anchor')
                    pts=[(transform[0]*px+transform[2]*py+transform[4],transform[1]*px+transform[3]*py+transform[5]) for px,py in ((x+left,y+top),(x+right,y+top),(x+right,y+bottom),(x+left,y+bottom))]
                    layer=re.search(r'Layer(\d+)',scope)
                    boxes.append({'layer':int(layer[1]) if layer else 0,'axis':int(match[2]) if match else None,'kind':('title' if match[3]=='Title' else 'tick') if match else 'label','box':[min(p[0] for p in pts),min(p[1] for p in pts),max(p[0] for p in pts),max(p[1] for p in pts)]})
            except (ValueError,OSError,TypeError):unknown.append(scope)
            return
        for child in element:visit(child,transform)
    visit(root)
    if expected_titles:
        for axis,text in enumerate(expected_titles):
            if text and not any(row['kind']=='title' and row['axis']==axis for row in boxes):unknown.append('missing axis title '+str(axis))
    conflicts=[];clipped=[]
    for title in (row for row in boxes if row['kind']=='title'):
        for tick in (row for row in boxes if row['kind']=='tick' and row['layer']==title['layer']):
            a,b=title['box'],tick['box'];overlap=[max(a[0],b[0]),max(a[1],b[1]),min(a[2],b[2]),min(a[3],b[3])]
            if overlap[2]-overlap[0]>1 and overlap[3]-overlap[1]>1:conflicts.append({'layer':title['layer'],'titleAxis':title['axis'],'tickAxis':tick['axis'],'overlap':overlap})
    try:
        view=[float(v) for v in re.split(r'[ ,]+',root.get('viewBox','').strip())]
        if len(view)!=4 or view[2]<=0 or view[3]<=0:raise ValueError('invalid viewBox')
        for row in boxes:
            box=row['box']
            if box[0]<view[0]-1 or box[1]<view[1]-1 or box[2]>view[0]+view[2]+1 or box[3]>view[1]+view[3]+1:clipped.append(row)
    except ValueError:
        unknown.append('missing or invalid SVG viewBox')
    return {'status':'detected' if conflicts or clipped else 'unverified' if unknown or not boxes else 'clear','method':'estimated-svg-font-boxes','conflicts':conflicts,'clipped':clipped,'unverified':unknown,'boxes':boxes}


def page_text_bounds(path):
    result=text_boxes(path,all_text=True)
    # Outside the plot layer is normal for axis titles. Only the SVG page
    # boundary is a clipping failure; overlaps are reported separately.
    result['conflicts']=[]
    result['status']='detected' if result['clipped'] else 'unverified' if result['unverified'] or not result['boxes'] else 'clear'
    return result
