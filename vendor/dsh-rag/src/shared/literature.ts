
export const SOURCE_ROLES = ['original', 'reading_note', 'metadata_note', 'supplement', 'thesis'] as const
export type SourceRole = typeof SOURCE_ROLES[number]

export interface LiteratureMetadata {
  readonly paperId: string
  readonly title: string
  readonly doi: string
  readonly authors: readonly string[]
  readonly year?: number
  readonly topics: readonly string[]
  readonly role: SourceRole
  readonly studyType?: string
}

export interface LiteratureFilters {
  readonly topics?: readonly string[]
  readonly roles?: readonly SourceRole[]
  readonly yearFrom?: number
  readonly yearTo?: number
  readonly maxPerPaper?: number
}

export const TOPIC_LABELS: Readonly<Record<string, string>> = {
  SEED: '综述 Review', PATH: '病理 Histology', CT: 'CT CTA', DECT: '双能 光子计数 Spectral CT',
  MRI: '磁共振 MRI', AI: '人工智能 影像组学 Radiomics', US: '超声 Ultrasound', IVUS: '血管内超声 Intravascular ultrasound',
  OCT: '光学相干断层 Optical coherence tomography', DRS: '漫反射 近红外 拉曼 Raman spectroscopy',
  EIS: '电阻抗 Electrical impedance spectroscopy', PA: '光声 Photoacoustic',
  MT: '分子靶向 Molecular imaging', MX: '分子靶向 PET MRI', CLIN: '临床背景 Clinical', THESIS: '学位论文 Thesis',
}

