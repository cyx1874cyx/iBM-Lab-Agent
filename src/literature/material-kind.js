/** Filename hints are routing hints; unlabelled PDFs are classified from their text. */
export const isSiFileName = name => /(?:^|[\s_.-])(?:si|esm|supp(?:lement(?:ary|al)?)?|supporting[\s_-]*(?:information|material)|补充(?:材料|信息)|附件)(?=[\s_.-]|$)/i.test(String(name ?? '').replace(/\.pdf$/i, ''));
export const normalizedPaperTitle = title => String(title ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
