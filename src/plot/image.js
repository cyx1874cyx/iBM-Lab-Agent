import {z} from 'zod';

export const imageExtensions=['.png','.jpg','.jpeg','.webp','.tif','.tiff','.bmp','.gif'];
const file=z.object({path:z.string(),fileName:z.string(),byteLength:z.number().nonnegative(),sha256:z.string()});
export const imageEditSchema=z.object({
 crop:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),w:z.number().positive().max(1),h:z.number().positive().max(1)}).default({x:0,y:0,w:1,h:1}),
 rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)]).default(0),
 flipH:z.boolean().default(false),flipV:z.boolean().default(false),
}).strict().refine(s=>s.crop.x+s.crop.w<=1+1e-9&&s.crop.y+s.crop.h<=1+1e-9,'裁剪区域不能超出原图');
export const imageRecordSchema=z.object({
 version:z.literal(1),revision:z.number().int().nonnegative(),raw:file,originalPreview:file,
 width:z.number().int().positive(),height:z.number().int().positive(),format:z.string(),warning:z.string().optional(),
 spec:imageEditSchema,saved:z.object({image:file,preview:file,width:z.number().int().positive(),height:z.number().int().positive()}),savedAt:z.string(),
});
